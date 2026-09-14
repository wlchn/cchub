# 系统架构

## 进程模型

CCHub 是一个 **Tauri 2 双进程桌面应用**：

```
┌─────────────────────────────────────────────────────────────┐
│  WebView 进程（前端）                                        │
│  React 19 + Zustand + React Router（HashRouter）             │
│  src/                                                        │
└───────────────┬─────────────────────────────────────────────┘
                │  invoke("command", args) / listen("event")
                │  唯一通道：src/lib/ipc.ts
┌───────────────▼─────────────────────────────────────────────┐
│  主进程（Rust）                                              │
│  src-tauri/src/  —— 32 个 #[tauri::command]                  │
│  文件系统 / 子进程 / 网络 / 系统钥匙串                        │
└───────────────┬─────────────────────────────────────────────┘
                │  std::process::Command（不走 shell）
                ▼
   外部世界：npm registry、git 仓库、各 CLI、宿主配置文件、
             系统钥匙串、远端目录源
```

- **入口**：`src-tauri/src/main.rs` 仅调用 `cchub_lib::run()`；全部逻辑在
  `src-tauri/src/lib.rs` 的 `run()`。`main.rs` 用
  `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` 保证
  Windows release 构建不弹控制台窗口。
- **前端入口**：`src/main.tsx` 在首次渲染前同步调用 `initTheme()` 与 `initLocale()`，
  再用 `HashRouter` 挂载 `App`（Tauri 用 `tauri://` 协议提供前端，没有 history
  服务端，所以用 hash 路由）。

## 全局状态装配（`lib.rs::run`）

命令可用之前，有三份全局状态必须先就位：

| 状态 | 类型 | 装载时机 |
| --- | --- | --- |
| 偏好 | `prefs::PrefsState` | `setup` 中 `PrefsState::load(&app)` 并 `.manage()` |
| 代理快照 | `sys` 的 `OnceLock` | `sys::set_proxy_prefs(state.snapshot().proxy)` |
| 运行中任务 | `apps::RunningTasks` | `Builder::manage(RunningTasks::default())` |
| 目录缓存 | `catalog_source::CatalogState` | `Builder::manage(CatalogState::new())` |

代理快照之所以要在 `setup` 里显式注入，是因为**子进程构造**（`sys::shell_command`）
会读它 —— 任何 npm 子进程都要带着代理环境变量出生。

## 后端模块地图

```
src-tauri/src/
├── lib.rs              模块装配 + 命令注册 + setup
├── main.rs             Windows 子系统垫片
├── error.rs            结构化错误/提示串（err / note / io_failed）
├── sys.rs              PATH 解析、子进程构造、版本比较、代理环境变量
├── registry.rs         ★ 可安装应用 id 白名单（安全边界）
├── apps.rs             应用检测 / 安装 / 更新 / 卸载 + 任务事件
├── prefs.rs            偏好持久化（版本化 + 原子写 + diff 合并）
├── catalog_source.rs   远端目录源（白名单过滤 + 回落链 + 缓存）
├── providers.rs        ★ 供应商静态目录（keys/routes/前端唯一真值）
├── keys.rs             API Key 存系统钥匙串 + 探活
├── skills.rs           ★ Skill 源白名单 + 安装/启停/卸载
├── mcp.rs              MCP 服务目录 + 公共校验 + 握手测试
├── mcp/hosts.rs        三宿主 MCP 配置写入 adapter
├── routes.rs           路由预设存取 + 校验 + 下发调度 + 回读
└── routes/
    ├── host_claude.rs  ~/.claude/settings.json  env 段
    ├── host_codex.rs   ~/.codex/config.toml + auth.json
    └── host_gemini.rs  ~/.gemini/.env
```

带 ★ 的是**安全边界所在**：前端只能传 id，真值（npm 包名 / git URL / 供应商配置）
写死在这些常量表里。

### 命令面（共 32 个）

| 域 | 命令 |
| --- | --- |
| 应用 | `detect_apps` `detect_app` `detect_environment` `check_latest_version` `run_app_task` |
| 偏好 | `get_prefs` `set_prefs` |
| 目录源 | `get_catalog` `test_network` |
| Skill | `list_skills` `list_skill_sources` `install_skill` `set_skill_enabled` `uninstall_skill` |
| Key | `list_key_refs` `save_key` `delete_key` `reveal_key` `test_key` |
| 供应商 | `list_providers` |
| MCP | `list_mcp_services` `read_host_config` `write_mcp_service` `remove_mcp_service` `test_mcp_service` |
| 路由 | `list_routes` `save_route` `delete_route` `switch_route` `apply_routes` `clear_route` `probe_route` |

注册处：`lib.rs` 的 `invoke_handler(tauri::generate_handler![...])`。

## 前端模块地图

```
src/
├── main.tsx            挂载前定型主题/语言 → HashRouter
├── App.tsx             Sidebar + 路由表 + 全局 useLocale()
├── types/index.ts      ★ 前后端契约：镜像 Rust 结构体（每个接口注明对齐的 .rs 文件）
├── lib/
│   ├── ipc.ts          ★ 唯一 IPC 通道，含浏览器 mock 全量实现
│   ├── errors.ts       结构化错误码 → 词典翻译（describeError / describeNote）
│   ├── catalog.ts      内置目录展示元数据
│   ├── theme.ts        主题三段式
│   └── utils.ts        cn()（clsx + tailwind-merge）
├── i18n/               index.ts（初始化+类型化词典）/ locale.ts（落地）/ useLocale.ts（校正）
├── locales/            zh-CN.json / en-US.json（各 461 行，扁平化后键一一对应）
├── store/              6 个 Zustand store：apps catalog keys mcp routes skills
├── pages/              6 个页面：AppStore Skills Mcp ApiKeys Routes Settings
└── components/
    ├── ui/             shadcn/ui 原语（button card select switch badge ...）
    ├── layout/         Sidebar / PageHeader
    ├── AppCard.tsx     应用卡片（状态 + 操作 + 日志）
    ├── EnvironmentBanner.tsx
    └── TaskLogPanel.tsx
```

