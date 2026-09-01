import type { ToolDef, Product } from '../../lib/types'
import { TODAY } from '../../lib/types'
import { scopeOrders, maskOrderForRole } from '../../lib/rbac'

function findProduct(products: Product[], skuOrName: string): Product | undefined {
  return products.find(p => p.sku === skuOrName || p.name === skuOrName)
}

export const erpTools: ToolDef[] = [
  {
    name: 'query_sales_orders',
    description: '查询销售订单。可按状态与交期区间筛选，供应链主管看到的金额与单价已脱敏。',
    allowedRoles: ['sales_rep', 'sales_director', 'supply_chain', 'ceo'],
    isWrite: false,
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '订单状态' },
        deliveryDateFrom: { type: 'string', description: '交期起始日 YYYY-MM-DD' },
        deliveryDateTo: { type: 'string', description: '交期截止日 YYYY-MM-DD' },
        limit: { type: 'number' },
      },
    },
    run: (a, ctx) => {
      let rows = scopeOrders(ctx.db, ctx.user)
      if (a.status) rows = rows.filter(o => o.status === a.status)
      if (a.deliveryDateFrom) rows = rows.filter(o => o.promisedDeliveryDate >= a.deliveryDateFrom)
      if (a.deliveryDateTo) rows = rows.filter(o => o.promisedDeliveryDate <= a.deliveryDateTo)
      if (!rows.length) return { found: false, reason: '当前角色权限范围内没有符合条件的订单' }
      const orders = rows.slice(0, a.limit ?? 20).map(o => maskOrderForRole(o, ctx.role))
      return { count: rows.length, orders }
    },
  },
  {
    name: 'get_order_detail',
    description: '按订单号查询订单详情，含客户名与每个 SKU 的品名，供应链主管看到的金额已脱敏。',
    allowedRoles: ['sales_rep', 'sales_director', 'supply_chain', 'ceo'],
    isWrite: false,
    parameters: {
      type: 'object',
      properties: { orderNo: { type: 'string', description: '订单号' } },
      required: ['orderNo'],
    },
    run: (a, ctx) => {
      const o = scopeOrders(ctx.db, ctx.user).find(x => x.orderNo === a.orderNo)
      if (!o) return { found: false, reason: `未找到订单「${a.orderNo}」，或当前角色无权查看` }
      const c = ctx.db.customers.find(x => x.id === o.customerId)
      const items = o.items.map(l => {
        const p = ctx.db.products.find(x => x.id === l.skuId)
        return { ...l, sku: p?.sku, skuName: p?.name }
      })
      return { ...maskOrderForRole(o, ctx.role), customerName: c?.name ?? '—', items }
    },
  },
  {
    name: 'check_inventory',
    description: '查询指定 SKU（编号或品名）的库存：现有量、已预留、可用量、安全库存，并标注是否低于安全库存。',
    allowedRoles: ['sales_rep', 'sales_director', 'supply_chain', 'ceo'],
    isWrite: false,
    parameters: {
      type: 'object',
      properties: {
        skus: { type: 'array', items: { type: 'string' }, description: 'SKU 编号或品名列表' },
      },
      required: ['skus'],
    },
    run: (a, ctx) => {
      const items = (a.skus as string[]).map(s => {
        const p = findProduct(ctx.db.products, s)
        if (!p) return { sku: s, found: false as const, reason: `未找到 SKU「${s}」` }
        const inv = ctx.db.inventory.find(i => i.skuId === p.id)
        if (!inv) return { sku: p.sku, skuName: p.name, found: false as const, reason: '该 SKU 无库存记录' }
        return {
          sku: p.sku, skuName: p.name, onHand: inv.onHand, reserved: inv.reserved,
          available: inv.available, safetyStock: inv.safetyStock,
          belowSafety: inv.available < inv.safetyStock,
        }
      })
      if (items.every(i => 'found' in i && i.found === false)) {
        return { found: false, reason: '所查询的 SKU 均未找到' }
      }
      return { count: items.length, items }
    },
  },
  {
    name: 'query_purchase_orders',
    description: '查询采购单。可按状态与 SKU 筛选，返回预计到货日。',
    allowedRoles: ['supply_chain', 'ceo'],
    isWrite: false,
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '采购单状态' },
        skuFilter: { type: 'string', description: '按 SKU 编号或品名筛选行项目' },
        limit: { type: 'number' },
      },
    },
    run: (a, ctx) => {
      let rows = ctx.db.purchaseOrders
      if (a.status) rows = rows.filter(po => po.status === a.status)
      if (a.skuFilter) {
        const p = findProduct(ctx.db.products, a.skuFilter)
        rows = rows.filter(po => po.items.some(l => l.skuId === p?.id))
      }
      if (!rows.length) return { found: false, reason: '没有符合条件的采购单' }
      const suppliers = ctx.db.suppliers
      const orders = rows.slice(0, a.limit ?? 20).map(po => ({
        ...po, supplierName: suppliers.find(s => s.id === po.supplierId)?.name ?? '—',
      }))
      return { count: rows.length, purchaseOrders: orders }
    },
  },
  {
    name: 'get_supplier_options',
    description: '查询某 SKU 的可选供应商，含交期、准时率、价格系数与预估单位成本，按交期升序排列。',
    allowedRoles: ['supply_chain', 'ceo'],
    isWrite: false,
    parameters: {
      type: 'object',
      properties: { sku: { type: 'string', description: 'SKU 编号或品名' } },
      required: ['sku'],
    },
    run: (a, ctx) => {
      const p = findProduct(ctx.db.products, a.sku)
      if (!p) return { found: false, reason: `未找到 SKU「${a.sku}」` }
      const suppliers = ctx.db.suppliers
        .filter(s => s.skuIds.includes(p.id))
        .map(s => ({
          id: s.id, name: s.name, leadTimeDays: s.leadTimeDays, onTimeRate: s.onTimeRate,
          priceFactor: s.priceFactor, estimatedUnitCost: Math.round(p.cost * s.priceFactor),
        }))
        .sort((x, y) => x.leadTimeDays - y.leadTimeDays)
      if (!suppliers.length) return { found: false, reason: `没有供应商可供应「${p.sku}」` }
      return { sku: p.sku, skuName: p.name, suppliers }
    },
  },
  {
    name: 'create_purchase_order',
    description: '创建一张采购单。这是写操作，会先请用户确认。',
    allowedRoles: ['supply_chain', 'ceo'],
    isWrite: true,
    parameters: {
      type: 'object',
      properties: {
        supplierName: { type: 'string', description: '供应商名称' },
        sku: { type: 'string', description: 'SKU 编号或品名' },
        qty: { type: 'number', description: '采购数量' },
        expedited: { type: 'boolean', description: '是否加急' },
      },
      required: ['supplierName', 'sku', 'qty'],
    },
    confirmSummary: (a, ctx) => {
      const s = ctx.db.suppliers.find(x => x.name === a.supplierName)
      const p = ctx.db.products.find(x => x.sku === a.sku || x.name === a.sku)
      if (!s || !p) return `将创建采购单：${a.supplierName} / ${a.sku} × ${a.qty}`
      const cost = Math.round(p.cost * s.priceFactor) * a.qty
      const lead = a.expedited ? Math.max(1, s.leadTimeDays - 2) : s.leadTimeDays
      const eta = new Date(Date.parse(TODAY) + lead * 86400000).toISOString().slice(0, 10)
      return `将向【${s.name}】采购 ${p.sku} ${p.name} × ${a.qty} 台，` +
             `预计成本 ¥${cost.toLocaleString('zh-CN')}，预计到货 ${eta}` +
             (a.expedited ? '（加急）' : '')
    },
    run: (a, ctx) => {
      const s = ctx.db.suppliers.find(x => x.name === a.supplierName)
      if (!s) return { found: false, reason: `未找到供应商「${a.supplierName}」` }
      const p = findProduct(ctx.db.products, a.sku)
      if (!p) return { found: false, reason: `未找到 SKU「${a.sku}」` }
      const lead = a.expedited ? Math.max(1, s.leadTimeDays - 2) : s.leadTimeDays
      const eta = new Date(Date.parse(TODAY) + lead * 86400000).toISOString().slice(0, 10)
      const unitCost = Math.round(p.cost * s.priceFactor)
      const seq = 900 + ctx.db.purchaseOrders.length
      const poNo = `PO-2026-${seq}`
      const po = {
        id: `PO-${seq}`, poNo, supplierId: s.id, status: '已下单' as const,
        eta, items: [{ skuId: p.id, qty: a.qty, unitCost }],
        totalCost: unitCost * a.qty, expedited: !!a.expedited, createdBy: ctx.user.id,
      }
      ctx.mutate({ kind: 'createPurchaseOrder', po })
      return { ok: true, poNo, eta, unitCost, totalCost: po.totalCost,
               message: `已创建采购单 ${poNo}，预计到货 ${eta}` }
    },
  },
]
