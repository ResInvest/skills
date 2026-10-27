import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { client, fixture, type Client } from "./fixtures.js";
import { todayWarsaw } from "../src/opening/opening.service.js";

/**
 * F4c — planer zakupów: plan dzienny (zapis, wersja, audyt, uprawnienia, izolacja magazynów) i wykonanie liczone
 * z operacji zakupu (produkcja z zakupu, sprzedaż bezpośrednia, zakup materiału w MP; inne operacje pomijane),
 * tony z wagi kursu + 0,33 t/MP, km / transport / kursy, kierowcy. Własny magazyn „TPL”.
 */
let app: INestApplication;
let F: Awaited<ReturnType<typeof fixture>>;
let mgr: Client, mag: Client, view: Client;
let WH = "", DRW = "", ZR = "", ZRT = "", NDL = "", EC = "", VEH = "";
const today = todayWarsaw();
const key = () => `t-${randomUUID()}`;
const post = (operation: object) => mgr.post("/operations", { idempotencyKey: key(), operation: { warehouseId: WH, date: today, ...operation } });
const plan = (c: Client, o: object) => c.put("/planner/plan", { warehouseId: WH, date: today, ...o });

beforeAll(async () => {
  app = await createTestApp(); F = await fixture(app, "plan");
  WH = (await F.db.warehouse.upsert({ where: { code: "TPL" }, update: {}, create: { code: "TPL", name: "Magazyn testowy planera" } })).id;
  for (const u of [F.users.mgr, F.users.view]) await F.db.userWarehouse.create({ data: { userId: u.id, warehouseId: WH } });
  mgr = client(app); mag = client(app); view = client(app);
  await mgr.login(F.users.mgr.email); await mag.login(F.users.mag.email); await view.login(F.users.view.email);
  const m = Object.fromEntries((await F.db.material.findMany()).map(x => [x.code, x.id]));
  DRW = m["DRW-O"]!; ZR = m["ZR-PL"]!; ZRT = m["ZR-T"]!;
  NDL = (await mgr.post("/catalog/partners", { name: "Nadleśnictwo TPL", role: "SUPPLIER", kind: "FOREST_DISTRICT" })).body.row.id;
  EC = (await mgr.post("/catalog/partners", { name: "EC TPL", role: "BUYER" })).body.row.id;
  const drv = (await mgr.post("/catalog/drivers", { name: "Jan Planer" })).body.row.id;
  VEH = (await mgr.post("/catalog/vehicles", { name: "Volvo", registration: "TPL 001", warehouseId: WH, defaultDriverId: drv })).body.row.id;

  // 1) zakup 50 m³ z produkcją 200 MP i dwoma kursami (jeden zważony) — wchodzi do planera
  expect((await post({ type: "PURCHASE", partnerId: NDL, materialId: DRW, qty: "50", unit: "M3", price: "100",
    production: { enabled: true, outMaterialId: ZR, source: "FOREST", forestDistrict: "Rudziniec", forestry: "Kłodnica" },
    transport: { mode: "OWN", place: "Las Kłodnica", runs: [
      { ownership: "OWN", vehicleId: VEH, km: "40", waybillNo: "K1", qty: "100", weightT: "35" }, { ownership: "OWN", vehicleId: VEH, km: "40", waybillNo: "K2", qty: "100" }] } })).status).toBe(201);
  // 2) sprzedaż bezpośrednia 120 MP (koszt surowca 3 000 zł) — wchodzi
  expect((await post({ type: "DIRECT_SALE", rawMaterialId: DRW, rawCost: "3000", production: { outMaterialId: ZR, outQty: "120", source: "OTHER" }, sale: { buyerId: EC, price: "90", priceUnit: "MP" } })).status).toBe(201);
  // 3) zakup zrębki towarowej 30 MP — wchodzi; 4) sprzedaż z magazynu i produkcja ze stanu — NIE wchodzą
  expect((await post({ type: "PURCHASE", partnerId: NDL, materialId: ZRT, qty: "30", unit: "MP", price: "50" })).status).toBe(201);
  expect((await post({ type: "SALE", partnerId: EC, materialId: ZRT, qty: "10", unit: "MP", price: "80" })).status).toBe(201);
  expect((await post({ type: "PURCHASE", partnerId: NDL, materialId: DRW, qty: "10", unit: "M3", price: "100" })).status).toBe(201);
  expect((await post({ type: "PRODUCTION", rawMaterialId: DRW, outMaterialId: ZR, outQty: "20" })).status).toBe(201);
});
afterAll(async () => { await app.close(); });

