import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'
import { toolsFor } from '../agent/registry'
import { PlanChecklist } from './PlanChecklist'
import { ToolCallCard } from './ToolCallCard'
import { ConfirmCard } from './ConfirmCard'
import { FinalAnswer } from './FinalAnswer'
import { PRESETS, useSidekick } from './SidekickProvider'
import { ConversationBar } from './ConversationBar'

export function Sidekick() {
  // 不要解构 db——本组件不用它，vite react-ts 模板开了 noUnusedLocals，会直接构建失败
  const { currentUser } = useStore()
  const c = useSidekick()
  const toolCount = toolsFor(currentUser.role).length

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b">
        <div className="flex items-center justify-between">
          <div className="font-medium text-sm">AI Sidekick</div>
          {c.replayMode && <span className="text-[10px] px-1.5 py-0.5 rounded bg-warn/20 text-warn">录播模式</span>}
        </div>
        <div className="text-xs text-slate-400 mt-0.5">
          {currentUser.name} · {ROLE_META[currentUser.role].label} · 可用工具 {toolCount} 个
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
        {c.items.map((it, i) => {
          switch (it.k) {
            case 'user':  return <div key={i} className="text-sm bg-brand text-white rounded-lg px-3 py-2 ml-8">{it.text}</div>
            case 'plan':  return <PlanChecklist key={i} plan={it.plan} states={c.steps} amendedIds={c.amended} />
            case 'tool':  return <ToolCallCard key={i} {...it} />
            case 'confirm': return <ConfirmCard key={i} {...it} onDecide={ok => c.decide(it.id, ok)} />
            case 'final': return <FinalAnswer key={i} text={it.text} refs={it.refs} />
            case 'error': return <div key={i} className="text-xs text-danger bg-danger/5 rounded p-2">{it.text}</div>
            case 'divider': return (
              <div key={i} className="flex items-center gap-2 py-1">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[10px] text-slate-400 whitespace-nowrap">{it.text}</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
            )
          }
        })}
      </div>

      <div className="border-t p-3 space-y-2">
        {c.readOnly && c.readOnlyOwner && (
          <div className="text-[11px] text-slate-400 bg-slate-50 rounded px-2 py-1.5 leading-relaxed">
            这是【{c.readOnlyOwner.name} · {c.readOnlyOwner.roleLabel}】的会话，切换到该角色后才能继续提问。
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(p => (
            <button key={p} onClick={() => c.ask(p)} disabled={c.busy || c.readOnly}
              className="text-[11px] px-2 py-1 rounded-full border text-slate-500
                         hover:border-brand hover:text-brand disabled:opacity-40">
              {p.length > 16 ? p.slice(0, 16) + '…' : p}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={c.input} onChange={e => c.setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && c.ask(c.input)}
            placeholder={c.busy ? '执行中…' : '问点什么…'} disabled={c.busy || c.readOnly}
            className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none focus:border-brand" />
          <button onClick={() => c.ask(c.input)} disabled={c.busy || c.readOnly}
            className="px-3 py-2 rounded-lg bg-brand text-white text-sm disabled:opacity-40">发送</button>
        </div>
      </div>
    </div>
  )
}
