import {
  encodeClearStats,
  encodeGetStatus,
  encodeSetEdge,
  encodeSetEnabled,
  type HidFrameEvent,
  type HidStatusReport,
  parseInputReport,
} from './protocol'

// WebHID 设备封装
//
// 负责枚举授权设备，打开输入报告通道，把解析后的 FRAME 和 STATUS 分发给订阅者
// 上层只关心数据和连接状态，不直接接触 HIDDevice

export const DEVICE_FILTER = {
  vendorId: 0x1a86,
  productId: 0x2334,
} as const

export type DeviceState = {
  isSupported: boolean
  isConnected: boolean
  isConnecting: boolean
  error: string | null
  productName: string | null
}

export type DpAuxFrameEvent = HidFrameEvent

export type DpAuxStatusEvent = {
  seq: number
  timestampUs: number
  status: HidStatusReport['status']
}

type FrameListener = (event: DpAuxFrameEvent) => void
type StatusListener = (event: DpAuxStatusEvent) => void
type StateListener = (state: DeviceState) => void

function getHid(): HID | null {
  const nav = globalThis.navigator as Navigator & { hid?: HID }
  return nav.hid ?? null
}

function deviceName(device: HIDDevice): string {
  return device.productName || `0x${device.vendorId.toString(16)}`
}

export function createDpAuxDevice() {
  const hid = getHid()
  const frameListeners = new Set<FrameListener>()
  const statusListeners = new Set<StatusListener>()
  const stateListeners = new Set<StateListener>()

  let device: HIDDevice | null = null
  let isConnecting = false
  let error: string | null =
    hid === null
      ? '当前浏览器不支持 WebHID，请使用 Chrome、Edge 或 Opera'
      : null
  let autoReconnect = false
  let disposed = false

  const snapshot = (): DeviceState => ({
    isSupported: hid !== null,
    isConnected: device?.opened ?? false,
    isConnecting,
    error,
    productName: device ? deviceName(device) : null,
  })

  const emitState = () => {
    const state = snapshot()
    for (const listener of stateListeners) listener(state)
  }

  const handleInputReport = (event: HIDInputReportEvent) => {
    try {
      const body = new Uint8Array(
        event.data.buffer,
        event.data.byteOffset,
        event.data.byteLength,
      )
      const report = parseInputReport(body)
      if (report.type === 0x02) {
        for (const listener of statusListeners) {
          listener({
            seq: report.seq,
            timestampUs: report.timestampUs,
            status: report.status,
          })
        }
        return
      }
      for (const listener of frameListeners) {
        listener({
          seq: report.seq,
          timestampUs: report.timestampUs,
          frame: report.frame,
        })
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : '解析输入报告失败'
      emitState()
    }
  }

  const attach = async (next: HIDDevice) => {
    if (disposed) return
    if (!next.opened) {
      isConnecting = true
      emitState()
      try {
        await next.open()
      } catch (caught) {
        error = caught instanceof Error ? caught.message : '打开 HID 设备失败'
        throw caught
      } finally {
        isConnecting = false
      }
    }

    device = next
    error = null
    next.addEventListener('inputreport', handleInputReport)
    emitState()
    // 打开后立刻拉一次状态，界面不用等周期上报
    void sendCommand(encodeGetStatus())
  }

  const detach = async () => {
    const current = device
    if (!current) {
      emitState()
      return
    }
    current.removeEventListener('inputreport', handleInputReport)
    device = null
    try {
      if (current.opened) await current.close()
    } finally {
      emitState()
    }
  }

  const connectAuthorized = async (): Promise<void> => {
    if (!hid || device?.opened) return
    const devices = await hid.getDevices()
    const match = devices.find(
      (item) =>
        item.vendorId === DEVICE_FILTER.vendorId &&
        item.productId === DEVICE_FILTER.productId,
    )
    if (!match) return
    await attach(match)
  }

  const handleConnect = () => {
    if (!autoReconnect || disposed || device?.opened) return
    void connectAuthorized().catch((caught: unknown) => {
      error = caught instanceof Error ? caught.message : '自动重连失败'
      emitState()
    })
  }

  const handleDisconnect = (event: HIDConnectionEvent) => {
    if (!device || event.device !== device) return
    device.removeEventListener('inputreport', handleInputReport)
    device = null
    emitState()
  }

  if (hid) {
    hid.addEventListener('connect', handleConnect)
    hid.addEventListener('disconnect', handleDisconnect)
  }

  const sendCommand = async (body: Uint8Array<ArrayBuffer>) => {
    if (!device?.opened) {
      throw new Error('没有已连接的 HID 设备')
    }
    await device.sendReport(0, body)
  }

  return {
    get isSupported() {
      return hid !== null
    },
    get isConnected() {
      return device?.opened ?? false
    },
    getState(): DeviceState {
      return snapshot()
    },
    // 弹出浏览器设备选择框，只在用户点击时调用
    async connect(): Promise<void> {
      if (!hid) {
        throw new Error('当前浏览器不支持 WebHID，请使用 Chrome、Edge 或 Opera')
      }
      isConnecting = true
      emitState()
      try {
        const devices = await hid.requestDevice({ filters: [DEVICE_FILTER] })
        const selected = devices[0]
        if (!selected) return
        await attach(selected)
      } catch (caught) {
        // 用户取消选择框不算错误
        if (!(caught instanceof Error && caught.name === 'NotFoundError')) {
          error = caught instanceof Error ? caught.message : '连接 HID 设备失败'
        }
        throw caught
      } finally {
        isConnecting = false
        emitState()
      }
    },
    // 复用浏览器已经授权的设备，用于刷新页面后自动重连
    connectAuthorized,
    async disconnect(): Promise<void> {
      await detach()
    },
    setAutoReconnect(enabled: boolean) {
      autoReconnect = enabled
    },
    async setEnabled(enabled: boolean): Promise<void> {
      await sendCommand(encodeSetEnabled(enabled))
    },
    async setEdge(falling: boolean): Promise<void> {
      await sendCommand(encodeSetEdge(falling))
    },
    async requestStatus(): Promise<void> {
      await sendCommand(encodeGetStatus())
    },
    async clearStats(): Promise<void> {
      await sendCommand(encodeClearStats())
    },
    onFrame(listener: FrameListener) {
      frameListeners.add(listener)
      return () => frameListeners.delete(listener)
    },
    onStatus(listener: StatusListener) {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    onState(listener: StateListener) {
      stateListeners.add(listener)
      listener(snapshot())
      return () => stateListeners.delete(listener)
    },
    dispose() {
      disposed = true
      if (hid) {
        hid.removeEventListener('connect', handleConnect)
        hid.removeEventListener('disconnect', handleDisconnect)
      }
      if (device) {
        device.removeEventListener('inputreport', handleInputReport)
        device = null
      }
      emitState()
    },
  }
}

export type DpAuxDevice = ReturnType<typeof createDpAuxDevice>
