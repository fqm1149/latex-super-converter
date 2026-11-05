"use strict";
/**
 * 端到端管线测试：分隔符转换 → 裸公式识别
 * 与插件里 convertAll() 完全同序，专门盯 Markdown 结构完整性。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { convertLatexDelimiters } = require("../src/converter.js");
const { convertBareFormulas } = require("../src/bare.js");

let pass = 0;
function ok(cond, label, extra) {
  assert.ok(cond, `${label}${extra ? "\n" + extra : ""}`);
  pass++;
}
function eq(actual, expected, label) {
  assert.strictEqual(
    actual,
    expected,
    `${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`
  );
  pass++;
}

/** 与 src/plugin.js 的 convertAll() 同序 */
function pipeline(input, opts = {}) {
  const d = convertLatexDelimiters(input, {
    isolateDisplay: opts.isolateDisplay !== false,
    mathOnly: opts.mathOnly === true,
  });
  const level = opts.level === undefined ? 2 : opts.level;
  if (level <= 0) return d.output;
  const b = convertBareFormulas(d.output, { level, skipHeadings: true });
  return b.output;
}

const P = (s, o) => pipeline(s, o);

/** 未转义的竖线数量 */
function pipeCount(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "|") n++;
  }
  return n;
}

const isRow = (l) => /^\s*\|/.test(l);

/** 提取连续表格块 */
function tableBlocks(lines) {
  const res = [];
  let i = 0;
  while (i < lines.length) {
    if (!isRow(lines[i])) {
      i++;
      continue;
    }
    const start = i;
    let j = i;
    while (j < lines.length && isRow(lines[j])) j++;
    res.push({ start, lines: lines.slice(start, j) });
    i = j;
  }
  return res;
}

/* ================================================================== */
/* 1. 表格单元格里的 \[ \] 不能撑断表格                                */
/* ================================================================== */

eq(
  P("| 一 | \\[p^a\\] |"),
  "| 一 | $p^a$ |",
  "display math in table cell becomes inline"
);

eq(
  P("| a | \\[x=1\\] | b |"),
  "| a | $x=1$ | b |",
  "display math in middle column"
);

eq(P("|a|\\[x\\]|"), "|a|$x$|", "tight table with display math");

eq(
  P("| x | \\[\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}\\] |"),
  "| x | $\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}$ |",
  "matrix inside table cell stays inline"
);

eq(
  P("| x | \\[\n1 & 2 \\\\\n3 & 4\n\\] |"),
  "| x | $1 & 2 \\\\ 3 & 4$ |",
  "multiline display inside cell collapsed to one line"
);

/* ================================================================== */
/* 2. 行数必须守恒（表格不被撑开）                                     */
/* ================================================================== */

const tblWithDisplay = [
  "| 定理 | 结论 |",
  "| --- | --- |",
  "| 一 | \\[p^a\\] |",
  "| 二 | \\(x^2\\) |",
].join("\n");

const tblOut = P(tblWithDisplay);
eq(tblOut.split("\n").length, 4, "table line count preserved");
eq(
  tblOut,
  ["| 定理 | 结论 |", "| --- | --- |", "| 一 | $p^a$ |", "| 二 | $x^2$ |"].join("\n"),
  "table content converted without breaking"
);

/* ================================================================== */
/* 3. 表格外仍然正常生成 $$ 块                                         */
/* ================================================================== */

eq(P("前文 \\[E=mc^2\\] 后文"), "前文\n$$E=mc^2$$\n后文", "outside table keeps display block");
eq(
  P("\\[\n\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}\n\\]"),
  "$$\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}$$",
  "outside table matrix keeps block"
);

/* ================================================================== */
/* 4. 表格各种形态的组合测试                                           */
/* ================================================================== */

