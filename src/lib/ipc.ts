/**
 * 前端与 Rust 之间唯一的通道。
 *
 * 在浏览器里直接跑 `pnpm dev`（没有 Tauri 外壳）时，`invoke` 不可用。这里提供
 * 一份 mock，让 UI 可以脱离 Rust 独立开发与调试；一旦运行在 Tauri 里，就走真实
 * 的 IPC。
 */

import i18n from "@/i18n";
import { describeError } from "@/lib/errors";
import type {
  AppId,
  AppStatus,
  CatalogResponse,
  EnvironmentInfo,
  LatestVersion,
  NetworkTestResult,
  Prefs,
  PrefsDiff,
  TaskFinished,
  TaskKind,
  TaskLog,
} from "@/types";

export const EVENT_LOG = "app-task-log";
export const EVENT_FINISHED = "app-task-finished";

/** 是否运行在 Tauri 外壳内。 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type UnlistenFn = () => void;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

async function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  return tauriListen<T>(event, (e) => handler(e.payload));
}

// ------------------------------------------------------------------ 浏览器 mock

/**
 * 取出结构化错误的 `code`（线格式见 `src-tauri/src/error.rs`）；非结构化返回 null。
 *
 * 只用来做分支判断，展示仍走 `describeError`。**不要**再按文案子串判断 —— 那会
 * 随文案或界面语言一起碎掉。
 */
function errorCode(raw: string): string | null {
  if (!raw.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw) as { code?: unknown };
    return typeof parsed?.code === "string" ? parsed.code : null;
  } catch {
    return null;
  }
}

/**
 * 造一条与 Rust 同格式的结构化消息，供 mock 抛出/返回。
 *
 * mock 直接 `throw new Error("名字不能为空")` 也能显示，但那样就绕过了
 * `describeError` 的翻译链路 —— 浏览器开发模式于是测不到真实环境会走的
 * 「后端给码、前端查词典」这条路。
 */
function wireError(code: string, args?: Record<string, string>): Error {
  return new Error(JSON.stringify(args ? { code, args } : { code }));
}

const mockState: Record<AppId, AppStatus> = {
  // 故意让这一条是 npm 外部安装，方便在浏览器里就能看到该分支的 UI
  "claude-code": {
    id: "claude-code",
    installed: true,
    version: "2.1.265",
    path: "/opt/homebrew/bin/claude",
    managed: false,
    externalHint: "homebrew",
    installUrl: null,
  },
  codex: {
    id: "codex",
    installed: false,
    version: null,
    path: null,
    managed: true,
    externalHint: null,
    installUrl: null,
  },
  "gemini-cli": {
    id: "gemini-cli",
    installed: false,
    version: null,
    path: null,
    managed: true,
    externalHint: null,
    installUrl: null,
  },
  "grok-build": {
    id: "grok-build",
    installed: true,
    version: "1.0.25",
    path: "/usr/local/bin/grok",
    managed: true,
    externalHint: null,
    installUrl: null,
  },
  opencode: {
    id: "opencode",
    installed: false,
    version: null,
    path: null,
    managed: true,
    externalHint: null,
    installUrl: null,
  },
  openclaw: {
    id: "openclaw",
    installed: false,
    version: null,
    path: null,
    managed: true,
    externalHint: null,
    installUrl: null,
  },
  pi: {
    id: "pi",
    installed: false,
    version: null,
    path: null,
    managed: true,
    externalHint: null,
    installUrl: null,
  },
  // External 源：装了 CLI 但不在 npm 全局目录 → 不在管理窗口返回按钮
  hermes: {
    id: "hermes",
    installed: true,
    version: "0.19.0",
    path: "/Users/x/.hermes/bin/hermes",
    managed: false,
    externalHint: "officialScript",
    installUrl: "https://hermes-agent.nousresearch.com/install.sh",
  },
  // External 源 + 桌面 App：WorkBuddy.app 走的是「官网下载」流程
  trae: {
    id: "trae",
    installed: false,
    version: null,
    path: null,
    managed: false,
    externalHint: null,
    installUrl: "https://www.trae.ai/download",
  },
  workbuddy: {
    id: "workbuddy",
    installed: true,
    version: "5.3.14",
    path: "/Applications/WorkBuddy.app",
    managed: false,
    externalHint: JSON.stringify({ code: "officialApp", args: { name: "WorkBuddy.app" } }),
    installUrl: "https://www.workbuddy.cn/",
  },
};

