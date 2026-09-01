import { useState } from 'react'

export function ToolCallCard(
  { name, args, result, ms }: { name: string; args: unknown; result?: unknown; ms?: number }
) {
  const [open, setOpen] = useState(false)
  const pending = result === undefined
  const denied = (result as any)?.error === 'PERMISSION_DENIED'
  const notFound = (result as any)?.found === false
  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          pending ? 'bg-warn animate-pulse' : denied ? 'bg-danger' : notFound ? 'bg-idle' : 'bg-ok'}`} />
        <code className="text-xs font-mono text-slate-700 flex-1 truncate">{name}</code>
        {ms !== undefined && <span className="text-[10px] text-slate-400">{ms}ms</span>}
        <span className="text-slate-300 text-xs">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="border-t bg-slate-50 p-2.5 space-y-2 text-[11px] font-mono">
          <div>
            <div className="text-slate-400 mb-0.5">入参</div>
            <pre className="whitespace-pre-wrap break-all text-slate-600">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
          {!pending && (
            <div>
              <div className="text-slate-400 mb-0.5">出参</div>
              <pre className="whitespace-pre-wrap break-all text-slate-600 max-h-56 overflow-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
