import { describe, it, expect } from 'vitest'
import { precheckAmbiguity, refineQuestion, fromPlanClarify } from './clarify'
import { generateSeed } from '../lib/seed'
import { PRESETS_BY_ROLE } from '../sidekick/SidekickProvider'
import { buildRiskCards } from '../lib/risk'
import type { User } from '../lib/types'

const db = generateSeed(42)
const pick = (id: string): User => db.users.find(u => u.id === id)!
const ceo = pick('U-008')
const supply = pick('U-006')
const rep = pick('U-001')

const check = (q: string, user: User = ceo, history?: { q: string; a: string }[]) =>
  precheckAmbiguity(q, { db, user, history })

describe('refineQuestion', () => {
  it('把选中的口径折进问题本身，下游只面对一句话', () => {
    expect(refineQuestion('公司最大的客户是谁？', '按累计成交金额排序'))
      .toBe('公司最大的客户是谁？（口径已确认：按累计成交金额排序）')
  })
})

describe('fromPlanClarify', () => {
  it('没有 assume 就不成立——兜底口径是这个功能的前提，不是可选字段', () => {
    expect(fromPlanClarify({ reason: 'r', ask: 'a', options: ['x', 'y'], assume: '' })).toBeNull()
    expect(fromPlanClarify({ reason: 'r', ask: 'a', options: ['x'], assume: '   ' })).toBeNull()
  })

  it('ask 为空同样不成立：没有问题就没有澄清', () => {
    expect(fromPlanClarify({ reason: 'r', ask: '  ', options: ['x'], assume: 'x' })).toBeNull()
    expect(fromPlanClarify(undefined)).toBeNull()
  })

  it('选项去空、截断到 4 个，来源标成 planner', () => {
    const r = fromPlanClarify({
      reason: '', ask: '按哪个口径？',
      options: ['a', '', 'b', 'c', 'd', 'e'], assume: 'a',
    })!
    expect(r.options.map(o => o.label)).toEqual(['a', 'b', 'c', 'd'])
    expect(r.source).toBe('planner')
    expect(r.fallback).toBe('a')
    // reason 缺失时给一句兜底，而不是在卡片上留一行空白
    expect(r.reason.length).toBeGreaterThan(0)
  })

  it('选项可以为空——有些歧义系统枚举不出候选，但只要有兜底口径就仍然能问', () => {
    const r = fromPlanClarify({ reason: 'r', ask: '指哪一条？', options: [], assume: '全部' })!
    expect(r.options).toEqual([])
  })
})

describe('R1 悬空指代', () => {
  it('第一句话就说「那个客户」，没有上文可以对齐 → 拦', () => {
    const r = check('那个客户的应收还有多少没回款？')!
    expect(r).not.toBeNull()
    expect(r.source).toBe('rule')
    // 枚举不出候选，所以不给选项，让用户直接说名字——不拿空反问占位
    expect(r.options).toEqual([])
    expect(r.fallback).toBeTruthy()
  })

  it('有上文时同一句话不拦：那是正常追问，拦掉等于逼用户把上一句重说一遍', () => {
    expect(check('那个客户的应收还有多少没回款？', ceo,
      [{ q: '华宁自动化的订单情况', a: '共 3 张订单…' }])).toBeNull()
  })

  it('「缺口最大的那个 SKU」不算悬空：指代对象已被前半句限定死', () => {
    expect(check('帮我把缺口最大的那个 SKU 的库存预留出来', supply)).toBeNull()
  })

  it('「这个月」不是指代，是时间锚点', () => {
    expect(check('我这个月的商机漏斗情况怎么样？', rep)).toBeNull()
  })
})

describe('R2 一个词同时像好几条记录', () => {
  it('「传感器」在种子数据里有十几种 → 拦，并列出候选', () => {
    const r = check('传感器的库存够不够？', supply)!
    expect(r).not.toBeNull()
    expect(r.options.length).toBeGreaterThan(1)
    expect(r.options.every(o => o.label.includes('传感器'))).toBe(true)
    // 选项最多列 4 个，但理由里报的是真实条数
    expect(r.options.length).toBeLessThanOrEqual(4)
  })

  it('用户已经把全名说全了就不拦——「自动化」虽然同时命中好几家客户，但他说的是华宁自动化', () => {
    expect(check('帮我给华宁自动化建一个下周的回访任务', rep)).toBeNull()
  })

  it('一句话里点了两类东西 → 不拦：那是有意要一批，不是指代不清', () => {
    expect(check('传感器和伺服电机的库存分别是多少？', supply)).toBeNull()
  })
})

describe('R3 模糊时间窗', () => {
  it('「最近」没有锚点 → 拦，给出三个具体窗口', () => {
    const r = check('最近的订单交付情况怎么样？')!
    expect(r.options.map(o => o.label)).toEqual(['最近 7 天', '最近 14 天', '最近 30 天'])
  })

  it('说了具体天数就不拦', () => {
    expect(check('最近 30 天的订单交付情况怎么样？')).toBeNull()
  })

  it('「本月」也是具体锚点', () => {
    expect(check('最近本月的订单交付情况怎么样？')).toBeNull()
  })
})

describe('R4 「最大的客户」的三种口径', () => {
  it('拦，并给出三个真的能查出结果的口径', () => {
    const r = check('公司最大的客户是谁？')!
    expect(r.options).toHaveLength(3)
    expect(r.fallback).toContain('累计成交金额')
  })

  it('「缺口最大的 SKU」不拦：那有唯一口径，不是三个不同的问题', () => {
    expect(check('缺口最大的 SKU 是哪个？', supply)).toBeNull()
  })
})

/**
 * 这一组是整个澄清闸最重要的回归。
 *
 * 澄清闸的失败模式不是「漏问」，是「乱问」——一个动不动就反问的 Agent，用户第二次
 * 就不会再用它了。内置引导问题和风险卡问题是演示时一定会被点到的那十几句话，
 * 它们里面唯一一个真有歧义的是「公司最大的客户是谁」（成交额 / 应收 / 体量是三份名单），
 * 那一条拦下来是对的。除此之外**一句都不许拦**。
 */
describe('内置问题不许被误拦', () => {
  const users: Record<string, User> = {
    sales_rep: rep, sales_director: pick('U-004'), supply_chain: supply, ceo,
  }
  // 这两条预置问题是**刻意**留着触发澄清闸的演示素材，不是漏网的误拦：
  // 「最大的客户」有三种口径排出三份名单，「伺服电机」在库里有 11 个 SKU。
  const deliberate = new Set(['公司最大的客户是谁？', '伺服电机还有多少库存？'])

  for (const [role, qs] of Object.entries(PRESETS_BY_ROLE)) {
    for (const q of qs) {
      it(`${role}：${q}`, () => {
        const hit = check(q, users[role])
        if (deliberate.has(q)) expect(hit).not.toBeNull()
        else expect(hit).toBeNull()
      })
    }
  }

  for (const u of [rep, supply, ceo]) {
    for (const card of buildRiskCards(db, u)) {
      it(`风险卡（${u.role}）：${card.question}`, () => {
        expect(check(card.question, u)).toBeNull()
      })
    }
  }
})
