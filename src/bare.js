"use strict";

/**
 * 裸公式智能识别（无分隔符的 LaTeX）
 * ---------------------------------------------------------------
 * 有些 AI 输出的笔记里公式完全不带任何定界符：
 *     |H| \mid |G|        p^a m        \text{Syl}_p(G) \neq \emptyset
 *     n_p(G) \mid m       D_4 = \langle r,s \mid r^4=e \rangle
 * 本模块扫描这类片段并补上 $ / $$。
 *
 * 做法：把每一行切成 token（命令 / 词 / 数字 / 运算符 / 括号 / 竖线 / 空白 / 文字），
 * 再从「带硬证据的数学 token」出发向两侧生长出区间，最后做证据校验。
 * 只有带明确数学证据的区间才会被包上定界符，普通英文与中文正文不动。
 *
 * level：
 *   0 关闭
 *   1 保守：只认 LaTeX 命令（\mid \text \mathbb …）与 |…|
 *   2 标准（默认）：再加 x^2、n_p、f(x)、24 = 2^3
 *   3 激进：再加夹在中文之间的孤立单字母（设 G 为 …, 群 H）
 */

/**
 * 打包进 main.js 后 collectSkipRanges 已在同一作用域里（函数声明提升），
 * 单独跑单测时再走 require。
 */
const __collectSkipRanges =
  typeof collectSkipRanges === "function"
    ? collectSkipRanges
    : require("./converter.js").collectSkipRanges;

