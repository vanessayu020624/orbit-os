/**
 * 飞书「自建应用」事件回调的协议层：解密、验签、拿 token、发消息、拼卡片。
 *
 * 和 api/notify.ts 的自定义群机器人是两条完全不同的路：webhook 只能单向推固定群、
 * 不需要任何鉴权状态；要让人在群里 @机器人 对话就必须走自建应用，
 * 于是多出来加密回调、Verification Token、tenant_access_token 这一整套东西。
 * 这里只做协议翻译，不含任何业务判断——上层怎么路由事件、怎么调 agent 与本文件无关。
 *
 * 全程 Web Crypto + atob/btoa，一处 node:crypto / Buffer 都不能有：
 * Pages Function 跑在 workers 运行时里，这两样都不存在，
 * 而 vitest 跑在 node 上照样能过——写错了本地全绿、线上每条消息 500。
 */

/** 飞书接口失败照样回 HTTP 200，真正的结果在 body 的 code 里，所以错误必须自己造。 */
export class FeishuApiError extends Error {
  constructor(readonly code: number, readonly msg: string, where: string) {
    super(`飞书拒绝了${where}（code ${code}）：${msg}`)
    this.name = 'FeishuApiError'
  }
}

const OPEN_API = 'https://open.feishu.cn/open-apis'

// ---------------------------------------------------------------------------
// 字节工具
// ---------------------------------------------------------------------------

/**
 * atob 返回的是「每个 char 的码位就是一个字节」的 binary string，
 * 直接 TextEncoder 编码会把 >0x7f 的字节当成 Unicode 码位再转成两三个字节，
 * 密文长度立刻不是 16 的倍数——所以只能一个字符一个字符抠 charCodeAt。
 */
function base64ToBytes(b64: string): Uint8Array {
  // 飞书不会换行，但有些网关会在长 base64 里插 \r\n，留着会让 atob 直接抛。
  const bin = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToHex(buf: ArrayBuffer): string {
  let hex = ''
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0')
  return hex
}

// ---------------------------------------------------------------------------
// 1. 回调解密与验签
// ---------------------------------------------------------------------------

/**
 * 解开飞书加密模式下的 `{"encrypt":"..."}`。
 *
 * 密钥不是 Encrypt Key 本身而是它的 SHA-256（正好 32 字节喂给 AES-256），
 * base64 解出来的**前 16 字节是 IV**、不是密文的一部分——这两处任意一处理解错，
 * 解出来的都是乱码而不是报错，日志里只会看到 JSON.parse 失败，很难往回倒查。
 *
 * PKCS#7 padding 没有手写：WebCrypto 的 AES-CBC 规定就带 PKCS#7，decrypt 会自己剥掉，
 * 再手动切一次尾巴会把明文最后几个字节吃掉。padding 不合法时它直接抛，
 * 这正好等价于「Encrypt Key 配错了」，比返回一段乱码好得多。
 */
export async function decryptEvent(encrypt: string, encryptKey: string): Promise<string> {
  if (!encryptKey) throw new Error('未配置飞书 Encrypt Key，无法解密加密模式的回调')

  let raw: Uint8Array
  try {
    raw = base64ToBytes(encrypt)
  } catch {
    throw new Error('飞书回调的 encrypt 字段不是合法 base64')
  }
  if (raw.length <= 16 || (raw.length - 16) % 16 !== 0) {
    throw new Error(`飞书回调密文长度异常（${raw.length} 字节），前 16 字节 IV 之外必须是 16 的整数倍`)
  }

  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptKey))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt'])

  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: raw.slice(0, 16) }, key, raw.slice(16))
  } catch {
    throw new Error('飞书回调解密失败，通常是 Encrypt Key 与开放平台上配置的不一致')
  }
  // 明文里有中文，必须按 UTF-8 解；按字节拼字符串会得到一串 ä½ å¥½。
  return new TextDecoder().decode(plain)
}

