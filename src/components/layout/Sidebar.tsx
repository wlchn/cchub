import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import {
  KeyRound,
  LayoutGrid,
  Plug,
  Settings,
  Sparkles,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  /** 词典键而非文案：语言切换时要跟着变，所以不能在模块级定型。 */
  labelKey: "nav.appStore" | "nav.skills" | "nav.mcp" | "nav.keys" | "nav.routes" | "nav.settings";
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "nav.appStore", icon: LayoutGrid },
  { to: "/skills", labelKey: "nav.skills", icon: Sparkles },
  { to: "/mcp", labelKey: "nav.mcp", icon: Plug },
  { to: "/keys", labelKey: "nav.keys", icon: KeyRound },
  { to: "/routes", labelKey: "nav.routes", icon: Waypoints },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];

export function Sidebar() {
  const { t } = useTranslation();

  return (
    <aside className="bg-sidebar border-sidebar-border flex w-[228px] shrink-0 flex-col border-r">
      <div
        className="flex h-14 items-center gap-2.5 px-5"
        data-tauri-drag-region
      >
        <div className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-lg text-[13px] font-bold">
          CC
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">{t("app.name")}</div>
          <div className="text-muted-foreground text-[11px]">{t("app.tagline")}</div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2.5 py-2">
        {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex-1 truncate">{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      <div className="text-muted-foreground px-5 py-4 text-[11px]">
        <div>{t("app.version")}</div>
      </div>
    </aside>
  );
}
