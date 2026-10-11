import type { ReactNode, UIEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

// 判定「已在底部」的阈值，单位像素
const BOTTOM_THRESHOLD = 50

type VirtualListProps<T> = {
  items: T[]
  rowHeight: number
  renderRow: (item: T) => ReactNode
  className?: string
  autoScroll: boolean
  onAutoScrollChange: (value: boolean) => void
  // 选中项的 key 和取 key 的方法，用于把选中行滚进视口
  selectedKey?: string | null
  getKey?: (item: T) => string
}

// 定高行虚拟滚动，带滚动跟随
//
// 帧上限放宽到 1 万后，全量渲染每次刷新要重建上万个 DOM 节点，会卡住主线程
// 这里只渲染视口内的行，上下各留一段 overscan 减少快速滚动时的空白
//
// 跟随策略参考 PD sniffer：新数据到达滚到底，用户往上滚就暂停，滚回底部再恢复
export function VirtualList<T>({
  items,
  rowHeight,
  renderRow,
  className,
  autoScroll,
  onAutoScrollChange,
  selectedKey,
  getKey,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  // 程序化滚动期间忽略滚动事件，避免把暂停状态又改回去
  const programmatic = useRef(false)
  const lastTop = useRef(0)
  // 上一次已经滚过的选中项，避免帧更新时重复滚动
  const lastScrolledKey = useRef<string | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () => setViewportHeight(element.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // 开启跟随时，新帧或开关变化都滚到底
  useEffect(() => {
    if (!autoScroll) return
    const element = containerRef.current
    if (!element) return
    programmatic.current = true
    // 内容高度就是行数乘行高，滚到这里即到底部
    element.scrollTop = items.length * rowHeight
    const timer = window.setTimeout(() => {
      programmatic.current = false
    }, 100)
    return () => window.clearTimeout(timer)
  }, [items.length, rowHeight, autoScroll])

  // 选中项变化时把它滚进视口，只做最小滚动
  useEffect(() => {
    if (!selectedKey || !getKey || selectedKey === lastScrolledKey.current) {
      return
    }
    lastScrolledKey.current = selectedKey
    const element = containerRef.current
    if (!element) return
    const index = items.findIndex((item) => getKey(item) === selectedKey)
    if (index < 0) return
    const top = index * rowHeight
    const bottom = top + rowHeight
    if (top < element.scrollTop) {
      programmatic.current = true
      element.scrollTop = top
    } else if (bottom > element.scrollTop + element.clientHeight) {
      programmatic.current = true
      element.scrollTop = bottom - element.clientHeight
    } else {
      return
    }
    const timer = window.setTimeout(() => {
      programmatic.current = false
    }, 100)
    return () => window.clearTimeout(timer)
  }, [selectedKey, items, rowHeight, getKey])

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const top = target.scrollTop
    setScrollTop(top)
    if (!programmatic.current) {
      const atBottom =
        target.scrollHeight - (top + target.clientHeight) <= BOTTOM_THRESHOLD
      if (atBottom) {
        if (!autoScroll) onAutoScrollChange(true)
      } else if (top < lastTop.current && autoScroll) {
        // 用户往上滚就暂停跟随
        onAutoScrollChange(false)
      }
    }
    lastTop.current = top
  }

  const overscan = 8
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  )

  return (
    <div ref={containerRef} onScroll={handleScroll} className={className}>
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: start * rowHeight,
            left: 0,
            right: 0,
          }}
        >
          {items.slice(start, end).map((item) => renderRow(item))}
        </div>
      </div>
    </div>
  )
}