## IPC 通道：`src/lib/ipc.ts`

**所有**跨进程调用都收敛在这一个文件里，它同时是「真实 Tauri」与「浏览器 mock」
两套实现的分发器：

```ts
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
```

- 在 Tauri 中：动态 `import("@tauri-apps/api/core")` 的 `invoke` /
  `import("@tauri-apps/api/event")` 的 `listen`（**延迟加载**，浏览器下不引入 Tauri 包）。
- 在浏览器中（`pnpm dev`，无 Tauri 外壳）：返回内置 mock，状态用 localStorage 持久化
  （`MOCK_PREFS_KEY` / `MOCK_SKILLS_KEY` / `MOCK_KEYS_KEY` / `MOCK_ROUTES_KEY` /
  `cchub:mock-mcp-<host>` 等），事件用两个 `Set`（`mockListeners.log/finished`）模拟，
  `mockRunTask` 用 `setTimeout` 逐行推进 `TaskLog`、最后推 `TaskFinished`。

mock 数据**刻意覆盖真实会走的边界分支**：例如 `claude-code` 被 mock 成
Homebrew 安装的 non-managed 状态（走「不可 npm 操作」分支）、`workbuddy` 走
`installUrl` 官网跳转流程 —— 让浏览器里就能调到真实的 UI 分支。

### Result 序列化形状

Rust 的 `Result<T, String>` 经 Tauri 序列化成 `{ Ok: T }` / `{ Err: String }`。
`ipc.ts` 对 `test_network` / `test_key` / `probe_route` 三个返回 `Result` 的命令做
形状归一，转成前端的判别联合（如 `KeyTestResult = {kind:"ok"|"invalid"|"error"}`）。

### 结构化错误

Rust 命令返回的 `String` 错误**不是**给人看的文案，而是
`{"code": "...", "args": {...}}` 的 JSON 串（见 `error.rs`）。
`ipc.ts` 用 `errorCode()` 解析出 `code` 做**分支判断**（绝不按文案子串判断），
用 `describeError` / `describeNote` 做展示翻译。浏览器 mock 也用 `wireError(code, args)`
构造同格式串抛出，从而在浏览器模式下也验证「后端给码、前端查词典」这条链路。

## 数据流示例：安装一个应用

```
用户点「安装」
  └─ store/apps.ts::runTask(id, "install")
      └─ ipc.ts::runAppTask({ id, kind })            invoke
          └─ apps.rs::run_app_task(app, tasks, id, kind)
              ├─ registry::find(id)  查白名单拿 npm 包名
              ├─ RunningTasks::try_acquire(id)  防并发（失败 → appBusy）
              ├─ installable() 拦截 External 应用
              ├─ spawn_blocking → sys::shell_command("npm", [...])  注入代理
              │     ├─ emit("app-task-log", TaskLog)     ← 逐行流式
              │     └─ emit("app-task-finished", ...)
              └─ TaskSlot::drop 归还槽位（panic 也归还）
  ┌─ ipc.ts::listen("app-task-log") ────────┐
  └─> store/apps.ts 追加日志（上限 400 行）  │
  ┌─ ipc.ts::listen("app-task-finished") ───┘
  └─> store/apps.ts 用 describeNote/describeError 定型结果文案
```

## 文件与磁盘落点

| 内容 | 路径 | 定义处 |
| --- | --- | --- |
| 偏好 | `{app_config_dir}/prefs.json` | `prefs.rs` |
| 目录磁盘缓存 | `{app_config_dir}/catalog-cache.json` | `catalog_source.rs` |
| Key 元数据索引（无明文） | `{app_config_dir}/keys-index.json` | `keys.rs` |
| 路由预设 + 激活态 | `{app_config_dir}/routes.json` | `routes.rs` |
| Skill 安装目录 | `~/.claude/skills/` | `skills.rs` |
| 宿主配置文件备份 | `<宿主文件>.cchub.bak` | 各 host adapter |
| 宿主 managed 清单 | `<宿主文件>.cchub-managed` | 各 host adapter |
| 系统钥匙串条目名 | `cchub` 服务下 `provider/label` | `keys.rs` |

`{app_config_dir}` 在 macOS 为 `~/Library/Application Support/cchub/`，
Windows 为 `%APPDATA%\cchub\`。

## 三个贯穿全局的设计母题

1. **契约集中、单一真值**：供应商目录只在 `providers.rs` 定义一次（此前散在三处）；
   前后端类型契约只在 `src/types/index.ts` 描述一次；IPC 只在 `ipc.ts` 一处。
2. **写外部文件必须可逆**：只动自己的键/段（managed 清单）、写前备份、原子写。
   详见 [security.md](security.md)。
3. **文案从后端以「码」的形式流出**：后端只产出 `code + args`，翻译责任在前端，
   从而天然支持中英双语且不产生中文残留。详见 [frontend.md](frontend.md)。
