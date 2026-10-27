import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { client, fixture, type Client } from "./fixtures.js";
import { todayWarsaw } from "../src/opening/opening.service.js";

/**
 * F4b-2b — transport operacji: własny (pojazd + kierowca domyślny z floty, km × stawka), zewnętrzny (firma, fracht kursu),
 * mieszany, kolej, „zapewnia dostawca”; dokument TR z kosztem, zapis kursów, kontrola floty magazynu, brak zapisu przy błędzie.
 * Własny magazyn „TTR” — testy nie zależą od innych plików.
 */
let app: INestApplication;
let F: Awaited<ReturnType<typeof fixture>>;
let mgr: Client;
let WH = "", ZR = "", SUP = "", BUY = "", VEH = "", VEH_BRA = "", DRV = "", CO = "";
const today = todayWarsaw();
const key = () => `t-${randomUUID()}`;
const post = (operation: object) => mgr.post("/operations", { idempotencyKey: key(), operation: { warehouseId: WH, date: today, ...operation } });
const sale = (transport: object, o: object = {}) => post({ type: "SALE", partnerId: BUY, materialId: ZR, qty: "120", unit: "MP", price: "90", transport, ...o });

beforeAll(async () => {
  app = await createTestApp(); F = await fixture(app, "tr");
  WH = (await F.db.warehouse.upsert({ where: { code: "TTR" }, update: {}, create: { code: "TTR", name: "Magazyn testowy transportu" } })).id;
  await F.db.userWarehouse.create({ data: { userId: F.users.mgr.id, warehouseId: WH } });
  mgr = client(app); await mgr.login(F.users.mgr.email);
  ZR = (await F.db.material.findUniqueOrThrow({ where: { code: "ZR-PL" } })).id;
  SUP = (await mgr.post("/catalog/partners", { name: "Dostawca TR", role: "SUPPLIER" })).body.row.id;
  BUY = (await mgr.post("/catalog/partners", { name: "Odbiorca TR", role: "BUYER" })).body.row.id;
  DRV = (await mgr.post("/catalog/drivers", { name: "Kierowca TR" })).body.row.id;
  VEH = (await mgr.post("/catalog/vehicles", { name: "Volvo FH", registration: "TTR 1001", warehouseId: WH, defaultDriverId: DRV })).body.row.id;
  VEH_BRA = (await mgr.post("/catalog/vehicles", { name: "MAN", registration: "TTR 2002", warehouseId: F.wh.BRA })).body.row.id;
  CO = (await mgr.post("/catalog/external-companies", { name: "Przewoźnik TR", kind: "TRANSPORT" })).body.row.id;
  expect((await post({ type: "PURCHASE", partnerId: SUP, materialId: ZR, qty: "1000", unit: "MP", price: "40" })).status).toBe(201);
});
afterAll(async () => { await app.close(); });