const mockListeners = {
  log: new Set<(p: TaskLog) => void>(),
  finished: new Set<(p: TaskFinished) => void>(),
};

function mockRunTask(id: AppId, kind: TaskKind) {
  const actionKey =
    kind === "uninstall"
      ? "ipc.action.uninstall"
      : kind === "update"
        ? "ipc.action.update"
        : "ipc.action.install";
  const lines = [
    i18n.t("ipc.mockTaskStart", { action: i18n.t(actionKey), name: id }),
    "$ npm install -g ... (mock)",
    "added 1 package in 3s",
  ];

  lines.forEach((line, i) => {
    setTimeout(() => {
      mockListeners.log.forEach((fn) => fn({ id, line, stream: i === 0 ? "info" : "stdout" }));
    }, 400 * (i + 1));
  });

  setTimeout(() => {
    if (kind === "uninstall") {
      mockState[id] = {
        id,
        installed: false,
        version: null,
        path: null,
        managed: true,
        externalHint: null,
        installUrl: null,
      };
    } else {
      mockState[id] = {
        id,
        installed: true,
        version: "9.9.9",
        path: `/mock/npm/bin/${id}`,
        managed: true,
        externalHint: null,
        installUrl: null,
      };
    }
    mockListeners.finished.forEach((fn) =>
      fn({ id, success: true, message: i18n.t("ipc.mockTaskDone", { name: id }) }),
    );
  }, 400 * (lines.length + 1));
}

// ------------------------------------------------------------------ 公开 API

export async function detectApps(): Promise<AppStatus[]> {
  if (!isTauri()) return Object.values(mockState);
  return invoke<AppStatus[]>("detect_apps");
}

export async function detectApp(id: AppId): Promise<AppStatus> {
  if (!isTauri()) return mockState[id];
  return invoke<AppStatus>("detect_app", { id });
}

export async function detectEnvironment(): Promise<EnvironmentInfo> {
  if (!isTauri()) {
    return {
      os: "browser",
      arch: "mock",
      nodeVersion: "24.20.0",
      npmVersion: "11.19.0",
      nodePath: "/mock/bin/node",
      npmPath: "/mock/bin/npm",
      resolvedPath: "/mock/bin:/usr/bin:/bin",
    };
  }
  return invoke<EnvironmentInfo>("detect_environment");
}

export async function checkLatestVersion(id: AppId): Promise<LatestVersion> {
  if (!isTauri()) {
    return { id, latest: "9.9.9", updateAvailable: true, error: null };
  }
  return invoke<LatestVersion>("check_latest_version", { id });
}

export async function runAppTask(id: AppId, kind: TaskKind): Promise<void> {
  if (!isTauri()) {
    // External 源在浏览器 mock 下走同一条拒绝路径（错误码与 Rust 侧一致）
    if (mockState[id].installUrl) {
      return Promise.reject(
        new Error(JSON.stringify({ code: "appNotNpm", args: { name: id } })),
      );
    }
    mockRunTask(id, kind);
    return;
  }
  return invoke<void>("run_app_task", { id, kind });
}

export async function onTaskLog(handler: (payload: TaskLog) => void): Promise<UnlistenFn> {
  if (!isTauri()) {
    mockListeners.log.add(handler);
    return () => mockListeners.log.delete(handler);
  }
  return listen<TaskLog>(EVENT_LOG, handler);
}

export async function onTaskFinished(
  handler: (payload: TaskFinished) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) {
    mockListeners.finished.add(handler);
    return () => mockListeners.finished.delete(handler);
  }
  return listen<TaskFinished>(EVENT_FINISHED, handler);
}

/** 用系统默认浏览器打开外链——桌面应用里不应该在 webview 内部导航到外站。 */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

// ------------------------------------------------------------------ 偏好 / 目录源

/** 浏览器 mock 下持久化的偏好（localStorage），让 UI 行为与桌面端一致。 */
const MOCK_PREFS_KEY = "cchub:mock-prefs";