const cases = [
  {
    name: "compact table",
    src: ["|定理|结论|", "|---|---|", "|一|p^a|"].join("\n"),
    want: ["|定理|结论|", "|---|---|", "|一|$p^a$|"].join("\n"),
  },
  {
    name: "aligned separator",
    src: ["| a | b |", "| :--- | ---: |", "| x^2 | \\[y^2\\] |"].join("\n"),
    want: ["| a | b |", "| :--- | ---: |", "| $x^2$ | $y^2$ |"].join("\n"),
  },
  {
    name: "table with bold",
    src: ["| **定理** | **p^a** |", "| --- | --- |", "| 一 | **\\[|G|\\]** |"].join("\n"),
    want: ["| **定理** | **$p^a$** |", "| --- | --- |", "| 一 | **$|G|$** |"].join("\n"),
  },
  {
    name: "table with inline code",
    src: ["| 符号 | 值 |", "| --- | --- |", "| `n_p` | n_p |"].join("\n"),
    want: ["| 符号 | 值 |", "| --- | --- |", "| `n_p` | $n_p$ |"].join("\n"),
  },
  {
    name: "table with link",
    src: ["| 文档 | 值 |", "| --- | --- |", "| [a](b.com/p^2) | x^2 |"].join("\n"),
    want: ["| 文档 | 值 |", "| --- | --- |", "| [a](b.com/p^2) | $x^2$ |"].join("\n"),
  },
  {
    name: "table with existing $",
    src: ["| 公式 | 说明 |", "| --- | --- |", "| $a^2$ | p^b |"].join("\n"),
    want: ["| 公式 | 说明 |", "| --- | --- |", "| $a^2$ | $p^b$ |"].join("\n"),
  },
  {
    name: "tight table |a|b|",
    src: ["|a|b|", "|---|---|", "|x|\\[p^a\\]|"].join("\n"),
    want: ["|a|b|", "|---|---|", "|x|$p^a$|"].join("\n"),
  },
  {
    name: "no leading pipe",
    src: ["a | b", "--- | ---", "x | \\[p^a\\]"].join("\n"),
    want: ["a | b", "--- | ---", "x | $p^a$"].join("\n"),
  },
  {
    name: "no trailing pipe",
    src: ["| a | b", "| --- | ---", "| x | \\[p^a\\]"].join("\n"),
    want: ["| a | b", "| --- | ---", "| x | $p^a$"].join("\n"),
  },
  {
    name: "no spaces around pipes",
    src: ["a|b", "---|---", "x|\\[p^a\\]"].join("\n"),
    want: ["a|b", "---|---", "x|$p^a$"].join("\n"),
  },
  {
    name: "blockquote table",
    src: ["> | a | b |", "> | --- | --- |", "> | \\[x\\] | y |"].join("\n"),
    want: ["> | a | b |", "> | --- | --- |", "> | $x$ | y |"].join("\n"),
  },
  {
    name: "nested blockquote table",
    src: ["> > | a | b |", "> > | --- | --- |", "> > | \\[x\\] | y |"].join("\n"),
    want: ["> > | a | b |", "> > | --- | --- |", "> > | $x$ | y |"].join("\n"),
  },
  {
    name: "list table",
    src: ["- | a | b |", "- | --- | --- |", "- | \\[x\\] | y |"].join("\n"),
    want: ["- | a | b |", "- | --- | --- |", "- | $x$ | y |"].join("\n"),
  },
  {
    name: "three column table",
    src: ["| a | b | c |", "| --- | --- | --- |", "| x | \\[y\\] | z |"].join("\n"),
    want: ["| a | b | c |", "| --- | --- | --- |", "| x | $y$ | z |"].join("\n"),
  },
  {
    name: "two tables separated by text",
    src: ["| a | b |", "| --- | --- |", "| x^2 | y |", "", "中间说明 p^a", "", "| c | d |", "| --- | --- |", "| \\[z\\] | w |"].join("\n"),
    want: ["| a | b |", "| --- | --- |", "| $x^2$ | y |", "", "中间说明 $p^a$", "", "| c | d |", "| --- | --- |", "| $z$ | w |"].join("\n"),
  },
];

for (const c of cases) {
  eq(P(c.src), c.want, `pipeline: ${c.name}`);
}

