import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vite 配置
// build.target 设为 chrome89 是因为 WebHID 只在 Chromium 系浏览器可用
export default defineConfig({
  build: {
    target: 'chrome89',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [react(), tailwindcss()],
})
