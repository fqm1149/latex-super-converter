# LaTeX Super Converter

Convert messy AI-generated LaTeX into something Obsidian's MathJax actually renders — including formulas that have **no delimiters at all**.

One click converts `\( … \)` → `$ … $`, `\[ … \]` → `$$ … $$`, and auto-detects bare LaTeX like `n_p(G) \equiv 1 \pmod p` that has no delimiters whatsoever. Markdown tables, bold, inline code, links, and code blocks are left untouched.

- ✅ Handles all table shapes: `| a | b |`, `|a|b|`, `a | b`, `| a | b`, inside blockquotes and lists
- ✅ Skips frontmatter, code blocks, inline code, wikilinks, HTML comments, and existing `$` math
- ✅ Configurable detection strictness (off / conservative / standard / aggressive)
- ✅ Write-back safety net: if a conversion would break the note, nothing is written
- ✅ Chinese and English interface (follows Obsidian, or pick one explicitly)
- ✅ Zero network access, no telemetry, works offline

---

## 中文说明

Obsidian 插件：把 AI 输出里**各种不规范的 LaTeX** 一次性改成 Obsidian(MathJax) 能渲染的写法。

| 输入形态 | 转换后 |
| --- | --- |
| `\( ... \)` | `$ ... $` |
| `\[ ... \]` | `$$ ... $$` |
| `\|H\| \mid \|G\|`（裸公式，无定界符） | `$\|H\| \mid \|G\|$` |
| `n_p(G) \equiv 1 \pmod p`（裸公式） | `$n_p(G) \equiv 1 \pmod p$` |
| 多行 `\begin{cases}` / `\begin{bmatrix}` | `$$\n...\n$$` 独立块 |

## 安装

**方法一：脚本（推荐）**

```bash
cd latex-super-converter
./install.sh /你的/Obsidian/仓库路径
```

脚本把 `main.js`、`manifest.json` 复制到 `<仓库>/.obsidian/plugins/latex-super-converter/`，并把插件 ID 写入 `community-plugins.json`。

**方法二：手动**

1. 在仓库里建目录 `.obsidian/plugins/latex-super-converter/`
2. 把 `main.js`、`manifest.json` 拷进去
3. Obsidian → 设置 → 第三方插件 → 刷新 → 启用 **LaTeX Super Converter**
4. `Ctrl/Cmd + R` 重载窗口

## 使用

左侧功能区（ribbon）出现 **σ** 按钮：

- **点击** → 转换当前笔记（分隔符 + 裸公式）
- **Alt + 点击** → 转换整个仓库（或在设置里把默认行为改成全库）

命令面板（`Ctrl/Cmd + P`）：

| 命令 | 作用 |
| --- | --- |
| 转换当前笔记（分隔符 + 裸公式） | 一站式处理整篇 |
| 只转换 `\( \)` 与 `\[ \]` 分隔符 | 不动裸公式 |
| 只智能识别裸公式并加定界符 | 不动已有 `\( \)` |
| 转换选中内容 | 只处理选区（右键菜单也有） |
| 转换整个仓库 | 批量处理所有 `.md` |

转换当前笔记走编辑器 API，**`Ctrl/Cmd + Z` 可撤销**。

## 裸公式识别（核心）

很多 AI 输出的公式连定界符都没有，例如：

```
在有限群论中，若 H 是 G 的子群，则 H 的阶整除 G 的阶（|H| \mid |G|）。
设 |G| = p^a m，其中 p \nmid m，a \ge 1：
全体 Sylow p-子群的集合记作 \text{Syl}_p(G)，其个数记作 n_p(G)。
```

插件用 **分词 + 区间生长 + 证据校验** 三段落识别：

1. **分词**：把行切成命令（`\mid`）、词（`n_p`）、数字（`2^3`）、运算符（`=`）、括号（`[`、`\{`、`\langle`）、竖线、空白、中文
2. **生长**：从带「硬证据」的 token 出发向两侧扩展，括号/竖线入栈配对，遇中文或英文长单词即停
3. **校验**：区间内必须出现 `\命令`、`|…|`、`^`/`_`、`=`/`<`/`>`、运算符+字母、`f(x)` 之一，否则放弃

