import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/locales/en-US.json";
import zhCN from "@/locales/zh-CN.json";

/**
 * 界面国际化。
 *
 * 语言由 `prefs.locale` 单一驱动（见 `useLocale`），**不用** i18next 的浏览器
 * 语言探测插件 —— 多一个真值源只会让「设置里选了英文但界面还是中文」这类问题
 * 变得难查。
 *
 * 词典按域分节：`nav` / `common` / `appStore` / `skills` / `mcp` / `keys` /
 * `routes` / `settings` / `errors` / `op`。`errors` 与 `op` 是 Rust 错误码的
 * 落地处（见 `src/lib/errors.ts`），**新增 Rust 错误码时两边都要加**。
 */

/** 支持的界面语言，取值域与 Rust `Prefs.locale` 一致。 */
export const LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof LOCALES)[number];

/** 兜底语言：词典缺条目时回落它。 */
export const FALLBACK_LOCALE: Locale = "zh-CN";

/** 把任意字符串收窄成受支持的 `Locale`。 */
export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

// 词典以 zh-CN 为形状真值：en-US 缺键会在 `tsc --noEmit` 阶段报错，
// 而不是等到用户切到英文才发现。
void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS },
  },
  lng: FALLBACK_LOCALE,
  fallbackLng: FALLBACK_LOCALE,
  // React 自己会转义；i18next 再转一遍会让文案里的引号显示成 &quot;
  interpolation: { escapeValue: false },
  returnNull: false,
});

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof zhCN };
  }
}

export default i18n;
