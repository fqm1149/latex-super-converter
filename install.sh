#!/usr/bin/env bash
# 把插件安装到指定 Obsidian 仓库：./install.sh /path/to/vault
set -euo pipefail

VAULT="${1:-}"
if [[ -z "$VAULT" ]]; then
  echo "用法: ./install.sh /path/to/your/vault"
  exit 1
fi
if [[ ! -d "$VAULT/.obsidian" ]]; then
  echo "错误：$VAULT 不是 Obsidian 仓库（缺少 .obsidian 目录）"
  exit 1
fi

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$VAULT/.obsidian/plugins/latex-super-converter"
mkdir -p "$DEST"
cp "$SRC/main.js" "$SRC/manifest.json" "$DEST/"
[[ -f "$SRC/styles.css" ]] && cp "$SRC/styles.css" "$DEST/"

# 写入 community-plugins.json（若不存在则创建）
node - "$VAULT" <<'NODE'
const fs = require("fs");
const path = require("path");
const vault = process.argv[2];
const file = path.join(vault, ".obsidian", "community-plugins.json");
let list = [];
try { list = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}
if (!Array.isArray(list)) list = [];
if (!list.includes("latex-super-converter")) list.push("latex-super-converter");
fs.writeFileSync(file, JSON.stringify(list, null, 2) + "\n", "utf8");
console.log("enabled in", file);
NODE

echo "已安装到: $DEST"
echo "打开 Obsidian → 设置 → 第三方插件，确认『LaTeX Super Converter』已启用。"
