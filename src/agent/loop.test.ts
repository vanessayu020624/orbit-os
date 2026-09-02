import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSeed } from '../lib/seed'
import type { AgentEvent, User } from '../lib/types'

// loop.ts 直接 import 了 chat，只能在模块层拦。vi.hoisted 保证 mock 工厂能拿到这个 fn。
const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }))
vi.mock('./llm', async () => {
  const actual = await vi.importActual<typeof import('./llm')>('./llm')
  return { ...actual, chat: (...args: unknown[]) => chatMock(...args) }
})

import { runAgent, type RunAgentOptions } from './loop'

const db = generateSeed(42)
const userNamed = (name: string): User => db.users.find(u => u.name === name)!

interface Msg { role: string; content: string | null }
/** 记录每次 chat 调用时 messages 的快照——loop 内部复用同一个数组，不拷贝就读不到当时的状态。 */
const seen: Msg[][] = []
/** 每次 chat 调用传的 tool_choice。守卫 A 的强制走工具就体现在这里。 */
const choices: (string | undefined)[] = []
let replies: unknown[] = []
let callIdx = 0
function script(...r: unknown[]) { replies = r; callIdx = 0 }

beforeEach(() => {
  chatMock.mockReset()
  seen.length = 0
  choices.length = 0
  chatMock.mockImplementation((opts: { messages: Msg[]; toolChoice?: string }) => {
    seen.push(opts.messages.map(m => ({ role: m.role, content: m.content })))
    choices.push(opts.toolChoice)
    return Promise.resolve(replies[Math.min(callIdx++, replies.length - 1)])
  })
})

function planReply(steps: { id: string; title: string; expectedTools: string[] }[]) {
  return {
    role: 'assistant',
    content: JSON.stringify({ goal: '测试目标', needsWrite: false, steps }),
  }
}
const textReply = (text: string) => ({ role: 'assistant', content: text })
const toolReply = (name: string, args: unknown, id = 'c1') => ({
  role: 'assistant', content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
})
/**
 * 一次真实的只读调用。四个角色都能用 query_sales_orders。
 * 大量用例都要先垫这一步：守卫 A 规定「一条数据都没查到就不许收尾」，
 * 所以「模型用文字收尾」这类场景必须先真的查过一次，否则测的是守卫 A 而不是被测逻辑。
 */
const READ = toolReply('query_sales_orders', { status: '待发货' }, 'r1')

/** 带写入步骤的两步计划：第 2 步指向 create_purchase_order。 */
const WRITE_PLAN = planReply([
  { id: 's1', title: '查询 SKU-203 的可选供应商', expectedTools: ['get_supplier_options'] },
  { id: 's2', title: '为缺口创建采购单', expectedTools: ['create_purchase_order'] },
])

function run(user: User, events: AgentEvent[], extra: Partial<RunAgentOptions> = {}) {
  return runAgent({
    question: '未来两周要交付的订单有风险吗？帮我排查并给出处理方案。',
    user,
    getDb: () => db,
    mutate: () => {},
    emit: (e) => { events.push(e) },
    pushAudit: () => {},
    requestConfirm: async () => true,
    ...extra,
  })
}

const hasNudge = (msgs: Msg[]) => msgs.some(m => m.content?.includes('尚未执行的写入步骤'))

