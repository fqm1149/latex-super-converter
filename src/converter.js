"use strict";

/**
 * LaTeX 分隔符转换核心
 * ---------------------------------------------------------------
 * 把非 Obsidian(MathJax) 兼容的 LaTeX 分隔符转换为 $ / $$：
 *   \( ... \)   -> $ ... $
 *   \[ ... \]   -> $$ ... $$
 *
 * 设计要点：
 * 1. 跳过 frontmatter、围栏代码块、行内代码、wikilink、HTML 注释，
 *    避免改坏代码与链接。
 * 2. 跳过已有的 $ / $$ 公式内部，避免嵌套破坏。
 * 3. 只做「成对」转换：找不到配对就保持原样，不制造孤立的 $。
 * 4. 新生成的 $$ 块独占行（两侧有文字时插入换行），这是 Obsidian
 *    Live Preview 渲染最稳的写法；已存在的 $$ 块不动。
 * 5. 空公式 \[\] 直接删除。
 */

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;

/* ------------------------------------------------------------------ */
/* 表格识别（文档级）                                                  */
/* ------------------------------------------------------------------ */

/** 拆行并记录每行的 [start,end) 偏移 */
function splitLinesWithOffsets(text) {
  const rows = [];
  let pos = 0;
  while (pos <= text.length) {
    let nl = text.indexOf("\n", pos);
    if (nl === -1) nl = text.length;
    rows.push({ start: pos, end: nl, text: text.slice(pos, nl) });
    if (nl === text.length) break;
    pos = nl + 1;
  }
  return rows;
}

/**
 * 剥掉行首的引用块标记（> / >>）与列表标记（- * + 1.）。
 * 表格可能嵌在引用块或列表里："> | a | b |"。
 */
function stripBlockPrefix(line) {
  let t = line;
  let changed = true;
  while (changed) {
    changed = false;
    const bq = /^\s*>[ \t]?/.exec(t);
    if (bq) {
      t = t.slice(bq[0].length);
      changed = true;
      continue;
    }
    const li = /^\s*[-*+][ \t]+/.exec(t);
    if (li) {
      t = t.slice(li[0].length);
      changed = true;
      continue;
    }
    const ol = /^\s*\d+[.)][ \t]+/.exec(t);
    if (ol) {
      t = t.slice(ol[0].length);
      changed = true;
    }
  }
  return t;
}

function unescapedPipes(line) {
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "|") n++;
  }
  return n;
}

/** 对齐行：只含 | : - 与空白，且至少一个 - 和一个 | */
function isSeparatorLine(line) {
  const t = stripBlockPrefix(line).trim();
  if (!t.includes("|") || !t.includes("-")) return false;
  return /^[\s:|-]+$/.test(t);
}

/**
 * 表格数据行判定：竖线数量必须与对齐行一致（markdown 表格的列数约束）。
 * 这样 "a|b"（1 竖线）、"x|\[p^a\]"（1 竖线）能正确归入 1 竖线的表，
 * 而 "若 |H| \mid |G| 成立"（2 竖线）不会串进 1 竖线的表。
 */
function looksLikeRow(line, expectedPipes) {
  const t = stripBlockPrefix(line).trim();
  if (t === "" || !t.includes("|")) return false;
  if (unescapedPipes(t) !== expectedPipes) return false;
  return true;
}

/**
 * 文档级表格行区间。
 * 以「对齐行」为锚点向上下扩展，能覆盖：
 *   | a | b |      a | b |      | a | b      a | b
 * 且不会把 "若 |H| \mid |G| 成立" 这类行内公式误判为表格。
 */
function buildTableRanges(text) {
  const rows = splitLinesWithOffsets(text);
  const marked = new Set();

  for (let i = 0; i < rows.length; i++) {
    if (!isSeparatorLine(rows[i].text)) continue;
    marked.add(i);
    const col = unescapedPipes(stripBlockPrefix(rows[i].text).trim());
    let up = i - 1;
    while (up >= 0 && looksLikeRow(rows[up].text, col)) {
      marked.add(up);
      up--;
    }
    let down = i + 1;
    while (down < rows.length && looksLikeRow(rows[down].text, col)) {
      marked.add(down);
      down++;
    }
  }

  // 兜底：整行被 | 包住且 ≥2 个竖线（无对齐行的单行表格）
  for (let i = 0; i < rows.length; i++) {
    if (marked.has(i)) continue;
    const t = stripBlockPrefix(rows[i].text).trim();
    if (t.startsWith("|") && t.endsWith("|") && unescapedPipes(t) >= 2) marked.add(i);
  }

  return rows.filter((_, i) => marked.has(i)).map((r) => [r.start, r.end]);
}

