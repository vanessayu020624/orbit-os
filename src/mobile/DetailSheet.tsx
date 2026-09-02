import { useStore } from '../lib/store'
import { lookupRecord } from '../lib/recordLookup'

const TONE: Record<string, string> = {
  ok: 'text-ok', warn: 'text-warn', danger: 'text-danger',
}

/**
 * 从底部推上来的记录详情卡。
 *
 * 桌面上点结论里的 [[编号]] 是跳到列表页并高亮那一行——因为结论和数据本来就并排。
 * 手机上没有并排：跳走会把用户从对话里踢出去，回来还得重新找到刚才读到哪。
 * 所以改成盖在对话上面的一层，关掉就回到原位，对话一个字都没动。
 *
 * 「关联」那一排是刻意做成可继续点的：核对一条订单往往要顺着看客户、看物料，
 * 这条链在桌面上靠左侧导航走，手机上只能靠记录自己把下一跳带出来。
 */
export function DetailSheet({ refId, depth, onOpen, onBack, onClose }: {
  refId: string
  /** 栈深度 > 0 时才显示返回，否则只有关闭——避免第一层出现一个点了没反应的返回。 */
  depth: number
  onOpen: (id: string) => void
  onBack: () => void
  onClose: () => void
}) {
  const { db, currentUser } = useStore()
  const d = lookupRecord(db, currentUser, refId)

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button aria-label="关闭详情" onClick={onClose} className="absolute inset-0 bg-slate-900/40" />
      <div className="relative bg-white rounded-t-2xl max-h-[80vh] flex flex-col shadow-xl">
        <div className="shrink-0 flex items-center justify-between px-4 pt-3 pb-2 border-b">
          {depth > 0
            ? <button onClick={onBack} className="text-sm text-slate-500 -ml-1 px-1">‹ 返回</button>
            : <span className="text-[11px] text-slate-400">记录详情</span>}
          <button onClick={onClose} className="text-sm text-slate-500 px-1">关闭</button>
        </div>

        {!d ? (
          // 和桌面 RefChip 的红色标记同一个态度：核不上就明说核不上，不做成一张空卡。
          <div className="p-5 text-sm text-danger leading-relaxed">
            <div className="font-medium">「{refId}」在你当前可见的数据里核对不到。</div>
            <div className="text-xs text-slate-500 mt-2">
              可能是模型引用有误，也可能这条记录不在你的权限范围内。请以「数据」页看到的记录为准。
            </div>
          </div>
        ) : (
          <div className="overflow-auto p-4 space-y-4">
            <div>
              <div className="text-[11px] text-slate-400">{d.kind}</div>
              <div className="text-lg font-semibold text-slate-900 mt-0.5">{d.title}</div>
              <div className="text-sm text-slate-500">{d.subtitle}</div>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
              {d.fields.map(f => (
                <div key={f.label}>
                  <div className="text-[11px] text-slate-400">{f.label}</div>
                  <div className={`text-sm mt-0.5 ${f.tone ? TONE[f.tone] : 'text-slate-800'}`}>
                    {f.value}
                  </div>
                </div>
              ))}
            </div>

            {d.related.length > 0 && (
              <div className="pt-1 border-t">
                <div className="text-[11px] text-slate-400 pt-3 pb-1.5">关联记录</div>
                <div className="flex flex-wrap gap-1.5">
                  {d.related.map(r => (
                    <button key={r} onClick={() => onOpen(r)}
                      className="px-2 py-1 rounded bg-brand/10 text-brand text-xs font-mono">
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
