//! MCP 宿主 adapter：三个 CLI 各自的 mcpServers / mcp_servers 写入方式。
//!
//! | 宿主 | 文件 | 格式 | 段名 |
//! |---|---|---|---|
//! | Claude Code | ~/.claude.json | JSON | mcpServers |
//! | Codex | ~/.codex/config.toml | TOML（toml_edit 保格式） | mcp_servers |
//! | Gemini CLI | ~/.gemini/settings.json | JSON | mcpServers |
//!
//! 统一的安全边界（与路由宿主同款）：
//! - 只增删自己写的条目：每个宿主一份 managed 清单（`<文件>.cchub-managed`），
//!   用户手写的条目永远不动
//! - 写前备份 `<文件>.cchub.bak`
//! - Codex 用 toml_edit 编辑（保留 marketplaces / plugins 等手写段与注释）

use crate::error;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};
use toml_edit::{value, DocumentMut};

use super::{HostConfig, HostEntry};

/// MCP 宿主 id（与路由宿主对齐）。
pub const MCP_HOSTS: &[&str] = &["claude-code", "codex", "gemini-cli"];

pub fn is_mcp_host(id: &str) -> bool {
    MCP_HOSTS.contains(&id)
}

// ---------------------------------------------------------------- 公共

fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|_| error::err_plain("noHomeDir"))
}

fn backup_path(path: &PathBuf) -> PathBuf {
    let mut s = path.clone().into_os_string();
    s.push(".cchub.bak");
    PathBuf::from(s)
}

fn managed_path(host_file: &PathBuf) -> PathBuf {
    let mut s = host_file.clone().into_os_string();
    s.push(".cchub-managed");
    PathBuf::from(s)
}

fn read_managed(host_file: &PathBuf) -> Vec<String> {
    fs::read_to_string(managed_path(host_file))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_managed(host_file: &PathBuf, names: &[String]) -> Result<(), String> {
    let text = serde_json::to_string(names).map_err(|err| format!("{err}"))?;
    fs::write(managed_path(host_file), text).map_err(|err| error::io_failed("writeManifest", err))
}

/// 写入前备份（有内容才备份）。
fn backup(host_file: &PathBuf) -> Result<(), String> {
    if let Ok(text) = fs::read_to_string(host_file) {
        if !text.is_empty() {
            fs::write(backup_path(host_file), text).map_err(|err| error::io_failed("backup", err))?;
        }
    }
    Ok(())
}

/// 原子写：tmp + rename，失败回落直接写。
fn atomic_write(path: &PathBuf, content: &str, tmp_ext: &str, what: &str) -> Result<(), String> {
    let tmp = path.with_extension(tmp_ext);
    if fs::write(&tmp, content).is_ok() {
        let _ = fs::rename(&tmp, path);
    } else {
        fs::write(path, content).map_err(|err| error::err("writeFailedNamed", &[("what", what), ("err", &err.to_string())]))?;
    }
    Ok(())
}

/// 组装一条 stdio MCP 的 spec JSON（三宿主共形）。
fn build_spec(command: &str, args: &[String], env: BTreeMap<String, String>) -> Value {
    let env_obj: serde_json::Map<String, Value> = env
        .into_iter()
        .map(|(k, v)| (k, json!(v)))
        .collect();
    json!({
        "type": "stdio",
        "command": command,
        "args": args,
        "env": Value::Object(env_obj),
    })
}

/// 从 JSON spec 里取展示用的 command / args（前端 HostEntry.spec 直接给原文）。
fn entries_from_json(root: &Value, managed: &[String], key: &str) -> Vec<HostEntry> {
    let mut entries = Vec::new();
    if let Some(servers) = root.get(key).and_then(Value::as_object) {
        for (name, spec) in servers {
            entries.push(HostEntry {
                name: name.clone(),
                managed: managed.contains(name),
                spec: spec.clone(),
            });
        }
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

// ---------------------------------------------------------------- Claude Code

fn claude_json_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".claude.json"))
}

fn read_claude() -> HostConfig {
    let Ok(path) = claude_json_path() else {
        return HostConfig::default();
    };
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => {
            return HostConfig {
                entries: Vec::new(),
                note: Some(error::note(
                    "hostNotCreated",
                    &[("file", "~/.claude.json"), ("host", "Claude Code")],
                )),
            }
        }
    };
    let root: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(err) => {
            return HostConfig {
                entries: Vec::new(),
                note: Some(error::err(
                    "hostParseFailed",
                    &[("file", "~/.claude.json"), ("err", &err.to_string())],
                )),
            }
        }
    };
    HostConfig {
        entries: entries_from_json(&root, &read_managed(&path), "mcpServers"),
        note: None,
    }
}

