import { describe, it, expect } from 'vitest'
import { generateSeed } from '../lib/seed'
import { resolveRef } from '../lib/refLookup'
import { toolsFor, executeTool } from './registry'
import type { Role, ToolContext, User } from '../lib/types'

const db = generateSeed(42)
const userOf = (role: Role): User => db.users.find(u => u.role === role)!
const ROLES: Role[] = ['sales_rep', 'sales_director', 'supply_chain', 'ceo']

/** 只读工具的代表性调用。写工具会改库、且新建记录尚未落库，不纳入本轮体检。 */
const CALLS: { tool: string; args: Record<string, unknown> }[] = [
  { tool: 'query_customers', args: { limit: 5 } },
  { tool: 'get_customer_detail', args: { nameOrId: '华宁自动化' } },
  { tool: 'query_opportunities', args: { limit: 5 } },
  { tool: 'query_sales_orders', args: { limit: 5 } },
  { tool: 'get_order_detail', args: { orderNo: 'SO-2026-0412' } },
  { tool: 'check_inventory', args: { skus: ['SKU-203'] } },
  { tool: 'query_purchase_orders', args: { limit: 5 } },
  { tool: 'get_supplier_options', args: { sku: 'SKU-203' } },
  { tool: 'query_receivables', args: { limit: 5 } },
  { tool: 'aggregate_metrics', args: { metric: 'top_customers' } },
  { tool: 'simulate_delivery_risk', args: { withinDays: 14 } },
]

/**
 * 形如标识符的字符串。内部主键（SO-001 / C-007 / P-003 / SUP-2 / U-001 / OPP-012）
 * 和业务单号（SO-2026-0412 / SKU-203 / AR-014）都会被它捞出来，
 * 这正是本测试要区分的两类东西。
 */
const IDLIKE = /^(?:SO|PO|SKU|C|OPP|AR|P|SUP|U|T|RC)-[A-Za-z0-9-]+$/

function idLikeStrings(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof v === 'string') { if (IDLIKE.test(v)) out.add(v); return out }
  if (Array.isArray(v)) { for (const x of v) idLikeStrings(x, out); return out }
  if (v && typeof v === 'object') { for (const x of Object.values(v)) idLikeStrings(x, out); return out }
  return out
}

/**
 * 不变量：工具返回给模型的每一个标识符，用户都能在界面上核到。
 *
 * 这条测试是为一个实测事故写的——工具用 `{...o}` 把整条记录原样返回，模型于是引用了
 * 内部主键「SO-001」。记录是真的，但界面只显示 orderNo「SO-2026-0412」，用户怎么搜都搜不到，
 * 直接判定系统在编数据。模型没有幻觉，是我们给错了口径。
 *
 * 所以校验的不是「模型有没有编」，而是「我们有没有给它无法被核对的东西」——
 * 前者靠提示词只能压概率，后者能在这里一次性堵死。
 * resolveRef 与 UI 的溯源标签走的是同一个函数，所以它通过 == 界面上一定点得开。
 */
describe('工具返回给模型的标识符必须在界面上可核对', () => {
  for (const role of ROLES) {
    const user = userOf(role)
    const ctx: ToolContext = { user, role, db, mutate: () => {} }
    const available = new Set(toolsFor(role).map(t => t.name))

    for (const { tool, args } of CALLS) {
      if (!available.has(tool)) continue
      it(`${role} / ${tool}`, () => {
        const r = executeTool(tool, args, ctx)
        const ids = [...idLikeStrings(r.result)]
        const unverifiable = ids.filter(id => resolveRef(db, user, id) === null)
        expect(unverifiable, `这些标识符界面上核不到：${unverifiable.join(', ')}`).toEqual([])
      })
    }
  }
})

describe('resolveRef', () => {
  const ceo = userOf('ceo')

  it('业务单号解析到对应页面并带定位关键词', () => {
    expect(resolveRef(db, ceo, 'SO-2026-0412')).toMatchObject({ route: '/orders', focus: 'SO-2026-0412' })
    expect(resolveRef(db, ceo, 'PO-2026-0117')).toMatchObject({ route: '/purchases' })
    expect(resolveRef(db, ceo, 'SKU-203')).toMatchObject({ route: '/inventory', focus: 'SKU-203' })
    expect(resolveRef(db, ceo, 'C-001')).toMatchObject({ route: '/customers' })
    expect(resolveRef(db, ceo, 'OPP-001')).toMatchObject({ route: '/opportunities' })
  })

  it('内部主键与不存在的单号一律解析失败，交由 UI 标红', () => {
    expect(resolveRef(db, ceo, 'SO-001')).toBeNull()      // 订单内部主键，界面只显示 orderNo
    expect(resolveRef(db, ceo, 'P-003')).toBeNull()       // 产品内部主键，界面只显示 sku
    expect(resolveRef(db, ceo, 'U-001')).toBeNull()       // 用户 id，没有对应页面
    expect(resolveRef(db, ceo, 'SO-2026-9999')).toBeNull()
    expect(resolveRef(db, ceo, '')).toBeNull()
  })

  it('越权范围外的记录解析失败，而不是跳到一张空表', () => {
    const rep = userOf('sales_rep')
    const foreign = db.orders.find(o => o.ownerId !== rep.id)!
    expect(resolveRef(db, ceo, foreign.orderNo)).not.toBeNull()
    expect(resolveRef(db, rep, foreign.orderNo)).toBeNull()
  })
})
