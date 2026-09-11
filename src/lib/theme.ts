/**
 * 主题解析与应用。
 *
 * CSP 里 `script-src 'self'` 禁止内联脚本，所以没法在 index.html 里同步打标；
 * 改为在 React 挂载前由这里同步设置 class。首屏那一瞬的背景色由 globals.css
 * 中的 `prefers-color-scheme` 兜底，不会看到白闪。
 *
 * 偏好驱动的三段式：
 * 1. `initTheme()`（同步，挂载前）读 localStorage 缓存的主题——上次会话保存的值，
 *    没有缓存时跟随系统。缓存是 prefs.json 的镜像，只是为了让启动这一瞬不用等
 *    异步 IPC。
 * 2. `PrefsState` 加载完成后（Settings/AppStore 的 loadCatalog）调用 `syncTheme(prefs)`，
 *    用真值校正缓存并应用。
 * 3. `applyTheme(theme)` 是唯一出口，设置页切换主题时调用并同时写缓存。
 */

import type { Prefs } from "@/types";

export type ThemeMode = Prefs["theme"]; // "system" | "light" | "dark"

const THEME_CACHE_KEY = "cchub:theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 偏好模式最终落到页面的实际主题。 */
export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return mode;
}

function apply(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.style.colorScheme = resolved;
}

/** 持久化缓存，让下次启动的 initTheme 不用等 IPC。 */
function cache(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_CACHE_KEY, mode);
  } catch {
    // localStorage 被禁用（隐私模式等）：仅本次会话生效，可接受
  }
}

function cachedMode(): ThemeMode {
  try {
    const value = localStorage.getItem(THEME_CACHE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // 读不了就当没有
  }
  return "system";
}

/** 挂载前同步调用：应用缓存的主题并挂系统监听。返回清理函数。 */
export function initTheme(): () => void {
  const mode = cachedMode();
  apply(resolveTheme(mode));

  // 跟随系统模式下，系统切换时页面要立即跟着变；固定模式不受影响
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (cachedMode() === "system") apply(systemPrefersDark() ? "dark" : "light");
  };

  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** 偏好加载后校正：以 prefs 真值为准刷新页面与缓存。 */
export function syncTheme(prefs: Prefs) {
  cache(prefs.theme);
  apply(resolveTheme(prefs.theme));
}

/** 设置页切换主题：立即应用、写缓存；prefs 的落盘由调用方负责。 */
export function applyTheme(mode: ThemeMode) {
  cache(mode);
  apply(resolveTheme(mode));
}