fn write_claude(
    name: &str,
    command: &str,
    args: &[String],
    env: BTreeMap<String, String>,
) -> Result<(), String> {
    let path = claude_json_path()?;
    let mut root: Value = fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}));
    if !root.is_object() {
        return Err(error::err("refuseWriteTopLevel", &[("file", "~/.claude.json")]));
    }

    backup(&path)?;

    let servers = root
        .as_object_mut()
        .unwrap()
        .entry("mcpServers".to_string())
        .or_insert_with(|| json!({}));
    if !servers.is_object() {
        return Err(error::err("refuseWriteSection", &[("section", "mcpServers")]));
    }
    servers
        .as_object_mut()
        .unwrap()
        .insert(name.to_string(), build_spec(command, args, env));

    let text =
        serde_json::to_string_pretty(&root).map_err(|err| error::io_failed("serialize", err))?;
    atomic_write(&path, &text, "json.tmp", "~/.claude.json")?;

    let mut managed = read_managed(&path);
    if !managed.iter().any(|n| n == name) {
        managed.push(name.to_string());
        write_managed(&path, &managed)?;
    }
    Ok(())
}

fn remove_claude(name: &str) -> Result<(), String> {
    let path = claude_json_path()?;
    let mut managed = read_managed(&path);
    if !managed.iter().any(|n| n == name) {
        return Err(error::err(
            "hostEntryNotManaged",
            &[("name", name), ("host", "Claude Code")],
        ));
    }

    let mut root: Value = fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .ok_or_else(|| error::err("hostFileUnreadable", &[("file", "~/.claude.json")]))?;

    backup(&path)?;

    if let Some(servers) = root
        .as_object_mut()
        .and_then(|o| o.get_mut("mcpServers"))
        .and_then(Value::as_object_mut)
    {
        servers.remove(name);
    }

    let text =
        serde_json::to_string_pretty(&root).map_err(|err| error::io_failed("serialize", err))?;
    atomic_write(&path, &text, "json.tmp", "~/.claude.json")?;

    managed.retain(|n| n != name);
    write_managed(&path, &managed)?;
    Ok(())
}

// ---------------------------------------------------------------- Gemini CLI

fn gemini_settings_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".gemini").join("settings.json"))
}

fn read_gemini() -> HostConfig {
    let Ok(path) = gemini_settings_path() else {
        return HostConfig::default();
    };
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => {
            return HostConfig {
                entries: Vec::new(),
                note: Some(error::note(
                    "hostNotCreated",
                    &[("file", "~/.gemini/settings.json"), ("host", "Gemini CLI")],
                )),
            }
        }
    };
    let root: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(err) => {
            return HostConfig {
                entries: Vec::new(),
                note: Some(error::err(
                    "hostParseFailed",
                    &[("file", "~/.gemini/settings.json"), ("err", &err.to_string())],
                )),
            }
        }
    };
    HostConfig {
        entries: entries_from_json(&root, &read_managed(&path), "mcpServers"),
        note: None,
    }
}

fn write_gemini(
    name: &str,
    command: &str,
    args: &[String],
    env: BTreeMap<String, String>,
) -> Result<(), String> {
    let path = gemini_settings_path()?;
    let mut root: Value = fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}));
    if !root.is_object() {
        return Err(error::err("refuseWriteTopLevel", &[("file", "~/.gemini/settings.json")]));
    }

    backup(&path)?;

    // Gemini 与 Claude 同形（command/args/env），但官方无 type 字段——
    // 保守起见不写 type（官方示例里没有）
    let env_obj: serde_json::Map<String, Value> = env
        .into_iter()
        .map(|(k, v)| (k, json!(v)))
        .collect();
    let spec = json!({
        "command": command,
        "args": args,
        "env": Value::Object(env_obj),
    });

    let servers = root
        .as_object_mut()
        .unwrap()
        .entry("mcpServers".to_string())
        .or_insert_with(|| json!({}));
    if !servers.is_object() {
        return Err(error::err("refuseWriteSection", &[("section", "mcpServers")]));
    }
    servers
        .as_object_mut()
        .unwrap()
        .insert(name.to_string(), spec);

    let text =
        serde_json::to_string_pretty(&root).map_err(|err| error::io_failed("serialize", err))?;
    atomic_write(&path, &text, "json.tmp", "~/.gemini/settings.json")?;

    let mut managed = read_managed(&path);
    if !managed.iter().any(|n| n == name) {
        managed.push(name.to_string());
        write_managed(&path, &managed)?;
    }
    Ok(())
}