describe("transport w operacji", () => {
  it("własny: 2 kursy (kierowca domyślny pojazdu, km × 5 zł), dokument TR, koszt w wyniku operacji, kursy zapisane", async () => {
    const r = await sale({ mode: "OWN", place: "EC Zabrze", runs: [{ ownership: "OWN", vehicleId: VEH, km: "42", qty: "60", weightT: "19,8" }, { ownership: "OWN", vehicleId: VEH, km: "40", qty: "60" }] });
    expect(r.status).toBe(201);
    const op = r.body.operation;
    expect(op.documents.map((d: { type: string }) => d.type)).toEqual(["WZ", "TR"]);
    expect(op.documents[1].number).toMatch(/^TR\/\d{3}\/\d{2}\/\d{4}$/);
    expect(op.totals.transportCost).toBe("410");
    expect(op.transport).toMatchObject({ mode: "OWN", place: "EC Zabrze", cost: "410", runs: [
      { runNo: 1, ownership: "OWN", vehicle: "TTR 1001 · Volvo FH", driver: "Kierowca TR", km: "42", ratePerKm: "5", cost: "210", qty: "60", unit: "MP", weightT: "19.8" },
      { runNo: 2, cost: "200", weightT: null },
    ] });
    const reg = await mgr.get(`/documents?warehouseId=${WH}&type=TR`);
    expect(reg.body.rows[0]).toMatchObject({ type: "TR", value: "410", place: "EC Zabrze" });
  });
  it("zewnętrzny: firma przewozowa i fracht kursu; „wliczony w cenę” = 0 zł", async () => {
    const r = await sale({ mode: "EXTERNAL", place: "Kalisz", externalCompanyId: CO, runs: [{ ownership: "EXTERNAL", registration: "wgm 7712c", driverName: "Adam", freight: "800" }] }, { qty: "10" });
    expect(r.body.operation.transport.runs[0]).toMatchObject({ company: "Przewoźnik TR", registration: "WGM 7712C", driver: "Adam", freight: "800", cost: "800", qty: "10" });
    const inc = await sale({ mode: "EXTERNAL", place: "Kalisz", externalCompanyId: CO, includedInPrice: true, runs: [{ ownership: "EXTERNAL", registration: "WGM 1" }] }, { qty: "10" });
    expect(inc.body.operation.totals.transportCost).toBe("0");
  });
  it("kolej: skład 2 × 33 t, 25 zł/t = 1 650 zł, szczegóły składu w kursie", async () => {
    const r = await sale({ mode: "TRAIN", place: "Bocznica", train: { trainNo: "PKP 4411", carrier: "PKP Cargo", wagonTons: ["33", "33"], priceUnit: "T", price: "25" } }, { qty: "200" });
    expect(r.status).toBe(201);
    expect(r.body.operation.transport).toMatchObject({ mode: "TRAIN", cost: "1650", runs: [{ weightT: "66", train: { trainNo: "PKP 4411", totalT: "66", wagonTons: ["33", "33"] } }] });
  });
  it("„zapewnia dostawca” przy zakupie — bez TR i bez kosztu; przy sprzedaży — błąd przy polu", async () => {
    const p = await post({ type: "PURCHASE", partnerId: SUP, materialId: ZR, qty: "5", unit: "MP", price: "40", transport: { mode: "SUPPLIER", place: "Las" } });
    expect(p.body.operation.documents.map((d: { type: string }) => d.type)).toEqual(["PZ"]);
    expect(p.body.operation.transport).toMatchObject({ mode: "SUPPLIER", cost: "0", runs: [] });
    const s = await sale({ mode: "SUPPLIER", place: "Las" }, { qty: "1" });
    expect(s.status).toBe(400); expect(s.body.details[0].field).toBe("transport.mode");
  });
  it("pojazd z innego magazynu, nieznana firma, brak miejsca — błędy przy polach, nic nie zapisane", async () => {
    const before = await F.db.transportRun.count();
    const r = await sale({ mode: "MIXED", place: "", externalCompanyId: randomUUID(), runs: [
      { ownership: "OWN", vehicleId: VEH_BRA, driverId: DRV, km: "10", qty: "1" }, { ownership: "EXTERNAL", registration: "X 1", freight: "1", qty: "1" }] }, { qty: "2" });
    expect(r.status).toBe(400);
    expect(r.body.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(["transport.place", "transport.externalCompanyId", "transport.runs.0.vehicleId"]));
    expect(r.body.details.find((d: { field: string }) => d.field === "transport.runs.0.vehicleId").message).toMatch(/RiC Brąszewice/);
    expect(await F.db.transportRun.count()).toBe(before);
  });
  it("sprzedaż ponad stan z transportem — odrzucona w całości (bez TR i bez kursów)", async () => {
    const before = await F.db.document.count({ where: { warehouseId: WH, type: "TR" } });
    const r = await sale({ mode: "OWN", place: "X", runs: [{ ownership: "OWN", vehicleId: VEH, km: "5" }] }, { qty: "100000" });
    expect(r.status).toBe(409); expect(r.body.code).toBe("STOCK_INSUFFICIENT");
    expect(await F.db.document.count({ where: { warehouseId: WH, type: "TR" } })).toBe(before);
  });
  it("produkcja na magazynie z transportem — odrzucona; dane formularza zawierają kierowców, firmy i stawkę", async () => {
    const r = await post({ type: "PRODUCTION", rawMaterialId: (await F.db.material.findUniqueOrThrow({ where: { code: "DRW-O" } })).id, outMaterialId: ZR, outQty: "4", transport: { mode: "OWN", place: "X", runs: [] } });
    expect(r.status).toBe(400); expect(r.body.details.map((d: { field: string }) => d.field)).toContain("transport.mode");
    const fd = await mgr.get(`/operations/form-data?warehouseId=${WH}`);
    expect(fd.body).toMatchObject({ kmRateDefault: "5", drivers: expect.arrayContaining([expect.objectContaining({ name: "Kierowca TR" })]),
      companies: expect.arrayContaining([expect.objectContaining({ name: "Przewoźnik TR", kind: "TRANSPORT" })]),
      vehicles: expect.arrayContaining([expect.objectContaining({ registration: "TTR 1001", defaultDriverId: DRV })]) });
    expect(fd.body.vehicles.some((v: { registration: string }) => v.registration === "TTR 2002")).toBe(false);
  });
});
