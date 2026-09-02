import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleEvents, parseMessageEvent, buildWebUrl, markSeen } from './events'

const TOKEN = 'vt-orbit-test'

/** 造一条 im.message.receive_v1 的完整事件体。改一处传一处，别的保持真实形状。 */
function messageEvent(over: Record<string, unknown> = {}, msgOver: Record<string, unknown> = {}) {
  return {
    schema: '2.0',
    header: { event_id: `ev-${Math.random()}`, event_type: 'im.message.receive_v1', token: TOKEN },
    event: {
      sender: { sender_id: { open_id: 'ou_alice' }, sender_type: 'user' },
      message: {
        message_id: 'om-1', chat_id: 'oc-1', message_type: 'text',
        content: JSON.stringify({ text: '@_user_1 未来两周交付有风险吗' }),
        mentions: [{ key: '@_user_1' }],
        ...msgOver,
      },
      ...over,
    },
  }
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://orbit.example.com/api/feishu/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const ENV = { FEISHU_VERIFICATION_TOKEN: TOKEN, FEISHU_APP_ID: 'cli_x', FEISHU_APP_SECRET: 's',
  FEISHU_USER_MAP: '{"ou_alice":"U-006"}' }

describe('parseMessageEvent', () => {
  it('挖出 open_id、message_id 和去掉 @ 占位符的正文', () => {
    const m = parseMessageEvent(messageEvent())
    expect(m?.openId).toBe('ou_alice')
    expect(m?.messageId).toBe('om-1')
    expect(m?.text).toBe('未来两周交付有风险吗')
  })

  // 不挡掉的话机器人会回答自己的回答，在群里无限刷。
  it('机器人自己发的消息一律忽略', () => {
    expect(parseMessageEvent(messageEvent({
      sender: { sender_id: { open_id: 'ou_bot' }, sender_type: 'app' },
    }))).toBeNull()
  })

  it('非文本消息（表情、图片）忽略而不是报错', () => {
    expect(parseMessageEvent(messageEvent({}, { message_type: 'image' }))).toBeNull()
  })

  it('@ 完没写正文的忽略', () => {
    expect(parseMessageEvent(messageEvent({}, {
      content: JSON.stringify({ text: '@_user_1   ' }),
    }))).toBeNull()
  })

  it('别的事件类型忽略', () => {
    const e = messageEvent()
    e.header.event_type = 'im.chat.member.bot.added_v1'
    expect(parseMessageEvent(e)).toBeNull()
  })

  it('字段缺失时返回 null 而不是抛', () => {
    expect(parseMessageEvent({ header: { event_type: 'im.message.receive_v1' } })).toBeNull()
    expect(parseMessageEvent({})).toBeNull()
  })
})

describe('buildWebUrl', () => {
  it('角色和问题都带上，且问题被正确转义', () => {
    const u = new URL(buildWebUrl('https://orbit.example.com', 'supply_chain', '交付有风险吗？'))
    expect(u.origin).toBe('https://orbit.example.com')
    expect(u.searchParams.get('role')).toBe('supply_chain')
    expect(u.searchParams.get('ask')).toBe('交付有风险吗？')
  })
})

describe('markSeen', () => {
  it('同一个 event_id 只放行一次', () => {
    expect(markSeen('dedup-case-1')).toBe(true)
    expect(markSeen('dedup-case-1')).toBe(false)
    expect(markSeen('dedup-case-2')).toBe(true)
  })
})

describe('handleEvents', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  const collect = () => {
    const tasks: Promise<unknown>[] = []
    return { tasks, waitUntil: (p: Promise<unknown>) => { tasks.push(p) } }
  }

  // 配回调地址的那一刻还没有任何签名可验，所以 challenge 必须在鉴权之前回。
  it('URL 验证原样回 challenge，且不需要通过鉴权', async () => {
    const { waitUntil } = collect()
    const res = await handleEvents(
      post({ type: 'url_verification', challenge: 'abc123', token: 'whatever' }), {}, waitUntil)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ challenge: 'abc123' })
  })

  // 这个端点公网可达，下游会真的花钱调模型。
  it('token 对不上直接 403，不进后台任务', async () => {
    const { tasks, waitUntil } = collect()
    const res = await handleEvents(post(messageEvent()), { FEISHU_VERIFICATION_TOKEN: '别的' }, waitUntil)
    expect(res.status).toBe(403)
    expect(tasks).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('没配任何校验方式时一律拒绝，不是默认放行', async () => {
    const { waitUntil } = collect()
    expect((await handleEvents(post(messageEvent()), {}, waitUntil)).status).toBe(403)
  })

  it('校验通过就立刻 200，执行丢进 waitUntil', async () => {
    const { tasks, waitUntil } = collect()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: {} })))
    const res = await handleEvents(post(messageEvent()), ENV, waitUntil)
    expect(res.status).toBe(200)
    // 返回 200 的那一刻后台任务还没跑完——这正是 3 秒 ACK 要的效果。
    expect(tasks).toHaveLength(1)
    await Promise.all(tasks)
  })

  it('忽略掉的事件也回 200，否则飞书会把同一条重推三遍', async () => {
    const { tasks, waitUntil } = collect()
    const res = await handleEvents(post(messageEvent({}, { message_type: 'image' })), ENV, waitUntil)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ignored: true })
    expect(tasks).toHaveLength(0)
  })

  it('重推的同一条事件不会再跑一遍', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: {} })))
    const e = messageEvent()
    const a = collect()
    await handleEvents(post(e), ENV, a.waitUntil)
    const b = collect()
    const res = await handleEvents(post(e), ENV, b.waitUntil)
    expect(await res.json()).toMatchObject({ deduped: true })
    expect(b.tasks).toHaveLength(0)
    await Promise.all(a.tasks)
  })

  it('body 不是合法 JSON 时回 400，不是 500', async () => {
    const { waitUntil } = collect()
    expect((await handleEvents(post('{ 坏掉的'), ENV, waitUntil)).status).toBe(400)
  })

  // 没有身份就没有权限边界。这里不给「默认只读身份」这个台阶。
  it('open_id 没配映射时，回一张带 open_id 的提示卡，且不跑 Agent', async () => {
    const { tasks, waitUntil } = collect()
    const bodies: string[] = []
    fetchMock.mockImplementation((_u: string, init: { body?: string }) => {
      bodies.push(init?.body ?? '')
      return Promise.resolve(new Response(JSON.stringify({
        code: 0, tenant_access_token: 't', expire: 7200, data: {},
      })))
    })
    await handleEvents(post(messageEvent({
      sender: { sender_id: { open_id: 'ou_stranger' }, sender_type: 'user' },
    })), ENV, waitUntil)
    await Promise.all(tasks)
    const card = bodies.find(b => b.includes('ou_stranger'))
    expect(card).toBeTruthy()
    expect(card).toContain('FEISHU_USER_MAP')
    // 跑 Agent 会打到 /api/chat；这里只应该有换 token 和发消息两次请求。
    expect(bodies.some(b => b.includes('"messages"'))).toBe(false)
  })
})
