/** 与 src-tauri/src/apps.rs 中的结构保持一致。 */

export type AppId =
  | "claude-code"
  | "codex"
  | "gemini-cli"
  | "grok-build"
  | "opencode"
  | "openclaw"
  | "pi"
  | "hermes"
  | "trae"
  | "workbuddy";

export interface AppStatus {
  id: AppId;
  installed: boolean;
  version: string | null;
  path: string | null;
  /**
   * 这份安装是否位于 npm 全局目录下、因而能被 CCHub 更新/卸载。
   *
   * 同一个 CLI 可以由 Homebrew、官方安装脚本等多种方式装上。对那些安装，
   * `npm uninstall -g` 会「成功」但什么都没删，`npm install -g` 则会装出
   * 第二份并造成 PATH 冲突，所以必须区分对待。
   */
  managed: boolean;
  /** managed 为 false 时，推断出的安装来源（如 "Homebrew"、"官方应用 (Trae.app)"）。 */
  externalHint: string | null;
  /**
   * External 源应用的官方安装页地址。非 External 应用为 null。
   * 当此字段存在时，前端应将「安装 / 更新 / 卸载」按钮改为打开官网。
   */
  installUrl: string | null;
}

export interface LatestVersion {
  id: AppId;
  latest: string | null;
  updateAvailable: boolean;
  error: string | null;
}

export interface EnvironmentInfo {
  os: string;
  arch: string;
  nodeVersion: string | null;
  npmVersion: string | null;
  nodePath: string | null;
  npmPath: string | null;
  resolvedPath: string;
}

export type TaskKind = "install" | "update" | "uninstall";

/** 与 src-tauri/src/prefs.rs 中的结构保持一致。 */

export type Theme = "system" | "light" | "dark";

export interface ProxyPrefs {
  /** 代理地址，空串表示直连 */
  url: string;
  /** 不走代理的主机（分号分隔，支持通配），写入 NO_PROXY */
  noProxy: string;
  /** 跟随系统环境变量里的代理 */
  useSystem: boolean;
}

export interface Prefs {
  schemaVersion: number;
  theme: Theme;
  locale: string;
  detectOnLaunch: boolean;
  checkUpdatesOnLaunch: boolean;
  proxy: ProxyPrefs;
  /** 远端目录地址，空串表示只用内置目录 */
  catalogUrl: string;
  /** 远端目录条目的缓存时长（小时） */
  catalogTtlHours: number;
}

/** set_prefs 的入参：部分字段的对象，只含要改的键。 */
export type PrefsDiff = Partial<
  Omit<Prefs, "schemaVersion" | "proxy">
> & { proxy?: Partial<ProxyPrefs> };

/** 远端目录条目（与 catalog.ts 的 CatalogEntry 展示字段对齐）。 */
export interface RemoteEntry {
  id: AppId;
  name: string;
  vendor: string;
  tagline: string;
  description: string;
  initials: string;
  tags: string[];
  homepage: string;
  docs: string;
}

export type CatalogSourceKind = "remote" | "cache" | "builtin";

export interface CatalogResponse {
  entries: RemoteEntry[];
  source: CatalogSourceKind;
  note: string | null;
}

export interface NetworkTestResult {
  ok: boolean;
  /** 成功时的延迟毫秒；失败时的原因 */
  latencyMs: number | null;
  error: string | null;
}

/** 与 src-tauri/src/skills.rs 中的结构保持一致。 */

export interface SkillMeta {
  name: string;
  description: string;
}

export interface SkillEntry {
  /** 目录名（slug） */
  id: string;
  meta: SkillMeta;
  enabled: boolean;
  path: string;
}

export interface SkillSource {
  id: string;
  name: string;
  description: string;
  category: string;
  repo: string;
  subdir: string;
}

/** 与 src-tauri/src/keys.rs 中的结构保持一致。 */

export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "openrouter"
  | "glm"
  | "deepseek"
  | "kimi"
  | "minimax";

export interface KeyRef {
  provider: ProviderId;
  label: string;
  addedAt: string;
}

/** 与 src-tauri/src/providers.rs 的 ProviderInfo 对齐。 */
export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Anthropic 兼容 base_url；null = 不可路由到 Claude Code。 */
  anthropicEndpoint: string | null;
  /** Gemini API 兼容 base_url；null = 不可路由到 Gemini CLI。 */
  geminiEndpoint: string | null;
  /** key 连通测试的端点。 */
  probeEndpoint: string;
  probeHeader: string;
  bearerAuth: boolean;
  /** 探活请求方式：get / post。 */
  probeMethod: "get" | "post";
  /** 推荐模型名（表单预填用）。 */
  defaultModels: string[];
}

