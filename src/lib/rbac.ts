import type { Role, User, Customer, SalesOrder, Opportunity, Receivable, DbSnapshot } from './types'

export interface RoleMeta { key: Role; label: string; demoUserId: string; description: string }

export const ROLE_META: Record<Role, RoleMeta> = {
  sales_rep:       { key: 'sales_rep',       label: '销售代表',   demoUserId: 'U-001',
                     description: '仅可见本人名下客户、商机与订单' },
  sales_director:  { key: 'sales_director',  label: '销售总监',   demoUserId: 'U-004',
                     description: '可见本团队全部数据与全公司汇总指标' },
  supply_chain:    { key: 'supply_chain',    label: '供应链主管', demoUserId: 'U-006',
                     description: '可见全部库存/采购/供应商与全部客户（不含客户财务字段）；订单金额脱敏；无商机权限' },
  ceo:             { key: 'ceo',             label: 'CEO',        demoUserId: 'U-008',
                     description: '全公司数据可见，可执行任何写操作，但越权代办会被显式提示并留痕' },
}

function teamMemberIds(db: DbSnapshot, user: User): string[] {
  return db.users.filter(u => u.teamId === user.teamId).map(u => u.id)
}

export function scopeCustomers(db: DbSnapshot, user: User): Customer[] {
  switch (user.role) {
    case 'sales_rep':      return db.customers.filter(c => c.ownerId === user.id)
    case 'sales_director': { const ids = teamMemberIds(db, user)
                             return db.customers.filter(c => ids.includes(c.ownerId)) }
    case 'ceo':            return db.customers
    case 'supply_chain':   return db.customers // 需要知道货发给谁，做分配优先级；财务字段另行裁剪
  }
}

/** 供应链需要知道货发给谁（做分配优先级），但不需要知道客户的钱。 */
export function canSeeCustomerFinancials(role: Role): boolean {
  return role !== 'supply_chain'
}

export function scopeOrders(db: DbSnapshot, user: User): SalesOrder[] {
  switch (user.role) {
    case 'sales_rep':      return db.orders.filter(o => o.ownerId === user.id)
    case 'sales_director': { const ids = teamMemberIds(db, user)
                             return db.orders.filter(o => ids.includes(o.ownerId)) }
    case 'ceo':
    case 'supply_chain':   return db.orders    // 供应链看全部订单，但金额脱敏
  }
}

export function scopeOpportunities(db: DbSnapshot, user: User): Opportunity[] {
  switch (user.role) {
    case 'sales_rep':      return db.opportunities.filter(o => o.ownerId === user.id)
    case 'sales_director': { const ids = teamMemberIds(db, user)
                             return db.opportunities.filter(o => ids.includes(o.ownerId)) }
    case 'ceo':            return db.opportunities
    case 'supply_chain':   return []
  }
}

// 应收没有 ownerId，按「所属客户归谁」过滤，口径与 scopeCustomers 一致。
export function scopeReceivables(db: DbSnapshot, user: User): Receivable[] {
  switch (user.role) {
    case 'ceo':            return db.receivables
    case 'sales_director': { const ids = new Set(scopeCustomers(db, user).map(c => c.id))
                             return db.receivables.filter(r => ids.has(r.customerId)) }
    case 'sales_rep':
    case 'supply_chain':   return []          // 无应收权限，见 PRD 权限矩阵
  }
}

const MASK = '***'

/** 供应链主管可见订单的 SKU 与交期，但看不到任何金额。 */
export function maskOrderForRole(o: SalesOrder, role: Role): Record<string, unknown> {
  if (role !== 'supply_chain') return { ...o }
  return {
    ...o,
    totalAmount: MASK,
    items: o.items.map(l => ({ skuId: l.skuId, qty: l.qty, unitPrice: MASK })),
  }
}

/** 写操作通常由谁执行。CEO 有权执行任何写操作，但那属于越权代办，必须显式提示并留痕。 */
const WRITE_TOOL_OWNER: Record<string, Role> = {
  create_purchase_order:     'supply_chain',
  reserve_inventory:         'supply_chain',
  create_followup_task:      'sales_rep',
  update_order_promise_date: 'sales_rep',
}

export function overrideNoticeFor(toolName: string, role: Role): string | null {
  const owner = WRITE_TOOL_OWNER[toolName]
  if (!owner || owner === role || role !== 'ceo') return null
  return `越权代办：该操作通常由「${ROLE_META[owner].label}」执行。你以 CEO 身份直接执行，操作会完整留痕。`
}

// ---- 决定 3：过滤必须自报边界 ----

export type ScopedEntity = 'customers' | 'opportunities' | 'orders' | 'receivables'

export interface ScopeSummary { visible: number; total: number; hidden: number; basis: string }

const ENTITY_LABEL: Record<ScopedEntity, string> = {
  customers: '客户', opportunities: '商机', orders: '订单', receivables: '应收',
}

function basisFor(role: Role, entity: ScopedEntity): string {
  if (role === 'supply_chain') {
    return entity === 'orders' || entity === 'customers' ? '全公司' : '无权查看'
  }
  const byRole: Record<'sales_rep' | 'sales_director' | 'ceo', string> = {
    sales_rep: '你本人名下', sales_director: '你所在团队', ceo: '全公司',
  }
  return byRole[role]
}

function scopedCount(db: DbSnapshot, user: User, entity: ScopedEntity): number {
  switch (entity) {
    case 'customers':     return scopeCustomers(db, user).length
    case 'orders':        return scopeOrders(db, user).length
    case 'opportunities': return scopeOpportunities(db, user).length
    case 'receivables':   return scopeReceivables(db, user).length
  }
}

function totalCount(db: DbSnapshot, entity: ScopedEntity): number {
  switch (entity) {
    case 'customers':     return db.customers.length
    case 'orders':        return db.orders.length
    case 'opportunities': return db.opportunities.length
    case 'receivables':   return db.receivables.length
  }
}

/** 每一处按角色过滤的数据都要能自报边界：看到多少、总共多少、按什么范围过滤的。 */
export function scopeSummary(db: DbSnapshot, user: User, entity: ScopedEntity): ScopeSummary {
  const visible = scopedCount(db, user, entity)
  const total = totalCount(db, entity)
  return { visible, total, hidden: total - visible, basis: basisFor(user.role, entity) }
}

/**
 * 受限读工具在按查询条件过滤后仍是空结果时用：把权限边界写进 reason，
 * 避免模型把「查询条件下没有」读成「全公司都没有」。
 */
export function boundaryReason(s: ScopeSummary, entity: ScopedEntity): string {
  const label = ENTITY_LABEL[entity]
  const base = `${s.basis}内没有符合条件的${label}`
  return s.hidden > 0 ? `${base}；全公司另有 ${s.hidden} 条，超出你的查看范围。` : `${base}。`
}
