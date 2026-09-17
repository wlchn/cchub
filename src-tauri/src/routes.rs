//! 请求路由（M5 阶段一扩展：多宿主 + 供应商预设切换）。
//!
//! 让「哪个应用的请求走哪个供应商」可视化：每个宿主（Claude Code / Codex）
//! 可保存多套供应商预设，「切换」= 激活 + 立即下发到宿主配置文件。
//!
//! 安全边界：
//! 1. base_url 只允许 https（明文 http 的中转会让 key 裸奔）
//! 2. key 以 keychain 引用存储（`@keychain:provider/label`），下发时才从
//!    钥匙串展开——路由规则文件里永远没有明文 key
//! 3. 写宿主配置前备份，失败回滚
//! 4. 宿主文件里只动自己写过的键/段（managed 清单，见各 host 模块）

use crate::error;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::mcp;

mod host_claude;
mod host_codex;
mod host_gemini;

// ---------------------------------------------------------------- 类型

/// 支持路由的宿主应用。
pub const HOSTS: &[&str] = &["claude-code", "codex", "gemini-cli"];

/// 一条路由预设：宿主 → 供应商的一套完整配置。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RouteRule {
    /// 预设实例 id（同宿主下唯一）。新增时可不传，由保存端生成。
    #[serde(default)]
    pub id: String,
    /// 目标应用 id（HOSTS 之一）。
    pub app: String,
    /// 显示名，如 "GLM 主力"。
    #[serde(default)]
    pub name: String,
    /// 供应商 id（providers.rs 目录里）。
    pub provider: String,
    /// 中转的 base URL，如 https://openrouter.ai/api/v1。
    pub base_url: String,
    /// key 引用：`@keychain:provider/label`。
    pub key_ref: String,
    /// 模型名。Codex 必填（写 config.toml 顶层 model）；Claude Code 可选。
    pub model: Option<String>,
    /// Codex 专属：请求协议（写 model_providers.<id> 段的 wire_api）。
    /// "chat" = Chat Completions（Codex 默认），"responses" = OpenAI Responses API。
    #[serde(default)]
    pub wire_api: Option<String>,
    /// Claude Code 专属：Opus 档位映射（写 ANTHROPIC_DEFAULT_OPUS_MODEL）。
    #[serde(default)]
    pub model_opus: Option<String>,
    /// Claude Code 专属：Sonnet 档位映射。
    #[serde(default)]
    pub model_sonnet: Option<String>,
    /// Claude Code 专属：Haiku 档位映射。
    #[serde(default)]
    pub model_haiku: Option<String>,
    /// 添加时间（RFC3339），仅展示用。
    #[serde(default)]
    pub added_at: String,
}

/// 路由存储：app_config_dir/routes.json。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoutesFile {
    pub rules: Vec<RouteRule>,
    /// 宿主 → 激活的预设 id。切换 = 改这里 + 下发。
    #[serde(default)]
    pub active: BTreeMap<String, String>,
}

/// list_routes 返回的完整状态。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutesStateView {
    pub rules: Vec<RouteRule>,
    pub active: BTreeMap<String, String>,
    /// 每宿主的实际生效配置（回读自宿主文件）。
    pub hosts: BTreeMap<String, HostStateView>,
}

/// 单宿主的回读状态（三宿主统一形状，各 host 模块构造）。
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostState {
    /// 宿主文件里生效的 base_url；None = 未下发。
    pub base_url: Option<String>,
    /// 生效的 key 指纹（前 4 位 + 长度，不回传明文）。
    pub key_fingerprint: Option<String>,
    /// 模型映射当前值（claude: opus/sonnet/haiku；codex: model）。
    pub model_mappings: BTreeMap<String, String>,
    /// 宿主文件是否可读。
    pub readable: bool,
}

/// 单宿主的回读状态 + 与激活预设的偏差标记（前端展示用）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStateView {
    /// 宿主文件里生效的 base_url；None = 未下发。
    pub base_url: Option<String>,
    /// 生效的 key 指纹（前 4 位 + 长度，不回传明文）。
    pub key_fingerprint: Option<String>,
    /// 模型映射当前值。
    pub model_mappings: BTreeMap<String, String>,
    /// 宿主文件是否可读。
    pub readable: bool,
    /// 激活预设与宿主实际配置是否一致；None = 无激活预设。
    pub drift: Option<bool>,
}

