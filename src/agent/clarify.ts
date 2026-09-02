import type { ClarifyRequest, ClarifyOption, DbSnapshot, PlanClarify, User } from '../lib/types'
import { scopeCustomers } from '../lib/rbac'
import type { Turn } from './prompts'

/**
 * 澄清闸：在规划之前判断「这句话是不是根本没法对齐」。
 *
 * 三条产品约束决定了这个模块长什么样，它们比实现重要得多：
 *
 * 1. 【只在会改变答案时才拦】判据不是「说得够不够精确」，而是
 *    「不同的理解会不会查到**完全不同的数据集合**」。「最大的客户」按成交额和按应收余额
 *    是两批人，必须问；「帮我看看订单情况」听着模糊，但查出来是同一批订单，不问。
 *    追问一个其实不影响结果的问题，比自己合理假设更烦人——那是把认知负担甩回用户。
 *
 * 2. 【最多一轮】第二轮无论如何往下走。永远在追问的 Agent 等于没有 Agent。
 *    这条由 loop.ts 的 askedClarify 兜住，本模块只负责「该不该问」。
 *
 * 3. 【必须给兜底口径】fallback 是必填字段，不是可选补充。用户不回答时按 fallback 执行，
 *    并把这个口径明示在结论里。没有它，澄清闸就是一个能把对话卡死的模态框。
 *
 * 结构上分两层，代价完全不同：
 *   - 本文件的 precheckAmbiguity：纯函数、零模型调用、零延迟。能用规则判死的就不要花模型。
 *   - 规划器返回的 clarify 字段：真正的语义判断，但它**搭规划那次调用的顺风车**，
 *     不额外增加一次往返。这是选择把它塞进 Plan 而不是单开一个「歧义分类器」的唯一理由——
 *     一个每次提问都多花 1~2 秒的功能，收益再好也会被用户关掉。
 */

/** 选中某个选项后，把它折进问题本身。让下游的规划器和执行器只面对一句话，不必再理解澄清协议。 */
export function refineQuestion(question: string, refine: string): string {
  return `${question}（口径已确认：${refine}）`
}

/** 把规划器返回的 clarify 字段规整成统一结构。options 为空或缺 assume 时返回 null——见约束 3。 */
export function fromPlanClarify(c: PlanClarify | undefined): ClarifyRequest | null {
  if (!c || typeof c.ask !== 'string' || !c.ask.trim()) return null
  const assume = typeof c.assume === 'string' ? c.assume.trim() : ''
  if (!assume) return null
  const options = (Array.isArray(c.options) ? c.options : [])
    .filter((s): s is string => typeof s === 'string' && !!s.trim())
    .slice(0, 4)
    .map(s => ({ label: s.trim(), refine: s.trim() }))
  return {
    reason: (c.reason ?? '').trim() || '这句话有多种理解，不同理解会查到不同的数据。',
    ask: c.ask.trim(),
    options,
    fallback: assume,
    source: 'planner',
  }
}

// ---------------------------------------------------------------------------
// 规则层
// ---------------------------------------------------------------------------

/**
 * 悬空指代。只在**本次对话没有任何上文**时才算歧义——有上文时指代是正常的追问，
 * prompts.ts 里专门叮嘱过模型「不要说问题模糊」，这里绝不能反过来把它拦掉。
 *
 * 指代词必须紧跟一个业务名词才算数。只匹配「这个」两个字会把
 * 「我这个月的商机漏斗」也拦下来——那句话没有任何歧义，是内置引导问题之一。
 * 规则层的假阳性比漏判贵得多：漏判只是少一次澄清，假阳性是在用户已经说清楚之后
 * 还要他再点一次。
 */
const DANGLING_RE = /(那个|这个|那家|这家|那笔|这笔|那批|这批|那单|这单|那条|这条|上一个)\s*(客户|订单|单子|商机|机会|供应商|产品|物料|SKU|项目|采购单|库存)/i

/**
 * 「缺口最大的那个 SKU」这类前面挂着「的」的，说明指代对象已经被前半句限定死了，
 * 不是悬空——它就是这句话自己定义出来的那一个。这一条也是内置引导问题之一。
 */
