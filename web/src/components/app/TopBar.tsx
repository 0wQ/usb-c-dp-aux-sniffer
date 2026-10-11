import {
  ArrowDownToLine,
  CircleAlert,
  CircleCheck,
  CirclePause,
  Download,
  Eraser,
  FileUp,
  FlaskConical,
  Moon,
  Pause,
  Play,
  PlugZap,
  RefreshCw,
  Sun,
  Trash2,
  TrendingDown,
  TrendingUp,
  Unplug,
  Upload,
  Usb,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DeviceState } from '@/lib/hid/device'

type TopBarProps = {
  state: DeviceState
  enabled: boolean
  theme: 'light' | 'dark'
  autoScroll: boolean
  edgeMode: 'rising' | 'falling'
  demoUrl: string
  onConnect: () => void
  onDisconnect: () => void
  onToggleEnabled: () => void
  onSetEdgeMode: (mode: 'rising' | 'falling') => void
  onToggleAutoScroll: () => void
  onRequestStatus: () => void
  onClearStats: () => void
  onClearFrames: () => void
  onLoadUrl: (url: string) => void
  onImportFile: (file: File) => void
  onExport: () => void
  exportDisabled: boolean
  onToggleTheme: () => void
}

// 远程导入面板，链接框预置 DEMO 链接
function ImportMenu({
  demoUrl,
  onLoadUrl,
  onImportFile,
}: {
  demoUrl: string
  onLoadUrl: (url: string) => void
  onImportFile: (file: File) => void
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(demoUrl)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 点面板外关掉
  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const submit = () => {
    onLoadUrl(url)
    setOpen(false)
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen((value) => !value)}
      >
        <Upload />
        导入
      </Button>
      {open ? (
        <div className="bg-raise absolute top-full right-0 z-50 mt-1 flex w-96 flex-col gap-2 rounded-md border border-line p-3 shadow-lg">
          <span className="text-[12px] font-medium">远程导入</span>
          <div className="flex gap-1">
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
              placeholder="抓包文件链接"
              className="h-7 text-xs"
            />
            <Button size="sm" variant="outline" onClick={submit}>
              载入
            </Button>
          </div>
          <span className="text-ink-3 text-[11px]">
            默认已填 DEMO 链接，也可以粘贴任意抓包 JSON 的地址
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => fileRef.current?.click()}
            >
              <FileUp />
              本地文件
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onImportFile(file)
                event.target.value = ''
                setOpen(false)
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

// 顶部工具栏，放设备、采集开关和全局操作，界面只有这一条命令带
export function TopBar({
  state,
  enabled,
  theme,
  autoScroll,
  edgeMode,
  demoUrl,
  onConnect,
  onDisconnect,
  onToggleEnabled,
  onSetEdgeMode,
  onToggleAutoScroll,
  onRequestStatus,
  onClearStats,
  onClearFrames,
  onLoadUrl,
  onImportFile,
  onExport,
  exportDisabled,
  onToggleTheme,
}: TopBarProps) {
  const connected = state.isConnected

  return (
    <header className="bg-chrome flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-1">
      <div className="flex items-center gap-2 pr-1">
        <Usb className="text-ink-2 size-4" />
        <span className="text-[13px] font-semibold tracking-tight">
          USB-C DP AUX Sniffer
        </span>
      </div>

      <div className="bg-line mx-1 h-5 w-px" />

      <div className="flex items-center gap-1.5">
        {connected ? (
          <CircleCheck className="text-rep size-3.5" />
        ) : (
          <CircleAlert className="text-ink-3 size-3.5" />
        )}
        <span className="text-ink-2 w-44 truncate text-xs">
          {connected
            ? (state.productName ?? 'DP AUX HID Demo')
            : state.isSupported
              ? '未连接'
              : '浏览器不支持 WebHID'}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={!state.isSupported || state.isConnecting}
          onClick={connected ? onDisconnect : onConnect}
        >
          {connected ? <Unplug /> : <PlugZap />}
          {connected ? '断开' : '连接'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!connected}
          onClick={onToggleEnabled}
        >
          {enabled ? <Pause /> : <Play />}
          {enabled ? '采集中' : '已暂停'}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          disabled={!connected}
          onClick={() =>
            onSetEdgeMode(edgeMode === 'rising' ? 'falling' : 'rising')
          }
          title={edgeMode === 'rising' ? '当前捕获上升沿' : '当前捕获下降沿'}
        >
          {edgeMode === 'rising' ? <TrendingUp /> : <TrendingDown />}
          {edgeMode === 'rising' ? '上升沿' : '下降沿'}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          disabled={!connected}
          onClick={onRequestStatus}
          title="刷新状态"
        >
          <RefreshCw />
          刷新状态
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!connected}
          onClick={onClearStats}
          title="清零设备统计"
        >
          <Eraser />
          清零统计
        </Button>
        <Button size="sm" variant="ghost" onClick={onClearFrames}>
          <Trash2 />
          清空列表
        </Button>

        <Button size="sm" variant="ghost" onClick={onToggleAutoScroll}>
          {autoScroll ? <ArrowDownToLine /> : <CirclePause />}
          {autoScroll ? '跟随中' : '不跟随'}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => onLoadUrl(demoUrl)}
          title="载入预置 DEMO"
        >
          <FlaskConical />
          DEMO
        </Button>
        <ImportMenu
          demoUrl={demoUrl}
          onLoadUrl={onLoadUrl}
          onImportFile={onImportFile}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={exportDisabled}
          onClick={onExport}
        >
          <Download />
          导出
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onToggleTheme}
          title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
      </div>
    </header>
  )
}
