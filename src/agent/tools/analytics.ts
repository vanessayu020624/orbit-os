import type { ToolDef } from '../../lib/types'
import { TODAY } from '../../lib/types'
import { scopeCustomers, scopeOpportunities, scopeOrders } from '../../lib/rbac'
import { simulateDeliveryRisk } from '../../lib/risk'
import { daysFromToday } from '../../lib/format'

export const analyticsTools: ToolDef[] = [
  {
    name: 'query_receivables',
    description: '查询应收账款。可按状态与最小逾期天数筛选，附客户名与逾期天数。',
    allowedRoles: ['sales_director', 'ceo'],
    isWrite: false,
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['未到期', '已逾期', '已回款'] },
        overdueDaysMin: { type: 'number', description: '最小逾期天数' },
        limit: { type: 'number' },
      },
    },
    run: (a, ctx) => {
      let rows = ctx.db.receivables
      if (a.status) rows = rows.filter(r => r.status === a.status)
      const withDays = rows.map(r => ({ r, overdueDays: Math.max(0, -daysFromToday(r.dueDate)) }))
      const filtered = a.overdueDaysMin != null
        ? withDays.filter(x => x.overdueDays >= a.overdueDaysMin)
        : withDays
      if (!filtered.length) return { found: false, reason: '没有符合条件的应收账款' }
      const receivables = filtered.slice(0, a.limit ?? 20).map(({ r, overdueDays }) => ({
        ...r, customerName: ctx.db.customers.find(c => c.id === r.customerId)?.name ?? '—',
        overdueDays,
      }))
      return { count: filtered.length, receivables }
    },
  },
  {
    name: 'aggregate_metrics',
    description: '按口径聚合指标：revenue（已发货/已完成订单总额）、funnel（商机漏斗）、top_customers（客户 TOP 榜）、order_status（订单状态分布）。',
    allowedRoles: ['sales_director', 'ceo'],
    isWrite: false,
    parameters: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['revenue', 'funnel', 'top_customers', 'order_status'] },
        limit: { type: 'number' },
      },
      required: ['metric'],
    },
    run: (a, ctx) => {
      switch (a.metric) {
        case 'revenue': {
          const rows = scopeOrders(ctx.db, ctx.user).filter(o => o.status === '已发货' || o.status === '已完成')
          if (!rows.length) return { found: false, reason: '没有已发货或已完成的订单' }
          const total = rows.reduce((s, o) => s + o.totalAmount, 0)
          return { metric: 'revenue', count: rows.length, revenue: total }
        }
        case 'funnel': {
          const rows = scopeOpportunities(ctx.db, ctx.user)
          if (!rows.length) return { found: false, reason: '当前角色权限范围内没有商机' }
          const map = new Map<string, { stage: string; count: number; amount: number }>()
          for (const o of rows) {
            const e = map.get(o.stage) ?? { stage: o.stage, count: 0, amount: 0 }
            e.count++; e.amount += o.amount
            map.set(o.stage, e)
          }
          return { metric: 'funnel', funnel: [...map.values()] }
        }
        case 'top_customers': {
          const rows = [...scopeCustomers(ctx.db, ctx.user)].sort((x, y) => y.annualRevenue - x.annualRevenue)
          if (!rows.length) return { found: false, reason: '当前角色权限范围内没有客户' }
          return { metric: 'top_customers', topCustomers: rows.slice(0, a.limit ?? 5) }
        }
        case 'order_status': {
          const rows = scopeOrders(ctx.db, ctx.user)
          if (!rows.length) return { found: false, reason: '当前角色权限范围内没有订单' }
          const map = new Map<string, number>()
          for (const o of rows) map.set(o.status, (map.get(o.status) ?? 0) + 1)
          return { metric: 'order_status', orderStatus: [...map.entries()].map(([status, count]) => ({ status, count })) }
        }
        default:
          return { found: false, reason: `未知的聚合口径「${a.metric}」` }
      }
    },
  },
  {
    name: 'simulate_delivery_risk',
    description: '测算交付风险：给定订单号或按交期窗口自动筛选「待发货」订单，计算库存缺口与预计延期天数。这是本地确定性计算，不是估算。',
    allowedRoles: ['sales_rep', 'sales_director', 'supply_chain', 'ceo'],
    isWrite: false,
    parameters: {
      type: 'object',
      properties: {
        orderNos: { type: 'array', items: { type: 'string' }, description: '指定订单号列表，不传则自动筛选' },
        withinDays: { type: 'number', description: '未指定 orderNos 时的交期窗口天数，默认 14' },
      },
    },
    run: (a, ctx) => {
      let ids: string[]
      let deniedCount = 0
      if (a.orderNos?.length) {
        // 即使这个工具对所有角色开放，也不能因为传了 orderNos 就绕过 scope——
        // 与其它工具一致，只对当前角色有权访问的订单放行；越权的订单号被过滤而非静默混入结果。
        const scoped = scopeOrders(ctx.db, ctx.user)
        const scopedRefs = new Set(scoped.flatMap(o => [o.id, o.orderNo]))
        const requested: string[] = a.orderNos
        const allowed = requested.filter(x => scopedRefs.has(x))
        deniedCount = requested.length - allowed.length
        if (!allowed.length) {
          return { found: false, reason: '指定的订单均不在当前角色权限范围内' }
        }
        ids = allowed
      } else {
        const horizon = new Date(Date.parse(TODAY) + (a.withinDays ?? 14) * 86400000).toISOString().slice(0, 10)
        ids = scopeOrders(ctx.db, ctx.user)
          .filter(o => o.status === '待发货'
                    && o.promisedDeliveryDate >= TODAY && o.promisedDeliveryDate <= horizon)
          .map(o => o.id)
      }
      if (!ids.length) return { found: false, reason: '没有符合条件的待发货订单' }
      const risks = simulateDeliveryRisk(ctx.db, ids)
      if (!risks.length) return { found: false, reason: '指定订单未找到' }
      return {
        count: risks.length, risks,
        ...(deniedCount > 0 ? {
          deniedCount,
          deniedReason: `另有 ${deniedCount} 个订单不在当前角色权限范围内，已过滤`,
        } : {}),
      }
    },
  },
]
