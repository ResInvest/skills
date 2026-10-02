/**
 * Wersja demonstracyjna ResInvest ERP 4 (jeden plik HTML do podglądu bez serwera):
 *   1. start zbudowanego API (apps/api/dist) na bazie z danymi (domyślnie baza testów E2E *_e2e — bez zmian w danych),
 *   2. nagranie odpowiedzi API (demo/record.mjs, tylko odczyty) → demo/snapshot.json,
 *   3. build demo (vite.demo.config.ts) → dist-demo/index.html.
 * Użycie (z katalogu apps/web): DEMO_EMAIL=… DEMO_PASSWORD=… node demo/build.mjs
 * Wymaga: pnpm build (API) i bazy z danymi (np. po testach E2E).
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(web, "../..");
config({ path: resolve(root, ".env"), quiet: true });
if (!existsSync(resolve(root, "apps/api/dist/main.js"))) throw new Error("Brak zbudowanego API — uruchom: pnpm build");
const db = new URL(process.env.DEMO_DATABASE_URL ?? process.env.DATABASE_URL ?? "");
if (!process.env.DEMO_DATABASE_URL) db.pathname = `${db.pathname}_e2e`;
const PORT = process.env.DEMO_API_PORT ?? "3101";
const env = { ...process.env, NODE_ENV: "test", DATABASE_URL: db.toString(), API_HOST: "127.0.0.1", API_PORT: PORT, APP_URL: "http://127.0.0.1:4180",
  CORS_ORIGINS: "", ALLOWED_NETWORKS: "", TRUSTED_PROXIES: "127.0.0.1", COMPANY_DOMAINS: "resinvest.group", EMAIL_TRANSPORT: "file", MAIL_WORKER: "off",
  MAIL_FILE_DIR: resolve(web, "demo/.mail"), LOGIN_RATE_PER_IP: "200", LOGIN_RATE_PER_EMAIL: "50" };
const api = spawn(process.execPath, ["apps/api/dist/main.js"], { cwd: root, env, stdio: ["ignore", "ignore", "inherit"] });
try {
  const until = Date.now() + 60_000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/v1/health`)).ok) break; } catch { /* jeszcze startuje */ }
    if (Date.now() > until) throw new Error("API nie wystartowało w 60 s");
    await new Promise(r => setTimeout(r, 500));
  }
  execFileSync(process.execPath, ["demo/record.mjs", "demo/snapshot.json"], { cwd: web, env: { ...process.env, DEMO_API: `http://127.0.0.1:${PORT}` }, stdio: "inherit" });
} finally { api.kill("SIGTERM"); }
execFileSync(resolve(web, "node_modules/.bin/vite"), ["build", "--config", "vite.demo.config.ts"], { cwd: web, stdio: "inherit" });
console.warn(`Gotowe: ${resolve(web, "dist-demo/index.html")}`);
