# CCHub 路线图

> 状态基准：M0-M5 全部落地（2026-09）；M5 阶段一扩展（多宿主 + 供应商预设切换）已落地（2026-09）。
> 本文档是开发排期依据；每个里程碑独立可交付，按依赖顺序排列。

## 全景

| 里程碑 | 模块 | 一句话 | 依赖 |
| --- | --- | --- | --- |
| M0 | 通用基础设施 | 偏好存储、远端目录源、代理 | 无 ✅ 已完成 |
| M1 | 设置 | 偏好项 + 已有环境诊断 | M0 ✅ 已完成 |
| M2 | Skill 管理 | 浏览 / 安装 / 启停本地 Skill | M0 ✅ 已完成 |
| M4 | API Key | 凭据集中存入系统钥匙串 | 无 ✅ 已完成 |
| M3 | MCP | MCP 服务发现与配置下发 | M0、M4（凭据）✅ 已完成 |
| M5 | 请求路由 | 多宿主多预设供应商切换（配置下发） | M4 ✅ 已完成 |

M4（API Key）不依赖任何前置，可提前；M3 需要 M4 的钥匙串能力存放 MCP 服务的
鉴权信息。M0 是所有模块的公共底座，优先做。

---

## M0 · 通用基础设施 ✅

不做界面，做三件后面所有模块都要用的东西。已全部落地：

- `src-tauri/src/prefs.rs` —— 版本化偏好（schema_version=1），原子写 + diff 合并，
  命令 `get_prefs` / `set_prefs`；损坏 / 版本未知整份回落默认重建
- `src-tauri/src/catalog_source.rs` —— 远端目录源（ureq，HTTPS only，10s 超时，
  走偏好代理），条目按白名单过滤（未知 id 整条丢弃），磁盘缓存 + TTL，
  回落链 远端 → 缓存 → 内置；命令 `get_catalog` / `test_network`
- `src-tauri/src/sys.rs` —— `proxy_envs()` 按偏好生成代理环境变量，
  `shell_command` 注入给所有 npm 子进程；启动时从 prefs 装载全局代理快照
- 前端 `store/catalog.ts` —— 目录 + 偏好的 Zustand store，远端条目与内置
  条目按字段合并（远端优先、builtin 兜底），页脚显示目录来源

### 0.1 偏好存储（Rust）

- 新增 `src-tauri/src/prefs.rs`：读写 `~/Library/Application Support/cchub/prefs.json`
  （Windows：`%APPDATA%\cchub\prefs.json`）
- 结构版本化（`schema_version` 字段），迁移策略：读不到已知版本就从头建，不猜
- 命令面：`get_prefs` / `set_prefs(diff)`，diff 合并而非整包覆盖，避免多窗口竞态
- 内容（M1 消费）：主题、语言、启动行为、自动检查更新、代理设置、各模块缓存

### 0.2 远端目录源

- 现状：应用目录硬编码在 `registry.rs`（安全白名单，保留）+ `catalog.ts`（展示元数据）
- 目标：展示元数据走远端 JSON（GitHub raw / 静态 CDN），Rust 白名单只保留
  「哪些 id 允许 npm 安装」；远端目录可以下架应用、改文案，但不能提权
- 校验：远端条目的 `id` 必须在白名单内，否则整条丢弃——白名单仍然是安全边界
- 网络失败时回落到内置目录，卡片正常显示，只是文案可能旧

### 0.3 网络代理

- `npm view` / 目录源请求统一走 `prefs` 里的代理设置
- 子进程侧：给 `sys::shell_command` 注入 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量
- 目录源请求侧：reqwest client 带 proxy（新增依赖时注意锁版本）

**验收**：改代理设置后 `npm view` 走代理；拔网线启动应用不白屏。（已达成：代理注入、回落链、白名单过滤均有单测覆盖，`test_network` 命令可在线验证连通性）

---

## M1 · 设置 ✅

把「应用偏好」卡片从规划中做出来。已全部落地：