const CJK_RE = /[\u2E80-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

/* ------------------------------------------------------------------ */
/* LaTeX 数学命令白名单                                                */
/* ------------------------------------------------------------------ */

const KNOWN_CMDS = new Set(
  `alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi
   omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega
   Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega
   in notin ni owns subset subseteq subsetneq supset supseteq supsetneq cup cap setminus
   complement emptyset varnothing forall exists nexists neg lnot land lor wedge vee
   implies iff Leftarrow Rightarrow leftarrow rightarrow leftrightarrow Leftrightarrow
   to gets mapsto longrightarrow longleftarrow longleftrightarrow impliedby
   approx approxeq equiv sim simeq cong propto perp parallel mid nmid
   le leq ge geq ll gg ne neq lt gt prec succ models vdash dashv top bot
   times cdot div pm mp ast star circ bullet oplus otimes odot bigoplus bigotimes
   sum prod coprod int iint iiint oint lim limsup liminf sup inf
   max min arg deg det dim exp gcd hom ker ln log sin cos tan cot sec csc
   arcsin arccos arctan sinh cosh tanh coth mod bmod pmod
   sqrt frac dfrac tfrac cfrac binom dbinom tbinom over choose above atop stackrel overset underset
   langle rangle lfloor rfloor lceil rceil lvert rvert Vert lVert rVert vert backslash slash
   hat widehat tilde widetilde bar overline underline vec dot ddot acute grave breve check mathring
   overbrace underbrace overrightarrow overleftarrow
   text textbf textit textrm textsf texttt textnormal
   mathrm mathbf mathit mathsf mathtt mathcal mathbb mathfrak mathscr boldsymbol bm operatorname
   quad qquad enspace thinspace medspace thickspace negthinspace hspace vspace space
   phantom hphantom vphantom smash
   left right big Big bigg Bigg middle
   displaystyle textstyle scriptstyle limits nolimits
   tag notag nonumber label ref eqref hline cline
   array matrix pmatrix bmatrix Bmatrix vmatrix Vmatrix cases aligned align gather split substack
   dots cdots ldots vdots ddots prime partial nabla infty aleph hbar ell Re Im wp
   angle triangle square blacksquare lozenge therefore because
   triangleleft triangleright vartriangleleft vartriangleright unlhd unrhd lhd rhd
   lbrace rbrace lbrack rbrack langle rangle lvert rvert Vert parallel
   hookrightarrow twoheadrightarrow rightleftharpoons iff colon approx ncong
   bigcup bigcap bigsqcup sqcup sqcap uplus sqsubset sqsubseteq sqsupset sqsupseteq
   mathrel mathbin mathord mathopen mathclose mathpunct
   colon dagger ddagger dag S P copyright pounds
   begin end`
    .split(/\s+/)
    .filter(Boolean)
);

/** 这些命令后面紧跟的 {…} 是参数，整块当一个原子 */
const TEXT_CMDS = new Set([
  "text", "textbf", "textit", "textrm", "textsf", "texttt", "textnormal",
  "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathcal", "mathbb",
  "mathfrak", "mathscr", "boldsymbol", "bm", "operatorname",
  "label", "tag", "hspace", "vspace", "begin", "end",
]);

const STRONG_OPS = new Set(["=", "<", ">", "+", "-", "*", "/"]);
const WEAK_OPS = new Set([",", ";", ":", "!", "'", '"']);

/**
 * 定界符规范化：把 \( \[ \{ \langle \left[ \left\{ … 一律映射到同一个「规范键」，
 * 这样 \left[ … \right] 才能和普通 [ … ] 用同一张配对表匹配。
 */
const DELIM_CANON = {
  "(": "(", ")": ")", "[": "[", "]": "]", "{": "{", "}": "}", "|": "|", ".": ".",
  "\\{": "{", "\\}": "}", "\\[": "[", "\\]": "]",
  "\\langle": "\\langle", "\\rangle": "\\rangle",
  "\\lbrace": "{", "\\rbrace": "}",
  "\\lbrack": "[", "\\rbrack": "]",
  "\\lvert": "|", "\\rvert": "|",
  "\\vert": "|", "\\Vert": "|",
  "\\lVert": "|", "\\rVert": "|",
  "\\lfloor": "\\lfloor", "\\rfloor": "\\rfloor",
  "\\lceil": "\\lceil", "\\rceil": "\\rceil",
};

const PAIR = {
  "|": "|",
  "(": ")",
  "[": "]",
  "{": "}",
  ".": ".",
  "\\langle": "\\rangle",
  "\\lfloor": "\\rfloor",
  "\\lceil": "\\rceil",
};

/** 命令名形态的左定界符（不含反斜杠） */
const OPEN_DELIMS = new Set([
  "langle", "lbrace", "lbrack", "lfloor", "lceil", "lvert", "lVert",
]);
/** 二字符转义形态的左定界符 */
const OPEN_DELIMS_TWO = new Set(["\\{", "\\["]);

/**
 * 规范键里「可以当作括号」的那些（开件与闭件都算）。
 * 半开区间 [c, +\infty)、\left(0,1\right] 这类混搭写法靠它做宽容配对。
 */
const BRACKET_KEYS = new Set([
  "(", ")", "[", "]", "{", "}",
  "\\langle", "\\rangle", "\\lfloor", "\\rfloor", "\\lceil", "\\rceil",
]);

function isBracketKey(key) {
  return BRACKET_KEYS.has(key);
}

/** i 指向 '['，返回配对 ']' 之后的下标；用于 \sqrt[3]{x} */
function matchSquare(line, i) {
  let depth = 0;
  let j = i;
  while (j < line.length) {
    const c = line[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return -1;
}

/**
 * 连续吃掉多个 {…} 参数的命令。
 * \frac{a}{b} 的第二个参数、\overset{a}{b} 的第二个参数都必须归到命令 token 里，
 * 否则 {…} 会变成独立括号，把 \frac 的分子分母切成两段。
 */
const MULTI_ARG_CMDS = new Set([
  ...TEXT_CMDS,
  "frac", "dfrac", "tfrac", "cfrac", "binom", "dbinom", "tbinom",
  "overset", "underset", "sqrt", "genfrac", "stackrel",
]);

/** 带可选 [..] 参数的命令：\sqrt[3]{x} */
const OPT_ARG_CMDS = new Set(["sqrt", "genfrac"]);

/* ------------------------------------------------------------------ */
/* 分词                                                                */
/* ------------------------------------------------------------------ */

/** i 指向 '{'，返回配对 '}' 之后的下标；失败返回 -1 */
function readGroup(line, i) {
  let depth = 0;
  let j = i;
  while (j < line.length) {
    const c = line[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return -1;
}

function readScripts(line, j) {
  let hasScript = false;
  let k = j;
  while (k < line.length && (line[k] === "_" || line[k] === "^")) {
    hasScript = true;
    k++;
    if (line[k] === "{") {
      const ge = readGroup(line, k);
      if (ge < 0) return { end: k, hasScript };
      k = ge;
    } else if (line[k] === "\\") {
      // ^\infty / _\alpha：整个命令是上下标的原子，不能只吃反斜杠
      const m = /^\\[A-Za-z]+/.exec(line.slice(k));
      k += m ? m[0].length : 2;
    } else if (k < line.length) {
      k++;
    }
  }
  return { end: k, hasScript };
}

/** 行内代码 `...` 与 ~~~...~~~：整段保护（表格单元格内也要生效） */
function codeIntervals(line) {
  const res = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let n = 1;
    while (line[i + n] === "`") n++;
    const openRun = "`".repeat(n);
    const close = line.indexOf(openRun, i + n);
    if (close < 0) {
      i += n;
      continue;
    }
    res.push([i, close + n]);
    i = close + n;
  }
  return res;
}

/** 引用块 "> "、任务列表 "[x] "、序列表 "1. " 这类行首标记 */
function prefixIntervals(line) {
  const res = [];
  const m = /^(\s*(?:>\s*)+)/.exec(line);
  if (m) res.push([0, m[1].length]);
  const task = /^(\s*[-*+]\s+\[[ xX]\]\s*)/.exec(line);
  if (task) res.push([0, task[1].length]);
  const ol = /^(\s*\d+[.)]\s+)/.exec(line);
  if (ol) res.push([0, ol[1].length]);
  return res;
}

/**
 * 表格行判定：
 * 以 | 开头且以 | 结尾、至少 2 个竖线 → 视为表格行。
 *
 * 说明：整行被 | 包住时（"|a|b|"、"|a|$x$|"），markdown 语义上只可能是表格
 * 或极罕见的 "|…|" 绝对值行；按表格处理能保证表格永不被改成公式，
 * 代价是这类孤立绝对值行不再自动加 $（可读性也更好）。
 */
/** 未转义竖线数量 */
/** 剥掉引用块（> / >>）与列表（- * + 1.）前缀，用于识别嵌在其中的表格 */
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

function pipeCount(line) {
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

function isTableRow(line) {
  const t = stripBlockPrefix(line).trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return false;
  return pipeCount(t) >= 2;
}

/**
 * 文档级表格行集合。
 * 以对齐行（| --- | --- |）为锚点，按「竖线数一致」向上下扩展，
 * 覆盖 | a | b | / a | b | / | a | b / a | b 四种写法；
 * 再兜底处理「整行被 | 包住且 ≥2 竖线」的单行表格。
 */
function findTableLines(lines) {
  const set = new Set();

  const isSep = (t) => {
    const s2 = stripBlockPrefix(t).trim();
    return s2.includes("|") && s2.includes("-") && /^[\s:|-]+$/.test(s2);
  };
  const sameCols = (t, cols) => {
    const s2 = stripBlockPrefix(t).trim();
    if (s2 === "" || !s2.includes("|")) return false;
    return pipeCount(s2) === cols;
  };

  for (let i = 0; i < lines.length; i++) {
    if (!isSep(lines[i])) continue;
    set.add(i);
    const cols = pipeCount(stripBlockPrefix(lines[i]).trim());
    let up = i - 1;
    while (up >= 0 && sameCols(lines[up], cols)) {
      set.add(up);
      up--;
    }
    let down = i + 1;
    while (down < lines.length && sameCols(lines[down], cols)) {
      set.add(down);
      down++;
    }
  }

  // 兜底：整行 | … | 且 ≥2 竖线（无对齐行的单行表格）
  for (let i = 0; i < lines.length; i++) {
    if (set.has(i)) continue;
    const t = stripBlockPrefix(lines[i]).trim();
    if (t.startsWith("|") && t.endsWith("|") && pipeCount(t) >= 2) set.add(i);
  }

  return set;
}

/** 表格对齐行：| --- | :--: | — 只含 | : - 与空白 */
function isTableSeparator(line) {
  const t = stripBlockPrefix(line).trim();
  if (!t.includes("|") || !t.includes("-")) return false;
  return /^[\s:|-]+$/.test(t);
}

/** 链接 / 图片 / 嵌入 / HTML 标签 / callout 标记：整段保护 */
function linkIntervals(line) {
  const res = [];
  const patterns = [
    /!?\[[^\]\n]*\]\([^)\n]*\)/g,   // [文字](url)
    /!?\[\[[^\]\n]*\]\]/g,            // [[wikilink]]
    /<\/?[A-Za-z][^<>\n]*>/g,           // <span> </span> <br/>
    /\[![A-Za-z]+\]/g,                  // callout: [!note]
    /\[\^[^\]\n]*\]/g,                  // 脚注引用 [^1]
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(line)) !== null) res.push([m.index, m.index + m[0].length]);
  }
  return res;
}

