"use strict";
/**
 * 用 mock obsidian 加载 main.js，验证插件能注册 ribbon 图标 / 命令 / 设置面板，
 * 并模拟一次「点击左栏按钮」的等价调用。
 */
const assert = require("assert");
const path = require("path");
const Module = require("module");

const notices = [];
let pass = 0;
const registered = { commands: [], ribbons: [], settingTabs: [], events: [], dropdowns: [] };

class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this._data = null;
  }
  async loadData() {
    return this._data;
  }
  async saveData(d) {
    this._data = d;
  }
  addRibbonIcon(icon, title, cb) {
    const el = {
      addClass() {
        return this;
      },
      remove() {},
    };
    registered.ribbons.push({ icon, title, cb, el });
    return el;
  }
  addCommand(cmd) {
    registered.commands.push(cmd);
    return cmd;
  }
  addSettingTab(tab) {
    registered.settingTabs.push(tab);
  }
  registerEvent(evt) {
    registered.events.push(evt);
  }
}

class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
}
const settingInstances = [];
class Setting {
  constructor() {
    settingInstances.push(this);
  }
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  setHeading() {
    this._heading = true;
    return this;
  }
  addToggle(cb) {
    const t = {
      setValue() {
        return t;
      },
      onChange() {
        return t;
      },
    };
    cb(t);
    return this;
  }
  addDropdown(cb) {
    const options = [];
    const d = {
      addOption(v, label) {
        options.push([v, label]);
        return d;
      },
      setValue() {
        return d;
      },
      onChange() {
        return d;
      },
    };
    cb(d);
    registered.dropdowns.push(options);
    return this;
  }
  addText(cb) {
    const t = {
      setValue() {
        return t;
      },
      onChange() {
        return t;
      },
      setPlaceholder() {
        return t;
      },
    };
    cb(t);
    return this;
  }
  addButton(cb) {
    const b = {
      setButtonText() {
        return b;
      },
      onClick() {
        return b;
      },
    };
    cb(b);
    return this;
  }
}
class Notice {
  constructor(msg, timeout) {
    notices.push(msg);
  }
  setMessage(m) {
    notices.push(m);
  }
  hide() {}
}
class MarkdownView {
  constructor(editor, file) {
    this.editor = editor;
    this.file = file;
  }
}
class TFile {}
class ItemView {}
class WorkspaceLeaf {}

function makeEditor(initial) {
  let value = initial;
  let selection = { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } };
  return {
    getValue: () => value,
    setValue: (v) => {
      value = v;
    },
    getCursor: () => ({ line: 0, ch: 0 }),
    setCursor: () => {},
    lineCount: () => value.split("\n").length,
    somethingSelected: () => false,
    getRange: () => "",
    replaceRange: () => {},
  };
}

const obsidianMock = {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  MarkdownView,
  TFile,
  ItemView,
  WorkspaceLeaf,
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "obsidian") return "obsidian";
  return origResolve.call(this, request, ...rest);
};
require.cache["obsidian"] = {
  id: "obsidian",
  filename: "obsidian",
  loaded: true,
  exports: obsidianMock,
};

const PluginClass = require(path.join(__dirname, "..", "main.js"));