| 项 | 形态 | 落点 |
| --- | --- | --- |
| 主题 | 跟随系统 / 浅色 / 深色 三选 | `theme.ts`（localStorage 缓存无闪启动 + prefs 校正）|
| 语言 | 中 / 英双语（界面 + 后端消息全量） | `prefs.locale` → `i18n/`，切语言即时生效 |
| 启动行为 | 开机自启开关 | `tauri-plugin-autostart`（LaunchAgent）|
| 启动时检测 | 开关 | `bootstrap(behavior)` 门控 |
| 启动时检查更新 | 开关 | 同上 |
| 代理 | HTTP(S) 代理地址 + 直连列表 + 跟随系统 + 测试按钮 | M0.3 |
| 目录源 | 远端地址 + 缓存 TTL + 当前来源展示 | M0.2 |

- 主题三段式：`initTheme`（挂载前，localStorage 缓存）→ `syncTheme`（prefs 加载后校正）→
  `applyTheme`（设置页切换，立即生效）；跟随系统模式下系统切换实时跟随
- 行为门控：`bootstrap` 等偏好到位再跑（AppStore useEffect 依赖 prefs），
  `detectOnLaunch=false` 跳过首屏检测，`checkUpdatesOnLaunch=false` 跳过启动查版本；
  手动刷新按钮不受影响
- 设置页卡片：外观 / 行为 / 网络 / 目录源 / 环境诊断；开关类即时保存（diff），
  输入框失焦保存；代理改动自动重拉目录
- 语言三段式与主题同构：`initLocale`（挂载前，localStorage 缓存）→ `useLocale`
  （prefs 加载后校正）→ `applyLocale`（设置页切换）。**不用** i18next 的浏览器
  语言探测 —— 语言只由 `prefs.locale` 单一驱动，多一个真值源只会让「选了英文却
  还是中文」难查
- **后端消息也双语化**：Rust 的错误与操作反馈统一返回结构化串
  （`{"code":..,"args":..}`，见 `src-tauri/src/error.rs`），前端 `lib/errors.ts`
  按 `code` 查词典。`Result<T,String>` 签名不变，30 个命令无需改；参数里的引号、
  中文、换行由 serde_json 转义，不会被撑破
  - 错误 → `errors.*`；状态与操作反馈 → `notes.*`
  - 保留参数名会在插值前二次翻译：`op`→`op.*`、`label`→`fields.*`、
    `hint`→`notes.*`、`verb`→`verb.*`
  - 解析失败或词典缺码一律回落原文，绝不会让用户看到空白或裸露的键名
- 目录内容（应用/Skill 描述、分类标签、MCP 服务定义）**不翻译** —— 属内容层，
  与界面文案是两回事；Skill 分区标题是例外（前端只译显示、匹配仍用后端原值）

**验收**：切主题立即生效且重启保持；设代理后 npm 类操作经代理出网；
切语言界面即时切换，英文下包含后端报错在内的文案无中文残留。

---

## M2 · Skill 管理 ✅

Skill 是给编码智能体加装的能力包，本模块管「找到 + 装好 + 管住」。已落地：

- `src-tauri/src/skills.rs` —— 安装源白名单（`SKILL_SOURCES`，id 查表得 git URL，
  前端拼不进地址）、git 仅 https + `--depth 1` 浅克隆 + 走代理、frontmatter 解析
  （serde_yaml，name 必填）、`.disabled` 后缀软禁用、卸载前 canonicalize 前缀校验
  防逃逸、仓库布局自适应（单 Skill / monorepo 多子目录）、跨设备 rename 回落复制
