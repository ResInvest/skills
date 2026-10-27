import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { Response } from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { client, fixture, type Client } from "./fixtures.js";
import { todayWarsaw } from "../src/opening/opening.service.js";

/**
 * F6 — raporty na prawdziwej bazie (własny magazyn „TRA”): obroty z korektą w kolumnie zakupu i kontrolą spójności,
 * stan początkowy z ruchów sprzed okresu, zestawienie roczne, pulpit z operacjami dodatkowymi, eksport CSV / XLSX /
 * PDF / DOCX z audytem, uprawnienia i izolacja magazynów.
 */
let app: INestApplication;
let F: Awaited<ReturnType<typeof fixture>>;
let mgr: Client, mag: Client, view: Client;
let W = "", DRW = "", ZR = "", SUP = "", BUY = "", LOADER = "";
const today = todayWarsaw();
const past = new Date(new Date(`${today}T00:00:00Z`).getTime() - 10 * 864e5).toISOString().slice(0, 10);
const month = today.slice(0, 7), year = Number(today.slice(0, 4));
const key = () => `r-${randomUUID()}`;
const post = (op: object) => mgr.post("/operations", { idempotencyKey: key(), operation: { warehouseId: W, date: today, ...op } });
/** Odpowiedź binarna (plik) jako Buffer. */
const binary = (res: Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks)));
};
const file = (c: Client, qs: string) => c.get(`/reports/export?${qs}`).buffer(true).parse(binary);

beforeAll(async () => {
  app = await createTestApp(); F = await fixture(app, "rap");
  W = (await F.db.warehouse.upsert({ where: { code: "TRA" }, update: {}, create: { code: "TRA", name: "Magazyn raportów" } })).id;
  await F.db.userWarehouse.createMany({ data: [{ userId: F.users.mgr.id, warehouseId: W }, { userId: F.users.mag.id, warehouseId: W }, { userId: F.users.view.id, warehouseId: W }] });
  mgr = client(app); mag = client(app); view = client(app);
  await mgr.login(F.users.mgr.email); await mag.login(F.users.mag.email); await view.login(F.users.view.email);
  const mats = Object.fromEntries((await F.db.material.findMany()).map(m => [m.code, m.id]));
  DRW = mats["DRW-O"]!; ZR = mats["ZR-PL"]!;
  LOADER = (await F.db.additionalOperationType.findFirstOrThrow({ where: { name: "Praca ładowarką" } })).id;
  SUP = (await mgr.post("/catalog/partners", { name: "Dostawca raportów", role: "SUPPLIER" })).body.row.id;
  BUY = (await mgr.post("/catalog/partners", { name: "Odbiorca raportów", role: "BUYER" })).body.row.id;
  // sprzed okresu: zakup 50 m³ (stan początkowy); w okresie: zakup 100 → korekta 90, produkcja 100 MP (zużycie 25 m³), sprzedaż 60 MP
  expect((await post({ type: "PURCHASE", date: past, partnerId: SUP, materialId: DRW, qty: "50", unit: "M3", price: "100" })).status).toBe(201);
  const pz = await post({ type: "PURCHASE", partnerId: SUP, materialId: DRW, qty: "100", unit: "M3", price: "120",
    extras: [{ typeId: LOADER, qty: "2", rate: "150" }] });
  expect(pz.status).toBe(201);
  const c = await mgr.post(`/operations/${pz.body.operation.id}/correction`, { idempotencyKey: key(), version: 1, reason: "korekta ilości z kwitu",
    operation: { type: "PURCHASE", warehouseId: W, date: today, partnerId: SUP, materialId: DRW, qty: "90", unit: "M3", price: "120", extras: [{ typeId: LOADER, qty: "2", rate: "150" }] } });
  expect(c.status).toBe(200);
  expect((await post({ type: "PRODUCTION", rawMaterialId: DRW, outMaterialId: ZR, outQty: "100", chipRate: "8" })).status).toBe(201);
  expect((await post({ type: "SALE", partnerId: BUY, materialId: ZR, qty: "60", unit: "MP", price: "90" })).status).toBe(201);
});
afterAll(async () => { await app.close(); });

