import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { client, fixture, type Client } from "./fixtures.js";
import { todayWarsaw } from "../src/opening/opening.service.js";

/**
 * F4b-2b-2 — zakup z produkcją (PZ + RW + PW, opcjonalnie WZ wyniku) i sprzedaż bezpośrednia (produkcja w lesie: PW + WZ):
 * dokumenty i ruchy w jednej transakcji, pochodzenie (las / wycinka), rekord produkcji, salda, role kontrahentów, braki.
 * Własny magazyn „TCH”.
 */
let app: INestApplication;
let F: Awaited<ReturnType<typeof fixture>>;
let mgr: Client;
let WH = "", DRW = "", ZR = "", NDL = "", EC = "";
const today = todayWarsaw();
const key = () => `t-${randomUUID()}`;
const post = (operation: object) => mgr.post("/operations", { idempotencyKey: key(), operation: { warehouseId: WH, date: today, ...operation } });
const bal = async (m: string) => (await F.db.stockBalance.findUnique({ where: { warehouseId_materialId: { warehouseId: WH, materialId: m } } }))?.qty.toString() ?? "0";
const forest = { source: "FOREST", forestDistrict: "Rudziniec", forestry: "Kłodnica", waybill: "KW 7/2026" };

beforeAll(async () => {
  app = await createTestApp(); F = await fixture(app, "chain");
  WH = (await F.db.warehouse.upsert({ where: { code: "TCH" }, update: {}, create: { code: "TCH", name: "Magazyn testowy produkcji" } })).id;
  await F.db.userWarehouse.create({ data: { userId: F.users.mgr.id, warehouseId: WH } });
  mgr = client(app); await mgr.login(F.users.mgr.email);
  DRW = (await F.db.material.findUniqueOrThrow({ where: { code: "DRW-O" } })).id;
  ZR = (await F.db.material.findUniqueOrThrow({ where: { code: "ZR-PL" } })).id;
  NDL = (await mgr.post("/catalog/partners", { name: "Nadleśnictwo Rudziniec TCH", role: "SUPPLIER", kind: "FOREST_DISTRICT" })).body.row.id;
  EC = (await mgr.post("/catalog/partners", { name: "EC Zabrze TCH", role: "BUYER" })).body.row.id;
});
afterAll(async () => { await app.close(); });

describe("zakup z produkcją", () => {
  it("50 m³ × 120 zł → zużycie 50 m³ → 200 MP → sprzedaż 200 MP po 300 zł/t: PZ, RW, PW, WZ; salda bez zmian netto", async () => {
    const r = await post({ type: "PURCHASE", partnerId: NDL, materialId: DRW, qty: "50", unit: "M3", price: "120",
      production: { enabled: true, outMaterialId: ZR, chipRate: "10", ...forest }, sale: { buyerId: EC, price: "300", priceUnit: "T" } });
    expect(r.status).toBe(201);
    const op = r.body.operation;
    expect(op.type).toBe("PURCHASE");
    expect(op.documents.map((d: { type: string }) => d.type)).toEqual(["PZ", "RW", "PW", "WZ"]);
    expect(op.documents[3]).toMatchObject({ partner: { id: EC }, lines: [{ qtyStock: "200", weightT: "66", value: "19800" }] });
    expect(op.production).toMatchObject({ mode: "FROM_PURCHASE", consumeQty: "50", outQty: "200", chippingCost: "2000", forestDistrict: "Rudziniec", forestry: "Kłodnica", waybill: "KW 7/2026" });
    expect(op.totals).toMatchObject({ purchaseCost: "6000", revenue: "19800", chippingCost: "2000" });
    expect(op.movements.map((m: { kind: string; qty: string }) => [m.kind, m.qty])).toEqual([["PURCHASE", "50"], ["CONSUMPTION", "-50"], ["PRODUCTION", "200"], ["SALE", "-200"]]);
    expect(await bal(DRW)).toBe("0"); expect(await bal(ZR)).toBe("0");
  });
  it("zużycie ponad zakup + stan — odrzucone przez księgę, nic nie zapisane", async () => {
    const before = await F.db.operation.count({ where: { warehouseId: WH } });
    const r = await post({ type: "PURCHASE", partnerId: NDL, materialId: DRW, qty: "10", unit: "M3", price: "100", production: { enabled: true, outMaterialId: ZR, consumeQty: "15", outQty: "60", ...forest } });
    expect(r.status).toBe(409); expect(r.body.code).toBe("STOCK_INSUFFICIENT"); expect(r.body.error).toMatch(/Drewno opałowe/);
    expect(await F.db.operation.count({ where: { warehouseId: WH } })).toBe(before);
  });
  it("wynik niższy bez przyczyny, odbiorca w roli dostawcy, kwit przy kursach — błędy przy polach", async () => {
    const low = await post({ type: "PURCHASE", partnerId: NDL, materialId: DRW, qty: "10", unit: "M3", price: "100", production: { enabled: true, outMaterialId: ZR, outQty: "30", ...forest } });
    expect(low.body.details.map((d: { field: string }) => d.field)).toEqual(["production.diffReason"]);
    const role = await post({ type: "PURCHASE", partnerId: NDL, materialId: DRW, qty: "10", unit: "M3", price: "100", production: { enabled: true, outMaterialId: ZR, ...forest }, sale: { buyerId: NDL, price: "1", priceUnit: "MP" } });
    expect(role.body.details).toEqual([{ field: "sale.buyerId", message: "„Nadleśnictwo Rudziniec TCH” nie jest odbiorcą" }]);
    const drv = (await mgr.post("/catalog/drivers", { name: "Kierowca TCH" })).body.row.id;
    const veh = (await mgr.post("/catalog/vehicles", { name: "Scania", registration: "TCH 101", warehouseId: WH, defaultDriverId: drv })).body.row.id;
    const wb = await post({ type: "PURCHASE", partnerId: NDL, materialId: DRW, qty: "10", unit: "M3", price: "100", production: { enabled: true, outMaterialId: ZR, source: "FOREST", forestDistrict: "R", forestry: "K" },
      transport: { mode: "OWN", place: "Las", runs: [{ ownership: "OWN", vehicleId: veh, km: "30" }] } });
    expect(wb.body.details.map((d: { field: string }) => d.field)).toEqual(["transport.runs.0.waybillNo"]);
    const ok = await post({ type: "PURCHASE", partnerId: NDL, materialId: DRW, qty: "10", unit: "M3", price: "100", production: { enabled: true, outMaterialId: ZR, source: "FOREST", forestDistrict: "R", forestry: "K" },
      transport: { mode: "OWN", place: "Las", runs: [{ ownership: "OWN", vehicleId: veh, km: "30", waybillNo: "KW 8", waybillM3: "10" }] } });
    expect(ok.status).toBe(201);
    expect(ok.body.operation.transport.runs[0]).toMatchObject({ waybillNo: "KW 8", waybillM3: "10", qty: "40", unit: "MP" });
    expect(await bal(ZR)).toBe("40");
  });
});

