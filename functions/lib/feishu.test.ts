import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  decryptEvent, verifySignature, verifyToken, parseCallback,
  getTenantAccessToken, resetTokenCache, FeishuApiError,
  replyMessage, sendMessage, extractText,
  renderRefMarkers, buildAnswerCard, buildBlockedWriteCard, mapFeishuUser,
} from './feishu'

/**
 * 加解密 / 验签的全部基准值，都是用 node:crypto 以同一套输入离线算出来的常量。
 * 产品代码里一行 node:crypto 都不能有（workers 没有它），所以只能把**结果**钉在这里对拍。
 *
 * 为什么必须对拍而不是「自己加密再自己解密」：把 IV 当成密文的一部分、
 * 拿 Encrypt Key 原文当 AES key（而不是它的 SHA-256）、验签时把 body 和 key 的顺序写反——
 * 这些错误在自洽的往返测试里全都是绿的，只有和真实算法的输出比对才会红。
 */
const ENCRYPT_KEY = 'orbit-os-encrypt-key'
const CHALLENGE_PLAIN = '{"challenge":"ajls384kdjx98XX","token":"xxxxxx","type":"url_verification"}'
const CHALLENGE_CIPHER = 'AAECAwQFBgcICQoLDA0OD5lNg0Pi+9PpAhTqL/hGsbULfTFnPamwuOcjwUj0SRX2U+ivCOJdqjkpv6HJs9RXA2emiQDC44O43dYoB2BSb3YSMOQpxDjAam9Xa95/2D9R'
const EVENT_PLAIN = '{"schema":"2.0","header":{"event_id":"e1","event_type":"im.message.receive_v1","token":"vtoken","tenant_key":"tk"},"event":{"sender":{"sender_id":{"open_id":"ou_abc123"}},"message":{"message_id":"om_msg_1","chat_id":"oc_chat_1","message_type":"text","content":"{\\"text\\":\\"@_user_1 未来两周交付有风险吗\\"}","mentions":[{"key":"@_user_1","id":{"open_id":"ou_bot"},"name":"OrbitOS"}]}}}'
const EVENT_CIPHER = 'AAECAwQFBgcICQoLDA0OD8whFcVkrJlD43z5/tAsjfdlwaxtnHQ5gJWNPaDSoCagWPi0uJuvmQhyd8PuYoCFfVIr67guEiOkHEdTdGHejqkH4mVYcy/pUshvyedr2zcB1S8gT4c5Q0HHiB+sB+bPByytBhAXC+V2ZZ0oHE/P6AdCqqtQgy3iq4n+btg5QRKypsn2sLIZHeW0f8IbSrwhkb1y3HUYjhrQp7eLBK0m3oa6fmUQsg2EQnD230kbJTlfXjoMTt47AAmPiemI3AbmcbznZtcSAtHV10ciaolPZ5GLpRkEJ9rfvXP5X7H4bHcsb2oox4p3GJQ+0hQdgwqIGKt0Nd52KGNPJQrI7+UJd1gNTTsMrSCriiLmTaumv9Oz+GhN29dG75QmNxKC8ibpGmzbo4GNtZRv6x23op86u/3rbXg6tOSFnDXVypNZxpi08IkK666V6eY6mYQWTPHZ/2CPnqaXNjry8vUDGOrY2fdOWyw5eDcANv0r/0g0T7VgnLUMdTvGmcjDu/jCg5eZiu0wMvvkQoEPPnEE8g7bEa0='
/** 明文长度恰好 16 字节：PKCS#7 会整整补一个块，手写 unpad 最容易在这里把明文吃掉。 */
const EXACT16_CIPHER = 'AAECAwQFBgcICQoLDA0OD3GpG78/8NRfk5GhGyNUg1SVlscxIlfa5mM6YVXh+24G'
/** 中文明文：按 latin1 拼字符串的实现在这条上才会露馅。 */
const CN_PLAIN = '交期风险：SKU-203 缺口 48 台'
const CN_CIPHER = 'AAECAwQFBgcICQoLDA0OD9ghjFLHFBs7AotMLSZWOtpSruRxKXGUmi2yQm8G6Y3QA4PGVWOwODgunEp5sb323g=='