function tokenize(line, opts = {}) {
  const tableRow = opts.tableRow === true;
  const toks = [];
  let i = 0;
  const push = (t, s, e, extra) => {
    toks.push(Object.assign({ t, s, e, text: line.slice(s, e) }, extra || {}));
  };

  while (i < line.length) {
    const c = line[i];

    // LaTeX 命令
    if (c === "\\") {
      const m = /^\\([A-Za-z]+)/.exec(line.slice(i));
      if (m) {
        const name = m[1];
        let end = i + m[0].length;

        // 1) 吃参数：MULTI_ARG_CMDS 循环吃 {…}，OPT_ARG_CMDS 先把 [..] 也吃掉
        if (OPT_ARG_CMDS.has(name) && line[end] === "[") {
          const close = matchSquare(line, end);
          if (close > 0) end = close;
        }
        if (MULTI_ARG_CMDS.has(name)) {
          let guard = 0;
          while (line[end] === "{" && guard++ < 4) {
            const ge = readGroup(line, end);
            if (ge < 0) break;
            end = ge;
          }
        } else if (TEXT_CMDS.has(name) && line[end] === "{") {
          const ge = readGroup(line, end);
          if (ge > 0) end = ge;
        }

        // 2) \left[ / \right( 这类：命令与紧随其后的定界符是同一条 token
        let kind = KNOWN_CMDS.has(name) ? "cmd" : "cmdx";
        let canon = null;
        if (name === "left" || name === "right") {
          const rest = line.slice(end);
          const dm = /^(\\(?:[A-Za-z]+)|\\.|[()[\]{}|./])/.exec(rest);
          if (dm) {
            end += dm[0].length;
            canon = DELIM_CANON[dm[1]] || null;
          }
          kind = name === "left" ? "open" : "close";
        } else if (DELIM_CANON["\\" + name] !== undefined) {
          canon = DELIM_CANON["\\" + name];
          kind = OPEN_DELIMS.has(name) ? "open" : "close";
        }

        // 3) \text{Syl}_p / \}_{k=1}^\infty 这种：命令后面还挂上下标
        const csc = readScripts(line, end);

        // 4) \begin{cases} / \end{cases}：环境边界 token，成对闭合
        if (name === "begin" || name === "end") {
          const gm = /^\{([A-Za-z*]+)\}/.exec(line.slice(i + m[0].length));
          if (gm && MATH_ENVS.has(gm[1])) {
            push(name === "begin" ? "envopen" : "envclose", i, end, {
              name2: gm[1],
              hasScript: false,
            });
            i = end;
            continue;
          }
        }

        push(kind, i, csc.end, { name, hasScript: csc.hasScript, canon });
        i = csc.end;
        continue;
      }
      const two = line.slice(i, i + 2);
      if (DELIM_CANON[two] !== undefined) {
        const kind = OPEN_DELIMS_TWO.has(two) ? "open" : "close";
        const csc = readScripts(line, i + 2);
        push(kind, i, csc.end, {
          name: two,
          canon: DELIM_CANON[two],
          hasScript: csc.hasScript,
        });
        i = csc.end;
        continue;
      }
      push("esc", i, i + 2, { name: two });
      i += 2;
      continue;
    }

    if (c === "|") {
      push(tableRow ? "md" : "pipe", i, i + 1);
      i++;
      continue;
    }

    // 行首列表符 * / - / +（后面紧跟空格）：md token
    if (
      (c === "*" || c === "-" || c === "+") &&
      /^[ \t]*$/.test(line.slice(0, i)) &&
      (line[i + 1] === " " || line[i + 1] === "\t")
    ) {
      push("md", i, i + 1, { marker: c });
      i++;
      continue;
    }

    // markdown 强调 / 删除线：只有紧贴文字时才算标记，否则 3 * 4 里的 * 是乘号
    if (c === "*" || c === "_" || c === "~") {
      let run = 1;
      while (line[i + run] === c) run++;
      const len = Math.min(run, 3);
      const before = line[i - 1] || "";
      const after = line[i + len] || "";
      const wordish = (ch) => ch !== "" && !/\s/.test(ch) && !/[0-9]/.test(ch);
      if (wordish(before) || wordish(after)) {
        push("md", i, i + len, { marker: c.repeat(len) });
        i += len;
        continue;
      }
      // 否则落下去按运算符处理
    }

    // 单词 + 上下标
    if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < line.length && /[A-Za-z]/.test(line[j])) j++;
      const word = line.slice(i, j);
      const sc = readScripts(line, j);
      push("word", i, sc.end, { word, hasScript: sc.hasScript });
      i = sc.end;
      continue;
    }

    // 数字（含小数）+ 上下标
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < line.length && /[0-9]/.test(line[j])) j++;
      if (line[j] === "." && /[0-9]/.test(line[j + 1] || "")) {
        j++;
        while (j < line.length && /[0-9]/.test(line[j])) j++;
      }
      const sc = readScripts(line, j);
      push("num", i, sc.end, { hasScript: sc.hasScript });
      i = sc.end;
      continue;
    }

    if (c === " " || c === "\t") {
      let j = i;
      while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
      push("space", i, j);
      i = j;
      continue;
    }

    if ("([{".includes(c)) {
      push("open", i, i + 1);
      i++;
      continue;
    }
    if (")]}".includes(c)) {
      push("close", i, i + 1);
      i++;
      continue;
    }

    if (STRONG_OPS.has(c)) {
      push("sop", i, i + 1);
      i++;
      continue;
    }
    if (WEAK_OPS.has(c)) {
      push("wop", i, i + 1);
      i++;
      continue;
    }
    // 环境内部分隔符：& （列分隔）、\\ （换行，已在 esc 分支）
    if (c === "&") {
      push("amp", i, i + 1);
      i++;
      continue;
    }

    push("other", i, i + 1);
    i++;
  }
  return toks;
}

