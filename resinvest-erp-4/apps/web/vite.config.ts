/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: /api → API NestJS (127.0.0.1:3000). Produkcja: Nginx serwuje build i przekazuje /api do API.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } } },
  preview: { port: 4173, strictPort: true, proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } } },
  build: { target: "es2022", sourcemap: true, outDir: "dist" },
  test: { environment: "jsdom", include: ["src/**/*.spec.tsx", "src/**/*.spec.ts"] },
});