const SIG_TS = '1756800000'
const SIG_NONCE = 'orbit-nonce-1'
const SIG_BODY = '{"encrypt":"xyz"}'
const SIGNATURE = '46fd1483dc9726855d4c50cfa71cdfde5cf72e46d001bd22749bd9381aa48481'
/** 把 encryptKey 和 body 的拼接顺序写反算出来的值，同样是一个合法的 64 位 hex。 */
const SIGNATURE_WRONG_ORDER = '639097bbd5f93fa16a84955d2c279a023f9ba5c2328be11306c73af9291778d0'

/** 飞书开放平台是真实地址，测试里一次都不许打出去。 */
function stubFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn((url: unknown, init: unknown) => Promise.resolve(impl(String(url), init as RequestInit)))
  vi.stubGlobal('fetch', spy)
  return spy
}
const sentBody = (spy: ReturnType<typeof stubFetch>, i = 0) =>
  JSON.parse(String((spy.mock.calls[i][1] as RequestInit).body)) as Record<string, unknown>

afterEach(() => {
  vi.unstubAllGlobals()
  resetTokenCache()
})

describe('回调解密（与 node:crypto 基准对拍）', () => {
  it('解出 url_verification 明文，一字不差', async () => {
    expect(await decryptEvent(CHALLENGE_CIPHER, ENCRYPT_KEY)).toBe(CHALLENGE_PLAIN)
  })

  it('解出真实事件明文，且能被 JSON.parse', async () => {
    const plain = await decryptEvent(EVENT_CIPHER, ENCRYPT_KEY)
    expect(plain).toBe(EVENT_PLAIN)
    const p = JSON.parse(plain) as { header: { event_type: string } }
    expect(p.header.event_type).toBe('im.message.receive_v1')
  })

  it('明文正好 16 字节时不多吃也不少吃一个块', async () => {
    expect(await decryptEvent(EXACT16_CIPHER, ENCRYPT_KEY)).toBe('0123456789abcdef')
  })

  it('中文按 UTF-8 解码而不是按字节拼字符串', async () => {
    expect(await decryptEvent(CN_CIPHER, ENCRYPT_KEY)).toBe(CN_PLAIN)
  })

  it('Encrypt Key 不对时报错，而不是返回一段乱码', async () => {
    await expect(decryptEvent(CHALLENGE_CIPHER, 'wrong-key')).rejects.toThrow(/Encrypt Key/)
  })

  it('没配 Encrypt Key 时直接报错', async () => {
    await expect(decryptEvent(CHALLENGE_CIPHER, '')).rejects.toThrow(/未配置/)
  })

  it('密文长度不是 16 的倍数（或只有 IV）时报错', async () => {
    await expect(decryptEvent(btoa('0123456789abcdef'), ENCRYPT_KEY)).rejects.toThrow(/长度异常/)
    await expect(decryptEvent(btoa('0123456789abcdefXY'), ENCRYPT_KEY)).rejects.toThrow(/长度异常/)
  })

  it('encrypt 不是合法 base64 时报错', async () => {
    await expect(decryptEvent('这不是 base64 !!!', ENCRYPT_KEY)).rejects.toThrow(/base64/)
  })

  it('容忍网关在长 base64 里插进来的换行', async () => {
    const wrapped = CHALLENGE_CIPHER.replace(/(.{40})/g, '$1\n')
    expect(await decryptEvent(wrapped, ENCRYPT_KEY)).toBe(CHALLENGE_PLAIN)
  })
})

