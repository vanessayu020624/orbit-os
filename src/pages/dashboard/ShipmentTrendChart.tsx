import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { DbSnapshot, User } from '../../lib/types'
import { scopeOrders } from '../../lib/rbac'
import { TODAY } from '../../lib/types'

const DAY = 86400000
const WEEK = 7 * DAY

// 12 周窗口：以本周为界，向前 6 周、向后 6 周，覆盖种子数据里 promisedDeliveryDate 的分布区间
// （seed.ts 里随机订单交期落在 TODAY-60 天 ~ TODAY+45 天之间）。
function weekBuckets() {
  const start = Date.parse(TODAY) - 6 * WEEK
  return Array.from({ length: 12 }, (_, i) => {
    const from = start + i * WEEK
    return { from, to: from + WEEK, label: new Date(from).toISOString().slice(5, 10) }
  })
}

export function ShipmentTrendChart({ db, user }: { db: DbSnapshot; user: User }) {
  const orders = scopeOrders(db, user)
  const data = weekBuckets().map(b => ({
    week: b.label,
    count: orders.filter(o => {
      const t = Date.parse(o.promisedDeliveryDate)
      return t >= b.from && t < b.to
    }).length,
  }))

  return (
    <div className="bg-white rounded-lg border shadow-sm p-4">
      <div className="text-sm font-medium mb-2">近 12 周发货趋势</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ left: 4, right: 16 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
          <Tooltip />
          <Line type="monotone" dataKey="count" stroke="#0073ea" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
