//! 应用检测、安装、卸载。
//!
//! 安装是长任务，命令本身立刻返回，进度通过事件推给前端：
//!   - `app-task-log`      每一行输出
//!   - `app-task-finished` 任务结束（含成功与否）
//!
//! 所有命令都是 async 的：检测与 `npm view` 都会 spawn 子进程甚至走网络，
//! 放在主线程上跑会让整个窗口卡死。真正的执行落在 `spawn_blocking` 里，
//! 主线程只负责调度与回传。

use crate::error;
use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::process::Stdio;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::registry::{self, AppSource};
use crate::sys;

pub const EVENT_LOG: &str = "app-task-log";
pub const EVENT_FINISHED: &str = "app-task-finished";

/// 某个应用在本机的安装状态。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub id: String,
    pub installed: bool,
    /// 已安装的版本号，取不到时为 None（可能是 CLI 输出格式变了，或桌面 App 无）。
    pub version: Option<String>,
    /// 已安装位置（PATH 中的可执行文件，或 macOS App bundle）的绝对路径。
    pub path: Option<String>,
    /// 这份安装是否能被本应用更新/卸载。
    ///
    /// false 有两种情形：1) npm 安装但不在 npm 全局目录（如 Homebrew）；2)
    /// 源根本不是 npm（脚本/桌面安装包），无论如何本应用都管不了。
    pub managed: bool,
    /// managed 为 false 时，从路径推断出的安装来源。
    pub external_hint: Option<String>,
    /// External 源应用的官方安装页。非 External 应用为 None。
    pub install_url: Option<String>,
}

/// 远端最新版本的查询结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestVersion {
    pub id: String,
    pub latest: Option<String>,
    pub update_available: bool,
    pub error: Option<String>,
}

/// 本机运行环境概况，用于在首页给出「能不能装」的前置判断。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentInfo {
    pub os: String,
    pub arch: String,
    pub node_version: Option<String>,
    pub npm_version: Option<String>,
    pub node_path: Option<String>,
    pub npm_path: Option<String>,
    /// 解析出的 PATH，排查「明明装了却检测不到」时很有用。
    pub resolved_path: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskKind {
    Install,
    Update,
    Uninstall,
}

