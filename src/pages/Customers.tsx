import { useStore } from '../lib/store'
import { canSeeCustomerFinancials, scopeCustomers, scopeSummary } from '../lib/rbac'
import { scopeHeaderText, scopeEmptyText } from '../lib/scopeText'
import { DataTable } from '../components/DataTable'
import { StatusChip, type Tone } from '../components/StatusChip'
import { money } from '../lib/format'
import type { Customer } from '../lib/types'

const TIER_TONE: Record<string, Tone> = { A: 'ok', B: 'info', C: 'idle' }

export default function Customers() {
  const { db, currentUser } = useStore()
  const rows = scopeCustomers(db, currentUser)
  const scope = scopeSummary(db, currentUser, 'customers')
  const showFinancials = canSeeCustomerFinancials(currentUser.role)

  const columns = [
    { key: 'name' as const, title: '客户名', width: '160px' },
    { key: 'industry' as const, title: '行业', width: '110px' },
    { key: 'region' as const, title: '区域', width: '90px' },
    { key: 'tier' as const, title: '等级', width: '90px',
      render: (r: Customer) => <StatusChip label={r.tier} tone={TIER_TONE[r.tier]} /> },
    ...(showFinancials ? [
      { key: 'annualRevenue' as const, title: '年采购额', width: '120px',
        render: (r: Customer) => money(r.annualRevenue) },
      { key: 'creditLimit' as const, title: '信用额度', width: '120px',
        render: (r: Customer) => money(r.creditLimit) },
      { key: 'creditUsed' as const, title: '已用额度', width: '120px',
        render: (r: Customer) => money(r.creditUsed) },
    ] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">客户</h1>
        <span className="text-sm text-slate-400">{scopeHeaderText(scope)}</span>
      </div>
      <DataTable
        rows={rows}
        empty={scopeEmptyText(scope)}
        columns={columns}
      />
    </div>
  )
}
