# CCHub

[English](README.md) | **简体中文**

开源的跨平台 AI 桌面应用商店，兼本地 AI 工具管理平台。用一个界面把散落在终端里的 AI 开发工具管起来：发现、安装、更新、配置。

支持 macOS 与 Windows。

![CCHub 应用商店界面](cchub-demo.png)

## 当前状态

首页（应用商店）已可用，其余模块为规划中的留白页，排期见 [docs/ROADMAP.md](docs/ROADMAP.md)。

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 应用商店 | ✅ 可用 | 检测 / 安装 / 更新 / 卸载 7 个 npm CLI，检测 3 个外部应用 |
| 基础设施 | ✅ 可用 | 偏好存储（版本化 + 原子写）、远端目录源（白名单过滤 + 缓存回落）、代理注入（M0） |
| 设置 | ✅ 可用 | 主题 / 语言 / 开机自启 / 启动行为 / 代理（含连通测试）/ 目录源 / 环境诊断（M1） |
| Skill 管理 | ✅ 可用 | 33 个 Skill 白名单安装源（官方 anthropics/skills 全量 + 社区 obra/superpowers），启停（.disabled）、卸载（防路径逃逸）（M2） |
| API Key | ✅ 可用 | 系统钥匙串存取（keyring）、连通测试、掩码显示（M4） |
| 路由 | ✅ 可用 | 供应商预设多套管理 + 一键切换下发；宿主：Claude Code（settings.json env + 模型档位映射）+ Codex（config.toml 的 model_providers + auth.json）+ Gemini CLI（~/.gemini/.env）；供应商目录 9 家；宿主实际配置回读与偏差提示（M5+） |
| MCP | ✅ 可用 | 9 个服务目录（官方 + Filesystem / Playwright / Context7 / Desktop Commander / Firecrawl），参数与 env 表单（@keychain: 引用）、三宿主写入（Claude Code / Codex / Gemini CLI，备份 + 只删自己的条目）、握手测试（M3+） |

### 首页能做什么

- 检测本机是否已安装目录中的应用，显示版本号与可执行文件路径
- 查询 npm registry 上的最新版本，有新版时给出更新入口
- 一键安装 / 更新 / 卸载（卸载有二次确认），npm 输出实时回显在卡片里
- npm 失败时把 `EACCES`、网络超时、`E404` 等常见原因翻译成可操作的提示
- 未检测到 Node.js 时禁用安装并引导先装环境
- 检测安装是否受 npm 管理：Homebrew / 官方脚本装的不提供 npm 操作，避免装出第二份

## 技术栈

| 层 | 选型 |
| --- | --- |
| 外壳 | Tauri 2 |
| 后端 | Rust 2021 |
| 前端 | React 19 + TypeScript 7 + Vite 8 |
| 样式 | Tailwind CSS 4 + shadcn/ui（neutral 默认主题，未做品牌化改动） |
| 状态 | Zustand 5 |
| 路由 | React Router 7（hash 模式） |

## 环境要求

开发：

- Node.js 20+（本项目在 24 上开发）与 pnpm 10+
- Rust 1.87+（`rustup` 安装；Tauri 2 当前依赖树需要 edition2024，低版本会编译失败）
- 平台依赖：
  - macOS：Xcode Command Line Tools（`xcode-select --install`）
  - Windows：Microsoft C++ 生成工具 + WebView2 运行时（Win11 已内置）

运行：macOS 12+ / Windows 10+。

## 快速开始

```bash
pnpm install
pnpm tauri:dev      # 启动桌面应用（首次会编译 Rust，需要几分钟）
```

只调 UI 时可以不带 Tauri 外壳跑，此时 IPC 走内置 mock 数据：

```bash
pnpm dev            # http://localhost:1420
```

打包：

```bash
pnpm tauri:build    # 产物在 src-tauri/target/release/bundle/
```

## 项目结构

```
├── src/                      前端
│   ├── components/
│   │   ├── ui/               shadcn/ui 基础组件（仅官方变体，无自定义配色）
│   │   ├── layout/           侧边栏与页头
│   │   ├── AppCard.tsx       应用卡片（状态 + 操作 + 日志）
│   │   └── ...
│   ├── pages/                五个一级页面
│   ├── store/apps.ts         Zustand store，聚合检测与任务状态
│   ├── lib/
│   │   ├── ipc.ts            与 Rust 的唯一通道（含浏览器 mock）
│   │   └── catalog.ts        应用目录的展示元数据
│   └── types/                与 Rust 结构对应的类型
├── src-tauri/                Rust 侧
│   └── src/
│       ├── registry.rs       可安装应用白名单
│       ├── apps.rs           检测 / 安装 / 卸载命令
│       └── sys.rs            PATH 解析、子进程构造、版本比较
└── scripts/generate-icon.mjs 零依赖生成应用图标
```

### 两个设计上的要点

**包名白名单在 Rust 侧。** 前端只能按 `id`（如 `claude-code`）请求操作，真正的 npm 包名在 `src-tauri/src/registry.rs` 里查表得到。前端无法把任意字符串拼进 `npm install`，命令注入在设计上就不成立。

**PATH 必须从登录 shell 里捞。** macOS 上从 Finder / Dock 启动的 `.app` 继承的 `PATH` 通常只有 `/usr/bin:/bin:/usr/sbin:/sbin`，nvm / homebrew / volta 装的 node 全都不在里面。`sys.rs` 会用 `$SHELL -ilc` 解析出用户真实的 `PATH` 并缓存，否则会出现「明明装了却检测不到」。设置页的「运行环境诊断」会把解析结果显示出来，便于排查。

## 添加一个新应用

1. 在 `src-tauri/src/registry.rs` 的 `APPS` 里加一条，写明 npm 包名与可执行文件名
2. 在 `src/lib/catalog.ts` 的 `CATALOG` 里加一条同 `id` 的展示元数据
3. 在 `src/types/index.ts` 的 `AppId` 里加上这个 id

## 测试

```bash
pnpm build                          # 类型检查 + 前端构建
cd src-tauri && cargo test          # Rust 单元测试（版本解析、白名单）
```

## 许可

MIT
