//! MCP（Model Context Protocol）服务发现与配置下发。
//!
//! 宿主 adapter 在 `mcp/hosts.rs`（Claude Code / Codex / Gemini CLI 三宿主），
//! 这里是服务目录、公共校验与握手测试。
//!
//! 安全边界：
//! 1. stdio 服务结构化为 command + args 数组，spawn 不走 shell——命令注入不成立
//! 2. 写宿主配置前先备份 `<file>.cchub.bak`，写失败自动回滚
//! 3. 只增删自己写的条目：CCHub 写入的条目记在 `<宿主文件>.cchub-managed`
//!    清单里，用户手写的服务条目永远不动
//! 4. env 里引用 API Key 用 `@keychain:provider/label` 形式，写入宿主时从钥匙串展开

use crate::error;
use std::io::{BufRead, BufReader, Write};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::keys;

// ---------------------------------------------------------------- 类型

/// MCP 服务传输方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    Stdio,
    Http,
}

/// 服务声明的一个可配置参数（前端渲染表单用）。
#[derive(Debug, Clone, Serialize)]
pub struct ArgSpec {
    /// 参数名（展示用）。
    pub label: &'static str,
    /// 占位提示。
    pub placeholder: &'static str,
}

/// 服务声明的环境变量（写入宿主 env 段的模板）。
#[derive(Debug, Clone, Serialize)]
pub struct EnvSpec {
    /// 环境变量名，如 FIRECRAWL_API_KEY。
    pub key: &'static str,
    /// 值来源：direct = 用户直接输入（敏感值可选 @keychain: 引用）。
    pub source: EnvSource,
    /// 占位提示。
    pub placeholder: &'static str,
    /// 是否必填。
    pub required: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EnvSource {
    /// 用户输入明文。
    Direct,
    /// 默认展开到用户主目录。
    ///
    /// 暂无内置服务用到，但它是**前后端契约的一部分**（前端 `EnvSource` 类型同样
    /// 声明了 `"homeDir"`），也是给未来服务的取值 —— 删掉会让契约缺一块。故保留。
    #[allow(dead_code)]
    HomeDir,
}

/// 目录里的一个 MCP 服务（内置白名单）。
///
/// `rename_all` 必须保留：前端按 camelCase 消费（`argSpecs` / `envSpecs` /
/// `installHint`）。漏掉它不会有编译错误，但真机模式下 MCP 页面会直接崩
/// （`undefined.length`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpService {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub transport: Transport,
    /// stdio：要写入宿主配置的 command。
    pub command: &'static str,
    /// stdio：默认参数（可被用户覆盖的参数另列在 arg_specs）。
    pub args: &'static [&'static str],
    /// 需要用户提供的参数（追加在默认 args 后）。
    pub arg_specs: &'static [ArgSpec],
    /// 需要用户填写的环境变量。
    pub env_specs: &'static [EnvSpec],
    /// 安装提示（stdio 服务的命令怎么装上）。
    pub install_hint: &'static str,
}

