import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn 约定的类名合并入口，先做条件拼接再消解 Tailwind 冲突
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