describe("planer zakupów", () => {
  it("plan dnia: zapis kierownika, zmiana z wersją, konflikt wersji, audyt było/jest", async () => {
    const a = await plan(mgr, { planMp: "400", note: "las Kłodnica" });
    expect(a.status).toBe(200); expect(a.body.plan).toMatchObject({ planMp: "400", note: "las Kłodnica", version: 1 });
    const b = await plan(mgr, { planMp: "380,5", version: 1 });
    expect(b.body.plan).toMatchObject({ planMp: "380.5", version: 2, note: null });
    const c = await plan(mgr, { planMp: "1", version: 1 });
    expect(c.status).toBe(409); expect(c.body.code).toBe("VERSION_CONFLICT");
    const audit = await F.db.auditLog.findMany({ where: { action: "PLAN_UPDATED", warehouseId: WH }, orderBy: { ts: "asc" } });
    expect(audit.map(x => [x.before, x.after])).toEqual([
      [null, { dzien: today, planMP: "400", uwagi: "las Kłodnica" }],
      [{ dzien: today, planMP: "400", uwagi: "las Kłodnica" }, { dzien: today, planMP: "380.5", uwagi: null }],
    ]);
  });
  it("plan: ujemny / tekst — błąd przy polu; obserwator i magazyn bez dostępu — odmowa", async () => {
    expect((await plan(mgr, { planMp: "-5" })).body.details[0].field).toBe("planMp");
    expect((await plan(view, { planMp: "10" })).status).toBe(403);
    expect((await plan(mag, { planMp: "10" })).status).toBe(403);
    expect((await mag.get(`/planner?warehouseId=${WH}&from=${today}&to=${today}`)).body.code).toBe("WAREHOUSE_FORBIDDEN");
  });
  it("dzień: wykonanie 350 MP (200 + 120 + 30), tony 35 z wagi + reszta × 0,33, koszt zakupu, kursy; sprzedaż i produkcja ze stanu pominięte", async () => {
    const r = await mgr.get(`/planner?warehouseId=${WH}&from=${today}&to=${today}`);
    expect(r.status).toBe(200);
    const d = r.body.days[0];
    // tony: 35 (kurs zważony 100 MP) + (200 − 100) × 0,33 + 120 × 0,33 + 30 × 0,33 = 35 + 33 + 39,6 + 9,9
    expect(d).toMatchObject({ plan: "380.5", note: null, act: "350", tWeighed: "35", tAuto: "82.5", t: "117.5", purchaseCost: "9500.00", km: "80", transportCost: "400.00", trips: 2 });
    expect(d.places).toEqual(["Las Kłodnica"]);
    expect(r.body.ops).toHaveLength(3);
    expect(r.body.totals).toMatchObject({ act: "350", realization: "92", avgPrice: "27.14", transportPerMp: "1.14", weighedShare: "29.8" });
    expect(r.body.drivers).toEqual([expect.objectContaining({ driver: "Jan Planer", registration: "TPL 001", trips: 2, qty: "200", km: "80", cost: "400.00" })]);
    expect(r.body).toMatchObject({ editable: true, tonPerMp: "0.33" });
  });
  it("wszystkie magazyny: tylko dostępne użytkownikowi, bez edycji planu; obserwator czyta, ale nie edytuje", async () => {
    const all = await mgr.get(`/planner?warehouseId=ALL&from=${today}&to=${today}`);
    expect(all.body.editable).toBe(false);
    expect(all.body.warehouses).toEqual(expect.arrayContaining([WH, F.wh.ZAB, F.wh.BRA]));
    expect(all.body.warehouses).not.toContain(F.wh.ROK);
    expect((await view.get(`/planner?warehouseId=${WH}&from=${today}&to=${today}`)).body.editable).toBe(false);
  });
  it("zakres: odwrócone daty i ponad 400 dni — odrzucone", async () => {
    expect((await mgr.get(`/planner?warehouseId=${WH}&from=2026-10-02&to=2026-10-01`)).status).toBe(400);
    expect((await mgr.get(`/planner?warehouseId=${WH}&from=2025-01-01&to=2026-12-31`)).status).toBe(400);
  });
});
