"use strict";

/**
 * 写入前的完整性校验（安全网）
 * ---------------------------------------------------------------
 * 转换是「就地覆盖」的：一旦写出错误结果，原文里的 LaTeX 结构就被破坏，
 * 再跑一次也救不回来（例如 `\{x_k\}_{k=1}^\infty` 被切成 `$\{x_k\}$_${k=1}$^$\infty$`
 * 之后，`$` 的配对关系已经错了，任何后续处理都无法还原）。
 *
 * 所以这里在「写盘之前」做一轮结构体检，只检查那些**一旦破坏就必然异常**的信号：
 *
 *   1. odd-dollar         某一行未转义的 `$` 个数为奇数 —— 定界符落单
 *   2. split-script       `}`/`]`/`)`/字母/数字 紧接 `$` 再接 `_` 或 `^`
 *                         —— 公式在上下标处被腰斩（1.2.1 的典型破坏形态）
 *   3. empty-script       `$_$` / `$^$` —— 空上下标，说明两侧被切断
 *   4. span-across-blank  `$…$` 跨了空行 —— 落单的 `$` 吞掉了后面整段正文
 *   5. command-mismatch   源文与结果里 `\命令` 的数量不一致 —— 有内容被删改
 *   6. content-changed    去掉 `$`、`\( \) \[ \]`、`\\`、空白之后字符流不一致
 *                         —— 除了「加定界符」之外还动了别的字符
 *
 * 每条检查都是纯函数、O(n)，不读网络、不依赖 Obsidian。
 * 返回的 issue 只带结构化 code 与位置，文案交给 plugin 层做 i18n。
 */

/* 打包后与 bare.js 同处一个作用域，名字必须唯一，故加 Integrity 后缀 */
const __collectSkipRangesIntegrity =
  typeof collectSkipRanges === "function"
    ? collectSkipRanges
    : require("./converter.js").collectSkipRanges;

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

/** 按行切分，保留每行的 [start, end) 偏移（不含换行符） */
function splitLines(text) {
  const out = [];
  let cursor = 0;
  while (cursor <= text.length) {
    let nl = text.indexOf("\n", cursor);
    if (nl === -1) nl = text.length;
    out.push({ start: cursor, end: nl, text: text.slice(cursor, nl) });
    if (nl === text.length) break;
    cursor = nl + 1;
  }
  return out;
}

/** 位置是否落在需要跳过的区间（代码块 / 行内代码 / frontmatter / wikilink …） */
function insideRanges(ranges, pos) {
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (pos >= r[0] && pos < r[1]) return true;
  }
  return false;
}

/**
 * 收集所有「未转义且不在跳过区间内」的 `$` 位置。
 * `\$` 不算定界符；`\\$` 里的 `$` 是定界符（反斜杠本身被转义）。
 */
function unescapedDollars(text) {
  const ranges = __collectSkipRangesIntegrity(text);
  const lines = splitLines(text);
  const dollars = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let i = line.start; i < line.end; i++) {
      if (text[i] !== "$") continue;
      if (insideRanges(ranges, i)) continue;
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) backslashes++;
      if (backslashes % 2 === 1) continue;
      dollars.push({ pos: i, line: li });
    }
  }

  return { dollars, ranges, lines };
}

/** 行是否整体落在跳过区间内（代码块里的 `$` 一律不参与结构判定） */
function lineIsSkipped(line, ranges) {
  return line.start < line.end && insideRanges(ranges, line.start);
}

/* ------------------------------------------------------------------ */
/* 各项检查                                                            */
/* ------------------------------------------------------------------ */

/** 1. 逐行 `$` 奇偶 */
function checkDollarParity(dollars) {
  const perLine = new Map();
  for (const d of dollars) perLine.set(d.line, (perLine.get(d.line) || 0) + 1);

  const issues = [];
  for (const entry of perLine) {
    const line = entry[0];
    const count = entry[1];
    if (count % 2 === 1) issues.push({ code: "odd-dollar", line: line + 1, count });
  }
  issues.sort((a, b) => a.line - b.line);
  return issues;
}

/** 2/3. 上下标被腰斩、空上下标 */
const SPLIT_SCRIPT_RE = /[}\])A-Za-z0-9]\$[_^](?=\{|\\|[A-Za-z0-9])/;
const EMPTY_SCRIPT_RE = /\$[_^]\$/;

function checkScriptHell(text, ranges, lines) {
  const issues = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (lineIsSkipped(line, ranges)) continue;
    if (EMPTY_SCRIPT_RE.test(line.text)) {
      issues.push({ code: "empty-script", line: li + 1 });
    }
    if (SPLIT_SCRIPT_RE.test(line.text)) {
      issues.push({ code: "split-script", line: li + 1 });
    }
  }
  return issues;
}

