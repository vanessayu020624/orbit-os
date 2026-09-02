import type { DbSnapshot, User } from './types'
import {
  scopeCustomers, scopeOpportunities, scopeOrders, scopePurchaseOrders, scopeReceivables,
} from './rbac'

export interface RefTarget {
  /** 跳转的页面路由。 */
  route: string
  /** 落地页面自动填进搜索框的关键词，保证一眼看到那一条，而不是丢进几十行里自己找。 */
  focus: string
  /** 记录类型，用于 chip 的 title 提示。 */
  kind: string
}

/**
 * 把结论里的 [[引用]] 解析成「界面上确实存在、且当前角色看得到」的那一条记录。
 *
 * 为什么要按角色 scope 查而不是查全库：chip 的三种外观（可跳转 / 未找到）必须与用户
 * 真实能看到的东西一致。如果按全库判定为「存在」，用户点过去却是一张空表，
 * 那和编造出来的单号在体验上没有区别——它照样自证不了。
 *
 * 返回 null 表示这个引用在当前角色的可见数据里找不到。调用方必须把它显式标红，
 * 不能当成普通 chip 渲染：一个看起来正常、点下去什么都没有的标签，
 * 比直接承认「这条我核不上」要糟得多。
 */
export function resolveRef(db: DbSnapshot, user: User, ref: string): RefTarget | null {
  const id = ref.trim()
  if (!id) return null

  if (scopeOrders(db, user).some(o => o.orderNo === id)) {
    return { route: '/orders', focus: id, kind: '销售订单' }
  }
  if (scopePurchaseOrders(db, user).some(p => p.poNo === id)) {
    return { route: '/purchases', focus: id, kind: '采购单' }
  }
  const product = db.products.find(p => p.sku === id || p.name === id)
  if (product) {
    return { route: '/inventory', focus: product.sku, kind: '库存 SKU' }
  }
  const customer = scopeCustomers(db, user).find(c => c.id === id || c.name === id)
  if (customer) {
    return { route: '/customers', focus: id, kind: '客户' }
  }
  const opp = scopeOpportunities(db, user).find(o => o.id === id || o.name === id)
  if (opp) {
    return { route: '/opportunities', focus: id, kind: '商机' }
  }
  if (scopeReceivables(db, user).some(r => r.id === id)) {
    return { route: '/receivables', focus: id, kind: '应收账款' }
  }
  return null
}
