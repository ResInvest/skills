import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken } from "../src/auth/tokens.js";
import { createTestApp } from "./helpers.js";
import { client, fixture, lastMailLink, PW } from "./fixtures.js";

let app: INestApplication;
let F: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { app = await createTestApp(); F = await fixture(app, "auth"); });
afterAll(async () => { await app.close(); });

describe("§34.1–§34.4 logowanie", () => {
  it("§34.1 poprawne konto (e-mail bez rozróżniania wielkości liter) — ciasteczko HttpOnly, SameSite=Strict", async () => {
    const c = client(app);
    const r = await c.login(F.users.admin.email.toUpperCase());
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ email: F.users.admin.email, role: { code: "ADMINISTRATOR", global: true } });
    const cookie = String(r.headers["set-cookie"]);
    expect(cookie).toMatch(/riw_sid=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|\$argon2/);
    const me = await c.get("/auth/me");
    expect(me.body.user.permissions).toContain("users.manage");
    expect(await F.db.auditLog.count({ where: { action: "LOGIN", userId: F.users.admin.id } })).toBeGreaterThan(0);
  });
  it("§34.2 błędne hasło — ogólny komunikat, wpis w dzienniku logowań", async () => {
    const r = await client(app).login(F.users.view.email, "Zle-Haslo-12345");
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: "BAD_CREDENTIALS", error: "Nieprawidłowy e-mail lub hasło." });
    const nobody = await client(app).login("nieistnieje.auth@resinvest.group", "Zle-Haslo-12345");
    expect(nobody.body.error).toBe(r.body.error);
    expect(await F.db.loginEvent.count({ where: { email: F.users.view.email, success: false, reason: "BAD_PASSWORD" } })).toBe(1);
  });
  it("§34.3 konto zaproszone (INVITED) i zawieszone — komunikat dopiero po poprawnym haśle", async () => {
    const u = await F.db.user.update({ where: { id: F.users.aud.id }, data: { status: "INVITED" } });
    expect((await client(app).login(u.email)).body).toMatchObject({ code: "NOT_ACTIVATED", error: "Twoje konto nie zostało jeszcze aktywowane." });
    await F.db.user.update({ where: { id: u.id }, data: { status: "SUSPENDED" } });
    expect((await client(app).login(u.email)).body).toMatchObject({ code: "INACTIVE", error: "Twoje konto jest nieaktywne." });
    expect((await client(app).login(u.email, "Zle-Haslo-12345")).body.code).toBe("BAD_CREDENTIALS");
    await F.db.user.update({ where: { id: u.id }, data: { status: "ACTIVE" } });
  });
  it("§34.4 domena spoza @resinvest.group — odrzucona po stronie serwera (w tym subdomena)", async () => {
    for (const e of ["jan@gmail.com", "jan@sub.resinvest.group", "jan@resinvest.group.pl"]) {
      const r = await client(app).login(e);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("EMAIL_DOMAIN");
    }
  });
});

describe("§34.18–§34.19 sesja", () => {
  it("§34.18 brak sesji — 401", async () => {
    const r = await client(app).get("/auth/me");
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("AUTH");
  });
  it("§34.19 sesja bezczynna i wygasła — wymagane ponowne logowanie", async () => {
    const c = client(app);
    await c.login(F.users.view.email);
    await F.db.session.updateMany({ where: { userId: F.users.view.id, revokedAt: null }, data: { lastSeenAt: new Date(Date.now() - 2 * 3_600_000) } });
    expect((await c.get("/auth/me")).status).toBe(401);
    expect(await F.db.session.count({ where: { userId: F.users.view.id, revokedReason: "IDLE" } })).toBeGreaterThan(0);
    const c2 = client(app);
    await c2.login(F.users.view.email);
    await F.db.session.updateMany({ where: { userId: F.users.view.id, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await c2.get("/auth/me")).status).toBe(401);
  });
  it("wylogowanie unieważnia sesję; lista aktywnych sesji i zdalne wylogowanie innej sesji", async () => {
    const a = client(app), b = client(app);
    await a.login(F.users.mgr.email); await b.login(F.users.mgr.email);
    const list = await a.get("/auth/sessions");
    expect(list.body.sessions.length).toBeGreaterThanOrEqual(2);
    expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const other = list.body.sessions.find((s: { current: boolean }) => !s.current);
    expect((await a.del(`/auth/sessions/${other.id}`)).status).toBe(200);
    expect((await b.get("/auth/me")).status).toBe(401);
    expect((await a.post("/auth/logout")).status).toBe(200);
    expect((await a.get("/auth/me")).status).toBe(401);
  });
  it("CSRF: żądanie zmieniające dane bez nagłówka albo z obcego Origin — 403", async () => {
    const c = client(app);
    const noHeader = await c.agent.post("/api/v1/auth/login").send({ email: F.users.admin.email, password: PW });
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.code).toBe("CSRF");
    const evil = await c.agent.post("/api/v1/auth/login").set({ "X-Requested-With": "ResInvestERP", Origin: "https://evil.example" }).send({ email: F.users.admin.email, password: PW });
    expect(evil.body.code).toBe("CSRF");
  });
});

