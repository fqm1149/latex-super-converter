"use strict";

const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  MarkdownView,
  TFile,
} = require("obsidian");

const DEFAULT_SETTINGS = {
  isolateDisplay: true,
  mathOnly: false,
  convertWholeVaultOnClick: false,
  showNotice: true,
  convertOnSave: false,
  // 裸公式智能识别
  bareLevel: 2,
  bareOnRibbon: true,
};

/* ------------------------------------------------------------------ */
/* 组合流水线                                                          */
/* ------------------------------------------------------------------ */

/**
 * 一步到位：先转换 \( \) / \[ \]，再（可选）智能补全裸公式。
 * @returns {{output: string, inlineCount: number, displayCount: number, skipped: number, bareInline: number, bareDisplay: number}}
 */
function convertAll(input, opts = {}) {
  const useDelimiters = opts.delimiters !== false;
  const delim = useDelimiters
    ? convertLatexDelimiters(input, {
        isolateDisplay: opts.isolateDisplay !== false,
        mathOnly: opts.mathOnly === true,
      })
    : { output: input, inlineCount: 0, displayCount: 0, skipped: 0 };

  const bareLevel = opts.bareLevel === undefined ? 0 : Number(opts.bareLevel) || 0;
  if (bareLevel <= 0) {
    return Object.assign({}, delim, { bareInline: 0, bareDisplay: 0 });
  }

  const bare = convertBareFormulas(delim.output, {
    level: bareLevel,
    skipHeadings: true,
  });

  return {
    output: bare.output,
    inlineCount: delim.inlineCount,
    displayCount: delim.displayCount,
    skipped: delim.skipped || 0,
    bareInline: bare.inlineCount,
    bareDisplay: bare.displayCount,
  };
}

/* ------------------------------------------------------------------ */
/* 插件主体                                                            */
/* ------------------------------------------------------------------ */

class LatexSuperConverterPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this._writing = new Set();

    // 左栏功能区按钮
    this.ribbonEl = this.addRibbonIcon("sigma", "转换 LaTeX（含裸公式智能识别）", async (evt) => {
      await this.runPrimaryAction(evt);
    });
    this.ribbonEl.addClass("latex-super-converter-ribbon");

    // 命令：一键全处理（默认）
    this.addCommand({
      id: "convert-current-note",
      name: "转换当前笔记（分隔符 + 裸公式）",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) this.convertActiveView(view);
        return true;
      },
    });

    // 命令：只处理 \( \) 与 \[ \]
    this.addCommand({
      id: "convert-delimiters-only",
      name: "只转换 \\( \\) 与 \\[ \\] 分隔符",
      editorCheckCallback: (checking, editor) => {
        if (!checking) this.convertEditor(editor, { bareLevel: 0 });
        return true;
      },
    });

    // 命令：只补裸公式
    this.addCommand({
      id: "convert-bare-only",
      name: "只智能识别裸公式并加定界符",
      editorCheckCallback: (checking, editor) => {
        if (!checking) this.convertEditor(editor, { delimiters: false });
        return true;
      },
    });

    // 命令：选中内容
    this.addCommand({
      id: "convert-selection",
      name: "转换选中内容",
      editorCheckCallback: (checking, editor) => {
        if (!editor.somethingSelected()) return false;
        if (!checking) this.convertSelection(editor);
        return true;
      },
    });

    // 命令：整个仓库
    this.addCommand({
      id: "convert-whole-vault",
      name: "转换整个仓库",
      callback: () => this.convertWholeVault(),
    });

    // 右键菜单
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (!editor.somethingSelected()) return;
        menu.addItem((item) =>
          item
            .setTitle("转换选中内容的 LaTeX")
            .setIcon("sigma")
            .onClick(() => this.convertSelection(editor))
        );
      })
    );

    // 可选：保存时自动转换
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (!this.settings.convertOnSave) return;
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (this._busy) return;
        if (this._writing.has(file.path)) return;
        await this.convertFile(file, { silent: true });
      })
    );

    this.addSettingTab(new LatexSuperConverterSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** 当前生效的转换参数 */
  pipelineOpts(override = {}) {
    return Object.assign(
      {
        isolateDisplay: this.settings.isolateDisplay,
        mathOnly: this.settings.mathOnly,
        bareLevel: this.settings.bareOnRibbon ? this.settings.bareLevel : 0,
        delimiters: true,
      },
      override
    );
  }

  /** 左栏按钮点击行为 */
  async runPrimaryAction(evt) {
    const wholeVault = evt?.altKey
      ? !this.settings.convertWholeVaultOnClick
      : this.settings.convertWholeVaultOnClick;

    if (wholeVault) {
      await this.convertWholeVault();
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) {
      await this.convertActiveView(view);
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (file && file.extension === "md") {
      await this.convertFile(file);
      return;
    }
    new Notice("请先打开一篇 Markdown 笔记");
  }

  /** 转换当前视图（走编辑器，保留撤销栈） */
  async convertActiveView(view) {
    if (!view?.editor || !view.file) {
      new Notice("当前笔记不可编辑");
      return;
    }
    this.convertEditor(view.editor, {});
  }

  /** 核心：对一段编辑器内容做转换 */
  convertEditor(editor, override = {}) {
    const source = editor.getValue();
    const opts = this.pipelineOpts(override);
    const result = convertAll(source, opts);

    if (result.output === source) {
      if (this.settings.showNotice) {
        new Notice(opts.bareLevel > 0 ? "没有发现可转换的 LaTeX" : "没有需要转换的分隔符");
      }
      return;
    }

    const cursor = editor.getCursor();
    editor.setValue(result.output);
    try {
      editor.setCursor({
        line: Math.min(cursor.line, Math.max(0, editor.lineCount() - 1)),
        ch: cursor.ch,
      });
    } catch (_) {}
    if (this.settings.showNotice) new Notice(this.summary("已转换", result));
  }

  /** 只转换选中内容 */
  convertSelection(editor) {
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const selected = editor.getRange(from, to);
    const result = convertAll(selected, this.pipelineOpts({}));

    if (result.output === selected) {
      if (this.settings.showNotice) new Notice("选中内容无需转换");
      return;
    }
    editor.replaceRange(result.output, from, to);
    if (this.settings.showNotice) new Notice(this.summary("已转换选中内容", result));
  }

  /** 统一结果文案 */
  summary(prefix, r) {
    const parts = [];
    if (r.inlineCount || r.displayCount) {
      parts.push(`分隔符 行内 ${r.inlineCount} / 行间 ${r.displayCount}`);
    }
    if (r.bareInline || r.bareDisplay) {
      parts.push(`裸公式 行内 ${r.bareInline} / 行间 ${r.bareDisplay}`);
    }
    if (r.skipped) parts.push(`跳过 ${r.skipped}`);
    return `${prefix}：${parts.join("，") || "无改动"}`;
  }

  /** 转换磁盘上的单个文件 */
  async convertFile(file, opts = {}) {
    if (!file || file.extension !== "md") return { changed: false };
    const source = await this.app.vault.read(file);
    const result = convertAll(source, this.pipelineOpts({}));
    if (result.output === source) return { changed: false };

    this._writing.add(file.path);
    try {
      await this.app.vault.modify(file, result.output);
    } finally {
      setTimeout(() => this._writing.delete(file.path), 0);
    }
    if (!opts.silent && this.settings.showNotice) {
      new Notice(this.summary(file.basename, result));
    }
    return Object.assign({ changed: true }, result);
  }

  /** 整个仓库批量转换 */
  async convertWholeVault() {
    if (this._busy) {
      new Notice("正在转换，请稍候…");
      return;
    }
    this._busy = true;

    const files = this.app.vault.getMarkdownFiles();
    let fileCount = 0;
    let inline = 0;
    let display = 0;
    let bareInline = 0;
    let bareDisplay = 0;

    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.editor && active.file) {
      const before = active.editor.getValue();
      const r = convertAll(before, this.pipelineOpts({}));
      if (r.output !== before) {
        active.editor.setValue(r.output);
        fileCount++;
        inline += r.inlineCount;
        display += r.displayCount;
        bareInline += r.bareInline;
        bareDisplay += r.bareDisplay;
      }
    }

    const notice = new Notice(`正在转换 0/${files.length} …`, 0);
    try {
      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        if (active?.file && file.path === active.file.path) continue;
        try {
          const r = await this.convertFile(file, { silent: true });
          if (r.changed) {
            fileCount++;
            inline += r.inlineCount || 0;
            display += r.displayCount || 0;
            bareInline += r.bareInline || 0;
            bareDisplay += r.bareDisplay || 0;
          }
        } catch (err) {
          console.error("[latex-super-converter]", file.path, err);
        }
        if (idx % 10 === 0) {
          notice.setMessage(`正在转换 ${idx + 1}/${files.length} …`);
          await new Promise((res) => setTimeout(res, 0));
        }
      }
    } finally {
      notice.hide();
      this._busy = false;
    }

    new Notice(
      `完成：修改 ${fileCount} 篇，分隔符 ${inline + display} 处，裸公式 ${bareInline + bareDisplay} 处`
    );
  }
}

