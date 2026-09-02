import { chat } from './llm'
import type { Turn } from './prompts'

/**
 * 原样喂给模型的最近轮数。
 *
 * 从 2 提到 6 的原因：2 轮只够接住「采用方案1」这种紧邻的指代，而演示里真实的追问链
 * 往往是「查风险 → 看某个订单 → 问这个客户的应收 → 回头说方案1」，第四问时第一问已经掉出上下文，
 * 模型会把「方案1」理解成刚才那个客户的事。
 *
 * 不无限往上加的原因是成本与噪音：executor 的 system prompt 本身就带工具目录，
 * 历史每多一轮都要乘进后面每一次 function calling 的往返。6 轮之外的部分改用摘要承接。
 */
export const HISTORY_TURNS = 6

/** 摘要长度上限。超出会被截断——宁可截断也不让它无限增长，它是每次请求都要付费的固定开销。 */
export const SUMMARY_MAX = 300

export function summarizePrompt(prev: string | undefined, dropped: Turn[]): string {
  return `你在为一个企业运营智能助手维护会话记忆。

${prev ? `已有摘要：\n${prev}\n` : '目前还没有摘要。\n'}
刚刚移出上下文窗口的对话：
${dropped.map(t => `用户：${t.q}\n助手：${t.a.slice(0, 800)}`).join('\n\n')}

请把两者合并成一段不超过 200 字的中文摘要，只保留后续追问可能会用到的事实：
用户关心的对象（客户、订单、SKU、供应商、单号）、已经给出的结论要点、已经执行过的写操作。
不要写寒暄，不要复述工具名，不要编造原文里没有的内容。直接输出摘要正文，不要任何前缀。`
}

/**
 * 把移出窗口的轮次滚动折叠进摘要。
 *
 * 失败一律返回原摘要而不是抛出：摘要是锦上添花，它挂了不该让用户的下一次提问也跟着挂。
 * 调用方是 fire-and-forget，用户完全感知不到这次调用。
 */
export async function summarizeTurns(prev: string | undefined, dropped: Turn[]): Promise<string | undefined> {
  if (!dropped.length) return prev
  try {
    const res = await chat({
      messages: [{ role: 'user', content: summarizePrompt(prev, dropped) }],
      temperature: 0.1,
      // 不计入用量：这次调用发生在上一问的 finally 之后，若计入会被算进下一问的
      // 「本次问询消耗 N tokens」里，把成本归到错误的那一问上。
      countUsage: false,
    })
    const text = (res.content ?? '').trim()
    return text ? text.slice(0, SUMMARY_MAX) : prev
  } catch {
    return prev
  }
}

/**
 * 记录一轮之后重新切分：保留最近 HISTORY_TURNS 轮，多出来的交给摘要。
 * 抽成纯函数是为了不依赖 React 就能测这个切分边界。
 */
export function splitHistory(history: Turn[]): { kept: Turn[]; dropped: Turn[] } {
  if (history.length <= HISTORY_TURNS) return { kept: history, dropped: [] }
  return {
    kept: history.slice(-HISTORY_TURNS),
    dropped: history.slice(0, history.length - HISTORY_TURNS),
  }
}
