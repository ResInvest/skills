import { expect, test, type Page } from "@playwright/test";
import { ADMIN, expectNoHorizontalScroll, login, MANAGER, MANAGER_NEW_PASSWORD, STOREKEEPER, STOREKEEPER_NEW_PASSWORD } from "./helpers";

/**
 * F4b-2 — przesunięcie MM dwuetapowe na prawdziwym stosie: kierownik RiC Zabrze wysyła zrębkę do RiC Brąszewice,
 * w Brąszewicach przyjęcie widzi konto bez prawa „Przyjęcie MM” (magazynier zmieniony na Obserwatora w scenariuszu 9
 * tożsamości) — bez przycisku; przyjmuje administrator z ubytkiem (przyczyna wymagana); stany i rejestry obu magazynów, telefon.
 * Stan początkowy: zrębka w Zabrzu po projekcie „dokumenty” (8 633 MP).
 */
test.describe.configure({ mode: "serial" });
const go = (p: Page, name: string) => p.getByRole("navigation", { name: "Główna nawigacja" }).getByRole("link", { name, exact: true }).click();
const shot = async (p: Page, name: string) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }); };
let mgr: Page, mag: Page, admin: Page;

test.beforeAll(async ({ browser }) => {
  mgr = await (await browser.newContext()).newPage();
  mag = await (await browser.newContext()).newPage();
  admin = await (await browser.newContext()).newPage();
  await login(admin, ADMIN.email, ADMIN.password);
  await login(mgr, MANAGER.email, MANAGER_NEW_PASSWORD);
  await login(mag, STOREKEEPER.email, STOREKEEPER_NEW_PASSWORD);
  await expect(mgr.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
  await expect(mag.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
});

test("1. kierownik wysyła MM 120 MP do Brąszewic — podsumowanie ze stanem źródła, dokument „w drodze”", async () => {
  await go(mgr, "Nowa operacja");
  await mgr.getByRole("tab", { name: /Przesunięcie/ }).click();
  await expect(mgr.locator("#op-form")).toContainText("MM dwuetapowe");
  await mgr.locator("#op-target").selectOption({ label: "RiC Brąszewice" });
  await mgr.locator("#op-mat").selectOption({ label: "Zrębka produkcyjna leśna (stan 8 633 MP)" });
  await mgr.locator("#op-qty").fill("120");
  await mgr.locator("#op-weight").fill("40,2");
  const live = mgr.locator("#op-live");
  await expect(live).toContainText("8 633 → 8 513");
  await expect(live).toContainText("W drodze do: RiC Brąszewice");
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f4b2-mm-formularz");
  await mgr.locator("#op-next").click();
  const sum = mgr.locator("#op-summary");
  await expect(sum.locator("[data-number]")).toHaveText(/^MM\/\d{3}\/\d{2}\/\d{4}$/);
  await expect(sum).toContainText("Zrębka produkcyjna leśna");
  await expect(sum).toContainText("120 MP | 40,2 t | RĘCZNY");
  await mgr.locator("#op-confirm").click();
  await expect(mgr.locator("#op-transfer")).toContainText("RiC Zabrze → RiC Brąszewice");
  await expect(mgr.locator("#op-transfer")).toContainText("w drodze");
  await mgr.getByRole("dialog").getByRole("button", { name: "Zamknij" }).click();
});

test("2. rejestr Zabrza: MM z trasą i stanem „w drodze”, lista wysłanych", async () => {
  await go(mgr, "Dokumenty");
  const row = mgr.locator("#docs-table tr.doc-row-MM").first();
  await expect(row).toContainText("RiC Zabrze → RiC Brąszewice");
  await expect(row).toContainText("w drodze");
  await expect(row.locator(".badge.doc-MM")).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await expect(mgr.locator("#mm-outbound")).toContainText("→ RiC Brąszewice");
  await expect(mgr.locator("#mm-inbound")).toHaveCount(0);
});

test("3. Brąszewice: konto bez prawa przyjęcia widzi MM bez przycisku; administrator przyjmuje 116 MP z przyczyną różnicy", async () => {
  await go(mag, "Dokumenty");
  const seen = mag.locator("#mm-inbound");
  await expect(seen).toContainText("z: RiC Zabrze");
  await expect(seen).toContainText("Zrębka produkcyjna leśna: 120 MP");
  await expect(seen.getByRole("button", { name: "Przyjmij" })).toHaveCount(0);
  await expect(seen).toContainText("przyjmuje osoba z uprawnieniem „Przyjęcie MM”");

  await go(admin, "Dokumenty");
  // poczekaj na ekran rejestru — pulpit administratora też ma sekcję „Magazyny”
  await expect(admin.getByRole("heading", { name: "Dokumenty", exact: true })).toBeVisible();
  await admin.getByRole("combobox", { name: "Magazyn", exact: true }).selectOption({ label: "RiC Brąszewice" });
  const inbound = admin.locator("#mm-inbound");
  await inbound.getByRole("button", { name: "Przyjmij" }).click();
  const dlg = admin.locator("#mm-receive");
  await expect(dlg).toContainText("wysłano");
  await admin.locator("#rc-qty").fill("116");
  await expect(dlg).toContainText("różni się od wysłanej o 4 MP — wskaż przyczynę");
  // zapis bez przyczyny — odrzucony przez serwer, komunikat przy polu
  await admin.locator("#mm-receive-save").click();
  await expect(dlg.locator(".error")).toContainText(/różni się od wysłanej o 4 MP/);
  await admin.locator("#rc-reason").selectOption({ label: "Ubytek w transporcie" });
  await expect(dlg).toContainText("ubytek 4 MP · Ubytek w transporcie");
  await admin.locator("#rc-note").fill("osypanie na trasie");
  await shot(admin, "f4b2-mm-przyjecie");
  await admin.locator("#mm-receive-save").click();
  await expect(admin.getByText(/Przyjęto MM\/\d{3}\/\d{2}\/\d{4} na magazyn RiC Brąszewice/)).toBeVisible();
  await expect(admin.locator("#mm-inbound")).toHaveCount(0);

  await mag.reload();
  await expect(mag.locator("#mm-inbound")).toHaveCount(0);
  const row = mag.locator("#docs-table tr.doc-row-MM").first();
  await expect(row).toContainText("przyjęte");
  await row.locator("button.linkish").click();
  await expect(mag.locator("#op-receipt")).toContainText("ubytek 4");
  await expect(mag.locator("#op-receipt")).toContainText("Ubytek w transporcie — osypanie na trasie");
  await mag.getByRole("dialog").getByRole("button", { name: "Zamknij" }).click();
});

test("4. stany: Zabrze 8 513 MP (rozchód 120), Brąszewice 116 MP (przyjęto)", async () => {
  await go(mgr, "Stany magazynowe");
  await expect(mgr.locator("tr", { hasText: "Zrębka produkcyjna leśna" }).first()).toContainText("8 513");
  await go(mag, "Stany magazynowe");
  await expect(mag.locator("tr", { hasText: "Zrębka produkcyjna leśna" }).first()).toContainText("116");
});

test("5. telefon (390 px): rejestr magazyniera z MM bez poziomego przewijania", async () => {
  await mag.setViewportSize({ width: 390, height: 844 });
  await mag.goto("/dokumenty");
  await expect(mag.locator("#docs-table")).toContainText("przyjęte");
  await expectNoHorizontalScroll(mag);
  await shot(mag, "f4b2-telefon-rejestr");
});
