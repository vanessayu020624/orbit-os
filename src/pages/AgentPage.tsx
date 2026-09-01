import { useNavigate } from 'react-router-dom'
import { Sidekick } from '../sidekick/Sidekick'
import { useSidekick } from '../sidekick/SidekickProvider'

export default function AgentPage() {
  const { setOpen } = useSidekick()
  const navigate = useNavigate()

  function backToDrawer() {
    setOpen(true)
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/')
    }
  }

  return (
    <div className="h-full flex flex-col">
      <button onClick={backToDrawer}
        className="self-start mb-3 shrink-0 text-sm text-slate-500 hover:text-brand px-3 py-1.5 rounded hover:bg-slate-50 border">
        ← 回到抽屉模式
      </button>
      {/* flex-1 min-h-0 而非 h-full：在 flex 列里 h-full 会解析成容器的 100%，
          加上上方按钮的高度就会溢出，整页模式多出一条外层滚动条。 */}
      <div className="flex-1 min-h-0 w-full max-w-4xl mx-auto">
        <Sidekick />
      </div>
    </div>
  )
}
