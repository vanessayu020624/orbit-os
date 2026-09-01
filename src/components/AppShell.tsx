import { NavLink, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useStore } from '../lib/store'
import { ROLE_META, isEntityDenied } from '../lib/rbac'
import type { ScopedEntity } from '../lib/rbac'
import { RoleSwitcher } from './RoleSwitcher'
import { useSidekick } from '../sidekick/SidekickProvider'

interface NavItem { to: string; label: string; entity: ScopedEntity | null }
interface NavGroup { title: string | null; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  { title: null, items: [
    { to: '/',              label: '仪表盘', entity: null },
    { to: '/agent',         label: 'AI 助手', entity: null },
  ] },
  { title: '销售', items: [
    { to: '/customers',     label: '客户',   entity: 'customers' },
    { to: '/opportunities', label: '商机',   entity: 'opportunities' },
    { to: '/orders',        label: '订单',   entity: 'orders' },
  ] },
  { title: '供应链', items: [
    { to: '/inventory',     label: '库存',   entity: null },
    { to: '/purchases',     label: '采购',   entity: 'purchases' },
  ] },
  { title: '财务', items: [
    { to: '/receivables',   label: '应收',   entity: 'receivables' },
  ] },
]

export function AppShell({ children, sidekick }: { children: ReactNode; sidekick?: ReactNode }) {
  const { currentUser, reset } = useStore()
  const meta = ROLE_META[currentUser.role]
  const { open, setOpen, wide, setWide, busy, resetConversations } = useSidekick()
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
          {NAV_GROUPS.map(g => (
            <div key={g.title ?? '__root'}>
              {g.title && (
                <div className="px-3 pt-3 pb-1 text-[10px] font-medium text-slate-400 tracking-wide">
                  {g.title}
                </div>
              )}
              {g.items.map(n => {
                const denied = n.entity !== null && isEntityDenied(currentUser.role, n.entity)
                return (
                  <NavLink key={n.to} to={n.to} end={n.to === '/'}
                    title={denied ? `${ROLE_META[currentUser.role].label}无此权限` : undefined}
                    className={({ isActive }) => `flex items-center justify-between gap-1.5 px-3 py-2 rounded-md text-sm ${
                      isActive ? 'bg-brand/10 text-brand font-medium'
                        : denied ? 'text-slate-300 hover:bg-slate-50' : 'text-slate-600 hover:bg-slate-50'}`}>
                    <span>{n.label}</span>
                    {denied && (
                      <svg viewBox="0 0 16 16" className="w-3 h-3 shrink-0" fill="currentColor" aria-hidden="true">
                        <path d="M5 7V5a3 3 0 1 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v4A1.5 1.5 0 0 1 11.5 14h-7A1.5 1.5 0 0 1 3 12.5v-4A1.5 1.5 0 0 1 4.5 7H5Zm1.2 0h3.6V5a1.8 1.8 0 1 0-3.6 0v2Z" />
                      </svg>
                    )}
                  </NavLink>
                )
              })}
            </div>
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
          <button onClick={() => { reset(); resetConversations() }}
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