/// 回读单个宿主并对比激活预设。
fn read_host_state(host: &str, active_rule: Option<&RouteRule>) -> HostStateView {
    let state: HostState = match host {
        "claude-code" => host_claude::read_state(),
        "codex" => host_codex::read_state(),
        "gemini-cli" => host_gemini::read_state(),
        _ => {
            return HostStateView {
                base_url: None,
                key_fingerprint: None,
                model_mappings: BTreeMap::new(),
                readable: false,
                drift: None,
            }
        }
    };

    // 偏差对比：有激活预设但宿主值对不上 = drift。
    // 模型映射只看我们管的键；宿主多出的用户手写键不算偏差。
    let drift = active_rule.map(|rule| {
        let url_match = state.base_url.as_deref() == Some(rule.base_url.as_str());
        let host = &state.model_mappings;
        let expects: Vec<(&str, Option<&str>)> = if rule.app == "codex" {
            // wire_api 只有 responses 会写入宿主；chat 是 Codex 默认（不写键）
            vec![
                ("model", rule.model.as_deref()),
                (
                    "wireApi",
                    rule.wire_api.as_deref().filter(|w| *w == "responses"),
                ),
            ]
        } else {
            vec![
                ("opus", rule.model_opus.as_deref()),
                ("sonnet", rule.model_sonnet.as_deref()),
                ("haiku", rule.model_haiku.as_deref()),
            ]
        };
        let models_match = expects.iter().all(|(k, v)| {
            let actual = host.get(*k).map(String::as_str);
            actual == *v || (v.is_none() && actual.is_none())
        });
        url_match && models_match
    });

    HostStateView {
        base_url: state.base_url,
        key_fingerprint: state.key_fingerprint,
        model_mappings: state.model_mappings,
        readable: state.readable,
        drift,
    }
}

// ---------------------------------------------------------------- 存储

fn routes_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("routes.json"))
}

/// 读取并做轻量迁移。旧格式（M5 初版）是 `{ rules: [...] }` 且规则无
/// id/name/model 字段——补上默认值而不是整份重建：路由规则是用户配的，
/// 丢了要重配，与 prefs「可重建」哲学不同。旧文件每宿主至多一条，迁移安全。
fn load_rules(app: &tauri::AppHandle) -> RoutesFile {
    let Some(path) = routes_path(app) else {
        return RoutesFile::default();
    };
    let Some(text) = fs::read_to_string(path).ok() else {
        return RoutesFile::default();
    };
    // 先按宽松的 JSON 结构读（rules 数组 + 任意其他字段）
    #[derive(Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    struct RawFile {
        #[serde(default)]
        rules: Vec<RawRule>,
        #[serde(default)]
        active: BTreeMap<String, String>,
    }
    #[derive(Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    struct RawRule {
        app: String,
        provider: String,
        base_url: String,
        key_ref: String,
        #[serde(default)]
        id: Option<String>,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        model: Option<String>,
        #[serde(default)]
        wire_api: Option<String>,
        #[serde(default)]
        model_opus: Option<String>,
        #[serde(default)]
        model_sonnet: Option<String>,
        #[serde(default)]
        model_haiku: Option<String>,
        #[serde(default)]
        added_at: Option<String>,
    }

    let Ok(raw) = serde_json::from_str::<RawFile>(&text) else {
        return RoutesFile::default();
    };

    let rules: Vec<RouteRule> = raw
        .rules
        .into_iter()
        .map(|r| {
            let id = r.id.unwrap_or_else(|| format!("legacy-{}", r.provider));
            RouteRule {
                id,
                name: r.name.unwrap_or_else(|| r.provider.clone()),
                app: r.app,
                provider: r.provider,
                base_url: r.base_url,
                key_ref: r.key_ref,
                model: r.model,
                wire_api: r.wire_api,
                model_opus: r.model_opus,
                model_sonnet: r.model_sonnet,
                model_haiku: r.model_haiku,
                added_at: r.added_at.unwrap_or_default(),
            }
        })
        .collect();

    // 迁移后旧格式天然满足「每宿主一条」：直接把 rules 里的第一条记为激活
    let mut active = raw.active;
    if active.is_empty() {
        let mut seen = std::collections::HashSet::new();
        for rule in rules.iter() {
            if seen.insert(rule.app.clone()) {
                active.insert(rule.app.clone(), rule.id.clone());
            }
        }
    }

    RoutesFile { rules, active }
}

