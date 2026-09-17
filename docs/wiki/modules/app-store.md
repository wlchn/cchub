# 模块 · App Store（应用商店）

> 首页 `/`。检测、安装、更新、卸载本地 AI 开发工具。

## 职责

CCHub 的起点：把散落在终端里的 AI CLI 与桌面应用收敛成卡片，显示「装没装、
什么版本、能不能被 CCHub 管」，并就地完成 npm 类操作。

## 目录内容

`registry.rs` 的 `APPS` 共 10 条，分两类来源：

**npm 可安装（7 个）** —— `AppSource::Npm { package }`，`installable() == true`：

`claude-code`、`codex`、`gemini-cli`、`grok-build`、`opencode`、`openclaw`、`pi`

**外部应用（3 个）** —— `AppSource::External { install_url, mac_app_name }`，
`installable() == false`，前端只提供「打开官网」：

`hermes`、`trae`、`workbuddy`

```rust
pub struct AppSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub source: AppSource,
    pub bin: &'static str,          // 可执行文件名
    pub version_args: Option<&'static [&'static str]>,
}
```

展示元数据（initials / vendor / tagline / description / category / tags /
homepage / docs）另在 `src/lib/catalog.ts` 的 `CATALOG` 里，按同一 `id` 关联。
`category` 为 `cli-agent`（安装/卸载类）或 `desktop-app`（只能跳官网）。

## 命令

| 命令 | 作用 |
| --- | --- |
| `detect_apps()` | 批量检测全部应用 |
| `detect_app(id)` | 单个检测 |
| `detect_environment()` | OS / arch / node / npm 版本与路径 / 解析出的 PATH |
| `check_latest_version(id)` | 查 npm registry 最新版，判断有无更新 |
| `run_app_task(app, tasks, id, kind)` | 执行 install / update / uninstall |

### 返回结构

```rust
pub struct AppStatus {
    pub id, installed, version, path,
    pub managed: bool,            // 是否 npm 全局安装（能否被 CCHub 管理）
    pub external_hint: Option<String>,  // managed=false 时推断的来源，如 "Homebrew"
    pub install_url: Option<String>,    // External 应用的官网
}
```

## 关键设计

### `managed` 区分是核心

同一个 CLI 可以由 npm、Homebrew、官方安装脚本等多种方式装上。对非 npm 安装：

- `npm uninstall -g` 会「成功」但什么都没删（**假成功**）
- `npm install -g` 会装出**第二份**，造成 PATH 冲突

所以 `AppStatus.managed` 必须准确。`sys::is_npm_managed(path)` 通过
`npm prefix -g` 拿到全局目录做前缀比较；**拿不到前缀时返回 `None`（未知）**，
`apps.rs` 按 `true` 处理 —— 宁可操作时报错，也不把正常安装误标为外部安装。

`managed == false` 时前端隐藏 npm 操作按钮，改为展示 `externalHint`
（来源推断来自 `sys::guess_install_source`，返回 `notes.*` 词典键）。

### 检测：`which` 命中不算已安装

`status_of_npm` / `status_of_external` 不会只凭 `which` 就判定已安装 ——
还会**真实跑一次版本命令**。版本号可能出现在 stderr，`sys::extract_version`
负责从输出里提取（跳过 token 中间的版本片段，保留 `-beta` 等预发布后缀）。

### 服务端二次拦截

前端把 External 应用的操作按钮换成「打开官网」只是提示。`run_app_task` 里
用 `installable()` 再次拦截；对 non-managed 的 Update/Uninstall 返回
`appOutsideNpmGlobal` 错误（带 `hint` / `verb` 词典键）。

### 参数写死，不来自前端

npm 参数在 `run_app_task` 里硬编码：

```
install -g {package}@latest --no-fund --no-audit
```

其中 `package` 查自 `registry.rs` 白名单。**前端只能传 `id`**，
命令注入结构上不成立。详见 [../security.md](../security.md)。

### 并发防重

`RunningTasks::try_acquire(id)` 抢槽位，失败返回 `appBusy`。槽位用 `TaskSlot`
的 `Drop` 实现归还 —— 即使 panic 或提前 return 也会归还，避免 UI 永久卡在
「处理中」。

### 子进程执行细节（`sys.rs`）

- 统一置 `NPM_CONFIG_COLOR=false`、`NO_COLOR=1`、`stdin=null`
- 注入代理环境变量（`sys::proxy_envs`）
- **stderr 单独线程读取**，防管道写满卡死子进程
- 在 `spawn_blocking` 中执行，join 失败返回 `Err` 而非 panic

### 失败诊断

`diagnose_failure` 把常见 npm 失败翻译成可操作的中文提示并映射为词典键：

| npm 错误 | 提示方向 |
| --- | --- |
| `EACCES` | 权限问题 |
| `ENOTFOUND` | 网络 / DNS |
| `EBADENGINE` | Node 版本不符（提示 `nvm alias default`） |
| 其他 | 兜底抛 npm 最后一条 `npm error` 行 |

## 事件流

长任务通过两个 Tauri 事件推进度（前端 `store/apps.ts` 消费）：

- `app-task-log` → `TaskLog { id, line, stream: "stdout"|"stderr"|"info" }`，
  逐行流式；前端日志缓冲上限 400 行
- `app-task-finished` → `TaskFinished { id, success, message }`

## 前端

- 页面：`src/pages/AppStore.tsx`；卡片：`src/components/AppCard.tsx`；
  环境横幅：`src/components/EnvironmentBanner.tsx`；日志面板：`TaskLogPanel.tsx`
- store：`src/store/apps.ts`
- 搜索用 `useMemo` 匹配 name / vendor / tagline / description / tags
- 页面底部**如实显示目录来源**（remote / cache / builtin），不掩盖回落

`EnvironmentBanner` 处理两种情况：npm 缺失、Node 版本过旧
（`MIN_NODE_MAJOR = 18`）—— 都只提示不拦截。
