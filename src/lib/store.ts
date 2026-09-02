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
}))