function mockPrefs(): Prefs {
  return {
    schemaVersion: 1,
    theme: "system",
    locale: "zh-CN",
    detectOnLaunch: true,
    checkUpdatesOnLaunch: true,
    proxy: { url: "", noProxy: "localhost;127.0.0.1", useSystem: false },
    catalogUrl: "",
    catalogTtlHours: 24,
  };
}

export async function getPrefs(): Promise<Prefs> {
  if (!isTauri()) {
    const raw = localStorage.getItem(MOCK_PREFS_KEY);
    if (raw) {
      try {
        return { ...mockPrefs(), ...(JSON.parse(raw) as Prefs) };
      } catch {
        // 损坏就当没有，走默认
      }
    }
    return mockPrefs();
  }
  return invoke<Prefs>("get_prefs");
}

export async function setPrefs(diff: PrefsDiff): Promise<Prefs> {
  if (!isTauri()) {
    const current = await getPrefs();
    const merged: Prefs = {
      ...current,
      ...diff,
      proxy: { ...current.proxy, ...diff.proxy },
    };
    localStorage.setItem(MOCK_PREFS_KEY, JSON.stringify(merged));
    return merged;
  }
  return invoke<Prefs>("set_prefs", { diff });
}

export async function getCatalog(): Promise<CatalogResponse> {
  if (!isTauri()) {
    // 浏览器模式下没有白名单校验需求，直接声明用内置目录
    return {
      entries: [],
      source: "builtin",
      note: JSON.stringify({ code: "browserBuiltinCatalog" }),
    };
  }
  return invoke<CatalogResponse>("get_catalog");
}

export async function testNetwork(): Promise<NetworkTestResult> {
  if (!isTauri()) {
    return { ok: true, latencyMs: 42, error: null };
  }
  // Rust 侧返回 Result<u128, String>，tauri 序列化为 { Ok } / { Err }
  const result = await invoke<{ Ok?: number; Err?: string }>("test_network");
  if (typeof result.Ok === "number") {
    return { ok: true, latencyMs: result.Ok, error: null };
  }
  if (typeof result.Err === "string") {
    return { ok: false, latencyMs: null, error: describeError(result.Err) };
  }
  return { ok: false, latencyMs: null, error: i18n.t("ipc.testNetworkUnknown") };
}

// ------------------------------------------------------------------ 开机自启

/** 浏览器 mock 下持久化自启状态（仅模拟开关行为，不真正自启）。 */
const MOCK_AUTOSTART_KEY = "cchub:mock-autostart";

export async function getAutoStart(): Promise<boolean> {
  if (!isTauri()) {
    return localStorage.getItem(MOCK_AUTOSTART_KEY) === "1";
  }
  const { isEnabled } = await import("@tauri-apps/plugin-autostart");
  return isEnabled();
}

export async function setAutoStart(enabled: boolean): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(MOCK_AUTOSTART_KEY, enabled ? "1" : "0");
    return;
  }
  const { enable, disable } = await import("@tauri-apps/plugin-autostart");
  if (enabled) {
    await enable();
  } else {
    await disable();
  }
}

// ------------------------------------------------------------------ Skill 管理

import type { SkillEntry, SkillSource } from "@/types";

/** 浏览器 mock 的已安装 Skill。 */
const MOCK_SKILLS_KEY = "cchub:mock-skills";

function mockSkillSources(): SkillSource[] {
  return [
    {
      id: "docx",
      name: "docx",
      description: "读写 Word 文件：创建、编辑、合并文档与格式（官方）",
      category: "文档",
      repo: "https://github.com/anthropics/skills.git",
      subdir: "skills/docx",
    },
    {
      id: "superpowers-tdd",
      name: "test-driven-development",
      description: "superpowers：测试驱动开发纪律",
      category: "工程",
      repo: "https://github.com/obra/superpowers.git",
      subdir: "skills/test-driven-development",
    },
  ];
}

function mockSkills(): SkillEntry[] {
  try {
    const raw = localStorage.getItem(MOCK_SKILLS_KEY);
    if (raw) return JSON.parse(raw) as SkillEntry[];
  } catch {
    // 损坏按空处理
  }
  return [];
}

function saveMockSkills(entries: SkillEntry[]) {
  localStorage.setItem(MOCK_SKILLS_KEY, JSON.stringify(entries));
}

export async function listSkills(): Promise<SkillEntry[]> {
  if (!isTauri()) return mockSkills();
  return invoke<SkillEntry[]>("list_skills");
}

