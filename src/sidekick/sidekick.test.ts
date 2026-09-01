import { describe, it, expect } from 'vitest'
import { shouldRecordTurn } from './SidekickProvider'

// 项目没配 jsdom，ask() 本身测不了；但「本轮该不该写进会话历史」这个判定是纯逻辑，
// 抽出来单独钉住。它守的是切角色竞态：一次问询 6~40 秒，用户中途切角色时，
// 清空历史的 effect 同步跑完，而 ask() 的 finally 在那之后才跑。

describe('切角色竞态：会话历史写回守卫', () => {
  it('角色没变且有答案 → 记录', () => {
    expect(shouldRecordTurn('U-006', 'U-006', '结论：两张订单有风险。')).toBe(true)
  })
  it('跑到一半被切走（发起角色 ≠ 当前角色）→ 丢弃，绝不把旧角色的数据带进新角色上下文', () => {
    expect(shouldRecordTurn('U-006', 'U-001', '结论：两张订单有风险。')).toBe(false)
  })
  it('角色没变但没有 final 文本（报错 / 录播未命中场景）→ 不记录', () => {
    expect(shouldRecordTurn('U-006', 'U-006', '')).toBe(false)
  })
})
