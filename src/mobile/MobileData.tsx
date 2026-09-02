import { useState } from 'react'
import { useStore } from '../lib/store'
import { isEntityDenied, scopeSummary, boundaryReason } from '../lib/rbac'
import type { ScopedEntity } from '../lib/rbac'
import { listCards, filterCards } from './dataCards'
import type { MobileEntity } from './dataCards'

const TABS: { key: MobileEntity; label: string }[] = [
  { key: 'orders', label: '订单' },
  { key: 'customers', label: '客户' },
  { key: 'opportunities', label: '商机' },
  { key: 'inventory', label: '库存' },
  { key: 'purchases', label: '采购' },
  { key: 'receivables', label: '应收' },
]

const TONE: Record<string, string> = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }

/**
 * 手机上的数据页。
 *
 * 它的定位是「核对」，不是「浏览」——手机上没人会翻 48 个客户。
 * 所以搜索框固定在顶部而不是折在筛选面板里，越权实体也照样列出来并显示为锁住：
 * 让用户看见「有这个东西但我看不了」，比直接把入口藏掉更能说明权限是怎么分的。
 */
export function MobileData({ onOpen }: { onOpen: (ref: string) => void }) {
  const { db, currentUser } = useStore()
  const [tab, setTab] = useState<MobileEntity>('orders')
  const [q, setQ] = useState('')

  const denied = tab !== 'inventory' && isEntityDenied(currentUser.role, tab as ScopedEntity)
  const cards = denied ? [] : filterCards(listCards(db, currentUser, tab), q)

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 bg-white border-b">
        <div className="flex gap-1.5 overflow-x-auto px-3 pt-2.5 pb-2">
          {TABS.map(t => {
            const lock = t.key !== 'inventory' && isEntityDenied(currentUser.role, t.key as ScopedEntity)
            return (
              <button key={t.key} onClick={() => { setTab(t.key); setQ('') }}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm ${
                  tab === t.key ? 'bg-brand text-white'
                    : lock ? 'border text-slate-300' : 'border text-slate-600'}`}>
                {t.label}{lock ? ' 🔒' : ''}
              </button>
            )
          })}
        </div>
        {!denied && (
          <div className="px-3 pb-2.5">
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="搜编号或名称…"
              className="w-full px-3 py-2 rounded-lg border text-base outline-none focus:border-brand" />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-3 py-3 space-y-2">
        {denied ? (
          <div className="text-sm text-slate-500 bg-slate-50 border rounded-lg p-4 leading-relaxed">
            {boundaryReason(scopeSummary(db, currentUser, tab as ScopedEntity), tab as ScopedEntity)}
          </div>
        ) : !cards.length ? (
          <div className="text-sm text-slate-400 p-4">没有匹配的记录。</div>
        ) : cards.map(c => (
          <button key={c.ref} onClick={() => onOpen(c.ref)}
            className="w-full text-left bg-white border rounded-lg px-3 py-2.5 active:bg-slate-50">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-sm text-slate-900 truncate">{c.title}</span>
              <span className={`text-[11px] shrink-0 ${c.tone ? TONE[c.tone] : 'text-slate-400'}`}>
                {c.status}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 mt-1">
              <span className="text-xs text-slate-500 truncate">{c.subtitle}</span>
              <span className={`text-xs shrink-0 ${c.tone === 'danger' ? 'text-danger' : 'text-slate-600'}`}>
                {c.metric}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
