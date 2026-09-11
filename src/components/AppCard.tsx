import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpCircle,
  ArrowUpRight,
  BookOpen,
  Check,
  Download,
  ExternalLink,
  Globe,
  Loader2,
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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TaskLogPanel } from "@/components/TaskLogPanel";
import { describeNote } from "@/lib/errors";
import { openExternal } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import type { TaskState } from "@/store/apps";
import type { AppStatus, CatalogEntry, LatestVersion, TaskKind } from "@/types";

interface AppCardProps {
  entry: CatalogEntry;
  status?: AppStatus;
  latest?: LatestVersion;
  task?: TaskState;
  /** npm 不可用时禁用所有写操作，并说明原因。 */
  disabledReason?: string;
  onRunTask: (id: CatalogEntry["id"], kind: TaskKind) => void;
}

export function AppCard({
  entry,
  status,
  latest,
  task,
  disabledReason,
  onRunTask,
}: AppCardProps) {
  const { t } = useTranslation();
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);

  const installed = status?.installed ?? false;
  const busy = task?.running ?? false;
  const hasUpdate = installed && (latest?.updateAvailable ?? false);

  // installUrl 存在说明是 External 源（脚本/桌面 App），CCHub 不代为安装
  const hasInstallUrl = Boolean(status?.installUrl);
  const installable = !hasInstallUrl;

  // 装在 npm 全局目录之外的版本，本应用管不了：npm 的更新/卸载对它无效，
  // 硬来只会装出第二份或让用户以为卸载了其实没卸。
  const external = installed && !(status?.managed ?? true);
  // externalHint 是后端给的码/结构化消息，要过一遍词典才是人话
  const externalHint = status?.externalHint
    ? describeNote(status.externalHint)
    : null;
  const externalReason = external
    ? externalHint
      ? t("appCard.externalReasonWithSource", { source: externalHint })
      : t("appCard.externalReason")
    : undefined;

  const blockReason = disabledReason ?? externalReason;
  const locked = busy || Boolean(blockReason);

  // External 源的「安装」按钮 → 直接打开官网下载页；更新/卸载不变
  const onInstall = hasInstallUrl
    ? () => void openExternal(status!.installUrl!)
    : () => onRunTask(entry.id, "install");

  // 「前往下载」在 External 源时是主动作，不再锁定（禁用 npm 操作 ≠ 禁用跳官网）
  const installLocked =
    (busy && !hasInstallUrl) ||
    (blockReason !== undefined && !hasInstallUrl);

  // External 源应用已安装时，更新/卸载 UI 隐藏，让用户去官网处理
  const showManagedButtons = installable;

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3.5 space-y-0">
        <div className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-md text-xs font-semibold">
          {entry.initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold leading-none tracking-tight">
              {entry.name}
            </h3>
            <StatusBadge installed={installed} version={status?.version ?? null} />
            {external && (
              <Badge variant="outline">{t("appCard.externalBadge")}</Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1.5 truncate text-xs">
            {entry.vendor} · {entry.tagline}
          </p>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="font-normal">
              {tag}
            </Badge>
          ))}
        </div>

        <dl className="text-muted-foreground grid gap-1.5 text-xs">
          {hasUpdate && !external && latest?.latest && (
            <Field label={t("appCard.field.updateAvailable")}>
              <span className="text-foreground font-mono">
                {status?.version ?? "?"} → {latest.latest}
              </span>
            </Field>
          )}

          {installed && status?.path && (
            <Field label={t("appCard.field.location")}>
              <code
                className="block truncate font-mono"
                title={status.path}
                data-selectable
              >
                {status.path}
              </code>
            </Field>
          )}

          {/* 按钮被禁用时必须说明原因，光靠 hover 的 title 用户看不到 */}
          {external && (
            <Field label={t("appCard.field.management")}>
              <span className="leading-relaxed">
                {externalHint
                  ? t("appCard.managedBy", { source: externalHint })
                  : t("appCard.managedExternal")}
              </span>
            </Field>
          )}
        </dl>

        {task && <TaskFeedback task={task} />}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {!installed && (
            <Button
              size="sm"
              disabled={installLocked || busy}
              onClick={onInstall}
              title={hasInstallUrl ? t("appCard.installTitle") : blockReason}
            >
              {busy && !hasInstallUrl ? (
                <Loader2 className="animate-spin" />
              ) : hasInstallUrl ? (
                <Globe />
              ) : (
                <Download />
              )}
              {busy && !hasInstallUrl
                ? t("appCard.installing")
                : hasInstallUrl
                  ? t("appCard.goDownload")
                  : t("appCard.install")}
            </Button>
          )}

          {installed && showManagedButtons && (
            <Button
              size="sm"
              variant={hasUpdate ? "default" : "outline"}
              disabled={locked}
              onClick={() => onRunTask(entry.id, "update")}
              title={
                blockReason ??
                (hasUpdate ? undefined : t("appCard.reinstallTitle"))
              }
            >
              {busy ? <Loader2 className="animate-spin" /> : <ArrowUpCircle />}
              {busy
                ? t("appCard.processing")
                : hasUpdate
                  ? t("appCard.update")
                  : t("appCard.reinstall")}
            </Button>
          )}

          {installed && showManagedButtons && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              disabled={locked}
              onClick={() => setConfirmingUninstall(true)}
              title={blockReason}
            >
              <Trash2 />
              {t("appCard.uninstall")}
            </Button>
          )}

          {/* External 源已装：隐藏 npm 操作，提示用户去官网处理 */}
          {installed && !installable && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => void openExternal(status?.installUrl ?? entry.homepage)}
              title={t("appCard.manageExternalTitle")}
            >
              <ArrowUpRight />
              {t("appCard.manageExternal")}
            </Button>
          )}

          <div className="ml-auto flex items-center gap-0.5">
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              title={t("appCard.docsTitle")}
              onClick={() => void openExternal(entry.docs)}
            >
              <BookOpen />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              title={t("appCard.homepageTitle")}
              onClick={() => void openExternal(entry.homepage)}
            >
              <ExternalLink />
            </Button>
          </div>
        </div>
      </CardContent>

      {/* npm 全局卸载不可撤销且影响终端里的使用，删除前必须明确确认 */}
      <AlertDialog
        open={confirmingUninstall}
        onOpenChange={setConfirmingUninstall}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("appCard.uninstallDialog.title", { name: entry.name })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <span className="block">
                  {t("appCard.uninstallDialog.description", { name: entry.name })}
                </span>
                {status?.path && (
                  <code
                    className="bg-muted text-muted-foreground block truncate rounded-md px-2 py-1 font-mono text-xs"
                    data-selectable
                  >
                    {status.path}
                  </code>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("appCard.uninstallDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => onRunTask(entry.id, "uninstall")}
            >
              <Trash2 />
              {t("appCard.uninstallDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-14 shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function StatusBadge({
  installed,
  version,
}: {
  installed: boolean;
  version: string | null;
}) {
  const { t } = useTranslation();

  if (!installed) {
    return <Badge variant="outline">{t("appCard.status.notInstalled")}</Badge>;
  }

  return (
    <Badge variant="secondary" className="font-mono font-normal">
      <Check />
      {version ? `v${version}` : t("appCard.status.installed")}
    </Badge>
  );
}

function TaskFeedback({ task }: { task: TaskState }) {
  return (
    <div className="space-y-2">
      {task.result && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
            task.result.success
              ? "text-muted-foreground"
              : "border-destructive/50 text-destructive",
          )}
        >
          {task.result.success ? (
            <Check className="mt-px size-3.5 shrink-0" />
          ) : (
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
          )}
          <span className="leading-relaxed" data-selectable>
            {task.result.message}
          </span>
        </div>
      )}

      <TaskLogPanel logs={task.logs} />
    </div>
  );
}
