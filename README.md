# LaTeX Super Converter

Convert messy AI-generated LaTeX into something Obsidian's MathJax actually renders — including formulas that have **no delimiters at all**.

One click converts `\( … \)` → `$ … $`, `\[ … \]` → `$$ … $$`, and auto-detects bare LaTeX like `n_p(G) \equiv 1 \pmod p` that has no delimiters whatsoever. Markdown tables, bold, inline code, links, and code blocks are left untouched.

- ✅ Handles all table shapes: `| a | b |`, `|a|b|`, `a | b`, `| a | b`, inside blockquotes and lists
- ✅ Skips frontmatter, code blocks, inline code, wikilinks, HTML comments, and existing `$` math
- ✅ Configurable detection strictness (off / conservative / standard / aggressive)
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

## 设置项

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 识别强度 | 2 标准 | 0 关闭 / 1 保守 / 2 标准 / 3 激进 |
| 左栏按钮启用裸公式识别 | 开 | 关掉则按钮只做 `\( \)` 转换 |
| 行间公式块独占行 | 开 | `$$` 块与正文拆行 |
| 只转换看起来像公式的内容 | 关 | `\( \)` 侧也启用启发式过滤 |
| 左栏按钮转换整个仓库 | 关 | 按钮默认改成全库批量 |
| 显示转换结果提示 | 开 | Notice 报告处理数量 |
| 保存时自动转换 | 关 | 保存后自动清理（带自触发保护） |

## 开发

```bash
node test/converter.test.js   # 32 个分隔符用例
node test/bare.test.js        # 232 个裸公式用例（含 Markdown 结构保护与 example.md 回归）
node test/plugin.test.js      # mock obsidian 加载 main.js 冒烟测试
node scripts/build.js         # 生成 main.js
```

`main.js` 由 `scripts/build.js` 拼接 `src/converter.js` + `src/bare.js` + `src/plugin.js` 生成，零依赖，不需要 `npm install`。

## 文件结构

```
latex-super-converter/
├── main.js               # 构建产物，Obsidian 实际加载
├── manifest.json
├── src/
│   ├── converter.js      # \( \) \[ \] 转换（纯函数）
│   ├── bare.js           # 裸公式识别（分词/生长/校验）
│   └── plugin.js         # Obsidian 外壳：ribbon / 命令 / 设置
├── scripts/build.js
├── test/
│   ├── converter.test.js
│   ├── bare.test.js
│   └── plugin.test.js
└── install.sh
```
