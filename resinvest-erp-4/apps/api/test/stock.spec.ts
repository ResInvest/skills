import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { client, fixture, type Client } from "./fixtures.js";
import { LedgerService } from "../src/stock/ledger.service.js";
import { todayWarsaw } from "../src/opening/opening.service.js";

/**
 * F3 — silnik stanów: bilans otwarcia (szkic → zatwierdzenie), salda, karta materiału, księgowanie z blokadą,
 * brak stanu ujemnego przy równoczesnej sprzedaży, kolejność blokad bez zakleszczeń, niezmienność ruchów.
 */
let app: INestApplication;
let F: Awaited<ReturnType<typeof fixture>>;
let admin: Client, mgr: Client, mag: Client, view: Client;
let M: Record<string, string>;
let ledger: LedgerService;

beforeAll(async () => {
  app = await createTestApp(); F = await fixture(app, "stk");
  admin = client(app); mgr = client(app); mag = client(app); view = client(app);
  await admin.login(F.users.admin.email); await mgr.login(F.users.mgr.email); await mag.login(F.users.mag.email); await view.login(F.users.view.email);
  M = Object.fromEntries((await F.db.material.findMany()).map(m => [m.code, m.id]));
  ledger = app.get(LedgerService);
});
afterAll(async () => { await app.close(); });

const ZAB_LINES = () => [
  { materialId: M["DRW-O"]!, qty: "817", unit: "M3" },
  { materialId: M["ZR-PL"]!, qty: "2 073,25", unit: "M3" }, // = 8 293 MP (1 m³ = 4 MP)
  { materialId: M["PKS"]!, qty: "728", unit: "T" },
];
const bal = async (wh: string | undefined, code: string) => (await F.db.stockBalance.findUnique({ where: { warehouseId_materialId: { warehouseId: wh!, materialId: M[code]! } } }))?.qty.toString() ?? "0";
/** Operacja techniczna do testów księgi (dokumenty sprzedaży powstają w fazie F4). */
const op = (wh: string | undefined) => F.db.operation.create({ data: { type: "SALE", warehouseId: wh!, operationDate: new Date(), idempotencyKey: `test:${randomUUID()}`, createdById: F.users.admin.id } });

