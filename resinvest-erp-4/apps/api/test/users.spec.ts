import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { client, fixture, type Client } from "./fixtures.js";

let app: INestApplication;
let F: Awaited<ReturnType<typeof fixture>>;
let admin: Client, mgr: Client, mag: Client, view: Client, aud: Client;
beforeAll(async () => {
  app = await createTestApp(); F = await fixture(app, "usr");
  admin = client(app); mgr = client(app); mag = client(app); view = client(app); aud = client(app);
  await admin.login(F.users.admin.email); await mgr.login(F.users.mgr.email); await mag.login(F.users.mag.email);
  await view.login(F.users.view.email); await aud.login(F.users.aud.email);
});
afterAll(async () => { await app.close(); });
const ver = async (id: string) => (await F.db.user.findUniqueOrThrow({ where: { id } })).version;

describe("§34.8–§34.12 role", () => {
  it("§34.8 ADMINISTRATOR — użytkownicy, role, uprawnienia, audyt, wszystkie magazyny", async () => {
    expect((await admin.get("/users")).status).toBe(200);
    expect((await admin.get("/roles")).body.roles.map((r: { code: string }) => r.code)).toEqual(expect.arrayContaining(["ADMINISTRATOR", "MANAGER", "MAGAZYNIER", "OBSERWATOR", "AUDYTOR"]));
    expect((await admin.get("/audit")).status).toBe(200);
    expect((await admin.get("/warehouses")).body.warehouses.length).toBeGreaterThanOrEqual(3);
  });
  it("§34.9 MANAGER — podgląd użytkowników swoich magazynów, bez zarządzania kontami", async () => {
    const list = await mgr.get("/users");
    expect(list.status).toBe(200);
    const emails = list.body.users.map((u: { email: string }) => u.email);
    expect(emails).toContain(F.users.mag.email);
    expect((await mgr.post("/users", { email: "x.usr@resinvest.group", firstName: "X", lastName: "Y", roleCode: "MAGAZYNIER", warehouseIds: [F.wh.ZAB] })).status).toBe(403);
    expect((await mgr.get("/audit")).status).toBe(403);
  });
  it("§34.10–11 MAGAZYNIER i OBSERWATOR — brak dostępu do administracji (403)", async () => {
    for (const c of [mag, view]) {
      expect((await c.get("/users")).status).toBe(403);
      expect((await c.get("/audit")).status).toBe(403);
      expect((await c.put("/roles/MAGAZYNIER/permissions", { version: 1, permissions: ["users.manage"] })).status).toBe(403);
    }
  });
  it("§34.12 AUDYTOR — odczyt audytu i użytkowników, bez zmian", async () => {
    expect((await aud.get("/audit")).status).toBe(200);
    expect((await aud.get("/users")).status).toBe(200);
    expect((await aud.patch(`/users/${F.users.mag.id}`, { version: 1, status: "SUSPENDED" })).status).toBe(403);
  });
});

