"use strict";
/**
 * 写回前完整性校验（src/integrity.js）的单元测试。
 *
 * 这套判据的职责是「宁可误报也不漏报」：它只负责识别那些一旦写出去
 * 就不可逆的结构性破坏，所以重点覆盖历史事故的真实形态。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  checkIntegrity,
  summarizeIssues,
  unescapedDollars,
  fingerprint,
  commandCounts,
  splitLines,
} = require("../src/integrity.js");
const { convertLatexDelimiters } = require("../src/converter.js");
const { convertBareFormulas } = require("../src/bare.js");

let pass = 0;
function ok(label, fn) {
  fn();
  pass++;
}
function eq(actual, expected, label) {
  assert.deepStrictEqual(actual, expected, label);
  pass++;
}

const run = (s) =>
  convertBareFormulas(
    convertLatexDelimiters(s, { isolateDisplay: true, mathOnly: false }).output,
    { level: 2 }
  ).output;

const codes = (source, output) =>
  [...new Set(checkIntegrity(source, output).issues.map((i) => i.code))].sort();

/* ------------------------------------------------------------------ */
/* 1. 正常输出必须放行                                                 */
/* ------------------------------------------------------------------ */

const goodSource = [
  "设 \\(f(x)=x^2\\)，则 \\[\\int_0^1 f(x)\\,dx = \\frac{1}{3}\\]。",
  "",
  "裸公式：若 H 是 G 的子群，则 |H| \\mid |G|。",
].join("\n");

ok("correct conversion passes", () => {
  const result = checkIntegrity(goodSource, run(goodSource));
  assert.strictEqual(result.ok, true, summarizeIssues(result.issues));
  assert.strictEqual(result.issues.length, 0);
});

ok("unchanged text passes (short circuit)", () => {
  const text = "完全没有公式的一段话，含 $ 符号也不成对……";
  const result = checkIntegrity(text, text);
  assert.strictEqual(result.ok, true);
});

ok("empty source passes", () => {
  assert.strictEqual(checkIntegrity("", "").ok, true);
});

/* ------------------------------------------------------------------ */
/* 2. 历史事故：1.2.1 的典型破坏形态                                    */
/* ------------------------------------------------------------------ */

ok("split script is caught", () => {
  const src = "序列 $\\{x_k\\}_{k=1}^\\infty$ 收敛。";
  const bad = "序列 $\\{x_k\\}$_${k=1}$^$\\infty$ 收敛。";
  assert.deepStrictEqual(codes(src, bad), ["empty-script"]);
});

ok("empty script alone is caught", () => {
  const res = checkIntegrity("前 $a_1$ 后", "前 $a$_$1$ 后");
  assert.strictEqual(res.ok, false);
  assert.ok(res.issues.some((i) => i.code === "empty-script"));
});

ok("odd dollar on a line is caught", () => {
  const res = checkIntegrity("前 $a$ 后", "前 $a 后 $b$");
  assert.strictEqual(res.ok, false);
  assert.ok(res.issues.some((i) => i.code === "odd-dollar"));
});

ok("span across blank line is caught", () => {
  // 落单的 $ 把后面整段正文都当成公式
  const res = checkIntegrity("前 $a$ 后", "前 $a\n\n整段正文\n\n$ 后");
  assert.strictEqual(res.ok, false);
  assert.ok(res.issues.some((i) => i.code === "span-across-blank"));
});

ok("lost latex command is caught", () => {
  const res = checkIntegrity("$\\frac{a}{b}$", "$\\frac{a}{b}$ 与 \\int");
  assert.strictEqual(res.ok, false);
  assert.ok(res.issues.some((i) => i.code === "command-mismatch"));
});

ok("changed character content is caught", () => {
  const res = checkIntegrity("$a+b$ 和 $c$", "$a+b$ 和 $c d$");
  assert.strictEqual(res.ok, false);
  assert.ok(res.issues.some((i) => i.code === "content-changed"));
});

/* ------------------------------------------------------------------ */
/* 3. 不许误报：这些合法写法必须通过                                    */
/* ------------------------------------------------------------------ */