/* ------------------------------------------------------------------ */
/* token 判定                                                          */
/* ------------------------------------------------------------------ */

function nextNonSpace(toks, i) {
  let j = i + 1;
  while (j < toks.length && toks[j].t === "space") j++;
  return j < toks.length ? j : -1;
}

function prevNonSpace(toks, i) {
  let j = i - 1;
  while (j >= 0 && toks[j].t === "space") j--;
  return j >= 0 ? j : -1;
}

function isShortWord(tk) {
  return !!tk && tk.t === "word" && tk.word.length <= 2;
}

function isMathTok(toks, i, level) {
  const tk = toks[i];
  if (!tk) return false;
  switch (tk.t) {
    case "cmd":
    case "esc":
    case "pipe":
    case "sop":
    case "open":
    case "close":
      return true;
    case "num":
      if (level < 2) return false;
      return tk.hasScript || followedByStrongOp(toks, i) || precededByMathOp(toks, i);
    case "word":
      if (level < 2) return false;
      return tk.hasScript || isShortWord(tk);
    default:
      return false;
  }
}

function precededByMathOp(toks, i) {
  const p = prevNonSpace(toks, i);
  if (p < 0) return false;
  const t = toks[p].t;
  return t === "cmd" || t === "sop" || t === "pipe";
}

function followedByStrongOp(toks, i) {
  const n = nextNonSpace(toks, i);
  if (n < 0) return false;
  const t = toks[n].t;
  return t === "sop" || t === "cmd";
}

/** 起点必须自带硬证据，否则每个普通单词都会被当成公式 */
function hasLocalEvidence(toks, i, level) {
  const tk = toks[i];
  if (!tk) return false;
  if (tk.t === "cmd" || tk.t === "esc" || tk.t === "pipe") return true;
  if (level < 2) return false;
  if (tk.hasScript) return true;
  const n = nextNonSpace(toks, i);
  if (n < 0) return false;
  const nt = toks[n];
  if (nt.t === "sop" || nt.t === "cmd") return true;
  if (nt.t === "open" && tk.t === "word" && tk.word.length <= 3) return true;
  return false;
}

