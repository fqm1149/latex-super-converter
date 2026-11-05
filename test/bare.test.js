"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { convertBareFormulas, findSpans } = require("../src/bare.js");

let pass = 0;
function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, `${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  pass++;
}

const c = (s, o) => convertBareFormulas(s, Object.assign({ level: 2 }, o)).output;

/* ---------------- 1. 基本识别 ---------------- */

eq(c("若 H 是 G 的子群，则 |H| \\mid |G|。"), "若 H 是 G 的子群，则 $|H| \\mid |G|$。", "pipe + mid");
eq(c("即 P 的阶为 p^a。"), "即 P 的阶为 $p^a$。", "superscript");
eq(c("集合记作 \\text{Syl}_p(G)，"), "集合记作 $\\text{Syl}_p(G)$，", "text with subscript");
eq(c("其个数 n_p(G) 满足"), "其个数 $n_p(G)$ 满足", "function call");
eq(c("设 |G| = p^a m，其中 p \\nmid m，a \\ge 1："), "设 $|G| = p^a m$，其中 $p \\nmid m$，$a \\ge 1$：", "multi span line");
eq(c("即 n_7 \\in \\{1, 8, 48\\}。"), "即 $n_7 \\in \\{1, 8, 48\\}$。", "brace set");
eq(
  c("D_4 = \\langle r, s \\mid r^4 = e, s^2 = e \\rangle 是非阿贝尔群"),
  "$D_4 = \\langle r, s \\mid r^4 = e, s^2 = e \\rangle$ 是非阿贝尔群",
  "angle brackets"
);
eq(
  c("指数关系：n_p(G) = [G : N_G(P)]。"),
  "指数关系：$n_p(G) = [G : N_G(P)]$。",
  "bracket interval"
);
eq(c("即 (\\{P\\}) 只有一个"), "即 $(\\{P\\})$ 只有一个", "paren wrapping braces");
eq(c("利用 p \\nmid \\binom{p^a m}{p^a}，必存在"), "利用 $p \\nmid \\binom{p^a m}{p^a}$，必存在", "binom");
eq(c("同余 n_p \\equiv 1 \\pmod p。"), "同余 $n_p \\equiv 1 \\pmod p$。", "pmod");
eq(c("阶数为 $|S_4| = 24 = 2^3 \\cdot 3$。"), "阶数为 $|S_4| = 24 = 2^3 \\cdot 3$。", "already delimited untouched");

/* ---------------- 2. 不误伤普通文字 ---------------- */

eq(c("GitHub 上有 3 个 commit，详见 README。"), "GitHub 上有 3 个 commit，详见 README。", "prose untouched");
eq(c("我已经 try 了 2 次，还是 failed。"), "我已经 try 了 2 次，还是 failed。", "prose 2 untouched");
eq(c("You can call the API with token ABCDEF123456."), "You can call the API with token ABCDEF123456.", "english untouched");
eq(c("版本 1.2.3 发布于 2024 年。"), "版本 1.2.3 发布于 2024 年。", "version numbers untouched");
eq(c("2024-05-01 更新"), "2024-05-01 更新", "date untouched");
eq(c("拉格朗日定理（Lagrange's Theorem）表明"), "拉格朗日定理（Lagrange's Theorem）表明", "english paren untouched");
eq(c("(1) 第一条"), "(1) 第一条", "ordered list untouched");
eq(c("```js\nconst a = b^c;\n```"), "```js\nconst a = b^c;\n```", "code fence untouched");
eq(c("`n_p(x)` 是代码"), "`n_p(x)` 是代码", "inline code untouched");
eq(c("---\ntitle: a^b\n---\nx"), "---\ntitle: a^b\n---\nx", "frontmatter untouched");
eq(c("# 1.2 标题 p^a"), "# 1.2 标题 p^a", "heading untouched");

/* ---------------- 3. 已存在的 $ 公式不重复处理 ---------------- */

eq(c("已有 $a^2$ 与 p^b"), "已有 $a^2$ 与 $p^b$", "skip existing inline math");
eq(c("$$E=mc^2$$ 与 n_p"), "$$E=mc^2$$ 与 $n_p$", "skip existing display math");

/* ---------------- 4. 层级 ---------------- */

eq(c("p^a", { level: 1 }), "p^a", "level1 ignores superscript");
eq(c("若 x \\mid y 成立", { level: 1 }), "若 x $\\mid$ y 成立", "level1 still sees commands");
eq(c("若 |G| 有限", { level: 1 }), "若 $|G|$ 有限", "level1 sees pipes");
eq(c("p^a", { level: 0 }), "p^a", "level0 disabled");
eq(c("设 G 为群", { level: 3 }), "设 $G$ 为群", "level3 lone letter");
eq(c("设 G 为群", { level: 2 }), "设 G 为群", "level2 keeps lone letter");

/* ---------------- 5. 纯公式行升级为 $$ ---------------- */

eq(c("正文\nA_4 = 12\n正文"), "正文\n$A_4 = 12$\n正文", "inline when not isolated");
eq(c("正文\n\n|G| = p^a m\n\n正文"), "正文\n\n$$|G| = p^a m$$\n\n正文", "display when isolated");

/* ---------------- 6. 多行环境 ---------------- */

eq(
  c("\\begin{cases}\nn_p \\mid m \\\\\nn_p \\equiv 1 \\pmod p\n\\end{cases}"),
  "$$\n\\begin{cases}\nn_p \\mid m \\\\\nn_p \\equiv 1 \\pmod p\n\\end{cases}\n$$",
  "multiline cases becomes block"
);
eq(
  c("A =\n\\begin{bmatrix}\n1 & 0 \\\\\n0 & 1\n\\end{bmatrix}"),
  "$$\nA =\n\\begin{bmatrix}\n1 & 0 \\\\\n0 & 1\n\\end{bmatrix}\n$$",
  "multiline matrix absorbs leading line"
);

/* ---------------- 7. 幂等 ---------------- */

const once = c("若 |G| = p^a m，则 n_p \\equiv 1 \\pmod p。");
eq(c(once), once, "idempotent");

/* ---------------- 8. 真实样本 ---------------- */

const examplePath = path.join(__dirname, "..", "..", "example.md");
if (fs.existsSync(examplePath)) {
  const src = fs.readFileSync(examplePath, "utf8");
  const r = convertBareFormulas(src, { level: 2 });
  assert.ok(r.inlineCount >= 150, `example.md span count too low: ${r.inlineCount}`);
  pass++;

  // 全局美元符号必须成对
  const lines = r.output.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const n = (lines[i].match(/\$/g) || []).length;
    assert.strictEqual(n % 2, 0, `unbalanced $ on line ${i + 1}: ${lines[i]}`);
  }
  pass++;

  // 关键片段必须被识别
  const musts = [
    "$|H| \\mid |G|$",
    "$\\text{Syl}_p(G)$",
    "$n_p(G) \\equiv 1 \\pmod p$",
    "$\\Omega = \\{X \\subseteq G \\mid |X|=p^a\\}$",
    "$|Z(P)| \\ge p$",
  ];
  for (const m of musts) {
    assert.ok(r.output.includes(m), `missing: ${m}`);
    pass++;
  }

  // 不应出现被拆坏的痕迹
  const bads = ["$$\\n$$", "$$$", "n_$p", "$_p"];
  for (const b of bads) {
    assert.ok(!r.output.includes(b), `broken output contains: ${b}`);
    pass++;
  }

  // 再次运行必须幂等
  const twice = convertBareFormulas(r.output, { level: 2 });
  assert.strictEqual(twice.output, r.output, "example.md not idempotent");
  pass++;
}

/* ---------------- 9. Markdown 结构保护 ---------------- */

// 表格：分隔行绝不能被包公式
eq(c("| --- | --- |"), "| --- | --- |", "table separator untouched");
eq(c("| :--- | ---: |"), "| :--- | ---: |", "table alignment untouched");
eq(c("| :---: | --- |"), "| :---: | --- |", "table center align untouched");

// 表格：纯文字单元格不动
eq(c("| 定理 | 结论 |"), "| 定理 | 结论 |", "table text cells untouched");
eq(c("| a | b |"), "| a | b |", "short table untouched");

// 表格：单元格内公式照常识别，竖线保持
eq(c("| x^2 | y^2 |"), "| $x^2$ | $y^2$ |", "table cells converted");
eq(c("| n_p \\mid m | p \\nmid m |"), "| $n_p \\mid m$ | $p \\nmid m$ |", "table cells with commands");
eq(c("| 第一定理 | 存在 p^a 阶子群 |"), "| 第一定理 | 存在 $p^a$ 阶子群 |", "table mixed cells");

// 表格：整行不能被升级成 $$ 块
const tblLine = c("| x^2 | y^2 |");
assert.ok(!tblLine.includes("$$"), "table row must not become display math");
pass++;

// 表格：完整表格流程
const tbl = ["| 定理 | 结论 |", "| --- | --- |", "| 一 | p^a 阶 |"].join("\n");
eq(
  c(tbl),
  ["| 定理 | 结论 |", "| --- | --- |", "| 一 | $p^a$ 阶 |"].join("\n"),
  "full table preserved"
);

// 表格：单元格内的行内代码不动
eq(c("| `n_p` | x^2 |"), "| `n_p` | $x^2$ |", "table inline code untouched");

// 表格：单元格内的链接不动
eq(c("| [文档](a.com/p^2) | x^2 |"), "| [文档](a.com/p^2) | $x^2$ |", "table link untouched");

// 加粗：标记必须留在公式外面
eq(c("**|G| = p^a m**"), "**$|G| = p^a m$**", "bold wraps formula correctly");
eq(c("**p^a** 是最高幂次"), "**$p^a$** 是最高幂次", "bold prefix formula");
eq(c("**核心结论**：Sylow p-子群"), "**核心结论**：Sylow p-子群", "bold text untouched");
eq(c("**a^2 与 b^2**"), "**$a^2$ 与 $b^2$**", "two formulas inside bold");
eq(c("**重点 `code` p^a**"), "**重点 `code` $p^a$**", "bold with code");

// 斜体 / 删除线
eq(c("*斜体* 与 __粗体__"), "*斜体* 与 __粗体__", "italic untouched");
eq(c("*|G| 有限*"), "*$|G|$ 有限*", "italic wraps formula");
eq(c("~~旧值 n_p~~"), "~~旧值 $n_p$~~", "strikethrough wraps formula");
eq(c("__p^a__ 是幂"), "__$p^a$__ 是幂", "double underscore wraps formula");

// 星号作为乘号时不能当强调标记
eq(c("正文 3 * 4 = 12 结束"), "正文 $3 * 4 = 12$ 结束", "asterisk multiplication is math");

// 链接 / 图片：URL 里的 ^ _ / 不能被当公式
eq(c("[文档](https://a.com/p^2)"), "[文档](https://a.com/p^2)", "link url untouched");
eq(c("![图](a_1.png)"), "![图](a_1.png)", "image path untouched");
eq(c("[[note n_p]] 与 x^2"), "[[note n_p]] 与 $x^2$", "wikilink untouched");

// HTML 标签
eq(c("<span>p^a</span> 文字"), "<span>p^a</span> 文字", "html tag untouched");

// callout / 引用 / 列表前缀
eq(c("> [!note] 说明 |G|"), "> [!note] 说明 $|G|$", "callout marker untouched");
eq(c("> 若 |H| \\mid |G|"), "> 若 $|H| \\mid |G|$", "blockquote prefix untouched");
eq(c(">> 深层 p^a"), ">> 深层 $p^a$", "nested blockquote untouched");
eq(c("- [x] 完成 p^a"), "- [x] 完成 $p^a$", "task list untouched");
eq(c("* p-子群：|P| = p^k"), "* p-子群：$|P| = p^k$", "asterisk list marker untouched");
eq(c("- 若 |P| = p^a"), "- 若 $|P| = p^a$", "dash list untouched");
eq(c("1. 阶数为 p^a"), "1. 阶数为 $p^a$", "ordered list untouched");

// 脚注
eq(c("正文[^1] 与 n_p"), "正文[^1] 与 $n_p$", "footnote ref untouched");
eq(c("[^1]: 说明 |G| = p"), "[^1]: 说明 $|G| = p$", "footnote def untouched");

// 行首就是 | 的公式行，不能被误判成表格
eq(c("正文\n\n|G| = p^a m\n\n正文"), "正文\n\n$$|G| = p^a m$$\n\n正文", "leading pipe formula is not a table");

// 行内代码
eq(c("用 `n_p` 表示但 n_p 是公式"), "用 `n_p` 表示但 $n_p$ 是公式", "inline code protected");
eq(c("`a^b` 与 c^d"), "`a^b` 与 $c^d$", "inline code + formula");

/* ---------------- 10. example.md 结构完整性 ---------------- */

if (fs.existsSync(examplePath)) {
  const src = fs.readFileSync(examplePath, "utf8");
  const r = convertBareFormulas(src, { level: 2 });
  const before = src.split("\n");
  const after = r.output.split("\n");

  // 行数不变（不允许凭空增删行）
  assert.strictEqual(after.length, before.length, "line count must be preserved");
  pass++;

  // 表格行：竖线数量必须一致，且不能出现 $$
  for (let i = 0; i < before.length; i++) {
    if (!/^\s*\|/.test(before[i])) continue;
    const pipeCount = (s2) => (s2.match(/(?<!\\)\|/g) || []).length;
    assert.strictEqual(pipeCount(after[i]), pipeCount(before[i]), `table pipes changed on line ${i + 1}`);
    assert.ok(!after[i].includes("$$"), `table row became display math on line ${i + 1}`);
    pass += 2;
  }

  // 加粗标记数量必须一致
  for (let i = 0; i < before.length; i++) {
    const b = (before[i].match(/\*\*/g) || []).length;
    const a = (after[i].match(/\*\*/g) || []).length;
    assert.strictEqual(a, b, `bold markers changed on line ${i + 1}`);
    pass++;
  }

  // 制表符（TSV 表）分隔结构不变
  for (let i = 0; i < before.length; i++) {
    if (!before[i].includes("\t")) continue;
    const bt = before[i].split("\t").length;
    const at = after[i].split("\t").length;
    assert.strictEqual(at, bt, `tab cell count changed on line ${i + 1}`);
    pass++;
  }
}

console.log(`✅ ${pass} bare-formula tests passed`);
