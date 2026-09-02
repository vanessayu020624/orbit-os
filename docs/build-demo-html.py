#!/usr/bin/env python3
"""把 docs/demo-script.md 渲染成一份能直接投屏、也能直接打印成 PDF 的单文件 HTML。

为什么要有这个脚本而不是手写 HTML：讲稿在面试前还会改，手抄一遍就意味着
两份内容迟早对不上——现场照着 HTML 念、而 md 里已经改过数字，是最糟的一种不一致。
所以 md 是唯一事实来源，HTML 每次从它生成。

    python3 docs/build-demo-html.py        # 覆盖 docs/demo-script.html

依赖：python-markdown（pip install markdown）。产物不引用任何外部资源，
断网、投影仪、离线笔记本上都能打开。
"""
import re
import pathlib
import markdown

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / 'demo-script.md'
OUT = ROOT / 'demo-script.html'

# 讲稿里成段出现的四种角色，各自一种视觉：做=动手、说=台词、屏幕=预期画面、卡住=兜底。
# 现场眼睛是扫的不是读的，颜色和图标要能在半秒内区分「这句我要念」和「这条我要点」。
# 用前缀匹配而不是全等，是因为原文里有「说（先不点）：」「做（可选，如果时间够）：」
# 这样带限定语的写法——限定语恰恰是最该看见的部分，所以整段标签原样搬到角标上。
KIND = {'做': 'act', '说': 'say', '屏幕上会出现': 'screen', '卡住了怎么办': 'stuck'}
LABEL_RE = re.compile(r'^\*\*([^*：:]{1,30})[：:]\*\*(.*)$')


def slug(value: str, sep: str) -> str:
    """默认的 slugify 会把中文整段扔掉——一屋子中文标题最后全变成 id="_2" 这种，
    锚点链接发出去谁也看不出指向哪一节。这里保留中文，只丢标点。"""
    v = re.sub(r'[^\w\s-]', '', value.strip().lower())
    return re.sub(r'[\s-]+', sep, v) or 'sec'


def classify(label: str):
    """→ (类名, 角标)。认不出的标签不套角标，保持原样加个浅底，别把长句塞进小圆角里。"""
    for prefix, cls in KIND.items():
        if label.startswith(prefix):
            return cls, label
    return 'note', None


TIMELINE = [
    ('剧本 A', '交期风险穿透排查', '4 min', 'a'),
    ('剧本 B', '两张聚合分析', '1.5 min', 'b'),
    ('剧本 C', '同问题不同角色', '2 min', 'c'),
    ('剧本 D', '追问链与记忆', '1 min', 'd'),
    ('剧本 E', '歧义先消解', '1 min', 'e'),
    ('收尾', '三句话收束', '0.5 min', 'x'),
]


def wrap_blocks(md_text: str) -> str:
    """把「**说：** + 紧随其后的引用/列表」这样的段落打包成带类名的 div。

    用 md_in_html 让 markdown 继续渲染 div 内部，而不是把它当成原始 HTML 整块跳过。
    """
    lines = md_text.split('\n')
    out, i = [], 0
    while i < len(lines):
        m = LABEL_RE.match(lines[i])
        if not m:
            out.append(lines[i]); i += 1; continue
        cls, tag = classify(m.group(1))
        rest = m.group(2).strip()
        # 认出角色的块：标签移到角标上，正文里不再重复一遍；认不出的原样保留。
        head = (rest if tag else lines[i]) if (rest or not tag) else None
        body = [head] if head else []
        i += 1
        # 同一块里继续吃：紧挨着的非空行，以及「空行 + 引用/列表」这种常见排版。
        while i < len(lines):
            if lines[i].strip():
                if LABEL_RE.match(lines[i]) or lines[i].startswith(('#', '---', '|')):
                    break
                body.append(lines[i]); i += 1
            elif i + 1 < len(lines) and lines[i + 1][:2] in ('> ', '- ', '1.'):
                body.append(''); body.append(lines[i + 1]); i += 2
            else:
                break
        chip = f'<span class="tag">{tag}</span>' if tag else ''
        out += [f'<div class="block {cls}" markdown="1">', chip, '', *body, '', '</div>', '']
    return '\n'.join(out)


