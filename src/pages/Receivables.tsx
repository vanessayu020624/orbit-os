import { useStore } from '../lib/store'
import { DataTable } from '../components/DataTable'
import { StatusChip, AR_TONE } from '../components/StatusChip'
import { money, daysFromToday } from '../lib/format'
import { scopeReceivables, scopeSummary } from '../lib/rbac'
import { scopeHeaderText, scopeEmptyText } from '../lib/scopeText'

export default function Receivables() {
  const { db, currentUser } = useStore()
  const rows = scopeReceivables(db, currentUser)
  const scope = scopeSummary(db, currentUser, 'receivables')

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">应收</h1>
        <span className="text-sm text-slate-400">{scopeHeaderText(scope)}</span>
      </div>
      <DataTable
        rows={rows}
        empty={scopeEmptyText(scope)}
        columns={[
          { key: 'id', title: '应收单号', width: '140px' },
          { key: 'customer', title: '客户', render: (r) =>
              db.customers.find(c => c.id === r.customerId)?.name ?? '—' },
          { key: 'amount', title: '金额', width: '120px', render: (r) => money(r.amount) },
          { key: 'dueDate', title: '到期日', width: '130px', render: (r) => {
              const overdue = daysFromToday(r.dueDate) < 0 && r.status !== '已回款'
              return <span className={overdue ? 'text-danger' : ''}>{r.dueDate}</span>
            } },
          { key: 'status', title: '状态', width: '110px',
            render: (r) => <StatusChip label={r.status} tone={AR_TONE[r.status]} /> },
        ]}
      />
    </div>
  )
}
