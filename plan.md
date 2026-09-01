# OrbitOS 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一天内交付一个可公网访问的 CRM/ERP 智能体演示系统，展示 Agent 自主规划、权限约束与人机协同闭环。

**Architecture:** 纯客户端单页应用，全部业务数据由种子函数在运行时生成并存于 Zustand。Agent 采用 Planner–Executor 双层架构：先让 LLM 输出结构化 JSON 计划并渲染成可见清单，再跑 function calling 循环逐步执行；写操作强制人工确认后才落库。权限在工具注册表层生效——未授权的工具不会出现在发给 LLM 的 tools 数组里。LLM 请求经 Cloudflare Pages Function 同源代理，API Key 不入前端。

**Tech Stack:** Vite 5 · React 18 · TypeScript 5 · Tailwind CSS 3 · shadcn/ui · Zustand 4 · Recharts 2 · Vitest 1 · Cloudflare Pages + Pages Functions · 智谱 GLM-4.5-Flash

**Spec:** `docs/superpowers/specs/2026-09-02-orbitos-design.md`

---

## Global Constraints

- **Node ≥ 20**（本机 v22.22.0）。包管理用 npm。
- **今天是 2026-09-02**。所有演示数据的日期以此为基准，不要写死其他"今天"。
- **每个源文件 < 200 行**。超了就拆。15 个工具必须拆成 `crm/erp/analytics/write` 四个文件。
- **种子数据是函数不是 JSON 文件**。绝不生成 `data.json` 之类的大体积数据文件——读一次就是 100k tokens。
- **修改已有文件只用 Edit，不用 Write**，避免整文件回读。
- **构建只看尾部**：`npm run build 2>&1 | tail -20`。不要把完整构建日志读进上下文。
- **测试策略（刻意的取舍）**：只对纯逻辑层写 Vitest 单测——种子埋雷校验、RBAC 过滤、工具执行、交期风险计算。这四块是演示的命门，且测试成本极低。UI 层用浏览器手工验收清单，不写组件测试。一天工期内为 UI 写测试是负收益，这是有意识的权衡，不是遗漏。
- **LLM 模型固定 `glm-4.5-flash`**，接口 `https://open.bigmodel.cn/api/paas/v4/chat/completions`，OpenAI 兼容格式。
- **API Key 只存 Cloudflare Pages 环境变量 `ZHIPU_API_KEY`**，禁止出现在任何提交的文件里。`.env.local` 必须在 `.gitignore` 中。
- **每期结束必须更新 `STATE.md`** 并提交。下一期的会话第一件事是读它。

---

## 上下文管理协议（每期开工前必读）

全项目约 45 文件 / 6000 行，全量读入约 150k tokens。按下面的规矩走，每期峰值可压在 30–50k。

**每期一个新会话。** 开工时：
1. 读 `STATE.md`（很小），**不要**为了"摸清情况"去读代码。
2. 读本期施工单的「只读文件」清单里列出的文件，**只读这些**。
3. 需要的上游类型签名已抄在本期的「接口契约」里，直接用，不要回读上游实现。

**收工时**：往 `STATE.md` 追加不超过 20 行——本期导出的关键签名、**踩到的坑**、未完成项。"坑"那几行最值钱，那是纯口头知识，不写下来就丢了。

**这几类脏活派给 subagent**（中间输出留在子代理里，只有结论回主会话）：
- 构建/类型报错排查（一屏 TS 报错 + 反复试错，轻松 30k tokens）
- 种子数据埋雷校验（要打印大量数据核对）
- 部署验证（wrangler 日志、DNS 检查）
- 跨文件符号检索（"XX 在哪定义的"）

**时间不足时的裁剪顺序**（先砍上面的）：
1. Task 6 的实时 tick 背景数据流（保留 Agent 写入的因果联动）
2. Task 3 的列表详情抽屉与手工编辑（列表只读即可，主角是 Agent）
3. Task 6 的图表从 3 个减到 1 个

演示剧本 A 与 C 必须活到最后。

---

## 文件结构

```
orbit-os/
├── package.json  vite.config.ts  tsconfig.json  tailwind.config.js  postcss.config.js
├── index.html  .gitignore  .env.example
├── plan.md  STATE.md  README.md
├── functions/api/chat.ts              # Pages Function：LLM 同源代理
├── docs/
│   ├── PRD.md  agent-design.md  demo-script.md
│   └── superpowers/specs/2026-09-02-orbitos-design.md
└── src/
    ├── main.tsx  App.tsx  index.css
    ├── lib/
    │   ├── types.ts        # 所有实体 + Role + AgentEvent + ToolDef 契约
    │   ├── seed.ts         # generateSeed(42)，含硬编码埋雷
    │   ├── seed.test.ts
    │   ├── rbac.ts         # ROLE_META / scope* / maskOrderForRole
    │   ├── rbac.test.ts
    │   ├── risk.ts         # simulateDeliveryRisk 纯计算 + buildRiskCards
    │   ├── risk.test.ts
    │   ├── store.ts        # Zustand：db + currentUser + applyMutation + reset
    │   └── format.ts       # 金额/日期/相对天数格式化
    ├── agent/
    │   ├── registry.ts     # ALL_TOOLS / toolsFor / toolSchemasFor / executeTool
    │   ├── registry.test.ts
    │   ├── tools/{crm,erp,analytics,write}.ts
    │   ├── prompts.ts      # PLANNER_PROMPT / EXECUTOR_PROMPT
    │   ├── llm.ts          # chat() → POST /api/chat
    │   ├── loop.ts         # runAgent()：Planner → Executor → Reflect
    │   └── replay.ts       # 录播模式事件流（断网兜底）
    ├── components/
    │   ├── ui/             # shadcn 生成
    │   ├── AppShell.tsx  RoleSwitcher.tsx  StatusChip.tsx  DataTable.tsx  RefChip.tsx
    ├── sidekick/
    │   ├── Sidekick.tsx  PlanChecklist.tsx  ToolCallCard.tsx  ConfirmCard.tsx  FinalAnswer.tsx
    └── pages/
        └── Dashboard.tsx  Customers.tsx  Opportunities.tsx  Orders.tsx
            Inventory.tsx  Purchases.tsx  Receivables.tsx
```

---

# Task 0（P0）：脚手架与部署打通

**为什么排第一**：部署问题晚发现会毁掉一整天。这一期结束时必须有一个能用手机 4G 打开的 URL。

**预计 40 分钟。**

**Files:**
- Create: `package.json` `vite.config.ts` `tsconfig.json` `tailwind.config.js` `postcss.config.js` `index.html` `.gitignore` `.env.example`
- Create: `src/main.tsx` `src/App.tsx` `src/index.css`
- Create: `functions/api/chat.ts`
- Create: `STATE.md`

**Interfaces:**
- Produces: `POST /api/chat` 接受 OpenAI 兼容的 `{model, messages, tools?, tool_choice?, response_format?}`，返回智谱原始响应。

**只读文件：** 无（全新项目）

---

- [ ] **Step 0.1: 注册智谱账号并拿 Key**

浏览器打开 `https://open.bigmodel.cn`，手机号注册 → 控制台 → API Keys → 新建。
复制形如 `xxxxxxxx.yyyyyyyy` 的 Key，先存在本地记事本，**不要写进任何代码文件**。

免费模型确认：模型列表里应能看到 `glm-4.5-flash`，标注免费。

- [ ] **Step 0.2: 初始化 Vite 项目**

```bash
cd ~/orbit-os
npm create vite@latest . -- --template react-ts
npm install
npm install zustand recharts react-router-dom clsx tailwind-merge lucide-react
npm install -D tailwindcss@3 postcss autoprefixer vitest
npx tailwindcss init -p
```

注意：`npm create vite` 在非空目录会提示，选择"忽略并继续"（目录里已有 `docs/` 和 `plan.md`）。

- [ ] **Step 0.3: 配置 Tailwind**

`tailwind.config.js`：

```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0073ea', dark: '#0060b9' },
        ok: '#00c875', warn: '#fdab3d', danger: '#e2445c', idle: '#c4c4c4',
      },
    },
  },
  plugins: [],
}
```

