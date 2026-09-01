# OrbitOS 施工状态

> 每期收工追加不超过 20 行。新会话第一件事读这个文件，不要读代码摸索。

## P0 完成 (2026-09-02)
- 线上地址：（待人工填写 —— 需完成 Step 0.7 推送 GitHub 与 Step 0.8 连接 Cloudflare Pages 后填写实际 URL）
- `/api/chat` 已连通，Key 存于 Cloudflare Pages 环境变量 ZHIPU_API_KEY（待人工填写 —— 需人工注册智谱账号拿 Key、在 Cloudflare 配置环境变量并验证后确认）
- 国内手机流量访问：通过 / 未通过（待人工填写 —— 需人工用手机 4G/5G 实测）
- 技术栈已装：react-ts, tailwind@3, zustand, recharts, react-router-dom, vitest
- ⚠️ 坑：`functions/api/chat.ts` 用到的 `PagesFunction<Env>` 类型默认无法被 TypeScript 解析，已装 `@cloudflare/workers-types` 并新增 `functions/tsconfig.json` 接入根 `tsconfig.json` 的 project references 以便 `npm run build` 一并类型检查

## P1 完成 (2026-09-02)
- src/lib/types.ts 导出全部实体、Mutation、AgentEvent、ToolDef、ToolContext、TODAY='2026-09-02'
- generateSeed(42) → DbSnapshot；埋雷已由 seed.test.ts 8 条断言锁定，改动后必须重跑
- useStore(): { db, currentUser, auditLog, setRole(role), applyMutation(m), pushAudit(e), reset() }
- rbac: ROLE_META / scopeCustomers / scopeOrders / scopeOpportunities / maskOrderForRole
- risk: simulateDeliveryRisk(db, orderIds) / buildRiskCards(db, user)
- ⚠️ 坑：Inventory.available 是计算字段，改 onHand/reserved 后必须手动重算
- ⚠️ 坑：applyPlantedScenario 必须在随机生成之后调用，否则埋雷被覆盖
- ⚠️ 坑（brief 里没写）：随机 Product 的 sku 编号区间是 SKU-101~160，不含 SKU-203；
  applyPlantedScenario 里用 `db.products.find(sku==='SKU-203') ?? db.products[2]` 兜底改号后再覆盖字段
- ⚠️ 坑（brief 里没写）：过滤已有「在途」采购单时可能删掉不止 1 条，原 while 循环只处理超编不处理
  缺编，已加补齐逻辑把 purchaseOrders 数量稳定钉回 55

## P2 完成 (2026-09-02)
- AppShell 接受 sidekick prop，右侧 420px 槽位待 P4 填充
- StatusChip({label, tone}) + 导出 ORDER_TONE/PO_TONE/STAGE_TONE/AR_TONE 映射表
- DataTable({columns: Column[], rows, empty})，Column = {key,title,width?,render?}
- 6 个列表页已按角色过滤，空态文案是权限的可见证明
- public/_redirects 已加 SPA 回退，否则 Pages 上刷新子路由 404
- Ruling T2-A：P0 自检页原样迁到 src/pages/SelfTest.tsx，路由 /selftest 挂在 AppShell 之外（未入导航）
- ⚠️ 坑：react-router-dom 7.18 仍导出 BrowserRouter/Routes/Route/NavLink，brief 的 R6 风格写法无需改动即可用

## P3 完成 (2026-09-02)
- ALL_TOOLS 15 个（写 4 个）；toolsFor(role) / toolSchemasFor(role) / toolCatalogText(role)
- executeTool(name, args, ctx) → {ok, result, ms}；权限双层拦截，registry.test.ts 14 条断言已覆盖
- runAgent(opts) 见 RunAgentOptions；UI 只需实现 emit 与 requestConfirm 两个回调
- requestConfirm 返回 Promise<boolean>，未批准时会把 rejected 结果喂回模型
- 工具返回结构契约以 registry.test.ts 的断言为准（count/customers/topCustomers/risks/suppliers）
- simulate_delivery_risk 默认 withinDays=14（非 7），供应链主管测算出 SKU-203 缺口 48 台已钉住
- ⚠️ 坑：本地 npm run dev 不跑 Pages Function，/api/chat 404。需 npx wrangler pages dev，本次沙箱无网络未实测 GLM 实际输出行为，留给 P4 验证
- 15 个工具全 15 通过 npm test（33/33 全绿，含 P1 的 19 条）；npm run build 通过

## P4 完成 (2026-09-02)
- <Sidekick /> 自包含，App.tsx 通过 <AppShell sidekick={<Sidekick/>}> 挂载
- renderWithRefs(text) 把 [[XXX]] 渲染成可跳转 chip，路由映射在 RefChip.tsx 的 ROUTE 表
- replay.ts 的 runReplay(scenario, emit, requestConfirm) 用于断网兜底，数据取自 generateSeed(42) 真实结果
  （SO-2026-0428/0435 缺 SKU-203 共 48 台，向锐驰机电下加急单 PO-2026-955，2026-09-07 到货）
