"use strict";
const assert = require("assert");
const { convertLatexDelimiters, countConvertible } = require("../src/converter.js");

const c = (s, o) => convertLatexDelimiters(s, o).output;

let pass = 0;
function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, `${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  pass++;
}

// 1 行内
eq(c("行内 \\(a+b\\) 结束"), "行内 $a+b$ 结束", "inline basic");

// 2 行间单行（独立成块）
eq(c("\\[E=mc^2\\]"), "$$E=mc^2$$", "display single line");

// 3 多个混合
eq(
  c("先 \\(x\\) 再 \\(y=1\\)，然后 \\[\\int_0^1 f(x)dx\\] 完"),
  "先 $x$ 再 $y=1$，然后\n$$\\int_0^1 f(x)dx$$\n完",
  "multiple mixed"
);

// 4 跨行 display
eq(
  c("\\[\na = b\n\\]"),
  "$$a = b$$",
  "multiline display preserved"
);

// 5 已存在的 $ 公式不被破坏
eq(c("已有 $a \\(b\\) c$ 和 \\(d\\)"), "已有 $a \\(b\\) c$ 和 $d$", "skip existing $ math");

// 6 代码块跳过
eq(
  c("```tex\n\\(a\\)\n\\[b\\]\n```\n\\(c\\)"),
  "```tex\n\\(a\\)\n\\[b\\]\n```\n$c$",
  "fenced code untouched"
);

// 7 行内代码跳过
eq(c("看 `\\(a\\)` 和 \\(b\\)"), "看 `\\(a\\)` 和 $b$", "inline code untouched");

// 8 未配对不制造孤立 $
eq(c("孤立的 \\( 保持"), "孤立的 \\( 保持", "unpaired open preserved");
eq(c("孤立的 \\] 保持"), "孤立的 \\] 保持", "unpaired close preserved");
eq(c("只有 \\[ 开"), "只有 \\[ 开", "unpaired open bracket preserved");

// 9 frontmatter 跳过
eq(
  c("---\ntitle: \\(x\\)\n---\n\\(y\\)"),
  "---\ntitle: \\(x\\)\n---\n$y$",
  "frontmatter untouched"
);

// 10 转义反斜杠 \\ 不影响
eq(c("\\\\\\(a\\)"), "\\\\$a$", "double backslash then paren");

// 11 嵌套括号
eq(c("\\(f(g(x)) + \\{1\\}\\)"), "$f(g(x)) + \\{1\\}$", "nested braces & parens");

// 12 空公式清理
eq(c("\\[\\]"), "", "empty display removed");

// 13 TeX 里的 \text{} 含中文
eq(c("\\(\\text{速度} = v\\)"), "$\\text{速度} = v$", "text with CJK");

// 14 $$ 行内既有 display 被跳过
eq(c("$$a \\(b\\)$$ 与 \\(c\\)"), "$$a \\(b\\)$$ 与 $c$", "skip existing $$ math");

// 15 html 注释跳过
eq(c("<!-- \\(a\\) -->\n\\(b\\)"), "<!-- \\(a\\) -->\n$b$", "html comment untouched");

// 16 wikilink 跳过
eq(c("[[note \\(a\\)]] 和 \\(b\\)"), "[[note \\(a\\)]] 和 $b$", "wikilink untouched");

// 17 计数
const cnt = countConvertible("x \\(a\\) y \\[b\\] z");
assert.deepStrictEqual(cnt, { inline: 1, display: 1 });
pass++;

// 18 幂等性：转换后再跑一遍不变
const once = c("A \\(a\\) B \\[b\\] C");
const twice = c(once);
eq(twice, once, "idempotent");

// 19 行间块与文字粘连时拆行
eq(c("前文\\[a=b\\]后文"), "前文\n$$a=b$$\n后文", "display block isolated");

// 20 多行 display 内容两侧文字
eq(c("前文\\[a=b\nc=d\\]后文"), "前文\n$$\na=b\nc=d\n$$\n后文", "multiline display isolated");

// 21 数学中的反斜杠命令保留
eq(c("\\(\\frac{1}{2} \\times \\pi\\)"), "$\\frac{1}{2} \\times \\pi$", "latex commands kept");

// 22 真实笔记片段
const note = [
  "# 向量",
  "",
  "已知 \\(\\vec{a}=(1,2)\\)，则",
  "",
  "\\[",
  "\\vec{a}\\cdot\\vec{b}=|a||b|\\cos\\theta",
  "\\]",
  "",
  "```python",
  "print('\\\\(x\\\\)')",
  "```",
  "",
  "完成。",
].join("\n");
const converted = c(note);
assert.ok(converted.includes("已知 $\\vec{a}=(1,2)$，则"), "note inline");
assert.ok(converted.includes("$$\\vec{a}\\cdot\\vec{b}=|a||b|\\cos\\theta$$"), "note display");
assert.ok(converted.includes("print('\\\\(x\\\\)')"), "note code kept");
pass++;


