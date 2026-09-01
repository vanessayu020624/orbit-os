import { useRef, useState } from 'react'
import type { AgentEvent, Plan } from '../lib/types'
import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'
import { toolsFor } from '../agent/registry'
import { runAgent } from '../agent/loop'
import { runReplay } from '../agent/replay'
import { PlanChecklist, type StepState } from './PlanChecklist'
import { ToolCallCard } from './ToolCallCard'
import { ConfirmCard } from './ConfirmCard'
import { FinalAnswer } from './FinalAnswer'

const PRESETS = [
  '未来两周要交付的订单有风险吗？帮我排查并给出处理方案。',
  '公司最大的客户是谁？',
  '我这个月的商机漏斗情况怎么样？',
]

type Item =
  | { k: 'user'; text: string }
  | { k: 'plan'; plan: Plan }
  | { k: 'tool'; id: string; name: string; args: unknown; result?: unknown; ms?: number }
  | { k: 'confirm'; id: string; toolName: string; summary: string; resolved?: boolean }
  | { k: 'final'; text: string; refs: string[] }
  | { k: 'error'; text: string }

export function Sidekick() {
  // 不要解构 db——本组件不用它，vite react-ts 模板开了 noUnusedLocals，会直接构建失败
  const { currentUser, applyMutation, pushAudit } = useStore()
  const [items, setItems] = useState<Item[]>([])
  const [steps, setSteps] = useState<Record<string, StepState>>({})
  const [amended, setAmended] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [replayMode, setReplayMode] = useState(false)
  const [input, setInput] = useState('')
  const pending = useRef<Map<string, (ok: boolean) => void>>(new Map())

  const toolCount = toolsFor(currentUser.role).length

  function onEvent(e: AgentEvent) {
    switch (e.type) {
      case 'plan':
        setItems(p => [...p, { k: 'plan', plan: e.plan }])
        setSteps(Object.fromEntries(e.plan.steps.map(s => [s.id, 'pending' as StepState])))
        break
      case 'plan_amended':
        setItems(p => p.map(it => it.k === 'plan'
          ? { ...it, plan: { ...it.plan, steps: [...it.plan.steps, ...e.addedSteps] } } : it))
        setAmended(s => new Set([...s, ...e.addedSteps.map(x => x.id)]))
        setSteps(s => ({ ...s, ...Object.fromEntries(e.addedSteps.map(x => [x.id, 'pending' as StepState])) }))
        break
      case 'step_start': setSteps(s => ({ ...s, [e.stepId]: 'running' })); break
      case 'step_done':  setSteps(s => ({ ...s, [e.stepId]: 'done' })); break
      case 'tool_call':
        setItems(p => [...p, { k: 'tool', id: e.id, name: e.name, args: e.args }]); break
      case 'tool_result':
        setItems(p => p.map(it => it.k === 'tool' && it.id === e.id
          ? { ...it, result: e.result, ms: e.ms } : it)); break
      case 'confirm_request':
        setItems(p => [...p, { k: 'confirm', id: e.id, toolName: e.toolName, summary: e.summary }]); break
      case 'confirm_resolved':
        setItems(p => p.map(it => it.k === 'confirm' && it.id === e.id
          ? { ...it, resolved: e.approved } : it)); break
      case 'final':
        setItems(p => [...p, { k: 'final', text: e.text, refs: e.refs }]); break
      case 'error':
        setItems(p => [...p, { k: 'error', text: e.message }]); break
    }
  }

  const requestConfirm = (id: string) =>
    new Promise<boolean>(res => { pending.current.set(id, res) })

  async function ask(q: string) {
    if (busy || !q.trim()) return
    setBusy(true); setInput('')
    setItems(p => [...p, { k: 'user', text: q }])
    const confirmFn = (id: string) => requestConfirm(id)
    try {
      await runAgent({
        question: q, user: currentUser,
        getDb: () => useStore.getState().db,
        mutate: applyMutation, emit: onEvent, pushAudit,
        requestConfirm: (id) => confirmFn(id),
      })
    } catch {
      setReplayMode(true)
      const scene = /风险|交期|延期|发货/.test(q) ? 'delivery' : 'permission'
      await runReplay(scene, onEvent, (id) => confirmFn(id))
    } finally {
      setBusy(false)
    }
  }

  function decide(id: string, ok: boolean) {
    pending.current.get(id)?.(ok)
    pending.current.delete(id)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b">
        <div className="flex items-center justify-between">
          <div className="font-medium text-sm">AI Sidekick</div>
          {replayMode && <span className="text-[10px] px-1.5 py-0.5 rounded bg-warn/20 text-warn">录播模式</span>}
        </div>
        <div className="text-xs text-slate-400 mt-0.5">
          {currentUser.name} · {ROLE_META[currentUser.role].label} · 可用工具 {toolCount} 个
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2.5">
        {!items.length && (
          <div className="text-sm text-slate-400 p-4 leading-relaxed">
            问我关于客户、商机、订单、库存、采购的任何问题。<br />
            我会先列出执行计划，再逐步调用工具，涉及数据变更时会先请你确认。
          </div>
        )}
        {items.map((it, i) => {
          switch (it.k) {
            case 'user':  return <div key={i} className="text-sm bg-brand text-white rounded-lg px-3 py-2 ml-8">{it.text}</div>
            case 'plan':  return <PlanChecklist key={i} plan={it.plan} states={steps} amendedIds={amended} />
            case 'tool':  return <ToolCallCard key={i} {...it} />
            case 'confirm': return <ConfirmCard key={i} {...it} onDecide={ok => decide(it.id, ok)} />
            case 'final': return <FinalAnswer key={i} text={it.text} refs={it.refs} />
            case 'error': return <div key={i} className="text-xs text-danger bg-danger/5 rounded p-2">{it.text}</div>
          }
        })}
      </div>

      <div className="border-t p-3 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(p => (
            <button key={p} onClick={() => ask(p)} disabled={busy}
              className="text-[11px] px-2 py-1 rounded-full border text-slate-500
                         hover:border-brand hover:text-brand disabled:opacity-40">
              {p.length > 16 ? p.slice(0, 16) + '…' : p}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && ask(input)}
            placeholder={busy ? '执行中…' : '问点什么…'} disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none focus:border-brand" />
          <button onClick={() => ask(input)} disabled={busy}
            className="px-3 py-2 rounded-lg bg-brand text-white text-sm disabled:opacity-40">发送</button>
        </div>
      </div>
    </div>
  )
}
