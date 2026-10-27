import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { client, fixture, type Client } from "./fixtures.js";
import { todayWarsaw } from "../src/opening/opening.service.js";
import { MailService } from "../src/mail/mail.service.js";
import type { MailTransport } from "../src/mail/transports.js";

/**
 * F7 — powiadomienia e-mail na prawdziwej bazie (magazyn „TNA”): zgoda administratora i wybór użytkownika, odbiorcy
 * (dostęp do magazynu, bez autora), treść, awaria serwera poczty (operacja zapisana, wiadomość FAILED z ponowieniem
 * po czasie), porzucenie (DEAD), ponowienie przez administratora, wiadomość testowa, korekta i usunięcie, uprawnienia.
 */
let app: INestApplication;
let F: Awaited<ReturnType<typeof fixture>>;
let admin: Client, mgr: Client, mag: Client;
let W = "", DRW = "", SUP = "", BUY = "", MAG_EMAIL = "";
let mail: MailService;
const today = todayWarsaw();
const key = () => `n-${randomUUID()}`;
const sent: string[] = [];
const ok: MailTransport = { name: "smtp", send: async m => { sent.push(m.to); return `id-${sent.length}`; } };
const down: MailTransport = { name: "smtp", send: async () => { throw new Error("SMTP 421 4.3.2 Service not available"); } };
const post = (op: object) => mgr.post("/operations", { idempotencyKey: key(), operation: { warehouseId: W, date: today, ...op } });
const mails = (to: string) => F.db.mailOutbox.findMany({ where: { toAddress: to, template: "notification" }, orderBy: { createdAt: "asc" } });
const allow = (events: Record<string, boolean>) => admin.put(`/users/${F.users.mag.id}/notifications`, { changes: events });

beforeAll(async () => {
  app = await createTestApp(); F = await fixture(app, "pow");
  mail = app.get(MailService); mail.transport = ok;
  W = (await F.db.warehouse.upsert({ where: { code: "TNA" }, update: {}, create: { code: "TNA", name: "Magazyn powiadomień" } })).id;
  await F.db.userWarehouse.createMany({ data: [{ userId: F.users.mgr.id, warehouseId: W }, { userId: F.users.mag.id, warehouseId: W }] });
  admin = client(app); mgr = client(app); mag = client(app);
  await admin.login(F.users.admin.email); await mgr.login(F.users.mgr.email); await mag.login(F.users.mag.email);
  MAG_EMAIL = F.users.mag.email;
  DRW = (await F.db.material.findFirstOrThrow({ where: { code: "DRW-O" } })).id;
  SUP = (await mgr.post("/catalog/partners", { name: "Dostawca powiadomień", role: "SUPPLIER" })).body.row.id;
  BUY = (await mgr.post("/catalog/partners", { name: "Odbiorca powiadomień", role: "BUYER" })).body.row.id;
});
afterAll(async () => { await app.close(); });

describe("ustawienia", () => {
  it("bez zgody administratora użytkownik nie włączy powiadomienia; administrator zezwala (audyt); użytkownik włącza", async () => {
    const s = await mag.get("/account/notifications");
    expect(s.body.settings).toHaveLength(7);
    expect(s.body.settings.every((x: { enabled: boolean; allowed: boolean }) => !x.enabled && !x.allowed)).toBe(true);
    const no = await mag.put("/account/notifications", { changes: { PZ_CREATED: true } });
    expect(no.status).toBe(400); expect(no.body.code).toBe("NOT_ALLOWED");
    expect((await mag.put(`/users/${F.users.mag.id}/notifications`, { changes: { PZ_CREATED: true } })).status).toBe(403);
    const a = await allow({ PZ_CREATED: true, WZ_CREATED: true, CORRECTION: true, DOCUMENT_DELETED: true });
    expect(a.status).toBe(200);
    expect(await F.db.auditLog.count({ where: { action: "NOTIFICATIONS_ALLOWED", entityId: F.users.mag.id } })).toBe(1);
    const on = await mag.put("/account/notifications", { changes: { PZ_CREATED: true, WZ_CREATED: true, CORRECTION: true, DOCUMENT_DELETED: true } });
    expect(on.body.settings.filter((x: { enabled: boolean }) => x.enabled)).toHaveLength(4);
    expect((await mag.put("/account/notifications", { changes: { DOCUMENT_EDITED: true } })).status).toBe(400);   // zarezerwowane, nieoferowane
  });
});

