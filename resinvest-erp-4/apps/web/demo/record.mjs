/**
 * Wersja demonstracyjna — krok 1: nagranie odpowiedzi API (tylko odczyty GET) z działającego serwera ResInvest ERP.
 * Użycie: DEMO_API=http://127.0.0.1:3101 DEMO_EMAIL=… DEMO_PASSWORD=… node demo/record.mjs demo/snapshot.json
 * Dane nie są zmieniane (logowanie + odczyty). Klucz nagrania: METODA ścieżka?parametry (parametry posortowane).
 */
import { writeFileSync } from "node:fs";

const API = (process.env.DEMO_API ?? "http://127.0.0.1:3101").replace(/\/$/, "");
const ORIGIN = process.env.DEMO_ORIGIN ?? "http://127.0.0.1:4180";
const out = process.argv[2] ?? "demo/snapshot.json";
let cookie = "";

const norm = path => { const u = new URL(path, "http://x"); u.searchParams.sort(); return `${u.pathname}${u.search}`; };
const H = () => ({ "X-Requested-With": "ResInvestERP", Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" });
const snap = {};
async function get(path) {
  const r = await fetch(`${API}/api/v1${path}`, { headers: H() });
  const body = await r.json().catch(() => null);
  if (r.ok) snap[`GET ${norm(path)}`] = body;
  return r.ok ? body : null;
}

const login = await fetch(`${API}/api/v1/auth/login`, { method: "POST", headers: H(), body: JSON.stringify({ email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD }) });
if (!login.ok) throw new Error(`Logowanie nieudane: ${login.status} ${await login.text()}`);
cookie = (login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie")]).filter(Boolean).map(c => c.split(";")[0]).join("; ");

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
const iso = d => d.toISOString().slice(0, 10);
const D = s => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const weekStart = s => addDays(s, -((D(s).getUTCDay() + 6) % 7));
const month = today.slice(0, 7), year = Number(today.slice(0, 4));
const monthsBack = n => { const d = new Date(Date.UTC(year, Number(month.slice(5)) - 1 - n, 1)); return iso(d).slice(0, 7); };
const lastDay = m => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)); return iso(d); };

for (const p of ["/auth/config", "/auth/me", "/auth/sessions", "/health", "/materials", "/permissions", "/roles", "/warehouses", "/account/notifications"]) await get(p);
await get("/mail/outbox?page=1&pageSize=50");
await get("/audit?page=1&pageSize=50");
await get("/audit/logins?page=1&pageSize=50");
for (const k of ["materials", "partners", "additional-operation-types", "vehicles", "chippers", "drivers", "operators", "external-companies"]) await get(`/catalog/${k}`);

const users = (await get("/users"))?.users ?? [];
for (const u of users) { await get(`/users/${u.id}`); await get(`/users/${u.id}/sessions`); await get(`/users/${u.id}/notifications`); }

const whs = ((await get("/warehouses"))?.warehouses ?? []).filter(w => w.active);
await get("/opening-balances");
const opIds = new Set();
for (const w of [...whs.map(x => x.id), "ALL"]) {
  for (let i = 0; i < 12; i++) await get(`/dashboard?warehouseId=${w}&month=${monthsBack(i)}`);
  const ws = weekStart(today);
  for (let i = -4; i <= 1; i++) { const a = addDays(ws, 7 * i); await get(`/planner?warehouseId=${w}&from=${a}&to=${addDays(a, 6)}`); }
  for (const y of [year - 1, year]) await get(`/planner?warehouseId=${w}&from=${y}-01-01&to=${y}-12-31`);
  for (let i = 0; i < 12; i++) { const m = monthsBack(i); await get(`/reports/turnover?warehouseId=${w}&from=${m}-01&to=${lastDay(m)}`); }
  await get(`/reports/turnover?warehouseId=${w}&from=${year}-01-01&to=${year}-12-31`);
  for (const y of [year - 1, year]) await get(`/reports/summary?warehouseId=${w}&year=${y}`);
  if (w === "ALL") continue;
  await get(`/opening-balances?warehouseId=${w}`);
  await get(`/transfers/in-transit?warehouseId=${w}`);
  await get(`/operations/form-data?warehouseId=${w}`);
  for (const all of [0, 1]) {
    const bal = await get(`/stock/balances?warehouseId=${w}&all=${all}`);
    for (const b of bal?.balances ?? []) if (b.movements) await get(`/stock/movements?warehouseId=${w}&materialId=${b.materialId}`);
  }
  for (const aux of [0, 1]) {
    const docs = await get(`/documents?warehouseId=${w}&page=1&pageSize=50&aux=${aux}`);
    for (const d of docs?.rows ?? []) opIds.add(d.operationId);
    for (const type of ["PZ", "WZ", "MM", ...(aux ? ["RW", "PW", "BO"] : [])]) await get(`/documents?warehouseId=${w}&page=1&pageSize=50&aux=${aux}&type=${type}`);
  }
  for (const kind of ["corrections", "edited", "deleted"]) {
    const ch = await get(`/documents/changes?warehouseId=${w}&kind=${kind}&page=1&pageSize=50`);
    for (const r of ch?.rows ?? []) opIds.add(r.operationId);
  }
}
for (const id of opIds) { await get(`/operations/${id}`); await get(`/operations/${id}/history`); }

writeFileSync(out, JSON.stringify({ recordedAt: new Date().toISOString(), today, entries: snap }));
console.warn(`Nagrano ${Object.keys(snap).length} odpowiedzi (operacje: ${opIds.size}) → ${out}`);
