import { describe, it, expect } from 'vitest'
import { generateSeed } from './seed'
import { simulateDeliveryRisk, buildRiskCards } from './risk'
import { scopeCustomers, scopeReceivables } from './rbac'
import type { DbSnapshot } from './types'

const db = generateSeed(42)
const wangQiang = db.users.find(u => u.name === '王强')!

describe('交期风险测算', () => {
  const ids = ['SO-2026-0412', 'SO-2026-0428', 'SO-2026-0435']
  const r = simulateDeliveryRisk(db, ids)

  it('按交期升序累积扣减，缺口合计 48 台', () => {
    expect(r.map(x => x.orderNo)).toEqual(ids)
    // 库存 42：0412 需 40 → 无缺口，余 2；0428 需 30 → 缺 28；0435 需 20 → 缺 20
    expect(r[0].shortages.length).toBe(0)
    expect(r[1].shortages[0].gap).toBe(28)
    expect(r[2].shortages[0].gap).toBe(20)
    expect(r[1].shortages[0].gap + r[2].shortages[0].gap).toBe(48)
  })

  it('缺口订单标记为 high 且晚 5 天以上', () => {
    expect(r[1].riskLevel).toBe('high')
    expect(r[1].incomingEta).toBe('2026-09-16')
    expect(r[1].daysLate).toBe(6)   // 09-16 减 09-10
    expect(r[2].daysLate).toBe(5)   // 09-16 减 09-11
  })
})

describe('主动风险卡', () => {
  it('供应链主管首页有交期风险卡', () => {
    const wq = db.users.find(u => u.name === '王强')!
    const cards = buildRiskCards(db, wq)
    expect(cards.some(c => c.id === 'RC-delivery')).toBe(true)
  })
  it('CEO 额外看到应收逾期卡', () => {
    const ceo = db.users.find(u => u.name === '陈立')!
    expect(buildRiskCards(db, ceo).some(c => c.id === 'RC-ar')).toBe(true)
  })
  it('销售总监的应收逾期风险卡做了团队隔离', () => {
    const lina = db.users.find(u => u.name === '李娜')!
    const customerIds = new Set(scopeCustomers(db, lina).map(c => c.id))
    const overdue = scopeReceivables(db, lina).filter(r => r.status === '已逾期' && r.dueDate < '2026-07-04')
    expect(overdue.length).toBeGreaterThan(0)
    expect(overdue.every(r => customerIds.has(r.customerId))).toBe(true)
    const arCard = buildRiskCards(db, lina).find(c => c.id === 'RC-ar')!
    expect(arCard.title).toBe(`${overdue.length} 笔应收逾期超 60 天`)
  })
})

describe('风险横幅区分常规到货与加急到货', () => {
  it('没有加急单时只说常规到货日', () => {
    const card = buildRiskCards(db, wangQiang).find(c => c.id === 'RC-delivery')!
    expect(card.detail).toContain('当前最早可到货')
    expect(card.detail).not.toContain('加急采购')
  })

  // 注意加急到货日必须仍然晚于交期。早于交期时风险直接降级、整张卡消失，
  // 那是正确的闭环行为（Agent 下完单风险就没了），不是这条用例要测的东西。
  it('存在加急在途单时，括号里单独交代它——那是 Agent 动作留下的痕迹', () => {
    const withExpedited: DbSnapshot = structuredClone(db)
    const target = buildRiskCards(db, wangQiang).find(c => c.id === 'RC-delivery')!
    const sku = withExpedited.products.find(p => target.detail.startsWith(p.sku))!
    withExpedited.purchaseOrders.unshift({
      id: 'PO-X', poNo: 'PO-2026-9001', supplierId: withExpedited.suppliers[0].id,
      status: '在途', eta: '2026-09-14', expedited: true, createdBy: wangQiang.id,
      items: [{ skuId: sku.id, qty: 1, unitCost: 100 }], totalCost: 100,
    })
    const card = buildRiskCards(withExpedited, wangQiang).find(c => c.id === 'RC-delivery')!
    expect(card.detail).toContain('（加急采购 2026-09-14 到货中）')
    // 关键：常规到货日不能被加急单顶掉，否则用户看到的还是一个自己变了的数字。
    expect(card.detail).toContain(`当前最早可到货 ${target.detail.match(/可到货 (\d{4}-\d{2}-\d{2})/)![1]}`)
  })
})
