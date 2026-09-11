import { Navigate, Route, Routes } from "react-router-dom";

import { Sidebar } from "@/components/layout/Sidebar";
import { ApiKeys } from "@/pages/ApiKeys";
import { AppStore } from "@/pages/AppStore";
import { Mcp } from "@/pages/Mcp";
import { Routes as RoutesPage } from "@/pages/Routes";
import { Settings } from "@/pages/Settings";
import { Skills } from "@/pages/Skills";
import { useLocale } from "@/i18n/useLocale";

export default function App() {
  // 语言是全局的，挂一次就够；具体页面不必各自关心
  useLocale();

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Routes>
          <Route path="/" element={<AppStore />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/mcp" element={<Mcp />} />
          <Route path="/keys" element={<ApiKeys />} />
          <Route path="/routes" element={<RoutesPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
