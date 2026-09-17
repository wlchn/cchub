//! 远端目录源：把展示元数据（文案 / 标签 / 链接）从客户端里挪出去。
//!
//! 分层原则——白名单管安全，远端管内容：
//! - `registry.rs` 的白名单（哪些 id 允许 npm 安装）仍然内置在客户端，远端改不了
//! - 远端 JSON 只提供展示元数据；条目的 id 不在白名单里就整条丢弃
//! - 因此远端目录可以下架应用、改文案，但无法提权让一个新 id 变成可安装
//!
//! 可用性优先于新鲜度，回落链：远端 → 磁盘缓存 → 内置（`catalog.rs`）。

use crate::error;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::prefs::Prefs;
use crate::registry;

/// 缓存文件名（app_config_dir 下）。
const CACHE_FILE: &str = "catalog-cache.json";

/// 请求超时。目录源挂了不应该让启动流程等半天。
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// 远端目录 JSON 中单个条目的形状。
///
/// 与前端 `CatalogEntry` 对齐（camelCase 字段）。缺字段的条目按解析失败丢弃。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub tagline: String,
    pub description: String,
    pub initials: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub homepage: String,
    pub docs: String,
}

/// 目录获取结果：数据 + 来源，前端要在页脚如实显示当前用的是哪份。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogResponse {
    pub entries: Vec<RemoteEntry>,
    /// remote: 远端刚拉的；cache: 缓存（远端失败）；builtin: 没配远端或彻底失败
    pub source: String,
    /// source 为 remote/cache 时为 None；builtin 时说明回落原因。
    pub note: Option<String>,
}

/// 进程内目录缓存状态。
pub struct CatalogState {
    /// (entries, fetched_at, 来源 url)。None = 还没拉过。
    inner: Mutex<Option<CachedCatalog>>,
}

struct CachedCatalog {
    entries: Vec<RemoteEntry>,
    fetched_at: SystemTime,
    url: String,
}

impl CatalogState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(CACHE_FILE))
}

/// 目录条目是否可信：id 必须在安装白名单里。
///
/// 这一道校验是整个分层的安全边界——远端目录被劫持/写错时，
/// 最多让展示层出垃圾，绝不能让一个未知 id 进入可安装集。
fn trusted(entries: Vec<RemoteEntry>) -> Vec<RemoteEntry> {
    entries
        .into_iter()
        .filter(|entry| registry::find(&entry.id).is_some())
        .collect()
}

/// 解析远端 JSON 文本。结构错误 / 空数组 / 全部条目被过滤都算失败，
/// 调用方走回落链。
fn parse_remote(text: &str) -> Option<Vec<RemoteEntry>> {
    let entries: Vec<RemoteEntry> = serde_json::from_str(text).ok()?;
    let entries = trusted(entries);
    if entries.is_empty() {
        None
    } else {
        Some(entries)
    }
}

/// 构造带代理与超时的 HTTP agent。代理偏好来自 prefs（显式 url 或跟随系统）。
fn http_agent(prefs: &Prefs) -> ureq::Agent {
    let mut builder = ureq::Agent::config_builder()
        .https_only(true)
        .timeout_global(Some(FETCH_TIMEOUT));

    let url = prefs.proxy.url.trim().to_string();
    if !url.is_empty() {
        if let Ok(proxy) = ureq::Proxy::new(&url) {
            builder = builder.proxy(Some(proxy));
        }
    }

    builder.build().new_agent()
}

/// 供其他模块（keys.rs 的连通测试）构造同一策略的 agent：
/// 走偏好代理（sys 的全局快照）、HTTPS only、10s 超时。
pub fn http_agent_for_prefs() -> ureq::Agent {
    let prefs = Prefs {
        proxy: crate::sys::proxy_prefs().unwrap_or_default(),
        ..Default::default()
    };
    http_agent(&prefs)
}

fn fetch_remote(url: &str, prefs: &Prefs) -> Result<Vec<RemoteEntry>, String> {
    let agent: ureq::Agent = http_agent(prefs);

    let mut response = agent
        .get(url)
        .call()
        .map_err(|err| error::io_failed("requestCatalog", err))?;

    let text = response
        .body_mut()
        .read_to_string()
        .map_err(|err| error::io_failed("readCatalogResponse", err))?;

    parse_remote(&text)
        .ok_or_else(|| error::err_plain("catalogUnusable"))
}

fn write_cache(app: &AppHandle, entries: &[RemoteEntry]) {
    let Some(path) = cache_path(app) else {
        return;
    };
    let Some(dir) = path.parent() else {
        return;
    };
    if fs::create_dir_all(dir).is_ok() {
        if let Ok(text) = serde_json::to_string(entries) {
            let tmp = dir.join(format!("{CACHE_FILE}.tmp"));
            if fs::write(&tmp, text).is_ok() {
                let _ = fs::rename(&tmp, &path);
            }
        }
    }
}

fn read_cache(app: &AppHandle) -> Option<Vec<RemoteEntry>> {
    let path = cache_path(app)?;
    let text = fs::read_to_string(path).ok()?;
    parse_remote(&text)
}