ok("escaped dollar is not a delimiter", () => {
  const text = "价格 \\$5 与 \\$10，另有 $x$。";
  assert.strictEqual(checkIntegrity(text, text).ok, true);
  const parsed = unescapedDollars(text);
  assert.strictEqual(parsed.dollars.length, 2, "only the real $ pair counted");
});

ok("display math with $$ passes", () => {
  const src = "\\[a=b\\]";
  const out = run(src);
  assert.strictEqual(checkIntegrity(src, out).ok, true, summarizeIssues(checkIntegrity(src, out).issues));
});

ok("cases environment passes", () => {
  const src = "$f(x,y)=\\begin{cases} 1, & x \\in \\mathbb{Q} \\\\ 0, & x \\notin \\mathbb{Q} \\end{cases}$";
  assert.strictEqual(checkIntegrity(src, src).ok, true);
});

ok("table rows pass", () => {
  const src = ["| 符号 | 含义 |", "| --- | --- |", "| \\(p^a\\) | 素数幂 |"].join("\n");
  const out = run(src);
  assert.strictEqual(checkIntegrity(src, out).ok, true, summarizeIssues(checkIntegrity(src, out).issues));
});

ok("code fences are skipped", () => {
  const src = ["```js", "const s = '$' + x + '$';", "```", "", "正文 $a$。"].join("\n");
  assert.strictEqual(checkIntegrity(src, src).ok, true);
});

ok("inline code is skipped", () => {
  const src = "用 `echo $HOME` 和 `$PATH` 查看，正文 $a$。";
  assert.strictEqual(checkIntegrity(src, src).ok, true);
});

/* ------------------------------------------------------------------ */
/* 4. 真实回归：example2.md                                           */
/* ------------------------------------------------------------------ */

const fixture = path.join(__dirname, "fixtures", "example2.md");

ok("example2 fixture converts cleanly", () => {
  const src = fs.readFileSync(fixture, "utf8");
  const out = run(src);
  const result = checkIntegrity(src, out);
  assert.strictEqual(result.ok, true, summarizeIssues(result.issues));
});

/* ------------------------------------------------------------------ */
/* 5. 工具函数                                                         */
/* ------------------------------------------------------------------ */

ok("fingerprint ignores delimiters and whitespace", () => {
  assert.strictEqual(fingerprint("$a + b$"), fingerprint("\\(a+b\\)"));
  assert.strictEqual(fingerprint("\\[x\\]"), fingerprint("$$x$$"));
});

ok("fingerprint keeps real content differences", () => {
  assert.notStrictEqual(fingerprint("$a+b$"), fingerprint("$a-b$"));
});

ok("commandCounts counts latex commands", () => {
  const counts = commandCounts("$\\frac{1}{2}$ 与 \\frac{3}{4}");
  assert.strictEqual(counts["\\frac"], 2);
});

ok("splitLines preserves offsets", () => {
  const lines = splitLines("ab\ncd\n");
  assert.strictEqual(lines.length, 3);
  assert.deepStrictEqual(
    lines.map((l) => l.text),
    ["ab", "cd", ""]
  );
  assert.strictEqual(lines[1].start, 3);
});

ok("summarizeIssues is compact and language-neutral", () => {
  const res = checkIntegrity("前 $a$ 后", "前 $a$_$1$ 后");
  const summary = summarizeIssues(res.issues);
  assert.ok(/empty-script/.test(summary), summary);
  assert.strictEqual(summarizeIssues([]), "none");
});

ok("issue lines are 1-based", () => {
  const res = checkIntegrity("ok\n\n$a$_$1$\n", "ok\n\n$a$_$1$\n");
  // 同一文本短路，用真实差异触发
  const res2 = checkIntegrity("ok\n\n$a_1$\n", "ok\n\n$a$_$1$\n");
  assert.strictEqual(res.ok, true);
  assert.ok(res2.issues.some((i) => i.line === 3), JSON.stringify(res2.issues));
});

console.log(`✅ ${pass} integrity tests passed`);
