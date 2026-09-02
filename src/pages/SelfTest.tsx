import { useState } from 'react'
import { MODEL } from '../agent/llm'

export default function SelfTest() {
  const [status, setStatus] = useState('未测试')
  async function ping() {
    setStatus('请求中…')
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: '只回复两个字：连通' }],
        }),
      })
      const j = await r.json()
      const text = j?.choices?.[0]?.message?.content
      if (text) { setStatus(`OK（${MODEL}）：${text}`); return }
      // 失败时把上游原始错误码带出来。线上排障卡了很久就是因为这里只报一句笼统的话：
      // 429/1302（限流）、503/NO_KEY（环境变量没配）、SPA fallback 返回 HTML，三者表现一样。
      setStatus(`HTTP ${r.status}\n${JSON.stringify(j, null, 2).slice(0, 400)}`)
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
