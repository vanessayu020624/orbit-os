import { describe, it, expect } from 'vitest'
import { ORDER_SLICE_HEX, sliceColor } from './orderPalette'
import { ORDER_TONE } from '../../components/StatusChip'

// 这张表守的是一件肉眼才发现得了、但代码里说得清的事：饼图上不许有两块同色。
// 它是回归测试而不是装饰——上一版复用状态标签的色板，六个状态塌成四个颜色，
// 现场看到的是两块橙、两块绿，图例形同虚设。

describe('订单状态饼图配色', () => {
  it('每个订单状态都有颜色，不留空档', () => {
    for (const status of Object.keys(ORDER_TONE)) {
      expect(ORDER_SLICE_HEX[status as keyof typeof ORDER_SLICE_HEX]).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('六个状态六个颜色，两两不重复——这正是上一版塌掉的地方', () => {
    const hexes = Object.values(ORDER_SLICE_HEX)
    expect(new Set(hexes).size).toBe(hexes.length)
  })

  it('状态标签的色板确实塌了色，所以饼图才需要自己一套', () => {
    const tones = Object.values(ORDER_TONE)
    expect(new Set(tones).size).toBeLessThan(tones.length)
  })

  it('表外状态落灰色，不抛错——外接数据源迟早会送来没见过的状态', () => {
    expect(sliceColor('已退货')).toBe('#c4c4c4')
    expect(sliceColor('待审核')).toBe('#fdab3d')
  })
})