(async () => {
  assert.strictEqual(typeof PluginClass, "function", "main.js must export the plugin class");

  const note = [
    "---",
    "title: 测试 \\(notmath\\)",
    "---",
    "",
    "行内 \\(a^2+b^2=c^2\\) 与 \\(\\frac{1}{2}\\)。",
    "",
    "\\[",
    "\\int_0^\\infty e^{-x}dx = 1",
    "\\]",
    "",
    "```js",
    "const s = \"\\\\(x\\\\)\";",
    "```",
    "",
    "已有 $keep \\(this\\)$ 不动。",
  ].join("\n");

  const editor = makeEditor(note);
  const file = Object.assign(new TFile(), { path: "notes/test.md", basename: "test", extension: "md" });
  const view = new MarkdownView(editor, file);

  const vaultFiles = [file];
  const app = {
    workspace: {
      getActiveViewOfType: () => view,
      getActiveFile: () => file,
      on: () => ({}),
    },
    vault: {
      getMarkdownFiles: () => vaultFiles,
      read: async () => note,
      modify: async () => {},
      on: () => ({}),
    },
  };

  const plugin = new PluginClass(app, { id: "latex-super-converter", version: "1.0.0" });
  await plugin.onload();

  assert.strictEqual(registered.ribbons.length, 1, "one ribbon icon registered");
  assert.strictEqual(registered.ribbons[0].icon, "sigma");
  assert.ok(registered.commands.length >= 3, "commands registered");
  assert.strictEqual(registered.settingTabs.length, 1, "settings tab registered");

  // 触发器：模拟点击左栏按钮（默认只转当前笔记）
  await registered.ribbons[0].cb({});

  const out = editor.getValue();
  assert.ok(out.includes("行内 $a^2+b^2=c^2$ 与 $\\frac{1}{2}$。"), "inline converted");
  assert.ok(out.includes("$$\\int_0^\\infty e^{-x}dx = 1$$"), "display converted");
  assert.ok(out.includes('const s = "\\\\(x\\\\)";'), "code block untouched");
  assert.ok(out.includes("已有 $keep \\(this\\)$ 不动。"), "existing math untouched");
  assert.ok(out.includes("title: 测试 \\(notmath\\)"), "frontmatter untouched");

  // 再次点击应幂等
  const before = editor.getValue();
  await registered.ribbons[0].cb({});
  assert.strictEqual(editor.getValue(), before, "idempotent on second click");

  // ---- 裸公式识别（第二条笔记，无任何定界符）----
  const bareNote = [
    "Sylow 定理",
    "",
    "若 H 是 G 的子群，则 |H| \\mid |G|。",
    "",
    "全体 Sylow p-子群记作 \\text{Syl}_p(G)，其个数 n_p \\equiv 1 \\pmod p。",
    "",
    "GitHub 上有 3 个 commit，详见 README。",
  ].join("\n");
  const bareEditor = makeEditor(bareNote);
  const bareFile = Object.assign(new TFile(), {
    path: "notes/bare.md",
    basename: "bare",
    extension: "md",
  });
  const bareView = new MarkdownView(bareEditor, bareFile);
  plugin.app.workspace.getActiveViewOfType = () => bareView;
  plugin.app.workspace.getActiveFile = () => bareFile;

  await registered.ribbons[0].cb({});
  const bareOut = bareEditor.getValue();
  assert.ok(bareOut.includes("则 $|H| \\mid |G|$。"), "bare pipe formula converted");
  assert.ok(bareOut.includes("$n_p \\equiv 1 \\pmod p$"), "bare congruence converted");
  assert.ok(bareOut.includes("GitHub 上有 3 个 commit，详见 README。"), "prose untouched by bare pass");

  // ---- 命令：只处理分隔符 / 只处理裸公式 ----
  const delimCmd = registered.commands.find((c) => c.id === "convert-delimiters-only");
  const bareCmd = registered.commands.find((c) => c.id === "convert-bare-only");
  assert.ok(delimCmd && bareCmd, "split commands registered");

  // 只处理分隔符时，裸公式必须原样保留
  const onlyDelim = makeEditor("若 |H| \\mid |G| 且 \\(a\\) 成立");
  delimCmd.editorCheckCallback(false, onlyDelim, null);
  assert.strictEqual(onlyDelim.getValue(), "若 |H| \\mid |G| 且 $a$ 成立", "delimiters-only leaves bare text");
  pass++;

  // 只处理裸公式时，\\( \\) 必须原样保留
  const onlyBare = makeEditor("若 |H| \\mid |G| 且 \\(a\\) 成立");
  bareCmd.editorCheckCallback(false, onlyBare, null);
  assert.ok(onlyBare.getValue().includes("$|H| \\mid |G|$"), "bare-only converts formula");
  assert.ok(onlyBare.getValue().includes("\\(a\\)"), "bare-only leaves delimiters");
  pass++;

  // 设置面板可以渲染（现在用小标题统一走 Setting().setHeading()）
  const tab = registered.settingTabs[0];
  const created = [];
  tab.containerEl = {
    empty() {},
    createEl(tag, opts) {
      created.push({ tag, opts });
      return { setText() {}, addClass() {} };
    },
  };
  settingInstances.length = 0;
  tab.display();
  assert.ok(settingInstances.length >= 5, "settings tab renders settings");
  assert.ok(
    settingInstances.some((s) => s._heading === true),
    "settings tab uses setHeading() for section titles"
  );
  assert.strictEqual(
    created.filter((c) => c.tag === "h1" || c.tag === "h2" || c.tag === "h3").length,
    0,
    "no raw heading elements (Obsidian guideline)"
  );

  console.log("✅ plugin smoke test passed");
  console.log("   notices:", notices.slice(0, 3).join(" | "));
})();
