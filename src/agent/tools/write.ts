import type { ToolDef } from '../../lib/types'
import { scopeOrders } from '../../lib/rbac'

export const writeTools: ToolDef[] = [
  {
    name: 'update_order_promise_date',
    description: '修改订单的承诺交期。这是写操作，会先请用户确认。',
    allowedRoles: ['sales_rep', 'sales_director', 'ceo'],
    isWrite: true,
    parameters: {
      type: 'object',
      properties: {
        orderNo: { type: 'string', description: '订单号' },
        newDate: { type: 'string', description: '新的承诺交期 YYYY-MM-DD' },
        reason: { type: 'string', description: '变更原因' },
      },
      required: ['orderNo', 'newDate', 'reason'],
    },
    confirmSummary: (a, ctx) => {
      const o = scopeOrders(ctx.db, ctx.user).find(x => x.orderNo === a.orderNo)
      const oldDate = o?.promisedDeliveryDate ?? '未知'
      return `将把 ${a.orderNo} 承诺交期从 ${oldDate} 改为 ${a.newDate}，原因：${a.reason}`
    },
    run: (a, ctx) => {
      const o = scopeOrders(ctx.db, ctx.user).find(x => x.orderNo === a.orderNo)
      if (!o) return { found: false, reason: `未找到订单「${a.orderNo}」，或当前角色无权修改` }
      ctx.mutate({ kind: 'updateOrderPromiseDate', orderId: o.id, newDate: a.newDate, reason: a.reason })
      return { ok: true, message: `已将 ${a.orderNo} 承诺交期改为 ${a.newDate}` }
    },
  },
  {
    name: 'reserve_inventory',
    description: '为指定订单锁定库存。这是写操作，会先请用户确认。',
    allowedRoles: ['supply_chain', 'ceo'],
    isWrite: true,
    parameters: {
      type: 'object',
      properties: {
        orderNo: { type: 'string', description: '订单号' },
        sku: { type: 'string', description: 'SKU 编号或品名' },
        qty: { type: 'number', description: '锁定数量' },
      },
      required: ['orderNo', 'sku', 'qty'],
    },
    confirmSummary: (a) => `将为 ${a.orderNo} 锁定 ${a.sku} × ${a.qty} 台`,
    run: (a, ctx) => {
      const o = ctx.db.orders.find(x => x.orderNo === a.orderNo)
      if (!o) return { found: false, reason: `未找到订单「${a.orderNo}」` }
      const p = ctx.db.products.find(x => x.sku === a.sku || x.name === a.sku)
      if (!p) return { found: false, reason: `未找到 SKU「${a.sku}」` }
      const inv = ctx.db.inventory.find(i => i.skuId === p.id)
      if (!inv || inv.available < a.qty) {
        return { found: false, reason: `${p.sku} 可用库存不足：现有可用 ${inv?.available ?? 0} 台，需要 ${a.qty} 台` }
      }
      ctx.mutate({ kind: 'reserveInventory', skuId: p.id, qty: a.qty, orderId: o.id })
      return { ok: true, message: `已为 ${a.orderNo} 锁定 ${p.sku} × ${a.qty} 台` }
    },
  },
]
