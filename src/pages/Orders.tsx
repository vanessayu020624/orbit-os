import { useStore } from '../lib/store'
import { scopeOrders, maskOrderForRole, scopeSummary } from '../lib/rbac'
import { scopeHeaderText, scopeEmptyText } from '../lib/scopeText'
import { DataTable } from '../components/DataTable'
import { StatusChip, ORDER_TONE } from '../components/StatusChip'
import { money, daysFromToday } from '../lib/format'

export default function Orders() {
  const { db, currentUser } = useStore()
  const rows = scopeOrders(db, currentUser)
    .map(o => maskOrderForRole(o, currentUser.role))
    .sort((a: any, b: any) => a.promisedDeliveryDate.localeCompare(b.promisedDeliveryDate))
  const scope = scopeSummary(db, currentUser, 'orders')

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">销售订单</h1>
        <span className="text-sm text-slate-400">{scopeHeaderText(scope)}</span>
      </div>
      <DataTable
        rows={rows}
        empty={scopeEmptyText(scope)}
        columns={[
          { key: 'orderNo', title: '订单号', width: '140px' },
          { key: 'customer', title: '客户', render: (r) =>
              db.customers.find(c => c.id === r.customerId)?.name ?? '—' },
          { key: 'status', title: '状态', width: '110px',
            render: (r) => <StatusChip label={r.status} tone={ORDER_TONE[r.status]} /> },
          { key: 'promisedDeliveryDate', title: '承诺交期', width: '150px', render: (r) => {
              const d = daysFromToday(r.promisedDeliveryDate)
              const late = d < 0
              return <span className={late ? 'text-danger' : d <= 7 ? 'text-warn' : ''}>
                {r.promisedDeliveryDate}{d >= 0 && d <= 7 ? ` (${d}天后)` : ''}
              </span>
            } },
          { key: 'totalAmount', title: '金额', width: '120px', render: (r) => money(r.totalAmount) },
          { key: 'items', title: '行项目', width: '90px', render: (r) => `${r.items.length} 项` },
        ]}
      />
    </div>
  )
}
