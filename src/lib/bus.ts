// 极简全局事件总线：风险卡点击 -> 驱动 Sidekick 直接开跑，避免为此改动组件树。
type Handler = (q: string) => void
let handler: Handler | null = null

/**
 * 还没人订阅时先存起来。
 *
 * 起因是飞书回跳的 ?ask=：DeepLink 是 SidekickProvider 的子组件，而 React 里子组件的
 * effect 先于父组件执行，所以它调 askAgent 的那一刻订阅还没注册，问题会被静默丢弃——
 * 表现是从飞书点进来只看到一个空的 Sidekick，且完全不报错。
 * 把「订阅晚于触发」这件事在总线里解决，比让每个调用方去猜时序可靠。
 */
let pending: string | null = null

export const askAgent = (q: string) => {
  if (handler) handler(q)
  else pending = q
}

export const onAskAgent = (h: Handler) => {
  handler = h
  if (pending !== null) {
    const q = pending
    pending = null
    h(q)
  }
  return () => { handler = null }
}
