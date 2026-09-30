/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: /api → API NestJS (domyślnie 127.0.0.1:3000; API_PROXY — np. testy E2E na osobnym porcie).
// Produkcja: Nginx serwuje build i przekazuje /api do API.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const target = env.API_PROXY ?? "http://127.0.0.1:3000";
const port = Number(env.WEB_PORT ?? 0);

export default defineConfig({
  plugins: [react()],
  server: { port: port || 5173, strictPort: true, proxy: { "/api": { target, changeOrigin: false } } },
  preview: { port: port || 4173, strictPort: true, proxy: { "/api": { target, changeOrigin: false } } },
  build: { target: "es2022", sourcemap: true, outDir: "dist" },
  test: { environment: "jsdom", include: ["src/**/*.spec.tsx", "src/**/*.spec.ts"] },
});
