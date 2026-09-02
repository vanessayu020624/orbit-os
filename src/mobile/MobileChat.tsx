import { useEffect, useRef } from 'react'
import { useStore } from '../lib/store'
import { buildRiskCards } from '../lib/risk'
import { presetsFor, useSidekick } from '../sidekick/SidekickProvider'
import { ItemView } from '../sidekick/ItemView'

/**
 * 手机首屏 = 对话。
 *
 * 桌面版首屏是仪表盘，星轨在右侧栏；手机上没有「侧」，必须选一个当主角。
 * 选对话不是因为它更好看，是因为在手机上用这个系统的场景本来就是「路上被问一句、
 * 要一个结论」——翻六张报表那件事发生在工位上。风险卡留在对话上方，
 * 因为它是 Agent 的主动发言，属于同一条时间线，不是另一个页面。
 */
export function MobileChat() {
  const { db, currentUser } = useStore()
  const c = useSidekick()
  const cards = buildRiskCards(db, currentUser)
  const presets = presetsFor(currentUser.role)
  const endRef = useRef<HTMLDivElement>(null)

  // 手机屏幕矮，一张计划卡就能把之前的内容顶出视野。不自动跟到底部，
  // 用户每出一条都要手动划一次。
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [c.items.length, c.busy])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-auto px-3 py-3 space-y-2.5">
        {!c.items.length && (
          <>
            {cards.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                  星轨主动发现 · 无需提问
                </div>
                {cards.map(k => (
                  <button key={k.id} onClick={() => c.ask(k.question)} disabled={c.busy}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 disabled:opacity-40 ${
                      k.severity === 'high'
                        ? 'bg-danger/5 border-danger/25' : 'bg-warn/5 border-warn/25'}`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                        k.severity === 'high' ? 'bg-danger text-white' : 'bg-warn/15 text-warn'}`}>
                        {k.severity === 'high' ? '高风险' : '中风险'}
                      </span>
                      <span className="text-sm font-medium text-slate-900 truncate">{k.title}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{k.detail}</div>
                    <div className={`text-xs font-medium mt-1.5 ${
                      k.severity === 'high' ? 'text-danger' : 'text-warn'}`}>让星轨排查 →</div>
                  </button>
                ))}
              </div>
            )}
            <div className="text-sm text-slate-400 px-1 pt-2 leading-relaxed">
              问我关于客户、商机、订单、库存、采购的任何问题。<br />
              涉及数据变更时我会先请你确认。结论里的编号点开就是原始记录。
            </div>
          </>
        )}
        {c.items.map((it, i) => <ItemView key={i} item={it} />)}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t bg-white px-3 py-2 space-y-2">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {presets.map(p => (
            <button key={p} onClick={() => c.ask(p)} disabled={c.busy}
              className="shrink-0 text-[11px] px-2.5 py-1 rounded-full border text-slate-500
                         disabled:opacity-40">
              {p.length > 14 ? p.slice(0, 14) + '…' : p}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={c.input} onChange={e => c.setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && c.ask(c.input)}
            placeholder={c.busy ? '执行中…' : '问点什么…'}
            disabled={c.busy}
            /* text-base 是刻意的：iOS Safari 在 16px 以下的输入框会自动放大整页，
               放大之后底部导航就被顶出屏幕了。 */
            className="flex-1 px-3 py-2.5 rounded-lg border text-base outline-none focus:border-brand" />
          <button onClick={() => c.ask(c.input)} disabled={c.busy}
            className="px-4 py-2.5 rounded-lg bg-brand text-white text-sm disabled:opacity-40">发送</button>
        </div>
      </div>
    </div>
  )
}
