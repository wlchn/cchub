//! Gemini CLI 宿主 adapter：写 `~/.gemini/.env`。
//!
//! Gemini CLI 的第三方端点机制（官方源码确认）：
//! - `GEMINI_API_KEY`：API key（从 ~/.gemini/.env 加载，在 auth 白名单里）
//! - `GOOGLE_GEMINI_BASE_URL`：自定义 base URL（进程环境变量，dotenv 同样注入）
//!
//! 安全边界：
//! - .env 是行式 dotenv 格式，逐行编辑：只替换 CCHub 管理的两个键，
//!   用户的其他 env 行原样保留（不整份重写）
//! - 写前备份 `.cchub.bak`
//! - 清除 = 删掉自己写的两行，其他行不动

use crate::error;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use super::{home_dir, HostState, RouteRule};
use crate::mcp;

/// CCHub 管理的两个键。
const MANAGED_KEYS: &[&str] = &["GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL"];

fn env_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".gemini").join(".env"))
}

fn backup_path(path: &Path) -> PathBuf {
    let mut s = path.to_path_buf().into_os_string();
    s.push(".cchub.bak");
    PathBuf::from(s)
}

/// dotenv 行解析（纯函数，单测直接喂字符串）。
/// 返回每行的 (键名, 是否是我们管理的键)。注释 / 空行 / 畸形行的键名为 None。
fn parse_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let (key, value) = trimmed.split_once('=')?;
    Some((key.trim().to_string(), value.trim().to_string()))
}

