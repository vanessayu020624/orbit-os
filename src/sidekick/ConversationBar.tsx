import { useState } from 'react'
import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'
import { useSidekick } from './SidekickProvider'

export function ConversationBar() {
  const { db, currentUser } = useStore()
  const c = useSidekick()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-b">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={c.newChat} disabled={c.busy}
          className="text-xs px-2 py-1 rounded border text-slate-600 hover:border-brand
                     hover:text-brand disabled:opacity-40">
          + 新会话
        </button>
        <button onClick={() => setExpanded(v => !v)}
          className="text-xs px-2 py-1 rounded text-slate-500 hover:text-brand">
          历史 {c.conversations.length} 个 {expanded ? '▴' : '▾'}
        </button>
      </div>
      {expanded && (
        <div className="max-h-48 overflow-auto border-t">
          {c.conversations.map(conv => {
            const isActive = conv.id === c.activeId
            const isOwn = conv.userId === currentUser.id
            const owner = db.users.find(u => u.id === conv.userId)
            const ownerName = owner?.name ?? '—'
            const roleLabel = owner ? ROLE_META[owner.role].label : '—'
            return (
              <div key={conv.id}
                onClick={() => !c.busy && c.switchChat(conv.id)}
                className={`group flex items-center gap-2 px-3 py-1.5 text-xs
                           ${c.busy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
                           ${isActive ? 'bg-brand/10' : 'hover:bg-slate-50'}`}>
                <div className="flex-1 min-w-0">
                  <div className={`truncate ${isActive ? 'text-brand font-medium' : 'text-slate-600'}`}>
                    {conv.title}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {ownerName} · {roleLabel}{isOwn ? '' : ' · 只读'}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); c.deleteChat(conv.id) }} disabled={c.busy}
                  className="text-slate-300 hover:text-danger px-1 opacity-0 group-hover:opacity-100">×</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
