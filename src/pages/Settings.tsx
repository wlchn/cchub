import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Globe,
  Loader2,
  Palette,
  RefreshCw,
  Settings2,
  Terminal,
  XCircle,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
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
import { Switch } from "@/components/ui/switch";
import { describeError, describeNote } from "@/lib/errors";
import * as ipc from "@/lib/ipc";
import { resolveTheme } from "@/lib/theme";
import { useAppsStore } from "@/store/apps";
import { useCatalogStore } from "@/store/catalog";
import type { NetworkTestResult, Prefs, PrefsDiff } from "@/types";

export function Settings() {
  const { t } = useTranslation();
  const { environment, bootstrap } = useAppsStore();
  const { prefs, setPrefs, loadCatalog } = useCatalogStore();

  useEffect(() => {
    void loadCatalog();
    if (!environment) void bootstrap();
  }, [environment, bootstrap, loadCatalog]);

  if (!prefs) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <PageHeader
          title={t("settings.title")}
          description={t("settings.description")}
        />
        <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t("settings.loadingPrefs")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title={t("settings.title")}
        description={t("settings.description")}
      />

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <AppearanceCard prefs={prefs} setPrefs={setPrefs} />
          <BehaviorCard prefs={prefs} setPrefs={setPrefs} />
          <ProxyCard prefs={prefs} setPrefs={setPrefs} />
          <CatalogCard prefs={prefs} setPrefs={setPrefs} />
          <EnvironmentCard environment={environment} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 外观

type SetPrefsFn = (diff: PrefsDiff) => Promise<void>;

function AppearanceCard({
  prefs,
  setPrefs,
}: {
  prefs: Prefs;
  setPrefs: SetPrefsFn;
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="size-4" />
          {t("settings.appearance.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[110px_1fr] items-center gap-3">
          <Label htmlFor="theme-select">{t("settings.appearance.theme")}</Label>
          <Select
            value={prefs.theme}
            onValueChange={(theme) => void setPrefs({ theme: theme as Prefs["theme"] })}
          >
            <SelectTrigger id="theme-select" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">
                {t("settings.appearance.themeSystem", {
                  mode:
                    resolveTheme("system") === "dark"
                      ? t("settings.appearance.themeDark")
                      : t("settings.appearance.themeLight"),
                })}
              </SelectItem>
              <SelectItem value="light">
                {t("settings.appearance.themeLight")}
              </SelectItem>
              <SelectItem value="dark">
                {t("settings.appearance.themeDark")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-[110px_1fr] items-center gap-3">
          <Label htmlFor="locale-select">{t("settings.appearance.language")}</Label>
          <Select
            value={prefs.locale}
            onValueChange={(locale) => void setPrefs({ locale })}
          >
            <SelectTrigger id="locale-select" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* 语言名按自身语言书写，不跟着界面语言走 —— 中文界面下也该看得懂 "English" */}
              <SelectItem value="zh-CN">简体中文</SelectItem>
              <SelectItem value="en-US">English</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground col-start-2 text-xs">
            {t("settings.appearance.languageNote")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- 行为

function BehaviorCard({
  prefs,
  setPrefs,
}: {
  prefs: Prefs;
  setPrefs: SetPrefsFn;
}) {
  const { t } = useTranslation();
  const [autoStart, setAutoStart] = useState<boolean | null>(null);
  const [autoStartError, setAutoStartError] = useState<string | null>(null);

  useEffect(() => {
    ipc
      .getAutoStart()
      .then(setAutoStart)
      .catch(() => setAutoStart(null));
  }, []);

  async function toggleAutoStart(enabled: boolean) {
    const previous = autoStart;
    setAutoStart(enabled); // 乐观更新
    try {
      await ipc.setAutoStart(enabled);
      setAutoStartError(null);
    } catch (err) {
      setAutoStart(previous); // 失败回滚
      setAutoStartError(describeError(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Terminal className="size-4" />
          {t("settings.behavior.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <SettingRow
          label={t("settings.behavior.autoStart")}
          description={autoStartError ?? t("settings.behavior.autoStartDesc")}
          error={autoStartError !== null}
        >
          {autoStart === null ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Switch
              checked={autoStart}
              onCheckedChange={(v) => void toggleAutoStart(v)}
            />
          )}
        </SettingRow>

        <SettingRow
          label={t("settings.behavior.detectOnLaunch")}
          description={t("settings.behavior.detectOnLaunchDesc")}
        >
          <Switch
            checked={prefs.detectOnLaunch}
            onCheckedChange={(v) => void setPrefs({ detectOnLaunch: v })}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.behavior.checkUpdates")}
          description={t("settings.behavior.checkUpdatesDesc")}
        >
          <Switch
            checked={prefs.checkUpdatesOnLaunch}
            onCheckedChange={(v) => void setPrefs({ checkUpdatesOnLaunch: v })}
          />
        </SettingRow>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- 代理

function ProxyCard({
  prefs,
  setPrefs,
}: {
  prefs: Prefs;
  setPrefs: SetPrefsFn;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(prefs.proxy.url);
  const [noProxy, setNoProxy] = useState(prefs.proxy.noProxy);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<NetworkTestResult | null>(null);

  // prefs 从外部变化（如其他页面写入）时同步本地输入框
  useEffect(() => {
    setUrl(prefs.proxy.url);
    setNoProxy(prefs.proxy.noProxy);
  }, [prefs.proxy.url, prefs.proxy.noProxy]);

  async function save(next: { url?: string; noProxy?: string }) {
    await setPrefs({
      proxy: {
        url: next.url ?? url,
        noProxy: next.noProxy ?? noProxy,
      },
    });
    setResult(null); // 配置变了，旧测试结果作废
  }

  async function runTest() {
    setTesting(true);
    try {
      // 先落盘再测：测的是「保存后的配置」，符合用户预期
      await save({});
      setResult(await ipc.testNetwork());
    } catch (err) {
      setResult({ ok: false, latencyMs: null, error: describeError(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="size-4" />
          {t("settings.network.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[110px_1fr] items-center gap-3">
          <Label htmlFor="proxy-url">{t("settings.network.proxyUrl")}</Label>
          <Input
            id="proxy-url"
            value={url}
            placeholder={t("settings.network.proxyUrlPlaceholder")}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => url !== prefs.proxy.url && void save({ url })}
            className="h-8 font-mono text-xs"
          />
        </div>

        <div className="grid grid-cols-[110px_1fr] items-center gap-3">
          <Label htmlFor="proxy-noproxy">{t("settings.network.noProxy")}</Label>
          <Input
            id="proxy-noproxy"
            value={noProxy}
            placeholder="localhost;127.0.0.1;*.internal"
            onChange={(e) => setNoProxy(e.target.value)}
            onBlur={() => noProxy !== prefs.proxy.noProxy && void save({ noProxy })}
            className="h-8 font-mono text-xs"
          />
        </div>

        <div className="grid grid-cols-[110px_1fr] items-center gap-3">
          <Label>{t("settings.network.useSystem")}</Label>
          <div className="flex items-center gap-3">
            <Switch
              id="proxy-use-system"
              checked={prefs.proxy.useSystem}
              onCheckedChange={(v) => void setPrefs({ proxy: { useSystem: v } })}
            />
            <span className="text-muted-foreground text-xs">
              {t("settings.network.useSystemHint")}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={testing}
            onClick={() => void runTest()}
          >
            {testing ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            {t("settings.network.test")}
          </Button>
          <span className="text-muted-foreground text-xs">
            {t("settings.network.testHint")}
          </span>
          {result && <NetworkResultBadge result={result} />}
        </div>
      </CardContent>
    </Card>
  );
}

function NetworkResultBadge({ result }: { result: NetworkTestResult }) {
  const { t } = useTranslation();

  if (result.ok) {
    return (
      <Badge variant="secondary" className="gap-1 font-normal">
        <CheckCircle2 className="size-3" />
        {t("settings.network.reachable", { ms: result.latencyMs ?? 0 })}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1 font-normal">
      <XCircle className="size-3" />
      {t("settings.network.unreachable")}
    </Badge>
  );
}

// ---------------------------------------------------------------- 目录源

function CatalogCard({
  prefs,
  setPrefs,
}: {
  prefs: Prefs;
  setPrefs: SetPrefsFn;
}) {
  const { t } = useTranslation();
  const { source, note } = useCatalogStore();
  const [url, setUrl] = useState(prefs.catalogUrl);

  useEffect(() => {
    setUrl(prefs.catalogUrl);
  }, [prefs.catalogUrl]);

  async function saveUrl() {
    if (url === prefs.catalogUrl) return;
    await setPrefs({ catalogUrl: url });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {t("settings.catalog.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[110px_1fr] items-center gap-3">
          <Label htmlFor="catalog-url">{t("settings.catalog.remoteUrl")}</Label>
          <Input
            id="catalog-url"
            value={url}
            placeholder={t("settings.catalog.remoteUrlPlaceholder")}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => void saveUrl()}
            className="h-8 font-mono text-xs"
          />
        </div>

        <div className="grid grid-cols-[110px_1fr] items-center gap-3">
          <Label htmlFor="catalog-ttl">{t("settings.catalog.ttl")}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="catalog-ttl"
              type="number"
              min={1}
              max={720}
              value={prefs.catalogTtlHours}
              onChange={(e) => {
                const hours = Number.parseInt(e.target.value, 10);
                if (Number.isNaN(hours)) return;
                void setPrefs({ catalogTtlHours: hours });
              }}
              onBlur={(e) => {
                // 失焦时若输入非法，回滚到已保存值
                const hours = Number.parseInt(e.target.value, 10);
                if (Number.isNaN(hours)) e.target.value = String(prefs.catalogTtlHours);
              }}
              className="h-8 w-20 font-mono text-xs"
            />
            <span className="text-muted-foreground text-xs">
              {t("settings.catalog.ttlHint")}
            </span>
          </div>
        </div>

        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span>
            {t("settings.catalog.currentSource")}
            {source === "remote"
              ? t("settings.catalog.sourceRemote")
              : source === "cache"
                ? t("settings.catalog.sourceCache")
                : t("settings.catalog.sourceBuiltin")}
          </span>
          {note && (
            <span className="text-muted-foreground/70">
              · {describeNote(note)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- 环境诊断

function EnvironmentCard({
  environment,
}: {
  environment: ReturnType<typeof useAppsStore.getState>["environment"];
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="size-4" />
          {t("settings.environment.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row label={t("settings.environment.mode")}>
          <Badge variant={ipc.isTauri() ? "secondary" : "outline"} className="font-normal">
            {ipc.isTauri()
              ? t("settings.environment.tauri")
              : t("settings.environment.browser")}
          </Badge>
        </Row>
        <Row label={t("settings.environment.os")}>
          {environment
            ? `${environment.os} / ${environment.arch}`
            : t("settings.environment.detecting")}
        </Row>
        <Row label={t("settings.environment.node")}>
          {environment?.nodeVersion ? (
            <span className="font-mono">v{environment.nodeVersion}</span>
          ) : (
            <span className="text-destructive">
              {t("settings.environment.notDetected")}
            </span>
          )}
        </Row>
        <Row label={t("settings.environment.npm")}>
          {environment?.npmVersion ? (
            <span className="font-mono">v{environment.npmVersion}</span>
          ) : (
            <span className="text-destructive">
              {t("settings.environment.notDetected")}
            </span>
          )}
        </Row>
        <Row label={t("settings.environment.resolvedPath")}>
          <code
            className="bg-muted/60 text-muted-foreground block max-h-24 overflow-y-auto rounded-md p-2 font-mono text-[11px] break-all"
            data-selectable
          >
            {environment?.resolvedPath ?? t("settings.environment.detecting")}
          </code>
        </Row>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- 通用小组件

function SettingRow({
  label,
  description,
  error = false,
  children,
}: {
  label: string;
  description?: string;
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-3">
      <Label>{label}</Label>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span
          className={
            error
              ? "text-destructive text-xs"
              : "text-muted-foreground text-xs"
          }
        >
          {description}
        </span>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-3">
      <span className="text-muted-foreground pt-0.5">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
