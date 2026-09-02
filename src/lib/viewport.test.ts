import { describe, it, expect } from 'vitest'
import { pickShell, MOBILE_MAX, DESKTOP_MIN } from './viewport'

// 项目没配 jsdom，组件渲染测不了；但「多宽走哪套外壳」是这个功能的全部意义，必须钉住。
// 它守的是两件会当场毁掉演示的事：一是手机打开却落进桌面三栏（必破版），
// 二是宽屏打开却落进移动版（面试官看到的是个阉割壳）。

describe('外壳分发', () => {
  it('手机宽度走移动外壳', () => {
    expect(pickShell(320, false)).toBe('mobile')
    expect(pickShell(390, false)).toBe('mobile')
    expect(pickShell(767, false)).toBe('mobile')
  })

  it('尴尬区走说明卡', () => {
    expect(pickShell(MOBILE_MAX, false)).toBe('gate')
    expect(pickShell(1023, false)).toBe('gate')
  })

  it('够宽走桌面工作台，边界取 min-width 口径', () => {
    expect(pickShell(DESKTOP_MIN, false)).toBe('desktop')
    expect(pickShell(1440, false)).toBe('desktop')
  })

  it('放行开关只对尴尬区有意义——手机上没什么好放行的，那不是布局破了，是另一个产品', () => {
    expect(pickShell(900, true)).toBe('desktop')
    expect(pickShell(320, true)).toBe('mobile')
  })
})
