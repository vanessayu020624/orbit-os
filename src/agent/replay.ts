import type { AgentEvent, PurchaseOrder, Role, User } from '../lib/types'
import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'

// 断网兜底：/api/chat 不可达时的两条剧本，事件序列与措辞按真实 GLM 输出的格式手写，
// tool_result 的数字直接取自 generateSeed(42) 的确定性结果（见 P4 报告的验证脚本），
// 保证录播模式与真实模式在演示现场切换时数字不穿帮。

const DELIVERY_PO: PurchaseOrder = {
  id: 'PO-955', poNo: 'PO-2026-955', supplierId: 'SUP-2', status: '已下单',
  eta: '2026-09-07', items: [{ skuId: 'P-003', qty: 48, unitCost: 12320 }],
  totalCost: 591360, expedited: true, createdBy: 'U-006',
}

const DELIVERY_SCRIPT: { delay: number; event: AgentEvent }[] = [
  { delay: 500, event: { type: 'plan', plan: {
    goal: '排查未来两周待发货订单的交付风险并给出处理方案',
    needsWrite: true,
    steps: [
      { id: 's1', title: '测算未来两周待发货订单的交付风险', expectedTools: ['simulate_delivery_risk'] },
      { id: 's2', title: '查询缺货 SKU 的可选供应商', expectedTools: ['get_supplier_options'] },
      { id: 's3', title: '为缺口下达加急采购单', expectedTools: ['create_purchase_order'] },
    ],
  } } },
  { delay: 300, event: { type: 'step_start', stepId: 's1' } },
  { delay: 700, event: { type: 'tool_call', id: 't1', name: 'simulate_delivery_risk',
    args: { withinDays: 14 } } },
  { delay: 1000, event: { type: 'tool_result', id: 't1', ms: 4, result: {
    count: 7,
    risks: [
      { orderId: 'SO-035', orderNo: 'SO-2026-0334', customerName: '德胜装备',
        promisedDeliveryDate: '2026-09-03', shortages: [], incomingEta: null, riskLevel: 'none', daysLate: 0 },
      { orderId: 'SO-P01', orderNo: 'SO-2026-0412', customerName: '华宁自动化',
        promisedDeliveryDate: '2026-09-08', shortages: [], incomingEta: null, riskLevel: 'none', daysLate: 0 },
      { orderId: 'SO-P02', orderNo: 'SO-2026-0428', customerName: '中科机电',
        promisedDeliveryDate: '2026-09-10',
        shortages: [{ skuId: 'P-003', sku: 'SKU-203', skuName: '高精度伺服电机 SV-800',
          required: 30, available: 2, gap: 28 }],
        incomingEta: '2026-09-16', riskLevel: 'high', daysLate: 6 },
      { orderId: 'SO-P03', orderNo: 'SO-2026-0435', customerName: '长风精工',
        promisedDeliveryDate: '2026-09-11',
        shortages: [{ skuId: 'P-003', sku: 'SKU-203', skuName: '高精度伺服电机 SV-800',
          required: 20, available: 0, gap: 20 }],
        incomingEta: '2026-09-16', riskLevel: 'high', daysLate: 5 },
      { orderId: 'SO-142', orderNo: 'SO-2026-0441', customerName: '聚力电气',
        promisedDeliveryDate: '2026-09-13', shortages: [], incomingEta: null, riskLevel: 'none', daysLate: 0 },
      { orderId: 'SO-011', orderNo: 'SO-2026-0310', customerName: '汇川设备',
        promisedDeliveryDate: '2026-09-14', shortages: [], incomingEta: null, riskLevel: 'none', daysLate: 0 },
      { orderId: 'SO-133', orderNo: 'SO-2026-0432', customerName: '安迅电子',
        promisedDeliveryDate: '2026-09-16', shortages: [], incomingEta: null, riskLevel: 'none', daysLate: 0 },
    ],
  } } },
  { delay: 300, event: { type: 'step_done', stepId: 's1' } },
  { delay: 300, event: { type: 'step_start', stepId: 's2' } },
  { delay: 600, event: { type: 'tool_call', id: 't2', name: 'get_supplier_options',
    args: { sku: 'SKU-203' } } },
  { delay: 700, event: { type: 'tool_result', id: 't2', ms: 2, result: {
    sku: 'SKU-203', skuName: '高精度伺服电机 SV-800',
    suppliers: [
      { id: 'SUP-2', name: '锐驰机电', leadTimeDays: 7, onTimeRate: 0.94, priceFactor: 1.12, estimatedUnitCost: 12320 },
      { id: 'SUP-1', name: '东瑞传动', leadTimeDays: 14, onTimeRate: 0.78, priceFactor: 1, estimatedUnitCost: 11000 },
    ],
  } } },
  { delay: 300, event: { type: 'step_done', stepId: 's2' } },
  { delay: 300, event: { type: 'step_start', stepId: 's3' } },
  { delay: 700, event: { type: 'tool_call', id: 't3', name: 'create_purchase_order',
    args: { supplierName: '锐驰机电', sku: 'SKU-203', qty: 48, expedited: true } } },
  { delay: 500, event: { type: 'confirm_request', id: 't3', toolName: 'create_purchase_order',
    args: { supplierName: '锐驰机电', sku: 'SKU-203', qty: 48, expedited: true },
    summary: '将向【锐驰机电】采购 SKU-203 高精度伺服电机 SV-800 × 48 台，预计成本 ¥591,360，预计到货 2026-09-07（加急）' } },
  // 批准后续内容（tool_result / step_done / final）由 runReplay 在拿到确认结果后接着播放，
  // 见下方 DELIVERY_AFTER_APPROVE。
]

