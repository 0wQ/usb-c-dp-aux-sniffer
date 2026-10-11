import { createRoot } from 'react-dom/client'

import App from './App'
import './index.css'

const rootElement = document.getElementById('root')

if (rootElement === null) {
  throw new Error('未找到 #root 挂载节点')
}

createRoot(rootElement).render(<App />)
