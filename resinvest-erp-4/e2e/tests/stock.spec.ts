import { expect, test, type Page } from "@playwright/test";
import { ADMIN, expectNoHorizontalScroll, login, MANAGER, MANAGER_NEW_PASSWORD } from "./helpers";

/**
 * Faza F3 — silnik stanów na prawdziwym stosie: bilans otwarcia (szkic kierownika → zatwierdzenie administratora),
 * stany magazynowe i karta materiału, widok telefonu. Konta pochodzą z projektu „desktop” (tożsamość).
 */
test.describe.configure({ mode: "serial" });
const go = (p: Page, name: string) => p.getByRole("navigation", { name: "Główna nawigacja" }).getByRole("link", { name }).click();
let mgr: Page, admin: Page;
/** Zrzuty ekranu do przeglądu wizualnego (opcjonalnie: SHOTS=<katalog>). */
const shot = async (p: Page, name: string) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }); };

test.beforeAll(async ({ browser }) => {
  mgr = await (await browser.newContext()).newPage();
  admin = await (await browser.newContext()).newPage();
  await login(mgr, MANAGER.email, MANAGER_NEW_PASSWORD);
  await expect(mgr.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
  await login(admin, ADMIN.email, ADMIN.password);
  await expect(admin.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
});

test("1. stany przed bilansem: ostrzeżenie o braku bilansu, stany zerowe", async () => {
  await go(mgr, "Stany magazynowe");
  await expect(mgr.getByRole("heading", { name: "Stany magazynowe" })).toBeVisible();
  await expect(mgr.getByText("Magazyn nie ma jeszcze zatwierdzonego bilansu otwarcia.")).toBeVisible();
  await expect(mgr.locator("#balances")).toContainText("Drewno opałowe");
});

test("2. kierownik: szkic bilansu z podglądem przeliczenia (2 073,25 m³ zrębki = 8 293 MP), błąd walidacji przy polu", async () => {
  await go(mgr, "Bilans otwarcia");
  await mgr.locator("#opening-new").click();
  const dlg = mgr.getByRole("dialog");
  await dlg.getByLabel(/^Magazyn/).selectOption({ label: "RiC Zabrze" });
  await dlg.getByLabel(/^Stan na dzień/).fill("2026-09-30");
  await dlg.getByLabel(/^Uwagi \(np/).fill("Remanent 30.09.2026");
  await mgr.locator("#opening-add").click();
  await dlg.getByLabel("Materiał, pozycja 1").selectOption({ label: "Drewno opałowe" });
  await dlg.getByLabel("Ilość, pozycja 1").fill("817");
  await mgr.locator("#opening-add").click();
  await dlg.getByLabel("Materiał, pozycja 2").selectOption({ label: "Zrębka produkcyjna leśna" });
  await dlg.getByLabel("Jednostka, pozycja 2").selectOption({ label: "m³" });
  await dlg.getByLabel("Ilość, pozycja 2").fill("2 073,25");
  await expect(dlg.locator("#opening-lines tbody tr").nth(1).locator("[data-preview]")).toHaveText("8 293 MP");
  await shot(mgr, "f3-bilans-edytor");
  await mgr.locator("#opening-add").click();
  await dlg.getByLabel("Materiał, pozycja 3").selectOption({ label: "PKS (łupina palmowa)" });
  await dlg.getByLabel("Ilość, pozycja 3").fill("-5");
  await mgr.locator("#opening-save").click();
  await expect(dlg.getByText("Ilość nie może być ujemna").first()).toBeVisible(); // walidacja serwera przy polu
  await dlg.getByLabel("Ilość, pozycja 3").fill("728");
  await mgr.locator("#opening-save").click();
  await expect(mgr.getByText("Szkic bilansu utworzony — czeka na zatwierdzenie przez administratora.")).toBeVisible();
  const row = mgr.locator("#opening-table tbody tr").first();
  await expect(row).toContainText("RiC Zabrze"); await expect(row).toContainText("szkic"); await expect(row).toContainText("3");
  await expect(row.getByRole("button", { name: "Zatwierdź…" })).toHaveCount(0); // zatwierdza tylko administrator
});

test("3. administrator zatwierdza — dokument BO, stany ustawione, zatwierdzonego nie można edytować", async () => {
  await go(admin, "Bilans otwarcia");
  const row = admin.locator("#opening-table tbody tr", { hasText: "RiC Zabrze" });
  await row.getByRole("button", { name: "Zatwierdź…" }).click();
  const dlg = admin.getByRole("dialog");
  await expect(dlg).toContainText("Zrębka produkcyjna leśna: 8 293 MP");
  await expect(dlg).toContainText("(wprowadzono 2 073,25 m³)");
  await shot(admin, "f3-zatwierdzenie");
  await admin.locator("#approve-yes").click();
  await expect(admin.getByText(/Bilans otwarcia zatwierdzony — dokument BO\/ZAB\/2026/)).toBeVisible();
  await expect(row).toContainText("zatwierdzony");
  await expect(row).toContainText("BO/ZAB/2026");
  await expect(row.getByRole("button", { name: "Zatwierdź…" })).toHaveCount(0);
  await row.getByRole("button", { name: "Podgląd" }).click();
  await expect(admin.getByRole("dialog")).toContainText("Zmiany stanu — wyłącznie dokumentami i korektami.");
  await expect(admin.locator("#opening-save")).toHaveCount(0);
  await admin.keyboard.press("Escape");
});

test("4. stany magazynowe i karta materiału po zatwierdzeniu (kierownik)", async () => {
  await go(mgr, "Stany magazynowe");
  await expect(mgr.getByText(/Bilans otwarcia zatwierdzony na dzień 30\.09\.2026/)).toBeVisible();
  const chips = mgr.locator("#balances tr", { hasText: "Zrębka produkcyjna leśna" });
  await expect(chips).toContainText("8 293"); await expect(chips).toContainText("MP");
  await expect(mgr.locator("#balances tr", { hasText: "Drewno opałowe" })).toContainText("817");
  await mgr.getByRole("button", { name: "Karta materiału Drewno opałowe" }).click();
  await expect(mgr.locator("#card-balance")).toHaveText("817 m³");
  const mv = mgr.locator("#movements tbody tr").first();
  await expect(mv).toContainText("Bilans otwarcia"); await expect(mv).toContainText("BO/ZAB/2026"); await expect(mv).toContainText("+817");
  await shot(mgr, "f3-karta-materialu");
  await mgr.keyboard.press("Escape");
  await shot(mgr, "f3-stany");
  await mgr.getByRole("button", { name: "Karta materiału Drewno opałowe" }).click();
  await mgr.keyboard.press("Escape");
});

test("5. drugi bilans dla tego samego magazynu — odrzucony z komunikatem", async () => {
  await go(mgr, "Bilans otwarcia");
  await mgr.locator("#opening-new").click();
  const dlg = mgr.getByRole("dialog");
  await dlg.getByLabel(/^Magazyn/).selectOption({ label: "RiC Zabrze" });
  await mgr.locator("#opening-add").click();
  await dlg.getByLabel("Materiał, pozycja 1").selectOption({ label: "Drewno opałowe" });
  await dlg.getByLabel("Ilość, pozycja 1").fill("1");
  await mgr.locator("#opening-save").click();
  await expect(dlg.getByRole("alert").first()).toContainText("ma już zatwierdzony bilans otwarcia");
  await mgr.keyboard.press("Escape");
});

test("6. dziennik audytu: szkic i zatwierdzenie bilansu", async () => {
  await go(admin, "Dziennik audytu");
  await expect(admin.getByRole("table").getByText("Bilans otwarcia — zatwierdzenie", { exact: true })).toBeVisible();
  await expect(admin.getByRole("table").getByText("Bilans otwarcia — szkic", { exact: true })).toBeVisible();
});

test("7. telefon (390 px): stany jako karty, bez poziomego przewijania", async () => {
  await mgr.setViewportSize({ width: 390, height: 844 });
  await mgr.goto("/stany");
  await expect(mgr.locator("#balances")).toContainText("8 293");
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f3-stany-telefon");
  await mgr.goto("/bilans-otwarcia");
  await expect(mgr.locator("#opening-table")).toContainText("RiC Zabrze");
  await expectNoHorizontalScroll(mgr);
});
