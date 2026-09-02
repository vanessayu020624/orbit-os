import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSeed } from '../lib/seed'
import type { AgentEvent, User } from '../lib/types'
import { TODAY } from '../lib/types'
import { runReplay, REPLAY } from './replay'
import { executeTool } from './registry'

const db = generateSeed(42)
const userNamed = (name: string): User => db.users.find(u => u.name === name)!

beforeEach(() => {
  vi.useFakeTimers()
})

function run(scenario: 'delivery' | 'permission', user: User, requestConfirm: (id: string, n: string, a: unknown, s: string) => Promise<boolean>) {
  const events: AgentEvent[] = []
  const p = runReplay(scenario, user, (e) => events.push(e), requestConfirm)
  return { p, events }
}

describe('录播模式按角色门禁（Bug F3）', () => {
  it('供应链主管跑 delivery 会 emit confirm_request', async () => {
    const { p, events } = run('delivery', userNamed('王强'), async () => true)
    await vi.runAllTimersAsync()
    await p
    expect(events.some(e => e.type === 'confirm_request')).toBe(true)
  })

  it('CEO 跑 delivery 只 emit 一条 error，requestConfirm 从未被调用', async () => {
    const confirmCalls = vi.fn(async () => true)
    const { p, events } = run('delivery', userNamed('陈立'), confirmCalls)
    await vi.runAllTimersAsync()
    await p
    expect(events.length).toBe(1)
    expect(events[0].type).toBe('error')
    expect(confirmCalls).toHaveBeenCalledTimes(0)
  })

  it('销售代表跑 permission 正常播放', async () => {
    const { p, events } = run('permission', userNamed('张伟'), async () => true)
    await vi.runAllTimersAsync()
    await p
    expect(events.some(e => e.type === 'final')).toBe(true)
    expect(events.some(e => e.type === 'error')).toBe(false)
  })
})

/**
 * 录播里的每个数字都是手写的。手写值一旦和种子库算出来的真值分叉，
 * 演示现场就会出现「Agent 说缺口 48，库存页显示别的数」——这种口径不一致
 * 比功能缺失更致命，而且只在被追问时才暴露。这里让种子库自己去核对录播稿。
 */
describe('录播数字必须与真实数据库对得上', () => {
  const sc = db.users.find(u => u.role === 'supply_chain')!
  const ctx = { user: sc, role: sc.role, db, mutate: () => {} }
  const evOf = (t: string, id?: string) => REPLAY.delivery
    .map(x => x.event).find(e => e.type === t && (!id || (e as { id?: string }).id === id))!

  it('交付风险的 7 条结果与 simulate_delivery_risk 在种子库上的实际输出逐字段一致', () => {
    const real = executeTool('simulate_delivery_risk', { windowDays: 14 }, ctx as never).result as
      { count: number; risks: unknown[] }
    const taped = (evOf('tool_result', 't1') as { result: { count: number; risks: unknown[] } }).result
    expect(taped.count).toBe(real.count)
    expect(taped.risks).toEqual(real.risks)
  })

  it('供应商报价与 get_supplier_options 的实际输出一致（单价 12320 = 成本 11000 × 1.12）', () => {
    const real = executeTool('get_supplier_options', { sku: 'SKU-203' }, ctx as never).result as
      { suppliers: unknown[] }
    const taped = (evOf('tool_result', 't2') as { result: { suppliers: unknown[] } }).result
    expect(taped.suppliers).toEqual(real.suppliers)
  })

  /** 批准后的结论文本不在 REPLAY.delivery 里，只能把整段录播真跑一遍才拿得到。 */
  async function finalText(): Promise<string> {
    const { p, events } = run('delivery', userNamed('王强'), async () => true)
    await vi.runAllTimersAsync()
    await p
    return (events.find(e => e.type === 'final') as { text: string }).text
  }

  it('结论里写死的「缺口 48 台」等于两张风险订单缺口之和，不是拍出来的数', async () => {
    const real = executeTool('simulate_delivery_risk', { windowDays: 14 }, ctx as never).result as
      { risks: { shortages: { gap: number }[] }[] }
    const gap = real.risks.flatMap(r => r.shortages).reduce((a, s) => a + s.gap, 0)
    expect(gap).toBe(48)
    expect(await finalText()).toContain('合计缺口 48 台')
  })

  it('结论里的「在途最早到货 2026-09-16」确实是种子库中 P-003 最早到货的未入库采购单', async () => {
    const earliest = db.purchaseOrders
      .filter(p => p.status !== '已入库' && p.items.some(l => l.skuId === 'P-003'))
      .map(p => p.eta).sort()[0]
    expect(earliest).toBe('2026-09-16')
    expect(await finalText()).toContain('最早到货 2026-09-16')
  })

  it('加急采购单的到货日 2026-09-07 = 今天 + (锐驰机电 7 天 - 加急 2 天)，与成本 ¥591,360 自洽', async () => {
    const s2 = db.suppliers.find(x => x.id === 'SUP-2')!
    const eta = new Date(Date.parse(TODAY) + Math.max(1, s2.leadTimeDays - 2) * 86400000)
      .toISOString().slice(0, 10)
    expect(eta).toBe('2026-09-07')
    const cost = Math.round(db.products.find(x => x.id === 'P-003')!.cost * s2.priceFactor) * 48
    expect(cost).toBe(591360)
    const t = await finalText()
    expect(t).toContain('2026-09-07')
    expect(t).toContain('48 台')
  })
})