export async function listSkillSources(): Promise<SkillSource[]> {
  if (!isTauri()) return mockSkillSources();
  return invoke<SkillSource[]>("list_skill_sources");
}

export async function installSkill(id: string): Promise<SkillEntry[]> {
  if (!isTauri()) {
    const source = mockSkillSources().find((s) => s.id === id);
    const entries = [
      ...mockSkills().filter((e) => e.id !== id),
      {
        id,
        meta: { name: source?.name ?? id, description: source?.description ?? "" },
        enabled: true,
        path: `/mock/.claude/skills/${id}`,
      },
    ];
    saveMockSkills(entries);
    return entries;
  }
  return invoke<SkillEntry[]>("install_skill", { id });
}

export async function setSkillEnabled(
  id: string,
  enabled: boolean,
): Promise<SkillEntry[]> {
  if (!isTauri()) {
    const entries = mockSkills().map((e) =>
      e.id === id ? { ...e, enabled } : e,
    );
    saveMockSkills(entries);
    return entries;
  }
  return invoke<SkillEntry[]>("set_skill_enabled", { id, enabled });
}

export async function uninstallSkill(id: string): Promise<SkillEntry[]> {
  if (!isTauri()) {
    saveMockSkills(mockSkills().filter((e) => e.id !== id));
    return mockSkills();
  }
  return invoke<SkillEntry[]>("uninstall_skill", { id });
}

// ------------------------------------------------------------------ 供应商目录

import type { ProviderInfo } from "@/types";

function mockProviders(): ProviderInfo[] {
  return [
    {
      id: "anthropic",
      label: "Anthropic（官方）",
      anthropicEndpoint: "https://api.anthropic.com",
      geminiEndpoint: null,
      probeEndpoint: "https://api.anthropic.com/v1/models",
      probeHeader: "x-api-key",
      bearerAuth: false,
      probeMethod: "get",
      defaultModels: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    },
    {
      id: "openrouter",
      label: "OpenRouter（聚合中转）",
      anthropicEndpoint: "https://openrouter.ai/api/v1",
      geminiEndpoint: null,
      probeEndpoint: "https://openrouter.ai/api/v1/models",
      probeHeader: "Authorization",
      bearerAuth: true,
      probeMethod: "get",
      defaultModels: [],
    },
    {
      id: "glm",
      label: "GLM（智谱）",
      anthropicEndpoint: "https://open.bigmodel.cn/api/anthropic",
      geminiEndpoint: null,
      probeEndpoint: "https://open.bigmodel.cn/api/anthropic/v1/models",
      probeHeader: "x-api-key",
      bearerAuth: false,
      probeMethod: "get",
      defaultModels: ["glm-5.2", "glm-4.7"],
    },
    {
      id: "deepseek",
      label: "DeepSeek",
      anthropicEndpoint: "https://api.deepseek.com/anthropic",
      geminiEndpoint: null,
      probeEndpoint: "https://api.deepseek.com/anthropic/v1/models",
      probeHeader: "x-api-key",
      bearerAuth: false,
      probeMethod: "get",
      defaultModels: ["deepseek-flash"],
    },
    {
      id: "kimi",
      label: "Kimi（Moonshot）",
      anthropicEndpoint: "https://api.moonshot.cn/anthropic",
      geminiEndpoint: null,
      probeEndpoint: "https://api.moonshot.cn/anthropic/v1/messages",
      probeHeader: "Authorization",
      bearerAuth: true,
      probeMethod: "post",
      defaultModels: ["kimi-k3", "kimi-k2.7-code"],
    },
    {
      id: "minimax",
      label: "MiniMax",
      anthropicEndpoint: "https://api.minimaxi.com",
      geminiEndpoint: null,
      probeEndpoint: "https://api.minimaxi.com/v1/models",
      probeHeader: "Authorization",
      bearerAuth: true,
      probeMethod: "get",
      defaultModels: ["MiniMax-M3", "MiniMax-M2.7"],
    },
    {
      id: "openai",
      label: "OpenAI",
      anthropicEndpoint: null,
      geminiEndpoint: null,
      probeEndpoint: "https://api.openai.com/v1/models",
      probeHeader: "Authorization",
      bearerAuth: true,
      probeMethod: "get",
      defaultModels: [],
    },
    {
      id: "google",
      label: "Google",
      anthropicEndpoint: null,
      geminiEndpoint: "https://generativelanguage.googleapis.com/v1beta",
      probeEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
      probeHeader: "x-goog-api-key",
      bearerAuth: false,
      probeMethod: "get",
      defaultModels: [],
    },
    {
      id: "xai",
      label: "xAI",
      anthropicEndpoint: null,
      geminiEndpoint: null,
      probeEndpoint: "https://api.x.ai/v1/models",
      probeHeader: "Authorization",
      bearerAuth: true,
      probeMethod: "get",
      defaultModels: [],
    },
  ];
}

