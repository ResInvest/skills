import { planOperation, qtySum, type OperationInput, type PlanExtraType, type PlanMaterial, type TransportFleet } from "@resinvest/domain";

/**
 * Atrapa API dla wersji demonstracyjnej (jeden plik HTML, bez serwera): odczyty z nagrania prawdziwego API
 * (demo/record.mjs), preferencje (motyw, język) i logowanie w pamięci strony, podgląd operacji liczony tą samą
 * funkcją domeny co serwer. Zapis operacji i inne zmiany danych są wyłączone (komunikat w języku interfejsu).
 */
export interface Snapshot { recordedAt: string; today: string; entries: Record<string, unknown> }
type Json = Record<string, unknown>;

export const DEMO_MSG = "Wersja demonstracyjna — zapis jest wyłączony. Dane pochodzą z przebiegu testowego systemu.";
const LS = "riw.demo.prefs";

const norm = (path: string) => { const u = new URL(path, "http://x"); u.searchParams.sort(); return `${u.pathname}${u.search}`; };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export function installMockApi(snap: Snapshot): void {
  const E = snap.entries;
  const byPath = new Map<string, string>();
  for (const k of Object.keys(E)) { const p = k.slice(4).split("?")[0]!; if (!byPath.has(p)) byPath.set(p, k); }
  const me = structuredClone((E["GET /auth/me"] as { user: Json }).user) as Json & { prefs: Json };
  try { Object.assign(me.prefs, JSON.parse(localStorage.getItem(LS) ?? "{}")); } catch { /* bez pamięci */ }
  let loggedIn = true;
  const real = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (!path.startsWith("/api/v1/")) return real(input, init);
    const p = path.slice("/api/v1".length);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) as Json : {};
    await new Promise(r => setTimeout(r, 60));   // odczucie sieci — widoczne stany „Wczytywanie…”

    if (p === "/auth/me" && method === "GET") return loggedIn ? json(200, { ok: true, user: me }) : json(401, { ok: false, code: "UNAUTHORIZED", error: "Sesja wygasła lub nie jesteś zalogowany. Zaloguj się ponownie." });
    if (p === "/auth/login") { loggedIn = true; return json(200, { ok: true, user: me }); }
    if (p === "/auth/logout") { loggedIn = false; return json(200, { ok: true }); }
    if (p === "/auth/me/preferences" && method === "PUT") {
      Object.assign(me.prefs, body);
      try { localStorage.setItem(LS, JSON.stringify(me.prefs)); } catch { /* bez pamięci */ }
      return json(200, { ok: true, prefs: me.prefs });
    }
    if (!loggedIn && !p.startsWith("/auth/") && p !== "/health") return json(401, { ok: false, code: "UNAUTHORIZED", error: "Sesja wygasła lub nie jesteś zalogowany. Zaloguj się ponownie." });
    if (method === "POST" && (p === "/operations/preview" || /^\/operations\/[^/]+\/correction\/preview$/.test(p))) return preview(E, (body.operation ?? body) as OperationInput);
    if (method === "GET") {
      const k = E[`GET ${norm(p)}`] !== undefined ? `GET ${norm(p)}` : byPath.get(p.split("?")[0]!);
      if (k) return json(200, E[k]);
      return json(404, { ok: false, code: "NOT_FOUND", error: "Nie znaleziono." });
    }
    return json(403, { ok: false, code: "DEMO", error: DEMO_MSG });
  };
}

interface FormData {
  materials: PlanMaterial[]; extraTypes: PlanExtraType[]; rates: never; today: string; mmTwoStage: boolean; kmRateDefault: string; balances: Record<string, string>;
  vehicles: Array<{ id: string; registration: string; status: string; warehouseId: string | null; defaultDriverId: string | null; ownership: "OWN" | "EXTERNAL" }>;
  drivers: Array<{ id: string; name: string }>; companies: Array<{ id: string; name: string }>; warehouses: Array<{ id: string; name: string }>;
}

/** Podsumowanie operacji jak z serwera: plan domeny, numery dokumentów (wzorzec), stan przed / po, braki towaru. */
function preview(E: Record<string, unknown>, input: OperationInput): Response {
  const fd = E[`GET ${norm(`/operations/form-data?warehouseId=${input.warehouseId}`)}`] as FormData | undefined;
  if (!fd) return json(403, { ok: false, code: "DEMO", error: DEMO_MSG });
  const fleet: TransportFleet = {
    vehicles: new Map(fd.vehicles.map(v => [v.id, { id: v.id, registration: v.registration, status: v.status as "ACTIVE", warehouseId: v.warehouseId ?? input.warehouseId, defaultDriverId: v.defaultDriverId, ownership: v.ownership }])),
    drivers: new Map(fd.drivers.map(d => [d.id, { id: d.id, name: d.name, active: true }])),
    companies: new Map(fd.companies.map(c => [c.id, { id: c.id, name: c.name, active: true }])),
    warehouseNames: new Map(fd.warehouses.map(w => [w.id, w.name])),
  };
  const r = planOperation(input, { materials: new Map(fd.materials.map(m => [m.id, m])), extraTypes: new Map(fd.extraTypes.map(x => [x.id, x])), rates: fd.rates,
    today: fd.today, transferTwoStage: fd.mmTwoStage, kmRateDefault: fd.kmRateDefault, fleet });
  if (!r.ok) return json(400, { ok: false, code: "VALIDATION", error: "Nieprawidłowe dane", details: r.errors });
  const ym = input.date.slice(5, 7) + "/" + input.date.slice(0, 4);
  const numbers = r.plan.documents.map(d => `${d.type}/DEMO/${ym}`);
  const running = new Map<string, string>(), steps: Array<{ key: string; before: string; qty: string; after: string }> = [], shortages: Array<{ materialId: string; message: string }> = [];
  for (const m of r.plan.movements) {
    const key = `${m.warehouseId}|${m.materialId}`;
    const before = running.get(key) ?? (m.warehouseId === input.warehouseId ? fd.balances[m.materialId] ?? "0" : "0");
    const after = qtySum(before, m.qty);
    running.set(key, after);
    steps.push({ key, before, qty: m.qty, after });
    if (after.startsWith("-")) shortages.push({ materialId: m.materialId, message: "Operacja zmniejszyłaby stan poniżej zera." });
  }
  return json(200, { ok: true, plan: r.plan, numbers, steps, shortages });
}