- 目录来源（两个经过克隆验证的仓库，共 33 个 Skill）：
  - anthropics/skills（官方，19 个全量，布局已改为 `skills/<name>` 平铺）：
    文档（docx/xlsx/pptx/pdf）、设计（frontend-design/brand-guidelines/
    theme-factory/canvas-design/algorithmic-art）、工程（mcp-builder/
    skill-creator/webapp-testing/web-artifacts-builder/claude-api）、
    写作（internal-comms/doc-coauthoring）
  - obra/superpowers（社区最火的工程方法论合集，14 个）：brainstorming、
    writing/executing-plans、TDD、systematic-debugging、verification、
    code-review 收发、subagent/parallel-agents、git-worktrees、分支收尾等
- 命令：`list_skills` / `list_skill_sources` / `install_skill` /
  `set_skill_enabled` / `uninstall_skill`
- 前端 Skills 页：已安装列表（启停开关乐观更新 / 删除确认弹窗 / 路径展示）+
  可安装目录按分类分组（文档 / 工程 / 设计 / 写作）
- 单测：frontmatter 合法/缺 name/未闭合、源 id 唯一、全 https、
  源仓库白名单（只信任两个仓库）、subdir 路径安全（禁绝对路径与 `..`）、
  路径逃逸拒绝

**验收**：装一个真实社区 Skill → 列表出现 → 禁用后 Claude Code 里不可见 → 删除后目录干净。（安装路径已通过编译与单测；真实安装需用户在 UI 触发）

---

## M3 · MCP ✅（多宿主扩展）

MCP（Model Context Protocol）配置的「商店 + 写入器」。已落地（三宿主）：

- **宿主 adapter**（`src-tauri/src/mcp/hosts.rs`）：
  - Claude Code —— `~/.claude.json` 的 `mcpServers` 段（JSON）
  - Codex —— `~/.codex/config.toml` 的 `[mcp_servers.*]` 段（toml_edit 保格式，
    用户手写的 marketplaces / plugins 段与注释原样保留）
  - Gemini CLI —— `~/.gemini/settings.json` 的 `mcpServers` 段（JSON，
    [官方格式](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/tutorials/mcp-setup.md)
    经源码确认）
  - 每宿主一份 managed 清单（`<文件>.cchub-managed`，只删自己写的条目）、
    写前备份 `.cchub.bak`
- **公共能力**（`src-tauri/src/mcp.rs`）——stdio 服务结构化 command+args
  （spawn 不走 shell，命令注入不成立）、initialize 握手测试（JSON-RPC 行协议，
  60s 超时容纳 npx 首次下载）、`resolve_env_value` 展开 `@keychain:` 引用
  （M5 复用）、`expand_home` 展开 `~` 路径
- 内置目录 9 个（npm 包名全部经 registry 验证）：
  - 官方参考实现：fetch（uvx mcp-server-fetch）、memory、everything、
    sequential-thinking（npx）
  - 热门通用：filesystem（允许访问目录参数）、playwright（@playwright/mcp）、
    context7（@upstash/context7-mcp，可选 API key env）、desktop-commander
    （@wonderwhy-er/desktop-commander，作者改名后的新包名）、firecrawl
    （必填 FIRECRAWL_API_KEY env）
- 服务声明 `arg_specs`（位置参数）与 `env_specs`（环境变量模板，含 required 标记）；
  `write_mcp_service` 接受参数化覆盖：args 追加在默认值后、env 支持
  `@keychain:` 引用（写入宿主时从钥匙串展开）、路径 `~` 展开
- 命令（全部带 hostId 参数）：`list_mcp_services` / `read_host_config(host_id)` /
  `write_mcp_service(host_id, id, request)` / `remove_mcp_service(host_id, id)` /
  `test_mcp_service(id)`
- 前端 Mcp 页：三宿主当前配置卡（CCHub 管理 / 手动配置徽章，手写条目只读）、
  服务目录（写入目标宿主下拉选择 + 需要参数的服务展开内联表单：参数输入 /
  env 掩码输入 / 必填校验）、握手测试 / 在线状态徽章、移除确认弹窗
- **路由预设测速**（M5+）：`probe_route` 命令按预设的 base_url + key 实发
  探活（与 test_key 的区别：用预设配置而非目录默认），前端预设行 Gauge 按钮
  + 延迟徽章（ok/无效/不通三态）

