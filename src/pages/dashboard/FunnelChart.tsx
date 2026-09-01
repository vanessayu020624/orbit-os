import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts'
import type { DbSnapshot, User, OppStage } from '../../lib/types'
import { scopeOpportunities } from '../../lib/rbac'
import { money } from '../../lib/format'

const STAGES: OppStage[] = ['线索确认', '需求分析', '方案报价', '商务谈判', '赢单', '输单']

export function FunnelChart({ db, user }: { db: DbSnapshot; user: User }) {
  const opps = scopeOpportunities(db, user)
  const data = STAGES.map(stage => ({
    stage, amount: opps.filter(o => o.stage === stage).reduce((s, o) => s + o.amount, 0),
  }))

  return (
    <div className="bg-white rounded-lg border shadow-sm p-4">
      <div className="text-sm font-medium mb-2">销售漏斗</div>
      {!opps.length ? (
        <div className="h-[220px] flex items-center justify-center text-sm text-slate-300">
          当前角色无商机数据
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={v => money(v)} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="stage" width={68} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => money(Number(Array.isArray(v) ? v[0] : v ?? 0))} />
            <Bar dataKey="amount" fill="#0073ea" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