export async function listProviders(): Promise<ProviderInfo[]> {
  if (!isTauri()) return mockProviders();
  return invoke<ProviderInfo[]>("list_providers");
}

// ------------------------------------------------------------------ API Key

import type { KeyRef, KeyTestResult, ProviderId } from "@/types";

const MOCK_KEYS_KEY = "cchub:mock-keys";

function mockKeyRefs(): KeyRef[] {
  try {
    const raw = localStorage.getItem(MOCK_KEYS_KEY);
    if (raw) return JSON.parse(raw) as KeyRef[];
  } catch {
    // 损坏按空处理
  }
  return [];
}

function saveMockKeyRefs(refs: KeyRef[]) {
  localStorage.setItem(MOCK_KEYS_KEY, JSON.stringify(refs));
}

export async function listKeyRefs(): Promise<KeyRef[]> {
  if (!isTauri()) return mockKeyRefs();
  return invoke<KeyRef[]>("list_key_refs");
}

export async function saveKey(
  provider: ProviderId,
  label: string,
  value: string,
): Promise<KeyRef[]> {
  if (!isTauri()) {
    // 与 Rust `save_key` 的校验保持一致：mock 放行了空值，浏览器开发模式
    // 就看不到真实环境会有的报错，错误路径也就没人验证。
    if (!label.trim()) throw wireError("nameRequired");
    if (!value.trim()) throw wireError("keyRequired");

    const refs = [
      ...mockKeyRefs().filter((k) => !(k.provider === provider && k.label === label)),
      { provider, label: label.trim(), addedAt: new Date().toISOString() },
    ];
    saveMockKeyRefs(refs);
    return refs;
  }
  return invoke<KeyRef[]>("save_key", { provider, label, value });
}

export async function deleteKey(provider: ProviderId, label: string): Promise<KeyRef[]> {
  if (!isTauri()) {
    const refs = mockKeyRefs().filter(
      (k) => !(k.provider === provider && k.label === label),
    );
    saveMockKeyRefs(refs);
    return refs;
  }
  return invoke<KeyRef[]>("delete_key", { provider, label });
}

export async function revealKey(provider: ProviderId, label: string): Promise<string> {
  if (!isTauri()) {
    return `sk-mock-${provider}-${label.replace(/\W/g, "")}`.slice(0, 40);
  }
  return invoke<string>("reveal_key", { provider, label });
}

export async function testKey(
  provider: ProviderId,
  label: string,
): Promise<KeyTestResult> {
  if (!isTauri()) {
    return { kind: "ok", latencyMs: 120 };
  }
  const result = await invoke<{ Ok?: number; Err?: string }>("test_key", {
    provider,
    label,
  });
  if (typeof result.Ok === "number") {
    return { kind: "ok", latencyMs: result.Ok };
  }
  if (typeof result.Err === "string") {
    if (errorCode(result.Err) === "keyRejected") {
      return { kind: "invalid" };
    }
    return { kind: "error", message: describeError(result.Err) };
  }
  return { kind: "error", message: i18n.t("ipc.unknownResult") };
}

// ------------------------------------------------------------------ MCP

import type { HostConfig, McpService, McpTestResult, McpWriteRequest } from "@/types";

function mockMcpServices(): McpService[] {
  return [
    {
      id: "filesystem",
      name: "Filesystem",
      description: "受控的文件系统读写：读写、搜索、移动（官方）",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      argSpecs: [{ label: "允许访问的目录", placeholder: "如 ~/Projects（多个以空格分隔）" }],
      envSpecs: [],
      installHint: "需要 Node.js",
    },
    {
      id: "context7",
      name: "Context7",
      description: "为代码智能体提供最新的库文档（Upstash）",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      argSpecs: [],
      envSpecs: [
        {
          key: "CONTEXT7_API_KEY",
          source: "direct",
          placeholder: "可选；留空走公共限流",
          required: false,
        },
      ],
      installHint: "需要 Node.js",
    },
  ];
}