const BRACKET_STARTS = new Set(["(", "[", "{", "|", "\\langle", "\\lfloor", "\\lceil"]);

function canStart(toks, i, level) {
  const tk = toks[i];
  if (!tk) return false;
  if (tk.t === "cmd" || tk.t === "esc" || tk.t === "pipe" || tk.t === "envopen") return true;
  if (tk.t === "open") return level >= 2 && BRACKET_STARTS.has(tk.canon || tk.text);
  if (tk.t === "word" || tk.t === "num") return hasLocalEvidence(toks, i, level);
  return false;
}

/* ------------------------------------------------------------------ */
/* 区间生长                                                            */
/* ------------------------------------------------------------------ */

/**
 * 从 i 出发向两侧生长，返回 { left, right, pending }。
 * pending > 0 表示还有未闭合的括号/环境 —— 该区间作废。
 */
function grow(toks, i, level) {
  const stack = [];
  let left = i;

  // 向左吸收紧邻的开括号与左操作数
  while (true) {
    const p = prevNonSpace(toks, left);
    if (p < 0) break;
    const tk = toks[p];
    if (tk.t === "open") {
      left = p;
      stack.push(tk.canon || tk.text);
      break;
    }
    // level 1 只允许向左吸收命令 / 竖线 / 运算符，保持“保守”
    const leftOk =
      tk.t === "sop" || tk.t === "wop" || tk.t === "cmd" || tk.t === "esc" ||
      tk.t === "pipe" || tk.t === "amp" ||
      (level >= 2 && (tk.t === "num" || isShortWord(tk)));
    if (!leftOk) break;
    left = p;
  }

  /** 当前是否在 \begin{…} 环境内部（cases / aligned / matrix …） */
  const inEnv = () => stack.some((k) => k.startsWith("env:"));

  let j = i;
  let right = i;
  while (j < toks.length) {
    const tk = toks[j];

    // ---- 环境边界 ----
    if (tk.t === "envopen") {
      stack.push("env:" + tk.name2);
      right = j;
      j++;
      continue;
    }
    if (tk.t === "envclose") {
      const key = "env:" + tk.name2;
      const at = stack.lastIndexOf(key);
      if (at >= 0) {
        stack.splice(at, 1);
        right = j;
        j++;
        continue;
      }
      // 不配对的 \end：退出该区间
      break;
    }

    // 环境内部：一切都可以继续（& 列分隔、\\ 换行、任意标识符与数字）
    if (inEnv()) {
      if (tk.t === "amp" || tk.t === "esc" || tk.t === "sop" || tk.t === "wop" ||
          tk.t === "word" || tk.t === "num" || tk.t === "space" ||
          tk.t === "cmd" || tk.t === "cmdx" || tk.t === "pipe") {
        right = j;
        j++;
        continue;
      }
      const key = tk.canon || tk.text;
      if (tk.t === "open") {
        stack.push(key);
        right = j;
        j++;
        continue;
      }
      if (tk.t === "close") {
        const top = stack[stack.length - 1];
        if (top && PAIR[top] === key) stack.pop();
        right = j;
        j++;
        continue;
      }
      break;
    }

    // 竖线成对：第一个是开，第二个是闭
    if (tk.t === "pipe") {
      if (stack[stack.length - 1] === "|") {
        stack.pop();
      } else {
        stack.push("|");
      }
      right = j;
      j++;
      continue;
    }
    if (tk.t === "open") {
      stack.push(tk.canon || tk.text);
      right = j;
      j++;
      continue;
    }
    if (tk.t === "close") {
      const top = stack[stack.length - 1];
      const key = tk.canon || tk.text;
      if (!stack.length) break;
      if (top && PAIR[top] === key) {
        stack.pop();
      } else if (top && top !== "|" && isBracketKey(top) && isBracketKey(key)) {
        // 宽容配对：半开区间写法 [c, +\infty)、\left(0,1\right] 这类混搭括号
        stack.pop();
      }
      right = j;
      j++;
      continue;
    }
    if (tk.t === "space") {
      const n = nextNonSpace(toks, j);
      if (n < 0) break;
      const nt = toks[n];
      const insideParen = stack.length > 0;
      const ok =
        nt.t === "cmd" || nt.t === "cmdx" || nt.t === "esc" || nt.t === "pipe" ||
        nt.t === "sop" || nt.t === "wop" || nt.t === "open" || nt.t === "amp" ||
        nt.t === "envopen" ||
        (nt.t === "word" && (nt.hasScript || (insideParen && nt.word.length <= 8))) ||
        (isShortWord(nt) && isMathTok(toks, n, level)) ||
        (nt.t === "num" &&
          (nt.hasScript || insideParen || followedByStrongOp(toks, n) || precededByMathOp(toks, n))) ||
        (nt.t === "close" && insideParen);
      if (!ok) break;
      j = n;
      continue;
    }
    if (tk.t === "wop") {
      const n2 = nextNonSpace(toks, j);
      const ntk = n2 >= 0 ? toks[n2] : null;
      const continues =
        stack.length > 0 ||
        (ntk &&
          (ntk.t === "cmd" || ntk.t === "cmdx" || ntk.t === "pipe" || ntk.t === "sop" ||
            (ntk.t === "word" && (ntk.hasScript || ntk.word.length <= 3)) ||
            (ntk.t === "num" && ntk.hasScript)));
      if (continues) {
        right = j;
        j++;
        continue;
      }
      break;
    }
    // 括号内允许任意标识符与数字（qxP、[G:P]、\{1, 8, 48\}）
    if ((tk.t === "word" || tk.t === "num") && stack.length > 0) {
      right = j;
      j++;
      continue;
    }
    // 顶层括号刚闭合：后面直接跟标识符说明公式已结束
    if (stack.length === 0 && right > left && toks[right].t === "close" && tk.t === "word") {
      const n3 = nextNonSpace(toks, j);
      const ntk3 = n3 >= 0 ? toks[n3] : null;
      if (!ntk3 || (ntk3.t !== "sop" && ntk3.t !== "cmd" && ntk3.t !== "pipe")) break;
    }
    if (isMathTok(toks, j, level)) {
      right = j;
      j++;
      continue;
    }
    break;
  }

  return { left, right, pending: stack.length };
}

