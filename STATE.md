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

## P8 完成 (2026-09-02) —— 结论区排版 / 窄屏 / 飞书推送
- 结论区从 `whitespace-pre-wrap` 换成 `src/components/Markdown.tsx`（自写，不引 react-markdown）。
  支持加粗、有序 / 无序列表、# 到 #### 标题、行内代码、表格、分隔线，其余语法原样落成正文。
  依据是 15 条真实端到端结论里的实际用量：加粗 23 / 无序列表 67 行 / 有序 7 行 / 标题 15 行 /
  行尾双空格 64 行 / 表格 0（表格仍实现了，因为漏斗类问题随时可能吐一张，现场出一排竖线更糟）
- ⚠️ 必须记住的顺序：`splitInline()` **先切 `[[编号]]`、再切加粗与行内代码**。反过来
  `**[[AR-002]]**` 会在星号处断开，引用被劈成两半、chip 不成立，整条溯源链废掉。
  唯一例外是加粗横跨引用（`**共 [[AR-002]] 笔**`）：两种顺序都不对，单独先摘星号再切引用。
  这条已用 `Markdown.test.ts` 的 14 条用例钉死，改这个文件前先跑它
- `RefChip.tsx` 的 `renderWithRefs()` 已删除（唯一调用者 FinalAnswer 改用 `<Markdown>`）。
  旧文档里提到它的地方已同步改掉；P4 那条历史记录保持原样，它记的是当时的事实
- 首屏视觉层级：风险卡改成 severity 着色底 + 实色 CTA + 「星轨主动发现 · 无需提问」小标题；
  KPI 的「交期风险订单」「逾期应收」非零时数字上色。改动理由写在 RiskCards.tsx 文件头注释里
- 新增 `src/components/NarrowScreenGate.tsx`：< 1024px 换成说明卡而非降级布局，
  纯谓词 `shouldBlock(width, bypassed)` 单独导出可测。只套在 `/*` 业务路由外面，`/selftest` 不拦
- 新增 `functions/api/notify.ts` + `src/components/NotifyButton.tsx`：风险卡一键推飞书群机器人。
  webhook 地址与加签密钥只存在于 Cloudflare 环境变量（`FEISHU_WEBHOOK_URL` /
  `FEISHU_WEBHOOK_SECRET`），前端和仓库都拿不到
- ⚠️ 坑：飞书对失败的推送照样回 HTTP 200，真正结果在 body 的 `code`（新版）或 `StatusCode`
  （旧版）里。只看 `upstream.ok` 会把签名失败当成推送成功。已按两套字段名都读
- ⚠️ 坑：加签是以 `timestamp + "\n" + secret` 作 HMAC **密钥**、空串作消息体，和直觉相反；
  写反了飞书只回一句 19021 sign match fail。用 Web Crypto 不用 node:crypto（Workers 没有后者）
- ⚠️ 坑（与之前记录不符，以此为准）：`tsconfig.json` 的 references 里**包含**
  `./functions/tsconfig.json`，所以 `tsc -b` 会扫 `functions/`；vitest 的 include 也覆盖它。
  把纯函数挪到 `src/lib/` 再从 functions import 会触发 TS6307，别试
- 验收：`npm run build` 0 错误；`npm test` 16 文件 236 用例全绿；`npm run lint` 11 条 warning
  （全是 `react/only-export-components`，与 SidekickProvider / StatusChip 同类，本期新增 2 条来自
  Markdown.tsx 导出的两个纯函数——为可测性刻意保留，与项目既有做法一致）
- 未做：端到端回归本期没重跑（只改渲染层与新增旁路功能，未动 prompts.ts / loop.ts）。
  下次改提示词或 agent/loop.ts 时按 README 的命令补跑

## P9 完成 (2026-09-02) —— 飞书双向：群里 @星轨 直接对话

起因：P8 交付的是「飞书 webhook 推送」，但那只是单向告警。真正想要的是**在飞书里直接和 Agent 互动**。
最终做法是 B+C 结合：**只读在飞书里闭环，写操作跳回网页确认**。

### 新增

- `functions/lib/feishu.ts` + 测试（72 条）——协议层：回调解密（AES-256-CBC，Web Crypto）、验签、
  `tenant_access_token` 缓存、发消息、卡片构造、`open_id` 映射。加解密和验签都有**对拍基准**：
  用 `node:crypto` 离线算出常量贴进测试，产品代码里零 `node:crypto`、零 `Buffer`（Workers 没有）。
  钉死的点包括「恰好 16 字节明文」（PKCS#7 整块填充）和「把 key 与 body 顺序写反」——后者同样
  产出合法 hex，只有对拍能发现。
- `functions/lib/agentRun.ts` + 测试（12 条）——在 Worker 里跑同一份执行器。
- `functions/api/feishu/events.ts` + 测试（16 条）——事件回调路由。
- `src/components/DeepLink.tsx`——处理 `?role=&ask=` 回跳。
- `src/lib/bus.test.ts`（4 条）。

### 改动

