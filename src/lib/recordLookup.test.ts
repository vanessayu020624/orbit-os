import { describe, it, expect } from 'vitest'
import { generateSeed } from './seed'
import { lookupRecord } from './recordLookup'
import { scopeCustomers, scopeOrders } from './rbac'
import { resolveRef } from './refLookup'

const db = generateSeed(42)
const u = (n: string) => db.users.find(x => x.name === n)!
const zhangWei = u('张伟')          // sales_rep
const liNa = u('李娜')              // sales_director
const wangQiang = u('王强')         // supply_chain
const chenLi = u('陈立')            // ceo

const anyOrder = db.orders[0]
const anySku = db.products[0].sku

describe('详情卡查询', () => {
  it('订单能展开成带客户名和交期的卡片', () => {
    const d = lookupRecord(db, chenLi, anyOrder.orderNo)!
    expect(d.kind).toBe('销售订单')
    expect(d.title).toBe(anyOrder.orderNo)
    expect(d.subtitle).toBe(db.customers.find(c => c.id === anyOrder.customerId)!.name)
    expect(d.fields.find(f => f.label === '承诺交期')!.value).toContain(anyOrder.promisedDeliveryDate)
  })

  it('订单详情把客户和 SKU 挂成可继续点的关联引用', () => {
    const d = lookupRecord(db, chenLi, anyOrder.orderNo)!
    expect(d.related).toContain(anyOrder.customerId)
    // 挂的必须是对外 SKU 编号，不是明细行里的内部主键——否则详情卡上是一排点不动的死 chip。
    for (const line of anyOrder.items) {
      expect(d.related).toContain(db.products.find(p => p.id === line.skuId)!.sku)
    }
    for (const ref of d.related) expect(resolveRef(db, chenLi, ref)).not.toBeNull()
  })

  it('SKU 能按编号或名称查到，可用量低于安全库存时标红', () => {
    const byName = lookupRecord(db, wangQiang, db.products[0].name)!
    expect(byName.title).toBe(anySku)
    const inv = db.inventory.find(i => i.skuId === db.products[0].id)!
    const avail = byName.fields.find(f => f.label === '可用')!
    expect(avail.value).toBe(String(inv.available))
    expect(avail.tone).toBe(inv.available < inv.safetyStock ? 'danger' : 'ok')
  })

  it('商机、应收、采购单都能展开', () => {
    expect(lookupRecord(db, chenLi, db.opportunities[0].id)!.kind).toBe('商机')
    expect(lookupRecord(db, chenLi, db.receivables[0].id)!.kind).toBe('应收账款')
    expect(lookupRecord(db, wangQiang, db.purchaseOrders[0].poNo)!.kind).toBe('采购单')
  })

  it('查不到的编号返回 null，由界面去渲染核对不上的红卡', () => {
    expect(lookupRecord(db, chenLi, 'SO-9999-0001')).toBeNull()
    expect(lookupRecord(db, chenLi, '不存在的客户')).toBeNull()
  })
})

describe('详情卡不许绕开权限', () => {
  // 这一组是这个文件存在的主要理由：手机上多一条查询路径，
  // 就多一个把角色边界漏掉的机会。
  it('销售代表查不到别人名下的客户', () => {
    const mine = new Set(scopeCustomers(db, zhangWei).map(c => c.id))
    const other = db.customers.find(c => !mine.has(c.id))!
    expect(lookupRecord(db, zhangWei, other.id)).toBeNull()
    expect(lookupRecord(db, zhangWei, other.name)).toBeNull()
    expect(lookupRecord(db, chenLi, other.id)).not.toBeNull()
  })

  it('销售代表查不到别人名下的订单', () => {
    const mine = new Set(scopeOrders(db, zhangWei).map(o => o.orderNo))
    const other = db.orders.find(o => !mine.has(o.orderNo))!
    expect(lookupRecord(db, zhangWei, other.orderNo)).toBeNull()
  })

  it('供应链主管看得到订单，但金额被脱敏', () => {
    const visible = scopeOrders(db, wangQiang)[0]
    const d = lookupRecord(db, wangQiang, visible.orderNo)!
    expect(d.fields.find(f => f.label === '订单金额')!.value).not.toContain('¥')
    // 同一条记录换成总监就该看到真金额，证明脱敏是按角色而不是按记录。
    if (scopeOrders(db, liNa).some(o => o.orderNo === visible.orderNo)) {
      expect(lookupRecord(db, liNa, visible.orderNo)!
        .fields.find(f => f.label === '订单金额')!.value).toContain('¥')
    }
  })

  it('供应链主管看不到客户的授信和年营收', () => {
    const c = scopeCustomers(db, wangQiang)[0]
    const d = lookupRecord(db, wangQiang, c.id)!
    for (const label of ['授信额度', '已用授信', '年营收规模']) {
      expect(d.fields.find(f => f.label === label)!.value).not.toContain('¥')
    }
    const ceoView = lookupRecord(db, chenLi, c.id)!
    expect(ceoView.fields.find(f => f.label === '授信额度')!.value).toContain('¥')
  })
})
