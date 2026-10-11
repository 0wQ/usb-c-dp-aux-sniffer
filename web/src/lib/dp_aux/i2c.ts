import type { DdcResult } from './ddc'
import { describeEdidBlock, type EdidResult, type EdidSection } from './edid'
import type { Exchange } from './exchange'
import type { AuxTransaction } from './frame'

// I2C-over-AUX 传输重组
//
// 移植自 firmware/tools/dp_aux_protocol.py 的 EdidAssembler
// 指针写（0x50）设定偏移，段写（0x30）设定段，随后反复的 DEFER 重试和最终
// ACK 读按偏移拼成完整块。只有自洽的事务进入组装器
//
// 另外把连续的同地址 I2C 事务聚成一次「传输」，和 ET240 的 Group I2C Transfer 对应

export type EdidBlock = {
  block: number
  bytes: Uint8Array
  header: boolean
  checksum: boolean
  sections: EdidSection[]
  errors: string[]
}

export type I2cTransfer = {
  key: string
  address: number
  timestampUs: number
  startSeq: number
  endSeq: number
  exchangeKeys: string[]
  offset: number | null
  segment: number
  bytes: Uint8Array
  blocks: EdidBlock[]
  // 这次传输里各事务的 DDC/CI 解码
  ddc: DdcResult[]
  details: string[]
  errors: string[]
}

export type I2cAnalysis = {
  transfers: I2cTransfer[]
  blocks: EdidBlock[]
  // 事务 key 到所属传输 key
  transferByExchange: Map<string, string>
}

// 连续 I2C 事务间隔超过这个值就断开成两次传输
const TRANSFER_GAP_US = 100000

function isByte(data: Uint8Array, value: number): boolean {
  return data.length === 1 && data[0] === value
}

function isEmpty(data: Uint8Array): boolean {
  return data.length === 0
}

// 跨帧组装 EDID，状态机随捕获上下文推进
class EdidAssembler {
  segment = 0
  private segmentObserved = false
  private segmentUncertain = false
  private segmentNoteReported = false
  private pendingPointer: AuxTransaction | null = null
  offset: number | null = null
  private bytes = new Map<number, number>()
  private reported = new Set<number>()
  completed: EdidBlock[] = []

  accept(
    req: AuxTransaction,
    reply: AuxTransaction,
  ): { details: string[]; errors: string[] } {
    const details: string[] = []
    const errors: string[] = []
    if (req.native) return { details, errors }

    if (req.operation === 'wsr') {
      const previous = this.pendingPointer
      if (
        previous &&
        req.address === previous.address &&
        reply.command === 0 &&
        (isEmpty(reply.data) || isByte(reply.data, 1))
      ) {
        this.pendingPointer = null
        return this.accept(previous, reply)
      }
      return { details, errors }
    }

    if (reply.command !== 0) {
      // 部分完成或延迟的 I2C 工作无法确定指针
      if (req.address === 0x30 || req.address === 0x50) {
        this.offset = null
        if (
          req.operation === 'writ' &&
          req.data.length === 1 &&
          reply.command === 8
        ) {
          this.pendingPointer = req
        }
        if (req.address === 0x30) {
          this.segmentObserved = false
          this.segmentUncertain = true
        }
      }
      return { details, errors }
    }

    if (req.addressOnly) return { details, errors }

    if (
      req.operation === 'writ' &&
      (req.address === 0x30 || req.address === 0x50)
    ) {
      this.pendingPointer = null
      if (
        req.data.length !== 1 ||
        !(isEmpty(reply.data) || isByte(reply.data, 1))
      ) {
        this.offset = null
        if (req.data.length === 1 && isByte(reply.data, 0)) {
          this.pendingPointer = req
        }
        return { details, errors }
      }
    }

    if (
      req.operation === 'writ' &&
      req.data.length === 1 &&
      (isEmpty(reply.data) || isByte(reply.data, req.data.length))
    ) {
      if (req.address === 0x30) {
        this.segment = req.data[0] ?? 0
        this.segmentObserved = true
        this.segmentUncertain = false
      } else if (req.address === 0x50) {
        this.offset = req.data[0] ?? 0
      }
      return { details, errors }
    }

    if (req.operation !== 'read' || req.address !== 0x50) {
      return { details, errors }
    }
    if (this.offset === null) {
      return { details: ['EDID 偏移未知，缺少指针写'], errors }
    }
    if (this.segmentUncertain) {
      return { details: ['EDID 段未知，段写未完成'], errors }
    }
    if (!this.segmentObserved && !this.segmentNoteReported) {
      details.push('EDID 假定 segment=0，未捕获段指针')
      this.segmentNoteReported = true
    }

    const touched = new Set<number>()
    const baseOffset = this.offset
    reply.data.forEach((value, index) => {
      const pos = this.segment * 256 + ((baseOffset + index) & 255)
      touched.add(Math.floor(pos / 128))
      const previous = this.bytes.get(pos)
      if (previous !== undefined && previous !== value) {
        errors.push(
          `EDID 字节 0x${pos.toString(16).toUpperCase().padStart(3, '0')} 变化 ${previous.toString(16).toUpperCase().padStart(2, '0')} 到 ${value.toString(16).toUpperCase().padStart(2, '0')}`,
        )
        this.reported.delete(Math.floor(pos / 128))
      }
      this.bytes.set(pos, value)
    })
    this.offset = (this.offset + reply.data.length) & 255

    for (const block of [...touched].sort((a, b) => a - b)) {
      if (this.reported.has(block)) continue
      const blockBytes = new Uint8Array(128)
      let complete = true
      for (let i = 0; i < 128; i += 1) {
        const value = this.bytes.get(block * 128 + i)
        if (value === undefined) {
          complete = false
          break
        }
        blockBytes[i] = value
      }
      if (!complete) continue

      const headerOk =
        block !== 0 ||
        [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00].every(
          (value, index) => blockBytes[index] === value,
        )
      let sum = 0
      for (const byte of blockBytes) sum += byte
      const checksumOk = (sum & 255) === 0

      let decoded: EdidResult = { sections: [], errors: [] }
      if (!headerOk || !checksumOk) {
        errors.push(`EDID block ${block} 头或 checksum 校验失败`)
      } else {
        decoded = describeEdidBlock(blockBytes, block)
        errors.push(...decoded.errors)
      }

      this.completed.push({
        block,
        bytes: blockBytes,
        header: headerOk,
        checksum: checksumOk,
        sections: decoded.sections,
        errors: decoded.errors,
      })
      this.reported.add(block)
    }

    return { details, errors }
  }

