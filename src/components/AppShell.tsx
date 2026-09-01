import { NavLink, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'
import { RoleSwitcher } from './RoleSwitcher'
import { useSidekick } from '../sidekick/SidekickProvider'

const NAV = [
  { to: '/',             label: '仪表盘' },
  { to: '/customers',    label: '客户' },
  { to: '/opportunities',label: '商机' },
  { to: '/orders',       label: '订单' },
  { to: '/inventory',    label: '库存' },
  { to: '/purchases',    label: '采购' },
  { to: '/receivables',  label: '应收' },
]

export function AppShell({ children, sidekick }: { children: ReactNode; sidekick?: ReactNode }) {
  const { currentUser, reset } = useStore()
  const meta = ROLE_META[currentUser.role]
  const { open, setOpen, wide, setWide, busy } = useSidekick()
  const location = useLocation()
  const onAgentPage = location.pathname === '/agent'
  return (
    <div className="flex h-full">
      <nav className="w-48 shrink-0 bg-white border-r flex flex-col">
        <div className="px-5 py-4 border-b">
          <div className="text-lg font-bold text-brand">OrbitOS</div>
          <div className="text-xs text-slate-400 mt-0.5">擎源工业设备</div>
        </div>
        <div className="p-2 space-y-0.5 flex-1">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}
              className={({ isActive }) => `block px-3 py-2 rounded-md text-sm ${
                isActive ? 'bg-brand/10 text-brand font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>
              {n.label}
            </NavLink>
          ))}
        </div>
        <div className="p-3 border-t text-xs text-slate-400 leading-relaxed">
          <div className="font-medium text-slate-600">{currentUser.name} · {meta.label}</div>
          <div className="mt-1">{meta.description}</div>
        </div>
      </nav>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 bg-white border-b flex items-center justify-between px-6">
          <RoleSwitcher />
          <button onClick={reset}
            className="text-sm text-slate-500 hover:text-danger px-3 py-1.5 rounded hover:bg-slate-50">
            重置演示数据
          </button>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>

      {!onAgentPage && open && (
        <aside className={`${wide ? 'w-[560px]' : 'w-[380px]'} shrink-0 bg-white border-l flex flex-col`}>
          <div className="px-3 py-2 border-b flex items-center justify-end gap-2 shrink-0">
            <NavLink to="/agent"
              className="text-xs text-slate-500 hover:text-brand px-2 py-1 rounded hover:bg-slate-50">
              在新页面打开 ↗
            </NavLink>
            <button onClick={() => setWide(!wide)}
              className="text-xs text-slate-500 hover:text-brand px-2 py-1 rounded hover:bg-slate-50">
              {wide ? '收窄' : '加宽'}
            </button>
            <button onClick={() => setOpen(false)}
              className="text-xs text-slate-500 hover:text-brand px-2 py-1 rounded hover:bg-slate-50">
              收起
            </button>
          </div>
          <div className="flex-1 min-h-0">
            {sidekick ?? <div className="p-6 text-slate-400 text-sm">AI Sidekick（P4 实现）</div>}
          </div>
        </aside>
      )}

      {!onAgentPage && !open && (
        <button onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-2.5 rounded-full
                     bg-brand text-white text-sm shadow-lg hover:opacity-90">
          <span>AI Sidekick</span>
          {/* 按钮底色就是 bg-brand，圆点必须用白色才看得见 */}
          {busy && <span className="w-2 h-2 rounded-full bg-white animate-pulse" />}
        </button>
      )}
    </div>
  )
}
