//! API Key 管理：凭据集中存入系统钥匙串。
//!
//! 设计原则——明文只在两个出口出现：
//! 1. `reveal_key`（用户在 UI 点「显示」）
//! 2. 写入宿主配置（M3 MCP / M5 路由下发时内联展开）
//!
//! 其余所有路径（列表 / 删除 / 测试）都只接触元数据。本地不落任何明文文件；
//! 元数据索引存 app_config_dir/keys-index.json（不含 key 值本身）。
//!
//! keyring v4：macOS Keychain / Windows Credential Manager / Linux Secret Service。
//! 服务名固定 `cchub`，条目名 = `<provider>/<label>`。

use crate::error;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// 钥匙串里的服务名。
const SERVICE: &str = "cchub";

/// 元数据索引文件名。
const INDEX_FILE: &str = "keys-index.json";

/// 支持的 provider 白名单。与 providers.rs 的目录保持一致：
/// 目录是唯一真值，这里只负责钥匙串场景下的类型安全视图。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Provider {
    Anthropic,
    Openai,
    Google,
    Xai,
    Openrouter,
    Glm,
    Deepseek,
    Kimi,
    Minimax,
}

impl Provider {
    pub fn as_str(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::Openai => "openai",
            Provider::Google => "google",
            Provider::Xai => "xai",
            Provider::Openrouter => "openrouter",
            Provider::Glm => "glm",
            Provider::Deepseek => "deepseek",
            Provider::Kimi => "kimi",
            Provider::Minimax => "minimax",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match crate::providers::find(s) {
            Some(_) => Some(match s {
                "anthropic" => Provider::Anthropic,
                "openai" => Provider::Openai,
                "google" => Provider::Google,
                "xai" => Provider::Xai,
                "openrouter" => Provider::Openrouter,
                "glm" => Provider::Glm,
                "deepseek" => Provider::Deepseek,
                "kimi" => Provider::Kimi,
                "minimax" => Provider::Minimax,
                _ => return None,
            }),
            None => None,
        }
    }

    /// 该 provider 的轻量探活端点（带鉴权头）。信息来自 providers 目录。
    pub fn probe_endpoint(self) -> (&'static str, &'static str) {
        let info = crate::providers::find(self.as_str()).expect("Provider 必在目录里");
        (info.probe_endpoint, info.probe_header)
    }

    /// 探活请求方式（GET models / POST messages）。
    pub fn probe_method(self) -> crate::providers::ProbeMethod {
        crate::providers::find(self.as_str())
            .expect("Provider 必在目录里")
            .probe_method
    }

    /// 鉴权头的值。Bearer 型前面要拼 `Bearer `。
    fn auth_value(self, key: &str) -> String {
        let info = crate::providers::find(self.as_str()).expect("Provider 必在目录里");
        if info.bearer_auth {
            format!("Bearer {key}")
        } else {
            key.to_string()
        }
    }
}

/// 一把 key 的元数据（不含明文）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyRef {
    pub provider: String,
    /// 用户起的名字，如 "work-main"、"personal"。 */
    pub label: String,
    /// 添加时间（RFC3339），仅展示用。
    pub added_at: String,
}

/// 元数据索引。损坏 / 缺失就重建（钥匙串里的真值还在，可对账找回）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KeyIndex {
    keys: Vec<KeyRef>,
}

// ---------------------------------------------------------------- 索引读写

fn index_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(INDEX_FILE))
}

