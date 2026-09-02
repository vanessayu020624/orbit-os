import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { DbSnapshot, User } from '../../lib/types'
import { scopeOrders } from '../../lib/rbac'
import { sliceColor } from './orderPalette'

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
            {/* 描白边 + 留缝：六块扇区里有两组是相邻色相，不分隔的话边界会糊在一起。 */}
            <Pie data={data} dataKey="count" nameKey="status" innerRadius={40} outerRadius={75}
              paddingAngle={2} stroke="#fff" strokeWidth={2}>
              {data.map(d => <Cell key={d.status} fill={sliceColor(d.status)} />)}
            </Pie>
            <Tooltip formatter={(v, n) => [`${v} 张`, String(n)]} />
            {/* 图例带上条数：颜色分得开是底线，但不该让人只靠颜色去对。 */}
            <Legend wrapperStyle={{ fontSize: 12 }}
              formatter={(value: string) => `${value} ${counts.get(value) ?? 0}`} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