describe("obroty magazynowe", () => {
  it("okres = dziś: stan początkowy z wcześniejszego zakupu, korekta w kolumnie zakupu, zużycie, produkcja, sprzedaż; zgodne z saldami", async () => {
    const r = await mgr.get(`/reports/turnover?warehouseId=${W}&from=${today}&to=${today}`);
    expect(r.status).toBe(200);
    const drw = r.body.rows.find((x: { materialId: string }) => x.materialId === DRW);
    expect(drw).toMatchObject({ start: "50", purchase: "90", consumption: "25", reversals: "-100", end: "115", material: { name: "Drewno opałowe", unit: "M3" } });
    expect(r.body.rows.find((x: { materialId: string }) => x.materialId === ZR)).toMatchObject({ start: "0", production: "100", sale: "60", end: "40" });
    expect(r.body.check).toEqual({ ok: true, mismatches: [] });
  });
  it("okres w przeszłości: bez kontroli sald; zakres odwrócony i zbyt długi — błąd", async () => {
    const r = await mgr.get(`/reports/turnover?warehouseId=${W}&from=${past}&to=${past}`);
    expect(r.body.rows).toEqual([expect.objectContaining({ materialId: DRW, start: "0", purchase: "50", end: "50" })]);
    expect(r.body.check).toBeNull();
    expect((await mgr.get(`/reports/turnover?warehouseId=${W}&from=${today}&to=${past}`)).status).toBe(400);
    expect((await mgr.get(`/reports/turnover?warehouseId=${W}&from=2000-01-01&to=${today}`)).status).toBe(400);
  });
  it("izolacja: magazyn bez dostępu — 403; „wszystkie” = tylko magazyny użytkownika", async () => {
    expect((await view.get(`/reports/turnover?warehouseId=${F.wh.BRA}&from=${today}&to=${today}`)).status).toBe(403);
    const all = await view.get(`/reports/turnover?warehouseId=ALL&from=${today}&to=${today}`);
    expect(all.body.warehouses.map((w: { code: string }) => w.code).sort()).toEqual(["TRA", "ZAB"]);
  });
});

describe("zestawienie roczne i pulpit", () => {
  it("rok: bieżący miesiąc z kwotami po korekcie, produkcją MP, korektą; suma roku", async () => {
    const r = await mgr.get(`/reports/summary?warehouseId=${W}&year=${year}`);
    const m = r.body.months[Number(month.slice(5)) - 1];
    expect(m).toMatchObject({ purchases: 1, productions: 1, sales: 1, revenue: "5400.00", chippingCost: "800.00", additionalCost: "300.00", productionMp: "100", corrections: 1 });
    expect(m.purchaseCost).toBe(past.slice(0, 7) === month ? "15800.00" : "10800.00");
    expect(r.body.total.corrections).toBeGreaterThanOrEqual(1);
  });
  it("pulpit miesiąca: operacje dodatkowe wg rodzaju (bez wersji sprzed korekty), stany, korekty", async () => {
    const r = await mgr.get(`/dashboard?warehouseId=${W}&month=${month}`);
    expect(r.body.extras).toEqual({ rows: [{ type: "Praca ładowarką", count: 1, quantity: "2", cost: "300.00" }], total: "300.00" });
    expect(r.body.stock).toEqual(expect.arrayContaining([expect.objectContaining({ materialId: DRW, qty: "115" }), expect.objectContaining({ materialId: ZR, qty: "40" })]));
    expect(r.body.totals).toMatchObject({ revenue: "5400.00", corrections: 1 });
    expect((await mgr.get(`/dashboard?warehouseId=${W}&month=2026-13`)).status).toBe(400);
  });
});

describe("eksport", () => {
  it("CSV (BOM, średnik, przecinek), XLSX i DOCX (ZIP), PDF — nagłówki pliku i nazwa", async () => {
    const csv = await file(mgr, `report=turnover&format=csv&warehouseId=${W}&from=${today}&to=${today}`);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain(`obroty_TRA_${today}_${today}.csv`);
    const text = (csv.body as Buffer).toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("Drewno opałowe;m³;50;0;90;0;0;0;25;0;0;115");
    for (const [fmt, magic] of [["xlsx", "PK"], ["docx", "PK"], ["pdf", "%PDF"]] as const) {
      const f = await file(mgr, `report=summary&format=${fmt}&warehouseId=${W}&year=${year}`);
      expect(f.status).toBe(200);
      expect((f.body as Buffer).subarray(0, magic.length).toString("latin1")).toBe(magic);
      expect((f.body as Buffer).length).toBeGreaterThan(1000);
    }
    const reg = await file(mgr, `report=documents&format=xlsx&warehouseId=${W}`);
    expect(reg.status).toBe(200);
    expect(reg.headers["content-disposition"]).toContain("rejestr_TRA");
    expect(await F.db.auditLog.count({ where: { action: "REPORT_EXPORTED", userId: F.users.mgr.id } })).toBe(5);
  });
  it("uprawnienia: magazynier i obserwator bez reports.export — 403; rejestr „wszystkie magazyny” — 400", async () => {
    expect((await mag.get(`/reports/export?report=summary&format=csv&warehouseId=${W}&year=${year}`)).status).toBe(403);
    expect((await view.get(`/reports/export?report=summary&format=csv&warehouseId=${W}&year=${year}`)).status).toBe(403);
    expect((await view.get(`/reports/summary?warehouseId=${W}&year=${year}`)).status).toBe(200);
    expect((await mgr.get(`/reports/export?report=documents&format=csv&warehouseId=ALL`)).status).toBe(400);
  });
});
