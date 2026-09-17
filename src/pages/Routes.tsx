import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Trash2,
  TriangleAlert,
  Waypoints,
  XCircle,
  Zap,
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
import { useKeysStore } from "@/store/keys";
import { useRoutesStore } from "@/store/routes";
import type { HostStateView, KeyRef, ProviderId, RouteRule } from "@/types";
import { probeRoute, type RouteProbeResult } from "@/lib/ipc";

/** 下发目标在词典里的键；模块级不能定型文案，只能存键。 */
type HostTargetKey =
  | "routes.host.targets.claudeCode"
  | "routes.host.targets.codex"
  | "routes.host.targets.geminiCli";

/** 宿主清单（与 Rust routes.rs 的 HOSTS 对齐）。 */
const HOSTS: { id: string; label: string; targetKey: HostTargetKey }[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    targetKey: "routes.host.targets.claudeCode",
  },
  {
    id: "codex",
    label: "Codex CLI",
    targetKey: "routes.host.targets.codex",
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    targetKey: "routes.host.targets.geminiCli",
  },
];

export function Routes() {
  const { t } = useTranslation();
  const {
    rules,
    active,
    hosts,
    providers,
    loading,
    error,
    lastApplied,
    load,
    loadProviders,
  } = useRoutesStore();
  const { refs, load: loadKeys } = useKeysStore();

  useEffect(() => {
    void load();
    void loadProviders();
    void loadKeys();
  }, [load, loadProviders, loadKeys]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="border-border bg-background/85 sticky top-0 z-10 flex items-start justify-between gap-4 border-b px-8 py-5 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {t("routes.title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("routes.description", { n: rules.length })}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          title={t("routes.reload")}
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

          {loading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {t("routes.loading")}
            </div>
          ) : (
            HOSTS.map((host) => (
              <HostCard
                key={host.id}
                host={host}
                rules={rules.filter((r) => r.app === host.id)}
                activeId={active[host.id]}
                hostState={hosts[host.id]}
                providers={providers}
                keys={refs}
                lastApplied={lastApplied}
              />
            ))
          )}

          <p className="text-muted-foreground/70 text-center text-xs">
            {t("routes.footerNote")}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 宿主卡片

interface HostSpec {
  id: string;
  label: string;
  targetKey: HostTargetKey;
}

