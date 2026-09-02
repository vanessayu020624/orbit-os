import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildFeishuCard, signTimestamp, handleNotify } from './notify'

const CARD = { title: '3 张订单存在交期风险', detail: 'SKU-203 精密伺服电机 缺口 48 台，当前最早可到货 2026-09-16', severity: 'high' as const }
const post = (body: unknown) =>
  new Request('https://orbit.test/api/notify', { method: 'POST', body: JSON.stringify(body) })

/** 飞书 webhook 是个真实的外部地址，测试里一次都不许打出去。fetch 全程替身。 */
function stubFetch(impl: (url: string, init: RequestInit) => Response) {
  const spy = vi.fn((url: unknown, init: unknown) => Promise.resolve(impl(String(url), init as RequestInit)))
  vi.stubGlobal('fetch', spy)
  return spy
}
const sent = (spy: ReturnType<typeof stubFetch>) =>
  JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>

afterEach(() => vi.unstubAllGlobals())

describe('飞书卡片构造', () => {
  const card = buildFeishuCard(CARD, '2026-09-02 10:30')

  it('是 interactive 卡片，标题带严重级别、表头配红色', () => {
    expect(card.msg_type).toBe('interactive')
    expect(card.card.header.template).toBe('red')
    expect(card.card.header.title.content).toBe('【高风险】3 张订单存在交期风险')
  })

  it('medium 走橙色', () => {
    const c = buildFeishuCard({ ...CARD, severity: 'medium' }, 'x')
    expect(c.card.header.template).toBe('orange')
    expect(c.card.header.title.content).toContain('【中风险】')
  })

  // 正文一律 plain_text：detail 里迟早会出现 * 或 [，lark_md 会把它当格式吃掉，
  // 群里看到的单号就少了几个字符。
  it('正文与备注都是 plain_text，不走 lark_md', () => {
    const tags = JSON.stringify(card).match(/"tag":"(lark_md|plain_text)"/g) ?? []
    expect(tags.length).toBeGreaterThan(0)
    expect(tags.every(t => t.includes('plain_text'))).toBe(true)
  })

  it('没有 question 时不多出分隔线，有 question 时附在正文后', () => {
    expect(JSON.stringify(card)).not.toContain('"hr"')
    const withQ = buildFeishuCard({ ...CARD, question: '未来两周要交付的订单有风险吗？' }, 'x')
    expect(JSON.stringify(withQ)).toContain('建议追问：未来两周要交付的订单有风险吗？')
  })

  it('推送时间落在备注里', () => {
    expect(JSON.stringify(card)).toContain('Orbit OS 风险预警 · 2026-09-02 10:30')
  })
})

describe('加签', () => {
  // 基准值由 node:crypto 以同一套输入算出。写反密钥与消息体（拿 secret 当 key、
  // 时间戳当消息）也能算出一个合法 base64，只有对拍才能发现，线上表现是 19021 sign match fail。
  it('HMAC-SHA256(key = timestamp\\nsecret, data = "") 再 base64', async () => {
    expect(await signTimestamp('1756800000', 'orbit-test-secret'))
      .toBe('sN+9ZKa5w6BQmKyxCaxNA1DWEgtEnZaOcfEOCqZ26fg=')
  })

  it('配了 secret 才带 timestamp/sign，没配就不带', async () => {
    const spy = stubFetch(() => Response.json({ code: 0, msg: 'success' }))
    await handleNotify(post(CARD), { FEISHU_WEBHOOK_URL: 'https://hook.test/x' })
    expect(sent(spy).sign).toBeUndefined()

    vi.unstubAllGlobals()
    const spy2 = stubFetch(() => Response.json({ code: 0, msg: 'success' }))
    await handleNotify(post(CARD), { FEISHU_WEBHOOK_URL: 'https://hook.test/x', FEISHU_WEBHOOK_SECRET: 'orbit-test-secret' })
    const body = sent(spy2)
    expect(String(body.sign)).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(await signTimestamp(String(body.timestamp), 'orbit-test-secret')).toBe(body.sign)
  })
})

describe('handleNotify 的失败分支', () => {
  it('没配 FEISHU_WEBHOOK_URL 时报 4xx，并且一次外发都没有', async () => {
    const spy = stubFetch(() => Response.json({ code: 0 }))
    const res = await handleNotify(post(CARD), {})
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'NO_WEBHOOK' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('请求体缺字段时 400，不往飞书发半张空卡', async () => {
    const spy = stubFetch(() => Response.json({ code: 0 }))
    const res = await handleNotify(post({ detail: '只有正文' }), { FEISHU_WEBHOOK_URL: 'https://hook.test/x' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'BAD_REQUEST' })
    expect(spy).not.toHaveBeenCalled()
  })

  // 飞书对签名错误、机器人被移出群这些情况照样回 HTTP 200，错误只在 body 里。
  // 只看 upstream.ok 的实现会把这些全判成「已推送」。
  it('HTTP 200 但 code 非 0 时透传 code/msg', async () => {
    stubFetch(() => Response.json({ code: 19021, msg: 'sign match fail or timestamp is not within one hour from current time' }))
    const res = await handleNotify(post(CARD), { FEISHU_WEBHOOK_URL: 'https://hook.test/x' })
    expect(res.ok).toBe(false)
    const j = await res.json() as Record<string, unknown>
    expect(j.code).toBe(19021)
    expect(String(j.msg)).toContain('sign match fail')
    expect(String(j.message)).toContain('19021')
  })

  it('旧版 StatusCode 字段同样能识别失败', async () => {
    stubFetch(() => Response.json({ StatusCode: 9499, StatusMessage: 'bad request' }))
    const res = await handleNotify(post(CARD), { FEISHU_WEBHOOK_URL: 'https://hook.test/x' })
    expect(await res.json()).toMatchObject({ error: 'FEISHU_REJECTED', code: 9499, msg: 'bad request' })
  })

  it('网络失败时报 502 且带上原因', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('getaddrinfo ENOTFOUND'))))
    const res = await handleNotify(post(CARD), { FEISHU_WEBHOOK_URL: 'https://hook.test/x' })
    expect(res.status).toBe(502)
    expect(String(((await res.json()) as Record<string, unknown>).message)).toContain('ENOTFOUND')
  })

  it('成功时回 ok:true', async () => {
    stubFetch(() => Response.json({ code: 0, msg: 'success' }))
    const res = await handleNotify(post(CARD), { FEISHU_WEBHOOK_URL: 'https://hook.test/x' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
