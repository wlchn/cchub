import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Sidebar } from "@/components/layout/Sidebar";
import { useLocale } from "@/i18n/useLocale";

// 页面按需加载：六个页面各自成 chunk，避免全部挤进入口包。
// 页面都是命名导出，写不出 default，所以逐个映射一次。
const AppStore = lazy(() => import("@/pages/AppStore").then((m) => ({ default: m.AppStore })));
const Skills = lazy(() => import("@/pages/Skills").then((m) => ({ default: m.Skills })));
const Mcp = lazy(() => import("@/pages/Mcp").then((m) => ({ default: m.Mcp })));
const ApiKeys = lazy(() => import("@/pages/ApiKeys").then((m) => ({ default: m.ApiKeys })));
const RoutesPage = lazy(() => import("@/pages/Routes").then((m) => ({ default: m.Routes })));
const Settings = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.Settings })));

export default function App() {
  // 语言是全局的，挂一次就够；具体页面不必各自关心
  useLocale();

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {/* chunk 从本地 tauri:// 读，正常情况下一帧内就绪，这是兜底 */}
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<AppStore />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/mcp" element={<Mcp />} />
            <Route path="/keys" element={<ApiKeys />} />
            <Route path="/routes" element={<RoutesPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
