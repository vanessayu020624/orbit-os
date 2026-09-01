import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentEvent, Plan } from '../lib/types'
import { useStore } from '../lib/store'
import { runAgent } from '../agent/loop'
import { LlmRateLimited, resetUsage, sumUsage } from '../agent/llm'
import { runReplay } from '../agent/replay'
import { onAskAgent } from '../lib/bus'
import { ROLE_META } from '../lib/rbac'
import type { StepState } from './PlanChecklist'
import { readUiPrefs, writeUiPrefs } from '../lib/uiPrefs'
import {
  type Conversation, readConversations, writeConversations, newConversation, titleFor,
} from '../lib/conversations'

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

export type Item =
  | { k: 'user'; text: string }
  | { k: 'plan'; plan: Plan }
  | { k: 'tool'; id: string; name: string; args: unknown; result?: unknown; ms?: number }
  | { k: 'confirm'; id: string; toolName: string; summary: string; resolved?: boolean }
  | { k: 'final'; text: string; refs: string[] }
  | { k: 'error'; text: string }
  | { k: 'divider'; text: string }

export interface SidekickCtx {
  items: Item[]
  steps: Record<string, StepState>
  amended: Set<string>
  busy: boolean
  replayMode: boolean
  input: string
  setInput: (v: string) => void
  ask: (q: string) => Promise<void>
  decide: (id: string, ok: boolean) => void
  open: boolean            // 抽屉是否展开
  setOpen: (v: boolean) => void
  wide: boolean            // 宽档位：false=380px，true=560px
  setWide: (v: boolean) => void
  conversations: Conversation[]
  activeId: string
  activeConversation: Conversation
  readOnly: boolean
  readOnlyOwner: { name: string; roleLabel: string } | null
  newChat: () => void
  switchChat: (id: string) => void
  deleteChat: (id: string) => void
  resetConversations: () => void
}

const Ctx = createContext<SidekickCtx | null>(null)

export function useSidekick(): SidekickCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useSidekick must be used within SidekickProvider')
  return c
}

export { PRESETS }

