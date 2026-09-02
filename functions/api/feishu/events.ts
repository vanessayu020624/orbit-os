/**
 * 飞书自建应用的事件回调：在群里 @星轨 就能直接问，答案回到同一条消息下面。
 *
 * 和 notify.ts 的区别不是「多了一个方向」，而是整条链路都换了：
 * webhook 是我们把已经算好的卡片推出去，这里是飞书把用户的问题推进来、
 * 由 Worker 现跑一遍执行器再回答。所以身份、权限、HITL 全都要在这一侧重新成立。
 *
 * 三条设计约束，都不是妥协，是这条链路成立的前提：
 *
 * 1) **必须 3 秒内返回 200。** 飞书没等到就判定失败并重推，最多 3 次，
 *    表现是群里同一个问题被回答三遍。而一次问询要跑 6~40 秒。
 *    所以这里收到就 ACK，真正的执行丢进 waitUntil。
 *
 * 2) **权限由 OrbitOS 决定，不由飞书决定。** 飞书只提供 open_id，
 *    映射成哪个 OrbitOS 用户由 FEISHU_USER_MAP 这个环境变量说了算。
 *    没配到的人一律不给答案——不是「降级成只读」，是不回答。
 *    在一个演示 CRM 里放行一个陌生人，和在真实系统里放行是同一个动作。
 *
 * 3) **写操作在这一侧永远拿不到批准。** 见 agentRun.ts 里 requestConfirm 的说明。
 *    Agent 照样会给出建议，但「执行」这一步要回到网页上按。
 */
import {
  parseCallback, verifySignature, verifyToken, extractText,
  getTenantAccessToken, replyMessage,
  buildAnswerCard, buildBlockedWriteCard, mapFeishuUser, FeishuApiError,
} from '../../lib/feishu'
import { runAgentServerSide } from '../../lib/agentRun'

interface Env {
  FEISHU_APP_ID?: string
  FEISHU_APP_SECRET?: string
  /** 配了就走验签（推荐）。没配就退回 Verification Token 比对。 */
  FEISHU_ENCRYPT_KEY?: string
  FEISHU_VERIFICATION_TOKEN?: string
  /** `{"ou_xxx":"U-006"}`。没有它谁都问不了，这是有意的。 */
  FEISHU_USER_MAP?: string
  /** 卡片按钮回跳的站点根地址。缺省用请求自己的 origin，一般不需要配。 */
  APP_BASE_URL?: string
}

/** 从事件体里挖出这一轮真正要用的东西。挖不全就不是我们要处理的事件。 */
export interface IncomingMessage {
  eventId: string
  messageId: string
  openId: string
  text: string
}

/**
 * 纯函数，好让「什么样的事件该被忽略」这件事能被单测钉死——
 * 而不是等到线上收到一条表情包消息、整个回调 500。
 *
 * 会被丢掉的情况：非 im.message.receive_v1、机器人自己发的、非文本消息、
 * @ 完没写正文。每一种都会真实发生，且都不该报错。
 */
export function parseMessageEvent(payload: Record<string, unknown>): IncomingMessage | null {
  const header = payload.header as { event_id?: unknown; event_type?: unknown } | undefined
  if (header?.event_type !== 'im.message.receive_v1') return null

  const event = payload.event as Record<string, unknown> | undefined
  const message = event?.message as Record<string, unknown> | undefined
  const sender = event?.sender as { sender_id?: { open_id?: unknown }; sender_type?: unknown } | undefined
  if (!message || !sender) return null

  // 机器人自己发的消息也会回推。不挡掉的话它会回答自己的回答，无限循环。
  if (sender.sender_type === 'app' || sender.sender_type === 'bot') return null
  if (message.message_type !== 'text') return null

  const openId = sender.sender_id?.open_id
  const messageId = message.message_id
  const eventId = header?.event_id
  const content = message.content
  if (typeof openId !== 'string' || typeof messageId !== 'string'
    || typeof eventId !== 'string' || typeof content !== 'string') return null

  const text = extractText(content, message.mentions as unknown[] | undefined)
  if (!text) return null
  return { eventId, messageId, openId, text }
}

