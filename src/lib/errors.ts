import i18n from "@/i18n";

/**
 * 后端消息（错误与提示）的翻译出口。
 *
 * Rust 的命令返回 `Result<T, String>` / `Option<String>`，但字符串里装的是结构化
 * 内容 —— 见 `src-tauri/src/error.rs`：
 *
 * ```json
 * {"code":"providerUnknown","args":{"provider":"glm"}}
 * ```
 *
 * **顶层码**决定去哪个词典分节查：
 * - `describeError` → `errors.*`（失败）
 * - `describeNote`  → `notes.*`（状态说明、操作反馈、任务日志）
 *
 * **保留参数名**会在插值前被二次翻译（值本身是词典键，不是文案）：
 * | 参数 | 分节 | 用途 |
 * |---|---|---|
 * | `op` | `op.*` | I/O 操作名，让 `errors.ioFailed` 一条模板覆盖所有 I/O 失败 |
 * | `label` | `fields.*` | 表单字段名，如 `fieldBlank` 的 `label` |
 * | `hint` | `notes.*` | 安装来源等短标签，如「由 X 管理」里的 X |
 * | `verb` | `verb.*` | 动作（安装/更新/卸载），Rust `TaskKind::verb` 产出的码 |
 *
 * 解析失败一律**原样透传**：新前端配旧后端、或后端加了码而前端还没跟上时，
 * 用户看到的顶多是中文原文，绝不会是空白或裸露的 `errors.xxx`。
 */

/** 后端结构化消息的线上形状。 */
interface WireMessage {
  code: string;
  args?: Record<string, string>;
}

/** 保留参数名 → 它该去的词典分节。 */
const RESERVED_ARGS: Record<string, string> = {
  op: "op",
  label: "fields",
  hint: "notes",
  verb: "verb",
};

/** 把任何抛出物收敛成一句可展示的错误文案。 */
export function describeError(err: unknown): string {
  if (typeof err === "string") return translate(err, "errors");
  if (err instanceof Error) return translate(err.message, "errors");
  return lookup("errors.unknown");
}

/**
 * 把后端产出的**非错误**消息（状态说明 / 操作反馈）翻译成当前语言。
 *
 * 两种输入都吃：
 * - 结构化 JSON（`{"code":"routeApplied",...}`）
 * - 裸码（如安装来源 `homebrew`）—— 查 `notes.<code>`，查不到原样显示
 *
 * 非 JSON 且不是已知裸码的输入（npm stdout、shell 命令回显）原样返回，
 * 所以对任务日志整行调用是安全的。
 */
export function describeNote(raw: string): string {
  if (!raw) return raw;
  const wire = parseWire(raw);
  if (wire) return translateWire(wire, "notes");
  // 裸码：查得到就翻译，查不到说明是原始输出，原样返回
  const key = `notes.${raw}`;
  return i18n.exists(key) ? lookup(key) : raw;
}

/** 解析结构化消息；不是结构化格式时返回 null。 */
function parseWire(raw: string): WireMessage | null {
  // 廉价预筛：自然语言与 npm 输出极少以 { 开头，省掉绝大多数 JSON.parse 抛错
  if (!raw.startsWith("{")) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "code" in parsed &&
      typeof (parsed as { code: unknown }).code === "string"
    ) {
      const { code, args } = parsed as { code: string; args?: unknown };
      return {
        code,
        args:
          typeof args === "object" && args !== null
            ? (args as Record<string, string>)
            : undefined,
      };
    }
  } catch {
    // 不是 JSON：按原文处理
  }
  return null;
}

function translate(raw: string, section: "errors" | "notes"): string {
  const wire = parseWire(raw);
  if (wire) return translateWire(wire, section);
  // `errors` 分节的调用方拿到的可能是裸码，兜一下；`notes` 走 describeNote
  const key = `${section}.${raw}`;
  return i18n.exists(key) ? lookup(key) : raw;
}

function translateWire(wire: WireMessage, section: string): string {
  const key = `${section}.${wire.code}`;
  // 词典没有这个码（后端加了新的、前端还没跟上）时，显示原文比显示键名诚实
  if (!i18n.exists(key)) {
    return wire.args ? JSON.stringify(wire.args) : wire.code;
  }

  const args: Record<string, string> = { ...wire.args };
  for (const [name, target] of Object.entries(RESERVED_ARGS)) {
    const value = args[name];
    if (!value) continue;
    const targetKey = `${target}.${value}`;
    if (i18n.exists(targetKey)) args[name] = lookup(targetKey);
  }

  return lookup(key, args);
}

/**
 * 动态键的翻译出口。
 *
 * 词典是类型化的（见 `src/i18n/index.ts` 的 `CustomTypeOptions`），这让静态的
 * `t("settings.appearance.light")` 能在编译期查错；但错误码是运行时才知道的，
 * 静态类型在这里只会帮倒忙，所以在这一处收窄成宽松签名。
 */
function lookup(key: string, args?: Record<string, string>): string {
  const translate = i18n.t as unknown as (
    k: string,
    o?: Record<string, string>,
  ) => string;
  return translate(key, args);
}