impl TaskKind {
    /// 词典键（`verb.*`）。返回键而非文案 —— 这些值会随消息发到前端再翻译。
    fn verb(self) -> &'static str {
        match self {
            TaskKind::Install => "install",
            TaskKind::Update => "update",
            TaskKind::Uninstall => "uninstall",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskLog {
    pub id: String,
    pub line: String,
    /// "stdout" | "stderr" | "info"
    pub stream: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFinished {
    pub id: String,
    pub success: bool,
    pub message: String,
}

/// 正在执行中的任务集合，避免同一个应用被并发安装两次。
#[derive(Default)]
pub struct RunningTasks(Mutex<HashSet<String>>);

impl RunningTasks {
    fn try_acquire(&self, id: &str) -> bool {
        // 锁被污染说明某个持锁线程 panic 过，但这里保护的只是一个 id 集合，
        // 拿回内层数据继续用是安全的，比让整个应用从此无法安装任何东西要好。
        let mut guard = self.0.lock().unwrap_or_else(|err| err.into_inner());
        guard.insert(id.to_string())
    }

    fn release(&self, id: &str) {
        let mut guard = self.0.lock().unwrap_or_else(|err| err.into_inner());
        guard.remove(id);
    }
}

/// 负责在任务线程结束时归还 `RunningTasks` 里的槽位。
///
/// 用 Drop 而不是在线程末尾手写 release：任何一条 `?`、panic 或提前 return
/// 都会漏掉手写的那次释放，那个应用就会永久停在「正在处理中」，只能重启应用。
struct TaskSlot {
    app: AppHandle,
    id: String,
}

impl Drop for TaskSlot {
    fn drop(&mut self) {
        if let Some(tasks) = self.app.try_state::<RunningTasks>() {
            tasks.release(&self.id);
        }
    }
}

// ---------------------------------------------------------------- 检测

fn status_of(spec: &registry::AppSpec) -> AppStatus {
    match spec.source {
        AppSource::Npm { .. } => status_of_npm(spec),
        AppSource::External {
            install_url,
            mac_app_name,
        } => status_of_external(spec, install_url, mac_app_name),
    }
}

/// npm 安装的检测：which + version + managed 检查。
fn status_of_npm(spec: &registry::AppSpec) -> AppStatus {
    let path = sys::which(spec.bin);
    let version_args = spec.version_args.unwrap_or(&["--version"]);

    // `which` 命中不等于能跑起来（残留的软链、权限问题都可能），所以再真实调用
    // 一次 version 命令才算「已安装」。
    let version = sys::run_capture(spec.bin, version_args).and_then(|(ok, out, err)| {
        if !ok && out.is_empty() {
            return None;
        }
        // 有些 CLI 把版本写到 stderr
        sys::extract_version(&out).or_else(|| sys::extract_version(&err))
    });

    // 拿不到 npm 前缀时（npm 不可用）按「受管理」处理：宁可让操作走下去报错，
    // 也不要把用户正常的 npm 安装误标成外部安装。
    let managed = path
        .as_deref()
        .and_then(sys::is_npm_managed)
        .unwrap_or(true);

    let external_hint = if managed {
        None
    } else {
        path.as_deref().and_then(sys::guess_install_source)
    };

    AppStatus {
        id: spec.id.to_string(),
        installed: version.is_some() || path.is_some(),
        version,
        path,
        managed,
        external_hint,
        install_url: None,
    }
}

/// External（脚本/桌面 App）的检测：先看 CLI，不存在再看 macOS App。本应用
/// 对这类安装始终无法管理和卸载——无论是 CLI 还是 App bundle 都在 npm 全局目录之外。
fn status_of_external(
    spec: &registry::AppSpec,
    install_url: &str,
    mac_app_name: Option<&str>,
) -> AppStatus {
    // 优先查 CLI（Hermes 装到 ~/.hermes 后往 PATH 加了 hermes 命令）。
    let mut path = sys::which(spec.bin);
    let mut version = None;

    if let Some(version_args) = spec.version_args {
        version = sys::run_capture(spec.bin, version_args).and_then(|(ok, out, err)| {
            if !ok && out.is_empty() {
                None
            } else {
                sys::extract_version(&out).or_else(|| sys::extract_version(&err))
            }
        });
    }

    // macOS 下桌面 App：CLI 在 PATH 找不到时，按 App bundle 检测。
    #[cfg(not(windows))]
    if path.is_none() {
        if let Some(app_name) = mac_app_name {
            for app_dir in ["/Applications", "/System/Applications"] {
                let app_path = format!("{app_dir}/{app_name}");
                if std::path::Path::new(&app_path).is_dir() {
                    path = Some(app_path);
                    break;
                }
            }
        }
    }

    // CLI 存在才取版本；App bundle 就只给路径，不给版本（桌面 App 版本在 Info.plist）。
    let external_hint = if path.is_some() {
        // 所有 External 源一律 managed=false，原因各有不同。
        Some(
            mac_app_name
                .map(|name| error::note("officialApp", &[("name", name)]))
                .unwrap_or_else(|| error::note("officialScript", &[])),
        )
    } else {
        None
    };

    AppStatus {
        id: spec.id.to_string(),
        installed: version.is_some() || path.is_some(),
        version,
        path,
        managed: false,
        external_hint,
        install_url: Some(install_url.to_string()),
    }
}

/// 并发检测目录里的全部应用。每个应用要跑一次登录 shell 解析 PATH（首次）
/// 加若干条 `which` / `--version` 子进程，串行时首屏要等 10 个应用轮完。
#[tauri::command]
pub async fn detect_apps() -> Result<Vec<AppStatus>, String> {
    run_blocking(|| registry::APPS.iter().map(status_of).collect()).await
}

#[tauri::command]
pub async fn detect_app(id: String) -> Result<AppStatus, String> {
    let spec = registry::find(&id).ok_or_else(|| error::err("unknownApp", &[("id", id.as_str())]))?;
    run_blocking(move || status_of(spec)).await
}

#[tauri::command]
pub async fn detect_environment() -> Result<EnvironmentInfo, String> {
    run_blocking(|| {
        let node_version = sys::run_capture("node", &["--version"])
            .filter(|(ok, ..)| *ok)
            .and_then(|(_, out, _)| sys::extract_version(&out));

        let npm_version = sys::run_capture("npm", &["--version"])
            .filter(|(ok, ..)| *ok)
            .and_then(|(_, out, _)| sys::extract_version(&out));

        EnvironmentInfo {
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            node_version,
            npm_version,
            node_path: sys::which("node"),
            npm_path: sys::which("npm"),
            resolved_path: sys::effective_path(),
        }
    })
    .await
}

/// 查询 npm 上的最新版本。会走网络，可能比较慢，前端应单独触发。
/// External 源无 npm 可查，直接返回 update_available=false。
#[tauri::command]
pub async fn check_latest_version(id: String) -> Result<LatestVersion, String> {
    let spec = registry::find(&id).ok_or_else(|| error::err("unknownApp", &[("id", id.as_str())]))?;

    let AppSource::Npm { package } = spec.source else {
        return Ok(LatestVersion {
            id,
            latest: None,
            update_available: false,
            error: None,
        });
    };

    run_blocking(move || {
        let result = sys::run_capture("npm", &["view", package, "version", "--no-update-notifier"]);

        let Some((ok, stdout, stderr)) = result else {
            return LatestVersion {
                id,
                latest: None,
                update_available: false,
                error: Some(error::err_plain("npmUnavailable")),
            };
        };

        if !ok {
            return LatestVersion {
                id,
                latest: None,
                update_available: false,
                error: Some(if stderr.is_empty() {
                    error::err_plain("npmRegistryQueryFailed")
                } else {
                    // stderr 原文来自 npm，不是我们的文案，原样透传
                    stderr
                        .lines()
                        .last()
                        .map(str::to_string)
                        .unwrap_or_else(|| error::err_plain("npmRegistryQueryFailed"))
                }),
            };
        }

        let latest = sys::extract_version(&stdout);
        let installed = status_of(spec).version;

        let update_available = match (&latest, &installed) {
            (Some(l), Some(i)) => sys::is_newer(l, i),
            _ => false,
        };

        LatestVersion {
            id,
            latest,
            update_available,
            error: None,
        }
    })
    .await
}

/// 把一段阻塞工作挪出主线程。
///
/// 这里跑的都是几十毫秒到数秒级的子进程调用（登录 shell、npm view 走网络），
/// 直接在 async 上下文里执行会卡住 Tauri 的主线程，窗口整个冻住。join 失败
/// （worker panic）时返回 Err 而不是 unwrap，别让一次检测炸掉整个应用。
async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|err| error::io_failed("backgroundTask", err))
}

// ---------------------------------------------------------------- 安装 / 卸载

/// 启动一个安装/更新/卸载任务。命令立即返回，进度走事件。
/// External 源不可执行，返回 Err 引导前端走「打开官网」流程。
#[tauri::command]
pub async fn run_app_task(
    app: AppHandle,
    tasks: State<'_, RunningTasks>,
    id: String,
    kind: TaskKind,
) -> Result<(), String> {
    let spec = registry::find(&id).ok_or_else(|| error::err("unknownApp", &[("id", id.as_str())]))?;

    // External 源永远不能用 npm 安装。Err 引导前端走 window.open 流程。
    if !spec.installable() {
        return Err(error::err("appExternalOnly", &[("name", spec.name)]));
    }

    // 前端会把这些按钮禁掉，但那只是提示；真正的拦截必须在这里，否则一次
    // npm -g 操作要么删不掉东西（用户以为卸载了），要么装出冲突的第二份。
    let status = run_blocking(move || status_of(spec)).await?;
    if !status.managed && matches!(kind, TaskKind::Update | TaskKind::Uninstall) {
        // hint 是 `notes.*` 的键，前端查表后插进模板
        let hint = status.external_hint.unwrap_or_default();
        return Err(error::err(
            "appOutsideNpmGlobal",
            &[("name", spec.name), ("hint", &hint), ("verb", kind.verb())],
        ));
    }

    if !tasks.try_acquire(&id) {
        return Err(error::err("appBusy", &[("name", spec.name)]));
    }

    let AppSource::Npm { package } = spec.source else {
        // 已在上面的 installable() 检查中拦截，这里是编译器排除
        return Err(error::err("appNotNpm", &[("name", spec.name)]));
    };

    // npm 的全局安装/卸载参数在这里定死，不接受任何来自前端的拼接。
    let args: Vec<String> = match kind {
        TaskKind::Install | TaskKind::Update => vec![
            "install".into(),
            "-g".into(),
            format!("{package}@latest"),
            "--no-fund".into(),
            "--no-audit".into(),
        ],
        TaskKind::Uninstall => vec![
            "uninstall".into(),
            "-g".into(),
            package.into(),
            "--no-fund".into(),
            "--no-audit".into(),
        ],
    };

    let handle = app.clone();
    let task_id = id.clone();
    let app_name = spec.name;

    std::thread::spawn(move || {
        // 线程无论怎么结束（正常、提前返回、panic），槽位都由这个 guard 归还
        let _slot = TaskSlot {
            app: handle.clone(),
            id: task_id.clone(),
        };

        let result = execute_task(&handle, &task_id, kind, app_name, &args);

        let (success, message) = match result {
            Ok(()) => (
                true,
                error::note("taskDone", &[("name", app_name), ("verb", kind.verb())]),
            ),
            Err(err) => (false, err),
        };

        let _ = handle.emit(
            EVENT_FINISHED,
            TaskFinished {
                id: task_id,
                success,
                message,
            },
        );
    });

    Ok(())
}

fn emit_log(app: &AppHandle, id: &str, stream: &str, line: impl Into<String>) {
    let _ = app.emit(
        EVENT_LOG,
        TaskLog {
            id: id.to_string(),
            line: line.into(),
            stream: stream.to_string(),
        },
    );
}

fn execute_task(
    app: &AppHandle,
    id: &str,
    kind: TaskKind,
    app_name: &str,
    args: &[String],
) -> Result<(), String> {
    emit_log(
        app,
        id,
        "info",
        error::note("taskStart", &[("verb", kind.verb()), ("name", app_name)]),
    );
    emit_log(app, id, "info", format!("$ npm {}", args.join(" ")));

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut command = sys::shell_command("npm", &arg_refs);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|err| error::err("npmMissing", &[("err", &err.to_string())]))?;

