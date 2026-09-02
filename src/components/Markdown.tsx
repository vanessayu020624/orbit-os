import type { ReactNode } from 'react'
import { RefChip } from './RefChip'

/**
 * 结论区的极简 Markdown 渲染。
 *
 * 在此之前结论是 `whitespace-pre-wrap` 直接铺出来的，模型写的 Markdown 就原样躺在屏幕上。
 * 拿 15 条真实端到端结论数了一下：23 处 `**加粗**`、67 行 `- ` 列表、15 行 `#` 标题、
 * 64 行以「行尾两个空格」结尾。演示的四分钟里有两分钟观众盯的就是这块面板，
 * 满屏星号井号会先让人怀疑这套东西没做完——这是个可信度问题，不是审美问题。
 *
 * 不引 react-markdown：它为了完整 CommonMark 带进 30KB+，而模型实际只用到五种语法。
 *
 * 关键顺序：**先按 `[[编号]]` 切段，再对非引用段做行内 Markdown**，不能反过来。
 * 反过来的话 `**[[SO-2026-0412]]**` 会先被加粗规则拆开，chip 被切成两截，点击溯源就废了；
 * 而溯源恰恰是这个项目最核心的可信度机制，宁可少支持几种语法也不能让它碎掉。
 */

type Block =
  | { k: 'h'; level: number; text: string }
  | { k: 'list'; ordered: boolean; items: string[] }
  | { k: 'p'; lines: string[] }
  | { k: 'table'; head: string[]; rows: string[][] }
  | { k: 'hr' }

const H  = /^(#{1,4})\s+(.*)$/
const UL = /^\s*[-*•]\s+(.*)$/
const OL = /^\s*\d+[.)]\s+(.*)$/
const TR = /^\s*\|(.+)\|\s*$/
const HR = /^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/
const SEP = /^:?-{2,}:?$/

const cells = (line: string) =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())

/**
 * 按行扫成块。导出是为了能单测——项目没配 jsdom，组件渲染测不了，
 * 但「这段文本被切成了什么块」是纯逻辑，值得钉死：这里错一个正则，
 * 演示时整段结论就会塌成一坨纯文本，而单测是唯一能提前发现它的地方。
 */
export function parseBlocks(src: string): Block[] {
  const out: Block[] = []
  let open: Block | null = null
  const flush = () => { if (open) { out.push(open); open = null } }

  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    // 行尾双空格是 Markdown 的软换行标记。我们本来就逐行断行，留着它只会渲染出多余空白。
    const line = raw.replace(/\s+$/, '')
    if (!line) { flush(); continue }

    let m: RegExpMatchArray | null
    if (HR.test(line)) { flush(); out.push({ k: 'hr' }); continue }
    if ((m = line.match(H))) { flush(); out.push({ k: 'h', level: m[1].length, text: m[2] }); continue }

    if ((m = line.match(UL))) {
      if (open?.k === 'list' && !open.ordered) open.items.push(m[1])
      else { flush(); open = { k: 'list', ordered: false, items: [m[1]] } }
      continue
    }
    if ((m = line.match(OL))) {
      if (open?.k === 'list' && open.ordered) open.items.push(m[1])
      else { flush(); open = { k: 'list', ordered: true, items: [m[1]] } }
      continue
    }
    if (TR.test(line)) {
      const c = cells(line)
      // |---|---| 这行不是数据，它只是宣布上一行是表头。当成数据行渲染会多出一排横杠。
      if (c.every(x => SEP.test(x))) continue
      if (open?.k === 'table') open.rows.push(c)
      else { flush(); open = { k: 'table', head: c, rows: [] } }
      continue
    }

    if (open?.k === 'p') open.lines.push(line)
    else { flush(); open = { k: 'p', lines: [line] } }
  }
  flush()
  return out
}

export type Token =
  | { t: 'ref'; v: string; bold?: true }
  | { t: 'strong'; v: string }
  | { t: 'code'; v: string; bold?: true }
  | { t: 'text'; v: string; bold?: true }

const REF = /(\[\[[^\]]+\]\])/g
const EMPH = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g
// 「加粗跨过了引用」：**共 [[AR-002]] 笔** 这种写法
const BOLD_WITH_REF = /\*\*[^*\n]*\[\[[^\]]+\]\][^*\n]*\*\*/

