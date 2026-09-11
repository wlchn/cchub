//! 与宿主系统打交道的底层工具：PATH 解析、子进程构造。
//!
//! 桌面应用（尤其 macOS 上从 Finder/Dock 启动的 .app）继承的是一个非常精简的
//! 环境变量集合，`PATH` 里通常只有 `/usr/bin:/bin:/usr/sbin:/sbin`。用户通过
//! nvm / homebrew / volta 安装的 node 与 npm 都不在其中，所以必须先把用户
//! 登录 shell 里的真实 `PATH` 取出来，后续所有子进程都用它。

use std::process::{Command, Stdio};
use std::sync::OnceLock;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::prefs::ProxyPrefs;

/// Windows 下不要为子进程弹出黑色控制台窗口。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static USER_PATH: OnceLock<Option<String>> = OnceLock::new();

/// 代理偏好的进程内快照，由 lib.rs 在启动时从 prefs 加载。
/// None = 尚未初始化（早于 setup 的调用），按直连处理。
static PROXY: OnceLock<Option<ProxyPrefs>> = OnceLock::new();

/// 安装代理快照。幂等：重复调用只保留第一次。
pub fn set_proxy_prefs(prefs: ProxyPrefs) {
    let _ = PROXY.set(Some(prefs));
}

/// 当前代理偏好的快照。keys.rs 等模块构造 HTTP 客户端时用。
pub fn proxy_prefs() -> Option<ProxyPrefs> {
    PROXY.get().cloned().flatten()
}

/// 按偏好生成要注入子进程 / 客户端的代理环境变量。
///
/// - 显式 url：HTTP_PROXY/HTTPS_PROXY 都指过去（npm 不区分）
/// - use_system：继承本进程已有的 HTTP(S)_PROXY（GUI 应用继承的通常为空，
///   但用户若以 `HTTPS_PROXY=... open CC\ Store` 方式启动则能接住）
/// - 两者都没配：不注入任何变量，npm 用自己的默认行为
pub fn proxy_envs() -> Vec<(String, String)> {
    let Some(proxy) = proxy_prefs() else {
        return Vec::new();
    };

    let mut envs = Vec::new();

    if !proxy.url.trim().is_empty() {
        for key in ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"] {
            envs.push((key.to_string(), proxy.url.trim().to_string()));
        }
    } else if proxy.use_system {
        for key in ["HTTP_PROXY", "HTTPS_PROXY"] {
            if let Ok(value) = std::env::var(key) {
                if !value.trim().is_empty() {
                    envs.push((key.to_string(), value));
                }
            }
        }
    }

    // NO_PROXY 无论哪种代理模式都生效（排除 localhost 走代理是常见需求）
    if !proxy.no_proxy.trim().is_empty() {
        let value = proxy.no_proxy.trim().replace(';', ",");
        envs.push(("NO_PROXY".to_string(), value.clone()));
        envs.push(("no_proxy".to_string(), value));
    }

    envs
}

/// 通过用户的登录 shell 解析出完整的 `PATH`。
///
/// 结果会被缓存：登录 shell 启动一次要读 `.zshrc` / `.bash_profile`，可能耗时
/// 上百毫秒，不值得每条命令都付一次。
#[cfg(not(windows))]
fn resolve_user_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());

    // -i (interactive) 让 .zshrc / .bashrc 被加载 —— nvm 通常只在这里定义。
    // -l (login) 让 .zprofile / .bash_profile 被加载 —— homebrew 的 shellenv 在这里。
    // 两者都要，才能覆盖主流的 node 安装方式。
    let output = Command::new(&shell)
        .args(["-ilc", "printf %s \"$PATH\""])
        .stdin(Stdio::null())
        .output()
        .ok()?;

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

#[cfg(windows)]
fn resolve_user_path() -> Option<String> {
    // Windows 上 GUI 进程继承的就是用户完整的环境变量，无需额外解析。
    std::env::var("PATH").ok()
}