describe("§34.13–§34.16 magazyny i próby nadużyć", () => {
  it("§34.13 dostęp do magazynów — magazynier widzi tylko przydzielone", async () => {
    const r = await mag.get("/warehouses");
    expect(r.body.warehouses.map((w: { id: string }) => w.id)).toEqual([F.wh.BRA]);
    expect((await mag.post("/auth/me/default-warehouse", { warehouseId: F.wh.ZAB })).status).toBe(404);
    expect((await mag.post("/auth/me/default-warehouse", { warehouseId: F.wh.BRA })).status).toBe(200);
  });
  it("§34.15 / §35.2 nadanie sobie roli ADMINISTRATOR / zmiana własnych magazynów — 403", async () => {
    const r = await admin.patch(`/users/${F.users.admin.id}`, { version: await ver(F.users.admin.id), roleCode: "MAGAZYNIER" });
    expect(r.status).toBe(403);
    expect((await admin.patch(`/users/${F.users.admin.id}`, { version: await ver(F.users.admin.id), status: "SUSPENDED" })).status).toBe(403);
    expect((await mag.patch(`/users/${F.users.mag.id}`, { version: await ver(F.users.mag.id), roleCode: "ADMINISTRATOR" })).status).toBe(403);
  });
  it("§34.16 / §35.1 kierownik z users.manage (bez roles.assign) — tylko swoje magazyny i role podstawowe", async () => {
    await F.db.rolePermission.create({ data: { roleId: F.role.MANAGER!, permissionCode: "users.manage" } });
    try {
      expect((await mgr.post("/users", { email: "adm.usr@resinvest.group", firstName: "A", lastName: "B", roleCode: "ADMINISTRATOR", warehouseIds: [] })).status).toBe(403);
      expect((await mgr.post("/users", { email: "rok.usr@resinvest.group", firstName: "A", lastName: "B", roleCode: "MAGAZYNIER", warehouseIds: [F.wh.ROK] })).status).toBe(403);
      const ok = await mgr.post("/users", { email: "bra.usr@resinvest.group", firstName: "Nowy", lastName: "Brąszewice", roleCode: "MAGAZYNIER", warehouseIds: [F.wh.BRA] });
      expect(ok.status).toBe(201);
      expect((await mgr.patch(`/users/${F.users.admin.id}`, { version: await ver(F.users.admin.id), firstName: "Zmiana" })).status).toBe(403);
      expect((await mgr.patch(`/users/${ok.body.user.id}`, { version: ok.body.user.version, roleCode: "MANAGER" })).status).toBe(403);
    } finally { await F.db.rolePermission.delete({ where: { roleId_permissionCode: { roleId: F.role.MANAGER!, permissionCode: "users.manage" } } }); }
  });
  it("§35.3 dane z przeglądarki nie nadają uprawnień — nadmiarowe pola odrzucone", async () => {
    const r = await admin.patch(`/users/${F.users.mag.id}`, { version: await ver(F.users.mag.id), permissions: ["*"], role_id: "x" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION");
  });
});

describe("edycja kont: role, magazyny, statusy, wersje", () => {
  it("zmiana roli i magazynów — audyt ROLE_CHANGED i WAREHOUSE_ACCESS_CHANGED, sesje osoby wylogowane", async () => {
    const r = await admin.patch(`/users/${F.users.view.id}`, { version: await ver(F.users.view.id), roleCode: "MAGAZYNIER", warehouseIds: [F.wh.ZAB, F.wh.ROK], defaultWarehouseId: F.wh.ROK });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ role: { code: "MAGAZYNIER" }, defaultWarehouseId: F.wh.ROK });
    expect(r.body.user.warehouseIds.sort()).toEqual([F.wh.ZAB, F.wh.ROK].sort());
    expect(await F.db.auditLog.count({ where: { entityId: F.users.view.id, action: { in: ["ROLE_CHANGED", "WAREHOUSE_ACCESS_CHANGED"] } } })).toBe(2);
    expect((await view.get("/auth/me")).status).toBe(401);
    await view.login(F.users.view.email);
  });
  it("magazyn domyślny spoza przydzielonych i nieistniejący magazyn — błąd", async () => {
    expect((await admin.patch(`/users/${F.users.mag.id}`, { version: await ver(F.users.mag.id), warehouseIds: [F.wh.BRA], defaultWarehouseId: F.wh.ZAB })).body.code).toBe("WAREHOUSE");
    expect((await admin.patch(`/users/${F.users.mag.id}`, { version: await ver(F.users.mag.id), warehouseIds: ["00000000-0000-7000-8000-000000000000"] })).body.code).toBe("WAREHOUSE");
    expect((await admin.patch(`/users/${F.users.mag.id}`, { version: await ver(F.users.mag.id), warehouseIds: [] })).body.code).toBe("WAREHOUSE");
  });
  it("równoczesna edycja — nieaktualna wersja odrzucona (409 VERSION)", async () => {
    const v = await ver(F.users.mag.id);
    expect((await admin.patch(`/users/${F.users.mag.id}`, { version: v, firstName: "Paweł" })).status).toBe(200);
    const stale = await admin.patch(`/users/${F.users.mag.id}`, { version: v, firstName: "Piotr" });
    expect(stale.status).toBe(409); expect(stale.body.code).toBe("VERSION");
  });
  it("wyłączenie konta — sesje wylogowane, logowanie niemożliwe, powiadomienie e-mail; historia zostaje", async () => {
    const r = await admin.patch(`/users/${F.users.aud.id}`, { version: await ver(F.users.aud.id), status: "DISABLED" });
    expect(r.status).toBe(200);
    expect((await aud.get("/auth/me")).status).toBe(401);
    expect((await client(app).login(F.users.aud.email)).body.code).toBe("INACTIVE");
    expect(await F.db.mailOutbox.count({ where: { toAddress: F.users.aud.email, template: "account-disabled" } })).toBe(1);
    expect(await F.db.user.count({ where: { id: F.users.aud.id } })).toBe(1);
    await admin.patch(`/users/${F.users.aud.id}`, { version: await ver(F.users.aud.id), status: "ACTIVE" });
  });
  it("sesje wskazanej osoby — podgląd i zdalne wylogowanie przez administratora", async () => {
    const list = await admin.get(`/users/${F.users.mgr.id}/sessions`);
    expect(list.body.sessions.length).toBeGreaterThan(0);
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash/);
    expect((await admin.del(`/users/${F.users.mgr.id}/sessions`)).body.revoked).toBeGreaterThan(0);
    expect((await mgr.get("/auth/me")).status).toBe(401);
    await mgr.login(F.users.mgr.email);
  });
});