fn remove_gemini(name: &str) -> Result<(), String> {
    let path = gemini_settings_path()?;
    let mut managed = read_managed(&path);
    if !managed.iter().any(|n| n == name) {
        return Err(error::err(
            "hostEntryNotManaged",
            &[("name", name), ("host", "Gemini CLI")],
        ));
    }

    let mut root: Value = fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .ok_or_else(|| error::err("hostFileUnreadable", &[("file", "~/.gemini/settings.json")]))?;

    backup(&path)?;

    if let Some(servers) = root
        .as_object_mut()
        .and_then(|o| o.get_mut("mcpServers"))
        .and_then(Value::as_object_mut)
    {
        servers.remove(name);
    }

    let text =
        serde_json::to_string_pretty(&root).map_err(|err| error::io_failed("serialize", err))?;
    atomic_write(&path, &text, "json.tmp", "~/.gemini/settings.json")?;

    managed.retain(|n| n != name);
    write_managed(&path, &managed)?;
    Ok(())
}

// ---------------------------------------------------------------- Codex

fn codex_config_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".codex").join("config.toml"))
}

/// TOML 的 mcp_servers 段读回 JSON 形 HostEntry（统一前端形状）。
fn read_codex() -> HostConfig {
    let Ok(path) = codex_config_path() else {
        return HostConfig::default();
    };
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => {
            return HostConfig {
                entries: Vec::new(),
                note: Some(error::note(
                    "hostNotCreated",
                    &[("file", "~/.codex/config.toml"), ("host", "Codex")],
                )),
            }
        }
    };
    let Ok(doc) = text.parse::<DocumentMut>() else {
        return HostConfig {
            entries: Vec::new(),
            note: Some(error::err_plain("hostParseFailedPlain")),
        };
    };

    let managed = read_managed(&path);
    let mut entries = Vec::new();
    if let Some(servers) = doc
        .get("mcp_servers")
        .and_then(|item| item.as_table_like())
    {
        for (name, item) in servers.iter() {
            let mut spec = serde_json::Map::new();
            if let Some(t) = item.get("type") {
                spec.insert("type".into(), json!(t.as_str().unwrap_or("stdio")));
            }
            if let Some(cmd) = item.get("command").and_then(|v| v.as_str()) {
                spec.insert("command".into(), json!(cmd));
            }
            if let Some(args) = item.get("args").and_then(|v| v.as_array()) {
                let arr: Vec<Value> = args
                    .iter()
                    .map(|a| json!(a.as_str().unwrap_or_default()))
                    .collect();
                spec.insert("args".into(), Value::Array(arr));
            }
            if let Some(env) = item.get("env").and_then(|v| v.as_table_like()) {
                let map: serde_json::Map<String, Value> = env
                    .iter()
                    .map(|(k, v)| (k.to_string(), json!(v.as_str().unwrap_or_default())))
                    .collect();
                spec.insert("env".into(), Value::Object(map));
            }
            entries.push(HostEntry {
                name: name.to_string(),
                managed: managed.iter().any(|n| n == name),
                spec: Value::Object(spec),
            });
        }
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    HostConfig {
        entries,
        note: None,
    }
}

/// 编辑 Codex config.toml 的 mcp_servers 段（纯函数，单测直接喂字符串）。
pub fn codex_edit_mcp(doc: &mut DocumentMut, name: &str, args: &[String], env: &BTreeMap<String, String>, command: &str) {
    // 确保父表存在
    if doc.get("mcp_servers").is_none() {
        let mut t = toml_edit::Table::new();
        t.set_implicit(true);
        doc["mcp_servers"] = toml_edit::Item::Table(t);
    }
    let mut tbl = doc
        .get("mcp_servers")
        .and_then(|item| item.get(name))
        .and_then(|item| item.as_table())
        .cloned()
        .unwrap_or_default();
    tbl["command"] = value(command);
    // args / env：给了就写，空就删（复用同名段时清掉旧值）
    if args.is_empty() {
        tbl.remove("args");
    } else {
        let arr = toml_edit::Array::from_iter(args.iter());
        tbl["args"] = value(arr);
    }
    if env.is_empty() {
        tbl.remove("env");
    } else {
        let mut env_tbl = toml_edit::Table::new();
        for (k, v) in env {
            env_tbl[k] = value(v.as_str());
        }
        tbl["env"] = toml_edit::Item::Table(env_tbl);
    }
    doc["mcp_servers"][name] = toml_edit::Item::Table(tbl);
}

fn write_codex(
    name: &str,
    command: &str,
    args: &[String],
    env: BTreeMap<String, String>,
) -> Result<(), String> {
    let path = codex_config_path()?;
    let text = fs::read_to_string(&path).unwrap_or_default();

    let mut doc = text
        .parse::<DocumentMut>()
        .map_err(|err| error::err("codexTomlBroken", &[("err", &err.to_string())]))?;

    backup(&path)?;
    codex_edit_mcp(&mut doc, name, args, &env, command);

    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|err| error::io_failed("createCodexDir", err))?;
    }
    atomic_write(&path, &doc.to_string(), "toml.tmp", "~/.codex/config.toml")?;

    let mut managed = read_managed(&path);
    if !managed.iter().any(|n| n == name) {
        managed.push(name.to_string());
        write_managed(&path, &managed)?;
    }
    Ok(())
}

