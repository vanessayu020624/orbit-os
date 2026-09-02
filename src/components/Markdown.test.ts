import { describe, it, expect } from 'vitest'
import { parseBlocks, splitInline } from './Markdown'

// 这些用例的输入全部抄自真实端到端跑出来的结论（e2e/regression.test.ts 的产物），
// 不是我坐在这儿编的 Markdown 教科书例子。模型实际只写这几种语法，
// 守住它们就够了；守不住的那天，演示面板上会直接出现一排星号。

describe('行内：引用必须先于加粗被切出来', () => {
  it('加粗包住引用时，引用仍是完整的一个 token', () => {
    // 反着切就会得到 ['**','AR-002','**'] 这种碎片，chip 不成立，点击溯源整条链废掉
    expect(splitInline('**[[AR-002]]**')).toEqual([{ t: 'ref', v: 'AR-002', bold: true }])
  })
  it('引用与普通文本混排，顺序和内容都不变', () => {
    expect(splitInline('赢单 [[OPP-011]]、[[OPP-014]] 两条')).toEqual([
      { t: 'text', v: '赢单 ' },
      { t: 'ref', v: 'OPP-011' },
      { t: 'text', v: '、' },
      { t: 'ref', v: 'OPP-014' },
      { t: 'text', v: ' 两条' },
    ])
  })
  it('加粗与行内代码各自成 token，标记符号不留在正文里', () => {
    expect(splitInline('营收 **46,613,657 元**，缺料 `SKU-203`')).toEqual([
      { t: 'text', v: '营收 ' },
      { t: 'strong', v: '46,613,657 元' },
      { t: 'text', v: '，缺料 ' },
      { t: 'code', v: 'SKU-203' },
    ])
  })
  it('加粗横跨引用时，星号不会漏进正文，引用也不被劈碎', () => {
    expect(splitInline('**共 [[AR-002]] 笔**')).toEqual([
      { t: 'text', v: '共 ', bold: true },
      { t: 'ref', v: 'AR-002', bold: true },
      { t: 'text', v: ' 笔', bold: true },
    ])
  })
  it('落单的星号是正文，不当成加粗', () => {
    expect(splitInline('毛利率 * 系数')).toEqual([{ t: 'text', v: '毛利率 * 系数' }])
  })
})

describe('块解析', () => {
  it('连续的 - 行并成一个列表，而不是一行一个块', () => {
    const b = parseBlocks('- 赢单：3个\n- 输单：2个\n- 方案报价：5个')
    expect(b).toEqual([{ k: 'list', ordered: false, items: ['赢单：3个', '输单：2个', '方案报价：5个'] }])
  })
  it('有序列表单独成块，序号由渲染层重排（模型有时会全写 1.）', () => {
    const b = parseBlocks('1. 先催收\n1. 再评估信用')
    expect(b).toEqual([{ k: 'list', ordered: true, items: ['先催收', '再评估信用'] }])
  })
  it('空行断开两个同类列表，不会把它们粘成一个', () => {
    expect(parseBlocks('- 甲\n\n- 乙')).toHaveLength(2)
  })
  it('# 到 #### 都识别成标题并保留层级', () => {
    expect(parseBlocks('## 结论\n#### 依据')).toEqual([
      { k: 'h', level: 2, text: '结论' },
      { k: 'h', level: 4, text: '依据' },
    ])
  })
  it('行尾双空格（模型 15 条结论里用了 64 次）被吃掉，不渲染成多余空白', () => {
    expect(parseBlocks('本月营收 2566.9 万元  ')).toEqual([{ k: 'p', lines: ['本月营收 2566.9 万元'] }])
  })
  it('段内换行保留在同一个段落里，段间空行才断段', () => {
    expect(parseBlocks('第一行\n第二行\n\n第二段')).toEqual([
      { k: 'p', lines: ['第一行', '第二行'] },
      { k: 'p', lines: ['第二段'] },
    ])
  })
  it('表格：首行是表头，|---| 分隔行被丢掉而不是渲染成一排横杠', () => {
    expect(parseBlocks('| 阶段 | 数量 |\n|---|---:|\n| 赢单 | 9 |\n| 输单 | 9 |')).toEqual([
      { k: 'table', head: ['阶段', '数量'], rows: [['赢单', '9'], ['输单', '9']] },
    ])
  })
  it('引用标记原样留在块内容里，交给行内层处理', () => {
    expect(parseBlocks('- 赢单：3个 [[OPP-011]]')).toEqual([
      { k: 'list', ordered: false, items: ['赢单：3个 [[OPP-011]]'] },
    ])
  })
  it('没有任何 Markdown 的纯文本原样成段，渲染结果和以前一致', () => {
    expect(parseBlocks('你名下当前共有18个销售商机，总金额1825万元。')).toEqual([
      { k: 'p', lines: ['你名下当前共有18个销售商机，总金额1825万元。'] },
    ])
  })
})
