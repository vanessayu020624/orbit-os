# OrbitOS

**一个把 CRM 与 ERP 打通、由 Agent 主动发现风险并协同处理的企业运营系统演示。**

虚拟公司「擎源工业设备」是工业传感器 / 伺服电机 / 控制器的 B2B 分销商。销售在承诺交期时看不到库存和在途采购，供应链发现缺货时订单已经签了。OrbitOS 让一个 Agent 横跨客户、商机、订单、库存、采购、应收六个模块自主排查这类跨部门问题，并在需要写数据时停下来请人确认。

**在线地址：<https://orbit-os.pages.dev>**　（部署自检页：<https://orbit-os.pages.dev/selftest>）

---

## 截图

> 📸 截图待补：仪表盘（切到「供应链主管」角色，顶部红色交期风险卡「2 张订单存在交期风险」+ 四张 KPI 卡 + 三张图表）

> 📸 截图待补：Sidekick 执行中（左侧带勾选状态的规划清单 + 右侧展开的工具调用卡，可见 `simulate_delivery_risk` 的入参与出参 JSON）

> 📸 截图待补：HITL 确认卡（黄框「需要你确认」+ 具体金额与到货日期的摘要 + 批准/拒绝两个按钮）

拍摄清单与要求见 [`docs/img/README.md`](docs/img/README.md)。

---

## 核心特性

1. **Agent 自主规划，且规划是可见的界面元素。** 采用 Planner–Executor 双层结构：先由 LLM 输出结构化 JSON 计划（`{goal, steps[]}`），Sidekick 立刻把它渲染成带勾选框的清单，然后才开始执行工具。用户在第一秒就知道 Agent 打算干什么，而不是看着工具一个个往外蹦。执行中还可以动态追加步骤（`plan_amended` 事件，清单高亮）。

2. **权限是物理约束，不是提示词里的君子协定。** 四个角色（销售代表 / 销售总监 / 供应链主管 / CEO）对应四套工具集合：`toolsFor(role)` 决定哪些工具会被放进发给 LLM 的 `tools` 数组，`executeTool()` 在执行前再查一次角色。未授权的工具对模型来说不存在，就算它凭幻觉编出工具名也会拿到 `PERMISSION_DENIED`。当前各角色实际可用工具数：销售代表 9 / 销售总监 11 / 供应链主管 8 / CEO 11（共 15 个）。

3. **写操作强制人工确认（HITL），确认卡写清楚代价。** 4 个写工具在执行前一律暂停，弹出的卡片不是「确认执行吗」，而是「将向【锐驰机电】采购 SKU-203 高精度伺服电机 SV-800 × 48 台，预计成本 ¥591,360，预计到货 2026-09-07（加急）」。用户点「拒绝」后，`{rejected: true, reason}` 会被喂回模型，让它改口给替代方案而不是原地重试。

4. **三道幻觉防线：数字溯源 / 写操作 HITL / 空结果显式化。** 结论里的每个记录号都用 `[[SO-2026-0428]]` 标注，前端渲染成可点击 chip，点一下跳到原始记录页；工具查不到数据时返回 `{found: false, reason}` 而不是空数组，逼模型说「未找到」而不是拿别的数据顶上。

5. **Agent 干预的结果当场反映在看板上。** 批准采购单后 store 真的落库，仪表盘的「交期风险订单」KPI 从 2 变 0，红色风险卡消失。断网时自动降级到录播模式，事件流与数字取自同一份种子数据，现场不穿帮。

---

## 技术架构

```
┌───────────────────────────── 浏览器 ─────────────────────────────┐
│                                                                  │
│  ┌── 业务界面 ────────────────┐   ┌── AI Sidekick ────────────┐  │
│  │ 仪表盘 / 客户 / 商机 / 订单 │   │ 规划清单 PlanChecklist     │  │
│  │ 库存 / 采购 / 应收          │◄──┤ 工具卡   ToolCallCard      │  │
│  │ 角色切换器 · 风险卡         │   │ 确认卡   ConfirmCard       │  │
│  └────────────┬───────────────┘   │ 结论+引用 FinalAnswer      │  │
│               │  bus.ts           └────────────┬──────────────┘  │
│               │  (风险卡→提问)                  │ AgentEvent 事件流 │
│  ┌────────────▼────────────┐      ┌────────────▼──────────────┐  │
│  │ Zustand store           │      │ Agent 内核 loop.ts        │  │
│  │  db / currentUser       │      │  ① Planner  (JSON 计划)   │  │
│  │  applyMutation  ◄───────┼──────┤  ② Executor (最多 12 轮)  │  │
│  │  auditLog               │      │  ③ HITL 拦截写工具        │  │
│  └────────────┬────────────┘      └────────────┬──────────────┘  │
│               │ DbSnapshot(只读)                │ toolSchemasFor  │
│  ┌────────────▼────────────┐      ┌────────────▼──────────────┐  │
│  │ seed.ts generateSeed(42)│      │ 工具注册表 registry.ts     │  │
│  │ rbac.ts scope*/mask*    │─────►│  crm 4 / erp 6            │  │
│  │ risk.ts 交期风险确定性计算│      │  analytics 3 / write 2    │  │
│  └─────────────────────────┘      │  权限双层：toolsFor +      │  │
│                                   │            executeTool     │  │
│                                   └────────────┬──────────────┘  │
└────────────────────────────────────────────────┼─────────────────┘
                                                 │ POST /api/chat（同源）
                              ┌──────────────────▼──────────────────┐
                              │ Cloudflare Pages Function            │
                              │ functions/api/chat.ts                │
                              │  读环境变量 ZHIPU_API_KEY 并转发       │
                              └──────────────────┬──────────────────┘
                                                 │
                              ┌──────────────────▼──────────────────┐
                              │ 智谱 GLM-4.5-Flash                   │
                              │ open.bigmodel.cn（OpenAI 兼容接口）   │
                              └─────────────────────────────────────┘
```