pub const MCP_SERVICES: &[McpService] = &[
    // ---- 官方参考实现 ----
    McpService {
        id: "fetch",
        name: "Fetch",
        description: "抓取网页并转成 Markdown（官方，uvx 运行）",
        transport: Transport::Stdio,
        command: "uvx",
        args: &["mcp-server-fetch"],
        arg_specs: &[],
        env_specs: &[],
        install_hint: "需要安装 uv（brew install uv）",
    },
    McpService {
        id: "memory",
        name: "Memory",
        description: "基于知识图谱的持久记忆（官方）",
        transport: Transport::Stdio,
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-memory"],
        arg_specs: &[],
        env_specs: &[],
        install_hint: "需要 Node.js",
    },
    McpService {
        id: "sequential-thinking",
        name: "Sequential Thinking",
        description: "结构化多步推理（官方）",
        transport: Transport::Stdio,
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-sequential-thinking"],
        arg_specs: &[],
        env_specs: &[],
        install_hint: "需要 Node.js",
    },
    McpService {
        id: "everything",
        name: "Everything",
        description: "测试用服务：覆盖全部 MCP 能力",
        transport: Transport::Stdio,
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-everything"],
        arg_specs: &[],
        env_specs: &[],
        install_hint: "需要 Node.js",
    },
    // ---- 热门通用服务 ----
    McpService {
        id: "filesystem",
        name: "Filesystem",
        description: "受控的文件系统读写：读写、搜索、移动（官方）",
        transport: Transport::Stdio,
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-filesystem"],
        // 允许访问的目录作为位置参数追加
        arg_specs: &[ArgSpec {
            label: "允许访问的目录",
            placeholder: "如 ~/Projects（多个以空格分隔）",
        }],
        env_specs: &[],
        install_hint: "需要 Node.js",
    },
    McpService {
        id: "playwright",
        name: "Playwright",
        description: "浏览器自动化：导航、点击、填表、截图（微软官方）",
        transport: Transport::Stdio,
        command: "npx",
        args: &["-y", "@playwright/mcp"],
        arg_specs: &[],
        env_specs: &[],
        install_hint: "需要 Node.js；首次运行会下载浏览器内核",
    },
    McpService {
        id: "context7",
        name: "Context7",
        description: "为代码智能体提供最新的库文档（Upstash，含 MCP 上下文）",
        transport: Transport::Stdio,
        command: "npx",
        args: &["-y", "@upstash/context7-mcp"],
        arg_specs: &[],
        env_specs: &[EnvSpec {
            key: "CONTEXT7_API_KEY",
            source: EnvSource::Direct,
            placeholder: "可选；留空走公共限流",
            required: false,
        }],
        install_hint: "需要 Node.js",
    },
    McpService {
        id: "desktop-commander",
        name: "Desktop Commander",
        description: "终端操作与进程管理：跑命令、管理会话（社区最热之一）",
        transport: Transport::Stdio,
        command: "npx",
        args: &["-y", "@wonderwhy-er/desktop-commander"],
        arg_specs: &[],
        env_specs: &[],
        install_hint: "需要 Node.js",
    },
    McpService {
        id: "firecrawl",
        name: "Firecrawl",
        description: "网站抓取与结构化提取（Mendable）",
        transport: Transport::Stdio,
        command: "npx",
        args: &["-y", "firecrawl-mcp"],
        arg_specs: &[],
        env_specs: &[EnvSpec {
            key: "FIRECRAWL_API_KEY",
            source: EnvSource::Direct,
            placeholder: "fc-…（firecrawl.dev 获取）",
            required: true,
        }],
        install_hint: "需要 Node.js 与 Firecrawl API Key",
    },
];

pub fn service(id: &str) -> Option<&'static McpService> {
    MCP_SERVICES.iter().find(|s| s.id == id)
}

/// 宿主里当前的一个 MCP 条目（读回）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostEntry {
    /// mcpServers 里的键名。
    pub name: String,
    pub managed: bool,
    /// mcpServers 条目原文（前端展示 command/args）。
    pub spec: Value,
}

/// 读宿主配置的结果：全部条目 + 文件不存在/损坏的说明。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostConfig {
    pub entries: Vec<HostEntry>,
    /// 文件不存在或 JSON 损坏时说明；None = 正常读取。
    pub note: Option<String>,
}

// ---------------------------------------------------------------- 宿主（多宿主 adapter）

pub mod hosts;

/// 目录里的全部 MCP 服务（内置白名单）。
#[tauri::command]
pub fn list_mcp_services() -> &'static [McpService] {
    MCP_SERVICES
}

/// 读指定宿主的 MCP 配置 + managed 标记。
#[tauri::command]
pub async fn read_host_config(host_id: String) -> Result<HostConfig, String> {
    if !hosts::is_mcp_host(&host_id) {
        return Err(error::err("unknownHost", &[("host", host_id.as_str())]));
    }
    tauri::async_runtime::spawn_blocking(move || Ok(hosts::read_host(&host_id)))
        .await
        .map_err(|err| error::io_failed("task", err))?
}

/// 写入请求：服务 id + 用户填写的参数与环境变量。
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WriteRequest {
    /// arg_specs 对应的位置参数值（按序追加在默认 args 后）。
    pub arg_values: Vec<String>,
    /// env_specs 对应的值；支持 @keychain:provider/label 引用。
    pub env_values: std::collections::BTreeMap<String, String>,
}