`src/index.css` 顶部替换为：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; }
body { @apply bg-slate-50 text-slate-800 antialiased; font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
```

- [ ] **Step 0.4: 写一个能验证部署的最小 App**

`src/App.tsx`：

```tsx
import { useState } from 'react'

export default function App() {
  const [status, setStatus] = useState('未测试')
  async function ping() {
    setStatus('请求中…')
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'glm-4.5-flash',
          messages: [{ role: 'user', content: '只回复两个字：连通' }],
        }),
      })
      const j = await r.json()
      setStatus(j?.choices?.[0]?.message?.content ?? `HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`)
    } catch (e) {
      setStatus('失败：' + String(e))
    }
  }
  return (
    <div className="p-10 space-y-4">
      <h1 className="text-2xl font-bold text-brand">OrbitOS 部署自检</h1>
      <button onClick={ping} className="px-4 py-2 rounded bg-brand text-white">测试 /api/chat</button>
      <pre className="p-3 bg-white rounded border text-sm whitespace-pre-wrap">{status}</pre>
    </div>
  )
}
```

- [ ] **Step 0.5: 写 Pages Function 代理**

`functions/api/chat.ts`：

```ts
interface Env { ZHIPU_API_KEY: string }

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const key = ctx.env.ZHIPU_API_KEY
  if (!key) {
    return new Response(JSON.stringify({ error: 'NO_KEY' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }
  const body = await ctx.request.text()
  const upstream = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body,
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

`.env.example`：

```
# 复制为 .env.local 后填入，仅本地开发用；线上走 Cloudflare Pages 环境变量
ZHIPU_API_KEY=
```

`.gitignore` 追加：

```
.env.local
.env
node_modules
dist
.wrangler
```

- [ ] **Step 0.6: 本地验证构建通过**

```bash
npm run build 2>&1 | tail -20
```

期望：出现 `dist/index.html` 且无错误。

- [ ] **Step 0.7: 提交并推到 GitHub**

在浏览器打开 `https://github.com/new`，仓库名 `orbit-os`，Public，**不要**勾选任何初始化文件。创建后执行：

```bash
cd ~/orbit-os
git add -A
git commit -m "feat: 项目脚手架与 LLM 代理"
git branch -M main
git remote add origin https://github.com/<你的用户名>/orbit-os.git
git push -u origin main
```

- [ ] **Step 0.8: 连接 Cloudflare Pages**

浏览器打开 `https://dash.cloudflare.com` → Workers & Pages → Create → Pages → Connect to Git → 选 `orbit-os`。

构建配置：
- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`

在 Settings → Environment variables → Production 添加 `ZHIPU_API_KEY`，值为 Step 0.1 的 Key。**添加变量后需要重新 Deploy 一次才生效。**

- [ ] **Step 0.9: 验收 —— 这一期唯一真正重要的一步**

1. 打开 `https://orbit-os.pages.dev`，页面能加载。
2. 点「测试 /api/chat」，输出框显示「连通」（或类似的两字回复）。
3. **用手机关掉 WiFi、走 4G/5G 蜂窝数据打开同一个 URL**，确认能加载且能点通。

⚠️ 第 3 条不通过就不要往下走。备选方案按顺序尝试：(a) 在 Cloudflare 绑一个自有域名；(b) 换 `orbit-demo.pages.dev` 之类的新项目名重试；(c) 接受本地 `npm run dev` 演示，在 `STATE.md` 里记下这个决定。

- [ ] **Step 0.10: 建立 STATE.md 并提交**

`STATE.md`：

```markdown
# OrbitOS 施工状态

> 每期收工追加不超过 20 行。新会话第一件事读这个文件，不要读代码摸索。

## P0 完成 (2026-09-02)
- 线上地址：https://orbit-os.pages.dev
- `/api/chat` 已连通，Key 存于 Cloudflare Pages 环境变量 ZHIPU_API_KEY
- 国内手机流量访问：通过 / 未通过（填实际结果）
- 技术栈已装：react-ts, tailwind@3, zustand, recharts, react-router-dom, vitest
- ⚠️ 坑：（填写遇到的问题）
```

```bash
git add -A && git commit -m "docs: P0 交接状态" && git push
```

---

# Task 1（P1）：数据层

**预计 90 分钟。** 本期是全项目的地基，类型定义错了后面全塌。

**Files:**
- Create: `src/lib/types.ts` `src/lib/seed.ts` `src/lib/seed.test.ts` `src/lib/rbac.ts` `src/lib/rbac.test.ts` `src/lib/risk.ts` `src/lib/risk.test.ts` `src/lib/store.ts` `src/lib/format.ts`
- Modify: `package.json`（加 test 脚本）

**只读文件：** `STATE.md`

**Interfaces:**
- Produces:
  ```ts
  generateSeed(seed?: number): DbSnapshot
  useStore(): { db, currentUser, setRole, applyMutation, reset, auditLog }
  scopeCustomers(db, user): Customer[]
  scopeOrders(db, user): SalesOrder[]
  scopeOpportunities(db, user): Opportunity[]
  maskOrderForRole(o: SalesOrder, role: Role): Record<string, unknown>
  simulateDeliveryRisk(db: DbSnapshot, orderIds: string[]): DeliveryRisk[]
  buildRiskCards(db: DbSnapshot, user: User): RiskCard[]
  ROLE_META: Record<Role, RoleMeta>
  ```

---

- [ ] **Step 1.1: 加测试脚本**

`package.json` 的 `scripts` 加：

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 1.2: 写 `src/lib/types.ts`**

```ts
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
```

- [ ] **Step 1.3: 先写种子埋雷的失败测试**

`src/lib/seed.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { generateSeed } from './seed'

describe('埋雷数据（演示命门，必须精确）', () => {
  const db = generateSeed(42)

  it('SKU-203 可用库存为 42', () => {
    const p = db.products.find(p => p.sku === 'SKU-203')!
    expect(p.name).toBe('高精度伺服电机 SV-800')
    const inv = db.inventory.find(i => i.skuId === p.id)!
    expect(inv.available).toBe(42)
  })

  it('三张订单在 09-08~09-11 交付，合计需 90 台 SKU-203', () => {
    const p = db.products.find(p => p.sku === 'SKU-203')!
    const nos = ['SO-2026-0412', 'SO-2026-0428', 'SO-2026-0435']
    const orders = nos.map(n => db.orders.find(o => o.orderNo === n)!)
    expect(orders.every(Boolean)).toBe(true)
    expect(orders.map(o => o.promisedDeliveryDate))
      .toEqual(['2026-09-08', '2026-09-10', '2026-09-11'])
    expect(orders.every(o => o.status === '待发货')).toBe(true)
    const total = orders.reduce(
      (s, o) => s + o.items.filter(l => l.skuId === p.id).reduce((a, l) => a + l.qty, 0), 0)
    expect(total).toBe(90)
  })

  it('唯一在途采购单 ETA 晚于最早交期 5 天', () => {
    const po = db.purchaseOrders.find(p => p.poNo === 'PO-2026-0117')!
    expect(po.status).toBe('在途')
    expect(po.eta).toBe('2026-09-16')
  })

  it('供应商比选：锐驰机电交期短但更贵', () => {
    const a = db.suppliers.find(s => s.name === '东瑞传动')!
    const b = db.suppliers.find(s => s.name === '锐驰机电')!
    expect(a.leadTimeDays).toBe(14); expect(a.onTimeRate).toBe(0.78); expect(a.priceFactor).toBe(1.0)
    expect(b.leadTimeDays).toBe(7);  expect(b.onTimeRate).toBe(0.94); expect(b.priceFactor).toBe(1.12)
    const p = db.products.find(p => p.sku === 'SKU-203')!
    expect(a.skuIds).toContain(p.id)
    expect(b.skuIds).toContain(p.id)
  })

  it('权限场景：张伟名下最大客户 86 万，全公司最大 520 万且不属于张伟', () => {
    const zw = db.users.find(u => u.name === '张伟')!
    const mine = db.customers.filter(c => c.ownerId === zw.id)
    expect(mine.length).toBe(9)
    expect(Math.max(...mine.map(c => c.annualRevenue))).toBe(860000)
    const top = [...db.customers].sort((a, b) => b.annualRevenue - a.annualRevenue)[0]
    expect(top.annualRevenue).toBe(5200000)
    expect(top.ownerId).not.toBe(zw.id)
  })

  it('存在 2 笔逾期超 60 天的应收', () => {
    const overdue = db.receivables.filter(r => r.status === '已逾期' && r.dueDate < '2026-07-04')
    expect(overdue.length).toBeGreaterThanOrEqual(2)
  })

  it('相同种子产出完全一致', () => {
    expect(JSON.stringify(generateSeed(42))).toBe(JSON.stringify(generateSeed(42)))
  })
})

describe('数据规模', () => {
  const db = generateSeed(42)
  it('实体数量符合设计', () => {
    expect(db.users.length).toBe(12)
    expect(db.customers.length).toBe(48)
    expect(db.opportunities.length).toBe(90)
    expect(db.products.length).toBe(60)
    expect(db.inventory.length).toBe(60)
    expect(db.suppliers.length).toBe(8)
    expect(db.orders.length).toBe(160)
    expect(db.purchaseOrders.length).toBe(55)
    expect(db.receivables.length).toBe(120)
  })
})
```

- [ ] **Step 1.4: 运行测试确认全部失败**

```bash
npm test 2>&1 | tail -20
```

期望：`Cannot find module './seed'`。

- [ ] **Step 1.5: 写 `src/lib/seed.ts`**

结构：先用 mulberry32 随机生成全部数据，**最后用 `applyPlantedScenario()` 硬编码覆盖埋雷部分**。顺序不能反。

```ts
import type {
  DbSnapshot, User, Customer, Product, Inventory, Supplier,
  SalesOrder, PurchaseOrder, Opportunity, Receivable, OppStage,
  OrderStatus, PoStatus,
} from './types'

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY = 86400000
function iso(d: Date) { return d.toISOString().slice(0, 10) }
function shift(base: string, days: number) { return iso(new Date(Date.parse(base) + days * DAY)) }

export function generateSeed(seed = 42): DbSnapshot {
  const rnd = mulberry32(seed)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))

  // ---- Users (12) ----
  // 前 4 个是演示角色，id 固定，后 8 个随机填充
  const users: User[] = [
    { id: 'U-001', name: '张伟', role: 'sales_rep',      teamId: 'T1', managerId: 'U-004' },
    { id: 'U-004', name: '李娜', role: 'sales_director', teamId: 'T1' },
    { id: 'U-006', name: '王强', role: 'supply_chain',   teamId: 'SC' },
    { id: 'U-008', name: '陈立', role: 'ceo',            teamId: 'HQ' },
    { id: 'U-002', name: '陈晓', role: 'sales_rep',      teamId: 'T1', managerId: 'U-004' },
    { id: 'U-003', name: '刘洋', role: 'sales_rep',      teamId: 'T1', managerId: 'U-004' },
    { id: 'U-005', name: '赵敏', role: 'sales_director', teamId: 'T2' },
    { id: 'U-009', name: '孙浩', role: 'sales_rep',      teamId: 'T2', managerId: 'U-005' },
    { id: 'U-010', name: '周琳', role: 'sales_rep',      teamId: 'T2', managerId: 'U-005' },
    { id: 'U-011', name: '吴迪', role: 'sales_rep',      teamId: 'T2', managerId: 'U-005' },
    { id: 'U-007', name: '孙磊', role: 'supply_chain',   teamId: 'SC' },
    { id: 'U-012', name: '郑凯', role: 'sales_rep',      teamId: 'T1', managerId: 'U-004' },
  ]
  const reps = users.filter(u => u.role === 'sales_rep')

  // ---- Products (60) ----
  const CATS = ['传感器', '伺服电机', '控制器', '减速机', '变频器', '工业相机']
  const products: Product[] = Array.from({ length: 60 }, (_, i) => {
    const cat = CATS[i % CATS.length]
    const unitPrice = int(800, 42000)
    return {
      id: `P-${String(i + 1).padStart(3, '0')}`,
      sku: `SKU-${String(101 + i).padStart(3, '0')}`,
      name: `${cat} ${['XA', 'SV', 'KC', 'RD', 'VF', 'IC'][i % 6]}-${int(100, 999)}`,
      category: cat, unitPrice, cost: Math.round(unitPrice * (0.58 + rnd() * 0.14)),
      unit: '台',
    }
  })

  // ---- Inventory (60) ----
  const inventory: Inventory[] = products.map(p => {
    const onHand = int(0, 400), reserved = int(0, Math.floor(onHand * 0.4))
    return { skuId: p.id, onHand, reserved, available: onHand - reserved, safetyStock: int(20, 80) }
  })

  // ---- Suppliers (8) ----
  const SUP_NAMES = ['东瑞传动', '锐驰机电', '恒信自动化', '中远精密',
                     '德昌电气', '联工科技', '汇能传感', '正泰工控']
  const suppliers: Supplier[] = SUP_NAMES.map((name, i) => ({
    id: `SUP-${i + 1}`, name,
    leadTimeDays: int(5, 20), onTimeRate: Math.round((0.7 + rnd() * 0.28) * 100) / 100,
    skuIds: products.filter(() => rnd() < 0.25).map(p => p.id),
    priceFactor: Math.round((0.95 + rnd() * 0.2) * 100) / 100,
  }))

  // ---- Customers (48) ----
  const CUST = ['华宁自动化','中科机电','长风精工','海通重工','明远智造','恒峰电子','鑫辉装备','蓝汛控制',
    '天工机床','宏业传动','汇川设备','南方精密','东方工控','瑞泽机械','和信自动化','立群电气',
    '博越智能','嘉禾装备','鼎信机电','远大重工','新宇精工','银河控制','裕丰机械','兴海电子',
    '腾达工控','昌盛传动','宁远装备','广联智造','晟通机械','凯瑞电气','万邦精密','中辰自动化',
    '联信机电','泰和工控','德胜装备','华科传动','安迅电子','正阳机械','金鹏智造','元通控制',
    '弘业精工','恒达机电','昊天装备','南山工控','中通传动','聚力电气','盛世机械','环宇自动化']
  const INDUSTRY = ['汽车零部件', '3C 电子', '新能源', '食品机械', '包装印刷', '半导体']
  const REGION = ['华东', '华南', '华北', '华中', '西南']
  const customers: Customer[] = CUST.map((name, i) => {
    const annualRevenue = int(20, 300) * 10000
    return {
      id: `C-${String(i + 1).padStart(3, '0')}`, name,
      industry: pick(INDUSTRY), region: pick(REGION),
      ownerId: reps[i % reps.length].id,
      tier: annualRevenue > 2000000 ? 'A' : annualRevenue > 800000 ? 'B' : 'C',
      creditLimit: Math.round(annualRevenue * 0.3),
      creditUsed: Math.round(annualRevenue * 0.3 * rnd()),
      annualRevenue,
    }
  })

  // ---- Opportunities (90) ----
  const STAGES: OppStage[] = ['线索确认','需求分析','方案报价','商务谈判','赢单','输单']
  const PROB: Record<OppStage, number> = {
    线索确认: 0.1, 需求分析: 0.25, 方案报价: 0.5, 商务谈判: 0.75, 赢单: 1, 输单: 0,
  }
  const opportunities: Opportunity[] = Array.from({ length: 90 }, (_, i) => {
    const c = customers[i % customers.length]
    const stage = pick(STAGES)
    return {
      id: `OPP-${String(i + 1).padStart(3, '0')}`,
      name: `${c.name} ${pick(CATS)}采购项目`,
      customerId: c.id, ownerId: c.ownerId, stage,
      amount: int(5, 200) * 10000, probability: PROB[stage],
      expectedCloseDate: shift('2026-09-02', int(-30, 90)),
      lastActivityAt: shift('2026-09-02', -int(0, 45)),
    }
  })

  // ---- SalesOrders (160) ----
  const OSTAT: OrderStatus[] = ['待审核','待发货','部分发货','已发货','已完成','已取消']
  const orders: SalesOrder[] = Array.from({ length: 160 }, (_, i) => {
    const c = customers[i % customers.length]
    const items = Array.from({ length: int(1, 3) }, () => {
      const p = pick(products)
      return { skuId: p.id, qty: int(1, 30), unitPrice: p.unitPrice }
    })
    return {
      id: `SO-${String(i + 1).padStart(3, '0')}`,
      orderNo: `SO-2026-${String(300 + i).padStart(4, '0')}`,
      customerId: c.id, ownerId: c.ownerId, status: pick(OSTAT),
      promisedDeliveryDate: shift('2026-09-02', int(-60, 45)),
      totalAmount: items.reduce((s, l) => s + l.qty * l.unitPrice, 0),
      items, createdAt: shift('2026-09-02', -int(5, 120)),
    }
  })

  // ---- PurchaseOrders (55) ----
  const PSTAT: PoStatus[] = ['草稿','待审批','已下单','在途','已入库']
  const purchaseOrders: PurchaseOrder[] = Array.from({ length: 55 }, (_, i) => {
    const s = pick(suppliers)
    const items = Array.from({ length: int(1, 3) }, () => {
      const p = pick(products)
      return { skuId: p.id, qty: int(10, 120), unitCost: Math.round(p.cost * s.priceFactor) }
    })
    return {
      id: `PO-${String(i + 1).padStart(3, '0')}`,
      poNo: `PO-2026-${String(100 + i).padStart(4, '0')}`,
      supplierId: s.id, status: pick(PSTAT),
      eta: shift('2026-09-02', int(-20, 40)),
      items, totalCost: items.reduce((a, l) => a + l.qty * l.unitCost, 0),
      expedited: false, createdBy: 'U-006',
    }
  })

  // ---- Receivables (120) ----
  const receivables: Receivable[] = Array.from({ length: 120 }, (_, i) => {
    const o = orders[i]
    const dueDate = shift(o.createdAt, 45)
    const paid = rnd() < 0.55
    return {
      id: `AR-${String(i + 1).padStart(3, '0')}`,
      orderId: o.id, customerId: o.customerId, amount: o.totalAmount,
      paidAmount: paid ? o.totalAmount : 0, dueDate,
      status: paid ? '已回款' : dueDate < '2026-09-02' ? '已逾期' : '未到期',
    }
  })

  const db: DbSnapshot = {
    users, customers, products, inventory, suppliers,
    orders, purchaseOrders, opportunities, receivables, tasks: [],
  }
  applyPlantedScenario(db)
  return db
}
```

- [ ] **Step 1.6: 写 `applyPlantedScenario`（同文件末尾）**

这是演示的命门，全部硬编码，不依赖随机数。

```ts
/**
 * 硬编码覆盖演示所需的冲突链。必须在随机生成之后调用。
 * 详见 spec §5.3。
 */
function applyPlantedScenario(db: DbSnapshot) {
  // 1) SKU-203 定义为「高精度伺服电机 SV-800」，可用库存 42
  const p203 = db.products.find(p => p.sku === 'SKU-203')!
  p203.name = '高精度伺服电机 SV-800'
  p203.category = '伺服电机'
  p203.unitPrice = 18600
  p203.cost = 11000
  const inv = db.inventory.find(i => i.skuId === p203.id)!
  inv.onHand = 58; inv.reserved = 16; inv.available = 42; inv.safetyStock = 30

  // 2) 三张待发货订单，合计 90 台，交期 09-08 / 09-10 / 09-11
  const planted: [string, string, string, number, string][] = [
    ['SO-P01', 'SO-2026-0412', '华宁自动化', 40, '2026-09-08'],
    ['SO-P02', 'SO-2026-0428', '中科机电',   30, '2026-09-10'],
    ['SO-P03', 'SO-2026-0435', '长风精工',   20, '2026-09-11'],
  ]
  for (const [id, orderNo, custName, qty, date] of planted) {
    const c = db.customers.find(x => x.name === custName)!
    db.orders = db.orders.filter(o => o.orderNo !== orderNo)   // 防随机重号
    db.orders.push({
      id, orderNo, customerId: c.id, ownerId: c.ownerId, status: '待发货',
      promisedDeliveryDate: date,
      totalAmount: qty * p203.unitPrice,
      items: [{ skuId: p203.id, qty, unitPrice: p203.unitPrice }],
      createdAt: '2026-08-05',
    })
  }
  // 保持总数 160
  while (db.orders.length > 160) {
    const i = db.orders.findIndex(o => !o.id.startsWith('SO-P'))
    db.orders.splice(i, 1)
  }

  // 3) 唯一在途采购单，ETA 比最早交期晚 5 天
  const dr = db.suppliers.find(s => s.name === '东瑞传动')!
  db.purchaseOrders = db.purchaseOrders.filter(
    po => !(po.status === '在途' && po.items.some(l => l.skuId === p203.id)))
  db.purchaseOrders.push({
    id: 'PO-P01', poNo: 'PO-2026-0117', supplierId: dr.id, status: '在途',
    eta: '2026-09-16',
    items: [{ skuId: p203.id, qty: 60, unitCost: 11000 }],
    totalCost: 660000, expedited: false, createdBy: 'U-006',
  })
  while (db.purchaseOrders.length > 55) {
    const i = db.purchaseOrders.findIndex(po => po.id !== 'PO-P01')
    db.purchaseOrders.splice(i, 1)
  }

  // 4) 供应商比选参数
  dr.leadTimeDays = 14; dr.onTimeRate = 0.78; dr.priceFactor = 1.0
  if (!dr.skuIds.includes(p203.id)) dr.skuIds.push(p203.id)
  const rc = db.suppliers.find(s => s.name === '锐驰机电')!
  rc.leadTimeDays = 7; rc.onTimeRate = 0.94; rc.priceFactor = 1.12
  if (!rc.skuIds.includes(p203.id)) rc.skuIds.push(p203.id)

  // 5) 权限场景：张伟名下 9 个客户，最大 86 万；全公司最大 520 万归赵敏团队
  const zw = db.users.find(u => u.name === '张伟')!
  const other = db.users.find(u => u.name === '周琳')!   // T2 团队，非张伟
  db.customers.forEach(c => { if (c.ownerId === zw.id) c.ownerId = other.id })
  const mine = db.customers.slice(0, 9)
  mine.forEach((c, i) => {
    c.ownerId = zw.id
    c.annualRevenue = [860000, 720000, 610000, 540000, 480000, 390000, 310000, 250000, 180000][i]
    c.tier = c.annualRevenue > 2000000 ? 'A' : c.annualRevenue > 800000 ? 'B' : 'C'
    c.creditLimit = Math.round(c.annualRevenue * 0.3)
    c.creditUsed = Math.round(c.creditLimit * 0.4)
  })
  const top = db.customers.find(c => c.name === '海通重工')!
  top.ownerId = other.id
  top.annualRevenue = 5200000
  top.tier = 'A'
  db.customers.filter(c => c !== top && c.ownerId !== zw.id)
    .forEach(c => { if (c.annualRevenue >= 5200000) c.annualRevenue = 1900000 })

  // 华宁自动化设为 A 级大客户，供 Agent 给出「优先保它」的建议
  const hn = db.customers.find(c => c.name === '华宁自动化')!
  hn.tier = 'A'; hn.annualRevenue = 3800000; hn.creditLimit = 1140000

  // 6) 两笔逾期超 60 天的应收
  db.receivables[0] = { ...db.receivables[0], status: '已逾期', paidAmount: 0,
    dueDate: '2026-06-20', amount: 486000 }
  db.receivables[1] = { ...db.receivables[1], status: '已逾期', paidAmount: 0,
    dueDate: '2026-06-05', amount: 312000 }
}
```

- [ ] **Step 1.7: 跑测试直到全绿**

```bash
npm test 2>&1 | tail -30
```

⚠️ 这一步大概率要反复调（数量守恒、客户归属互相打架）。**如果超过两轮还不绿，把排查派给 subagent**：给它 `seed.ts` 和 `seed.test.ts`，让它跑测试、定位、修复，只回报改了哪几行。别把大段测试输出读进主会话。

- [ ] **Step 1.8: 写 `src/lib/rbac.ts`**

```ts
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
```

- [ ] **Step 1.9: 写 `src/lib/rbac.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { generateSeed } from './seed'
import { scopeCustomers, scopeOrders, scopeOpportunities, maskOrderForRole } from './rbac'

const db = generateSeed(42)
const u = (n: string) => db.users.find(x => x.name === n)!

describe('数据级权限', () => {
  it('销售代表只看到自己的 9 个客户', () => {
    const r = scopeCustomers(db, u('张伟'))
    expect(r.length).toBe(9)
    expect(r.every(c => c.ownerId === 'U-001')).toBe(true)
  })
  it('销售代表看不到全公司最大客户', () => {
    const r = scopeCustomers(db, u('张伟'))
    expect(Math.max(...r.map(c => c.annualRevenue))).toBe(860000)
  })
  it('CEO 看到全部 48 个客户', () => {
    expect(scopeCustomers(db, u('陈立')).length).toBe(48)
  })
  it('供应链主管无客户与商机权限', () => {
    expect(scopeCustomers(db, u('王强')).length).toBe(0)
    expect(scopeOpportunities(db, u('王强')).length).toBe(0)
  })
  it('销售总监看到本团队而非全公司', () => {
    const r = scopeOrders(db, u('李娜'))
    expect(r.length).toBeGreaterThan(0)
    expect(r.length).toBeLessThan(db.orders.length)
  })
})

describe('字段脱敏', () => {
  it('供应链主管看到的订单金额是 ***，SKU 与数量保留', () => {
    const o = db.orders.find(x => x.orderNo === 'SO-2026-0412')!
    const m = maskOrderForRole(o, 'supply_chain') as any
    expect(m.totalAmount).toBe('***')
    expect(m.items[0].unitPrice).toBe('***')
    expect(m.items[0].qty).toBe(40)
  })
  it('其他角色不脱敏', () => {
    const o = db.orders.find(x => x.orderNo === 'SO-2026-0412')!
    expect((maskOrderForRole(o, 'ceo') as any).totalAmount).toBe(o.totalAmount)
  })
})
```

跑 `npm test 2>&1 | tail -20`，期望全绿。

- [ ] **Step 1.10: 写 `src/lib/risk.ts`**

关键算法：**按交期升序遍历订单并累积扣减可用量账本**。这是三张订单共 90 台、库存 42 台时能算出正确缺口的前提。

```ts
import type { DbSnapshot, User } from './types'
import { TODAY } from './types'
import { scopeOrders } from './rbac'

export interface Shortage {
  skuId: string; sku: string; skuName: string
  required: number; available: number; gap: number
}
export interface DeliveryRisk {
  orderId: string; orderNo: string; customerName: string
  promisedDeliveryDate: string
  shortages: Shortage[]
  incomingEta: string | null       // 该 SKU 最早在途到货日
  riskLevel: 'high' | 'medium' | 'none'
  daysLate: number
}

const DAY = 86400000
const diffDays = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY)

export function simulateDeliveryRisk(db: DbSnapshot, orderIds: string[]): DeliveryRisk[] {
  const ledger = new Map(db.inventory.map(i => [i.skuId, i.available]))
  const orders = orderIds
    .map(id => db.orders.find(o => o.id === id || o.orderNo === id))
    .filter((o): o is NonNullable<typeof o> => !!o)
    .sort((a, b) => a.promisedDeliveryDate.localeCompare(b.promisedDeliveryDate))

  return orders.map(o => {
    const shortages: Shortage[] = []
    let incomingEta: string | null = null
    for (const line of o.items) {
      const p = db.products.find(x => x.id === line.skuId)!
      const avail = ledger.get(line.skuId) ?? 0
      const gap = Math.max(0, line.qty - avail)
      ledger.set(line.skuId, Math.max(0, avail - line.qty))
      if (gap > 0) {
        shortages.push({ skuId: p.id, sku: p.sku, skuName: p.name,
                         required: line.qty, available: avail, gap })
        const etas = db.purchaseOrders
          .filter(po => (po.status === '在途' || po.status === '已下单')
                     && po.items.some(l => l.skuId === line.skuId))
          .map(po => po.eta).sort()
        if (etas.length && (!incomingEta || etas[0] < incomingEta)) incomingEta = etas[0]
      }
    }
    let riskLevel: DeliveryRisk['riskLevel'] = 'none'
    let daysLate = 0
    if (shortages.length) {
      if (!incomingEta) { riskLevel = 'high'; daysLate = 99 }
      else {
        daysLate = diffDays(incomingEta, o.promisedDeliveryDate)
        riskLevel = daysLate > 0 ? 'high' : 'medium'
      }
    }
    const c = db.customers.find(x => x.id === o.customerId)
    return { orderId: o.id, orderNo: o.orderNo, customerName: c?.name ?? '—',
             promisedDeliveryDate: o.promisedDeliveryDate,
             shortages, incomingEta, riskLevel, daysLate: Math.max(0, daysLate) }
  })
}

export interface RiskCard {
  id: string; severity: 'high' | 'medium'
  title: string; detail: string; question: string
}

/** 首页 Agent 主动风险卡。点击后把 question 灌进 Sidekick 直接开跑。 */
export function buildRiskCards(db: DbSnapshot, user: User): RiskCard[] {
  const cards: RiskCard[] = []
  const horizon = new Date(Date.parse(TODAY) + 7 * DAY).toISOString().slice(0, 10)
  const pending = scopeOrders(db, user)
    .filter(o => o.status === '待发货'
              && o.promisedDeliveryDate >= TODAY && o.promisedDeliveryDate <= horizon)
  const risks = simulateDeliveryRisk(db, pending.map(o => o.id)).filter(r => r.riskLevel === 'high')
  if (risks.length) {
    const gap = risks.flatMap(r => r.shortages).reduce((s, x) => s + x.gap, 0)
    const sku = risks[0].shortages[0]
    cards.push({
      id: 'RC-delivery', severity: 'high',
      title: `${risks.length} 张订单存在交期风险`,
      detail: `${sku.sku} ${sku.skuName} 缺口 ${gap} 台，最早到货 ${risks[0].incomingEta ?? '无在途'}`,
      question: '下周要交付的订单有风险吗？帮我排查并给出处理方案。',
    })
  }
  if (user.role === 'sales_director' || user.role === 'ceo') {
    const overdue = db.receivables.filter(r => r.status === '已逾期' && r.dueDate < '2026-07-04')
    if (overdue.length) {
      const amt = overdue.reduce((s, r) => s + r.amount - r.paidAmount, 0)
      cards.push({
        id: 'RC-ar', severity: 'medium',
        title: `${overdue.length} 笔应收逾期超 60 天`,
        detail: `合计 ¥${(amt / 10000).toFixed(1)} 万未回款`,
        question: '有哪些逾期超过 60 天的应收账款？涉及哪些客户？',
      })
    }
  }
  return cards
}
```

- [ ] **Step 1.11: 写 `src/lib/risk.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { generateSeed } from './seed'
import { simulateDeliveryRisk, buildRiskCards } from './risk'

const db = generateSeed(42)

describe('交期风险测算', () => {
  const ids = ['SO-2026-0412', 'SO-2026-0428', 'SO-2026-0435']
  const r = simulateDeliveryRisk(db, ids)

  it('按交期升序累积扣减，缺口合计 48 台', () => {
    expect(r.map(x => x.orderNo)).toEqual(ids)
    // 库存 42：0412 需 40 → 无缺口，余 2；0428 需 30 → 缺 28；0435 需 20 → 缺 20
    expect(r[0].shortages.length).toBe(0)
    expect(r[1].shortages[0].gap).toBe(28)
    expect(r[2].shortages[0].gap).toBe(20)
    expect(r[1].shortages[0].gap + r[2].shortages[0].gap).toBe(48)
  })

  it('缺口订单标记为 high 且晚 5 天以上', () => {
    expect(r[1].riskLevel).toBe('high')
    expect(r[1].incomingEta).toBe('2026-09-16')
    expect(r[1].daysLate).toBe(6)   // 09-16 减 09-10
    expect(r[2].daysLate).toBe(5)   // 09-16 减 09-11
  })
})

describe('主动风险卡', () => {
  it('供应链主管首页有交期风险卡', () => {
    const wq = db.users.find(u => u.name === '王强')!
    const cards = buildRiskCards(db, wq)
    expect(cards.some(c => c.id === 'RC-delivery')).toBe(true)
  })
  it('CEO 额外看到应收逾期卡', () => {
    const ceo = db.users.find(u => u.name === '陈立')!
    expect(buildRiskCards(db, ceo).some(c => c.id === 'RC-ar')).toBe(true)
  })
})
```

跑 `npm test 2>&1 | tail -20`，全绿。

> ⚠️ 若 `daysLate` 断言不符，先确认 `simulateDeliveryRisk` 是否真的做了**升序排序 + 账本累积扣减**。这是最容易写错的地方。

- [ ] **Step 1.12: 写 `src/lib/store.ts` 与 `src/lib/format.ts`**

```ts
// src/lib/store.ts
import { create } from 'zustand'
import type { DbSnapshot, User, Role, Mutation, AuditEntry } from './types'
import { generateSeed } from './seed'
import { ROLE_META } from './rbac'

interface State {
  db: DbSnapshot
  currentUser: User
  auditLog: AuditEntry[]
  setRole: (r: Role) => void
  applyMutation: (m: Mutation) => void
  pushAudit: (e: AuditEntry) => void
  reset: () => void
}

const initDb = generateSeed(42)
const initUser = initDb.users.find(u => u.id === ROLE_META.supply_chain.demoUserId)!

export const useStore = create<State>((set, get) => ({
  db: initDb,
  currentUser: initUser,
  auditLog: [],

  setRole: (r) => set(s => ({
    currentUser: s.db.users.find(u => u.id === ROLE_META[r].demoUserId)!,
  })),

  pushAudit: (e) => set(s => ({ auditLog: [e, ...s.auditLog].slice(0, 200) })),

  applyMutation: (m) => set(s => {
    const db = structuredClone(s.db)
    switch (m.kind) {
      case 'createPurchaseOrder':
        db.purchaseOrders.unshift(m.po)
        // 加急采购视为可用量即时补足（演示语义：锁定供应）
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
        db.tasks.unshift({
          id: `TSK-${db.tasks.length + 1}`, assigneeId: m.assigneeId,
          title: m.title, dueDate: m.dueDate, createdBy: get().currentUser.id,
        })
        break
    }
    return { db }
  }),

  reset: () => set({ db: generateSeed(42), auditLog: [] }),
}))
```

```ts
// src/lib/format.ts
export const money = (n: number | string) =>
  typeof n === 'string' ? n
    : n >= 10000 ? `¥${(n / 10000).toFixed(1)}万` : `¥${n.toLocaleString('zh-CN')}`

export const pct = (n: number) => `${Math.round(n * 100)}%`

export function daysFromToday(d: string, today = '2026-09-02') {
  return Math.round((Date.parse(d) - Date.parse(today)) / 86400000)
}
```

- [ ] **Step 1.13: 提交并更新 STATE.md**

往 `STATE.md` 追加：

```markdown
## P1 完成 (2026-09-02)
- src/lib/types.ts 导出全部实体、Mutation、AgentEvent、ToolDef、ToolContext、TODAY='2026-09-02'
- generateSeed(42) → DbSnapshot；埋雷已由 seed.test.ts 8 条断言锁定，改动后必须重跑
- useStore(): { db, currentUser, auditLog, setRole(role), applyMutation(m), pushAudit(e), reset() }
- rbac: ROLE_META / scopeCustomers / scopeOrders / scopeOpportunities / maskOrderForRole
- risk: simulateDeliveryRisk(db, orderIds) / buildRiskCards(db, user)
- ⚠️ 坑：Inventory.available 是计算字段，改 onHand/reserved 后必须手动重算
- ⚠️ 坑：applyPlantedScenario 必须在随机生成之后调用，否则埋雷被覆盖
```

```bash
npm test 2>&1 | tail -5
git add -A && git commit -m "feat: 数据层、RBAC 与交期风险计算" && git push
```

---

# Task 2（P2）：业务界面

**预计 100 分钟。**

**Files:**
- Create: `src/components/AppShell.tsx` `RoleSwitcher.tsx` `StatusChip.tsx` `DataTable.tsx`
- Create: `src/pages/{Customers,Opportunities,Orders,Inventory,Purchases,Receivables}.tsx`
- Modify: `src/App.tsx` `src/main.tsx`

**只读文件：** `STATE.md`、`src/lib/types.ts`、`src/lib/rbac.ts`、`src/lib/store.ts`、`src/lib/format.ts`

**Interfaces:**
- Consumes: `useStore()` / `ROLE_META` / `scope*` / `maskOrderForRole` / `money`（签名见 P1 交接）
- Produces:
  ```ts
  <AppShell>{children}</AppShell>          // 左导航 + 顶栏 + 内容槽 + 右侧 Sidekick 挂载点
  <StatusChip label={string} tone={'ok'|'warn'|'danger'|'info'|'idle'} />
  <DataTable columns={Column[]} rows={any[]} />
  interface Column { key: string; title: string; width?: string; render?: (row:any)=>ReactNode }
  ```

---

- [ ] **Step 2.1: 写 `StatusChip`（Monday 式彩色状态块）**

```tsx
// src/components/StatusChip.tsx
const TONE = {
  ok:     'bg-ok text-white',
  warn:   'bg-warn text-white',
  danger: 'bg-danger text-white',
  info:   'bg-brand text-white',
  idle:   'bg-idle text-slate-700',
} as const

export type Tone = keyof typeof TONE

export function StatusChip({ label, tone = 'idle' }: { label: string; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center justify-center px-3 py-1 rounded text-xs font-medium min-w-[76px] ${TONE[tone]}`}>
      {label}
    </span>
  )
}

