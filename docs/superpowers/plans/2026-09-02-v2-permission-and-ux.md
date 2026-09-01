# OrbitOS V2：权限逻辑修订 + 交互重构

**背景**：用户（本项目作者，将用它面试 AI 产品经理）在完成 V1 验收前提出四点质疑。
第 4 点是对核心设计的挑战，已单独讨论并定向为「保留分级 + 显式边界」。

**四个交付单元**（按用户提出的四点编号，逐项交付、逐项验收）：

| 交付 | 对应用户诉求 | 任务 |
|---|---|---|
| 交付 1 | 第 4 点：权限逻辑有歧义 | T1 权限语义修订、T2 显式边界 |
| 交付 2 | 第 1 点：chatbox 应可收起 / 独立页 | T3 |
| 交付 3 | 第 2 点：左侧导航杂乱、缺筛选 | T4 |
| 交付 4 | 第 3 点：chatbox 应支持新会话与历史回看 | T5 |

**Spec**：`docs/superpowers/specs/2026-09-02-orbitos-design.md`（V1 的 spec，本计划修订其 §4.1 权限模型）

## Global Constraints

- 全部界面文案中文。不引入新依赖。
- `tsconfig` 开启 `noUnusedLocals`，删代码须同步清理 import。
- 无 jsdom / testing-library，测试只能是纯函数级单元测试。
- 数据仍由 `generateSeed(42)` 确定性生成，不引入后端与持久化。
- 每个任务结束时 `npx vitest run` 与 `npm run build` 必须全绿。
- 不 push、不建分支、不改远端。

---

## 问题诊断（为什么要改）

实测当前四角色可见量（seed 42，总量：客户 48 / 商机 90 / 订单 160 / 应收 120）：

| 角色 | 客户 | 商机 | 订单 | 应收 | 写工具 |
|---|---|---|---|---|---|
| 张伟 sales_rep | 9 | 18 | 32 | 0 | 建跟进任务、改承诺交期 |
| 李娜 sales_director | 26 | 50 | 90 | 69 | 建跟进任务、改承诺交期 |
| 王强 supply_chain | **0** | 0 | **160** | 0 | 建采购单、锁库存 |
| 陈立 ceo | 48 | 90 | 160 | 120 | **无** |

两处不自洽：

1. **王强能看全公司 160 张订单，却看不到任何一个客户。** 他知道要发多少货，不知道发给谁，
   无法做分配优先级。这是 V1 把 `scopeCustomers` 对供应链直接返回 `[]` 切得过狠。
2. **CEO 零写权限。** 真实系统里 CEO 通常是超级管理员。硬性只读是演示简化，不是好设计；
   权限设计的目标是减少误操作，不是表达等级。

第三处是体验缺陷而非权限缺陷，也是用户所说「歧义」的真正来源：

3. **静默过滤。** 张伟看到 0 张风险卡时屏幕就是空的，他无从判断是「真没有」还是「我看不到」。
   同一个问题不同角色得到不同数字，读起来像系统不可靠，而不是像系统安全。

---

## T1：权限语义修订

**Files:**
- Modify: `src/lib/rbac.ts`（`scopeCustomers` 供应链分支、新增字段可见性判定、新增越权判定）
- Modify: `src/agent/tools/crm.ts`（`query_customers` / `get_customer_detail` 开放给供应链并裁剪字段）
- Modify: `src/agent/registry.ts`（若写工具的 `allowedRoles` 需含 ceo）
- Modify: `src/agent/tools/write.ts`（四个写工具的 `allowedRoles` 与 `confirmSummary`）
- Modify: `src/agent/loop.ts`（越权写操作的确认摘要前缀与审计标记）
- Modify: `src/pages/Customers.tsx`（按角色裁剪列）
- Test: `src/lib/rbac.test.ts`、`src/agent/registry.test.ts`

**Interfaces（后续任务依赖）:**
- Produces: `canSeeCustomerFinancials(role: Role): boolean`
- Produces: `overrideNoticeFor(toolName: string, role: Role): string | null`

