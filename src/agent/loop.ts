import type { AgentEvent, ClarifyRequest, Plan, ToolContext, User, Mutation, PlanStep } from '../lib/types'
import { chat, extractJson, describeLlmError, type ChatMessage } from './llm'
import { plannerPrompt, executorPrompt, type Turn } from './prompts'
import { toolSchemasFor, executeTool, auditOf, ALL_TOOLS, toolsFor } from './registry'
import { overrideNoticeFor } from '../lib/rbac'
import { resolveRef } from '../lib/refLookup'
import { fromPlanClarify, precheckAmbiguity, refineQuestion } from './clarify'
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
  /** 更早轮次折叠成的会话摘要。见 agent/summarize.ts。 */
  summary?: string
  /**
   * 澄清闸的出口。返回用户选中的口径，返回 null 表示「不选，按兜底口径继续」。
   *
   * 可选，缺省即等价于全部返回 null。这不是偷懒的默认值：服务端（飞书那条链路）
   * 天然没有「等用户点一下」这个动作，它必须能在无人应答的情况下把问题答完——
   * 答案里会明写按了哪个口径。把「不能澄清」做成一个合法状态，
   * 比要求每个调用方都实现一套交互要诚实得多。
   */
  requestClarify?: (id: string, req: ClarifyRequest) => Promise<string | null>
}

const MAX_TURNS = 12

