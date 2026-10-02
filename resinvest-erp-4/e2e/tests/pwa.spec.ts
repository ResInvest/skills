import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, login, MANAGER, MANAGER_NEW_PASSWORD } from "./helpers";

/**
 * F8 — PWA na buildzie produkcyjnym (vite preview): manifest i ikony, service worker przejmuje stronę, w pamięci
 * urządzenia są tylko pliki aplikacji (żadnej odpowiedzi /api/), po zerwaniu sieci aplikacja otwiera się z paskiem
 * „Brak połączenia”, sekcja instalacji w „Moje konto”.
 */
test.describe.configure({ mode: "serial" });

test("1. manifest: nazwa, tryb okna, ikony 192 / 512 / maskowalna — dostępne", async ({ request }) => {
  const r = await request.get("/manifest.webmanifest");
  expect(r.ok()).toBe(true);
  const m = await r.json();
  expect(m).toMatchObject({ name: "ResInvest ERP", display: "standalone", start_url: "/", lang: "pl" });
  const sizes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  for (const i of m.icons) {
    const ic = await request.get(i.src);
    expect(ic.ok(), i.src).toBe(true);
  }
  expect((await request.get("/sw.js")).headers()["content-type"]).toContain("javascript");
});

test("2. service worker przejmuje stronę; w pamięci tylko pliki aplikacji, bez odpowiedzi API; bez sieci — powłoka i pasek", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, MANAGER.email, MANAGER_NEW_PASSWORD);
  await expect(page.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
  // kilka ekranów z danymi — odpowiedzi API nie mogą trafić do pamięci urządzenia
  await page.goto("/stany"); await page.goto("/dokumenty");
  await expect(page.getByRole("heading", { name: "Dokumenty" })).toBeVisible();
  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
  expect(cached).toEqual(expect.arrayContaining(["/index.html", "/manifest.webmanifest"]));
  expect(cached.some(p => p.startsWith("/assets/"))).toBe(true);
  expect(cached.filter(p => p.startsWith("/api/"))).toEqual([]);
  // brak sieci: strona otwiera się z pamięci, aplikacja informuje o braku połączenia
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.locator("#pwa-offline")).toContainText("Brak połączenia z serwerem");
  await ctx.setOffline(false);
  await expect(page.locator("#pwa-offline")).toHaveCount(0);
  await ctx.close();
});

test("3. Moje konto: sekcja instalacji aplikacji; telefon bez poziomego przewijania", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await login(page, MANAGER.email, MANAGER_NEW_PASSWORD);
  await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
  await page.goto("/konto");
  await expect(page.locator("#pwa-install")).toContainText("Dane pozostają na serwerze firmy");
  await expectNoHorizontalScroll(page);
  await page.context().close();
});
