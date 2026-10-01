import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { client, fixture, type Client } from "./fixtures.js";
import { todayWarsaw } from "../src/opening/opening.service.js";

/**
 * F5 — zmiany dokumentów na prawdziwej bazie: korekta (BYŁO / JEST, numery bez zmian, odwrócenie + nowe ruchy,
 * idempotencja, wersja, brak zmian, zestaw dokumentów, uprawnienia, brak towaru), usunięcie (odwrócenie ruchów,
 * blokada po wydaniu towaru), MM (korekta w drodze, blokada po przyjęciu, usunięcie przyjętego), zakładki i historia.
 * Własne magazyny „TKA” i „TKB” — testy nie zależą od innych plików.
 */
let app: INestApplication;
let F: Awaited<ReturnType<typeof fixture>>;
let mgr: Client, mag: Client, view: Client;
let A = "", B = "", DRW = "", ZR = "", SUP = "", SUP2 = "", BUY = "";
const today = todayWarsaw();
const key = () => `c-${randomUUID()}`;
const bal = async (wh: string, m: string) => (await F.db.stockBalance.findUnique({ where: { warehouseId_materialId: { warehouseId: wh, materialId: m } } }))?.qty.toString() ?? "0";
const purchase = (o: object = {}) => ({ type: "PURCHASE", warehouseId: A, date: today, partnerId: SUP, materialId: DRW, qty: "100", unit: "M3", price: "120", ...o });
const correct = (c: Client, id: string, version: number, operation: object, reason = "błędna ilość z kwitu wagowego", k = key()) =>
  c.post(`/operations/${id}/correction`, { idempotencyKey: k, version, reason, operation });
const remove = (c: Client, id: string, version: number, reason = "dokument wprowadzony podwójnie") => c.post(`/operations/${id}/delete`, { version, reason });

beforeAll(async () => {
  app = await createTestApp(); F = await fixture(app, "kor");
  A = (await F.db.warehouse.upsert({ where: { code: "TKA" }, update: {}, create: { code: "TKA", name: "Magazyn korekt A" } })).id;
  B = (await F.db.warehouse.upsert({ where: { code: "TKB" }, update: {}, create: { code: "TKB", name: "Magazyn korekt B" } })).id;
  await F.db.userWarehouse.createMany({ data: [{ userId: F.users.mgr.id, warehouseId: A }, { userId: F.users.mgr.id, warehouseId: B }, { userId: F.users.mag.id, warehouseId: A }, { userId: F.users.view.id, warehouseId: A }] });
  mgr = client(app); mag = client(app); view = client(app);
  await mgr.login(F.users.mgr.email); await mag.login(F.users.mag.email); await view.login(F.users.view.email);
  const mats = Object.fromEntries((await F.db.material.findMany()).map(m => [m.code, m.id]));
  DRW = mats["DRW-O"]!; ZR = mats["ZR-PL"]!;
  SUP = (await mgr.post("/catalog/partners", { name: "Nadl. Korekta", role: "SUPPLIER" })).body.row.id;
  SUP2 = (await mgr.post("/catalog/partners", { name: "Nadl. Korekta Druga", role: "SUPPLIER" })).body.row.id;
  BUY = (await mgr.post("/catalog/partners", { name: "Odbiorca Korekta", role: "BUYER" })).body.row.id;
});
afterAll(async () => { await app.close(); });