  // 已重组的字节按偏移升序，缺洞处截断
  assembled(): Uint8Array {
    if (this.bytes.size === 0) return new Uint8Array(0)
    const max = Math.max(...this.bytes.keys())
    const out: number[] = []
    for (let i = 0; i <= max; i += 1) {
      const value = this.bytes.get(i)
      if (value === undefined) break
      out.push(value)
    }
    return Uint8Array.from(out)
  }
}

// 判断一次事务是不是 I2C-over-AUX 访问
// EDID 组装只看 0x30/0x50，这里放宽到所有 I2C 地址，DDC/CI 的 0x37 也要聚
function isI2cExchange(exchange: Exchange): boolean {
  const req = exchange.request
  return !!req && !req.native
}

export function analyzeI2c(exchanges: Exchange[]): I2cAnalysis {
  // exchanges 已经是旧到新，直接按顺序喂给组装器
  const assembler = new EdidAssembler()
  const transfers: I2cTransfer[] = []
  const transferByExchange = new Map<string, string>()

  // 先把连续的 I2C 事务切成传输段，段写 0x30 和数据读 0x50 属于同一次会话
  type Group = { exchanges: Exchange[] }
  const groups: Group[] = []
  let currentGroup: Group | null = null
  let lastTimestamp = 0

  for (const exchange of exchanges) {
    if (!isI2cExchange(exchange)) {
      currentGroup = null
      continue
    }
    const gap = exchange.timestampUs - lastTimestamp
    if (!currentGroup || gap > TRANSFER_GAP_US) {
      currentGroup = { exchanges: [] }
      groups.push(currentGroup)
    }
    lastTimestamp = exchange.timestampUs
    currentGroup.exchanges.push(exchange)
  }

  // 再按时间顺序喂给组装器，记录每段新完成的块
  for (const group of groups) {
    const first = group.exchanges[0]
    const last = group.exchanges[group.exchanges.length - 1]
    if (!first || !last) continue
    const before = assembler.completed.length
    const details: string[] = []
    const errors: string[] = []

    for (const exchange of group.exchanges) {
      if (
        exchange.kind === 'exchange' &&
        exchange.errors.length === 0 &&
        exchange.request &&
        exchange.reply
      ) {
        const result = assembler.accept(exchange.request, exchange.reply)
        details.push(...result.details)
        errors.push(...result.errors)
      }
    }

    const transfer: I2cTransfer = {
      key: `i2c-${first.frames[0]?.seq ?? 0}`,
      // 会话里出现过 0x50 读就标成 EDID，否则用首个请求的地址
      address: group.exchanges.some((item) => item.request?.address === 0x50)
        ? 0x50
        : (group.exchanges[0]?.request?.address ?? 0),
      timestampUs: first.timestampUs,
      startSeq: first.frames[0]?.seq ?? 0,
      endSeq: last.frames[last.frames.length - 1]?.seq ?? 0,
      exchangeKeys: group.exchanges.map((item) => item.key),
      offset: assembler.offset,
      segment: assembler.segment,
      bytes: assembler.assembled(),
      blocks: assembler.completed.slice(before),
      ddc: group.exchanges
        .map((item) => item.ddc)
        .filter((value): value is DdcResult => value !== null),
      details,
      errors,
    }
    transfers.push(transfer)
    for (const exchange of group.exchanges) {
      transferByExchange.set(exchange.key, transfer.key)
    }
  }

  return { transfers, blocks: assembler.completed, transferByExchange }
}