/* ------------------------------------------------------------------ */
/* 设置面板                                                            */
/* ------------------------------------------------------------------ */

class LatexSuperConverterSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    /* ---------- 裸公式智能识别 ---------- */
    new Setting(containerEl).setName("裸公式识别").setHeading();

    new Setting(containerEl)
      .setName("识别强度")
      .setDesc(
        "有些 AI 输出的公式完全没有定界符（如 |H| \\mid |G|、n_p(G) \\equiv 1 \\pmod p）。下拉选择识别松紧。"
      )
      .addDropdown((d) =>
        d
          .addOption("0", "关闭（只处理 \\( \\) 和 \\[ \\]）")
          .addOption("1", "保守：只认 LaTeX 命令与 |…|")
          .addOption("2", "标准：再加 x^2、n_p、f(x)、24 = 2^3")
          .addOption("3", "激进：再加夹在中文间的单字母变量")
          .setValue(String(this.plugin.settings.bareLevel))
          .onChange(async (v) => {
            this.plugin.settings.bareLevel = Number(v) || 0;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("左栏按钮启用裸公式识别")
      .setDesc("关闭后按钮只做 \\( \\) / \\[ \\] 转换，裸公式识别仅通过命令面板调用。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.bareOnRibbon).onChange(async (v) => {
          this.plugin.settings.bareOnRibbon = v;
          await this.plugin.saveSettings();
        })
      );

    /* ---------- 分隔符转换 ---------- */
    new Setting(containerEl).setName("分隔符转换").setHeading();

    new Setting(containerEl)
      .setName("行间公式块独占行")
      .setDesc("把 $$…$$ 与前后文字拆到不同行。实时预览对独立成块的 $$ 渲染更稳。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.isolateDisplay).onChange(async (v) => {
          this.plugin.settings.isolateDisplay = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("只转换看起来像公式的内容（实验性）")
      .setDesc(
        "默认关闭，即无条件转换所有 \\( \\) 与 \\[ \\]。开启后会跳过明显不是数学的片段（如 \\[x for x in ...\\]）。"
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.mathOnly).onChange(async (v) => {
          this.plugin.settings.mathOnly = v;
          await this.plugin.saveSettings();
        })
      );

    /* ---------- 行为 ---------- */
    new Setting(containerEl).setName("行为").setHeading();

    new Setting(containerEl)
      .setName("左栏按钮转换整个仓库")
      .setDesc("关闭时按钮只转换当前笔记；按住 Alt 点击可临时反转。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.convertWholeVaultOnClick).onChange(async (v) => {
          this.plugin.settings.convertWholeVaultOnClick = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("显示转换结果提示")
      .setDesc("每次转换后用 Notice 显示处理数量。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showNotice).onChange(async (v) => {
          this.plugin.settings.showNotice = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("保存时自动转换")
      .setDesc("笔记保存后自动扫描并转换（含裸公式识别，会改动手写文件，谨慎开启）。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.convertOnSave).onChange(async (v) => {
          this.plugin.settings.convertOnSave = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("说明").setDesc(
      "代码块、行内代码、YAML frontmatter、HTML 注释、wikilink 与已有 $ / $$ 公式都会跳过；" +
        "未配对的分隔符保持原样；Markdown 表格、加粗、链接一律保留；" +
        "裸公式识别只包裹带明确数学证据的片段，普通中英文正文不动。"
    );
  }
}

const _export = LatexSuperConverterPlugin;
module.exports = _export;
module.exports.default = _export;