fn store_rules(app: &tauri::AppHandle, file: &RoutesFile) -> Result<(), String> {
    let path = routes_path(app).ok_or_else(|| error::err_plain("configDirMissing"))?;
    let dir = path
        .parent()
        .ok_or_else(|| error::err_plain("configDirNoParent"))?;
    fs::create_dir_all(dir).map_err(|err| error::io_failed("createDir", err))?;
    let text = serde_json::to_string_pretty(file).map_err(|err| format!("{err}"))?;
    let tmp = dir.join("routes.json.tmp");
    fs::write(&tmp, text).map_err(|err| error::io_failed("writeRoutes", err))?;
    fs::rename(&tmp, &path).map_err(|err| error::io_failed("saveRoutes", err))
}

// ---------------------------------------------------------------- 校验

/// 宿主是否支持路由。
pub fn is_host(app: &str) -> bool {
    HOSTS.contains(&app)
}

fn validate(rule: &RouteRule) -> Result<(), String> {
    if !is_host(&rule.app) {
        return Err(error::err(
            "hostUnsupported",
            &[("app", rule.app.as_str()), ("hosts", &HOSTS.join(" / "))],
        ));
    }
    let Some(info) = crate::providers::find(&rule.provider) else {
        return Err(error::err("unknownProvider", &[("provider", rule.provider.as_str())]));
    };
    // 各宿主的协议要求：Claude Code 走 Anthropic 协议、Gemini CLI 走 Gemini
    // 协议，供应商必须有对应兼容端点；Codex 写自己的 provider 段，任何目录
    // 供应商都行。
    match rule.app.as_str() {
        "claude-code" if info.anthropic_endpoint.is_none() => {
            return Err(error::err(
                "providerNoAnthropicEndpoint",
                &[("provider", rule.provider.as_str())],
            ));
        }
        "gemini-cli" if info.gemini_endpoint.is_none() => {
            return Err(error::err(
                "providerNoGeminiEndpoint",
                &[("provider", rule.provider.as_str())],
            ));
        }
        _ => {}
    }
    if rule.name.trim().is_empty() {
        return Err(error::err_plain("presetNameRequired"));
    }
    if !rule.base_url.starts_with("https://") {
        return Err(error::err_plain("baseUrlNotHttps"));
    }
    if !rule.key_ref.starts_with("@keychain:") {
        return Err(error::err_plain("keyRefFormat"));
    }
    // 模型映射：给了就不能是空白；Codex 必须有主模型
    // label 是 `fields.*` 的键（不是文案）：escaped 到前端才翻译
    for (label, value) in [
        ("model", &rule.model),
        ("modelOpus", &rule.model_opus),
        ("modelSonnet", &rule.model_sonnet),
        ("modelHaiku", &rule.model_haiku),
    ] {
        if let Some(v) = value {
            if v.trim().is_empty() {
                return Err(error::err("fieldBlank", &[("label", label)]));
            }
        }
    }
    if rule.app == "codex" && rule.model.as_deref().map(str::trim).unwrap_or("").is_empty() {
        return Err(error::err_plain("codexModelRequired"));
    }
    // wire_api 只认两种已知协议（None = Codex 默认 chat）
    if let Some(api) = rule.wire_api.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if api != "chat" && api != "responses" {
            return Err(error::err("unknownWireApi", &[("api", api)]));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- 命令

/// 由规则文件构造完整视图（含宿主回读）。所有返回 RoutesStateView 的命令共用。
fn view_of(file: &RoutesFile) -> RoutesStateView {
    let mut hosts = BTreeMap::new();
    for host in HOSTS {
        let active_id = file.active.get(*host);
        let active_rule = active_id.and_then(|id| file.rules.iter().find(|r| &r.id == id));
        hosts.insert(host.to_string(), read_host_state(host, active_rule));
    }
    RoutesStateView {
        rules: file.rules.clone(),
        active: file.active.clone(),
        hosts,
    }
}

/// 当前路由状态：全部预设 + 每宿主的激活项 + 宿主实际生效配置。
#[tauri::command]
pub fn list_routes(app: tauri::AppHandle) -> RoutesStateView {
    view_of(&load_rules(&app))
}

/// 保存（新增或按 id 覆盖）一个预设。不动激活态。
#[tauri::command]
pub async fn save_route(
    app: tauri::AppHandle,
    rule: RouteRule,
) -> Result<RoutesStateView, String> {
    validate(&rule)?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut file = load_rules(&app);
        let mut rule = rule;
        if rule.added_at.is_empty() {
            rule.added_at = crate::keys::now_rfc3339();
        }
        // 同宿主下 id 唯一；新 id 用时间戳生成
        if rule.id.trim().is_empty() {
            rule.id = format!("r-{}", now_ms());
        }
        // 名字在宿主内唯一（展示层面），重名自动加后缀
        let base = rule.name.trim().to_string();
        let mut name = base.clone();
        let mut n = 2;
        while file.rules.iter().any(|r| {
            r.app == rule.app && r.name == name && r.id != rule.id
        }) {
            name = format!("{base} {n}");
            n += 1;
        }
        rule.name = name;

        file.rules.retain(|r| r.id != rule.id);
        file.rules.push(rule.clone());
        store_rules(&app, &file)?;
        Ok(view_of(&file))
    })
    .await
    .map_err(|err| error::io_failed("task", err))?
}

