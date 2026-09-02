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
/**
 * reply 只在 steps 为空时有值：规划器判定「做不了」时写给用户看的边界引导话术。
 * 与 goal 分开是因为二者受众不同——goal 是计划卡标题，reply 是对话正文。
 * 曾经共用 goal 一个字段，结果是「让它当标题」和「让它当引导语」两条指令互相打架，
 * 实测强化任一条都会压掉另一条。拆字段是唯一稳定的解法。
 */
export interface Plan {
  goal: string; steps: PlanStep[]; needsWrite: boolean; reply?: string
  /**
   * 规划器判定「这句话有歧义，不同理解会查到完全不同的数据」时填这里，steps 留空。
   * 与 reply（做不了）是两件事：reply 是能力/权限边界，clarify 是**能做，但不知道要哪个**。
   * 早期版本把两者塞进同一个 reply 字段，结果模型分不清该道歉还是该反问，两种话术互相污染。
   */
  clarify?: PlanClarify
}

/** 规划器给出的澄清请求。options 是给用户点的具体选项，assume 是用户不选时的兜底口径。 */
export interface PlanClarify { reason: string; ask: string; options: string[]; assume: string }

/** 澄清选项。label 是按钮上的字，refine 是选中后追加进问题的措辞（可以更啰嗦、更精确）。 */
export interface ClarifyOption { label: string; refine: string }

/**
 * 一次澄清请求。
 *
 * fallback 是这个设计的关键，不是可选的补充字段：它保证「用户不回答」永远有出路。
 * 没有它，澄清闸就退化成一个能把对话卡死的模态框——而一个能被卡死的 Agent，
 * 比一个偶尔猜错的 Agent 难用得多。所以规则也好、模型也好，提不出兜底口径就不许发起澄清。
 */
export interface ClarifyRequest {
  /** 为什么要问。展示给用户，让他知道这不是随口反问。 */
  reason: string
  /** 问用户的那一句。 */
  ask: string
  /** 可直接点击的选项，可能为空（例如悬空指代，系统枚举不出候选）。 */
  options: ClarifyOption[]
  /** 用户不选时采用的口径，会被明示在最终结论里。 */
  fallback: string
  /** rule = 确定性预检命中（零模型开销）；planner = 规划器的语义判定。 */
  source: 'rule' | 'planner'
}

export type AgentEvent =
  | { type: 'clarify_request'; id: string; req: ClarifyRequest }
  | { type: 'clarify_resolved'; id: string; choice: string | null }
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