    // stderr 单独一个线程，否则管道写满时子进程会卡死。
    let stderr_handle = child.stderr.take().map(|stderr| {
        let app = app.clone();
        let id = id.to_string();
        std::thread::spawn(move || {
            let mut collected = Vec::new();
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    emit_log(&app, &id, "stderr", &line);
                    collected.push(line);
                }
            }
            collected
        })
    });

    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if !line.trim().is_empty() {
                emit_log(app, id, "stdout", line);
            }
        }
    }

    let status = child
        .wait()
        .map_err(|err| error::io_failed("waitNpm", err))?;

    let stderr_lines = stderr_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();

    if status.success() {
        return Ok(());
    }

    Err(diagnose_failure(kind, app_name, &stderr_lines))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 打印本机真实的检测结果。
    ///
    /// 依赖开发者机器上装了什么，所以默认不跑；排查「明明装了却检测不到」时
    /// 手动执行：`cargo test -- --ignored --nocapture`
    #[test]
    #[ignore = "依赖本机环境，需手动运行"]
    fn diagnose_local_machine() {
        let env = tauri::async_runtime::block_on(detect_environment()).unwrap();
        println!("os          = {} / {}", env.os, env.arch);
        println!("node        = {:?} @ {:?}", env.node_version, env.node_path);
        println!("npm         = {:?} @ {:?}", env.npm_version, env.npm_path);
        println!("npm bin dir = {:?}", sys::npm_bin_dir());
        println!("PATH        = {}", env.resolved_path);

        let statuses = tauri::async_runtime::block_on(detect_apps()).unwrap();
        for status in statuses {
            println!(
                "\n{}\n  installed = {}\n  version   = {:?}\n  path      = {:?}\n  managed   = {}\n  source    = {:?}",
                status.id,
                status.installed,
                status.version,
                status.path,
                status.managed,
                status.external_hint,
            );
        }
    }
}

