# 开发指南

## 环境要求

- **Node.js 20+**（本项目在 24 上开发）与 **pnpm 10+**
- **Rust 1.87+**（用 `rustup` 装）。Tauri 2 当前依赖树需要 edition2024，
  更早的版本编译不过。（`Cargo.toml` 里写的 `rust-version = 1.77.2` 是保守下限）
- 平台依赖：
  - macOS：Xcode Command Line Tools（`xcode-select --install`）
  - Windows：Microsoft C++ Build Tools + WebView2 运行时（Win11 自带）

**运行环境**：macOS 12+ / Windows 10+。

## 常用命令

```bash
pnpm install

pnpm tauri:dev      # 启动桌面应用（首次编译 Rust 需数分钟）
pnpm dev            # 只跑前端 http://localhost:1420，IPC 走内置 mock
pnpm tauri:build    # 打包，产物在 src-tauri/target/release/bundle/
pnpm build          # tsc --noEmit && vite build

pnpm check:locales  # 校验 zh-CN / en-US 词典键与占位符一致
pnpm test:messages  # 后端消息 → 界面文案的翻译链路测试

cd src-tauri && cargo test   # Rust 单元测试
```

### 只做 UI 时不必起 Tauri

`pnpm dev` 下 `lib/ipc.ts` 自动降级到 mock（localStorage 持久化），
可覆盖绝大多数 UI 分支。详见 [frontend.md](frontend.md) 的 mock 设计原则。

## 测试

| 层 | 命令 | 覆盖内容 |
| --- | --- | --- |
| 类型检查 | `pnpm build` | `tsc --noEmit`；**同时兜住 i18n** —— 词典类型化，拼错键/漏加键在此阶段报错 |
| 词典一致性 | `pnpm check:locales` | 扁平化比对两份词典的缺失键、多余键、`{{占位符}}` 一致性 |
| 消息链路 | `pnpm test:messages` | 结构化解析、保留参数二次翻译、未知码回落、非结构化原样透传（中英各跑一遍） |
| Rust | `cargo test` | 见下 |

Rust 单测集中在纯函数与解析逻辑上，覆盖面较广，包括：

- `registry.rs`：拒绝未知 id / 路径穿越 / 注入串；id 唯一；npm 可装、External 不可装
- `prefs.rs`：roundtrip、损坏 JSON / 未知版本 → 重建、TTL 越界夹取、diff 合并不覆盖未提及字段
- `catalog_source.rs`：解析、丢弃未知 id、全未知即失败、畸形 JSON、缺必填字段
- `skills.rs`：frontmatter 解析（合法/缺 name/未闭合）、源 id 唯一、全 https、
  只信任预期仓库、subdir 路径安全、路径逃逸拒绝
- `keys.rs`：provider roundtrip、目录与 enum 一一对应、条目名 sanitize、鉴权头拼装、RFC3339 形状
- `mcp.rs`：服务 id 唯一、camelCase 序列化契约、keychain 引用解析、
  `write_removes_only_managed`、`~` 展开、required env 声明
- `mcp/hosts.rs`：Codex MCP 段编辑保留用户内容、同名原位覆盖、三宿主覆盖
- `routes.rs`：validate 全分支（Codex 必填 model / 无兼容端点拒绝 / 空白映射拒绝 /
  非 https 拒绝 / 裸 key_ref 拒绝 / 未知宿主拒绝）、legacy 反序列化
- `routes/host_codex.rs`：写 provider 段、清除只删自己的、保留用户自有
  `model_provider`、切换替换、auth.json 只动 `OPENAI_API_KEY`
- `routes/host_gemini.rs`：追加 / 原位替换 / 清除只删自己 / 畸形行不动 / keychain 展开
- `error.rs`：**敌对参数不撑破 JSON**（引号、中文、换行、`a|b:c`、反斜杠）

`apps.rs` 有一个 `#[ignore]` 的机器相关测试，用于打印本机真实检测结果：

