import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { client, fixture, type Client } from "./fixtures.js";
import { todayWarsaw } from "../src/opening/opening.service.js";

/**
 * F4b-2 — przesunięcia MM: dwuetapowe (wysłanie → „W drodze” → przyjęcie z różnicą i przyczyną) i jednoetapowe,
 * izolacja magazynów (wysyła magazyn źródłowy, przyjmuje docelowy), idempotencja i równoczesne przyjęcia, rejestr.
 * Własne magazyny „TMA” (źródło) i „TMB” (cel) — testy nie zależą od innych plików.
 */
let app: INestApplication;
let F: Awaited<ReturnType<typeof fixture>>;
let admin: Client, mgr: Client, mag: Client, view: Client;
let A = "", B = "", ZR = "", PKS = "", SUP = "";
const today = todayWarsaw();
const key = () => `t-${randomUUID()}`;
const bal = async (wh: string, m: string) => (await F.db.stockBalance.findUnique({ where: { warehouseId_materialId: { warehouseId: wh, materialId: m } } }))?.qty.toString() ?? "0";
const mm = (c: Client, o: object, k = key()) => c.post("/operations", { idempotencyKey: k, operation: { type: "TRANSFER", warehouseId: A, targetWarehouseId: B, date: today, materialId: ZR, unit: "MP", ...o } });
const receive = (c: Client, id: string, receipt: object, k = key()) => c.post(`/operations/${id}/receive`, { idempotencyKey: k, receipt });
const setMode = (v: "one" | "two") => F.db.setting.upsert({ where: { key: "mm.mode" }, update: { value: v }, create: { key: "mm.mode", value: v } });

beforeAll(async () => {
  app = await createTestApp(); F = await fixture(app, "mm");
  A = (await F.db.warehouse.upsert({ where: { code: "TMA" }, update: {}, create: { code: "TMA", name: "Magazyn MM źródłowy" } })).id;
  B = (await F.db.warehouse.upsert({ where: { code: "TMB" }, update: {}, create: { code: "TMB", name: "Magazyn MM docelowy" } })).id;
  // kierownik — tylko magazyn źródłowy; magazynier i obserwator — tylko docelowy
  await F.db.userWarehouse.create({ data: { userId: F.users.mgr.id, warehouseId: A } });
  for (const u of [F.users.mag, F.users.view]) await F.db.userWarehouse.create({ data: { userId: u.id, warehouseId: B } });
  admin = client(app); mgr = client(app); mag = client(app); view = client(app);
  await admin.login(F.users.admin.email); await mgr.login(F.users.mgr.email); await mag.login(F.users.mag.email); await view.login(F.users.view.email);
  const mats = Object.fromEntries((await F.db.material.findMany()).map(m => [m.code, m.id]));
  ZR = mats["ZR-PL"]!; PKS = mats.PKS!;
  SUP = (await mgr.post("/catalog/partners", { name: "Dostawca MM", role: "SUPPLIER" })).body.row.id;
  const pz = await mgr.post("/operations", { idempotencyKey: key(), operation: { type: "PURCHASE", warehouseId: A, date: today, partnerId: SUP, materialId: ZR, qty: "200", unit: "MP", price: "40" } });
  expect(pz.status).toBe(201);
  await setMode("two");
});
afterAll(async () => { await setMode("two"); await app.close(); });