/// 删除一个预设（按 id）。若是激活的，同时清掉激活记录（宿主配置不动，
/// 需要用户手动「停用」或在宿主里清理）。
#[tauri::command]
pub async fn delete_route(app: tauri::AppHandle, id: String) -> Result<RoutesStateView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut file = load_rules(&app);
        let Some(target) = file.rules.iter().find(|r| r.id == id).cloned() else {
            return Err(error::err("presetNotFound", &[("id", id.as_str())]));
        };
        file.rules.retain(|r| r.id != id);
        // 删的是激活项 → 激活记录一并清（宿主文件里已下发的配置不动）
        if file.active.get(&target.app) == Some(&id) {
            file.active.remove(&target.app);
        }
        store_rules(&app, &file)?;
        Ok(view_of(&file))
    })
    .await
    .map_err(|err| error::io_failed("task", err))?
}

/// 一键切换：把某宿主的激活预设改为指定项，并立即下发。
#[tauri::command]
pub async fn switch_route(app: tauri::AppHandle, id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut file = load_rules(&app);
        let Some(rule) = file.rules.iter().find(|r| r.id == id).cloned() else {
            return Err(error::err("presetNotFound", &[("id", id.as_str())]));
        };
        let result = dispatch(&rule)?;
        file.active.insert(rule.app.clone(), rule.id.clone());
        store_rules(&app, &file)?;
        Ok(result)
    })
    .await
    .map_err(|err| error::io_failed("task", err))?
}

/// 按当前激活状态重下发全部宿主（保留原有 apply 语义）。
#[tauri::command]
pub async fn apply_routes(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = load_rules(&app);
        let mut messages = Vec::new();
        for host in HOSTS {
            let Some(id) = file.active.get(*host) else {
                continue;
            };
            let Some(rule) = file.rules.iter().find(|r| &r.id == id) else {
                continue;
            };
            messages.push(dispatch(rule)?);
        }
        if messages.is_empty() {
            return Ok(error::note("noActiveHost", &[]));
        }
        Ok(messages.join("；"))
    })
    .await
    .map_err(|err| error::io_failed("task", err))?
}

/// 停用某宿主：下发「清除」并移除激活记录。
#[tauri::command]
pub async fn clear_route(app: tauri::AppHandle, app_id: String) -> Result<String, String> {
    if !is_host(&app_id) {
        return Err(error::err("unknownHost", &[("host", app_id.as_str())]));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let result = match app_id.as_str() {
            "claude-code" => host_claude::apply(None)?,
            "codex" => host_codex::apply(None)?,
            "gemini-cli" => host_gemini::apply(None)?,
            _ => unreachable!(),
        };
        let mut file = load_rules(&app);
        file.active.remove(&app_id);
        store_rules(&app, &file)?;
        Ok(result)
    })
    .await
    .map_err(|err| error::io_failed("task", err))?
}

// ---------------------------------------------------------------- 下发

/// 把规则下发到对应宿主（明文 key 只在宿主模块内部展开）。
fn dispatch(rule: &RouteRule) -> Result<String, String> {
    match rule.app.as_str() {
        "claude-code" => host_claude::apply(Some(rule)),
        "codex" => host_codex::apply(Some(rule)),
        "gemini-cli" => host_gemini::apply(Some(rule)),
        other => Err(error::err("unknownHost", &[("host", other)])),
    }
}

/// 新预设的 id：毫秒时间戳 + 计数器，避免同毫秒碰撞（连点两次添加）。
fn now_ms() -> u128 {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    ts * 1000 + n as u128
}