describe('写入步骤补推（Bug 1b）', () => {
  it('模型用文字收尾时补推一次，chat 共 4 次，第 4 次带补推提示', async () => {
    script(WRITE_PLAN, READ, textReply('建议向锐驰机电采购 48 台。'), textReply('确实不需要执行，理由如下。'))
    const events: AgentEvent[] = []
    await run(userNamed('王强'), events)

    expect(chatMock).toHaveBeenCalledTimes(4)
    const last = seen[3].at(-1)!
    expect(last.role).toBe('user')
    expect(last.content).toContain('尚未执行的写入步骤')
    expect(events.some(e => e.type === 'final')).toBe(true)
  })

  it('模型坚持不调用工具时只补推一次，正常收尾且不死循环', async () => {
    script(WRITE_PLAN, READ, textReply('建议采购。'), textReply('我还是建议采购。'), textReply('依旧建议。'))
    const events: AgentEvent[] = []
    await run(userNamed('王强'), events)

    expect(chatMock.mock.calls.length).toBeLessThanOrEqual(5)
    expect(chatMock).toHaveBeenCalledTimes(4)
    expect(events.filter(e => e.type === 'final').length).toBe(1)
    // 补推提示只出现一次
    expect(seen.at(-1)!.filter(m => m.content?.includes('尚未执行的写入步骤')).length).toBe(1)
  })

  it('V2：CEO 现在也持有写工具（越权代办），同样的计划一样会被补推一次，chat 4 次', async () => {
    // 推翻 V1「CEO 零写权限」：CEO 的 writeToolNames 不再是空集，补推逻辑对 CEO 同样生效。
    script(WRITE_PLAN, READ, textReply('建议向锐驰机电采购 48 台。'), textReply('确实不需要执行，理由如下。'))
    const events: AgentEvent[] = []
    await run(userNamed('陈立'), events)

    expect(chatMock).toHaveBeenCalledTimes(4)
    const last = seen[3].at(-1)!
    expect(last.role).toBe('user')
    expect(last.content).toContain('尚未执行的写入步骤')
    expect(events.some(e => e.type === 'final')).toBe(true)
  })

  it('真的执行过写工具之后模型收尾，不补推', async () => {
    script(
      WRITE_PLAN,
      {
        role: 'assistant', content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: {
          name: 'create_purchase_order',
          arguments: JSON.stringify({ supplierName: '锐驰机电', sku: 'SKU-203', qty: 48, expedited: true }),
        } }],
      },
      textReply('已创建采购单，等待供应商确认。'),
    )
    const events: AgentEvent[] = []
    await run(userNamed('王强'), events)

    expect(chatMock).toHaveBeenCalledTimes(3)
    expect(seen.some(hasNudge)).toBe(false)
    expect(events.some(e => e.type === 'confirm_request')).toBe(true)
  })

  it('用户拒绝写操作后不再补推（不会弹出第二张确认卡）', async () => {
    script(
      WRITE_PLAN,
      {
        role: 'assistant', content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: {
          name: 'create_purchase_order',
          arguments: JSON.stringify({ supplierName: '锐驰机电', sku: 'SKU-203', qty: 48, expedited: true }),
        } }],
      },
      textReply('好的，已了解，不再重试。'),
    )
    const events: AgentEvent[] = []
    await run(userNamed('王强'), events, { requestConfirm: async () => false })

    expect(chatMock).toHaveBeenCalledTimes(3)
    expect(events.filter(e => e.type === 'confirm_request').length).toBe(1)
    expect(seen.at(-1)!.some(m => m.content?.includes('尚未执行的写入步骤'))).toBe(false)
    // 用户拒绝时一条数据都没查到，但这是守卫 A 唯一允许的零依据收尾：
    // 用户说了不做，模型就该回一句「已取消」，不该被逼着再去查一遍。
    expect(events.some(e => e.type === 'final')).toBe(true)
  })

  it('计划里没有写入步骤时，查完就收尾（主路径不回归）', async () => {
    script(
      planReply([{ id: 's1', title: '查订单', expectedTools: ['query_sales_orders'] }]),
      READ,
      textReply('结论：无风险。'),
    )
    const events: AgentEvent[] = []
    await run(userNamed('王强'), events)

    expect(chatMock).toHaveBeenCalledTimes(3)
    expect(seen.some(hasNudge)).toBe(false)
    expect(events.at(-1)!.type).toBe('final')
  })
})