def main() -> None:
    text = SRC.read_text(encoding='utf-8')
    # [[SO-2026-0412]] 是产品里的溯源标签，在讲稿里也该长成标签的样子。
    text = re.sub(r'\[\[([^\]]+)\]\]', r'<code class="ref">\1</code>', text)
    md = markdown.Markdown(extensions=['tables', 'fenced_code', 'sane_lists',
                                       'attr_list', 'md_in_html', 'toc'],
                           extension_configs={'toc': {'toc_depth': '2-3', 'slugify': slug}})
    html = md.convert(wrap_blocks(text))
    html = html.replace('<table>', '<div class="tw"><table>').replace('</table>', '</table></div>')
    # 第一行 h1 由页头承担，正文里不再重复一次。
    html = re.sub(r'<h1[^>]*>.*?</h1>', '', html, count=1, flags=re.S)

    chips = '\n'.join(
        f'<div class="chip c-{k}"><b>{n}</b><span>{d}</span><i>{t}</i></div>'
        for n, d, t, k in TIMELINE)
    OUT.write_text(PAGE.format(toc=md.toc, body=html, chips=chips), encoding='utf-8')
    print(f'{OUT}  {OUT.stat().st_size // 1024} KB')


PAGE = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OrbitOS 现场演示脚本</title>
<style>
:root {{
  --ink:#1b2430; --ink-2:#4a5768; --ink-3:#8593a5; --line:#e3e6ec;
  --paper:#ffffff; --wash:#f6f7f9; --brand:#0073ea; --ok:#00a35c;
  --warn:#c97a10; --danger:#d43b52; --purple:#7c4dc4;
}}
* {{ box-sizing:border-box; }}
html {{ -webkit-text-size-adjust:100%; }}
body {{
  margin:0; background:var(--wash); color:var(--ink);
  font:15px/1.85 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;
}}
code, .mono {{ font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace; }}

