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
      <div className="h-full max-w-4xl mx-auto">
        <Sidekick />
      </div>
    </div>
  )
}