**验收**：给任一宿主添加 stdio MCP 服务 → 对应 CLI 的配置文件出现该条目 →
在 CCHub 里删除后该条目消失、用户手写的其他条目原封不动。（mock 路径已验证
三宿主写入/删除/选择；真机下发需用户在 UI 触发）

---

## M4 · API Key 管理 ✅

先把凭据管起来，M3 / M5 都依赖它。已落地：

- `src-tauri/src/keys.rs` —— keyring v4（macOS Keychain / Windows Credential
  Manager / Linux Secret Service），服务名 `cchub`、条目 `provider/label`；
  本地只存元数据索引（`keys-index.json`，不含 key 值）；provider 白名单
  （anthropic / openai / google / xai / openrouter）各带探活端点与鉴权头型；
  `test_key` 走偏好代理（与目录源同一 HTTP agent 策略）；幂等删除
  （钥匙串无条目不算错）；RFC3339 时间戳（civil 算法，不引 chrono）
- 命令：`list_key_refs` / `save_key` / `delete_key` / `reveal_key`（用户主动显示）/
  `test_key`
- 前端 ApiKeys 页：按 provider 分组、添加（type=password 输入）、
  测试连通（延迟徽章 / 无效 / 失败三态）、显示明文（10 秒自动恢复掩码）、
  删除确认弹窗
- 安全不变量：明文只在 `reveal_key` 与写宿主配置（M3/M5）两个出口出现；
  无「导出全部」功能；不落任何明文文件

**验收**：存的 key 在 macOS 钥匙串.app 里可见（`cchub` 条目）；删除后钥匙串里同步消失。

---

## M5 · 请求路由 ✅（阶段一扩展：多宿主 + 供应商预设切换）

让「哪个应用的请求走哪个供应商 / 什么 base URL」可视化。已落地（对标 cc-switch 的
核心体验：多套供应商配置 + 一键切换）：

- **供应商目录**（`src-tauri/src/providers.rs`）——9 家白名单统一真值，前端经
  `list_providers` 拉取，消除此前 keys.rs / ApiKeys.tsx / RouteCard.tsx 三处手动同步；
  可路由（Anthropic 兼容端点）：anthropic、openrouter、glm（bigmodel.cn）、deepseek、
  kimi（moonshot）、minimax；仅 Key 管理：openai、google、xai。每家带探活端点、
  鉴权头型、推荐模型名
- **多预设**（`src-tauri/src/routes.rs`）——RouteRule 扩展为完整预设
  （id / name / provider / baseUrl / keyRef / model / 三档模型映射），每宿主可存
  多套；`active` map 记录每宿主当前激活的预设；旧 routes.json 轻量迁移
  （补 id / name，不重建）；「切换」= 激活 + 立即下发
- **宿主 adapter**：
  - Claude Code（`routes/host_claude.rs`）——写 `~/.claude/settings.json` env 段
    （`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` + 可选
    `ANTHROPIC_DEFAULT_OPUS/SONNET/HAIKU_MODEL` 模型档位映射）；managed 清单记录
    写过哪些键，清除时只删自己的（用户手写的 FABLE 等映射键永不触碰）
  - Codex（`routes/host_codex.rs`）——`config.toml` 用 toml_edit 编辑
    （保留用户手写的 marketplaces / plugins / mcp_servers 段与注释），写顶层
    `model_provider` + `model` + `[model_providers.cchub_*]` 段（前缀标识，
    只删自己的）；`auth.json` 只动 `OPENAI_API_KEY` 字段（OAuth tokens /
    auth_mode / last_refresh 原样保留，损坏时拒绝写入防止丢登录态）；两文件各自
    备份 `.cchub.bak`
  - Gemini CLI（`routes/host_gemini.rs`）——写 `~/.gemini/.env` 的
    `GEMINI_API_KEY` + `GOOGLE_GEMINI_BASE_URL` 两行（dotenv 逐行编辑，用户其他
    env 行原样保留）；写前备份；Google 官方端点经源码确认（GEMINI_API_KEY 在
    auth 白名单、base URL 读 GOOGLE_GEMINI_BASE_URL）
