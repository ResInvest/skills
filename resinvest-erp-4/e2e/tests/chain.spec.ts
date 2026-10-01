import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, login, MANAGER, MANAGER_NEW_PASSWORD } from "./helpers";

/**
 * F4b-2b-2 — zakup z produkcją i sprzedaż bezpośrednia na prawdziwym stosie (kierownik RiC Zabrze):
 * zakup 25 m³ drewna z nadleśnictwa → 100 MP zrębki → sprzedaż EC (cena za t), pochodzenie leśne z kwitem;
 * sprzedaż bezpośrednia 120 MP z wycinki (100 MP sprzedane, reszta na stan); stany; telefon.
 * Stan początkowy po wcześniejszych projektach: drewno 817 m³, zrębka 8 453 MP.
 */
test.describe.configure({ mode: "serial" });
const go = (p: Page, name: string) => p.getByRole("navigation", { name: "Główna nawigacja" }).getByRole("link", { name, exact: true }).click();
const shot = async (p: Page, name: string) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }); };
let mgr: Page;

test.beforeAll(async ({ browser }) => {
  mgr = await (await browser.newContext()).newPage();
  await login(mgr, MANAGER.email, MANAGER_NEW_PASSWORD);
  await expect(mgr.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
});

test("1. zakup z produkcją i sprzedażą wyniku: PZ + RW + PW + WZ, pochodzenie leśne, błąd przy braku leśnictwa", async () => {
  await go(mgr, "Nowa operacja");
  await mgr.getByRole("tab", { name: /Zakup/ }).click();
  await mgr.locator("#op-partner").selectOption({ label: "Nadleśnictwo Rudziniec" });
  await mgr.locator("#op-mat").selectOption({ label: "Drewno opałowe (stan 817 m³)" });
  await mgr.locator("#op-qty").fill("25");
  await mgr.locator("#op-price").fill("110");
  await mgr.locator("#op-chain-on").check();
  await mgr.locator("#ch-out").selectOption({ label: "Zrębka produkcyjna leśna" });
  await mgr.locator("#ch-ndl").fill("Rudziniec");
  await mgr.locator("#ch-kwit").fill("KW 15/2026");
  await mgr.locator("#op-outsale-on").check();
  await mgr.locator("#os-buyer").selectOption({ label: "Elektrociepłownia Zabrze S.A." });
  await mgr.locator("#os-price").fill("300");
  await mgr.getByLabel("Jednostka ceny sprzedaży").selectOption("T");
  await mgr.locator("#op-next").click();
  await expect(mgr.locator("#op-chain")).toContainText("Podaj leśnictwo");
  await mgr.locator("#ch-lesn").fill("Kłodnica");
  await expect(mgr.locator("#op-live")).toContainText("Zużycie 25 m³ → produkcja 100 MP (1 m³ = 4 MP)");
  await expect(mgr.locator("#op-live")).toContainText("Sprzedaż 100 MP | 33 t | AUTO");
  // podgląd krok po kroku: zakup, potem zużycie z nowego stanu; produkcja, potem sprzedaż
  await expect(mgr.locator("#op-live")).toContainText("Drewno opałowe: 817 → 842 m³");
  await expect(mgr.locator("#op-live")).toContainText("Drewno opałowe: 842 → 817 m³");
  await expect(mgr.locator("#op-live")).toContainText("Zrębka produkcyjna leśna: 8 553 → 8 453 MP");
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f4b2b-zakup-z-produkcja");
  await mgr.locator("#op-next").click();
  const nums = mgr.locator("#op-summary [data-number]");
  await expect(nums).toHaveCount(4);
  await expect(nums.nth(0)).toHaveText(/^PZ\//); await expect(nums.nth(1)).toHaveText(/^RW\//);
  await expect(nums.nth(2)).toHaveText(/^PW\//); await expect(nums.nth(3)).toHaveText(/^WZ\//);
  await mgr.locator("#op-confirm").click();
  await expect(mgr.getByRole("dialog").getByRole("heading", { name: /^Zakup z produkcją — PZ\// })).toBeVisible();
  await expect(mgr.locator("#op-production")).toContainText("Nadl. Rudziniec, leśn. Kłodnica · kwit KW 15/2026");
  await expect(mgr.locator("#op-detail")).toContainText("9900,00 zł");     // 33 t × 300 zł (pl-PL nie grupuje liczb 4-cyfrowych)
  await mgr.getByRole("dialog").getByRole("button", { name: "Zamknij" }).click();
});

test("2. sprzedaż bezpośrednia: produkcja 120 MP z wycinki, sprzedaż 100 MP, ostrzeżenie o reszcie na stanie", async () => {
  await mgr.getByRole("tab", { name: /Sprzedaż bezpośrednia/ }).click();
  await mgr.locator("#op-raw").selectOption({ label: "Drewno opałowe" });
  await mgr.locator("#op-rawcost").fill("2500");
  await mgr.locator("#ch-out").selectOption({ label: "Zrębka produkcyjna leśna" });
  await mgr.locator("#ch-outqty").fill("120");
  await mgr.locator("#ch-source").selectOption("INVESTMENT");
  await mgr.locator("#ch-site").fill("DK88 Zabrze — wycinka pasa");
  await mgr.locator("#os-buyer").selectOption({ label: "Elektrociepłownia Zabrze S.A." });
  await mgr.locator("#os-qty").fill("100");
  await mgr.locator("#os-price").fill("90");
  await expect(mgr.locator("#op-live")).toContainText("Produkcja w lesie 120 MP (surowiec nie ze stanu: ok. 30 m³)");
  await mgr.locator("#op-next").click();
  const sum = mgr.locator("#op-summary");
  await expect(sum).toContainText("pozostałe 20 MP zostanie przyjęte na stan magazynu");
  await expect(sum.locator("[data-number]").nth(1)).toHaveText(/^WZ\//);
  await mgr.locator("#op-confirm").click();
  await expect(mgr.getByRole("dialog").getByRole("heading", { name: /^Sprzedaż bezpośrednia — WZ\// })).toBeVisible();
  await expect(mgr.locator("#op-production")).toContainText("wycinka: DK88 Zabrze — wycinka pasa");
  await mgr.getByRole("dialog").getByRole("button", { name: "Zamknij" }).click();
});

test("3. stany: drewno bez zmian (817 m³: +25 −25), zrębka 8 453 + 20 = 8 473 MP", async () => {
  await go(mgr, "Stany magazynowe");
  await expect(mgr.locator("tr", { hasText: "Drewno opałowe" }).first()).toContainText("817");
  await expect(mgr.locator("tr", { hasText: "Zrębka produkcyjna leśna" }).first()).toContainText("8 473");
});

test("4. telefon (390 px): zakup z produkcją i sprzedażą — formularz bez poziomego przewijania", async () => {
  await mgr.setViewportSize({ width: 390, height: 844 });
  await mgr.goto("/nowa-operacja");
  await mgr.locator("#op-chain-on").check();
  await mgr.locator("#op-outsale-on").check();
  await expect(mgr.locator("#op-outsale")).toBeVisible();
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f4b2b-produkcja-telefon");
});