function danglingHit(q: string): string | null {
  const m = DANGLING_RE.exec(q)
  if (!m) return null
  if (m.index > 0 && q[m.index - 1] === '的') return null
  return m[0]
}

/** 模糊时间词。配上任何一个具体窗口（数字 + 单位，或本月/本周这类锚点）就不算模糊。 */
const VAGUE_TIME = ['最近', '近期', '这段时间', '这阵子', '前段时间', '近来', '这些天']
const CONCRETE_TIME = /(\d+\s*(天|日|周|个月|月|年|季度))|(本月|上月|本周|上周|今年|去年|本季度|上季度|今天|昨天|本年度)/

/** 口径不明的最高级词。只和「客户」搭配时才拦——「最大的订单」有唯一口径（金额），不歧义。 */
const SUPERLATIVE = /(最大|最重要|最好|最优质|最值得|最关键|排名前|top\s*\d)/i

/**
 * 停用词：这些 2 字词在实体名里高频出现，拿它们去做子串匹配必然命中一堆无关记录，
 * 会把「查一下订单」这种毫无歧义的问题拦下来。规则层的假阳性比漏判贵得多——
 * 漏判只是少一次澄清，假阳性是在用户明确表达之后还要他再点一次。
 */
const STOP = new Set([
  '订单', '库存', '采购', '商机', '应收', '客户', '风险', '交付', '发货', '产品', '设备',
  '数量', '金额', '时间', '情况', '问题', '帮我', '查询', '分析', '现在', '未来', '最近',
  '团队', '公司', '本月', '这个', '那个', '我们', '你们', '多少', '哪些', '什么', '怎么',
  '需要', '可以', '没有', '还有', '一下', '看看', '目前', '所有', '全部', '有限', '科技',
  '工业', '集团', '股份', '实业', '智能', '系统', '技术', '机械', '电子', '自动',
])

export interface PrecheckContext {
  db: DbSnapshot
  user: User
  history?: Turn[]
}

/** 问题里所有 2~8 字的连续中文片段。中文没有词边界，只能穷举子串去撞实体名。 */
function cjkFragments(q: string): string[] {
  const out = new Set<string>()
  for (const run of q.match(/[一-龥]{2,}/g) ?? []) {
    for (let i = 0; i < run.length; i++) {
      for (let len = 2; len <= 8 && i + len <= run.length; len++) out.add(run.slice(i, i + len))
    }
  }
  return [...out]
}

/**
 * 找出「一个词同时像好几条记录」的情况。典型是「传感器库存够不够」——
 * 系统里有十几种传感器，不问就得替他挑一个，挑错了整段结论都是错的。
 *
 * 两个必须有的排除条件，都是实测踩出来的：
 *
 * 1) 问题里已经出现了某条记录的**完整名字**时，这个名字内部的所有片段一律不算歧义。
 *    没有这一条，「帮我给华宁自动化建一个回访任务」会因为「自动化」同时命中
 *    华宁自动化 / 和信自动化 / 中辰自动化 而被拦下——用户明明已经说全了。
 *
 * 2) 只在**恰好一个**片段产生多候选时才报。两个以上说明这是宽泛提问
 *    （「传感器和伺服电机的库存」），用户是有意要一批，不是指代不清。
 *
 * 命中的片段取最长的那个：「传感」「感器」「传感器」命中的是同一批产品，
 * 报给用户看的理由当然要用「传感器」。
 */
