import type { DbSnapshot, User } from './types'
import { TODAY } from './types'
import { scopeOrders, scopeReceivables } from './rbac'

export interface Shortage {
  skuId: string; sku: string; skuName: string
  required: number; available: number; gap: number
}
export interface DeliveryRisk {
  orderId: string; orderNo: string; customerName: string
  promisedDeliveryDate: string
  shortages: Shortage[]
  incomingEta: string | null       // 该 SKU 最早在途到货日（含加急），daysLate 由它算
  /**
   * 拆出常规补货与加急补货两个到货日，是因为它们在界面上的含义完全不同：
   * routineEta 是「什么都不做会怎样」，expeditedEta 是「已经采取的动作把它提前到了什么时候」。
   * 只留一个 incomingEta 时，Agent 下完加急采购单，横幅上的日期会从 09-16 无声跳到 09-07——
   * 用户看到的是一个自己变了的数字，而不是自己刚刚批准的那个动作产生的结果。
   */
  routineEta: string | null
  expeditedEta: string | null
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

  const earliest = (a: string | null, b: string | null) =>
    a && b ? (a < b ? a : b) : (a ?? b)

  return orders.map(o => {
    const shortages: Shortage[] = []
    let routineEta: string | null = null
    let expeditedEta: string | null = null
    for (const line of o.items) {
      const p = db.products.find(x => x.id === line.skuId)!
      const avail = ledger.get(line.skuId) ?? 0
      const gap = Math.max(0, line.qty - avail)
      ledger.set(line.skuId, Math.max(0, avail - line.qty))
      if (gap > 0) {
        shortages.push({ skuId: p.id, sku: p.sku, skuName: p.name,
                         required: line.qty, available: avail, gap })
        const inFlight = db.purchaseOrders
          .filter(po => (po.status === '在途' || po.status === '已下单')
                     && po.items.some(l => l.skuId === line.skuId))
        const min = (list: typeof inFlight) =>
          list.map(po => po.eta).sort()[0] ?? null
        routineEta = earliest(routineEta, min(inFlight.filter(po => !po.expedited)))
        expeditedEta = earliest(expeditedEta, min(inFlight.filter(po => po.expedited)))
      }
    }
    const incomingEta = earliest(routineEta, expeditedEta)
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
             shortages, incomingEta, routineEta, expeditedEta,
             riskLevel, daysLate: Math.max(0, daysLate) }
  })
}

export interface RiskCard {
  id: string; severity: 'high' | 'medium'
  title: string; detail: string; question: string
}

// 14 天而非 7 天：埋雷的三张订单交期是 09-08/09-10/09-11，7 天窗口只能捞到第一张（它不缺货），
// 风险卡会永远不出现。改动此常量前先跑 risk.test.ts。
function pendingDeliveryWindow(db: DbSnapshot, user: User) {
  const horizon = new Date(Date.parse(TODAY) + 14 * DAY).toISOString().slice(0, 10)
  return scopeOrders(db, user)
    .filter(o => o.status === '待发货'
              && o.promisedDeliveryDate >= TODAY && o.promisedDeliveryDate <= horizon)
}

/** 首页「交期风险订单」KPI 与风险卡共用的口径：14 天窗口内高风险订单数。 */
export function countDeliveryRiskOrders(db: DbSnapshot, user: User): number {
  const pending = pendingDeliveryWindow(db, user)
  return simulateDeliveryRisk(db, pending.map(o => o.id)).filter(r => r.riskLevel === 'high').length
}

/** 首页 Agent 主动风险卡。点击后把 question 灌进 Sidekick 直接开跑。 */
export function buildRiskCards(db: DbSnapshot, user: User): RiskCard[] {
  const cards: RiskCard[] = []
  const pending = pendingDeliveryWindow(db, user)
  const risks = simulateDeliveryRisk(db, pending.map(o => o.id)).filter(r => r.riskLevel === 'high')
  if (risks.length) {
    const gap = risks.flatMap(r => r.shortages).reduce((s, x) => s + x.gap, 0)
    const sku = risks[0].shortages[0]
    // 常规到货日打底、加急到货日括号补充：Agent 下过加急单之后，横幅上多出来的
    // 那句「加急采购 X 到货中」就是它这次动作留下的痕迹，而不是一个自己变小了的数字。
    const { routineEta, expeditedEta } = risks[0]
    const eta = routineEta ? `当前最早可到货 ${routineEta}` : '当前无常规在途补货'
    const expedited = expeditedEta ? `（加急采购 ${expeditedEta} 到货中）` : ''
    cards.push({
      id: 'RC-delivery', severity: 'high',
      title: `${risks.length} 张订单存在交期风险`,
      detail: `${sku.sku} ${sku.skuName} 缺口 ${gap} 台，${eta}${expedited}`,
      question: '未来两周要交付的订单有风险吗？帮我排查并给出处理方案。',
    })
  }
  if (user.role === 'sales_director' || user.role === 'ceo') {
    const overdue = scopeReceivables(db, user).filter(r => r.status === '已逾期' && r.dueDate < '2026-07-04')
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
