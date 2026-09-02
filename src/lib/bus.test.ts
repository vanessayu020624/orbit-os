import { describe, it, expect, beforeEach } from 'vitest'
import { askAgent, onAskAgent } from './bus'

// 每个用例结束都要摘掉订阅，否则 handler 是模块级的，会漏到下一个用例里。
let off: (() => void) | null = null
beforeEach(() => { off?.(); off = null })

describe('bus 的暂存槽', () => {
  it('订阅已就位时直接透传', () => {
    const got: string[] = []
    off = onAskAgent(q => got.push(q))
    askAgent('库存够吗')
    expect(got).toEqual(['库存够吗'])
  })

  // 这是飞书 ?ask= 回跳真正踩到的时序：子组件的 effect 早于父组件，触发发生在订阅之前。
  it('订阅晚于触发时，注册的一刻补发', () => {
    askAgent('未来两周交付有风险吗')
    const got: string[] = []
    off = onAskAgent(q => got.push(q))
    expect(got).toEqual(['未来两周交付有风险吗'])
  })

  it('补发只发一次，重新订阅不会再收到旧问题', () => {
    askAgent('只问一次')
    const first: string[] = []
    onAskAgent(q => first.push(q))()
    const second: string[] = []
    off = onAskAgent(q => second.push(q))
    expect(first).toEqual(['只问一次'])
    expect(second).toEqual([])
  })

  it('退订后触发会被暂存，等下一次订阅', () => {
    onAskAgent(() => { throw new Error('这个订阅已经退掉了，不该被调用') })()
    askAgent('退订之后的提问')
    const got: string[] = []
    off = onAskAgent(q => got.push(q))
    expect(got).toEqual(['退订之后的提问'])
  })
})