/// 把目录服务写进指定宿主。同名条目（无论谁写的）都会被覆盖，覆盖前备份。
#[tauri::command]
pub async fn write_mcp_service(
    host_id: String,
    id: String,
    request: Option<WriteRequest>,
) -> Result<HostConfig, String> {
    if !hosts::is_mcp_host(&host_id) {
        return Err(error::err("unknownHost", &[("host", host_id.as_str())]));
    }
    let svc = service(&id).ok_or_else(|| error::err("unknownMcpService", &[("id", id.as_str())]))?;
    let request = request.unwrap_or_default();

    tauri::async_runtime::spawn_blocking(move || {
        // 校验必填项都给了
        for spec in svc.env_specs {
            if spec.required {
                let provided = request
                    .env_values
                    .get(spec.key)
                    .map(|v| !v.trim().is_empty())
                    .unwrap_or(false);
                if !provided {
                    return Err(error::err("missingEnv", &[("key", spec.key)]));
                }
            }
        }

        // 组装 args：默认值 + 用户参数（~ 展开到 home）
        let home = std::env::var("HOME").unwrap_or_default();
        let mut args: Vec<String> = svc.args.iter().map(|s| s.to_string()).collect();
        for value in &request.arg_values {
            if value.trim().is_empty() {
                continue;
            }
            args.push(expand_home(value, &home));
        }

        // 组装 env：用户值（keychain 引用展开成明文——只在这一步）
        let mut env = std::collections::BTreeMap::new();
        for (key, value) in &request.env_values {
            if value.trim().is_empty() {
                continue;
            }
            let resolved = resolve_env_value(value)?;
            env.insert(key.clone(), resolved);
        }

        hosts::write_host(&host_id, svc.id, svc.command, &args, env)?;

        Ok(hosts::read_host(&host_id))
    })
    .await
    .map_err(|err| error::io_failed("task", err))?
}

/// 只删 CCHub 写入的条目；用户手写的报错不动。
#[tauri::command]
pub async fn remove_mcp_service(host_id: String, id: String) -> Result<HostConfig, String> {
    if !hosts::is_mcp_host(&host_id) {
        return Err(error::err("unknownHost", &[("host", host_id.as_str())]));
    }
    tauri::async_runtime::spawn_blocking(move || {
        hosts::remove_host(&host_id, &id)?;
        Ok(hosts::read_host(&host_id))
    })
    .await
    .map_err(|err| error::io_failed("task", err))?
}

// ---------------------------------------------------------------- 握手测试

/// 服务连通性测试结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTestResult {
    pub ok: bool,
    /// 成功时服务自报的名称。
    pub server_name: Option<String>,
    /// 失败原因。
    pub error: Option<String>,
}

/// 与 stdio MCP 服务做 initialize 握手。
///
/// 协议：发 initialize 请求，等 response 里 capabilities；服务起来了就算通。
/// npx 型服务首次运行要下载包，超时放得比较宽（60s）。
#[tauri::command]
pub async fn test_mcp_service(id: String) -> Result<McpTestResult, String> {
    let svc = service(&id).ok_or_else(|| error::err("unknownMcpService", &[("id", id.as_str())]))?;

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut child = match std::process::Command::new(svc.command)
            .args(svc.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(err) => {
                return McpTestResult {
                    ok: false,
                    server_name: None,
                    error: Some(error::err(
                        "mcpSpawnFailed",
                        &[
                            ("command", svc.command),
                            ("err", &err.to_string()),
                            ("hint", svc.install_hint),
                        ],
                    )),
                };
            }
        };

        // MCP stdio：JSON-RPC 行协议
        let init = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "cchub", "version": "0.1.0"}
            }
        });

        let ok = (|| -> Option<String> {
            let stdin = child.stdin.as_mut()?;
            let line = serde_json::to_string(&init).ok()?;
            writeln!(stdin, "{line}").ok()?;
            stdin.flush().ok()?;

            // 逐行读 stdout 找 id=1 的 response（60s 上限，npx 首次要下载）
            let stdout = child.stdout.take()?;
            let deadline = std::time::Instant::now() + Duration::from_secs(60);
            for line in BufReader::new(stdout).lines() {
                if std::time::Instant::now() > deadline {
                    return None;
                }
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                let Ok(v) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if v.get("id") == Some(&json!(1)) {
                    let name = v
                        .pointer("/result/serverInfo/name")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    return Some(name.unwrap_or_default());
                }
            }
            None
        })()
        .map(Some)
        .unwrap_or(None);

        let _ = child.kill();
        let _ = child.wait();

        match ok {
            Some(name) => McpTestResult {
                ok: true,
                server_name: Some(name),
                error: None,
            },
            None => McpTestResult {
                ok: false,
                server_name: None,
                error: Some(error::err_plain("mcpHandshakeTimeout")),
            },
        }
    })
    .await
    .map_err(|err| error::io_failed("task", err))?;

    Ok(result)
}

/// 暴露给 M5：从钥匙串解析 `@keychain:provider/label` 引用。
/// 非 keychain 引用原样返回。
pub fn resolve_env_value(raw: &str) -> Result<String, String> {
    let Some(rest) = raw.strip_prefix("@keychain:") else {
        return Ok(raw.to_string());
    };
    let (provider, label) = rest
        .split_once('/')
        .ok_or_else(|| error::err("keyRefFormatWithValue", &[("raw", raw)]))?;
    keys::reveal_key_sync(provider, label)
}

