// Sidekick 会话持久化。业务数据不持久化（generateSeed(42) 每次刷新重来），
// 会话是第二个例外（第一个是 uiPrefs.ts 的抽屉偏好）。
// 结构照抄 uiPrefs.ts：接受可选 store 参数、getItem/setItem 各自 try/catch、
// 损坏内容逐级回落、绝不抛异常。

import type { Item } from '../sidekick/SidekickProvider'

export interface Conversation {
  id: string
  title: string
  userId: string                        // 创建者，用于只读判定
  createdAt: number                     // Date.now()
  items: Item[]
  history: { q: string; a: string }[]   // 喂给模型的最近两轮
}

const KEY = 'orbitos.sidekick.conversations'
export const MAX_CONVERSATIONS = 20

const UNRESOLVED_CONFIRM_ERROR = '这一轮的确认在页面刷新前未完成，已中断。'

/** 标题取首个用户提问的前 20 字，超出补「…」；还没提问过的会话叫「新会话」。 */
export function titleFor(items: Item[]): string {
  const first = items.find((it): it is Extract<Item, { k: 'user' }> => it.k === 'user')
  if (!first) return '新会话'
  return first.text.length > 20 ? first.text.slice(0, 20) + '…' : first.text
}

/** 新建一个空会话。id 由调用方传入（便于测试确定性）。 */
export function newConversation(id: string, userId: string, createdAt: number): Conversation {
  return { id, title: '新会话', userId, createdAt, items: [], history: [] }
}

/** 把刷新后无法响应的未决确认卡换成中断提示。见决定 3。 */
export function sanitizeItems(items: Item[]): Item[] {
  return items.map(it => {
    if (it.k === 'confirm' && it.resolved === undefined) {
      return { k: 'error', text: UNRESOLVED_CONFIRM_ERROR }
    }
    return it
  })
}

function getStorage(store?: Pick<Storage, 'getItem'>): Pick<Storage, 'getItem'> | null {
  if (store) return store
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function isValidConversation(v: unknown): v is Conversation {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return typeof c.id === 'string'
    && typeof c.title === 'string'
    && typeof c.userId === 'string'
    && typeof c.createdAt === 'number'
    && Array.isArray(c.items)
    && Array.isArray(c.history)
}

/** 读回会话列表；存储不可用或内容损坏一律返回 []，绝不抛异常。 */
export function readConversations(store?: Pick<Storage, 'getItem'>): Conversation[] {
  const s = getStorage(store)
  if (!s) return []
  let raw: string | null
  try {
    raw = s.getItem(KEY)
  } catch {
    return []
  }
  if (raw == null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: Conversation[] = []
  for (const item of parsed) {
    if (!isValidConversation(item)) continue
    out.push({ ...item, items: sanitizeItems(item.items) })
  }
  return out
}

/** 写入；最多保留最近 MAX_CONVERSATIONS 条（按数组顺序取前 N 条），超额丢弃最旧的。 */
export function writeConversations(cs: Conversation[], store?: Pick<Storage, 'setItem'>): void {
  const s = store ?? (() => {
    try {
      return globalThis.localStorage ?? null
    } catch {
      return null
    }
  })()
  if (!s) return
  try {
    s.setItem(KEY, JSON.stringify(cs.slice(0, MAX_CONVERSATIONS)))
  } catch {
    // Safari 隐私模式、配额超限等：忽略
  }
}
