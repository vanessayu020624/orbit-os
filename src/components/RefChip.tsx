import { useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { resolveRef } from '../lib/refLookup'

/**
 * 结论里的溯源标签。
 *
 * 这里曾经只按前缀猜路由（^SO- → /orders），既不校验记录是否真的存在，
 * 也不告诉落地页要看哪一条。两个后果都在实测中出现过：
 *   1. 模型引用了内部主键 SO-001（真实记录，但界面只显示 SO-2026-0412），
 *      chip 长得和正常的一模一样，用户点过去搜不到 → 判定为「系统在编数据」；
 *   2. 就算引用是对的，点击也只跳到列表页，用户还要在几十行里自己找。
 * 现在：先解析、解析不到就标红明说核不上，解析得到就带着关键词跳过去自动定位。
 * 宁可让一次核不上的引用显眼地失败，也不要让它安静地看起来成功。
 */
export function RefChip({ id }: { id: string }) {
  const nav = useNavigate()
  const { db, currentUser } = useStore()
  const target = resolveRef(db, currentUser, id)

  if (!target) {
    return (
      <span
        title="这条引用在你当前可见的数据里核对不到。可能是模型引用有误，请以左侧页面的数据为准。"
        className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-danger/10 text-danger
                   text-xs font-mono align-baseline line-through decoration-danger/50">
        {id}
      </span>
    )
  }

  return (
    <button
      onClick={() => nav(`${target.route}?focus=${encodeURIComponent(target.focus)}`)}
      title={`跳转到${target.kind}列表并定位 ${target.focus}`}
      className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-brand/10 text-brand
                 text-xs font-mono hover:bg-brand/20 align-baseline">
      {id}
    </button>
  )
}
