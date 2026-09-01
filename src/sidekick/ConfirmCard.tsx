export function ConfirmCard(
  { summary, toolName, resolved, onDecide }:
  { summary: string; toolName: string; resolved?: boolean; onDecide: (ok: boolean) => void }
) {
  return (
    <div className={`rounded-lg border-2 p-3 ${
      resolved === undefined ? 'border-warn bg-warn/5'
      : resolved ? 'border-ok bg-ok/5' : 'border-idle bg-slate-50'}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-warn">需要你确认</span>
        <code className="text-[10px] font-mono text-slate-400">{toolName}</code>
      </div>
      <div className="text-sm text-slate-700 leading-relaxed mb-3">{summary}</div>
      {resolved === undefined ? (
        <div className="flex gap-2">
          <button onClick={() => onDecide(true)}
            className="px-3 py-1.5 rounded bg-brand text-white text-sm hover:bg-brand-dark">
            批准执行
          </button>
          <button onClick={() => onDecide(false)}
            className="px-3 py-1.5 rounded border text-sm text-slate-600 hover:bg-slate-50">
            拒绝
          </button>
        </div>
      ) : (
        <div className={`text-xs ${resolved ? 'text-ok' : 'text-slate-400'}`}>
          {resolved ? '✓ 已批准并执行' : '已拒绝，Agent 将调整建议'}
        </div>
      )}
    </div>
  )
}
