import type { DbSnapshot, User } from '../../lib/types'
import { scopeOrders } from '../../lib/rbac'
import { countDeliveryRiskOrders } from '../../lib/risk'
import { money } from '../../lib/format'

interface Kpi { title: string; value: string; note: string }

// Ruling T5-A：第三张 KPI 卡从「库存告警 SKU」改为「交期风险订单」，
// 与 buildRiskCards 共用 countDeliveryRiskOrders 的 14 天窗口口径，
// 这样批准采购单后风险卡消失的同时这张 KPI 也会同步归零，才能演示 Agent 干预的实时反馈。
function computeKpis(db: DbSnapshot, user: User): Kpi[] {
  const orders = scopeOrders(db, user)
  const revenueOrders = orders.filter(o => o.status === '已发货' || o.status === '已完成')
  const revenue = revenueOrders.reduce((s, o) => s + o.totalAmount, 0)
  const pendingShip = orders.filter(o => o.status === '待发货').length
  const riskOrders = countDeliveryRiskOrders(db, user)

  const canSeeAr = user.role === 'sales_director' || user.role === 'ceo'
  const overdue = db.receivables.filter(r => r.status === '已逾期')
  const overdueAmt = overdue.reduce((s, r) => s + r.amount - r.paidAmount, 0)

  return [
    { title: '本月营收', value: user.role === 'supply_chain' ? '***' : money(revenue),
      note: `${revenueOrders.length} 张已发货 / 已完成订单` },
    { title: '待发货订单', value: String(pendingShip), note: '当前处于待发货状态的订单数' },
    { title: '交期风险订单', value: String(riskOrders), note: '未来 14 天内存在缺货风险' },
    { title: '逾期应收', value: canSeeAr ? money(overdueAmt) : '—',
      note: canSeeAr ? `${overdue.length} 笔已逾期` : '仅销售总监 / CEO 可见' },
  ]
}

export function KpiCards({ db, user }: { db: DbSnapshot; user: User }) {
  const kpis = computeKpis(db, user)
  return (
    <div className="grid grid-cols-4 gap-4">
      {kpis.map(k => (
        <div key={k.title} className="bg-white rounded-lg border shadow-sm p-4">
          <div className="text-xs text-slate-400">{k.title}</div>
          <div className="text-2xl font-semibold mt-1 transition-all duration-500">{k.value}</div>
          <div className="text-xs text-slate-400 mt-1">{k.note}</div>
        </div>
      ))}
    </div>
  )
}
