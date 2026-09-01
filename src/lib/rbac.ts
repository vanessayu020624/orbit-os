import type { Role, User, Customer, SalesOrder, Opportunity, DbSnapshot } from './types'

export interface RoleMeta { key: Role; label: string; demoUserId: string; description: string }

export const ROLE_META: Record<Role, RoleMeta> = {
  sales_rep:       { key: 'sales_rep',       label: '销售代表',   demoUserId: 'U-001',
                     description: '仅可见本人名下客户、商机与订单' },
  sales_director:  { key: 'sales_director',  label: '销售总监',   demoUserId: 'U-004',
                     description: '可见本团队全部数据与全公司汇总指标' },
  supply_chain:    { key: 'supply_chain',    label: '供应链主管', demoUserId: 'U-006',
                     description: '可见全部库存/采购/供应商；订单金额脱敏；无客户与商机权限' },
  ceo:             { key: 'ceo',             label: 'CEO',        demoUserId: 'U-008',
                     description: '全公司数据只读，无任何写权限' },
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
    case 'supply_chain':   return []          // 无客户权限
  }
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
