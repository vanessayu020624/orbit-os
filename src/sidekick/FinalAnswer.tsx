import { renderWithRefs } from '../components/RefChip'
import { useStore } from '../lib/store'
import { resolveRef } from '../lib/refLookup'

export function FinalAnswer({ text, refs }: { text: string; refs: string[] }) {
  const { db, currentUser } = useStore()
  // 脚注里的条数必须是「真的核得上的条数」。过去它数的是方括号出现次数，
  // 模型引用了一个不存在的编号，脚注照样自称「引用了 3 条记录」——
  // 一句无法兑现的可信度声明，比不写这行还糟。
  const verified = refs.filter(r => resolveRef(db, currentUser, r) !== null)
  const missing = refs.length - verified.length

  return (
    <div className="rounded-lg border-l-[3px] border-l-brand bg-white border p-3">
      <div className="text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
        {renderWithRefs(text)}
      </div>
      {refs.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t text-[11px] text-slate-400">
          {verified.length > 0 && `本结论引用了 ${verified.length} 条记录，点击标签可跳转核对`}
          {missing > 0 && (
            <span className="text-danger">
              {verified.length > 0 && '；'}另有 {missing} 条引用在你可见的数据里核对不到，已标红
            </span>
          )}
        </div>
      )}
    </div>
  )
}
