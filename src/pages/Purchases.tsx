import { useStore } from '../lib/store'
import { DataTable } from '../components/DataTable'
import { StatusChip, PO_TONE } from '../components/StatusChip'
import { money } from '../lib/format'
import { scopePurchaseOrders, scopeSummary } from '../lib/rbac'
import { scopeHeaderText, scopeEmptyText } from '../lib/scopeText'

export default function Purchases() {
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
        rows={rows}
        empty={scopeEmptyText(scope)}
        columns={[
          { key: 'poNo', title: '采购单号', width: '140px' },
          { key: 'supplier', title: '供应商', render: (r) =>
              db.suppliers.find(s => s.id === r.supplierId)?.name ?? '—' },
          { key: 'status', title: '状态', width: '110px',
            render: (r) => <StatusChip label={r.status} tone={PO_TONE[r.status]} /> },
          { key: 'eta', title: 'ETA', width: '130px' },
          { key: 'items', title: '行项目', width: '90px', render: (r) => `${r.items.length} 项` },
          { key: 'totalCost', title: '总成本', width: '120px', render: (r) => money(r.totalCost) },
        ]}
      />
    </div>
  )
}
