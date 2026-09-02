import type { DbSnapshot, User } from '../lib/types'
import {
  scopeCustomers, scopeOpportunities, scopeOrders, scopePurchaseOrders, scopeReceivables,
  canSeeCustomerFinancials,
} from '../lib/rbac'
import type { ScopedEntity } from '../lib/rbac'
import { money, pct, daysFromToday } from '../lib/format'

/**
 * 手机上的「数据」页：把桌面的表格压成卡片流。
 *
 * 桌面表格一行有 6 列，手机屏宽放不下——横向滚动的表格在手机上等于没有。
 * 所以每条记录只保留四个位置：标题（编号）、副标题（是谁的）、状态、一个最该看的数字，
 * 其余字段留给详情卡。挑哪四个是产品决策，不是布局决策，所以放在这个纯函数里，
 * 让它可测、可评审，而不是散在 JSX 里。
 *
 * 权限一律走 scope*，与桌面同源：手机上绝不能多看到一条。
 */

/** 库存不在 ScopedEntity 里（它对所有角色可见），但在导航上和其它实体是一档的。 */
export type MobileEntity = ScopedEntity | 'inventory'

export interface DataCard {
  /** 必须是 resolveRef 认得的对外编号——点开详情卡靠它。 */
  ref: string
  title: string
  subtitle: string
  /** 右上角的状态词。 */
  status: string
  /** 右下角那一个数字/日期，卡片上唯一的量化信息。 */
  metric: string
  tone?: 'ok' | 'warn' | 'danger'
}

export function listCards(db: DbSnapshot, user: User, entity: MobileEntity): DataCard[] {
  const custOf = (cid: string) => db.customers.find(c => c.id === cid)?.name ?? cid

  switch (entity) {
    case 'orders':
      return scopeOrders(db, user)
        .slice()
        .sort((a, b) => a.promisedDeliveryDate.localeCompare(b.promisedDeliveryDate))
        .map(o => {
          const d = daysFromToday(o.promisedDeliveryDate)
          return {
            ref: o.orderNo, title: o.orderNo, subtitle: custOf(o.customerId), status: o.status,
            // 供应链主管在桌面看不到订单金额，手机上也不能看到。改成交期天数——
            // 对这个角色来说本来就是更有用的那个数字。
            metric: user.role === 'supply_chain'
              ? (d < 0 ? `逾期 ${-d} 天` : `${d} 天后交付`)
              : money(o.totalAmount),
            tone: d < 0 ? 'danger' : d <= 14 ? 'warn' : undefined,
          }
        })

    case 'customers':
      return scopeCustomers(db, user).map(c => ({
        ref: c.id, title: c.name, subtitle: `${c.industry} · ${c.region}`,
        status: `${c.tier} 类`,
        metric: canSeeCustomerFinancials(user.role) ? `授信 ${money(c.creditLimit)}` : '—',
        tone: canSeeCustomerFinancials(user.role) && c.creditUsed > c.creditLimit * 0.8
          ? 'warn' : undefined,
      }))

    case 'opportunities':
      return scopeOpportunities(db, user)
        .slice()
        .sort((a, b) => b.amount - a.amount)
        .map(o => ({
          ref: o.id, title: o.name, subtitle: custOf(o.customerId), status: o.stage,
          metric: `${money(o.amount)} · 赢率 ${pct(o.probability)}`,
        }))

    case 'receivables':
      return scopeReceivables(db, user)
        .slice()
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .map(r => ({
          ref: r.id, title: r.id, subtitle: custOf(r.customerId), status: r.status,
          metric: `未回款 ${money(r.amount - r.paidAmount)}`,
          tone: r.status === '已逾期' ? 'danger' : undefined,
        }))

    case 'purchases':
      return scopePurchaseOrders(db, user)
        .slice()
        .sort((a, b) => a.eta.localeCompare(b.eta))
        .map(p => ({
          ref: p.poNo, title: p.poNo,
          subtitle: db.suppliers.find(s => s.id === p.supplierId)?.name ?? p.supplierId,
          status: p.status,
          metric: `到货 ${p.eta}${p.expedited ? ' · 加急' : ''}`,
          tone: p.expedited ? 'warn' : undefined,
        }))

    case 'inventory':
      return db.products.map(p => {
        const inv = db.inventory.find(i => i.skuId === p.id)
        const short = inv ? inv.available < inv.safetyStock : false
        return {
          ref: p.sku, title: p.sku, subtitle: `${p.name} · ${p.category}`,
          status: short ? '低于安全库存' : '正常',
          metric: inv ? `可用 ${inv.available} / 安全 ${inv.safetyStock}` : '—',
          tone: short ? 'danger' : 'ok',
        }
      })
  }
}

/**
 * 卡片流的搜索。匹配标题和副标题就够了：手机上用户搜的是「华宁」或者单号，
 * 不会去搜状态词。多搜一个字段的代价是「已发货」三个字命中一半的列表。
 */
export function filterCards(cards: DataCard[], q: string): DataCard[] {
  const k = q.trim().toLowerCase()
  if (!k) return cards
  return cards.filter(c =>
    c.title.toLowerCase().includes(k) || c.subtitle.toLowerCase().includes(k))
}