describe("korekta zakupu", () => {
  let id = "", number = "";
  it("zakup 100 m³ × 120 zł", async () => {
    const r = await mgr.post("/operations", { idempotencyKey: key(), operation: purchase() });
    expect(r.status).toBe(201);
    id = r.body.operation.id; number = r.body.operation.documents[0].number;
    expect(r.body.operation).toMatchObject({ version: 1, corrections: 0, deleted: null, input: expect.objectContaining({ qty: "100" }) });
    expect(await bal(A, DRW)).toBe("100");
  });
  it("podgląd korekty: BYŁO / JEST i stan netto, bez zapisu", async () => {
    const p = await mgr.post(`/operations/${id}/correction/preview`, { version: 1, operation: purchase({ qty: "90", partnerId: SUP2 }) });
    expect(p.status).toBe(200);
    expect(p.body.numbers).toEqual([number]);
    expect(p.body.changes).toEqual(expect.arrayContaining([
      { field: "PZ — kontrahent", before: "Nadl. Korekta", after: "Nadl. Korekta Druga" },
      { field: "PZ — ilość", before: "100 m³", after: "90 m³" },
    ]));
    expect(p.body.steps).toEqual([expect.objectContaining({ before: "100", qty: "-10", after: "90" })]);
    expect(await bal(A, DRW)).toBe("100");
  });
  it("korekta: stan 90, ten sam numer, ruchy dopisane (odwrócenie + nowy), KOR, BYŁO / JEST, audyt", async () => {
    const k = key();
    const r = await correct(mgr, id, 1, purchase({ qty: "90", partnerId: SUP2, notes: "wg kwitu 12/26" }), "błędna ilość z kwitu wagowego", k);
    expect(r.status).toBe(200);
    expect(r.body.operation).toMatchObject({ version: 2, corrections: 1, documents: [expect.objectContaining({ number, partner: expect.objectContaining({ id: SUP2 }) })] });
    expect(await bal(A, DRW)).toBe("90");
    const kinds = (await F.db.stockMovement.findMany({ where: { operationId: id }, orderBy: { seq: "asc" } })).map(m => `${m.kind}:${m.qty.toString()}`);
    expect(kinds).toEqual(["PURCHASE:100", "PURCHASE:90", "REVERSAL:-100"]);   // przychody księgowane przed rozchodami
    const cor = await F.db.correction.findFirstOrThrow({ where: { operationId: id } });
    expect(cor.number).toMatch(/^KOR\/\d{3}\/\d{2}\/\d{4}$/);
    expect(await F.db.auditLog.count({ where: { action: "OPERATION_CORRECTED", entityId: id } })).toBe(1);
    // to samo żądanie ponownie (podwójne kliknięcie) — bez drugiej korekty
    const again = await correct(mgr, id, 1, purchase({ qty: "90", partnerId: SUP2, notes: "wg kwitu 12/26" }), "błędna ilość z kwitu wagowego", k);
    expect(again.status).toBe(200);
    expect(await F.db.correction.count({ where: { operationId: id } })).toBe(1);
    expect(await bal(A, DRW)).toBe("90");
  });
  it("historia zmian: numer korekty, kto, powód, pola było / jest", async () => {
    const h = await mgr.get(`/operations/${id}/history`);
    expect(h.body.corrections).toEqual([expect.objectContaining({ reason: "błędna ilość z kwitu wagowego", createdBy: expect.stringContaining("kierownik"),
      changes: expect.arrayContaining([{ field: "Uwagi", before: null, after: "wg kwitu 12/26" }, { field: "Wartość zakupu", before: "12000,00 zł", after: "10800,00 zł" }]) })]);
  });
  it("nieaktualna wersja — 409; brak zmian — 400; brak powodu — błąd przy polu", async () => {
    expect((await correct(mgr, id, 1, purchase({ qty: "80" }))).body.code).toBe("VERSION_CONFLICT");
    const same = await correct(mgr, id, 2, purchase({ qty: "90", partnerId: SUP2, notes: "wg kwitu 12/26" }));
    expect(same.status).toBe(400); expect(same.body.error).toMatch(/Nic się nie zmieniło/);
    const nr = await correct(mgr, id, 2, purchase({ qty: "80" }), " ");
    expect(nr.body.details[0].field).toBe("reason");
    expect(await bal(A, DRW)).toBe("90");
  });
  it("zmiana zestawu dokumentów (włączenie produkcji) albo rodzaju — odrzucona z wyjaśnieniem", async () => {
    const shape = await correct(mgr, id, 2, purchase({ qty: "90", partnerId: SUP2, production: { enabled: true, outMaterialId: ZR, source: "OTHER" } }));
    expect(shape.status).toBe(400); expect(shape.body.error).toMatch(/zestawu dokumentów/);
    const kind = await correct(mgr, id, 2, { type: "SALE", warehouseId: A, date: today, partnerId: BUY, materialId: DRW, qty: "1", unit: "M3", price: "1" });
    expect(kind.body.error).toMatch(/rodzaju operacji/);
  });
  it("uprawnienia: magazynier i obserwator nie korygują ani nie usuwają", async () => {
    expect((await correct(mag, id, 2, purchase({ qty: "80" }))).status).toBe(403);
    expect((await correct(view, id, 2, purchase({ qty: "80" }))).status).toBe(403);
    expect((await remove(mag, id, 2)).status).toBe(403);
  });

  let sale = "";
  it("po sprzedaży 50 m³ korekta zakupu do 40 m³ i usunięcie zakupu — zablokowane (towar wydany), stan bez zmian", async () => {
    const s = await mgr.post("/operations", { idempotencyKey: key(), operation: { type: "SALE", warehouseId: A, date: today, partnerId: BUY, materialId: DRW, qty: "50", unit: "M3", price: "150" } });
    expect(s.status).toBe(201); sale = s.body.operation.id;
    expect(await bal(A, DRW)).toBe("40");
    const c = await correct(mgr, id, 2, purchase({ qty: "40", partnerId: SUP2 }));
    expect(c.status).toBe(409); expect(c.body.error).toMatch(/^Korekta niemożliwa/);
    const d = await remove(mgr, id, 2);
    expect(d.status).toBe(409); expect(d.body.error).toMatch(/^Nie można usunąć — towar z dokumentu został już wydany/);
    expect(await bal(A, DRW)).toBe("40");
  });
  it("zakładki: korekty i edytowane", async () => {
    const k = await mgr.get(`/documents/changes?warehouseId=${A}&kind=corrections`);
    expect(k.body.rows).toEqual([expect.objectContaining({ operationId: id, documents: [{ type: "PZ", number }], changes: expect.arrayContaining([expect.objectContaining({ field: "PZ — ilość" })]) })]);
    const e = await mgr.get(`/documents/changes?warehouseId=${A}&kind=edited`);
    expect(e.body.rows).toEqual([expect.objectContaining({ operationId: id, corrections: 1, last: expect.objectContaining({ reason: "błędna ilość z kwitu wagowego" }) })]);
    const reg = await mgr.get(`/documents?warehouseId=${A}`);
    expect(reg.body.rows.find((r: { number: string }) => r.number === number)).toMatchObject({ corrections: 1 });
  });
  it("usunięcie: najpierw sprzedaż (stan wraca), potem zakup; numery zostają zajęte, rejestr bez usuniętych, zakładka „Usunięte”", async () => {
    const ds = await remove(mgr, sale, 1, "sprzedaż wprowadzona na złego odbiorcę");
    expect(ds.status).toBe(200); expect(ds.body.operation).toMatchObject({ status: "DELETED", deleted: { reason: "sprzedaż wprowadzona na złego odbiorcę" } });
    expect(await bal(A, DRW)).toBe("90");
    const dp = await remove(mgr, id, 2);
    expect(dp.status).toBe(200);
    expect(await bal(A, DRW)).toBe("0");
    expect((await remove(mgr, id, 3)).body.code).toBe("ALREADY_DELETED");
    expect((await correct(mgr, id, 3, purchase({ qty: "10" }))).body.code).toBe("DELETED");
    const reg = await mgr.get(`/documents?warehouseId=${A}`);
    expect(reg.body.rows.map((r: { number: string }) => r.number)).not.toContain(number);
    const del = await mgr.get(`/documents/changes?warehouseId=${A}&kind=deleted`);
    expect(del.body.rows.map((r: { operationId: string }) => r.operationId).sort()).toEqual([id, sale].sort());
    expect(await F.db.auditLog.count({ where: { action: "OPERATION_DELETED", entityId: { in: [id, sale] } } })).toBe(2);
    const h = await mgr.get(`/operations/${id}/history`);
    expect(h.body.deleted).toMatchObject({ reason: "dokument wprowadzony podwójnie" });
  });
});