/** pos 所在行是否以 | 开头且竖线数 ≥2（用于多行 \[ 的兜底判定） */
function startsWithPipeRow(text, pos) {
  let start = text.lastIndexOf("\n", pos - 1) + 1;
  let end = text.indexOf("\n", pos);
  if (end === -1) end = text.length;
  const t = stripBlockPrefix(text.slice(start, end)).trim();
  if (!t.startsWith("|")) return false;
  return unescapedPipes(t) >= 2;
}

/** 位置是否落在表格行内 */
function isTableLine(ranges, pos) {
  for (const [a, b] of ranges) if (pos >= a && pos <= b) return true;
  return false;
}

/** 找出需要整体跳过的区间：[start, end) */
function collectSkipRanges(text) {
  const ranges = [];

  // 1) YAML frontmatter
  if (text.startsWith("---\n") || text.startsWith("---\r\n")) {
    const bodyStart = text.indexOf("\n") + 1;
    const rest = text.slice(bodyStart);
    const m = /^---[ \t]*$/m.exec(rest);
    if (m) ranges.push([0, bodyStart + m.index + m[0].length]);
  }

  // 2) 围栏代码块 ``` / ~~~
  const lines = [];
  let cursor = 0;
  while (cursor <= text.length) {
    let nl = text.indexOf("\n", cursor);
    if (nl === -1) nl = text.length;
    lines.push({ start: cursor, end: nl, text: text.slice(cursor, nl) });
    if (nl === text.length) break;
    cursor = nl + 1;
  }

  let fence = null;
  let fenceStart = -1;
  for (const line of lines) {
    const m = FENCE_RE.exec(line.text);
    if (!m) continue;
    const marker = m[1];
    if (fence === null) {
      fence = marker;
      fenceStart = line.start;
      continue;
    }
    if (marker[0] === fence[0] && marker.length >= fence.length) {
      ranges.push([fenceStart, line.end]);
      fence = null;
      fenceStart = -1;
    }
  }
  if (fence !== null) ranges.push([fenceStart, text.length]);

  // 3) 行内代码 `...`（跳过围栏内的反引号）
  const inFence = (pos) => ranges.some(([s, e]) => pos >= s && pos < e);
  let i = 0;
  while (i < text.length) {
    if (text[i] === "`" && !inFence(i)) {
      let n = 1;
      while (text[i + n] === "`") n++;
      const openRun = "`".repeat(n);
      const closeIdx = text.indexOf(openRun, i + n);
      if (closeIdx === -1) {
        i += n;
        continue;
      }
      const chunk = text.slice(i + n, closeIdx);
      if (!chunk.includes("\n")) {
        ranges.push([i, closeIdx + n]);
        i = closeIdx + n;
        continue;
      }
      i += n;
      continue;
    }
    i++;
  }

  // 4) HTML 注释 <!-- ... -->
  let cm;
  const commentRe = /<!--[\s\S]*?-->/g;
  while ((cm = commentRe.exec(text)) !== null) {
    ranges.push([cm.index, cm.index + cm[0].length]);
  }

  // 5) wikilink / 嵌入 ![[...]]
  let wm;
  const wikiRe = /!?\[\[[^\]\n]*\]\]/g;
  while ((wm = wikiRe.exec(text)) !== null) {
    ranges.push([wm.index, wm.index + wm[0].length]);
  }

  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

function rangeAt(ranges, pos) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e] = ranges[mid];
    if (pos < s) hi = mid - 1;
    else if (pos >= e) lo = mid + 1;
    else return [s, e];
  }
  return null;
}

function inRanges(ranges, pos) {
  return rangeAt(ranges, pos) !== null;
}

/**
 * 粗略判断一段文本是否像 LaTeX 数学（用于可选的“只转公式”模式）。
 * 只看结构性信号，不做语义解析。
 */
