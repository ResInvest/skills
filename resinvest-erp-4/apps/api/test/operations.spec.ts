import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { client, fixture, type Client } from "./fixtures.js";
import { todayWarsaw } from "../src/opening/opening.service.js";

/**
 * F4b-1 — dokumenty: zakup (PZ), sprzedaż z magazynu (WZ), produkcja na magazynie (RW + PW), numeracja automatyczna
 * i ręczna, idempotencja, operacje dodatkowe, brak stanu ujemnego, zamknięty okres, uprawnienia, rejestr dokumentów.
 * Osobny magazyn testowy „TST” — testy nie zależą od innych plików.
 */
let app: INestApplication;
let F: Awaited<ReturnType<typeof fixture>>;
let admin: Client, mgr: Client, mag: Client, view: Client;
let WH = "", M: Record<string, string> = {}, SUP = "", BUY = "", VEH = "", HOL = "", LAD = "";
const today = todayWarsaw();
const key = () => `t-${randomUUID()}`;
const bal = async (code: string) => (await F.db.stockBalance.findUnique({ where: { warehouseId_materialId: { warehouseId: WH, materialId: M[code]! } } }))?.qty.toString() ?? "0";
const post = (c: Client, operation: object, idempotencyKey = key()) => c.post("/operations", { idempotencyKey, operation: { warehouseId: WH, date: today, ...operation } });
const PZ = (o: object = {}) => ({ type: "PURCHASE", partnerId: SUP, materialId: M["DRW-O"], qty: "20", unit: "M3", price: "230", ...o });
const WZ = (o: object = {}) => ({ type: "SALE", partnerId: BUY, materialId: M["ZR-PL"], qty: "60", unit: "MP", price: "90", ...o });

beforeAll(async () => {
  app = await createTestApp(); F = await fixture(app, "ops");
  WH = (await F.db.warehouse.upsert({ where: { code: "TST" }, update: {}, create: { code: "TST", name: "Magazyn testowy dokumentów" } })).id;
  for (const u of [F.users.mgr, F.users.mag, F.users.view]) await F.db.userWarehouse.create({ data: { userId: u.id, warehouseId: WH } });
  admin = client(app); mgr = client(app); mag = client(app); view = client(app);
  await admin.login(F.users.admin.email); await mgr.login(F.users.mgr.email); await mag.login(F.users.mag.email); await view.login(F.users.view.email);
  M = Object.fromEntries((await F.db.material.findMany()).map(m => [m.code, m.id]));
  SUP = (await mgr.post("/catalog/partners", { name: "Lander Agro ops", role: "SUPPLIER" })).body.row.id;
  BUY = (await mgr.post("/catalog/partners", { name: "EC Zabrze ops", role: "BUYER" })).body.row.id;
  VEH = (await mgr.post("/catalog/vehicles", { name: "Scania", registration: "OPS 1", warehouseId: WH })).body.row.id;
  const types = await F.db.additionalOperationType.findMany();
  HOL = types.find(t => t.name === "Holowanie")!.id; LAD = types.find(t => t.name === "Praca ładowarką")!.id;
  await F.db.additionalOperationType.update({ where: { id: LAD }, data: { defaultRate: "160" } });
});
afterAll(async () => { await app.close(); });

