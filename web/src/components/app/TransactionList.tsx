import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { VirtualList } from '@/components/app/VirtualList'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { DdcResult } from '@/lib/dp_aux/ddc'
import { type DpcdField, describeDpcd, dpcdName } from '@/lib/dp_aux/dpcd'
import type { EdidSection } from '@/lib/dp_aux/edid'
import type { Exchange } from '@/lib/dp_aux/exchange'
import {
  type AuxTransaction,
  describeFlags,
  type FrameParse,
  parseFrame,
  REPLY_NAMES,
  requestCommandName,
} from '@/lib/dp_aux/frame'
import type { EdidBlock, I2cAnalysis, I2cTransfer } from '@/lib/dp_aux/i2c'
import {
  formatAddress,
  formatHex,
  formatSpan,
  formatTimestamp,
} from '@/lib/format'
import type { DpAuxFrameEvent } from '@/lib/hid/device'
import { cn } from '@/lib/utils'

type TransactionListProps = {
  frames: DpAuxFrameEvent[]
  exchanges: Exchange[]
  analysis: I2cAnalysis
  autoScroll: boolean
  onAutoScrollChange: (value: boolean) => void
}

type View = 'exchange' | 'raw' | 'i2c'

const VIEW_LABEL: Record<View, string> = {
  exchange: '事务',
  raw: '原始帧',
  i2c: 'I2C 传输',
}

const OPERATION_CHIP: Record<string, string> = {
  read: 'bg-rep-wash text-rep',
  writ: 'bg-req-wash text-req',
  wsr: 'bg-unk-wash text-unk',
}

const KIND_LABEL: Record<Exchange['kind'], string> = {
  exchange: '事务',
  'request-only': '缺回复',
  'reply-only': '孤立回复',
  invalid: '无法解析',
}

function operationChip(exchange: Exchange): string {
  if (exchange.request) {
    return OPERATION_CHIP[exchange.request.operation] ?? 'bg-unk-wash text-unk'
  }
  if (exchange.reply) {
    return exchange.reply.command === 0
      ? 'bg-rep-wash text-rep'
      : 'bg-alert-wash text-alert'
  }
  return 'bg-unk-wash text-unk'
}

// 概览条上的竖线用实色，读绿写蓝
function operationTick(exchange: Exchange): string {
  if (exchange.request) {
    if (exchange.request.operation === 'read') return 'bg-rep'
    if (exchange.request.operation === 'writ') return 'bg-req'
    return 'bg-unk'
  }
  if (exchange.reply) {
    return exchange.reply.command === 0 ? 'bg-rep' : 'bg-alert'
  }
  return 'bg-unk'
}

type OverviewItem = {
  key: string
  timestampUs: number
  tick: string
}

// 概览条的时间刻度，空态也画，让它始终像一条时间轴
const OVERVIEW_GRID = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]

