/**
 * 把首页的交期风险卡推到飞书群（自定义群机器人 webhook）。
 *
 * 走自定义机器人而不是自建应用 OAuth：后者要建应用、配权限、等审核，
 * 这个演示项目里没有任何一步是可复现的；webhook 只需要群主粘一个地址，
 * 面试现场能当场配、当场发。代价是只能往固定群发消息，这里正好够用。
 */

/** webhook 地址与加签密钥都只存在于 Cloudflare 的环境变量里，仓库和前端都拿不到。 */
interface Env {
  FEISHU_WEBHOOK_URL?: string
  FEISHU_WEBHOOK_SECRET?: string
}

/** 前端传过来的风险卡字段。故意不接受任意 JSON：卡片长什么样由服务端决定，前端只给数据。 */
export interface RiskNotification {
  title: string
  detail: string
  severity: 'high' | 'medium'
  /** 风险卡点开后灌进 Sidekick 的那句话。附在卡片末尾，收到消息的人知道回到系统里该问什么。 */
  question?: string
}

const SEVERITY = {
  high: { label: '高风险', template: 'red' },
  medium: { label: '中风险', template: 'orange' },
} as const

/**
 * 拼飞书交互式卡片。
 *
 * 全部用 plain_text 而不是 lark_md：detail 里带着 SKU-203、¥12.5 万这类字符串，
 * 一旦某天出现 `*` 或 `[` 就会被飞书当 markdown 解析，用户看到的是被吃掉的单号。
 * 卡片这点排版好看不值得拿数据准确性换。
 *
 * pushedAt 从外面传进来而不是在函数里取 now()：这样它是纯函数，卡片结构能被单测钉死。
 */
export function buildFeishuCard(n: RiskNotification, pushedAt: string) {
  const sev = SEVERITY[n.severity] ?? SEVERITY.medium
  const elements: unknown[] = [
    { tag: 'div', text: { tag: 'plain_text', content: n.detail } },
  ]
  if (n.question) {
    elements.push({ tag: 'hr' })
    elements.push({
      tag: 'div',
      text: { tag: 'plain_text', content: `建议追问：${n.question}` },
    })
  }
  elements.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: `Orbit OS 风险预警 · ${pushedAt}` }],
  })
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: sev.template,
        // 严重级别写进标题而不是只靠颜色：飞书的消息列表预览只有标题这一行文字，
        // 群里刷过去的时候颜色根本看不见。
        title: { tag: 'plain_text', content: `【${sev.label}】${n.title}` },
      },
      elements,
    },
  }
}

/**
 * 飞书加签：以 `timestamp + "\n" + secret` 为 HMAC-SHA256 的**密钥**、空串为消息体，
 * 结果 base64。密钥和消息体的位置和直觉相反，写反了飞书只会回一句 19021 sign match fail。
 *
 * 用 Web Crypto 而不是 node:crypto —— Workers 运行时没有后者，本地测试跑不出这个差异，
 * 只有部署上去才会 500。
 */
export async function signTimestamp(timestamp: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(`${timestamp}\n${secret}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new Uint8Array(0))
  let bin = ''
  for (const b of new Uint8Array(mac)) bin += String.fromCharCode(b)
  return btoa(bin)
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json' },
  })

function parse(body: unknown): RiskNotification | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.title !== 'string' || !b.title.trim()) return null
  if (typeof b.detail !== 'string') return null
  const severity = b.severity === 'high' ? 'high' : 'medium'
  return {
    title: b.title, detail: b.detail, severity,
    ...(typeof b.question === 'string' && b.question ? { question: b.question } : {}),
  }
}

/**
 * 与 onRequestPost 分开，是为了能在单测里直接喂一个假 env / 假 fetch 走完所有分支。
 * PagesFunction 的 ctx 类型在测试里构造不出来，这层薄壳是唯一无法被覆盖的代码。
 */
export async function handleNotify(request: Request, env: Env): Promise<Response> {
  const url = env.FEISHU_WEBHOOK_URL
  if (!url) {
    // 没配就必须报错。早期版本这里直接 return 200，界面上一片「已推送」而群里什么都没有——
    // 用户不会去查日志，他会以为对方收到了。静默成功比报错危险得多。
    return json(400, {
      error: 'NO_WEBHOOK',
      message: '未配置 FEISHU_WEBHOOK_URL，推送功能在当前部署上未启用',
    })
  }

  let payload: RiskNotification | null = null
  try {
    payload = parse(await request.json())
  } catch {
    payload = null
  }
  if (!payload) {
    return json(400, { error: 'BAD_REQUEST', message: '请求体缺少 title / detail 字段' })
  }

  const body: Record<string, unknown> = buildFeishuCard(payload, new Date().toISOString().slice(0, 16).replace('T', ' '))
  const secret = env.FEISHU_WEBHOOK_SECRET
  if (secret) {
    // 秒级、且飞书只接受一小时内的时间戳；毫秒传上去一律 19021。
    const timestamp = String(Math.floor(Date.now() / 1000))
    body.timestamp = timestamp
    body.sign = await signTimestamp(timestamp, secret)
  }

  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return json(502, { error: 'UPSTREAM_FAILED', message: `连接飞书失败：${String(e)}` })
  }

  const result = await upstream.json().catch(() => ({})) as Record<string, unknown>
  // 飞书对失败的推送照样回 HTTP 200，真正的结果在 body 里，而且新旧两套字段名都在用
  // （新版 code/msg，旧版 StatusCode/StatusMessage）。只看 upstream.ok 会把签名错误当成功。
  const code = Number(result.code ?? result.StatusCode ?? (upstream.ok ? 0 : -1))
  if (code !== 0) {
    const msg = String(result.msg ?? result.StatusMessage ?? `HTTP ${upstream.status}`)
    return json(502, {
      error: 'FEISHU_REJECTED', code, msg,
      message: `飞书拒绝了这条消息（code ${code}）：${msg}`,
    })
  }
  return json(200, { ok: true })
}

export const onRequestPost: PagesFunction<Env> = (ctx) => handleNotify(ctx.request, ctx.env)
