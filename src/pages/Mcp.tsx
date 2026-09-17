import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  Plug,
  PlugZap,
  RefreshCw,
  Trash2,
  TriangleAlert,
  XCircle,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { describeNote } from "@/lib/errors";
import { MCP_HOSTS, type McpHostTargetKey } from "@/lib/ipc";
import { useMcpStore } from "@/store/mcp";
import type { HostEntry, McpService, McpWriteRequest } from "@/types";

export function Mcp() {
  const { t } = useTranslation();
  const { services, hosts, loading, error, ops, tests, load, add, remove, test } =
    useMcpStore();
  const [confirming, setConfirming] = useState<{ host: string; name: string } | null>(
    null,
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="border-border bg-background/85 sticky top-0 z-10 flex items-start justify-between gap-4 border-b px-8 py-5 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">MCP</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("mcp.description")}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          title={t("mcp.reload")}
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {error && (
            <div className="border-destructive/50 text-destructive flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span data-selectable>{error}</span>
            </div>
          )}

          {MCP_HOSTS.map((host) => {
            const config = hosts[host.id];
            return (
              <HostCard
                key={host.id}
                label={host.label}
                targetKey={host.targetKey}
                entries={config?.entries ?? []}
                note={config?.note ?? null}
                onDelete={(name) => setConfirming({ host: host.id, name })}
              />
            );
          })}

          <ServiceCard
            services={services}
            hosts={hosts}
            ops={ops}
            tests={tests}
            onAdd={(hostId, id, request) => void add(hostId, id, request)}
            onTest={(id) => void test(id)}
          />

          <p className="text-muted-foreground/70 text-center text-xs">
            {t("mcp.footerNote")}
          </p>
        </div>
      </div>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("mcp.removeDialog.title", { name: confirming?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("mcp.removeDialog.description", {
                path:
                  confirming?.host === "claude-code"
                    ? "~/.claude.json"
                    : confirming?.host === "codex"
                      ? "~/.codex/config.toml"
                      : "~/.gemini/settings.json",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("mcp.removeDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirming) void remove(confirming.host, confirming.name);
                setConfirming(null);
              }}
            >
              <Trash2 />
              {t("mcp.removeDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------- 宿主配置

function HostCard({
  label,
  targetKey,
  entries,
  note,
  onDelete,
}: {
  label: string;
  targetKey: McpHostTargetKey;
  entries: HostEntry[];
  note: string | null;
  onDelete: (name: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="size-4" />
          {t("mcp.host.currentConfig", { label })}
          <Badge variant="secondary" className="font-normal">
            {entries.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-muted-foreground text-xs">
          {t("mcp.host.location")}
          <code data-selectable>{t(targetKey)}</code>
        </p>
        {note && (
          <p className="text-muted-foreground text-xs" data-selectable>
            {describeNote(note)}
          </p>
        )}
        {entries.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">
            {t("mcp.host.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((entry) => (
              <li key={entry.name} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{entry.name}</span>
                    {entry.managed ? (
                      <Badge variant="secondary" className="font-normal">
                        {t("mcp.host.managed")}
                      </Badge>
                    ) : (
                      <Badge variant="outline">{t("mcp.host.manual")}</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                    {entry.spec.command ?? "?"}
                    {entry.spec.args?.length ? ` ${entry.spec.args.join(" ")}` : ""}
                  </p>
                </div>
                {entry.managed && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    title={t("mcp.host.removeTitle", { label })}
                    onClick={() => onDelete(entry.name)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- 服务目录

function ServiceCard({
  services,
  hosts,
  ops,
  tests,
  onAdd,
  onTest,
}: {
  services: ReturnType<typeof useMcpStore.getState>["services"];
  hosts: Record<string, ReturnType<typeof useMcpStore.getState>["hosts"][string]>;
  ops: ReturnType<typeof useMcpStore.getState>["ops"];
  tests: ReturnType<typeof useMcpStore.getState>["tests"];
  onAdd: (hostId: string, id: string, request?: McpWriteRequest) => void;
  onTest: (id: string) => void;
}) {
  const { t } = useTranslation();
  // 写入目标宿主（目录级选择，一次选好连续添加）
  const [targetHost, setTargetHost] = useState(MCP_HOSTS[0].id);

  const configuredNames = new Set(
    hosts[targetHost]?.entries.map((e) => e.name) ?? [],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugZap className="size-4" />
          {t("mcp.catalog.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Label className="text-xs">{t("mcp.catalog.writeTo")}</Label>
          {/* Base UI 的 Select 在清空时回传 null；这里没有「不选」这一档，忽略即可 */}
          <Select
            value={targetHost}
            onValueChange={(host) => {
              if (host) setTargetHost(host);
            }}
          >
            <SelectTrigger className="h-8 w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MCP_HOSTS.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ul className="divide-y divide-border">
          {services.map((svc) => (
            <ServiceRow
              key={svc.id}
              svc={svc}
              configured={configuredNames.has(svc.id)}
              op={ops[`${targetHost}/${svc.id}`]}
              test={tests[svc.id]}
              onAdd={(id, request) => onAdd(targetHost, id, request)}
              onTest={onTest}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ServiceRow({
  svc,
  configured,
  op,
  test,
  onAdd,
  onTest,
}: {
  svc: McpService;
  configured: boolean;
  op: { running: boolean; error: string | null } | undefined;
  test: import("@/types").McpTestResult | null | undefined;
  onAdd: (id: string, request?: McpWriteRequest) => void;
  onTest: (id: string) => void;
}) {
  const { t } = useTranslation();
  // 需要用户填参数/环境变量的服务：先展开表单再提交
  const needsInput = svc.argSpecs.length > 0 || svc.envSpecs.length > 0;
  const [expanded, setExpanded] = useState(false);
  const [argValues, setArgValues] = useState<string[]>(() => svc.argSpecs.map(() => ""));
  const [envValues, setEnvValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(svc.envSpecs.map((s) => [s.key, ""])),
  );

  const requiredMissing = svc.envSpecs.some(
    (s) => s.required && !envValues[s.key]?.trim(),
  );

  function submit() {
    const request =
      needsInput
        ? {
            argValues: argValues.map((v) => v.trim()),
            envValues: Object.fromEntries(
              Object.entries(envValues).map(([k, v]) => [k, v.trim()]),
            ),
          }
        : undefined;
    onAdd(svc.id, request);
  }

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{svc.name}</span>
            <Badge variant="outline" className="font-normal">
              {svc.transport}
            </Badge>
            {configured && (
              <Badge variant="secondary" className="font-normal">
                {t("mcp.service.configured")}
              </Badge>
            )}
            {svc.envSpecs.some((s) => s.required) && (
              <Badge variant="outline" className="font-normal">
                {t("mcp.service.needsKey")}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">{svc.description}</p>
          <p className="text-muted-foreground/60 mt-0.5 truncate font-mono text-[10px]">
            {svc.command} {svc.args.join(" ")}
          </p>
          {test && (
            <p
              className={
                test.ok
                  ? "text-muted-foreground mt-1 text-xs"
                  : "text-destructive mt-1 text-xs"
              }
              data-selectable
            >
              {test.ok
                ? test.serverName
                  ? t("mcp.service.handshakeOkNamed", { name: test.serverName })
                  : t("mcp.service.handshakeOk")
                : test.error}
            </p>
          )}
          {op?.error && (
            <p className="text-destructive mt-1 text-xs" data-selectable>
              {op.error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {test?.ok && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <CheckCircle2 className="size-3" />
              {t("mcp.service.online")}
            </Badge>
          )}
          {test && !test.ok && (
            <Badge variant="destructive" className="gap-1 font-normal">
              <XCircle className="size-3" />
              {t("mcp.service.offline")}
            </Badge>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            title={t("mcp.service.testTitle", { hint: svc.installHint })}
            disabled={op?.running}
            onClick={() => onTest(svc.id)}
          >
            <RefreshCw />
          </Button>
          {needsInput ? (
            <Button
              size="sm"
              variant="default"
              disabled={op?.running || (expanded && requiredMissing)}
              onClick={() => (expanded ? submit() : setExpanded(true))}
              title={
                expanded && requiredMissing
                  ? t("mcp.service.requiredMissing")
                  : t("mcp.service.expandHint")
              }
            >
              {op?.running ? <Loader2 className="animate-spin" /> : <ChevronDown />}
              {op?.running
                ? t("mcp.service.writing")
                : expanded
                  ? t("mcp.service.write")
                  : t("mcp.service.configure")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant={configured ? "outline" : "default"}
              disabled={op?.running}
              onClick={() => onAdd(svc.id)}
              title={
                configured
                  ? t("mcp.service.rewriteTitle")
                  : t("mcp.service.addTitle")
              }
            >
              {op?.running ? (
                <Loader2 className="animate-spin" />
              ) : (
                <PlugZap />
              )}
              {op?.running
                ? t("mcp.service.writing")
                : configured
                  ? t("mcp.service.rewrite")
                  : t("mcp.service.add")}
            </Button>
          )}
        </div>
      </div>

      {/* 参数 / 环境变量表单 */}
      {expanded && needsInput && (
        <div className="border-border bg-muted/30 mt-3 space-y-3 rounded-md border p-3">
          {svc.argSpecs.map((spec, i) => (
            <div key={spec.label} className="grid grid-cols-[100px_1fr] items-center gap-2">
              <Label className="text-xs">{spec.label}</Label>
              <Input
                value={argValues[i] ?? ""}
                placeholder={spec.placeholder}
                onChange={(e) => {
                  const next = [...argValues];
                  next[i] = e.target.value;
                  setArgValues(next);
                }}
                className="h-7 font-mono text-xs"
              />
            </div>
          ))}
          {svc.envSpecs.map((spec) => (
            <div key={spec.key} className="grid grid-cols-[100px_1fr] items-center gap-2">
              <Label className="font-mono text-xs" title={spec.key}>
                {spec.key.replace(/_(API_)?KEY$/, "")}
              </Label>
              <Input
                type="password"
                value={envValues[spec.key] ?? ""}
                placeholder={
                  spec.placeholder +
                  (spec.required ? "" : t("mcp.service.optionalSuffix")) +
                  t("mcp.service.envKeychainHint")
                }
                onChange={(e) =>
                  setEnvValues({ ...envValues, [spec.key]: e.target.value })
                }
                className="h-7 font-mono text-xs"
              />
            </div>
          ))}
          <p className="text-muted-foreground/70 text-[10px]">
            {t("mcp.service.footerHint", { hint: svc.installHint })}
          </p>
        </div>
      )}
    </li>
  );
}
