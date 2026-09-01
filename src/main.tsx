import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 临时调试，P4 完成后删除
// 仅本地环境挂载：import.meta.env.DEV 覆盖 `npm run dev`，
// hostname 判断覆盖 `wrangler pages dev`（服务已构建产物，DEV 为 false）。
// 线上 *.pages.dev 两者都不成立，钩子不会打进任何人可见的生产页面。
import { runAgent } from './agent/loop'
import { useStore } from './lib/store'
if (import.meta.env.DEV || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  ;(window as any).__agent = (q: string) => runAgent({
    question: q,
    user: useStore.getState().currentUser,
    getDb: () => useStore.getState().db,
    mutate: useStore.getState().applyMutation,
    emit: (e) => console.log('[EVENT]', e.type, e),
    pushAudit: useStore.getState().pushAudit,
    requestConfirm: async (_i, _n, _a, s) => confirm(s),
  })
}
