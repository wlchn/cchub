# 模块 · API Key 管理

> 页面 `/keys`。对应的 Rust 模块：`src-tauri/src/keys.rs`（供应商真值在 `providers.rs`）。

## 职责

把散落在各种工具配置里的 API 凭据**集中存进操作系统钥匙串**。本地只落一份
不含明文的元数据索引。这是 M3（MCP）与 M5（路由）的公共依赖 ——
它们需要凭据来写宿主配置。

## 存储模型

| 层 | 位置 | 内容 |
| --- | --- | --- |
| 真值 | 系统钥匙串（服务名 `cchub`，条目 `provider/label`） | 明文 key |
| 索引 | `{app_config_dir}/keys-index.json` | `{provider, label, added_at}`，**无明文** |

后端实现用 `keyring` v4：macOS → Keychain，Windows → Credential Manager，
Linux → Secret Service。

```rust
pub struct KeyRef { pub provider, pub label, pub added_at }
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `list_key_refs()` | 列出索引（**永不含明文**） |
| `save_key(provider, label, value)` | 写入钥匙串 + 更新索引（覆盖语义） |
| `delete_key(provider, label)` | 删除（**幂等**：钥匙串无条目不算错） |
| `reveal_key(provider, label)` | 返回明文（用户主动点「显示」） |
| `test_key(provider, label)` | 探活，返回耗时或结构化错误 |

## 供应商目录

`providers.rs` 的 `PROVIDERS` 是**唯一真值**（此前 keys.rs / ApiKeys.tsx /
RouteCard.tsx 三处各写一份）。

| 供应商 | Anthropic 兼容端点 | Gemini 兼容端点 | 说明 |
| --- | --- | --- | --- |
| `anthropic` | ✅ `api.anthropic.com` | — | 官方 |
| `openrouter` | ✅ | — | 聚合中转 |
| `glm` | ✅ `open.bigmodel.cn/api/anthropic` | — | 智谱 |
| `deepseek` | ✅ `api.deepseek.com/anthropic` | — | |
| `kimi` | ✅ `api.moonshot.cn/anthropic` | — | 探活走 POST |
| `minimax` | ✅ `api.minimaxi.com` | — | |
| `openai` | — | — | 仅 Key 管理 |
| `google` | — | ✅ `generativelanguage.googleapis.com/v1beta` | 可路由到 Gemini CLI |
| `xai` | — | — | 仅 Key 管理 |

每个供应商声明：探活端点、鉴权头名（`x-api-key` / `Authorization`）、
是否 Bearer 前缀、探活请求方式（GET/POST）、推荐模型名。

**探活方式分级**：多数支持 `GET /models`，但 Kimi 的 `GET /models` 返回 404，
改走 `POST /messages` 的最小请求（`max_tokens=1`）。

## 关键设计

### 明文只有两个出口

这是模块的核心不变量：

1. `reveal_key` 命令 —— 用户在 UI 里主动点「显示」
2. `reveal_key_sync` —— 写宿主配置（M3 / M5）时展开 `@keychain:` 引用

此外**无「导出全部」功能**，不落任何明文文件。前端 `store/keys.ts` 的 `reveal`
在 **10 秒后自动恢复掩码**，明文不常驻 UI。

### 条目名 sanitize

`entry_name` 把 label 里的 `/` 与 `\` 替换为 `_`，防止条目名歧义
（`a/b` 与 `a_b` 撞车）。

### 索引的健壮性

- 写索引用 tmp + rename 原子替换
- 索引损坏或缺失时 `load_index` 返回默认值 —— **钥匙串才是真值**，可以随时对账
- `delete_key` 幂等：钥匙串没有该条目时 `NoEntry` 不算错误

### 鉴权头构造

`auth_value` 按供应商的 `bearer_auth` 决定是否拼 `Bearer ` 前缀。
`test_key` 用最小请求（GET models 或 POST messages），
401/403 判 `keyRejected`；POST 下 404/405 判 `probeMethodUnsupported`。
请求走偏好代理（与目录源同一 HTTP agent 策略）。

### 时间戳不引 chrono

`now_rfc3339` 手写 civil 算法生成 RFC3339 时间戳，避免为一个字段引入 chrono 依赖。

## 前端

- 页面：`src/pages/ApiKeys.tsx`；store：`src/store/keys.ts`
- `AddKeyCard`（provider Select + label + `type=password` 输入）
- 按 provider 分组的列表；每行支持：
  - **测试连通** → 三态徽章（ok + 延迟 / invalid / error）
  - **显示明文** → Eye/EyeOff 切换，10 秒后自动遮罩
  - **删除** → 确认弹窗
- Key 用 `provider/label` 复合键；`keyRefOf` 生成 `@keychain:provider/label`
  供路由/MCP 模块引用

> 路由页（`/routes`）在 M5 阶段从 ApiKeys 页**拆分**出去，现在两页各自独立。

## 测试覆盖

`provider_roundtrip`、`providers_catalog_covers_every_variant`
（enum 与目录一一对应，防漏配）、`entry_name_sanitizes_slashes`、
`auth_value_bearer_or_raw`、`rfc3339_shape`。
