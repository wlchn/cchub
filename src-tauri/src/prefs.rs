//! 用户偏好：唯一的持久化存储，后续所有模块（设置页 / 代理 / 目录源）都从这里读写。
//!
//! 落盘位置：`{app_config_dir}/prefs.json`（macOS:
//! `~/Library/Application Support/cchub/`；Windows: `%APPDATA%\cchub\`）。
//!
//! 三条不变量：
//! 1. `schema_version` 必须匹配，读不到已知版本（损坏 / 更新过 / 空）就整份重建，
//!    不做猜测式迁移——偏好丢了可以重设，错误地活下来会很难排查。
//! 2. 写入原子化：先写同目录临时文件再 rename，任何时刻断电 prefs.json 都是完整的。
//! 3. `set_prefs` 按 diff 合并而不是整包覆盖，避免两个来源（设置页、未来可能的
//!    多窗口）后写的把先写的整份冲掉。

use crate::error;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// 当前偏好结构的版本。字段语义变更（改名/删字段/改含义）时 +1，
/// 并在 `migrate` 里处理旧版本到新版本的迁移。
pub const SCHEMA_VERSION: u32 = 1;

pub const PREFS_FILE: &str = "prefs.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    /// 见 [`SCHEMA_VERSION`]。
    pub schema_version: u32,

    // ---- 主题 / 语言（M1 设置页消费）----
    /// 跟随系统 / 浅色 / 深色。默认跟随系统。
    pub theme: Theme,
    /// 界面语言。先埋结构，翻译后补。
    pub locale: String,

    // ---- 行为 ----
    /// 启动时自动检测已安装应用。默认开。
    pub detect_on_launch: bool,
    /// 启动时后台查询 npm 远端版本。默认开。
    pub check_updates_on_launch: bool,

    // ---- 网络（M0.3 消费）----
    pub proxy: ProxyPrefs,

    // ---- 目录源（M0.2 消费）----
    /// 远端目录地址，空串表示只用内置目录。
    pub catalog_url: String,
    /// 远端目录条目的缓存时长（小时）。
    pub catalog_ttl_hours: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProxyPrefs {
    /// 代理地址，如 `http://127.0.0.1:7890`。空串表示直连。
    pub url: String,
    /// 不走代理的主机，分号分隔，支持通配。写入 NO_PROXY。
    pub no_proxy: String,
    /// 让 npm / 目录源请求走系统代理（读系统环境变量）。
    pub use_system: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            theme: Theme::System,
            locale: "zh-CN".to_string(),
            detect_on_launch: true,
            check_updates_on_launch: true,
            proxy: ProxyPrefs::default(),
            catalog_url: String::new(),
            catalog_ttl_hours: 24,
        }
    }
}

impl Prefs {
    /// 校验字段值在合理范围内。偏好是用户手改文件也可能触达的输入，
    /// 越界值回落默认而不是让下游拿去用。
    fn sanitized(self) -> Self {
        Self {
            catalog_ttl_hours: self.catalog_ttl_hours.clamp(1, 24 * 30),
            ..self
        }
    }
}

/// 旧版本结构到当前的迁移。当前只有 v1，占位说明模式。
fn migrate(_raw: &Value) -> Option<Prefs> {
    // 未来: raw["schemaVersion"] == 1 时从 v0 结构转换。
    None
}

// ---------------------------------------------------------------- 读写

fn prefs_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(PREFS_FILE))
}

/// 解析一段 prefs.json 文本。损坏 / 版本未知返回 None（调用方回落默认）。
fn parse(text: &str) -> Option<Prefs> {
    let raw: Value = serde_json::from_str(text).ok()?;

    match raw.get("schemaVersion").and_then(Value::as_u64) {
        Some(v) if v == SCHEMA_VERSION as u64 => {
            // 当前版本：正常反序列化，再过一遍 sanitize。
            serde_json::from_value(raw).ok().map(Prefs::sanitized)
        }
        _ => migrate(&raw),
    }
}

/// 读偏好。任何读不出来（没建过 / 损坏 / 版本未知）都返回默认值，
/// 但只有文件确实存在且解析成功时才进缓存；其余情形不写回，留给下次设置时覆盖。
fn load(app: &AppHandle) -> Prefs {
    let Some(path) = prefs_path(app) else {
        return Prefs::default();
    };

    match fs::read_to_string(&path) {
        Ok(text) => parse(&text).unwrap_or_default(),
        Err(_) => Prefs::default(),
    }
}

/// 原子写入：临时文件 + rename，保证 prefs.json 不会出现半截 JSON。
fn store(app: &AppHandle, prefs: &Prefs) -> Result<(), String> {
    let path = prefs_path(app).ok_or_else(|| error::err_plain("configDirMissing"))?;
    let dir = path
        .parent()
        .ok_or_else(|| error::err_plain("configDirNoParent"))?;

    fs::create_dir_all(dir).map_err(|err| error::io_failed("createConfigDir", err))?;

    let text =
        serde_json::to_string_pretty(prefs).map_err(|err| error::io_failed("serializePrefs", err))?;

    let tmp = dir.join(format!("{PREFS_FILE}.tmp"));
    fs::write(&tmp, text).map_err(|err| error::io_failed("writePrefs", err))?;

    // Windows 上 rename 覆盖已存在文件可能失败，回落先删后改名。
    if fs::rename(&tmp, &path).is_err() {
        let _ = fs::remove_file(&path);
        fs::rename(&tmp, &path).map_err(|err| error::io_failed("savePrefs", err))?;
    }

    Ok(())
}

