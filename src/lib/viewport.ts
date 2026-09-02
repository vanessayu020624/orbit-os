import { useSyncExternalStore } from 'react'

/**
 * 按宽度决定给谁哪一套外壳。
 *
 * 三档，不是两档，因为「手机」和「窄窗口」是两件不同的事：
 *
 *   < 768px   手机。给一套问答优先的移动外壳（见 src/mobile/）。
 *   768~1023  尴尬区。桌面三栏在这个宽度必破版，手机版在这个宽度又太空。
 *             这一档保留原来那张说明卡——它讲的取舍在这个区间依然成立。
 *   >= 1024   桌面三栏工作台。
 *
 * 为什么不是「一套响应式吃掉所有宽度」：桌面版的核心动作是
 * 「一边读结论、一边点结论里的编号跳回数据区核对」，需要导航/数据/Agent 三栏同屏。
 * 折成单栏之后这个动作物理上就不存在了。所以移动端不是桌面版的窄版本，
 * 而是另一个产品形态——问答优先，数据按需从底部推上来看一眼就关掉。
 * 硬要做成一套，交出去的会是一个两头都不好用的东西。
 */
export const MOBILE_MAX = 768
export const DESKTOP_MIN = 1024

export type Shell = 'mobile' | 'gate' | 'desktop'

/**
 * 抽成纯函数是因为项目没配 jsdom，组件渲染测不了，但「多宽走哪套外壳」是这个功能的全部意义。
 * bypassed 是那张说明卡上「仍要继续」的开关，只对尴尬区有意义——
 * 手机上不该有这个开关：那不是「布局会破」，那是另一个产品，没什么好放行的。
 */
export function pickShell(width: number, bypassed: boolean): Shell {
  if (width < MOBILE_MAX) return 'mobile'
  if (bypassed) return 'desktop'
  return width < DESKTOP_MIN ? 'gate' : 'desktop'
}

let mql: MediaQueryList | null = null
function media(): MediaQueryList | null {
  // 不在模块顶层建 MediaQueryList：这个文件会被 Node 里的单测直接 import，
  // 顶层碰 window 会让测试在 import 阶段就炸。
  if (mql) return mql
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  mql = window.matchMedia(`(min-width: ${DESKTOP_MIN}px)`)
  return mql
}

/**
 * 同时听 resize 和 matchMedia 的 change：resize 让说明卡上那个实时宽度跟得上拖拽，
 * change 保证跨过断点时一定收得到通知（resize 在部分环境里会被合并/节流，
 * 断点翻转却漏一次就会停在错误的那一屏）。
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const m = media()
  window.addEventListener('resize', onChange)
  m?.addEventListener('change', onChange)
  return () => {
    window.removeEventListener('resize', onChange)
    m?.removeEventListener('change', onChange)
  }
}

// 拿不到 window 时报一个「够宽」的数：探测失败的代价应该是布局破掉，
// 而不是把所有人塞进一个他没要的外壳里。
function readWidth(): number {
  return typeof window === 'undefined' ? DESKTOP_MIN : window.innerWidth
}

export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, readWidth)
}