export async function listMcpServices(): Promise<McpService[]> {
  if (!isTauri()) return mockMcpServices();
  return invoke<McpService[]>("list_mcp_services");
}

/** MCP 宿主配置位置的词典键；模块级不能定型文案，只能存键。 */
export type McpHostTargetKey =
  | "mcp.host.targets.claudeCode"
  | "mcp.host.targets.codex"
  | "mcp.host.targets.geminiCli";

/** MCP 宿主清单（与 Rust mcp::hosts 的 MCP_HOSTS 对齐）。 */
export const MCP_HOSTS: { id: string; label: string; targetKey: McpHostTargetKey }[] = [
  { id: "claude-code", label: "Claude Code", targetKey: "mcp.host.targets.claudeCode" },
  { id: "codex", label: "Codex CLI", targetKey: "mcp.host.targets.codex" },
  { id: "gemini-cli", label: "Gemini CLI", targetKey: "mcp.host.targets.geminiCli" },
];

/** 浏览器 mock：每宿主一份 managed 清单。 */
function mockManagedOf(host: string): string[] {
  try {
    const raw = localStorage.getItem(`cchub:mock-mcp-${host}`);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    // 损坏按空处理
  }
  return [];
}

function saveMockManagedOf(host: string, names: string[]) {
  localStorage.setItem(`cchub:mock-mcp-${host}`, JSON.stringify(names));
}

export async function readHostConfig(hostId: string): Promise<HostConfig> {
  if (!isTauri()) {
    return {
      entries: mockManagedOf(hostId).map((name) => ({
        name,
        managed: true,
        spec: {
          type: "stdio",
          command: name === "fetch" ? "uvx" : "npx",
          args: [],
        },
      })),
      note: null,
    };
  }
  return invoke<HostConfig>("read_host_config", { hostId });
}

export async function writeMcpService(
  hostId: string,
  id: string,
  request?: McpWriteRequest,
): Promise<HostConfig> {
  if (!isTauri()) {
    const managed = mockManagedOf(hostId);
    if (!managed.includes(id)) managed.push(id);
    saveMockManagedOf(hostId, managed);
    return readHostConfig(hostId);
  }
  return invoke<HostConfig>("write_mcp_service", {
    hostId,
    id,
    request: request ?? { argValues: [], envValues: {} },
  });
}

export async function removeMcpService(hostId: string, id: string): Promise<HostConfig> {
  if (!isTauri()) {
    saveMockManagedOf(hostId, mockManagedOf(hostId).filter((n) => n !== id));
    return readHostConfig(hostId);
  }
  return invoke<HostConfig>("remove_mcp_service", { hostId, id });
}

export async function testMcpService(id: string): Promise<McpTestResult> {
  if (!isTauri()) {
    return { ok: true, serverName: id, error: null };
  }
  return invoke<McpTestResult>("test_mcp_service", { id });
}

// ------------------------------------------------------------------ 请求路由

import type { HostStateView, RouteRule, RoutesStateView } from "@/types";

const MOCK_ROUTES_KEY = "cchub:mock-routes";

/** mock 宿主回读：把激活预设当作宿主实际（无真机文件可读），
 * 外部改动偏差由用户手动改 localStorage 模拟。 */
function mockHosts(
  state: MockRoutesFile,
): Record<string, HostStateView> {
  const hosts: Record<string, HostStateView> = {};
  for (const [app, id] of Object.entries(state.active)) {
    const rule = state.rules.find((r) => r.id === id);
    hosts[app] = {
      baseUrl: rule?.baseUrl ?? null,
      keyFingerprint: rule ? "mock…6" : null,
      modelMappings: rule
        ? {
            ...(rule.model ? { model: rule.model } : {}),
            ...(rule.modelOpus ? { opus: rule.modelOpus } : {}),
            ...(rule.modelSonnet ? { sonnet: rule.modelSonnet } : {}),
            ...(rule.modelHaiku ? { haiku: rule.modelHaiku } : {}),
          }
        : {},
      readable: true,
      drift: false,
    };
  }
  return hosts;
}

