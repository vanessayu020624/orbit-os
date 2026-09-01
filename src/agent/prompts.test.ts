import { describe, it, expect } from 'vitest'
import { generateSeed } from '../lib/seed'
import { plannerPrompt, executorPrompt } from './prompts'
import type { Plan } from '../lib/types'

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
  it('单轮答案截断到 600 字，不会把整段长回答塞进上下文', () => {
    const long = '啊'.repeat(1000)
    const p = plannerPrompt(wangQiang, [{ q: '甲', a: long }])
    expect(p).toContain('啊'.repeat(600))
    expect(p).not.toContain('啊'.repeat(601))
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