- `src/agent/llm.ts`：`fetch('/api/chat')` 改成可注入的 `chatEndpoint` + `setChatEndpoint()`。
  **这是服务端复用执行器的唯一硬阻塞点**——Worker 的 fetch 没有页面基准，相对路径直接抛 Invalid URL。
- `functions/tsconfig.json`：include 里逐个列出 `loop.ts` 的 14 个传递闭包文件 + `seed.ts`。
  不能写 `../src/lib/**`——`uiPrefs.ts` 用 localStorage、`store.ts` 依赖 zustand，在 `lib:["ES2021"]`
  无 DOM 的配置下直接编译失败。**这份清单是护栏**：它变长 = 有浏览器依赖漏进执行器。
- `src/lib/bus.ts`：加了 pending 暂存槽。

### 踩的坑

1. **把 `src/agent` 纳入 functions 项目后暴露了一个真实类型缺口**：DOM 里 `Response.json()` 返回
   `any`，Workers 类型定义里返回 `{}`，所以 `j?.choices` 在浏览器侧编得过、在 Worker 侧编译失败。
   已在 `llm.ts` 显式标注返回体类型。这类差异只有真的把代码放进另一个运行时才会暴露。

2. **`vi.mock` + `vi.hoisted` 打桩 `loop.ts` 一直拿到零参数调用**，且逐字节相同的文件换个名字复现、
   加一行 `probe.push` 就不复现——排查了很久没定位到根因（不是缓存，`rm -rf node_modules/.vite` 后仍然复现）。
   **换成注入**：`ServerRunOptions.runner?`，默认 `runAgent`。这本来就更符合这个仓库的风格
   （`buildFeishuCard` 的 `pushedAt`、`getTenantAccessToken` 的 `now` 都是这么做的），测试面反而更小。
   教训是：在一个到处都用注入的代码库里遇到 mock 打不通，先想想是不是不该 mock。

3. **子组件 effect 早于父组件**：`DeepLink` 是 `SidekickProvider` 的子组件，它调 `askAgent` 时
   订阅还没注册，问题被静默丢弃——表现是从飞书点进来只看到一个空 Sidekick，且完全不报错。
   在总线里加暂存槽解决，比让每个调用方去猜时序可靠。

### 已知边界（都写进了代码注释和 `docs/agent-design.md` §8）

- 3 秒 ACK vs 6~40 秒的问询：收到即 ACK + `waitUntil`，但后台任务时限不由我们控制。
- 事件去重只在隔离实例内有效，不是严格幂等。
- 服务端的 db 是另一份 `generateSeed(42)` 快照，和浏览器会话是两个世界；审计日志丢弃。
  **只读前提下这两件事才成立**——允许飞书落库的第一件要解决的不是权限，是状态从哪来。

### 验收

`npm run build` 0 错误；`npm test` **20 文件 340 用例全绿**（基线 16/236）；`npm run lint` 仍 11 条 warning，无新增。

## P10 完成 (2026-09-03) —— 歧义澄清闸 + 移动端外壳

### 新增

- `src/agent/clarify.ts` + 测试（33 条）——澄清闸。两层：确定性规则预检（零模型开销）+ 规划器语义判定。
- `src/sidekick/ClarifyCard.tsx`——三态卡（待选 / 已选 / 已按兜底继续）。
- `src/sidekick/ItemView.tsx`——把对话项渲染从 `Sidekick.tsx` 抽出来，桌面与移动共用同一批卡片。
- `src/lib/viewport.ts` + 测试（4 条）——`pickShell(width,bypassed)` 三档分发：mobile / gate / desktop。
- `src/lib/recordLookup.ts` + 测试（9 条）——把一个 `[[编号]]` 展开成详情卡的字段列表。
- `src/mobile/`：`MobileApp` / `MobileChat` / `MobileData` / `DetailSheet` / `dataCards.ts`（6 条测试）。
- `src/components/RefNav.tsx`——context，让外壳决定点 `[[编号]]` 是跳页面还是推详情卡。

### 关键决策

1. **语义澄清搭规划器的顺风车**，`Plan` JSON 多一个 `clarify` 字段，而不是单开一次分类器调用。
   后者会让**每个问题**都多付一次往返；现在只有真触发澄清才多付一次重新规划，规则命中则零开销。
2. **硬闸但最多一轮**（`askedClarify` 一次性），且 `fallback` 是必填——`fromPlanClarify` 没有 `assume`
   直接返回 null。一个能被卡死的 Agent 比一个偶尔猜错的 Agent 难用得多。
3. **服务端（飞书）没有 `requestClarify`**，所以恒走兜底分支。口径在结论正文（`assumptionBlock`）
   和卡片脚注（`ServerRunResult.assumption`）各说一次——正文靠模型不保证，脚注是确定性的。
4. **移动端是另一套 IA，不是响应式收缩**。共用数据 / 权限 / 全部对话卡片组件，只有布局是两套。
   `[[编号]]` 在手机上从底部推详情卡而不是跳页面：跳走等于把用户踢出对话。
