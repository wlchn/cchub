//! Codex 宿主 adapter：写 `~/.codex/config.toml` + `~/.codex/auth.json`。
//!
//! 分工（Codex 官方约定）：
//! - `config.toml`：顶层 `model_provider` + `model`，以及
//!   `[model_providers.<id>]` 段（name / base_url / env_key）
//! - `auth.json`：`OPENAI_API_KEY` 字段存 key
//!
//! 安全边界：
//! - config.toml 用 toml_edit 编辑（保留用户手写的 marketplaces / plugins /
//!   mcp_servers 等段与注释），只动 CCHub 前缀的 provider 段与顶层两个键
//! - auth.json 里的 OAuth tokens / auth_mode / last_refresh 永远不动——
//!   只读改 `OPENAI_API_KEY` 一个字段再写回
//! - 两个文件写前各自备份 `.cchub.bak`
//!
//! Codex 官方对第三方 provider 的认证方式是 `env_key = "OPENAI_API_KEY"`
//! （读 auth.json 的同名字段），所以 key 从钥匙串展开后写进 auth.json。

use crate::error;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(test)]
use serde_json::Map;
use serde_json::{json, Value};
use toml_edit::{value, DocumentMut};

use super::{home_dir, HostState, RouteRule};
use crate::mcp;

/// CCHub 写入 config.toml 的 provider 段前缀（只删自己写的段）。
const PROVIDER_PREFIX: &str = "cchub_";

fn provider_key(provider: &str) -> String {
    // provider id 已经是白名单字符（providers.rs 目录），直接拼
    format!("{PROVIDER_PREFIX}{provider}")
}

fn codex_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".codex"))
}

fn config_path() -> Result<PathBuf, String> {
    Ok(codex_dir()?.join("config.toml"))
}

fn auth_path() -> Result<PathBuf, String> {
    Ok(codex_dir()?.join("auth.json"))
}

fn backup_path(path: &Path) -> PathBuf {
    let mut s = path.to_path_buf().into_os_string();
    s.push(".cchub.bak");
    PathBuf::from(s)
}

// ---------------------------------------------------------------- config.toml

/// 编辑 config.toml 文档的纯函数（单测直接喂字符串）。
/// rule = None 时清除 CCHub 写过的一切痕迹。
pub fn edit_config(doc: &mut DocumentMut, rule: Option<&RouteRule>) {
    match rule {
        Some(rule) => {
            let key = provider_key(&rule.provider);
            doc["model_provider"] = value(key.as_str());
            if let Some(model) = rule.model.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
                doc["model"] = value(model);
            } else {
                doc.remove("model");
            }

            // 确保 model_providers 父表存在（不隐性打印表头，由子表带出）
            if doc.get("model_providers").is_none() {
                let mut t = toml_edit::Table::new();
                t.set_implicit(true);
                doc["model_providers"] = toml_edit::Item::Table(t);
            }

            // provider 段：存在就复用（原地改字段），不存在新建
            let mut tbl: toml_edit::Table = doc
                .get("model_providers")
                .and_then(|item| item.get(&key))
                .and_then(|item| item.as_table())
                .cloned()
                .unwrap_or_else(toml_edit::Table::new);
            tbl["name"] = value(rule.name.as_str());
            tbl["base_url"] = value(rule.base_url.as_str());
            tbl["env_key"] = value("OPENAI_API_KEY");
            // 请求协议：responses 显式写；chat 是 Codex 默认，不写键
            //（保持 config.toml 最小化；回读侧 None 视作 chat）
            match rule.wire_api.as_deref().map(str::trim) {
                Some("responses") => tbl["wire_api"] = value("responses"),
                _ => {
                    tbl.remove("wire_api");
                }
            }
            doc["model_providers"][&key] = toml_edit::Item::Table(tbl);
        }
        None => {
            // 清除：顶层两键 + model_providers 下自己前缀的段。
            // 顶层 model_provider 指向我们才删（用户手写指向其他 provider 的不动）。
            let ours = doc
                .get("model_provider")
                .and_then(|v| v.as_str())
                .map(|s| s.starts_with(PROVIDER_PREFIX))
                .unwrap_or(false);
            if ours {
                doc.remove("model_provider");
            }
            if let Some(providers) = doc
                .get_mut("model_providers")
                .and_then(|item| item.as_table_like_mut())
            {
                let keys: Vec<String> = providers
                    .iter()
                    .filter(|(k, _)| k.starts_with(PROVIDER_PREFIX))
                    .map(|(k, _)| k.to_string())
                    .collect();
                for k in keys {
                    providers.remove(&k);
                }
                // 段删空了连父表一起收掉
                if providers.is_empty() {
                    doc.remove("model_providers");
                }
            }
            // model 键：只有我们删了 model_provider 时才一并删
            // （用户手写 model + 手写 provider 的组合保持原样）
            if ours {
                doc.remove("model");
            }
        }
    }
}

