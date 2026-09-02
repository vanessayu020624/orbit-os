import type { DbSnapshot, User } from './types'
import {
  scopeCustomers, scopeOpportunities, scopeOrders, scopePurchaseOrders, scopeReceivables,
  canSeeCustomerFinancials,
} from './rbac'
import { resolveRef } from './refLookup'
import { money, pct, daysFromToday } from './format'

/**
 * 把一个 [[编号]] 展开成「这一条记录到底长什么样」。
 *
 * 桌面版不需要它：点 chip 会跳到列表页，那一整张表本来就在屏幕上。
 * 手机上没有并排的表，跳走等于把用户从对话里踢出去，所以改成从底部推一张详情卡——
 * 而推一张卡就需要先知道这条记录有哪些字段。
 *
 * 权限判定一律借 resolveRef：它已经按角色 scope 查过一遍了。
 * 这里绝不能自己再写一套「查全库」的快捷路径——那样手机上会看到桌面上看不到的记录，
 * 同一套权限出两种结果，是这个项目最不能接受的一类 bug。
 */

export interface RecordField {
  label: string
  value: string
  /** 让「已逾期」「可用为负」这类字段自己跳出来，而不是混在一列灰字里。 */
  tone?: 'ok' | 'warn' | 'danger'
}

export interface RecordDetail {
  kind: string
  title: string
  subtitle: string
  fields: RecordField[]
  /** 这条记录牵出来的其它编号，详情卡上做成可继续点的 chip。 */
  related: string[]
}

const MASKED = '***（当前角色不可见）'

