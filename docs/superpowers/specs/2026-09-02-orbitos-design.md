# OrbitOS 设计文档

> CRM/ERP 智能体系统演示项目 · 2026-09-02
> 用途：AI 产品经理面试现场演示（目标公司：大厂 AI 产品线）

---

## 1. 目标

一天内交付一个可公网访问的演示系统，让面试官在 8 分钟内看到三件事：

1. **Agent 自主规划**——一句话提问，Agent 自己拆解任务、跨 CRM/ERP 五个模块串联查询、动态追加步骤。
2. **权限是真实约束**——同一个问题，销售代表和 CEO 得到不同答案，因为低权限角色根本拿不到那个工具。
3. **人机协同闭环**——Agent 提出写操作，人工确认后落库，BI 看板当场变化，风险告警消失。

叙事重心按目标公司调整为：Agent 架构设计、工具编排、幻觉防护、成本与延迟权衡。

## 2. 非目标

明确不做，避免范围蔓延：

- 真实数据库、用户注册、JWT 鉴权（用一键角色切换替代）
- 多租户、审批工作流引擎、财务/HR/生产模块
- Agent 长期记忆、多 Agent 协同、RAG 知识库
- 移动端适配（现场投屏，桌面宽屏优先）
- 字段级动态脱敏配置（供应链角色的金额脱敏写死即可）

## 3. 业务场景

虚拟公司「**擎源工业设备**」：工业传感器、伺服电机、控制器的 B2B 分销商。客单价 5 万–200 万，销售周期 1–3 个月，有实物库存和交期压力——CRM 与 ERP 天然耦合。

主线九环节：线索 → 客户 → 商机 → 报价 → 订单 → 库存 → 采购 → 发货 → 回款。

## 4. 角色与权限

### 4.1 角色定义

| 角色 key | 演示人物 | 数据范围 | 特有能力 | 明确禁止 |
|---|---|---|---|---|
| `sales_rep` | 张伟 | 仅 `ownerId === self` 的客户/商机/订单 | 创建跟进任务 | 全公司统计、采购、成本、审批 |
| `sales_director` | 李娜 | 本团队全部 + 全公司汇总指标 | 团队漏斗分析、订单折扣审批 | 采购写入 |
| `supply_chain` | 王强 | 全部库存/采购/供应商；订单可见 SKU 与交期，**金额脱敏为 `***`** | 采购单创建、库存调拨、供应商比选 | 客户联系人、商机 |
| `ceo` | 陈立 | 全公司全部数据，**只读** | 全局聚合分析 | 一切写操作 |

CEO 无写权限是刻意设计：权限映射的是职责边界，不是行政层级。这一点在面试中可主动讲。

### 4.2 权限的两层实现

**第一层 · 工具级**：`toolsFor(role)` 过滤工具注册表，未授权工具**不会出现在发给 LLM 的 `tools` 数组里**。Agent 不是"装作看不见"，是根本没有这个能力。

**第二层 · 数据级**：每个工具执行前经过 `scopeFilter(role, user)`，返回记录集已按 `ownerId` / `teamId` 裁剪，敏感字段已替换。

两层都在客户端 `executeTool` 内实现，不依赖 UI 隐藏。

## 5. 数据模型

### 5.1 实体清单

| 实体 | 数量 | 说明 |
|---|---|---|
| `User` | 12 | 4 种角色，2 个销售团队 |
| `Customer` | 48 | 含信用额度、已用额度、等级 |
| `Opportunity` | 90 | 6 个阶段，含预计成交日与赢率 |
| `Product` | 60 | 含 `cost` 敏感字段 |
| `Inventory` | 60 | 与 Product 一一对应 |
| `Supplier` | 8 | 含交期与准时率 |
| `SalesOrder` | 160 | 6 种状态，含承诺交期与行项目 |
| `PurchaseOrder` | 55 | 5 种状态，含 ETA |
| `Receivable` | 120 | 关联订单，含到期日 |
| `AuditLog` | 动态 | Agent 每次工具调用与写入的审计 |

