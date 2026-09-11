import type { CatalogEntry } from "@/types";

/**
 * 目录里的应用普遍要求的最低 Node.js 大版本。
 *
 * 只用于提前给出可读的提示，不作为硬性拦截 —— 具体要求由各个包的 engines
 * 字段说话，真装不上时 npm 的 EBADENGINE 会被翻译成人话。
 */
export const MIN_NODE_MAJOR = 18;

/** 从 `24.20.0` 这样的版本号里取大版本，解析不了返回 null。 */
export function nodeMajor(version: string | null): number | null {
  if (!version) return null;
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? null : major;
}

/**
 * 首页展示的应用目录。
 *
 * 这里只放展示用的元数据；真正能被安装的包名在 Rust 侧的白名单里
 * （src-tauri/src/registry.rs），两边通过 `id` 对齐。往后接远端目录时，
 * 这个数组会被替换成一次网络请求，但 id 契约保持不变。
 *
 * npm 安装的 7 个应用走 `cli-agent` 流程；其余 3 个（Hermes 脚本 / Trae /
 * WorkBuddy 桌面应用）属于 `desktop-app`，CCHub 不代为安装，
 * 用户点「安装」时打开官方下载页。
 */
export const CATALOG: CatalogEntry[] = [
  // ---- 7 个 npm 可装的 CLI 智能体 ----
  {
    id: "claude-code",
    name: "Claude Code",
    vendor: "Anthropic",
    tagline: "在终端里干活的编码智能体",
    description:
      "Anthropic 官方的命令行编码智能体，可以读写代码库、运行命令、提交 PR。支持 CLI、桌面端与 IDE 扩展。",
    initials: "CC",
    category: "cli-agent",
    tags: ["编码智能体", "终端", "官方"],
    homepage: "https://claude.com/claude-code",
    docs: "https://docs.claude.com/en/docs/claude-code/overview",
  },
  {
    id: "codex",
    name: "Codex CLI",
    vendor: "OpenAI",
    tagline: "在本地沙箱里跑的开源智能体",
    description:
      "OpenAI 官方的开源命令行编码智能体，在本地沙箱中读写代码、执行任务，可搭配 ChatGPT 订阅或 API Key 使用。",
    initials: "CX",
    category: "cli-agent",
    tags: ["编码智能体", "终端", "开源"],
    homepage: "https://openai.com/codex",
    docs: "https://developers.openai.com/codex/cli",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    vendor: "Google",
    tagline: "Google 的开源终端编码智能体",
    description:
      "Google 官方出的开源命令行 AI 编码智能体，内置 Gemini 2.5 Pro，免费额度 60 req/min。",
    initials: "GE",
    category: "cli-agent",
    tags: ["编码智能体", "终端", "免费"],
    homepage: "https://github.com/google-gemini/gemini-cli",
    docs: "https://github.com/google-gemini/gemini-cli#readme",
  },
  {
    id: "grok-build",
    name: "Grok Build",
    vendor: "xAI",
    tagline: "xAI 的终端编码智能体",
    description:
      "xAI 官方的命令行编码智能体，带 Grok Code Fast 1 模型，支持 60 rpm 免费额度。",
    initials: "GR",
    category: "cli-agent",
    tags: ["编码智能体", "终端", "免费"],
    homepage: "https://docs.x.ai/grok-cli",
    docs: "https://docs.x.ai/grok-cli",
  },
  {
    id: "opencode",
    name: "OpenCode",
    vendor: "SST",
    tagline: "开源、MIT 协议的终端编码智能体",
    description:
      "SST 团队出品的开源终端编码智能体，原生 TUI，不绑定任何模型，支持任意 provider。",
    initials: "OC",
    category: "cli-agent",
    tags: ["编码智能体", "终端", "开源"],
    homepage: "https://opencode.ai",
    docs: "https://opencode.ai/docs",
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    vendor: "OpenClaw",
    tagline: "终端才是最重要的操作系统",
    description: "可自部署的开源个人 AI 助手网关，浦语灵笔项目孵化。",
    initials: "OC",
    category: "cli-agent",
    tags: ["助手", "网关", "自部署"],
    homepage: "https://openclaw.ai",
    docs: "https://docs.openclaw.ai/install",
  },
  {
    id: "pi",
    name: "Pi",
    vendor: "Mario Zechner",
    tagline: "开源交互式编码智能体",
    description: "badlogic 开源的交互式编码智能体 CLI，带统一 LLM API、多会话与终端 UI。",
    initials: "PI",
    category: "cli-agent",
    tags: ["编码智能体", "终端", "开源"],
    homepage: "https://badlogic.org/projects/pi-mono",
    docs: "https://badlogic.org/projects/pi-mono",
  },
  // ---- 3 个脚本 / 桌面 App：仅检测，不负责安装 ----
  {
    id: "hermes",
    name: "Hermes",
    vendor: "Nous Research",
    tagline: "自改进的 AI 智能体",
    description:
      "Nous Research 出品的自改进 AI 智能体，能从对话中持续学习，支持 Telegram / Discord / Slack 接入。通过官方脚本安装。",
    initials: "HE",
    category: "desktop-app",
    tags: ["编码智能体", "自学习", "官方脚本"],
    homepage: "https://github.com/NousResearch/hermes-agent",
    docs: "https://hermes-agent.nousresearch.com/",
  },
  {
    id: "trae",
    name: "Trae",
    vendor: "ByteDance",
    tagline: "字节的 AI 编程 IDE",
    description:
      "字节跳动的 AI 编程 IDE，原生支持 Claude / GPT 模型，面向中文开发者体验优化。桌面应用形态。",
    initials: "TR",
    category: "desktop-app",
    tags: ["IDE", "桌面应用", "中文"],
    homepage: "https://www.trae.ai",
    docs: "https://docs.trae.ai",
  },
  {
    id: "workbuddy",
    name: "WorkBuddy",
    vendor: "腾讯",
    tagline: "AI Agent 办公新范式",
    description:
      "腾讯出品的 AI Agent 办公助手。桌面应用形态，处理办公场景文档 / 协作 / 行程等任务。",
    initials: "WB",
    category: "desktop-app",
    tags: ["办公", "AI Agent", "桌面应用"],
    homepage: "https://www.workbuddy.cn",
    docs: "https://www.workbuddy.cn",
  },
];

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.id === id);
}
