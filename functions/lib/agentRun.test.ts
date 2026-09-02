import { describe, it, expect } from 'vitest'
import type { RunAgentOptions } from '../../src/agent/loop'
import { runAgentServerSide, resolveUser } from './agentRun'
import { generateSeed } from '../../src/lib/seed'

// 不打桩 loop.ts，用 runner 注入一个按脚本吐事件的假执行器。真跑一遍既依赖模型、
// 也验不出这里要验的分支（把关与拦截）。执行器本身在 loop.test.ts 里另有覆盖。
const OK_ENDPOINT = 'https://example.com/api/chat'
const SUPPLY_CHAIN = 'U-006'

/** 把一段事件脚本包成执行器。runCount 用来断言「压根没跑」这种情况。 */
let runCount = 0
function script(fn: (o: RunAgentOptions) => void | Promise<void>) {
  runCount = 0
  return async (o: RunAgentOptions) => { runCount++; await fn(o) }
}

describe('resolveUser', () => {
  it('查得到就返回那个人', () => {
    const db = generateSeed(42)
    expect(resolveUser(db.users, SUPPLY_CHAIN)?.id).toBe(SUPPLY_CHAIN)
  })
  it('查不到返回 null，不抛', () => {
    expect(resolveUser(generateSeed(42).users, 'U-999')).toBeNull()
  })
})

describe('runAgentServerSide', () => {
  it('正常一轮：结论、引用、工具次数都带回来', async () => {
    const runner = script(o => {
      o.emit({ type: 'tool_result', id: '1', result: {}, ms: 3 })
      o.emit({ type: 'final', text: '有 2 张订单存在缺货风险', refs: ['SO-2026-0412', 'SKU-203'] })
    })
    const r = await runAgentServerSide({ question: '交付有风险吗', orbitUserId: SUPPLY_CHAIN, chatEndpoint: OK_ENDPOINT, runner })
    expect(r.ok).toBe(true)
    expect(r.answer).toBe('有 2 张订单存在缺货风险')
    expect(r.refs).toEqual(['SO-2026-0412', 'SKU-203'])
    expect(r.toolCalls).toBe(1)
    expect(r.blockedWrite).toBeNull()
  })

  it('传进去的用户就是执行器认定的身份，权限不由飞书那边决定', async () => {
    let seen = ''
    const runner = script(o => {
      seen = o.user.id
      o.emit({ type: 'tool_result', id: '1', result: {}, ms: 1 })
      o.emit({ type: 'final', text: '结论', refs: [] })
    })
    await runAgentServerSide({ question: 'q', orbitUserId: 'U-001', chatEndpoint: OK_ENDPOINT, runner })
    expect(seen).toBe('U-001')
  })

  it('用户 id 映射错了，报一句能照着去修的话', async () => {
    const runner = script(() => { throw new Error('不该跑到这里') })
    const r = await runAgentServerSide({ question: 'q', orbitUserId: 'U-999', chatEndpoint: OK_ENDPOINT, runner })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('FEISHU_USER_MAP')
    expect(runCount).toBe(0)
  })

  // 这条是整条飞书链路的核心约束：写操作在服务端一定拿不到批准。
  it('requestConfirm 恒返回 false，并把被拦的动作交出来', async () => {
    let approved: boolean | null = null
    const runner = script(async o => {
      approved = await o.requestConfirm('c1', 'create_purchase_order', {}, '将开一张加急采购单')
      o.emit({ type: 'tool_result', id: '1', result: {}, ms: 1 })
      o.emit({ type: 'final', text: '建议开一张加急采购单', refs: [] })
    })
    const r = await runAgentServerSide({ question: '补货', orbitUserId: SUPPLY_CHAIN, chatEndpoint: OK_ENDPOINT, runner })
    expect(approved).toBe(false)
    expect(r.blockedWrite).toEqual({ toolName: 'create_purchase_order', summary: '将开一张加急采购单' })
    // 被拦不等于这轮失败：执行器照样会给出建议，用户在飞书里拿得到「该做什么」。
    expect(r.ok).toBe(true)
  })

  it('连续两次写操作，记住第一次那个（卡片上只放一个动作）', async () => {
    const runner = script(async o => {
      await o.requestConfirm('c1', 'reserve_inventory', {}, '将锁定库存')
      await o.requestConfirm('c2', 'update_order_promise_date', {}, '将改交期')
      o.emit({ type: 'tool_result', id: '1', result: {}, ms: 1 })
      o.emit({ type: 'final', text: '建议', refs: [] })
    })
    const r = await runAgentServerSide({ question: 'q', orbitUserId: SUPPLY_CHAIN, chatEndpoint: OK_ENDPOINT, runner })
    expect(r.blockedWrite?.toolName).toBe('reserve_inventory')
  })

  it('mutate 被调用说明有写工具漏配了 isWrite，当场炸而不是静默改一份没人看的快照', async () => {
    const runner = script(o => { o.mutate({ kind: 'reserveInventory' } as never) })
    const r = await runAgentServerSide({ question: 'q', orbitUserId: SUPPLY_CHAIN, chatEndpoint: OK_ENDPOINT, runner })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('服务端不允许写操作')
  })

  // 守卫 A 的服务端版本：发出去的消息比屏幕上的更难撤回。
  it('一次工具都没调的结论一律拦下', async () => {
    const runner = script(o => o.emit({ type: 'final', text: '本月营收 2566.9 万', refs: [] }))
    const r = await runAgentServerSide({ question: 'q', orbitUserId: SUPPLY_CHAIN, chatEndpoint: OK_ENDPOINT, runner })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('无法溯源')
    expect(r.answer).toBe('本月营收 2566.9 万')
  })

  it('没有 final 就是没有结论', async () => {
    const runner = script(o => o.emit({ type: 'tool_result', id: '1', result: {}, ms: 1 }))
    const r = await runAgentServerSide({ question: 'q', orbitUserId: SUPPLY_CHAIN, chatEndpoint: OK_ENDPOINT, runner })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('没有产出结论')
  })

  it('执行器抛错时，优先用它 emit 出来的那条已分类的错误', async () => {
    const runner = script(o => {
      o.emit({ type: 'error', message: '模型 45 秒没有响应' })
      throw new Error('LlmTimeout')
    })
    const r = await runAgentServerSide({ question: 'q', orbitUserId: SUPPLY_CHAIN, chatEndpoint: OK_ENDPOINT, runner })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('模型 45 秒没有响应')
  })

  it('没 emit 过 error 的异常（工具层抛的）也要带出来', async () => {
    const runner = script(() => { throw new Error('BOOM') })
    const r = await runAgentServerSide({ question: 'q', orbitUserId: SUPPLY_CHAIN, chatEndpoint: OK_ENDPOINT, runner })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('BOOM')
  })
})
