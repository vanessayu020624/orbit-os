import { renderWithRefs } from '../components/RefChip'

export function FinalAnswer({ text, refs }: { text: string; refs: string[] }) {
  return (
    <div className="rounded-lg border-l-[3px] border-l-brand bg-white border p-3">
      <div className="text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
        {renderWithRefs(text)}
      </div>
      {refs.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t text-[11px] text-slate-400">
          本结论引用了 {refs.length} 条记录，点击标签可跳转核对
        </div>
      )}
    </div>
  )
}