/// 把 npm 的失败输出翻译成用户能照着做的一句话。
fn diagnose_failure(kind: TaskKind, app_name: &str, stderr: &[String]) -> String {
    let joined = stderr.join("\n");
    let verb = kind.verb();

    if joined.contains("EACCES") || joined.contains("permission denied") {
        return format!(
            "{app_name} {verb}失败：npm 全局目录没有写权限。建议改用 nvm 管理 Node.js，或执行 `npm config set prefix ~/.npm-global` 后重试"
        );
    }

    if joined.contains("ENOTFOUND") || joined.contains("ETIMEDOUT") || joined.contains("ECONNRESET")
    {
        return format!("{app_name} {verb}失败：无法连接 npm registry，请检查网络或代理设置");
    }

    if joined.contains("E404") {
        return format!("{app_name} {verb}失败：npm 上找不到对应的包");
    }

    // 登录 shell 的默认 node 版本太老时会撞上这个 —— 用户在终端里 nvm use 过
    // 新版本也不算，因为应用读的是默认版本。
    if joined.contains("EBADENGINE") || joined.contains("Unsupported engine") {
        return format!(
            "{app_name} {verb}失败：当前 Node.js 版本不满足该包的要求。CCHub 使用登录 shell 的默认版本，用 nvm 的话可执行 `nvm alias default 22` 后重试"
        );
    }

    if joined.contains("EEXIST") {
        return format!("{app_name} {verb}失败：目标文件已存在，可先卸载再重新安装");
    }

    // 兜底：把 npm 自己的最后一条 ERR 抛给用户，比「未知错误」有用得多。
    let detail = stderr
        .iter()
        .rev()
        .find(|line| line.contains("npm error") || line.contains("npm ERR!"))
        .map(|line| line.trim())
        .unwrap_or("请查看下方日志");

    format!("{app_name} {verb}失败：{detail}")
}
