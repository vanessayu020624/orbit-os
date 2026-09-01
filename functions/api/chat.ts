interface Env { ZHIPU_API_KEY: string }

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const key = ctx.env.ZHIPU_API_KEY
  if (!key) {
    return new Response(JSON.stringify({ error: 'NO_KEY' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }
  const body = await ctx.request.text()
  const upstream = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body,
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
