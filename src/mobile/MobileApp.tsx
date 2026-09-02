import { useState } from 'react'
import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'
import type { Role } from '../lib/types'
import { useSidekick } from '../sidekick/SidekickProvider'
import { RefNavProvider } from '../components/RefNav'
import { MobileChat } from './MobileChat'
import { MobileData } from './MobileData'
import { DetailSheet } from './DetailSheet'

const ROLES: Role[] = ['sales_rep', 'sales_director', 'supply_chain', 'ceo']

/**
 * 窄屏下的整个应用。
 *
 * 这不是桌面版的响应式收缩，是另一套信息架构：桌面版的核心动作要三栏同时在场
 * （读结论 ↔ 点编号 ↔ 在数据里核对），手机上任何断点都摆不下三栏。
 * 所以这里把「核对」从并排改成盖上来的一层，把八个导航项压成两个 tab。
 * 共用的是数据、权限和全部对话卡片组件；不共用的只有布局。
 */
export function MobileApp() {
  const { currentUser, setRole, reset } = useStore()
  const { busy, resetConversations } = useSidekick()
  const [tab, setTab] = useState<'chat' | 'data'>('chat')
  // 详情卡是一个栈：订单 → 客户 → 另一张订单，返回要能逐层退回去。
  const [stack, setStack] = useState<string[]>([])

  const open = (ref: string) => setStack(s => [...s, ref])

  return (
    <RefNavProvider onOpen={open}>
      <div className="flex flex-col h-full bg-slate-50">
        <header className="shrink-0 bg-white border-b px-3 py-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-base font-bold text-brand leading-tight">OrbitOS</div>
            <div className="text-[10px] text-slate-400 truncate">擎源工业设备 · 星轨</div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* 手机上用原生 select 而不是桌面那排分段按钮：四个中文角色名在 360px 宽下
                会挤成两行，而原生选择器还顺带给了系统级的滚轮交互。 */}
            <select value={currentUser.role} onChange={e => setRole(e.target.value as Role)}
              className="text-xs border rounded-md px-2 py-1.5 bg-white text-slate-700 max-w-[8rem]">
              {ROLES.map(r => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
            </select>
            <button onClick={() => { reset(); resetConversations(); setStack([]) }} disabled={busy}
              className="text-xs text-slate-400 px-1.5 py-1.5 disabled:opacity-40">重置</button>
          </div>
        </header>

        <div className="flex-1 min-h-0">
          {tab === 'chat' ? <MobileChat /> : <MobileData onOpen={open} />}
        </div>

        {/* 底部内边距吃 safe-area：不加的话在 iPhone 上两个 tab 会被那条 home 指示条压掉一半 */}
        <nav className="shrink-0 bg-white border-t flex pb-[env(safe-area-inset-bottom)]">
          {([['chat', '星轨'], ['data', '数据']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 py-2.5 text-sm flex items-center justify-center gap-1.5 ${
                tab === k ? 'text-brand font-medium' : 'text-slate-400'}`}>
              {label}
              {k === 'chat' && busy && <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />}
            </button>
          ))}
        </nav>

        {stack.length > 0 && (
          <DetailSheet
            refId={stack[stack.length - 1]}
            depth={stack.length - 1}
            onOpen={open}
            onBack={() => setStack(s => s.slice(0, -1))}
            onClose={() => setStack([])} />
        )}
      </div>
    </RefNavProvider>
  )
}
