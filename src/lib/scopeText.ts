import type { ScopeSummary } from './rbac'

/** 列表页表头：显示 N 条 · 范围：{basis} · 范围外另有 M 条不可见（M 为 0 时省略后半句）。 */
export function scopeHeaderText(s: ScopeSummary): string {
  if (s.denied) return `你没有查看${s.label}的权限 · 全公司共 ${s.total} 条`
  const base = `显示 ${s.visible} 条 · 范围：${s.basis}`
  return s.hidden > 0 ? `${base} · 范围外另有 ${s.hidden} 条不可见` : base
}

/** 列表为空时的提示：不留白屏，说明是范围内没有，还是权限本身裁剪掉了。 */
export function scopeEmptyText(s: ScopeSummary): string {
  if (s.denied) return `你没有查看${s.label}的权限。全公司共 ${s.total} 条，均超出你的查看范围。`
  const base = `${s.basis}没有符合条件的记录。`
  return s.hidden > 0 ? `${base}全公司另有 ${s.hidden} 条，超出你的查看范围。` : base
}
