import type { RiskCard } from '../../lib/risk'
import { askAgent } from '../../lib/bus'

const SEVERITY_STYLE: Record<RiskCard['severity'], { bar: string; badge: string }> = {
  high:   { bar: 'bg-danger', badge: 'bg-danger/10 text-danger' },
  medium: { bar: 'bg-warn',   badge: 'bg-warn/10 text-warn' },
}

/** 首页顶部的 Agent 主动风险卡区：Agent 主动发现问题，而非等人来问。 */
export function RiskCards({ cards }: { cards: RiskCard[] }) {
  if (!cards.length) return null
  return (
    <div className="space-y-3">
      {cards.map(c => {
        const style = SEVERITY_STYLE[c.severity]
        return (
          <div key={c.id} className="flex bg-white rounded-lg border shadow-sm overflow-hidden">
            <div className={`w-1.5 shrink-0 ${style.bar}`} />
            <div className="flex-1 flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${style.badge}`}>
                    {c.severity === 'high' ? '高风险' : '中风险'}
                  </span>
                  <div className="font-medium text-sm truncate">{c.title}</div>
                </div>
                <div className="text-xs text-slate-400 mt-1 truncate">{c.detail}</div>
              </div>
              <button onClick={() => askAgent(c.question)}
                className="shrink-0 text-sm text-brand hover:text-brand-dark font-medium px-3 py-1.5
                           rounded-md hover:bg-brand/5 whitespace-nowrap">
                让 Agent 排查 →
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
