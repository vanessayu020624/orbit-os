import { describe, it, expect } from 'vitest'
import {
  titleFor, newConversation, sanitizeItems,
  readConversations, writeConversations, MAX_CONVERSATIONS,
  activeFor, archivedFor, otherRoleCount, pruneConversations,
  MAX_ACTIVE_PER_USER, MAX_ARCHIVED_PER_USER,
  type Conversation,
} from './conversations'
import type { Item } from '../sidekick/SidekickProvider'

// 假存储照 uiPrefs 的测试写法造：一个内存 Map 包一层 getItem/setItem。
function fakeStore(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v) },
  }
}

describe('titleFor', () => {
  it('取首个 user 项的文本', () => {
    const items: Item[] = [{ k: 'plan', plan: { steps: [] } as never }, { k: 'user', text: '你好' }]
    expect(titleFor(items)).toBe('你好')
  })
  it('超过 20 字截断并补「…」', () => {
    const text = '一二三四五六七八九十一二三四五六七八九十一'
    const items: Item[] = [{ k: 'user', text }]
    expect(titleFor(items)).toBe(text.slice(0, 20) + '…')
  })
  it('恰好 20 字不加「…」', () => {
    const text = '一二三四五六七八九十一二三四五六七八九十'
    expect(text.length).toBe(20)
    const items: Item[] = [{ k: 'user', text }]
    expect(titleFor(items)).toBe(text)
  })
  it('没有 user 项时返回「新会话」', () => {
    const items: Item[] = [{ k: 'plan', plan: { steps: [] } as never }]
    expect(titleFor(items)).toBe('新会话')
  })
})

describe('newConversation', () => {
  it('字段齐全，items 与 history 为空数组，title 为「新会话」', () => {
    const c = newConversation('conv-1', 'U-001', 1000)
    expect(c).toEqual({ id: 'conv-1', title: '新会话', userId: 'U-001', createdAt: 1000, items: [], history: [] })
  })
})

describe('sanitizeItems', () => {
  it('resolved 为 undefined 的 confirm 变成中断提示', () => {
    const items: Item[] = [{ k: 'confirm', id: 'c1', toolName: 't', summary: 's' }]
    expect(sanitizeItems(items)).toEqual([
      { k: 'error', text: '这一轮的确认在页面刷新前未完成，已中断。' },
    ])
  })
  it('resolved: true 与 resolved: false 的 confirm 原样保留', () => {
    const items: Item[] = [
      { k: 'confirm', id: 'c1', toolName: 't', summary: 's', resolved: true },
      { k: 'confirm', id: 'c2', toolName: 't', summary: 's', resolved: false },
    ]
    expect(sanitizeItems(items)).toEqual(items)
  })
  it('其它类型的项不受影响', () => {
    const items: Item[] = [{ k: 'user', text: '问题' }, { k: 'final', text: '答案', refs: [] }]
    expect(sanitizeItems(items)).toEqual(items)
  })
  it('不修改入参数组', () => {
    const items: Item[] = [{ k: 'confirm', id: 'c1', toolName: 't', summary: 's' }]
    const copy = JSON.parse(JSON.stringify(items))
    sanitizeItems(items)
    expect(items).toEqual(copy)
  })
})

describe('readConversations', () => {
  it('getItem 抛异常 → []', () => {
    const store = { getItem: () => { throw new Error('boom') } }
    expect(readConversations(store)).toEqual([])
  })
  it('返回 null → []', () => {
    const store = { getItem: () => null }
    expect(readConversations(store)).toEqual([])
  })
  it('返回非法 JSON → []', () => {
    const store = { getItem: () => '{not json' }
    expect(readConversations(store)).toEqual([])
  })
  it('返回 \'{"a":1}\'（不是数组） → []', () => {
    const store = { getItem: () => '{"a":1}' }
    expect(readConversations(store)).toEqual([])
  })
  it('数组里一条合法一条缺 userId → 只返回合法的那条', () => {
    const good = newConversation('conv-1', 'U-001', 1000)
    const bad = { id: 'conv-2', title: 'x', createdAt: 2000, items: [], history: [] } // 缺 userId
    const store = fakeStore({ [ 'orbitos.sidekick.conversations' ]: JSON.stringify([good, bad]) })
    const result = readConversations(store)
    expect(result).toEqual([good])
  })
  it('读回时未决 confirm 已被 sanitizeItems 处理', () => {
    const c: Conversation = {
      ...newConversation('conv-1', 'U-001', 1000),
      items: [{ k: 'confirm', id: 'c1', toolName: 't', summary: 's' }],
    }
    const store = fakeStore({ 'orbitos.sidekick.conversations': JSON.stringify([c]) })
    const result = readConversations(store)
    expect(result[0].items).toEqual([{ k: 'error', text: '这一轮的确认在页面刷新前未完成，已中断。' }])
  })
})

