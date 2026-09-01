/** 从一行里取出用于搜索/排序/筛选的原始值。合成列（如「客户」是按 id 查名字）必须显式提供。 */
export type Accessor = (row: any) => string | number

/** 大小写不敏感的子串匹配，任一 accessor 命中即保留。q 为空白时原样返回。 */
export function searchRows<T>(rows: T[], accessors: Accessor[], q: string): T[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter(row =>
    accessors.some(acc => String(acc(row)).toLowerCase().includes(needle)))
}

/** active 里值为空字符串的键表示「全部」，跳过不筛。多个键之间是 AND。 */
export function filterRows<T>(rows: T[], accessors: Record<string, Accessor>,
                               active: Record<string, string>): T[] {
  const entries = Object.entries(active).filter(([, v]) => v !== '')
  if (!entries.length) return rows
  return rows.filter(row =>
    entries.every(([key, v]) => {
      const acc = accessors[key]
      if (!acc) return true
      return String(acc(row)) === v
    }))
}

/** acc 为 null 时原样返回（保留调用方传入的既有顺序）。必须是稳定排序。 */
export function sortRows<T>(rows: T[], acc: Accessor | null, dir: 'asc' | 'desc'): T[] {
  if (!acc) return rows
  const sorted = [...rows].sort((a, b) => {
    const va = acc(a)
    const vb = acc(b)
    let cmp: number
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb
    } else {
      cmp = String(va).localeCompare(String(vb), 'zh-CN')
    }
    return dir === 'desc' ? -cmp : cmp
  })
  return sorted
}

/** 下拉选项：去重、去掉空值、按中文排序。 */
export function distinctValues<T>(rows: T[], acc: Accessor): string[] {
  const set = new Set<string>()
  for (const row of rows) {
    const v = String(acc(row))
    if (v !== '') set.add(v)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

/** shown 等于 total 时返回 null（没筛就不显示这行字）。 */
export function filterSummaryText(shown: number, total: number): string | null {
  if (shown === total) return null
  return `筛选后 ${shown} 条 / 范围内共 ${total} 条`
}