// ---------------------------------------------------------------- 全局快照

/// 进程内的偏好快照。
///
/// 读方（子进程注入代理、目录源 TTL 判断）要求 O(1) 且不触发 IO；写方只有
/// `set_prefs` 命令。启动时惰性加载一次，之后全走内存。
pub struct PrefsState(pub Mutex<Prefs>);

impl PrefsState {
    pub fn load(app: &tauri::App) -> Self {
        let handle = app.handle().clone();
        Self(Mutex::new(load(&handle)))
    }

    /// 当前偏好的副本。
    pub fn snapshot(&self) -> Prefs {
        self.0.lock().unwrap_or_else(|err| err.into_inner()).clone()
    }

    /// 合并 diff 并落盘。返回合并后的完整偏好。
    pub fn apply(&self, app: &AppHandle, diff: Value) -> Result<Prefs, String> {
        let mut guard = self.0.lock().unwrap_or_else(|err| err.into_inner());

        // 把当前值序列化成 Value 再合并 diff，最后解析回来：
        // 三个环节任何类型不匹配（diff 里塞了垃圾字段/类型）都整体报错，
        // 内存与磁盘都不会停在半合并状态。
        let mut merged =
            serde_json::to_value(&*guard).map_err(|err| error::io_failed("serializePrefs", err))?;
        if let (Some(dst), Some(src)) = (merged.as_object_mut(), diff.as_object()) {
            for (key, value) in src {
                dst.insert(key.clone(), value.clone());
            }
        }

        let prefs = serde_json::from_value::<Prefs>(merged)
            .map_err(|err| error::err("badPrefsField", &[("err", &err.to_string())]))?
            .sanitized();

        store(app, &prefs)?;
        *guard = prefs.clone();

        Ok(prefs)
    }
}

// ---------------------------------------------------------------- 命令

#[tauri::command]
pub fn get_prefs(state: tauri::State<'_, PrefsState>) -> Prefs {
    state.snapshot()
}

/// 合并写入偏好。`diff` 是部分字段的对象（如 `{"theme":"dark"}`）。
#[tauri::command]
pub fn set_prefs(
    app: AppHandle,
    state: tauri::State<'_, PrefsState>,
    diff: Value,
) -> Result<Prefs, String> {
    state.apply(&app, diff)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prefs_json(prefs: &Prefs) -> String {
        serde_json::to_string(prefs).unwrap()
    }

    #[test]
    fn roundtrip_current_schema() {
        let prefs = Prefs {
            theme: Theme::Dark,
            catalog_ttl_hours: 48,
            ..Prefs::default()
        };
        let text = prefs_json(&prefs);
        assert_eq!(parse(&text).unwrap(), prefs);
    }

    #[test]
    fn corrupted_file_falls_back_to_default() {
        assert_eq!(parse("{ not json"), None);
        // parse 返回 None 后 load 会给默认值——上层行为在 apply/ load 测不到
        //（依赖文件系统），这里只验证判定函数本身。
    }

    #[test]
    fn unknown_schema_version_rejected() {
        let text = r#"{"schemaVersion": 99, "theme": "dark"}"#;
        assert_eq!(parse(text), None);
    }

    #[test]
    fn missing_schema_version_rejected() {
        // 无版本字段 = 猜不出结构，宁可重建
        let text = r#"{"theme": "dark"}"#;
        assert_eq!(parse(text), None);
    }

    #[test]
    fn ttl_out_of_range_is_clamped() {
        // 走 parse 而不是裸 from_str：sanitize 只挂在 parse/load 路径上，
        // 这里验证的正是「读进来的偏好一定被夹过范围」这条契约
        let text = r#"{"schemaVersion": 1, "catalogTtlHours": 999999}"#;
        assert_eq!(parse(text).unwrap().catalog_ttl_hours, 24 * 30);
    }

    #[test]
    fn merge_diff_keeps_unmentioned_fields() {
        let base = Prefs {
            theme: Theme::Light,
            ..Prefs::default()
        };
        let mut merged = serde_json::to_value(&base).unwrap();
        let diff: Value = serde_json::from_str(r#"{"theme": "dark", "locale": "en-US"}"#).unwrap();
        for (k, v) in diff.as_object().unwrap() {
            merged.as_object_mut().unwrap().insert(k.clone(), v.clone());
        }
        let merged: Prefs = serde_json::from_value(merged).unwrap();

        assert_eq!(merged.theme, Theme::Dark); // 被 diff 覆盖
        assert_eq!(merged.locale, "en-US"); // 被 diff 写入
        assert_eq!(merged.catalog_ttl_hours, 24); // 未提及，保留
        assert_eq!(merged.detect_on_launch, true); // 未提及，保留
    }

    #[test]
    fn merge_rejects_garbage_field_types() {
        let mut merged = serde_json::to_value(Prefs::default()).unwrap();
        merged
            .as_object_mut()
            .unwrap()
            .insert("theme".into(), Value::String("banana".into()));
        // 非法枚举值在反序列化时整体失败，而不是静默回落——apply 会返回 Err
        assert!(serde_json::from_value::<Prefs>(merged).is_err());
    }
}