### 决定 1：供应链获得客户可见性，但财务字段裁剪

`scopeCustomers` 的 `supply_chain` 分支由 `return []` 改为 `return db.customers`（48 条，
与其 160 张订单口径一致）。

同时在 `rbac.ts` 新增字段级判定：

```ts
/** 供应链需要知道货发给谁（做分配优先级），但不需要知道客户的钱。 */
export function canSeeCustomerFinancials(role: Role): boolean {
  return role !== 'supply_chain'
}
```

`annualRevenue` / `creditLimit` / `creditUsed` 三个字段：
- `Customers.tsx` 对供应链不渲染这三列；
- `query_customers` 与 `get_customer_detail` 对供应链从返回对象中删除这三个 key
  （不是置 0，置 0 会让模型把它当成真实数值），并在工具 description 里写明会按角色裁剪。

这两个工具的 `allowedRoles` 加入 `'supply_chain'`。

### 决定 2：CEO 恢复写权限，但每次写操作标注为「越权代办」

四个写工具的 `allowedRoles` 全部加入 `'ceo'`。

在 `rbac.ts` 新增：

```ts
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
```

`loop.ts` 的 HITL 块里，把它拼在 `confirmSummary` 之前（换行分隔），
并在 `auditOf(...)` 产出的审计条目上带 `override: true`（`AuditEntry` 需加可选字段）。

**这条替换掉 V1「CEO 零写权限」的说法。** 新说法：权限设计的目标是减少误操作，不是表达等级；
所以 CEO 保留写权限，但把它做成一个需要额外确认、且必然留痕的显式越权动作。

### 测试

- `scopeCustomers` 对供应链返回 48 条；
- `canSeeCustomerFinancials`：仅 supply_chain 为 false；
- `query_customers` 以供应链身份调用，返回对象**不含** `annualRevenue`/`creditLimit`/`creditUsed` 三个 key；以 CEO 身份调用则三个 key 都在；
- `overrideNoticeFor('create_purchase_order', 'ceo')` 非空且含「供应链主管」；
  `overrideNoticeFor('create_purchase_order', 'supply_chain')` 为 null；
  `overrideNoticeFor('create_followup_task', 'sales_rep')` 为 null；
- `toolsFor('ceo')` 现在包含四个写工具（更新 V1 里断言 CEO 无写工具的那条测试）。

---

## T2：显式边界

**Files:**
- Modify: `src/lib/rbac.ts`（新增 `scopeSummary`）
- Modify: `src/agent/tools/crm.ts` `erp.ts` `analytics.ts`（受限读工具返回 `scope` 字段）
- Modify: `src/agent/prompts.ts`（新增范围限定语规则）
- Modify: `src/pages/Customers.tsx` `Opportunities.tsx` `Orders.tsx` `Receivables.tsx`（表头与空态文案）
- Test: `src/lib/rbac.test.ts`

**Interfaces:**
- Consumes: T1 的 `canSeeCustomerFinancials`
- Produces: `scopeSummary(db, user, entity): { visible: number; total: number; hidden: number; basis: string }`

### 决定 3：过滤必须自报边界

```ts
export type ScopedEntity = 'customers' | 'opportunities' | 'orders' | 'receivables'

/** basis 是给人看的范围说明，直接进界面文案与模型回答。 */
export function scopeSummary(db: DbSnapshot, user: User, entity: ScopedEntity):
  { visible: number; total: number; hidden: number; basis: string }
```

`basis` 取值：`sales_rep` → `你本人名下`；`sales_director` → `你所在团队`；
`ceo` → `全公司`；`supply_chain` → 视实体而定（订单/客户为 `全公司`，商机/应收为 `无权查看`）。

**界面**：四个列表页表头由现在的「N 条（已按当前角色权限过滤）」改为
「显示 N 条 · 范围：{basis} · 范围外另有 M 条不可见」（M 为 0 时省略后半句）。
列表为空时不留白屏，显示：「{basis}内没有符合条件的记录。全公司另有 M 条，超出你的查看范围。」