- **宿主回读与偏差提示**：`list_routes` 附带每宿主从配置文件实际读回的生效值
  （base URL / key 指纹 / 模型映射），与激活预设对比，不一致时前端显示
  「配置偏差」徽章 + 一键重新下发（防 cc-switch 同款「外部手改后 UI 与实际
  脱节」问题）
- **探活方式分级**：供应商目录声明 GET / POST 探活（Kimi 的 `/v1/models` 是
  404，改走 POST `/v1/messages` 最小请求；GLM / DeepSeek / MiniMax 的 GET 已
  真机验证 200/401）
- 命令：`list_providers` / `list_routes` / `save_route` / `delete_route` /
  `switch_route`（一键切换）/ `apply_routes`（按激活态重下发全部宿主）/
  `clear_route`（停用宿主）
- 前端：独立的「路由」页（`/routes`，从 API Key 页拆出）——按宿主分区两张卡片：
  当前激活徽章、预设列表（切换 / 编辑 / 删除）、添加预设内联表单（供应商选择
  联动带出默认 base URL 与推荐模型、Key 选择、Codex 必填模型、Claude Code
  可选三档模型映射）
- 17 个单测：validate 扩展（Codex 必填模型 / 新供应商可路由 / 无兼容端点拒绝 /
  空白映射拒绝）、TOML 编辑纯函数（用户段保留 / 只删自己前缀段 / 切换替换 /
  用户自有 provider 不动）、auth.json 字段集合不变、legacy 反序列化、
  managed 键白名单、id 防碰撞；Gemini 宿主 dotenv 纯函数（追加 / 原位替换 /
  清除只删自己 / 畸形行不动 / keychain 引用走展开）

### 阶段二：本地网关（远期，先不承诺）

CCHub 起本地反代（如 `127.0.0.1:8787`），CLI 统一指向网关，网关按规则转发。

- 价值：切换供应商不用改 CLI 配置、统一计费统计、key 不落 CLI 侧
- 代价：常驻进程管理、TLS、流式转发正确性——风险高，等阶段一稳定使用后评估

**验收**：给 Claude Code 配置一个 GLM 预设并切换 → `~/.claude/settings.json` 的
env 段出现对应 base URL / token / 模型映射；给 Codex 配置预设 → `config.toml`
出现 `model_provider` 指向 `cchub_*` 段、`auth.json` 的 `OPENAI_API_KEY` 更新
且 tokens 完好；「停用」后宿主文件里 CCHub 的键 / 段全部清除，用户手写内容
原样。（下发路径有单测覆盖；端到端效果需用户真实 key 验证）

---

## 依赖关系图

```
M0 偏好/目录源/代理 ──┬──> M1 设置
                      ├──> M2 Skill（目录源）
                      └──> M3 MCP（目录源 + 钥匙串 <── M4 API Key）
M4 API Key ──────────────> M5 路由（key 引用 + 下发）
```

## 里程碑外（持续）

- Windows 专项验证（`where` / `cmd /C` 路径、Credential Manager）
- CI 双平台矩阵：当前 `.github/workflows/ci.yml` 跑 Ubuntu 单平台
  （前端 `check:locales` + `test:messages` + `build`，Rust `cargo test`），
  Windows 侧待补
- 各 CLI 输出格式变化的兼容性监控（`extract_version` 是模式匹配，靠真实安装回归）
- MCP / Skill 目录从内置白名单接远端目录源（复用 M0.2，白名单仍是安装边界）
- 路由宿主扩展：更多 CLI adapter（复用 routes/ 下 host 模块模式）
- 供应商目录的 Gemini 兼容端点扩展（第三方 Gemini 兼容网关，如 Cloudflare
  AI Gateway）
