import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  CheckCircle2,
  Download,
  FolderOpen,
  Loader2,
  PackageOpen,
  RefreshCw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useSkillsStore } from "@/store/skills";
import type { SkillEntry } from "@/types";

export function Skills() {
  const { t } = useTranslation();
  const { entries, sources, loading, error, tasks, load, install, uninstall, setEnabled } =
    useSkillsStore();
  const [confirming, setConfirming] = useState<SkillEntry | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const installedIds = new Set(entries.map((e) => e.id));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="border-border bg-background/85 sticky top-0 z-10 flex items-start justify-between gap-4 border-b px-8 py-5 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">Skill</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("skills.description", { n: entries.length })}
          </p>
        </div>
        <Button variant="outline" size="icon" title={t("skills.rescan")} disabled={loading} onClick={() => void load()}>
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {error && (
            <div className="border-destructive/50 text-destructive flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span data-selectable>
                {t("skills.loadError", { err: error })}
              </span>
            </div>
          )}

          <InstalledCard
            entries={entries}
            tasks={tasks}
            loading={loading}
            onToggle={(id, enabled) => void setEnabled(id, enabled)}
            onDelete={(entry) => setConfirming(entry)}
          />

          {SKILL_CATEGORIES.map((cat) => {
            const list = sources.filter((s) => s.category === cat);
            if (list.length === 0) return null;
            return (
              <AvailableCard
                key={cat}
                title={categoryLabel(cat, t)}
                sources={list}
                installedIds={installedIds}
                tasks={tasks}
                onInstall={(id) => void install(id)}
              />
            );
          })}
        </div>
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("skills.deleteDialog.title", { name: confirming?.meta.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <span className="block">
                  {t("skills.deleteDialog.description")}
                </span>
                {confirming?.path && (
                  <code
                    className="bg-muted text-muted-foreground block truncate rounded-md px-2 py-1 font-mono text-xs"
                    data-selectable
                  >
                    {confirming.path}
                  </code>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("skills.deleteDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (confirming) void uninstall(confirming.id);
                setConfirming(null);
              }}
            >
              <Trash2 />
              {t("skills.deleteDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------- 已安装

function InstalledCard({
  entries,
  tasks,
  loading,
  onToggle,
  onDelete,
}: {
  entries: SkillEntry[];
  tasks: ReturnType<typeof useSkillsStore.getState>["tasks"];
  loading: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (entry: SkillEntry) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4" />
          {t("skills.installed.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t("skills.installed.loading")}
          </div>
        ) : entries.length === 0 ?(
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-sm">
            <PackageOpen className="size-8 opacity-40" />
            {t("skills.installed.empty")}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((entry) => {
              const task = tasks[entry.id];
              return (
                <li key={entry.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{entry.meta.name}</span>
                      {!entry.enabled && (
                        <Badge variant="outline">
                          {t("skills.installed.disabled")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
                      {entry.meta.description || t("skills.installed.noDescription")}
                    </p>
                    <p
                      className="text-muted-foreground/60 mt-0.5 truncate font-mono text-[10px]"
                      title={entry.path}
                      data-selectable
                    >
                      {entry.path}
                    </p>
                    {task?.error && (
                      <p className="text-destructive mt-1 text-xs" data-selectable>
                        {task.error}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {task?.running ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Switch
                        checked={entry.enabled}
                        onCheckedChange={(v) => onToggle(entry.id, v)}
                        title={t("skills.installed.toggleTitle")}
                      />
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      title={t("skills.installed.deleteTitle")}
                      disabled={task?.running}
                      onClick={() => onDelete(entry)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- 分类

/**
 * 后端返回的 `category` 是中文串（属目录内容），既作分组依据、也作分区标题。
 *
 * 只翻译**显示**这一层：匹配仍用后端原值，避免为纯展示需求去改 Rust 契约。
 * 后端新增分类时这里查不到，回落显示原值 —— 退化，而不是整块消失。
 */
const CATEGORY_KEYS: Record<string, string> = {
  文档: "skills.category.document",
  工程: "skills.category.engineering",
  设计: "skills.category.design",
  写作: "skills.category.writing",
};

/** 分区展示顺序，与 Rust `SkillSource` 目录里的分类集合对齐。 */
const SKILL_CATEGORIES = Object.keys(CATEGORY_KEYS);

/**
 * 键是运行时才知道的，而类型化的 `t` 只认字面量键 —— 在这一点收窄成宽松签名。
 * 与 `src/lib/errors.ts` 里的 `lookup` 是同一个理由。
 */
function categoryLabel(category: string, t: TFunction): string {
  const key = CATEGORY_KEYS[category];
  if (!key) return category;
  const loose = t as unknown as (k: string) => string;
  return loose(key);
}

// ---------------------------------------------------------------- 可安装目录（按分类分组）

function AvailableCard({
  title,
  sources,
  installedIds,
  tasks,
  onInstall,
}: {
  title: string;
  sources: ReturnType<typeof useSkillsStore.getState>["sources"];
  installedIds: Set<string>;
  tasks: ReturnType<typeof useSkillsStore.getState>["tasks"];
  onInstall: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderOpen className="size-4" />
          {title}
          <Badge variant="secondary" className="font-normal">
            {sources.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sources.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">
            {t("skills.available.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {sources.map((source) => {
              const installed = installedIds.has(source.id);
              const task = tasks[source.id];
              return (
                <li
                  key={source.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{source.name}</span>
                      {installed && (
                        <Badge variant="secondary" className="gap-1 font-normal">
                          <CheckCircle2 className="size-3" />
                          {t("skills.available.installed")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                      {source.description}
                    </p>
                    {task?.error && (
                      <p className="text-destructive mt-1 text-xs" data-selectable>
                        {task.error}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={installed ? "outline" : "default"}
                    disabled={task?.running}
                    onClick={() => onInstall(source.id)}
                    title={
                      installed
                        ? t("skills.available.reinstallTitle")
                        : t("skills.available.installTitle")
                    }
                  >
                    {task?.running ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Download />
                    )}
                    {task?.running
                      ? t("skills.available.installing")
                      : installed
                        ? t("skills.available.reinstall")
                        : t("skills.available.install")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-muted-foreground/70 mt-3 text-xs">
          {t("skills.available.sourceNote")}
        </p>
      </CardContent>
    </Card>
  );
}
