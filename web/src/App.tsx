import { useMemo, useState } from 'react'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { toast } from 'sonner'
import { StatsPanel } from '@/components/app/StatsPanel'
import { StatusBar } from '@/components/app/StatusBar'
import { TopBar } from '@/components/app/TopBar'
import { TransactionList } from '@/components/app/TransactionList'
import { Toaster } from '@/components/ui/sonner'
import { useDpAuxDevice } from '@/hooks/useDpAuxDevice'
import { useTheme } from '@/hooks/useTheme'
import { buildCaptureFile, downloadJson, parseCaptureFile } from '@/lib/capture'
import { buildExchanges } from '@/lib/dp_aux/exchange'
import { analyzeI2c } from '@/lib/dp_aux/i2c'

function describeError(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

function App() {
  const {
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
  } = useDpAuxDevice()
  const { theme, toggle: toggleTheme } = useTheme()
  // 事务和 I2C 聚合提到这里算，顶栏的导出和列表都要用
  const exchanges = useMemo(() => buildExchanges(frames), [frames])
  const analysis = useMemo(() => analyzeI2c(exchanges), [exchanges])
  const [autoScroll, setAutoScroll] = useState(true)
  // 侧栏用像素固定宽度，窗口缩放时保持，布局写入 localStorage
  const sidebarLayout = useDefaultLayout({
    id: 'dp-aux-sidebar',
    panelIds: ['sidebar', 'main'],
  })

  const handleConnect = async () => {
    try {
      await connect()
      toast.success('设备已连接')
    } catch (caught) {
      // 用户取消设备选择框时浏览器抛 NotFoundError，不需要提示
      if (caught instanceof Error && caught.name === 'NotFoundError') return
      toast.error(describeError(caught, '连接设备失败'))
    }
  }

  const handleDisconnect = async () => {
    try {
      await disconnect()
      toast.info('已断开设备')
    } catch (caught) {
      toast.error(describeError(caught, '断开设备失败'))
    }
  }

  const handleToggleEnabled = async () => {
    const next = !enabled
    try {
      await setCaptureEnabled(next)
      toast.info(next ? '已开启采集' : '已关闭采集')
    } catch (caught) {
      toast.error(describeError(caught, '切换采集开关失败'))
    }
  }

  const handleSetEdgeMode = async (mode: 'rising' | 'falling') => {
    try {
      await setEdgeMode(mode)
      toast.info(mode === 'falling' ? '已切到下降沿' : '已切到上升沿')
    } catch (caught) {
      toast.error(describeError(caught, '切换边沿模式失败'))
    }
  }

  const handleRequestStatus = async () => {
    try {
      await requestStatus()
    } catch (caught) {
      toast.error(describeError(caught, '请求状态失败'))
    }
  }

  const handleClearStats = async () => {
    try {
      await clearStats()
      toast.info('已清零设备统计')
    } catch (caught) {
      toast.error(describeError(caught, '清零统计失败'))
    }
  }

  const handleExport = () => {
    const file = buildCaptureFile(frames, state, status?.status ?? null)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    downloadJson(`dp-aux-${stamp}.json`, file)
  }

  // 远程导入：拉取链接里的抓包文件
  const handleLoadUrl = async (url: string) => {
    const target = url.trim()
    if (target.length === 0) {
      toast.error('请输入抓包文件链接')
      return
    }
    try {
      const response = await fetch(target)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const next = parseCaptureFile(await response.text())
      loadFrames(next)
      toast.info(`已载入 ${next.length} 帧`)
    } catch (caught) {
      toast.error(describeError(caught, '远程导入失败'))
    }
  }

  const handleImportFile = async (file: File) => {
    try {
      const next = parseCaptureFile(await file.text())
      loadFrames(next)
      toast.info(`已导入 ${next.length} 帧`)
    } catch (caught) {
      toast.error(describeError(caught, '导入失败'))
    }
  }

  return (
    <div className="bg-canvas text-ink flex h-dvh flex-col overflow-hidden">
      <Toaster position="bottom-right" richColors closeButton />
      <TopBar
        state={state}
        enabled={enabled}
        theme={theme}
        autoScroll={autoScroll}
        edgeMode={edgeMode}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onToggleEnabled={handleToggleEnabled}
        onSetEdgeMode={handleSetEdgeMode}
        onToggleAutoScroll={() => setAutoScroll((value) => !value)}
        onRequestStatus={handleRequestStatus}
        onClearStats={handleClearStats}
        onClearFrames={clearFrames}
        demoUrl={`${import.meta.env.BASE_URL}demo.json`}
        onLoadUrl={handleLoadUrl}
        onImportFile={handleImportFile}
        onExport={handleExport}
        exportDisabled={frames.length === 0}
        onToggleTheme={toggleTheme}
      />

      <Group
        id="dp-aux-sidebar"
        orientation="horizontal"
        defaultLayout={sidebarLayout.defaultLayout}
        onLayoutChanged={sidebarLayout.onLayoutChanged}
        className="flex min-h-0 min-w-0 flex-1"
      >
        <Panel
          id="sidebar"
          defaultSize={288}
          minSize={200}
          maxSize={560}
          groupResizeBehavior="preserve-pixel-size"
          className="bg-chrome flex min-w-0 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="text-ink-3 px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
              捕获统计
            </div>
            <StatsPanel status={status} statusCount={statusCount} />
          </div>
        </Panel>

        <Separator className="bg-line w-px shrink-0 cursor-col-resize" />

        <Panel id="main" minSize={400} className="flex min-w-0 flex-col">
          <TransactionList
            frames={frames}
            exchanges={exchanges}
            analysis={analysis}
            autoScroll={autoScroll}
            onAutoScrollChange={setAutoScroll}
          />
        </Panel>
      </Group>

      <StatusBar
        state={state}
        status={status}
        frameCount={frames.length}
        enabled={enabled}
      />
    </div>
  )
}

export default App
