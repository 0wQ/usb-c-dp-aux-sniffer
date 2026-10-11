import { useEffect, useState } from 'react'

// 明暗主题，默认跟随系统，用户选择后写入 localStorage
type Theme = 'light' | 'dark'

const STORAGE_KEY = 'dp-aux-theme'

function readInitialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  return {
    theme,
    toggle: () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')),
  }
}