只有通过校验的片段才包上 `$`，普通中英文正文完全不动。

### 识别强度（设置里可调）

| 级别 | 认什么 | 适用 |
| --- | --- | --- |
| 0 关闭 | 只处理 `\( \)` / `\[ \]` | 已规范化的笔记 |
| 1 保守 | LaTeX 命令 + `\|…\|` | 只想抓明显公式 |
| **2 标准（默认）** | + `x^2`、`n_p`、`f(x)`、`24 = 2^3` | 绝大多数场景 |
| 3 激进 | + 夹在中文之间的单字母变量（设 `$G$` 为群） | 纯数学笔记 |

实测 `example.md`（Sylow 定理长文）：level 2 识别 **183 处**，全部 `$` 成对，行数、表格竖线、加粗标记、制表符分列全部零变化。

### 识别示例

| 原文 | 输出 |
| --- | --- |
| `|H| \mid |G|` | `$\|H\| \mid \|G\|$` |
| `\text{Syl}_p(G)` | `$\text{Syl}_p(G)$` |
| `n_p(G) = [G : N_G(P)]` | `$n_p(G) = [G : N_G(P)]$` |
| `n_7 \in \{1, 8, 48\}` | `$n_7 \in \{1, 8, 48\}$` |
| `\langle r, s \mid r^4 = e \rangle` | `$\langle r, s \mid r^4 = e \rangle$` |
| `p \nmid \binom{p^a m}{p^a}` | `$p \nmid \binom{p^a m}{p^a}$` |
| `\{x_k\}_{k=1}^\infty` | `$\{x_k\}_{k=1}^\infty$` |
| `\left[ \frac{y^2}{2} \right]_{-1}^1 = 0` | `$\left[ \frac{y^2}{2} \right]_{-1}^1 = 0$` |
| `\frac{x^2 - y^2}{(x^2 + y^2)^2}` | `$\frac{x^2 - y^2}{(x^2 + y^2)^2}$` |
| `\begin{cases} 1, & x > 0 \\ -1, & x < 0 \end{cases}` | `$\begin{cases} 1, & x > 0 \\ -1, & x < 0 \end{cases}$`（`&` 与 `\\` 不断开） |
| `D = [a, b] \times [c, +\infty)` | `$D = [a, b] \times [c, +\infty)$`（半开区间） |

### 不会误伤的内容

| 内容 | 结果 |
| --- | --- |
| `GitHub 上有 3 个 commit，详见 README。` | 原样 |
| `我已经 try 了 2 次，还是 failed。` | 原样 |
| `You can call the API with token ABCDEF123456.` | 原样 |
| `版本 1.2.3 发布于 2024 年。` | 原样 |
| `2024-05-01 更新` | 原样（日期不当公式） |
| `拉格朗日定理（Lagrange's Theorem）表明` | 原样 |

## 安全边界（全局跳过）

### 代码与结构

| 区域 | 是否跳过 |
| --- | --- |
| YAML frontmatter | ✅ |
| 围栏代码块 ` ``` ` / `~~~` | ✅ |
| 行内代码 `` `...` `` | ✅（表格单元格内也生效） |
| HTML 注释 `<!-- -->` | ✅ |
| HTML 标签 `<span>` `<br/>` | ✅ |
| wikilink `[[...]]` / 嵌入 `![[...]]` | ✅ |
| 链接 `[文字](url)` / 图片 `![图](path)` | ✅ URL 里的 `^` `_` `/` 不当公式 |
| 已有 `$...$` / `$$...$$` | ✅ 不嵌套改造 |
| 标题行 `# ...` | ✅（裸公式识别跳过） |
| 未配对的 `\(` 或 `\]` | ✅ 保持原样，不生成孤立 `$` |

### Markdown 语法保护（v1.1.0 新增）

