import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { client, fixture, type Client } from "./fixtures.js";

/**
 * Preferencje interfejsu (język, motyw, kolory motywu własnego): zapis tylko dla własnego konta, walidacja
 * na serwerze i w bazie (CHECK), audyt, preferencje w profilu /auth/me.
 */
let app: INestApplication;
let F: Awaited<ReturnType<typeof fixture>>;
let mag: Client, view: Client;

beforeAll(async () => {
  app = await createTestApp(); F = await fixture(app, "pref");
  mag = client(app); view = client(app);
  await mag.login(F.users.mag.email); await view.login(F.users.view.email);
});
afterAll(async () => { await app.close(); });

describe("preferencje interfejsu", () => {
  it("domyślnie: polski, motyw domyślny; zmiana języka i motywu własnego z kolorami → profil, baza, audyt", async () => {
    expect((await mag.get("/auth/me")).body.user.prefs).toEqual({ lang: "pl", theme: null, themePrimary: null, themeSecondary: null });
    const r = await mag.put("/auth/me/preferences", { lang: "cs", theme: "custom", themePrimary: "#1E6B45", themeSecondary: " #0a0f16 " });
    expect(r.status).toBe(200);
    expect(r.body.prefs).toEqual({ lang: "cs", theme: "custom", themePrimary: "#1e6b45", themeSecondary: "#0a0f16" });   // małe litery, bez spacji
    expect((await mag.get("/auth/me")).body.user.prefs).toMatchObject({ lang: "cs", theme: "custom" });
    const a = await F.db.auditLog.findFirstOrThrow({ where: { action: "PREFERENCES_CHANGED", entityId: F.users.mag.id } });
    expect(a.after).toMatchObject({ lang: "cs", theme: "custom" });
    expect((await view.get("/auth/me")).body.user.prefs.lang).toBe("pl");   // inny użytkownik bez zmian
  });
  it("bez zmian — bez wpisu w audycie; motyw gotowy", async () => {
    const n = await F.db.auditLog.count({ where: { action: "PREFERENCES_CHANGED", entityId: F.users.mag.id } });
    await mag.put("/auth/me/preferences", { lang: "cs" });
    expect(await F.db.auditLog.count({ where: { action: "PREFERENCES_CHANGED", entityId: F.users.mag.id } })).toBe(n);
    expect((await mag.put("/auth/me/preferences", { theme: "ultra" })).body.prefs.theme).toBe("ultra");
    expect((await mag.put("/auth/me/preferences", { theme: null })).body.prefs.theme).toBeNull();   // „Automatycznie”
    expect((await mag.put("/auth/me/preferences", { theme: "ultra" })).body.prefs.theme).toBe("ultra");
  });
  it("walidacja: nieznany język / motyw, zły kolor, obce pola (np. userId, role) → 400; bez sesji → 401", async () => {
    for (const body of [{ lang: "de" }, { theme: "neon" }, { themePrimary: "red" }, { themeSecondary: "#12345" }, { themePrimary: "#12345g" },
      { userId: F.users.view.id, lang: "en" }, { role: "ADMINISTRATOR" }]) {
      expect((await mag.put("/auth/me/preferences", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await view.get("/auth/me")).body.user.prefs.lang).toBe("pl");
    expect((await client(app).put("/auth/me/preferences", { lang: "en" })).status).toBe(401);
  });
  it("baza odrzuca niedozwolone wartości także z pominięciem API (CHECK)", async () => {
    await expect(F.db.user.update({ where: { id: F.users.view.id }, data: { lang: "de" } })).rejects.toThrow();
    await expect(F.db.user.update({ where: { id: F.users.view.id }, data: { theme: "neon" } })).rejects.toThrow();
    await expect(F.db.user.update({ where: { id: F.users.view.id }, data: { themePrimary: "#FFFFFF" } })).rejects.toThrow();
  });
});