/* ================================================================== */
/* 5. example.md 端到端                                                */
/* ================================================================== */

const examplePath = path.join(__dirname, "..", "..", "example.md");
if (fs.existsSync(examplePath)) {
  const src = fs.readFileSync(examplePath, "utf8");
  const out = P(src);
  const a = src.split("\n");
  const b = out.split("\n");

  eq(b.length, a.length, "example.md line count preserved");

  // 表格块结构比对
  const srcBlocks = tableBlocks(a);
  const outBlocks = tableBlocks(b);
  eq(outBlocks.length, srcBlocks.length, "example.md table block count preserved");

  for (let k = 0; k < srcBlocks.length; k++) {
    const A = srcBlocks[k].lines;
    const B = outBlocks[k].lines;
    eq(B.length, A.length, `example.md block ${k + 1} line count`);
    for (let r = 0; r < A.length; r++) {
      eq(
        pipeCount(B[r]),
        pipeCount(A[r]),
        `example.md block ${k + 1} row ${r + 1} pipe count`
      );
      ok(
        !B[r].includes("$$"),
        `example.md block ${k + 1} row ${r + 1} must not contain $$`,
        `  line: ${JSON.stringify(B[r].slice(0, 160))}`
      );
    }
  }

  // 加粗标记守恒
  for (let i = 0; i < a.length; i++) {
    eq(
      (b[i].match(/\*\*/g) || []).length,
      (a[i].match(/\*\*/g) || []).length,
      `example.md line ${i + 1} bold marker count`
    );
  }

  // 制表符分列守恒（TSV 表格）
  for (let i = 0; i < a.length; i++) {
    if (!a[i].includes("\t")) continue;
    eq(
      b[i].split("\t").length,
      a[i].split("\t").length,
      `example.md line ${i + 1} tab column count`
    );
  }

  // 幂等
  eq(P(out), out, "example.md pipeline idempotent");
}

/* ================================================================== */
/* 6. 真实仓库扫描（存在则跑）                                         */
/* ================================================================== */

const vaultRoots = [
  "/Users/fqm/Documents/obsidian/26fall",
  "/Users/fqm/Documents/obsidian/pkusms/pkusms",
];

let scannedFiles = 0;
let scannedBlocks = 0;

for (const root of vaultRoots) {
  if (!fs.existsSync(root)) continue;
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.name.startsWith(".obsidian")) continue;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) files.push(p);
    }
  })(root);

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const srcLines = src.split("\n");
    const srcBlocks = tableBlocks(srcLines);
    if (srcBlocks.length === 0) continue;

    const out = pipeline(src);
    const outBlocks = tableBlocks(out.split("\n"));
    const rel = path.basename(file);

    eq(outBlocks.length, srcBlocks.length, `${rel}: table block count`);

    for (let k = 0; k < srcBlocks.length && k < outBlocks.length; k++) {
      const A = srcBlocks[k].lines;
      const B = outBlocks[k].lines;
      eq(B.length, A.length, `${rel}: block ${k + 1} line count`);
      for (let r = 0; r < A.length && r < B.length; r++) {
        const pb = pipeCount(A[r]);
        const pa = pipeCount(B[r]);
        // 原文单元格内部若本来就有 $$…$$（用户自己写的），合法，不算破坏
        const legitDD = (A[r].match(/\$\$/g) || []).length > 0;
        eq(pa, pb, `${rel}: block ${k + 1} row ${r + 1} pipe count`);
        if (!legitDD) {
          ok(
            !B[r].includes("$$"),
            `${rel}: block ${k + 1} row ${r + 1} must not become display math`,
            `  before: ${JSON.stringify(A[r].slice(0, 140))}\n  after:  ${JSON.stringify(B[r].slice(0, 140))}`
          );
        }
        scannedBlocks++;
      }
    }
    scannedFiles++;
  }
}

console.log(`✅ ${pass} pipeline tests passed`);
console.log(`   扫描真实笔记 ${scannedFiles} 篇，表格行 ${scannedBlocks} 行，全部结构完好`);