function OverviewStrip({
  items,
  selectedKey,
  onSelect,
}: {
  items: OverviewItem[]
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const start = items[0]?.timestampUs ?? 0
  const end = items[items.length - 1]?.timestampUs ?? start
  const span = Math.max(1, end - start)
  const selected = items.find((item) => item.key === selectedKey)

  // 竖线是 1px，落在 100% 时右边会超出容器 1px，进而抬高父级 scrollWidth
  // 绝对定位的子元素也算进父级 scrollWidth，所以这里统一钳到 100% - 1px
  const leftAt = (ratio: number) => `min(${ratio * 100}%, calc(100% - 1px))`

  // 把指针横坐标换算成时间，选中时间戳最近的一条
  const selectNearest = (clientX: number, element: HTMLElement) => {
    if (items.length === 0) return
    const rect = element.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const target = start + ratio * span
    let nearest: OverviewItem | null = null
    let best = Number.POSITIVE_INFINITY
    for (const item of items) {
      const distance = Math.abs(item.timestampUs - target)
      if (distance < best) {
        best = distance
        nearest = item
      }
    }
    if (nearest) onSelect(nearest.key)
  }

  return (
    <div
      className="bg-canvas relative h-10 cursor-pointer border-b border-line select-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        selectNearest(event.clientX, event.currentTarget)
      }}
      onPointerMove={(event) => {
        // 按住拖动时持续选中最近的项
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          selectNearest(event.clientX, event.currentTarget)
        }
      }}
    >
      {OVERVIEW_GRID.map((ratio) => (
        <span
          key={ratio}
          className="bg-line absolute top-2 bottom-2 w-px"
          style={{ left: leftAt(ratio) }}
        />
      ))}
      {items.map((item) => (
        <span
          key={item.key}
          className={cn('absolute top-2 bottom-2 w-px', item.tick)}
          style={{ left: leftAt((item.timestampUs - start) / span) }}
        />
      ))}
      {selected ? (
        <span
          className="bg-ink absolute top-0 bottom-0 w-0.5 -translate-x-1/2 rounded-full"
          style={{ left: leftAt((selected.timestampUs - start) / span) }}
        />
      ) : null}
      {items.length > 0 ? (
        <>
          <span className="text-ink-2 bg-canvas/50 absolute bottom-0.5 left-1.5 rounded px-1 font-mono text-[10px] tabular-nums backdrop-blur-sm select-none">
            0
          </span>
          <span className="text-ink-2 bg-canvas/50 absolute right-1.5 bottom-0.5 rounded px-1 font-mono text-[10px] tabular-nums backdrop-blur-sm select-none">
            {formatSpan(span)}
          </span>
        </>
      ) : null}
    </div>
  )
}

function FieldTable({ fields }: { fields: DpcdField[] }) {
  return (
    <table className="w-full border-collapse font-mono text-xs">
      <thead>
        <tr className="text-ink-3 text-left">
          <th className="w-24 py-1 font-normal">地址</th>
          <th className="w-14 py-1 font-normal">值</th>
          <th className="py-1 font-normal">含义</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr
            key={`${field.address}-${field.value}`}
            className="border-t border-line"
          >
            <td className="text-ink-2 py-1">
              0x{field.address.toString(16).toUpperCase().padStart(5, '0')}
            </td>
            <td className="text-ink py-1 font-medium">
              {field.value.toString(16).toUpperCase().padStart(2, '0')}
            </td>
            <td className="py-1">{field.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TransactionBlock({
  title,
  transaction,
}: {
  title: string
  transaction: AuxTransaction
}) {
  const heading =
    transaction.direction === 'request'
      ? requestCommandName(transaction.command)
      : (transaction.operation ?? 'reply')
  const detail =
    transaction.direction === 'request'
      ? transaction.addressOnly
        ? '仅地址'
        : `LEN=0x${(transaction.encodedLength ?? 0).toString(16).toUpperCase().padStart(2, '0')} N=${transaction.length}`
      : `${transaction.data.length} 字节`
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="text-ink-2 text-xs">{heading}</span>
        <span className="text-ink-3 font-mono text-xs">{detail}</span>
        {transaction.address !== null ? (
          <span className="text-ink-3 font-mono text-xs">
            {transaction.native
              ? formatAddress(transaction.address)
              : `i2c 0x${transaction.address.toString(16).toUpperCase().padStart(2, '0')}`}
          </span>
        ) : null}
      </div>
      <pre className="bg-canvas overflow-x-auto rounded border border-line p-2 font-mono text-xs">
        {transaction.data.length > 0
          ? formatHex(transaction.data)
          : '（无数据）'}
      </pre>
    </div>
  )
}

// 解码详情的统一容器，填满底部面板
function DetailShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto px-3 py-3">
      {children}
    </div>
  )
}

function EmptyDetail({ label }: { label: string }) {
  return (
    <div className="text-ink-3 flex h-full items-center justify-center text-xs">
      {label}
    </div>
  )
}

// I2C 传输的地址标签
function transferAddressLabel(address: number): string {
  if (address === 0x50) return 'EDID 0x50'
  if (address === 0x30) return '段 0x30'
  if (address === 0x37) return 'DDC/CI 0x37'
  return `0x${address.toString(16).toUpperCase().padStart(2, '0')}`
}