describe("zakup (PZ)", () => {
  let first = "";
  it("§22 TEST 4: 20 m³ × 230 zł — PZ z numerem automatycznym, ruch +20 m³, koszt 4 600 zł, audyt", async () => {
    const r = await post(mgr, PZ());
    expect(r.status).toBe(201);
    const op = r.body.operation;
    expect(op).toMatchObject({ type: "PURCHASE", status: "POSTED", totals: { purchaseCost: "4600", revenue: "0" } });
    expect(op.documents[0]).toMatchObject({ type: "PZ", number: `PZ/001/${today.slice(5, 7)}/${today.slice(0, 4)}`, partner: { name: "Lander Agro ops" } });
    expect(op.documents[0].lines[0]).toMatchObject({ qtyStock: "20", unitStock: "M3", weightSource: "COMPANY_RATE", value: "4600" });
    expect(await bal("DRW-O")).toBe("20");
    expect(await F.db.stockMovement.count({ where: { operationId: op.id, documentId: op.documents[0].id, kind: "PURCHASE" } })).toBe(1);
    expect(await F.db.auditLog.count({ where: { action: "OPERATION_CREATED", entityId: op.id } })).toBe(1);
    first = op.id;
  });
  it("idempotencja: to samo żądanie wysłane dwa razy (podwójne kliknięcie) — jedna operacja", async () => {
    const k = key();
    const [a, b] = await Promise.all([post(mgr, PZ({ qty: "5" }), k), post(mgr, PZ({ qty: "5" }), k)]);
    expect([a.status, b.status].every(s => s === 201)).toBe(true);
    expect(a.body.operation.id).toBe(b.body.operation.id);
    expect(await bal("DRW-O")).toBe("25");
    expect(first).not.toBe(a.body.operation.id);
  });
  it("numer ręczny: zapisany; ten sam numer (inna wielkość liter, spacje) w magazynie i roku — odrzucony", async () => {
    const r = await post(mgr, PZ({ qty: "1", numbering: { mode: "MANUAL", number: "PZ/11" } }));
    expect(r.body.operation.documents[0].number).toBe("PZ/11");
    const dup = await post(mgr, PZ({ qty: "1", numbering: { mode: "MANUAL", number: "pz / 11" } }));
    expect(dup.status).toBe(400); expect(dup.body.details[0]).toMatchObject({ field: "numbering.number", message: expect.stringMatching(/już użyty/) });
    // podgląd informuje o zajętym numerze już przed zatwierdzeniem
    const pre = await mgr.post("/operations/preview", { warehouseId: WH, date: today, ...PZ({ qty: "1", numbering: { mode: "MANUAL", number: "Pz/ 11" } }) });
    expect(pre.status).toBe(400); expect(pre.body.details[0]).toMatchObject({ field: "numbering.number", message: expect.stringMatching(/już użyty/) });
    expect(await bal("DRW-O")).toBe("26");
  });
  it("równoczesne zakupy z numeracją automatyczną — różne numery, bez kolizji", async () => {
    const res = await Promise.all(Array.from({ length: 5 }, () => post(mgr, PZ({ qty: "1" }))));
    expect(res.every(r => r.status === 201)).toBe(true);
    const nums = res.map(r => r.body.operation.documents[0].number);
    expect(new Set(nums).size).toBe(5);
    expect(await bal("DRW-O")).toBe("31");
  });
  it("kontrahent w złej roli, ilość 0, jednostka niedozwolona — błędy przy polach", async () => {
    const r = await post(mgr, PZ({ partnerId: BUY, qty: "0" }));
    expect(r.status).toBe(400);
    expect(r.body.details.map((d: { field: string }) => d.field).sort()).toEqual(["partnerId", "qty"]);
    expect((await post(mgr, PZ({ materialId: M["PKS"], unit: "MP" }))).body.details[0].field).toBe("unit");
  });
});

