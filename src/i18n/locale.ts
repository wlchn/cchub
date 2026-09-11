import i18n, { FALLBACK_LOCALE, isLocale, type Locale } from "@/i18n";

/**
 * 语言的落地与缓存。
 *
 * 与 `lib/theme.ts` 是同一套三段式，理由也一样 —— 偏好是异步 IPC 读来的，
 * 但首屏必须立刻是对的语言，否则英文用户会看到中文闪一下：
 *
 * 1. `initLocale()`（同步，挂载前）读 localStorage 缓存，缓存是 prefs.json 的镜像。
 * 2. 偏好加载完成后 `useLocale` 触发校正，以 prefs 真值为准。
 * 3. `applyLocale(locale)` 是唯一出口，负责改语言、改 `<html lang>`、写缓存。
 */

const LOCALE_CACHE_KEY = "cchub:locale";

/** 持久化缓存，让下次启动的 initLocale 不用等 IPC。 */
function cache(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_CACHE_KEY, locale);
  } catch {
    // localStorage 被禁用（隐私模式等）：仅本次会话生效，可接受
  }
}

function cachedLocale(): Locale {
  try {
    const value = localStorage.getItem(LOCALE_CACHE_KEY);
    if (value && isLocale(value)) return value;
  } catch {
    // 读不了就当没有
  }
  return FALLBACK_LOCALE;
}

/** 切换语言的唯一出口。词典是随包打进来的，`changeLanguage` 实际上同步生效。 */
export function applyLocale(locale: Locale): void {
  cache(locale);
  void i18n.changeLanguage(locale);
  // 无障碍朗读与浏览器断词都依赖这个属性，必须跟着语言走
  document.documentElement.lang = locale;
}

/** 挂载前同步调用：先用缓存定型，避免首屏闪错语言。 */
export function initLocale(): void {
  applyLocale(cachedLocale());
}
