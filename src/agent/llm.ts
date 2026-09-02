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
/** 429：上游限流。与真断网必须区分——面向用户的文案不一样。 */
export class LlmRateLimited extends LlmUnavailable {}

/**
 * 通义千问（DashScope OpenAI 兼容模式）。换掉智谱 GLM-4.5-Flash 的原因：
 * 免费档速率上限（错误码 1302）在两人同时演示时必挂，而一次问询要跑
 * 规划器 1 次 + 执行器最多 12 次，撞限流几乎是必然事件。
 *
 * 选 qwen-plus 而不是 qwen3.7-plus：实测单次延迟 0.42s vs 2.44s。执行器最多 12 轮，
 * 前者最坏 ~5s、后者 ~30s，对演示节奏是决定性差异。两者的 function calling 与
 * response_format: json_object 均已实测可用，能力上不构成瓶颈。要换推理模型改这一行。
 */
export const MODEL = 'qwen-plus'

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

/**
 * 推理模型（qwen3.7-plus 等）在返回 tool_calls 的同时还会带 reasoning_content。
 * 这条 assistant 消息会被 loop.ts 原样 push 回 messages 再发给上游，
 * 带着这个非标准字段回传属于未定义行为，且白白占 prompt token。这里剥掉。
 */
function stripToChatMessage(msg: Record<string, unknown>): ChatMessage {
  return {
    role: msg.role as ChatMessage['role'],
    content: (msg.content ?? null) as string | null,
    ...(msg.tool_calls ? { tool_calls: msg.tool_calls as ChatMessage['tool_calls'] } : {}),
  }
}

async function chatOnce(opts: ChatOptions): Promise<ChatMessage> {
  const body: Record<string, unknown> = {
    model: MODEL,
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
    if (r.status === 429) throw new LlmRateLimited('RATE_LIMIT')
    if (!r.ok) throw new LlmUnavailable(`HTTP ${r.status}`)
    const j = await r.json()
    const msg = j?.choices?.[0]?.message
    if (!msg) throw new LlmUnavailable('响应缺少 choices')
    if (j?.usage?.total_tokens) usageLog.push(j.usage as Usage)
    return stripToChatMessage(msg as Record<string, unknown>)
  } catch (e) {
    throw e instanceof LlmUnavailable ? e : new LlmUnavailable(String(e))
  } finally {
    clearTimeout(timer)
  }
}

/** 限流退避的等待毫秒数。抽出来是为了能在测试里断言退避序列，不用真的等。 */
export const BACKOFF_MS = [1500, 4000, 9000]

export async function chat(opts: ChatOptions): Promise<ChatMessage> {
  let last: unknown
  // 撞限流是秒级抖动，指数退避重试三次远比只退一次 6 秒有效：
  // 旧实现固定退避一次，第二次仍撞上就直接切录播，这正是线上「LLM 服务不可用」的成因。
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      return await chatOnce(opts)
    } catch (e) {
      last = e
      if (!(e instanceof LlmRateLimited) || attempt === BACKOFF_MS.length) break
      await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]))
    }
  }
  throw last
}

/** 从可能带 markdown 围栏的文本里抠出 JSON。模型偶尔不听话。 */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
  if (s < 0 || e < 0) throw new Error('无法从响应中解析 JSON')
  return JSON.parse(raw.slice(s, e + 1)) as T
}