/**
 * 校验 `X-Lark-Signature`：`SHA256(timestamp + nonce + encryptKey + 原始body)` 的十六进制小写。
 *
 * 四段是直接拼接、没有任何分隔符，顺序写反同样能算出一个合法的 64 位 hex，
 * 线上表现是所有回调都验不过；只有和固定基准对拍才能发现，所以测试里钉了常量。
 *
 * rawBody 必须是**收到的原始字符串**，不能是 JSON.parse 再 stringify 的结果——
 * 键顺序和空格只要变一个字符，摘要就全变。
 *
 * 逐字节全量比较而不是 `===` 提前返回：签名是攻击者可控的输入，短路比较会按前缀
 * 长度泄漏时间。这里成本只有几十纳秒，没有不做的理由。
 */
export async function verifySignature(
  timestamp: string, nonce: string, encryptKey: string, rawBody: string, signature: string,
): Promise<boolean> {
  if (!encryptKey || !signature) return false
  const data = new TextEncoder().encode(`${timestamp}${nonce}${encryptKey}${rawBody}`)
  const expected = bytesToHex(await crypto.subtle.digest('SHA-256', data))
  const got = signature.toLowerCase()
  if (got.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

/**
 * 没配 Encrypt Key 时飞书不带签名，只能拿事件体里的 Verification Token 比对。
 * token 在 v2（schema 2.0）事件里挪进了 header，v1 还在顶层，两处都得认，
 * 只认一处的话换个事件类型就整批验不过。
 */
export function verifyToken(payload: unknown, expected: string | undefined): boolean {
  if (!expected) return false
  if (!payload || typeof payload !== 'object') return false
  const p = payload as { token?: unknown; header?: { token?: unknown } }
  const got = typeof p.header?.token === 'string' ? p.header.token
    : typeof p.token === 'string' ? p.token : ''
  return got !== '' && got === expected
}

/** 回调体的三种形态。上层据此决定回 challenge 还是走业务，避免每个入口自己 if 一遍。 */
export type FeishuCallback =
  | { kind: 'challenge'; challenge: string; payload: Record<string, unknown> }
  | { kind: 'event'; payload: Record<string, unknown> }

/**
 * 把原始 body 归一成上面两种形态：明文 / 加密两种模式、以及加密模式下**解出来仍是
 * url_verification** 的情况（配了 Encrypt Key 后连 URL 验证都是密文，这一步漏了
 * 就永远配不上回调地址）。
 *
 * 返回时保留完整 payload，是因为验 token 要用 header.token，而它只存在于解密后的明文里。
 */
export async function parseCallback(rawBody: string, encryptKey?: string): Promise<FeishuCallback> {
  const read = (s: string): Record<string, unknown> => {
    const v: unknown = JSON.parse(s)
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('飞书回调体不是 JSON 对象')
    return v as Record<string, unknown>
  }

  let payload = read(rawBody)
  if (typeof payload.encrypt === 'string') {
    payload = read(await decryptEvent(payload.encrypt, encryptKey ?? ''))
  }
  if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
    return { kind: 'challenge', challenge: payload.challenge, payload }
  }
  return { kind: 'event', payload }
}

// ---------------------------------------------------------------------------
// 2. tenant_access_token
// ---------------------------------------------------------------------------

/** 提前 5 分钟换新：飞书给的是 7200s，卡着到期换会撞上「拿到时刚好过期」的窗口。 */
const TOKEN_SKEW_SECONDS = 300

/**
 * 缓存**只在当前 Workers 隔离实例内有效**，绝不是全局缓存：
 * Cloudflare 会按流量起停多个隔离实例、随时回收，每个实例都有自己的模块级变量，
 * 所以实际请求飞书的次数是「实例数 × 换发次数」，不是「1 次 / 2 小时」。
 * 这个量级对演示和中小流量完全够用；真要全局唯一得放 KV，那是另一套部署成本。
 *
 * 按 appId 分桶而不是存单个 token：多环境（测试应用 / 正式应用）共用这份代码时，
 * 单变量会把上一个应用的 token 发给下一个，报错是 99991663，很难联想到缓存。
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>()
/** 冷启动瞬间常常有多条消息同时进来，不合并就会并发打好几次换发接口（飞书有频控）。 */
const tokenInflight = new Map<string, Promise<string>>()

/** 测试之间必须清干净，否则上一个用例缓存的假 token 会让下一个用例的 fetch 桩收不到调用。 */
export function resetTokenCache(): void {
  tokenCache.clear()
  tokenInflight.clear()
}

async function requestToken(appId: string, appSecret: string): Promise<{ token: string; expire: number }> {
  const res = await fetch(`${OPEN_API}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  const code = Number(body.code ?? (res.ok ? 0 : -1))
  if (code !== 0 || typeof body.tenant_access_token !== 'string') {
    // 这里绝不能吞掉返回一个空 token：后面每次发消息都会 401，而真正的原因
    //（app_secret 配错、应用没发布）只在这一次响应里出现过。
    throw new FeishuApiError(code, String(body.msg ?? `HTTP ${res.status}`), '换发 tenant_access_token 的请求')
  }
  return { token: body.tenant_access_token, expire: Number(body.expire ?? 7200) }
}

/**
 * now 从参数注入（默认取当前时间），照 notify.ts 里 pushedAt 的做法：
 * 过期分支不用假时钟就能被单测钉死，而调用方什么都不用改。
 */
export async function getTenantAccessToken(
  appId: string, appSecret: string, now: number = Date.now(),
): Promise<string> {
  if (!appId || !appSecret) throw new Error('未配置飞书 App ID / App Secret，无法换发 tenant_access_token')

  const hit = tokenCache.get(appId)
  if (hit && hit.expiresAt > now) return hit.token

  const pending = tokenInflight.get(appId)
  if (pending) return pending

  const task = requestToken(appId, appSecret)
    .then(({ token, expire }) => {
      // expire 比提前量还小时 expiresAt 直接落在过去，等于不缓存：
      // 宁可每次都换一次，也不能把一个已经过期的 token 发出去。
      tokenCache.set(appId, { token, expiresAt: now + Math.max(expire - TOKEN_SKEW_SECONDS, 0) * 1000 })
      return token
    })
    // 失败不进缓存，但 inflight 必须清掉，否则这个应用之后永远拿到同一个失败的 promise。
    .finally(() => tokenInflight.delete(appId))
  tokenInflight.set(appId, task)
  return task
}

// ---------------------------------------------------------------------------
// 3. 发消息
// ---------------------------------------------------------------------------

/**
 * 飞书的 content 字段类型是 string，里面再放一层 JSON。
 * 传对象进来就替调用方序列化，传字符串就原样透传——已经 stringify 过的再 stringify 一次
 * 会变成带转义的字符串字面量，飞书报 230001 且提示里完全看不出是双重序列化。
 */
function encodeContent(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}

async function callMessageApi(
  url: string, token: string, body: Record<string, unknown>, where: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  // 和 notify.ts 同一个坑：机器人不在群里、token 过期这些情况飞书照样回 HTTP 200，
  // 只看 res.ok 会把「消息根本没发出去」当成功，界面上显示已回复而群里一片安静。
  const code = Number(data.code ?? (res.ok ? 0 : -1))
  if (code !== 0) {
    throw new FeishuApiError(code, String(data.msg ?? `HTTP ${res.status}`), where)
  }
  return (data.data as Record<string, unknown>) ?? {}
}

/**
 * 回复到原消息下面（群里会显示引用关系）。
 * 群聊里必须用 reply 而不是 send：send 出去的是一条孤立消息，
 * 几个人同时问的时候没人知道哪条答的是自己那句。
 */
export function replyMessage(
  token: string, messageId: string, content: unknown, msgType: string = 'interactive',
): Promise<Record<string, unknown>> {
  return callMessageApi(
    `${OPEN_API}/im/v1/messages/${encodeURIComponent(messageId)}/reply`,
    token, { content: encodeContent(content), msg_type: msgType }, '回复消息的请求',
  )
}

/** 主动发（比如异步任务算完了才回来），此时原消息可能已经被折叠很远，只能新发一条。 */
export function sendMessage(
  token: string, receiveId: string, content: unknown,
  msgType: string = 'interactive', receiveIdType: string = 'chat_id',
): Promise<Record<string, unknown>> {
  return callMessageApi(
    `${OPEN_API}/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
    token, { receive_id: receiveId, content: encodeContent(content), msg_type: msgType }, '发送消息的请求',
  )
}

// ---------------------------------------------------------------------------
// 4. 取出用户真正问的那句话
// ---------------------------------------------------------------------------

/**
 * 群里 @机器人 时正文是 `{"text":"@_user_1 未来两周交付有风险吗"}`，
 * 占位符不去掉会原样进 prompt，模型会当成人名去理解，答案里也会带上这串乱码。
 *
 * 优先按 mentions 里给出的 key 精确删：key 未必都是 @_user_N（还有 @_all），
 * 正则兜底是为了 mentions 缺失时不至于漏。
 *
 * 只压缩横向空白、保留换行：多行提问（贴一段清单再问）里的换行是语义的一部分，
 * 一律 \s+ 压成空格会把列表压成一行。
 */
export function extractText(content: string, mentions?: unknown[]): string {
  let text: string
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object') return ''
    const t = (parsed as { text?: unknown }).text
    if (typeof t !== 'string') return ''
    text = t
  } catch {
    // 富文本（post）等非 text 消息走到这里。这层只认纯文本，交给上层去决定要不要提示用户。
    return ''
  }

  for (const m of mentions ?? []) {
    const key = (m as { key?: unknown } | null)?.key
    if (typeof key === 'string' && key) text = text.split(key).join(' ')
  }
  return text.replace(/@_user_\d+/g, ' ').replace(/[^\S\n]+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// 5. 卡片
// ---------------------------------------------------------------------------

/** 单条消息的正文上限保守取 3000：飞书卡片整体有 30KB 限制，但中文按 UTF-8 占 3 字节，
 *  再加上卡片结构本身的开销，按字符数留足余量比精确算字节稳。 */
const MAX_BODY_CHARS = 3000
const TITLE_CHARS = 40

/**
 * `[[SO-2026-0428]]` 是 Agent 结论里的溯源标记，在网页端点了会定位到那条记录。
 * 飞书卡片里做不到「点击跳转并定位」，双方括号留着就是一串没人看得懂的噪声；
 * 转成行内代码至少视觉上还是「一个可查的单号」，用户能复制去系统里搜。
 *
 * 单独导出是因为截断、卡片、以后可能的纯文本降级都要用同一套规则，
 * 复制一份必然有一处先漏改。
 */
export function renderRefMarkers(text: string): string {
  // [^[\]]+ 保证 [[]] 这种空标记原样留着——它多半是上游模板出了 bug，
  // 悄悄变成一对空反引号会让问题更难发现。
  return text.replace(/\[\[([^[\]]+)\]\]/g, '`$1`')
}

function truncate(text: string, max: number, tail: string): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  let cut = chars.slice(0, max).join('')
  // 截断点可能落在一对反引号中间，剩下的单个反引号会让飞书把后面的提示语一起吞进代码块。
  if ((cut.match(/`/g)?.length ?? 0) % 2 === 1) cut += '`'
  return cut + tail
}

/** 标题只有一行显示空间，超长会被飞书自己截，但截口没有省略号，看起来像话没说完。 */
function truncateTitle(text: string): string {
  const chars = Array.from(text)
  return chars.length <= TITLE_CHARS ? text : chars.slice(0, TITLE_CHARS).join('') + '…'
}

export interface AnswerCardOptions {
  question: string
  /** Agent 的结论正文，含 [[编号]] 溯源标记。 */
  answer: string
  /** 例如「供应链主管 · 王强」。放进 note 里，让群里其他人知道这条结论是以谁的权限算的。 */
  roleLabel: string
  /** 「在 OrbitOS 中核对 →」按钮的完整地址。缺省时不出按钮，而不是出一个死链。 */
  webUrl?: string
  footnote?: string
}

/**
 * 返回的是**卡片本身**（config/header/elements），不是 notify.ts 那种
 * `{msg_type, card}` 信封：webhook 要信封，而 im/v1 的 content 字段就是卡片，
 * 多包一层飞书报 230001 且提示只说 content 格式错。
 *
 * 正文用 lark_md 而不是 notify.ts 的 plain_text：那边是机器拼的固定句式、
 * 出现 `*` 就是数据本身；这边是模型写的结论，本来就带加粗和列表，
 * 不渲染的话满屏 `**` 反而更难读。代价是单号里的特殊字符可能被吃——
 * 所以单号统一走 renderRefMarkers 变成行内代码，代码块里 markdown 不生效。
 */
export function buildAnswerCard(opts: AnswerCardOptions) {
  const body = truncate(
    renderRefMarkers(opts.answer),
    MAX_BODY_CHARS,
    '\n\n**（结论过长已截断，点下方按钮在 OrbitOS 中查看全文）**',
  )

  const elements: unknown[] = [
    { tag: 'div', text: { tag: 'lark_md', content: body } },
  ]

  if (opts.webUrl) {
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag: 'plain_text', content: '在 OrbitOS 中核对 →' },
        type: 'primary',
        url: opts.webUrl,
      }],
    })
  }

  const note = [opts.roleLabel, opts.footnote].filter(Boolean).join(' · ')
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: note }] })

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      // 标题放问题原文而不是「Orbit OS 回复」：群消息列表的预览只有标题这一行，
      // 一屏十条一样的标题等于没有标题。
      title: { tag: 'plain_text', content: truncateTitle(opts.question) },
    },
    elements,
  }
}

