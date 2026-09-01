import { describe, it, expect } from 'vitest'
import { generateSeed } from './seed'
import {
  scopeCustomers, scopeOrders, scopeOpportunities, scopeReceivables, maskOrderForRole,
  canSeeCustomerFinancials, overrideNoticeFor, scopeSummary, boundaryReason,
} from './rbac'
import { toolsFor, executeTool } from '../agent/registry'

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

describe('显式边界：scopeSummary', () => {
  it('张伟（销售代表）看客户：9/48，basis 为「你本人名下」', () => {
    const s = scopeSummary(db, u('张伟'), 'customers')
    expect(s).toEqual({ visible: 9, total: 48, hidden: 39, basis: '你本人名下' })
  })
  it('陈立（CEO）看订单：hidden 为 0', () => {
    const s = scopeSummary(db, u('陈立'), 'orders')
    expect(s.hidden).toBe(0)
    expect(s.basis).toBe('全公司')
  })
  it('李娜（销售总监）看应收：basis 为「你所在团队」，hidden > 0', () => {
    const s = scopeSummary(db, u('李娜'), 'receivables')
    expect(s.basis).toBe('你所在团队')
    expect(s.hidden).toBeGreaterThan(0)
  })
  it('王强（供应链）看客户/订单 basis 为「全公司」，看商机/应收 basis 为「无权查看」', () => {
    expect(scopeSummary(db, u('王强'), 'customers').basis).toBe('全公司')
    expect(scopeSummary(db, u('王强'), 'orders').basis).toBe('全公司')
    expect(scopeSummary(db, u('王强'), 'opportunities').basis).toBe('无权查看')
    expect(scopeSummary(db, u('王强'), 'receivables').basis).toBe('无权查看')
  })
  it('boundaryReason 在 hidden 为 0 与大于 0 时文案不同', () => {
    const noHidden = boundaryReason({ visible: 5, total: 5, hidden: 0, basis: '全公司' }, 'orders')
    expect(noHidden).not.toContain('超出你的查看范围')
    const withHidden = boundaryReason({ visible: 0, total: 120, hidden: 120, basis: '你本人名下' }, 'receivables')
    expect(withHidden).toContain('全公司另有 120 条，超出你的查看范围')
  })
})

describe('显式边界：工具层', () => {
  const mkCtx = (userName: string) => {
    const user = u(userName)
    return { user, role: user.role, db, mutate: () => {} }
  }

  it('张伟身份调 query_receivables 被 registry 层拒绝（PERMISSION_DENIED），保持 V1 行为不变', () => {
    expect(toolsFor('sales_rep').some(t => t.name === 'query_receivables')).toBe(false)
    const r = executeTool('query_receivables', {}, mkCtx('张伟'))
    expect(r.ok).toBe(false)
    expect((r.result as any).error).toBe('PERMISSION_DENIED')
  })

  it('李娜身份调用受限读工具，返回值含 scope 且 scope.hidden > 0', () => {
    const r = executeTool('query_sales_orders', {}, mkCtx('李娜'))
    expect(r.ok).toBe(true)
    const result = r.result as any
    expect(result.scope).toBeTruthy()
    expect(result.scope.hidden).toBeGreaterThan(0)
    expect(result.scope.basis).toBe('你所在团队')
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
