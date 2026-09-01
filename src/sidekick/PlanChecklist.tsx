import type { Plan } from '../lib/types'

export type StepState = 'pending' | 'running' | 'done'

export function PlanChecklist(
  { plan, states, amendedIds }: { plan: Plan; states: Record<string, StepState>; amendedIds: Set<string> }
) {
  return (
    <div className="rounded-lg border bg-slate-50 p-3">
      <div className="text-xs font-medium text-slate-500 mb-2">执行计划</div>
      <div className="text-sm font-medium mb-2.5">{plan.goal}</div>
      <ol className="space-y-1.5">
        {plan.steps.map(s => {
          const st = states[s.id] ?? 'pending'
          return (
            <li key={s.id}
                className={`flex items-start gap-2 text-sm transition-colors ${
                  amendedIds.has(s.id) ? 'bg-warn/15 -mx-1 px-1 rounded' : ''}`}>
              <span className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${
                st === 'done' ? 'bg-ok border-ok text-white'
                : st === 'running' ? 'border-brand text-brand animate-pulse'
                : 'border-slate-300 text-transparent'}`}>
                {st === 'done' ? '✓' : st === 'running' ? '●' : '·'}
              </span>
              <span className={st === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'}>
                {s.title}
                {amendedIds.has(s.id) && <span className="ml-1 text-warn text-xs">新增</span>}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
