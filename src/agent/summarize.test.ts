import { describe, it, expect, vi, beforeEach } from 'vitest'

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }))
vi.mock('./llm', async () => {
  const actual = await vi.importActual<typeof import('./llm')>('./llm')
  return { ...actual, chat: (...args: unknown[]) => chatMock(...args) }
})

import { splitHistory, summarizeTurns, summarizePrompt, HISTORY_TURNS, SUMMARY_MAX } from './summarize'

const turns = (n: number) => Array.from({ length: n }, (_, i) => ({ q: `问${i}`, a: `答${i}` }))

beforeEach(() => { chatMock.mockReset() })

describe('splitHistory', () => {
  it(`不足 ${HISTORY_TURNS} 轮时原样保留，不产生摘要工作`, () => {
    const h = turns(HISTORY_TURNS)
    expect(splitHistory(h)).toEqual({ kept: h, dropped: [] })
  })

  it('超出后只挤出最旧的那几轮，保留的仍是最新的', () => {
    const { kept, dropped } = splitHistory(turns(HISTORY_TURNS + 2))
    expect(kept).toHaveLength(HISTORY_TURNS)
    expect(dropped).toEqual([{ q: '问0', a: '答0' }, { q: '问1', a: '答1' }])
    expect(kept.at(-1)).toEqual({ q: `问${HISTORY_TURNS + 1}`, a: `答${HISTORY_TURNS + 1}` })
  })
})

describe('summarizeTurns', () => {
  it('把已有摘要和新挤出的轮次一起交给模型，并且不计入本次问询用量', async () => {
    chatMock.mockResolvedValue({ role: 'assistant', content: '  用户关注华宁自动化的交付风险。  ' })
    const out = await summarizeTurns('旧摘要', [{ q: '甲', a: '乙' }])

    expect(out).toBe('用户关注华宁自动化的交付风险。')
    const opts = chatMock.mock.calls[0][0]
    // 归到下一问的成本里会让「本次问询消耗 N tokens」这个数字失真。
    expect(opts.countUsage).toBe(false)
    expect(opts.messages[0].content).toContain('旧摘要')
    expect(opts.messages[0].content).toContain('甲')
  })

  it('没有挤出任何轮次时不调用模型', async () => {
    expect(await summarizeTurns('旧摘要', [])).toBe('旧摘要')
    expect(chatMock).not.toHaveBeenCalled()
  })

  it('模型失败时退回原摘要而不是抛出——摘要挂了不该让下一次提问也挂', async () => {
    chatMock.mockRejectedValue(new Error('boom'))
    await expect(summarizeTurns('旧摘要', [{ q: '甲', a: '乙' }])).resolves.toBe('旧摘要')
  })

  it('模型返回空串时退回原摘要，不会把摘要清空', async () => {
    chatMock.mockResolvedValue({ role: 'assistant', content: '   ' })
    expect(await summarizeTurns('旧摘要', [{ q: '甲', a: '乙' }])).toBe('旧摘要')
  })

  it(`摘要截断到 ${SUMMARY_MAX} 字，防止它无限增长成固定开销`, async () => {
    chatMock.mockResolvedValue({ role: 'assistant', content: '啊'.repeat(SUMMARY_MAX + 50) })
    const out = await summarizeTurns(undefined, [{ q: '甲', a: '乙' }])
    expect(out).toHaveLength(SUMMARY_MAX)
  })
})

describe('summarizePrompt', () => {
  it('首次摘要时明确说明还没有已有摘要，不留一个空标题', () => {
    expect(summarizePrompt(undefined, [{ q: '甲', a: '乙' }])).toContain('目前还没有摘要')
  })
  it('长回答按 800 字截断后再进摘要请求', () => {
    const p = summarizePrompt(undefined, [{ q: '甲', a: '啊'.repeat(1000) }])
    expect(p).toContain('啊'.repeat(800))
    expect(p).not.toContain('啊'.repeat(801))
  })
})