// ---- 追加：多行块与 mathOnly ----
const c2 = (s, o) => convertLatexDelimiters(s, o).output;

// 23 多行 display 保留块内换行（矩阵）
eq(
  c2("\\[\nA =\n\\begin{bmatrix}\n1 & 0 \\\\\n0 & 1\n\\end{bmatrix}\n\\]"),
  "$$\nA =\n\\begin{bmatrix}\n1 & 0 \\\\\n0 & 1\n\\end{bmatrix}\n$$",
  "multiline matrix block preserved"
);

// 24 单行表达式被 \\[ \\] 包在独立行时折叠为一行
eq(c2("\\[\nE = mc^2\n\\]"), "$$E = mc^2$$", "single expr collapses");

// 25 mathOnly 跳过明显非数学
eq(
  c2("\\[x for x in y\\] 与 \\(a+b\\)", { mathOnly: true }),
  "\\[x for x in y\\] 与 $a+b$",
  "mathOnly skips code-like fragment"
);

// 26 mathOnly 保留单变量
eq(c2("\\(G\\) 与 \\(X\\) 与 \\(S_n\\)", { mathOnly: true }), "$G$ 与 $X$ 与 $S_n$", "mathOnly keeps variables");

// 27 mathOnly 对纯英文句子跳过
eq(
  c2("\\(this is a sentence\\) 与 \\(x^2\\)", { mathOnly: true }),
  "\\(this is a sentence\\) 与 $x^2$",
  "mathOnly skips prose"
);

// 28 未闭合块保持原样
eq(c2("开头 \\[\na=b"), "开头 \\[\na=b", "unclosed display preserved");

// 29 表格里的行内公式
eq(c2("| \\(x\\) | \\(y\\) |"), "| $x$ | $y$ |", "table cells");

// 30 行间块前后空行保留
eq(c2("前\n\n\\[a=b\\]\n\n后"), "前\n\n$$a=b$$\n\n后", "blank lines around display");

// 31 表格单元格内的 \[ \] 必须降级为行内，绝不换行撑断表格
eq(c2("| 一 | \\[p^a\\] |"), "| 一 | $p^a$ |", "table cell display downgraded");
eq(c2("| a | \\[x=1\\] | b |"), "| a | $x=1$ | b |", "table multi column display");
eq(c2("|a|\\[x\\]|"), "|a|$x$|", "tight table display");
eq(
  c2("| x | \\[\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}\\] |"),
  "| x | $\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}$ |",
  "table cell matrix stays inline"
);
eq(
  c2("| x | \\[\n1 & 2 \\\\\n3 & 4\n\\] |"),
  "| x | $1 & 2 \\\\ 3 & 4$ |",
  "table cell multiline display collapsed"
);

// 32 表格外的 \[ \] 仍然生成独立 $$ 块
eq(c2("前文 \\[x=1\\] 后文"), "前文\n$$x=1$$\n后文", "outside table still displays");

console.log(`✅ ${pass} tests passed (incl. extensions)`);
