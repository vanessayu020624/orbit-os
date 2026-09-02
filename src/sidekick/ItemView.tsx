import type { Item } from './SidekickProvider'
import { useSidekick } from './SidekickProvider'
import { PlanChecklist } from './PlanChecklist'
import { ToolCallCard } from './ToolCallCard'
import { ConfirmCard } from './ConfirmCard'
import { ClarifyCard } from './ClarifyCard'
import { FinalAnswer } from './FinalAnswer'

/**
 * 一条对话项的渲染。桌面侧栏和移动端首屏共用同一份。
 *
 * 拆出来是为了保证一件事：确认卡、澄清卡、溯源 chip 在手机上和桌面上是**同一个组件**。
 * 如果移动端另写一套简化版，第一次改了确认话术、加了新的事件类型，两边就开始漂移，
 * 而漂移最先丢的一定是这几张卡上的安全语义（要不要确认、按了哪个口径）。
 * 布局可以两套，卡片只能有一套。
 */
export function ItemView({ item }: { item: Item }) {
  const c = useSidekick()
  const it = item

  switch (it.k) {
    case 'user':
      return <div className="text-sm bg-brand text-white rounded-lg px-3 py-2 ml-8">{it.text}</div>
    case 'plan':
      return <PlanChecklist plan={it.plan} states={c.steps} amendedIds={c.amended} />
    case 'tool':
      return <ToolCallCard {...it} />
    case 'confirm':
      return <ConfirmCard {...it} onDecide={ok => c.decide(it.id, ok)} />
    case 'clarify':
      return <ClarifyCard req={it.req} chosen={it.chosen} onChoose={ch => c.clarify(it.id, ch)} />
    case 'final':
      return <FinalAnswer text={it.text} refs={it.refs} />
    case 'error':
      return <div className="text-xs text-danger bg-danger/5 rounded p-2">{it.text}</div>
    case 'retry':
      return (
        <div className="text-xs bg-slate-50 border rounded p-2 space-y-1.5">
          <div className="text-slate-500">{it.hint}</div>
          <button onClick={() => c.ask(it.q)} disabled={c.busy}
            className="px-2 py-1 rounded border text-slate-600 hover:border-brand hover:text-brand
                       disabled:opacity-40">重新问一次</button>
        </div>
      )
    case 'divider':
      return (
        <div className="flex items-center gap-2 py-1">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-[10px] text-slate-400 whitespace-nowrap">{it.text}</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>
      )
  }
}
