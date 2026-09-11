//! 供应商目录：keys / routes / 前端共用的唯一真值。
//!
//! 此前列出供应商的地方有三处（keys.rs 的 Provider enum、ApiKeys.tsx 的 PROVIDERS、
//! RouteCard.tsx 的 ROUTABLE_PROVIDERS），改一处漏两处。现在统一成这里的静态目录，
//! 前端经 `list_providers` 命令拉取，Rust 各模块直接引用。
//!
//! 目录按能力分两类：
//! - 可路由（`anthropic_endpoint = Some`）：提供 Anthropic Messages 兼容端点，
//!   Claude Code 指过去就能用
//! - 仅 Key 管理：只能存 Key / 测连通（openai / google / xai 的官方端点不是
//!   Anthropic 兼容格式，路由无意义）

use serde::Serialize;

/// 探活请求方式。各家 REST 风格不一：多数支持 GET /models，
/// Kimi 只认 POST /messages（GET /models 是 404）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProbeMethod {
    /// GET（models 列表端点）。
    Get,
    /// POST（messages 端点，max_tokens=1 的最小请求）。
    Post,
}

/// 一个供应商的全部静态信息。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    /// 稳定 id，与钥匙串条目名的前缀一致。
    pub id: &'static str,
    /// 展示名。
    pub label: &'static str,
    /// Anthropic 兼容 base_url（Claude Code 路由可用）；None = 不可路由到 Claude Code。
    pub anthropic_endpoint: Option<&'static str>,
    /// Gemini API 兼容 base_url（Gemini CLI 路由可用）；None = 不可路由到 Gemini CLI。
    /// 与 anthropic_endpoint 独立：两种协议的兼容网关生态不同。
    pub gemini_endpoint: Option<&'static str>,
    /// key 连通测试的端点。
    pub probe_endpoint: &'static str,
    /// key 连通测试的鉴权头名。
    pub probe_header: &'static str,
    /// true = Bearer 前缀鉴权；false = 裸 key。
    pub bearer_auth: bool,
    /// 探活请求方式。
    pub probe_method: ProbeMethod,
    /// 该供应商当前的推荐模型名（前端预填表单用）。
    pub default_models: &'static [&'static str],
}

pub const PROVIDERS: &[ProviderInfo] = &[
    // ---- 可路由（Anthropic 兼容端点）----
    ProviderInfo {
        id: "anthropic",
        label: "Anthropic（官方）",
        anthropic_endpoint: Some("https://api.anthropic.com"),
        gemini_endpoint: None,
        probe_endpoint: "https://api.anthropic.com/v1/models",
        probe_header: "x-api-key",
        bearer_auth: false,
        probe_method: ProbeMethod::Get,
        default_models: &["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    },
    ProviderInfo {
        id: "openrouter",
        label: "OpenRouter（聚合中转）",
        anthropic_endpoint: Some("https://openrouter.ai/api/v1"),
        gemini_endpoint: None,
        probe_endpoint: "https://openrouter.ai/api/v1/models",
        probe_header: "Authorization",
        bearer_auth: true,
        probe_method: ProbeMethod::Get,
        default_models: &[],
    },
    ProviderInfo {
        id: "glm",
        label: "GLM（智谱）",
        anthropic_endpoint: Some("https://open.bigmodel.cn/api/anthropic"),
        gemini_endpoint: None,
        probe_endpoint: "https://open.bigmodel.cn/api/anthropic/v1/models",
        probe_header: "x-api-key",
        bearer_auth: false,
        probe_method: ProbeMethod::Get,
        default_models: &["glm-5.2", "glm-4.7"],
    },
    ProviderInfo {
        id: "deepseek",
        label: "DeepSeek",
        anthropic_endpoint: Some("https://api.deepseek.com/anthropic"),
        gemini_endpoint: None,
        probe_endpoint: "https://api.deepseek.com/anthropic/v1/models",
        probe_header: "x-api-key",
        bearer_auth: false,
        probe_method: ProbeMethod::Get,
        default_models: &["deepseek-flash"],
    },
    ProviderInfo {
        id: "kimi",
        label: "Kimi（Moonshot）",
        anthropic_endpoint: Some("https://api.moonshot.cn/anthropic"),
        gemini_endpoint: None,
        probe_endpoint: "https://api.moonshot.cn/anthropic/v1/messages",
        probe_header: "Authorization",
        bearer_auth: true,
        probe_method: ProbeMethod::Post,
        default_models: &["kimi-k3", "kimi-k2.7-code"],
    },
    ProviderInfo {
        id: "minimax",
        label: "MiniMax",
        anthropic_endpoint: Some("https://api.minimaxi.com"),
        gemini_endpoint: None,
        probe_endpoint: "https://api.minimaxi.com/v1/models",
        probe_header: "Authorization",
        bearer_auth: true,
        probe_method: ProbeMethod::Get,
        default_models: &["MiniMax-M3", "MiniMax-M2.7"],
    },
    // ---- 仅 Key 管理（无 Anthropic 兼容端点）----
    ProviderInfo {
        id: "openai",
        label: "OpenAI",
        anthropic_endpoint: None,
        gemini_endpoint: None,
        probe_endpoint: "https://api.openai.com/v1/models",
        probe_header: "Authorization",
        bearer_auth: true,
        probe_method: ProbeMethod::Get,
        default_models: &[],
    },
    ProviderInfo {
        id: "google",
        label: "Google",
        anthropic_endpoint: None,
        gemini_endpoint: Some("https://generativelanguage.googleapis.com/v1beta"),
        probe_endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
        probe_header: "x-goog-api-key",
        bearer_auth: false,
        probe_method: ProbeMethod::Get,
        default_models: &[],
    },
    ProviderInfo {
        id: "xai",
        label: "xAI",
        anthropic_endpoint: None,
        gemini_endpoint: None,
        probe_endpoint: "https://api.x.ai/v1/models",
        probe_header: "Authorization",
        bearer_auth: true,
        probe_method: ProbeMethod::Get,
        default_models: &[],
    },
];

/// 按 id 查目录。
pub fn find(id: &str) -> Option<&'static ProviderInfo> {
    PROVIDERS.iter().find(|p| p.id == id)
}

/// 供应商目录（前端拉取）。
#[tauri::command]
pub fn list_providers() -> &'static [ProviderInfo] {
    PROVIDERS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_unique() {
        for (i, p) in PROVIDERS.iter().enumerate() {
            assert!(
                PROVIDERS.iter().skip(i + 1).all(|o| o.id != p.id),
                "重复 id: {}",
                p.id
            );
        }
    }

    #[test]
    fn routable_providers_have_endpoint() {
        // 声称可路由的必须给出对应协议的兼容端点
        for p in PROVIDERS {
            if let Some(ep) = p.anthropic_endpoint {
                assert!(ep.starts_with("https://"), "{} 的 Anthropic 端点不是 https", p.id);
            }
            if let Some(ep) = p.gemini_endpoint {
                assert!(ep.starts_with("https://"), "{} 的 Gemini 端点不是 https", p.id);
            }
        }
    }

    #[test]
    fn known_provider_lookup() {
        assert!(find("glm").is_some());
        assert!(find("nope").is_none());
    }

    #[test]
    fn legacy_ids_still_present() {
        // keys.rs 原有 5 家不能丢（已存的钥匙串条目前缀依赖它们）
        for id in ["anthropic", "openai", "google", "xai", "openrouter"] {
            assert!(find(id).is_some(), "原 provider {} 不见了", id);
        }
    }
}
