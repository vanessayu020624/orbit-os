import { describe, it, expect } from 'vitest'
import { generateSeed } from './seed'
import {
  scopeCustomers, scopeOrders, scopeOpportunities, scopeReceivables, maskOrderForRole,
  canSeeCustomerFinancials, overrideNoticeFor,
} from './rbac'

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
  it('供应链主管可见全部 48 个客户（需要知道货发给谁），但无商机权限', () => {
    // V2 修订：推翻 V1「供应链看不到客户」——他要发 160 张订单的货，得知道发给谁才能排优先级。
    expect(scopeCustomers(db, u('王强')).length).toBe(48)
    expect(scopeOpportunities(db, u('王强')).length).toBe(0)
  })
  it('销售总监看到本团队而非全公司', () => {
    const r = scopeOrders(db, u('李娜'))
    expect(r.length).toBeGreaterThan(0)
    expect(r.length).toBeLessThan(db.orders.length)
  })
})

describe('应收账款团队隔离', () => {
  it('销售总监拿到的应收，其 customerId 全部落在 scopeCustomers 的结果里', () => {
    const custIds = new Set(scopeCustomers(db, u('李娜')).map(c => c.id))
    const r = scopeReceivables(db, u('李娜'))
    expect(r.length).toBeGreaterThan(0)
    expect(r.every(x => custIds.has(x.customerId))).toBe(true)
  })
  it('销售代表与供应链拿到空数组', () => {
    expect(scopeReceivables(db, u('张伟')).length).toBe(0)
    expect(scopeReceivables(db, u('王强')).length).toBe(0)
  })
  it('CEO 拿到全部 120 条', () => {
    expect(scopeReceivables(db, u('陈立')).length).toBe(120)
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

describe('客户财务字段可见性', () => {
  it('仅供应链主管不可见客户财务字段', () => {
    expect(canSeeCustomerFinancials('supply_chain')).toBe(false)
    expect(canSeeCustomerFinancials('sales_rep')).toBe(true)
    expect(canSeeCustomerFinancials('sales_director')).toBe(true)
    expect(canSeeCustomerFinancials('ceo')).toBe(true)
  })
})

describe('CEO 越权代办提示', () => {
  it('CEO 执行通常由供应链负责的写操作会收到含「供应链主管」的提示', () => {
    const notice = overrideNoticeFor('create_purchase_order', 'ceo')
    expect(notice).toBeTruthy()
    expect(notice).toContain('供应链主管')
  })
  it('供应链主管执行自己的写工具没有越权提示', () => {
    expect(overrideNoticeFor('create_purchase_order', 'supply_chain')).toBeNull()
  })
  it('销售代表执行自己的写工具没有越权提示', () => {
    expect(overrideNoticeFor('create_followup_task', 'sales_rep')).toBeNull()
  })
})
