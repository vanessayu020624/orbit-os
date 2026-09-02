import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'
import { ALL_TOOLS, toolsFor } from '../agent/registry'
import { ItemView } from './ItemView'
import { presetsFor, useSidekick } from './SidekickProvider'
import { ConversationBar } from './ConversationBar'
import { ContextPanel } from './ContextPanel'

export function Sidekick() {
  // 不要解构 db——本组件不用它，vite react-ts 模板开了 noUnusedLocals，会直接构建失败
  const { currentUser } = useStore()
  const c = useSidekick()
  const toolCount = toolsFor(currentUser.role).length
  const presets = presetsFor(currentUser.role)

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b">
        <div className="font-medium text-sm">星轨</div>
        <div className="text-xs text-slate-400 mt-0.5">
          {currentUser.name} · {ROLE_META[currentUser.role].label} · 可用工具 {toolCount} / 共 {ALL_TOOLS.length} 个
        </div>
      </div>

      <ConversationBar />

      <div className="flex-1 overflow-auto p-3 space-y-2.5">
        {!c.items.length && (
          <div className="text-sm text-slate-400 p-4 leading-relaxed">
            问我关于客户、商机、订单、库存、采购的任何问题。<br />
            我会先列出执行计划，再逐步调用工具，涉及数据变更时会先请你确认。
          </div>
        )}
        {c.items.map((it, i) => <ItemView key={i} item={it} />)}
      </div>

      <div className="border-t p-3 space-y-2">
        <ContextPanel />
        <div className="flex flex-wrap gap-1.5">
          {presets.map(p => (
            <button key={p} onClick={() => c.ask(p)} disabled={c.busy}
              className="text-[11px] px-2 py-1 rounded-full border text-slate-500
                         hover:border-brand hover:text-brand disabled:opacity-40">
              {p.length > 16 ? p.slice(0, 16) + '…' : p}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={c.input} onChange={e => c.setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && c.ask(c.input)}
            placeholder={c.busy && c.busyConvId !== c.activeId ? '星轨正在另一个会话中执行，结束后可继续' : c.busy ? '执行中…' : '问点什么…'}
            disabled={c.busy}
            className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none focus:border-brand" />
          <button onClick={() => c.ask(c.input)} disabled={c.busy}
            className="px-3 py-2 rounded-lg bg-brand text-white text-sm disabled:opacity-40">发送</button>
        </div>
      </div>
    </div>
  )
}
