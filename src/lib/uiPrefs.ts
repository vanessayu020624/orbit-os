// UI 偏好（抽屉展开/宽窄）持久化到 localStorage。业务数据不持久化，仅这两个界面偏好例外。
// 写成接受 Storage 参数的纯函数，方便在没有 jsdom 的环境下用假对象测试。

export interface UiPrefs { open: boolean; wide: boolean }
export const DEFAULT_UI_PREFS: UiPrefs = { open: true, wide: false }

const KEY = 'orbitos.ui.sidekick'

function getStorage(store?: Pick<Storage, 'getItem'>): Pick<Storage, 'getItem'> | null {
  if (store) return store
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** 存储不可用（隐私模式、被禁用）或内容损坏时一律回落到默认值，绝不抛异常。 */
export function readUiPrefs(store?: Pick<Storage, 'getItem'>): UiPrefs {
  const s = getStorage(store)
  if (!s) return { ...DEFAULT_UI_PREFS }
  let raw: string | null
  try {
    raw = s.getItem(KEY)
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
  if (raw == null) return { ...DEFAULT_UI_PREFS }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...DEFAULT_UI_PREFS }
  }
  const p = parsed as Record<string, unknown>
  return {
    open: typeof p.open === 'boolean' ? p.open : DEFAULT_UI_PREFS.open,
    wide: typeof p.wide === 'boolean' ? p.wide : DEFAULT_UI_PREFS.wide,
  }
}

export function writeUiPrefs(p: UiPrefs, store?: Pick<Storage, 'setItem'>): void {
  const s = store ?? (() => {
    try {
      return globalThis.localStorage ?? null
    } catch {
      return null
    }
  })()
  if (!s) return
  try {
    s.setItem(KEY, JSON.stringify(p))
  } catch {
    // Safari 隐私模式等：忽略
  }
}
