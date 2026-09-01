import type { ReactNode } from 'react'

export interface Column { key: string; title: string; width?: string; render?: (row: any) => ReactNode }

export function DataTable({ columns, rows, empty = '暂无数据' }:
  { columns: Column[]; rows: any[]; empty?: string }) {
  if (!rows.length) {
    return <div className="p-12 text-center text-slate-400 bg-white rounded-lg border">{empty}</div>
  }
  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b">
          <tr>{columns.map(c => (
            <th key={c.key} style={{ width: c.width }}
                className="text-left px-4 py-3 font-medium text-slate-500">{c.title}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
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
  )
}