export type KeyTestResult =
  | { kind: "ok"; latencyMs: number }
  | { kind: "invalid" }
  | { kind: "error"; message: string };

/** 与 src-tauri/src/mcp.rs 中的结构保持一致。 */

export interface ArgSpec {
  label: string;
  placeholder: string;
}

export type EnvSource = "direct" | "homeDir";

export interface EnvSpec {
  key: string;
  source: EnvSource;
  placeholder: string;
  required: boolean;
}

export interface McpService {
  id: string;
  name: string;
  description: string;
  transport: "stdio" | "http";
  command: string;
  args: string[];
  argSpecs: ArgSpec[];
  envSpecs: EnvSpec[];
  installHint: string;
}

/** write_mcp_service 的请求体。 */
export interface McpWriteRequest {
  argValues: string[];
  envValues: Record<string, string>;
}

export interface HostEntry {
  name: string;
  managed: boolean;
  spec: {
    type?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
  };
}

export interface HostConfig {
  entries: HostEntry[];
  note: string | null;
}

export interface McpTestResult {
  ok: boolean;
  serverName: string | null;
  error: string | null;
}

/** 与 src-tauri/src/routes.rs 中的结构保持一致。 */

export interface RouteRule {
  /** 预设实例 id。新增时不传，由后端生成。 */
  id: string;
  /** 目标宿主："claude-code" | "codex"。 */
  app: string;
  /** 显示名，如 "GLM 主力"。 */
  name: string;
  provider: ProviderId;
  baseUrl: string;
  keyRef: string;
  /** 模型名。Codex 必填；Claude Code 可选。 */
  model: string | null;
  /** Codex 专属：请求协议。"chat" = Chat Completions（默认），"responses" = OpenAI Responses API。null = 默认。 */
  wireApi: "chat" | "responses" | null;
  /** Claude Code 专属：Opus 档位映射（ANTHROPIC_DEFAULT_OPUS_MODEL）。 */
  modelOpus: string | null;
  /** Claude Code 专属：Sonnet 档位映射。 */
  modelSonnet: string | null;
  /** Claude Code 专属：Haiku 档位映射。 */
  modelHaiku: string | null;
  addedAt: string;
}

/** 单宿主的回读状态 + 偏差标记。 */
export interface HostStateView {
  /** 宿主文件里生效的 base_url；null = 未下发。 */
  baseUrl: string | null;
  /** 生效的 key 指纹（前 4 位 + 长度，不含明文）。 */
  keyFingerprint: string | null;
  /** 模型映射当前值。 */
  modelMappings: Record<string, string>;
  /** 宿主文件是否可读。 */
  readable: boolean;
  /** 激活预设与宿主实际是否一致；null = 无激活预设。 */
  drift: boolean | null;
}

/** list_routes 返回的完整状态。 */
export interface RoutesStateView {
  rules: RouteRule[];
  /** 宿主 → 激活的预设 id。 */
  active: Record<string, string>;
  /** 宿主 → 实际生效配置（回读）。 */
  hosts: Record<string, HostStateView>;
}

export interface TaskLog {
  id: AppId;
  line: string;
  stream: "stdout" | "stderr" | "info";
}

export interface TaskFinished {
  id: AppId;
  success: boolean;
  message: string;
}

/** CCHub 首页上展示的应用条目。 */
export interface CatalogEntry {
  id: AppId;
  /** 卡片左上角的缩写，用首字母区分 */
  initials: string;
  name: string;
  /** 厂商名，如 "Anthropic" / "Google" / "xAI" */
  vendor: string;
  /** 简介（一句话，不含句号） */
  tagline: string;
  /** 详细描述（用于将来详情页，现在已起用搜索索引） */
  description: string;
  /** 类别标记。cli-agent 是安装/卸载类，desktop-app 是只能跳转官网下载的 */
  category: "cli-agent" | "desktop-app";
  /** 卡片上的标签，前两个是标签 */
  tags: string[];
  /** 项目主页 // 官网 */
  homepage: string;
  /** 官方文档 */
  docs: string;
}
