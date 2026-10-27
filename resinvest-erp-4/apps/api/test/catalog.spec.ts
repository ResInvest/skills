import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { client, fixture, type Client } from "./fixtures.js";

/** F4a — kartoteki: walidacja serwera, uprawnienia, wersje, audyt, „użyte → tylko dezaktywacja”, izolacja floty. */
let app: INestApplication;
let F: Awaited<ReturnType<typeof fixture>>;
let admin: Client, mgr: Client, mag: Client, view: Client;

beforeAll(async () => {
  app = await createTestApp(); F = await fixture(app, "cat");
  admin = client(app); mgr = client(app); mag = client(app); view = client(app);
  await admin.login(F.users.admin.email); await mgr.login(F.users.mgr.email); await mag.login(F.users.mag.email); await view.login(F.users.view.email);
});
afterAll(async () => { await app.close(); });

describe("materiały", () => {
  let id = "", version = 0;
  it("dodanie: kod normalizowany, jednostka magazynowa dopisana do dozwolonych; uprawnienie master.edit", async () => {
    expect((await view.post("/catalog/materials", { code: "x", name: "X", category: "CHIPS", stockUnit: "MP", allowedUnits: ["MP"] })).status).toBe(403);
    expect((await mag.post("/catalog/materials", { code: "x", name: "X", category: "CHIPS", stockUnit: "MP", allowedUnits: ["MP"] })).status).toBe(403);
    const r = await mgr.post("/catalog/materials", { code: " zr-test ", name: "Zrębka testowa", category: "CHIPS", stockUnit: "MP", allowedUnits: ["T"], tonPerUnit: "0,31" });
    expect(r.status).toBe(201);
    expect(r.body.row).toMatchObject({ code: "ZR-TEST", stockUnit: "MP", allowedUnits: ["MP", "T"], tonPerUnit: "0.31", active: true, version: 1 });
    id = r.body.row.id; version = r.body.row.version;
    expect(await F.db.auditLog.count({ where: { action: "CATALOG_CREATED", entityId: id } })).toBe(1);
  });
  it("walidacja: duplikat kodu i nazwy (bez względu na wielkość liter), zły kod, przelicznik ≤ 0, tony bez gęstości", async () => {
    const dup = await mgr.post("/catalog/materials", { code: "ZR-TEST", name: "zrębka TESTOWA", category: "CHIPS", stockUnit: "MP", allowedUnits: ["MP"] });
    expect(dup.status).toBe(400); expect(dup.body.details.map((d: { field: string }) => d.field)).toEqual(["code", "name"]);
    expect((await mgr.post("/catalog/materials", { code: "-x", name: "A", category: "CHIPS", stockUnit: "MP", allowedUnits: ["MP"] })).body.details[0].field).toBe("code");
    expect((await mgr.post("/catalog/materials", { code: "AB", name: "A", category: "CHIPS", stockUnit: "MP", allowedUnits: ["MP"], mpPerM3: "0" })).body.details[0].field).toBe("mpPerM3");
    expect((await mgr.post("/catalog/materials", { code: "AC", name: "B", category: "TONNAGE", stockUnit: "T", allowedUnits: ["T", "M3"] })).body.details[0].field).toBe("tonPerM3");
  });
  it("edycja częściowa: pominięte pola zachowują wartości; konflikt wersji; audyt tylko zmienionych pól", async () => {
    const r = await mgr.patch(`/catalog/materials/${id}`, { version, name: "Zrębka testowa B" });
    expect(r.status).toBe(200);
    expect(r.body.row).toMatchObject({ name: "Zrębka testowa B", code: "ZR-TEST", tonPerUnit: "0.31", active: true, version: 2 });
    expect((await mgr.patch(`/catalog/materials/${id}`, { version, name: "Stare" })).body.code).toBe("VERSION_CONFLICT");
    const a = await F.db.auditLog.findFirstOrThrow({ where: { action: "CATALOG_UPDATED", entityId: id } });
    expect(a.before).toEqual({ name: "Zrębka testowa" }); expect(a.after).toEqual({ name: "Zrębka testowa B" });
    version = 2;
  });
  it("materiał ze stanem: nie można zmienić jednostki magazynowej, dezaktywować ani usunąć", async () => {
    // magazyn Rokitki — Zabrze i Brąszewice służą testom bilansu otwarcia (bilans musi być pierwszym ruchem magazynu)
    const op = await F.db.operation.create({ data: { type: "PURCHASE", warehouseId: F.wh.ROK!, operationDate: new Date(), idempotencyKey: `t:${randomUUID()}`, createdById: F.users.admin.id } });
    await F.db.stockMovement.create({ data: { warehouseId: F.wh.ROK!, materialId: id, operationId: op.id, kind: "PURCHASE", qty: "10", movementDate: new Date(), createdById: F.users.admin.id } });
    await F.db.stockBalance.create({ data: { warehouseId: F.wh.ROK!, materialId: id, qty: "10" } });
    const unit = await mgr.patch(`/catalog/materials/${id}`, { version, stockUnit: "M3", allowedUnits: ["M3", "MP"] });
    expect(unit.body.details[0]).toMatchObject({ field: "stockUnit" });
    const off = await mgr.patch(`/catalog/materials/${id}`, { version, active: false });
    expect(off.body.details[0].message).toMatch(/ma stan 10 w magazynie RiC Rokitki/);
    const del = await admin.del(`/catalog/materials/${id}?version=${version}`);
    expect(del.status).toBe(409); expect(del.body.code).toBe("IN_USE");
  });
  it("nieużyty materiał można usunąć (audyt)", async () => {
    const r = await mgr.post("/catalog/materials", { code: "TMP-1", name: "Tymczasowy", category: "OTHER", stockUnit: "T", allowedUnits: ["T"] });
    expect((await mgr.del(`/catalog/materials/${r.body.row.id}?version=1`)).status).toBe(200);
    expect(await F.db.material.findUnique({ where: { id: r.body.row.id } })).toBeNull();
    expect(await F.db.auditLog.count({ where: { action: "CATALOG_DELETED", entityId: r.body.row.id } })).toBe(1);
  });
});