/// 获取目录。决策顺序：
/// 1. 未配置 catalog_url → builtin（这是主动选择，不算错误）
/// 2. 内存缓存未过期（TTL 内）→ 直接用
/// 3. 拉远端 → 成功则写缓存并返回 remote
/// 4. 远端失败 → 磁盘缓存 → cache
/// 5. 磁盘也没有 → builtin（带说明）
///
/// 首次调用会走网络（未配 TTL 过期时），命令是 async 的，阻塞工作在
/// spawn_blocking 里跑。
#[tauri::command]
pub async fn get_catalog(
    app: AppHandle,
    state: tauri::State<'_, CatalogState>,
    prefs: tauri::State<'_, crate::prefs::PrefsState>,
) -> Result<CatalogResponse, String> {
    let p = prefs.snapshot();

    if p.catalog_url.trim().is_empty() {
        return Ok(CatalogResponse {
            entries: Vec::new(),
            source: "builtin".to_string(),
            note: Some(error::note("catalogNoRemote", &[])),
        });
    }

    let url = p.catalog_url.trim().to_string();
    let ttl = Duration::from_secs(u64::from(p.catalog_ttl_hours) * 3600);

    // TTL 命中：内存缓存直接用，无网络无 IO
    {
        let guard = state.inner.lock().unwrap_or_else(|err| err.into_inner());
        if let Some(cached) = guard.as_ref() {
            if cached.url == url
                && cached
                    .fetched_at
                    .elapsed()
                    .map(|age| age < ttl)
                    .unwrap_or(false)
            {
                return Ok(CatalogResponse {
                    entries: cached.entries.clone(),
                    source: "remote".to_string(),
                    note: None,
                });
            }
        }
    }

    // 远端 + 缓存回落都在阻塞线程里做
    let app2 = app.clone();
    let url2 = url.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || (fetch_remote(&url2, &p), read_cache(&app2)))
            .await
            .map_err(|err| error::io_failed("fetchCatalog", err))?;

    let (remote, cache) = result;

    match remote {
        Ok(entries) => {
            write_cache(&app, &entries);
            *state.inner.lock().unwrap_or_else(|err| err.into_inner()) = Some(CachedCatalog {
                entries: entries.clone(),
                fetched_at: SystemTime::now(),
                url,
            });
            Ok(CatalogResponse {
                entries,
                source: "remote".to_string(),
                note: None,
            })
        }
        Err(err) => {
            if let Some(entries) = cache {
                Ok(CatalogResponse {
                    entries,
                    source: "cache".to_string(),
                    note: Some(error::note(
                        "catalogFallbackCache",
                        &[("err", &err.to_string())],
                    )),
                })
            } else {
                Ok(CatalogResponse {
                    entries: Vec::new(),
                    source: "builtin".to_string(),
                    note: Some(error::note(
                        "catalogFallbackBuiltin",
                        &[("err", &err.to_string())],
                    )),
                })
            }
        }
    }
}

/// 测当前代理配置能否访问 npm registry。返回 Ok(延迟毫秒) 或 Err(原因)。
///
/// 不直接测目录源：目录源可能没配，而 npm 连通性是「代理对不对」的
/// 更普适信号（check_latest_version 也依赖它）。
#[tauri::command]
pub async fn test_network(
    prefs: tauri::State<'_, crate::prefs::PrefsState>,
) -> Result<Result<u128, String>, String> {
    let p = prefs.snapshot();

    let started = SystemTime::now();
    let outcome = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let agent: ureq::Agent = http_agent(&p);
        agent
            .get("https://registry.npmjs.org/@anthropic-ai/claude-code")
            .call()
            .map_err(|err| format!("{err}"))?;
        Ok(())
    })
    .await
    .map_err(|err| error::io_failed("testNetwork", err))?;

    Ok(outcome.map(|_| started.elapsed().map(|d| d.as_millis()).unwrap_or_default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> RemoteEntry {
        RemoteEntry {
            id: id.to_string(),
            name: format!("Name {id}"),
            vendor: "Vendor".to_string(),
            tagline: "tagline".to_string(),
            description: "desc".to_string(),
            initials: "XX".to_string(),
            tags: vec!["t".to_string()],
            homepage: "https://example.com".to_string(),
            docs: "https://example.com/docs".to_string(),
        }
    }

    #[test]
    fn parses_wellformed_catalog() {
        let text = serde_json::to_string(&[entry("claude-code"), entry("workbuddy")]).unwrap();
        let parsed = parse_remote(&text).unwrap();
        assert_eq!(parsed.len(), 2);
    }

    #[test]
    fn drops_unknown_ids_entirely() {
        // 安全边界：远端塞进来的未知 id（哪怕带着恶意字段）不能进入结果
        let text = serde_json::to_string(&[
            entry("claude-code"),
            entry("totally-evil-new-app"),
            entry("../../etc/passwd"),
        ])
        .unwrap();
        let parsed = parse_remote(&text).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "claude-code");
    }

    #[test]
    fn all_unknown_ids_is_failure() {
        let text = serde_json::to_string(&[entry("no-such-app")]).unwrap();
        assert!(parse_remote(&text).is_none());
    }

    #[test]
    fn malformed_json_is_failure() {
        assert!(parse_remote("{ not json").is_none());
        assert!(parse_remote("[]").is_none()); // 空目录没有意义，按失败回落
    }

    #[test]
    fn wrong_shape_is_failure() {
        // RemoteEntry 必填字段缺失（缺 homepage），整条解析失败
        let text = r#"[{"id":"claude-code","name":"x","vendor":"v","tagline":"t","description":"d","initials":"XX","tags":[]}]"#;
        assert!(parse_remote(text).is_none());
    }
}