| 语法 | 行为 |
| --- | --- |
| 表格对齐行 `\| --- \| --- \|` | ✅ 整行不动 |
| 表格对齐行 `\| :--- \| ---: \|` | ✅ 整行不动 |
| 表格纯文字行 `\| 定理 \| 结论 \|` | ✅ 整行不动 |
| 表格含公式行 `\| x^2 \| y^2 \|` | ✅ 按单元格分别识别 → `\| $x^2$ \| $y^2$ \|` |
| 表格竖线数量 | ✅ 严格保持，绝不改成 `$$` 块 |
| 加粗 `**文本**` | ✅ 标记留在公式外 → `**$p^a$**` |
| 斜体 `*文本*` / `_文本_` | ✅ 同上 |
| 删除线 `~~文本~~` | ✅ 同上 |
| 乘号 `3 * 4` | ✅ 不当作强调标记 |
| 行首 `\|` 的公式 `\|G\| = p^a m` | ✅ 识别为公式，不误判为表格 |
| callout `> [!note]` | ✅ 标记不动 |
| 引用块 `> ` / `>> ` | ✅ 前缀不动 |
| 任务列表 `- [x] ` | ✅ 标记不动 |
| 星号列表 `* ` | ✅ 列表符与乘号区分 |
| 有序列表 `1. ` | ✅ 序号不动 |
| 脚注 `[^1]` / `[^1]:` | ✅ 不做公式处理 |

判定逻辑：`isTableRow()` 要求「以 `|` 开头结尾、≥3 个竖线、中间竖线两侧均有空格」，再配合文档级的 `findTableLines()`（从对齐行向上下扩展）确定整张表格，避免 `|G| \mid |H|` 这类公式被误判。命中表格后走 `convertTableLine()` 按单元格拆分，竖线始终保留。

## 行间公式排版

- 单行 `\[E=mc^2\]` → `$$E=mc^2$$`
- 多行块（矩阵、`cases`、多行推导）保留内部换行：

```latex
$$
A =
\begin{bmatrix}
1 & 0 \\
0 & 1
\end{bmatrix}
$$
```

- 连续多行纯公式（如 `n_p \equiv 1 \pmod p` / `n_p \mid m`）自动合并成一个 `$$` 块，行间用 `\\` 分隔
- 被空行包围的单行纯公式提升为 `$$` 块
- 生成的 `$$` 与正文同行时自动拆到独立行
- `\[\]`（空内容）直接删除

## 写回前的安全检查（v1.2.3 新增）

转换是**就地覆盖**的：一旦写出错误结果，原文里的 LaTeX 结构就被破坏，再跑一次也救不回来。
例如 `\{x_k\}_{k=1}^\infty` 曾被切成 `$\{x_k\}$_${k=1}$^$\infty$`，
此时 `$` 的配对关系已经错了，任何后续处理都无法还原。

所以插件在**写盘之前**先做一轮结构体检。任何一项不通过，就放弃写入、弹出提示，**笔记保持原样**：

| 检查 | 检出什么 |
| --- | --- |
| `odd-dollar` | 某一行未转义的 `$` 个数为奇数 —— 定界符落单 |
| `split-script` | `}`/`]`/`)`/字母/数字 紧接 `$` 再接 `_` 或 `^` —— 公式在上下标处被腰斩 |
| `empty-script` | `$_$` / `$^$` —— 空上下标，说明两侧被切断 |
| `span-across-blank` | `$…$` 跨了空行 —— 落单的 `$` 吞掉了后面整段正文 |
| `command-mismatch` | 源文与结果里 `\命令` 的数量不一致 —— 有内容被删改 |
| `content-changed` | 去掉 `$`、`\( \)`、`\[ \]`、`\\`、空白后字符流不一致 |

覆盖的写回路径：当前笔记、选中内容、保存时自动转换、整个仓库批量。
全库模式下不通过的文件会被跳过并汇总报告，其余文件照常转换。

提示里会带一行技术摘要（形如 `empty-script×3@L45,90,91; split-script×3@L52,89,92`），
方便直接把这段内容反馈给开发者。确实需要强行写入时，可以在设置里关掉这个开关。

## 设置项

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 界面语言 | 跟随 Obsidian | 自动 / 中文 / English |
| 识别强度 | 2 标准 | 0 关闭 / 1 保守 / 2 标准 / 3 激进 |
| 左栏按钮启用裸公式识别 | 开 | 关掉则按钮只做 `\( \)` 转换 |
| 行间公式块独占行 | 开 | `$$` 块与正文拆行 |
| 保存时自动转换 | 关 | 保存后自动清理（带自触发保护） |
| 显示转换结果提示 | 开 | Notice 报告处理数量 |
| **写回前做完整性校验** | **开** | **不通过就放弃写入，原文不变** |

