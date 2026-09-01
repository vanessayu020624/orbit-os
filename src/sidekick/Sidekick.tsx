import { useEffect, useRef, useState } from 'react'
import type { AgentEvent, Plan } from '../lib/types'
import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'
import { toolsFor } from '../agent/registry'
import { runAgent } from '../agent/loop'
import { LlmRateLimited, resetUsage, sumUsage } from '../agent/llm'
import { runReplay } from '../agent/replay'
import { onAskAgent } from '../lib/bus'
import { PlanChecklist, type StepState } from './PlanChecklist'
import { ToolCallCard } from './ToolCallCard'
import { ConfirmCard } from './ConfirmCard'
import { FinalAnswer } from './FinalAnswer'

const PRESETS = [
  '未来两周要交付的订单有风险吗？帮我排查并给出处理方案。',
  '公司最大的客户是谁？',
  '我这个月的商机漏斗情况怎么样？',
]

// Ruling T4-B：录播只录了两个场景，猜错场景会答非所问、但看起来像真的，比明说"不支持"更糟。
// 命中不了任何场景就不猜，交给调用方走诚实降级提示。
type Scene = 'delivery' | 'permission' | null
function pickScene(q: string): Scene {
  if (/风险|交期|延期|发货/.test(q)) return 'delivery'
  if (/最大|排名|客户/.test(q)) return 'permission'
  return null
}

/**
 * 本轮问答是否该写进会话历史。
 * 一次问询要 6~40 秒，用户可能中途切角色；切角色的 effect 会同步清空 history.current，
 * 而 ask() 的 finally 在那之后才跑，会把旧角色的答案写回已清空的历史——下一次提问就带上了
 * 上一个角色看到的数据，属于越权泄漏（剧本 C 正是切角色对照，最容易撞上）。
 * 所以：跑到一半被切走了，这一轮的答案直接丢弃，它本来就属于旧角色。
 * 抽成纯函数是为了在没有 jsdom 的情况下也能对这个判定做回归测试。
 */
export function shouldRecordTurn(askUserId: string, currentUserId: string, finalText: string): boolean {
  return !!finalText && askUserId === currentUserId
}

type Item =
  | { k: 'user'; text: string }
  | { k: 'plan'; plan: Plan }
  | { k: 'tool'; id: string; name: string; args: unknown; result?: unknown; ms?: number }
  | { k: 'confirm'; id: string; toolName: string; summary: string; resolved?: boolean }
  | { k: 'final'; text: string; refs: string[] }
  | { k: 'error'; text: string }
  | { k: 'divider'; text: string }

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
  // busy 状态用于渲染禁用输入框；busyRef 供 ask() 内部做实时并发拦截，
  // 避免 bus 订阅注册的旧闭包读到渲染时快照的 busy（见下方 useEffect 的说明）。
  const busyRef = useRef(false)
  // 最近两轮问答，喂给 planner/executor 让追问能理解指代。
  // 切换角色时必须清空——把 A 角色看到的数据带进 B 角色的上下文是越权泄漏。
  const history = useRef<{ q: string; a: string }[]>([])

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
    if (busyRef.current || !q.trim()) return
    busyRef.current = true
    setBusy(true); setInput('')
    setItems(p => [...p, { k: 'user', text: q }])
    // 真跑成功时不该再挂着上一次失败留下的「录播模式」徽章。
    setReplayMode(false)
    resetUsage()

    // onEvent 拿不到问题文本，所以在这里接住本轮的 final 文本，回头连同 q 一起进历史。
    let finalText = ''
    const emit = (e: AgentEvent) => {
      if (e.type === 'final') finalText = e.text
      onEvent(e)
    }
    const confirmFn = (id: string) => requestConfirm(id)
    // 本次运行认定的角色。取自 useStore.getState()：即便本次 ask 闭包是 bus 在上一次角色切换时
    // 注册的旧闭包，这里取的也是调用时刻的实时角色，不会读到渲染快照。
    // 捕获成常量而不是在下面现取，保证一次运行自始至终是同一个角色（也是 finally 里的比对基准）。
    const askUser = useStore.getState().currentUser
    try {
      await runAgent({
        question: q, user: askUser,
        getDb: () => useStore.getState().db,
        mutate: applyMutation, emit, pushAudit,
        requestConfirm: (id) => confirmFn(id),
        history: history.current,
      })
    } catch (e) {
      const limited = e instanceof LlmRateLimited
      setReplayMode(true)
      const scene = pickScene(q)
      // 真实卡片已经 emit 过一部分，录播从这里接管，必须有肉眼可见的分界。
      setItems(p => [...p, { k: 'divider', text: limited
        ? '模型并发已满（1302），以下为录播内容'
        : '模型连接失败，以下为录播内容' }])
      if (scene) {
        await runReplay(scene, emit, (id) => confirmFn(id))
      } else {
        setItems(p => [...p, { k: 'error', text: limited
          ? '智谱免费档并发上限为 2 路，当前已占满（错误码 1302），且这个问题不在录播的两个场景内。稍等几秒重试即可。'
          : '当前无法连接模型，且这个问题不在录播的「交期风险排查」与「权限差异」两个场景内。' }])
      }
    } finally {
      // 只有当前角色仍然是发起这次提问的角色时，才把这一轮写进历史。见 shouldRecordTurn。
      if (shouldRecordTurn(askUser.id, useStore.getState().currentUser.id, finalText)) {
        history.current = [...history.current, { q, a: finalText }].slice(-2)
      }
      const u = sumUsage()
      if (u.total_tokens > 0) {
        setItems(p => [...p, { k: 'divider',
          text: `本次问询消耗 ${u.total_tokens} tokens（输入 ${u.prompt_tokens} / 输出 ${u.completion_tokens}）` }])
      }
      busyRef.current = false
      setBusy(false)
    }
  }

  // 风险卡「让 Agent 排查 →」通过全局事件总线驱动本组件。ask 内部已改为从
  // useStore.getState() 读取实时 currentUser、用 busyRef 做并发拦截，因此即便这里注册进
  // bus 的 ask 是角色切换那一刻捕获的闭包，也不会读到过期状态（P5 brief 提示的坑，已处理）。
  useEffect(() => onAskAgent(ask), [currentUser])

  // 切角色即清空会话历史。可见的对话记录**保留**（剧本 C 靠上下对照），
  // 但喂给模型的上下文必须清掉，否则会把上一个角色的数据带进新角色的推理里。
  useEffect(() => { history.current = [] }, [currentUser])

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
