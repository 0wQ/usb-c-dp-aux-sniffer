import type * as React from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

// sonner 的 shadcn 包装，把提示色接到主题变量
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
