interface Env { DASHSCOPE_API_KEY: string }

const UPSTREAM = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const key = ctx.env.DASHSCOPE_API_KEY
  if (!key) {
    return new Response(JSON.stringify({ error: 'NO_KEY' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }
  const body = await ctx.request.text()
  const upstream = await fetch(UPSTREAM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body,
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
