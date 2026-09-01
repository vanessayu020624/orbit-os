import { useState } from 'react'

export default function SelfTest() {
  const [status, setStatus] = useState('未测试')
  async function ping() {
    setStatus('请求中…')
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'glm-4.5-flash',
          messages: [{ role: 'user', content: '只回复两个字：连通' }],
        }),
      })
      const j = await r.json()
      setStatus(j?.choices?.[0]?.message?.content ?? `HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`)
    } catch (e) {
      setStatus('失败：' + String(e))
    }
  }
  return (
    <div className="p-10 space-y-4">
      <h1 className="text-2xl font-bold text-brand">OrbitOS 部署自检</h1>
      <button onClick={ping} className="px-4 py-2 rounded bg-brand text-white">测试 /api/chat</button>
      <pre className="p-3 bg-white rounded border text-sm whitespace-pre-wrap">{status}</pre>
    </div>
  )
}
