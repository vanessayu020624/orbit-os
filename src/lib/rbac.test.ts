import { describe, it, expect } from 'vitest'
import { generateSeed } from './seed'
import { scopeCustomers, scopeOrders, scopeOpportunities, maskOrderForRole } from './rbac'

const db = generateSeed(42)
const u = (n: string) => db.users.find(x => x.name === n)!

describe('数据级权限', () => {
  it('销售代表只看到自己的 9 个客户', () => {
    const r = scopeCustomers(db, u('张伟'))
    expect(r.length).toBe(9)
    expect(r.every(c => c.ownerId === 'U-001')).toBe(true)
  })
  it('销售代表看不到全公司最大客户', () => {
    const r = scopeCustomers(db, u('张伟'))
    expect(Math.max(...r.map(c => c.annualRevenue))).toBe(860000)
  })
  it('CEO 看到全部 48 个客户', () => {
    expect(scopeCustomers(db, u('陈立')).length).toBe(48)
  })
  it('供应链主管无客户与商机权限', () => {
    expect(scopeCustomers(db, u('王强')).length).toBe(0)
    expect(scopeOpportunities(db, u('王强')).length).toBe(0)
  })
  it('销售总监看到本团队而非全公司', () => {
    const r = scopeOrders(db, u('李娜'))
    expect(r.length).toBeGreaterThan(0)
    expect(r.length).toBeLessThan(db.orders.length)
  })
})

describe('字段脱敏', () => {
  it('供应链主管看到的订单金额是 ***，SKU 与数量保留', () => {
    const o = db.orders.find(x => x.orderNo === 'SO-2026-0412')!
    const m = maskOrderForRole(o, 'supply_chain') as any
    expect(m.totalAmount).toBe('***')
    expect(m.items[0].unitPrice).toBe('***')
    expect(m.items[0].qty).toBe(40)
  })
  it('其他角色不脱敏', () => {
    const o = db.orders.find(x => x.orderNo === 'SO-2026-0412')!
    expect((maskOrderForRole(o, 'ceo') as any).totalAmount).toBe(o.totalAmount)
  })
})
