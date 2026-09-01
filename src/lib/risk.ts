import type { DbSnapshot, User } from './types'
import { TODAY } from './types'
import { scopeOrders } from './rbac'

export interface Shortage {
  skuId: string; sku: string; skuName: string
  required: number; available: number; gap: number
}
export interface DeliveryRisk {
  orderId: string; orderNo: string; customerName: string
  promisedDeliveryDate: string
  shortages: Shortage[]
  incomingEta: string | null       // 该 SKU 最早在途到货日
  riskLevel: 'high' | 'medium' | 'none'
  daysLate: number
}

const DAY = 86400000
const diffDays = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY)

export function simulateDeliveryRisk(db: DbSnapshot, orderIds: string[]): DeliveryRisk[] {
  const ledger = new Map(db.inventory.map(i => [i.skuId, i.available]))
  const orders = orderIds
    .map(id => db.orders.find(o => o.id === id || o.orderNo === id))
    .filter((o): o is NonNullable<typeof o> => !!o)
    .sort((a, b) => a.promisedDeliveryDate.localeCompare(b.promisedDeliveryDate))

  return orders.map(o => {
    const shortages: Shortage[] = []
    let incomingEta: string | null = null
    for (const line of o.items) {
      const p = db.products.find(x => x.id === line.skuId)!
      const avail = ledger.get(line.skuId) ?? 0
      const gap = Math.max(0, line.qty - avail)
      ledger.set(line.skuId, Math.max(0, avail - line.qty))
      if (gap > 0) {
        shortages.push({ skuId: p.id, sku: p.sku, skuName: p.name,
                         required: line.qty, available: avail, gap })
        const etas = db.purchaseOrders
          .filter(po => (po.status === '在途' || po.status === '已下单')
                     && po.items.some(l => l.skuId === line.skuId))
          .map(po => po.eta).sort()
        if (etas.length && (!incomingEta || etas[0] < incomingEta)) incomingEta = etas[0]
      }
    }
    let riskLevel: DeliveryRisk['riskLevel'] = 'none'
    let daysLate = 0
    if (shortages.length) {
      if (!incomingEta) { riskLevel = 'high'; daysLate = 99 }
      else {
        daysLate = diffDays(incomingEta, o.promisedDeliveryDate)
        riskLevel = daysLate > 0 ? 'high' : 'medium'
      }
    }
    const c = db.customers.find(x => x.id === o.customerId)
    return { orderId: o.id, orderNo: o.orderNo, customerName: c?.name ?? '—',
             promisedDeliveryDate: o.promisedDeliveryDate,
             shortages, incomingEta, riskLevel, daysLate: Math.max(0, daysLate) }
  })
}

export interface RiskCard {
  id: string; severity: 'high' | 'medium'
  title: string; detail: string; question: string
}

/** 首页 Agent 主动风险卡。点击后把 question 灌进 Sidekick 直接开跑。 */
export function buildRiskCards(db: DbSnapshot, user: User): RiskCard[] {
  const cards: RiskCard[] = []
  // 14 天而非 7 天：埋雷的三张订单交期是 09-08/09-10/09-11，7 天窗口只能捞到第一张（它不缺货），
  // 风险卡会永远不出现。改动此常量前先跑 risk.test.ts。
  const horizon = new Date(Date.parse(TODAY) + 14 * DAY).toISOString().slice(0, 10)
  const pending = scopeOrders(db, user)
    .filter(o => o.status === '待发货'
              && o.promisedDeliveryDate >= TODAY && o.promisedDeliveryDate <= horizon)
  const risks = simulateDeliveryRisk(db, pending.map(o => o.id)).filter(r => r.riskLevel === 'high')
  if (risks.length) {
    const gap = risks.flatMap(r => r.shortages).reduce((s, x) => s + x.gap, 0)
    const sku = risks[0].shortages[0]
    cards.push({
      id: 'RC-delivery', severity: 'high',
      title: `${risks.length} 张订单存在交期风险`,
      detail: `${sku.sku} ${sku.skuName} 缺口 ${gap} 台，最早到货 ${risks[0].incomingEta ?? '无在途'}`,
      question: '未来两周要交付的订单有风险吗？帮我排查并给出处理方案。',
    })
  }
  if (user.role === 'sales_director' || user.role === 'ceo') {
    const overdue = db.receivables.filter(r => r.status === '已逾期' && r.dueDate < '2026-07-04')
    if (overdue.length) {
      const amt = overdue.reduce((s, r) => s + r.amount - r.paidAmount, 0)
      cards.push({
        id: 'RC-ar', severity: 'medium',
        title: `${overdue.length} 笔应收逾期超 60 天`,
        detail: `合计 ¥${(amt / 10000).toFixed(1)} 万未回款`,
        question: '有哪些逾期超过 60 天的应收账款？涉及哪些客户？',
      })
    }
  }
  return cards
}
