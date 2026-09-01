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

/**
 * 硬编码覆盖演示所需的冲突链。必须在随机生成之后调用。
 * 详见 spec §5.3。
 */
function applyPlantedScenario(db: DbSnapshot) {
  // 1) SKU-203 定义为「高精度伺服电机 SV-800」，可用库存 42
  // 随机生成的 SKU 编号区间是 101~160，不含 203：借用一个已有 Product 槽位改编号，
  // 反正埋雷场景会把它的字段全部覆盖。
  const p203 = db.products.find(p => p.sku === 'SKU-203') ?? db.products[2]
  p203.sku = 'SKU-203'
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
  // 过滤在途单可能删掉不止一条，用已有采购单克隆补足到 55（保持规模稳定）
  let fillerN = 0
  while (db.purchaseOrders.length < 55) {
    const base = db.purchaseOrders.find(po => po.id !== 'PO-P01')!
    fillerN += 1
    db.purchaseOrders.push({ ...base, id: `PO-FILL-${fillerN}`, poNo: `PO-2026-09${String(fillerN).padStart(2, '0')}` })
  }

  // 4) 供应商比选参数。先把 SKU-203 从所有供应商剥离，再只发给这两家——
  //    否则随机生成的第三家供应商可能 leadTime 更短，把「锐驰机电排第一」的断言冲掉。
  db.suppliers.forEach(s => { s.skuIds = s.skuIds.filter(id => id !== p203.id) })
  dr.leadTimeDays = 14; dr.onTimeRate = 0.78; dr.priceFactor = 1.0
  if (!dr.skuIds.includes(p203.id)) dr.skuIds.push(p203.id)
  const rc = db.suppliers.find(s => s.name === '锐驰机电')!
  rc.leadTimeDays = 7; rc.onTimeRate = 0.94; rc.priceFactor = 1.12
  if (!rc.skuIds.includes(p203.id)) rc.skuIds.push(p203.id)

  // 5) 权限场景：张伟名下 9 个客户，最大 86 万；全公司最大 520 万归赵敏团队
  const zw = db.users.find(u => u.name === '张伟')!
  const other = db.users.find(u => u.name === '周琳')!   // T2 团队，非张伟
  db.customers.forEach(c => { if (c.ownerId === zw.id) c.ownerId = other.id })
  // 必须从下标 10 开始：前 4 个（华宁自动化/中科机电/长风精工/海通重工）分别是埋雷订单客户与
  // 全公司最大客户，被划给张伟就会同时打破「张伟最大 86 万」和「华宁是 380 万 A 级客户」两条断言。
  const mine = db.customers.slice(10, 19)
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
