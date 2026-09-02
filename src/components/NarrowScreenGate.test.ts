import { describe, it, expect } from 'vitest'
import { shouldBlock } from './NarrowScreenGate'

// 项目没配 jsdom，组件渲染本身测不了；但「什么宽度该被拦下来换成说明卡」是纯逻辑，钉在这里。
// 完整的三档分发（手机 / 尴尬区 / 桌面）见 src/lib/viewport.test.ts，
// 本文件只守拦截这一档：断点跑偏（三栏工作台不到 1024px 会破版）和
// 放行开关失效（面试官点了继续还被挡在外面，等于把人锁死在作品外面）。

describe('窄屏拦截判定', () => {
  it('宽屏 → 不拦，直接透传工作台', () => {
    expect(shouldBlock(1440, false)).toBe(false)
  })

  it('尴尬区 → 拦下来换成说明卡', () => {
    expect(shouldBlock(812, false)).toBe(true)
  })

  it('手机宽度不再拦：它有自己的外壳，不需要一张说明卡', () => {
    expect(shouldBlock(390, false)).toBe(false)
  })

  it('点过「仍要继续」之后，再窄也透传——这个开关唯一的作用就是不把人锁在外面', () => {
    expect(shouldBlock(320, true)).toBe(false)
  })

  it('恰好 1024 不拦：媒体查询写的是 min-width，JS 这边的口径必须跟它一致，否则边界上会出现 CSS 认为宽、拦截认为窄的分歧', () => {
    expect(shouldBlock(1024, false)).toBe(false)
    expect(shouldBlock(1023, false)).toBe(true)
  })
})
