import { estimateBitrateKhz } from '@/lib/format'
import type { DeviceState, DpAuxStatusEvent } from '@/lib/hid/device'

type StatusBarProps = {
  state: DeviceState
  status: DpAuxStatusEvent | null
  frameCount: number
  enabled: boolean
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-ink-3">{label}</span>
      <span className="text-ink font-mono font-medium tabular-nums">
        {value}
      </span>
    </span>
  )
}

// 底部状态栏，一条线汇总当前链路和解码概况
export function StatusBar({
  state,
  status,
  frameCount,
  enabled,
}: StatusBarProps) {
  const stats = status?.status
  const bitrate = stats
    ? estimateBitrateKhz(stats.tickHzKhz, stats.halfTicks)
    : null
  const validRate =
    stats && stats.frameCount > 0
      ? `${((stats.validFrameCount / stats.frameCount) * 100).toFixed(1)}%`
      : '-'

  return (
    <footer className="bg-chrome text-ink-3 flex h-7 shrink-0 items-center gap-4 border-t border-line px-3 text-[11px]">
      <Item label="链路" value={state.isConnected ? '已连接' : '未连接'} />
      <Item label="采集" value={enabled ? '开' : '关'} />
      <Item label="列表" value={frameCount.toLocaleString()} />
      <Item label="自洽率" value={validRate} />
      <Item
        label="AUX 位速率"
        value={bitrate === null ? '-' : `${bitrate.toFixed(1)} kHz`}
      />
    </footer>
  )
}