/// 供子进程使用的 `PATH`：优先用登录 shell 解析出的值，失败则回落到继承的值，
/// 并补上几个常见的 node 安装目录，让「什么都没配好」的机器也有一线机会。
pub fn effective_path() -> String {
    let resolved = USER_PATH.get_or_init(resolve_user_path).clone();
    if let Some(path) = resolved {
        return path;
    }

    let inherited = std::env::var("PATH").unwrap_or_default();

    #[cfg(not(windows))]
    {
        let mut parts: Vec<String> = inherited
            .split(':')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();

        let home = std::env::var("HOME").unwrap_or_default();
        for candidate in [
            "/opt/homebrew/bin".to_string(),
            "/usr/local/bin".to_string(),
            format!("{home}/.volta/bin"),
            format!("{home}/.local/bin"),
            format!("{home}/.npm-global/bin"),
        ] {
            if !candidate.contains("//") && !parts.contains(&candidate) {
                parts.push(candidate);
            }
        }

        parts.join(":")
    }

    #[cfg(windows)]
    {
        inherited
    }
}

/// 构造一条继承了用户真实 `PATH` 的子进程命令。
///
/// Windows 上 `npm` / `claude` 这类入口是 `.cmd` 批处理，无法被 `CreateProcess`
/// 直接执行，必须经由 `cmd /C`。非 Windows 平台直接执行程序本体。
pub fn shell_command(program: &str, args: &[&str]) -> Command {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(program).args(args);
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };

    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new(program);
        c.args(args);
        c
    };

    cmd.env("PATH", effective_path());
    // 代理偏好（M0.3）：npm view / install 的网络请求走用户配置的代理
    for (key, value) in proxy_envs() {
        cmd.env(key, value);
    }
    // npm 在非 TTY 下仍会输出进度条转义序列，关掉让日志可读。
    cmd.env("NPM_CONFIG_COLOR", "false");
    cmd.env("NO_COLOR", "1");
    cmd.stdin(Stdio::null());

    cmd
}