describe('验签（与 node:crypto 基准对拍）', () => {
  it('SHA256(timestamp + nonce + encryptKey + body) 的十六进制小写', async () => {
    expect(await verifySignature(SIG_TS, SIG_NONCE, ENCRYPT_KEY, SIG_BODY, SIGNATURE)).toBe(true)
  })

  it('拼接顺序写反算出的签名必须验不过', async () => {
    expect(SIGNATURE_WRONG_ORDER).not.toBe(SIGNATURE)
    expect(await verifySignature(SIG_TS, SIG_NONCE, ENCRYPT_KEY, SIG_BODY, SIGNATURE_WRONG_ORDER)).toBe(false)
  })

  it('大写签名也认（飞书文档给的是小写，但不该因大小写拒掉合法请求）', async () => {
    expect(await verifySignature(SIG_TS, SIG_NONCE, ENCRYPT_KEY, SIG_BODY, SIGNATURE.toUpperCase())).toBe(true)
  })

  it('body 改一个字符就验不过', async () => {
    expect(await verifySignature(SIG_TS, SIG_NONCE, ENCRYPT_KEY, SIG_BODY + ' ', SIGNATURE)).toBe(false)
  })

  it('timestamp / nonce / key 任意一项不同都验不过', async () => {
    expect(await verifySignature('1756800001', SIG_NONCE, ENCRYPT_KEY, SIG_BODY, SIGNATURE)).toBe(false)
    expect(await verifySignature(SIG_TS, 'other-nonce', ENCRYPT_KEY, SIG_BODY, SIGNATURE)).toBe(false)
    expect(await verifySignature(SIG_TS, SIG_NONCE, 'other-key', SIG_BODY, SIGNATURE)).toBe(false)
  })

  it('签名或 Encrypt Key 缺失时一律不通过，不能当作「没配就放行」', async () => {
    expect(await verifySignature(SIG_TS, SIG_NONCE, ENCRYPT_KEY, SIG_BODY, '')).toBe(false)
    expect(await verifySignature(SIG_TS, SIG_NONCE, '', SIG_BODY, SIGNATURE)).toBe(false)
  })
})

describe('Verification Token 比对（没配 Encrypt Key 时的唯一防线）', () => {
  it('v2 事件的 token 在 header 里', () => {
    expect(verifyToken({ header: { token: 'vtoken' } }, 'vtoken')).toBe(true)
    expect(verifyToken({ header: { token: 'vtoken' } }, 'other')).toBe(false)
  })

  it('v1 事件的 token 在顶层', () => {
    expect(verifyToken({ token: 'vtoken' }, 'vtoken')).toBe(true)
  })

  it('缺 token / 缺配置 / 非对象一律不通过', () => {
    expect(verifyToken({}, 'vtoken')).toBe(false)
    expect(verifyToken({ token: 'vtoken' }, undefined)).toBe(false)
    expect(verifyToken('vtoken', 'vtoken')).toBe(false)
    expect(verifyToken(null, 'vtoken')).toBe(false)
  })
})

describe('parseCallback 的三种形态', () => {
  it('明文 url_verification：原样带出 challenge', async () => {
    const r = await parseCallback(CHALLENGE_PLAIN)
    expect(r.kind).toBe('challenge')
    expect(r.kind === 'challenge' && r.challenge).toBe('ajls384kdjx98XX')
  })

  // 配了 Encrypt Key 之后连 URL 验证都是密文。漏了这条分支的实现，
  // 表现是「回调地址永远配置不上」，而日志里只有一句 JSON 解析失败。
  it('加密的 url_verification：解密之后仍要识别出 challenge', async () => {
    const r = await parseCallback(JSON.stringify({ encrypt: CHALLENGE_CIPHER }), ENCRYPT_KEY)
    expect(r.kind).toBe('challenge')
    expect(r.kind === 'challenge' && r.challenge).toBe('ajls384kdjx98XX')
  })

  it('加密的真实事件：解出完整 payload 供上层验 token', async () => {
    const r = await parseCallback(JSON.stringify({ encrypt: EVENT_CIPHER }), ENCRYPT_KEY)
    expect(r.kind).toBe('event')
    expect(verifyToken(r.payload, 'vtoken')).toBe(true)
  })

  it('明文事件直接透传', async () => {
    const r = await parseCallback('{"schema":"2.0","header":{"event_type":"im.message.receive_v1"}}')
    expect(r.kind).toBe('event')
  })

  it('body 不是 JSON 对象时抛错，不静默当成空事件', async () => {
    await expect(parseCallback('[]')).rejects.toThrow(/JSON 对象/)
    await expect(parseCallback('not json')).rejects.toThrow()
  })
})

