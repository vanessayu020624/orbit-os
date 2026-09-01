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
let replies: unknown[] = []
let callIdx = 0
function script(...r: unknown[]) { replies = r; callIdx = 0 }

beforeEach(() => {
  chatMock.mockReset()
  seen.length = 0
  chatMock.mockImplementation((opts: { messages: Msg[] }) => {
    seen.push(opts.messages.map(m => ({ role: m.role, content: m.content })))
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
  it('模型用文字收尾时补推一次，chat 共 3 次，第 3 次带补推提示', async () => {
    script(WRITE_PLAN, textReply('建议向锐驰机电采购 48 台。'), textReply('确实不需要执行，理由如下。'))
    const events: AgentEvent[] = []
    await run(userNamed('王强'), events)

    expect(chatMock).toHaveBeenCalledTimes(3)
    const last = seen[2].at(-1)!
    expect(last.role).toBe('user')
    expect(last.content).toContain('尚未执行的写入步骤')
    expect(events.some(e => e.type === 'final')).toBe(true)
  })

  it('模型坚持不调用工具时只补推一次，正常收尾且不死循环', async () => {
    script(WRITE_PLAN, textReply('建议采购。'), textReply('我还是建议采购。'), textReply('依旧建议。'))
    const events: AgentEvent[] = []
    await run(userNamed('王强'), events)

    expect(chatMock.mock.calls.length).toBeLessThanOrEqual(4)
    expect(chatMock).toHaveBeenCalledTimes(3)
    expect(events.filter(e => e.type === 'final').length).toBe(1)
    // 补推提示只出现一次
    expect(seen.at(-1)!.filter(m => m.content?.includes('尚未执行的写入步骤')).length).toBe(1)
  })

  it('V2：CEO 现在也持有写工具（越权代办），同样的计划一样会被补推一次，chat 3 次', async () => {
    // 推翻 V1「CEO 零写权限」：CEO 的 writeToolNames 不再是空集，补推逻辑对 CEO 同样生效。
    script(WRITE_PLAN, textReply('建议向锐驰机电采购 48 台。'), textReply('确实不需要执行，理由如下。'))
    const events: AgentEvent[] = []
    await run(userNamed('陈立'), events)

    expect(chatMock).toHaveBeenCalledTimes(3)
    const last = seen[2].at(-1)!
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
      textReply('已创建采购单 [[PO-2026-955]]。'),
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
  })

  it('计划里没有写入步骤时，无 tool_calls 立即收尾（主路径不回归）', async () => {
    script(
      planReply([{ id: 's1', title: '查订单', expectedTools: ['query_sales_orders'] }]),
      textReply('结论：无风险。'),
    )
    const events: AgentEvent[] = []
    await run(userNamed('王强'), events)

    expect(chatMock).toHaveBeenCalledTimes(2)
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

describe('会话历史穿进 prompt（Bug 2b）', () => {
  it('history 同时出现在 planner 与 executor 的 system prompt 里', async () => {
    script(
      planReply([{ id: 's1', title: '查订单', expectedTools: ['query_sales_orders'] }]),
      textReply('结论。'),
    )
    await run(userNamed('王强'), [], {
      question: '采用处理方案1',
      history: [{ q: '未来两周要交付的订单有风险吗？', a: '方案1：向锐驰机电加急采购。' }],
    })

    expect(seen.length).toBe(2)
    for (const msgs of seen) {
      expect(msgs[0].content).toContain('最近的对话')
      expect(msgs[0].content).toContain('方案1：向锐驰机电加急采购。')
    }
  })
})
