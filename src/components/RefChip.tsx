import { useNavigate } from 'react-router-dom'

const ROUTE: [RegExp, string][] = [
  [/^SO-/, '/orders'], [/^PO-/, '/purchases'], [/^SKU-/, '/inventory'],
  [/^C-|^客户/, '/customers'], [/^OPP-/, '/opportunities'], [/^AR-/, '/receivables'],
]

export function RefChip({ id }: { id: string }) {
  const nav = useNavigate()
  const to = ROUTE.find(([re]) => re.test(id))?.[1]
  return (
    <button
      onClick={() => to && nav(to)}
      title={to ? `跳转到 ${to} 查看来源记录` : '来源记录'}
      className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-brand/10 text-brand
                 text-xs font-mono hover:bg-brand/20 align-baseline">
      {id}
    </button>
  )
}

/** 把 [[XXX]] 渲染成可点击 chip。未被标注的数字保持原样。 */
export function renderWithRefs(text: string) {
  return text.split(/(\[\[[^\]]+\]\])/g).map((seg, i) => {
    const m = seg.match(/^\[\[([^\]]+)\]\]$/)
    return m ? <RefChip key={i} id={m[1]} /> : <span key={i}>{seg}</span>
  })
}