「线索」不单独建表，作为 `Opportunity.stage` 的第一个取值，省一张表且不断主线。

### 5.2 类型契约

下游施工单直接引用，无需回读实现：

```ts
type Role = 'sales_rep' | 'sales_director' | 'supply_chain' | 'ceo'

type OppStage = '线索确认' | '需求分析' | '方案报价' | '商务谈判' | '赢单' | '输单'
type OrderStatus = '待审核' | '待发货' | '部分发货' | '已发货' | '已完成' | '已取消'
type PoStatus = '草稿' | '待审批' | '已下单' | '在途' | '已入库'
type ReceivableStatus = '未到期' | '已逾期' | '已回款'

interface User      { id: string; name: string; role: Role; teamId: string; managerId?: string }
interface Customer  { id: string; name: string; industry: string; region: string;
                      ownerId: string; tier: 'A'|'B'|'C';
                      creditLimit: number; creditUsed: number; annualRevenue: number }
interface Product   { id: string; sku: string; name: string; category: string;
                      unitPrice: number; cost: number; unit: string }
interface Inventory { skuId: string; onHand: number; reserved: number;
                      available: number;      // 计算字段 = onHand - reserved，勿直接改
                      safetyStock: number }
interface Supplier  { id: string; name: string; leadTimeDays: number;
                      onTimeRate: number; skuIds: string[]; priceFactor: number }
interface OrderLine { skuId: string; qty: number; unitPrice: number }
interface SalesOrder{ id: string; orderNo: string; customerId: string; ownerId: string;
                      oppId?: string; status: OrderStatus;
                      promisedDeliveryDate: string;   // ISO date
                      totalAmount: number; items: OrderLine[]; createdAt: string }
interface PoLine    { skuId: string; qty: number; unitCost: number }
interface PurchaseOrder { id: string; poNo: string; supplierId: string; status: PoStatus;
                      eta: string; items: PoLine[]; totalCost: number;
                      expedited: boolean; createdBy: string }
interface Opportunity { id: string; name: string; customerId: string; ownerId: string;
                      stage: OppStage; amount: number; probability: number;
                      expectedCloseDate: string; lastActivityAt: string }
interface Receivable{ id: string; orderId: string; customerId: string; amount: number;
                      paidAmount: number; dueDate: string; status: ReceivableStatus }
```

### 5.3 种子数据必须"埋雷"

**这是演示成败的关键，不能靠随机数碰运气。** 生成器 `generateSeed(42)` 在随机生成之后，必须硬编码覆盖出下面这条冲突链：

```
SKU-203「高精度伺服电机 SV-800」
  ├── 3 张销售订单承诺 2026-09-08 ~ 09-11 交付，合计需 90 台
  │     SO-2026-0412 (客户: 华宁自动化, tier A, 40台, 交期 09-08)
  │     SO-2026-0428 (客户: 中科机电,   tier B, 30台, 交期 09-10)
  │     SO-2026-0435 (客户: 长风精工,   tier B, 20台, 交期 09-11)
  ├── 当前 available = 42 台                 → 缺口 48 台
  ├── 唯一在途采购单 PO-2026-0117，ETA 2026-09-16  → 比最早交期晚 5 天
  └── 供应商比选：
        东瑞传动（现供应商）leadTime 14 天 / 准时率 78% / priceFactor 1.00
        锐驰机电（备选）    leadTime  7 天 / 准时率 94% / priceFactor 1.12
```

场景 A 的期望产出：

> 建议向锐驰机电加急采购 48 台（增加成本约 ¥52,800，7 天到货可保 09-08 交付）；
> 或与 SO-2026-0412 协商延期 5 天。推荐前者——该客户信用等级 A，年采购额 ¥380 万。

