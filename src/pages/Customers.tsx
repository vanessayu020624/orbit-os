import { useStore } from '../lib/store'
import { scopeCustomers } from '../lib/rbac'
import { DataTable } from '../components/DataTable'
import { StatusChip, type Tone } from '../components/StatusChip'
import { money } from '../lib/format'

const TIER_TONE: Record<string, Tone> = { A: 'ok', B: 'info', C: 'idle' }

export default function Customers() {
  const { db, currentUser } = useStore()
  const rows = scopeCustomers(db, currentUser)

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">客户</h1>
        <span className="text-sm text-slate-400">{rows.length} 条（已按当前角色权限过滤）</span>
      </div>
      <DataTable
        rows={rows}
        empty="当前角色无权访问客户数据"
        columns={[
          { key: 'name', title: '客户名', width: '160px' },
          { key: 'industry', title: '行业', width: '110px' },
          { key: 'region', title: '区域', width: '90px' },
          { key: 'tier', title: '等级', width: '90px',
            render: (r) => <StatusChip label={r.tier} tone={TIER_TONE[r.tier]} /> },
          { key: 'annualRevenue', title: '年采购额', width: '120px', render: (r) => money(r.annualRevenue) },
          { key: 'creditLimit', title: '信用额度', width: '120px', render: (r) => money(r.creditLimit) },
          { key: 'creditUsed', title: '已用额度', width: '120px', render: (r) => money(r.creditUsed) },
        ]}
      />
    </div>
  )
}
