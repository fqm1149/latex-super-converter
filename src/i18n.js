"use strict";

/**
 * 国际化（中 / 英）
 * ---------------------------------------------------------------
 * 只做一件事：给一个 key，返回当前语言的字符串。
 *
 * 语言来源优先级：
 *   1. 用户设置里的 language（"zh" / "en"）
 *   2. 设置是 "auto" 时，跟随 Obsidian 界面语言（moment.locale()）
 *   3. 兜底中文
 *
 * 参数插值用 {name} 形式，避免拼接时的语序问题。
 */

const STRINGS = {
  zh: {
    "ribbon.tooltip": "转换 LaTeX（含裸公式智能识别）",

    "cmd.convertCurrent": "转换当前笔记的 LaTeX",
    "cmd.delimitersOnly": "只转换 \\( \\) 与 \\[ \\] 分隔符",
    "cmd.bareOnly": "只智能识别裸公式",
    "cmd.selection": "转换选中的 LaTeX",
    "cmd.wholeVault": "转换整个库的 LaTeX",

    "menu.convert": "转换 LaTeX",

    "notice.prefix.done": "已转换",
    "notice.sep": "：",
    "notice.prefix.selection": "已转换选中内容",
    "notice.done": "分隔符 行内 {inline} / 行间 {block}，裸公式 {bare} 处",
    "notice.skipped": "跳过 {skipped} 个代码块/行内代码",
    "notice.nothing": "没有需要转换的内容",
    "notice.blocked":
      "已取消写入：转换结果未通过完整性校验（{issues}）。原文保持不变。",
    "notice.blockedHint":
      "这通常说明遇到了尚未支持的 LaTeX 写法。可关闭「安全检查」后重试，或把这段内容反馈给开发者。",
    "notice.busy": "正在转换，请稍候…",
    "notice.vaultDone": "全库转换完成：{files} 个文件",
    "notice.vaultBlocked": "跳过了 {files} 个文件（未通过完整性校验）：{list}",

    "settings.heading.behavior": "转换行为",
    "settings.heading.safety": "安全检查",
    "settings.heading.language": "语言",

    "settings.bareLevel.name": "裸公式识别强度",
    "settings.bareLevel.desc":
      "识别没有任何定界符的 LaTeX 公式。强度越高识别越多，误判风险也越大。",
    "settings.bareLevel.off": "关闭",
    "settings.bareLevel.safe": "保守（仅 \\命令 与 |…|）",
    "settings.bareLevel.standard": "标准（推荐）",
    "settings.bareLevel.aggressive": "激进（含中文间单字母）",

    "settings.bareOnRibbon.name": "左栏按钮启用裸公式识别",
    "settings.bareOnRibbon.desc":
      "关闭后，左栏按钮只转换 \\( \\) 与 \\[ \\] 分隔符，不动裸公式。",

    "settings.isolateDisplay.name": "行间公式独占一行",
    "settings.isolateDisplay.desc":
      "在 $$ 前后各加一个换行，让实时预览更稳定地渲染。表格内会自动降级为行内公式。",

    "settings.showNotice.name": "转换完成后显示提示",
    "settings.showNotice.desc": "在右下角显示转换了多少处。",

    "settings.convertOnSave.name": "保存时自动转换",
    "settings.convertOnSave.desc":
      "每次保存笔记时自动跑一遍。建议先手动确认效果再开启。",

    "settings.integrity.name": "写回前做完整性校验（推荐开启）",
    "settings.integrity.desc":
      "写入前检查 $ 是否成对、上下标是否被切断、LaTeX 命令是否丢失。不通过就放弃写入，原文保持不变。这是防止转换事故的最后一道防线。",

    "settings.language.name": "界面语言",
    "settings.language.desc": "切换设置面板与提示文字的语言，需重新加载插件生效。",
    "settings.language.auto": "跟随 Obsidian",
    "settings.language.zh": "中文",
    "settings.language.en": "English",

    "settings.about":
      "把 \\( \\) 与 \\[ \\] 转成 $ 与 $$，并智能识别没有定界符的裸公式。表格、加粗、代码块、链接完全保留。",
  },

  en: {
    "ribbon.tooltip": "Convert LaTeX (with smart bare-formula detection)",

    "cmd.convertCurrent": "Convert LaTeX in current note",
    "cmd.delimitersOnly": "Convert \\( \\) and \\[ \\] delimiters only",
    "cmd.bareOnly": "Detect bare formulas only",
    "cmd.selection": "Convert LaTeX in selection",
    "cmd.wholeVault": "Convert LaTeX across the whole vault",

    "menu.convert": "Convert LaTeX",

    "notice.prefix.done": "Converted",
    "notice.sep": ": ",
    "notice.prefix.selection": "Converted selection",
    "notice.done": "{inline} inline / {block} display delimiters, {bare} bare formulas",
    "notice.skipped": "Skipped {skipped} code block(s) / inline code",
    "notice.nothing": "Nothing to convert",
    "notice.blocked":
      "Write cancelled: the result failed the integrity check ({issues}). The note was left untouched.",
    "notice.blockedHint":
      "This usually means an unsupported LaTeX construct. Disable the safety check to retry, or report the snippet to the developer.",
    "notice.busy": "A conversion is already running, please wait…",
    "notice.vaultDone": "Vault conversion finished: {files} file(s)",
    "notice.vaultBlocked":
      "Skipped {files} file(s) that failed the integrity check: {list}",

    "settings.heading.behavior": "Behaviour",
    "settings.heading.safety": "Safety",
    "settings.heading.language": "Language",

    "settings.bareLevel.name": "Bare formula detection",
    "settings.bareLevel.desc":
      "Detect LaTeX formulas that have no delimiters at all. Higher levels catch more but risk more false positives.",
    "settings.bareLevel.off": "Off",
    "settings.bareLevel.safe": "Conservative (\\commands and |…| only)",
    "settings.bareLevel.standard": "Standard (recommended)",
    "settings.bareLevel.aggressive": "Aggressive (incl. lone letters in CJK)",

    "settings.bareOnRibbon.name": "Include bare detection in the ribbon button",
    "settings.bareOnRibbon.desc":
      "When off, the ribbon button only converts \\( \\) and \\[ \\] and leaves bare formulas alone.",

    "settings.isolateDisplay.name": "Put display math on its own line",
    "settings.isolateDisplay.desc":
      "Adds a newline before and after $$ so Live Preview renders it more reliably. Inside tables it falls back to inline math.",

    "settings.showNotice.name": "Show a notice when done",
    "settings.showNotice.desc": "Report how many conversions happened.",

    "settings.convertOnSave.name": "Convert automatically on save",
    "settings.convertOnSave.desc":
      "Runs on every save. Try the manual command first.",

    "settings.integrity.name": "Verify before writing back (recommended)",
    "settings.integrity.desc":
      "Checks that $ is balanced, that scripts were not cut in half, and that no LaTeX command was lost. If the check fails, nothing is written and the note stays as it was. This is the last line of defence against a bad conversion.",

    "settings.language.name": "Interface language",
    "settings.language.desc":
      "Language for the settings panel and notices. Reload the plugin to apply.",
    "settings.language.auto": "Follow Obsidian",
    "settings.language.zh": "中文",
    "settings.language.en": "English",

    "settings.about":
      "Turns \\( \\) and \\[ \\] into $ and $$, and detects bare LaTeX formulas that have no delimiters. Tables, bold, code blocks, and links are fully preserved.",
  },
};

