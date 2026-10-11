import type { ReactNode } from 'react'

import { estimateBitrateKhz } from '@/lib/format'
import type { DpAuxStatusEvent } from '@/lib/hid/device'
import type { HidStatusPayload } from '@/lib/hid/protocol'

// 未连接时的占位统计，全部为 0，保证连接前后面板结构一致
// minIntervalTicks 用 0xFFFF，表示尚无有效测量，和固件约定一致
const EMPTY_STATS: HidStatusPayload = {
  edgeCount: 0,
  frameCount: 0,
  validFrameCount: 0,
  syncErrorCount: 0,
  ringOverrun: 0,
  captureOverrun: 0,
  queueDropCount: 0,
  minIntervalTicks: 0xffff,
  halfTicks: 0,
  tickHzKhz: 0,
  gapCount: 0,
}

type StatsPanelProps = {
  status: DpAuxStatusEvent | null
  statusCount: number
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-3 py-[3px]">
      <span className="text-ink-3 text-xs">{label}</span>
      <span className="text-ink font-mono text-xs font-medium tabular-nums">
        {value}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-line first:border-t-0">
      <div className="text-ink-3 px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
        {title}
      </div>
      <div className="pb-2">{children}</div>
    </div>
  )
}

// 侧栏统计，沿用设备侧累计值，分组展示
export function StatsPanel({ status, statusCount }: StatsPanelProps) {
  const stats = status?.status ?? EMPTY_STATS
  const bitrate = estimateBitrateKhz(stats.tickHzKhz, stats.halfTicks)

  return (
    <div className="flex flex-col">
      <Section title="事务">
        <Row label="捕获边沿" value={stats.edgeCount.toLocaleString()} />
        <Row label="解出事务" value={stats.frameCount.toLocaleString()} />
        <Row label="自洽事务" value={stats.validFrameCount.toLocaleString()} />
        <Row label="同步错误" value={stats.syncErrorCount.toLocaleString()} />
      </Section>

      <Section title="异常">
        <Row label="环形覆盖" value={stats.ringOverrun.toLocaleString()} />
        <Row label="采集溢出" value={stats.captureOverrun.toLocaleString()} />
        <Row label="队列丢弃" value={stats.queueDropCount.toLocaleString()} />
        <Row label="空闲间隔" value={stats.gapCount.toLocaleString()} />
      </Section>

      <Section title="时序">
        <Row
          label="最短间隔"
          value={
            stats.minIntervalTicks === 0xffff
              ? '-'
              : `${stats.minIntervalTicks} tick`
          }
        />
        <Row
          label="半位周期"
          value={stats.halfTicks === 0 ? '-' : `${stats.halfTicks} tick`}
        />
        <Row
          label="Tick 频率"
          value={stats.tickHzKhz === 0 ? '-' : `${stats.tickHzKhz} kHz`}
        />
        <Row
          label="AUX 位速率"
          value={bitrate === null ? '-' : `${bitrate.toFixed(1)} kHz`}
        />
      </Section>

      <div className="border-t border-line px-3 py-3">
        <div className="text-ink-3 flex justify-between text-[11px]">
          <span title="主机收到的状态报文次数，设备每秒上报一次，可用于发现丢报">
            状态上报次数
          </span>
          <span className="text-ink font-mono font-medium tabular-nums">
            {statusCount}
          </span>
        </div>
        <div className="text-ink-3 mt-1 flex justify-between text-[11px]">
          <span>设备时间</span>
          <span className="text-ink font-mono font-medium tabular-nums">
            {status ? `${Math.round(status.timestampUs / 1_000_000)} s` : '-'}
          </span>
        </div>
      </div>
    </div>
  )
}
