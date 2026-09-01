import { describe, it, expect } from 'vitest'
import { readUiPrefs, writeUiPrefs, DEFAULT_UI_PREFS } from './uiPrefs'

// 没有 jsdom，用假 Storage 对象测试。只测纯函数本身的回落与往返逻辑。

function fakeStore(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v },
    _data: data,
  }
}

describe('readUiPrefs', () => {
  it('空存储 → 返回默认值', () => {
    expect(readUiPrefs(fakeStore())).toEqual(DEFAULT_UI_PREFS)
  })

  it('合法 JSON → 原样返回', () => {
    const store = fakeStore({ 'orbitos.ui.sidekick': JSON.stringify({ open: false, wide: true }) })
    expect(readUiPrefs(store)).toEqual({ open: false, wide: true })
  })

  it('非法 JSON 字符串 → 返回默认值，不抛', () => {
    const store = fakeStore({ 'orbitos.ui.sidekick': '{oops' })
    expect(() => readUiPrefs(store)).not.toThrow()
    expect(readUiPrefs(store)).toEqual(DEFAULT_UI_PREFS)
  })

  it('合法 JSON 但不是对象 → 返回默认值', () => {
    const store = fakeStore({ 'orbitos.ui.sidekick': JSON.stringify('just a string') })
    expect(readUiPrefs(store)).toEqual(DEFAULT_UI_PREFS)
  })

  it('字段缺失 → 逐字段回落，不整体丢弃', () => {
    const store = fakeStore({ 'orbitos.ui.sidekick': JSON.stringify({ wide: true }) })
    expect(readUiPrefs(store)).toEqual({ open: true, wide: true })
  })

  it('字段类型不对 → 该字段回落为默认值', () => {
    const store = fakeStore({ 'orbitos.ui.sidekick': JSON.stringify({ open: 'yes' }) })
    expect(readUiPrefs(store)).toEqual({ open: true, wide: false })
  })

  it('getItem 抛异常 → 返回默认值，不抛', () => {
    const store = { getItem: () => { throw new Error('boom') } }
    expect(() => readUiPrefs(store)).not.toThrow()
    expect(readUiPrefs(store)).toEqual(DEFAULT_UI_PREFS)
  })
})

describe('writeUiPrefs', () => {
  it('setItem 抛异常时不抛', () => {
    const store = { setItem: () => { throw new Error('boom') } }
    expect(() => writeUiPrefs({ open: false, wide: true }, store)).not.toThrow()
  })

  it('写入后 readUiPrefs 能读回同一份（往返一致）', () => {
    const store = fakeStore()
    writeUiPrefs({ open: false, wide: true }, store)
    expect(readUiPrefs(store)).toEqual({ open: false, wide: true })
  })
})
