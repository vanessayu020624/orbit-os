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
import { runAgent } from './agent/loop'
import { useStore } from './lib/store'
;(window as any).__agent = (q: string) => runAgent({
  question: q,
  user: useStore.getState().currentUser,
  getDb: () => useStore.getState().db,
  mutate: useStore.getState().applyMutation,
  emit: (e) => console.log('[EVENT]', e.type, e),
  pushAudit: useStore.getState().pushAudit,
  requestConfirm: async (_i, _n, _a, s) => confirm(s),
})