const DELIVERY_AFTER_APPROVE: { delay: number; event: AgentEvent }[] = [
  { delay: 900, event: { type: 'tool_result', id: 't3', ms: 3, result: {
    ok: true, poNo: 'PO-2026-955', eta: '2026-09-07', unitCost: 12320, totalCost: 591360,
    message: '已创建采购单 PO-2026-955，预计到货 2026-09-07',
  } } },
  { delay: 300, event: { type: 'step_done', stepId: 's3' } },
  { delay: 900, event: { type: 'final', text:
    '结论：未来两周内共有 7 张待发货订单，其中 2 张存在交付风险 —— [[SO-2026-0428]]（中科机电）和 ' +
    '[[SO-2026-0435]]（长风精工），均因 [[SKU-203]] 高精度伺服电机 SV-800 库存不足导致，预计分别延期 6 天和 5 天。\n\n' +
    '依据：两张订单现有可用库存分别为 2 台与 0 台，合计缺口 48 台；现有在途采购单最早到货 2026-09-16，晚于两张订单的承诺交期。\n\n' +
    '处理方案：已向锐驰机电下达加急采购单 [[PO-2026-955]]，采购 48 台，预计 2026-09-07 到货，早于两张订单的交期，风险已解除。' +
    '建议同步通知客户成功经理跟进发货节奏。',
    refs: ['SO-2026-0428', 'SO-2026-0435', 'SKU-203', 'PO-2026-955'] } },
]

const DELIVERY_AFTER_REJECT: { delay: number; event: AgentEvent }[] = [
  { delay: 400, event: { type: 'tool_result', id: 't3', ms: 0, result: {
    rejected: true, reason: '用户拒绝了该写操作，请据此调整建议，不要重复尝试。',
  } } },
  { delay: 300, event: { type: 'step_done', stepId: 's3' } },
  { delay: 800, event: { type: 'final', text:
    '结论：由于加急采购未被批准，[[SO-2026-0428]]（中科机电）与 [[SO-2026-0435]]（长风精工）的交付风险仍未解除，' +
    '两张订单预计分别延期 6 天和 5 天。\n\n' +
    '依据：[[SKU-203]] 高精度伺服电机 SV-800 合计缺口 48 台，现有在途采购单最早到货 2026-09-16。\n\n' +
    '建议：（1）与两位客户协商交期顺延至 2026-09-16 之后；（2）如经费允许，可重新考虑向锐驰机电下达加急采购单。',
    refs: ['SO-2026-0428', 'SO-2026-0435', 'SKU-203'] } },
]