/// 生成 / 更新 .env 内容（纯函数）。
/// rule = Some：写入两个键（已有行替换，没有则追加）；
/// rule = None：删除自己写的两行，其余原样。
pub fn render_env(current: &str, rule: Option<&RouteRule>) -> Result<String, String> {
    let mut lines: Vec<String> = current.lines().map(|l| l.to_string()).collect();

    // 写入模式下要设置的两个键值；清除模式下为空 map
    let mut desired: BTreeMap<String, String> = BTreeMap::new();
    if let Some(rule) = rule {
        // 展开 key 引用（明文只在这一步从钥匙串出来）
        let key = mcp::resolve_env_value(&rule.key_ref)?;
        desired.insert("GEMINI_API_KEY".to_string(), key);
        desired.insert("GOOGLE_GEMINI_BASE_URL".to_string(), rule.base_url.clone());
    }

    // 逐行处理：是我们管理的键 → 替换或删除；其他行原样
    for line in lines.iter_mut() {
        let Some((k, _)) = parse_line(line) else {
            continue;
        };
        if !MANAGED_KEYS.contains(&k.as_str()) {
            continue;
        }
        match desired.get(&k) {
            Some(v) => *line = format!("{k}={v}"),
            None => *line = String::new(), // 清除模式：标记删除
        }
    }

    // 追加 desired 里没在文件中出现过的键
    let present: BTreeSet<String> = lines
        .iter()
        .filter_map(|l| parse_line(l).map(|(k, _)| k))
        .collect();
    for (k, v) in &desired {
        if !present.contains(k) {
            lines.push(format!("{k}={v}"));
        }
    }

    // 过滤空行（含清除标记与原文件就有的空行——dotenv 不在乎空行）
    let mut out = lines
        .into_iter()
        .filter(|l| !l.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    Ok(out)
}

// ---------------------------------------------------------------- 回读

/// 读 Gemini CLI 当前生效的路由配置（只读 .env，不写）。
pub fn read_state() -> HostState {
    let Ok(path) = env_path() else {
        return HostState::default();
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return HostState {
            readable: false,
            ..Default::default()
        };
    };

    let mut base_url = None;
    let mut key_fingerprint = None;
    for line in text.lines() {
        if let Some((k, v)) = parse_line(line) {
            match k.as_str() {
                "GOOGLE_GEMINI_BASE_URL" => base_url = Some(v),
                "GEMINI_API_KEY" => {
                    key_fingerprint =
                        Some(format!("{}…{}", &v[..v.len().min(4)], v.len()))
                }
                _ => {}
            }
        }
    }

    HostState {
        base_url,
        key_fingerprint,
        model_mappings: Default::default(),
        readable: true,
    }
}

/// 把规则下发到 Gemini CLI（或清除：rule = None）。
pub fn apply(rule: Option<&RouteRule>) -> Result<String, String> {
    let path = env_path()?;
    let current = fs::read_to_string(&path).unwrap_or_default();

    // 备份（有内容才备份）
    if !current.is_empty() {
        fs::write(backup_path(&path), &current).map_err(|err| error::io_failed("backup", err))?;
    }

    let content = render_env(&current, rule)?;

    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|err| error::io_failed("createGeminiDir", err))?;
    }
    let tmp = path.with_extension("env.tmp");
    if fs::write(&tmp, &content).is_ok() {
        let _ = fs::rename(&tmp, &path);
    } else {
        fs::write(&path, &content).map_err(|err| error::io_failed("writeGeminiEnv", err))?;
    }

    Ok(match rule {
        Some(r) => error::note(
            "routeApplied",
            &[("host", "Gemini CLI"), ("name", &r.name), ("url", &r.base_url)],
        ),
        None => error::note("routeCleared", &[("host", "Gemini CLI")]),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(key_ref: &str) -> RouteRule {
        RouteRule {
            id: "t1".into(),
            app: "gemini-cli".into(),
            name: "测试".into(),
            provider: "google".into(),
            base_url: "https://example.com/v1".into(),
            key_ref: key_ref.into(),
            model: None,
            model_opus: None,
            model_sonnet: None,
            model_haiku: None,
            added_at: String::new(),
        }
    }

    // render_env 不展开 keychain 引用（会走钥匙串），用非引用值测纯逻辑
    fn plain_rule() -> RouteRule {
        rule("plain-key-value")
    }

    #[test]
    fn appends_keys_to_empty_file() {
        let out = render_env("", Some(&plain_rule())).unwrap();
        assert!(out.contains("GEMINI_API_KEY=plain-key-value"), "{out}");
        assert!(out.contains("GOOGLE_GEMINI_BASE_URL=https://example.com/v1"), "{out}");
    }

    #[test]
    fn replaces_existing_managed_lines_in_place() {
        let current = "# 注释\nOTHER_VAR=keep\nGEMINI_API_KEY=old\nGOOGLE_GEMINI_BASE_URL=https://old\n";
        let out = render_env(current, Some(&plain_rule())).unwrap();
        // 用户行原样
        assert!(out.contains("# 注释"), "{out}");
        assert!(out.contains("OTHER_VAR=keep"), "{out}");
        // 管理行替换
        assert!(out.contains("GEMINI_API_KEY=plain-key-value"), "{out}");
        assert!(!out.contains("GEMINI_API_KEY=old"), "{out}");
        assert!(out.contains("GOOGLE_GEMINI_BASE_URL=https://example.com/v1"), "{out}");
        // 行顺序保持（替换发生在原位置）
        let key_pos = out.find("GEMINI_API_KEY=plain").unwrap();
        let other_pos = out.find("OTHER_VAR=keep").unwrap();
        assert!(other_pos < key_pos, "{out}");
    }

    #[test]
    fn clear_removes_only_managed_lines() {
        let current = "GEMINI_API_KEY=k\nOTHER=x\nGOOGLE_GEMINI_BASE_URL=https://u\n";
        let out = render_env(current, None).unwrap();
        assert!(!out.contains("GEMINI_API_KEY"), "{out}");
        assert!(!out.contains("GOOGLE_GEMINI_BASE_URL"), "{out}");
        assert!(out.contains("OTHER=x"), "{out}");
    }

    #[test]
    fn clear_on_file_without_managed_lines_is_noop() {
        let current = "OTHER=x\nANOTHER=y\n";
        let out = render_env(current, None).unwrap();
        assert!(out.contains("OTHER=x"), "{out}");
        assert!(out.contains("ANOTHER=y"), "{out}");
        assert!(!out.contains("GEMINI_API_KEY"), "{out}");
    }

    #[test]
    fn quoted_values_are_left_alone() {
        // 用户自己写的带引号值不清 parse 出问题
        let current = "GEMINI_API_KEY=\"old-quoted\"\n";
        let out = render_env(current, Some(&plain_rule())).unwrap();
        assert!(out.contains("GEMINI_API_KEY=plain-key-value"), "{out}");
    }

    #[test]
    fn malformed_lines_untouched() {
        let current = "this-is-not-env\nGEMINI_API_KEY=k\n";
        let out = render_env(current, Some(&plain_rule())).unwrap();
        assert!(out.contains("this-is-not-env"), "{out}");
    }

    #[test]
    fn keychain_ref_resolved_by_apply_path() {
        // render_env 对 keychain 引用会尝试展开（测试环境无钥匙串 → 报错）
        assert!(render_env("", Some(&rule("@keychain:google/main"))).is_err());
    }
}
