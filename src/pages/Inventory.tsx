import { useSearchParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import { DataTable } from '../components/DataTable'

export default function Inventory() {
  // 溯源标签带 ?focus=xxx 跳过来时，自动把关键词填进搜索框，直接定位到那一条。
  const [params] = useSearchParams()
  const focus = params.get('focus') ?? ''
  const { db } = useStore()
  const rows = db.inventory

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">库存</h1>
        <span className="text-sm text-slate-400">{rows.length} 条</span>
      </div>
      <DataTable
        key={focus}
        initialQuery={focus}
        rows={rows}
        searchKeys={['sku', 'name']}
        columns={[
          { key: 'sku', title: 'SKU', width: '110px',
            value: (r) => db.products.find(p => p.id === r.skuId)?.sku ?? '',
            render: (r) =>
              db.products.find(p => p.id === r.skuId)?.sku ?? '—' },
          { key: 'name', title: '品名',
            value: (r) => db.products.find(p => p.id === r.skuId)?.name ?? '',
            render: (r) =>
              db.products.find(p => p.id === r.skuId)?.name ?? '—' },
          { key: 'onHand', title: '在库', width: '90px', sortable: true },
          { key: 'reserved', title: '已占用', width: '90px', sortable: true },
          { key: 'available', title: '可用', width: '90px', sortable: true, render: (r) =>
              <span className={r.available < r.safetyStock ? 'text-danger font-semibold' : ''}>
                {r.available}
              </span> },
          { key: 'safetyStock', title: '安全库存', width: '100px', sortable: true },
        ]}
      />
    </div>
  )
}
