import type { RiskCard } from '../../lib/risk'
import { askAgent } from '../../lib/bus'
import { NotifyButton } from '../../components/NotifyButton'

/**
 * 这一区的视觉权重是刻意调重的。
 *
 * 改之前它和下面四张 KPI 卡长得一样——同样的白底、同样的细边框，而 KPI 那排有四张、
 * 数字还是 2xl，结果整个首屏最扎眼的是「本月营收」，最不起眼的反倒是「有订单要交不出去」。
 * 这个产品想讲的恰恰是后者：Agent 主动把问题端到你面前，而不是等你自己去翻报表。
 * 首屏第一眼看到什么，就是在替用户排优先级，这件事不能交给默认样式。
 */
const SEVERITY_STYLE: Record<RiskCard['severity'], {
  bar: string; badge: string; wrap: string; cta: string; label: string
}> = {
  high: {
    bar: 'bg-danger',
    badge: 'bg-danger text-white',
    wrap: 'bg-danger/5 border-danger/25 shadow-sm',
    cta: 'bg-danger text-white hover:bg-danger/90',
    label: '高风险',
  },
  medium: {
    bar: 'bg-warn',
    badge: 'bg-warn/15 text-warn',
    wrap: 'bg-warn/5 border-warn/25 shadow-sm',
    cta: 'border border-warn/40 text-warn hover:bg-warn/10',
    label: '中风险',
  },
}

export function RiskCards({ cards }: { cards: RiskCard[] }) {
  if (!cards.length) return null
  return (
    <div className="space-y-2">
      {/* 这行小标题是在回答「这几张卡是谁放上来的」。没有它，用户会把它读成一个静态的
          告警条；有了它，它才是 Agent 的第一次主动发言，后面点进去的排查才接得上。 */}
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
        星轨主动发现 · 无需提问
      </div>
      <div className="space-y-3">
        {cards.map(c => {
          const s = SEVERITY_STYLE[c.severity]
          return (
            <div key={c.id} className={`flex rounded-lg border overflow-hidden ${s.wrap}`}>
              <div className={`w-1 shrink-0 ${s.bar}`} />
              <div className="flex-1 flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium shrink-0 ${s.badge}`}>
                      {s.label}
                    </span>
                    <div className="font-semibold text-[15px] text-slate-900 truncate">{c.title}</div>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 truncate">{c.detail}</div>
                </div>
                {/* 两个动作的主次是刻意分开的：排查是这个产品要讲的事，推送只是把结论
                    带出系统。推送做成次要样式，免得演示时第一眼被引到飞书那条支线上去。
                    max-w 是给推送失败原因留的——飞书的错误原文可能很长，不限宽会把
                    左边的风险标题挤没。 */}
                <div className="shrink-0 flex items-center gap-1 max-w-[22rem] justify-end">
                  <NotifyButton title={c.title} detail={c.detail}
                                severity={c.severity} question={c.question} />
                  <button onClick={() => askAgent(c.question)}
                    className={`shrink-0 text-sm font-medium px-3.5 py-1.5 rounded-md
                                whitespace-nowrap transition-colors ${s.cta}`}>
                    让 Agent 排查 →
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
