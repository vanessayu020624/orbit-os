import { describe, it, expect } from 'vitest'
import { generateSeed } from './seed'
import { simulateDeliveryRisk, buildRiskCards } from './risk'

const db = generateSeed(42)

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
})
