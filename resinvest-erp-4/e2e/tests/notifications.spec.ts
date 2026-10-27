import { expect, test, type Page } from "@playwright/test";
import { ADMIN, expectNoHorizontalScroll, login, MANAGER, MANAGER_NEW_PASSWORD, mailTexts, STOREKEEPER, STOREKEEPER_NEW_PASSWORD } from "./helpers";

/**
 * F7 — powiadomienia e-mail na prawdziwym stosie (poczta do plików .eml, proces wysyłki co 5 s): administrator daje
 * zgodę magazynierowi z Brąszewic, magazynier włącza powiadomienie o MM, kierownik z Zabrza wysyła MM do Brąszewic →
 * wiadomość trafia do magazyniera; dziennik „Poczta” z wiadomością testową; audyt; telefon.
 */
test.describe.configure({ mode: "serial" });
const go = (p: Page, name: string) => p.getByRole("navigation", { name: "Główna nawigacja" }).getByRole("link", { name, exact: true }).click();
const shot = async (p: Page, name: string) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }); };
let admin: Page, sk: Page;

test.beforeAll(async ({ browser }) => {
  admin = await (await browser.newContext()).newPage();
  await login(admin, ADMIN.email, ADMIN.password);
  await expect(admin.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
  sk = await (await browser.newContext()).newPage();
  await login(sk, STOREKEEPER.email, STOREKEEPER_NEW_PASSWORD);
  await expect(sk.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
});

test("1. bez zgody administratora magazynier nie włączy powiadomień", async () => {
  await go(sk, "Moje konto");
  await expect(sk.locator("#nt-own-STOCK_OPERATION")).toBeDisabled();
  await expect(sk.locator("#nt-own")).toContainText("wymaga zgody administratora");
});

test("2. administrator daje zgodę na MM i PZ (karta użytkownika), magazynier włącza MM", async () => {
  await go(admin, "Użytkownicy");
  await admin.getByRole("link", { name: /Marek/ }).click();
  await admin.locator("#nt-admin-STOCK_OPERATION").check();
  await expect(admin.locator("#nt-admin")).toContainText("Zapisano ustawienia powiadomień");
  await admin.locator("#nt-admin-PZ_CREATED").check();
  await expect(admin.locator("#nt-admin-PZ_CREATED")).toBeChecked();
  await shot(admin, "f7-zgody");
  await sk.reload();
  await sk.locator("#nt-own-STOCK_OPERATION").check();
  await expect(sk.locator("#nt-own")).toContainText("Zapisano ustawienia powiadomień");
  await expect(sk.locator("#nt-own-PZ_CREATED")).toBeEnabled();
  await expect(sk.locator("#nt-own-PZ_CREATED")).not.toBeChecked();
  await expect(sk.locator("#nt-own-WZ_CREATED")).toBeDisabled();
  await shot(sk, "f7-moje-konto");
});

test("3. kierownik wysyła MM do Brąszewic → magazynier dostaje e-mail z numerem, trasą i autorem", async ({ browser }) => {
  const before = mailTexts(STOREKEEPER.email).length;
  const mgr = await (await browser.newContext()).newPage();
  await login(mgr, MANAGER.email, MANAGER_NEW_PASSWORD);
  await go(mgr, "Nowa operacja");
  await mgr.getByRole("tab", { name: /Przesunięcie/ }).click();
  await mgr.locator("#op-target").selectOption({ label: "RiC Brąszewice" });
  const v = await mgr.locator("#op-mat option", { hasText: "Zrębka produkcyjna leśna" }).getAttribute("value");
  await mgr.locator("#op-mat").selectOption(v!);
  await mgr.locator("#op-qty").fill("5");
  await mgr.locator("#op-next").click();
  const number = (await mgr.locator("#op-summary [data-number]").first().textContent()) ?? "";
  await mgr.locator("#op-confirm").click();
  await expect(mgr.locator("#op-transfer")).toContainText("w drodze");
  await mgr.context().close();
  await expect.poll(() => mailTexts(STOREKEEPER.email).length, { timeout: 30_000, message: "brak powiadomienia o MM" }).toBeGreaterThan(before);
  const text = mailTexts(STOREKEEPER.email).at(-1)!;
  expect(text).toContain("Przesunięcie MM");
  expect(text).toContain(number);
  expect(text).toContain("Magazyn: RiC Zabrze → RiC Brąszewice");
  expect(text).toContain("Wprowadził: Karol Kierownik");
});

test("4. Poczta (administrator): statystyka, wiadomość w dzienniku jako wysłana, wiadomość testowa", async () => {
  await go(admin, "Poczta");
  await expect(admin.locator("#mail-stats")).toContainText("pliki .eml");
  await expect(admin.locator("#mail-table tr", { hasText: STOREKEEPER.email }).first()).toContainText(/wysłana|w kolejce/);
  await admin.locator("#mail-test").click();
  await expect(admin.locator("#mail-msg")).toContainText("Wysłano wiadomość testową");
  await expect.poll(() => mailTexts(ADMIN.email).some(t => t.includes("poczta systemu działa")), { timeout: 15_000 }).toBe(true);
  await shot(admin, "f7-poczta");
  await go(admin, "Dziennik audytu");
  await expect(admin.locator("tr", { hasText: "Powiadomienia — zgoda administratora" }).first()).toBeVisible();
  await expect(admin.locator("tr", { hasText: "Powiadomienia — zmiana ustawień" }).first()).toBeVisible();
});

test("5. telefon (390 px): Poczta i ustawienia powiadomień bez poziomego przewijania", async () => {
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.goto("/poczta");
  await expect(admin.locator("#mail-table")).toBeVisible();
  await expectNoHorizontalScroll(admin);
  await sk.setViewportSize({ width: 390, height: 844 });
  await sk.goto("/konto");
  await expect(sk.locator("#nt-own")).toBeVisible();
  await expectNoHorizontalScroll(sk);
  await shot(sk, "f7-konto-telefon");
});