/**
 * 回跳地址。role 必须带上：少了它，从飞书点进来的人落在默认身份上，
 * 看到的数据范围和卡片里那条结论不一样，而两边都没有任何提示。
 */
export function buildWebUrl(origin: string, role: string, question: string): string {
  const u = new URL('/', origin)
  u.searchParams.set('role', role)
  u.searchParams.set('ask', question)
  return u.toString()
}

/**
 * 事件去重。
 *
 * 只在当前隔离实例内有效——Workers 每个实例有自己的内存，换实例就失效。
 * 所以它挡不住所有重复，只挡最常见的那种：同一个实例上几秒内的重推。
 * 真要做严格幂等得上 KV 或 D1，那是这个演示项目里不成比例的复杂度。
 * 写在这里是为了别人读到时知道边界在哪，而不是以为已经万无一失。
 */
const seenEvents = new Set<string>()
const SEEN_CAP = 500

export function markSeen(eventId: string): boolean {
  if (seenEvents.has(eventId)) return false
  if (seenEvents.size >= SEEN_CAP) {
    // Set 迭代按插入序，删最老的那个就是 FIFO。留着不清会一直涨到实例被回收。
    for (const k of seenEvents) { seenEvents.delete(k); break }
  }
  seenEvents.add(eventId)
  return true
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

/** 出错也要在群里说人话。只在日志里报错等于群里永远没反应，用户只会以为机器人挂了。 */
async function say(env: Env, messageId: string, card: unknown) {
  try {
    const token = await getTenantAccessToken(env.FEISHU_APP_ID ?? '', env.FEISHU_APP_SECRET ?? '')
    await replyMessage(token, messageId, card)
  } catch (e) {
    const detail = e instanceof FeishuApiError ? `${e.code} ${e.msg}` : String(e)
    console.error('[feishu] 回复失败：', detail)
  }
}

function noticeCard(title: string, body: string, template: string) {
  return {
    config: { wide_screen_mode: true },
    header: { template, title: { tag: 'plain_text', content: title } },
    elements: [{ tag: 'div', text: { tag: 'plain_text', content: body } }],
  }
}

/**
 * 真正干活的部分，跑在 waitUntil 里。
 *
 * ⚠️ 一次问询最长 45 秒（TIMEOUT_MS）× 最多 12 轮，理论上会超出 Worker 给后台任务的
 * 时限。实测单次问询在 6~15 秒，够用；但这是这条链路已知的上限，不是没有上限。
 * 真正要抗住的做法是把执行拆成队列 + 轮询，那是另一个量级的工程。
 */
async function handle(env: Env, origin: string, msg: IncomingMessage) {
  const orbitUserId = mapFeishuUser(msg.openId, env.FEISHU_USER_MAP)
  if (!orbitUserId) {
    // 把 open_id 原样打在卡片上：管理员要配 FEISHU_USER_MAP 就得知道这串 id，
    // 而它在飞书界面上并不好找。这一步省掉的话，每个新同事都得来问一次。
    return say(env, msg.messageId, noticeCard(
      '还没有为你分配 OrbitOS 身份',
      `星轨的每一条结论都是按某个具体角色的数据权限算出来的，没有身份就没法回答。\n\n`
      + `请管理员把下面这行加进 FEISHU_USER_MAP：\n"${msg.openId}": "U-006"\n\n`
      + `（U-006 换成你在 OrbitOS 里的用户 id）`,
      'grey',
    ))
  }

  const r = await runAgentServerSide({
    question: msg.text,
    orbitUserId,
    // Worker 的 fetch 不认相对路径，必须拼成绝对地址。
    chatEndpoint: new URL('/api/chat', origin).toString(),
  })

  const roleLabel = r.actor ? `${r.actor.roleLabel} · ${r.actor.name}` : orbitUserId
  const webUrl = buildWebUrl(origin, r.actor?.role ?? '', msg.text)

  if (!r.ok) {
    return say(env, msg.messageId, noticeCard(
      '这次没能给出结论',
      `${r.error ?? '未知原因'}\n\n左侧的客户、商机、订单、库存、应收数据不依赖模型，在 OrbitOS 里现在就能查。`,
      'red',
    ))
  }

  // 先发结论卡。被拦的写操作是补充说明，不是替代——用户仍然需要看到「为什么要做这件事」。
  await say(env, msg.messageId, buildAnswerCard({
    question: msg.text,
    answer: r.answer,
    roleLabel,
    webUrl,
    footnote: `调用了 ${r.toolCalls} 次工具${r.refs.length ? ` · 引用 ${r.refs.length} 条记录` : ''}`
      // 飞书这条链路没有「等用户点一下」这个动作，澄清闸只能按兜底口径往下走。
      // 那就必须写出来：群里的人看到的是一个语气笃定的数字，他有权知道口径是系统定的。
      + (r.assumption ? `\n口径由系统按默认值确定：${r.assumption}（要换口径请重新提问并写明）` : ''),
  }))

  if (r.blockedWrite) {
    await say(env, msg.messageId, buildBlockedWriteCard({
      actionLabel: r.blockedWrite.toolName,
      detail: r.blockedWrite.summary,
      roleLabel,
      webUrl,
    }))
  }
}

export async function handleEvents(
  request: Request, env: Env, waitUntil: (p: Promise<unknown>) => void,
): Promise<Response> {
  // 必须先拿原文再解析：验签算的是字节流，JSON.parse 再 stringify 回去键顺序和空格都会变，
  // 摘要必然对不上，而报错只有一句「签名不匹配」，查起来极难。
  const raw = await request.text()

  let cb
  try {
    cb = await parseCallback(raw, env.FEISHU_ENCRYPT_KEY)
  } catch (e) {
    return json(400, { error: 'BAD_CALLBACK', message: String(e) })
  }

  // URL 验证要在鉴权之前回：配置回调地址的那一刻还没有任何签名可验。
  if (cb.kind === 'challenge') return json(200, { challenge: cb.challenge })

  const encryptKey = env.FEISHU_ENCRYPT_KEY
  const passed = encryptKey
    ? await verifySignature(
        request.headers.get('X-Lark-Request-Timestamp') ?? '',
        request.headers.get('X-Lark-Request-Nonce') ?? '',
        encryptKey, raw, request.headers.get('X-Lark-Signature') ?? '')
    : verifyToken(cb.payload, env.FEISHU_VERIFICATION_TOKEN)
  if (!passed) {
    // 这个端点是公网可达的，且下游会真的花钱调模型。验不过就是验不过。
    return json(403, { error: 'BAD_SIGNATURE', message: '事件来源校验未通过' })
  }

  const msg = parseMessageEvent(cb.payload)
  // 不是我们要处理的事件（表情、机器人自己的话、空 @），照样回 200：
  // 回非 2xx 飞书会重推，而重推同一条它照样处理不了，只是白白刷三遍。
  if (!msg) return json(200, { ok: true, ignored: true })
  if (!markSeen(msg.eventId)) return json(200, { ok: true, deduped: true })

  const origin = env.APP_BASE_URL ?? new URL(request.url).origin
  // 立刻 ACK，执行丢到后台。顺序不能反：先跑再回 200 必然超 3 秒。
  waitUntil(handle(env, origin, msg).catch(e => console.error('[feishu] 处理失败：', e)))
  return json(200, { ok: true })
}

export const onRequestPost: PagesFunction<Env> = (ctx) =>
  handleEvents(ctx.request, ctx.env, (p) => ctx.waitUntil(p))