describe('tenant_access_token 缓存', () => {
  const okToken = (token = 't-1', expire = 7200) =>
    stubFetch(() => Response.json({ code: 0, msg: 'ok', tenant_access_token: token, expire }))

  it('用 POST 打 internal 接口，body 带 app_id / app_secret', async () => {
    const spy = okToken()
    expect(await getTenantAccessToken('cli_x', 'secret_x')).toBe('t-1')
    expect(String(spy.mock.calls[0][0])).toBe('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal')
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe('POST')
    expect(sentBody(spy)).toEqual({ app_id: 'cli_x', app_secret: 'secret_x' })
  })

  it('有效期内第二次调用不再打网络', async () => {
    const spy = okToken()
    await getTenantAccessToken('cli_x', 'secret_x', 0)
    await getTenantAccessToken('cli_x', 'secret_x', 60_000)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // 提前 5 分钟换新：卡着 7200s 才换，会撞上「拿到手就过期」的窗口。
  it('提前 5 分钟过期：到 expire-300 秒时必须重新换发', async () => {
    const spy = okToken('t-1')
    await getTenantAccessToken('cli_x', 'secret_x', 0)
    await getTenantAccessToken('cli_x', 'secret_x', (7200 - 301) * 1000)
    expect(spy).toHaveBeenCalledTimes(1)
    await getTenantAccessToken('cli_x', 'secret_x', (7200 - 300) * 1000)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('expire 比提前量还短时等于不缓存，绝不发已过期的 token', async () => {
    const spy = okToken('t-short', 60)
    await getTenantAccessToken('cli_x', 'secret_x', 0)
    await getTenantAccessToken('cli_x', 'secret_x', 0)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('不同 app_id 各自缓存，不会把上一个应用的 token 发给下一个', async () => {
    const spy = stubFetch((_u, init) => {
      const b = JSON.parse(String(init.body)) as { app_id: string }
      return Response.json({ code: 0, tenant_access_token: `t-${b.app_id}`, expire: 7200 })
    })
    expect(await getTenantAccessToken('cli_a', 's')).toBe('t-cli_a')
    expect(await getTenantAccessToken('cli_b', 's')).toBe('t-cli_b')
    expect(await getTenantAccessToken('cli_a', 's')).toBe('t-cli_a')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  // 冷启动时多条消息同时进来，不合并就会并发打好几次换发接口。
  it('并发调用只换发一次', async () => {
    const spy = okToken()
    const all = await Promise.all([
      getTenantAccessToken('cli_x', 'secret_x'),
      getTenantAccessToken('cli_x', 'secret_x'),
      getTenantAccessToken('cli_x', 'secret_x'),
    ])
    expect(all).toEqual(['t-1', 't-1', 't-1'])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('resetTokenCache 之后重新换发', async () => {
    const spy = okToken()
    await getTenantAccessToken('cli_x', 'secret_x', 0)
    resetTokenCache()
    await getTenantAccessToken('cli_x', 'secret_x', 0)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('code 非 0 时抛出带 code/msg 的错误，不返回空 token', async () => {
    stubFetch(() => Response.json({ code: 10003, msg: 'app_secret invalid' }))
    await expect(getTenantAccessToken('cli_x', 'bad')).rejects.toThrow(FeishuApiError)
    stubFetch(() => Response.json({ code: 10003, msg: 'app_secret invalid' }))
    await getTenantAccessToken('cli_x', 'bad').catch((e: unknown) => {
      const err = e as FeishuApiError
      expect(err.code).toBe(10003)
      expect(err.msg).toBe('app_secret invalid')
      expect(err.message).toContain('10003')
    })
  })

  it('失败不进缓存，也不会把失败的 promise 永久留在 inflight 里', async () => {
    stubFetch(() => Response.json({ code: 10003, msg: 'bad' }))
    await expect(getTenantAccessToken('cli_x', 'bad')).rejects.toThrow()
    vi.unstubAllGlobals()
    const spy = okToken('t-2')
    expect(await getTenantAccessToken('cli_x', 'bad')).toBe('t-2')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('没配 app_id / app_secret 时直接报错，一次外发都没有', async () => {
    const spy = okToken()
    await expect(getTenantAccessToken('', 's')).rejects.toThrow(/未配置/)
    await expect(getTenantAccessToken('cli_x', '')).rejects.toThrow(/未配置/)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('发消息', () => {
  const CARD = { config: {}, header: {}, elements: [] }

  it('reply 打 /reply 接口，带 Bearer token，content 是序列化后的字符串', async () => {
    const spy = stubFetch(() => Response.json({ code: 0, data: { message_id: 'om_new' } }))
    const data = await replyMessage('t-1', 'om_msg_1', CARD)
    expect(String(spy.mock.calls[0][0])).toBe('https://open.feishu.cn/open-apis/im/v1/messages/om_msg_1/reply')
    const init = spy.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t-1')
    const body = sentBody(spy)
    expect(body.msg_type).toBe('interactive')
    expect(typeof body.content).toBe('string')
    expect(JSON.parse(String(body.content))).toEqual(CARD)
    expect(data).toEqual({ message_id: 'om_new' })
  })

  // content 已经是字符串时再 stringify 一次会变成带转义的字符串字面量，飞书回 230001，
  // 提示里完全看不出是双重序列化。
  it('content 已是字符串时原样透传，不二次序列化', async () => {
    const spy = stubFetch(() => Response.json({ code: 0 }))
    await replyMessage('t-1', 'om_1', '{"text":"hi"}', 'text')
    const body = sentBody(spy)
    expect(body.content).toBe('{"text":"hi"}')
    expect(body.msg_type).toBe('text')
  })

  it('send 走 messages?receive_id_type=chat_id，body 带 receive_id', async () => {
    const spy = stubFetch(() => Response.json({ code: 0 }))
    await sendMessage('t-1', 'oc_chat_1', CARD)
    expect(String(spy.mock.calls[0][0])).toBe('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id')
    expect(sentBody(spy)).toMatchObject({ receive_id: 'oc_chat_1', msg_type: 'interactive' })
  })

  it('send 可以换 receive_id_type', async () => {
    const spy = stubFetch(() => Response.json({ code: 0 }))
    await sendMessage('t-1', 'ou_abc', { text: 'hi' }, 'text', 'open_id')
    expect(String(spy.mock.calls[0][0])).toContain('receive_id_type=open_id')
  })

  // 机器人被移出群、token 过期这些情况飞书照样回 HTTP 200，
  // 只看 res.ok 的实现会把「消息根本没发出去」当成功。
  it('HTTP 200 但 code 非 0 时抛错并透传 code/msg', async () => {
    stubFetch(() => Response.json({ code: 230002, msg: 'bot is not in the chat' }, { status: 200 }))
    await expect(replyMessage('t-1', 'om_1', CARD)).rejects.toThrow(/230002/)
  })

  it('HTTP 非 2xx 且 body 不是 JSON 时也算失败', async () => {
    stubFetch(() => new Response('gateway error', { status: 502 }))
    await expect(sendMessage('t-1', 'oc_1', CARD)).rejects.toThrow(FeishuApiError)
  })

  it('message_id 做过转义，不会被特殊字符拼坏 URL', async () => {
    const spy = stubFetch(() => Response.json({ code: 0 }))
    await replyMessage('t-1', 'om/1?x=2', CARD)
    expect(String(spy.mock.calls[0][0])).toContain('/messages/om%2F1%3Fx%3D2/reply')
  })
})

describe('extractText', () => {
  it('去掉 @_user_N 占位符，返回用户真正问的那句话', () => {
    expect(extractText('{"text":"@_user_1 未来两周交付有风险吗"}')).toBe('未来两周交付有风险吗')
  })

  it('多个 mention 与句中 @ 一并清掉，且不留多余空格', () => {
    const text = extractText(
      '{"text":"@_user_1 帮 @_user_2 看下  SO-2026-0428 "}',
      [{ key: '@_user_1' }, { key: '@_user_2' }],
    )
    expect(text).toBe('帮 看下 SO-2026-0428')
  })

  it('mentions 里的非 @_user_N key（如 @_all）也按 key 删', () => {
    expect(extractText('{"text":"@_all 今天的交付情况"}', [{ key: '@_all' }])).toBe('今天的交付情况')
  })

  it('mentions 缺失时正则兜底', () => {
    expect(extractText('{"text":"@_user_3 x"}', undefined)).toBe('x')
  })

  it('只 @ 了机器人没说话时返回空字符串', () => {
    expect(extractText('{"text":"@_user_1 "}')).toBe('')
    expect(extractText('{"text":""}')).toBe('')
  })

  it('多行提问保留换行（列表被压成一行就读不出结构了）', () => {
    expect(extractText('{"text":"@_user_1 看这两单：\\nSO-1\\nSO-2"}')).toBe('看这两单：\nSO-1\nSO-2')
  })

  it('非文本消息 / 坏 JSON 返回空字符串，不抛', () => {
    expect(extractText('not json')).toBe('')
    expect(extractText('{"title":"post","content":[]}')).toBe('')
    expect(extractText('null')).toBe('')
    expect(extractText('')).toBe('')
  })
})

describe('溯源标记转换', () => {
  it('[[编号]] 变成行内代码，双方括号不留在群里', () => {
    expect(renderRefMarkers('参见 [[SO-2026-0428]] 与 [[SKU-203]]。'))
      .toBe('参见 `SO-2026-0428` 与 `SKU-203`。')
  })

  it('没有标记时原样返回', () => {
    expect(renderRefMarkers('没有任何标记')).toBe('没有任何标记')
  })

  // 空标记多半是上游模板出了 bug，悄悄变成一对空反引号只会让问题更难被发现。
  it('空标记与单层方括号原样保留', () => {
    expect(renderRefMarkers('[[]] 和 [SO-1] 都不动')).toBe('[[]] 和 [SO-1] 都不动')
  })
})

describe('答案卡', () => {
  const OPTS = {
    question: '未来两周要交付的订单有风险吗？',
    answer: '**有 3 张**订单存在风险，最紧的是 [[SO-2026-0428]]。',
    roleLabel: '供应链主管 · 王强',
    webUrl: 'https://orbit.test/orders?focus=SO-2026-0428',
    footnote: '本结论引用了 6 条记录',
  }
  const card = buildAnswerCard(OPTS)
  const els = card.elements as Array<Record<string, unknown>>

  // 返回的是卡片本身而不是 notify.ts 那种 {msg_type, card} 信封：
  // im/v1 的 content 字段就是卡片，多包一层飞书报 230001。
  it('返回卡片本身，不带 msg_type 信封', () => {
    expect(card).not.toHaveProperty('msg_type')
    expect(card).not.toHaveProperty('card')
    expect(card.config).toEqual({ wide_screen_mode: true })
  })

  it('header 用 blue，标题是问题原文', () => {
    expect(card.header.template).toBe('blue')
    expect(card.header.title.content).toBe(OPTS.question)
  })

  it('标题超过 40 字截断并加省略号', () => {
    const long = '一'.repeat(80)
    const c = buildAnswerCard({ ...OPTS, question: long })
    expect(c.header.title.content).toBe('一'.repeat(40) + '…')
    expect(Array.from(c.header.title.content).length).toBe(41)
  })

  it('正文走 lark_md（结论里有加粗和列表，要渲染）', () => {
    const body = els[0] as { tag: string; text: { tag: string; content: string } }
    expect(body.tag).toBe('div')
    expect(body.text.tag).toBe('lark_md')
    expect(body.text.content).toContain('**有 3 张**')
  })

  it('正文里的 [[编号]] 已转成行内代码，卡片 JSON 里不再有双方括号', () => {
    expect(JSON.stringify(card)).not.toContain('[[')
    expect((els[0] as { text: { content: string } }).text.content).toContain('`SO-2026-0428`')
  })

  it('有 webUrl 时追加 primary 按钮，url 指向它', () => {
    const action = els.find(e => e.tag === 'action') as { actions: Array<Record<string, unknown>> }
    expect(action.actions).toHaveLength(1)
    expect(action.actions[0]).toMatchObject({
      tag: 'button', type: 'primary', url: OPTS.webUrl,
    })
    expect((action.actions[0].text as { content: string }).content).toBe('在 OrbitOS 中核对 →')
  })

  it('没有 webUrl 时不出按钮，而不是出一个死链', () => {
    const c = buildAnswerCard({ ...OPTS, webUrl: undefined })
    expect((c.elements as Array<Record<string, unknown>>).some(e => e.tag === 'action')).toBe(false)
  })

  it('note 里放角色与脚注', () => {
    const note = els.find(e => e.tag === 'note') as { elements: Array<{ content: string }> }
    expect(note.elements[0].content).toBe('供应链主管 · 王强 · 本结论引用了 6 条记录')
  })

  it('没有脚注时 note 不留下孤零零的分隔点', () => {
    const c = buildAnswerCard({ ...OPTS, footnote: undefined })
    const note = (c.elements as Array<Record<string, unknown>>).find(e => e.tag === 'note') as { elements: Array<{ content: string }> }
    expect(note.elements[0].content).toBe('供应链主管 · 王强')
  })

  it('超长结论截断到 3000 字并提示去网页看全文', () => {
    const c = buildAnswerCard({ ...OPTS, answer: '长'.repeat(5000) })
    const content = ((c.elements as Array<Record<string, unknown>>)[0] as { text: { content: string } }).text.content
    expect(content.startsWith('长'.repeat(3000))).toBe(true)
    expect(content).toContain('已截断')
    expect(content).toContain('OrbitOS')
    expect(Array.from(content).length).toBeLessThan(3100)
  })

  it('刚好 3000 字不截断', () => {
    const c = buildAnswerCard({ ...OPTS, answer: '长'.repeat(3000) })
    const content = ((c.elements as Array<Record<string, unknown>>)[0] as { text: { content: string } }).text.content
    expect(content).toBe('长'.repeat(3000))
  })

  // 截断点落在一对反引号中间的话，剩下的单个反引号会把后面的提示语一起吞进代码块。
  it('截断处补齐落单的反引号', () => {
    const answer = '长'.repeat(2990) + '[[SO-2026-0428-XXXX]]'
    const c = buildAnswerCard({ ...OPTS, answer })
    const content = ((c.elements as Array<Record<string, unknown>>)[0] as { text: { content: string } }).text.content
    expect((content.match(/`/g) ?? []).length % 2).toBe(0)
  })
})

describe('写操作拦截卡', () => {
  const c = buildBlockedWriteCard({
    actionLabel: '把 SO-2026-0428 的交期改到 09-20',
    detail: '影响 [[SO-2026-0428]] 一张订单，下游 2 个工单需要同步顺延。',
    roleLabel: '供应链主管 · 王强',
    webUrl: 'https://orbit.test/orders/SO-2026-0428',
  })
  const els = c.elements as Array<Record<string, unknown>>

  it('header 用 orange，和蓝色的答案卡在群里一眼能分开', () => {
    expect(c.header.template).toBe('orange')
    expect(c.header.title.content).toContain('待确认')
  })

  it('说明这个动作要回系统里确认', () => {
    expect(JSON.stringify(c)).toContain('需要在 OrbitOS 里确认后执行')
  })

  it('正文带动作摘要，标记同样转成行内代码', () => {
    expect(JSON.stringify(c)).not.toContain('[[')
    expect(JSON.stringify(c)).toContain('`SO-2026-0428`')
  })

  // 没有按钮这张卡就是个死胡同：告诉你不能做，又不告诉你去哪做。
  it('必须带跳转按钮', () => {
    const action = els.find(e => e.tag === 'action') as { actions: Array<Record<string, unknown>> }
    expect(action.actions[0].url).toBe('https://orbit.test/orders/SO-2026-0428')
  })

  it('长动作名同样截断', () => {
    const long = buildBlockedWriteCard({
      actionLabel: '改'.repeat(80), detail: 'x', roleLabel: 'r', webUrl: 'https://x.test',
    })
    expect(Array.from(long.header.title.content).length).toBe(41)
  })
})

describe('身份映射', () => {
  const MAP = '{"ou_abc123":"U-006","ou_def456":"U-001"}'

  it('命中时返回 OrbitOS 用户 id', () => {
    expect(mapFeishuUser('ou_abc123', MAP)).toBe('U-006')
    expect(mapFeishuUser('ou_def456', MAP)).toBe('U-001')
  })

  it('未登记的人返回 null', () => {
    expect(mapFeishuUser('ou_unknown', MAP)).toBeNull()
  })

  // 环境变量是运维手填的，多一个逗号就是 JSON 错。抛出去整个回调 500，
  // 正确的降级是「认不出这个人」——认不出的人拿不到数据，方向是安全的。
  it('JSON 非法时返回 null 而不是抛', () => {
    expect(mapFeishuUser('ou_abc123', '{bad json')).toBeNull()
    expect(mapFeishuUser('ou_abc123', '')).toBeNull()
    expect(mapFeishuUser('ou_abc123', undefined)).toBeNull()
  })

  it('JSON 合法但不是对象、或值不是字符串时也返回 null', () => {
    expect(mapFeishuUser('ou_abc123', '["ou_abc123"]')).toBeNull()
    expect(mapFeishuUser('ou_abc123', 'null')).toBeNull()
    expect(mapFeishuUser('ou_abc123', '{"ou_abc123":123}')).toBeNull()
    expect(mapFeishuUser('ou_abc123', '{"ou_abc123":""}')).toBeNull()
  })

  it('空 open_id 直接 null，不去撞原型链上的键', () => {
    expect(mapFeishuUser('', MAP)).toBeNull()
    expect(mapFeishuUser('toString', MAP)).toBeNull()
    expect(mapFeishuUser('__proto__', MAP)).toBeNull()
  })
})
