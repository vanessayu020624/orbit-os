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
