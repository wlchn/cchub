//! Claude Code 宿主 adapter：写 `~/.claude/settings.json` 的 env 段。
//!
//! 下发内容：
//! - `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`（基础路由）
//! - `ANTHROPIC_DEFAULT_OPUS_MODEL` / `..._SONNET_MODEL` / `..._HAIKU_MODEL`
//!   （可选的模型档位映射；用户本机真实在用的能力）
//!
//! 安全边界：
//! - 用户 settings.json 的 env 段里可能有大量非 CCHub 管理的键（如
//!   ANTHROPIC_DEFAULT_FABLE_MODEL、CLAUDE_CODE_AUTO_COMPACT_WINDOW）。
//!   CCHub 每次写入哪些键记在 managed 清单里，清除时只删自己写过的键。
//! - 写前备份 `settings.json.cchub.bak`。

use crate::error;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::{home_dir, HostState, RouteRule};
use crate::mcp;

/// CCHub 在 Claude Code env 段里可能写的全部键（managed 清单校验用）。
const MANAGED_KEYS: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
];

fn settings_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".claude").join("settings.json"))
}

fn backup_path(settings: &Path) -> PathBuf {
    let mut s = settings.to_path_buf().into_os_string();
    s.push(".cchub.bak");
    PathBuf::from(s)
}

fn managed_list_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".claude").join("settings.json.cchub-managed"))
}

fn read_managed() -> BTreeSet<String> {
    managed_list_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .map(|v| v.into_iter().collect())
        .unwrap_or_default()
}

fn write_managed(names: &BTreeSet<String>) -> Result<(), String> {
    let path = managed_list_path()?;
    let text = serde_json::to_string(&names).map_err(|err| format!("{err}"))?;
    fs::write(&path, text).map_err(|err| error::io_failed("writeManifest", err))
}

/// 读 Claude Code 当前生效的路由配置（只读，不写）。
pub fn read_state() -> HostState {
    let Ok(settings) = settings_path() else {
        return HostState::default();
    };
    let Ok(text) = fs::read_to_string(&settings) else {
        return HostState {
            readable: false,
            ..Default::default()
        };
    };
    let Ok(root) = serde_json::from_str::<Value>(&text) else {
        return HostState {
            readable: false,
            ..Default::default()
        };
    };
    let empty = serde_json::Map::new();
    let env = root.get("env").and_then(Value::as_object).unwrap_or(&empty);

    let base_url = env
        .get("ANTHROPIC_BASE_URL")
        .and_then(Value::as_str)
        .map(str::to_string);
    // key 指纹：长度 + 前 6 位（判断「换了没」，不暴露明文）
    let key_fingerprint = env
        .get("ANTHROPIC_AUTH_TOKEN")
        .and_then(Value::as_str)
        .map(|k| format!("{}…{}", &k[..k.len().min(4)], k.len()));

    let mut model_mappings = std::collections::BTreeMap::new();
    for (env_key, field) in [
        ("ANTHROPIC_DEFAULT_OPUS_MODEL", "opus"),
        ("ANTHROPIC_DEFAULT_SONNET_MODEL", "sonnet"),
        ("ANTHROPIC_DEFAULT_HAIKU_MODEL", "haiku"),
    ] {
        if let Some(v) = env.get(env_key).and_then(Value::as_str) {
            model_mappings.insert(field.to_string(), v.to_string());
        }
    }

    HostState {
        base_url,
        key_fingerprint,
        model_mappings,
        readable: true,
    }
}

/// 把规则下发到 Claude Code（或清除：rule = None）。
pub fn apply(rule: Option<&RouteRule>) -> Result<String, String> {
    let settings = settings_path()?;

    // 读现值（不存在从空对象开始）
    let mut root: Value = fs::read_to_string(&settings)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}));
    if !root.is_object() {
        return Err(error::err("refuseWriteTopLevel", &[("file", "~/.claude/settings.json")]));
    }

    // 备份
    if let Ok(text) = fs::read_to_string(&settings) {
        fs::write(backup_path(&settings), text)
            .map_err(|err| error::io_failed("backup", err))?;
    }

    let obj = root.as_object_mut().unwrap();
    let env = obj.entry("env".to_string()).or_insert_with(|| json!({}));
    if !env.is_object() {
        return Err(error::err("refuseWriteSection", &[("section", "env")]));
    }
    let env = env.as_object_mut().unwrap();

    // 只清自己写过的键：managed 清单 ∩ 本次范围
    let managed = read_managed();
    for key in &managed {
        if MANAGED_KEYS.contains(&key.as_str()) {
            env.remove(key);
        }
    }

    // 写入
    let mut written: BTreeSet<String> = BTreeSet::new();
    match rule {
        Some(rule) => {
            // 展开 key 引用（明文只在这一步从钥匙串出来，直接进宿主配置）
            let key = mcp::resolve_env_value(&rule.key_ref)?;
            env.insert("ANTHROPIC_BASE_URL".into(), json!(rule.base_url));
            env.insert("ANTHROPIC_AUTH_TOKEN".into(), json!(key));
            written.insert("ANTHROPIC_BASE_URL".into());
            written.insert("ANTHROPIC_AUTH_TOKEN".into());

            for (field, env_key) in [
                (&rule.model_opus, "ANTHROPIC_DEFAULT_OPUS_MODEL"),
                (&rule.model_sonnet, "ANTHROPIC_DEFAULT_SONNET_MODEL"),
                (&rule.model_haiku, "ANTHROPIC_DEFAULT_HAIKU_MODEL"),
            ] {
                if let Some(model) = field.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
                    env.insert(env_key.into(), json!(model));
                    written.insert(env_key.into());
                }
            }
        }
        None => {
            // 清除模式：上面已经按 managed 清单删过了
        }
    }

    let text =
        serde_json::to_string_pretty(&root).map_err(|err| error::io_failed("serialize", err))?;
    let tmp = settings.with_extension("json.tmp");
    if fs::write(&tmp, &text).is_ok() {
        let _ = fs::rename(&tmp, &settings);
    } else {
        fs::write(&settings, text).map_err(|err| error::io_failed("writeSettings", err))?;
    }

    write_managed(&written)?;

    Ok(match rule {
        Some(r) => error::note(
            "routeApplied",
            &[("host", "Claude Code"), ("name", &r.name), ("url", &r.base_url)],
        ),
        None => error::note("routeCleared", &[("host", "Claude Code")]),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_keys_are_a_safe_subset() {
        // managed 清单可写的键必须是白名单里的——将来扩字段时防止把
        // 用户手写键误纳管
        for key in MANAGED_KEYS {
            assert!(key.starts_with("ANTHROPIC_"), "{key} 不在 ANTHROPIC_ 命名域");
        }
        // 白名单内不得出现用户常见手写键（FABLE 档位映射不由 CCHub 管）
        assert!(!MANAGED_KEYS.contains(&"ANTHROPIC_DEFAULT_FABLE_MODEL"));
    }

    #[test]
    fn managed_roundtrip_filter() {
        // managed 清单与白名单求交集的纯逻辑
        let managed: BTreeSet<String> =
            ["ANTHROPIC_BASE_URL".to_string(), "USER_KEY".to_string()]
                .into_iter()
                .collect();
        let filtered: Vec<String> = managed
            .iter()
            .filter(|k| MANAGED_KEYS.contains(&k.as_str()))
            .cloned()
            .collect();
        assert_eq!(filtered, vec!["ANTHROPIC_BASE_URL".to_string()]);
    }
}
