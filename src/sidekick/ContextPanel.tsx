import { useState } from 'react'
import { HISTORY_TURNS } from '../agent/summarize'
import { useSidekick } from './SidekickProvider'

/**
 * 「模型这次到底带了什么上下文」的可展开面板。
 *
 * 为什么值得单独做：多轮记忆是最容易被当成玄学的一块——用户追问「那个订单」时对了，
 * 换个问法又不对，看不见的东西没法判断也没法申诉。把纳入的轮次、折叠出来的摘要、
 * 以及上一次实际发出的输入 token 摆出来，记忆就从「感觉」变成了可核对的事实。
 * 这也是演示里回答「你们怎么控制上下文成本」最直接的一屏。
 */
export function ContextPanel() {
  const [open, setOpen] = useState(false)
  const { activeConversation: conv } = useSidekick()
  const { history, summary, lastPromptTokens } = conv

  // 一轮都还没有、也没有摘要时不占位：空会话下这一行只是噪音。
  if (!history.length && !summary) return null

  return (
    <div className="text-[11px] border rounded bg-slate-50/60">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-slate-500 hover:text-brand">
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        <span>上下文</span>
        <span className="text-slate-400">
          原样带 {history.length} 轮{summary ? ' + 更早的摘要' : ''}
          {lastPromptTokens ? ` · 上次输入 ${lastPromptTokens} tokens` : ''}
        </span>
      </button>

      {open && (
        <div className="px-2.5 pb-2 space-y-2 text-slate-500 leading-relaxed">
          {summary && (
            <div>
              <div className="text-slate-400 mb-0.5">更早对话的摘要（由模型异步生成）</div>
              <div className="bg-white border rounded px-2 py-1.5">{summary}</div>
            </div>
          )}
          <div>
            <div className="text-slate-400 mb-0.5">原样发送的最近 {history.length} 轮</div>
            <ol className="space-y-0.5 list-decimal list-inside">
              {history.map((t, i) => (
                <li key={i} className="truncate" title={t.q}>{t.q}</li>
              ))}
            </ol>
          </div>
          <div className="text-slate-400 border-t pt-1.5">
            超过 {HISTORY_TURNS} 轮的部分不再原样发送，会折叠进上面的摘要。
            切换角色会开一条属于新角色的会话，上下文不跨角色带过去。
          </div>
        </div>
      )}
    </div>
  )
}