/// 执行一条命令并收集其输出。返回 `(成功, stdout, stderr)`。
pub fn run_capture(program: &str, args: &[&str]) -> Option<(bool, String, String)> {
    let output = shell_command(program, args).output().ok()?;

    Some((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

/// 在 `PATH` 中定位一个可执行文件，返回其绝对路径。
pub fn which(bin: &str) -> Option<String> {
    #[cfg(windows)]
    let (program, args) = ("where", vec![bin]);

    #[cfg(not(windows))]
    let (program, args) = ("/usr/bin/which", vec![bin]);

    let (ok, stdout, _) = run_capture(program, &args)?;
    if !ok {
        return None;
    }

    // Windows 的 `where` 命中多个时每行一个，取第一行。
    stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

static NPM_BIN_DIR: OnceLock<Option<String>> = OnceLock::new();

/// npm 全局包的可执行文件目录。
///
/// 用 `npm prefix -g` 而不是猜路径：nvm 下这个目录随当前 node 版本变化，
/// homebrew、volta、系统 node 各自又都不一样。
pub fn npm_bin_dir() -> Option<String> {
    NPM_BIN_DIR
        .get_or_init(|| {
            let (ok, stdout, _) = run_capture("npm", &["prefix", "-g", "--no-update-notifier"])?;
            if !ok || stdout.is_empty() {
                return None;
            }

            let prefix = stdout.lines().next()?.trim();

            #[cfg(windows)]
            {
                // Windows 上全局 bin 就是 prefix 本身
                Some(prefix.to_string())
            }

            #[cfg(not(windows))]
            {
                Some(format!("{prefix}/bin"))
            }
        })
        .clone()
}

/// 判断某个可执行文件是否位于 npm 全局目录下。
///
/// 拿不到 npm 前缀时返回 `None`（未知），调用方应按「不确定」处理而不是断言
/// 它不受管理 —— 否则 npm 暂时不可用就会让所有已装应用变成「外部安装」。
pub fn is_npm_managed(path: &str) -> Option<bool> {
    let bin_dir = npm_bin_dir()?;
    Some(path.starts_with(&bin_dir))
}

/// 从路径推断安装来源，仅用于给用户一句更具体的提示。
///
/// 返回的是 `notes.*` 的键，不是文案 —— 这个值会被插进界面上的句子里
/// （「由 X 管理」），必须到前端才翻译。
pub fn guess_install_source(path: &str) -> Option<String> {
    const HINTS: &[(&str, &str)] = &[
        ("/homebrew/", "homebrew"),
        ("/Cellar/", "homebrew"),
        ("/.volta/", "volta"),
        ("/.bun/", "bun"),
        ("/.local/share/pnpm", "pnpm"),
        ("/.yarn/", "yarn"),
        ("/.local/bin", "officialScript"),
        ("/.claude/", "officialScript"),
        ("/opt/", "systemPackageManager"),
    ];

    HINTS
        .iter()
        .find(|(needle, _)| path.contains(needle))
        .map(|(_, label)| (*label).to_string())
}

/// 从 `--version` 之类的输出里抽出第一个形如 `1.2.3` 的版本号。
///
/// 各家 CLI 的输出格式并不统一（`1.0.60 (Claude Code)`、`codex-cli 0.5.0`、
/// 裸版本号都有），统一按模式提取比逐个适配更稳。
pub fn extract_version(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }

        // 前一个字符是数字或 '.' 说明我们落在了某个 token 中间，跳过。
        if i > 0 && (bytes[i - 1] == b'.' || bytes[i - 1].is_ascii_digit()) {
            i += 1;
            continue;
        }

        let start = i;
        let mut dots = 0;
        while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
            if bytes[i] == b'.' {
                dots += 1;
            }
            i += 1;
        }

        let candidate = text[start..i].trim_end_matches('.');
        if dots >= 1 && !candidate.is_empty() {
            // 带预发布后缀的情况（1.2.3-beta.1）一并保留
            let tail: String = text[i..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '.' || *c == '+')
                .collect();
            if tail.starts_with('-') {
                return Some(format!("{candidate}{tail}"));
            }
            return Some(candidate.to_string());
        }
    }

    None
}

/// 语义化版本比较：`a` 是否比 `b` 新。解析失败时保守地返回 false。
pub fn is_newer(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.split('-')
            .next()
            .unwrap_or("")
            .split('.')
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    };

    let (va, vb) = (parse(a), parse(b));
    if va.is_empty() || vb.is_empty() {
        return false;
    }

    for i in 0..va.len().max(vb.len()) {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_plain_version() {
        assert_eq!(extract_version("1.2.3").as_deref(), Some("1.2.3"));
    }

    #[test]
    fn extracts_version_with_suffix_text() {
        assert_eq!(
            extract_version("1.0.60 (Claude Code)").as_deref(),
            Some("1.0.60")
        );
    }

    #[test]
    fn extracts_version_with_prefix_text() {
        assert_eq!(
            extract_version("codex-cli 0.5.12").as_deref(),
            Some("0.5.12")
        );
    }

    #[test]
    fn extracts_prerelease_version() {
        assert_eq!(
            extract_version("v2.0.0-beta.3 ready").as_deref(),
            Some("2.0.0-beta.3")
        );
    }

    #[test]
    fn ignores_text_without_version() {
        assert_eq!(extract_version("command not found"), None);
    }

    #[test]
    fn guesses_install_source_from_path() {
        // 返回的是 `notes.*` 词典键，不是展示文案
        assert_eq!(
            guess_install_source("/opt/homebrew/bin/claude").as_deref(),
            Some("homebrew")
        );
        assert_eq!(
            guess_install_source("/Users/x/.volta/bin/codex").as_deref(),
            Some("volta")
        );
        assert_eq!(
            guess_install_source("/opt/local/bin/thing").as_deref(),
            Some("systemPackageManager")
        );
        // npm 全局路径不该被当成「外部来源」
        assert_eq!(
            guess_install_source("/Users/x/.nvm/versions/node/v24.0.0/bin/claude"),
            None
        );
    }

    #[test]
    fn compares_versions() {
        assert!(is_newer("1.2.4", "1.2.3"));
        assert!(is_newer("1.3.0", "1.2.9"));
        assert!(is_newer("2.0.0", "1.99.99"));
        assert!(!is_newer("1.2.3", "1.2.3"));
        assert!(!is_newer("1.2.3", "1.2.4"));
        assert!(is_newer("1.2.10", "1.2.9"));
    }
}
