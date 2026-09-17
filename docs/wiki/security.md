# 安全模型

CCHub 会执行子进程、写用户的 CLI 配置文件、读写系统钥匙串 —— 这是一个高权限
的桌面工具。本文汇总代码中**实际存在**的安全不变量及其落点。

## 0. 威胁模型

CCHub 面对的主要风险不是远端攻击者，而是三条本地边界：

1. **前端不应能构造命令**。前端是 WebView 里的 JS，一旦能拼出
   `npm install <任意串>` 或 `git clone <任意 URL>`，注入即成立。防法是
   **所有可执行的真值写死在 Rust 常量表**，前端只传 `id`。
2. **不应破坏用户的既有配置**。宿主配置文件（`settings.json` / `config.toml` /
   `.env`）里有大量用户手写内容，覆盖式重写会静默销毁它们。
3. **明文凭据应尽量不落盘、不出跨进程边界**。

## 1. id 白名单是唯一安全边界

| 白名单 | 文件 | 内容 | 前端能传什么 |
| --- | --- | --- | --- |
| `APPS` | `registry.rs` | 10 条（7 npm + 3 external），含 npm 包名与可执行名 | 仅 `id` |
| `SKILL_SOURCES` | `skills.rs` | 30 条，含 git repo URL 与 subdir | 仅 `id` |
| `MCP_SERVICES` | `mcp.rs` | 9 条，含 command + args | 仅 `id` |
| `PROVIDERS` | `providers.rs` | 9 条，含端点与鉴权头型 | 仅 `id` |
| `MCP_HOSTS` | `mcp/hosts.rs` | 3 个宿主 id | 仅 `hostId` |
| `HOSTS` | `routes.rs` | 3 个宿主 id | 仅宿主 id |

`registry.rs` 的单元测试直接断言了这一点：

```rust
// registry.rs 测试：显式拒绝路径穿越与 shell 注入串
find("../../etc/passwd")        // → None
find("left-pad && rm -rf /")    // → None
```

### 远端目录不能提权

`catalog_source.rs` 允许从远端拉取展示元数据，但 `trusted()` 过滤器要求每个
远端条目的 `id` **必须命中 `registry::find`**，否则整条丢弃。远端目录可以下架
应用、改文案，但**不可能让一个未知 id 变成可安装**。测试覆盖了「丢弃未知 id」
与「丢弃路径穿越 id」两种情形。

## 2. 命令注入的结构性防御

### 2.1 子进程不走 shell

所有子进程都经 `sys::shell_command(program, args)` 构造，参数是**数组**而非拼接串：

- MCP stdio 服务：`command + args` 直接传 `Command`，不经过 shell。
- npm 操作：npm 参数在 `apps.rs::run_app_task` 里**写死**
  （`install -g {package}@latest --no-fund --no-audit`），`package` 取自白名单。
- git clone：URL 取自 `SKILL_SOURCES[id].repo`，前端拼不进去。

Windows 是唯一例外：跑 `.cmd` 批处理时需要 `cmd /C`（`sys.rs`），
但加 `CREATE_NO_WINDOW` 且参数同样来自白名单。

### 2.2 前端禁用的按钮，后端会再拦一次

前端把 External 应用的操作按钮换成「打开官网」，只是**提示**。服务端在
`run_app_task` 里用 `AppSpec::installable()` 再次拦截；对 non-managed 安装的
Update/Uninstall 返回 `appOutsideNpmGlobal` 错误（带 `hint` / `verb` 词典键）。
测试 `npm 可装 / External 不可装` 覆盖了这条。

### 2.3 卸载 Skill 前的路径逃逸校验

`skills.rs::ensure_under_root` 先 `canonicalize` 再对 skills 根做前缀比较，
拒绝 `../` 逃逸（错误码 `pathOutsideSkills`）。启停与卸载前均调用。测试
`escapes_are_rejected_by_ensure_under_root` 覆盖。

## 3. 写宿主配置的通用协议

三处写宿主的代码（`mcp/hosts.rs`、`routes/host_*.rs`）遵循同一套约定：

```
1. 解析现有文件（失败 → 拒绝写入，绝不覆盖）
2. 读 managed 清单，只删除「CCHub 自己写过的」键/段
3. 写入新值，更新 managed 清单
4. 写前备份为 <文件>.cchub.bak
5. 原子写（tmp + rename；Windows rename 失败回落直写）
```

### managed 清单：只删自己写的

每个被写文件旁边有一个 `<文件>.cchub-managed` 清单，记录 CCHub 写过哪些条目。
`remove_*` 先查清单，非自己写的返回 `hostEntryNotManaged`，**用户手写条目永不触碰**。

具体到各宿主：

