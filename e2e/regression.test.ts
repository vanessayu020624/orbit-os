/**
 * 打真实模型的端到端回归。不进 `npm test`——要外网、要几分钟、结果不确定，
 * 放进单元测试会让 CI 变成一个看天吃饭的东西。
 *
 * 它是改提示词或改 agent/loop.ts 之后的**手动验收关卡**：12 条预置问题 + 2 条边界问题
 * 各跑一遍完整链路（规划 → function calling → 工具执行 → 结论），逐条核对结论里每一个
 * [[编号]] 能不能用 resolveRef 在数据库里查到。核不上就是用户点下去会扑空的死链。
 *
 * 跑法：
 *   E2E_OUT=/tmp/e2e.md npx vitest run --config vitest.e2e.config.ts
 *   E2E_ONLY=sc-1,ceo-2 ...              只跑指定场景
 *
 * 它在 src/ 之外，是因为 tsc -b 只扫 src——这里用到 fs/process，放在 src 里会让
 * `npm run build` 报 TS2591（项目没装 @types/node，也没必要为一个测试文件装）。
 */
import { it, expect } from 'vitest'
import { writeFileSync } from 'fs'
import { generateSeed } from '../src/lib/seed'
import { resolveRef } from '../src/lib/refLookup'
import { runAgent } from '../src/agent/loop'
import { resetUsage, sumUsage } from '../src/agent/llm'
import type { AgentEvent, DbSnapshot, Mutation, Role, User } from '../src/lib/types'

const OUT = process.env.E2E_OUT!
const ONLY = (process.env.E2E_ONLY ?? '').split(',').filter(Boolean)
const ENDPOINT = 'https://orbit-os.pages.dev/api/chat'

const real = globalThis.fetch
globalThis.fetch = ((url: any, init: any) =>
  real(typeof url === 'string' && url.startsWith('/') ? ENDPOINT + url.slice('/api/chat'.length) : url, init)) as any

const SCENARIOS: { id: string; role: Role; q: string; followup?: string }[] = [
  { id: 'rep-1', role: 'sales_rep', q: '我手上有哪些待发货订单有交付风险？' },
  { id: 'rep-2', role: 'sales_rep', q: '我这个月的商机漏斗情况怎么样？' },
  { id: 'rep-3', role: 'sales_rep', q: '帮我给华宁自动化建一个下周的回访任务' },
  { id: 'dir-1', role: 'sales_director', q: '团队里逾期超过 30 天的应收有哪些？' },
  { id: 'dir-2', role: 'sales_director', q: '本月团队的营收和商机漏斗怎么样？' },
  { id: 'dir-3', role: 'sales_director', q: '未来两周要交付的订单有风险吗？' },
  { id: 'sc-1', role: 'supply_chain', q: '未来两周要交付的订单有风险吗？帮我排查并给出处理方案。',
    followup: '刚才那两张有风险的订单，除了 SKU-203 还缺别的料吗？' },
  { id: 'sc-2', role: 'supply_chain', q: 'SKU-203 库存够不够？在途采购什么时候到？' },
  { id: 'sc-3', role: 'supply_chain', q: '帮我把缺口最大的那个 SKU 的库存预留出来' },
  { id: 'ceo-1', role: 'ceo', q: '公司最大的客户是谁？' },
  { id: 'ceo-2', role: 'ceo', q: '本月全公司的营收、商机漏斗和逾期应收情况' },
  { id: 'ceo-3', role: 'ceo', q: '未来两周的交付风险，需要的话直接下加急采购单' },
  { id: 'edge-1', role: 'sales_director', q: '为什么上个月华东区的销售额下滑了？' },
  { id: 'edge-2', role: 'sales_rep', q: '帮我查一下公司所有客户的应收账款' },
]

/** 与 lib/store.ts 的 applyMutation 等价，就地改动。写操作后新建的记录必须真的落库，
 *  否则结论里引用新采购单号会被误判成「核不上」。 */