export async function runAgent(o: RunAgentOptions): Promise<void> {
  const ctx = (): ToolContext =>
    ({ user: o.user, role: o.user.role, db: o.getDb(), mutate: o.mutate })

  // ---------- Phase 0: 澄清闸 ----------
  // 见 agent/clarify.ts 顶部的三条约束。这里只负责「最多一轮」这一条：askedClarify 一旦为真，
  // 后面无论规则还是规划器再报歧义都不再拦，一律带着兜底口径往下走。
  // 一个可以无限追问的 Agent，用户第二次就不会再用它了。
  let question = o.question
  let assumption: string | null = null
  let askedClarify = false
  let clarifySeq = 0

  async function gate(req: ClarifyRequest): Promise<void> {
    askedClarify = true
    const id = `clarify-${++clarifySeq}`
    o.emit({ type: 'clarify_request', id, req })
    const choice = o.requestClarify ? await o.requestClarify(id, req) : null
    o.emit({ type: 'clarify_resolved', id, choice })
    // 两条路都把结果折进问题本身，下游的规划器和执行器只看到一句更具体的话，
    // 不需要理解澄清协议——歧义在进入模型之前就已经消解完了。
    if (choice) {
      question = refineQuestion(question, choice)
    } else {
      // 用户不选，或运行环境压根没有澄清能力（飞书那条链路就是）：按兜底口径继续，
      // 但必须在结论里明示。静默按默认口径作答是最糟的一种处理——
      // 用户拿到一个语气笃定的答案，却不知道系统替他做了一次选择。
      assumption = req.fallback
      question = refineQuestion(question, req.fallback)
    }
  }

  // 确定性预检不花模型、不加延迟，所以放在最前面：规则能判死的就不必等规划器。
  const ruleHit = precheckAmbiguity(question, { db: o.getDb(), user: o.user, history: o.history })
  if (ruleHit) await gate(ruleHit)

  // ---------- Phase 1: Planner ----------
  async function planOnce(q: string): Promise<Plan> {
    try {
      const res = await chat({
        jsonMode: true,
        messages: [
          { role: 'system', content: plannerPrompt(o.user, o.history, o.summary, askedClarify) },
          { role: 'user', content: q },
        ],
      })
      const p = extractJson<Plan>(res.content ?? '{}')
      if (!Array.isArray(p.steps)) p.steps = []
      p.steps = p.steps.map((s, i) => ({ ...s, id: s.id || `s${i + 1}` }))
      return p
    } catch (e) {
      // 不再把 String(e) 上屏：AbortError 之类的内部报错对用户没有任何可操作性。
      // 分类文案统一由 describeLlmError 出，UI 侧再补「重试」按钮和「左侧数据仍可查」的出路。
      o.emit({ type: 'error', message: `规划阶段中断。${describeLlmError(e).text}` })
      throw e
    }
  }

  let plan = await planOnce(question)
  // 规划器的语义判定搭的是这次规划调用的顺风车，不额外增加一次往返——这正是把 clarify
  // 塞进 Plan、而不是单开一个「歧义分类器」的理由。代价是命中时要重规划一次，
  // 但那只发生在真有歧义的少数问题上，而分类器是每一个问题都要多付一次钱。
  const planHit = askedClarify ? null : fromPlanClarify(plan.clarify)
  if (planHit) {
    await gate(planHit)
    plan = await planOnce(question)
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
    { role: 'system', content: executorPrompt(o.user, plan, o.history, o.summary, assumption) },
    { role: 'user', content: question },
  ]
  const tools = toolSchemasFor(o.user.role)
  // 本角色可用的写入工具名集合。用于判断「计划里有写入步骤但模型没调用」，只在这时才补推。
  const writeToolNames = new Set(
    toolsFor(o.user.role).filter(t => t.isWrite).map(t => t.name)
  )
  // 计划里明确安排过的写入工具。用来区分「计划好的写」和「模型临时起意的写」——
  // 后者在没有任何数据依据时会被守卫 B 拦下。
  const plannedWriteTools = new Set(
    plan.steps.flatMap(s => s.expectedTools ?? []).filter(t => writeToolNames.has(t))
  )
  let writeResolved = false
  let nudged = false
  /** 真正执行成功的工具次数。0 表示这次回答到目前为止没有任何数据依据。 */
  let toolResults = 0
  /**
   * 用户拒绝过写操作。这是「零工具结果也允许收尾」的唯一合法情形——
   * 用户说了不做，模型就该回一句「已取消」，不该被守卫 A 逼着再去查一遍数据。
   */
  let userDeclined = false
  let noToolNudged = false
  let refined = false
  let stepIdx = 0
  o.emit({ type: 'step_start', stepId: plan.steps[0].id })

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let res: ChatMessage
    try {
      // 还一条数据都没查到时强制走工具。实测 qwen-plus 在多步只读计划上会直接跳过工具编造整段
      // 答案（营收、漏斗、单号全是假的），而 tool_choice: 'auto' 和提示词都拦不住。
      // 只在「零工具结果」期间强制，拿到数据后立刻放开，否则模型永远没法收尾。
      const force = toolResults === 0 && !userDeclined && tools.length > 0
      res = await chat({ messages, tools, toolChoice: force ? 'required' : 'auto' })
    } catch (e) {
      o.emit({ type: 'error', message: `执行阶段中断。${describeLlmError(e).text}` })
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
      // ---------- 守卫 A：零数据依据不许收尾 ----------
      // 实测故障：销售总监问「本月团队营收和漏斗」，执行器一个工具都没调，
      // 直接编出 1842.6 万营收、六段漏斗、八个不存在的单号，还编了一个系统里根本没有的
      // scope.basis。上面的 tool_choice: 'required' 已经在正常路径上堵死了这条路，
      // 这里是兜底：万一上游忽略了 tool_choice，也绝不让一段没有数据来源的答案发出去。
      if (toolResults === 0 && !userDeclined) {
        if (noToolNudged) {
          o.emit({ type: 'error', message: '这次问询没有取到任何数据，为避免给出没有依据的结论，已中止。请换个说法再问一次。' })
          return
        }
        noToolNudged = true
        messages.push({
          role: 'user',
          content: '你还没有调用任何工具，手上没有任何真实数据。请立刻调用工具查询，再基于返回结果作答。禁止凭常识或经验填充数字、单号、客户名。',
        })
        continue
      }

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

      const text = res.content ?? ''
      const refs = [...new Set([...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]))]

      // ---------- 守卫 C：核不上的引用当场退回重写 ----------
      // 用户点每一个标注都会跳页核对，核不到就是当场露馅。UI 侧已经把这类标注标红，
      // 但标红只是止损；这里在发出去之前先给模型一次带着「具体哪几个核不上」的重写机会。
      // 只给一次：模型如果第二次还编，说明它手上确实没有对应数据，标红比无限重试更诚实。
      const bad = refs.filter(r => resolveRef(o.getDb(), o.user, r) === null)
      if (bad.length && !refined) {
        refined = true
        messages.push({
          role: 'user',
          content: `你标注的这些编号在系统里核对不到：${bad.join('、')}。`
            + '用户点击每个标注都会跳转核对，核不到就说明是编的。'
            + '请只保留工具返回结果中原样出现过的编号，把核对不到的标注删掉或换成工具真实返回的编号，'
            + '并相应修正正文里依赖它们的结论。不要重新调用工具，直接给出修正后的最终回答。',
        })
        continue
      }

      // 没有工具调用 = 收尾
      for (let i = stepIdx; i < plan.steps.length; i++) {
        o.emit({ type: 'step_done', stepId: plan.steps[i].id })
      }
      o.emit({ type: 'final', text, refs })
      return
    }

    for (const call of calls) {
      const name = call.function.name
      let args: any = {}
      try { args = JSON.parse(call.function.arguments || '{}') } catch { /* 容忍空参 */ }
      o.emit({ type: 'tool_call', id: call.id, name, args })

      const def = ALL_TOOLS.find(t => t.name === name)

      // ---------- 守卫 B：没有任何数据依据的计划外写操作 ----------
      // 实测故障：销售总监问「未来两周交付有风险吗」，计划是两步只读，执行器却跳过读工具
      // 直接调 create_purchase_order 下单，参数里的单号和 SKU 全是编的。
      // 写操作一旦发出确认卡，用户看到的是一张长得完全正常的卡片，根本无从分辨依据真假。
      // 所以这一类调用不进 HITL，直接退回：既没查过数据、计划里也没安排，就没有执行的资格。
      // 计划里安排过的写（例如「建一个回访任务」）不受影响，读后再写也不受影响。
      if (def?.isWrite && toolResults === 0 && !plannedWriteTools.has(name)) {
        const blocked = {
          rejected: true,
          reason: '拒绝执行：你还没有调用任何只读工具核实数据，本次计划中也没有安排这个写操作。'
            + '请先查询相关订单、库存或客户数据，确认确实需要之后再调用写入工具。',
        }
        o.emit({ type: 'tool_result', id: call.id, result: blocked, ms: 0 })
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(blocked) })
        continue
      }

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
          userDeclined = true
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
      toolResults++
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
