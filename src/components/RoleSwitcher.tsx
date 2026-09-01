import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'
import type { Role } from '../lib/types'

const ORDER: Role[] = ['sales_rep', 'sales_director', 'supply_chain', 'ceo']

export function RoleSwitcher({ onSwitched }: { onSwitched?: (r: Role) => void }) {
  const { currentUser, setRole } = useStore()
  return (
    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
      {ORDER.map(r => {
        const m = ROLE_META[r]
        const active = currentUser.role === r
        return (
          <button key={r} title={m.description}
            onClick={() => { setRole(r); onSwitched?.(r) }}
            className={`px-3 py-1.5 rounded-md text-sm transition ${
              active ? 'bg-white shadow-sm font-medium text-brand' : 'text-slate-500 hover:text-slate-700'}`}>
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
