import { useState, useSyncExternalStore, type ReactNode } from 'react'

/**
 * 窄屏不做降级布局，直接换掉整个工作台。
 *
 * OrbitOS 的核心动作是「一边读星轨的结论，一边点结论里的编号跳回数据区核对」，
 * 这要求导航 / 数据区 / Agent 侧栏三栏同屏并置。折成单栏之后，结论和被它引用的
 * 那条记录永远不可能同时出现在屏幕上，这个动作就没了——剩下的只是一个能打开、
 * 点两下就发现用不了的壳。所以这里选择明确不支持并把理由讲出来，
 * 而不是交一个看起来做了响应式、实际毁掉核心交互的移动版。
 */

// 1024 同时喂给媒体查询和 shouldBlock 的比较，是为了不出现「CSS 认为宽、JS 认为窄」
// 这种只在边界上偶发、几乎没法复现的分歧。改这个数等于改产品结论，先看上面那段。
const MIN_WIDTH = 1024
const MEDIA_QUERY = `(min-width: ${MIN_WIDTH}px)`

// 放行状态存 sessionStorage 而不是组件 state：点完「仍要继续」再刷新或换路由
// 又被拦回来，看的人会判定这是个 bug 而不是一个决定。用 session 而非 local，
// 是为了下次新开标签页还能看到这张卡——它是作品的一部分，不该被一次点击永久关掉。
const BYPASS_KEY = 'orbitos.narrowGate.bypass'

/** 存储不可用（隐私模式、被禁用）时按「没放行」处理，绝不因为读写失败把人挡死或漏放。 */
function readBypass(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(BYPASS_KEY) === '1'
  } catch {
    return false
  }
}

function writeBypass(): void {
  try {
    globalThis.sessionStorage?.setItem(BYPASS_KEY, '1')
  } catch {
    // Safari 隐私模式等：这一次会话内的 state 已经放行了，写不进去就算了
  }
}

let mql: MediaQueryList | null = null
function media(): MediaQueryList | null {
  if (mql) return mql
  // 不在模块顶层建 MediaQueryList：这个文件会被 Node 里的单测直接 import，
  // 顶层碰 window 会让测试在 import 阶段就炸。
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  mql = window.matchMedia(MEDIA_QUERY)
  return mql
}

/**
 * 同时听 resize 和 matchMedia 的 change：resize 让卡片上那个实时宽度跟得上拖拽，
 * change 保证跨过 1024 这条线时一定收得到通知（resize 在部分环境里会被合并/节流，
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
// 而不是把所有人挡在一张说明卡后面、连试都试不了。
function readWidth(): number {
  return typeof window === 'undefined' ? MIN_WIDTH : window.innerWidth
}

/**
 * 该不该拦。抽成纯函数是因为项目没配 jsdom（同 uiPrefs / SidekickProvider 的做法），
 * 组件本身测不了，但「多窄算窄、放行之后还拦不拦」这两条是这个功能的全部意义所在，
 * 必须单独钉住。等于 1024 不拦：媒体查询是 min-width，两边口径得一致。
 */
// 这里多导出一个非组件函数会让本文件失去 fast refresh，规则报的就是这件事。
// 为它单开一个文件的代价更大：判定会和它唯一的使用者分家，读的人得跳两个文件
// 才知道 1024 是怎么用的。已知并接受，不是漏掉的告警。
// oxlint-disable-next-line react/only-export-components
export function shouldBlock(width: number, bypassed: boolean): boolean {
  return !bypassed && width < MIN_WIDTH
}

export function NarrowScreenGate({ children }: { children: ReactNode }) {
  const width = useSyncExternalStore(subscribe, readWidth)
  const [bypassed, setBypassed] = useState(readBypass)

  if (!shouldBlock(width, bypassed)) return <>{children}</>

  return (
    <div className="h-full overflow-auto flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-xl border shadow-sm p-6">
        <div className="text-lg font-bold text-brand">OrbitOS</div>
        <h1 className="mt-3 text-base font-medium leading-relaxed">
          这是面向桌面工作流的 B 端控制台，请在宽度 ≥ {MIN_WIDTH}px 的窗口打开。
        </h1>
        <p className="mt-3 text-sm text-slate-400 leading-relaxed">
          工作台是三栏同屏的：左边导航、中间数据区、右边星轨（Agent）。它真正被用起来的方式，
          是一边读星轨给出的结论、一边点结论里的编号跳回数据区核对——两者必须同时在屏幕上。
          折成单栏能显示，但这个核对动作就没了。
        </p>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          所以这里没有做移动端适配：与其交一个能打开、点两下发现用不了的版本，
          不如把「不支持窄屏」说清楚。
        </p>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-xs text-slate-400">当前窗口</span>
          <span className="text-sm font-mono text-warn">{width}px</span>
        </div>
        <button
          onClick={() => { setBypassed(true); writeBypass() }}
          className="mt-4 w-full px-4 py-2 rounded-md border text-sm text-slate-500
                     hover:text-brand hover:border-brand">
          仍要继续（布局会破）
        </button>
        <p className="mt-2 text-xs text-slate-400 text-center">继续之后本次会话不再拦截。</p>
      </div>
    </div>
  )
}