/* ------------------------------------------------------------------ */
/* 证据校验                                                            */
/* ------------------------------------------------------------------ */

function hasEvidence(text) {
  if (/\\[A-Za-z]+/.test(text)) return true;
  if (/\\[{}|\[\]]/.test(text)) return true;
  if (text.includes("|")) return true;
  if (/[\^_]/.test(text)) return true;
  if (/[=<>]/.test(text)) return true;
  // 纯数字运算：必须带字母或比较符才算公式，避免把 2024-05-01 这类日期圈进去
  if (/[+\-*/]/.test(text) && /[A-Za-z]/.test(text)) return true;
  if (/[+\-*/]/.test(text) && /[=<>]/.test(text)) return true;
  if (/[A-Za-z0-9]\s*[(\[].*[)\]]/.test(text)) return true;
  return false;
}

function trimSpan(line, start, end) {
  const edgeSoft = (ch) => /[ \t,;:!]/.test(ch);
  const edgeHard = (ch) => /[=<>+\-*/^_]/.test(ch);
  while (start < end && edgeSoft(line[start])) start++;
  let prev = -1;
  while (end > start && end !== prev) {
    prev = end;
    while (end > start && edgeSoft(line[end - 1])) end--;
    while (end > start && edgeHard(line[end - 1])) {
      // 不要把 "\" 转义命令的尾巴切掉
      if (line[end - 2] === "\\") break;
      end--;
    }
  }
  return [start, end];
}

/** 中文只允许出现在 {…} 参数里（\text{其中 }） */
function cjkOutsideBraces(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (CJK_RE.test(c) && depth === 0) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* 对外：一行内找出公式区间                                            */
/* ------------------------------------------------------------------ */

function findSpans(line, level = 2, protectedIntervals = [], forceTable = undefined) {
  if (level <= 0) return [];
  if (isTableSeparator(line)) return [];
  const tableRow = forceTable === true ? true : isTableRow(line);
  const prot = protectedIntervals.concat(
    linkIntervals(line),
    prefixIntervals(line),
    codeIntervals(line)
  );
  const toks = tokenize(line, { tableRow });
  const inProt = (pos) => prot.some(([a, b]) => pos >= a && pos < b);

  const spans = [];
  let i = 0;
  let acceptedEnd = -1;
  while (i < toks.length) {
    const tk = toks[i];
    if (tk.s < acceptedEnd || inProt(tk.s) || !canStart(toks, i, level)) {
      i++;
      continue;
    }
    let { left, right, pending } = grow(toks, i, level);
    while (left < right && toks[left].s < acceptedEnd) left++;
    if (!pending && right >= left) {
      const [a, b] = trimSpan(line, toks[left].s, toks[right].e);
      const text = line.slice(a, b);
      if (b - a >= 2 && !inProt(a) && hasEvidence(text) && !cjkOutsideBraces(text)) {
        spans.push([a, b]);
        acceptedEnd = b;
        i = right + 1;
        continue;
      }
    }
    i++;
  }
  return spans;
}

/* ------------------------------------------------------------------ */
/* level 3：中文之间的孤立单字母                                        */
/* ------------------------------------------------------------------ */

function findLoneLetters(line, level, prot, taken) {
  if (level < 3) return [];
  const res = [];
  const occupied = (i) =>
    prot.some(([a, b]) => i >= a && i < b) || taken.some(([a, b]) => i >= a && i < b);
  // 左右相邻允许隔一个空格："设 G 为" 里的 G
  const neighbour = (from, step) => {
    let k = from;
    let skipped = 0;
    while (k >= 0 && k < line.length && skipped <= 1) {
      const ch = line[k];
      if (ch === " " || ch === "\t") {
        skipped++;
        k += step;
        continue;
      }
      return ch;
    }
    return "";
  };

  for (let i = 1; i < line.length - 1; i++) {
    const c = line[i];
    if (!/[A-Za-z]/.test(c)) continue;
    if (occupied(i)) continue;
    const prev = neighbour(i - 1, -1);
    const next = neighbour(i + 1, 1);
    if (!prev || !next) continue;
    if (!CJK_RE.test(prev) && !/[（(、，,]/.test(prev)) continue;
    if (!CJK_RE.test(next) && !/[）)、，,。：:]/.test(next)) continue;
    if (c === "A" && next === "、") continue;
    if (c === "I" && next === ",") continue; // 英文 "I,"
    res.push([i, i + 1]);
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* 表格行：按单元格分别识别                                            */
/* ------------------------------------------------------------------ */

/** 按未转义的 | 切分表格行，返回 [{start,end}] 单元格内容区间 */
function tableCells(line) {
  const cuts = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "|") cuts.push(i);
  }
  if (cuts.length < 2) return [];
  const cells = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    cells.push([cuts[k] + 1, cuts[k + 1]]);
  }
  return cells;
}