function DdcTable({ ddc }: { ddc: DdcResult }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium">DDC/CI</span>
        <span className="text-ink-2 text-xs">{ddc.name}</span>
      </div>
      <table className="w-full border-collapse font-mono text-xs">
        <tbody>
          {ddc.fields.map((field) => (
            <tr
              key={`${field.name}-${field.value}`}
              className="border-t border-line first:border-t-0"
            >
              <td className="text-ink-3 w-28 px-2 py-0.5 align-top whitespace-nowrap">
                {field.name}
              </td>
              <td className="px-2 py-0.5 align-top">{field.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExchangeDetail({ exchange }: { exchange: Exchange }) {
  return (
    <DetailShell>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-medium">
          {KIND_LABEL[exchange.kind]}
        </span>
        <span className="text-ink-3 font-mono text-xs">
          {formatTimestamp(exchange.timestampUs)}
        </span>
        {exchange.elapsedUs !== null ? (
          <span className="text-ink-3 font-mono text-xs">
            往返 {exchange.elapsedUs} us
          </span>
        ) : null}
        {exchange.registerName ? (
          <span className="text-ink-2 text-xs">{exchange.registerName}</span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-1">
          {exchange.errors.map((error) => (
            <Badge key={error} className="bg-alert text-white">
              {error}
            </Badge>
          ))}
          {exchange.warnings.map((warning) => (
            <Badge key={warning} variant="outline">
              {warning}
            </Badge>
          ))}
        </div>
      </div>

      {exchange.request ? (
        <TransactionBlock title="请求" transaction={exchange.request} />
      ) : null}
      {exchange.reply ? (
        <TransactionBlock title="回复" transaction={exchange.reply} />
      ) : null}

      {exchange.fields.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium">DPCD 字段</span>
          <FieldTable fields={exchange.fields} />
        </div>
      ) : null}

      {exchange.ddc ? <DdcTable ddc={exchange.ddc} /> : null}

      <div className="flex flex-wrap gap-1">
        {exchange.frames.map((frame) =>
          describeFlags(frame.frame.flags).map((label) => (
            <Badge
              key={`${frame.seq}-${label}`}
              variant="outline"
              className={cn(
                'font-mono text-[10px]',
                (label === 'INTERVAL' || label === 'TRUNCATED') &&
                  'border-alert text-alert',
              )}
            >
              {label}
            </Badge>
          )),
        )}
      </div>
    </DetailShell>
  )
}

function EdidSectionView({ section }: { section: EdidSection }) {
  return (
    <div className="flex min-w-0 flex-col rounded border border-line">
      <div className="flex items-center gap-2 border-b border-line px-2 py-1">
        <span className="text-[12px] font-medium">{section.title}</span>
        {section.range ? (
          <span className="text-ink-3 font-mono text-[10px]">
            {section.range}
          </span>
        ) : null}
        <span className="text-ink-3 ml-auto min-w-0 truncate font-mono text-[10px]">
          {section.raw}
        </span>
      </div>
      <table className="w-full border-collapse font-mono text-xs">
        <tbody>
          {section.fields.map((field) => (
            <tr
              key={`${field.name}-${field.value}`}
              className="border-t border-line first:border-t-0"
            >
              <td className="text-ink-3 w-28 px-2 py-0.5 align-top whitespace-nowrap">
                {field.bytes}
              </td>
              <td className="text-ink-2 w-28 px-2 py-0.5 align-top whitespace-nowrap">
                {field.name}
              </td>
              <td className="px-2 py-0.5 align-top">{field.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EdidBlockView({ block }: { block: EdidBlock }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium">
          EDID block {block.block}
        </span>
        <Badge
          variant="outline"
          className={block.header ? '' : 'border-alert text-alert'}
        >
          header {block.header ? 'ok' : 'BAD'}
        </Badge>
        <Badge
          variant="outline"
          className={block.checksum ? '' : 'border-alert text-alert'}
        >
          checksum {block.checksum ? 'ok' : 'BAD'}
        </Badge>
      </div>
      {block.sections.map((section) => (
        <EdidSectionView
          key={`${section.title}-${section.range}`}
          section={section}
        />
      ))}
      {block.errors.map((error) => (
        <p key={error} className="text-alert font-mono text-xs">
          {error}
        </p>
      ))}
    </div>
  )
}

function TransferDetail({ transfer }: { transfer: I2cTransfer }) {
  return (
    <DetailShell>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-medium">I2C 传输</span>
        <span className="text-ink-2 font-mono text-xs">
          {transferAddressLabel(transfer.address)}
        </span>
        <span className="text-ink-3 font-mono text-xs">
          事件 {transfer.startSeq}-{transfer.endSeq}
        </span>
        <span className="text-ink-3 font-mono text-xs">
          {transfer.exchangeKeys.length} 次事务
        </span>
        <span className="text-ink-3 font-mono text-xs">
          {transfer.bytes.length} 字节
        </span>
        {transfer.offset !== null ? (
          <span className="text-ink-3 font-mono text-xs">
            指针 0x{transfer.offset.toString(16).toUpperCase().padStart(2, '0')}
          </span>
        ) : null}
        {transfer.errors.map((error) => (
          <Badge key={error} className="bg-alert text-white">
            {error}
          </Badge>
        ))}
      </div>

      {transfer.blocks.length > 0 ? (
        transfer.blocks.map((block) => (
          <EdidBlockView key={block.block} block={block} />
        ))
      ) : transfer.ddc.length === 0 ? (
        <p className="text-ink-3 text-xs">
          尚未重组出完整的 EDID 块，可能还在读取或缺少指针写
        </p>
      ) : null}

      {transfer.ddc.map((ddc, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 传输内的 DDC 消息数组固定，不会重排
        <DdcTable key={`${ddc.opcode}-${index}`} ddc={ddc} />
      ))}

      {transfer.bytes.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium">重组字节</span>
          <pre className="bg-canvas overflow-x-auto rounded border border-line p-2 font-mono text-xs break-all whitespace-pre-wrap">
            {formatHex(transfer.bytes)}
          </pre>
        </div>
      ) : null}
    </DetailShell>
  )
}

type RawRow = {
  key: string
  event: DpAuxFrameEvent
  parsed: FrameParse
  flagLabels: string[]
  directionLabel: string
  directionChip: string
  tick: string
  typeLabel: string
  address: number | null
  registerName: string
  fields: DpcdField[]
  transaction: AuxTransaction | null
}

// 原始帧也接上解码
// 回复本身没有地址，靠配对上下文拿到请求的地址才能解释寄存器
function buildRawRows(
  frames: DpAuxFrameEvent[],
  exchanges: Exchange[],
): RawRow[] {
  const context = new Map<string, Exchange>()
  for (const exchange of exchanges) {
    for (const frame of exchange.frames) {
      context.set(`${frame.seq}-${frame.timestampUs}`, exchange)
    }
  }

  // frames 是最新在前，原始帧视图改成旧到新
  return [...frames].reverse().map((event) => {
    const key = `${event.seq}-${event.timestampUs}`
    const parsed = parseFrame(event.frame.data)
    const exchange = context.get(key) ?? null
    const flagLabels = describeFlags(event.frame.flags)

    let transaction: AuxTransaction | null = null
    let directionLabel = '未知'
    let directionChip = 'bg-alert-wash text-alert'
    let tick = 'bg-alert'
    let typeLabel = '无法解析'
    let address: number | null = null

    if (parsed.kind === 'request') {
      transaction = parsed.transaction
      directionLabel = '请求'
      directionChip = 'bg-req-wash text-req'
      tick = 'bg-req'
      typeLabel = requestCommandName(transaction.command)
      address = transaction.address
    } else if (parsed.kind === 'reply') {
      transaction = parsed.transaction
      directionLabel = '回复'
      directionChip =
        transaction.command === 0
          ? 'bg-rep-wash text-rep'
          : 'bg-alert-wash text-alert'
      tick = transaction.command === 0 ? 'bg-rep' : 'bg-alert'
      typeLabel = REPLY_NAMES[transaction.command] ?? 'REPLY'
      address = exchange?.request?.address ?? null
    } else if (parsed.kind === 'ambiguous') {
      transaction = parsed.request
      directionLabel = '不定'
      directionChip = 'bg-unk-wash text-unk'
      tick = 'bg-unk'
      typeLabel = requestCommandName(parsed.request.command)
      address = parsed.request.address
    }

    const registerName = address === null ? '' : dpcdName(address)

    // 原生写用请求数据，原生读的 ACK 回复用回复数据
    let fields: DpcdField[] = []
    if (
      transaction?.direction === 'request' &&
      transaction.native &&
      transaction.operation === 'writ' &&
      transaction.data.length > 0
    ) {
      fields = describeDpcd(address ?? 0, transaction.data)
    } else if (
      transaction?.direction === 'reply' &&
      transaction.command === 0 &&
      exchange?.request?.native &&
      exchange.request.operation === 'read'
    ) {
      fields = describeDpcd(exchange.request.address ?? 0, transaction.data)
    }

    return {
      key,
      event,
      parsed,
      flagLabels,
      directionLabel,
      directionChip,
      tick,
      typeLabel,
      address,
      registerName,
      fields,
      transaction,
    }
  })
}

export function TransactionList({
  frames,
  exchanges,
  analysis,
  autoScroll,
  onAutoScrollChange,
}: TransactionListProps) {
  const [view, setView] = useState<View>('exchange')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // 选中某项后暂停跟随，避免新数据到达时把定位冲掉
  const selectItem = (key: string | null) => {
    setSelectedKey(key)
    onAutoScrollChange(false)
  }
  // 底部解码区用像素固定高度，布局写入 localStorage
  const detailLayout = useDefaultLayout({
    id: 'dp-aux-detail',
    panelIds: ['list', 'detail'],
  })
  const rawRows = useMemo<RawRow[]>(
    () => buildRawRows(frames, exchanges),
    [frames, exchanges],
  )

  const needle = query.trim().toLowerCase()
  const filteredExchanges = useMemo(() => {
    if (needle.length === 0) return exchanges
    return exchanges.filter((item) => {
      const haystack = [
        item.registerName,
        item.operationLabel,
        item.commandLabel,
        item.fields.map((field) => field.text).join(' '),
        formatHex(item.data, ''),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [exchanges, needle])

  const filteredRaw = useMemo(() => {
    if (needle.length === 0) return rawRows
    return rawRows.filter((item) => {
      const haystack = [
        item.typeLabel,
        item.registerName,
        item.fields.map((field) => field.text).join(' '),
        formatHex(item.event.frame.data, ''),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [rawRows, needle])

  const selectedExchange =
    filteredExchanges.find((item) => item.key === selectedKey) ?? null
  const selectedRaw =
    filteredRaw.find((item) => item.key === selectedKey) ?? null
  const selectedTransfer =
    analysis.transfers.find((item) => item.key === selectedKey) ?? null

  // 概览条跟随当前视图：事务、原始帧或 I2C 传输
  const overviewItems = useMemo<OverviewItem[]>(() => {
    if (view === 'raw') {
      return rawRows.map((item) => ({
        key: item.key,
        timestampUs: item.event.timestampUs,
        tick: item.tick,
      }))
    }
    if (view === 'i2c') {
      return analysis.transfers.map((transfer) => ({
        key: transfer.key,
        timestampUs: transfer.timestampUs,
        tick: transfer.address === 0x50 ? 'bg-req' : 'bg-unk',
      }))
    }
    return exchanges.map((item) => ({
      key: item.key,
      timestampUs: item.timestampUs,
      tick: operationTick(item),
    }))
  }, [view, rawRows, analysis, exchanges])

  return (
    <section className="font-mono flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="bg-chrome font-sans flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
        <div className="flex items-center gap-1 rounded-md bg-control p-0.5">
          {(['exchange', 'raw', 'i2c'] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              onClick={() => {
                setView(mode)
                setSelectedKey(null)
              }}
              className={cn(
                'rounded px-2 py-0.5 text-xs',
                view === mode
                  ? 'bg-canvas text-ink font-medium'
                  : 'text-ink-3 hover:text-ink',
              )}
            >
              {VIEW_LABEL[mode]}
            </button>
          ))}
        </div>
        <span className="text-ink-3 font-mono text-xs tabular-nums">
          {view === 'exchange' ? filteredExchanges.length : filteredRaw.length}
          {needle.length > 0
            ? ` / ${view === 'exchange' ? exchanges.length : rawRows.length}`
            : ''}
        </span>
        <div className="relative ml-auto w-64">
          <Search className="text-ink-3 pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索寄存器、命令或数据"
            className="h-7 bg-control pl-7 text-xs"
          />
          {query.length > 0 ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-ink-3 hover:text-ink absolute top-1/2 right-1.5 -translate-y-1/2"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <OverviewStrip
        items={overviewItems}
        selectedKey={selectedKey}
        onSelect={selectItem}
      />

      <Group
        id="dp-aux-detail"
        orientation="vertical"
        defaultLayout={detailLayout.defaultLayout}
        onLayoutChanged={detailLayout.onLayoutChanged}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <Panel
          id="list"
          minSize={120}
          className="flex min-h-0 min-w-0 flex-col"
        >
          {view === 'exchange' ? (
            <div className="text-ink-3 bg-chrome grid h-7 shrink-0 grid-cols-[56px_96px_76px_60px_minmax(0,1fr)_minmax(0,1.6fr)] items-center gap-2 border-b border-line px-3 text-[11px]">
              <span>seq</span>
              <span>时间</span>
              <span>操作</span>
              <span>命令</span>
              <span>地址 / 寄存器</span>
              <span>原始 hex</span>
            </div>
          ) : view === 'raw' ? (
            <div className="text-ink-3 bg-chrome grid h-7 shrink-0 grid-cols-[56px_96px_48px_96px_minmax(0,1fr)_minmax(0,1.6fr)] items-center gap-2 border-b border-line px-3 text-[11px]">
              <span>seq</span>
              <span>时间</span>
              <span>方向</span>
              <span>类型</span>
              <span>地址 / 寄存器</span>
              <span>原始 hex</span>
            </div>
          ) : (
            <div className="text-ink-3 bg-chrome grid h-7 shrink-0 grid-cols-[96px_84px_minmax(0,1fr)_64px_48px] items-center gap-2 border-b border-line px-3 text-[11px]">
              <span>时间</span>
              <span>地址</span>
              <span>事件范围</span>
              <span className="text-right">字节</span>
              <span className="text-right">块</span>
            </div>
          )}

          {view === 'exchange' ? (
            filteredExchanges.length === 0 ? (
              <div className="text-ink-3 flex h-32 items-center justify-center text-xs">
                {exchanges.length === 0
                  ? '暂无数据，连接设备并在 SBU 接入 DP 源'
                  : '没有匹配的事务'}
              </div>
            ) : (
              <VirtualList
                className="min-h-0 flex-1 overflow-auto"
                items={filteredExchanges}
                rowHeight={32}
                autoScroll={autoScroll}
                onAutoScrollChange={onAutoScrollChange}
                selectedKey={selectedKey}
                getKey={(item) => item.key}
                renderRow={(item) => (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() =>
                      selectItem(item.key === selectedKey ? null : item.key)
                    }
                    className={cn(
                      'grid h-8 w-full grid-cols-[56px_96px_76px_60px_minmax(0,1fr)_minmax(0,1.6fr)] items-center gap-2 border-b border-line px-3 text-left',
                      item.key === selectedKey ? 'bg-sel' : 'hover:bg-hover',
                    )}
                  >
                    <span className="text-ink-3 font-mono text-xs tabular-nums">
                      {item.frames[0]?.seq ?? 0}
                    </span>
                    <span className="text-ink-2 font-mono text-xs tabular-nums">
                      {formatTimestamp(item.timestampUs)}
                    </span>
                    <span
                      className={cn(
                        'inline-flex h-5 w-fit items-center rounded px-1.5 text-[11px] font-medium',
                        operationChip(item),
                      )}
                    >
                      {item.operationLabel}
                    </span>
                    <span className="text-ink-2 text-xs">
                      {item.commandLabel}
                    </span>
                    <span className="min-w-0 truncate text-xs">
                      {item.address !== null ? (
                        <span className="font-mono">
                          {formatAddress(item.address)}
                        </span>
                      ) : (
                        '-'
                      )}
                      {item.registerName ? (
                        <span className="text-ink-3 ml-1.5">
                          {item.registerName}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-ink-2 min-w-0 truncate font-mono text-xs">
                      {item.frames
                        .map((frame) => formatHex(frame.frame.data))
                        .join('  ')}
                    </span>
                  </button>
                )}
              />
            )
          ) : view === 'raw' ? (
            filteredRaw.length === 0 ? (
              <div className="text-ink-3 flex h-32 items-center justify-center text-xs">
                {rawRows.length === 0
                  ? '暂无数据，连接设备并在 SBU 接入 DP 源'
                  : '没有匹配的帧'}
              </div>
            ) : (
              <VirtualList
                className="min-h-0 flex-1 overflow-auto"
                items={filteredRaw}
                rowHeight={32}
                autoScroll={autoScroll}
                onAutoScrollChange={onAutoScrollChange}
                selectedKey={selectedKey}
                getKey={(item) => item.key}
                renderRow={(item) => (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() =>
                      selectItem(item.key === selectedKey ? null : item.key)
                    }
                    className={cn(
                      'grid h-8 w-full grid-cols-[56px_96px_48px_96px_minmax(0,1fr)_minmax(0,1.6fr)] items-center gap-2 border-b border-line px-3 text-left',
                      item.key === selectedKey ? 'bg-sel' : 'hover:bg-hover',
                    )}
                  >
                    <span className="text-ink-3 font-mono text-xs tabular-nums">
                      {item.event.seq}
                    </span>
                    <span className="text-ink-2 font-mono text-xs tabular-nums">
                      {formatTimestamp(item.event.timestampUs)}
                    </span>
                    <span
                      className={cn(
                        'inline-flex h-5 w-fit items-center rounded px-1.5 text-[11px] font-medium',
                        item.directionChip,
                      )}
                    >
                      {item.directionLabel}
                    </span>
                    <span className="text-ink-2 min-w-0 truncate text-xs">
                      {item.typeLabel}
                    </span>
                    <span className="min-w-0 truncate text-xs">
                      {item.address !== null ? (
                        <span className="font-mono">
                          {formatAddress(item.address)}
                        </span>
                      ) : (
                        '-'
                      )}
                      {item.registerName ? (
                        <span className="text-ink-3 ml-1.5">
                          {item.registerName}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-ink-2 min-w-0 truncate font-mono text-xs">
                      {formatHex(item.event.frame.data)}
                    </span>
                  </button>
                )}
              />
            )
          ) : analysis.transfers.length === 0 ? (
            <div className="text-ink-3 flex h-32 items-center justify-center text-xs">
              暂无 I2C 传输
            </div>
          ) : (
            <VirtualList
              className="min-h-0 flex-1 overflow-auto"
              items={analysis.transfers}
              rowHeight={32}
              autoScroll={autoScroll}
              onAutoScrollChange={onAutoScrollChange}
              selectedKey={selectedKey}
              getKey={(transfer) => transfer.key}
              renderRow={(transfer) => (
                <button
                  type="button"
                  key={transfer.key}
                  onClick={() =>
                    selectItem(
                      transfer.key === selectedKey ? null : transfer.key,
                    )
                  }
                  className={cn(
                    'grid h-8 w-full grid-cols-[96px_84px_minmax(0,1fr)_64px_48px] items-center gap-2 border-b border-line px-3 text-left',
                    transfer.key === selectedKey ? 'bg-sel' : 'hover:bg-hover',
                  )}
                >
                  <span className="text-ink-2 font-mono text-xs tabular-nums">
                    {formatTimestamp(transfer.timestampUs)}
                  </span>
                  <span className="text-ink-2 whitespace-nowrap text-xs">
                    {transferAddressLabel(transfer.address)}
                  </span>
                  <span className="text-ink-2 min-w-0 truncate font-mono text-xs whitespace-nowrap tabular-nums">
                    {transfer.startSeq}-{transfer.endSeq}
                    <span className="text-ink-3 ml-2">
                      {transfer.exchangeKeys.length} 次事务
                    </span>
                  </span>
                  <span className="text-ink-2 text-right font-mono text-xs tabular-nums">
                    {transfer.bytes.length}
                  </span>
                  <span className="text-ink-2 text-right font-mono text-xs tabular-nums">
                    {transfer.blocks.length}
                  </span>
                </button>
              )}
            />
          )}
        </Panel>

        <Separator className="bg-line h-px shrink-0 cursor-row-resize" />

        <Panel
          id="detail"
          defaultSize={260}
          minSize={80}
          groupResizeBehavior="preserve-pixel-size"
          className="bg-chrome flex min-w-0 flex-col overflow-hidden"
        >
          {view === 'exchange' ? (
            selectedExchange ? (
              <ExchangeDetail exchange={selectedExchange} />
            ) : (
              <EmptyDetail label="选择一条事务查看解码" />
            )
          ) : view === 'raw' ? (
            selectedRaw ? (
              <DetailShell>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[13px] font-medium">原始帧</span>
                  <span className="text-ink-3 font-mono text-xs">
                    seq {selectedRaw.event.seq}
                  </span>
                  <span className="text-ink-3 font-mono text-xs">
                    {formatTimestamp(selectedRaw.event.timestampUs)}
                  </span>
                  <span className="text-ink-3 font-mono text-xs">
                    bytes {selectedRaw.event.frame.byteCount} · bits{' '}
                    {selectedRaw.event.frame.bitCount} · raw{' '}
                    {selectedRaw.event.frame.rawBits}
                  </span>
                  {selectedRaw.registerName ? (
                    <span className="text-ink-2 text-xs">
                      {selectedRaw.registerName}
                    </span>
                  ) : null}
                  <div className="ml-auto flex flex-wrap gap-1">
                    {selectedRaw.flagLabels.map((label) => (
                      <Badge
                        key={label}
                        variant="outline"
                        className={cn(
                          'font-mono text-[10px]',
                          (label === 'INTERVAL' || label === 'TRUNCATED') &&
                            'border-alert text-alert',
                        )}
                      >
                        {label}
                      </Badge>
                    ))}
                  </div>
                </div>

                {selectedRaw.transaction ? (
                  <TransactionBlock
                    title={
                      selectedRaw.transaction.direction === 'request'
                        ? '请求'
                        : '回复'
                    }
                    transaction={selectedRaw.transaction}
                  />
                ) : (
                  <pre className="bg-canvas rounded border border-line p-2 font-mono text-xs break-all whitespace-pre-wrap">
                    {formatHex(selectedRaw.event.frame.data)}
                  </pre>
                )}

                {selectedRaw.fields.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-[13px] font-medium">DPCD 字段</span>
                    <FieldTable fields={selectedRaw.fields} />
                  </div>
                ) : null}
              </DetailShell>
            ) : (
              <EmptyDetail label="选择一个原始帧查看解码" />
            )
          ) : selectedTransfer ? (
            <TransferDetail transfer={selectedTransfer} />
          ) : (
            <EmptyDetail label="选择一次 I2C 传输查看 EDID" />
          )}
        </Panel>
      </Group>
    </section>
  )
}
