import type {
  Customer, DbSnapshot, Opportunity, OrderLine, PurchaseOrder, Receivable,
  Role, SalesOrder, Supplier,
} from '../lib/types'
import { canSeeCustomerFinancials } from '../lib/rbac'
import type { DeliveryRisk } from '../lib/risk'

/**
 * 工具返回值的对外投影层：只把界面上真实可见的业务标识交给模型，内部主键一律不出现。
 *
 * 为什么必须有这一层——这是一个被实测抓到的严重可信度缺陷：
 * 数据层每条记录都带两套标识，内部主键（SO-001 / C-007 / OPP-012 / P-003 / SUP-2 / U-001）
 * 和业务单号（SO-2026-0412 / 客户名 / SKU-203）。界面上只显示后者。
 * 过去工具用 `{...o}` 把整条记录原样喂给模型，模型就照着最像单号的那个字段引用，
 * 输出「[[SO-001]]」——记录是真的，但用户在任何页面都搜不到它，看起来就是凭空编的。
 * 这不是模型幻觉，是我们给错了口径；而口径错比答错更伤，因为用户无法自证，只能判定系统在骗人。
 *
 * 顺带修掉的第二个问题：query_sales_orders 过去只给 customerId，模型拿不到客户名，
 * 想回答「这张订单是哪个客户的」只能再查一次或者硬猜。这里一次性把外键解析成人看得懂的名字。
 *
 * 保留 id 的两个例外是 customers 与 opportunities：它们没有独立的业务单号，
 * 对应的做法是把编号列显式加进界面（见 pages/Customers.tsx、pages/Opportunities.tsx），
 * 让模型引用的东西在界面上一定找得到。口径统一的方向可以是「藏起来」或「露出来」，
 * 但两边必须是同一套。
 */

const MASK = '***'

const customerName = (db: DbSnapshot, id: string) =>
  db.customers.find(c => c.id === id)?.name ?? '—'
const userName = (db: DbSnapshot, id: string) =>
  db.users.find(u => u.id === id)?.name ?? '—'
const supplierName = (db: DbSnapshot, id: string) =>
  db.suppliers.find(s => s.id === id)?.name ?? '—'

function presentOrderLine(l: OrderLine, db: DbSnapshot, masked: boolean) {
  const p = db.products.find(x => x.id === l.skuId)
  return {
    sku: p?.sku ?? '—', skuName: p?.name ?? '—',
    qty: l.qty, unitPrice: masked ? MASK : l.unitPrice,
  }
}

/** 供应链主管看不到金额：这里直接给 '***' 而不是 0——给 0 模型会当成真实数值去做加总。 */
export function presentOrder(o: SalesOrder, db: DbSnapshot, role: Role) {
  const masked = role === 'supply_chain'
  return {
    orderNo: o.orderNo,
    customerName: customerName(db, o.customerId),
    ownerName: userName(db, o.ownerId),
    status: o.status,
    promisedDeliveryDate: o.promisedDeliveryDate,
    createdAt: o.createdAt,
    totalAmount: masked ? MASK : o.totalAmount,
    items: o.items.map(l => presentOrderLine(l, db, masked)),
  }
}

export function presentCustomer(c: Customer, db: DbSnapshot, role: Role) {
  const base = {
    customerId: c.id, name: c.name, industry: c.industry, region: c.region,
    tier: c.tier, ownerName: userName(db, c.ownerId),
  }
  if (!canSeeCustomerFinancials(role)) return base
  return {
    ...base,
    annualRevenue: c.annualRevenue,
    creditLimit: c.creditLimit,
    creditUsed: c.creditUsed,
    creditAvailable: c.creditLimit - c.creditUsed,
  }
}

export function presentOpportunity(o: Opportunity, db: DbSnapshot) {
  return {
    oppId: o.id, name: o.name,
    customerName: customerName(db, o.customerId),
    ownerName: userName(db, o.ownerId),
    stage: o.stage, amount: o.amount, probability: o.probability,
    expectedCloseDate: o.expectedCloseDate, lastActivityAt: o.lastActivityAt,
  }
}

export function presentReceivable(r: Receivable, db: DbSnapshot, overdueDays: number) {
  return {
    receivableNo: r.id,
    orderNo: db.orders.find(o => o.id === r.orderId)?.orderNo ?? '—',
    customerName: customerName(db, r.customerId),
    amount: r.amount, paidAmount: r.paidAmount, unpaidAmount: r.amount - r.paidAmount,
    dueDate: r.dueDate, status: r.status, overdueDays,
  }
}

export function presentPurchaseOrder(po: PurchaseOrder, db: DbSnapshot) {
  return {
    poNo: po.poNo,
    supplierName: supplierName(db, po.supplierId),
    status: po.status, eta: po.eta, expedited: po.expedited,
    createdByName: userName(db, po.createdBy),
    totalCost: po.totalCost,
    items: po.items.map(l => {
      const p = db.products.find(x => x.id === l.skuId)
      return { sku: p?.sku ?? '—', skuName: p?.name ?? '—', qty: l.qty, unitCost: l.unitCost }
    }),
  }
}

export function presentSupplier(s: Supplier, estimatedUnitCost: number) {
  return {
    name: s.name, leadTimeDays: s.leadTimeDays, onTimeRate: s.onTimeRate,
    priceFactor: s.priceFactor, estimatedUnitCost,
  }
}

/** 交付风险：orderNo / sku 本来就在，只需摘掉 orderId 与 shortages[].skuId 两个内部主键。 */
export function presentRisk(r: DeliveryRisk) {
  const { orderId: _orderId, shortages, ...rest } = r
  void _orderId
  return {
    ...rest,
    shortages: shortages.map(({ skuId: _skuId, ...s }) => { void _skuId; return s }),
  }
}
