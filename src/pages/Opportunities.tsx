import { useSearchParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import { scopeOpportunities, scopeSummary } from '../lib/rbac'
import { scopeHeaderText, scopeEmptyText } from '../lib/scopeText'
import { DataTable } from '../components/DataTable'
import { StatusChip, STAGE_TONE } from '../components/StatusChip'
import { money, pct } from '../lib/format'

export default function Opportunities() {
  // 溯源标签带 ?focus=xxx 跳过来时，自动把关键词填进搜索框，直接定位到那一条。
  const [params] = useSearchParams()
  const focus = params.get('focus') ?? ''
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
        key={focus}
        initialQuery={focus}
        rows={rows}
        empty={scopeEmptyText(scope)}
        searchKeys={['id', 'name', 'customer']}
        columns={[
          // 编号列的理由同 pages/Customers.tsx：Agent 引用的东西必须在界面上搜得到。
          { key: 'id', title: '商机编号', width: '110px' },
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
