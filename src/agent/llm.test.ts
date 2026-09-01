import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chat, LlmRateLimited, LlmUnavailable, resetUsage, sumUsage } from './llm'

const OK_BODY = {
  choices: [{ message: { role: 'assistant', content: '好的' } }],
  usage: { prompt_tokens: 123, completion_tokens: 489, total_tokens: 612 },
}
const ok = () => ({ ok: true, status: 200, json: async () => OK_BODY })
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) })

let fetchMock: ReturnType<typeof vi.fn>
const bodyOf = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body as string)
const call = () => chat({ messages: [{ role: 'user', content: '嗨' }] })

beforeEach(() => {
  resetUsage()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('thinking 参数与它的兜底（Bug 3b）', () => {
  it('正常请求带 thinking:{type:"disabled"}', async () => {
    fetchMock.mockResolvedValue(ok())
    await call()
    expect(bodyOf(0).thinking).toEqual({ type: 'disabled' })
  })

  it('服务端对 thinking 返回 400 时，去掉该参数重试一次并成功', async () => {
    fetchMock.mockResolvedValueOnce(fail(400)).mockResolvedValueOnce(ok())
    const r = await call()
    expect(r.content).toBe('好的')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodyOf(0).thinking).toEqual({ type: 'disabled' })
    expect(bodyOf(1).thinking).toBeUndefined()
    // 其余字段保持不变
    expect(bodyOf(1).model).toBe(bodyOf(0).model)
    expect(bodyOf(1).messages).toEqual(bodyOf(0).messages)
  })

  it('去掉 thinking 后仍失败则如实抛错，不无限重试', async () => {
    fetchMock.mockResolvedValue(fail(400))
    await expect(call()).rejects.toBeInstanceOf(LlmUnavailable)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('5xx 不触发去 thinking 的重试（那不是参数问题）', async () => {
    fetchMock.mockResolvedValue(fail(503))
    await expect(call()).rejects.toBeInstanceOf(LlmUnavailable)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('限流与真断网的区分（Bug 3a）', () => {
  it('429 抛 LlmRateLimited，并退避重试一次', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(fail(429))
    const p = call().catch(e => e)
    await vi.advanceTimersByTimeAsync(6000)
    const e = await p
    expect(e).toBeInstanceOf(LlmRateLimited)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('429 后重试成功则正常返回，且不会退化成去掉 thinking', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok())
    const p = call()
    await vi.advanceTimersByTimeAsync(6000)
    expect((await p).content).toBe('好的')
    expect(bodyOf(1).thinking).toEqual({ type: 'disabled' })
  })

  it('LlmRateLimited 是 LlmUnavailable 的子类，上层旧的 catch 仍然生效', () => {
    expect(new LlmRateLimited('x')).toBeInstanceOf(LlmUnavailable)
  })
})

describe('用量统计（Bug 3d）', () => {
  it('成功调用累加 usage，resetUsage 清零', async () => {
    fetchMock.mockResolvedValue(ok())
    await call(); await call()
    expect(sumUsage()).toEqual({ prompt_tokens: 246, completion_tokens: 978, total_tokens: 1224 })
    resetUsage()
    expect(sumUsage().total_tokens).toBe(0)
  })
})
