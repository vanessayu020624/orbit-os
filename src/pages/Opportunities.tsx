import { useStore } from '../lib/store'
import { scopeOpportunities } from '../lib/rbac'
import { DataTable } from '../components/DataTable'
import { StatusChip, STAGE_TONE } from '../components/StatusChip'
import { money, pct } from '../lib/format'

export default function Opportunities() {
  const { db, currentUser } = useStore()
  const rows = scopeOpportunities(db, currentUser)

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">商机</h1>
        <span className="text-sm text-slate-400">{rows.length} 条（已按当前角色权限过滤）</span>
      </div>
      <DataTable
        rows={rows}
        empty="当前角色无权访问商机数据"
        columns={[
          { key: 'name', title: '商机名', width: '180px' },
          { key: 'customer', title: '客户', render: (r) =>
              db.customers.find(c => c.id === r.customerId)?.name ?? '—' },
          { key: 'stage', title: '阶段', width: '110px',
            render: (r) => <StatusChip label={r.stage} tone={STAGE_TONE[r.stage]} /> },
          { key: 'amount', title: '金额', width: '120px', render: (r) => money(r.amount) },
          { key: 'probability', title: '赢率', width: '90px', render: (r) => pct(r.probability) },
          { key: 'expectedCloseDate', title: '预计成交日', width: '130px' },
        ]}
      />
    </div>
  )
}
