"use strict";

const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  MarkdownView,
  TFile,
} = require("obsidian");

/*
 * 打包成 main.js 之后，integrity.js / i18n.js 的内容已经拼进同一个作用域，
 * 它们的函数是提升的函数声明，直接可见。单独跑源码（测试）时则回退到 require。
 * 用 typeof 做判据：对未声明的标识符 typeof 不抛错，所以两种模式都能工作。
 */
const _checkIntegrity =
  typeof checkIntegrity === "function"
    ? checkIntegrity
    : require("./integrity.js").checkIntegrity;
const _summarizeIssues =
  typeof summarizeIssues === "function"
    ? summarizeIssues
    : require("./integrity.js").summarizeIssues;
const _createTranslator =
  typeof createTranslator === "function"
    ? createTranslator
    : require("./i18n.js").createTranslator;
const _resolveLanguage =
  typeof resolveLanguage === "function"
    ? resolveLanguage
    : require("./i18n.js").resolveLanguage;

const DEFAULT_SETTINGS = {
  isolateDisplay: true,
  mathOnly: false,
  convertWholeVaultOnClick: false,
  showNotice: true,
  convertOnSave: false,
  // 裸公式智能识别
  bareLevel: 2,
  bareOnRibbon: true,
  // 写回前的完整性校验（安全网）
  integrityCheck: true,
  // 界面语言：auto / zh / en
  language: "auto",
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
    this.refreshTranslator();

    // 左栏功能区按钮
    this.ribbonEl = this.addRibbonIcon("sigma", this.t("ribbon.tooltip"), async (evt) => {
      await this.runPrimaryAction(evt);
    });
    this.ribbonEl.addClass("latex-super-converter-ribbon");

    // 命令：一键全处理（默认）
    this.addCommand({
      id: "convert-current-note",
      name: this.t("cmd.convertCurrent"),
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
      name: this.t("cmd.delimitersOnly"),
      editorCheckCallback: (checking, editor) => {
        if (!checking) this.convertEditor(editor, { bareLevel: 0 });
        return true;
      },
    });

    // 命令：只补裸公式
    this.addCommand({
      id: "convert-bare-only",
      name: this.t("cmd.bareOnly"),
      editorCheckCallback: (checking, editor) => {
        if (!checking) this.convertEditor(editor, { delimiters: false });
        return true;
      },
    });

    // 命令：选中内容
    this.addCommand({
      id: "convert-selection",
      name: this.t("cmd.selection"),
      editorCheckCallback: (checking, editor) => {
        if (!editor.somethingSelected()) return false;
        if (!checking) this.convertSelection(editor);
        return true;
      },
    });

    // 命令：整个仓库
    this.addCommand({
      id: "convert-whole-vault",
      name: this.t("cmd.wholeVault"),
      callback: () => this.convertWholeVault(),
    });

    // 右键菜单
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (!editor.somethingSelected()) return;
        menu.addItem((item) =>
          item
            .setTitle(this.t("menu.convert"))
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

  /** 语言变化时重建翻译函数（命令名需要重载插件才会更新，这里只影响新文案） */
  refreshTranslator() {
    this.lang = _resolveLanguage(this.settings.language);
    this.t = _createTranslator(this.lang);
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

  /**
   * 安全网：写回前校验。
   * @returns {null | Array} null 表示通过（或用户关闭了校验），否则返回 issue 列表
   */
  verify(source, output) {
    if (!this.settings.integrityCheck) return null;
    const result = _checkIntegrity(source, output);
    return result.ok ? null : result.issues;
  }

  /** 校验失败时的提示（含一行技术摘要，方便用户反馈） */
  reportBlocked(issues) {
    new Notice(
      this.t("notice.blocked", { issues: _summarizeIssues(issues) }),
      12000
    );
    new Notice(this.t("notice.blockedHint"), 12000);
    console.warn("[latex-super-converter] integrity check failed:", issues);
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
    new Notice(this.t("notice.nothing"));
  }

  /** 转换当前视图（走编辑器，保留撤销栈） */
  async convertActiveView(view) {
    if (!view?.editor || !view.file) {
      new Notice(this.t("notice.nothing"));
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
      if (this.settings.showNotice) new Notice(this.t("notice.nothing"));
      return;
    }

    // 安全网：不通过就不写
    const issues = this.verify(source, result.output);
    if (issues) {
      this.reportBlocked(issues);
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
    if (this.settings.showNotice) new Notice(this.summary("notice.prefix.done", result));
  }

  /** 只转换选中内容 */
  convertSelection(editor) {
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const selected = editor.getRange(from, to);
    const result = convertAll(selected, this.pipelineOpts({}));

    if (result.output === selected) {
      if (this.settings.showNotice) new Notice(this.t("notice.nothing"));
      return;
    }

    const issues = this.verify(selected, result.output);
    if (issues) {
      this.reportBlocked(issues);
      return;
    }

    editor.replaceRange(result.output, from, to);
    if (this.settings.showNotice) new Notice(this.summary("notice.prefix.selection", result));
  }

  /** 统一结果文案：数量部分走 i18n，前缀由调用方决定 */
  summary(prefixKey, r) {
    const parts = [];
    parts.push(
      this.t("notice.done", {
        inline: r.inlineCount || 0,
        block: r.displayCount || 0,
        bare: (r.bareInline || 0) + (r.bareDisplay || 0),
      })
    );
    if (r.skipped) parts.push(this.t("notice.skipped", { skipped: r.skipped }));
    const body = parts.join(" · ");
    if (!prefixKey) return body;
    return `${this.t(prefixKey)}${this.t("notice.sep")}${body}`;
  }

  /**
   * 转换磁盘上的单个文件。
   * @returns {{changed: boolean, blocked?: boolean, issues?: Array}}
   */
  async convertFile(file, opts = {}) {
    if (!file || file.extension !== "md") return { changed: false };
    const source = await this.app.vault.read(file);
    const result = convertAll(source, this.pipelineOpts({}));
    if (result.output === source) return { changed: false };

    const issues = this.verify(source, result.output);
    if (issues) {
      if (!opts.silent) this.reportBlocked(issues);
      return { changed: false, blocked: true, issues };
    }

    this._writing.add(file.path);
    try {
      await this.app.vault.modify(file, result.output);
    } finally {
      setTimeout(() => this._writing.delete(file.path), 0);
    }
    if (!opts.silent && this.settings.showNotice) {
      new Notice(`${file.basename}: ${this.summary(null, result)}`);
    }
    return Object.assign({ changed: true }, result);
  }

  /** 整个仓库批量转换 */
  async convertWholeVault() {
    if (this._busy) {
      new Notice(this.t("notice.busy"));
      return;
    }
    this._busy = true;

    const files = this.app.vault.getMarkdownFiles();
    let fileCount = 0;
    let inline = 0;
    let display = 0;
    let bareInline = 0;
    let bareDisplay = 0;
    const blocked = [];

    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.editor && active.file) {
      const before = active.editor.getValue();
      const r = convertAll(before, this.pipelineOpts({}));
      if (r.output !== before) {
        const issues = this.verify(before, r.output);
        if (issues) {
          blocked.push(active.file.basename);
        } else {
          active.editor.setValue(r.output);
          fileCount++;
          inline += r.inlineCount;
          display += r.displayCount;
          bareInline += r.bareInline;
          bareDisplay += r.bareDisplay;
        }
      }
    }

    const notice = new Notice(`${fileCount}/${files.length} …`, 0);
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
          } else if (r.blocked) {
            blocked.push(file.basename);
          }
        } catch (err) {
          console.error("[latex-super-converter]", file.path, err);
        }
        if (idx % 10 === 0) {
          notice.setMessage(`${idx + 1}/${files.length} …`);
          await new Promise((res) => setTimeout(res, 0));
        }
      }
    } finally {
      notice.hide();
      this._busy = false;
    }

    new Notice(this.t("notice.vaultDone", { files: fileCount }));
    if (blocked.length) {
      new Notice(
        this.t("notice.vaultBlocked", {
          files: blocked.length,
          list: blocked.slice(0, 5).join(", ") + (blocked.length > 5 ? " …" : ""),
        }),
        15000
      );
    }
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
    const t = this.plugin.t;
    containerEl.empty();

    /* ---------- 语言（放最上面，方便英文用户立刻切换） ---------- */
    new Setting(containerEl).setName(t("settings.heading.language")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.language.name"))
      .setDesc(t("settings.language.desc"))
      .addDropdown((d) =>
        d
          .addOption("auto", t("settings.language.auto"))
          .addOption("zh", t("settings.language.zh"))
          .addOption("en", t("settings.language.en"))
          .setValue(this.plugin.settings.language || "auto")
          .onChange(async (v) => {
            this.plugin.settings.language = v;
            await this.plugin.saveSettings();
            this.plugin.refreshTranslator();
            this.display();
          })
      );

    /* ---------- 裸公式智能识别 ---------- */
    new Setting(containerEl).setName(t("settings.heading.behavior")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.bareLevel.name"))
      .setDesc(t("settings.bareLevel.desc"))
      .addDropdown((d) =>
        d
          .addOption("0", t("settings.bareLevel.off"))
          .addOption("1", t("settings.bareLevel.safe"))
          .addOption("2", t("settings.bareLevel.standard"))
          .addOption("3", t("settings.bareLevel.aggressive"))
          .setValue(String(this.plugin.settings.bareLevel))
          .onChange(async (v) => {
            this.plugin.settings.bareLevel = Number(v) || 0;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.bareOnRibbon.name"))
      .setDesc(t("settings.bareOnRibbon.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.bareOnRibbon).onChange(async (v) => {
          this.plugin.settings.bareOnRibbon = v;
          await this.plugin.saveSettings();
        })
      );

    /* ---------- 分隔符转换 ---------- */
    new Setting(containerEl)
      .setName(t("settings.isolateDisplay.name"))
      .setDesc(t("settings.isolateDisplay.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.isolateDisplay).onChange(async (v) => {
          this.plugin.settings.isolateDisplay = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.convertOnSave.name"))
      .setDesc(t("settings.convertOnSave.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.convertOnSave).onChange(async (v) => {
          this.plugin.settings.convertOnSave = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.showNotice.name"))
      .setDesc(t("settings.showNotice.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.showNotice).onChange(async (v) => {
          this.plugin.settings.showNotice = v;
          await this.plugin.saveSettings();
        })
      );

    /* ---------- 安全检查 ---------- */
    new Setting(containerEl).setName(t("settings.heading.safety")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.integrity.name"))
      .setDesc(t("settings.integrity.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.integrityCheck).onChange(async (v) => {
          this.plugin.settings.integrityCheck = v;
          await this.plugin.saveSettings();
        })
      );

    // 说明段落：用普通 <p>，不要拿长句子当小标题（Obsidian 规范里 setHeading 只用于章节名）
    const about = containerEl.createEl("p", { text: t("settings.about") });
    about.addClass("setting-item-description");
  }
}

const _export = LatexSuperConverterPlugin;
module.exports = _export;
module.exports.default = _export;