fn load_index(app: &AppHandle) -> KeyIndex {
    let Some(path) = index_path(app) else {
        return KeyIndex::default();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn store_index(app: &AppHandle, index: &KeyIndex) -> Result<(), String> {
    let path = index_path(app).ok_or_else(|| error::err_plain("configDirMissing"))?;
    let dir = path
        .parent()
        .ok_or_else(|| error::err_plain("configDirNoParent"))?;
    fs::create_dir_all(dir).map_err(|err| error::io_failed("createConfigDir", err))?;
    let text =
        serde_json::to_string_pretty(index).map_err(|err| error::io_failed("serializeIndex", err))?;
    let tmp = dir.join(format!("{INDEX_FILE}.tmp"));
    fs::write(&tmp, text).map_err(|err| error::io_failed("writeIndex", err))?;
    fs::rename(&tmp, &path).map_err(|err| error::io_failed("saveIndex", err))
}

/// 钥匙串条目名。label 里的 `/` 会破坏唯一性，统一替换掉。
fn entry_name(provider: &str, label: &str) -> String {
    let safe_label = label.replace(['/', '\\'], "_");
    format!("{provider}/{safe_label}")
}

fn entry(provider: &str, label: &str) -> Result<keyring::Entry, String> {
    Provider::parse(provider).ok_or_else(|| error::err("unknownProvider", &[("provider", provider)]))?;
    keyring::Entry::new(SERVICE, &entry_name(provider, label))
        .map_err(|err| error::io_failed("accessKeychain", err))
}

// ---------------------------------------------------------------- 状态

/// 进程内索引缓存（读多写少）。
pub struct KeysState(pub Mutex<KeyIndex>);

impl KeysState {
    pub fn load(app: &AppHandle) -> Self {
        Self(Mutex::new(load_index(app)))
    }
}

// ---------------------------------------------------------------- 命令

/// 已存的 key 引用列表（永不含明文）。
#[tauri::command]
pub fn list_key_refs(state: tauri::State<'_, KeysState>) -> Vec<KeyRef> {
    state
        .0
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .keys
        .clone()
}

/// 保存（新增或覆盖）一把 key。
#[tauri::command]
pub async fn save_key(
    app: AppHandle,
    provider: String,
    label: String,
    value: String,
) -> Result<Vec<KeyRef>, String> {
    if Provider::parse(&provider).is_none() {
        return Err(error::err("unknownProvider", &[("provider", provider.as_str())]));
    }
    if label.trim().is_empty() {
        return Err(error::err_plain("nameRequired"));
    }
    if value.trim().is_empty() {
        return Err(error::err_plain("keyRequired"));
    }

    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<KeysState>();

        entry(&provider, &label)?
            .set_password(value.trim())
            .map_err(|err| error::io_failed("writeKeychain", err))?;

        let mut guard = state.0.lock().unwrap_or_else(|err| err.into_inner());
        // 覆盖语义：同 provider+label 更新 added_at
        let now = now_rfc3339();
        let key_ref = KeyRef {
            provider: provider.clone(),
            label: label.trim().to_string(),
            added_at: now,
        };
        guard
            .keys
            .retain(|k| !(k.provider == key_ref.provider && k.label == key_ref.label));
        guard.keys.push(key_ref);
        let keys = guard.keys.clone();
        drop(guard);

        store_index(&app, &KeyIndex { keys: keys.clone() })?;
        Ok(keys)
    })
    .await
    .map_err(|err| error::io_failed("task", err))?
}

/// 删除一把 key（钥匙串 + 索引）。
#[tauri::command]
pub async fn delete_key(
    app: AppHandle,
    provider: String,
    label: String,
) -> Result<Vec<KeyRef>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<KeysState>();

        // 钥匙串里没有这条不算错（索引先删了、钥匙串手动清了），幂等删除
        match entry(&provider, &label) {
            Ok(e) => {
                if let Err(err) = e.delete_credential() {
                    use keyring::Error as KeyringError;
                    if !matches!(err, KeyringError::NoEntry) {
                        return Err(error::io_failed("deleteKeychain", err));
                    }
                }
            }
            Err(err) => return Err(err),
        }

        let mut guard = state.0.lock().unwrap_or_else(|err| err.into_inner());
        guard
            .keys
            .retain(|k| !(k.provider == provider && k.label == label));
        let keys = guard.keys.clone();
        drop(guard);

        store_index(&app, &KeyIndex { keys: keys.clone() })?;
        Ok(keys)
    })
    .await
    .map_err(|err| error::io_failed("task", err))?
}

/// 显示明文。仅设置页「显示」按钮调用。
#[tauri::command]
pub async fn reveal_key(provider: String, label: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || reveal_key_sync(&provider, &label))
        .await
        .map_err(|err| error::io_failed("task", err))?
}

/// 同步读取明文。M3/M5 写宿主配置时展开 keychain 引用用。
pub fn reveal_key_sync(provider: &str, label: &str) -> Result<String, String> {
    entry(provider, label)?
        .get_password()
        .map_err(|err| error::io_failed("readKeychain", err))
}