describe("bilans otwarcia — obieg szkic → zatwierdzenie", () => {
  let id = "", version = 0;

  it("kartoteka materiałów i puste stany przed bilansem", async () => {
    const r = await view.get("/materials");
    expect(r.status).toBe(200);
    expect(r.body.materials.find((m: { code: string }) => m.code === "ZR-PL")).toMatchObject({ stockUnit: "MP", allowedUnits: ["MP", "M3", "T"] });
    const b = await view.get(`/stock/balances?warehouseId=${F.wh.ZAB}`);
    expect(b.status).toBe(200);
    expect(b.body.opening).toBeNull();
    expect(b.body.balances.every((x: { qty: string }) => x.qty === "0")).toBe(true);
  });

  it("walidacja na serwerze: data z przyszłości, powtórzony materiał, jednostka niedozwolona, brak pozycji", async () => {
    const future = "2999-01-01";
    expect((await mgr.post("/opening-balances", { warehouseId: F.wh.ZAB, effectiveDate: future, lines: ZAB_LINES() })).body).toMatchObject({ code: "VALIDATION", error: expect.stringMatching(/przyszłości/) });
    const dup = await mgr.post("/opening-balances", { warehouseId: F.wh.ZAB, effectiveDate: "2026-08-01", lines: [ZAB_LINES()[0], ZAB_LINES()[0]] });
    expect(dup.status).toBe(400); expect(dup.body.details[0].field).toBe("lines.1.materialId");
    const unit = await mgr.post("/opening-balances", { warehouseId: F.wh.ZAB, effectiveDate: "2026-08-01", lines: [{ materialId: M["PKS"]!, qty: "5", unit: "MP" }] });
    expect(unit.status).toBe(400); expect(unit.body.details[0].field).toBe("lines.0.unit");
    expect((await mgr.post("/opening-balances", { warehouseId: F.wh.ZAB, effectiveDate: "2026-08-01", lines: [] })).status).toBe(400);
  });

  it("uprawnienia i izolacja magazynów: obserwator/magazynier nie wprowadzają; kierownik nie ma dostępu do Rokitek", async () => {
    expect((await view.post("/opening-balances", { warehouseId: F.wh.ZAB, effectiveDate: "2026-08-01", lines: ZAB_LINES() })).status).toBe(403);
    expect((await mag.post("/opening-balances", { warehouseId: F.wh.BRA, effectiveDate: "2026-08-01", lines: ZAB_LINES() })).status).toBe(403);
    const rok = await mgr.post("/opening-balances", { warehouseId: F.wh.ROK, effectiveDate: "2026-08-01", lines: ZAB_LINES() });
    expect(rok.status).toBe(403); expect(rok.body.code).toBe("WAREHOUSE_FORBIDDEN");
    expect((await mgr.get(`/stock/balances?warehouseId=${F.wh.ROK}`)).status).toBe(403);
  });

  it("kierownik zapisuje szkic — ilości przeliczone na jednostkę magazynową; stan bez zmian", async () => {
    const r = await mgr.post("/opening-balances", { warehouseId: F.wh.ZAB, effectiveDate: "2026-08-01", note: "Stan z remanentu 31.07", lines: ZAB_LINES() });
    expect(r.status).toBe(201);
    expect(r.body.batch).toMatchObject({ status: "DRAFT", effectiveDate: "2026-08-01", createdBy: `kierownik stk`, approvedBy: null, version: 1 });
    const chips = r.body.batch.lines.find((l: { code: string }) => l.code === "ZR-PL");
    expect(chips).toMatchObject({ qty: "2073.25", unit: "M3", qtyStock: "8293", stockUnit: "MP" });
    id = r.body.batch.id; version = r.body.batch.version;
    expect(await bal(F.wh.ZAB, "DRW-O")).toBe("0");
  });

  it("edycja szkicu z kontrolą wersji (konflikt przy nieaktualnej wersji)", async () => {
    const lines = ZAB_LINES(); lines[2]!.qty = "730";
    const ok = await mgr.put(`/opening-balances/${id}`, { version, warehouseId: F.wh.ZAB, effectiveDate: "2026-08-01", lines });
    expect(ok.status).toBe(200); expect(ok.body.batch.version).toBe(2);
    const stale = await mgr.put(`/opening-balances/${id}`, { version, warehouseId: F.wh.ZAB, effectiveDate: "2026-08-01", lines: ZAB_LINES() });
    expect(stale.status).toBe(409); expect(stale.body.code).toBe("VERSION_CONFLICT");
    const back = await mgr.put(`/opening-balances/${id}`, { version: 2, warehouseId: F.wh.ZAB, effectiveDate: "2026-08-01", lines: ZAB_LINES() });
    version = back.body.batch.version;
  });

  it("kierownik nie zatwierdza (opening.approve tylko Administrator)", async () => {
    expect((await mgr.post(`/opening-balances/${id}/approve`, { version })).status).toBe(403);
  });

  it("administrator zatwierdza: operacja + dokument BO + ruchy OPENING + salda + audyt — w jednej transakcji", async () => {
    const r = await admin.post(`/opening-balances/${id}/approve`, { version });
    expect(r.status).toBe(200);
    expect(r.body.batch).toMatchObject({ status: "APPROVED", approvedBy: "admin stk", documentNumber: "BO/ZAB/2026" });
    expect(await bal(F.wh.ZAB, "DRW-O")).toBe("817");
    expect(await bal(F.wh.ZAB, "ZR-PL")).toBe("8293");
    expect(await bal(F.wh.ZAB, "PKS")).toBe("728");
    const mv = await F.db.stockMovement.findMany({ where: { warehouseId: F.wh.ZAB } });
    expect(mv).toHaveLength(3); expect(mv.every(m => m.kind === "OPENING")).toBe(true);
    const doc = await F.db.document.findFirstOrThrow({ where: { number: "BO/ZAB/2026" }, include: { lines: true } });
    expect(doc.lines.find(l => l.materialId === M["ZR-PL"]!)).toMatchObject({ unitSource: "M3", unitStock: "MP", conversionSource: "COMPANY_RATE" });
    expect(doc.lines.find(l => l.materialId === M["ZR-PL"]!)!.conversionFactor.toString()).toBe("4");
    expect(await F.db.auditLog.count({ where: { action: "OPENING_BALANCE_APPROVED", entityId: id } })).toBe(1);
    const view_ = await view.get(`/stock/balances?warehouseId=${F.wh.ZAB}`);
    expect(view_.body.opening).toMatchObject({ id });
    expect(view_.body.balances.find((b: { code: string }) => b.code === "ZR-PL")).toMatchObject({ qty: "8293", unit: "MP", movements: 1 });
  });

  it("zatwierdzonego bilansu nie można zmienić, usunąć ani zatwierdzić ponownie; drugi bilans magazynu odrzucony", async () => {
    const b = (await admin.get(`/opening-balances/${id}`)).body.batch;
    expect((await admin.post(`/opening-balances/${id}/approve`, { version: b.version })).body.code).toBe("OPENING_APPROVED");
    expect((await admin.del(`/opening-balances/${id}?version=${b.version}`)).body.code).toBe("OPENING_APPROVED");
    expect((await mgr.post("/opening-balances", { warehouseId: F.wh.ZAB, effectiveDate: "2026-08-01", lines: ZAB_LINES() })).body.code).toBe("OPENING_EXISTS");
  });

  it("szkic można usunąć (z kontrolą wersji) — wpis w audycie", async () => {
    const r = await mgr.post("/opening-balances", { warehouseId: F.wh.BRA, effectiveDate: todayWarsaw(), lines: [{ materialId: M["DRW-O"]!, qty: "1", unit: "M3" }] });
    expect(r.status).toBe(201);
    expect((await mgr.del(`/opening-balances/${r.body.batch.id}?version=${r.body.batch.version}`)).status).toBe(200);
    expect(await F.db.openingBalanceBatch.findUnique({ where: { id: r.body.batch.id } })).toBeNull();
    expect(await F.db.auditLog.count({ where: { action: "OPENING_BALANCE_DRAFT_DELETED", entityId: r.body.batch.id } })).toBe(1);
  });
});

