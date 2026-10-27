import { expect, test, type Page } from "@playwright/test";
import { ADMIN, expectNoHorizontalScroll, login, MANAGER, MANAGER_NEW_PASSWORD } from "./helpers";

/** F4a — kartoteki na prawdziwym stosie: dodanie i edycja, błędy serwera przy polach, rębak firmy zewnętrznej, blokada usuwania, telefon. */
test.describe.configure({ mode: "serial" });
const go = (p: Page, name: string) => p.getByRole("navigation", { name: "Główna nawigacja" }).getByRole("link", { name }).click();
const tab = (p: Page, name: string) => p.getByRole("tab", { name, exact: true }).click();
const shot = async (p: Page, name: string) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }); };
let mgr: Page, admin: Page;

test.beforeAll(async ({ browser }) => {
  mgr = await (await browser.newContext()).newPage();
  admin = await (await browser.newContext()).newPage();
  await login(mgr, MANAGER.email, MANAGER_NEW_PASSWORD);
  await login(admin, ADMIN.email, ADMIN.password);
  await expect(mgr.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
  await expect(admin.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
});

test("1. materiały: lista z instalacji, dodanie z błędem serwera przy polu, poprawa, edycja", async () => {
  await go(mgr, "Kartoteki");
  await expect(mgr.locator("#catalog-table")).toContainText("Zrębka produkcyjna leśna");
  await mgr.locator("#cat-new").click();
  const dlg = mgr.getByRole("dialog");
  await dlg.getByLabel(/^Nazwa/).fill("Zrębka kora");
  await dlg.getByLabel(/^Kod/).fill("zr-pl");
  await mgr.locator("#cat-save").click();
  await expect(dlg.getByText("Materiał o takim kodzie już istnieje").first()).toBeVisible();
  await dlg.getByLabel(/^Kod/).fill("ZR-KORA");
  await dlg.getByLabel(/^MP z 1 m³/).fill("3,8");
  await mgr.locator("#cat-save").click();
  await expect(mgr.getByText("Dodano materiał.")).toBeVisible();
  const row = mgr.locator("#catalog-table tr", { hasText: "Zrębka kora" });
  await expect(row).toContainText("ZR-KORA");
  await row.getByRole("button", { name: /^Edytuj/ }).click();
  await mgr.getByRole("dialog").getByLabel(/^Nazwa/).fill("Zrębka z kory");
  await mgr.locator("#cat-save").click();
  await expect(mgr.getByText("Zapisano zmiany.")).toBeVisible();
  await expect(mgr.locator("#catalog-table")).toContainText("Zrębka z kory");
});

test("2. kontrahent: NIP z sumą kontrolną sprawdzany na serwerze", async () => {
  await tab(mgr, "Kontrahenci");
  await mgr.locator("#cat-new").click();
  const dlg = mgr.getByRole("dialog");
  await dlg.getByLabel(/^Nazwa/).fill("Elektrociepłownia Zabrze S.A.");
  await dlg.getByLabel(/^NIP/).fill("526-000-12-47");
  await dlg.getByLabel(/^Rola/).selectOption("BUYER");
  await mgr.locator("#cat-save").click();
  await expect(dlg.getByText(/Nieprawidłowy NIP/).first()).toBeVisible();
  await dlg.getByLabel(/^NIP/).fill("526-000-12-46");
  await mgr.locator("#cat-save").click();
  await expect(mgr.locator("#catalog-table tr", { hasText: "Elektrociepłownia Zabrze" })).toContainText("5260001246");
});

test("3. flota: firma zewnętrzna, rębak firmy zewnętrznej z operatorem opisowo, kierowca i pojazd", async () => {
  await tab(mgr, "Firmy zewnętrzne");
  await mgr.locator("#cat-new").click();
  await mgr.getByRole("dialog").getByLabel(/^Nazwa/).fill("Usługi Leśne Drwal");
  await mgr.getByRole("dialog").getByLabel(/^Rodzaj/).selectOption("CHIPPING");
  await mgr.locator("#cat-save").click();
  await expect(mgr.getByText("Dodano firmę.")).toBeVisible();

  await tab(mgr, "Rębaki");
  await mgr.locator("#cat-new").click();
  const dlg = mgr.getByRole("dialog");
  await dlg.getByLabel(/^Nazwa \/ model/).fill("Bandit 2590XP");
  await dlg.getByLabel(/^Czyj jest rębak/).selectOption("EXTERNAL");
  await expect(dlg.getByLabel(/^Operator \(z kartoteki\)/)).toHaveCount(0); // rębak zewnętrzny — operator opisowo
  await mgr.locator("#cat-save").click();
  await expect(dlg.getByText("Wybierz firmę — właściciela rębaka").first()).toBeVisible();
  await dlg.getByLabel(/^Firma — właściciel rębaka/).selectOption({ label: "Usługi Leśne Drwal" });
  await dlg.getByLabel(/^Operator firmy zewnętrznej/).fill("Zbigniew Kos");
  await dlg.getByLabel(/^Magazyn/).selectOption({ label: "RiC Zabrze" });
  await mgr.locator("#cat-save").click();
  const row = mgr.locator("#catalog-table tr", { hasText: "Bandit 2590XP" });
  await expect(row).toContainText("firma: Usługi Leśne Drwal"); await expect(row).toContainText("Zbigniew Kos");
  await shot(mgr, "f4a-rebaki");

  await tab(mgr, "Kierowcy");
  await mgr.locator("#cat-new").click();
  await mgr.getByRole("dialog").getByLabel(/^Imię i nazwisko/).fill("Jan Kowalski");
  await mgr.locator("#cat-save").click();
  await tab(mgr, "Pojazdy");
  await mgr.locator("#cat-new").click();
  const v = mgr.getByRole("dialog");
  await v.getByLabel(/^Nazwa \/ opis/).fill("Scania R450");
  await v.getByLabel(/^Numer rejestracyjny/).fill("sgl 4t821");
  await v.getByLabel(/^Magazyn/).selectOption({ label: "RiC Zabrze" });
  await v.getByLabel(/^Kierowca domyślny/).selectOption({ label: "Jan Kowalski" });
  await mgr.locator("#cat-save").click();
  await expect(mgr.locator("#catalog-table tr", { hasText: "SGL 4T821" })).toContainText("Jan Kowalski");
});

test("4. powiązany rekord nie znika: usunięcie kierowcy domyślnego pojazdu — komunikat o dezaktywacji", async () => {
  await tab(mgr, "Kierowcy");
  mgr.once("dialog", d => void d.accept());
  await mgr.locator("#catalog-table tr", { hasText: "Jan Kowalski" }).getByRole("button", { name: /^Usuń/ }).click();
  await expect(mgr.getByRole("alert").first()).toContainText("nie można go usunąć; ustaw jako nieaktywny");
  await expect(mgr.locator("#catalog-table")).toContainText("Jan Kowalski");
});

test("5. dziennik audytu: zmiany kartotek z było/jest", async () => {
  await go(admin, "Dziennik audytu");
  await expect(admin.getByRole("table").getByText("Kartoteka — dodanie", { exact: true }).first()).toBeVisible();
  await expect(admin.getByRole("table").getByText("Kartoteka — zmiana", { exact: true }).first()).toBeVisible();
});

test("6. telefon (390 px): kartoteki jako karty, zakładki przewijane, bez poziomego przewijania strony", async () => {
  await mgr.setViewportSize({ width: 390, height: 844 });
  await mgr.goto("/kartoteki/chippers");
  await expect(mgr.locator("#catalog-table")).toContainText("Bandit 2590XP");
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f4a-telefon");
});
