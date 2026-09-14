# 模块 · 设置与基础设施

> 页面 `/settings`。对应的 Rust 模块：`prefs.rs`、`catalog_source.rs`、`sys.rs`
> 的代理部分。对应 ROADMAP 的 M0（通用基础设施）与 M1（设置）。

## 职责

M0 不做界面，只做后面所有模块都要用的三件东西：**偏好存储、远端目录源、网络代理**。
M1 把它们露到设置页上。

## 一、偏好存储（`prefs.rs`）

唯一持久化存储，落盘 `{app_config_dir}/prefs.json`。

```rust
pub const SCHEMA_VERSION: u32 = 1;

pub struct Prefs {
    pub schema_version: u32,
    pub theme: Theme,              // System | Light | Dark
    pub locale: String,            // "zh-CN" | "en-US"
    pub detect_on_launch: bool,
    pub check_updates_on_launch: bool,
    pub proxy: ProxyPrefs,
    pub catalog_url: String,       // 空串 = 只用内置目录
    pub catalog_ttl_hours: u32,
}
pub struct ProxyPrefs { pub url: String, pub no_proxy: String, pub use_system: bool }
```

### 三条不变量

1. **版本必须匹配**：`parse()` 发现 `schemaVersion != SCHEMA_VERSION` 或字段缺失
   → `migrate()` 返回 `None` → **整份重建，不做猜测式迁移**。
   理由：猜错的迁移比重新开始更糟。
2. **原子写**：`store()` 先写 `prefs.json.tmp` 再 rename；Windows 上 rename 覆盖
   可能失败，回落「先删后改名」。
3. **diff 合并**：`apply()` 把当前值序列化为 `Value`，逐 key 覆盖再反序列化。
   类型不匹配则**整体报错**，内存与磁盘不会停在半合并状态。

另外 `sanitized()` 把 `catalog_ttl_hours` clamp 到 `1..=24*30`（720 小时）。

命令：`get_prefs()` / `set_prefs(diff)`。**diff 而非整包覆盖**，避免多窗口竞态。

## 二、远端目录源（`catalog_source.rs`）

现状：应用目录的展示元数据可以走远端 JSON（GitHub raw / 静态 CDN），
Rust 白名单只保留「哪些 id 允许 npm 安装」。

```
回落链：远端 → 磁盘缓存 → 内置
```

### 安全边界不变

远端条目经 `trusted()` 过滤：**`id` 必须命中 `registry::find`，否则整条丢弃**。
`parse_remote` 对空数组 / 全被过滤 / 结构错误一律返回 `None`。
远端目录可以下架应用、改文案，但**不能提权**。

### 细节

- `http_agent` 强制 `https_only(true)` + 10s 全局超时（`FETCH_TIMEOUT`），
  按偏好注入 `ureq::Proxy`。该 agent 也被 `keys.rs` 复用。
- 未配 url → 直接 builtin；TTL 内内存缓存直接返回；远端成功则写磁盘 + 内存缓存。
- 远端失败 → 磁盘缓存（`catalogFallbackCache`）→ builtin（`catalogFallbackBuiltin`）。
- 磁盘缓存同样 tmp + rename 原子写；网络请求在 `spawn_blocking` 中执行。
- 锁污染用 `unwrap_or_else(|e| e.into_inner())` 恢复。

```rust
pub struct CatalogResponse { pub entries, pub source: CatalogSourceKind, pub note }
pub enum CatalogSourceKind { Remote, Cache, Builtin }
```

命令：`get_catalog()` / `test_network()`（测 npm registry 延迟）。

### 前端行为

`src/lib/catalog.ts` 里 `mergeEntries()` 把远端条目与内置条目**按字段合并**
（远端优先，builtin 兜底），展示顺序按 builtin 顺序。
AppStore 页脚**如实显示目录来源**，不掩盖是否回落了。

## 三、网络代理（`sys.rs`）

`proxy_envs()` 按偏好生成代理环境变量：

| 配置 | 行为 |
| --- | --- |
| 显式 `url` | 注入 `HTTP_PROXY` / `HTTPS_PROXY`（含小写变体） |
| `use_system` | 继承进程已有的代理变量 |
| `no_proxy` | **始终生效**，把 `;` 换成 `,`（npm 约定） |

`sys::shell_command` 给**所有** npm 子进程注入这些变量；目录源请求侧由
`catalog_source::http_agent` 带 `ureq::Proxy`。

启动时 `lib.rs::setup` 从 prefs 装载全局代理快照（`OnceLock`），
保证任何子进程出生时就带着正确的代理环境。

## 设置页五张卡（`src/pages/Settings.tsx`）

| 卡 | 内容 | 落点 |
| --- | --- | --- |
| 外观 `AppearanceCard` | 主题三选（跟随系统 / 浅色 / 深色） | `lib/theme.ts` + `prefs.theme` |
| 语言 | 中 / 英双语 | `prefs.locale` + `i18n/` |
| 行为 `BehaviorCard` | 开机自启、启动时检测、启动时检查更新 | `tauri-plugin-autostart` + prefs |
| 网络 `ProxyCard` | 代理地址 + 直连列表 + 跟随系统 + 测试按钮 | M0.3 |
| 目录源 `CatalogCard` | 远端地址 + 缓存 TTL + 当前来源展示 | M0.2 |
| 环境诊断 `EnvironmentCard` | 模式判定 / OS / node / npm / 解析出的 PATH | `sys::effective_path` |

交互约定：**开关类即时保存（diff）**，**输入框失焦保存**；
TTL 非法输入失焦回滚；代理改动自动重拉目录（因为目录请求也走代理）；
代理测试前先保存。
