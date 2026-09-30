/**
 * Serwer API dla testów E2E (uruchamiany przez Playwright jako webServer):
 *   1. baza <DATABASE_URL>_e2e tworzona od zera (usuwana WYŁĄCZNIE baza z sufiksem _e2e),
 *   2. migracje (prisma migrate deploy) + dane słownikowe (seed),
 *   3. pierwszy administrator przez CLI (bootstrap-admin) — link aktywacyjny zapisany w .state/admin-link.txt,
 *   4. start zbudowanego API (apps/api/dist/main.js) z pocztą w plikach .eml (.state/mail).
 * Wymaga zbudowanego API: pnpm build.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const state = resolve(here, ".state");
config({ path: resolve(root, ".env"), quiet: true });

const base = process.env.DATABASE_URL;
if (!base) throw new Error("Brak DATABASE_URL (plik .env w katalogu głównym)");
const url = new URL(base);
const dbName = `${url.pathname.slice(1)}_e2e`;
if (!/^[a-z0-9_]+_e2e$/.test(dbName)) throw new Error(`Nieprawidłowa nazwa bazy E2E: ${dbName}`);
if (!existsSync(resolve(root, "apps/api/dist/main.js"))) throw new Error("Brak zbudowanego API — uruchom: pnpm build");

const admin = new URL(base); admin.pathname = "/postgres"; admin.search = "";
const c = new pg.Client({ connectionString: admin.toString() });
await c.connect();
await c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
await c.query(`CREATE DATABASE "${dbName}"`);
await c.end();
url.pathname = `/${dbName}`;

const API_PORT = process.env.E2E_API_PORT ?? "3100";
const WEB_URL = process.env.E2E_WEB_URL ?? "http://127.0.0.1:4180";
rmSync(state, { recursive: true, force: true });
mkdirSync(resolve(state, "mail"), { recursive: true });

const env = {
  ...process.env, NODE_ENV: "test", DATABASE_URL: url.toString(), API_HOST: "127.0.0.1", API_PORT, APP_URL: WEB_URL, CORS_ORIGINS: "",
  ALLOWED_NETWORKS: "", TRUSTED_PROXIES: "127.0.0.1", COMPANY_DOMAINS: "resinvest.group", EMAIL_TRANSPORT: "file", MAIL_FILE_DIR: resolve(state, "mail"),
  MAIL_WORKER: "on", LOGIN_MAX_FAILS: "5", LOGIN_RATE_PER_IP: "200", LOGIN_RATE_PER_EMAIL: "20",
};
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, env, stdio: ["ignore", "pipe", "inherit"] }).toString();
run(resolve(root, "node_modules/.bin/prisma"), ["migrate", "deploy"]);
run(process.execPath, ["apps/api/dist/seed/seed.js"]);
const out = run(process.execPath, ["apps/api/dist/cli.js", "bootstrap-admin", "admin.e2e@resinvest.group"]);
const link = out.split("\n").find(l => l.includes("/aktywacja?token="));
if (!link) throw new Error(`CLI nie zwróciło linku aktywacyjnego:\n${out}`);
writeFileSync(resolve(state, "admin-link.txt"), link.trim(), { mode: 0o600 });

const api = spawn(process.execPath, ["apps/api/dist/main.js"], { cwd: root, env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => api.kill(sig));
api.on("exit", code => process.exit(code ?? 0));
