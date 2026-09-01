export const money = (n: number | string) =>
  typeof n === 'string' ? n
    : n >= 10000 ? `¥${(n / 10000).toFixed(1)}万` : `¥${n.toLocaleString('zh-CN')}`

export const pct = (n: number) => `${Math.round(n * 100)}%`

export function daysFromToday(d: string, today = '2026-09-02') {
  return Math.round((Date.parse(d) - Date.parse(today)) / 86400000)
}