describe("sprzedaż z magazynu (WZ) i produkcja (RW + PW)", () => {
  it("§31.16 B: produkcja ponad stan surowca — komunikat jak w 3.x, nic nie zapisane (numer nie zużyty)", async () => {
    const before = await F.db.document.count({ where: { warehouseId: WH } });
    const r = await post(mgr, { type: "PRODUCTION", rawMaterialId: M["DRW-O"], outMaterialId: M["ZR-PL"], outQty: "500" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("Brak wystarczającej ilości: Drewno opałowe (Magazyn testowy dokumentów). Dostępne: 31 m³. Wymagane: 125 m³. Brakuje: 94 m³.");
    expect(await F.db.document.count({ where: { warehouseId: WH } })).toBe(before);
  });
  it("§22 TEST 1: produkcja 100 MP → zużycie 25 m³ (RW), przychód 100 MP (PW), rąbanie 100 × 10 zł, rębak firmy zewnętrznej", async () => {
    const ext = (await mgr.post("/catalog/external-companies", { name: "Drwal ops", kind: "CHIPPING" })).body.row.id;
    const ch = (await mgr.post("/catalog/chippers", { name: "Bandit ops", ownership: "EXTERNAL", externalCompanyId: ext, externalOperator: "Zbigniew Kos", warehouseId: WH })).body.row.id;
    const r = await post(mgr, { type: "PRODUCTION", rawMaterialId: M["DRW-O"], outMaterialId: M["ZR-PL"], outQty: "100", chipRate: "10", chipperId: ch });
    expect(r.status).toBe(201);
    const op = r.body.operation;
    expect(op.documents.map((d: { type: string }) => d.type)).toEqual(["RW", "PW"]);
    expect(op.production).toMatchObject({ consumeQty: "25", outQty: "100", chippingCost: "1000", chipper: "Bandit ops", operator: "Zbigniew Kos" });
    expect(await bal("DRW-O")).toBe("6"); expect(await bal("ZR-PL")).toBe("100");
  });
  it("§9 WZ ponad stan — odrzucone; WZ 60 MP z tonażem RĘCZNYM 20,35 t i operacjami dodatkowymi (pojazd z floty)", async () => {
    expect((await post(mgr, WZ({ qty: "100,01" }))).body.code).toBe("STOCK_INSUFFICIENT");
    const r = await post(mgr, WZ({ weightManual: "20,35", extras: [{ typeId: HOL, vehicleId: VEH, cost: "500", description: "Holowanie" }, { typeId: LAD, qty: "2" }] }));
    expect(r.status).toBe(201);
    const op = r.body.operation;
    expect(op.documents[0].lines[0]).toMatchObject({ qtyStock: "60", weightT: "20.35", weightSource: "MANUAL", value: "5400" });
    expect(op.totals).toMatchObject({ revenue: "5400", additionalCost: "820" });
    expect(op.extras.map((x: { cost: string }) => x.cost)).toEqual(["500", "320"]);
    expect(op.extras[0].vehicle).toBe("OPS 1 · Scania");
    expect(await bal("ZR-PL")).toBe("40");
  });
  it("podgląd przed zatwierdzeniem: numery, stan przed/po, braki — bez zapisu", async () => {
    const n = await F.db.operation.count();
    const p = await mgr.post("/operations/preview", { warehouseId: WH, date: today, ...WZ({ qty: "50" }) });
    expect(p.status).toBe(200);
    expect(p.body.numbers[0]).toMatch(/^WZ\/002\//);
    expect(p.body.steps[0]).toMatchObject({ before: "40", after: "-10" });
    expect(p.body.shortages[0].message).toMatch(/Brakuje: 10 MP/);
    expect(await F.db.operation.count()).toBe(n);
  });
});

describe("uprawnienia, okresy, rejestr", () => {
  it("obserwator nie wprowadza; magazynier wprowadza w swoim magazynie; kierownik bez dostępu do Rokitek", async () => {
    expect((await post(view, PZ({ qty: "1" }))).status).toBe(403);
    expect((await post(mag, PZ({ qty: "1" }))).status).toBe(201);
    expect((await mgr.post("/operations", { idempotencyKey: key(), operation: { ...PZ(), warehouseId: F.wh.ROK, date: today } })).body.code).toBe("WAREHOUSE_FORBIDDEN");
  });
  it("zamknięty okres inwentaryzacji blokuje operacje z datą w tym miesiącu", async () => {
    await F.db.inventoryPeriod.create({ data: { warehouseId: WH, period: "2026-08", status: "CLOSED", openedById: F.users.admin.id, closedAt: new Date(), closedById: F.users.admin.id } });
    const r = await post(mgr, PZ({ qty: "1" }), key());
    expect(r.status).toBe(201); // bieżący miesiąc — otwarty
    const old = await mgr.post("/operations", { idempotencyKey: key(), operation: { ...PZ({ qty: "1" }), warehouseId: WH, date: "2026-08-20" } });
    expect(old.status).toBe(400); expect(old.body.details[0]).toMatchObject({ field: "date", message: expect.stringMatching(/Okres 2026-08 jest zamknięty/) });
  });
  it("rejestr: domyślnie tylko PZ / WZ / MM; dokumenty pomocnicze (RW, PW) na żądanie; wyszukiwanie po kontrahencie", async () => {
    const main = await mgr.get(`/documents?warehouseId=${WH}`);
    expect(new Set(main.body.rows.map((r: { type: string }) => r.type))).toEqual(new Set(["PZ", "WZ"]));
    const aux = await mgr.get(`/documents?warehouseId=${WH}&aux=1`);
    expect(aux.body.rows.map((r: { type: string }) => r.type)).toEqual(expect.arrayContaining(["RW", "PW"]));
    const q = await mgr.get(`/documents?warehouseId=${WH}&q=EC%20Zabrze`);
    expect(q.body.rows.every((r: { type: string; partner: string }) => r.type === "WZ" && r.partner === "EC Zabrze ops")).toBe(true);
    expect((await mgr.get(`/documents?warehouseId=${F.wh.ROK}`)).status).toBe(403);
  });
  it("spójność: saldo = suma ruchów dla magazynu testowego", async () => {
    const rows = await F.db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "stock_balances" b
      LEFT JOIN (SELECT "warehouse_id", "material_id", sum("qty") s FROM "stock_movements" GROUP BY 1, 2) m USING ("warehouse_id", "material_id")
      WHERE b."warehouse_id" = ${WH}::uuid AND b."qty" <> coalesce(m.s, 0)`;
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
