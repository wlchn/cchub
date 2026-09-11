#!/usr/bin/env node
/**
 * 校验两份词典是否严格对齐。
 *
 * 为什么需要它：`tsc` 只能把 `t("a.b.c")` 对着 **zh-CN** 的形状做类型检查
 * （见 `src/i18n/index.ts` 的 `CustomTypeOptions`）。en-US 少一个键，类型检查
 * 一无所知，要等用户切到英文才会看到裸露的键名或中文残留。
 *
 * 因此这份脚本是那份类型安全的补集，必须进 CI。
 *
 * 用法：`pnpm check:locales`（退出码非 0 即有不对齐）
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["zh-CN", "en-US"];

/** 拍平成 `a.b.c` → 文案 的映射。 */
function flatten(value, prefix = "", out = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      flatten(child, path, out);
    } else {
      out[path] = child;
    }
  }
  return out;
}

/** 取出文案里的 `{{name}}` 占位符。 */
function placeholders(text) {
  if (typeof text !== "string") return [];
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
}

const maps = {};
for (const locale of LOCALES) {
  const raw = readFileSync(join(root, "src/locales", `${locale}.json`), "utf8");
  maps[locale] = flatten(JSON.parse(raw));
}

const problems = [];
const reference = LOCALES[0];

for (const locale of LOCALES.slice(1)) {
  const missing = Object.keys(maps[reference]).filter((k) => !(k in maps[locale]));
  const extra = Object.keys(maps[locale]).filter((k) => !(k in maps[reference]));

  for (const key of missing) {
    problems.push(`${locale} 缺少键：${key}（${reference} 有）`);
  }
  for (const key of extra) {
    problems.push(`${locale} 多出键：${key}（${reference} 没有）`);
  }
  for (const key of Object.keys(maps[reference])) {
    if (!(key in maps[locale])) continue;
    const a = placeholders(maps[reference][key]);
    const b = placeholders(maps[locale][key]);
    if (a.join(",") !== b.join(",")) {
      problems.push(
        `${key} 插值不一致：${reference}=[${a}] ${locale}=[${b}]`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`词典对齐检查未通过（${problems.length} 项）：`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

const total = Object.keys(maps[reference]).length;
console.log(`✓ 词典对齐：${LOCALES.join(" / ")} 各 ${total} 个键，插值一致`);
