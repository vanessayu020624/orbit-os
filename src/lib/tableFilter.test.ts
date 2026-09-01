import { describe, it, expect } from 'vitest'
import { searchRows, filterRows, sortRows, distinctValues, filterSummaryText } from './tableFilter'

describe('searchRows', () => {
  const rows = [
    { name: 'Acme', region: '华东' },
    { name: 'Beta', region: '华南' },
    { name: 'Gamma', region: '华东' },
  ]
  const accessors = [(r: any) => r.name, (r: any) => r.region]

  it('命中其中一个 accessor 就保留', () => {
    expect(searchRows(rows, accessors, '华南')).toEqual([{ name: 'Beta', region: '华南' }])
  })

  it('大小写不敏感', () => {
    expect(searchRows(rows, accessors, 'ACME')).toEqual([{ name: 'Acme', region: '华东' }])
  })

  it('q 为空白字符串时原样返回全部', () => {
    expect(searchRows(rows, accessors, '  ')).toEqual(rows)
  })
})

describe('filterRows', () => {
  const rows = [
    { status: 'A', region: '华东' },
    { status: 'B', region: '华东' },
    { status: 'A', region: '华南' },
  ]
  const accessors = { status: (r: any) => r.status, region: (r: any) => r.region }

  it('单键筛选正确', () => {
    expect(filterRows(rows, accessors, { status: 'A' })).toEqual([
      { status: 'A', region: '华东' },
      { status: 'A', region: '华南' },
    ])
  })

  it('两个键是 AND', () => {
    expect(filterRows(rows, accessors, { status: 'A', region: '华东' })).toEqual([
      { status: 'A', region: '华东' },
    ])
  })

  it('值为空字符串的键被跳过（等于「全部」）', () => {
    expect(filterRows(rows, accessors, { status: '', region: '华南' })).toEqual([
      { status: 'A', region: '华南' },
    ])
  })
})

describe('sortRows', () => {
  it('数字列按数值排，能区分数值排序与字典序', () => {
    const rows = [{ n: 9 }, { n: 10 }, { n: 2 }]
    expect(sortRows(rows, (r: any) => r.n, 'asc')).toEqual([{ n: 2 }, { n: 9 }, { n: 10 }])
  })

  it('字符串列按 localeCompare 排序', () => {
    const rows = [{ s: '乙' }, { s: '甲' }, { s: '丙' }]
    const sorted = sortRows(rows, (r: any) => r.s, 'asc')
    expect(sorted.map(r => r.s)).toEqual(['乙', '甲', '丙'].slice().sort((a, b) => a.localeCompare(b, 'zh-CN')))
  })

  it('desc 是 asc 的逆序', () => {
    const rows = [{ n: 9 }, { n: 10 }, { n: 2 }]
    const asc = sortRows(rows, (r: any) => r.n, 'asc')
    const desc = sortRows(rows, (r: any) => r.n, 'desc')
    expect(desc).toEqual([...asc].reverse())
  })

  it('acc 为 null 时原样返回', () => {
    const rows = [{ n: 9 }, { n: 10 }, { n: 2 }]
    expect(sortRows(rows, null, 'asc')).toEqual(rows)
  })

  it('排序不修改入参数组', () => {
    const rows = [{ n: 9 }, { n: 10 }, { n: 2 }]
    const copy = [...rows]
    sortRows(rows, (r: any) => r.n, 'asc')
    expect(rows).toEqual(copy)
  })
})

describe('distinctValues', () => {
  it('去重、去空、排序', () => {
    const rows = [{ v: '乙' }, { v: '甲' }, { v: '' }, { v: '甲' }, { v: '丙' }]
    expect(distinctValues(rows, (r: any) => r.v)).toEqual(
      ['乙', '甲', '丙'].sort((a, b) => a.localeCompare(b, 'zh-CN')))
  })
})

describe('filterSummaryText', () => {
  it('shown 等于 total 时返回 null', () => {
    expect(filterSummaryText(5, 5)).toBeNull()
  })

  it('shown 不等于 total 时返回汇总文案', () => {
    expect(filterSummaryText(3, 10)).toBe('筛选后 3 条 / 范围内共 10 条')
  })
})