function newConvId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function SidekickProvider({ children }: { children: ReactNode }) {
  const { currentUser, applyMutation, pushAudit } = useStore()

  // 必须惰性初始化：Provider 包着整棵应用树，一次问询会 emit 几十个事件、每个都触发重渲染，
  // 非惰性写法会在每次渲染上做一次同步 localStorage.getItem + JSON.parse 再把结果丢掉。
  // 初始化：读回会话；列表为空就用 newConversation 造一条并设为 active；非空则 active 取第 0 条。
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const cs = readConversations()
    return cs.length > 0 ? cs : [newConversation(newConvId(), currentUser.id, Date.now())]
  })
  const [activeId, setActiveId] = useState<string>(() => conversations[0].id)
  const activeIdRef = useRef(activeId)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  // 供 ensureWritableConversation 在事件循环之外（bus 路径）读取最新会话列表。
  // 只能在 effect 里同步，不能写进 setConversations 的更新函数内部——
  // React 严格模式会双调用更新函数，那样会导致 ref 被写两次而状态本身只变一次，不是本质问题，
  // 但把有副作用的写操作放进 reducer 是明确的反模式，这里避免。
  const conversationsRef = useRef(conversations)
  useEffect(() => { conversationsRef.current = conversations }, [conversations])

  const [steps, setSteps] = useState<Record<string, StepState>>({})
  const [amended, setAmended] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [replayMode, setReplayMode] = useState(false)
  const [input, setInput] = useState('')
  const pending = useRef<Map<string, (ok: boolean) => void>>(new Map())
  // busy 状态用于渲染禁用输入框；busyRef 供 ask() 内部做实时并发拦截，
  // 避免 bus 订阅注册的旧闭包读到渲染时快照的 busy（见下方 useEffect 的说明）。
  const busyRef = useRef(false)

  // 必须惰性初始化：Provider 包着整棵应用树，一次问询会 emit 几十个事件、每个都触发重渲染，
  // 非惰性写法会在每次渲染上做一次同步 localStorage.getItem + JSON.parse 再把结果丢掉。
  const [open, setOpen] = useState(() => readUiPrefs().open)
  const [wide, setWide] = useState(() => readUiPrefs().wide)

  useEffect(() => { writeUiPrefs({ open, wide }) }, [open, wide])
  useEffect(() => { writeConversations(conversations) }, [conversations])

  const activeConversation = conversations.find(c => c.id === activeId) ?? conversations[0]
  const items = activeConversation.items
  const readOnly = activeConversation.userId !== currentUser.id
  const owner = readOnly ? useStore.getState().db.users.find(u => u.id === activeConversation.userId) : undefined
  const readOnlyOwner = readOnly
    ? { name: owner?.name ?? '—', roleLabel: owner ? ROLE_META[owner.role].label : '—' }
    : null

  // 更新指定会话（不是「活跃会话」）的 items。必须是函数式更新——高频 emit 下闭包读旧 state 会丢事件
  // （P5 复审专门核过的点）。convId 由调用方在 ask() 开始时捕获成常量传入，不读 activeIdRef——
  // 一次问询自始至终写同一个会话，哪怕用户中途切了会话/新建了会话/触发了重置。
  // title 只在 retitle=true（追加首条 user 消息时）才重算，其余高频事件不必每次都重算一次标题。
  function updateItems(convId: string, fn: (items: Item[]) => Item[], retitle = false) {
    setConversations(cs => cs.map(c => {
      if (c.id !== convId) return c
      const items = fn(c.items)
      return { ...c, items, title: retitle ? titleFor(items) : c.title }
    }))
  }

  function onEvent(convId: string, e: AgentEvent) {
    switch (e.type) {
      case 'plan':
        updateItems(convId, p => [...p, { k: 'plan', plan: e.plan }])
        setSteps(Object.fromEntries(e.plan.steps.map(s => [s.id, 'pending' as StepState])))
        break
      case 'plan_amended':
        updateItems(convId, p => p.map(it => it.k === 'plan'
          ? { ...it, plan: { ...it.plan, steps: [...it.plan.steps, ...e.addedSteps] } } : it))
        setAmended(s => new Set([...s, ...e.addedSteps.map(x => x.id)]))
        setSteps(s => ({ ...s, ...Object.fromEntries(e.addedSteps.map(x => [x.id, 'pending' as StepState])) }))
        break
      case 'step_start': setSteps(s => ({ ...s, [e.stepId]: 'running' })); break
      case 'step_done':  setSteps(s => ({ ...s, [e.stepId]: 'done' })); break
      case 'tool_call':
        updateItems(convId, p => [...p, { k: 'tool', id: e.id, name: e.name, args: e.args }]); break
      case 'tool_result':
        updateItems(convId, p => p.map(it => it.k === 'tool' && it.id === e.id
          ? { ...it, result: e.result, ms: e.ms } : it)); break
      case 'confirm_request':
        updateItems(convId, p => [...p, { k: 'confirm', id: e.id, toolName: e.toolName, summary: e.summary }]); break
      case 'confirm_resolved':
        updateItems(convId, p => p.map(it => it.k === 'confirm' && it.id === e.id
          ? { ...it, resolved: e.approved } : it)); break
      case 'final':
        updateItems(convId, p => [...p, { k: 'final', text: e.text, refs: e.refs }]); break
      case 'error':
        updateItems(convId, p => [...p, { k: 'error', text: e.message }]); break
    }
  }

  const requestConfirm = (id: string) =>
    new Promise<boolean>(res => { pending.current.set(id, res) })

  // 只读会话不能提问，但「什么都不做」是最差的选择：首页风险卡的按钮经 bus 进来时，
  // 用户看到的会是一个点了毫无反应的按钮，这个项目全程在反对静默禁用/静默无响应。
  // 意图是明确的——他要在当前角色下问这件事——所以直接给他开一条属于当前角色的新会话。
  // 返回完整的 Conversation（而不是 id），这样调用方能立刻拿到正确的 history，
  // 不必去读可能落后一帧的 conversationsRef。
  function ensureWritableConversation(): Conversation {
    const uid = useStore.getState().currentUser.id
    const cur = conversationsRef.current.find(c => c.id === activeIdRef.current)
    if (cur && cur.userId === uid) return cur
    const c = newConversation(newConvId(), uid, Date.now())
    activeIdRef.current = c.id
    setSteps({}); setAmended(new Set())
    setConversations(cs => [c, ...cs])
    setActiveId(c.id)
    return c
  }

  async function ask(q: string) {
    if (busyRef.current || !q.trim()) return
    const targetConv = ensureWritableConversation()
    const targetId = targetConv.id
    busyRef.current = true
    setBusy(true); setInput('')
    updateItems(targetId, p => [...p, { k: 'user', text: q }], true)
    // 真跑成功时不该再挂着上一次失败留下的「录播模式」徽章。
    setReplayMode(false)
    resetUsage()

    // onEvent 拿不到问题文本，所以在这里接住本轮的 final 文本，回头连同 q 一起进历史。
    let finalText = ''
    const emit = (e: AgentEvent) => {
      if (e.type === 'final') finalText = e.text
      onEvent(targetId, e)
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
        history: targetConv.history,
      })
    } catch (e) {
      const limited = e instanceof LlmRateLimited
      setReplayMode(true)
      const scene = pickScene(q)
      // 真实卡片已经 emit 过一部分，录播从这里接管，必须有肉眼可见的分界。
      updateItems(targetId, p => [...p, { k: 'divider', text: limited
        ? '模型并发已满（1302），以下为录播内容'
        : '模型连接失败，以下为录播内容' }])
      if (scene) {
        await runReplay(scene, askUser, emit, (id) => confirmFn(id))
      } else {
        updateItems(targetId, p => [...p, { k: 'error', text: limited
          ? '智谱免费档并发上限为 2 路，当前已占满（错误码 1302），且这个问题不在录播的两个场景内。稍等几秒重试即可。'
          : '当前无法连接模型，且这个问题不在录播的「交期风险排查」与「权限差异」两个场景内。' }])
      }
    } finally {
      // 只有当前角色仍然是发起这次提问的角色时，才把这一轮写进历史。见 shouldRecordTurn。
      if (shouldRecordTurn(askUser.id, useStore.getState().currentUser.id, finalText)) {
        setConversations(cs => cs.map(c => c.id === targetId
          ? { ...c, history: [...c.history, { q, a: finalText }].slice(-2) } : c))
      }
      const u = sumUsage()
      if (u.total_tokens > 0) {
        updateItems(targetId, p => [...p, { k: 'divider',
          text: `本次问询消耗 ${u.total_tokens} tokens（输入 ${u.prompt_tokens} / 输出 ${u.completion_tokens}）` }])
      }
      busyRef.current = false
      setBusy(false)
    }
  }

  // 风险卡「让 Agent 排查 →」通过全局事件总线驱动。ask 内部已改为从
  // useStore.getState() 读取实时 currentUser、用 busyRef 做并发拦截，因此即便这里注册进
  // bus 的 ask 是角色切换那一刻捕获的闭包，也不会读到过期状态（P5 brief 提示的坑，已处理）。
  // 抽屉可能是收起的：先展开再问，否则点击看起来毫无反应。
  useEffect(() => onAskAgent((q) => { setOpen(true); ask(q) }), [currentUser])

  function decide(id: string, ok: boolean) {
    pending.current.get(id)?.(ok)
    pending.current.delete(id)
  }

  // 四个会话管理操作统一用 busyRef（而非渲染态 busy）做并发拦截：理由和 ask() 一样——
  // 它们可能被非渲染路径（bus、事件回调）调用，读渲染快照的 busy 可能过期。
  // 一次问询跑到一半切走/删除/重置活跃会话，会让 updateItems 写不到目标会话，答案凭空消失；
  // 所以这里直接拒绝，而不是「切走了再默默丢事件」。

  function newChat() {
    if (busyRef.current) return
    const c = newConversation(newConvId(), useStore.getState().currentUser.id, Date.now())
    setSteps({}); setAmended(new Set())
    setConversations(cs => [c, ...cs])
    setActiveId(c.id)
  }

  function switchChat(id: string) {
    if (busyRef.current) return
    if (!conversations.some(c => c.id === id)) return
    setSteps({}); setAmended(new Set())
    setActiveId(id)
  }

  function deleteChat(id: string) {
    if (busyRef.current) return
    const rest = conversations.filter(c => c.id !== id)
    const next = rest.length > 0 ? rest : [newConversation(newConvId(), useStore.getState().currentUser.id, Date.now())]
    setConversations(next)
    if (id === activeIdRef.current) {
      setSteps({}); setAmended(new Set())
      setActiveId(next[0].id)
    }
  }

  function resetConversations() {
    if (busyRef.current) return
    const c = newConversation(newConvId(), useStore.getState().currentUser.id, Date.now())
    setSteps({}); setAmended(new Set())
    setConversations([c])
    setActiveId(c.id)
  }

  const value: SidekickCtx = {
    items, steps, amended, busy, replayMode, input, setInput, ask, decide,
    open, setOpen, wide, setWide,
    conversations, activeId, activeConversation, readOnly, readOnlyOwner,
    newChat, switchChat, deleteChat, resetConversations,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
