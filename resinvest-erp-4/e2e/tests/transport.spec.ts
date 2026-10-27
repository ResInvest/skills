import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, login, MANAGER, MANAGER_NEW_PASSWORD } from "./helpers";

/**
 * F4b-2b — transport na prawdziwym stosie: kierownik RiC Zabrze sprzedaje zrębkę z transportem własnym
 * (pojazd SGL 4T821 z kierowcą domyślnym — kartoteki z projektu „kartoteki”): podgląd kosztu, błąd przy kursie,
 * podsumowanie, szczegóły z kursami, dokument TR w rejestrze, telefon.
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

test("1. sprzedaż 60 MP z transportem własnym: 2 kursy, kierowca domyślny, koszt w podglądzie i podsumowaniu", async () => {
  await go(mgr, "Nowa operacja");
  await mgr.getByRole("tab", { name: /Sprzedaż z magazynu/ }).click();
  await mgr.locator("#op-partner").selectOption({ label: "Elektrociepłownia Zabrze S.A." });
  await mgr.locator("#op-mat").selectOption({ label: "Zrębka produkcyjna leśna (stan 8 513 MP)" });
  await mgr.locator("#op-qty").fill("60");
  await mgr.locator("#op-price").fill("90");
  await mgr.locator("#tr-mode").selectOption("OWN");
  await mgr.locator("#tr-place").fill("EC Zabrze, ul. Wolności");
  await mgr.locator("#tr-veh-0").selectOption({ label: "SGL 4T821 Scania R450" });
  await mgr.locator("#tr-km-0").fill("42");
  await mgr.locator("#tr-qty-0").fill("30");
  await mgr.locator("#tr-w-0").fill("9,9");
  await mgr.locator("#tr-run-add").click();
  await mgr.locator("#tr-veh-1").selectOption({ label: "SGL 4T821 Scania R450" });
  await mgr.locator("#tr-km-1").fill("42");
  // drugi kurs bez ilości przy wielu kursach — błąd przy polu (reguła domeny w podglądzie)
  await mgr.locator("#op-next").click();
  await expect(mgr.locator("#op-transport")).toContainText("Podaj ilość przewożoną w kursie 2 (MP)");
  await mgr.locator("#tr-qty-1").fill("30");
  await expect(mgr.locator("#op-live-transport")).toHaveText(/420,00/);
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f4b2b-transport-formularz");
  await mgr.locator("#op-next").click();
  const sum = mgr.locator("#op-summary");
  await expect(sum.locator("[data-number]").nth(1)).toHaveText(/^TR\/\d{3}\/\d{2}\/\d{4}$/);
  await expect(sum).toContainText("Transport własny · 2 kursy · 420,00");
  await expect(sum).toContainText("Brak wagi rzeczywistej dla 1 z 2 kursów.");
  await mgr.locator("#op-confirm").click();
  const tr = mgr.locator("#op-transport-detail");
  await expect(tr).toContainText("Transport — Transport własny");
  await expect(tr).toContainText("EC Zabrze, ul. Wolności");
  await expect(tr).toContainText("Jan Kowalski");
  await expect(tr).toContainText("SGL 4T821");
  await expect(tr.locator("tbody tr")).toHaveCount(2);
  await mgr.getByRole("dialog").getByRole("button", { name: "Zamknij" }).click();
});

test("2. rejestr: dokument TR (pomocniczy) z kosztem transportu", async () => {
  await go(mgr, "Dokumenty");
  await mgr.locator("#doc-aux").check();
  await expect(mgr.locator("#docs-table tr.doc-row-aux", { hasText: "TR/" }).first()).toContainText("420,00");
});

test("3. telefon (390 px): sekcja transportu w formularzu bez poziomego przewijania", async () => {
  await mgr.setViewportSize({ width: 390, height: 844 });
  await mgr.goto("/nowa-operacja");
  await mgr.getByRole("tab", { name: /Zakup/ }).click();
  await mgr.locator("#tr-mode").selectOption("MIXED");
  await mgr.locator("#tr-run-add").click();
  await expect(mgr.locator(".run-row")).toHaveCount(2);
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f4b2b-transport-telefon");
});
