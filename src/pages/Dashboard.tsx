import { useStore } from '../lib/store'
import { buildRiskCards } from '../lib/risk'
import { RiskCards } from './dashboard/RiskCards'
import { KpiCards } from './dashboard/KpiCards'
import { FunnelChart } from './dashboard/FunnelChart'
import { StatusPieChart } from './dashboard/StatusPieChart'
import { ShipmentTrendChart } from './dashboard/ShipmentTrendChart'

export default function Dashboard() {
  const { db, currentUser } = useStore()

  // 这里曾有一个 4 秒一次的 tick()，随机把一张待发货订单推成已发货、或把一笔应收标记回款，
  // 目的是让看板「显得在动」。移除原因不是它有 bug，而是它把演示的可信度换掉了：
  //   1. 数字无缘无故变化（实测 35→34→31、62→66），看的人只会判断成数据错乱；
  //   2. 与 replay.ts 开头明确承诺的「录播与真实模式数字不穿帮」的确定性直接冲突；
  //   3. 32 张可推进订单约 3.6 分钟耗尽，讲久一点数据就见底。
  // 现在数据全程静止，屏幕上任何数字变化都只可能来自 Agent 的写操作，且能在审计日志里对上。

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