describe("kontrahenci", () => {
  it("NIP z sumą kontrolną (normalizacja), duplikat NIP, rola wymagana, leśnictwa bez powtórzeń", async () => {
    const r = await mgr.post("/catalog/partners", { name: "Lander Agro", nip: "PL 526-000-12-46", role: "SUPPLIER", forestries: ["Stanica", "Stanica", "Kuźnia"] });
    expect(r.status).toBe(201);
    expect(r.body.row).toMatchObject({ nip: "5260001246", forestries: ["Stanica", "Kuźnia"], kind: "COMPANY", createdById: F.users.mgr.id });
    expect((await mgr.post("/catalog/partners", { name: "Inny", nip: "5260001247", role: "BUYER" })).body.details[0]).toMatchObject({ field: "nip" });
    expect((await mgr.post("/catalog/partners", { name: "Inny", nip: "5260001246", role: "BUYER" })).body.details[0].message).toMatch(/Lander Agro/);
    expect((await mgr.post("/catalog/partners", { name: "Bez roli" })).status).toBe(400);
  });
});

describe("flota: firmy, kierowcy, operatorzy, pojazdy, rębaki (fleet.edit, izolacja magazynów)", () => {
  let ext = "", drv = "", opr = "";
  it("firma zewnętrzna, kierowca, operator", async () => {
    ext = (await mgr.post("/catalog/external-companies", { name: "Usługi Leśne Drwal", kind: "CHIPPING", nip: "5260001246" })).body.row.id;
    drv = (await mgr.post("/catalog/drivers", { name: "Jan Kowalski", phone: "600 100 200" })).body.row.id;
    opr = (await mgr.post("/catalog/operators", { name: "Piotr Mazur" })).body.row.id;
    expect([ext, drv, opr].every(Boolean)).toBe(true);
    expect((await mag.post("/catalog/drivers", { name: "X" })).status).toBe(403);
  });
  it("pojazd: rejestracja normalizowana i unikalna; obcy wymaga firmy; kierownik — tylko swój magazyn, nie wspólny", async () => {
    const v = await mgr.post("/catalog/vehicles", { name: "Scania R450", registration: "sgl  4t821", warehouseId: F.wh.ZAB, defaultDriverId: drv });
    expect(v.status).toBe(201); expect(v.body.row).toMatchObject({ registration: "SGL 4T821", ownership: "OWN", status: "ACTIVE" });
    expect((await mgr.post("/catalog/vehicles", { name: "Inny", registration: "SGL 4T821", warehouseId: F.wh.ZAB })).body.details[0].field).toBe("registration");
    expect((await mgr.post("/catalog/vehicles", { name: "Obcy", registration: "SK 12345", ownership: "EXTERNAL", warehouseId: F.wh.ZAB })).body.details[0].field).toBe("externalCompanyId");
    expect((await mgr.post("/catalog/vehicles", { name: "Rokitki", registration: "SK 1", warehouseId: F.wh.ROK })).status).toBe(403);
    expect((await mgr.post("/catalog/vehicles", { name: "Wspólny", registration: "SK 2" })).body.details[0].field).toBe("warehouseId");
    expect((await admin.post("/catalog/vehicles", { name: "Wspólny", registration: "SK 2" })).status).toBe(201);
    const rok = await admin.post("/catalog/vehicles", { name: "Rokitki", registration: "ROK 1", warehouseId: F.wh.ROK });
    const list = (await mgr.get("/catalog/vehicles")).body.rows.map((r: { registration: string }) => r.registration);
    expect(list).toContain("SGL 4T821"); expect(list).toContain("SK 2"); expect(list).not.toContain("ROK 1");
    expect((await mgr.patch(`/catalog/vehicles/${rok.body.row.id}`, { version: 1, name: "X" })).status).toBe(403);
  });
  it("rębak zewnętrzny: firma wymagana, operator z floty wyczyszczony, operator opisowo; własny bez firmy", async () => {
    const e = await mgr.post("/catalog/chippers", { name: "Bandit 2590XP", ownership: "EXTERNAL", externalCompanyId: ext, operatorId: opr, externalOperator: "Zbigniew Kos", registration: "sgl 7z412", warehouseId: F.wh.ZAB });
    expect(e.status).toBe(201);
    expect(e.body.row).toMatchObject({ ownership: "EXTERNAL", externalCompanyId: ext, operatorId: null, externalOperator: "Zbigniew Kos", registration: "SGL 7Z412" });
    const o = await mgr.post("/catalog/chippers", { name: "Albach 2000", ownership: "OWN", externalCompanyId: ext, externalOperator: "x", operatorId: opr, warehouseId: F.wh.ZAB });
    expect(o.body.row).toMatchObject({ externalCompanyId: null, externalOperator: null, operatorId: opr });
    expect((await mgr.post("/catalog/chippers", { name: "Bez firmy", ownership: "EXTERNAL", warehouseId: F.wh.ZAB })).body.details[0].field).toBe("externalCompanyId");
  });
  it("powiązania w kartotekach blokują usunięcie: kierowca domyślny pojazdu, operator rębaka, firma z rębakiem", async () => {
    expect((await mgr.del(`/catalog/drivers/${drv}?version=1`)).body.code).toBe("IN_USE");
    expect((await mgr.del(`/catalog/operators/${opr}?version=1`)).body.code).toBe("IN_USE");
    expect((await mgr.del(`/catalog/external-companies/${ext}?version=1`)).body.code).toBe("IN_USE");
  });
  it("wycofanie pojazdu (status RETIRED) i filtr aktywnych", async () => {
    const v = (await mgr.get("/catalog/vehicles")).body.rows.find((r: { registration: string }) => r.registration === "SGL 4T821");
    expect((await mgr.patch(`/catalog/vehicles/${v.id}`, { version: v.version, status: "RETIRED" })).body.row.status).toBe("RETIRED");
    expect((await mgr.get("/catalog/vehicles?active=1")).body.rows.some((r: { id: string }) => r.id === v.id)).toBe(false);
    expect((await mgr.get("/catalog/vehicles?active=0")).body.rows.some((r: { id: string }) => r.id === v.id)).toBe(true);
  });
});

describe("rodzaje operacji dodatkowych i błędy ogólne", () => {
  it("stawka ≥ 0 zapisywana z dokładnością do grosza; duplikat nazwy", async () => {
    const r = await mgr.post("/catalog/additional-operation-types", { name: "Ważenie kontrolne", unit: "szt.", defaultRate: "120,5" });
    expect(r.body.row).toMatchObject({ defaultRate: "120.5", unit: "szt." });
    expect((await mgr.post("/catalog/additional-operation-types", { name: "ważenie KONTROLNE" })).body.details[0].field).toBe("name");
    expect((await mgr.post("/catalog/additional-operation-types", { name: "Z", defaultRate: "-1" })).body.details[0].field).toBe("defaultRate");
  });
  it("nieznana kartoteka — 404; odczyt dla obserwatora", async () => {
    expect((await admin.get("/catalog/users")).status).toBe(404);
    expect((await view.get("/catalog/partners")).status).toBe(200);
  });
});
