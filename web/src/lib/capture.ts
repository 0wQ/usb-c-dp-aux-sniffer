import { formatHex } from '@/lib/format'
import type { DeviceState, DpAuxFrameEvent } from '@/lib/hid/device'
import type { HidStatusPayload } from '@/lib/hid/protocol'

// 抓包文件格式，导入导出共用
//
// 只存元数据和原始帧，解码结果（事务、I2C 聚合、EDID）在导入时重算
// 帧按旧到新存，和人读的顺序一致

export const CAPTURE_FORMAT = 'dp-aux-capture'
export const CAPTURE_VERSION = 1

// 兼容旧的调试导出格式，帧字段一致
const ACCEPTED_FORMATS = new Set([CAPTURE_FORMAT, 'dp-aux-decode'])

export type CaptureFrame = {
  seq: number
  timestampUs: number
  flags: number
  bitCount: number
  byteCount: number
  rawBits: number
  data: string
}

export type CaptureFile = {
  format: string
  version: number
  createdAt: string
  device: {
    productName: string | null
    vendorId: number
    productId: number
  }
  status: HidStatusPayload | null
  frames: CaptureFrame[]
}

export function buildCaptureFile(
  frames: DpAuxFrameEvent[],
  state: DeviceState,
  status: HidStatusPayload | null,
): CaptureFile {
  return {
    format: CAPTURE_FORMAT,
    version: CAPTURE_VERSION,
    createdAt: new Date().toISOString(),
    device: {
      productName: state.productName,
      vendorId: 0x1a86,
      productId: 0x2334,
    },
    status,
    frames: [...frames].reverse().map((event) => ({
      seq: event.seq,
      timestampUs: event.timestampUs,
      flags: event.frame.flags,
      bitCount: event.frame.bitCount,
      byteCount: event.frame.byteCount,
      rawBits: event.frame.rawBits,
      data: formatHex(event.frame.data, ''),
    })),
  }
}

function parseHex(text: string, index: number): Uint8Array {
  const compact = text.replace(/\s+/g, '')
  if (compact.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(compact)) {
    throw new Error(`第 ${index} 帧 data 不是合法十六进制`)
  }
  const data = new Uint8Array(compact.length / 2)
  for (let i = 0; i < compact.length; i += 2) {
    data[i / 2] = Number.parseInt(compact.slice(i, i + 2), 16)
  }
  return data
}

// 解析抓包文件，返回旧到新的帧列表
export function parseCaptureFile(text: string): DpAuxFrameEvent[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('不是有效的 JSON 文件')
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('文件内容不是对象')
  }
  const file = parsed as Partial<CaptureFile>
  if (typeof file.format !== 'string' || !ACCEPTED_FORMATS.has(file.format)) {
    throw new Error(`不是 DP AUX 抓包文件（format=${String(file.format)}）`)
  }
  if (!Array.isArray(file.frames)) {
    throw new Error('缺少 frames 数组')
  }

  return file.frames.map((frame, index) => {
    if (frame === null || typeof frame !== 'object') {
      throw new Error(`第 ${index} 帧不是对象`)
    }
    const data = parseHex(String(frame.data ?? ''), index)
    return {
      seq: Number(frame.seq) || 0,
      timestampUs: Number(frame.timestampUs) || 0,
      frame: {
        flags: Number(frame.flags) || 0,
        bitCount: Number(frame.bitCount) || data.length * 8,
        byteCount: Number(frame.byteCount) || data.length,
        rawBits: Number(frame.rawBits) || data.length * 8,
        data,
      },
    }
  })
}

// 触发浏览器下载
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
