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
