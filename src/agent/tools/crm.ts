import type { ToolDef } from '../../lib/types'
import { scopeCustomers, scopeOpportunities } from '../../lib/rbac'

export const crmTools: ToolDef[] = [
  {
    name: 'query_customers',
    description: '查询客户列表。返回客户名、行业、区域、等级、年采购额、信用额度。只返回当前用户有权查看的客户。',
    allowedRoles: ['sales_rep', 'sales_director', 'ceo'],
    isWrite: false,
    parameters: {
      type: 'object',
      properties: {
        tier: { type: 'string', enum: ['A', 'B', 'C'], description: '按客户等级筛选' },
        sortByRevenue: { type: 'boolean', description: '是否按年采购额降序排列' },
        limit: { type: 'number', description: '返回条数上限，默认 20' },
      },
    },
    run: (a, ctx) => {
      let rows = scopeCustomers(ctx.db, ctx.user)
      if (a.tier) rows = rows.filter(c => c.tier === a.tier)
      if (a.sortByRevenue) rows = [...rows].sort((x, y) => y.annualRevenue - x.annualRevenue)
      if (!rows.length) return { found: false, reason: '当前角色权限范围内没有符合条件的客户' }
      return { count: rows.length, customers: rows.slice(0, a.limit ?? 20) }
    },
  },
  {
    name: 'get_customer_detail',
    description: '按客户名或客户ID查询单个客户详情，含信用额度、已用额度、历史订单数。',
    allowedRoles: ['sales_rep', 'sales_director', 'ceo'],
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
      return { ...c, orderCount: orders.length,
               creditAvailable: c.creditLimit - c.creditUsed }
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
    allowedRoles: ['sales_rep', 'sales_director'],
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
