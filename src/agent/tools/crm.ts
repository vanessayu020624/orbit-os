import type { Role, ToolDef } from '../../lib/types'
import { canSeeCustomerFinancials, scopeCustomers, scopeOpportunities } from '../../lib/rbac'

/** 供应链主管不需要知道客户的钱：从返回对象里删掉这三个 key（不置 0，置 0 会被模型当成真实数值）。 */
function stripFinancials<T extends object>(c: T, role: Role): T {
  if (canSeeCustomerFinancials(role)) return c
  const rest: any = { ...c }
  delete rest.annualRevenue
  delete rest.creditLimit
  delete rest.creditUsed
  return rest as T
}

export const crmTools: ToolDef[] = [
  {
    name: 'query_customers',
    description: '查询客户列表。返回客户名、行业、区域、等级；销售角色与 CEO 另可见年采购额、信用额度，' +
      '供应链主管按角色裁剪，不返回这些财务字段。sortByRevenue 对供应链主管无意义会被静默忽略。',
    allowedRoles: ['sales_rep', 'sales_director', 'supply_chain', 'ceo'],
    isWrite: false,
    parameters: {
      type: 'object',
      properties: {
        tier: { type: 'string', enum: ['A', 'B', 'C'], description: '按客户等级筛选' },
        sortByRevenue: { type: 'boolean', description: '是否按年采购额降序排列（供应链主管看不到该字段，此参数对其无效）' },
        limit: { type: 'number', description: '返回条数上限，默认 20' },
      },
    },
    run: (a, ctx) => {
      let rows = scopeCustomers(ctx.db, ctx.user)
      if (a.tier) rows = rows.filter(c => c.tier === a.tier)
      if (a.sortByRevenue && canSeeCustomerFinancials(ctx.role)) {
        rows = [...rows].sort((x, y) => y.annualRevenue - x.annualRevenue)
      }
      if (!rows.length) return { found: false, reason: '当前角色权限范围内没有符合条件的客户' }
      const customers = rows.slice(0, a.limit ?? 20).map(c => stripFinancials(c, ctx.role))
      return { count: rows.length, customers }
    },
  },
  {
    name: 'get_customer_detail',
    description: '按客户名或客户ID查询单个客户详情，含历史订单数；销售角色与 CEO 另可见信用额度、已用额度，' +
      '供应链主管按角色裁剪，不返回这些财务字段。',
    allowedRoles: ['sales_rep', 'sales_director', 'supply_chain', 'ceo'],
    isWrite: false,
    parameters: {
      type: 'object',
      properties: { nameOrId: { type: 'string', description: '客户名称或客户ID' } },
      required: ['nameOrId'],
    },
    run: (a, ctx) => {
      const c = scopeCustomers(ctx.db, ctx.user)
        .find(x => x.id === a.nameOrId || x.name === a.nameOrId)
      if (!c) return { found: false, reason: `未找到客户「${a.nameOrId}」，或当前角色无权查看` }
      const orders = ctx.db.orders.filter(o => o.customerId === c.id)
      const detail: Record<string, unknown> = { ...c, orderCount: orders.length }
      if (canSeeCustomerFinancials(ctx.role)) {
        detail.creditAvailable = c.creditLimit - c.creditUsed
      }
      return stripFinancials(detail, ctx.role)
    },
  },
  {
    name: 'query_opportunities',
    description: '查询销售商机。可按阶段筛选，返回商机名、客户、阶段、金额、赢率、预计成交日。',
    allowedRoles: ['sales_rep', 'sales_director', 'ceo'],
    isWrite: false,
    parameters: {
      type: 'object',
      properties: {
        stage: { type: 'string', enum: ['线索确认','需求分析','方案报价','商务谈判','赢单','输单'] },
        closeBefore: { type: 'string', description: '预计成交日早于该日期，格式 YYYY-MM-DD' },
        limit: { type: 'number' },
      },
    },
    run: (a, ctx) => {
      let rows = scopeOpportunities(ctx.db, ctx.user)
      if (a.stage) rows = rows.filter(o => o.stage === a.stage)
      if (a.closeBefore) rows = rows.filter(o => o.expectedCloseDate <= a.closeBefore)
      if (!rows.length) return { found: false, reason: '当前角色权限范围内没有符合条件的商机' }
      const weighted = rows.reduce((s, o) => s + o.amount * o.probability, 0)
      return { count: rows.length, weightedForecast: Math.round(weighted),
               opportunities: rows.slice(0, a.limit ?? 20) }
    },
  },
  {
    name: 'create_followup_task',
    description: '为指定负责人创建一条跟进任务。这是写操作，会先请用户确认。',
    allowedRoles: ['sales_rep', 'sales_director', 'ceo'],
    isWrite: true,
    parameters: {
      type: 'object',
      properties: {
        assigneeName: { type: 'string', description: '负责人姓名' },
        title: { type: 'string', description: '任务标题' },
        dueDate: { type: 'string', description: '截止日期 YYYY-MM-DD' },
      },
      required: ['assigneeName', 'title', 'dueDate'],
    },
    confirmSummary: (a) => `将为 ${a.assigneeName} 创建跟进任务「${a.title}」，截止 ${a.dueDate}`,
    run: (a, ctx) => {
      const u = ctx.db.users.find(x => x.name === a.assigneeName)
      if (!u) return { found: false, reason: `未找到用户「${a.assigneeName}」` }
      ctx.mutate({ kind: 'createTask', assigneeId: u.id, title: a.title, dueDate: a.dueDate })
      return { ok: true, message: `已为 ${u.name} 创建任务「${a.title}」` }
    },
  },
]
