import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chat, MODEL, BACKOFF_MS, LlmRateLimited, LlmUnavailable, resetUsage, sumUsage } from './llm'

const OK_BODY = {
  choices: [{ message: { role: 'assistant', content: '好的' } }],
  usage: { prompt_tokens: 123, completion_tokens: 489, total_tokens: 612 },
}
const ok = () => ({ ok: true, status: 200, json: async () => OK_BODY })
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) })

let fetchMock: ReturnType<typeof vi.fn>
const bodyOf = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body as string)
const call = () => chat({ messages: [{ role: 'user', content: '嗨' }] })

/** 走完全部退避档位所需的虚拟时间。 */
const TOTAL_BACKOFF = BACKOFF_MS.reduce((a, b) => a + b, 0)

beforeEach(() => {
  resetUsage()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('请求体', () => {
  it('用 DashScope 的模型名', async () => {
    fetchMock.mockResolvedValue(ok())
    await call()
    expect(bodyOf(0).model).toBe(MODEL)
  })

  it('不再发送 thinking 参数（智谱专有，DashScope 不认）', async () => {
    fetchMock.mockResolvedValue(ok())
    await call()
    expect(bodyOf(0).thinking).toBeUndefined()
  })

  it('jsonMode 映射成 response_format', async () => {
    fetchMock.mockResolvedValue(ok())
    await chat({ messages: [{ role: 'user', content: '嗨' }], jsonMode: true })
    expect(bodyOf(0).response_format).toEqual({ type: 'json_object' })
  })

  it('有 tools 时带上 tool_choice:auto；没有则两个字段都不出现', async () => {
    fetchMock.mockResolvedValue(ok())
    await chat({ messages: [{ role: 'user', content: '嗨' }], tools: [{ type: 'function' }] })
    expect(bodyOf(0).tool_choice).toBe('auto')
    await call()
    expect(bodyOf(1).tools).toBeUndefined()
    expect(bodyOf(1).tool_choice).toBeUndefined()
  })
})

describe('推理模型的 reasoning_content', () => {
  it('被剥掉，不会回传给上游污染下一轮 messages', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: {
        role: 'assistant', content: '好的', reasoning_content: '一大段思考过程',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }],
      } }] }),
    })
    const r = await call()
    expect((r as unknown as Record<string, unknown>).reasoning_content).toBeUndefined()
    // tool_calls 必须原样保留，执行器完全依赖它
    expect(r.tool_calls?.[0].function.name).toBe('f')
    expect(r.content).toBe('好的')
  })
})

describe('限流与真断网的区分', () => {
  it('429 指数退避重试，用尽档位后抛 LlmRateLimited', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(fail(429))
    const p = call().catch(e => e)
    await vi.advanceTimersByTimeAsync(TOTAL_BACKOFF)
    expect(await p).toBeInstanceOf(LlmRateLimited)
    // 首次 + 每个退避档位各重试一次
    expect(fetchMock).toHaveBeenCalledTimes(BACKOFF_MS.length + 1)
  })

  it('429 后某次重试成功则正常返回', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok())
    const p = call()
    await vi.advanceTimersByTimeAsync(TOTAL_BACKOFF)
    expect((await p).content).toBe('好的')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('非 429 的 4xx 不重试（那不是限流，重试只会更慢）', async () => {
    fetchMock.mockResolvedValue(fail(400))
    await expect(call()).rejects.toBeInstanceOf(LlmUnavailable)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('5xx 不重试', async () => {
    fetchMock.mockResolvedValue(fail(503))
    await expect(call()).rejects.toBeInstanceOf(LlmUnavailable)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('LlmRateLimited 是 LlmUnavailable 的子类，上层旧的 catch 仍然生效', () => {
    expect(new LlmRateLimited('x')).toBeInstanceOf(LlmUnavailable)
  })
})

describe('用量统计', () => {
  it('成功调用累加 usage，resetUsage 清零', async () => {
    fetchMock.mockResolvedValue(ok())
    await call(); await call()
    expect(sumUsage()).toEqual({ prompt_tokens: 246, completion_tokens: 978, total_tokens: 1224 })
    resetUsage()
    expect(sumUsage().total_tokens).toBe(0)
  })
})