/** 4. `$…$` 跨空行 —— 落单的 `$` 把后面整段正文当成了公式 */
function checkSpanAcrossBlank(text, dollars) {
  const issues = [];
  for (let i = 0; i + 1 < dollars.length; i += 2) {
    const from = dollars[i];
    const to = dollars[i + 1];
    const inner = text.slice(from.pos + 1, to.pos);
    if (/\n[ \t]*\n/.test(inner)) {
      issues.push({ code: "span-across-blank", line: from.line + 1 });
    }
  }
  return issues;
}

/** 5. `\命令` 数量必须守恒（转换只加 `$`，不动命令） */
function commandCounts(text) {
  const found = text.match(/\\[A-Za-z]+/g) || [];
  const counts = Object.create(null);
  for (const cmd of found) counts[cmd] = (counts[cmd] || 0) + 1;
  return counts;
}

function checkCommands(source, output) {
  const before = commandCounts(source);
  const after = commandCounts(output);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  const missing = [];
  const added = [];
  for (const key of keys) {
    const a = before[key] || 0;
    const b = after[key] || 0;
    if (a > b) missing.push({ command: key, source: a, output: b });
    else if (b > a) added.push({ command: key, source: a, output: b });
  }

  if (missing.length === 0 && added.length === 0) return [];
  return [{ code: "command-mismatch", missing, added }];
}

/** 6. 字符流守恒：除了 `$` 与 `\( \) \[ \]` 之外，不许增删任何字符 */
function fingerprint(text) {
  return text
    .replace(/\$/g, "")
    .replace(/\\[()[\]]/g, "")
    .replace(/\\\\/g, "")
    .replace(/\s+/g, "");
}

function firstDivergence(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return {
        at: i,
        source: a.slice(Math.max(0, i - 24), i + 24),
        output: b.slice(Math.max(0, i - 24), i + 24),
      };
    }
  }
  if (a.length !== b.length) {
    return {
      at: n,
      source: a.slice(Math.max(0, n - 24), n + 24),
      output: b.slice(Math.max(0, n - 24), n + 24),
    };
  }
  return null;
}

function checkContent(source, output) {
  const before = fingerprint(source);
  const after = fingerprint(output);
  if (before === after) return [];
  const diff = firstDivergence(before, after);
  return [
    {
      code: "content-changed",
      at: diff.at,
      sourceSample: diff.source,
      outputSample: diff.output,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* 对外入口                                                            */
/* ------------------------------------------------------------------ */

/**
 * 校验一次转换的结果是否可以安全写回。
 * @param {string} source 原始内容
 * @param {string} output 转换后内容
 * @returns {{ok: boolean, issues: Array<{code: string}>}}
 */
function checkIntegrity(source, output) {
  if (typeof source !== "string" || typeof output !== "string") {
    return { ok: false, issues: [{ code: "bad-input" }] };
  }
  if (source === output) return { ok: true, issues: [] };

  const scan = unescapedDollars(output);
  const issues = [];

  for (const i of checkDollarParity(scan.dollars)) issues.push(i);
  for (const i of checkScriptHell(output, scan.ranges, scan.lines)) issues.push(i);
  for (const i of checkSpanAcrossBlank(output, scan.dollars)) issues.push(i);
  for (const i of checkCommands(source, output)) issues.push(i);
  for (const i of checkContent(source, output)) issues.push(i);

  return { ok: issues.length === 0, issues };
}

/** 汇总成一句紧凑的技术描述，供 Notice 使用（语言无关） */
function summarizeIssues(issues) {
  if (!issues || issues.length === 0) return "none";
  const tally = new Map();
  for (const issue of issues) tally.set(issue.code, (tally.get(issue.code) || 0) + 1);

  const parts = [];
  for (const entry of tally) {
    const code = entry[0];
    const n = entry[1];
    const lines = issues
      .filter((i) => i.code === code && i.line)
      .map((i) => i.line)
      .slice(0, 3);
    parts.push(lines.length ? `${code}×${n}@L${lines.join(",")}` : `${code}×${n}`);
  }
  return parts.join("; ");
}

module.exports = {
  checkIntegrity,
  summarizeIssues,
  unescapedDollars,
  fingerprint,
  commandCounts,
  splitLines,
  SPLIT_SCRIPT_RE,
  EMPTY_SCRIPT_RE,
};