场景 C 的埋雷：销售代表**张伟**名下 9 个客户，最大年额 ¥86 万；全公司最大客户属于**李娜团队**，年额 ¥520 万。张伟问"公司最大客户是谁"必须被工具层挡住。

另需埋：2 笔逾期超 60 天的应收，供风险卡片使用。

## 6. Agent 架构

### 6.1 Planner–Executor 双层

```
用户提问
 │
 ├─ ① Planner        LLM 输出结构化 JSON 计划 { goal, steps[] }
 │                    UI 立刻渲染成带勾选框的清单 —— "自主规划"变成可见界面元素
 │
 ├─ ② Executor       function calling 循环，上限 12 轮
 │                    每步：勾选 ✓ + 可展开的工具入参 / 出参 / 耗时
 │                    可动态 append 新步骤 → 清单高亮闪烁（动态重规划）
 │
 ├─ ③ HITL           命中写工具则暂停，弹确认卡说明"将要变更什么"
 │                    人工批准 → 落库 → 看板当场变化 + 风险卡消失
 │
 └─ ④ Reflect        结论文本，数字带 [[SO-2026-0412]] 标记
                      前端正则渲染成可点击来源 chip，点击跳转原始记录
```

选择理由：纯 ReAct 循环的规划过程是隐式的，面试官只看到工具逐个蹦出来。显式规划层多花约 1.5 小时和一轮 LLM 调用（GLM-4.5-Flash 延迟可接受），换来第一叙事直接可见。

### 6.2 事件契约

Agent 循环对 UI 只暴露事件流，UI 不感知 LLM 细节：

```ts
type AgentEvent =
  | { type: 'plan';             plan: Plan }
  | { type: 'plan_amended';     addedSteps: PlanStep[]; reason: string }
  | { type: 'step_start';       stepId: string }
  | { type: 'tool_call';        id: string; name: string; args: unknown }
  | { type: 'tool_result';      id: string; result: unknown; ms: number }
  | { type: 'confirm_request';  id: string; toolName: string; args: unknown; summary: string }
  | { type: 'confirm_resolved'; id: string; approved: boolean }
  | { type: 'step_done';        stepId: string }
  | { type: 'final';            text: string; refs: string[] }
  | { type: 'error';            message: string }

interface PlanStep { id: string; title: string; expectedTools: string[] }
interface Plan     { goal: string; steps: PlanStep[]; needsWrite: boolean }
```

### 6.3 工具契约

```ts
interface DbSnapshot {                  // P1 由 store 导出的只读快照
  users: User[]; customers: Customer[]; products: Product[]
  inventory: Inventory[]; suppliers: Supplier[]
  orders: SalesOrder[]; purchaseOrders: PurchaseOrder[]
  opportunities: Opportunity[]; receivables: Receivable[]
}

type Mutation =
  | { kind: 'createPurchaseOrder'; po: PurchaseOrder }
  | { kind: 'updateOrderPromiseDate'; orderId: string; newDate: string; reason: string }
  | { kind: 'reserveInventory'; skuId: string; qty: number; orderId: string }
  | { kind: 'createTask'; assigneeId: string; title: string; dueDate: string }

interface ToolContext {
  user: User
  role: Role
  db: DbSnapshot                        // 只读快照
  mutate: (m: Mutation) => void         // 唯一写入通道，自动写 AuditLog
}

interface ToolDef<A = any, R = any> {
  name: string
  description: string                   // 直接发给 LLM，措辞影响调用准确率
  parameters: JSONSchema
  allowedRoles: Role[]
  isWrite: boolean
  confirmSummary?: (args: A, ctx: ToolContext) => string   // HITL 卡片文案
  run: (args: A, ctx: ToolContext) => R | { found: false; reason: string }
}
```

### 6.4 工具注册表（15 个）

按域拆四个文件，每个文件控制在 200 行内。

**只读 11 个**

