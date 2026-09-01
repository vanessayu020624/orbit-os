import { useEffect } from 'react'
import { useStore } from '../lib/store'
import { buildRiskCards } from '../lib/risk'
import { RiskCards } from './dashboard/RiskCards'
import { KpiCards } from './dashboard/KpiCards'
import { FunnelChart } from './dashboard/FunnelChart'
import { StatusPieChart } from './dashboard/StatusPieChart'
import { ShipmentTrendChart } from './dashboard/ShipmentTrendChart'

export default function Dashboard() {
  const { db, currentUser, tick } = useStore()

  // 4 秒一次的「实时」演示跳动：随机推进订单/回款，让看板显得在动。
  // tick 是 zustand store 里定义一次的稳定函数引用，effect 只在挂载/卸载时触发一次，
  // 卸载（切换页面）时务必清掉定时器，否则页面来回切换会攒出多个 interval、越切越快。
  useEffect(() => {
    const timer = setInterval(tick, 4000)
    return () => clearInterval(timer)
  }, [tick])

  const cards = buildRiskCards(db, currentUser)

  return (
    <div className="space-y-6">
      <RiskCards cards={cards} />
      <KpiCards db={db} user={currentUser} />
      <div className="grid grid-cols-3 gap-4">
        <FunnelChart db={db} user={currentUser} />
        <StatusPieChart db={db} user={currentUser} />
        <ShipmentTrendChart db={db} user={currentUser} />
      </div>
    </div>
  )
}
