import { useState } from 'react'
import { useStore } from '../lib/store'
import { useSidekick } from './SidekickProvider'
import { activeFor, archivedFor, otherRoleCount } from '../lib/conversations'

export function ConversationBar() {
  const { currentUser } = useStore()
  const c = useSidekick()
  const [expanded, setExpanded] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const mine = activeFor(c.conversations, currentUser.id)
  const arch = archivedFor(c.conversations, currentUser.id)
  const others = otherRoleCount(c.conversations, currentUser.id)

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
          历史 {mine.length} 个 {expanded ? '▴' : '▾'}
        </button>
      </div>
      {expanded && (
        <div className="max-h-48 overflow-auto border-t">
          {mine.map(conv => {
            const isActive = conv.id === c.activeId
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
                    {new Date(conv.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); c.archiveChat(conv.id) }} disabled={c.busy}
                  title="归档"
                  className="text-[10px] text-slate-400 hover:text-brand px-1 opacity-0 group-hover:opacity-100">归档</button>
                <button onClick={e => { e.stopPropagation(); c.deleteChat(conv.id) }} disabled={c.busy}
                  title="删除"
                  className="text-slate-300 hover:text-danger px-1 opacity-0 group-hover:opacity-100">×</button>
              </div>
            )
          })}
          {others > 0 && (
            <div className="px-3 py-1.5 text-[10px] text-slate-400 border-t">
              另有 {others} 个会话属于其他角色，切换到该角色后可见。
            </div>
          )}
          {arch.length > 0 && (
            <>
              <button onClick={() => setShowArchived(v => !v)}
                className="w-full text-left px-3 py-1.5 text-[10px] text-slate-400 hover:text-brand border-t">
                已归档 {arch.length} 个 {showArchived ? '▴' : '▾'}
              </button>
              {showArchived && arch.map(conv => {
                const isActive = conv.id === c.activeId
                return (
                  <div key={conv.id}
                    onClick={() => !c.busy && c.switchChat(conv.id)}
                    className={`group flex items-center gap-2 px-3 py-1.5 text-xs opacity-70
                               ${c.busy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
                               ${isActive ? 'bg-brand/10' : 'hover:bg-slate-50'}`}>
                    <div className="flex-1 min-w-0">
                      <div className={`truncate ${isActive ? 'text-brand font-medium' : 'text-slate-600'}`}>
                        {conv.title}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(conv.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); c.unarchiveChat(conv.id) }} disabled={c.busy}
                      title="恢复"
                      className="text-[10px] text-slate-400 hover:text-brand px-1 opacity-0 group-hover:opacity-100">恢复</button>
                    <button onClick={e => { e.stopPropagation(); c.deleteChat(conv.id) }} disabled={c.busy}
                      title="删除"
                      className="text-slate-300 hover:text-danger px-1 opacity-0 group-hover:opacity-100">×</button>
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
