import { useSearchParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import { canSeeCustomerFinancials, scopeCustomers, scopeSummary } from '../lib/rbac'
import { scopeHeaderText, scopeEmptyText } from '../lib/scopeText'
import { DataTable } from '../components/DataTable'
import { StatusChip, type Tone } from '../components/StatusChip'
import { money } from '../lib/format'
import type { Customer } from '../lib/types'

const TIER_TONE: Record<string, Tone> = { A: 'ok', B: 'info', C: 'idle' }

export default function Customers() {
  // 溯源标签带 ?focus=xxx 跳过来时，自动把关键词填进搜索框，直接定位到那一条。
  const [params] = useSearchParams()
  const focus = params.get('focus') ?? ''
  const { db, currentUser } = useStore()
  const rows = scopeCustomers(db, currentUser)
  const scope = scopeSummary(db, currentUser, 'customers')
  const showFinancials = canSeeCustomerFinancials(currentUser.role)

  // 客户与商机没有独立的业务单号，界面过去只显示名字。而 Agent 的结论要引用具体记录，
  // 引用名字容易撞重、也无法排序对账，引用内部编号又在界面上找不到——两头不落。
  // 解法是把编号显式露出来：模型引用什么，用户就一定能在这张表里搜到什么。
  const columns = [
    { key: 'id' as const, title: '客户编号', width: '100px' },
    { key: 'name' as const, title: '客户名', width: '160px', sortable: true },
    { key: 'industry' as const, title: '行业', width: '110px' },
    { key: 'region' as const, title: '区域', width: '90px', filterable: true },
    { key: 'tier' as const, title: '等级', width: '90px', filterable: true,
      render: (r: Customer) => <StatusChip label={r.tier} tone={TIER_TONE[r.tier]} /> },
    ...(showFinancials ? [
      { key: 'annualRevenue' as const, title: '年采购额', width: '120px', sortable: true,
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
        key={focus}
        initialQuery={focus}
        rows={rows}
        empty={scopeEmptyText(scope)}
        columns={columns}
        searchKeys={['id', 'name', 'industry', 'region']}
      />
    </div>
  )
}