| 宿主 | 文件 | 只管这些 | 显式保护 |
| --- | --- | --- | --- |
| Claude Code (MCP) | `~/.claude.json` | `mcpServers` 段内自己写的条目 | 顶层/段非对象 → `refuseWriteTopLevel` / `refuseWriteSection` |
| Codex (MCP) | `~/.codex/config.toml` | `[mcp_servers.*]` 自己写的条目 | toml_edit 保格式，用户 marketplaces/plugins 与注释原样保留 |
| Gemini CLI (MCP) | `~/.gemini/settings.json` | `mcpServers` 段内自己写的条目 | 同 Claude Code |
| Claude Code (路由) | `~/.claude/settings.json` | `env` 段内 `MANAGED_KEYS` 5 个键 | 用户手写的 `ANTHROPIC_DEFAULT_FABLE_MODEL` 等映射键不在集合内，永不动 |
| Codex (路由) | `~/.codex/config.toml` | 顶层 `model_provider`/`model` + `[model_providers.cchub_*]` | 仅当 `model_provider` 指向 `cchub_` 前缀才删；用户自有 provider 组合保留 |
| Codex (路由) | `~/.codex/auth.json` | 仅 `OPENAI_API_KEY` 字段 | **OAuth `tokens` / `auth_mode` / `last_refresh` 永不触碰**；解析失败直接报错拒绝写入，防丢登录态 |
| Gemini CLI (路由) | `~/.gemini/.env` | `GEMINI_API_KEY` + `GOOGLE_GEMINI_BASE_URL` 两行 | 逐行编辑，用户其他行 / 注释 / 畸形行 / 带引号值原样保留 |

### 路由下发的额外校验（`routes.rs::validate`）

- `base_url` 必须以 `https://` 开头（`baseUrlNotHttps`）
- `key_ref` 必须是 `@keychain:` 前缀（`keyRefFormat`）
- Claude Code 预设要求供应商有 `anthropic_endpoint`
- Gemini CLI 预设要求供应商有 `gemini_endpoint`
- Codex 预设必须有 `model`
- 模型映射不得为空白（`rejects_blank_model_mapping`）

### 偏差检测（drift）

`list_routes` 会**回读宿主文件的实际生效值**（base URL / key 指纹 / 模型映射），
与激活预设比对。不一致时前端显示「配置偏差」徽章并提供一键重新下发。这防的是
「用户或其它工具外部手改了配置，UI 与实际脱节」——只对比 CCHub 管理的键，
用户手写的键不算偏差。

## 4. 凭据处理不变量

`keys.rs` 的安全设计：

- **明文只在两个出口出现**：`reveal_key` 命令（用户主动点「显示」）与
  `reveal_key_sync`（写宿主配置时经 `mcp::resolve_env_value` 展开 `@keychain:` 引用）。
- **本地索引不含明文**：`keys-index.json` 只有 `{provider, label, added_at}`。
- **无「导出全部」功能**，不落任何明文文件。
- 索引写用 tmp + rename 原子替换；索引损坏时回落默认值（钥匙串才是真值，可对账）。
- `entry_name` 把 label 里的 `/` `\` 换成 `_`，防条目名歧义。
- 前端 `store/keys.ts` 的 `reveal` 在 10 秒后**自动恢复掩码**，明文不常驻 UI。

## 5. 网络

- `catalog_source.rs::http_agent` 强制 `https_only(true)`，全局 10s 超时，
  按偏好注入 `ureq::Proxy`。
- Skill 安装只接受 `https://` 的 repo（`install_skill` 校验 + `skillSourceNotHttps`，
  测试 `all_sources_are_https` 覆盖）。
- 代理注入（`sys::proxy_envs`）：显式 url → 注入 `HTTP_PROXY`/`HTTPS_PROXY`（含小写）；
  `use_system` → 继承已有变量；`NO_PROXY` 始终生效并把 `;` 换成 `,`（npm 约定）。

## 6. WebView 加固

- CSP（`tauri.conf.json` 与 `index.html` 双处一致）：
  `default-src 'self'; script-src 'self'`，无 `unsafe-inline` 脚本。
  因此**不能用 index.html 内联脚本打主题标记** —— 主题必须由 JS 在挂载前同步设置。
- Tauri capability（`src-tauri/capabilities/default.json`）是最小集：
  `core:default` + 窗口拖拽 + `opener:allow-open-url`（限 `https://*`）+ autostart 三命令
  + `window-state:default`（只用于恢复窗口位置尺寸，不读窗口内容）。
  没有引入 shell 插件 —— 子进程全走 `std::process::Command`。
- 外链走 `plugin-opener` 的系统浏览器，不在 webview 内导航外部站点。

## 7. 健壮性设计（防「假成功」与死锁）

- **`managed` 三分态**：`is_npm_managed` 拿不到 npm 前缀时返回 `None`（未知），
  `apps.rs` 按 `true` 处理 —— 宁可操作报错，也不把正常安装误标为外部安装。
- **并发防重**：`RunningTasks::try_acquire` → `appBusy`；`TaskSlot` 用 `Drop`
  保证 panic 或提前 return 也归还槽位，避免 UI 永久卡在「处理中」。
- **子进程管道**：stderr 单独线程读取，防管道写满卡死子进程。
- **`spawn_blocking` 隔离**：子进程/网络在阻塞线程池执行，join 失败返回 `Err`
  而不是 panic。
- **锁污染恢复**：`unwrap_or_else(|e| e.into_inner())` 从 poisoned 锁恢复。