describe("blokada konta", () => {
  it("5 błędnych haseł blokuje konto; poprawne hasło w czasie blokady odrzucone; odblokowanie przez administratora", async () => {
    const c = client(app);
    for (let i = 0; i < 5; i++) await c.login(F.users.mag.email, "Zle-Haslo-12345");
    const locked = await c.login(F.users.mag.email);
    expect(locked.status).toBe(403);
    expect(locked.body.code).toBe("LOCKED");
    expect(await F.db.auditLog.count({ where: { action: "ACCOUNT_LOCKED", entityId: F.users.mag.id } })).toBe(1);
    const admin = client(app); await admin.login(F.users.admin.email);
    expect((await admin.post(`/users/${F.users.mag.id}/unlock`)).status).toBe(200);
    expect((await client(app).login(F.users.mag.email)).status).toBe(200);
  });
});

describe("§34.5–§34.7 zaproszenie, aktywacja, reset hasła", () => {
  it("§34.5–6 zaproszenie → link e-mail → hasło wg polityki → konto ACTIVE; link jednorazowy", async () => {
    const admin = client(app); await admin.login(F.users.admin.email);
    const email = "nowy.pracownik.auth@resinvest.group";
    const inv = await admin.post("/users", { email, firstName: "Nowy", lastName: "Pracownik", roleCode: "MAGAZYNIER", warehouseIds: [F.wh.BRA], defaultWarehouseId: F.wh.BRA });
    expect(inv.status).toBe(201);
    expect(inv.body.user).toMatchObject({ email, status: "INVITED", warehouseIds: [F.wh.BRA] });
    expect((await admin.post("/users", { email, firstName: "X", lastName: "Y", roleCode: "MAGAZYNIER", warehouseIds: [F.wh.BRA] })).body.code).toBe("EMAIL_TAKEN");
    const token = await lastMailLink(F.db, email, "/aktywacja");
    const guest = client(app);
    expect((await guest.post("/auth/token", { token, kind: "INVITE" })).body).toMatchObject({ email, name: "Nowy Pracownik" });
    expect((await guest.post("/auth/invite/accept", { token, password: "krotkie1" })).body.code).toBe("PASSWORD_POLICY");
    expect((await guest.post("/auth/invite/accept", { token, password: PW })).status).toBe(200);
    expect((await guest.post("/auth/invite/accept", { token, password: PW })).body.code).toBe("TOKEN_USED");
    expect((await guest.post("/auth/invite/accept", { token: "x".repeat(43), password: PW })).body.code).toBe("TOKEN_INVALID");
    expect((await client(app).login(email)).status).toBe(200);
    expect(await F.db.auditLog.count({ where: { action: { in: ["USER_INVITED", "INVITE_ACCEPTED"] }, entityId: inv.body.user.id } })).toBe(2);
  });
  it("§34.6 link przeterminowany", async () => {
    const admin = client(app); await admin.login(F.users.admin.email);
    const email = "spozniony.auth@resinvest.group";
    await admin.post("/users", { email, firstName: "S", lastName: "P", roleCode: "OBSERWATOR", warehouseIds: [F.wh.ZAB] });
    const token = await lastMailLink(F.db, email, "/aktywacja");
    await F.db.authToken.update({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await client(app).post("/auth/invite/accept", { token, password: PW })).body.code).toBe("TOKEN_EXPIRED");
  });
  it("§34.7 reset hasła — ta sama odpowiedź dla każdego adresu, stare hasło nieważne, sesje wylogowane", async () => {
    const other = client(app); await other.login(F.users.view.email);
    const guest = client(app);
    const a = await guest.post("/auth/forgot", { email: F.users.view.email });
    const b = await guest.post("/auth/forgot", { email: "brak.konta@resinvest.group" });
    expect(a.status).toBe(200); expect(a.body.message).toBe(b.body.message);
    const token = await lastMailLink(F.db, F.users.view.email, "/reset-hasla");
    const NEW = "Nowe-Haslo-Plac-9";
    expect((await guest.post("/auth/reset", { token, password: NEW })).status).toBe(200);
    expect((await other.get("/auth/me")).status).toBe(401);
    expect((await client(app).login(F.users.view.email)).status).toBe(401);
    expect((await client(app).login(F.users.view.email, NEW)).status).toBe(200);
    expect((await guest.post("/auth/reset", { token, password: "Jeszcze-Inne-77" })).body.code).toBe("TOKEN_USED");
    await F.db.user.update({ where: { id: F.users.view.id }, data: { passwordHash: (await F.db.user.findUniqueOrThrow({ where: { id: F.users.admin.id } })).passwordHash } });
  });
});

