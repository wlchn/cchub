# CCHub 项目 Wiki

> 本 Wiki 由对代码库某个具体版本的静态分析生成（基线 `0298f87`），描述的是**代码中实际存在的实现**，而非规划。
> 与规划/排期的区别见 [docs/ROADMAP.md](../ROADMAP.md)。

CCHub 是一个开源的跨平台桌面应用（Tauri 2 + Rust + React），定位是
**「AI 桌面应用商店 + 本地 AI 工具管理平台」**：把散落在终端里的 AI 开发工具
收敛到一扇窗口里发现、安装、更新与配置。

支持 macOS 与 Windows。

---

## 目录

### 总览

| 页面 | 内容 |
| --- | --- |
| [architecture.md](architecture.md) | 系统架构：进程模型、模块地图、IPC 通道、数据流、文件落点 |
| [security.md](security.md) | 安全模型：id 白名单、命令注入防护、managed 清单、凭据处理不变量 |
| [frontend.md](frontend.md) | 前端架构：路由、Zustand store、IPC mock、主题与语言三段式 |
| [development.md](development.md) | 开发指南：环境要求、构建、测试、CI、扩展点 |

### 功能模块

| 模块 | 页面 | 一句话 |
| --- | --- | --- |
| App Store | [modules/app-store.md](modules/app-store.md) | 检测 / 安装 / 更新 / 卸载 7 个 npm CLI，识别 3 个外部应用 |
| Skill 管理 | [modules/skills.md](modules/skills.md) | 30 个白名单 Skill 源的浏览、安装、启停、卸载 |
| MCP | [modules/mcp.md](modules/mcp.md) | 9 个 MCP 服务的目录与向三大 CLI 宿主下发配置 |
| API Key | [modules/api-keys.md](modules/api-keys.md) | 凭据集中存入系统钥匙串，本地只留不含明文的索引 |
| 请求路由 | [modules/routes.md](modules/routes.md) | 多宿主多预设的供应商切换与配置下发、偏差回读 |
| 设置与基础设施 | [modules/settings-infra.md](modules/settings-infra.md) | 偏好存储、远端目录源、代理注入（M0/M1） |

---

## 一句话技术栈

| 层 | 选型 |
| --- | --- |
| 外壳 | Tauri 2 |
| 后端 | Rust 2021（edition 2021，`rust-version = 1.87`） |
| 前端 | React 19 + TypeScript 7 + Vite 8 |
| 样式 | Tailwind CSS 4 + shadcn/ui（neutral 主题，未做品牌化改动） |
| 状态 | Zustand 5 |
| 路由 | React Router 7（hash 模式） |

## 六个顶层页面

`/`（App Store）、`/skills`、`/mcp`、`/keys`、`/routes`、`/settings`。
导航定义在 `src/components/layout/Sidebar.tsx` 的 `NAV_ITEMS`，路由表在 `src/App.tsx`。

## 当前完成度

M0–M5 全部落地（基础设施 → 设置 → Skill → MCP → API Key → 路由），
六个页面均为可用状态。里程碑细节与后续排期见 [docs/ROADMAP.md](../ROADMAP.md)。

## 需要注意的两处文档漂移

以代码为准：

1. **Skill 安装源数量**：README 与 ROADMAP 写「33 个」，`src-tauri/src/skills.rs` 的
   `SKILL_SOURCES` 实际为 **30 条**（anthropics/skills 16 条 + obra/superpowers 14 条）。
2. **供应商可路由性**：文档把 provider 粗分为「可路由 6 家 / 仅 Key 管理 3 家」，
   实际 `ProviderInfo` 有**两个独立的方向字段** —— `anthropic_endpoint`
   （供 Claude Code）与 `gemini_endpoint`（供 Gemini CLI）。`google` 二者中只有
   `gemini_endpoint`，可路由到 Gemini CLI 但不能路由到 Claude Code。