| 工具 | 角色 | 说明 |
|---|---|---|
| `query_customers` | rep/director/ceo | 受 scope 过滤的客户列表（supply_chain 无权，与 §4.1 一致） |
| `get_customer_detail` | rep/director/ceo | 含信用额度、历史成交 |
| `query_opportunities` | rep/director/ceo | 商机，支持阶段与日期筛选 |
| `query_sales_orders` | 全部 | 支持 `deliveryDateBefore` / `status` |
| `get_order_detail` | 全部 | 含行项目；supply_chain 金额脱敏 |
| `check_inventory` | 全部 | 可用量、安全库存 |
| `query_purchase_orders` | supply_chain/ceo | 含 ETA |
| `get_supplier_options` | supply_chain/ceo | 按 SKU 返回可选供应商与交期对比 |
| `query_receivables` | director/ceo | 逾期筛选 |
| `aggregate_metrics` | director/ceo | 通用聚合：营收、漏斗、TOP 客户 |
| `simulate_delivery_risk` | 全部 | 纯本地计算，返回每个订单的缺口与风险等级 |

**写入 4 个（强制 HITL）**

| 工具 | 角色 | 确认卡文案 |
|---|---|---|
| `create_purchase_order` | supply_chain | 将向 {供应商} 采购 {SKU} × {数量}，预计成本 ¥{金额}，ETA {日期} |
| `update_order_promise_date` | rep/director | 将把 {订单号} 承诺交期从 {旧} 改为 {新}，原因：{reason} |
| `reserve_inventory` | supply_chain | 将为 {订单号} 锁定 {SKU} × {数量} |
| `create_followup_task` | rep/director | 将为 {负责人} 创建跟进任务「{标题}」，截止 {日期} |

`simulate_delivery_risk` 刻意做成本地纯计算工具——面试可讲"确定性计算不交给 LLM，LLM 只负责决定何时调用它"。

## 7. 幻觉防护

三道防线，实现成本低但都是面试考点：

1. **数字必须溯源**。所有工具返回结构化数据并携带记录 ID；System Prompt 强约束"禁止输出任何未从工具结果中获得的数字"；结论中的数字须以 `[[记录ID]]` 标注，前端渲染为可点击 chip，点击跳转原始记录。无法溯源的数字在 UI 上标黄警示。
2. **写操作强制人工确认**。Agent 无权直接落库，`mutate` 只能在 `confirm_resolved: approved` 之后被调用。确认卡明示变更内容。
3. **空结果不编造**。工具查无数据时返回 `{ found: false, reason }` 而非空数组，System Prompt 要求据此明确回复"未找到"。

补充：`AuditLog` 记录每次工具调用的入参、出参摘要、耗时、发起角色，可在设置页查看——支撑"可观测性"话题。

## 8. 界面

```
┌────────┬───────────────────────────────┬────────────────┐
│ 仪表盘 │  ⚠ Agent 主动风险卡 × 2-3      │  AI Sidekick   │
│ 客户   │  KPI 卡 × 4（实时跳动）         │  ├ 规划清单     │
│ 商机   │  图表 × 3（Recharts）          │  ├ 工具调用卡   │
│ 订单   │                               │  ├ HITL 确认卡  │
│ 库存   │  ……或列表页                    │  └ 结论 + 引用  │
│ 采购   │  （Monday 式彩色状态块）        │                │
│ 应收   │                               │  [输入框]       │
├────────┤                               │  [3 个预设问题] │
│ 角色切换│                               │                │
└────────┴───────────────────────────────┴────────────────┘
```

- 顶栏：**角色一键切换器**。切换后 Sidekick 自动提示"已切换为张伟（销售代表），可用工具 15 → 7"，并清空会话。
- 顶栏：**重置演示数据**按钮，恢复到 `generateSeed(42)` 初始态。
- Sidekick 底部三个**预设问题按钮**——现场演示不打字，节奏可控。
- 风险卡片点击直接开启对应 Agent 会话，开场即有钩子。

视觉：Monday 风格彩色状态块 + 右侧常驻 Sidekick 抽屉。shadcn/ui + Tailwind。

