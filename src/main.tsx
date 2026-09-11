import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";

import App from "@/App";
import { initLocale } from "@/i18n/locale";
import { initTheme } from "@/lib/theme";
import "@/globals.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("未找到 #root 挂载点");
}

// 这两件都必须在首次渲染前定型，否则会闪一下错误的配色 / 语言。
// 用的都是 localStorage 缓存（prefs.json 的镜像），不必等异步 IPC。
initTheme();
initLocale();

// Tauri 的前端由 tauri:// 协议提供，没有 history 服务端，用 hash 路由最稳
createRoot(container).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
