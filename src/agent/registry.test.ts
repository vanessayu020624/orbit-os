import { describe, it, expect } from 'vitest'
import { generateSeed } from '../lib/seed'
import { ALL_TOOLS, toolsFor, executeTool } from './registry'
import type { ToolContext } from '../lib/types'

const db = generateSeed(42)
const ctxFor = (name: string): ToolContext => {
  const user = db.users.find(u => u.name === name)!
  return { user, role: user.role, db, mutate: () => {} }
}

describe('工具注册表', () => {
  it('共 15 个工具，其中 4 个写工具', () => {
    expect(ALL_TOOLS.length).toBe(15)
    expect(ALL_TOOLS.filter(t => t.isWrite).length).toBe(4)
  })
  it('工具名唯一', () => {
    expect(new Set(ALL_TOOLS.map(t => t.name)).size).toBe(15)
  })
  it('每个工具都声明了至少一个角色', () => {
    expect(ALL_TOOLS.every(t => t.allowedRoles.length > 0)).toBe(true)
  })
})

describe('权限第一层：工具可见性', () => {
  it('销售代表可用工具明显少于 CEO', () => {
    expect(toolsFor('sales_rep').length).toBeLessThan(toolsFor('ceo').length)
  })
  it('销售代表拿不到 aggregate_metrics', () => {
    expect(toolsFor('sales_rep').map(t => t.name)).not.toContain('aggregate_metrics')
  })
  it('CEO 拿不到任何写工具', () => {
    expect(toolsFor('ceo').some(t => t.isWrite)).toBe(false)
  })
  it('供应链主管拿不到客户与商机工具', () => {
    const names = toolsFor('supply_chain').map(t => t.name)
    expect(names).not.toContain('query_customers')
    expect(names).not.toContain('query_opportunities')
  })
})

describe('权限第二层：执行拦截', () => {
  it('绕过工具列表直接调用也会被拒', () => {
    const r = executeTool('aggregate_metrics', { metric: 'top_customers' }, ctxFor('张伟'))
    expect(r.ok).toBe(false)
    expect((r.result as any).error).toBe('PERMISSION_DENIED')
  })
  it('不存在的工具名返回错误而非抛异常', () => {
    expect(executeTool('drop_database', {}, ctxFor('陈立')).ok).toBe(false)
  })
})

describe('演示剧本 C：同一问题不同角色不同答案', () => {
  it('张伟查客户只拿到自己的 9 个，最大 86 万', () => {
    const r: any = executeTool('query_customers', { sortByRevenue: true }, ctxFor('张伟')).result
    expect(r.count).toBe(9)
    expect(r.customers[0].annualRevenue).toBe(860000)
  })
  it('CEO 查全公司 TOP 客户，榜首 520 万', () => {
    const r: any = executeTool('aggregate_metrics',
      { metric: 'top_customers', limit: 5 }, ctxFor('陈立')).result
    expect(r.topCustomers[0].annualRevenue).toBe(5200000)
  })
})

describe('演示剧本 A：交期风险', () => {
  it('供应链主管测算出 48 台缺口', () => {
    const r: any = executeTool('simulate_delivery_risk', { withinDays: 14 }, ctxFor('王强')).result
    const gap = r.risks.flatMap((x: any) => x.shortages).reduce((s: number, x: any) => s + x.gap, 0)
    expect(gap).toBe(48)
  })
  it('供应商比选返回锐驰机电交期更短', () => {
    const r: any = executeTool('get_supplier_options', { sku: 'SKU-203' }, ctxFor('王强')).result
    expect(r.suppliers[0].name).toBe('锐驰机电')
    expect(r.suppliers[0].leadTimeDays).toBe(7)
  })
})

describe('simulate_delivery_risk 传入 orderNos 也要过 scope（不能绕过权限）', () => {
  it('张伟传入不属于自己的订单号，拿不到该订单数据', () => {
    // SO-2026-0428（埋雷订单，客户中科机电，ownerId=U-002 陈晓）不在张伟（U-001）名下，属于越权访问
    const other = db.orders.find(o => o.orderNo === 'SO-2026-0428')!
    expect(other.ownerId).not.toBe(db.users.find(u => u.name === '张伟')!.id)
    const r: any = executeTool('simulate_delivery_risk',
      { orderNos: ['SO-2026-0428'] }, ctxFor('张伟')).result
    expect(r.found).toBe(false)
    expect(typeof r.reason).toBe('string')
  })
  it('混合传入越权与合法订单号时，只返回权限范围内的订单，并标注被过滤数量', () => {
    const zw = db.users.find(u => u.name === '张伟')!
    const own = db.orders.find(o => o.ownerId === zw.id)!
    const r: any = executeTool('simulate_delivery_risk',
      { orderNos: [own.orderNo, 'SO-2026-0428'] }, ctxFor('张伟')).result
    expect(r.count).toBe(1)
    expect(r.risks[0].orderNo).toBe(own.orderNo)
    expect(r.deniedCount).toBe(1)
  })
})

describe('空结果不编造', () => {
  it('查不到的客户返回 found:false', () => {
    const r: any = executeTool('get_customer_detail',
      { nameOrId: '不存在的公司' }, ctxFor('陈立')).result
    expect(r.found).toBe(false)
    expect(typeof r.reason).toBe('string')
  })
})
