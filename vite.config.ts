import path from "node:path";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // Desktop-App, Bundle wird lokal geladen – großer Einzel-Chunk ist unkritisch
  build: { chunkSizeWarningLimit: 1536 },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    proxy: {
      "^/api/announcements\\.atom\\?page=[1-9][0-9]*$": {
        target: "https://github.com",
        changeOrigin: true,
        proxyTimeout: 20_000,
        timeout: 20_000,
        rewrite: (url) => url.replace("/api/announcements.atom", "/jonax1337/pumpkin-launcher/discussions/categories/announcements.atom"),
        configure: (proxy) => {
          proxy.on("proxyReq", (request) => {
            request.removeHeader("authorization");
            request.removeHeader("cookie");
          });
        },
      },
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and the agent worktrees (their build temp files crash the watcher with EBUSY)
      ignored: ["**/src-tauri/**", "**/.claude/worktrees/**"],
    },
  },
}));
