import { useState, type ReactNode } from 'react'
import { DESKTOP_MIN, pickShell, useViewportWidth } from '../lib/viewport'
import { MobileApp } from '../mobile/MobileApp'

/**
 * 按宽度分发外壳：手机走移动版，尴尬区（768~1023）走这张说明卡，够宽走桌面工作台。
 *
 * 这个文件早先是「窄屏一律拦下来」——那时候没有移动版，拦截是唯一诚实的选择：
 * 桌面版的核心动作要三栏同屏（读结论 ↔ 点编号 ↔ 回数据区核对），
 * 折成单栏之后这个动作物理上不存在，交一个点两下就用不了的响应式版本还不如直说不支持。
 *
 * 现在手机有了自己的形态（问答优先，记录从底部推上来），所以 < 768px 不再拦。
 * 但 768~1023 这一档保留原样：桌面三栏在这里必破版，移动外壳在这里又空得不像话，
 * 这个区间当初的取舍依然成立。断点口径统一在 src/lib/viewport.ts。
 */

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

/**
 * 该不该拦。保留这个导出是因为它守的判定没变：尴尬区要拦、点过「仍要继续」不能再拦。
 * 抽成纯函数是因为项目没配 jsdom（同 uiPrefs / SidekickProvider 的做法），组件本身测不了。
 */
// 这里多导出一个非组件函数会让本文件失去 fast refresh，规则报的就是这件事。
// 已知并接受，不是漏掉的告警。
// oxlint-disable-next-line react/only-export-components
export function shouldBlock(width: number, bypassed: boolean): boolean {
  return pickShell(width, bypassed) === 'gate'
}

export function NarrowScreenGate({ children }: { children: ReactNode }) {
  const width = useViewportWidth()
  const [bypassed, setBypassed] = useState(readBypass)
  const shell = pickShell(width, bypassed)

  if (shell === 'mobile') return <MobileApp />
  if (shell === 'desktop') return <>{children}</>

  return (
    <div className="h-full overflow-auto flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-xl border shadow-sm p-6">
        <div className="text-lg font-bold text-brand">OrbitOS</div>
        <h1 className="mt-3 text-base font-medium leading-relaxed">
          这个宽度两套界面都不合适，请把窗口拉到 ≥ {DESKTOP_MIN}px，或换用手机打开。
        </h1>
        <p className="mt-3 text-sm text-slate-400 leading-relaxed">
          桌面工作台是三栏同屏的：左边导航、中间数据区、右边星轨（Agent）。它真正被用起来的方式，
          是一边读星轨给出的结论、一边点结论里的编号跳回数据区核对——两者必须同时在屏幕上。
          折成单栏能显示，但这个核对动作就没了。
        </p>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          手机上有另一套界面：星轨对话是首屏，结论里的编号点开是从底部推上来的记录卡。
          它不是桌面版的窄版本，是同一套数据和权限之上的另一种用法。
        </p>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-xs text-slate-400">当前窗口</span>
          <span className="text-sm font-mono text-warn">{width}px</span>
        </div>
        <button
          onClick={() => { setBypassed(true); writeBypass() }}
          className="mt-4 w-full px-4 py-2 rounded-md border text-sm text-slate-500
                     hover:text-brand hover:border-brand">
          仍要继续（用桌面版，布局会破）
        </button>
        <p className="mt-2 text-xs text-slate-400 text-center">继续之后本次会话不再拦截。</p>
      </div>
    </div>
  )
}
