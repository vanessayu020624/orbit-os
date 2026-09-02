#!/usr/bin/env python3
"""把 docs/pm-pack/ 下的章节片段合成一份 PDF。

用法：python3 docs/pm-pack/build.py
输出：docs/OrbitOS-AI产品交付物全集.pdf
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "OrbitOS-AI产品交付物全集.pdf"

# 顺序即成册顺序
SECTIONS = [
    "00-cover.html",
    "01-toc.html",
    "02-preface.html",
    "03-research.html",
    "04-process.html",
    "05-prd.html",
    "06-prototype.html",
    "07-feasibility.html",
    "08-metrics.html",
    "09-beyond.html",
    "10-skills.html",
    "11-audit.html",
    "12-appendix.html",
]


# ASCII 图里混排中文时，CJK 字形宽 1em，而 DejaVu Sans Mono 每格 0.6021em，
# 直接混排会让竖线错位。构建期把每个全角字符包进定宽 span（= 2 格），强制对齐。
CJK = re.compile(
    r"[⺀-鿿　-〿＀-｠￠-￦]"
)
ASCII_BLOCK = re.compile(r'(<div class="ascii">)(.*?)(</div>)', re.S)


def _pad_cjk(m: "re.Match[str]") -> str:
    inner = CJK.sub(lambda c: f'<span class="w">{c.group(0)}</span>', m.group(2))
    return m.group(1) + inner + m.group(3)


def main() -> int:
    css = (HERE / "style.css").read_text(encoding="utf-8")
    parts = []
    for name in SECTIONS:
        p = HERE / name
        if not p.exists():
            print(f"  ! 缺片段 {name}，跳过", file=sys.stderr)
            continue
        parts.append(f"<!-- ===== {name} ===== -->\n" + p.read_text(encoding="utf-8"))
    body = ASCII_BLOCK.sub(_pad_cjk, "\n".join(parts))

    html = (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        "<title>OrbitOS AI 产品交付物全集</title>"
        f"<style>{css}</style></head><body>{body}</body></html>"
    )
    tmp = HERE / "_merged.html"
    tmp.write_text(html, encoding="utf-8")

    from weasyprint import HTML

    HTML(filename=str(tmp)).write_pdf(str(OUT))

    # 统计
    n_head = len(re.findall(r"<h[12][ >]", body))
    print(f"✓ {OUT}")
    print(f"  片段 {len(parts)} 个 · 标题 {n_head} 个 · HTML {len(html)/1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