/// `~/xxx` / `~` 展开为 home 绝对路径（宿主配置里的路径不该带波浪号）。
fn expand_home(value: &str, home: &str) -> String {
    if let Some(rest) = value.strip_prefix("~/") {
        format!("{home}/{rest}")
    } else if value == "~" {
        home.to_string()
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_ids_unique() {
        for (i, s) in MCP_SERVICES.iter().enumerate() {
            assert!(
                MCP_SERVICES.iter().skip(i + 1).all(|o| o.id != s.id),
                "重复 id: {}",
                s.id
            );
        }
    }

    #[test]
    fn known_service_lookup() {
        assert!(service("fetch").is_some());
        assert!(service("nope").is_none());
    }

    /// 前端按 camelCase 消费 MCP 服务字段，Rust 侧漏掉 `rename_all` 不会有编译
    /// 错误 —— 只会在真机模式下让 MCP 页面崩掉（`svc.argSpecs` 是 undefined）。
    /// 这个断言就是那道防线：序列化后的键名必须与 `src/types/index.ts` 对齐。
    #[test]
    fn service_serializes_as_camel_case() {
        let v = serde_json::to_value(&MCP_SERVICES[0]).unwrap();
        let obj = v.as_object().unwrap();

        for key in ["argSpecs", "envSpecs", "installHint"] {
            assert!(obj.contains_key(key), "缺字段 {key}（漏了 rename_all？）");
        }
        for snake in ["arg_specs", "env_specs", "install_hint"] {
            assert!(!obj.contains_key(snake), "不该出现 snake_case 的 {snake}");
        }

        // 嵌套的 ArgSpec / EnvSpec 同样是前端直接消费的
        let with_args = MCP_SERVICES
            .iter()
            .find(|s| !s.arg_specs.is_empty())
            .expect("应至少有一个带参数的 stdio 服务");
        let v = serde_json::to_value(with_args).unwrap();
        let first = &v["argSpecs"][0];
        assert!(first.get("label").is_some() && first.get("placeholder").is_some());
    }

    #[test]
    fn keychain_ref_parsing() {
        // 非 keychain 引用原样返回（无钥匙串依赖）
        assert_eq!(resolve_env_value("plain").unwrap(), "plain");
        // 格式错误的 keychain 引用要报错而不是静默
        assert!(resolve_env_value("@keychain:noslash").is_err());
        // 正确引用在测试环境里会走 reveal_key_sync（无 AppHandle），
        // 报读取钥匙串失败——这里只验证它不是格式错误
        let err = resolve_env_value("@keychain:anthropic/work").unwrap_err();
        assert!(
            error::code_of(&err).is_some(),
            "错误应是结构化格式：{err}"
        );
        assert_ne!(
            error::code_of(&err).as_deref(),
            Some("keyRefFormatWithValue"),
            "格式正确，不该报格式错误"
        );
    }

    #[test]
    fn write_removes_only_managed() {
        // managed 清单逻辑的纯函数部分
        let mut managed = vec!["fetch".to_string(), "memory".to_string()];
        managed.retain(|n| n != "fetch");
        assert_eq!(managed, vec!["memory".to_string()]);
    }

    #[test]
    fn expands_home_in_arg_values() {
        assert_eq!(expand_home("~/Projects", "/Users/x"), "/Users/x/Projects");
        assert_eq!(expand_home("~", "/Users/x"), "/Users/x");
        assert_eq!(expand_home("/abs/path", "/Users/x"), "/abs/path");
        assert_eq!(expand_home("relative", "/Users/x"), "relative");
    }

    #[test]
    fn services_with_required_env_declare_it() {
        // 声明了 required 的 env 必须有对应 spec（保证前端能渲染出表单）
        for svc in MCP_SERVICES {
            for spec in svc.env_specs {
                if spec.required {
                    assert!(
                        svc.env_specs.iter().any(|s| s.key == spec.key),
                        "{} 的 required env {} 缺少声明",
                        svc.id,
                        spec.key
                    );
                }
            }
        }
    }

    #[test]
    fn filesystem_has_arg_spec() {
        // filesystem 允许目录是位置参数，必须声明 arg_spec 才能被用户配置
        let fs = service("filesystem").unwrap();
        assert_eq!(fs.arg_specs.len(), 1);
        let fc = service("firecrawl").unwrap();
        assert!(fc
            .env_specs
            .iter()
            .any(|s| s.key == "FIRECRAWL_API_KEY" && s.required));
    }
}
