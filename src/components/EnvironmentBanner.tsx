import { useTranslation } from "react-i18next";
import { Cpu, ExternalLink, MonitorSmartphone, Package, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MIN_NODE_MAJOR, nodeMajor } from "@/lib/catalog";
import { openExternal } from "@/lib/ipc";
import type { EnvironmentInfo } from "@/types";

interface EnvironmentBannerProps {
  environment: EnvironmentInfo | null;
}

export function EnvironmentBanner({ environment }: EnvironmentBannerProps) {
  const { t, i18n } = useTranslation();

  if (!environment) return null;

  // 三个平台名是专有名词，按各自写法显示；只有开发模式需要翻译
  const OS_LABELS: Record<string, string> = {
    macos: "macOS",
    windows: "Windows",
    linux: "Linux",
    browser: t("environmentBanner.osBrowser"),
  };

  if (!environment.npmVersion) {
    return (
      <Warning
        title={t("environmentBanner.npmMissingTitle")}
        detail={t("environmentBanner.npmMissingDetail", { major: MIN_NODE_MAJOR })}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void openExternal(
                // 下载页分语言，英文界面不该跳到中文版
                i18n.language === "zh-CN"
                  ? "https://nodejs.org/zh-cn/download"
                  : "https://nodejs.org/en/download",
              )
            }
          >
            <ExternalLink />
            {t("environmentBanner.installNode")}
          </Button>
        }
      />
    );
  }

  // CCHub 用的是登录 shell 里的默认 node，未必等于你在终端里临时 nvm use
  // 的那个版本。版本太老时装包会以 EBADENGINE 失败，提前说清楚怎么改。
  const major = nodeMajor(environment.nodeVersion);
  if (major !== null && major < MIN_NODE_MAJOR) {
    return (
      <Warning
        title={t("environmentBanner.nodeOldTitle", {
          version: environment.nodeVersion,
        })}
        detail={t("environmentBanner.nodeOldDetail", { major: MIN_NODE_MAJOR })}
      />
    );
  }

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-xs">
      <span className="flex items-center gap-1.5">
        <MonitorSmartphone className="size-3.5" />
        {OS_LABELS[environment.os] ?? environment.os}
      </span>
      <span className="flex items-center gap-1.5">
        <Cpu className="size-3.5" />
        {environment.arch}
      </span>
      {environment.nodeVersion && (
        <span className="flex items-center gap-1.5 font-mono">
          <Package className="size-3.5" />
          node v{environment.nodeVersion}
        </span>
      )}
      {environment.npmVersion && (
        <span className="font-mono">npm v{environment.npmVersion}</span>
      )}
    </div>
  );
}

function Warning({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  // 全角逗号只适合中文；英文用冒号，否则标题和正文会黏在一起
  const { i18n } = useTranslation();
  const joiner = i18n.language === "zh-CN" ? "，" : ": ";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
      <TriangleAlert className="size-4 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">
          {joiner}
          {detail}
        </span>
      </div>
      {action}
    </div>
  );
}
