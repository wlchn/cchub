# 模块 · MCP

> 页面 `/mcp`。对应的 Rust 模块：`src-tauri/src/mcp.rs` + `src-tauri/src/mcp/hosts.rs`。

## 职责

MCP（Model Context Protocol）配置的「商店 + 写入器」：浏览服务目录，
选择目标宿主，填入参数与环境变量，把配置写进对应 CLI 的配置文件；
也能读回宿主当前配置、删除自己写过的条目、跑握手测试验证服务可用。

## 服务目录（`MCP_SERVICES`，9 条）

npm 包名全部经 registry 验证。

**官方参考实现**：`fetch`（uvx mcp-server-fetch）、`memory`、`everything`、
`sequential-thinking`（npx）

**热门通用**：`filesystem`（带允许访问目录参数）、`playwright`（`@playwright/mcp`）、
`context7`（`@upstash/context7-mcp`，可选 API key env）、
`desktop-commander`（`@wonderwhy-er/desktop-commander`）、
`firecrawl`（必填 `FIRECRAWL_API_KEY` env）

```rust
pub struct McpService {
    pub id, name, description,
    pub transport: Transport,     // Stdio | Http
    pub command: String,
    pub args: Vec<String>,
    pub arg_specs: Vec<ArgSpec>,  // 位置参数（label / placeholder）
    pub env_specs: Vec<EnvSpec>,  // 环境变量模板
    pub install_hint: String,
}
pub struct EnvSpec { pub key, pub source: EnvSource, pub placeholder, pub required: bool }
pub enum EnvSource { Direct, HomeDir }   // HomeDir 显式保留为前后端契约
```

`arg_specs` 声明用户可填的位置参数（如 filesystem 的允许目录），
`env_specs` 声明环境变量（含 `required` 标记）。

## 三大宿主

| 宿主 id | 文件 | 格式 | 段名 |
| --- | --- | --- | --- |
| `claude-code` | `~/.claude.json` | JSON | `mcpServers` |
| `codex` | `~/.codex/config.toml` | TOML（toml_edit） | `mcp_servers` |
| `gemini-cli` | `~/.gemini/settings.json` | JSON | `mcpServers` |

Claude Code 与 Gemini CLI 的写法同形（Gemini 不写 `type` 字段），
Codex 因为要保 TOML 格式而走 `toml_edit` 原地编辑。

## 命令

| 命令 | 作用 |
| --- | --- |
| `list_mcp_services()` | 返回服务目录 |
| `read_host_config(host_id)` | 读回宿主当前配置（标注哪些是 CCHub 管理的） |
| `write_mcp_service(host_id, id, request)` | 写入配置 |
| `remove_mcp_service(host_id, id)` | 移除 CCHub 写过的条目 |
| `test_mcp_service(id)` | JSON-RPC initialize 握手测试 |

`WriteRequest { arg_values, env_values }` 是写入时的参数化覆盖。

```rust
pub struct HostEntry { pub name, pub managed: bool, pub spec }
pub struct HostConfig { pub entries: Vec<HostEntry>, pub note: Option<String> }
```

`managed` 标记该条目是否由 CCHub 写入 —— 前端据此展示「CCHub 管理 / 手动配置」
徽章，手写条目只读。

## 关键设计

### stdio 不走 shell

stdio 服务用 `command + args` 数组直接 spawn，**不经过 shell**，
命令注入不成立。

### `@keychain:` 引用展开

环境变量值支持 `@keychain:provider/label` 格式。写入宿主时由
`resolve_env_value` 从系统钥匙串**展开成明文**（这是明文出口之一，见
[../security.md](../security.md)）。格式缺少 `/` 时报 `keyRefFormatWithValue`。

### 参数校验与 `~` 展开

- `write_mcp_service` 校验 `required` 的 env 是否齐全（`missingEnv`）
- args 追加在默认值之后；路径经 `expand_home` 展开 `~`

### 握手测试

`test_mcp_service` 走 JSON-RPC **initialize** 行协议，逐行找 `id=1` 的 response，
**60s 超时**（容纳 `npx` 首次下载包的耗时）。

### 写宿主的通用协议

`mcp/hosts.rs` 与路由模块共享同一套约定：

- `MCP_HOSTS = ["claude-code", "codex", "gemini-cli"]` 白名单
- **managed 清单**：`<宿主文件>.cchub-managed` 记录 CCHub 写过的条目，
  `remove_*` 先查清单，非自己写的报 `hostEntryNotManaged`，
  **用户手写条目永不动**
- 写前 `backup` 落 `<文件>.cchub.bak`
- `atomic_write`（tmp + rename，失败回落直写）
- 顶层非对象报 `refuseWriteTopLevel`，段非对象报 `refuseWriteSection`

Codex 用 `codex_edit_mcp` 原地编辑（保注释与手写段；args/env 为空则删键），
删空 `mcp_servers` 后连父表一起收掉。

## 前端

- 页面：`src/pages/Mcp.tsx`；store：`src/store/mcp.ts`
- `ServiceCard` → `ServiceRow`：选目标宿主（遍历 `ipc.MCP_HOSTS`）+
  展开填 `arg_specs` / `env_specs`（必填校验 `requiredMissing`）
- store 里 `ops` 按 `hostId/serviceId` 记录写入状态
- 三宿主当前配置卡展示「CCHub 管理 / 手动配置」徽章
- 另有移除确认弹窗、握手测试按钮与在线状态徽章

## 测试覆盖

`service_ids_unique`、`known_service_lookup`、`service_serializes_as_camel_case`
（断言 camelCase 键，防真机页面崩）、`keychain_ref_parsing`、
`write_removes_only_managed`、`expands_home_in_arg_values`、
`services_with_required_env_declare_it`、`filesystem_has_arg_spec`；
hosts 侧：`codex_edit_writes_mcp_section_preserving_user_content`、
`codex_edit_overwrites_same_name_in_place`、`hosts_cover_three_clis`。
