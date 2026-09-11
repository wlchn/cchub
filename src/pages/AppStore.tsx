import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, Search, TriangleAlert } from "lucide-react";

import { AppCard } from "@/components/AppCard";
import { EnvironmentBanner } from "@/components/EnvironmentBanner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppsStore } from "@/store/apps";
import { useCatalogStore } from "@/store/catalog";

export function AppStore() {
  const { t } = useTranslation();
  const {
    environment,
    statuses,
    latest,
    tasks,
    loading,
    error,
    bootstrap,
    refreshStatuses,
    checkUpdates,
    runTask,
  } = useAppsStore();

  const {
    entries: catalog,
    source: catalogSource,
    note: catalogNote,
    loading: catalogLoading,
    prefs,
    loadCatalog,
  } = useCatalogStore();

  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // 行为门控（M1.2）：bootstrap 等 prefs 到位再跑，detectOnLaunch=false
  // 才能真正跳过首屏检测。prefs 为 null（未加载完）时也不先跑——
  // 宁可首屏多等一拍偏好，也不要把用户明确关掉的行为又执行一遍。
  useEffect(() => {
    if (prefs === null) return;
    void bootstrap({
      detectOnLaunch: prefs.detectOnLaunch,
      checkUpdatesOnLaunch: prefs.checkUpdatesOnLaunch,
    });
  }, [prefs, bootstrap]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;

    return catalog.filter((entry) =>
      [entry.name, entry.vendor, entry.tagline, entry.description, ...entry.tags]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [query, catalog]);

  const installedCount = catalog.filter((e) => statuses[e.id]?.installed).length;

  // npm 缺失时安装按钮全部禁用，并把原因带到按钮的 title 上
  const disabledReason =
    environment && !environment.npmVersion
      ? t("appStore.npmRequired")
      : undefined;

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([refreshStatuses(), loadCatalog()]);
      await checkUpdates();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title={t("appStore.title")}
        description={t("appStore.description", {
          installed: installedCount,
          total: catalog.length,
        })}
        actions={
          <>
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("appStore.searchPlaceholder")}
                className="h-9 w-48 pl-8"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              title={t("appStore.refresh")}
              disabled={refreshing || loading}
              onClick={() => void handleRefresh()}
            >
              <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-5xl space-y-5">
          <EnvironmentBanner environment={environment} />

          {error && (
            <div className="border-destructive/50 text-destructive flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span data-selectable>
                {t("appStore.detectError", { err: error })}
              </span>
            </div>
          )}

          {loading || catalogLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-24 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {t("appStore.loading")}
            </div>
          ) : results.length === 0 ? (
            <div className="text-muted-foreground py-24 text-center text-sm">
              {t("appStore.noMatch", { query })}
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              {results.map((entry) => (
                <AppCard
                  key={entry.id}
                  entry={entry}
                  status={statuses[entry.id]}
                  latest={latest[entry.id]}
                  task={tasks[entry.id]}
                  disabledReason={disabledReason}
                  onRunTask={(id, kind) => void runTask(id, kind)}
                />
              ))}
            </div>
          )}

          {/* 目录来源如实显示：远端 / 缓存回落 / 内置，用户需要知道看的是哪份数据 */}
          <p className="text-muted-foreground/70 pt-2 text-center text-xs">
            {catalogNote ??
              t("appStore.catalogSource", {
                source:
                  catalogSource === "remote"
                    ? t("appStore.source.remote")
                    : catalogSource === "cache"
                      ? t("appStore.source.cache")
                      : t("appStore.source.builtin"),
              })}
          </p>
        </div>
      </div>
    </div>
  );
}
