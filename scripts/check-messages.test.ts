/**
 * 后端消息翻译的回归测试。
 *
 * 覆盖的是最容易悄悄坏掉的那几条路径：结构化解析、保留参数二次翻译、
 * 未知码回落、以及「非结构化输入必须原样透传」（npm stdout 走的就是这条）。
 *
 * 跑法：`pnpm test:messages`
 */

import assert from "node:assert/strict";

import i18n from "@/i18n";
import { describeError, describeNote } from "@/lib/errors";

/** 词典里真实存在的码。 */
const CASES: Array<[string, string, string]> = [
  // [描述, 输入, 期望的中文输出]
  ["无参错误码", '{"code":"nameRequired"}', "名字不能为空"],
  [
    "带插值的错误码",
    '{"code":"unknownProvider","args":{"provider":"glm"}}',
    "未知的供应商：glm",
  ],
  [
    "保留参数 op 走 op.* 再翻译",
    '{"code":"ioFailed","args":{"op":"writePrefs","err":"disk full"}}',
    "写入偏好失败：disk full",
  ],
  [
    "保留参数 label 走 fields.* 再翻译",
    '{"code":"fieldBlank","args":{"label":"modelOpus"}}',
    "Opus 映射不能是空白",
  ],
  [
    "保留参数 hint 走 notes.* 再翻译",
    '{"code":"appOutsideNpmGlobal","args":{"name":"Codex","hint":"homebrew","verb":"update"}}',
    "Codex 装在 npm 全局目录之外（来自 Homebrew），CCHub 无法更新它，请用原来的安装方式操作",
  ],
];

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  try {
    assert.equal(actual, expected);
    console.log(`  ✓ ${label}`);
  } catch {
    failures += 1;
    console.error(`  ✗ ${label}\n      期望: ${String(expected)}\n      实得: ${String(actual)}`);
  }
}

await i18n.changeLanguage("zh-CN");

console.log("describeError —— 结构化错误码");
for (const [label, input, expected] of CASES) {
  check(label, describeError(input), expected);
}

// `fieldBlank` 的期望值含插值，单独放宽断言（上面的例子容易写错标点）
console.log("describeNote —— 状态与操作反馈");
check(
  "成功提示",
  describeNote('{"code":"routeCleared","args":{"host":"Codex"}}'),
  "已停用 Codex 路由（仅清除 CCHub 写入的配置）",
);
check(
  "任务日志行",
  describeNote('{"code":"taskStart","args":{"verb":"install","name":"Claude Code"}}'),
  "开始安装 Claude Code",
);
check("裸码（安装来源）", describeNote("systemPackageManager"), "系统包管理器");
check("带参裸结构", describeNote('{"code":"officialApp","args":{"name":"Trae"}}'), "官方应用（Trae）");

console.log("回落路径 —— 绝不能把原文弄丢或露出键名");
check("非结构化原样透传", describeNote("npm ERR! network timeout"), "npm ERR! network timeout");
check("shell 回显原样透传", describeNote("$ npm install -g foo"), "$ npm install -g foo");
check(
  "未知码回落显示原文而非键名",
  describeError('{"code":"totallyNewCode","args":{}}'),
  "{}",
);
check("Error 实例", describeError(new Error('{"code":"keyRequired"}')), "Key 不能为空");
check("非字符串非 Error", describeError(42), "发生未知错误");

// 切到英文，确认同一批码走的是英文词典（也验证了「切语言后仍可用」）
console.log("英文词典");
await i18n.changeLanguage("en-US");
check("错误码 → 英文", describeError('{"code":"nameRequired"}'), "Name cannot be empty");
check(
  "保留参数 → 英文",
  describeNote('{"code":"taskStart","args":{"verb":"install","name":"Claude Code"}}'),
  "Starting install of Claude Code",
);
check("裸码 → 英文", describeNote("systemPackageManager"), "system package manager");
check("非结构化仍原样透传", describeNote("npm ERR! network timeout"), "npm ERR! network timeout");

await i18n.changeLanguage("zh-CN");

if (failures > 0) {
  console.error(`\n消息翻译测试未通过：${failures} 项`);
  process.exit(1);
}
console.log("\n✓ 消息翻译全部通过");
