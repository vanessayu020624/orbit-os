export type Role = 'sales_rep' | 'sales_director' | 'supply_chain' | 'ceo'

export type OppStage = '线索确认' | '需求分析' | '方案报价' | '商务谈判' | '赢单' | '输单'
export type OrderStatus = '待审核' | '待发货' | '部分发货' | '已发货' | '已完成' | '已取消'
export type PoStatus = '草稿' | '待审批' | '已下单' | '在途' | '已入库'
export type ReceivableStatus = '未到期' | '已逾期' | '已回款'

export interface User { id: string; name: string; role: Role; teamId: string; managerId?: string }
export interface Customer {
  id: string; name: string; industry: string; region: string
  ownerId: string; tier: 'A' | 'B' | 'C'
  creditLimit: number; creditUsed: number; annualRevenue: number
}
export interface Product {
  id: string; sku: string; name: string; category: string
  unitPrice: number; cost: number; unit: string
}
export interface Inventory {
  skuId: string; onHand: number; reserved: number
  available: number          // 计算字段 = onHand - reserved，勿直接改
  safetyStock: number
}
export interface Supplier {
  id: string; name: string; leadTimeDays: number
  onTimeRate: number; skuIds: string[]; priceFactor: number
}
export interface OrderLine { skuId: string; qty: number; unitPrice: number }
export interface SalesOrder {
  id: string; orderNo: string; customerId: string; ownerId: string; oppId?: string
  status: OrderStatus; promisedDeliveryDate: string
  totalAmount: number; items: OrderLine[]; createdAt: string
}
export interface PoLine { skuId: string; qty: number; unitCost: number }
export interface PurchaseOrder {
  id: string; poNo: string; supplierId: string; status: PoStatus
  eta: string; items: PoLine[]; totalCost: number
  expedited: boolean; createdBy: string
}
export interface Opportunity {
  id: string; name: string; customerId: string; ownerId: string
  stage: OppStage; amount: number; probability: number
  expectedCloseDate: string; lastActivityAt: string
}
export interface Receivable {
  id: string; orderId: string; customerId: string
  amount: number; paidAmount: number; dueDate: string; status: ReceivableStatus
}
export interface Task {
  id: string; assigneeId: string; title: string; dueDate: string; createdBy: string
}
export interface AuditEntry {
  id: string; at: string; role: Role; userId: string
  tool: string; args: unknown; ok: boolean; ms: number; summary: string
  /** 越权代办标记：例如 CEO 执行了通常由其他角色负责的写操作。 */
  override?: boolean
}

export interface DbSnapshot {
  users: User[]; customers: Customer[]; products: Product[]
  inventory: Inventory[]; suppliers: Supplier[]
  orders: SalesOrder[]; purchaseOrders: PurchaseOrder[]
  opportunities: Opportunity[]; receivables: Receivable[]; tasks: Task[]
}

export type Mutation =
  | { kind: 'createPurchaseOrder'; po: PurchaseOrder }
  | { kind: 'updateOrderPromiseDate'; orderId: string; newDate: string; reason: string }
  | { kind: 'reserveInventory'; skuId: string; qty: number; orderId: string }
  | { kind: 'createTask'; assigneeId: string; title: string; dueDate: string }

// ---- Agent 契约 ----
export interface PlanStep { id: string; title: string; expectedTools: string[] }
export interface Plan { goal: string; steps: PlanStep[]; needsWrite: boolean }

export type AgentEvent =
  | { type: 'plan'; plan: Plan }
  | { type: 'plan_amended'; addedSteps: PlanStep[]; reason: string }
  | { type: 'step_start'; stepId: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; result: unknown; ms: number }
  | { type: 'confirm_request'; id: string; toolName: string; args: unknown; summary: string }
  | { type: 'confirm_resolved'; id: string; approved: boolean }
  | { type: 'step_done'; stepId: string }
  | { type: 'final'; text: string; refs: string[] }
  | { type: 'error'; message: string }

export interface ToolContext {
  user: User
  role: Role
  db: DbSnapshot
  mutate: (m: Mutation) => void
}

export interface NotFound { found: false; reason: string }

export interface ToolDef<A = any, R = any> {
  name: string
  description: string
  parameters: Record<string, unknown>   // JSON Schema，直接发给 LLM
  allowedRoles: Role[]
  isWrite: boolean
  confirmSummary?: (args: A, ctx: ToolContext) => string
  run: (args: A, ctx: ToolContext) => R | NotFound
}

export const TODAY = '2026-09-02'