const PERMISSION_SCRIPT: { delay: number; event: AgentEvent }[] = [
  { delay: 500, event: { type: 'plan', plan: {
    goal: '全公司客户排行不在您的权限范围内，改为展示您名下客户按年采购额排序',
    needsWrite: false,
    steps: [
      { id: 's1', title: '查询本人名下客户并按年采购额降序排列', expectedTools: ['query_customers'] },
    ],
  } } },
  { delay: 300, event: { type: 'step_start', stepId: 's1' } },
  { delay: 700, event: { type: 'tool_call', id: 'p1', name: 'query_customers',
    args: { sortByRevenue: true, limit: 5 } } },
  { delay: 900, event: { type: 'tool_result', id: 'p1', ms: 2, result: {
    count: 9,
    customers: [
      { id: 'C-011', name: '汇川设备', industry: '包装印刷', region: '西南', ownerId: 'U-001',
        tier: 'B', creditLimit: 258000, creditUsed: 103200, annualRevenue: 860000 },
      { id: 'C-012', name: '南方精密', industry: '新能源', region: '华南', ownerId: 'U-001',
        tier: 'C', creditLimit: 216000, creditUsed: 86400, annualRevenue: 720000 },
      { id: 'C-013', name: '东方工控', industry: '3C 电子', region: '华北', ownerId: 'U-001',
        tier: 'C', creditLimit: 183000, creditUsed: 73200, annualRevenue: 610000 },
      { id: 'C-014', name: '瑞泽机械', industry: '包装印刷', region: '华南', ownerId: 'U-001',
        tier: 'C', creditLimit: 162000, creditUsed: 64800, annualRevenue: 540000 },
      { id: 'C-015', name: '和信自动化', industry: '包装印刷', region: '华北', ownerId: 'U-001',
        tier: 'C', creditLimit: 144000, creditUsed: 57600, annualRevenue: 480000 },
    ],
  } } },
  { delay: 300, event: { type: 'step_done', stepId: 's1' } },
  { delay: 900, event: { type: 'final', text:
    '结论：全公司客户排行不在您（销售代表）的权限范围内 —— 该数据仅销售总监与 CEO 可见。' +
    '在您名下的客户中，采购额最高的是 [[C-011]] 汇川设备，年采购额 ¥860,000。\n\n' +
    '依据：您名下共有 9 个客户，按年采购额降序排列后 [[C-011]] 汇川设备排名第一，其次是 [[C-012]] 南方精密（¥720,000）。\n\n' +
    '建议：如需查看全公司客户排行，请联系您的销售总监；建议优先跟进 [[C-011]] 汇川设备维护关系。',
    refs: ['C-011', 'C-012'] } },
]

export const REPLAY: Record<string, { delay: number; event: AgentEvent }[]> = {
  delivery: DELIVERY_SCRIPT,
  permission: PERMISSION_SCRIPT,
}

// 每段录播都是以某个角色的视角录的：delivery 以供应链主管身份创建采购单，
// permission 是销售代表口吻。角色对不上就不能演——否则 CEO 会看到销售代表的
// 回答，还能批准一张它本来无权发起的采购单。
export const REPLAY_ROLE: Record<'delivery' | 'permission', Role> = {
  delivery: 'supply_chain',
  permission: 'sales_rep',
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

export async function runReplay(
  scenario: 'delivery' | 'permission',
  user: User,
  emit: (e: AgentEvent) => void,
  requestConfirm: (id: string, n: string, a: unknown, s: string) => Promise<boolean>,
): Promise<void> {
  const need = REPLAY_ROLE[scenario]
  if (user.role !== need) {
    emit({ type: 'error', message:
      `这段录播是以「${ROLE_META[need].label}」的视角录制的，当前角色是「${ROLE_META[user.role].label}」。` +
      `不同角色能看到的数据和能执行的写操作都不一样，直接播放会给出与权限不符的内容，所以这里不演。` +
      `请切到「${ROLE_META[need].label}」再问一次，或等几秒重试实时模型。` })
    return
  }
  const script = REPLAY[scenario]
  for (const { delay, event } of script) {
    await sleep(delay)
    emit(event)
    if (event.type === 'confirm_request') {
      const approved = await requestConfirm(event.id, event.toolName, event.args, event.summary)
      emit({ type: 'confirm_resolved', id: event.id, approved })
      // 因果联动：批准后把采购单真的写进 store，看板必须跟着变。
      const tail = approved ? DELIVERY_AFTER_APPROVE : DELIVERY_AFTER_REJECT
      if (approved) useStore.getState().applyMutation({ kind: 'createPurchaseOrder', po: DELIVERY_PO })
      for (const t of tail) {
        await sleep(t.delay)
        emit(t.event)
      }
    }
  }
}