let pzId = "";
describe("wysyłka", () => {
  it("zakup: wiadomość do magazyniera (dostęp do magazynu, zdarzenie włączone), nie do autora; treść z magazynem, kwotą i autorem", async () => {
    const r = await post({ type: "PURCHASE", partnerId: SUP, materialId: DRW, qty: "100", unit: "M3", price: "120" });
    expect(r.status).toBe(201); pzId = r.body.operation.id;
    const m = await mails(MAG_EMAIL);
    expect(m).toHaveLength(1);
    expect(m[0]!.subject).toMatch(/^Przyjęcie \/ zakup \(PZ\): PZ\/\d{3}\//);
    const text = (m[0]!.payload as { text: string }).text;
    expect(text).toContain("Magazyn: Magazyn powiadomień");
    expect(text).toContain("Wartość zakupu: 12000.00 zł");
    expect(text).toContain("Wprowadził: kierownik pow");
    expect(await mails(F.users.mgr.email)).toHaveLength(0);
    expect(await mails(F.users.view.email)).toHaveLength(0);
    await mail.drain();
    expect((await F.db.mailOutbox.findUniqueOrThrow({ where: { id: m[0]!.id } })).status).toBe("SENT");
  });
  it("awaria serwera poczty: sprzedaż zapisana, wiadomość FAILED z błędem i kolejną próbą później; administrator ponawia → SENT", async () => {
    mail.transport = down;
    const r = await post({ type: "SALE", partnerId: BUY, materialId: DRW, qty: "10", unit: "M3", price: "150" });
    expect(r.status).toBe(201);
    expect(await F.db.operation.count({ where: { id: r.body.operation.id, status: "POSTED" } })).toBe(1);
    await mail.drain();
    const [m] = (await mails(MAG_EMAIL)).filter(x => x.subject.startsWith("Wydanie"));
    expect(m).toMatchObject({ status: "FAILED", attempts: 1, lastError: expect.stringContaining("421") });
    expect(m!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    const box = await admin.get("/mail/outbox?status=FAILED");
    expect(box.body.rows.find((x: { id: string }) => x.id === m!.id)).toMatchObject({ retryable: true, lastError: expect.stringContaining("421") });
    expect(box.body.transport).toBe("smtp");
    mail.transport = ok;
    const rt = await admin.post(`/mail/${m!.id}/retry`);
    expect(rt.status).toBe(200); expect(rt.body.mail.status).toBe("SENT");
    expect(await F.db.auditLog.count({ where: { action: "MAIL_RETRIED", entityId: m!.id } })).toBe(1);
  });
  it("porzucenie po wyczerpaniu prób: powiadomienie DEAD z treścią (do ponowienia), zaproszenie DEAD bez treści (link jednorazowy)", async () => {
    mail.transport = down;
    const r = await post({ type: "PURCHASE", partnerId: SUP, materialId: DRW, qty: "5", unit: "M3", price: "100" });
    expect(r.status).toBe(201);
    const m = (await mails(MAG_EMAIL)).at(-1)!;
    await F.db.mailOutbox.update({ where: { id: m.id }, data: { attempts: 5, status: "FAILED", nextAttemptAt: new Date(Date.now() - 1000) } });
    const inv = await F.db.mailOutbox.create({ data: { template: "invite", toAddress: "nowy.pow@resinvest.group", subject: "Zaproszenie", payload: { text: "x", html: "x" }, attempts: 5, status: "FAILED", nextAttemptAt: new Date(Date.now() - 1000) } });
    await mail.drain();
    expect(await F.db.mailOutbox.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "DEAD", payload: expect.objectContaining({ text: expect.any(String) }) });
    expect((await F.db.mailOutbox.findUniqueOrThrow({ where: { id: inv.id } })).payload).toMatchObject({ scrubbed: true });
    mail.transport = ok;
    expect((await admin.post(`/mail/${inv.id}/retry`)).body.code).toBe("NO_CONTENT");
    expect((await admin.post(`/mail/${m.id}/retry`)).body.mail.status).toBe("SENT");
    expect((await admin.post(`/mail/${m.id}/retry`)).body.code).toBe("NOT_RETRYABLE");
  });
  it("korekta i usunięcie: powiadomienia z powodem i zmianami BYŁO → JEST", async () => {
    const c = await mgr.post(`/operations/${pzId}/correction`, { idempotencyKey: key(), version: 1, reason: "zła ilość z kwitu",
      operation: { type: "PURCHASE", warehouseId: W, date: today, partnerId: SUP, materialId: DRW, qty: "95", unit: "M3", price: "120" } });
    expect(c.status).toBe(200);
    const cm = (await mails(MAG_EMAIL)).find(x => x.subject.startsWith("Korekta dokumentu"))!;
    expect((cm.payload as { text: string }).text).toMatch(/Powód: zła ilość z kwitu[\s\S]*PZ — ilość: 100 m³ → 95 m³/);
    const d = await mgr.post(`/operations/${pzId}/delete`, { version: 2, reason: "dokument podwójny" });
    expect(d.status).toBe(409);   // stan 95 + 5 − 10 = 90 m³; usunięcie PZ 95 m³ dałoby −5 — zablokowane, bez powiadomienia
    const s = await mgr.get(`/documents?warehouseId=${W}&type=WZ`);
    const sale = s.body.rows[0].operationId as string;
    expect((await mgr.post(`/operations/${sale}/delete`, { version: 1, reason: "sprzedaż anulowana" })).status).toBe(200);
    const dm = (await mails(MAG_EMAIL)).find(x => x.subject.startsWith("Usunięcie dokumentu"))!;
    expect((dm.payload as { text: string }).text).toContain("Powód: sprzedaż anulowana");
  });
  it("odebranie zgody wyłącza wysyłkę; wiadomość testowa; dziennik i działania tylko dla notifications.manage", async () => {
    await allow({ PZ_CREATED: false });
    expect((await mag.get("/account/notifications")).body.settings.find((x: { event: string }) => x.event === "PZ_CREATED")).toMatchObject({ enabled: false, allowed: false });
    const before = (await mails(MAG_EMAIL)).length;
    expect((await post({ type: "PURCHASE", partnerId: SUP, materialId: DRW, qty: "1", unit: "M3", price: "100" })).status).toBe(201);
    expect(await mails(MAG_EMAIL)).toHaveLength(before);
    const t = await admin.post("/mail/test");
    expect(t.body.mail.status).toBe("SENT");
    expect(sent).toContain(F.users.admin.email);
    for (const [m, u] of [["get", "/mail/outbox"], ["post", "/mail/test"], ["post", "/mail/drain"]] as const) expect((await (m === "get" ? mag.get(u) : mag.post(u))).status).toBe(403);
    expect((await mgr.get("/mail/outbox")).status).toBe(403);
  });
});