export const ORDER_TONE: Record<string, Tone> = {
  待审核: 'warn', 待发货: 'info', 部分发货: 'warn',
  已发货: 'ok', 已完成: 'ok', 已取消: 'idle',
}
export const PO_TONE: Record<string, Tone> = {
  草稿: 'idle', 待审批: 'warn', 已下单: 'info', 在途: 'info', 已入库: 'ok',
}
export const STAGE_TONE: Record<string, Tone> = {
  线索确认: 'idle', 需求分析: 'info', 方案报价: 'info',
  商务谈判: 'warn', 赢单: 'ok', 输单: 'danger',
}
export const AR_TONE: Record<string, Tone> = {
  未到期: 'info', 已逾期: 'danger', 已回款: 'ok',
}
```

- [ ] **Step 2.2: 写 `DataTable`**

```tsx
// src/components/DataTable.tsx
import type { ReactNode } from 'react'

export interface Column { key: string; title: string; width?: string; render?: (row: any) => ReactNode }

export function DataTable({ columns, rows, empty = '暂无数据' }:
  { columns: Column[]; rows: any[]; empty?: string }) {
  if (!rows.length) {
    return <div className="p-12 text-center text-slate-400 bg-white rounded-lg border">{empty}</div>
  }
  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b">
          <tr>{columns.map(c => (
            <th key={c.key} style={{ width: c.width }}
                className="text-left px-4 py-3 font-medium text-slate-500">{c.title}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className="border-b last:border-0 hover:bg-slate-50">
              {columns.map(c => (
                <td key={c.key} className="px-4 py-2.5">
                  {c.render ? c.render(r) : String(r[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2.3: 写 `RoleSwitcher`**

```tsx
// src/components/RoleSwitcher.tsx
import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'
import type { Role } from '../lib/types'

const ORDER: Role[] = ['sales_rep', 'sales_director', 'supply_chain', 'ceo']

export function RoleSwitcher({ onSwitched }: { onSwitched?: (r: Role) => void }) {
  const { currentUser, setRole } = useStore()
  return (
    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
      {ORDER.map(r => {
        const m = ROLE_META[r]
        const active = currentUser.role === r
        return (
          <button key={r} title={m.description}
            onClick={() => { setRole(r); onSwitched?.(r) }}
            className={`px-3 py-1.5 rounded-md text-sm transition ${
              active ? 'bg-white shadow-sm font-medium text-brand' : 'text-slate-500 hover:text-slate-700'}`}>
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2.4: 写 `AppShell`**

左导航 + 顶栏（角色切换器、重置按钮）+ 内容区 + 右侧 Sidekick 槽位。Sidekick 本体在 P4 才实现，这里先留一个 `<aside>` 占位。

```tsx
// src/components/AppShell.tsx
import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'
import { RoleSwitcher } from './RoleSwitcher'

const NAV = [
  { to: '/',             label: '仪表盘' },
  { to: '/customers',    label: '客户' },
  { to: '/opportunities',label: '商机' },
  { to: '/orders',       label: '订单' },
  { to: '/inventory',    label: '库存' },
  { to: '/purchases',    label: '采购' },
  { to: '/receivables',  label: '应收' },
]

export function AppShell({ children, sidekick }: { children: ReactNode; sidekick?: ReactNode }) {
  const { currentUser, reset } = useStore()
  const meta = ROLE_META[currentUser.role]
  return (
    <div className="flex h-full">
      <nav className="w-48 shrink-0 bg-white border-r flex flex-col">
        <div className="px-5 py-4 border-b">
          <div className="text-lg font-bold text-brand">OrbitOS</div>
          <div className="text-xs text-slate-400 mt-0.5">擎源工业设备</div>
        </div>
        <div className="p-2 space-y-0.5 flex-1">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}
              className={({ isActive }) => `block px-3 py-2 rounded-md text-sm ${
                isActive ? 'bg-brand/10 text-brand font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>
              {n.label}
            </NavLink>
          ))}
        </div>
        <div className="p-3 border-t text-xs text-slate-400 leading-relaxed">
          <div className="font-medium text-slate-600">{currentUser.name} · {meta.label}</div>
          <div className="mt-1">{meta.description}</div>
        </div>
      </nav>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 bg-white border-b flex items-center justify-between px-6">
          <RoleSwitcher />
          <button onClick={reset}
            className="text-sm text-slate-500 hover:text-danger px-3 py-1.5 rounded hover:bg-slate-50">
            重置演示数据
          </button>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>

      <aside className="w-[420px] shrink-0 bg-white border-l flex flex-col">
        {sidekick ?? <div className="p-6 text-slate-400 text-sm">AI Sidekick（P4 实现）</div>}
      </aside>
    </div>
  )
}
```

- [ ] **Step 2.5: 写订单页作为完整范例**

```tsx
// src/pages/Orders.tsx
import { useStore } from '../lib/store'
import { scopeOrders, maskOrderForRole } from '../lib/rbac'
import { DataTable } from '../components/DataTable'
import { StatusChip, ORDER_TONE } from '../components/StatusChip'
import { money, daysFromToday } from '../lib/format'

export default function Orders() {
  const { db, currentUser } = useStore()
  const rows = scopeOrders(db, currentUser)
    .map(o => maskOrderForRole(o, currentUser.role))
    .sort((a: any, b: any) => a.promisedDeliveryDate.localeCompare(b.promisedDeliveryDate))

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">销售订单</h1>
        <span className="text-sm text-slate-400">{rows.length} 条（已按当前角色权限过滤）</span>
      </div>
      <DataTable
        rows={rows}
        empty="当前角色无权访问销售订单"
        columns={[
          { key: 'orderNo', title: '订单号', width: '140px' },
          { key: 'customer', title: '客户', render: (r) =>
              db.customers.find(c => c.id === r.customerId)?.name ?? '—' },
          { key: 'status', title: '状态', width: '110px',
            render: (r) => <StatusChip label={r.status} tone={ORDER_TONE[r.status]} /> },
          { key: 'promisedDeliveryDate', title: '承诺交期', width: '150px', render: (r) => {
              const d = daysFromToday(r.promisedDeliveryDate)
              const late = d < 0
              return <span className={late ? 'text-danger' : d <= 7 ? 'text-warn' : ''}>
                {r.promisedDeliveryDate}{d >= 0 && d <= 7 ? ` (${d}天后)` : ''}
              </span>
            } },
          { key: 'totalAmount', title: '金额', width: '120px', render: (r) => money(r.totalAmount) },
          { key: 'items', title: '行项目', width: '90px', render: (r) => `${r.items.length} 项` },
        ]}
      />
    </div>
  )
}
```

- [ ] **Step 2.6: 照此写另外 5 个列表页**

结构与 `Orders.tsx` 完全一致，只换数据源与列定义。**每页都必须传 `empty` 文案**，因为供应链主管在客户/商机页会拿到空数组——空态文案本身就是权限的可见证明。

| 文件 | 数据源 | 列 | 空态文案 |
|---|---|---|---|
| `Customers.tsx` | `scopeCustomers(db, currentUser)` | 客户名 / 行业 / 区域 / 等级(StatusChip: A=ok,B=info,C=idle) / 年采购额 `money` / 信用额度 `money` / 已用额度 | 当前角色无权访问客户数据 |
| `Opportunities.tsx` | `scopeOpportunities(db, currentUser)` | 商机名 / 客户 / 阶段(StatusChip + STAGE_TONE) / 金额 `money` / 赢率 `pct` / 预计成交日 | 当前角色无权访问商机数据 |
| `Inventory.tsx` | `db.inventory` 全部（无权限过滤） | SKU / 品名 / 在库 onHand / 已占用 reserved / **可用 available**（`available < safetyStock` 时红色加粗）/ 安全库存 | — |
| `Purchases.tsx` | `db.purchaseOrders`，非 supply_chain/ceo 显示空态 | 采购单号 / 供应商 / 状态(PO_TONE) / ETA / 行项目数 / 总成本 `money`（仅 supply_chain 与 ceo 可见） | 当前角色无权访问采购数据 |
| `Receivables.tsx` | `db.receivables`，非 sales_director/ceo 显示空态 | 应收单号 / 客户 / 金额 / 到期日（逾期红色）/ 状态(AR_TONE) | 当前角色无权访问应收数据 |

`Inventory.tsx` 的可用量列写法：

```tsx
{ key: 'available', title: '可用', width: '90px', render: (r) =>
    <span className={r.available < r.safetyStock ? 'text-danger font-semibold' : ''}>
      {r.available}
    </span> }
```

- [ ] **Step 2.7: 接路由**

```tsx
// src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import Dashboard from './pages/Dashboard'
import Customers from './pages/Customers'
import Opportunities from './pages/Opportunities'
import Orders from './pages/Orders'
import Inventory from './pages/Inventory'
import Purchases from './pages/Purchases'
import Receivables from './pages/Receivables'

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/opportunities" element={<Opportunities />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/receivables" element={<Receivables />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}
```

`src/pages/Dashboard.tsx` 本期先放占位（P5 实现）：

```tsx
export default function Dashboard() {
  return <div className="text-slate-400">仪表盘（P5 实现）</div>
}
```

Cloudflare Pages 的 SPA 回退：新建 `public/_redirects`，内容一行：

```
/*    /index.html   200
```

- [ ] **Step 2.8: 浏览器验收清单**

```bash
npm run dev
```

逐条核对：
1. 切到「销售代表」→ 客户页 9 条、订单页只有张伟的、商机页只有张伟的
2. 切到「供应链主管」→ 客户页与商机页显示空态文案；订单页有数据但**金额列显示 `***`**
3. 切到「CEO」→ 客户页 48 条、应收页有数据
4. 切到「销售总监」→ 客户数量介于 9 和 48 之间
5. 库存页存在若干可用量低于安全库存的红色行
6. 点「重置演示数据」，页面数据回到初始态
7. 状态列是彩色块不是纯文字

- [ ] **Step 2.9: 提交并更新 STATE.md**

```markdown
## P2 完成 (2026-09-02)
- AppShell 接受 sidekick prop，右侧 420px 槽位待 P4 填充
- StatusChip({label, tone}) + 导出 ORDER_TONE/PO_TONE/STAGE_TONE/AR_TONE 映射表
- DataTable({columns: Column[], rows, empty})，Column = {key,title,width?,render?}
- 6 个列表页已按角色过滤，空态文案是权限的可见证明
- public/_redirects 已加 SPA 回退，否则 Pages 上刷新子路由 404
- ⚠️ 坑：（填写）
```

```bash
npm run build 2>&1 | tail -20
git add -A && git commit -m "feat: 业务界面与角色切换" && git push
```

---

# Task 3（P3）：Agent 内核

**预计 120 分钟。全项目技术含量最高的一期。**

**Files:**
- Create: `src/agent/tools/{crm,erp,analytics,write}.ts` `src/agent/registry.ts` `src/agent/registry.test.ts`
- Create: `src/agent/prompts.ts` `src/agent/llm.ts` `src/agent/loop.ts`

**只读文件：** `STATE.md`、`src/lib/types.ts`、`src/lib/rbac.ts`、`src/lib/risk.ts`

**Interfaces:**
- Consumes（P1 契约，直接用，不要回读实现）：
  ```ts
  ToolDef, ToolContext, NotFound, Role, DbSnapshot, User, Mutation
  AgentEvent, Plan, PlanStep, TODAY
  scopeCustomers(db,user) / scopeOrders(db,user) / scopeOpportunities(db,user)
  maskOrderForRole(o, role): Record<string,unknown>
  simulateDeliveryRisk(db, orderIds): DeliveryRisk[]
  ROLE_META: Record<Role, {key,label,demoUserId,description}>
  ```
- Produces:
  ```ts
  ALL_TOOLS: ToolDef[]
  toolsFor(role: Role): ToolDef[]
  toolSchemasFor(role: Role): OpenAITool[]      // 直接塞进请求的 tools 字段
  executeTool(name, args, ctx): { ok: boolean; result: unknown; ms: number }
  runAgent(opts: RunAgentOptions): Promise<void>
  ```

---

- [ ] **Step 3.1: 写 `src/agent/tools/crm.ts`（4 个只读工具）**

```ts
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
```

- [ ] **Step 3.2: 写 `src/agent/tools/erp.ts`（6 个：5 只读 + 1 写）**

按下表实现，格式与 `crm.ts` 完全一致。

| name | allowedRoles | isWrite | parameters | run 要点 |
|---|---|---|---|---|
| `query_sales_orders` | 全部 4 角色 | false | `status?`, `deliveryDateFrom?`, `deliveryDateTo?`, `limit?` | `scopeOrders` 过滤后逐条 `maskOrderForRole`；空则 `{found:false}` |
| `get_order_detail` | 全部 4 角色 | false | `orderNo` (required) | 在 `scopeOrders` 结果里找，找到后 `maskOrderForRole`；附带客户名与每个 SKU 的品名 |
| `check_inventory` | 全部 4 角色 | false | `skus: string[]` (required，接受 SKU 编号或品名) | 返回 `onHand/reserved/available/safetyStock` + `belowSafety: boolean` |
| `query_purchase_orders` | `supply_chain`, `ceo` | false | `status?`, `skuFilter?`, `limit?` | 返回含 `eta`；`skuFilter` 匹配行项目 |
| `get_supplier_options` | `supply_chain`, `ceo` | false | `sku` (required) | 返回所有可供该 SKU 的供应商，含 `leadTimeDays / onTimeRate / priceFactor / estimatedUnitCost`，按 `leadTimeDays` 升序 |
| `create_purchase_order` | `supply_chain` | **true** | `supplierName`, `sku`, `qty`, `expedited?` (前三项 required) | 生成 `poNo = 'PO-2026-' + (900 + 现有采购单数)`，`eta = TODAY + leadTimeDays`（expedited 时减 2 天），`unitCost = product.cost * supplier.priceFactor`，调 `ctx.mutate({kind:'createPurchaseOrder', po})` |

`create_purchase_order` 的 `confirmSummary` 必须写清变更内容：

```ts
confirmSummary: (a, ctx) => {
  const s = ctx.db.suppliers.find(x => x.name === a.supplierName)
  const p = ctx.db.products.find(x => x.sku === a.sku || x.name === a.sku)
  if (!s || !p) return `将创建采购单：${a.supplierName} / ${a.sku} × ${a.qty}`
  const cost = Math.round(p.cost * s.priceFactor) * a.qty
  const lead = a.expedited ? Math.max(1, s.leadTimeDays - 2) : s.leadTimeDays
  const eta = new Date(Date.parse(TODAY) + lead * 86400000).toISOString().slice(0, 10)
  return `将向【${s.name}】采购 ${p.sku} ${p.name} × ${a.qty} 台，` +
         `预计成本 ¥${cost.toLocaleString('zh-CN')}，预计到货 ${eta}` +
         (a.expedited ? '（加急）' : '')
},
```

`get_supplier_options` 的 `estimatedUnitCost` 让 Agent 能算出"多付 ¥52,800"这个数——不要省略。

- [ ] **Step 3.3: 写 `src/agent/tools/analytics.ts`（3 个）**

| name | allowedRoles | isWrite | parameters | run 要点 |
|---|---|---|---|---|
| `query_receivables` | `sales_director`, `ceo` | false | `status?`, `overdueDaysMin?`, `limit?` | 附客户名与逾期天数 |
| `aggregate_metrics` | `sales_director`, `ceo` | false | `metric: 'revenue'\|'funnel'\|'top_customers'\|'order_status'` (required), `limit?` | 见下 |
| `simulate_delivery_risk` | 全部 4 角色 | false | `orderNos?: string[]`, `withinDays?: number` | 见下 |

`aggregate_metrics` 的四种口径：
- `revenue`：`scopeOrders` 中状态为已发货/已完成的 `totalAmount` 合计
- `funnel`：`scopeOpportunities` 按 stage 分组，返回每阶段条数与金额合计
- `top_customers`：`scopeCustomers` 按 `annualRevenue` 降序，取 `limit ?? 5`
- `order_status`：`scopeOrders` 按 status 分组计数

`simulate_delivery_risk`：不传 `orderNos` 时，默认取 `scopeOrders` 中状态为「待发货」且 `promisedDeliveryDate` 在 `TODAY` 到 `TODAY + (withinDays ?? 7)` 之间的订单，再调 P1 的 `simulateDeliveryRisk(ctx.db, ids)`。这是纯本地确定性计算——面试时可讲"数值推理不交给 LLM，LLM 只决定何时调用它"。

- [ ] **Step 3.4: 写 `src/agent/tools/write.ts`（2 个）**

| name | allowedRoles | isWrite | parameters | confirmSummary | run 要点 |
|---|---|---|---|---|---|
| `update_order_promise_date` | `sales_rep`, `sales_director` | true | `orderNo`, `newDate`, `reason` (全 required) | `将把 {orderNo} 承诺交期从 {旧日期} 改为 {newDate}，原因：{reason}` | 先在 `scopeOrders` 里校验有权访问，否则 `{found:false}`；再 `ctx.mutate` |
| `reserve_inventory` | `supply_chain` | true | `orderNo`, `sku`, `qty` (全 required) | `将为 {orderNo} 锁定 {sku} × {qty} 台` | 校验 `available >= qty`，不足返回 `{found:false, reason}` |

注意 `create_purchase_order` 与 `create_followup_task` 已分别在 `erp.ts` 与 `crm.ts` 中，本文件只放这 2 个。全项目写工具共 4 个，与 spec §6.4 一致。

- [ ] **Step 3.5: 写 `src/agent/registry.ts`**

```ts
import type { ToolDef, Role, ToolContext, AuditEntry } from '../lib/types'
import { crmTools } from './tools/crm'
import { erpTools } from './tools/erp'
import { analyticsTools } from './tools/analytics'
import { writeTools } from './tools/write'

export const ALL_TOOLS: ToolDef[] = [...crmTools, ...erpTools, ...analyticsTools, ...writeTools]

/** 权限第一层：未授权工具根本不会进入发给 LLM 的 tools 数组。 */
export function toolsFor(role: Role): ToolDef[] {
  return ALL_TOOLS.filter(t => t.allowedRoles.includes(role))
}

export function toolSchemasFor(role: Role) {
  return toolsFor(role).map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

export function toolCatalogText(role: Role): string {
  return toolsFor(role).map(t => `- ${t.name}: ${t.description}`).join('\n')
}

export interface ExecResult { ok: boolean; result: unknown; ms: number }

/** 权限第二层：执行前再查一次角色，防止 LLM 幻觉出一个它没有的工具名。 */
export function executeTool(name: string, args: any, ctx: ToolContext): ExecResult {
  const t0 = performance.now()
  const tool = ALL_TOOLS.find(t => t.name === name)
  if (!tool) {
    return { ok: false, ms: 0, result: { error: `不存在名为 ${name} 的工具` } }
  }
  if (!tool.allowedRoles.includes(ctx.role)) {
    return { ok: false, ms: 0, result: {
      error: 'PERMISSION_DENIED',
      reason: `当前角色无权调用 ${name}`,
      allowedRoles: tool.allowedRoles,
    } }
  }
  try {
    const result = tool.run(args ?? {}, ctx)
    return { ok: true, result, ms: Math.round(performance.now() - t0) }
  } catch (e) {
    return { ok: false, result: { error: String(e) }, ms: Math.round(performance.now() - t0) }
  }
}

export function auditOf(name: string, args: unknown, r: ExecResult, ctx: ToolContext): AuditEntry {
  return {
    id: `AU-${Date.now()}-${Math.round(Math.random() * 1e4)}`,
    at: new Date().toISOString(), role: ctx.role, userId: ctx.user.id,
    tool: name, args, ok: r.ok, ms: r.ms,
    summary: r.ok ? JSON.stringify(r.result).slice(0, 160) : String((r.result as any)?.error),
  }
}
```

- [ ] **Step 3.6: 写 `src/agent/registry.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { generateSeed } from '../lib/seed'
import { ALL_TOOLS, toolsFor, executeTool } from './registry'
import type { ToolContext, Role } from '../lib/types'

const db = generateSeed(42)
const ctxFor = (name: string): ToolContext => {
  const user = db.users.find(u => u.name === name)!
  return { user, role: user.role, db, mutate: () => {} }
}

describe('工具注册表', () => {
  it('共 15 个工具，其中 4 个写工具', () => {
    expect(ALL_TOOLS.length).toBe(15)
    expect(ALL_TOOLS.filter(t => t.isWrite).length).toBe(4)
  })
  it('工具名唯一', () => {
    expect(new Set(ALL_TOOLS.map(t => t.name)).size).toBe(15)
  })
  it('每个工具都声明了至少一个角色', () => {
    expect(ALL_TOOLS.every(t => t.allowedRoles.length > 0)).toBe(true)
  })
})

describe('权限第一层：工具可见性', () => {
  it('销售代表可用工具明显少于 CEO', () => {
    expect(toolsFor('sales_rep').length).toBeLessThan(toolsFor('ceo').length)
  })
  it('销售代表拿不到 aggregate_metrics', () => {
    expect(toolsFor('sales_rep').map(t => t.name)).not.toContain('aggregate_metrics')
  })
  it('CEO 拿不到任何写工具', () => {
    expect(toolsFor('ceo').some(t => t.isWrite)).toBe(false)
  })
  it('供应链主管拿不到客户与商机工具', () => {
    const names = toolsFor('supply_chain').map(t => t.name)
    expect(names).not.toContain('query_customers')
    expect(names).not.toContain('query_opportunities')
  })
})

describe('权限第二层：执行拦截', () => {
  it('绕过工具列表直接调用也会被拒', () => {
    const r = executeTool('aggregate_metrics', { metric: 'top_customers' }, ctxFor('张伟'))
    expect(r.ok).toBe(false)
    expect((r.result as any).error).toBe('PERMISSION_DENIED')
  })
  it('不存在的工具名返回错误而非抛异常', () => {
    expect(executeTool('drop_database', {}, ctxFor('陈立')).ok).toBe(false)
  })
})

describe('演示剧本 C：同一问题不同角色不同答案', () => {
  it('张伟查客户只拿到自己的 9 个，最大 86 万', () => {
    const r: any = executeTool('query_customers', { sortByRevenue: true }, ctxFor('张伟')).result
    expect(r.count).toBe(9)
    expect(r.customers[0].annualRevenue).toBe(860000)
  })
  it('CEO 查全公司 TOP 客户，榜首 520 万', () => {
    const r: any = executeTool('aggregate_metrics',
      { metric: 'top_customers', limit: 5 }, ctxFor('陈立')).result
    expect(r.topCustomers[0].annualRevenue).toBe(5200000)
  })
})

describe('演示剧本 A：交期风险', () => {
  it('供应链主管测算出 48 台缺口', () => {
    const r: any = executeTool('simulate_delivery_risk', { withinDays: 7 }, ctxFor('王强')).result
    const gap = r.risks.flatMap((x: any) => x.shortages).reduce((s: number, x: any) => s + x.gap, 0)
    expect(gap).toBe(48)
  })
  it('供应商比选返回锐驰机电交期更短', () => {
    const r: any = executeTool('get_supplier_options', { sku: 'SKU-203' }, ctxFor('王强')).result
    expect(r.suppliers[0].name).toBe('锐驰机电')
    expect(r.suppliers[0].leadTimeDays).toBe(7)
  })
})

describe('空结果不编造', () => {
  it('查不到的客户返回 found:false', () => {
    const r: any = executeTool('get_customer_detail',
      { nameOrId: '不存在的公司' }, ctxFor('陈立')).result
    expect(r.found).toBe(false)
    expect(typeof r.reason).toBe('string')
  })
})
```

跑 `npm test 2>&1 | tail -30`。断言里的字段名（`r.count` / `r.customers` / `r.topCustomers` / `r.risks` / `r.suppliers`）就是各工具返回结构的契约，实现时按这个来。

- [ ] **Step 3.7: 写 `src/agent/prompts.ts`**

```ts
import type { Role, User, Plan } from '../lib/types'
import { TODAY } from '../lib/types'
import { ROLE_META } from '../lib/rbac'
import { toolCatalogText } from './registry'

export function plannerPrompt(user: User): string {
  const m = ROLE_META[user.role]
  return `你是「擎源工业设备」企业运营智能助手 OrbitOS 的规划器。

当前用户：${user.name}（${m.label}）
权限说明：${m.description}
当前日期：${TODAY}

你可以使用的工具（列表之外的工具不存在，不要规划任何依赖它们的步骤）：
${toolCatalogText(user.role)}

任务：把用户的问题拆解成 2 到 6 个可执行步骤。
规则：
1. 每个步骤必须能由上面列出的至少一个工具完成。
2. 如果用户的问题超出当前角色权限，输出空的 steps 数组，并在 goal 里说明原因和哪个角色可以做。
3. 任何会写入数据的步骤，把 needsWrite 置为 true。
4. 步骤要具体，不要写「分析数据」这种空话。

只输出 JSON，不要任何解释、不要 markdown 代码块：
{"goal":"一句话目标","steps":[{"id":"s1","title":"具体步骤","expectedTools":["tool_name"]}],"needsWrite":false}`
}

export function executorPrompt(user: User, plan: Plan): string {
  const m = ROLE_META[user.role]
  return `你是「擎源工业设备」企业运营智能助手 OrbitOS。

当前用户：${user.name}（${m.label}）
权限说明：${m.description}
当前日期：${TODAY}

本次执行计划：
${plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}

严格规则：
1. 【禁止编造】回答中出现的每一个数字、单号、客户名、日期，都必须来自工具返回结果。绝不估算、推测或凭常识填充。宁可说"数据不足"也不要编。
2. 【必须溯源】结论中引用具体记录时用双方括号标注，例如 [[SO-2026-0412]]、[[SKU-203]]、[[PO-2026-0117]]。
3. 【空结果】工具返回 {"found": false} 时，明确告诉用户"未找到相关数据"及原因，不要用其他数据替代。
4. 【权限】工具返回 PERMISSION_DENIED 时，直接说明当前角色无权访问，并指出哪个角色可以，不要绕路猜测。
5. 【写操作】写入类工具会先弹确认卡由用户批准，你正常调用即可。
6. 【计划调整】执行中若发现需要计划外的步骤，先输出一句"需要追加步骤：XXX"，再调用工具。
7. 【效率】能一次查完就不要分多次。不要重复调用同一个工具查同样的东西。

回答格式：先给结论，再给依据，最后给 1 到 2 条可执行建议。简洁，不要客套话，不要复述计划。`
}
```

- [ ] **Step 3.8: 写 `src/agent/llm.ts`**

```ts
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export interface ChatOptions {
  messages: ChatMessage[]
  tools?: unknown[]
  jsonMode?: boolean
  temperature?: number
}

export class LlmUnavailable extends Error {}

export async function chat(opts: ChatOptions): Promise<ChatMessage> {
  const body: Record<string, unknown> = {
    model: 'glm-4.5-flash',
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
  }
  if (opts.tools?.length) { body.tools = opts.tools; body.tool_choice = 'auto' }
  if (opts.jsonMode) body.response_format = { type: 'json_object' }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 45000)
  try {
    const r = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctl.signal,
    })
    if (!r.ok) throw new LlmUnavailable(`HTTP ${r.status}`)
    const j = await r.json()
    const msg = j?.choices?.[0]?.message
    if (!msg) throw new LlmUnavailable('响应缺少 choices')
    return msg as ChatMessage
  } catch (e) {
    throw e instanceof LlmUnavailable ? e : new LlmUnavailable(String(e))
  } finally {
    clearTimeout(timer)
  }
}

/** 从可能带 markdown 围栏的文本里抠出 JSON。GLM 偶尔不听话。 */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
  if (s < 0 || e < 0) throw new Error('无法从响应中解析 JSON')
  return JSON.parse(raw.slice(s, e + 1)) as T
}
```

- [ ] **Step 3.9: 写 `src/agent/loop.ts`**

这是全项目的核心。Planner → Executor → Reflect，全程通过 `emit` 推 `AgentEvent`，UI 不感知 LLM 细节。

```ts
import type { AgentEvent, Plan, ToolContext, User, Mutation, PlanStep } from '../lib/types'
import { chat, extractJson, LlmUnavailable, type ChatMessage } from './llm'
import { plannerPrompt, executorPrompt } from './prompts'
import { toolSchemasFor, executeTool, auditOf, ALL_TOOLS } from './registry'
import type { DbSnapshot, AuditEntry } from '../lib/types'

export interface RunAgentOptions {
  question: string
  user: User
  getDb: () => DbSnapshot                 // 每次工具执行都重新取，保证写入后的读能看到新值
  mutate: (m: Mutation) => void
  emit: (e: AgentEvent) => void
  pushAudit: (e: AuditEntry) => void
  /** 返回 true 表示用户批准。UI 负责弹卡并 resolve。 */
  requestConfirm: (id: string, toolName: string, args: unknown, summary: string) => Promise<boolean>
}

const MAX_TURNS = 12

export async function runAgent(o: RunAgentOptions): Promise<void> {
  const ctx = (): ToolContext =>
    ({ user: o.user, role: o.user.role, db: o.getDb(), mutate: o.mutate })

  // ---------- Phase 1: Planner ----------
  let plan: Plan
  try {
    const res = await chat({
      jsonMode: true,
      messages: [
        { role: 'system', content: plannerPrompt(o.user) },
        { role: 'user', content: o.question },
      ],
    })
    plan = extractJson<Plan>(res.content ?? '{}')
    if (!Array.isArray(plan.steps)) plan.steps = []
    plan.steps = plan.steps.map((s, i) => ({ ...s, id: s.id || `s${i + 1}` }))
  } catch (e) {
    o.emit({ type: 'error', message: e instanceof LlmUnavailable
      ? 'LLM 服务不可用，已切换录播模式' : `规划失败：${String(e)}` })
    throw e
  }
  o.emit({ type: 'plan', plan })

  if (!plan.steps.length) {
    o.emit({ type: 'final', text: plan.goal || '当前角色无权处理该请求。', refs: [] })
    return
  }

  // ---------- Phase 2: Executor ----------
  const messages: ChatMessage[] = [
    { role: 'system', content: executorPrompt(o.user, plan) },
    { role: 'user', content: o.question },
  ]
  const tools = toolSchemasFor(o.user.role)
  let stepIdx = 0
  o.emit({ type: 'step_start', stepId: plan.steps[0].id })

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let res: ChatMessage
    try {
      res = await chat({ messages, tools })
    } catch (e) {
      o.emit({ type: 'error', message: `执行中断：${String(e)}` })
      throw e
    }
    messages.push(res)

    // 动态重规划：模型在正文里声明要追加步骤
    const amend = res.content?.match(/需要追加步骤[：:]\s*(.+)/)
    if (amend) {
      const added: PlanStep[] = [{
        id: `s${plan.steps.length + 1}`, title: amend[1].trim().slice(0, 60), expectedTools: [],
      }]
      plan.steps.push(...added)
      o.emit({ type: 'plan_amended', addedSteps: added, reason: amend[1].trim() })
    }

    const calls = res.tool_calls ?? []
    if (!calls.length) {
      // 没有工具调用 = 收尾
      for (let i = stepIdx; i < plan.steps.length; i++) {
        o.emit({ type: 'step_done', stepId: plan.steps[i].id })
      }
      const text = res.content ?? ''
      const refs = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1])
      o.emit({ type: 'final', text, refs: [...new Set(refs)] })
      return
    }

    for (const call of calls) {
      const name = call.function.name
      let args: any = {}
      try { args = JSON.parse(call.function.arguments || '{}') } catch { /* 容忍空参 */ }
      o.emit({ type: 'tool_call', id: call.id, name, args })

      const def = ALL_TOOLS.find(t => t.name === name)

      // ---------- Phase 3: HITL ----------
      if (def?.isWrite) {
        const summary = def.confirmSummary?.(args, ctx()) ?? `将执行写操作 ${name}`
        o.emit({ type: 'confirm_request', id: call.id, toolName: name, args, summary })
        const approved = await o.requestConfirm(call.id, name, args, summary)
        o.emit({ type: 'confirm_resolved', id: call.id, approved })
        if (!approved) {
          const denial = { rejected: true, reason: '用户拒绝了该写操作，请据此调整建议，不要重复尝试。' }
          o.emit({ type: 'tool_result', id: call.id, result: denial, ms: 0 })
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(denial) })
          continue
        }
      }

      const r = executeTool(name, args, ctx())
      o.pushAudit(auditOf(name, args, r, ctx()))
      o.emit({ type: 'tool_result', id: call.id, result: r.result, ms: r.ms })
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(r.result) })
    }

    if (stepIdx < plan.steps.length) {
      o.emit({ type: 'step_done', stepId: plan.steps[stepIdx].id })
      stepIdx++
      if (stepIdx < plan.steps.length) {
        o.emit({ type: 'step_start', stepId: plan.steps[stepIdx].id })
      }
    }
  }

  o.emit({ type: 'error', message: `已达最大执行轮数 ${MAX_TURNS}，任务未完成。` })
}
```

- [ ] **Step 3.10: 浏览器控制台冒烟测试**

在 `src/main.tsx` 临时挂一个全局调试入口：

```ts
// 临时调试，P4 完成后删除
import { runAgent } from './agent/loop'
import { useStore } from './lib/store'
;(window as any).__agent = (q: string) => runAgent({
  question: q,
  user: useStore.getState().currentUser,
  getDb: () => useStore.getState().db,
  mutate: useStore.getState().applyMutation,
  emit: (e) => console.log('[EVENT]', e.type, e),
  pushAudit: useStore.getState().pushAudit,
  requestConfirm: async (_i, _n, _a, s) => confirm(s),
})
```

`npm run dev` 后在控制台跑：

```js
__agent('下周要交付的订单有风险吗？帮我排查并给出处理方案。')
```

期望：先打印一条 `plan` 事件（steps 有 3-5 条），随后若干 `tool_call` / `tool_result`，最后一条 `final`。

⚠️ 常见问题：
- GLM 把 JSON 包在 markdown 围栏里 → `extractJson` 已处理
- `tool_calls` 的 `arguments` 是空字符串 → 已容错
- 模型一轮返回多个 tool_call → 已循环处理
- **本地 `npm run dev` 不会跑 Pages Function**，`/api/chat` 会 404。用 `npx wrangler pages dev -- npm run dev` 或直接推到线上测。这一条务必先确认。

- [ ] **Step 3.11: 提交并更新 STATE.md**

```markdown
## P3 完成 (2026-09-02)
- ALL_TOOLS 15 个（写 4 个）；toolsFor(role) / toolSchemasFor(role) / toolCatalogText(role)
- executeTool(name, args, ctx) → {ok, result, ms}；权限双层拦截，registry.test.ts 已覆盖
- runAgent(opts) 见 RunAgentOptions；UI 只需实现 emit 与 requestConfirm 两个回调
- requestConfirm 返回 Promise<boolean>，未批准时会把 rejected 结果喂回模型
- 工具返回结构契约以 registry.test.ts 的断言为准（count/customers/topCustomers/risks/suppliers）
- ⚠️ 坑：本地 npm run dev 不跑 Pages Function，/api/chat 404。需 npx wrangler pages dev
- ⚠️ 坑：（填写 GLM 实际表现，例如是否听话输出纯 JSON）
```

```bash
npm test 2>&1 | tail -5
git add -A && git commit -m "feat: Agent 内核、工具注册表与权限中间件" && git push
```

---

# Task 4（P4）：Sidekick 界面

**预计 90 分钟。这一期决定演示的观感。**

**Files:**
- Create: `src/sidekick/{Sidekick,PlanChecklist,ToolCallCard,ConfirmCard,FinalAnswer}.tsx`
- Create: `src/components/RefChip.tsx`
- Create: `src/agent/replay.ts`
- Modify: `src/App.tsx`（把 `<Sidekick />` 传给 AppShell）、`src/main.tsx`（删掉调试入口）

**只读文件：** `STATE.md`、`src/lib/types.ts`（只看 `AgentEvent` / `Plan` 部分）、`src/components/AppShell.tsx`

**Interfaces:**
- Consumes：`runAgent(opts)` / `AgentEvent` 十种类型 / `useStore()`（签名见 P3 与 P1 交接）
- Produces：`<Sidekick />` 自包含组件，通过 `useStore` 取当前角色，无需外部 props

---

- [ ] **Step 4.1: 写 `RefChip`（引用溯源）**

```tsx
// src/components/RefChip.tsx
import { useNavigate } from 'react-router-dom'

const ROUTE: [RegExp, string][] = [
  [/^SO-/, '/orders'], [/^PO-/, '/purchases'], [/^SKU-/, '/inventory'],
  [/^C-|^客户/, '/customers'], [/^OPP-/, '/opportunities'], [/^AR-/, '/receivables'],
]

export function RefChip({ id }: { id: string }) {
  const nav = useNavigate()
  const to = ROUTE.find(([re]) => re.test(id))?.[1]
  return (
    <button
      onClick={() => to && nav(to)}
      title={to ? `跳转到 ${to} 查看来源记录` : '来源记录'}
      className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-brand/10 text-brand
                 text-xs font-mono hover:bg-brand/20 align-baseline">
      {id}
    </button>
  )
}

/** 把 [[XXX]] 渲染成可点击 chip。未被标注的数字保持原样。 */
export function renderWithRefs(text: string) {
  return text.split(/(\[\[[^\]]+\]\])/g).map((seg, i) => {
    const m = seg.match(/^\[\[([^\]]+)\]\]$/)
    return m ? <RefChip key={i} id={m[1]} /> : <span key={i}>{seg}</span>
  })
}
```

- [ ] **Step 4.2: 写 `PlanChecklist`**

```tsx
// src/sidekick/PlanChecklist.tsx
import type { Plan } from '../lib/types'

export type StepState = 'pending' | 'running' | 'done'

export function PlanChecklist(
  { plan, states, amendedIds }: { plan: Plan; states: Record<string, StepState>; amendedIds: Set<string> }
) {
  return (
    <div className="rounded-lg border bg-slate-50 p-3">
      <div className="text-xs font-medium text-slate-500 mb-2">执行计划</div>
      <div className="text-sm font-medium mb-2.5">{plan.goal}</div>
      <ol className="space-y-1.5">
        {plan.steps.map(s => {
          const st = states[s.id] ?? 'pending'
          return (
            <li key={s.id}
                className={`flex items-start gap-2 text-sm transition-colors ${
                  amendedIds.has(s.id) ? 'bg-warn/15 -mx-1 px-1 rounded' : ''}`}>
              <span className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${
                st === 'done' ? 'bg-ok border-ok text-white'
                : st === 'running' ? 'border-brand text-brand animate-pulse'
                : 'border-slate-300 text-transparent'}`}>
                {st === 'done' ? '✓' : st === 'running' ? '●' : '·'}
              </span>
              <span className={st === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'}>
                {s.title}
                {amendedIds.has(s.id) && <span className="ml-1 text-warn text-xs">新增</span>}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
```

- [ ] **Step 4.3: 写 `ToolCallCard`**

默认折叠，点击展开入参与出参。展开态是面试时"给我看看它到底查了什么"的答案。

```tsx
// src/sidekick/ToolCallCard.tsx
import { useState } from 'react'

export function ToolCallCard(
  { name, args, result, ms }: { name: string; args: unknown; result?: unknown; ms?: number }
) {
  const [open, setOpen] = useState(false)
  const pending = result === undefined
  const denied = (result as any)?.error === 'PERMISSION_DENIED'
  const notFound = (result as any)?.found === false
  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          pending ? 'bg-warn animate-pulse' : denied ? 'bg-danger' : notFound ? 'bg-idle' : 'bg-ok'}`} />
        <code className="text-xs font-mono text-slate-700 flex-1 truncate">{name}</code>
        {ms !== undefined && <span className="text-[10px] text-slate-400">{ms}ms</span>}
        <span className="text-slate-300 text-xs">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="border-t bg-slate-50 p-2.5 space-y-2 text-[11px] font-mono">
          <div>
            <div className="text-slate-400 mb-0.5">入参</div>
            <pre className="whitespace-pre-wrap break-all text-slate-600">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
          {!pending && (
            <div>
              <div className="text-slate-400 mb-0.5">出参</div>
              <pre className="whitespace-pre-wrap break-all text-slate-600 max-h-56 overflow-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4.4: 写 `ConfirmCard`（HITL）**

```tsx
// src/sidekick/ConfirmCard.tsx
export function ConfirmCard(
  { summary, toolName, resolved, onDecide }:
  { summary: string; toolName: string; resolved?: boolean; onDecide: (ok: boolean) => void }
) {
  return (
    <div className={`rounded-lg border-2 p-3 ${
      resolved === undefined ? 'border-warn bg-warn/5'
      : resolved ? 'border-ok bg-ok/5' : 'border-idle bg-slate-50'}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-warn">需要你确认</span>
        <code className="text-[10px] font-mono text-slate-400">{toolName}</code>
      </div>
      <div className="text-sm text-slate-700 leading-relaxed mb-3">{summary}</div>
      {resolved === undefined ? (
        <div className="flex gap-2">
          <button onClick={() => onDecide(true)}
            className="px-3 py-1.5 rounded bg-brand text-white text-sm hover:bg-brand-dark">
            批准执行
          </button>
          <button onClick={() => onDecide(false)}
            className="px-3 py-1.5 rounded border text-sm text-slate-600 hover:bg-slate-50">
            拒绝
          </button>
        </div>
      ) : (
        <div className={`text-xs ${resolved ? 'text-ok' : 'text-slate-400'}`}>
          {resolved ? '✓ 已批准并执行' : '已拒绝，Agent 将调整建议'}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4.5: 写 `FinalAnswer`**

```tsx
// src/sidekick/FinalAnswer.tsx
import { renderWithRefs } from '../components/RefChip'

export function FinalAnswer({ text, refs }: { text: string; refs: string[] }) {
  return (
    <div className="rounded-lg border-l-[3px] border-l-brand bg-white border p-3">
      <div className="text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
        {renderWithRefs(text)}
      </div>
      {refs.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t text-[11px] text-slate-400">
          本结论引用了 {refs.length} 条记录，点击标签可跳转核对
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4.6: 写 `replay.ts`（断网兜底）**

导出 `REPLAY: Record<string, {delay:number; event:AgentEvent}[]>`，键为场景标识 `'delivery'` 与 `'permission'`。

内容按剧本 A 与 C 的真实事件序列手写：`plan` → `step_start` → `tool_call` → `tool_result` → … → `confirm_request` → `final`。每条给 300–1200ms 的 `delay`，让回放有真实节奏感。

`tool_result` 的数据直接从 `generateSeed(42)` 的真实结果里抄——录播模式里的数字必须和真实模式完全一致，否则现场切换会穿帮。

导出：

```ts
export async function runReplay(
  scenario: 'delivery' | 'permission',
  emit: (e: AgentEvent) => void,
  requestConfirm: (id: string, n: string, a: unknown, s: string) => Promise<boolean>,
): Promise<void>
```

实现：按序 `await sleep(delay)` 后 `emit`；遇到 `confirm_request` 类型时先 emit 再 `await requestConfirm(...)`，拿到结果后 emit `confirm_resolved`，并在批准时调 `useStore.getState().applyMutation(...)` 把采购单真的写进去——**因果联动在录播模式下也必须成立**，否则看板不会变，演示高潮没了。

场景选择规则：问题里含「风险」「交期」「延期」→ `delivery`；含「最大」「客户」「排名」→ `permission`；其余取 `delivery`。

- [ ] **Step 4.7: 写 `Sidekick.tsx`（把上面全部串起来）**

```tsx
// src/sidekick/Sidekick.tsx
import { useRef, useState } from 'react'
import type { AgentEvent, Plan } from '../lib/types'
import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'
import { toolsFor } from '../agent/registry'
import { runAgent } from '../agent/loop'
import { runReplay } from '../agent/replay'
import { PlanChecklist, type StepState } from './PlanChecklist'
import { ToolCallCard } from './ToolCallCard'
import { ConfirmCard } from './ConfirmCard'
import { FinalAnswer } from './FinalAnswer'

const PRESETS = [
  '下周要交付的订单有风险吗？帮我排查并给出处理方案。',
  '公司最大的客户是谁？',
  '我这个月的商机漏斗情况怎么样？',
]

type Item =
  | { k: 'user'; text: string }
  | { k: 'plan'; plan: Plan }
  | { k: 'tool'; id: string; name: string; args: unknown; result?: unknown; ms?: number }
  | { k: 'confirm'; id: string; toolName: string; summary: string; resolved?: boolean }
  | { k: 'final'; text: string; refs: string[] }
  | { k: 'error'; text: string }

export function Sidekick() {
  const { currentUser, db, applyMutation, pushAudit } = useStore()
  const [items, setItems] = useState<Item[]>([])
  const [steps, setSteps] = useState<Record<string, StepState>>({})
  const [amended, setAmended] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [replayMode, setReplayMode] = useState(false)
  const [input, setInput] = useState('')
  const pending = useRef<Map<string, (ok: boolean) => void>>(new Map())

  const toolCount = toolsFor(currentUser.role).length

  function onEvent(e: AgentEvent) {
    switch (e.type) {
      case 'plan':
        setItems(p => [...p, { k: 'plan', plan: e.plan }])
        setSteps(Object.fromEntries(e.plan.steps.map(s => [s.id, 'pending' as StepState])))
        break
      case 'plan_amended':
        setItems(p => p.map(it => it.k === 'plan'
          ? { ...it, plan: { ...it.plan, steps: [...it.plan.steps, ...e.addedSteps] } } : it))
        setAmended(s => new Set([...s, ...e.addedSteps.map(x => x.id)]))
        setSteps(s => ({ ...s, ...Object.fromEntries(e.addedSteps.map(x => [x.id, 'pending' as StepState])) }))
        break
      case 'step_start': setSteps(s => ({ ...s, [e.stepId]: 'running' })); break
      case 'step_done':  setSteps(s => ({ ...s, [e.stepId]: 'done' })); break
      case 'tool_call':
        setItems(p => [...p, { k: 'tool', id: e.id, name: e.name, args: e.args }]); break
      case 'tool_result':
        setItems(p => p.map(it => it.k === 'tool' && it.id === e.id
          ? { ...it, result: e.result, ms: e.ms } : it)); break
      case 'confirm_request':
        setItems(p => [...p, { k: 'confirm', id: e.id, toolName: e.toolName, summary: e.summary }]); break
      case 'confirm_resolved':
        setItems(p => p.map(it => it.k === 'confirm' && it.id === e.id
          ? { ...it, resolved: e.approved } : it)); break
      case 'final':
        setItems(p => [...p, { k: 'final', text: e.text, refs: e.refs }]); break
      case 'error':
        setItems(p => [...p, { k: 'error', text: e.message }]); break
    }
  }

  const requestConfirm = (id: string) =>
    new Promise<boolean>(res => { pending.current.set(id, res) })

  async function ask(q: string) {
    if (busy || !q.trim()) return
    setBusy(true); setInput('')
    setItems(p => [...p, { k: 'user', text: q }])
    const confirmFn = (id: string) => requestConfirm(id)
    try {
      await runAgent({
        question: q, user: currentUser,
        getDb: () => useStore.getState().db,
        mutate: applyMutation, emit: onEvent, pushAudit,
        requestConfirm: (id) => confirmFn(id),
      })
    } catch {
      setReplayMode(true)
      const scene = /风险|交期|延期|发货/.test(q) ? 'delivery' : 'permission'
      await runReplay(scene, onEvent, (id) => confirmFn(id))
    } finally {
      setBusy(false)
    }
  }

  function decide(id: string, ok: boolean) {
    pending.current.get(id)?.(ok)
    pending.current.delete(id)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b">
        <div className="flex items-center justify-between">
          <div className="font-medium text-sm">AI Sidekick</div>
          {replayMode && <span className="text-[10px] px-1.5 py-0.5 rounded bg-warn/20 text-warn">录播模式</span>}
        </div>
        <div className="text-xs text-slate-400 mt-0.5">
          {currentUser.name} · {ROLE_META[currentUser.role].label} · 可用工具 {toolCount} 个
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2.5">
        {!items.length && (
          <div className="text-sm text-slate-400 p-4 leading-relaxed">
            问我关于客户、商机、订单、库存、采购的任何问题。<br />
            我会先列出执行计划，再逐步调用工具，涉及数据变更时会先请你确认。
          </div>
        )}
        {items.map((it, i) => {
          switch (it.k) {
            case 'user':  return <div key={i} className="text-sm bg-brand text-white rounded-lg px-3 py-2 ml-8">{it.text}</div>
            case 'plan':  return <PlanChecklist key={i} plan={it.plan} states={steps} amendedIds={amended} />
            case 'tool':  return <ToolCallCard key={i} {...it} />
            case 'confirm': return <ConfirmCard key={i} {...it} onDecide={ok => decide(it.id, ok)} />
            case 'final': return <FinalAnswer key={i} text={it.text} refs={it.refs} />
            case 'error': return <div key={i} className="text-xs text-danger bg-danger/5 rounded p-2">{it.text}</div>
          }
        })}
      </div>

      <div className="border-t p-3 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(p => (
            <button key={p} onClick={() => ask(p)} disabled={busy}
              className="text-[11px] px-2 py-1 rounded-full border text-slate-500
                         hover:border-brand hover:text-brand disabled:opacity-40">
              {p.length > 16 ? p.slice(0, 16) + '…' : p}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && ask(input)}
            placeholder={busy ? '执行中…' : '问点什么…'} disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none focus:border-brand" />
          <button onClick={() => ask(input)} disabled={busy}
            className="px-3 py-2 rounded-lg bg-brand text-white text-sm disabled:opacity-40">发送</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4.8: 挂进 AppShell 并清理调试代码**

`src/App.tsx` 把 `<AppShell>` 改为 `<AppShell sidekick={<Sidekick />}>`。
删掉 Step 3.10 在 `main.tsx` 里加的 `window.__agent` 调试入口。

- [ ] **Step 4.9: 浏览器验收清单**

用 `npx wrangler pages dev -- npm run dev`（本地才有 `/api/chat`），逐条核对：

1. 切「供应链主管」→ 点第一个预设问题 → 先出计划清单（3-5 步）
2. 计划项逐个变成 ✓，工具卡逐个出现
3. 展开任一工具卡能看到 JSON 入参与出参，有耗时毫秒数
4. 出现确认卡，文案写明"将向【锐驰机电】采购…"，点「批准执行」
5. 最终结论里出现蓝色的 `SO-2026-0412` 之类 chip，点击跳转到订单页
6. 切「销售代表」→ 顶部工具计数变化（按当前注册表：销售代表 9、销售总监 12、供应链主管 8、CEO 11；以实际渲染为准并记进演示脚本）→ 问"公司最大的客户是谁" → 被拒绝并给出自己名下最大客户
7. 断开网络重试 → 自动进录播模式，右上角出现角标，流程依然完整

- [ ] **Step 4.10: 提交并更新 STATE.md**

```markdown
## P4 完成 (2026-09-02)
- <Sidekick /> 自包含，App.tsx 通过 <AppShell sidekick={<Sidekick/>}> 挂载
- renderWithRefs(text) 把 [[XXX]] 渲染成可跳转 chip，路由映射在 RefChip.tsx 的 ROUTE 表
- replay.ts 的 runReplay(scenario, emit, requestConfirm) 用于断网兜底，数据与真实模式一致
- ⚠️ 坑：本地必须用 npx wrangler pages dev 才有 /api/chat
- ⚠️ 坑：（填写 GLM 实际的计划质量、是否稳定输出 [[]] 标注）
```

```bash
npm run build 2>&1 | tail -20
git add -A && git commit -m "feat: AI Sidekick 界面与录播兜底" && git push
```

---

# Task 5（P5）：仪表盘与实时看板

**预计 60 分钟。裁剪优先级最高的一期——时间紧就砍 Step 5.4。**

**Files:**
- Modify: `src/pages/Dashboard.tsx`（替换占位）
- Modify: `src/lib/store.ts`（加 tick）

**只读文件：** `STATE.md`、`src/lib/risk.ts`、`src/lib/format.ts`、`src/components/StatusChip.tsx`

**Interfaces:**
- Consumes：`buildRiskCards(db, user): RiskCard[]`，`RiskCard = {id, severity, title, detail, question}`

---

- [ ] **Step 5.1: 风险卡片区（Agent 主动性，最高优先级）**

`Dashboard.tsx` 顶部渲染 `buildRiskCards(db, currentUser)`。每张卡：左侧色条（high=danger / medium=warn）、标题、明细、右侧「让 Agent 排查 →」按钮。

点击按钮要把 `card.question` 灌进 Sidekick 并直接开跑。用一个极简的全局事件总线实现，避免为此改动组件树：

```ts
// src/lib/bus.ts
type Handler = (q: string) => void
let handler: Handler | null = null
export const askAgent = (q: string) => handler?.(q)
export const onAskAgent = (h: Handler) => { handler = h; return () => { handler = null } }
```

在 `Sidekick.tsx` 里 `useEffect(() => onAskAgent(ask), [currentUser])`。

- [ ] **Step 5.2: KPI 卡 × 4**

按当前角色计算，全部走 `scope*`：

| 卡片 | 口径 |
|---|---|
| 本月营收 | `scopeOrders` 中已发货+已完成的 `totalAmount` 合计（supply_chain 显示 `***`） |
| 待发货订单 | `scopeOrders` 中状态为待发货的条数 |
| 库存告警 SKU | `db.inventory` 中 `available < safetyStock` 的条数 |
| 逾期应收 | `db.receivables` 中已逾期的金额合计（仅 director/ceo，其余显示 `—`） |

样式：白底圆角卡，大号数字 + 小号标题 + 一行同比说明。数字用 `money()` 格式化。

- [ ] **Step 5.3: 图表 × 3（Recharts）**

| 图表 | 类型 | 数据 |
|---|---|---|
| 销售漏斗 | `BarChart` 横向 | `scopeOpportunities` 按 stage 分组金额合计，按阶段顺序排列 |
| 订单状态分布 | `PieChart` | `scopeOrders` 按 status 分组计数，配色用 `StatusChip` 的 ORDER_TONE 同色系 |
| 近 12 周发货趋势 | `LineChart` | `scopeOrders` 按 `promisedDeliveryDate` 所在周分组计数 |

统一包一层 `<ResponsiveContainer width="100%" height={220}>`。

**时间不够时只保留销售漏斗。**

- [ ] **Step 5.4: 实时 tick（可裁剪）**

`store.ts` 加：

```ts
tick: () => set(s => {
  const db = structuredClone(s.db)
  // 随机推进一张待发货订单为已发货，或给一笔应收回款
  const cand = db.orders.filter(o => o.status === '待发货' && !o.id.startsWith('SO-P'))
  if (cand.length && Math.random() < 0.6) {
    cand[Math.floor(Math.random() * cand.length)].status = '已发货'
  } else {
    const ar = db.receivables.find(r => r.status === '未到期')
    if (ar) { ar.status = '已回款'; ar.paidAmount = ar.amount }
  }
  return { db }
}),
```

⚠️ **必须排除 `SO-P*` 开头的埋雷订单**——它们被自动推进就没风险可演了。

`Dashboard.tsx` 里 `useEffect` 起 `setInterval(tick, 4000)`，卸载时清除。KPI 数字加 `transition-all duration-500` 让变化平滑。

- [ ] **Step 5.5: 验收**

1. 切「供应链主管」→ 首页有红色交期风险卡，明细写着 SKU-203 缺口 48 台
2. 点「让 Agent 排查 →」→ 右侧 Sidekick 自动开始执行
3. 走完流程批准采购单后 → **风险卡消失，库存告警 KPI 减 1**（这是演示的高潮，必须验证）
4. 切「CEO」→ 多一张应收逾期卡；切「销售代表」→ 风险卡内容变少或消失
5. 静置 20 秒，KPI 数字有平滑变化
6. 点「重置演示数据」→ 风险卡回来

- [ ] **Step 5.6: 提交并更新 STATE.md**

```markdown
## P5 完成 (2026-09-02)
- Dashboard: 风险卡 + KPI×4 + 图表×3 + 4 秒 tick
- src/lib/bus.ts: askAgent(q) / onAskAgent(h)，风险卡点击驱动 Sidekick
- ⚠️ 坑：tick 必须排除 SO-P* 埋雷订单，否则风险自己就消失了
- ⚠️ 坑：（填写）
```

```bash
git add -A && git commit -m "feat: 实时 BI 看板与主动风险卡" && git push
```

---

# Task 6（P6）：文档

**预计 40 分钟。对 AI PM 岗位，这一期的性价比高于任何代码。**

**Files:**
- Create: `README.md` `docs/PRD.md` `docs/agent-design.md` `docs/demo-script.md`

**只读文件：** `STATE.md`、`docs/superpowers/specs/2026-09-02-orbitos-design.md`

---

- [ ] **Step 6.1: `README.md`**

内容：一句话介绍 → 在线地址 → 3 张截图（仪表盘含风险卡 / Sidekick 执行中的计划清单与工具卡 / 确认卡）→ 核心特性 5 条 → 技术架构图（ASCII）→ 本地运行 → 部署说明 → 文档索引。

截图用浏览器截图后放 `docs/img/`。

- [ ] **Step 6.2: `docs/PRD.md`**

按下列小节写，每节 100–200 字：

1. **问题定义**——B2B 分销商的部门墙：销售承诺交期时看不到库存与在途，供应链知道缺货时订单已签。
2. **目标用户与场景**——四个角色各一段：他是谁、什么时候会打开这个系统、他要做什么决定。
3. **功能范围**——做什么、明确不做什么（抄 spec §2 的非目标，这一节能体现你会做减法）。
4. **核心流程**——剧本 A 的用户旅程，逐步骤写。
5. **权限模型**——四角色矩阵表，并说明为什么 CEO 没有写权限。
6. **成功指标**——把 demo 的能力翻译成可衡量的业务指标：交期风险发现提前期（天）、缺货导致的延期订单率、Agent 建议采纳率、单次问询平均工具调用数、人工确认拒绝率（拒绝率高说明建议质量差）。
7. **迭代规划**——V2 做什么：真实 ERP 系统对接、Agent 记忆、多 Agent 分工、审批流引擎。

- [ ] **Step 6.3: `docs/agent-design.md`（面试主要加分项，写扎实）**

必须覆盖这七节：

1. **为什么选 Planner–Executor 而不是纯 ReAct**——纯 ReAct 的规划隐式，用户无法预期也无法中断；显式计划让用户在第一秒就知道 Agent 要干什么，代价是多一轮调用（约 +1.2s）。附实际延迟数据。
2. **工具边界怎么切**——三条原则：①一个工具对应一个业务问题，不做万能查询接口；②确定性计算（`simulate_delivery_risk`）不交给 LLM，LLM 只决定何时调用；③工具粒度过细会导致调用轮数暴涨，过粗会让 LLM 无法组合。举 `simulate_delivery_risk` 为例说明为什么它不该拆成三个工具。
3. **权限为什么放在工具层**——如果只做 UI 隐藏或 prompt 约束，模型可以被绕过；放在 `toolsFor(role)` 与 `executeTool` 双层，未授权工具在物理上不可达。附 `registry.test.ts` 里"绕过工具列表直接调用也会被拒"那条测试。
4. **幻觉防护三道防线**——数字溯源 / 写操作 HITL / 空结果显式化。说明每道防线拦的是哪一类幻觉：编造数字 / 越权行动 / 无中生有。
5. **HITL 的产品设计**——为什么只拦写操作不拦读操作（读操作拦截会让体验崩溃且无收益）；确认卡为什么要写具体金额和日期而不是"确认执行吗"；用户拒绝后为什么要把 rejected 结果喂回模型（防止它重复尝试）。
6. **成本与延迟**——单次剧本 A 的实际 token 消耗与耗时（跑一次记录真实数据填进来）；GLM-4.5-Flash 免费额度下的成本估算；如果换 GPT-4 级模型成本会是多少，什么场景值得。
7. **上线后怎么评测**——离线：构造 30 条标注问题的测试集，评工具选择准确率、参数正确率、结论事实一致率；在线：人工确认拒绝率、追问率、任务完成率。说明为什么工具选择准确率比最终答案的人工评分更值得优先监控。

- [ ] **Step 6.4: `docs/demo-script.md`**

逐句台词 + 操作步骤 + 预计耗时，两个剧本各一节。每一步写清：说什么、点哪里、屏幕上会出现什么、如果卡住怎么办。

结尾加一节「面试官可能追问的 8 个问题及回答要点」：
- 数据是真的吗 → 全部虚拟生成，`generateSeed(42)` 确定性可复现
- 幻觉怎么防 → 三道防线
- 权限能被绕过吗 → 工具层双检，有测试
- 为什么要人工确认 → 写操作不可逆，且拒绝率是产品质量信号
- 用了什么模型、多少钱 → GLM-4.5-Flash，免费额度
- 多少个工具、怎么切的 → 15 个，三条切分原则
- 上线后怎么衡量效果 → 离线 + 在线双轨指标
- 这套东西能接真实 ERP 吗 → 工具层是唯一耦合点，换实现不换契约

- [ ] **Step 6.5: 提交**

```bash
git add -A && git commit -m "docs: PRD、Agent 设计说明与演示脚本" && git push
```

---

# Task 7（P7）：端到端演练

**预计 30 分钟。这一期不写新功能，只跑通和修补。**

**只读文件：** `STATE.md`、`docs/demo-script.md`

---

- [ ] **Step 7.1: 线上完整跑剧本 A**

在 `https://orbit-os.pages.dev` 上，按 `demo-script.md` 逐句走一遍，计时。

检查点：
- [ ] 计划清单在 3 秒内出现
- [ ] 工具调用不少于 4 次，且包含 `simulate_delivery_risk` 与 `get_supplier_options`
- [ ] 出现「需要追加步骤」的动态重规划（若模型没触发，调整 `executorPrompt` 第 6 条措辞）
- [ ] 确认卡文案含具体供应商名、数量、金额、ETA
- [ ] 批准后风险卡消失
- [ ] 结论里至少 3 个可点击引用 chip
- [ ] 全程不超过 4 分钟

- [ ] **Step 7.2: 线上完整跑剧本 C**

- [ ] 销售代表被拒绝时给出的是"无权访问"而非编造数据
- [ ] 切 CEO 后同一句话返回全公司 TOP 5，榜首 520 万
- [ ] 顶部工具计数随角色切换而变化（销售代表 9 → CEO 11，以 `toolsFor` 实际输出为准，把真实数字写进 `demo-script.md`，现场别报错数）

- [ ] **Step 7.3: 兜底演练**

浏览器 DevTools → Network → Offline，重跑剧本 A，确认录播模式接管且流程完整、看板依然联动。

- [ ] **Step 7.4: 补测与最终提交**

```bash
npm test 2>&1 | tail -10
npm run build 2>&1 | tail -20
```

把 `agent-design.md` 第 6 节的实际 token 与耗时数据填进去。

```bash
git add -A && git commit -m "chore: 演练修复与实测数据回填" && git push
```

- [ ] **Step 7.5: 最终 STATE.md**

追加一节「演示当天检查清单」：打开链接、确认角色是供应链主管、确认首页有红色风险卡、备好手机热点、备好本地 `npm run dev` 作为终极兜底。

---

## 自查记录

对照 spec 逐节核验：

| Spec 节 | 覆盖任务 |
|---|---|
| §1 目标 / §2 非目标 | Task 6 PRD |
| §3 业务场景 | Task 1 种子数据 |
| §4 角色与权限（双层） | Task 1 rbac + Task 3 registry（含拦截测试） |
| §5 数据模型 + §5.3 埋雷 | Task 1（8 条断言锁定） |
| §6 Agent 架构 / 事件契约 / 工具契约 | Task 3 |
| §6.4 工具注册表 15 个 | Task 3 Steps 3.1–3.4 |
| §7 幻觉防护三道防线 | Task 3（prompts + 空结果 + HITL）、Task 4（引用 chip） |
| §8 界面 | Task 2 + Task 4 |
| §9 实时性（两层） | Task 5 |
| §10 技术栈与部署 | Task 0 |
| §11 降级兜底 | Task 4 Step 4.6 |
| §12 演示剧本 A / C | Task 3 测试 + Task 7 演练 |
| §13 交付物 | Task 6 |
| §14 分期与上下文策略 | 本文件开头「上下文管理协议」 |
| §15 风险 | 分散于各任务的 ⚠️ 提示 |

无遗漏。
