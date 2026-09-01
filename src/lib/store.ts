import { create } from 'zustand'
import type { DbSnapshot, User, Role, Mutation, AuditEntry } from './types'
import { generateSeed } from './seed'
import { ROLE_META } from './rbac'

interface State {
  db: DbSnapshot
  currentUser: User
  auditLog: AuditEntry[]
  setRole: (r: Role) => void
  applyMutation: (m: Mutation) => void
  pushAudit: (e: AuditEntry) => void
  reset: () => void
  tick: () => void
}

const initDb = generateSeed(42)
const initUser = initDb.users.find(u => u.id === ROLE_META.supply_chain.demoUserId)!

export const useStore = create<State>((set, get) => ({
  db: initDb,
  currentUser: initUser,
  auditLog: [],

  setRole: (r) => set(s => ({
    currentUser: s.db.users.find(u => u.id === ROLE_META[r].demoUserId)!,
  })),

  pushAudit: (e) => set(s => ({ auditLog: [e, ...s.auditLog].slice(0, 200) })),

  applyMutation: (m) => set(s => {
    const db = structuredClone(s.db)
    switch (m.kind) {
      case 'createPurchaseOrder':
        db.purchaseOrders.unshift(m.po)
        // 加急采购视为可用量即时补足（演示语义：锁定供应）
        for (const l of m.po.items) {
          const inv = db.inventory.find(i => i.skuId === l.skuId)
          if (inv) { inv.onHand += l.qty; inv.available = inv.onHand - inv.reserved }
        }
        break
      case 'updateOrderPromiseDate': {
        const o = db.orders.find(x => x.id === m.orderId || x.orderNo === m.orderId)
        if (o) o.promisedDeliveryDate = m.newDate
        break
      }
      case 'reserveInventory': {
        const inv = db.inventory.find(i => i.skuId === m.skuId)
        if (inv) { inv.reserved += m.qty; inv.available = inv.onHand - inv.reserved }
        break
      }
      case 'createTask':
        db.tasks.unshift({
          id: `TSK-${db.tasks.length + 1}`, assigneeId: m.assigneeId,
          title: m.title, dueDate: m.dueDate, createdBy: get().currentUser.id,
        })
        break
    }
    return { db }
  }),

  reset: () => set({ db: generateSeed(42), auditLog: [] }),

  // 演示用「实时」跳动：每次调用随机推进一张待发货订单为已发货，或给一笔应收回款。
  // ⚠️ 必须排除 SO-P* 开头的埋雷订单，否则它们会被自动推进导致风险卡自己消失，没法演示 Agent 干预。
  tick: () => set(s => {
    const db = structuredClone(s.db)
    const cand = db.orders.filter(o => o.status === '待发货' && !o.id.startsWith('SO-P'))
    if (cand.length && Math.random() < 0.6) {
      cand[Math.floor(Math.random() * cand.length)].status = '已发货'
    } else {
      const ar = db.receivables.find(r => r.status === '未到期')
      if (ar) { ar.status = '已回款'; ar.paidAmount = ar.amount }
    }
    return { db }
  }),
}))
