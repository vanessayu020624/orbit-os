import { useStore } from '../lib/store'
import { scopeOpportunities, scopeSummary } from '../lib/rbac'
import { scopeHeaderText, scopeEmptyText } from '../lib/scopeText'
import { DataTable } from '../components/DataTable'
import { StatusChip, STAGE_TONE } from '../components/StatusChip'
import { money, pct } from '../lib/format'

export default function Opportunities() {
  const { db, currentUser } = useStore()
  const rows = scopeOpportunities(db, currentUser)
  const scope = scopeSummary(db, currentUser, 'opportunities')

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">商机</h1>
        <span className="text-sm text-slate-400">{scopeHeaderText(scope)}</span>
      </div>
      <DataTable
        rows={rows}
        empty={scopeEmptyText(scope)}
        searchKeys={['name', 'customer']}
        columns={[
          { key: 'name', title: '商机名', width: '180px', sortable: true },
          { key: 'customer', title: '客户',
            value: (r) => db.customers.find(c => c.id === r.customerId)?.name ?? '',
            render: (r) =>
              db.customers.find(c => c.id === r.customerId)?.name ?? '—' },
          { key: 'stage', title: '阶段', width: '110px', filterable: true,
            render: (r) => <StatusChip label={r.stage} tone={STAGE_TONE[r.stage]} /> },
          { key: 'amount', title: '金额', width: '120px', sortable: true, render: (r) => money(r.amount) },
          { key: 'probability', title: '赢率', width: '90px', sortable: true, render: (r) => pct(r.probability) },
          { key: 'expectedCloseDate', title: '预计成交日', width: '130px', sortable: true },
        ]}
      />
    </div>
  )
}