## 隐私与权限

插件**不联网**，没有遥测，没有账号，没有付费门槛。全部处理都在本地完成。

为了履行披露义务，这里明确列出插件使用的 Obsidian API 权限范围：

| 权限 | 何时使用 | 范围 |
| --- | --- | --- |
| 读取当前笔记（`editor.getValue`） | 点击左栏按钮 / 命令面板 | **仅当前打开的笔记** |
| 写入当前笔记（`editor.setValue`） | 同上，可 `Ctrl/Cmd + Z` 撤销 | **仅当前打开的笔记** |
| 读取单个文件（`vault.read`） | 「转换整个仓库」命令 / 保存时自动转换 | 仅目标 `.md` 文件 |
| 修改单个文件（`vault.modify`） | 同上 | 仅目标 `.md` 文件 |
| 枚举仓库文件（`vault.getMarkdownFiles`） | **仅当你主动执行「转换整个仓库」时** | 返回所有 `.md` 的路径列表 |
| 监听文件修改（`vault.on("modify")`） | 仅在「保存时自动转换」开启时注册 | 事件回调 |

关于**仓库文件枚举**的说明：

- 插件**不会**在加载时、启动时或后台扫描你的仓库。`vault.getMarkdownFiles()` 只在 `convertWholeVault()` 内部调用，而它只由你主动触发的两个入口进入：「转换整个仓库」命令，或设置了「左栏按钮转换整个仓库」后点击按钮（含 Alt+点击）。
- 枚举结果只用于遍历转换，**不写入磁盘、不发送网络、不上报**，进程结束即丢弃。
- 默认设置下按钮只处理**当前笔记**，全库模式需要你显式开启。
- 如果你只想要单篇处理，完全不碰全库功能即可，此时插件只读写你正在编辑的那一篇。

完整的代码只有 `src/` 下三个文件，`main.js` 由 `scripts/build.js` 从它们拼接生成，没有第三方运行时依赖（`devDependencies` 为空）。

## 开发

```bash
node test/converter.test.js   # 38 个分隔符用例
node test/bare.test.js        # 630 个裸公式用例（含 Markdown 结构保护、example/example2 回归）
node test/integrity.test.js   # 22 个完整性校验用例（历史事故形态 + 防误报）
node test/pipeline.test.js    # 1196 个端到端用例（真实仓库 21 篇笔记审计）
node test/plugin.test.js      # mock obsidian 加载 main.js 冒烟 + 拦截 + 语言切换
node scripts/build.js         # 生成 main.js
npm test                      # 以上全部
```

回归样本放在 `test/fixtures/`，`example2.md` 覆盖了 `\{ \}` 上下标链、`\left[ \right]` 混搭定界符、
`\frac` 嵌套参数、`cases` 环境内的 `&` / `\\`、半开区间 `[c, +\infty)` 这类曾经断裂的写法。

`main.js` 由 `scripts/build.js` 拼接 `src/converter.js` + `src/bare.js` + `src/integrity.js` + `src/i18n.js` + `src/plugin.js` 生成，零依赖，不需要 `npm install`。

## 文件结构

```
latex-super-converter/
├── main.js               # 构建产物，Obsidian 实际加载
├── manifest.json
├── src/
│   ├── converter.js      # \( \) \[ \] 转换（纯函数）
│   ├── bare.js           # 裸公式识别（分词/生长/校验）
│   ├── integrity.js      # 写回前的完整性校验（安全网）
│   ├── i18n.js           # 中英文案表 + 语言解析
│   └── plugin.js         # Obsidian 外壳：ribbon / 命令 / 设置
├── scripts/build.js
├── test/
│   ├── converter.test.js
│   ├── bare.test.js
│   ├── integrity.test.js
│   ├── pipeline.test.js
│   ├── plugin.test.js
│   └── fixtures/         # 回归样本（example2.md 等）
│       └── example2.md
└── install.sh
```
