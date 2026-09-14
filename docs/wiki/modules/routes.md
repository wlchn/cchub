# 模块 · 请求路由

> 页面 `/routes`。对应的 Rust 模块：`src-tauri/src/routes.rs` +
> `src-tauri/src/routes/host_{claude,codex,gemini}.rs`。

## 职责

让「哪个 CLI 的请求走哪个供应商 / 什么 base URL / 用哪个 key」可视化。
对标 cc-switch 的核心体验：**每宿主存多套供应商预设，一键切换并立即下发**。

模块做两件事：

1. **下发**：把激活预设写进宿主的配置文件
2. **回读**：读回宿主实际生效的值，与激活预设比对，标记偏差

## 数据模型

```rust
pub struct RouteRule {
    pub id: String,          // 预设实例 id，新增时由后端生成
    pub app: String,         // 宿主："claude-code" | "codex" | "gemini-cli"
    pub name: String,        // 显示名，如 "GLM 主力"
    pub provider: ProviderId,
    pub base_url: String,
    pub key_ref: String,     // "@keychain:provider/label"
    pub model: Option<String>,        // Codex 必填；Claude Code 可选
    pub model_opus: Option<String>,   // Claude Code 三档模型映射
    pub model_sonnet: Option<String>,
    pub model_haiku: Option<String>,
    pub added_at: String,
}

pub struct RoutesFile { pub rules: Vec<RouteRule>, pub active: HashMap<String, String> }
```

`active` 是「宿主 → 当前激活的预设 id」的映射。数据存在
`{app_config_dir}/routes.json`。

### 回读视图

```rust
pub struct HostStateView {
    pub base_url: Option<String>,       // 宿主文件里实际生效的值；None = 未下发
    pub key_fingerprint: Option<String>, // key 指纹（前 4 位 + 长度），不含明文
    pub model_mappings: HashMap<String, String>,
    pub readable: bool,
    pub drift: Option<bool>,            // 激活预设与宿主实际是否一致；None = 无激活预设
}
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `list_providers()` | 拉取供应商目录（前端表单用） |
| `list_routes()` | 预设列表 + 激活态 + **各宿主回读状态** |
| `save_route(rule)` | 新增/覆盖预设（**不动激活态**） |
| `delete_route(id)` | 删除预设 |
| `switch_route(host, id)` | **一键切换** = 激活 + 立即下发 |
| `apply_routes()` | 按当前激活态重新下发全部宿主 |
| `clear_route(host)` | 停用宿主（清除 CCHub 写过的键/段） |
| `probe_route(id)` | 按预设的 base_url + key **实发探活**测速 |

## 三宿主的下发实现

| 宿主 | 文件 | 写什么 | 保格式手段 |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | `env` 段的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` + 可选三档模型映射 | JSON 局部编辑 |
| Codex | `~/.codex/config.toml` | 顶层 `model_provider` + `model` + `[model_providers.cchub_*]` 段 | `toml_edit` 原地编辑 |
| Codex | `~/.codex/auth.json` | 仅 `OPENAI_API_KEY` 字段 | JSON 字段级编辑 |
| Gemini CLI | `~/.gemini/.env` | `GEMINI_API_KEY` + `GOOGLE_GEMINI_BASE_URL` 两行 | dotenv **逐行**编辑 |

### Claude Code（`host_claude.rs`）

```rust
const MANAGED_KEYS: &[&str] = &[
    "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
];
```

先按 `read_managed()` ∩ `MANAGED_KEYS` **删掉自己写过的键**，再写入新值并
`write_managed` 记录本次写的键。用户手写的键（如
`ANTHROPIC_DEFAULT_FABLE_MODEL`）不在集合内，永不被触碰 ——
测试 `managed_keys_are_a_safe_subset` 显式断言不得含 FABLE 键。

### Codex（`host_codex.rs`）

- `PROVIDER_PREFIX = "cchub_"` 作为所有权标识
- `config.toml` 只动 `cchub_*` provider 段与顶层 `model_provider` / `model`；
  清除时**仅当** `model_provider` 指向 `cchub_` 前缀才删它和 `model`，
  用户手写的 provider 组合原样保留；段空则连 `model_providers` 父表一起收掉
