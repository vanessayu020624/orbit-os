import { describe, it, expect } from 'vitest'
import { generateSeed } from '../lib/seed'
import { plannerPrompt, executorPrompt } from './prompts'
import type { Plan } from '../lib/types'
import { restrictedCatalogText } from './registry'

const db = generateSeed(42)
const wangQiang = db.users.find(u => u.name === '王强')!

const PLAN: Plan = {
  goal: '排查交期风险',
  needsWrite: true,
  steps: [{ id: 's1', title: '测算交付风险', expectedTools: ['simulate_delivery_risk'] }],
}

describe('会话历史注入（Bug 2a）', () => {
  it('plannerPrompt 传入 history 后含上一轮问答原文', () => {
    const p = plannerPrompt(wangQiang, [{ q: '甲', a: '乙' }])
    expect(p).toContain('最近的对话')
    expect(p).toContain('甲')
    expect(p).toContain('乙')
  })
  it('plannerPrompt 不传 history 时不含「最近的对话」', () => {
    expect(plannerPrompt(wangQiang)).not.toContain('最近的对话')
    expect(plannerPrompt(wangQiang, [])).not.toContain('最近的对话')
  })
  it('executorPrompt 同样支持 history', () => {
    expect(executorPrompt(wangQiang, PLAN, [{ q: '甲', a: '乙' }])).toContain('最近的对话')
    expect(executorPrompt(wangQiang, PLAN)).not.toContain('最近的对话')
  })
  it('单轮答案截断到 800 字，不会把整段长回答塞进上下文', () => {
    // 600 → 800：保留轮数从 2 提到 6 之后，带单号清单的长回答（dir-1 那种十几条应收）
    // 在 600 字处正好会被从中间切断，追问「第三条那个客户」时指代就断了。
    const long = '啊'.repeat(1000)
    const p = plannerPrompt(wangQiang, [{ q: '甲', a: long }])
    expect(p).toContain('啊'.repeat(800))
    expect(p).not.toContain('啊'.repeat(801))
  })

  it('summary 单独成段，且标注它是背景而非数据来源', () => {
    const p = plannerPrompt(wangQiang, [{ q: '甲', a: '乙' }], '用户此前关注华宁自动化的交付风险。')
    expect(p).toContain('更早的对话摘要')
    expect(p).toContain('用户此前关注华宁自动化的交付风险。')
    // 摘要是二手转述，从里面摘编号当数据来源正是「引用核不上」的来源之一。
    expect(p).toContain('不要从这里摘编号当作数据来源')
  })

  it('只有 summary 没有 history 时也照样注入', () => {
    const p = executorPrompt(wangQiang, PLAN, [], '早前聊过 SKU-203 的缺口。')
    expect(p).toContain('早前聊过 SKU-203 的缺口。')
    expect(p).not.toContain('最近的对话')
  })
})

describe('追问与写操作的提示词硬约束（Bug 1a / 2a）', () => {
  it('planner 明确要求不要对追问输出空 steps', () => {
    expect(plannerPrompt(wangQiang)).toContain('不要输出空 steps 要求用户澄清')
  })
  it('executor 要求写操作必须真的调用工具，且不再诱导以「建议」收尾', () => {
    const p = executorPrompt(wangQiang, PLAN)
    expect(p).toContain('写操作必须真的执行')
    expect(p).toContain('create_purchase_order')
    expect(p).not.toContain('最后给 1 到 2 条可执行建议')
  })
})

describe('能力边界与权限边界必须能被区分', () => {
  const rep = db.users.find(u => u.role === 'sales_rep')!

  it('规划器提示词里同时给出「我能做的」和「系统有但我无权的」', () => {
    const p = plannerPrompt(rep)
    // 只喂本角色工具时，模型会把「你无权」说成「系统不支持」——实测复现过。
    expect(p).toContain('query_sales_orders')
    expect(p).toContain('query_receivables')
    expect(p).toContain('销售总监')
  })

  it('无权清单不把本角色已有的工具列进去', () => {
    const r = restrictedCatalogText('sales_rep')
    expect(r).not.toContain('query_sales_orders:')
    expect(r).toContain('query_receivables:')
  })

  it('CEO 拥有全部能力，无权清单为空态而不是半截列表', () => {
    expect(restrictedCatalogText('ceo')).toContain('无')
    expect(restrictedCatalogText('ceo')).not.toContain('- ')
  })
})
