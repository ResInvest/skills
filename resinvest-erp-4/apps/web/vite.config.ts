/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * PWA bez zależności zewnętrznych: przy budowaniu powstaje dist/sw.js z szablonu sw.template.js — z wersją
 * (identyfikator buildu) i listą plików powłoki aplikacji (index.html, JS, CSS, ikony, manifest). Odpowiedzi API
 * nie trafiają do pamięci urządzenia (reguła w szablonie).
 */
function pwa(): Plugin {
  return {
    name: "resinvest-pwa", apply: "build",
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter(f => /\.(js|css)$/.test(f) && !f.endsWith(".map")).map(f => `/${f}`);
      const precache = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png", "/icons/favicon-32.png", "/theme-boot.js", ...files];
      const build = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
      const source = readFileSync(new URL("./sw.template.js", import.meta.url), "utf8").replace("__BUILD__", build).replace("__PRECACHE__", JSON.stringify(precache));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// Dev: /api → API NestJS (domyślnie 127.0.0.1:3000; API_PROXY — np. testy E2E na osobnym porcie).
// Produkcja: Nginx serwuje build i przekazuje /api do API.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const target = env.API_PROXY ?? "http://127.0.0.1:3000";
const port = Number(env.WEB_PORT ?? 0);

export default defineConfig({
  plugins: [react(), pwa()],
  server: { port: port || 5173, strictPort: true, proxy: { "/api": { target, changeOrigin: false } } },
  preview: { port: port || 4173, strictPort: true, proxy: { "/api": { target, changeOrigin: false } } },
  build: { target: "es2022", sourcemap: true, outDir: "dist" },
  test: { environment: "jsdom", include: ["src/**/*.spec.tsx", "src/**/*.spec.ts"] },
});