describe('writeConversations', () => {
  it('超过 MAX_CONVERSATIONS 条时只写前 MAX_CONVERSATIONS 条', () => {
    const cs = Array.from({ length: MAX_CONVERSATIONS + 5 }, (_, i) => newConversation(`conv-${i}`, 'U-001', i))
    const store = fakeStore()
    writeConversations(cs, store)
    const raw = store.getItem('orbitos.sidekick.conversations')!
    expect((JSON.parse(raw) as unknown[]).length).toBe(MAX_CONVERSATIONS)
  })
  it('setItem 抛异常时不抛出', () => {
    const store = { setItem: () => { throw new Error('quota') } }
    expect(() => writeConversations([newConversation('c', 'U-001', 1)], store)).not.toThrow()
  })
})

describe('往返一致性', () => {
  it('writeConversations 后 readConversations 拿到等价数据', () => {
    const cs = [newConversation('conv-1', 'U-001', 1000), newConversation('conv-2', 'U-002', 2000)]
    const store = fakeStore()
    writeConversations(cs, store)
    expect(readConversations(store)).toEqual(cs)
  })
})

describe('activeFor', () => {
  it('只返回指定 userId 的、且 archived 不为真的，保持传入顺序', () => {
    const cs: Conversation[] = [
      newConversation('conv-1', 'U-001', 1000),
      { ...newConversation('conv-2', 'U-001', 2000), archived: true },
      newConversation('conv-3', 'U-002', 3000),
      newConversation('conv-4', 'U-001', 4000),
    ]
    expect(activeFor(cs, 'U-001').map(c => c.id)).toEqual(['conv-1', 'conv-4'])
  })
  it('没有 archived 字段的老数据必须被当成未归档返回', () => {
    const old = { id: 'conv-1', title: 'x', userId: 'U-001', createdAt: 1000, items: [], history: [] } as Conversation
    expect(activeFor([old], 'U-001')).toEqual([old])
  })
})

describe('archivedFor', () => {
  it('只返回指定 userId 的 archived === true 的', () => {
    const cs: Conversation[] = [
      newConversation('conv-1', 'U-001', 1000),
      { ...newConversation('conv-2', 'U-001', 2000), archived: true },
      { ...newConversation('conv-3', 'U-002', 3000), archived: true },
    ]
    expect(archivedFor(cs, 'U-001').map(c => c.id)).toEqual(['conv-2'])
  })
})

describe('otherRoleCount', () => {
  it('统计不属于该 userId 的条数，归档的也计入', () => {
    const cs: Conversation[] = [
      newConversation('conv-1', 'U-001', 1000),
      newConversation('conv-2', 'U-002', 2000),
      { ...newConversation('conv-3', 'U-002', 3000), archived: true },
    ]
    expect(otherRoleCount(cs, 'U-001')).toBe(2)
  })
})

describe('pruneConversations', () => {
  it('单个角色 25 条未归档 → 留 20 条，丢掉数组末尾（最旧）的 5 条', () => {
    const cs = Array.from({ length: 25 }, (_, i) => newConversation(`conv-${i}`, 'U-001', i))
    const result = pruneConversations(cs)
    expect(result.length).toBe(MAX_ACTIVE_PER_USER)
    expect(result.map(c => c.id)).toEqual(cs.slice(0, 20).map(c => c.id))
  })
  it('两个角色各 25 条未归档 → 各留 20 条，共 40 条', () => {
    const a = Array.from({ length: 25 }, (_, i) => newConversation(`a-${i}`, 'U-001', i))
    const b = Array.from({ length: 25 }, (_, i) => newConversation(`b-${i}`, 'U-002', i))
    const result = pruneConversations([...a, ...b])
    expect(result.length).toBe(40)
    expect(result.filter(c => c.userId === 'U-001').length).toBe(20)
    expect(result.filter(c => c.userId === 'U-002').length).toBe(20)
  })
  it('归档的不占未归档名额：某角色 20 条未归档 + 5 条归档 → 25 条全留', () => {
    const active = Array.from({ length: 20 }, (_, i) => newConversation(`act-${i}`, 'U-001', i))
    const archived = Array.from({ length: 5 }, (_, i) => ({ ...newConversation(`arc-${i}`, 'U-001', i), archived: true }))
    const result = pruneConversations([...active, ...archived])
    expect(result.length).toBe(25)
  })
  it('某角色 35 条归档 → 留 30 条', () => {
    const cs = Array.from({ length: 35 }, (_, i) => ({ ...newConversation(`conv-${i}`, 'U-001', i), archived: true }))
    const result = pruneConversations(cs)
    expect(result.length).toBe(MAX_ARCHIVED_PER_USER)
    expect(result.map(c => c.id)).toEqual(cs.slice(0, 30).map(c => c.id))
  })
  it('返回值保持入参的相对顺序', () => {
    const cs: Conversation[] = [
      newConversation('conv-1', 'U-001', 1000),
      newConversation('conv-2', 'U-002', 2000),
      newConversation('conv-3', 'U-001', 3000),
    ]
    expect(pruneConversations(cs).map(c => c.id)).toEqual(['conv-1', 'conv-2', 'conv-3'])
  })
})

describe('readConversations（archived 字段）', () => {
  it('存了一条带 archived: true 的记录，读回来 archived 仍为 true', () => {
    const c: Conversation = { ...newConversation('conv-1', 'U-001', 1000), archived: true }
    const store = fakeStore({ 'orbitos.sidekick.conversations': JSON.stringify([c]) })
    const result = readConversations(store)
    expect(result[0].archived).toBe(true)
  })
})