describe('空计划只发一张卡（Bug 2d）', () => {
  it('steps 为空时不发 plan 事件，只发 final', async () => {
    script(planReply([]))
    const events: AgentEvent[] = []
    await run(userNamed('王强'), events)

    expect(events.some(e => e.type === 'plan')).toBe(false)
    expect(events.length).toBe(1)
    expect(events[0].type).toBe('final')
  })
})

describe('能力边界引导：空计划走 reply 而不是 goal', () => {
  const rawPlan = (o: Record<string, unknown>) =>
    ({ role: 'assistant', content: JSON.stringify({ needsWrite: false, steps: [], ...o }) })

  it('有 reply 时展示 reply——goal 是计划卡标题，不该被当成对话正文', async () => {
    script(rawPlan({ goal: '分析A区上月销售额下滑原因', reply: '这类归因我做不了，但我能帮你查…' }))
    const events: AgentEvent[] = []
    await run(userNamed('张伟'), events)
    const final = events.find(e => e.type === 'final')!
    // 关键回归点：goal 复述了问题，直接展示等于答非所问。
    expect(final).toMatchObject({ text: '这类归因我做不了，但我能帮你查…' })
  })

  it('模型漏了 reply 时退回 goal，不能因为字段缺失就吐兜底话术', async () => {
    script(rawPlan({ goal: '当前角色无权查看应收账款，请联系销售总监。' }))
    const events: AgentEvent[] = []
    await run(userNamed('张伟'), events)
    expect(events.find(e => e.type === 'final')).toMatchObject(
      { text: '当前角色无权查看应收账款，请联系销售总监。' })
  })

  it('reply 与 goal 都空时兜底，且兜底文案不得把能力外说成权限外', async () => {
    script(rawPlan({ goal: '', reply: '   ' }))
    const events: AgentEvent[] = []
    await run(userNamed('张伟'), events)
    const final = events.find(e => e.type === 'final') as { text: string }
    expect(final.text).not.toContain('无权')
    expect(final.text).toContain('你可以问我')
  })
})

describe('会话历史穿进 prompt（Bug 2b）', () => {
  it('history 同时出现在 planner 与 executor 的 system prompt 里', async () => {
    script(
      planReply([{ id: 's1', title: '查订单', expectedTools: ['query_sales_orders'] }]),
      READ,
      textReply('结论。'),
    )
    await run(userNamed('王强'), [], {
      question: '采用处理方案1',
      history: [{ q: '未来两周要交付的订单有风险吗？', a: '方案1：向锐驰机电加急采购。' }],
    })

    expect(seen.length).toBe(3)
    for (const msgs of seen) {
      expect(msgs[0].content).toContain('最近的对话')
      expect(msgs[0].content).toContain('方案1：向锐驰机电加急采购。')
    }
  })
})

const READ_ONLY_PLAN = planReply([
  { id: 's1', title: '筛选未来两周待发货订单', expectedTools: ['query_sales_orders'] },
  { id: 's2', title: '逐单测算缺口与延期', expectedTools: ['simulate_delivery_risk'] },
])

/**
 * 实测到的最严重一类故障：执行器一个工具都不调，凭空编出整段答案。
 * 销售总监问「本月团队营收和漏斗」，它编出 1842.6 万营收、六段漏斗、八个不存在的单号；
 * 问「未来两周交付有风险吗」，它跳过两步只读计划直接下采购单，参数里的单号和 SKU 全是假的。
 * 这三道守卫就是为此而设，每一道都必须有回归用例压着。
 */