/// 测试 key 连通性：按目录声明的探活方式（GET models / POST messages）。
#[tauri::command]
pub async fn test_key(provider: String, label: String) -> Result<Result<u128, String>, String> {
    let p = Provider::parse(&provider).ok_or_else(|| error::err("unknownProvider", &[("provider", provider.as_str())]))?;

    tauri::async_runtime::spawn_blocking(move || -> Result<Result<u128, String>, String> {
        let key = entry(&provider, &label)?
            .get_password()
            .map_err(|err| error::io_failed("readKeychain", err))?;

        let (url, header) = p.probe_endpoint();
        let method = p.probe_method();
        let agent: ureq::Agent = crate::catalog_source::http_agent_for_prefs();
        let started = std::time::SystemTime::now();

        let response = match method {
            crate::providers::ProbeMethod::Get => {
                agent.get(url).header(header, p.auth_value(&key)).call()
            }
            // 最小 messages 请求：只要服务端肯应答（无论 2xx / 4xx）就证明
            // 网络与 key 格式链路通了；401/403 在下面统一判 key 无效
            crate::providers::ProbeMethod::Post => agent
                .post(url)
                .header(header, p.auth_value(&key))
                .send_json(serde_json::json!({
                    "model": "probe",
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "hi"}],
                })),
        };

        match response {
            Ok(_) => {
                let ms = started.elapsed().map(|d| d.as_millis()).unwrap_or_default();
                Ok(Ok(ms))
            }
            Err(err) => {
                let msg = format!("{err}");
                // 401/403 = key 无效但网络通；其余按网络/服务问题报
                if msg.contains("401") || msg.contains("403") {
                    Ok(Err(error::err_plain("keyRejected")))
                } else if method == crate::providers::ProbeMethod::Post
                    && (msg.contains("404") || msg.contains("405"))
                {
                    Ok(Err(error::err(
                        "probeMethodUnsupported",
                        &[("msg", msg.as_str())],
                    )))
                } else {
                    Ok(Err(error::err("requestFailed", &[("msg", msg.as_str())])))
                }
            }
        }
    })
    .await
    .map_err(|err| error::io_failed("task", err))?
}

/// RFC3339 时间戳（routes.rs 存预设的 added_at 用）。
pub fn now_rfc3339() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map(|secs| {
            // 简易 RFC3339（UTC）。不引 chrono：只为展示，不参与逻辑判断。
            let days = secs / 86400;
            let rem = secs % 86400;
            let (hour, min, sec) = (rem / 3600, (rem % 3600) / 60, rem % 60);
            // 1970-01-01 起的天数转年月日（ civile 算法，Howard Hinnant）
            let z = days as i64 + 719_468;
            let era = z.div_euclid(146_097);
            let doe = z.rem_euclid(146_097);
            let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
            let y = yoe + era * 400;
            let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
            let mp = (5 * doy + 2) / 153;
            let d = doy - (153 * mp + 2) / 5 + 1;
            let m = if mp < 10 { mp + 3 } else { mp - 9 };
            let y = if m <= 2 { y + 1 } else { y };
            format!("{y:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}Z")
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_roundtrip() {
        for p in [
            Provider::Anthropic,
            Provider::Openai,
            Provider::Google,
            Provider::Xai,
            Provider::Openrouter,
            Provider::Glm,
            Provider::Deepseek,
            Provider::Kimi,
            Provider::Minimax,
        ] {
            assert_eq!(Provider::parse(p.as_str()), Some(p));
        }
        assert_eq!(Provider::parse("nope"), None);
    }

    #[test]
    fn providers_catalog_covers_every_variant() {
        // enum 与目录必须一一对应：目录里每个 id 都 parse 得到，
        // 反过来每个 variant 都在目录里（否则 probe_endpoint 会 panic）
        for info in crate::providers::PROVIDERS {
            assert!(Provider::parse(info.id).is_some(), "目录多出 {}", info.id);
        }
        for p in [
            Provider::Anthropic,
            Provider::Openai,
            Provider::Google,
            Provider::Xai,
            Provider::Openrouter,
            Provider::Glm,
            Provider::Deepseek,
            Provider::Kimi,
            Provider::Minimax,
        ] {
            assert!(
                crate::providers::find(p.as_str()).is_some(),
                "enum 多出 {}",
                p.as_str()
            );
        }
    }

    #[test]
    fn entry_name_sanitizes_slashes() {
        assert_eq!(entry_name("anthropic", "a/b"), "anthropic/a_b");
        assert_eq!(entry_name("openai", "个人\\key"), "openai/个人_key");
    }

    #[test]
    fn auth_value_bearer_or_raw() {
        assert_eq!(Provider::Anthropic.auth_value("sk-1"), "sk-1");
        assert_eq!(Provider::Openai.auth_value("sk-1"), "Bearer sk-1");
    }

    #[test]
    fn rfc3339_shape() {
        let s = now_rfc3339();
        assert_eq!(s.len(), 20, "{s}");
        assert!(s.ends_with('Z'));
        assert_eq!(&s[4..5], "-");
        assert_eq!(&s[10..11], "T");
    }
}