/**
 * 表格行只在单元格内部找公式，竖线始终是单元格分隔符。
 * 返回 { text, count }。
 */
function convertTableLine(line, level) {
  const cells = tableCells(line);
  if (cells.length === 0) return { text: line, count: 0 };

  let text = "";
  let count = 0;
  let pos = 0;
  for (const [a, b] of cells) {
    text += line.slice(pos, a);
    const cell = line.slice(a, b);
    const prot = dollarIntervals(cell)
      .concat(linkIntervals(cell))
      .concat(codeIntervals(cell));
    const spans = findSpans(cell, level, prot, false);
    if (spans.length === 0) {
      text += cell;
    } else {
      let out = "";
      let p = 0;
      for (const [x, y] of spans) {
        out += cell.slice(p, x) + "$" + cell.slice(x, y) + "$";
        p = y;
      }
      out += cell.slice(p);
      text += out;
      count += spans.length;
    }
    pos = b;
  }
  text += line.slice(pos);
  return { text, count };
}

/* ------------------------------------------------------------------ */
/* 行级组装                                                            */
/* ------------------------------------------------------------------ */

const OPEN_ENV_RE = /\\begin\{([A-Za-z*]+)\}/;
const MATH_ENVS = new Set([
  "equation", "equation*", "align", "align*", "aligned", "gather", "gather*",
  "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "cases",
  "array", "split", "multline", "multline*", "eqnarray", "eqnarray*", "substack",
]);

function dollarIntervals(line) {
  const res = [];
  const re = /\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g;
  let m;
  while ((m = re.exec(line)) !== null) res.push([m.index, m.index + m[0].length]);
  return res;
}

function segmentsOf(line, spans) {
  const segs = [];
  let pos = 0;
  for (const [a, b] of spans) {
    if (a > pos) segs.push({ t: "text", v: line.slice(pos, a) });
    segs.push({ t: "math", v: line.slice(a, b) });
    pos = b;
  }
  if (pos < line.length) segs.push({ t: "text", v: line.slice(pos) });
  return segs;
}