**技术栈**：React 19.2 + TypeScript 6.0 + Vite 8.2 · Tailwind CSS 3.4 · Zustand 5 · Recharts 3.10 · React Router 7.18 · Vitest 4.1 · Cloudflare Pages + Pages Functions · 智谱 GLM-4.5-Flash

**数据**：全部由 `generateSeed(42)` 运行时确定性生成（mulberry32 伪随机），无数据库、无后端存储。48 客户 / 90 商机 / 60 SKU / 160 销售订单 / 55 采购单 / 120 应收。演示所需的冲突链在随机生成之后由 `applyPlantedScenario()` 硬编码覆盖，由 `seed.test.ts` 的断言钉死。

**测试**：4 个测试文件 37 条用例（`seed` 10 / `rbac` 7 / `risk` 4 / `registry` 16），覆盖埋雷数据一致性、权限双层拦截、字段脱敏与交期风险计算。

---

## 本地运行

```bash
npm install
npm run dev          # http://localhost:5173
```

⚠️ **`npm run dev` 不会启动 Pages Function，`/api/chat` 会返回 404**，Sidekick 会因此进入录播模式。要在本地跑真实 LLM：

```bash
# 需要一个智谱 API Key（open.bigmodel.cn 注册后免费获取）
npx wrangler pages dev -- npm run dev
# 或先构建再起：
npm run build && npx wrangler pages dev dist --binding ZHIPU_API_KEY=<your-key>
```

其他命令：

```bash
npm test             # vitest run，应为 4 files / 37 tests 全绿
npm run build        # tsc -b && vite build
npm run lint         # oxlint
```

---

## 部署说明

托管在 **Cloudflare Pages**（而非 Vercel：`vercel.app` 在国内 DNS 污染严重，面试现场打不开就是事故；`pages.dev` 国内可达性明显更好）。

1. 推送到 GitHub，在 Cloudflare Pages 里连接该仓库。
2. 构建配置：构建命令 `npm run build`，输出目录 `dist`。
3. 在 Pages 项目的 **Settings → Environment variables** 里加 `ZHIPU_API_KEY`，值为智谱开放平台的 API Key。
4. `functions/api/chat.ts` 会被自动映射为 `/api/chat`，它读取该环境变量并把请求原样转发给 `https://open.bigmodel.cn/api/paas/v4/chat/completions`。

**API Key 不进前端产物。** 浏览器只请求同源的 `/api/chat`，Key 只存在于 Cloudflare 的环境变量里。未配置 Key 时该 Function 返回 503 `NO_KEY`，前端捕获后走录播兜底而不是白屏。

`public/_redirects` 里配了 SPA 回退，否则在 Pages 上直接刷新 `/orders` 这类子路由会 404。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 问题定义、目标用户与场景、功能范围与非目标、核心流程、权限模型、成功指标、迭代规划 |
| [`docs/agent-design.md`](docs/agent-design.md) | **Agent 架构设计说明**：为什么选 Planner–Executor、工具边界怎么切、权限为什么放在工具层、幻觉防护三道防线、HITL 的产品设计、成本与延迟、上线后怎么评测 |
| [`docs/demo-script.md`](docs/demo-script.md) | 现场演示逐句台词、操作步骤、屏幕预期与卡壳预案，附 8 个高频追问的回答要点 |
| [`docs/img/README.md`](docs/img/README.md) | 截图拍摄清单 |
| [`docs/superpowers/specs/2026-09-02-orbitos-design.md`](docs/superpowers/specs/2026-09-02-orbitos-design.md) | 施工前的原始设计文档（历史存档，部分内容已被实现修正，以代码为准） |
| [`STATE.md`](STATE.md) | 分期施工记录与踩坑笔记 |