export interface BlockedWriteCardOptions {
  /** 动作名，例如「把 SO-2026-0428 的交期改到 09-20」。 */
  actionLabel: string
  /** 动作摘要：改什么、影响谁。 */
  detail: string
  roleLabel: string
  /** 这里是必填：卡片的全部意义就是把人引到能确认的地方，没有按钮就是个死胡同。 */
  webUrl: string
  footnote?: string
}

/**
 * Agent 想执行写操作时用这张卡。
 *
 * 橙色而不是蓝色：它和答案卡在群里是连着刷出来的，颜色是唯一能在余光里区分
 * 「这是结论」和「这是等你点的动作」的信号。
 *
 * 卡片上不放「确认执行」按钮，只放跳转：飞书这侧没有 OrbitOS 的登录态，
 * 谁点的按钮只能拿到 open_id，靠它直接改单据等于把写权限挂在群成员身份上。
 * 写操作必须回到系统里、带着真实权限做。
 */
export function buildBlockedWriteCard(opts: BlockedWriteCardOptions) {
  const elements: unknown[] = [
    {
      tag: 'div',
      text: { tag: 'plain_text', content: '这个动作需要在 OrbitOS 里确认后执行，机器人不会替你提交。' },
    },
    { tag: 'hr' },
    { tag: 'div', text: { tag: 'lark_md', content: renderRefMarkers(opts.detail) } },
    {
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag: 'plain_text', content: '在 OrbitOS 中核对 →' },
        type: 'primary',
        url: opts.webUrl,
      }],
    },
  ]
  const note = [opts.roleLabel, opts.footnote].filter(Boolean).join(' · ')
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: note }] })

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'orange',
      title: { tag: 'plain_text', content: truncateTitle(`待确认：${opts.actionLabel}`) },
    },
    elements,
  }
}

// ---------------------------------------------------------------------------
// 6. 身份映射
// ---------------------------------------------------------------------------

/**
 * open_id 只在「同一个应用内」标识一个人，和 OrbitOS 的用户 id 没有任何关系，
 * 映射表只能人工维护，放环境变量里（改一次不用重新部署代码）。
 *
 * 解析失败返回 null 而不是抛：环境变量是运维手填的，多一个逗号就是 JSON 错，
 * 抛出去会让整个回调 500——所有人都用不了，而正确的降级是「这个人认不出来，
 * 按未授权处理」。认不出来的人拿不到数据，这是安全的方向。
 */
export function mapFeishuUser(openId: string, rawMap: string | undefined): string | null {
  if (!openId || !rawMap) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(rawMap)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const hit = (parsed as Record<string, unknown>)[openId]
  return typeof hit === 'string' && hit ? hit : null
}