function applyMutation(db: DbSnapshot, m: Mutation, user: User) {
  switch (m.kind) {
    case 'createPurchaseOrder':
      db.purchaseOrders.unshift(m.po)
      for (const l of m.po.items) {
        const inv = db.inventory.find(i => i.skuId === l.skuId)
        if (inv) { inv.onHand += l.qty; inv.available = inv.onHand - inv.reserved }
      }
      break
    case 'updateOrderPromiseDate': {
      const o = db.orders.find(x => x.id === m.orderId || x.orderNo === m.orderId)
      if (o) o.promisedDeliveryDate = m.newDate
      break
    }
    case 'reserveInventory': {
      const inv = db.inventory.find(i => i.skuId === m.skuId)
      if (inv) { inv.reserved += m.qty; inv.available = inv.onHand - inv.reserved }
      break
    }
    case 'createTask':
      db.tasks.unshift({ id: `TSK-${db.tasks.length + 1}`, assigneeId: m.assigneeId,
                         title: m.title, dueDate: m.dueDate, createdBy: user.id })
      break
  }
}

it('e2e', { timeout: 900_000 }, async () => {
  const lines: string[] = []
  for (const sc of SCENARIOS) {
    if (ONLY.length && !ONLY.includes(sc.id)) continue
    const db: DbSnapshot = generateSeed(42)
    const user: User = db.users.find(u => u.role === sc.role)!
    const ev: AgentEvent[] = []
    resetUsage()
    const t0 = Date.now()
    let err = ''
    try {
      await runAgent({
        question: sc.q, user, getDb: () => db,
        mutate: (m: Mutation) => applyMutation(db, m, user), emit: e => ev.push(e), pushAudit: () => {},
        requestConfirm: async () => true,
      })
    } catch (e) { err = String(e) }
    const final = ev.filter(e => e.type === 'final').map(e => (e as any).text).join('\n')
    const refs = [...final.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1])
    const bad = [...new Set(refs)].filter(r => resolveRef(db, user, r) === null)
    lines.push([
      `### ${sc.id} [${sc.role}] ${sc.q}`,
      `耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s  事件 ${ev.length}  错误 ${err || '无'}  token 输入 ${sumUsage().prompt_tokens} / 输出 ${sumUsage().completion_tokens} / 合计 ${sumUsage().total_tokens}`,
      `工具调用: ${ev.filter(e => e.type === 'tool_call').map(e => (e as any).name).join(' → ') || '（无）'}`,
      `计划: ${ev.filter(e => e.type === 'plan').map(e => (e as any).plan.steps.map((s: any) => s.title).join(' | ')).join('') || '（空计划/边界引导）'}`,
      `引用核对: 共 ${refs.length} 条，核不上 ${bad.length} 条 ${bad.length ? '❌ ' + bad.join(',') : '✅'}`,
      `--- 结论 ---\n${final || '（无 final）'}`,
      '',
    ].join('\n'))
    writeFileSync(OUT, lines.join('\n'))

    // 第二轮追问：带上第一轮的 history，验证指代（「刚才那两张订单」）真的能被还原成具体单号。
    // 这是剧本 D 的台词依据——demo 里敢说「我没重复任何单号，它能接住」，靠的就是这一段。
    if (sc.followup) {
      const ev2: AgentEvent[] = []
      resetUsage()
      const t1 = Date.now()
      let err2 = ''
      try {
        await runAgent({
          question: sc.followup, user, getDb: () => db,
          history: [{ q: sc.q, a: final }],
          mutate: (m: Mutation) => applyMutation(db, m, user), emit: e => ev2.push(e), pushAudit: () => {},
          requestConfirm: async () => true,
        })
      } catch (e) { err2 = String(e) }
      const f2 = ev2.filter(e => e.type === 'final').map(e => (e as any).text).join('\n')
      const r2 = [...f2.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1])
      const b2 = [...new Set(r2)].filter(r => resolveRef(db, user, r) === null)
      lines.push([
        `### ${sc.id}-追问 [${sc.role}] ${sc.followup}`,
        `耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s  事件 ${ev2.length}  错误 ${err2 || '无'}  token 输入 ${sumUsage().prompt_tokens} / 输出 ${sumUsage().completion_tokens}`,
        `工具调用: ${ev2.filter(e => e.type === 'tool_call').map(e => (e as any).name).join(' → ') || '（无）'}`,
        `计划: ${ev2.filter(e => e.type === 'plan').map(e => (e as any).plan.steps.map((s: any) => s.title).join(' | ')).join('') || '（空计划/边界引导）'}`,
        `引用核对: 共 ${r2.length} 条，核不上 ${b2.length} 条 ${b2.length ? '❌ ' + b2.join(',') : '✅'}`,
        `--- 结论 ---\n${f2 || '（无 final）'}`,
        '',
      ].join('\n'))
      writeFileSync(OUT, lines.join('\n'))
    }
  }
  expect(lines.length).toBeGreaterThan(0)
})