fn apply_config(rule: Option<&RouteRule>) -> Result<(), String> {
    let path = config_path()?;
    let text = fs::read_to_string(&path).unwrap_or_default();

    // 解析失败 = 用户手写的 TOML 有语法问题，绝不能盲目覆盖——直接报错
    let mut doc = text
        .parse::<DocumentMut>()
        .map_err(|err| error::err("codexTomlBroken", &[("err", &err.to_string())]))?;

    // 备份（有内容才备份）
    if !text.is_empty() {
        fs::write(backup_path(&path), &text).map_err(|err| error::io_failed("backup", err))?;
    }

    edit_config(&mut doc, rule);

    fs::create_dir_all(codex_dir()?).map_err(|err| error::io_failed("createCodexDir", err))?;
    let tmp = path.with_extension("toml.tmp");
    if fs::write(&tmp, doc.to_string()).is_ok() {
        let _ = fs::rename(&tmp, &path);
    } else {
        fs::write(&path, doc.to_string())
            .map_err(|err| error::io_failed("writeCodexConfig", err))?;
    }
    Ok(())
}

// ---------------------------------------------------------------- auth.json

/// 读改写 auth.json 的 OPENAI_API_KEY 字段（其余字段原样保留）。
/// None = 删除该字段（回到官方 OAuth 模式）。
fn apply_auth(rule: Option<&RouteRule>) -> Result<(), String> {
    let path = auth_path()?;

    // 读现值；不存在 / 损坏时从空对象开始——但损坏时直接报错更安全
    // （auth.json 里有 OAuth tokens，覆盖会丢失登录态）
    let text = fs::read_to_string(&path);
    let mut root: Value = match &text {
        Ok(t) if !t.trim().is_empty() => serde_json::from_str(t).map_err(|err| {
            format!("~/.codex/auth.json 解析失败（{err}），拒绝写入以免丢失登录态")
        })?,
        _ => json!({}),
    };
    if !root.is_object() {
        return Err(error::err("refuseWriteTopLevel", &[("file", "~/.codex/auth.json")]));
    }

    // 备份（有原文才备份）
    if let Ok(t) = &text {
        if !t.trim().is_empty() {
            fs::write(backup_path(&path), t).map_err(|err| error::io_failed("backup", err))?;
        }
    }

    let obj = root.as_object_mut().unwrap();
    match rule {
        Some(rule) => {
            // 展开 key 引用（明文只在这一步从钥匙串出来）
            let key = mcp::resolve_env_value(&rule.key_ref)?;
            obj.insert("OPENAI_API_KEY".into(), json!(key));
        }
        None => {
            obj.remove("OPENAI_API_KEY");
        }
    }

    let new_text =
        serde_json::to_string_pretty(&root).map_err(|err| error::io_failed("serialize", err))?;
    fs::create_dir_all(codex_dir()?).map_err(|err| error::io_failed("createCodexDir", err))?;
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, &new_text).is_ok() {
        let _ = fs::rename(&tmp, &path);
    } else {
        fs::write(&path, &new_text).map_err(|err| error::io_failed("writeCodexAuth", err))?;
    }
    Ok(())
}

// ---------------------------------------------------------------- 回读