/// 预设测速：按预设的 base_url + key 实发一次探活请求。
/// 与 keys::test_key 的区别：用预设里配置的端点与 key（而不是目录默认），
/// 测的是「这条预设实际能不能用、延迟多少」。
#[tauri::command]
pub async fn probe_route(
    app: tauri::AppHandle,
    id: String,
) -> Result<Result<u128, String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = load_rules(&app);
        let Some(rule) = file.rules.iter().find(|r| r.id == id) else {
            return Err(error::err("presetNotFound", &[("id", id.as_str())]));
        };
        let info = crate::providers::find(&rule.provider)
            .ok_or_else(|| error::err("unknownProvider", &[("provider", rule.provider.as_str())]))?;

        // 展开 key（明文只在这一次请求中出现，不落盘）
        let key = mcp::resolve_env_value(&rule.key_ref)?;

        let agent: ureq::Agent = crate::catalog_source::http_agent_for_prefs();
        let started = std::time::SystemTime::now();

        // 探活端点：Claude Code 宿主用供应商的探活端点（目录声明）；
        // 其他宿主直接打 base_url（HEAD 不一定支持，用 GET）
        let url = if rule.app == "claude-code" {
            info.probe_endpoint.to_string()
        } else {
            rule.base_url.clone()
        };
        let auth = if info.bearer_auth {
            format!("Bearer {key}")
        } else {
            key
        };

        let response = match info.probe_method {
            crate::providers::ProbeMethod::Get => {
                agent.get(&url).header(info.probe_header, auth).call()
            }
            crate::providers::ProbeMethod::Post => agent
                .post(&url)
                .header(info.probe_header, auth)
                .send_json(serde_json::json!({
                    "model": "probe",
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "hi"}],
                })),
        };

        Ok(match response {
            Ok(_) => {
                let ms = started
                    .elapsed()
                    .map(|d| d.as_millis())
                    .unwrap_or_default();
                Ok(ms)
            }
            Err(err) => {
                let msg = format!("{err}");
                if msg.contains("401") || msg.contains("403") {
                    Err(error::err_plain("keyRejected"))
                } else {
                    Err(error::err("requestFailed", &[("msg", msg.as_str())]))
                }
            }
        })
    })
    .await
    .map_err(|err| error::io_failed("task", err))?
}

// ---------------------------------------------------------------- 公共：HOME 解析