function looksLikeMath(inner) {
  const s = inner.trim();
  if (s === "") return false;
  // 单个字母 / 短标识符（G、X、S_n…）：几乎总是数学变量
  if (/^[A-Za-z]$/.test(s)) return true;
  if (/^[A-Za-z][A-Za-z0-9]*(?:[\^_][A-Za-z0-9{}]+)*$/.test(s)) return true;
  // 明确的 LaTeX 命令
  if (/\\[a-zA-Z]+/.test(s)) return true;
  // 上下标、等号、关系符
  if (/[\^_=<>]/.test(s)) return true;
  // \begin{...}
  if (/\{[\s\S]*\}/.test(s)) return true;
  // 数字参与运算 / 希腊字母 / 常见符号
  if (/\d\s*[-+*/×÷]\s*\d/.test(s)) return true;
  if (/[α-ωΑ-Ωπθλμσ]/.test(s)) return true;
  if (/[∑∫√∞≈≤≥≠±→←↔∈∉⊂⊆∪∩]/.test(s)) return true;
  // 含数学运算符（+ - * / \times \cdot 等）且没有连续小写英文单词 -> 像公式
  if (/[+\-*/]/.test(s) && !/[a-z]{4,}/.test(s)) return true;
  if (/[()\[\]]/.test(s) && /[+\-*/^_]/.test(s) && !/[a-z]{4,}/.test(s)) return true;
  return false;
}

/**
 * 主转换函数
 * @param {string} input
 * @param {{isolateDisplay?: boolean, mathOnly?: boolean}} [opts]
 * @returns {{output: string, inlineCount: number, displayCount: number, skipped: number}}
 */
