import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'
import { RoleSwitcher } from './RoleSwitcher'

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

      <aside className="w-[420px] shrink-0 bg-white border-l flex flex-col">
        {sidekick ?? <div className="p-6 text-slate-400 text-sm">AI Sidekick（P4 实现）</div>}
      </aside>
    </div>
  )
}