/// 用户主目录。Windows 上 HOME 常缺失，回落 USERPROFILE。
pub fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|_| error::err_plain("noHomeDir"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(app: &str, provider: &str, url: &str, key: &str) -> RouteRule {
        RouteRule {
            id: "t1".into(),
            app: app.into(),
            name: "测试".into(),
            provider: provider.into(),
            base_url: url.into(),
            key_ref: key.into(),
            model: None,
            wire_api: None,
            model_opus: None,
            model_sonnet: None,
            model_haiku: None,
            added_at: String::new(),
        }
    }

    #[test]
    fn accepts_valid_rule() {
        assert!(validate(&rule(
            "claude-code",
            "openrouter",
            "https://openrouter.ai/api/v1",
            "@keychain:openrouter/main"
        ))
        .is_ok());
        assert!(validate(&rule(
            "claude-code",
            "anthropic",
            "https://api.anthropic.com",
            "@keychain:anthropic/work"
        ))
        .is_ok());
    }

    #[test]
    fn accepts_codex_with_any_catalog_provider() {
        // Codex 走自己的 provider 段，不要求 Anthropic 兼容
        let mut r = rule(
            "codex",
            "openai",
            "https://api.openai.com/v1",
            "@keychain:openai/main",
        );
        r.model = Some("gpt-5.2".into());
        assert!(validate(&r).is_ok());
    }

    #[test]
    fn codex_requires_model() {
        let err = validate(&rule(
            "codex",
            "openai",
            "https://api.openai.com/v1",
            "@keychain:openai/main",
        ))
        .unwrap_err();
        assert_eq!(error::code_of(&err).as_deref(), Some("codexModelRequired"));
    }

    #[test]
    fn codex_accepts_known_wire_api_values() {
        let mut r = rule(
            "codex",
            "openai",
            "https://api.openai.com/v1",
            "@keychain:openai/main",
        );
        r.model = Some("gpt-5.2".into());
        r.wire_api = Some("chat".into());
        assert!(validate(&r).is_ok());
        r.wire_api = Some("responses".into());
        assert!(validate(&r).is_ok());
        r.wire_api = Some("  responses  ".into());
        assert!(validate(&r).is_ok());
    }

    #[test]
    fn rejects_unknown_wire_api() {
        let mut r = rule(
            "codex",
            "openai",
            "https://api.openai.com/v1",
            "@keychain:openai/main",
        );
        r.model = Some("gpt-5.2".into());
        r.wire_api = Some("grpc".into());
        assert_eq!(
            error::code_of(&validate(&r).unwrap_err()).as_deref(),
            Some("unknownWireApi")
        );
    }

    #[test]
    fn rejects_http_url() {
        let err = validate(&rule(
            "claude-code",
            "openrouter",
            "http://insecure.example.com",
            "@keychain:openrouter/main",
        ))
        .unwrap_err();
        assert_eq!(error::code_of(&err).as_deref(), Some("baseUrlNotHttps"));
    }

    #[test]
    fn rejects_provider_without_anthropic_endpoint_for_claude() {
        let err = validate(&rule(
            "claude-code",
            "openai",
            "https://api.openai.com/v1",
            "@keychain:openai/main",
        ))
        .unwrap_err();
        assert_eq!(
            error::code_of(&err).as_deref(),
            Some("providerNoAnthropicEndpoint")
        );
    }

    #[test]
    fn gemini_cli_requires_gemini_compatible_provider() {
        // google 官方端点是 Gemini 格式，可路由
        assert!(validate(&rule(
            "gemini-cli",
            "google",
            "https://generativelanguage.googleapis.com/v1beta",
            "@keychain:google/main"
        ))
        .is_ok());
        // openrouter 是 Anthropic/OpenAI 兼容，不是 Gemini 格式
        let err = validate(&rule(
            "gemini-cli",
            "openrouter",
            "https://openrouter.ai/api/v1",
            "@keychain:openrouter/main",
        ))
        .unwrap_err();
        assert_eq!(
            error::code_of(&err).as_deref(),
            Some("providerNoGeminiEndpoint")
        );
    }

    #[test]
    fn accepts_new_cn_providers_for_claude() {
        for (provider, url) in [
            ("glm", "https://open.bigmodel.cn/api/anthropic"),
            ("deepseek", "https://api.deepseek.com/anthropic"),
            ("kimi", "https://api.moonshot.cn/anthropic"),
            ("minimax", "https://api.minimaxi.com"),
        ] {
            assert!(
                validate(&rule(
                    "claude-code",
                    provider,
                    url,
                    &format!("@keychain:{provider}/main")
                ))
                .is_ok(),
                "{provider} 应可路由到 Claude Code"
            );
        }
    }

    #[test]
    fn rejects_plain_key_ref() {
        let err = validate(&rule(
            "claude-code",
            "openrouter",
            "https://openrouter.ai/api/v1",
            "sk-plain-value",
        ))
        .unwrap_err();
        assert_eq!(error::code_of(&err).as_deref(), Some("keyRefFormat"));
    }

    #[test]
    fn rejects_unknown_app() {
        let r = rule(
            "some-future-cli",
            "openrouter",
            "https://openrouter.ai/api/v1",
            "@keychain:openrouter/main",
        );
        assert!(validate(&r).unwrap_err().contains("some-future-cli"));
    }

    #[test]
    fn rejects_blank_model_mapping() {
        let mut r = rule(
            "claude-code",
            "glm",
            "https://open.bigmodel.cn/api/anthropic",
            "@keychain:glm/main",
        );
        r.model_opus = Some("   ".into());
        assert!(validate(&r).unwrap_err().contains("Opus"));
    }

    #[test]
    fn rejects_blank_name() {
        let mut r = rule(
            "claude-code",
            "glm",
            "https://open.bigmodel.cn/api/anthropic",
            "@keychain:glm/main",
        );
        r.name = "  ".into();
        assert_eq!(
            error::code_of(&validate(&r).unwrap_err()).as_deref(),
            Some("presetNameRequired")
        );
    }

    #[test]
    fn legacy_rule_deserializes_without_new_fields() {
        // 旧格式（M5 初版）：无 id/name/model 等字段，serde 默认值兜住
        let text = r#"{
            "rules": [{
                "app": "claude-code",
                "provider": "openrouter",
                "baseUrl": "https://openrouter.ai/api/v1",
                "keyRef": "@keychain:openrouter/main"
            }],
            "active": {}
        }"#;
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct RawFile {
            rules: Vec<RouteRule>,
        }
        let raw: RawFile = serde_json::from_str(text).unwrap();
        assert_eq!(raw.rules.len(), 1);
        assert_eq!(raw.rules[0].app, "claude-code");
        assert!(raw.rules[0].model.is_none());
    }
}