/// 读 Codex 当前生效的路由配置（只读，不写）。
pub fn read_state() -> HostState {
    let config = match config_path().ok().and_then(|p| fs::read_to_string(p).ok()) {
        Some(t) => t,
        None => {
            return HostState {
                readable: false,
                ..Default::default()
            }
        }
    };
    let Ok(doc) = config.parse::<DocumentMut>() else {
        return HostState {
            readable: false,
            ..Default::default()
        };
    };

    // 顶层 model_provider 指向我们的段才算「我们下发的」
    let provider = doc
        .get("model_provider")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let is_ours = provider
        .as_deref()
        .map(|s| s.starts_with(PROVIDER_PREFIX))
        .unwrap_or(false);

    let base_url = if is_ours {
        provider
            .as_deref()
            .and_then(|key| doc.get("model_providers").and_then(|mp| mp.get(key)))
            .and_then(|item| item.get("base_url"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    } else {
        None
    };

    // 激活段里的 wire_api；缺省键 = Codex 默认 chat
    let wire_api = if is_ours {
        provider
            .as_deref()
            .and_then(|key| doc.get("model_providers").and_then(|mp| mp.get(key)))
            .and_then(|item| item.get("wire_api"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    } else {
        None
    };

    let model = doc
        .get("model")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let mut model_mappings = std::collections::BTreeMap::new();
    if let Some(m) = model {
        model_mappings.insert("model".to_string(), m);
    }
    if let Some(api) = wire_api {
        model_mappings.insert("wireApi".to_string(), api);
    }

    // auth.json 的 key 指纹
    let key_fingerprint = auth_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| {
            v.get("OPENAI_API_KEY")
                .and_then(Value::as_str)
                .map(|k| format!("{}…{}", &k[..k.len().min(4)], k.len()))
        });

    HostState {
        base_url,
        key_fingerprint,
        model_mappings,
        readable: true,
    }
}

// ---------------------------------------------------------------- 入口

/// 把规则下发到 Codex（或清除：rule = None）。
/// 顺序：先 auth.json 后 config.toml——config 是开关，key 先就位再切换更安全。
pub fn apply(rule: Option<&RouteRule>) -> Result<String, String> {
    apply_auth(rule)?;
    apply_config(rule)?;

    Ok(match rule {
        Some(r) => error::note(
            "routeApplied",
            &[("host", "Codex"), ("name", &r.name), ("url", &r.base_url)],
        ),
        None => error::note("routeCleared", &[("host", "Codex")]),
    })
}

/// auth.json 保留字段集合（单测用）：除了 OPENAI_API_KEY 之外的都不该被改动。
#[cfg(test)]
fn auth_preserved_fields(root: &Value) -> Vec<&str> {
    root.as_object()
        .map(Map::keys)
        .map(|keys| keys.map(|k| k.as_str()).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rule(provider: &str, model: &str) -> RouteRule {
        RouteRule {
            id: "t1".into(),
            app: "codex".into(),
            name: "测试供应商".into(),
            provider: provider.into(),
            base_url: "https://api.example.com/v1".into(),
            key_ref: "@keychain:glm/main".into(),
            model: Some(model.into()),
            wire_api: None,
            model_opus: None,
            model_sonnet: None,
            model_haiku: None,
            added_at: String::new(),
        }
    }

    #[test]
    fn writes_provider_section_and_top_keys() {
        let text = r##"# 用户注释
model_reasoning_effort = "medium"

[mcp_servers.node_repl]
command = "node"
"##;
        let mut doc = text.parse::<DocumentMut>().unwrap();
        edit_config(&mut doc, Some(&rule("glm", "glm-5.2")));

        let out = doc.to_string();
        assert!(out.contains(r#"model_provider = "cchub_glm""#), "{out}");
        assert!(out.contains(r#"model = "glm-5.2""#), "{out}");
        assert!(out.contains("[model_providers.cchub_glm]"), "{out}");
        assert!(out.contains(r#"base_url = "https://api.example.com/v1""#), "{out}");
        assert!(out.contains(r#"env_key = "OPENAI_API_KEY""#), "{out}");
        // 用户手写内容必须原样保留
        assert!(out.contains("# 用户注释"), "{out}");
        assert!(out.contains(r#"model_reasoning_effort = "medium""#), "{out}");
        assert!(out.contains("[mcp_servers.node_repl]"), "{out}");
    }

    #[test]
    fn clear_removes_only_our_sections() {
        let text = r##"model_provider = "cchub_glm"
model = "glm-5.2"

[model_providers.cchub_glm]
name = "GLM"
base_url = "https://api.example.com/v1"
env_key = "OPENAI_API_KEY"

[model_providers.my_own]
name = "手写"
base_url = "https://hand-written.example.com"
"##;
        let mut doc = text.parse::<DocumentMut>().unwrap();
        edit_config(&mut doc, None);

        let out = doc.to_string();
        assert!(!out.contains("cchub_glm"), "{out}");
        assert!(!out.contains(r#"model = "glm-5.2""#), "{out}");
        // 用户手写的 provider 段不动
        assert!(out.contains("[model_providers.my_own]"), "{out}");
    }

    #[test]
    fn clear_keeps_user_owned_model_provider() {
        // model_provider 指向用户自己的 provider：整段不动
        let text = r#"model_provider = "my_own"
model = "custom-model"

[model_providers.my_own]
name = "手写"
"#;
        let mut doc = text.parse::<DocumentMut>().unwrap();
        edit_config(&mut doc, None);

        let out = doc.to_string();
        assert!(out.contains(r#"model_provider = "my_own""#), "{out}");
        assert!(out.contains(r#"model = "custom-model""#), "{out}");
    }

    #[test]
    fn switch_between_providers_replaces_section() {
        let mut doc = DocumentMut::new();
        edit_config(&mut doc, Some(&rule("glm", "glm-5.2")));
        let first = doc.to_string();
        assert!(first.contains("cchub_glm"));

        // 切换到另一家：新段写入，旧段清除（None）后重写
        edit_config(&mut doc, None);
        edit_config(&mut doc, Some(&rule("deepseek", "deepseek-flash")));
        let second = doc.to_string();
        assert!(!second.contains("cchub_glm"), "{second}");
        assert!(second.contains("cchub_deepseek"), "{second}");
    }

    #[test]
    fn rule_without_model_clears_model_key() {
        let mut doc = DocumentMut::new();
        edit_config(&mut doc, Some(&rule("glm", "glm-5.2")));
        let mut r = rule("glm", "");
        r.model = None;
        edit_config(&mut doc, Some(&r));
        let out = doc.to_string();
        assert!(!out.contains("\nmodel = "), "{out}");
    }

    #[test]
    fn wire_api_responses_is_written() {
        let mut r = rule("openai", "gpt-5.2");
        r.wire_api = Some("responses".into());
        let mut doc = DocumentMut::new();
        edit_config(&mut doc, Some(&r));
        let out = doc.to_string();
        assert!(out.contains(r#"wire_api = "responses""#), "{out}");
    }

    #[test]
    fn wire_api_chat_omits_key() {
        // chat 是 Codex 默认协议：不写键，config.toml 保持最小
        let mut r = rule("openai", "gpt-5.2");
        r.wire_api = Some("chat".into());
        let mut doc = DocumentMut::new();
        edit_config(&mut doc, Some(&r));
        assert!(!doc.to_string().contains("wire_api"), "{}", doc.to_string());
    }

    #[test]
    fn wire_api_removed_when_switched_back() {
        // 先下发 responses，再切回 chat：旧键必须被清掉
        let mut responses = rule("openai", "gpt-5.2");
        responses.wire_api = Some("responses".into());
        let mut doc = DocumentMut::new();
        edit_config(&mut doc, Some(&responses));
        assert!(doc.to_string().contains("wire_api"));

        let mut chat = rule("openai", "gpt-5.2");
        chat.wire_api = Some("chat".into());
        edit_config(&mut doc, Some(&chat));
        assert!(!doc.to_string().contains("wire_api"), "{}", doc.to_string());
    }

    #[test]
    fn auth_edit_only_touches_openai_key() {
        // 模拟 apply_auth 对 root 的字段操作（纯逻辑部分）
        let mut root = json!({
            "auth_mode": "chatgpt",
            "OPENAI_API_KEY": "old-key",
            "tokens": {"id_token": "x", "access_token": "y", "refresh_token": "z", "account_id": "a"},
            "last_refresh": "2026-09-01T00:00:00Z"
        });
        let before: Vec<String> = root
            .as_object()
            .unwrap()
            .keys()
            .map(|k| k.to_string())
            .collect();

        // 模拟写入：只动 OPENAI_API_KEY
        root.as_object_mut()
            .unwrap()
            .insert("OPENAI_API_KEY".into(), json!("new-key"));
        let after = auth_preserved_fields(&root);

        assert_eq!(before, after); // 字段集合不变
        assert_eq!(root["OPENAI_API_KEY"], json!("new-key"));
        assert_eq!(root["tokens"]["refresh_token"], json!("z")); // tokens 原样
    }

    #[test]
    fn provider_key_is_prefixed() {
        assert_eq!(provider_key("glm"), "cchub_glm");
        assert!(provider_key("deepseek").starts_with(PROVIDER_PREFIX));
    }
}