- `auth.json` **只改 `OPENAI_API_KEY` 一个字段**，OAuth 的 `tokens` /
  `auth_mode` / `last_refresh` 永不触碰；**解析失败直接报错拒绝写入**
  （防丢登录态）；TOML 解析失败报 `codexTomlBroken`，绝不覆盖
- **下发顺序：先 auth 后 config** —— key 先就位再切开关

### Gemini CLI（`host_gemini.rs`）

`render_env` 是纯函数，**逐行编辑** `~/.gemini/.env`：只替换/删除自己管的
两行，用户其他行、注释、畸形行、带引号的值原样保留（不整份重写）。
清除 = 置空标记行后过滤空行；缺键则追加。`render_env` 内展开 keychain 引用
（明文仅此一步）。写前有内容才备份。

## 关键设计

### 校验（`validate`）

- `base_url` 必须 `https://` 开头（`baseUrlNotHttps`）
- `key_ref` 必须 `@keychain:` 前缀（`keyRefFormat`）
- `claude-code` 预设要求供应商有 `anthropic_endpoint`
- `gemini-cli` 预设要求供应商有 `gemini_endpoint`
- `codex` 预设必须有 `model`
- 模型映射不得为空白

### 偏差检测（drift）

`list_routes` 回读宿主文件的实际生效值，与激活预设比对：
base URL、key 指纹（前 4 位 + 长度，**不含明文**）、模型映射。
不一致时前端显示「配置偏差」徽章 + 一键重新下发。

这防的是「用户或其它工具外部手改了配置，UI 与实际脱节」——
正是 cc-switch 的同款问题。`drift` **只对比 CCHub 管理的键**，用户手写的键不算偏差。

### 旧格式迁移

`load_rules` 对旧的 `routes.json` 做**轻量迁移**：补 `id`（`legacy-<provider>`）
与 `name`，逐宿主第一条记为 active，不重建文件。并自动去重名
（冲突时生成 `"{base} {n}"`）。

### id 生成防碰撞

`now_ms` 用毫秒时间戳 + 原子计数器，避免同一毫秒内多次新建预设产生相同 id
（测试 `id 防碰撞`）。

### 其他健壮性

- `store_rules` 用 tmp + rename 原子写
- 无激活预设时 `clear_route` 是安全的空操作

## 前端

- 页面：`src/pages/Routes.tsx`；store：`src/store/routes.ts`
- 每宿主一张 `HostCard`：宿主目标文件路径（`t(host.targetKey)`）、
  激活预设徽章、**drift 偏差告警 + 一键重新下发**、预设列表
  （切换 / 编辑 / 删除）
- `RuleForm` 增改：按 provider 自动预填 `anthropicEndpoint` 与 `defaultModels`；
  Codex 必填 model；Claude Code 可选三档映射；`canSubmit` 要求 https 开头
- 预设行有 `probeRoute` 测速按钮 + 延迟徽章（ok / 无效 / 不通三态）
- `save` / `remove` / `switchTo` / `clear` / `apply` 之后统一重拉 `listRoutes`
- key 引用经 `keyRefOf` 生成

## 远期：本地网关

ROADMAP 的「阶段二」设想 CCHub 起本地反代（如 `127.0.0.1:8787`），
CLI 统一指向网关。价值是切换不用改 CLI 配置、统一计费统计、key 不落 CLI 侧；
代价是常驻进程管理、TLS、流式转发正确性 —— 风险高，**先不承诺**，
等阶段一稳定使用后评估。

## 测试覆盖（17 个）

`accepts_valid_rule`、`accepts_codex_with_any_catalog_provider`、
`codex_requires_model`、`rejects_http_url`、
`rejects_provider_without_anthropic_endpoint_for_claude`、
`gemini_cli_requires_gemini_compatible_provider`、`accepts_new_cn_providers_for_claude`、
`rejects_plain_key_ref`、`rejects_unknown_app`、`rejects_blank_model_mapping`、
`rejects_blank_name`、`legacy_rule_deserializes_without_new_fields`；
host 侧：`writes_provider_section_and_top_keys`、`clear_removes_only_our_sections`、
`clear_keeps_user_owned_model_provider`、`switch_between_providers_replaces_section`、
`rule_without_model_clears_model_key`、`auth_edit_only_touches_openai_key`、
`provider_key_is_prefixed`。
