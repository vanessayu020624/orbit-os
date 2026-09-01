import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSeed } from '../lib/seed'
import type { AgentEvent, User } from '../lib/types'
import { runReplay } from './replay'

const db = generateSeed(42)
const userNamed = (name: string): User => db.users.find(u => u.name === name)!

beforeEach(() => {
  vi.useFakeTimers()
})

function run(scenario: 'delivery' | 'permission', user: User, requestConfirm: (id: string, n: string, a: unknown, s: string) => Promise<boolean>) {
  const events: AgentEvent[] = []
  const p = runReplay(scenario, user, (e) => events.push(e), requestConfirm)
  return { p, events }
}

describe('录播模式按角色门禁（Bug F3）', () => {
  it('供应链主管跑 delivery 会 emit confirm_request', async () => {
    const { p, events } = run('delivery', userNamed('王强'), async () => true)
    await vi.runAllTimersAsync()
    await p
    expect(events.some(e => e.type === 'confirm_request')).toBe(true)
  })

  it('CEO 跑 delivery 只 emit 一条 error，requestConfirm 从未被调用', async () => {
    const confirmCalls = vi.fn(async () => true)
    const { p, events } = run('delivery', userNamed('陈立'), confirmCalls)
    await vi.runAllTimersAsync()
    await p
    expect(events.length).toBe(1)
    expect(events[0].type).toBe('error')
    expect(confirmCalls).toHaveBeenCalledTimes(0)
  })

  it('销售代表跑 permission 正常播放', async () => {
    const { p, events } = run('permission', userNamed('张伟'), async () => true)
    await vi.runAllTimersAsync()
    await p
    expect(events.some(e => e.type === 'final')).toBe(true)
    expect(events.some(e => e.type === 'error')).toBe(false)
  })
})