5. **< 768 不再拦**，768~1023 保留说明卡。`shouldBlock` 保留导出（= `pickShell(...)==='gate'`），
   老的 4 条测试原样通过。

### 踩的坑

1. **规则层的误拦比漏拦危险得多**。第一版用平铺的代词词表 + `[一-龥]{2,}` 连续中文串，会把内置预置问题
   「我这个月的商机漏斗情况怎么样？」按「这个」拦下来，也会把「缺口最大的那个 SKU」拦下来。
   改成：代词后面必须跟业务名词、前面是「的」则不算悬空；多实体匹配改成枚举 2~8 字子串并排除
   已完整拼出的实体名、只保留极大片段。**并加了一组回归测试**：全部预置问题 + 全部风险卡问题
   逐条断言不被误拦（唯一豁免是 CEO 的「公司最大的客户是谁？」，那是刻意留的演示素材）。
2. **`functions/tsconfig.json` 的 include 是逐文件列的**，新增 `clarify.ts` 后 `tsc -b` 报 TS6307。
   这份清单是护栏不是负担，见 P9 的同一条。
3. **明细行里的 `skuId` 是产品内部主键（`P-054`），不是对外 `SKU-154`**。详情卡的「关联记录」
   直接把它挂上去会得到一排点不动的死 chip——和结论里引用内部主键是同一个老问题。
   `recordLookup.test.ts` 里加了一条硬断言：`related` 里每一个都必须能被 `resolveRef` 解析。

### 验收

`npm run build` 0 错误；`npm test` **24 文件 393 用例全绿**（基线 20/340）；
`npm run lint` 12 条 warning（+1，`RefNav.tsx` 的 fast-refresh 告警，与既有 11 条同类）。


---

## P11 完成 (2026-09-03) —— 饼图配色、演示脚本补全、预置问题纠错

### 改动

1. **订单状态饼图六个状态塌成四个颜色**。`StatusPieChart` 一直复用状态标签的 `ORDER_TONE`：
   待审核 / 部分发货 同为 warn，已发货 / 已完成 同为 ok。标签上没问题（旁边有字），
   饼图上颜色**就是**信息，两块同色扇区挨着，图例形同虚设。
   新增 `src/pages/dashboard/orderPalette.ts`：按生命周期排的六色专用色板 + 表外状态落灰的 `sliceColor()`；
   扇区描白边留缝，图例带上条数（不让人只靠颜色对）。
   `orderPalette.test.ts` 4 条，其中一条**反向断言 `ORDER_TONE` 确实塌色**——说明这套色板为什么必须独立存在。
2. **demo-script 补上「每个角色三个场景」这件早就答应的事**（原 P1 第 11 项，一直没做）。
   新增**剧本 B**（销售总监：一句话两个聚合口径 + 逾期应收，也就是漏斗分析与应收分析）
   和**附录全表**：13 条预置问题逐条写清会调什么工具、屏幕上出什么数字、被哪个剧本覆盖，
   外加 2 条边界问题。数字全部由 `generateSeed(42)` 现算核对过。
3. **修 demo-script 里三处会被当场拆穿的数字**：王强 8 → **10** 个工具（两处）、CEO 11 → **15**
   （同一段后文本来就写着 15，自相矛盾）；销售代表那句「点底部第二个预设按钮」是错的，
   他底部根本没有「公司最大的客户是谁？」。
4. **澄清闸上线后剧本 C 其实已经断了**：那句「公司最大的客户是谁？」现在必然先弹澄清卡。
   补进剧本 C 并写死口径必须点「**客户年营收规模**」——点「累计成交金额」的话两个角色的第一名
   **都是南方精密**（张伟名下客户恰好是全公司成交额榜首），权限对比那一幕直接消失。
5. **销售代表的写操作预置问题指向了他无权看的客户**。「帮我给华宁自动化建一个下周的回访任务」——
   华宁自动化归 U-010，张伟的客户页里根本没有这家。改成他名下的**汇川设备**。
   `create_followup_task` 只认 `assigneeName`，客户名只是任务标题里的一串字，所以它一直「跑得通」，
   但面试官翻一下客户页就穿帮。
6. `e2e/regression.test.ts` 补 `sc-4`（伺服电机，走澄清兜底分支），与 13 条预置问题对齐。

### 关键决策

- **饼图不复用状态标签色板**。语义色够用是因为标签旁边有文字；图表里颜色是唯一的区分手段。
  同色系调深浅在投影仪上等于同一个颜色，所以六段是跨色相排的。
- **附录全表而不是把 13 条都写成剧本**。剧本是给「演」用的，一条 4 分钟；全表是给「被临场点到」
  用的，一行一条。把两者混在一起会让 7 分钟的主线找不着。
- **三种口径三个名字是实测的**，不是修辞：累计成交金额 → 南方精密、未结应收余额 → 广联智造、
  客户年营收规模 → 海通重工。这句话写进剧本 E 之前先跑数核过。

### 验收

`npm run build` 0 错误；`npm test` **25 文件 397 用例全绿**；`npm run lint` 12 条 warning（与 P10 持平）。