const SUPPORTED = ["zh", "en"];

/** 把任意语言标记规整成 zh / en */
function normalizeLanguage(value) {
  if (!value || value === "auto") return null;
  const lower = String(value).toLowerCase();
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("en")) return "en";
  return null;
}

/**
 * 检测 Obsidian 当前界面语言。
 * Obsidian 暴露全局 moment；拿不到就退回浏览器语言。
 */
function detectObsidianLanguage() {
  try {
    if (typeof moment !== "undefined" && typeof moment.locale === "function") {
      const locale = normalizeLanguage(moment.locale());
      if (locale) return locale;
    }
  } catch (err) {
    /* 忽略：不能用 moment 时走下面的兜底 */
  }

  try {
    if (typeof navigator !== "undefined" && navigator.language) {
      const locale = normalizeLanguage(navigator.language);
      if (locale) return locale;
    }
  } catch (err) {
    /* 忽略 */
  }

  return "zh";
}

/**
 * 解析最终语言。
 * @param {"auto"|"zh"|"en"} setting 用户设置
 * @returns {"zh"|"en"}
 */
function resolveLanguage(setting) {
  return normalizeLanguage(setting) || detectObsidianLanguage();
}

/**
 * 取字符串并做 {name} 插值。
 * 缺失的 key 返回 key 本身，便于早期发现漏翻译。
 */
function createTranslator(setting) {
  const lang = resolveLanguage(setting);
  const table = STRINGS[lang] || STRINGS.zh;

  return function t(key, params) {
    let text = table[key];
    if (text === undefined) text = STRINGS.zh[key];
    if (text === undefined) return key;
    if (!params) return text;

    return text.replace(/\{(\w+)\}/g, function (match, name) {
      return Object.prototype.hasOwnProperty.call(params, name)
        ? String(params[name])
        : match;
    });
  };
}

module.exports = {
  STRINGS,
  SUPPORTED,
  normalizeLanguage,
  detectObsidianLanguage,
  resolveLanguage,
  createTranslator,
};