function convertLatexDelimiters(input, opts = {}) {
  if (typeof input !== "string" || input.length === 0) {
    return { output: input || "", inlineCount: 0, displayCount: 0, skipped: 0 };
  }
  const isolateDisplay = opts.isolateDisplay !== false;
  const mathOnly = opts.mathOnly === true;

  const skip = collectSkipRanges(input);
  const tableRanges = buildTableRanges(input);
  const n = input.length;

  const out = [];
  let curLine = ""; // 当前输出行的内容（用于判断是否需要换行）
  const emit = (piece) => {
    if (piece === "") return;
    out.push(piece);
    const nl = piece.lastIndexOf("\n");
    curLine = nl === -1 ? curLine + piece : piece.slice(nl + 1);
  };
  const lineBreak = () => {
    // 去掉行尾空白后换行；若已在行首则不重复
    if (curLine.trim() === "") return;
    emit("\n");
  };

  let i = 0;
  let inlineCount = 0;
  let displayCount = 0;
  let skipped = 0;

  // 已有 $ / $$ 公式：整段原样复制
  const mathSpanEnd = (pos) => {
    const delim = input[pos + 1] === "$" ? "$$" : "$";
    const closeIdx = input.indexOf(delim, pos + delim.length);
    if (closeIdx === -1) return -1;
    // 单个 $ 不允许跨段落（否则一个孤立的 $ 会吞掉后面大段文本）
    if (delim === "$") {
      const body = input.slice(pos + 1, closeIdx);
      if (/\n[ \t]*\r?\n/.test(body)) return -1;
    }
    return closeIdx + delim.length;
  };

  while (i < n) {
    if (inRanges(skip, i)) {
      const r = rangeAt(skip, i);
      const end = r ? r[1] : i + 1;
      emit(input.slice(i, end));
      i = end;
      continue;
    }

    const ch = input[i];

    if (ch === "$") {
      const end = mathSpanEnd(i);
      if (end > i) {
        emit(input.slice(i, end));
        i = end;
        continue;
      }
      emit(ch);
      i++;
      continue;
    }

    if (ch === "\\") {
      const next = input[i + 1];

      if (next === "(") {
        const close = input.indexOf("\\)", i + 2);
        if (close !== -1 && !inRanges(skip, close)) {
          const inner = input.slice(i + 2, close);
          if (inner.trim() === "") {
            i = close + 2;
            continue;
          }
          if (mathOnly && !looksLikeMath(inner)) {
            emit(input.slice(i, close + 2));
            skipped++;
            i = close + 2;
            continue;
          }
          emit("$" + inner + "$");
          inlineCount++;
          i = close + 2;
          continue;
        }
        emit("\\(");
        i += 2;
        continue;
      }

      if (next === "[") {
        const close = input.indexOf("\\]", i + 2);
        if (close !== -1 && !inRanges(skip, close)) {
          const inner = input.slice(i + 2, close);
          if (inner.trim() === "") {
            i = close + 2;
            continue;
          }
          if (mathOnly && !looksLikeMath(inner)) {
            emit(input.slice(i, close + 2));
            skipped++;
            i = close + 2;
            continue;
          }

          // 去掉首尾空白，但保留内部换行与缩进结构
          const body = inner.replace(/^[ \t]*\r?\n/, "").replace(/[ \t]*\r?\n[ \t]*$/, "").replace(/\s+$/, "");
          const multiline = body.includes("\n");

          // 表格单元格内：$$ 块会撑断表格，降级为行内公式（换行压成空格）
          // 额外覆盖「\[ 开在表格行、\] 在后续行」的多行写法
          const startsOnTableRow =
            multiline && isTableLine(tableRanges, i) === false && startsWithPipeRow(input, i);
          if (isTableLine(tableRanges, i) || startsOnTableRow) {
            emit("$" + body.replace(/\s*\n\s*/g, " ") + "$");
            inlineCount++;
            i = close + 2;
            continue;
          }

          if (isolateDisplay) {
            const trimmed = curLine.replace(/[ \t]+$/, "");
            if (trimmed !== "") {
              if (trimmed !== curLine) {
                const last = out.length - 1;
                out[last] = out[last].replace(/[ \t]+$/, "");
                curLine = trimmed;
              }
              emit("\n");
            }
          }

          if (multiline) {
            emit("$$\n" + body + "\n$$");
          } else {
            emit("$$" + body + "$$");
          }

          if (isolateDisplay) {
            let k = close + 2;
            while (k < n && (input[k] === " " || input[k] === "\t")) k++;
            if (k < n && input[k] !== "\n") emit("\n");
            i = k;
          } else {
            i = close + 2;
          }
          displayCount++;
          continue;
        }
        emit("\\[");
        i += 2;
        continue;
      }

      if (next === ")" || next === "]") {
        // 孤立右分隔符：无配对，保持原样
        emit(input.slice(i, i + 2));
        i += 2;
        continue;
      }

      if (i + 1 < n) {
        emit(input.slice(i, i + 2));
        i += 2;
      } else {
        emit(ch);
        i++;
      }
      continue;
    }

    emit(ch);
    i++;
  }

  return { output: out.join(""), inlineCount, displayCount, skipped };
}

/** 统计还能转换多少处（UI 预览用） */
function countConvertible(input) {
  const skip = collectSkipRanges(input);
  let inline = 0;
  let display = 0;
  let i = 0;
  while (i < input.length) {
    if (inRanges(skip, i)) {
      const r = rangeAt(skip, i);
      i = r ? r[1] : i + 1;
      continue;
    }
    if (input[i] === "$") {
      const delim = input[i + 1] === "$" ? "$$" : "$";
      const closeIdx = input.indexOf(delim, i + delim.length);
      if (closeIdx === -1) {
        i += 1;
        continue;
      }
      if (delim === "$" && /\n[ \t]*\r?\n/.test(input.slice(i + 1, closeIdx))) {
        i += 1;
        continue;
      }
      i = closeIdx + delim.length;
      continue;
    }
    if (input[i] === "\\") {
      if (input[i + 1] === "(") {
        const close = input.indexOf("\\)", i + 2);
        if (close !== -1) {
          inline++;
          i = close + 2;
          continue;
        }
      }
      if (input[i + 1] === "[") {
        const close = input.indexOf("\\]", i + 2);
        if (close !== -1) {
          display++;
          i = close + 2;
          continue;
        }
      }
      i += 2;
      continue;
    }
    i++;
  }
  return { inline, display };
}

module.exports = {
  convertLatexDelimiters,
  countConvertible,
  collectSkipRanges,
  buildTableRanges,
  unescapedPipes,
  stripBlockPrefix,
};
