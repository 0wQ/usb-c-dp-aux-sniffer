// DP AUX HID 线协议，对应固件 src/usb/hid_protocol.h
//
// IN 和 OUT report 都固定 64 字节，多字节字段为小端
// 字节 0 是应用层 type 或 opcode，设备没有使用 USB HID Report ID

export const HID_REPORT_SIZE = 64
export const HID_IN_HEADER_SIZE = 12
export const HID_IN_PAYLOAD_MAX = HID_REPORT_SIZE - HID_IN_HEADER_SIZE
export const HID_FRAME_HEADER_SIZE = 4
export const HID_FRAME_DATA_MAX = 20
export const HID_OUT_PAYLOAD_MAX = HID_REPORT_SIZE - 2

// IN report 的 type 字段
export const HID_REPORT_TYPE = {
  FRAME: 0x01,
  STATUS: 0x02,
} as const

// OUT report 的 opcode 字段
export const HID_CMD = {
  SET_ENABLED: 0x01,
  GET_STATUS: 0x02,
  CLEAR_STATS: 0x03,
  SET_EDGE: 0x04,
} as const

export type HidFramePayload = {
  flags: number
  bitCount: number
  byteCount: number
  rawBits: number
  data: Uint8Array
}

export type HidStatusPayload = {
  edgeCount: number
  frameCount: number
  validFrameCount: number
  syncErrorCount: number
  ringOverrun: number
  captureOverrun: number
  queueDropCount: number
  minIntervalTicks: number
  halfTicks: number
  tickHzKhz: number
  gapCount: number
}

export type HidFrameReport = {
  type: typeof HID_REPORT_TYPE.FRAME
  seq: number
  timestampUs: number
  frame: HidFramePayload
}

export type HidStatusReport = {
  type: typeof HID_REPORT_TYPE.STATUS
  seq: number
  timestampUs: number
  status: HidStatusPayload
}

export type HidInputReport = HidFrameReport | HidStatusReport

// 一帧解码结果在传输层的表示，供上层解码消费
export type HidFrameEvent = {
  seq: number
  timestampUs: number
  frame: HidFramePayload
}

function readU16Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

function readU32Le(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  )
}

// 解析一个 64 字节的 IN report
// 长度不符或 type 未知时抛错，调用方负责提示
export function parseInputReport(body: Uint8Array): HidInputReport {
  if (body.length !== HID_REPORT_SIZE) {
    throw new Error(
      `IN report 长度应为 ${HID_REPORT_SIZE}，实际 ${body.length}`,
    )
  }

  const type = body[0] ?? 0
  const len = body[1] ?? 0
  if (len > HID_IN_PAYLOAD_MAX) {
    throw new Error(`IN payload 最多 ${HID_IN_PAYLOAD_MAX} 字节，实际 ${len}`)
  }
  const seq = readU32Le(body, 4)
  const timestampUs = readU32Le(body, 8)
  const payload = body.subarray(HID_IN_HEADER_SIZE, HID_IN_HEADER_SIZE + len)

  if (type === HID_REPORT_TYPE.FRAME) {
    return {
      type,
      seq,
      timestampUs,
      frame: parseFramePayload(payload),
    }
  }

  if (type === HID_REPORT_TYPE.STATUS) {
    return {
      type,
      seq,
      timestampUs,
      status: parseStatusPayload(payload),
    }
  }

  throw new Error(`未知的 IN report type 0x${type.toString(16)}`)
}

function parseFramePayload(payload: Uint8Array): HidFramePayload {
  if (payload.length < HID_FRAME_HEADER_SIZE) {
    throw new Error(`FRAME payload 至少 ${HID_FRAME_HEADER_SIZE} 字节`)
  }

  const flags = payload[0] ?? 0
  const bitCount = payload[1] ?? 0
  const byteCount = payload[2] ?? 0
  const rawBits = payload[3] ?? 0
  if (byteCount > HID_FRAME_DATA_MAX) {
    throw new Error(
      `FRAME data 最多 ${HID_FRAME_DATA_MAX} 字节，实际 ${byteCount}`,
    )
  }
  if (payload.length !== HID_FRAME_HEADER_SIZE + byteCount) {
    throw new Error(`FRAME payload 长度与 byteCount 不一致`)
  }
  if (bitCount !== byteCount * 8) {
    throw new Error(`FRAME bitCount 与 byteCount 不一致`)
  }
  const data = payload.slice(
    HID_FRAME_HEADER_SIZE,
    HID_FRAME_HEADER_SIZE + byteCount,
  )

  return { flags, bitCount, byteCount, rawBits, data }
}

function parseStatusPayload(payload: Uint8Array): HidStatusPayload {
  if (payload.length !== 36) {
    throw new Error(`STATUS payload 应为 36 字节，实际 ${payload.length}`)
  }

  return {
    edgeCount: readU32Le(payload, 0),
    frameCount: readU32Le(payload, 4),
    validFrameCount: readU32Le(payload, 8),
    syncErrorCount: readU32Le(payload, 12),
    ringOverrun: readU32Le(payload, 16),
    captureOverrun: readU32Le(payload, 20),
    queueDropCount: readU32Le(payload, 24),
    minIntervalTicks: readU16Le(payload, 28),
    halfTicks: readU16Le(payload, 30),
    tickHzKhz: readU16Le(payload, 32),
    gapCount: readU16Le(payload, 34),
  }
}

// 编码一个 64 字节的 OUT report
// opcode 后面跟 len 和最多 62 字节 payload，剩余部分补 0
export function encodeOutReport(
  opcode: number,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array<ArrayBuffer> {
  if (payload.length > HID_OUT_PAYLOAD_MAX) {
    throw new Error(
      `OUT payload 最多 ${HID_OUT_PAYLOAD_MAX} 字节，实际 ${payload.length}`,
    )
  }

  const body = new Uint8Array(HID_REPORT_SIZE)
  body[0] = opcode
  body[1] = payload.length
  body.set(payload, 2)
  return body
}

export function encodeSetEnabled(enabled: boolean): Uint8Array<ArrayBuffer> {
  return encodeOutReport(HID_CMD.SET_ENABLED, Uint8Array.of(enabled ? 1 : 0))
}

export function encodeSetEdge(falling: boolean): Uint8Array<ArrayBuffer> {
  return encodeOutReport(HID_CMD.SET_EDGE, Uint8Array.of(falling ? 1 : 0))
}

export function encodeGetStatus(): Uint8Array<ArrayBuffer> {
  return encodeOutReport(HID_CMD.GET_STATUS)
}

export function encodeClearStats(): Uint8Array<ArrayBuffer> {
  return encodeOutReport(HID_CMD.CLEAR_STATS)
}
