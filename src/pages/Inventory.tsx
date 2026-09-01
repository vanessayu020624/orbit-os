import { useStore } from '../lib/store'
import { DataTable } from '../components/DataTable'

export default function Inventory() {
  const { db } = useStore()
  const rows = db.inventory

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">库存</h1>
        <span className="text-sm text-slate-400">{rows.length} 条</span>
      </div>
      <DataTable
        rows={rows}
        columns={[
          { key: 'sku', title: 'SKU', width: '110px', render: (r) =>
              db.products.find(p => p.id === r.skuId)?.sku ?? '—' },
          { key: 'name', title: '品名', render: (r) =>
              db.products.find(p => p.id === r.skuId)?.name ?? '—' },
          { key: 'onHand', title: '在库', width: '90px' },
          { key: 'reserved', title: '已占用', width: '90px' },
          { key: 'available', title: '可用', width: '90px', render: (r) =>
              <span className={r.available < r.safetyStock ? 'text-danger font-semibold' : ''}>
                {r.available}
              </span> },
          { key: 'safetyStock', title: '安全库存', width: '100px' },
        ]}
      />
    </div>
  )
}
