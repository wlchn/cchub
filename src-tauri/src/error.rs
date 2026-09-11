//! 结构化错误 —— 前端的翻译接缝。
//!
//! 命令仍然返回 `Result<T, String>`（不改 30 个 `#[tauri::command]` 的签名），
//! 但 String 的内容从自然语言换成一段 JSON：
//!
//! ```json
//! {"code":"providerUnknown","args":{"provider":"glm"}}
//! ```
//!
//! 前端 `src/lib/errors.ts` 解析出 code 后查 `errors.*` 词典翻译。用 JSON 而不是
//! 自定义分隔符，是因为错误参数里会出现中文、冒号、竖线（如 provider 名、
//! 路径、底层 errno 文本），任何裸串拼接的格式都会被这些字符撑破。
//!
//! 前端对解析失败/词典缺 key 一律回落显示原文，所以漏改一处只会显示中文，
//! 不会显示空白或裸露的 key。

use std::fmt::Display;

/// 构造一条结构化错误。
///
/// `code` 是词典键（`errors.<code>`），`args` 是该条文案的插值参数。
pub fn err(code: &str, args: &[(&str, &str)]) -> String {
    if args.is_empty() {
        let mut s = String::with_capacity(code.len() + 12);
        s.push_str("{\"code\":");
        s.push_str(&quote(code));
        s.push('}');
        return s;
    }

    let mut s = String::with_capacity(code.len() + args.len() * 32 + 16);
    s.push_str("{\"code\":");
    s.push_str(&quote(code));
    s.push_str(",\"args\":{");
    for (i, (k, v)) in args.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&quote(k));
        s.push(':');
        s.push_str(&quote(v));
    }
    s.push_str("}}");
    s
}

/// 无参数错误的便捷形式。
pub fn err_plain(code: &str) -> String {
    err(code, &[])
}

/// 构造一条结构化**提示**（不是错误）。
///
/// 线格式与 `err` 完全相同，区别只在前端去 `notes.*` 还是 `errors.*` 查词典
/// —— 用在 `CatalogResponse.note` 这类「状态说明」字段上：它们同样是后端产出的
/// 用户可见文案，但语义上不是失败。
pub fn note(code: &str, args: &[(&str, &str)]) -> String {
    err(code, args)
}

/// I/O 类错误的统一包装：`op` 是 `op.*` 词典键（动词短语），`e` 是底层错误。
///
/// ```ignore
/// fs::write(&path, text).map_err(|e| error::io_failed("writePrefs", e))?;
/// ```
pub fn io_failed(op: &str, e: impl Display) -> String {
    err("ioFailed", &[("op", op), ("err", &e.to_string())])
}

/// 取出结构化错误里的 `code`；不是结构化格式时返回 `None`。
///
/// 只给测试用 —— 断言稳定的错误码比断言散文更抗改（文案一改测试就碎）。
#[cfg(test)]
pub fn code_of(raw: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()?
        .get("code")?
        .as_str()
        .map(str::to_string)
}

/// 借 `serde_json` 做转义。对 `&str` 的序列化不可能失败，但仍给出兜底。
fn quote(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_error_has_code_only() {
        assert_eq!(err_plain("nameRequired"), r#"{"code":"nameRequired"}"#);
    }

    #[test]
    fn args_are_serialized() {
        let got = err("unknownProvider", &[("provider", "glm")]);
        assert_eq!(got, r#"{"code":"unknownProvider","args":{"provider":"glm"}}"#);
    }

    /// 参数里的引号、中文、换行都不能破坏 JSON —— 这正是弃用裸串拼接的原因。
    #[test]
    fn hostile_args_stay_parseable() {
        for nasty in [
            r#"he said "hi""#,
            "写入失败：磁盘已满",
            "line1\nline2",
            "a|b:c",
            "\\",
        ] {
            let raw = err("requestFailed", &[("msg", nasty)]);
            let v: serde_json::Value =
                serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{nasty:?} 撑破了 JSON: {e}"));
            assert_eq!(v["args"]["msg"], nasty);
        }
    }

    #[test]
    fn io_failed_carries_op_and_err() {
        let raw = io_failed("writePrefs", std::io::Error::other("disk full"));
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["code"], "ioFailed");
        assert_eq!(v["args"]["op"], "writePrefs");
        assert_eq!(v["args"]["err"], "disk full");
    }
}