export function lookupRecord(db: DbSnapshot, user: User, ref: string): RecordDetail | null {
  const id = ref.trim()
  // 先过 resolveRef：解析不到就是「这个角色看不到」，直接返回 null，
  // 由调用方去渲染那张「核对不到」的红卡。
  const target = resolveRef(db, user, id)
  if (!target) return null

  const nameOf = (uid: string) => db.users.find(u => u.id === uid)?.name ?? uid
  const custOf = (cid: string) => db.customers.find(c => c.id === cid)?.name ?? cid
  // 明细行里的 skuId 是产品内部主键（P-203），而 resolveRef 只认 sku / 名称。
  // 直接把主键塞进 related，详情卡上会挂出一排点不动的死 chip——
  // 和结论里引用内部主键是同一个老问题，这里换成对外编号。
  const skuRefs = (lines: { skuId: string }[]) =>
    lines.map(l => db.products.find(p => p.id === l.skuId)?.sku).filter((s): s is string => !!s)

  switch (target.route) {
    case '/orders': {
      const o = scopeOrders(db, user).find(x => x.orderNo === id)!
      const eta = daysFromToday(o.promisedDeliveryDate)
      const masked = user.role === 'supply_chain'
      return {
        kind: '销售订单', title: o.orderNo, subtitle: custOf(o.customerId),
        fields: [
          { label: '状态', value: o.status },
          { label: '承诺交期', value: `${o.promisedDeliveryDate}（${eta >= 0 ? `还有 ${eta} 天` : `已逾期 ${-eta} 天`}）`,
            tone: eta < 0 ? 'danger' : eta <= 14 ? 'warn' : undefined },
          // 供应链主管看得到订单，但看不到金额。这里必须和 maskOrderForRole 一个口径——
          // 界面上漏出来一个工具层特意脱敏掉的数字，权限演示当场就不成立了。
          { label: '订单金额', value: masked ? MASKED : money(o.totalAmount) },
          { label: '负责人', value: nameOf(o.ownerId) },
          { label: '行项目', value: `${o.items.length} 行` },
          { label: '创建日期', value: o.createdAt },
        ],
        related: [o.customerId, ...skuRefs(o.items)],
      }
    }
    case '/purchases': {
      const p = scopePurchaseOrders(db, user).find(x => x.poNo === id)!
      const eta = daysFromToday(p.eta)
      return {
        kind: '采购单', title: p.poNo,
        subtitle: db.suppliers.find(s => s.id === p.supplierId)?.name ?? p.supplierId,
        fields: [
          { label: '状态', value: p.status },
          { label: '预计到货', value: `${p.eta}（${eta >= 0 ? `还有 ${eta} 天` : `已延误 ${-eta} 天`}）`,
            tone: eta < 0 ? 'danger' : undefined },
          { label: '采购金额', value: money(p.totalCost) },
          { label: '加急', value: p.expedited ? '是' : '否', tone: p.expedited ? 'warn' : undefined },
          { label: '创建人', value: nameOf(p.createdBy) },
        ],
        related: skuRefs(p.items),
      }
    }
    case '/inventory': {
      const prod = db.products.find(x => x.sku === id || x.name === id)!
      const inv = db.inventory.find(i => i.skuId === prod.id)
      const short = inv ? inv.available < inv.safetyStock : false
      return {
        kind: '库存 SKU', title: prod.sku, subtitle: prod.name,
        fields: [
          { label: '分类', value: prod.category },
          { label: '单价', value: `${money(prod.unitPrice)} / ${prod.unit}` },
          { label: '现货', value: inv ? String(inv.onHand) : '—' },
          { label: '已预留', value: inv ? String(inv.reserved) : '—' },
          { label: '可用', value: inv ? String(inv.available) : '—',
            tone: short ? 'danger' : 'ok' },
          { label: '安全库存', value: inv ? String(inv.safetyStock) : '—',
            tone: short ? 'warn' : undefined },
        ],
        related: [],
      }
    }
    case '/customers': {
      const c = scopeCustomers(db, user).find(x => x.id === id || x.name === id)!
      const fin = canSeeCustomerFinancials(user.role)
      return {
        kind: '客户', title: c.name, subtitle: `${c.id} · ${c.tier} 类客户`,
        fields: [
          { label: '行业', value: c.industry },
          { label: '区域', value: c.region },
          { label: '负责人', value: nameOf(c.ownerId) },
          { label: '授信额度', value: fin ? money(c.creditLimit) : MASKED },
          { label: '已用授信', value: fin ? money(c.creditUsed) : MASKED,
            tone: fin && c.creditUsed > c.creditLimit * 0.8 ? 'warn' : undefined },
          { label: '年营收规模', value: fin ? money(c.annualRevenue) : MASKED },
        ],
        related: scopeOrders(db, user).filter(o => o.customerId === c.id).slice(0, 5).map(o => o.orderNo),
      }
    }
    case '/opportunities': {
      const op = scopeOpportunities(db, user).find(x => x.id === id || x.name === id)!
      return {
        kind: '商机', title: op.id, subtitle: op.name,
        fields: [
          { label: '客户', value: custOf(op.customerId) },
          { label: '阶段', value: op.stage },
          { label: '金额', value: money(op.amount) },
          { label: '赢率', value: pct(op.probability) },
          { label: '预计成交', value: op.expectedCloseDate },
          { label: '最近活动', value: op.lastActivityAt },
        ],
        related: [op.customerId],
      }
    }
    case '/receivables': {
      const r = scopeReceivables(db, user).find(x => x.id === id)!
      const open = r.amount - r.paidAmount
      const due = daysFromToday(r.dueDate)
      return {
        kind: '应收账款', title: r.id, subtitle: custOf(r.customerId),
        fields: [
          { label: '状态', value: r.status, tone: r.status === '已逾期' ? 'danger' : undefined },
          { label: '应收金额', value: money(r.amount) },
          { label: '已回款', value: money(r.paidAmount) },
          { label: '未回款', value: money(open), tone: open > 0 ? 'warn' : 'ok' },
          { label: '到期日', value: `${r.dueDate}（${due >= 0 ? `还有 ${due} 天` : `已逾期 ${-due} 天`}）`,
            tone: due < 0 ? 'danger' : undefined },
        ],
        related: [r.customerId,
          ...scopeOrders(db, user).filter(o => o.id === r.orderId).map(o => o.orderNo)],
      }
    }
  }
  return null
}