function HostCard({
  host,
  rules,
  activeId,
  hostState,
  providers,
  keys,
  lastApplied,
}: {
  host: HostSpec;
  rules: RouteRule[];
  activeId: string | undefined;
  hostState: HostStateView | undefined;
  providers: ReturnType<typeof useRoutesStore.getState>["providers"];
  keys: KeyRef[];
  lastApplied: string | null;
}) {
  const { t } = useTranslation();
  const { saving, switchTo, clear, apply } = useRoutesStore();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RouteRule | null>(null);
  const [confirming, setConfirming] = useState<RouteRule | null>(null);
  // 测速状态（每预设一份，本地 state 足够——不跨页共享）
  const [probes, setProbes] = useState<
    Record<string, { running: boolean; result: RouteProbeResult | null }>
  >({});

  async function probe(id: string) {
    setProbes((p) => ({ ...p, [id]: { running: true, result: null } }));
    const result = await probeRoute(id);
    setProbes((p) => ({ ...p, [id]: { running: false, result } }));
  }

  const probeState = (id: string) => probes[id];

  const activeRule = rules.find((r) => r.id === activeId) ?? null;
  const drifted = hostState?.drift === true;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Waypoints className="size-4" />
          {host.label}
          {activeRule ? (
            <Badge className="gap-1 font-normal">
              <CheckCircle2 className="size-3" />
              {activeRule.name}
            </Badge>
          ) : (
            <Badge variant="secondary" className="font-normal">
              {t("routes.host.inactive")}
            </Badge>
          )}
          {drifted && (
            <Badge variant="destructive" className="gap-1 font-normal">
              <AlertTriangle className="size-3" />
              {t("routes.host.drift")}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-xs">
          {t("routes.host.targetLabel")}
          <code data-selectable>{t(host.targetKey)}</code>
        </p>

        {drifted && (
          <div className="border-destructive/40 bg-destructive/5 flex items-start justify-between gap-2.5 rounded-lg border px-3 py-2.5 text-xs">
            <span className="text-muted-foreground" data-selectable>
              {t("routes.host.driftDetail", {
                baseUrl: hostState?.baseUrl ?? t("routes.host.notApplied"),
              })}
              {hostState?.keyFingerprint
                ? t("routes.host.keyFingerprint", {
                    fingerprint: hostState.keyFingerprint,
                  })
                : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 shrink-0 px-2 text-xs"
              disabled={saving}
              title={t("routes.host.reapplyTitle")}
              onClick={() => void apply()}
            >
              {t("routes.host.reapply")}
            </Button>
          </div>
        )}

        {rules.length === 0 && !adding && !editing ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-6 text-sm">
            <Route className="size-6 opacity-40" />
            {t("routes.host.empty")}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{rule.name}</span>
                    <Badge variant="outline" className="font-normal">
                      {rule.provider}
                    </Badge>
                    {rule.id === activeId && (
                      <Badge className="gap-1 font-normal">
                        <Zap className="size-3" />
                        {t("routes.host.activeBadge")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-0.5 truncate font-mono text-[11px]">
                    {rule.baseUrl}
                    {rule.model ? ` · ${rule.model}` : ""}
                    {rule.wireApi === "responses" ? " · responses" : ""}
                  </p>
                  {(rule.modelOpus || rule.modelSonnet || rule.modelHaiku) && (
                    <p className="text-muted-foreground/70 mt-0.5 text-[10px]">
                      {t("routes.host.modelMapping")}
                      {[
                        rule.modelOpus && `Opus→${rule.modelOpus}`,
                        rule.modelSonnet && `Sonnet→${rule.modelSonnet}`,
                        rule.modelHaiku && `Haiku→${rule.modelHaiku}`,
                      ]
                        .filter(Boolean)
                        .join(" / ")}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {(() => {
                    const ps = probeState(rule.id);
                    return (
                      <>
                        {ps?.result?.kind === "ok" && (
                          <Badge variant="secondary" className="gap-1 font-normal">
                            <CheckCircle2 className="size-3" />
                            {ps.result.latencyMs}ms
                          </Badge>
                        )}
                        {ps?.result?.kind === "invalid" && (
                          <Badge variant="destructive" className="gap-1 font-normal">
                            <XCircle className="size-3" />
                            {t("routes.probe.invalidKey")}
                          </Badge>
                        )}
                        {ps?.result?.kind === "error" && (
                          <Badge variant="destructive" className="gap-1 font-normal">
                            <XCircle className="size-3" />
                            {t("routes.probe.unreachable")}
                          </Badge>
                        )}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-muted-foreground"
                          title={t("routes.probe.title")}
                          disabled={ps?.running}
                          onClick={() => void probe(rule.id)}
                        >
                          {ps?.running ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Gauge />
                          )}
                        </Button>
                      </>
                    );
                  })()}
                  <Button
                    size="sm"
                    variant={rule.id === activeId ? "secondary" : "outline"}
                    disabled={saving || rule.id === activeId}
                    title={t("routes.host.switchTitle")}
                    onClick={() => void switchTo(rule.id)}
                  >
                    {saving ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Zap />
                    )}
                    {t("routes.host.switch")}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    title={t("routes.host.editTitle")}
                    disabled={saving}
                    onClick={() => {
                      setEditing(rule);
                      setAdding(false);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    title={t("routes.host.deleteTitle")}
                    disabled={saving}
                    onClick={() => setConfirming(rule)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between">
          <div className="min-w-0">
            {activeRule && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                disabled={saving}
                title={t("routes.host.clearTitle")}
                onClick={() => void clear(host.id)}
              >
                <Trash2 />
                {t("routes.host.clear")}
              </Button>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAdding(!adding);
              setEditing(null);
            }}
          >
            <Plus />
            {t("routes.host.addRule")}
          </Button>
        </div>

        {adding && (
          <RuleForm
            host={host}
            providers={providers}
            keys={keys}
            onCancel={() => setAdding(false)}
          />
        )}
        {editing && (
          <RuleForm
            host={host}
            providers={providers}
            keys={keys}
            initial={editing}
            onCancel={() => setEditing(null)}
          />
        )}

        {lastApplied && host.id === activeId && (
          <p className="flex items-center gap-1.5 text-xs" data-selectable>
            <CheckCircle2 className="size-3.5 shrink-0" />
            {lastApplied}
          </p>
        )}

        <AlertDialog
          open={confirming !== null}
          onOpenChange={(o) => !o && setConfirming(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("routes.deleteDialog.title", { name: confirming?.name ?? "" })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("routes.deleteDialog.description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("routes.deleteDialog.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  if (confirming) void useRoutesStore.getState().remove(confirming.id);
                  setConfirming(null);
                }}
              >
                <Trash2 />
                {t("routes.deleteDialog.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- 预设表单

function RuleForm({
  host,
  providers,
  keys,
  initial,
  onCancel,
}: {
  host: HostSpec;
  providers: ReturnType<typeof useRoutesStore.getState>["providers"];
  keys: KeyRef[];
  initial?: RouteRule;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { save } = useRoutesStore();
  const isCodex = host.id === "codex";
  const isGemini = host.id === "gemini-cli";

  // 可选供应商按宿主协议过滤：Codex 全目录；Claude Code 只列 Anthropic 兼容；
  // Gemini CLI 只列 Gemini API 兼容
  const available = providers.filter((p) =>
    isCodex
      ? true
      : isGemini
        ? p.geminiEndpoint !== null
        : p.anthropicEndpoint !== null,
  );

  const [name, setName] = useState(initial?.name ?? "");
  const [provider, setProvider] = useState<ProviderId>(
    initial?.provider ?? (available[0]?.id as ProviderId) ?? "anthropic",
  );
  const providerInfo = providers.find((p) => p.id === provider);
  const defaultEndpoint = isGemini
    ? providerInfo?.geminiEndpoint
    : providerInfo?.anthropicEndpoint;
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? defaultEndpoint ?? "");
  const [keyLabel, setKeyLabel] = useState(initial?.keyRef.split("/")[1] ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  // Codex 请求协议：null 与 "chat" 等价（Codex 默认），表单里统一展示成 "chat"
  const [wireApi, setWireApi] = useState<"chat" | "responses">(
    initial?.wireApi === "responses" ? "responses" : "chat",
  );
  const [modelOpus, setModelOpus] = useState(initial?.modelOpus ?? "");
  const [modelSonnet, setModelSonnet] = useState(initial?.modelSonnet ?? "");
  const [modelHaiku, setModelHaiku] = useState(initial?.modelHaiku ?? "");

  // 切换供应商时带出默认 base URL 与推荐模型
  function onProviderChange(next: ProviderId) {
    setProvider(next);
    const info = providers.find((p) => p.id === next);
    const endpoint = isGemini ? info?.geminiEndpoint : info?.anthropicEndpoint;
    if (endpoint) setBaseUrl(endpoint);
    if (isCodex) {
      if (info?.defaultModels[0]) setModel(info.defaultModels[0]);
    } else if (!isGemini) {
      const [opus, sonnet, haiku] = info?.defaultModels ?? [];
      setModelOpus(opus ?? "");
      setModelSonnet(sonnet ?? "");
      setModelHaiku(haiku ?? "");
    }
  }

  const compatibleKeys = keys.filter((k) => k.provider === provider);
  const canSubmit =
    name.trim().length > 0 &&
    baseUrl.trim().startsWith("https://") &&
    keyLabel.length > 0 &&
    (!isCodex || model.trim().length > 0);

  async function submit() {
    const selected = compatibleKeys.find((k) => k.label === keyLabel);
    if (!selected) return;
    const ok = await save({
      id: initial?.id ?? "",
      app: host.id,
      name: name.trim(),
      provider,
      baseUrl: baseUrl.trim(),
      keyRef: `@keychain:${selected.provider}/${selected.label}`,
      model: isCodex ? model.trim() : null,
      wireApi: isCodex && wireApi === "responses" ? "responses" : null,
      modelOpus: !isCodex && !isGemini && modelOpus.trim() ? modelOpus.trim() : null,
      modelSonnet: !isCodex && !isGemini && modelSonnet.trim() ? modelSonnet.trim() : null,
      modelHaiku: !isCodex && !isGemini && modelHaiku.trim() ? modelHaiku.trim() : null,
      addedAt: initial?.addedAt ?? "",
    });
    if (ok) onCancel();
  }

  return (
    <div className="border-border space-y-4 rounded-lg border p-4">
      <div className="grid grid-cols-[110px_1fr] items-center gap-3">
        <Label htmlFor="rule-name">{t("routes.form.name")}</Label>
        <Input
          id="rule-name"
          value={name}
          placeholder={t("routes.form.namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
          className="h-8"
        />
      </div>

      <div className="grid grid-cols-[110px_1fr] items-center gap-3">
        <Label>{t("routes.form.provider")}</Label>
        <Select value={provider} onValueChange={(v) => onProviderChange(v as ProviderId)}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {available.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-[110px_1fr] items-center gap-3">
        <Label htmlFor="rule-url">Base URL</Label>
        <Input
          id="rule-url"
          value={baseUrl}
          placeholder={t("routes.form.baseUrlPlaceholder")}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="h-8 font-mono text-xs"
        />
      </div>

      <div className="grid grid-cols-[110px_1fr] items-center gap-3">
        <Label>{t("routes.form.key")}</Label>
        {compatibleKeys.length === 0 ? (
          <span className="text-muted-foreground text-xs">
            {t("routes.form.noKey", {
              provider: providerInfo?.label ?? provider,
            })}
          </span>
        ) : (
          <Select
            value={keyLabel}
            onValueChange={(label) => {
              if (label) setKeyLabel(label);
            }}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder={t("routes.form.selectKey")} />
            </SelectTrigger>
            <SelectContent>
              {compatibleKeys.map((k) => (
                <SelectItem key={`${k.provider}/${k.label}`} value={k.label}>
                  {k.provider} · {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isCodex && (
        <>
          <div className="grid grid-cols-[110px_1fr] items-center gap-3">
            <Label htmlFor="rule-wire-api">{t("routes.form.wireApi")}</Label>
            <Select
              value={wireApi}
              onValueChange={(v) => v === "chat" || v === "responses" ? setWireApi(v) : undefined}
            >
              <SelectTrigger id="rule-wire-api" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat">{t("routes.form.wireApiChat")}</SelectItem>
                <SelectItem value="responses">{t("routes.form.wireApiResponses")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-3">
            <Label htmlFor="rule-model">
              {t("routes.form.model")}
              <span className="text-destructive ml-0.5">*</span>
            </Label>
            <Input
              id="rule-model"
              value={model}
              placeholder={
                providerInfo?.defaultModels[0] ?? t("routes.form.modelPlaceholder")
              }
              onChange={(e) => setModel(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
        </>
      )}

      {!isCodex && !isGemini && (
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs">
            {t("routes.form.mappingNote")}
          </p>
          <div className="grid grid-cols-[110px_1fr] items-center gap-3">
            <Label htmlFor="m-opus" className="text-xs">
              {t("routes.form.opusTier")}
            </Label>
            <Input
              id="m-opus"
              value={modelOpus}
              placeholder={
                providerInfo?.defaultModels[0] ?? t("routes.form.modelExample")
              }
              onChange={(e) => setModelOpus(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-3">
            <Label htmlFor="m-sonnet" className="text-xs">
              {t("routes.form.sonnetTier")}
            </Label>
            <Input
              id="m-sonnet"
              value={modelSonnet}
              placeholder={providerInfo?.defaultModels[1] ?? providerInfo?.defaultModels[0] ?? ""}
              onChange={(e) => setModelSonnet(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-3">
            <Label htmlFor="m-haiku" className="text-xs">
              {t("routes.form.haikuTier")}
            </Label>
            <Input
              id="m-haiku"
              value={modelHaiku}
              placeholder={providerInfo?.defaultModels[2] ?? providerInfo?.defaultModels[0] ?? ""}
              onChange={(e) => setModelHaiku(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("routes.form.cancel")}
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={() => void submit()}>
          {initial ? t("routes.form.save") : t("routes.form.add")}
        </Button>
      </div>
    </div>
  );
}
