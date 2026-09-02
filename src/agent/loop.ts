import type { AgentEvent, Plan, ToolContext, User, Mutation, PlanStep } from '../lib/types'
import { chat, extractJson, LlmUnavailable, type ChatMessage } from './llm'
import { plannerPrompt, executorPrompt, type Turn } from './prompts'
import { toolSchemasFor, executeTool, auditOf, ALL_TOOLS, toolsFor } from './registry'
import { overrideNoticeFor } from '../lib/rbac'
import type { DbSnapshot, AuditEntry } from '../lib/types'

export interface RunAgentOptions {
  question: string
  user: User
  getDb: () => DbSnapshot                 // 每次工具执行都重新取，保证写入后的读能看到新值
  mutate: (m: Mutation) => void
  emit: (e: AgentEvent) => void
  pushAudit: (e: AuditEntry) => void
  /** 返回 true 表示用户批准。UI 负责弹卡并 resolve。 */
  requestConfirm: (id: string, toolName: string, args: unknown, summary: string) => Promise<boolean>
  /** 最近几轮问答，用于让追问能理解指代。不传则按单轮处理。 */
  history?: Turn[]
}

const MAX_TURNS = 12

export async function runAgent(o: RunAgentOptions): Promise<void> {
  const ctx = (): ToolContext =>
    ({ user: o.user, role: o.user.role, db: o.getDb(), mutate: o.mutate })

  // ---------- Phase 1: Planner ----------
  let plan: Plan
  try {
    const res = await chat({
      jsonMode: true,
      messages: [
        { role: 'system', content: plannerPrompt(o.user, o.history) },
        { role: 'user', content: o.question },
      ],
    })
    plan = extractJson<Plan>(res.content ?? '{}')
    if (!Array.isArray(plan.steps)) plan.steps = []
    plan.steps = plan.steps.map((s, i) => ({ ...s, id: s.id || `s${i + 1}` }))
  } catch (e) {
    o.emit({ type: 'error', message: e instanceof LlmUnavailable
      ? 'LLM 服务不可用，已切换录播模式' : `规划失败：${String(e)}` })
    throw e
  }
  // 空计划时 plan.goal 会同时渲染成计划卡标题和 final 卡，同一句话在屏幕上出现两遍。
  // 所以先判空、只发 final；有步骤时才发计划卡。
  if (!plan.steps.length) {
    // 空 steps 是规划器认定「做不了」的信号，reply 里装的是它写好的边界引导话术。
    // 兜底文案不能说「无权处理」——能力外和权限外是两回事，说错了是误导。
    o.emit({ type: 'final', text: plan.reply?.trim() || plan.goal?.trim()
      || '这个问题我暂时没有对应的数据能力。你可以问我客户、商机、订单、库存、采购或应收方面的具体情况。', refs: [] })
    return
  }
  o.emit({ type: 'plan', plan })

  // ---------- Phase 2: Executor ----------
  const messages: ChatMessage[] = [
    { role: 'system', content: executorPrompt(o.user, plan, o.history) },
    { role: 'user', content: o.question },
  ]
  const tools = toolSchemasFor(o.user.role)
  // 本角色可用的写入工具名集合。用于判断「计划里有写入步骤但模型没调用」，只在这时才补推。
  const writeToolNames = new Set(
    toolsFor(o.user.role).filter(t => t.isWrite).map(t => t.name)
  )
  let writeResolved = false
  let nudged = false
  let stepIdx = 0
  o.emit({ type: 'step_start', stepId: plan.steps[0].id })

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let res: ChatMessage
    try {
      res = await chat({ messages, tools })
    } catch (e) {
      o.emit({ type: 'error', message: `执行中断：${String(e)}` })
      throw e
    }
    messages.push(res)

    // 动态重规划：模型在正文里声明要追加步骤
    const amend = res.content?.match(/需要追加步骤[：:]\s*(.+)/)
    if (amend) {
      const added: PlanStep[] = [{
        id: `s${plan.steps.length + 1}`, title: amend[1].trim().slice(0, 60), expectedTools: [],
      }]
      plan.steps.push(...added)
      o.emit({ type: 'plan_amended', addedSteps: added, reason: amend[1].trim() })
    }

    const calls = res.tool_calls ?? []
    if (!calls.length) {
      // 实盘复现：计划里含写入步骤时，模型常用「建议你去采购 X 个」这样的文字收尾，
      // 而不去真的调用 create_purchase_order，导致确认卡与后续联动全部不发生。
      // 这里补推一次。只补一次，避免模型坚持不调用时死循环。
      const planHasWriteStep = plan.steps.some(
        s => s.expectedTools?.some(t => writeToolNames.has(t))
      )
      if (!nudged && !writeResolved && planHasWriteStep) {
        nudged = true
        messages.push({
          role: 'user',
          content: '计划中还有尚未执行的写入步骤。请直接调用对应的写入工具去完成它，不要只用文字给建议。如果你判断确实不需要执行，请明确说明原因。',
        })
        continue
      }

      // 没有工具调用 = 收尾
      for (let i = stepIdx; i < plan.steps.length; i++) {
        o.emit({ type: 'step_done', stepId: plan.steps[i].id })
      }
      const text = res.content ?? ''
      const refs = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1])
      o.emit({ type: 'final', text, refs: [...new Set(refs)] })
      return
    }

    for (const call of calls) {
      const name = call.function.name
      let args: any = {}
      try { args = JSON.parse(call.function.arguments || '{}') } catch { /* 容忍空参 */ }
      o.emit({ type: 'tool_call', id: call.id, name, args })

      const def = ALL_TOOLS.find(t => t.name === name)

      // ---------- Phase 3: HITL ----------
      const overrideNotice = def?.isWrite ? overrideNoticeFor(name, o.user.role) : null
      if (def?.isWrite) {
        const baseSummary = def.confirmSummary?.(args, ctx()) ?? `将执行写操作 ${name}`
        const summary = overrideNotice ? `${overrideNotice}\n${baseSummary}` : baseSummary
        o.emit({ type: 'confirm_request', id: call.id, toolName: name, args, summary })
        const approved = await o.requestConfirm(call.id, name, args, summary)
        o.emit({ type: 'confirm_resolved', id: call.id, approved })
        // 批准或拒绝都算「这一步已有结论」，补推只针对模型压根没调用写工具的情况。
        writeResolved = true
        if (!approved) {
          const denial = { rejected: true, reason: '用户拒绝了该写操作，请据此调整建议，不要重复尝试。' }
          o.emit({ type: 'tool_result', id: call.id, result: denial, ms: 0 })
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(denial) })
          continue
        }
      }

      const r = executeTool(name, args, ctx())
      o.pushAudit(auditOf(name, args, r, ctx(), !!overrideNotice))
      o.emit({ type: 'tool_result', id: call.id, result: r.result, ms: r.ms })
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(r.result) })
    }

    if (stepIdx < plan.steps.length) {
      o.emit({ type: 'step_done', stepId: plan.steps[stepIdx].id })
      stepIdx++
      if (stepIdx < plan.steps.length) {
        o.emit({ type: 'step_start', stepId: plan.steps[stepIdx].id })
      }
    }
  }

  o.emit({ type: 'error', message: `已达最大执行轮数 ${MAX_TURNS}，任务未完成。` })
}
