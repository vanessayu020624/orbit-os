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
/** 429（错误码 1302）：免费档并发上限 2 路被占满。与真断网必须区分——面向用户的文案不一样。 */
export class LlmRateLimited extends LlmUnavailable {}

export interface Usage { prompt_tokens: number; completion_tokens: number; total_tokens: number }

/** 每次成功调用的用量。演示时用来现场报「这次问询花了多少 token」，也是文档里成本数据的来源。 */
export const usageLog: Usage[] = []
export function resetUsage() { usageLog.length = 0 }
export function sumUsage(): Usage {
  return usageLog.reduce((a, u) => ({
    prompt_tokens: a.prompt_tokens + u.prompt_tokens,
    completion_tokens: a.completion_tokens + u.completion_tokens,
    total_tokens: a.total_tokens + u.total_tokens,
  }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
}

async function chatOnce(opts: ChatOptions, withThinking = true): Promise<ChatMessage> {
  const body: Record<string, unknown> = {
    model: 'glm-4.5-flash',
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
  }
  if (opts.tools?.length) { body.tools = opts.tools; body.tool_choice = 'auto' }
  if (opts.jsonMode) body.response_format = { type: 'json_object' }
  // GLM-4.5 默认开思考链，实测单次 26 秒、绝大部分输出 token 花在 reasoning_content 上，
  // 对演示节奏是致命的。关掉它：线上实测 26s→6.4s、输出 token 489→34、reasoning_content 消失，
  // 且 tool_calls 照常返回。chat() 里仍保留「服务端不认就去掉它重试」的兜底，防智谱改行为。
  if (withThinking) body.thinking = { type: 'disabled' }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 45000)
  try {
    const r = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctl.signal,
    })
    if (r.status === 429) throw new LlmRateLimited('RATE_LIMIT')
    if (!r.ok) throw new LlmUnavailable(`HTTP ${r.status}`)
    const j = await r.json()
    const msg = j?.choices?.[0]?.message
    if (!msg) throw new LlmUnavailable('响应缺少 choices')
    if (j?.usage?.total_tokens) usageLog.push(j.usage as Usage)
    return msg as ChatMessage
  } catch (e) {
    throw e instanceof LlmUnavailable ? e : new LlmUnavailable(String(e))
  } finally {
    clearTimeout(timer)
  }
}

export async function chat(opts: ChatOptions): Promise<ChatMessage> {
  try {
    return await chatOnce(opts)
  } catch (e) {
    // 限流退避重试一次。免费档并发上限 2 路，撞车是秒级的，这一次重试往往就够了；
    // 若第二次仍被占满，交给上层切录播。
    if (e instanceof LlmRateLimited) {
      await new Promise(r => setTimeout(r, 6000))
      return await chatOnce(opts)
    }
    // thinking 参数已线上实测可用，这里是防御：若服务端哪天不认了（非 429 的 4xx），
    // 去掉它重试一次。宁可慢，不可挂。
    if (e instanceof LlmUnavailable && !(e instanceof LlmRateLimited)
        && /HTTP 4\d\d/.test(e.message)) {
      return await chatOnce(opts, false)
    }
    throw e
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