describe("sprzedaż bezpośrednia", () => {
  it("produkcja w lesie 120 MP, WZ 100 MP; reszta 20 MP na stan; operacja typu SALE z produkcją DIRECT; WZ w rejestrze", async () => {
    const r = await post({ type: "DIRECT_SALE", rawMaterialId: DRW, rawCost: "3000",
      production: { outMaterialId: ZR, outQty: "120", source: "INVESTMENT", investSite: "DK88 Zabrze" }, sale: { buyerId: EC, qty: "100", price: "90", priceUnit: "MP" },
      numbering: { mode: "MANUAL", number: "WZ-BEZP 1" } });
    expect(r.status).toBe(201);
    const op = r.body.operation;
    expect(op.type).toBe("SALE");
    expect(op.documents.map((d: { type: string; number: string }) => [d.type, d.number])).toEqual([["PW", expect.stringMatching(/^PW\//)], ["WZ", "WZ-BEZP 1"]]);
    expect(op.production).toMatchObject({ mode: "DIRECT", outQty: "120", consumeQty: "30", investSite: "DK88 Zabrze" });
    expect(op.totals).toMatchObject({ purchaseCost: "3000", revenue: "9000" });
    expect(await bal(ZR)).toBe("60");      // 40 z poprzedniego testu + 20 reszty
    expect(await bal(DRW)).toBe("0");      // surowiec nie ze stanu
    const reg = await mgr.get(`/documents?warehouseId=${WH}&q=WZ-BEZP`);
    expect(reg.body.rows).toEqual([expect.objectContaining({ type: "WZ", number: "WZ-BEZP 1", operationType: "SALE" })]);
  });
  it("brak ilości produkcji, odbiorcy i jednostki ceny — wszystkie błędy naraz", async () => {
    const r = await post({ type: "DIRECT_SALE", rawMaterialId: DRW, production: { outMaterialId: ZR, outQty: "", source: "OTHER" }, sale: { buyerId: "", price: "1", priceUnit: null } });
    expect(r.status).toBe(400);
    expect(r.body.details.map((d: { field: string }) => d.field)).toEqual(["production.outQty", "sale.buyerId", "sale.priceUnit"]);
  });
  it("spójność: saldo = suma ruchów", async () => {
    for (const m of [DRW, ZR]) {
      const s = await F.db.stockMovement.aggregate({ where: { warehouseId: WH, materialId: m }, _sum: { qty: true } });
      expect(s._sum.qty?.toString() ?? "0").toBe(await bal(m));
    }
  });
});