/**
 * 行内切词。**引用优先于加粗**——这是本文件唯一真正要命的地方，所以单独导出成纯函数
 * 钉在单测里：先切加粗的话 `[[AR-002]]` 会在星号处被劈成两半，chip 不成立，
 * 点击溯源整条链就废了，而溯源是这个项目最核心的可信度机制。
 *
 * 唯一的例外是加粗横跨引用（`**共 [[AR-002]] 笔**`）：这时两种顺序都不对——
 * 先切引用会把两个星号原样留在正文里，先切加粗又会劈碎引用。所以对这种跨界写法
 * 单独先摘掉星号、把内部内容整体标成加粗，再照常切引用。
 */
export function splitInline(text: string): Token[] {
  const out: Token[] = []
  for (const seg of text.split(new RegExp(`(${BOLD_WITH_REF.source})`, 'g'))) {
    if (!seg) continue
    const bold = new RegExp(`^${BOLD_WITH_REF.source}$`).test(seg)
    push(bold ? seg.slice(2, -2) : seg, bold, out)
  }
  return out
}

function push(text: string, bold: boolean, out: Token[]) {
  const b = bold ? { bold: true as const } : {}
  for (const seg of text.split(REF)) {
    if (!seg) continue
    const ref = seg.match(/^\[\[([^\]]+)\]\]$/)
    if (ref) { out.push({ t: 'ref', v: ref[1], ...b }); continue }
    for (const s of seg.split(EMPH)) {
      if (!s) continue
      if (/^\*\*[^*\n]+\*\*$/.test(s)) out.push({ t: 'strong', v: s.slice(2, -2) })
      else if (/^`[^`\n]+`$/.test(s)) out.push({ t: 'code', v: s.slice(1, -1), ...b })
      else out.push({ t: 'text', v: s, ...b })
    }
  }
}

const BOLD = 'font-semibold text-slate-900'

function inline(text: string): ReactNode[] {
  return splitInline(text).map((tk, i) => {
    switch (tk.t) {
      case 'ref':    return tk.bold
        ? <strong key={i} className={BOLD}><RefChip id={tk.v} /></strong>
        : <RefChip key={i} id={tk.v} />
      case 'strong': return <strong key={i} className={BOLD}>{tk.v}</strong>
      case 'code':   return <code key={i} className={`px-1 py-0.5 rounded bg-slate-100 text-[12px] font-mono ${tk.bold ? BOLD : ''}`}>{tk.v}</code>
      case 'text':   return tk.bold
        ? <strong key={i} className={BOLD}>{tk.v}</strong>
        : <span key={i}>{tk.v}</span>
    }
  })
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed text-slate-800 space-y-2">
      {parseBlocks(text).map((b, i) => {
        switch (b.k) {
          case 'hr':
            return <hr key={i} className="border-slate-200" />

          // 四级标题全部压成同一号字，只用字重和颜色分层：侧栏只有 380px 宽，
          // 真按 h1/h2/h3 放大字号，一个 `# 结论` 会顶掉半屏，比不渲染还糟。
          case 'h':
            return (
              <div key={i} className={b.level <= 2
                ? 'font-semibold text-slate-900 pt-1'
                : 'font-medium text-slate-500 text-[13px] pt-0.5'}>
                {inline(b.text)}
              </div>
            )

          case 'list': {
            const List = b.ordered ? 'ol' : 'ul'
            return (
              <List key={i} className="space-y-1">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-1.5">
                    <span className="shrink-0 select-none text-slate-300 tabular-nums">
                      {b.ordered ? `${j + 1}.` : '•'}
                    </span>
                    <span className="min-w-0 flex-1">{inline(it)}</span>
                  </li>
                ))}
              </List>
            )
          }

          case 'table':
            // 表格是唯一可能横向超出侧栏的块。让它自己滚，而不是把整个面板撑宽——
            // 面板一宽，左边的业务数据区就被挤，点编号跳转过去反而看不全。
            return (
              <div key={i} className="overflow-x-auto -mx-0.5">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr>{b.head.map((h, j) => (
                      <th key={j} className="border-b px-1.5 py-1 text-left font-medium
                                             text-slate-500 whitespace-nowrap">{inline(h)}</th>
                    ))}</tr>
                  </thead>
                  <tbody>{b.rows.map((r, j) => (
                    <tr key={j}>{r.map((c, k) => (
                      <td key={k} className="border-b border-slate-100 px-1.5 py-1 align-top">{inline(c)}</td>
                    ))}</tr>
                  ))}</tbody>
                </table>
              </div>
            )

          case 'p':
            return (
              <p key={i}>
                {b.lines.map((l, j) => (
                  <span key={j}>{j > 0 && <br />}{inline(l)}</span>
                ))}
              </p>
            )
        }
      })}
    </div>
  )
}