## 9. 实时性

两层都要：

1. **背景数据流**：`setInterval` 每 4 秒推进一个模拟事件（新订单、发货、回款），KPI 数字与图表平滑过渡，看板"活着"。
2. **因果联动**：Agent 写入落库后，store 变更驱动看板即时重算——风险卡消失、库存缺口归零。这才是演示高潮。

第 1 层在时间不足时可砍（见 §12）。

## 10. 技术栈与部署

**前端**：Vite + React 18 + TypeScript · Tailwind CSS + shadcn/ui · Zustand（状态）· Recharts（图表）· react-router · mulberry32 种子随机数

**LLM**：智谱 GLM-4.5-Flash。免费不限量、国内直连、OpenAI 兼容接口、原生支持 function calling。注册地址 `open.bigmodel.cn`。

**部署**：Cloudflare Pages + Pages Functions（不单独建 Worker）
- `functions/api/chat.ts` 自动映射为 `/api/chat`，读取环境变量 `ZHIPU_API_KEY`，转发至 `https://open.bigmodel.cn/api/paas/v4/chat/completions`
- GitHub 推送触发自动构建，构建命令 `npm run build`，输出目录 `dist`
- 域名 `orbit-os.pages.dev`

选择 Cloudflare 而非 Vercel 的原因：`vercel.app` 在国内 DNS 污染严重，现场演示打不开即翻车；`pages.dev` 国内可达性明显更好，且免费额度无限流量、零冷启动。

**API Key 不入前端**：Key 存在 Pages 环境变量中，前端只请求同源 `/api/chat`。

## 11. 降级兜底

`/api/chat` 失败、超时或未配置 Key 时，自动切换「**录播模式**」：预置场景 A 与场景 C 的完整 `AgentEvent` 事件流，按真实延迟逐条回放。现场断网也能完成演示。

UI 上以一个低调的角标标示当前处于录播模式——诚实，且面试官通常会认为这是加分的工程考量。

## 12. 演示剧本

### 剧本 A · 交期风险穿透排查（主场景，约 4 分钟）

以王强（供应链主管）身份，点击首页风险卡或提问「下周要交付的订单有风险吗？」

预期 Agent 行为：输出 5 步计划 → 查未来 7 天待发货订单 → 逐个查 SKU 库存 → 发现 SKU-203 缺口 48 台 → **动态追加步骤**"追查在途采购单" → 发现 ETA 晚 5 天 → 比选供应商 → 提议向锐驰机电加急采购 → 弹确认卡 → 批准 → 看板风险卡消失、库存缺口归零。

讲解要点：跨 5 个模块自主串联、动态重规划、HITL、数字全部可溯源。

### 剧本 C · 同一问题、不同角色不同答案（约 2 分钟）

以张伟（销售代表）身份问「公司最大的客户是谁？」→ Agent 回复无权访问全公司数据，并给出其名下最大客户（¥86 万）。

一键切换为陈立（CEO）→ 同一句话 → 直接返回全公司 TOP 5 客户排名（榜首 ¥520 万）。

讲解要点：权限在工具注册表层生效，不是 UI 隐藏；`toolsFor(role)` 的数量差异可现场展示。

## 13. 交付物

| 交付物 | 说明 |
|---|---|
| 可访问站点 | `orbit-os.pages.dev` |
| GitHub 仓库 | `orbit-os`，含完整源码 |
| `docs/PRD.md` | 用户角色与场景、功能范围、指标定义 |
| `docs/agent-design.md` | Agent 架构、工具设计原则、幻觉防护、成本与延迟权衡、评测思路 |
| `README.md` | 项目介绍、截图、本地运行与部署说明 |
| `docs/demo-script.md` | 现场演示逐句台词与操作步骤 |

`docs/agent-design.md` 是面向大厂 AI 产品线的核心加分项，需覆盖：为什么这样切工具边界、为什么要 HITL、幻觉如何防、Planner 多一轮调用的延迟与成本代价、上线后如何评测。

