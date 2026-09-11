import { useEffect } from "react";

import { isLocale } from "@/i18n";
import { applyLocale } from "@/i18n/locale";
import { useCatalogStore } from "@/store/catalog";

/**
 * 把 `prefs.locale` 校正到 i18next 与 `<html lang>`。
 *
 * 挂在 `App` 顶层调用一次。首屏语言由 `initLocale()` 用 localStorage 缓存定型，
 * 这里负责在偏好异步到位后用真值覆盖 —— 与 `syncTheme` 校正主题是同一个套路。
 */
export function useLocale(): void {
  const locale = useCatalogStore((state) => state.prefs?.locale);

  useEffect(() => {
    if (locale && isLocale(locale)) applyLocale(locale);
  }, [locale]);
}