describe("zmiana hasła i wymuszenie zmiany", () => {
  it("wymuszona zmiana hasła blokuje pracę do czasu zmiany; zmiana wylogowuje inne sesje", async () => {
    const admin = client(app); await admin.login(F.users.admin.email);
    const u = client(app), second = client(app);
    await u.login(F.users.mgr.email); await second.login(F.users.mgr.email);
    expect((await admin.post(`/users/${F.users.mgr.id}/force-password-change`)).status).toBe(200);
    const blocked = await u.get("/users");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await u.get("/auth/me")).body.user.mustChangePassword).toBe(true);
    expect((await u.post("/auth/password", { oldPassword: "zle", newPassword: "Nowe-Haslo-Plac-9" })).body.code).toBe("BAD_PASSWORD");
    expect((await u.post("/auth/password", { oldPassword: PW, newPassword: PW })).body.code).toBe("PASSWORD_SAME");
    expect((await u.post("/auth/password", { oldPassword: PW, newPassword: "Plac-Brasz-Nowe-7" })).status).toBe(200);
    expect((await u.get("/users")).status).toBe(200);
    expect((await second.get("/auth/me")).status).toBe(401);
    expect(await F.db.mailOutbox.count({ where: { toAddress: F.users.mgr.email, template: "password-changed" } })).toBe(1);
    await F.db.user.update({ where: { id: F.users.mgr.id }, data: { passwordHash: (await F.db.user.findUniqueOrThrow({ where: { id: F.users.admin.id } })).passwordHash } });
  });
});

describe("rejestracja samodzielna", () => {
  it("domyślnie wyłączona; po włączeniu zgłoszenie INVITED bez hasła i powiadomienie administratorów", async () => {
    const guest = client(app);
    const off = await guest.post("/auth/register", { email: "chetny.auth@resinvest.group", firstName: "Jan", lastName: "Chętny" });
    expect(off.status).toBe(403); expect(off.body.code).toBe("DISABLED");
    await F.db.setting.update({ where: { key: "auth.allowSelfRegistration" }, data: { value: true } });
    expect((await guest.post("/auth/register", { email: "chetny.auth@resinvest.group", firstName: "Jan", lastName: "Chętny" })).status).toBe(200);
    const u = await F.db.user.findUniqueOrThrow({ where: { email: "chetny.auth@resinvest.group" } });
    expect(u).toMatchObject({ status: "INVITED", selfRegistered: true, passwordHash: null });
    expect(await F.db.mailOutbox.count({ where: { template: "self-registration", toAddress: F.users.admin.email } })).toBe(1);
    await F.db.setting.update({ where: { key: "auth.allowSelfRegistration" }, data: { value: false } });
  });
});

describe("limit prób z jednego adresu", () => {
  it("ponad 20 prób logowania z jednego adresu i ponad 8 na jedno konto w 5 min — 429", async () => {
    const own = await createTestApp({ LOGIN_RATE_PER_IP: "20", LOGIN_RATE_PER_EMAIL: "8" });
    const c = client(own);
    let last = 0;
    for (let i = 0; i < 22; i++) last = (await c.login(`x${i}.auth@resinvest.group`, "Zle-Haslo-12345")).status;
    expect(last).toBe(429);
    const c2 = client(own);
    let s2 = 0;
    for (let i = 0; i < 9; i++) s2 = (await c2.login("jeden.adres.auth@resinvest.group", "Zle-Haslo-12345")).status;
    expect(s2).toBe(429);
    await own.close();
  });
});