/** mock 的持久化形态（hosts 动态算，不落盘）。 */
type MockRoutesFile = Omit<RoutesStateView, "hosts">;

function mockRoutesState(): MockRoutesFile {
  try {
    const raw = localStorage.getItem(MOCK_ROUTES_KEY);
    if (raw) return JSON.parse(raw) as MockRoutesFile;
  } catch {
    // 损坏按空处理
  }
  return { rules: [], active: {} };
}

function saveMockRoutes(state: MockRoutesFile) {
  localStorage.setItem(MOCK_ROUTES_KEY, JSON.stringify(state));
}

export async function listRoutes(): Promise<RoutesStateView> {
  if (!isTauri()) {
    const state = mockRoutesState();
    return { ...state, hosts: mockHosts(state) };
  }
  return invoke<RoutesStateView>("list_routes");
}

export async function saveRoute(rule: RouteRule): Promise<RoutesStateView> {
  if (!isTauri()) {
    const state = mockRoutesState();
    const withId = { ...rule, id: rule.id || `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    const rules = [...state.rules.filter((r) => r.id !== withId.id), withId];
    const next = { rules, active: state.active };
    saveMockRoutes(next);
    return { ...next, hosts: mockHosts(next) };
  }
  return invoke<RoutesStateView>("save_route", { rule });
}

export async function deleteRoute(id: string): Promise<RoutesStateView> {
  if (!isTauri()) {
    const state = mockRoutesState();
    const target = state.rules.find((r) => r.id === id);
    const rules = state.rules.filter((r) => r.id !== id);
    const active = { ...state.active };
    if (target && active[target.app] === id) delete active[target.app];
    const next = { rules, active };
    saveMockRoutes(next);
    return { ...next, hosts: mockHosts(next) };
  }
  return invoke<RoutesStateView>("delete_route", { id });
}

/** 一键切换：激活指定预设并立即下发。 */
export async function switchRoute(id: string): Promise<string> {
  if (!isTauri()) {
    const state = mockRoutesState();
    const target = state.rules.find((r) => r.id === id);
    if (!target) {
      return Promise.reject(
        new Error(JSON.stringify({ code: "presetNotFound", args: { id } })),
      );
    }
    const next = { ...state, active: { ...state.active, [target.app]: id } };
    saveMockRoutes(next);
    return i18n.t("ipc.mockSwitchDone", { app: target.app, name: target.name });
  }
  return invoke<string>("switch_route", { id });
}

/** 停用某宿主：下发清除并移除激活记录。 */
export async function clearRoute(appId: string): Promise<string> {
  if (!isTauri()) {
    const state = mockRoutesState();
    const active = { ...state.active };
    delete active[appId];
    const next = { ...state, active };
    saveMockRoutes(next);
    return i18n.t("ipc.mockClearDone", { app: appId });
  }
  return invoke<string>("clear_route", { appId });
}

/** 按当前激活状态重下发全部宿主。 */
export async function applyRoutes(): Promise<string> {
  if (!isTauri()) {
    return i18n.t("ipc.mockApplyDone");
  }
  return invoke<string>("apply_routes");
}

/** 预设测速结果：ok = 延迟 ms；其余为失败原因。 */
export type RouteProbeResult =
  | { kind: "ok"; latencyMs: number }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

/** 按预设的 base_url + key 实发一次探活（测这条预设实际能不能用）。 */
export async function probeRoute(id: string): Promise<RouteProbeResult> {
  if (!isTauri()) {
    return { kind: "ok", latencyMs: 180 };
  }
  const result = await invoke<{ Ok?: number; Err?: string }>("probe_route", { id });
  if (typeof result.Ok === "number") {
    return { kind: "ok", latencyMs: result.Ok };
  }
  if (typeof result.Err === "string") {
    // key 被服务端拒绝（401/403）走 invalid；其余按网络/服务问题报
    if (errorCode(result.Err) === "keyRejected") {
      return { kind: "invalid", message: describeError(result.Err) };
    }
    return { kind: "error", message: describeError(result.Err) };
  }
  return { kind: "error", message: i18n.t("ipc.unknownResult") };
}
