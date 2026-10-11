import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createDpAuxDevice,
  type DeviceState,
  type DpAuxFrameEvent,
  type DpAuxStatusEvent,
} from '@/lib/hid/device'

// 帧列表最多保留的条数，超过后丢弃最旧的
// 列表用虚拟滚动，所以可以放宽到 1 万条
const MAX_FRAMES = 10000

// 边沿模式持久化，连上设备后按这个值下发一次
const EDGE_MODE_KEY = 'dp-aux-edge-mode'

function readEdgeMode(): 'rising' | 'falling' {
  return localStorage.getItem(EDGE_MODE_KEY) === 'falling'
    ? 'falling'
    : 'rising'
}

export function useDpAuxDevice() {
  const device = useMemo(() => createDpAuxDevice(), [])
  const [state, setState] = useState<DeviceState>(() => device.getState())
  const [frames, setFrames] = useState<DpAuxFrameEvent[]>([])
  const [status, setStatus] = useState<DpAuxStatusEvent | null>(null)
  // 主机侧统计收到的 STATUS 次数，STATUS 的 seq 固件恒为 0，用这个代替序号
  const [statusCount, setStatusCount] = useState(0)
  const [enabled, setEnabled] = useState(true)
  // 边沿模式，下降沿用于线序反接的实验，默认上升沿，持久化到 localStorage
  const [edgeMode, setEdgeModeState] = useState<'rising' | 'falling'>(
    readEdgeMode,
  )

  // 帧会在几十微秒内成批到达，先攒在 ref 里再按动画帧合并刷新
  const pendingFrames = useRef<DpAuxFrameEvent[]>([])
  const flushScheduled = useRef(false)
  // 连接状态跳变和最新边沿模式，供 onState 回调读取
  const wasConnected = useRef(false)
  const edgeModeRef = useRef(edgeMode)
  edgeModeRef.current = edgeMode

  const scheduleFlush = useCallback(() => {
    if (flushScheduled.current) return
    flushScheduled.current = true
    requestAnimationFrame(() => {
      flushScheduled.current = false
      const batch = pendingFrames.current
      if (batch.length === 0) return
      pendingFrames.current = []
      setFrames((prev) => [...batch.reverse(), ...prev].slice(0, MAX_FRAMES))
    })
  }, [])

  useEffect(() => {
    const offState = device.onState((next) => {
      setState(next)
      if (!next.isConnected) {
        setStatusCount(0)
        wasConnected.current = false
        return
      }
      // 刚连上时把本地保存的边沿模式下发给设备，保证两边一致
      if (!wasConnected.current) {
        wasConnected.current = true
        void device
          .setEdge(edgeModeRef.current === 'falling')
          .catch(() => undefined)
      }
    })
    const offFrame = device.onFrame((event) => {
      pendingFrames.current.push(event)
      // 标签页切到后台时 requestAnimationFrame 会暂停，这里给缓冲封顶
      const limit = MAX_FRAMES * 2
      if (pendingFrames.current.length > limit) {
        pendingFrames.current.splice(0, pendingFrames.current.length - limit)
      }
      scheduleFlush()
    })
    const offStatus = device.onStatus((event) => {
      setStatus(event)
      setStatusCount((count) => count + 1)
    })

    // 刷新页面后如果已经授权过，直接复用授权设备
    device.setAutoReconnect(true)
    void device.connectAuthorized().catch(() => undefined)

    return () => {
      offState()
      offFrame()
      offStatus()
      device.dispose()
    }
  }, [device, scheduleFlush])

  const connect = useCallback(async () => {
    await device.connect()
  }, [device])

  const disconnect = useCallback(async () => {
    await device.disconnect()
    setFrames([])
    setStatus(null)
    setStatusCount(0)
  }, [device])

  const setCaptureEnabled = useCallback(
    async (next: boolean) => {
      await device.setEnabled(next)
      setEnabled(next)
    },
    [device],
  )

  const setEdgeMode = useCallback(
    async (mode: 'rising' | 'falling') => {
      await device.setEdge(mode === 'falling')
      setEdgeModeState(mode)
      localStorage.setItem(EDGE_MODE_KEY, mode)
    },
    [device],
  )

  const clearFrames = useCallback(() => {
    setFrames([])
  }, [])

  // 导入或载入 DEMO，文件是旧到新，列表存新到旧
  const loadFrames = useCallback((next: DpAuxFrameEvent[]) => {
    pendingFrames.current = []
    setFrames([...next].reverse().slice(0, MAX_FRAMES))
    setStatusCount(0)
  }, [])

  const clearStats = useCallback(async () => {
    await device.clearStats()
  }, [device])

  const requestStatus = useCallback(async () => {
    await device.requestStatus()
  }, [device])

  return {
    state,
    frames,
    status,
    statusCount,
    enabled,
    edgeMode,
    connect,
    disconnect,
    setCaptureEnabled,
    setEdgeMode,
    clearFrames,
    loadFrames,
    clearStats,
    requestStatus,
  }
}
