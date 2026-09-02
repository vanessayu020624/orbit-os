import { useState } from 'react'

interface Props {
  title: string
  detail: string
  severity: 'high' | 'medium'
  question?: string
}

type State =
  | { phase: 'idle' | 'sending' | 'sent' }
  | { phase: 'error'; reason: string }

/**
 * 从服务端响应里挖出一句人能看懂的话。
 *
 * 不能只 catch 一个「推送失败」了事：这条链路上会失败的地方各不相同，
 * 而用户能做的动作完全取决于是哪一种——没配环境变量要去 Cloudflare 加变量、
 * 19021 要去核对加签密钥、机器人被移出群要去拉回来。给个红点等于让人去猜。
 *
 * 特别是 `vite dev` 下 /api/notify 不存在，请求会落到 SPA fallback 拿回一份 index.html，
 * r.json() 抛出的是「Unexpected token '<'」——一句和飞书毫无关系的报错，
 * 这里直接翻译成「本地开发没有 Pages Function」。
 */
async function readError(r: Response): Promise<string> {
  let body: Record<string, unknown> | null = null
  try {
    body = await r.json() as Record<string, unknown>
  } catch {
    return r.status === 404 || r.status === 405
      ? '本地开发环境没有 /api/notify（Pages Function 只在部署后生效）'
      : `服务端返回了非 JSON 内容（HTTP ${r.status}）`
  }
  if (typeof body?.message === 'string') return body.message
  if (typeof body?.error === 'string') return `${body.error}（HTTP ${r.status}）`
  return `推送失败（HTTP ${r.status}）`
}

/** 把一张风险卡推到飞书群。自包含：父组件只管把卡片字段传进来。 */
export function NotifyButton({ title, detail, severity, question }: Props) {
  const [state, setState] = useState<State>({ phase: 'idle' })

  async function push() {
    setState({ phase: 'sending' })
    try {
      const r = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, detail, severity, question }),
      })
      // 只有 HTTP 2xx 才算发出去了。服务端已经把飞书 body 里的非 0 code 转成了 4xx/5xx，
      // 所以这里不需要、也不应该再去猜一次「到底成没成」。
      if (!r.ok) return setState({ phase: 'error', reason: await readError(r) })
      setState({ phase: 'sent' })
    } catch (e) {
      setState({ phase: 'error', reason: `请求没能发出：${String(e)}` })
    }
  }

  const sending = state.phase === 'sending'
  return (
    <span className="inline-flex items-center gap-2 min-w-0 overflow-hidden">
      <button
        onClick={push}
        disabled={sending}
        className="shrink-0 text-sm text-brand hover:text-brand-dark font-medium px-3 py-1.5
                   rounded-md hover:bg-brand/5 whitespace-nowrap disabled:opacity-50
                   disabled:cursor-not-allowed">
        {state.phase === 'sent' ? '再推一次' : '推送到飞书'}
      </button>
      {sending && <span className="text-xs text-slate-400 whitespace-nowrap">推送中…</span>}
      {state.phase === 'sent' && <span className="text-xs text-ok whitespace-nowrap">已推送</span>}
      {state.phase === 'error' && (
        // 失败原因就地铺开而不是塞进 tooltip：演示时鼠标不会停在一个红点上等它浮出来。
        // truncate 只截显示，title 里留全文，长错误（飞书原文可能很长）也能看到全部。
        <span className="text-xs text-danger truncate min-w-0" title={state.reason}>
          推送失败：{state.reason}
        </span>
      )}
    </span>
  )
}
