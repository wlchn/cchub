import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const rootDir = import.meta.dirname;

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },

  // Tauri 期望一个固定端口，且端口被占用时应直接失败而不是自动切换
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Rust 侧代码由 cargo 自己监听，避免 vite 重复触发
      ignored: ["**/src-tauri/**"],
    },
  },

  // 让 Rust 的 target triple 决定构建产物特性
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Windows 走 WebView2（Chromium 基线 105），macOS/Linux 走 WKWebView/WebKitGTK。
    // esbuild 的兼容表把 Safari 对解构的完整支持标记在 16.4，低于此值它会拒绝
    // 编译（而非降级），所以这里以 safari16.4 为基线，并与 bundle 里的
    // minimumSystemVersion 12.0 保持一致。
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari16.4",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