describe("korekta i usunięcie MM", () => {
  let id = "";
  it("MM w drodze: korekta 120 → 100 MP zmienia tylko źródło; po przyjęciu korekta zablokowana; usunięcie przyjętego odwraca oba magazyny", async () => {
    await F.db.setting.upsert({ where: { key: "mm.mode" }, update: { value: "two" }, create: { key: "mm.mode", value: "two" } });
    await mgr.post("/operations", { idempotencyKey: key(), operation: { type: "PURCHASE", warehouseId: A, date: today, partnerId: SUP, materialId: ZR, qty: "200", unit: "MP", price: "40" } });
    const mmOp = { type: "TRANSFER", warehouseId: A, targetWarehouseId: B, date: today, materialId: ZR, unit: "MP" };
    const r = await mgr.post("/operations", { idempotencyKey: key(), operation: { ...mmOp, qty: "120" } });
    id = r.body.operation.id;
    expect(await bal(A, ZR)).toBe("80");
    const c = await correct(mgr, id, 1, { ...mmOp, qty: "100" });
    expect(c.status).toBe(200);
    expect([await bal(A, ZR), await bal(B, ZR)]).toEqual(["100", "0"]);
    expect(c.body.operation.transfer.state).toBe("IN_TRANSIT");
    const rc = await mgr.post(`/operations/${id}/receive`, { idempotencyKey: key(), receipt: { qty: "100" } });
    expect(rc.status).toBe(200);
    expect(await bal(B, ZR)).toBe("100");
    expect((await correct(mgr, id, 3, { ...mmOp, qty: "90" })).body.code).toBe("MM_RECEIVED");
    const d = await remove(mgr, id, 3, "przesunięcie anulowane — towar wrócił");
    expect(d.status).toBe(200);
    expect([await bal(A, ZR), await bal(B, ZR)]).toEqual(["200", "0"]);
  });
});
