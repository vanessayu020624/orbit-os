import { describe, it, expect } from 'vitest'
import { generateSeed } from '../lib/seed'
import { listCards, filterCards } from './dataCards'
import type { MobileEntity } from './dataCards'
import { resolveRef } from '../lib/refLookup'
import {
  scopeCustomers, scopeOrders, scopeOpportunities, scopeReceivables, scopePurchaseOrders,
} from '../lib/rbac'

const db = generateSeed(42)
const u = (n: string) => db.users.find(x => x.name === n)!
const zhangWei = u('张伟')          // sales_rep
const wangQiang = u('王强')         // supply_chain
const chenLi = u('陈立')            // ceo

const ALL: MobileEntity[] = ['customers', 'opportunities', 'orders', 'inventory', 'purchases', 'receivables']

describe('移动端卡片流', () => {
  it('每种实体都能出卡，且卡上的编号都点得开', () => {
    for (const e of ALL) {
      const cards = listCards(db, chenLi, e)
      expect(cards.length).toBeGreaterThan(0)
      // 这是卡片流唯一的硬约束：ref 必须解析得到，否则点开是一张空详情卡。
      for (const c of cards) expect(resolveRef(db, chenLi, c.ref), `${e} / ${c.ref}`).not.toBeNull()
    }
  })

  it('卡片数量与桌面同一套 scope，手机上不多不少', () => {
    expect(listCards(db, zhangWei, 'orders').length).toBe(scopeOrders(db, zhangWei).length)
    expect(listCards(db, zhangWei, 'customers').length).toBe(scopeCustomers(db, zhangWei).length)
    expect(listCards(db, zhangWei, 'opportunities').length).toBe(scopeOpportunities(db, zhangWei).length)
    expect(listCards(db, chenLi, 'receivables').length).toBe(scopeReceivables(db, chenLi).length)
    expect(listCards(db, wangQiang, 'purchases').length).toBe(scopePurchaseOrders(db, wangQiang).length)
    // 销售代表只看得到自己名下的，一定少于 CEO
    expect(listCards(db, zhangWei, 'orders').length).toBeLessThan(listCards(db, chenLi, 'orders').length)
  })

  it('供应链主管的订单卡不带金额', () => {
    for (const c of listCards(db, wangQiang, 'orders')) expect(c.metric).not.toContain('¥')
    expect(listCards(db, chenLi, 'orders').some(c => c.metric.includes('¥'))).toBe(true)
  })

  it('供应链主管的客户卡不带授信金额', () => {
    for (const c of listCards(db, wangQiang, 'customers')) expect(c.metric).toBe('—')
    expect(listCards(db, chenLi, 'customers').every(c => c.metric.includes('¥'))).toBe(true)
  })

  it('逾期应收标红、逾期订单标红', () => {
    const overdue = listCards(db, chenLi, 'receivables').filter(c => c.status === '已逾期')
    expect(overdue.length).toBeGreaterThan(0)
    for (const c of overdue) expect(c.tone).toBe('danger')
  })

  it('搜索按标题和副标题匹配，不匹配状态词', () => {
    const cards = listCards(db, chenLi, 'orders')
    const name = db.customers[0].name
    const hit = filterCards(cards, name)
    expect(hit.length).toBeGreaterThan(0)
    for (const c of hit) expect(c.subtitle).toContain(name)
    expect(filterCards(cards, '已发货').length).toBe(0)
    expect(filterCards(cards, '  ').length).toBe(cards.length)
  })
})
