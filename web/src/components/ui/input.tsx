import type * as React from 'react'

import { cn } from '@/lib/utils'

// 扁平输入框，填充而非描边，聚焦时只加深填充
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'bg-control text-ink placeholder:text-ink-3 focus-visible:bg-control-hover flex h-8 w-full min-w-0 rounded-md border border-transparent px-2.5 py-1 text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