## 14. 分期与上下文策略

### 14.1 八期施工单

| 期 | 内容 | 时长 |
|---|---|---|
| P0 | **先打通部署**：脚手架 + 空壳上线 + `/api/chat` 连通 + 手机流量验证国内可访问 | 40 min |
| P1 | 数据层：类型、种子生成器（含埋雷）、Zustand store、RBAC 矩阵 | 90 min |
| P2 | 业务界面：布局、导航、角色切换器、6 个列表页 | 100 min |
| P3 | Agent 内核：15 个工具 + 权限中间件 + Planner/Executor 循环 | 120 min |
| P4 | Sidekick UI：规划清单、工具卡、确认卡、引用 chip、预设问题 | 90 min |
| P5 | BI 与风险卡：图表、实时 tick、Agent 主动风险卡 | 60 min |
| P6 | 文档与兜底：PRD、Agent 设计说明、README、录播降级 | 40 min |
| P7 | 演练：端到端跑通剧本 A 与 C，卡点修复 | 30 min |
| | | **≈ 9.3 h** |

P0 置顶是刻意的：部署问题晚发现会毁掉一整天。

**时间不足时的裁剪顺序**（先砍上面的）：
1. 实时 tick 背景数据流（保留因果联动）
2. 列表页详情抽屉与手工编辑（列表只读即可，主角是 Agent）
3. 仪表盘图表从 3 个减到 1 个

剧本 A 与 C 必须活到最后。

### 14.2 防上下文爆炸

全项目约 45 文件 / 6000 行，全量读入约 150k tokens。撑爆上下文的主因是反复重读、调试循环、大块工具输出。三层防线：

**第一层 · 分期分会话**。每期开新会话，只读该期所需文件。每张施工单强制包含四段：前置依赖 / 只读文件清单 / 产出文件清单 / **接口契约**（把下游需要的类型签名直接写死在 plan 里，避免为了知道 `SalesOrder` 长什么样而回读整个 P1）/ 验收标准 / 交接内容。

**第二层 · `STATE.md` 交接棒**。项目根目录维护，每期结束追加不超过 20 行：本期导出的关键签名、踩到的坑、未完成项。新会话第一件事读它，而非读代码摸索。"坑"那几行最值钱——那是纯口头知识，不写下来就丢了。

**第三层 · 子代理隔离脏活**。以下工作派给 subagent，中间输出留在子代理内，只有结论回主会话：构建报错排查、种子数据校验、部署验证、跨文件符号检索。

**工程纪律**（同样写进 plan）：
- 每个文件 < 200 行；15 个工具拆 `crm / erp / analytics / write` 四个文件
- 种子数据是函数不是 JSON 文件——`generateSeed(42)` 运行时生成，绝不落大体积 `data.json`
- 修改代码只用 Edit 不用 Write，避免整文件回读
- 构建只看尾部：`npm run build 2>&1 | tail -20`

目标：每期会话上下文峰值控制在 30–50k tokens，全程不触发压缩。

代价是 plan.md 会写得较厚（接口契约需重复抄写）。这是值得的——一天工期内最大的风险，是上下文压缩后 AI 开始编造并不存在的既有代码。

## 15. 风险

| 风险 | 应对 |
|---|---|
| 现场网络不通或 LLM 超时 | 录播模式兜底（§11） |
| `pages.dev` 国内偶发不稳 | P0 即验证；备用本地 `npm run dev` |
| GLM-4.5-Flash 工具调用不稳定 | 工具 description 写充分；Planner 输出用 JSON Schema 约束；失败重试一次后降级 |
| 9.3 小时缓冲过薄 | 按 §14.1 裁剪顺序执行，剧本 A/C 优先级最高 |
| 种子数据随机性破坏埋雷 | 埋雷数据硬编码覆盖，P1 验收标准包含逐条核对 |
