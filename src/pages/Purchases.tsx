import { useSearchParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import { DataTable } from '../components/DataTable'
import { StatusChip, PO_TONE } from '../components/StatusChip'
import { money } from '../lib/format'
import { scopePurchaseOrders, scopeSummary } from '../lib/rbac'
import { scopeHeaderText, scopeEmptyText } from '../lib/scopeText'

export default function Purchases() {
  // 溯源标签带 ?focus=xxx 跳过来时，自动把关键词填进搜索框，直接定位到那一条。
  const [params] = useSearchParams()
  const focus = params.get('focus') ?? ''
  const { db, currentUser } = useStore()
  const rows = scopePurchaseOrders(db, currentUser)
  const scope = scopeSummary(db, currentUser, 'purchases')

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">采购</h1>
        <span className="text-sm text-slate-400">{scopeHeaderText(scope)}</span>
      </div>
      <DataTable
        key={focus}
        initialQuery={focus}
        rows={rows}
        empty={scopeEmptyText(scope)}
        searchKeys={['poNo', 'supplier']}
        columns={[
          { key: 'poNo', title: '采购单号', width: '140px' },
          { key: 'supplier', title: '供应商',
            value: (r) => db.suppliers.find(s => s.id === r.supplierId)?.name ?? '',
            render: (r) =>
              db.suppliers.find(s => s.id === r.supplierId)?.name ?? '—' },
          { key: 'status', title: '状态', width: '110px', filterable: true,
            render: (r) => <StatusChip label={r.status} tone={PO_TONE[r.status]} /> },
          { key: 'eta', title: 'ETA', width: '130px', sortable: true },
          { key: 'items', title: '行项目', width: '90px', render: (r) => `${r.items.length} 项` },
          { key: 'totalCost', title: '总成本', width: '120px', sortable: true, render: (r) => money(r.totalCost) },
        ]}
      />
    </div>
  )
}
