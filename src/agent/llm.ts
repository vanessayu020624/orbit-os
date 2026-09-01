export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export interface ChatOptions {
  messages: ChatMessage[]
  tools?: unknown[]
  jsonMode?: boolean
  temperature?: number
}

export class LlmUnavailable extends Error {}

export async function chat(opts: ChatOptions): Promise<ChatMessage> {
  const body: Record<string, unknown> = {
    model: 'glm-4.5-flash',
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
  }
  if (opts.tools?.length) { body.tools = opts.tools; body.tool_choice = 'auto' }
  if (opts.jsonMode) body.response_format = { type: 'json_object' }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 45000)
  try {
    const r = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctl.signal,
    })
    if (!r.ok) throw new LlmUnavailable(`HTTP ${r.status}`)
    const j = await r.json()
    const msg = j?.choices?.[0]?.message
    if (!msg) throw new LlmUnavailable('响应缺少 choices')
    return msg as ChatMessage
  } catch (e) {
    throw e instanceof LlmUnavailable ? e : new LlmUnavailable(String(e))
  } finally {
    clearTimeout(timer)
  }
}

/** 从可能带 markdown 围栏的文本里抠出 JSON。GLM 偶尔不听话。 */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
  if (s < 0 || e < 0) throw new Error('无法从响应中解析 JSON')
  return JSON.parse(raw.slice(s, e + 1)) as T
}
