import { useState } from 'react'
import type { ClarifyRequest } from '../lib/types'

/**
 * 澄清卡：Agent 在动手之前停下来，先把话对齐。
 *
 * 三个刻意的设计，都是在防同一件事——把认知负担甩回用户：
 *
 * 1. 【给选项，不给开放式反问】能枚举候选时一定枚举出来，让他点一下就走。
 *    「能再详细说说吗」是把问题原样退回去，用户还得自己想该怎么描述才算够详细。
 * 2. 【永远有一个不回答的出口】右边那个「按默认口径继续」不是次要按钮，是这张卡成立的前提。
 *    没有它，一次误判的澄清就能把整个对话卡死，而澄清判定永远不可能百分之百准。
 * 3. 【选完之后卡片留在原地，并写清是谁定的】「你选了 X」和「系统按 X 处理」在结论的
 *    可信度上完全是两回事。收起来会让人事后无法判断这个数字是按什么口径算的。
 *
 * 实在枚举不出候选（悬空指代那一类）时才退化成输入框，而不是一上来就给输入框。
 */
export function ClarifyCard(
  { req, chosen, onChoose }:
  { req: ClarifyRequest; chosen?: string | null; onChoose: (choice: string | null) => void }
) {
  const [typed, setTyped] = useState('')
  const settled = chosen !== undefined

  if (settled) {
    return (
      <div className="rounded-lg border bg-slate-50 p-3">
        <div className="text-xs font-medium text-slate-500 mb-1.5">已对齐口径</div>
        <div className="text-sm text-slate-700 leading-relaxed">{req.ask}</div>
        <div className={`text-xs mt-2 ${chosen ? 'text-ok' : 'text-warn'}`}>
          {chosen
            ? `✓ 你选择了：${chosen}`
            : `未选择，已按默认口径继续：${req.fallback}（结论里会标明）`}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border-2 border-brand/40 bg-brand/[0.03] p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
        <span className="text-xs font-medium text-brand">先对齐一下再查</span>
      </div>
      <div className="text-sm text-slate-700 leading-relaxed">{req.ask}</div>
      <div className="text-xs text-slate-400 mt-1 leading-relaxed">{req.reason}</div>

      {req.options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {req.options.map(o => (
            <button key={o.label} onClick={() => onChoose(o.refine)}
              className="text-xs px-2.5 py-1.5 rounded-full border border-brand/40 text-brand
                         hover:bg-brand hover:text-white transition-colors">
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex gap-2 mt-2.5">
          <input value={typed} onChange={e => setTyped(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && typed.trim() && onChoose(typed.trim())}
            placeholder="直接输入名称或单号"
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md border text-xs outline-none focus:border-brand" />
          <button onClick={() => typed.trim() && onChoose(typed.trim())} disabled={!typed.trim()}
            className="px-2.5 py-1.5 rounded-md bg-brand text-white text-xs disabled:opacity-40">
            确定
          </button>
        </div>
      )}

      <button onClick={() => onChoose(null)}
        className="mt-2 text-[11px] text-slate-400 hover:text-slate-600 underline underline-offset-2">
        跳过，按「{req.fallback}」继续
      </button>
    </div>
  )
}