/* ---------- 页头 ---------- */
.hero {{ background:linear-gradient(150deg,#0b1b2e,#123a63 55%,#0e5aa7); color:#fff; padding:44px 0 34px; }}
.hero .in {{ max-width:1180px; margin:0 auto; padding:0 28px; }}
.hero h1 {{ margin:0; font-size:30px; letter-spacing:.4px; font-weight:700; }}
.hero p {{ margin:10px 0 0; color:#bcd4ee; font-size:14px; max-width:70ch; line-height:1.8; }}
.chips {{ display:flex; flex-wrap:wrap; gap:8px; margin-top:22px; }}
.chip {{ background:rgba(255,255,255,.10); border:1px solid rgba(255,255,255,.18);
  border-radius:9px; padding:8px 12px; min-width:132px; }}
.chip b {{ display:block; font-size:13px; }}
.chip span {{ display:block; font-size:11.5px; color:#a9c6e6; margin-top:1px; }}
.chip i {{ display:block; font-style:normal; font-size:11px; color:#7fd3ff; margin-top:4px; }}
.chip.c-a {{ border-left:3px solid #4ea3ff; }} .chip.c-b {{ border-left:3px solid #b58bff; }}
.chip.c-c {{ border-left:3px solid #4be0a5; }} .chip.c-d {{ border-left:3px solid #ffd166; }}
.chip.c-e {{ border-left:3px solid #ff8a7a; }} .chip.c-x {{ border-left:3px solid #9fb2c8; }}

/* ---------- 骨架 ---------- */
.wrap {{ max-width:1180px; margin:0 auto; padding:26px 28px 80px; display:grid;
  grid-template-columns:236px minmax(0,1fr); gap:32px; align-items:start; }}
nav.toc {{ position:sticky; top:20px; max-height:calc(100vh - 40px); overflow:auto;
  font-size:12.5px; line-height:1.6; }}
nav.toc .toc > ul {{ list-style:none; margin:0; padding:0; }}
nav.toc h4 {{ margin:0 0 8px; padding-left:6px; font-size:11px; letter-spacing:1.5px;
  color:var(--ink-3); font-weight:600; }}
nav.toc ul ul {{ list-style:none; margin:2px 0 6px; padding-left:11px; border-left:1px solid var(--line); }}
nav.toc li {{ margin:3px 0; }}
nav.toc a {{ color:var(--ink-2); text-decoration:none; display:block; padding:2px 6px; border-radius:5px; }}
nav.toc a:hover {{ background:#eaf2fd; color:var(--brand); }}
nav.toc .toc > ul > li > a {{ color:var(--ink); font-weight:600; }}
main {{ background:var(--paper); border:1px solid var(--line); border-radius:14px;
  padding:14px 40px 46px; box-shadow:0 1px 2px rgba(16,32,56,.05); min-width:0; }}

/* ---------- 正文 ---------- */
h2 {{ font-size:21px; margin:46px 0 14px; padding-top:22px; border-top:1px solid var(--line);
  letter-spacing:.2px; scroll-margin-top:16px; }}
h2:first-of-type {{ border-top:0; margin-top:26px; padding-top:0; }}
h3 {{ font-size:16px; margin:30px 0 10px; color:#12325a; scroll-margin-top:16px; }}
p {{ margin:11px 0; }}
strong {{ color:#0d2b52; font-weight:650; }}
hr {{ display:none; }}
a {{ color:var(--brand); }}
ul, ol {{ padding-left:22px; margin:10px 0; }}
li {{ margin:5px 0; }}
code {{ background:#f1f3f7; border:1px solid #e4e8ef; border-radius:4px;
  padding:1px 5px; font-size:12.5px; color:#2b3a55; }}
code.ref {{ background:#e8f2ff; border-color:#c9e0fb; color:var(--brand); }}
blockquote {{ margin:10px 0; padding:2px 0 2px 15px; border-left:3px solid #dfe4ec; color:var(--ink-2); }}
blockquote p {{ margin:7px 0; }}

/* ---------- 四类段落 ---------- */
.block {{ position:relative; margin:16px 0; padding:14px 18px 14px 17px;
  border-radius:10px; border:1px solid var(--line); background:#fcfdff; }}
.block > :first-child {{ margin-top:0; }}
.block > :last-child {{ margin-bottom:0; }}
/* 角标独占一个 <p>（markdown 生成的），把这个 p 整个抬到边框上，别让它在流里占一行高。
   浏览器不认 :has() 时会退化成框内第一行的一枚小标签——不好看，但不影响读。 */
.block > p:has(> .tag) {{ position:absolute; top:-9px; left:14px; margin:0; line-height:1; }}
.block > p:has(> .tag) + * {{ margin-top:0; }}
.block .tag {{ display:inline-block; font-size:10.5px; letter-spacing:1px;
  padding:1px 8px; border-radius:20px; background:#fff; border:1px solid var(--line); color:var(--ink-3); }}
.block.act {{ border-left:3px solid var(--brand); background:#f7fbff; }}
.block.act .tag {{ color:var(--brand); border-color:#c9e0fb; }}
.block.say {{ border-left:3px solid var(--purple); background:#faf8ff; }}
.block.say .tag {{ color:var(--purple); border-color:#e0d3f7; }}
.block.say blockquote {{ border-left-color:#d9c9f5; color:#33265a; font-size:15.5px; }}
.block.screen {{ border-left:3px solid var(--ok); background:#f6fbf8; }}
.block.screen .tag {{ color:var(--ok); border-color:#c4e8d6; }}
.block.stuck {{ border-left:3px solid var(--warn); background:#fffbf3; }}
.block.stuck .tag {{ color:var(--warn); border-color:#f0dcbb; }}
.block.note {{ border-left:3px solid #b9c2d0; background:#fafbfc; }}

/* ---------- 表格 ---------- */
.tw {{ overflow-x:auto; margin:16px 0; border:1px solid var(--line); border-radius:10px; }}
table {{ border-collapse:collapse; width:100%; font-size:13.5px; }}
th, td {{ padding:9px 12px; border-top:1px solid var(--line); text-align:left; vertical-align:top; }}
th {{ background:#f4f6f9; border-top:0; font-weight:650; color:#26364e; white-space:nowrap; }}
tbody tr:nth-child(even) {{ background:#fbfcfd; }}
td:first-child {{ color:#26364e; }}
/* 附录全表用空的首列表示「同一个角色的下一条」，这里把这类行的上边框淡掉，读起来是一组。 */
tr:has(td:first-child:empty) td {{ border-top-color:#f1f3f6; }}

/* ---------- 打印 ---------- */
@media print {{
  body {{ background:#fff; font-size:11pt; }}
  .hero {{ background:#0b1b2e !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
  .wrap {{ display:block; max-width:none; padding:0; }}
  nav.toc {{ display:none; }}
  main {{ border:0; border-radius:0; box-shadow:none; padding:0 6mm; }}
  h2 {{ break-before:page; }} h2:first-of-type {{ break-before:auto; }}
  .block, .tw, tr {{ break-inside:avoid; }}
  .block {{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
}}
@media (max-width:900px) {{
  .wrap {{ grid-template-columns:minmax(0,1fr); }}
  nav.toc {{ position:static; max-height:none; order:2; }}
  main {{ padding:10px 20px 30px; }}
}}
</style>
</head>
<body>
<header class="hero"><div class="in">
  <h1>OrbitOS 现场演示脚本</h1>
  <p>五个剧本 + 13 条预置问题全表。屏幕上出现的每一个数字都来自 <code class="mono">generateSeed(42)</code> 的确定性种子，每次演示完全一致。台词是逐句写的，但不要背——写下来是为了保证该说的三件事一件不漏。</p>
  <div class="chips">{chips}</div>
</div></header>
<div class="wrap">
  <nav class="toc"><h4>目录</h4>{toc}</nav>
  <main>{body}</main>
</div>
</body>
</html>
"""

if __name__ == '__main__':
    main()