describe("§34.17 / §35.5 ostatni aktywny administrator", () => {
  it("dwóch administratorów zawiesza się nawzajem w tej samej chwili — zostaje dokładnie jeden aktywny", async () => {
    const hash = (await F.db.user.findUniqueOrThrow({ where: { id: F.users.admin.id } })).passwordHash;
    const others = await F.db.user.findMany({ where: { status: "ACTIVE", role: { code: "ADMINISTRATOR" } } });
    await F.db.user.updateMany({ where: { id: { in: others.map(o => o.id) } }, data: { status: "SUSPENDED" } });
    const mk = (n: string) => F.db.user.create({ data: { email: `${n}.lastadmin.usr@resinvest.group`, firstName: n, lastName: "Admin", roleId: F.role.ADMINISTRATOR!, status: "ACTIVE", passwordHash: hash } });
    const A = await mk("alfa"), B = await mk("beta");
    try {
      const ca = client(app), cb = client(app);
      await ca.login(A.email); await cb.login(B.email);
      const [ra, rb] = await Promise.all([
        ca.patch(`/users/${B.id}`, { version: B.version, status: "SUSPENDED" }),
        cb.patch(`/users/${A.id}`, { version: A.version, status: "SUSPENDED" }),
      ]);
      const codes = [ra.status, rb.status].sort();
      expect(codes[0]).toBe(200);
      expect([401, 409]).toContain(codes[1]);
      expect(await F.db.user.count({ where: { id: { in: [A.id, B.id] }, status: "ACTIVE" } })).toBe(1);
      // pozostały administrator nie zmieni własnej roli ani statusu
      const alive = ra.status === 200 ? { c: ca, u: A } : { c: cb, u: B };
      expect((await alive.c.patch(`/users/${alive.u.id}`, { version: await ver(alive.u.id), status: "DISABLED" })).status).toBe(403);
    } finally {
      await F.db.user.updateMany({ where: { id: { in: [A.id, B.id] } }, data: { status: "DISABLED" } });
      await F.db.user.updateMany({ where: { id: { in: others.map(o => o.id) } }, data: { status: "ACTIVE" } });
    }
  });
  it("kontrola w serwisie: degradacja jedynego aktywnego administratora — 409 LAST_ADMIN", async () => {
    const { UsersService } = await import("../src/users/users.service.js");
    const svc = app.get(UsersService);
    const others = await F.db.user.findMany({ where: { status: "ACTIVE", role: { code: "ADMINISTRATOR" }, id: { not: F.users.admin.id } } });
    await F.db.user.updateMany({ where: { id: { in: others.map(o => o.id) } }, data: { status: "SUSPENDED" } });
    // „stary” kontekst drugiego administratora (np. żądanie w toku) — serwis sprawdza stan bazy, nie kontekst
    const ghost = { id: "00000000-0000-7000-8000-000000000001", email: "duch@resinvest.group", firstName: "D", lastName: "A", status: "ACTIVE" as const, roleCode: "ADMINISTRATOR", roleName: "Administrator",
      global: true, permissions: new Set(["users.manage", "roles.assign"]), warehouseIds: [], defaultWarehouseId: null, mustChangePassword: false, sessionId: "s", version: 1 };
    try {
      await expect(svc.update(ghost, F.users.admin.id, { version: await ver(F.users.admin.id), roleCode: "MANAGER", warehouseIds: [F.wh.ZAB!] }, { ip: null, userAgent: null, requestId: null })).rejects.toMatchObject({ code: "LAST_ADMIN" });
      expect((await F.db.user.findUniqueOrThrow({ where: { id: F.users.admin.id }, include: { role: true } })).role.code).toBe("ADMINISTRATOR");
    } finally { await F.db.user.updateMany({ where: { id: { in: others.map(o => o.id) } }, data: { status: "ACTIVE" } }); }
  });
});