```bash
cd src-tauri && cargo test -- --ignored --nocapture
```

## CI（`.github/workflows/ci.yml`）

两个并行 job，均跑 Ubuntu：

- **frontend**：`pnpm install --frozen-lockfile` → `check:locales` → `test:messages`
  → `build`（pnpm 版本显式钉 10；Node 22）
- **rust**：装 Tauri 的 Linux 系统依赖（webkit2gtk 等）→ `cargo test`
  （`Swatinem/rust-cache` 缓存，workspaces 指向 `src-tauri`）

CI **不按分支过滤**（push / PR / 手动触发都跑），用 concurrency 取消同分支的旧运行。
Windows 侧矩阵尚未补 —— 见文末待办。

## 扩展点

### 加一个新应用（App Store）

1. 在 `src-tauri/src/registry.rs` 的 `APPS` 加一条：npm 包名 + 可执行名
2. 在 `src/lib/catalog.ts` 的 `CATALOG` 加同 `id` 的展示元数据
3. 在 `src/types/index.ts` 的 `AppId` 联合类型里加这个 id

外部应用（Homebrew / 桌面 App）用 `AppSource::External`，带 `install_url` 与
`mac_app_name`，`installable()` 自动为 false，前端会走「打开官网」分支。

### 加一个 Skill 源

在 `src-tauri/src/skills.rs` 的 `SKILL_SOURCES` 加一条（id / name / category /
repo / subdir）。注意：repo 必须 https；subdir 不得是绝对路径或含 `..`；
仓库布局支持单 Skill 与 monorepo 多子目录自适应。

### 加一个 MCP 服务

在 `src-tauri/src/mcp.rs` 的 `MCP_SERVICES` 加一条：command + args +
`arg_specs`（位置参数）/ `env_specs`（环境变量模板，含 `required` 标记）。
需要密钥的 env 支持 `@keychain:provider/label` 引用，写入宿主时从钥匙串展开。

### 加一个路由宿主（CLI adapter）

参照 `src-tauri/src/routes/host_gemini.rs` 的模式：
实现 `read_state` + `apply(Option<&RouteRule>)`，在 `routes.rs` 的 `HOSTS`
和 `mcp/hosts.rs` 的 `MCP_HOSTS` 注册。三条硬性约定必须遵守
（见 [security.md](security.md) 第 3 节）：managed 清单只删自己写的、写前备份、
解析失败拒绝写入而非覆盖。

### 加一个供应商

在 `src-tauri/src/providers.rs` 的 `PROVIDERS` 加一条，声明：
`anthropic_endpoint`（能否路由到 Claude Code）、`gemini_endpoint`（能否路由到
Gemini CLI）、探活端点 / 头型 / 方式 / 推荐模型。前端经 `list_providers` 自动带出，
**无需改前端**。测试 `legacy_ids_still_present` 要求原有 5 家的 id 不能丢
（钥匙串条目前缀依赖它们）。

### 加一个后端错误码

1. Rust 侧用 `error::err("myCode", args)` 或 `error::note("myNote", args)` 返回
2. `src/locales/zh-CN.json` 与 `en-US.json` 的 `errors` / `notes` 节各加一条
3. `pnpm check:locales` + `pnpm build` 会兜住漏加

## 已知待办

- **Windows 专项验证**：`where` / `cmd /C` 路径解析、Credential Manager 行为
- **CI Windows 矩阵**：当前仅 Ubuntu 单平台
- **CLI 输出格式兼容性**：`sys::extract_version` 是模式匹配，依赖真实安装回归
- **前端 header 复用**：Skills / Mcp / ApiKeys / Routes 内联复制了 sticky header，
  可统一到 `PageHeader`
- **文档与代码漂移**：README / ROADMAP 的 Skill 源数量（33）与代码（30）不一致
- **MCP / Skill 目录接远端目录源**：复用 M0.2 的机制（白名单仍是安装边界）
