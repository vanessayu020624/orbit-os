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
  /**
   * 'required' 强制这一轮必须调用工具，不允许直接输出正文。
   * 存在的唯一理由是实测复现的一类严重故障：执行器在第一轮就绕过所有工具、
   * 凭空编出营收/漏斗/单号（见 loop.ts 的「守卫 A」）。auto 挡不住，提示词也挡不住。
   */
  toolChoice?: 'auto' | 'required'
  /** 缺省 true。置 false 的调用不计入 usageLog——见 summarize.ts 的说明。 */
  countUsage?: boolean
}

export class LlmUnavailable extends Error {}
/** 429：上游限流。与真断网必须区分——面向用户的文案不一样。 */
export class LlmRateLimited extends LlmUnavailable {}
/**
 * 45 秒没回来，由 AbortController 掐断。
 *
 * 必须是独立的类：abort 抛出的是 DOMException，name 固定为 AbortError，但 message 在不同
 * 运行时里各不相同（浏览器 'signal is aborted without reason'、Node 'This operation was aborted'）。
 * 早期直接 String(e) 上屏，用户看到的就是「执行中断：Error: AbortError: signal is aborted
 * without reason」——一句用户完全无法处理的内部报错。分类在抛出点做，文案在 describeLlmError 做。
 */
export class LlmTimeout extends LlmUnavailable {}

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

/** 单次请求超时上限。执行器最多 12 轮，超时只掐单轮，不是整次问询的上限。 */
export const TIMEOUT_MS = 45000

/**
 * 上游代理的地址。浏览器里是相对路径 `/api/chat`，同源、由 Pages Function 转发。
 *
 * 做成可注入的，是因为飞书事件回调让同一份执行器要在 Worker 里再跑一遍，而 Worker 的
 * fetch 没有「当前页面」这个基准，相对路径会直接抛 TypeError: Invalid URL。
 * 服务端在入口处调一次 setChatEndpoint(new URL('/api/chat', request.url).toString()) 即可。
 *
 * 不改成「每次调用都传参」：那要穿透 loop.ts / summarize.ts / present.ts 三层签名，
 * 而这个值在一个运行时里自始至终只有一个。模块级变量是这里最小的改动面。
 */
let chatEndpoint = '/api/chat'

export function setChatEndpoint(url: string) { chatEndpoint = url }
/** 仅供测试复原，别在业务代码里用。 */
export function resetChatEndpoint() { chatEndpoint = '/api/chat' }

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
  if (opts.tools?.length) { body.tools = opts.tools; body.tool_choice = opts.toolChoice ?? 'auto' }
  if (opts.jsonMode) body.response_format = { type: 'json_object' }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(chatEndpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctl.signal,
    })
    if (r.status === 429) throw new LlmRateLimited('RATE_LIMIT')
    if (!r.ok) throw new LlmUnavailable(`HTTP ${r.status}`)
    // 必须显式标注返回体类型：DOM 里 Response.json() 是 any，Workers 运行时的类型定义里是 {}，
    // 不标注的话这段在浏览器侧能编过、在飞书回调那侧编译直接失败。
    const j = await r.json() as { choices?: { message?: unknown }[]; usage?: Usage }
    const msg = j?.choices?.[0]?.message
    if (!msg) throw new LlmUnavailable('响应缺少 choices')
    if (j.usage?.total_tokens && opts.countUsage !== false) usageLog.push(j.usage)
    return stripToChatMessage(msg as Record<string, unknown>)
  } catch (e) {
    if (e instanceof LlmUnavailable) throw e
    // 不靠 message 字符串判断超时——各运行时措辞不一致。signal.aborted 是唯一可靠的信号。
    if (ctl.signal.aborted) throw new LlmTimeout(`TIMEOUT ${TIMEOUT_MS}ms`)
    throw new LlmUnavailable(String(e))
  } finally {
    clearTimeout(timer)
  }
}

/** 限流退避的等待毫秒数。抽出来是为了能在测试里断言退避序列，不用真的等。 */
export const BACKOFF_MS = [1500, 4000, 9000]

export async function chat(opts: ChatOptions): Promise<ChatMessage> {
  let last: unknown
  // 撞限流是秒级抖动，指数退避重试三次远比只退一次 6 秒有效：
  // 旧实现固定退避一次，第二次仍撞上就直接判失败，这正是线上「LLM 服务不可用」的成因。
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

export type LlmFailureKind = 'timeout' | 'rate_limit' | 'network' | 'server' | 'unknown'

/**
 * 把异常翻译成一句用户能据此行动的话。
 *
 * 为什么值得单独抽一个函数：失败文案会出现在两个地方（loop.ts 的 error 事件、Sidekick 的失败卡），
 * 两处必须一致；而且「说清出了什么事 + 我现在能做什么」是这个项目对降级体验的硬要求——
 * 之前把 String(e) 直接上屏，用户拿到的是内部报错，等于没说。这里做成纯函数以便测试覆盖每一类。
 * 返回的 text 只讲这一次失败本身，不带「左侧数据仍可查」这类界面引导——那属于 UI 层。
 */
export function describeLlmError(e: unknown): { kind: LlmFailureKind; text: string } {
  if (e instanceof LlmTimeout) {
    return { kind: 'timeout', text: `模型 ${TIMEOUT_MS / 1000} 秒没有响应，这次问询已中断。通常重试一次就能跑通。` }
  }
  if (e instanceof LlmRateLimited) {
    return { kind: 'rate_limit', text: '模型调用太密集被限流了（已自动退避重试 3 次仍未成功）。等几秒再问一次即可。' }
  }
  const msg = e instanceof Error ? e.message : String(e)
  const http = msg.match(/HTTP (\d{3})/)
  if (http) {
    return { kind: 'server', text: `模型服务返回错误 ${http[1]}，这次问询没有完成。${
      http[1] === '401' || http[1] === '403' ? '通常是 API Key 未配置或已失效。' : '稍后重试即可。'}` }
  }
  if (/Failed to fetch|NetworkError|fetch failed|ENOTFOUND|ECONNREFUSED/i.test(msg)) {
    return { kind: 'network', text: '连不上模型服务，可能是网络不通或 /api/chat 未部署。' }
  }
  return { kind: 'unknown', text: `这次问询中断了：${msg}` }
}