describe("role i uprawnienia", () => {
  it("edycja zestawu uprawnień roli (roles.assign) z wersją i audytem; ADMINISTRATOR i nieznane uprawnienia odrzucone", async () => {
    const roles = (await admin.get("/roles")).body.roles as { code: string; version: number; permissions: string[] }[];
    const obs = roles.find(r => r.code === "OBSERWATOR")!;
    const next = [...obs.permissions, "reports.export"];
    expect((await admin.put("/roles/OBSERWATOR/permissions", { version: obs.version, permissions: next })).status).toBe(200);
    expect((await admin.put("/roles/OBSERWATOR/permissions", { version: obs.version, permissions: obs.permissions })).body.code).toBe("VERSION");
    expect((await admin.put("/roles/ADMINISTRATOR/permissions", { version: 1, permissions: [] })).status).toBe(403);
    expect((await admin.put("/roles/OBSERWATOR/permissions", { version: obs.version + 1, permissions: ["nie.ma"] })).body.code).toBe("PERMISSION");
    expect((await view.get("/auth/me")).body.user?.permissions ?? []).toBeDefined();
    const a = await F.db.auditLog.findFirst({ where: { action: "ROLE_PERMISSIONS_CHANGED", entityId: "OBSERWATOR" }, orderBy: { id: "desc" } });
    expect((a?.after as { uprawnienia: string[] }).uprawnienia).toContain("reports.export");
    await admin.put("/roles/OBSERWATOR/permissions", { version: obs.version + 1, permissions: obs.permissions });
  });
});

describe("kolejka poczty", () => {
  it("wysyłka do pliku .eml, treść z linkiem usunięta z bazy po wysłaniu", async () => {
    const n = await F.mail.drain(200);
    expect(n).toBeGreaterThan(0);
    const sent = await F.db.mailOutbox.findFirst({ where: { status: "SENT", template: "invite" }, orderBy: { sentAt: "desc" } });
    expect(sent?.providerId).toMatch(/\.eml$/);
    expect(JSON.stringify(sent?.payload)).not.toMatch(/token=/);
    const eml = await readFile(sent!.providerId!, "utf8");
    expect(eml).toMatch(/Subject: =\?UTF-8\?B\?/);
  });
  it("błąd serwera poczty nie cofa operacji — wiadomość FAILED z ponowieniem", async () => {
    const original = F.mail.transport;
    F.mail.transport = { name: "broken", send: async () => { throw new Error("SMTP 421 niedostępny"); } };
    try {
      const r = await admin.post("/users", { email: "poczta.usr@resinvest.group", firstName: "Po", lastName: "Czta", roleCode: "OBSERWATOR", warehouseIds: [F.wh.ZAB] });
      expect(r.status).toBe(201);
      await F.mail.drain(50);
      const m = await F.db.mailOutbox.findFirstOrThrow({ where: { toAddress: "poczta.usr@resinvest.group" } });
      expect(m).toMatchObject({ status: "FAILED", attempts: 1 });
      expect(m.lastError).toMatch(/SMTP 421/);
      expect(m.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      expect(await F.db.user.count({ where: { email: "poczta.usr@resinvest.group", status: "INVITED" } })).toBe(1);
      expect((await admin.post(`/users/${r.body.user.id}/resend-invite`)).status).toBe(200);
    } finally { F.mail.transport = original; }
  });
});

describe("dziennik audytu", () => {
  it("filtry, stronicowanie, dziennik logowań; brak możliwości usunięcia wpisów przez API", async () => {
    const r = await admin.get("/audit?action=USER_INVITED&pageSize=10");
    expect(r.body.total).toBeGreaterThan(0);
    expect(r.body.rows.every((x: { action: string }) => x.action === "USER_INVITED")).toBe(true);
    expect(r.body.rows[0]).toHaveProperty("ip");
    expect((await admin.get("/audit/logins?success=false")).body.rows.length).toBeGreaterThan(0);
    expect((await admin.del("/audit/1")).status).toBe(404);
  });
});