**工具**：受限读工具的成功返回值加 `scope` 字段（即 `scopeSummary` 的结果）；
`{found:false}` 的 `reason` 同样带上边界，例如
`在你本人名下没有符合条件的应收；全公司另有 120 条，超出你的查看范围。`

**Prompt**：`prompts.ts` 增加一条硬规则：

> 工具返回的 `scope` 字段说明了本次结果的权限范围。当 `scope.hidden > 0` 时，
> 你的结论必须带范围限定语（例如「在你负责的范围内…」），并说明范围外还有多少条不可见。
> 严禁使用「全公司只有 / 一共只有 / 没有任何」这类越界断言。

**已知取舍（写进文档，面试会被问）**：向用户披露「范围外还有 M 条」会泄漏一个计数。
这是刻意的：计数不含业务内容，而它是让权限边界可解释的最小代价。
不披露就会回到「静默过滤」，那正是本次要修的问题。

### 测试

- `scopeSummary(db, 张伟, 'customers')` → `{visible:9, total:48, hidden:39}`，basis 为「你本人名下」；
- `scopeSummary(db, 陈立, 'orders')` → `hidden` 为 0；
- 以张伟身份调 `query_receivables` 被 registry 层拒绝（`PERMISSION_DENIED`）——保持 V1 行为不变；
- 以李娜身份调用某受限读工具，返回值含 `scope` 且 `scope.hidden > 0`。

---

## T3：Sidekick 可收起 + 独立页（交付 2）

**Files:** `src/components/AppShell.tsx`、`src/sidekick/Sidekick.tsx`、`src/App.tsx`

- Sidekick 由固定右栏改为可收起抽屉：收起时数据区占满宽度，右侧留一个常驻唤起按钮（显示未读/进行中状态）。
- 展开宽度可在两档间切换（窄 380px / 宽 560px），不做自由拖拽。
- 新增 `/agent` 独立整页模式，与抽屉共用同一个 Sidekick 组件与同一份会话状态。
- 收起/展开状态与宽度档位存入 `localStorage`，刷新保留（注意：业务数据仍不持久化，只存 UI 偏好）。

## T4：导航整理 + 数据表筛选（交付 3）

**Files:** `src/components/AppShell.tsx`、`src/components/DataTable.tsx`、六个列表页

- 左侧导航按职能分组：**销售**（客户 / 商机 / 订单）· **供应链**（库存 / 采购）· **财务**（应收）。
- 当前角色无权访问的导航项不隐藏，改为置灰 + 锁图标 + 悬浮说明「{角色}无此权限」——
  与 T2 同一原则：边界要看得见，不能静默消失。
- `DataTable` 增加通用能力：文本搜索框、按列排序、状态类字段的下拉筛选。
  筛选结果同样要显示「筛选后 N 条 / 范围内共 M 条」，不与 T2 的权限计数混淆。

## T5：多会话 + 历史回看（交付 4）

**Files:** `src/sidekick/*`、`src/lib/store.ts`

- 会话模型进 store：`conversations: { id, title, createdAt, items, history }[]` + `activeId`。
- 顶部「+ 新会话」按钮；会话列表可切换、可删除；标题取首个问题的前 20 字。
- 切换角色时**不清空**已有会话，但新会话独立；跨角色的历史不进入模型上下文
  （沿用 V1 `shouldRecordTurn` 的角色一致性判定）。
- 会话存入 `localStorage`，刷新保留；「重置演示数据」按钮同时清空会话。

---

## 收尾（全部交付完成后）

- 同步 `docs/PRD.md` §5 权限模型、`docs/agent-design.md` §3 与新增的「显式边界」小节、
  `docs/demo-script.md` 全部台词与数字、`README.md` 特性列表。
- V1 的「CEO 零写权限」说法在四处文档中出现，必须全部改为新说法。
- 重跑六条浏览器验收，重拍截图。