describe("księga ruchów — blokady, brak stanu ujemnego, równoczesność", () => {
  it("karta materiału: ruchy ze stanem przed / po i dokumentem", async () => {
    const r = await view.get(`/stock/movements?warehouseId=${F.wh.ZAB}&materialId=${M["DRW-O"]!}`);
    expect(r.status).toBe(200);
    expect(r.body.balance).toBe("817");
    expect(r.body.movements[0]).toMatchObject({ kind: "OPENING", qty: "817", before: "0", after: "817", document: { type: "BO", number: "BO/ZAB/2026" }, operationType: "OPENING_BALANCE" });
  });

  it("rozchód ponad stan — czytelny błąd jak w 3.x, nic nie zapisane", async () => {
    const o = await op(F.wh.ZAB);
    const before = await F.db.stockMovement.count();
    const err: unknown = await F.db.$transaction(tx => ledger.post(tx, { operationId: o.id, movementDate: new Date(), createdById: F.users.admin.id,
      movements: [{ warehouseId: F.wh.ZAB!, materialId: M["DRW-O"]!, qty: "-1000", kind: "SALE" }] })).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ code: "STOCK_INSUFFICIENT" });
    expect(JSON.stringify((err as { getResponse: () => unknown }).getResponse())).toContain("Brak wystarczającej ilości: Drewno opałowe (RiC Zabrze). Dostępne: 817 m³. Wymagane: 1 000 m³. Brakuje: 183 m³.");
    expect(await F.db.stockMovement.count()).toBe(before);
    expect(await bal(F.wh.ZAB, "DRW-O")).toBe("817");
  });

  it("dwie równoczesne sprzedaże 600 MP przy stanie 1 000 MP: jedna przechodzi, druga odrzucona — stan 400, nigdy ujemny", async () => {
    const wh = F.wh.BRA!, mat = M["ZR-T"]!;
    const o0 = await op(wh);
    await F.db.$transaction(tx => ledger.post(tx, { operationId: o0.id, movementDate: new Date(), createdById: F.users.admin.id, movements: [{ warehouseId: wh, materialId: mat, qty: "1000", kind: "PURCHASE" }] }));
    const [o1, o2] = [await op(wh), await op(wh)];
    const sell = (operationId: string) => F.db.$transaction(async tx => {
      const r = await ledger.post(tx, { operationId, movementDate: new Date(), createdById: F.users.admin.id, movements: [{ warehouseId: wh, materialId: mat, qty: "-600", kind: "SALE" }] });
      await new Promise(res => setTimeout(res, 150)); // transakcja trzyma blokadę — druga musi poczekać
      return r;
    }, { timeout: 15_000 });
    const res = await Promise.allSettled([sell(o1.id), sell(o2.id)]);
    expect(res.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejected = res.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "STOCK_INSUFFICIENT" });
    expect(await bal(wh, "ZR-T")).toBe("400");
    expect(await F.db.stockMovement.count({ where: { warehouseId: wh, materialId: mat, kind: "SALE" } })).toBe(1);
  });

  it("20 równoczesnych rozchodów po 50 przy stanie 400 — dokładnie 8 udanych, saldo = suma ruchów = 0", async () => {
    const wh = F.wh.BRA!, mat = M["ZR-T"]!;
    const ops = await Promise.all(Array.from({ length: 20 }, () => op(wh)));
    const res = await Promise.allSettled(ops.map(o => F.db.$transaction(tx => ledger.post(tx, { operationId: o.id, movementDate: new Date(), createdById: F.users.admin.id,
      movements: [{ warehouseId: wh, materialId: mat, qty: "-50", kind: "SALE" }] }), { timeout: 20_000 })));
    expect(res.filter(r => r.status === "fulfilled")).toHaveLength(8);
    expect(await bal(wh, "ZR-T")).toBe("0");
    const sum = await F.db.stockMovement.aggregate({ where: { warehouseId: wh, materialId: mat }, _sum: { qty: true } });
    expect(sum._sum.qty?.toString()).toBe("0");
  });

  it("krzyżowa kolejność materiałów w dwóch transakcjach — stała kolejność blokad, bez zakleszczenia", async () => {
    const wh = F.wh.BRA!, a = M["DRW-I"]!, b = M["ZR-PI"]!;
    const seed = await op(wh);
    await F.db.$transaction(tx => ledger.post(tx, { operationId: seed.id, movementDate: new Date(), createdById: F.users.admin.id, movements: [{ warehouseId: wh, materialId: a, qty: "100", kind: "PURCHASE" }, { warehouseId: wh, materialId: b, qty: "100", kind: "PURCHASE" }] }));
    const [o1, o2] = [await op(wh), await op(wh)];
    const res = await Promise.allSettled([
      F.db.$transaction(tx => ledger.post(tx, { operationId: o1.id, movementDate: new Date(), createdById: F.users.admin.id, movements: [{ warehouseId: wh, materialId: a, qty: "-10", kind: "CONSUMPTION" }, { warehouseId: wh, materialId: b, qty: "40", kind: "PRODUCTION" }] })),
      F.db.$transaction(tx => ledger.post(tx, { operationId: o2.id, movementDate: new Date(), createdById: F.users.admin.id, movements: [{ warehouseId: wh, materialId: b, qty: "-5", kind: "SALE" }, { warehouseId: wh, materialId: a, qty: "-5", kind: "SALE" }] })),
    ]);
    expect(res.map(r => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await bal(wh, "DRW-I")).toBe("85");
    expect(await bal(wh, "ZR-PI")).toBe("135");
  });

  it("bilans otwarcia po ruchach w magazynie — odrzucony (bilans musi być pierwszym zdarzeniem)", async () => {
    const r = await mgr.post("/opening-balances", { warehouseId: F.wh.BRA, effectiveDate: "2026-08-01", lines: [{ materialId: M["DRW-O"]!, qty: "10", unit: "M3" }] });
    expect(r.status).toBe(201);
    const ap = await admin.post(`/opening-balances/${r.body.batch.id}/approve`, { version: r.body.batch.version });
    expect(ap.status).toBe(409); expect(ap.body.code).toBe("OPENING_AFTER_MOVEMENTS");
    expect((await admin.get(`/opening-balances/${r.body.batch.id}`)).body.batch.status).toBe("DRAFT");
  });

  it("ruchy są niezmienne (UPDATE / DELETE zablokowane w bazie); saldo nie może być ujemne (CHECK)", async () => {
    const m = await F.db.stockMovement.findFirstOrThrow();
    await expect(F.db.$executeRaw`UPDATE "stock_movements" SET "qty" = 1 WHERE "id" = ${m.id}::uuid`).rejects.toThrow(/tylko do dopisywania/);
    await expect(F.db.$executeRaw`DELETE FROM "stock_movements" WHERE "id" = ${m.id}::uuid`).rejects.toThrow(/tylko do dopisywania/);
    await expect(F.db.$executeRaw`UPDATE "stock_balances" SET "qty" = -1 WHERE "warehouse_id" = ${F.wh.ZAB}::uuid AND "material_id" = ${M["PKS"]!}::uuid`).rejects.toThrow(/non_negative/);
  });

  it("saldo każdej pary magazyn × materiał = suma jej ruchów (spójność księgi)", async () => {
    const diff = await F.db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM "stock_balances" b
      LEFT JOIN (SELECT "warehouse_id", "material_id", sum("qty") AS s FROM "stock_movements" GROUP BY 1, 2) m USING ("warehouse_id", "material_id")
      WHERE b."qty" <> coalesce(m.s, 0)`;
    expect(Number(diff[0]!.n)).toBe(0);
  });
});