function isPureMathLine(line, spans, segs, forceTable = undefined) {
  if (spans.length === 0) return false;
  if (forceTable === undefined ? isTableRow(line) : forceTable) return false;
  if (CJK_RE.test(line)) return false;
  const rest = segs.filter((s) => s.t === "text").map((s) => s.v).join("");
  if (rest.replace(/[\s,;:.!·|]+/g, "") !== "") return false;
  const body = segs.filter((s) => s.t === "math").map((s) => s.v).join(" ");
  return /[=<>^_\\]|[a-zA-Z]\s*[-+*/]\s*[a-zA-Z0-9]/.test(body);
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

function convertBareFormulas(input, opts = {}) {
  const level = opts.level === undefined ? 2 : Math.max(0, Math.min(3, Number(opts.level) || 0));
  if (typeof input !== "string" || input === "" || level === 0) {
    return { output: input || "", inlineCount: 0, displayCount: 0, skipped: 0 };
  }
  const skipHeadings = opts.skipHeadings !== false;
  const skip = __collectSkipRanges(input);
  const lines = input.split("\n");
  const starts = [];
  let acc = 0;
  for (const l of lines) {
    starts.push(acc);
    acc += l.length + 1;
  }

  // 跨行的 $$ … $$ 块：整块保护，避免二次扫描把块内内容再包一层
  const displayLines = new Set();
  {
    let inDisp = false;
    for (let k = 0; k < lines.length; k++) {
      const cnt = (lines[k].match(/\$\$/g) || []).length;
      if (inDisp) {
        displayLines.add(k);
        if (cnt % 2 === 1) inDisp = false;
        continue;
      }
      if (cnt % 2 === 1) {
        displayLines.add(k);
        inDisp = true;
      }
    }
  }

  const tableLines = findTableLines(lines);

  const out = [];
  let inlineCount = 0;
  let displayCount = 0;

  const protectedLine = (idx) => {
    const s = starts[idx];
    const e = s + lines[idx].length;
    return skip.some(([a, b]) => a <= s && b >= e);
  };

  const localProt = (idx) => {
    const s = starts[idx];
    const e = s + lines[idx].length;
    return skip
      .filter(([a, b]) => b > s && a < e)
      .map(([a, b]) => [Math.max(a, s) - s, Math.min(b, e) - s])
      .concat(dollarIntervals(lines[idx]));
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    if (line.trim() === "" || protectedLine(idx) || displayLines.has(idx)) {
      out.push(line);
      continue;
    }
    if (skipHeadings && /^\s{0,3}#{1,6}\s/.test(line)) {
      out.push(line);
      continue;
    }

    // ---------- 多行 \begin{env} … \end{env} ----------
    const envM = OPEN_ENV_RE.exec(line);
    if (envM && MATH_ENVS.has(envM[1])) {
      const env = envM[1];
      const tag = "\\end{" + env + "}";
      if (line.indexOf(tag) === -1) {
        let j = idx + 1;
        while (j < lines.length && lines[j].indexOf(tag) === -1) j++;
        if (j < lines.length) {
          const beginPos = envM.index;
          const prefix = line.slice(0, beginPos);
          const endPos = lines[j].indexOf(tag) + tag.length;
          const suffix = lines[j].slice(endPos);

          // 吸收上方紧邻的纯公式行（"A =" 这种）
          const absorbed = [];
          while (out.length > 0) {
            const k = idx - absorbed.length - 1;
            if (k < 0) break;
            const prevLine = lines[k];
            if (prevLine.trim() === "" || protectedLine(k)) break;

            const frag = prevLine.trim();
            // 形如 "A =" / "f(x) ="：以运算符结尾的纯公式碎片
            const isTrailingOp =
              /^[A-Za-z0-9_^{}\\(\[\])\s]*[=<>+\-*/]$/.test(frag) && /[A-Za-z0-9]/.test(frag);

            const pSpans = findSpans(prevLine, level, dollarIntervals(prevLine));
            const pure = pSpans.length
              ? isPureMathLine(prevLine, pSpans, segmentsOf(prevLine, pSpans))
              : false;
            if (!isTrailingOp && !pure) break;
            absorbed.unshift(prevLine);
            out.pop();
          }

          const body = [
            line.slice(beginPos),
            ...lines.slice(idx + 1, j),
            lines[j].slice(0, endPos),
          ].join("\n");
          const content = absorbed.length ? absorbed.join("\n") + "\n" + body : body;

          if (prefix.trim() !== "") out.push(prefix.replace(/[ \t]+$/, ""));
          out.push("$$\n" + content + "\n$$");
          displayCount++;
          if (suffix.trim() !== "") out.push(suffix.replace(/^[ \t]+/, ""));
          idx = j;
          continue;
        }
      }
    }

    // ---------- 普通行 ----------
    const prot = localProt(idx);
    const inTable = tableLines.has(idx) || isTableRow(line) || isTableSeparator(line);

    if (inTable) {
      const t = convertTableLine(line, level);
      out.push(t.text);
      inlineCount += t.count;
      continue;
    }

    let spans = findSpans(line, level, prot, false);
    spans = spans.concat(findLoneLetters(line, level, prot, spans));
    spans.sort((a, b) => a[0] - b[0]);

    const clean = [];
    let lastEnd = -1;
    for (const sp of spans) {
      if (sp[0] >= lastEnd) {
        clean.push(sp);
        lastEnd = sp[1];
      }
    }

    if (clean.length === 0) {
      out.push(line);
      continue;
    }

    const segs = segmentsOf(line, clean);
    if (isPureMathLine(line, clean, segs, inTable)) {
      const body = clean.map(([a, b]) => line.slice(a, b)).join(" ");
      const prevBlank = idx === 0 || lines[idx - 1].trim() === "";
      const nextBlank = idx === lines.length - 1 || lines[idx + 1].trim() === "";
      if (prevBlank && nextBlank) {
        out.push("$$" + body + "$$");
        displayCount++;
      } else {
        out.push("$" + body + "$");
        inlineCount++;
      }
      continue;
    }

    let text = "";
    for (const seg of segs) text += seg.t === "math" ? "$" + seg.v + "$" : seg.v;
    inlineCount += clean.length;
    out.push(text);
  }

  // ---------- 收尾：连续多行纯公式合并成一个 $$ 块 ----------
  const merged = mergePureRuns(out);
  displayCount += merged.blocks;
  inlineCount -= merged.consumed;

  return { output: merged.lines.join("\n"), inlineCount, displayCount, skipped: 0 };
}

/**
 * 把相邻的若干 "纯公式单行"（已各自包成 $…$）合并成一个 $$ 块。
 * 只在整段左右都是空行/文件边界时合并，避免动到正常排版。
 */
function mergePureRuns(lines) {
  const PURE = /^\$([^$\n]+)\$$/;
  const outLines = [];
  let blocks = 0;
  let consumed = 0;
  let i = 0;

  while (i < lines.length) {
    const m = PURE.exec(lines[i]);
    if (!m) {
      outLines.push(lines[i]);
      i++;
      continue;
    }
    // 收集连续纯公式行
    let j = i;
    const bodies = [];
    while (j < lines.length) {
      const mm = PURE.exec(lines[j]);
      if (!mm) break;
      bodies.push(mm[1]);
      j++;
    }
    if (bodies.length < 2) {
      outLines.push(lines[i]);
      i++;
      continue;
    }
    const prevBlank = i === 0 || lines[i - 1].trim() === "";
    const nextBlank = j >= lines.length || lines[j].trim() === "";
    if (!prevBlank || !nextBlank) {
      for (let k = i; k < j; k++) outLines.push(lines[k]);
      i = j;
      continue;
    }
    outLines.push("$$\n" + bodies.join(" \\\\\n") + "\n$$");
    blocks += 1;
    consumed += bodies.length;
    i = j;
  }

  return { lines: outLines, blocks, consumed };
}

module.exports = { convertBareFormulas, findSpans, tokenize };