describe("MM dwuetapowe", () => {
  let op = "";
  it("wysłanie 120 MP: rozchód w źródle, cel bez zmian, stan „w drodze”, tonaż ręczny na dokumencie", async () => {
    const r = await mm(mgr, { qty: "120", weightManual: "40,2", numbering: { mode: "MANUAL", number: "MM 1/TMA" } });
    expect(r.status).toBe(201);
    op = r.body.operation.id;
    expect(r.body.operation.documents[0]).toMatchObject({ type: "MM", number: "MM 1/TMA", lines: [{ qtyStock: "120", weightT: "40.2", weightSource: "MANUAL" }] });
    expect(r.body.operation.transfer).toMatchObject({ target: { code: "TMB" }, state: "IN_TRANSIT", twoStage: true, receipt: null });
    expect(await bal(A, ZR)).toBe("80"); expect(await bal(B, ZR)).toBe("0");
  });
  it("magazyn docelowy widzi MM w rejestrze (kierunek IN) i na liście do przyjęcia", async () => {
    const reg = await mag.get(`/documents?warehouseId=${B}`);
    expect(reg.body.rows).toEqual([expect.objectContaining({ number: "MM 1/TMA", transfer: expect.objectContaining({ direction: "IN", state: "IN_TRANSIT", to: "Magazyn MM docelowy" }) })]);
    const t = await mag.get(`/transfers/in-transit?warehouseId=${B}`);
    expect(t.body.transfers).toEqual([expect.objectContaining({ operationId: op, direction: "IN", qtyStock: "120", material: expect.objectContaining({ id: ZR }) })]);
    expect((await mag.get(`/operations/${op}`)).status).toBe(200);
  });
  it("przyjmuje tylko magazyn docelowy z uprawnieniem mm.receive", async () => {
    expect((await receive(mgr, op, {})).body.code).toBe("WAREHOUSE_FORBIDDEN");
    expect((await receive(view, op, {})).status).toBe(403);
  });
  it("różnica bez przyczyny i data sprzed wysłania — błędy przy polach, nic nie zapisane", async () => {
    const r = await receive(mag, op, { qty: "116" });
    expect(r.status).toBe(400); expect(r.body.details[0]).toMatchObject({ field: "reason", message: expect.stringContaining("4 MP") });
    const d = await receive(mag, op, { date: "2020-01-01" });
    expect(d.body.details[0].field).toBe("date");
    expect(await bal(B, ZR)).toBe("0");
  });
  it("przyjęcie 116 MP z ubytkiem: przychód w celu, różnica 4, stan „przyjęte”, audyt; to samo żądanie ponownie — bez drugiego ruchu", async () => {
    const k = key();
    const r = await receive(mag, op, { qty: "116", reason: "LOSS", note: "ubytek na trasie" }, k);
    expect(r.status).toBe(200);
    expect(r.body.operation.transfer).toMatchObject({ state: "RECEIVED", receipt: { qtyStock: "116", diffStock: "4", reason: "LOSS", reasonLabel: "Ubytek w transporcie" } });
    expect(await bal(B, ZR)).toBe("116");
    const again = await receive(mag, op, { qty: "116", reason: "LOSS", note: "ubytek na trasie" }, k);
    expect(again.status).toBe(200);
    expect(await bal(B, ZR)).toBe("116");
    expect(await F.db.stockMovement.count({ where: { operationId: op, kind: "TRANSFER_IN" } })).toBe(1);
    expect(await F.db.auditLog.count({ where: { action: "MM_RECEIVED", entityId: op } })).toBe(1);
  });
  it("drugie przyjęcie (inne żądanie) — odrzucone; MM znika z listy do przyjęcia", async () => {
    const r = await receive(mag, op, {});
    expect(r.status).toBe(409); expect(r.body.code).toBe("MM_RECEIVED");
    expect((await mag.get(`/transfers/in-transit?warehouseId=${B}`)).body.transfers).toEqual([]);
  });
  it("równoczesne przyjęcia tego samego MM — dokładnie jedno skuteczne", async () => {
    const s = await mm(mgr, { qty: "10" });
    const id = s.body.operation.id;
    const res = await Promise.all([receive(mag, id, {}), receive(mag, id, {}), receive(admin, id, {})]);
    expect(res.map(r => r.status).sort()).toEqual([200, 409, 409]);
    expect(await bal(B, ZR)).toBe("126");
    expect(await F.db.stockMovement.count({ where: { operationId: id, kind: "TRANSFER_IN" } })).toBe(1);
  });
});

describe("MM jednoetapowe i reguły", () => {
  it("tryb jednoetapowy: rozchód i przychód jednym zatwierdzeniem; przyjęcie niepotrzebne", async () => {
    await setMode("one");
    try {
      const r = await mm(mgr, { qty: "20" });
      expect(r.status).toBe(201);
      expect(r.body.operation.transfer).toMatchObject({ state: "RECEIVED", twoStage: false });
      expect(await bal(A, ZR)).toBe("50"); expect(await bal(B, ZR)).toBe("146");
      const rc = await receive(mag, r.body.operation.id, {});
      expect(rc.status).toBe(409); expect(rc.body.error).toMatch(/jednoetapowe/);
    } finally { await setMode("two"); }
  });
  it("ten sam magazyn, ponad stan, brak uprawnienia, cudzy magazyn źródłowy — odrzucone bez zapisu", async () => {
    const same = await mm(mgr, { targetWarehouseId: A, qty: "1" });
    expect(same.status).toBe(400); expect(same.body.details[0].field).toBe("targetWarehouseId");
    const over = await mm(mgr, { materialId: PKS, unit: "T", qty: "5" });
    expect(over.status).toBe(409); expect(over.body.code).toBe("STOCK_INSUFFICIENT");
    expect((await mm(view, { qty: "1" })).status).toBe(403);
    expect((await mm(mag, { qty: "1" })).body.code).toBe("WAREHOUSE_FORBIDDEN");
    expect(await bal(A, ZR)).toBe("50");
  });
  it("nieaktywny magazyn docelowy — błąd przy polu", async () => {
    const c = await F.db.warehouse.create({ data: { code: "TMC", name: "Magazyn zamknięty", active: false } });
    const r = await mm(mgr, { targetWarehouseId: c.id, qty: "1" });
    expect(r.status).toBe(400); expect(r.body.details[0]).toMatchObject({ field: "targetWarehouseId", message: expect.stringMatching(/nieaktywny/) });
  });
  it("spójność: saldo każdego magazynu = suma ruchów", async () => {
    for (const wh of [A, B]) {
      const sum = await F.db.stockMovement.aggregate({ where: { warehouseId: wh, materialId: ZR }, _sum: { qty: true } });
      expect(sum._sum.qty?.toString()).toBe(await bal(wh, ZR));
    }
  });
});
