import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
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
import { useKeysStore } from "@/store/keys";
import { useRoutesStore } from "@/store/routes";
import type { KeyRef, ProviderId } from "@/types";

export function ApiKeys() {
  const { t } = useTranslation();
  const { refs, loading, error, load, remove } = useKeysStore();
  const { providers, loadProviders } = useRoutesStore();
  const [confirming, setConfirming] = useState<KeyRef | null>(null);

  useEffect(() => {
    void load();
    void loadProviders();
  }, [load, loadProviders]);

  // 按 provider 分组
  const groups = new Map<ProviderId, KeyRef[]>();
  for (const ref of refs) {
    const list = groups.get(ref.provider) ?? [];
    list.push(ref);
    groups.set(ref.provider, list);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="border-border bg-background/85 sticky top-0 z-10 flex items-start justify-between gap-4 border-b px-8 py-5 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">API Key</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("apiKeys.description", { n: refs.length })}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          title={t("apiKeys.reload")}
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

          <AddKeyCard providers={providers.map((p) => ({ id: p.id, label: p.label }))} />

          {loading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {t("apiKeys.loading")}
            </div>
          ) : refs.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm">
              <KeyRound className="size-8 opacity-40" />
              {t("apiKeys.empty")}
            </div>
          ) : (
            [...groups.entries()].map(([provider, list]) => (
              <KeyGroupCard
                key={provider}
                provider={provider}
                refs={list}
                onDelete={setConfirming}
              />
            ))
          )}

          <p className="text-muted-foreground/70 text-center text-xs">
            {t("apiKeys.footerNote")}
          </p>
        </div>
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("apiKeys.deleteDialog.title", {
                provider: providerLabel(providers, confirming?.provider),
                label: confirming?.label ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("apiKeys.deleteDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("apiKeys.deleteDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (confirming) void remove(confirming);
                setConfirming(null);
              }}
            >
              <Trash2 />
              {t("apiKeys.deleteDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function providerLabel(
  providers: { id: string; label: string }[],
  id: ProviderId | string | undefined,
): string {
  return providers.find((p) => p.id === id)?.label ?? id ?? "";
}

// ---------------------------------------------------------------- 添加

function AddKeyCard({ providers }: { providers: { id: ProviderId; label: string }[] }) {
  const { t } = useTranslation();
  const { adding, add } = useKeysStore();
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");

  async function submit() {
    const ok = await add(provider, label.trim(), value.trim());
    if (ok) {
      setLabel("");
      setValue("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="size-4" />
          {t("apiKeys.add.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[110px_1fr] items-center gap-3">
          <Label>{t("apiKeys.add.provider")}</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as ProviderId)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-[110px_1fr] items-center gap-3">
          <Label htmlFor="key-label">{t("apiKeys.add.name")}</Label>
          <Input
            id="key-label"
            value={label}
            placeholder={t("apiKeys.add.namePlaceholder")}
            onChange={(e) => setLabel(e.target.value)}
            className="h-8"
          />
        </div>

        <div className="grid grid-cols-[110px_1fr] items-center gap-3">
          <Label htmlFor="key-value">Key</Label>
          <Input
            id="key-value"
            type="password"
            value={value}
            placeholder={t("apiKeys.add.valuePlaceholder")}
            onChange={(e) => setValue(e.target.value)}
            className="h-8 font-mono text-xs"
          />
        </div>

        {adding.error && (
          <p className="text-destructive col-start-2 text-xs" data-selectable>
            {adding.error}
          </p>
        )}

        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={adding.running || !label.trim() || !value.trim()}
            onClick={() => void submit()}
          >
            {adding.running ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            {adding.running ? t("apiKeys.add.saving") : t("apiKeys.add.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- 分组列表

function KeyGroupCard({
  provider,
  refs,
  onDelete,
}: {
  provider: ProviderId;
  refs: KeyRef[];
  onDelete: (ref: KeyRef) => void;
}) {
  const { providers } = useRoutesStore();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" />
          {providerLabel(providers, provider)}
          <Badge variant="secondary" className="font-normal">
            {refs.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {refs.map((ref) => (
            <KeyRow key={ref.label} ref={ref} onDelete={onDelete} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function KeyRow({
  ref,
  onDelete,
}: {
  ref: KeyRef;
  onDelete: (ref: KeyRef) => void;
}) {
  const { t } = useTranslation();
  const { tests, revealed, test, reveal, mask } = useKeysStore();
  const k = `${ref.provider}/${ref.label}`;
  const testState = tests[k];
  const plain = revealed[k];

  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{ref.label}</span>
          <span className="text-muted-foreground font-mono text-xs">
            {plain ? (
              <span data-selectable className="text-foreground">
                {plain}
              </span>
            ) : (
              "••••••••••••"
            )}
          </span>
        </div>
        <p className="text-muted-foreground/60 mt-0.5 text-[10px]">
          {t("apiKeys.row.addedAt", { date: ref.addedAt.slice(0, 10) })}
        </p>
        {testState?.result?.kind === "error" && (
          <p className="text-destructive mt-1 text-xs" data-selectable>
            {testState.result.message}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {testState?.result?.kind === "ok" && (
          <Badge variant="secondary" className="gap-1 font-normal">
            <CheckCircle2 className="size-3" />
            {testState.result.latencyMs}ms
          </Badge>
        )}
        {testState?.result?.kind === "invalid" && (
          <Badge variant="destructive" className="gap-1 font-normal">
            <XCircle className="size-3" />
            {t("apiKeys.row.invalid")}
          </Badge>
        )}
        {testState?.result?.kind === "error" && (
          <Badge variant="destructive" className="gap-1 font-normal">
            <XCircle className="size-3" />
            {t("apiKeys.row.failed")}
          </Badge>
        )}

        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground"
          title={t("apiKeys.row.testTitle")}
          disabled={testState?.running}
          onClick={() => void test(ref)}
        >
          {testState?.running ? (
            <Loader2 className="animate-spin" />
          ) : (
            <RefreshCw />
          )}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground"
          title={
            plain ? t("apiKeys.row.hideTitle") : t("apiKeys.row.revealTitle")
          }
          onClick={() => (plain ? mask(ref) : void reveal(ref))}
        >
          {plain ? <EyeOff /> : <Eye />}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          title={t("apiKeys.row.deleteTitle")}
          onClick={() => onDelete(ref)}
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}
