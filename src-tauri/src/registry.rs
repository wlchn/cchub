//! 可管理应用的白名单。
//!
//! 前端只能按 `id` 请求操作，具体的包名/命令名/下载地址一律在这里查表得到。
//! 这样前端永远无法把任意字符串拼进安装命令，从设计上排掉命令注入。

/// 一个可被 CCHub 管理的应用。
#[derive(Debug, Clone, Copy)]
pub struct AppSpec {
    /// 前后端共用的稳定标识。
    pub id: &'static str,
    /// 展示名，仅用于日志与错误信息。
    pub name: &'static str,
    /// 安装方式。
    pub source: AppSource,
    /// 安装后应出现在 `PATH` 中的可执行文件名。桌面 App 没有可执行文件时用该 App 的检测名。
    pub bin: &'static str,
    /// 取版本号用的参数。None 表示这类安装不提供自报版本（桌面 App 走 Info.plist 或跳过）。
    pub version_args: Option<&'static [&'static str]>,
}

#[derive(Debug, Clone, Copy)]
pub enum AppSource {
    /// 通过 `npm install -g <package>` 安装。
    Npm { package: &'static str },
    /// 非 npm 安装（官方脚本、桌面安装包）。CCHub 不代为安装：
    /// 用户点「安装」时打开 `install_url`，下载并手动完成。
    External {
        /// 官方安装页或下载地址。
        install_url: &'static str,
        /// macOS App bundle 名（用于 `/Applications` 下的存在性检测），如 `WorkBuddy.app`。
        /// 留空则走 `bin` 的 PATH 检测。
        mac_app_name: Option<&'static str>,
    },
}

/// 判断某个应用能否被 CCHub 执行安装/更新/卸载。
impl AppSpec {
    pub const fn installable(&self) -> bool {
        matches!(self.source, AppSource::Npm { .. })
    }
}

pub const APPS: &[AppSpec] = &[
    // ---- 7 个 npm 可装 ----
    AppSpec {
        id: "claude-code",
        name: "Claude Code",
        source: AppSource::Npm {
            package: "@anthropic-ai/claude-code",
        },
        bin: "claude",
        version_args: Some(&["--version"]),
    },
    AppSpec {
        id: "codex",
        name: "Codex CLI",
        source: AppSource::Npm {
            package: "@openai/codex",
        },
        bin: "codex",
        version_args: Some(&["--version"]),
    },
    AppSpec {
        id: "gemini-cli",
        name: "Gemini CLI",
        source: AppSource::Npm {
            package: "@google/gemini-cli",
        },
        bin: "gemini",
        version_args: Some(&["--version"]),
    },
    AppSpec {
        id: "grok-build",
        name: "Grok Build",
        source: AppSource::Npm {
            package: "@xai-official/grok",
        },
        bin: "grok",
        version_args: Some(&["--version"]),
    },
    AppSpec {
        id: "opencode",
        name: "OpenCode",
        source: AppSource::Npm {
            package: "opencode-ai",
        },
        bin: "opencode",
        version_args: Some(&["--version"]),
    },
    AppSpec {
        id: "openclaw",
        name: "OpenClaw",
        source: AppSource::Npm {
            package: "openclaw",
        },
        bin: "openclaw",
        version_args: Some(&["--version"]),
    },
    AppSpec {
        id: "pi",
        name: "Pi",
        source: AppSource::Npm {
            package: "@earendil-works/pi-coding-agent",
        },
        bin: "pi",
        // Pi 的官方命令是 `pi update --self`，`--version` 也能出字串
        version_args: Some(&["--version"]),
    },
    // ---- 3 个 External：能检测、不负责安装 ----
    AppSpec {
        id: "hermes",
        name: "Hermes",
        // 官方安装脚本；CCHub 不 curl，让用户读官网自行执行
        source: AppSource::External {
            install_url: "https://hermes-agent.nousresearch.com/install.sh",
            mac_app_name: None,
        },
        bin: "hermes",
        // hermes 自更新，但 --version 可用
        version_args: Some(&["--version"]),
    },
    AppSpec {
        id: "trae",
        name: "Trae",
        // ByteDance IDE，桌面 App 形态，无 CLI
        source: AppSource::External {
            install_url: "https://www.trae.ai/download",
            mac_app_name: Some("Trae.app"),
        },
        bin: "trae",
        version_args: None,
    },
    AppSpec {
        id: "workbuddy",
        name: "WorkBuddy",
        // 腾讯 WorkBuddy，桌面 App 形态
        source: AppSource::External {
            install_url: "https://www.workbuddy.cn/",
            mac_app_name: Some("WorkBuddy.app"),
        },
        bin: "workbuddy",
        version_args: None,
    },
];

pub fn find(id: &str) -> Option<&'static AppSpec> {
    APPS.iter().find(|app| app.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_known_apps() {
        assert!(find("claude-code").is_some());
        assert!(find("workbuddy").is_some());
        assert!(find("hermes").is_some());
    }

    #[test]
    fn rejects_unknown_id() {
        assert!(find("../../etc/passwd").is_none());
        assert!(find("left-pad && rm -rf /").is_none());
    }

    #[test]
    fn ids_are_unique() {
        for (i, app) in APPS.iter().enumerate() {
            assert!(
                APPS.iter().skip(i + 1).all(|other| other.id != app.id),
                "重复的应用 id: {}",
                app.id
            );
        }
    }

    #[test]
    fn npm_apps_are_installable() {
        assert!(APPS
            .iter()
            .find(|a| a.id == "claude-code")
            .unwrap()
            .installable());
        assert!(!APPS
            .iter()
            .find(|a| a.id == "hermes")
            .unwrap()
            .installable());
        assert!(!APPS.iter().find(|a| a.id == "trae").unwrap().installable());
        assert!(!APPS
            .iter()
            .find(|a| a.id == "workbuddy")
            .unwrap()
            .installable());
    }
}
