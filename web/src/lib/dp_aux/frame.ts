// DP AUX 帧解析
//
// 移植自 firmware/tools/dp_aux_protocol.py 的 parse_request/parse_reply/validate_reply
// 命令 nibble 的语义：bit3 置 1 是 DP 原生，bit2 是 I2C 的 MOT，低两位是读写操作
// 回复的高 nibble 是回复类型，不是请求命令

// 帧结构标志，对应固件 DP_AUX_FLAG_*
export const DP_AUX_FLAG = {
  SYNC_OK: 1 << 0,
  STOP_OK: 1 << 1,
  ALIGN: 1 << 2,
  ALIGN_FIX: 1 << 3,
  INTERVAL: 1 << 4,
  VALID: 1 << 5,
  TRUNCATED: 1 << 6,
  IDLE: 1 << 7,
} as const

export function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0
}

// 解码层的最小输入，结构上兼容 HID 层的帧事件
// 这样 dp_aux 不依赖传输层类型
export type AuxFrameInput = {
  seq: number
  timestampUs: number
  frame: {
    flags: number
    bitCount: number
    byteCount: number
    data: Uint8Array
  }
}

export type AuxDirection = 'request' | 'reply'

export type AuxTransaction = {
  direction: AuxDirection
  command: number
  address: number | null
  // 请求里的 LEN 字段，等于 N-1
  encodedLength: number | null
  length: number
  data: Uint8Array
  addressOnly: boolean
  native: boolean
  mot: boolean
  operation: string
}

// 回复类型，对应 DP 2.0 表 2-172
export const REPLY_NAMES: Record<number, string> = {
  0: 'ACK',
  1: 'NACK',
  2: 'DEFER',
  4: 'I2C_NACK',
  8: 'I2C_DEFER',
}

const REQUEST_COMMANDS = new Set([0, 1, 2, 4, 5, 6, 8, 9])
const REPLY_COMMANDS = new Set([0, 1, 2, 4, 8])

export function requestCommandName(command: number): string {
  const native = command === 8 || command === 9
  const operation = command & 3
  const name =
    operation === 0
      ? 'Write'
      : operation === 1
        ? 'Read'
        : operation === 2
          ? 'Write Status'
          : `0x${command.toString(16).toUpperCase()}`
  return `${native ? 'Native' : 'I2C'} ${name}`
}

function requestOperation(command: number): string {
  const operation = command & 3
  return operation === 0 ? 'writ' : operation === 1 ? 'read' : 'wsr'
}

function toTransaction(
  direction: AuxDirection,
  command: number,
  fields: Partial<AuxTransaction>,
): AuxTransaction {
  return {
    direction,
    command,
    address: null,
    encodedLength: null,
    length: 0,
    data: new Uint8Array(0),
    addressOnly: false,
    native: direction === 'request' && (command === 8 || command === 9),
    mot:
      direction === 'request' &&
      command !== 8 &&
      command !== 9 &&
      !!(command & 4),
    operation:
      direction === 'reply'
        ? (REPLY_NAMES[command] ?? 'REPLY')
        : requestOperation(command),
    ...fields,
  }
}

export function parseRequest(data: Uint8Array): AuxTransaction {
  if (data.length < 3) throw new Error('请求头不足 3 字节')
  const command = (data[0] ?? 0) >> 4
  if (!REQUEST_COMMANDS.has(command)) {
    throw new Error(`保留的请求命令 0x${command.toString(16).toUpperCase()}`)
  }
  const address =
    (((data[0] ?? 0) << 16) | ((data[1] ?? 0) << 8) | (data[2] ?? 0)) & 0xfffff
  const native = command === 8 || command === 9
  if (!native && address > 0x7f) {
    throw new Error(
      `I2C 地址 0x${address.toString(16).toUpperCase().padStart(5, '0')} 超过 7 位`,
    )
  }
  const operation = command & 3
  if (data.length === 3) {
    if (native) throw new Error('只带地址的请求仅对 I2C 有效')
    return toTransaction('request', command, { address, addressOnly: true })
  }
  const encoded = data[3] ?? 0
  if (operation === 2) {
    if (encoded !== 0 || data.length !== 4) {
      throw new Error('I2C 写状态请求要求 LEN=0 且共 4 字节')
    }
    return toTransaction('request', command, {
      address,
      encodedLength: encoded,
    })
  }
  if (encoded > 15) {
    throw new Error(
      `LEN=0x${encoded.toString(16).toUpperCase().padStart(2, '0')} 超出 0..15`,
    )
  }
  const length = encoded + 1
  const want = operation === 0 ? 4 + length : 4
  if (data.length !== want) {
    throw new Error(
      `${operation === 0 ? '写' : '读'}需要 ${want} 字节，实际 ${data.length} 字节 (LEN=${encoded}, N=${length})`,
    )
  }
  return toTransaction('request', command, {
    address,
    encodedLength: encoded,
    length,
    data: data.slice(4),
  })
}

