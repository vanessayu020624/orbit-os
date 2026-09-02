import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * 线上 `/api/chat` 由 Cloudflare Pages Function（functions/api/chat.ts）提供，
 * 但 `vite dev` 不跑 Pages Functions —— 请求会落到 SPA fallback 拿回一份 index.html，
 * 前端 r.json() 解析失败 → LlmUnavailable → Sidekick 出失败卡。
 * 结果是本地永远看不到真实模型。这里把同一段转发逻辑在 dev server 上补一份，
 * 密钥从 .env.local 读（该文件已在 .gitignore 里，绝不进仓库）。
 */
function devChatApi(mode: string): Plugin {
  const key = loadEnv(mode, process.cwd(), '').DASHSCOPE_API_KEY
  return {
    name: 'orbitos-dev-chat-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/chat', (req, res, next) => {
        if (req.method !== 'POST') return next()
        const json = (status: number, payload: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(payload))
        }
        if (!key) return json(503, { error: 'NO_KEY' })

        const chunks: Buffer[] = []
        req.on('data', c => chunks.push(c as Buffer))
        req.on('end', async () => {
          try {
            const upstream = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
              body: Buffer.concat(chunks).toString('utf8'),
            })
            json(upstream.status, await upstream.json())
          } catch (e) {
            json(502, { error: 'UPSTREAM_FAILED', message: String(e) })
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), devChatApi(mode)],
  test: {
    // e2e/ 里是打真实模型的回归，要外网、要几分钟、结果不确定，不能进 `npm test`。
    // 它有自己的配置（vitest.e2e.config.ts），跑法见 README「端到端回归」。
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
}))