fn remove_codex(name: &str) -> Result<(), String> {
    let path = codex_config_path()?;
    let mut managed = read_managed(&path);
    if !managed.iter().any(|n| n == name) {
        return Err(error::err(
            "hostEntryNotManaged",
            &[("name", name), ("host", "Codex")],
        ));
    }

    let text = fs::read_to_string(&path).unwrap_or_default();
    let mut doc = text
        .parse::<DocumentMut>()
        .map_err(|err| error::err("codexTomlBroken", &[("err", &err.to_string())]))?;

    backup(&path)?;

    if let Some(servers) = doc
        .get_mut("mcp_servers")
        .and_then(|item| item.as_table_like_mut())
    {
        servers.remove(name);
        if servers.is_empty() {
            // 段删空了连父表一起收掉（保持文件干净）
            // toml_edit 的 table_like_mut 借用中不能同时 remove 顶层键，先判空
        }
    }
    // 父表空了 → 收掉顶层键
    if doc
        .get("mcp_servers")
        .and_then(|item| item.as_table_like())
        .map(|t| t.is_empty())
        .unwrap_or(false)
    {
        doc.remove("mcp_servers");
    }

    atomic_write(&path, &doc.to_string(), "toml.tmp", "~/.codex/config.toml")?;

    managed.retain(|n| n != name);
    write_managed(&path, &managed)?;
    Ok(())
}

// ---------------------------------------------------------------- 统一入口

/// 读指定宿主的 MCP 配置。
pub fn read_host(host: &str) -> HostConfig {
    match host {
        "claude-code" => read_claude(),
        "codex" => read_codex(),
        "gemini-cli" => read_gemini(),
        _ => HostConfig {
            entries: Vec::new(),
            note: Some(error::err("unknownHost", &[("host", host)])),
        },
    }
}

/// 把一条服务写进指定宿主。
pub fn write_host(
    host: &str,
    name: &str,
    command: &str,
    args: &[String],
    env: BTreeMap<String, String>,
) -> Result<(), String> {
    match host {
        "claude-code" => write_claude(name, command, args, env),
        "codex" => write_codex(name, command, args, env),
        "gemini-cli" => write_gemini(name, command, args, env),
        other => Err(error::err("unknownHost", &[("host", other)])),
    }
}

/// 从指定宿主移除一条 CCHub 写入的服务。
pub fn remove_host(host: &str, name: &str) -> Result<(), String> {
    match host {
        "claude-code" => remove_claude(name),
        "codex" => remove_codex(name),
        "gemini-cli" => remove_gemini(name),
        other => Err(error::err("unknownHost", &[("host", other)])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_edit_writes_mcp_section_preserving_user_content() {
        let text = r#"model = "gpt-5"
# 用户注释

[mcp_servers.hand_written]
command = "node"
"#;
        let mut doc = text.parse::<DocumentMut>().unwrap();
        let env: BTreeMap<String, String> =
            [("KEY".to_string(), "v".to_string())].into_iter().collect();
        codex_edit_mcp(&mut doc, "fetch", &["-y".into(), "mcp".into()], &env, "npx");

        let out = doc.to_string();
        assert!(out.contains("[mcp_servers.fetch]"), "{out}");
        assert!(out.contains(r#"command = "npx""#), "{out}");
        assert!(out.contains(r#"args = ["-y", "mcp"]"#), "{out}");
        assert!(out.contains("[mcp_servers.fetch.env]"), "{out}");
        // 用户内容原样
        assert!(out.contains("# 用户注释"), "{out}");
        assert!(out.contains("[mcp_servers.hand_written]"), "{out}");
        assert!(out.contains(r#"model = "gpt-5""#), "{out}");
    }

    #[test]
    fn codex_edit_overwrites_same_name_in_place() {
        let text = r#"[mcp_servers.fetch]
command = "old-cmd"
args = ["a"]
"#;
        let mut doc = text.parse::<DocumentMut>().unwrap();
        codex_edit_mcp(&mut doc, "fetch", &[], &Default::default(), "npx");

        let out = doc.to_string();
        assert!(out.contains(r#"command = "npx""#), "{out}");
        assert!(!out.contains("old-cmd"), "{out}");
        // 空 args 不写键
        assert!(!out.contains("args ="), "{out}");
    }

    #[test]
    fn hosts_cover_three_clis() {
        assert_eq!(MCP_HOSTS.len(), 3);
        assert!(is_mcp_host("codex"));
        assert!(!is_mcp_host("trae"));
    }
}