export function parseReply(data: Uint8Array): AuxTransaction {
  if (data.length < 1 || data.length > 17) {
    throw new Error('回复需要 1..17 字节')
  }
  const command = (data[0] ?? 0) >> 4
  if ((data[0] ?? 0) & 15) throw new Error('回复填充 nibble 必须为 0')
  if (!REPLY_COMMANDS.has(command)) {
    throw new Error(`保留的回复命令 0x${command.toString(16).toUpperCase()}`)
  }
  const n = data.length - 1
  if ((command === 2 || command === 8) && n) {
    throw new Error('DEFER 回复不能带数据')
  }
  if ((command === 1 || command === 4) && n > 1) {
    throw new Error('NACK 回复最多带一个已写字节数')
  }
  return toTransaction('reply', command, { length: n, data: data.slice(1) })
}

export type FrameParse =
  | { kind: 'request'; transaction: AuxTransaction }
  | { kind: 'reply'; transaction: AuxTransaction }
  | { kind: 'ambiguous'; request: AuxTransaction; reply: AuxTransaction }
  | { kind: 'unknown'; errors: string[] }

// 一帧字节流同时满足请求和回复的形状时判为有歧义
export function parseFrame(data: Uint8Array): FrameParse {
  const found: AuxTransaction[] = []
  const errors: string[] = []
  for (const parse of [parseRequest, parseReply]) {
    try {
      found.push(parse(data))
    } catch (caught) {
      errors.push(caught instanceof Error ? caught.message : '解析失败')
    }
  }
  if (found.length === 2) {
    return {
      kind: 'ambiguous',
      request: found[0] as AuxTransaction,
      reply: found[1] as AuxTransaction,
    }
  }
  if (found.length === 1) {
    const transaction = found[0] as AuxTransaction
    return transaction.direction === 'request'
      ? { kind: 'request', transaction }
      : { kind: 'reply', transaction }
  }
  return { kind: 'unknown', errors }
}

// 校验回复与请求是否自洽，返回问题列表，空列表代表通过
export function validateReply(
  request: AuxTransaction,
  reply: AuxTransaction,
): string[] {
  const n = reply.data.length
  const command = reply.command
  if (request.native && (command === 4 || command === 8)) {
    return ['原生请求收到了 I2C 回复状态']
  }
  if (command === 2 || command === 8) return []
  if (request.addressOnly) {
    return n === 0 ? [] : ['只带地址的回复不能带数据']
  }
  if (request.operation === 'read') {
    if (command === 1 && request.native) {
      return ['原生读对不支持的地址用 ACK 加 0，而不是 NACK']
    }
    if (command === 1 || command === 4) {
      return n === 0 ? [] : ['读 NACK 不能带数据']
    }
    return n <= request.length
      ? []
      : [`回复 ${n} 字节，请求最多 ${request.length} 字节`]
  }
  if (request.native && command === 0 && n) {
    return ['原生写 ACK 不能带数据']
  }
  if (command === 1 && n !== 1) return ['AUX 写 NACK 需要一个已写字节数 M']
  if (n > 1) return ['写回复最多带一个已写字节数 M']
  if (
    n &&
    request.operation !== 'wsr' &&
    (reply.data[0] ?? 0) > request.length
  ) {
    return [`已写字节数 M=${reply.data[0]} 超过 ${request.length}`]
  }
  return []
}

// 展开 flags 为可读标签，顺序按固件头文件
export function describeFlags(flags: number): string[] {
  const labels: string[] = []
  if (hasFlag(flags, DP_AUX_FLAG.SYNC_OK)) labels.push('SYNC_OK')
  if (hasFlag(flags, DP_AUX_FLAG.STOP_OK)) labels.push('STOP_OK')
  if (hasFlag(flags, DP_AUX_FLAG.ALIGN)) labels.push('ALIGN')
  if (hasFlag(flags, DP_AUX_FLAG.ALIGN_FIX)) labels.push('ALIGN_FIX')
  if (hasFlag(flags, DP_AUX_FLAG.INTERVAL)) labels.push('INTERVAL')
  if (hasFlag(flags, DP_AUX_FLAG.VALID)) labels.push('VALID')
  if (hasFlag(flags, DP_AUX_FLAG.TRUNCATED)) labels.push('TRUNCATED')
  if (hasFlag(flags, DP_AUX_FLAG.IDLE)) labels.push('IDLE')
  return labels
}