- runReplay 对 confirm_request 分批准/拒绝两条后续剧本，拒绝分支也会正确收尾（不会误报采购成功）
- ⚠️ 坑：本地必须用 npx wrangler pages dev 才有 /api/chat；本次沙箱无网络，GLM 实际返回格式仍未实机验证，
  已按 P3 记录的 T3-C 风险不变，Sidekick 的 catch(LlmUnavailable) 分支已实现但走的是 mock 路径未见真实响应
- ⚠️ 坑（本期新发现，未擅自改 loop.ts，仅记录）：loop.ts 用正文里的正则 `/需要追加步骤[：:]\s*(.+)/`
  识别动态重规划，且工具调用检测靠 `res.tool_calls` 是否为空来判断"是否收尾"——这两者都要求 GLM 严格按
  OpenAI tool_calls 结构返回且在文本追加步骤时不同时携带 tool_calls，未见真实响应前无法确认 GLM 是否符合

## P5 完成 (2026-09-02)
- Dashboard：风险卡 + KPI×4 + 图表×3（漏斗/订单状态饼图/12周发货趋势）+ 4 秒 tick，拆到 src/pages/dashboard/*
- src/lib/bus.ts：askAgent(q) / onAskAgent(h)，风险卡点击驱动 Sidekick 自动开跑
- Ruling T5-A 已落地：risk.ts 新增 countDeliveryRiskOrders(db,user)（提取 buildRiskCards 内部的
  14 天窗口筛选为 pendingDeliveryWindow 共用，未改 buildRiskCards 签名/行为），KPI#3 改「交期风险订单」
- ⚠️ 坑：tick 必须排除 SO-P* 埋雷订单，否则风险自己就消失了（已照办）
- ⚠️ 坑（本期实测发现，与派发时的口头验证不符）：countDeliveryRiskOrders(db, 王强) 实测为 **2**，不是
  派单说的 3。risk.test.ts 里 SO-2026-0412 本来就无缺货（riskLevel='none'），高风险只有 0428/0435 两张，
  这与 buildRiskCards 卡片标题里 `${risks.length} 张订单存在交期风险` 用的是同一个数字，两者互相印证。
  验收文案第 3 条按实测口径记：批准采购单后风险卡消失，KPI 从 2 变 0（不是 3 变 0）
- ⚠️ 坑：Sidekick.tsx 的 `useEffect(() => onAskAgent(ask), [currentUser])` 按 brief 原文写会让 bus 注册
  的 ask 闭包捕获角色切换那一刻的 busy 快照，并发拦截可能失效；已加 busyRef 做实时并发拦截，并把
  runAgent 的 user 参数改读 useStore.getState().currentUser，不依赖闭包快照
- 未执行的验收项（沙箱无浏览器/网络）：Step 5.5 全部 6 条需人工在浏览器里过一遍，本期只做了对应的
  vitest 数值验证（风险卡存在性、KPI 数字、角色差异）和静态检查，20 秒静置观察数字变化、点击按钮跳转
  Sidekick、重置按钮回填风险卡这几条纯 UI 交互未做浏览器实测

## P6 完成 (2026-09-02) —— 纯文档，未改任何 .ts/.tsx
- 新增 README.md / docs/PRD.md / docs/agent-design.md / docs/demo-script.md / docs/img/README.md
- 所有事实性数字均由代码核实（临时探针脚本跑完即删）：各角色可用工具数 rep 9 / director 11 /
  supply_chain 8 / ceo 11；供应链主管风险订单 **2** 张、缺口 48 台；14 天窗口内待发货 7 张
- ⚠️ 未实测数字一律写成「待实测 + 测量方法」占位（Planner 延迟、token 消耗、端到端耗时、成本）。
  沙箱无外网跑不了真实 GLM，不许后人拿「约 1.2s / 约 3000 tokens」这类数字直接填坑
- ⚠️ 文档里主动记录了 3 处「实现与设计意图的缺口」，是刻意保留的诚实交代，不是待办漏项：
  ① [[ref]] 只渲染不校验（原 spec 的「无法溯源标黄」未实现）
  ② 被拒绝的写操作不进 auditLog（loop.ts:104 拒绝分支 continue 掉了），而拒绝率是 PRD 核心指标
  ③ loop.ts 的 stepIdx 每轮推进一格，不与 expectedTools 对齐，勾选进度是近似值
- ⚠️ 与 brief/spec 不符、以代码为准的三处：交期风险订单 2 张（非 3）；技术栈 React 19.2 / Recharts 3.10
  （非 18 / 2）；风险卡「逾期超 60 天」实际是 5 笔 ¥353.4 万（seed 只埋了 2 笔，随机数据又凑出 3 笔）
- ⚠️ Sidekick 切换角色不清空会话（spec §8 说要清空），剧本 C 的上下对照演示反而依赖这个行为，未改
- README 三处截图位是中文占位不是图片标签（避免 GitHub 破图），拍摄清单见 docs/img/README.md
