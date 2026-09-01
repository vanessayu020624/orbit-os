import { useMemo, useState, type ReactNode } from 'react'
import { searchRows, filterRows, sortRows, distinctValues, filterSummaryText, type Accessor } from '../lib/tableFilter'

export interface Column {
  key: string
  title: string
  width?: string
  render?: (row: any) => ReactNode
  /** 搜索/排序/筛选取值。合成列（render 里查表得来的）必须提供，否则 row[key] 是 undefined。 */
  value?: Accessor
  /** 该列表头可点击排序。 */
  sortable?: boolean
  /** 该列在工具栏生成一个下拉筛选。 */
  filterable?: boolean
}

type SortDir = 'asc' | 'desc'

function accessorFor(col: Column): Accessor {
  return col.value ?? ((r: any) => r[col.key] ?? '')
}

export function DataTable({ columns, rows, empty = '暂无数据', searchKeys }:
  { columns: Column[]; rows: any[]; empty?: string; searchKeys?: string[] }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<Record<string, string>>({})
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const filterableColumns = columns.filter(c => c.filterable)
  const searchAccessors = useMemo(() =>
    (searchKeys ?? [])
      .map(key => columns.find(c => c.key === key))
      .filter((c): c is Column => !!c)
      .map(accessorFor),
    [columns, searchKeys])

  const searched = useMemo(() => searchRows(rows, searchAccessors, query), [rows, searchAccessors, query])

  const filterAccessors = useMemo(() => {
    const map: Record<string, Accessor> = {}
    for (const c of filterableColumns) map[c.key] = accessorFor(c)
    return map
  }, [filterableColumns])

  const filtered = useMemo(() => filterRows(searched, filterAccessors, active), [searched, filterAccessors, active])

  const sortCol = sortKey ? columns.find(c => c.key === sortKey) : undefined
  const sortAcc = sortCol ? accessorFor(sortCol) : null
  const sorted = useMemo(() => sortRows(filtered, sortAcc, sortDir), [filtered, sortAcc, sortDir])

  function resetFilters() {
    setQuery('')
    setActive({})
    setSortKey(null)
    setSortDir('asc')
  }

  function toggleSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortKey(null)
      setSortDir('asc')
    }
  }

  if (!rows.length) {
    return <div className="p-12 text-center text-slate-400 bg-white rounded-lg border">{empty}</div>
  }

  const summary = filterSummaryText(sorted.length, rows.length)
  const showSearch = !!(searchKeys && searchKeys.length)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {showSearch && (
          <input
            placeholder="搜索…"
            className="px-3 py-1.5 rounded-lg border text-sm outline-none focus:border-brand w-48"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        )}
        {filterableColumns.map(col => {
          const acc = accessorFor(col)
          const options = distinctValues(rows, acc)
          return (
            <select
              key={col.key}
              className="px-2 py-1.5 rounded-lg border text-sm outline-none focus:border-brand"
              value={active[col.key] ?? ''}
              onChange={e => setActive(prev => ({ ...prev, [col.key]: e.target.value }))}
            >
              <option value="">全部{col.title}</option>
              {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          )
        })}
        {summary !== null && <span className="ml-auto text-xs text-slate-400">{summary}</span>}
      </div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>{columns.map(c => (
              <th key={c.key} style={{ width: c.width }}
                  className="text-left px-4 py-3 font-medium text-slate-500">
                {c.sortable ? (
                  <button
                    className="flex items-center gap-1 hover:text-brand"
                    onClick={() => toggleSort(c.key)}
                  >
                    {c.title}
                    <span className={sortKey === c.key ? 'text-[10px]' : 'text-[10px] text-slate-300'}>
                      {sortKey === c.key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                ) : c.title}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-12 text-center text-slate-400">
                  当前筛选条件下没有记录。
                  <div>
                    <button className="mt-2 text-sm text-brand hover:underline" onClick={resetFilters}>
                      清除筛选条件
                    </button>
                  </div>
                </td>
              </tr>
            ) : sorted.map((r, i) => (
              <tr key={r.id ?? i} className="border-b last:border-0 hover:bg-slate-50">
                {columns.map(c => (
                  <td key={c.key} className="px-4 py-2.5">
                    {c.render ? c.render(r) : String(r[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
