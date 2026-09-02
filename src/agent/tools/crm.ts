import type { ToolDef } from '../../lib/types'
import { canSeeCustomerFinancials, scopeCustomers, scopeOpportunities, scopeSummary, boundaryReason } from '../../lib/rbac'
import { presentCustomer, presentOpportunity } from '../present'

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
      const scope = scopeSummary(ctx.db, ctx.user, 'customers')
      let rows = scopeCustomers(ctx.db, ctx.user)
      if (a.tier) rows = rows.filter(c => c.tier === a.tier)
      if (a.sortByRevenue && canSeeCustomerFinancials(ctx.role)) {
        rows = [...rows].sort((x, y) => y.annualRevenue - x.annualRevenue)
      }
      if (!rows.length) return { found: false, reason: boundaryReason(scope, 'customers') }
      const customers = rows.slice(0, a.limit ?? 20).map(c => presentCustomer(c, ctx.db, ctx.role))
      return { scope, count: rows.length, customers }
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
      const scope = scopeSummary(ctx.db, ctx.user, 'customers')
      const c = scopeCustomers(ctx.db, ctx.user)
        .find(x => x.id === a.nameOrId || x.name === a.nameOrId)
      if (!c) {
        const extra = scope.hidden > 0
          ? `（${scope.basis}内共 ${scope.visible} 条，另有 ${scope.hidden} 条超出你的查看范围）` : ''
        return { found: false, reason: `未找到客户「${a.nameOrId}」，或当前角色无权查看${extra}` }
      }
      const orders = ctx.db.orders.filter(o => o.customerId === c.id)
      return { scope, ...presentCustomer(c, ctx.db, ctx.role), orderCount: orders.length }
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
      const scope = scopeSummary(ctx.db, ctx.user, 'opportunities')
      let rows = scopeOpportunities(ctx.db, ctx.user)
      if (a.stage) rows = rows.filter(o => o.stage === a.stage)
      if (a.closeBefore) rows = rows.filter(o => o.expectedCloseDate <= a.closeBefore)
      if (!rows.length) return { found: false, reason: boundaryReason(scope, 'opportunities') }
      const weighted = rows.reduce((s, o) => s + o.amount * o.probability, 0)
      return { scope, count: rows.length, weightedForecast: Math.round(weighted),
               opportunities: rows.slice(0, a.limit ?? 20).map(o => presentOpportunity(o, ctx.db)) }
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
      return { ok: true, assigneeName: u.name, title: a.title, dueDate: a.dueDate,
               message: `已为 ${u.name} 创建任务「${a.title}」，截止 ${a.dueDate}` }
    },
  },
]