describe('反编造守卫', () => {
  describe('守卫 A：零数据依据不许收尾', () => {
    it('第一轮强制 tool_choice=required，拿到数据后立刻放开', async () => {
      script(READ_ONLY_PLAN, READ, textReply('结论：无风险。'))
      await run(userNamed('李娜'), [])

      // choices[0] 是规划器（不带 tools）。执行器第一轮强制，第二轮已有数据故放开。
      expect(choices[1]).toBe('required')
      expect(choices[2]).toBe('auto')
    })

    it('一个工具都没调就想收尾时补推一次，仍不调则中止且不发 final', async () => {
      script(READ_ONLY_PLAN, textReply('本月营收 1842.6 万元。'), textReply('我确认就是 1842.6 万元。'))
      const events: AgentEvent[] = []
      await run(userNamed('李娜'), events)

      expect(chatMock).toHaveBeenCalledTimes(3)
      expect(seen[2].at(-1)!.content).toContain('还没有调用任何工具')
      // 关键断言：宁可报错也不能把没有数据来源的结论发出去。
      expect(events.some(e => e.type === 'final')).toBe(false)
      expect(events.at(-1)).toMatchObject({ type: 'error' })
    })
  })

  describe('守卫 B：没有数据依据的计划外写操作', () => {
    it('零数据时调用计划外的写工具被直接退回，不弹确认卡', async () => {
      script(
        READ_ONLY_PLAN,
        toolReply('create_purchase_order',
          { supplierName: '锐驰机电', sku: 'SKU-309', qty: 8, expedited: true }),
        textReply('好的，我先查数据。'),
      )
      const events: AgentEvent[] = []
      await run(userNamed('王强'), events)

      // 确认卡长得完全正常，用户根本无从分辨参数里的单号是不是编的——所以不能让它弹出来。
      expect(events.some(e => e.type === 'confirm_request')).toBe(false)
      const res = events.find(e => e.type === 'tool_result') as { result: { rejected: boolean } }
      expect(res.result.rejected).toBe(true)
      expect(events.some(e => e.type === 'final')).toBe(false)
    })

    it('计划里安排过的写工具不受影响（零数据也放行）', async () => {
      script(
        planReply([{ id: 's1', title: '建回访任务', expectedTools: ['create_followup_task'] }]),
        toolReply('create_followup_task',
          { assigneeName: '张伟', title: '回访华宁自动化', dueDate: '2026-09-09' }),
        textReply('任务已建。'),
      )
      const events: AgentEvent[] = []
      await run(userNamed('张伟'), events)

      expect(events.some(e => e.type === 'confirm_request')).toBe(true)
    })
  })

  describe('守卫 C：核不上的引用退回重写', () => {
    const realOrderNo = db.orders[0].orderNo

    it('引用核不上时带着具体编号退回重写一次', async () => {
      script(
        READ_ONLY_PLAN, READ,
        textReply(`风险订单：[[SO-2026-9999]]。`),
        textReply(`风险订单：[[${realOrderNo}]]。`),
      )
      const events: AgentEvent[] = []
      await run(userNamed('王强'), events)

      expect(chatMock).toHaveBeenCalledTimes(4)
      expect(seen[3].at(-1)!.content).toContain('SO-2026-9999')
      expect(events.find(e => e.type === 'final')).toMatchObject({ refs: [realOrderNo] })
    })

    it('重写后仍核不上就照发，交给界面标红，不无限重试', async () => {
      script(READ_ONLY_PLAN, READ, textReply('见 [[SO-2026-9999]]。'), textReply('还是 [[SO-2026-8888]]。'))
      const events: AgentEvent[] = []
      await run(userNamed('王强'), events)

      expect(chatMock).toHaveBeenCalledTimes(4)
      expect(events.find(e => e.type === 'final')).toMatchObject({ refs: ['SO-2026-8888'] })
    })

    it('引用全部核得上时一次通过，不多跑一轮', async () => {
      script(READ_ONLY_PLAN, READ, textReply(`风险订单：[[${realOrderNo}]]。`))
      const events: AgentEvent[] = []
      await run(userNamed('王强'), events)

      expect(chatMock).toHaveBeenCalledTimes(3)
      expect(events.find(e => e.type === 'final')).toMatchObject({ refs: [realOrderNo] })
    })
  })
})
