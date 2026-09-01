import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { DbSnapshot, User } from '../../lib/types'
import { scopeOrders } from '../../lib/rbac'
import { ORDER_TONE } from '../../components/StatusChip'

// StatusChip 只导出 Tailwind 类名（Tone），图表需要真实色值，这里与 tailwind.config.js 的自定义色保持一致。
const TONE_HEX: Record<string, string> = {
  ok: '#00c875', warn: '#fdab3d', danger: '#e2445c', info: '#0073ea', idle: '#c4c4c4',
}

export function StatusPieChart({ db, user }: { db: DbSnapshot; user: User }) {
  const orders = scopeOrders(db, user)
  const counts = new Map<string, number>()
  for (const o of orders) counts.set(o.status, (counts.get(o.status) ?? 0) + 1)
  const data = [...counts.entries()].map(([status, count]) => ({ status, count }))

  return (
    <div className="bg-white rounded-lg border shadow-sm p-4">
      <div className="text-sm font-medium mb-2">订单状态分布</div>
      {!data.length ? (
        <div className="h-[220px] flex items-center justify-center text-sm text-slate-300">暂无订单数据</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="status" innerRadius={40} outerRadius={75}>
              {data.map(d => <Cell key={d.status} fill={TONE_HEX[ORDER_TONE[d.status] ?? 'idle']} />)}
            </Pie>
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
