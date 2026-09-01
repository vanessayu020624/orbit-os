// 极简全局事件总线：风险卡点击 -> 驱动 Sidekick 直接开跑，避免为此改动组件树。
type Handler = (q: string) => void
let handler: Handler | null = null
export const askAgent = (q: string) => handler?.(q)
export const onAskAgent = (h: Handler) => { handler = h; return () => { handler = null } }