function multiEntityMatch(q: string, ctx: PrecheckContext): { options: ClarifyOption[]; total: number } | null {
  const names = [
    ...scopeCustomers(ctx.db, ctx.user).map(c => c.name),
    ...ctx.db.products.map(p => p.name),
  ]
  const spelledOut = names.filter(n => q.includes(n))

  const hits = new Map<string, string[]>()
  for (const frag of cjkFragments(q)) {
    if (STOP.has(frag)) continue
    if (spelledOut.some(n => n.includes(frag))) continue   // 排除条件 1
    const matched = names.filter(n => n.includes(frag))
    if (matched.length < 2) continue
    hits.set(frag, matched)
  }
  if (!hits.size) return null

  // 收敛到极大片段：丢掉那些「被更长片段包含、且命中同一批记录」的短片段。
  const frags = [...hits.keys()]
  const maximal = frags.filter(a => !frags.some(
    b => b !== a && b.includes(a) && hits.get(b)!.length === hits.get(a)!.length))
  if (maximal.length !== 1) return null                    // 排除条件 2

  const matched = [...new Set(hits.get(maximal[0])!)]
  // 选项最多列 4 个（再多用户就不看了），但 total 报真实条数——
  // 卡片上写「匹配到 4 条」而实际有 11 条，是在自己给自己制造一个假事实。
  return {
    total: matched.length,
    options: matched.slice(0, 4).map(n => ({ label: n, refine: `指的是「${n}」` })),
  }
}

/**
 * 确定性预检。命中就返回一个澄清请求，且**完全不花模型**。
 *
 * 顺序即优先级，第一条命中就返回：一次只问一个问题。同时抛三个问题的澄清卡，
 * 用户的第一反应是关掉它——那比不问还糟。
 */
export function precheckAmbiguity(question: string, ctx: PrecheckContext): ClarifyRequest | null {
  const q = question.trim()
  if (!q) return null

  // R1 悬空指代：有上文时这是正常追问，不拦。
  if (!ctx.history?.length) {
    const word = danglingHit(q)
    if (word) {
      return {
        reason: `这是本次对话的第一句，「${word}」没有上文可以对齐。`,
        ask: '请直接说出客户名、单号或 SKU，我好确定查哪一条。',
        // 系统枚举不出候选，所以这里没有选项。给不出选项时就老实说「请直接讲」，
        // 不要拿「能详细说说吗」这种空反问占位——那是把问题原样退回给用户。
        options: [],
        fallback: '在你权限范围内的全部数据里查',
        source: 'rule',
      }
    }
  }

  // R2 一个词同时像好几条记录。
  const multi = multiEntityMatch(q, ctx)
  if (multi) {
    return {
      reason: `这个说法在你可见的数据里匹配到 ${multi.total} 条记录`
        + (multi.total > multi.options.length ? `，下面列出前 ${multi.options.length} 条。` : '。'),
      ask: '你指的是哪一个？',
      options: multi.options,
      fallback: `把匹配到的 ${multi.total} 条一起查出来对比`,
      source: 'rule',
    }
  }

  // R3 模糊时间窗。窗口直接决定被统计进来的是哪几条订单，是典型的「换个理解换一批数据」。
  if (VAGUE_TIME.some(w => q.includes(w)) && !CONCRETE_TIME.test(q)) {
    return {
      reason: '「最近」在不同口径下会圈进完全不同的一批单据。',
      ask: '你说的时间范围是多长？',
      options: [
        { label: '最近 7 天', refine: '时间范围取最近 7 天' },
        { label: '最近 14 天', refine: '时间范围取最近 14 天' },
        { label: '最近 30 天', refine: '时间范围取最近 30 天' },
      ],
      fallback: '时间范围取最近 14 天',
      source: 'rule',
    }
  }

  // R4 「最大的客户」这类最高级。这不是措辞不严谨，是三个不同的问题：
  // 成交额最高的客户、欠钱最多的客户、体量最大的客户，答案通常不是同一家。
  if (SUPERLATIVE.test(q) && q.includes('客户')) {
    return {
      reason: '「最大」在客户上有三种常用口径，排出来的名单不一样。',
      ask: '按哪个口径排？',
      options: [
        { label: '累计成交金额', refine: '按该客户名下所有销售订单的累计成交金额排序' },
        { label: '未结应收余额', refine: '按该客户当前未收回的应收账款余额排序' },
        { label: '客户年营收规模', refine: '按客户档案里的年营收规模字段排序' },
      ],
      fallback: '按该客户名下所有销售订单的累计成交金额排序',
      source: 'rule',
    }
  }

  return null
}
