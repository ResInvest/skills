import { expect, test, type Page } from "@playwright/test";
import { ADMIN, expectNoHorizontalScroll, login, MANAGER, MANAGER_NEW_PASSWORD } from "./helpers";

/**
 * F4c — planer zakupów na prawdziwym stosie (kierownik RiC Zabrze). Dzisiejsze wykonanie pochodzi z operacji projektu
 * „produkcja”: zakup z produkcją 100 MP (2 750 zł) + sprzedaż bezpośrednia 120 MP (koszt surowca 2 500 zł) = 220 MP.
 * Inne operacje (zakup drewna bez produkcji, sprzedaż z magazynu, MM) nie wchodzą do planera.
 */
test.describe.configure({ mode: "serial" });
const go = (p: Page, name: string) => p.getByRole("navigation", { name: "Główna nawigacja" }).getByRole("link", { name, exact: true }).click();
const shot = async (p: Page, name: string) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }); };
let mgr: Page;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());

test.beforeAll(async ({ browser }) => {
  mgr = await (await browser.newContext()).newPage();
  await login(mgr, MANAGER.email, MANAGER_NEW_PASSWORD);
  await expect(mgr.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
});

test("1. tydzień: wykonanie z dokumentów, plan dnia wpisany ręcznie i zapisany, realizacja", async () => {
  await go(mgr, "Planer zakupów");
  const row = mgr.locator(`#pl-week tr[data-day="${today()}"]`);
  await expect(row.locator('td[data-label="Wykonanie"]')).toHaveText("220");
  await expect(row.locator('td[data-label="Tony"]')).toHaveText("72,6");
  await expect(row.locator('td[data-label="Wartość zakupu"]')).toHaveText("5250,00");   // pl-PL nie grupuje liczb 4-cyfrowych
  const input = row.getByLabel(/^Plan na/);
  await input.fill("250");
  await input.press("Enter");
  await expect(row.locator('td[data-label="Realizacja"]')).toHaveText("88,0%");
  await expect(mgr.locator("#pl-kpis")).toContainText("88,0%");
  await expect(mgr.locator("#pl-kpis")).toContainText("220 MP");
  await shot(mgr, "f4c-planer-tydzien");
  // po odświeżeniu plan jest w bazie (nie w przeglądarce)
  await mgr.reload();
  await expect(mgr.locator(`#pl-week tr[data-day="${today()}"]`).getByLabel(/^Plan na/)).toHaveValue("250");
  // błędna wartość — komunikat, plan bez zmian
  await mgr.locator(`#pl-week tr[data-day="${today()}"]`).getByLabel(/^Plan na/).fill("-5");
  await mgr.locator(`#pl-week tr[data-day="${today()}"]`).getByLabel(/^Plan na/).press("Enter");
  await expect(mgr.getByText(/Plan: liczba nie mniejsza od 0/)).toBeVisible();
});

test("2. dokumenty źródłowe dnia: PZ, RW, PW, WZ zakupu z produkcją i PW + WZ sprzedaży bezpośredniej", async () => {
  await mgr.reload();
  await mgr.locator(`#pl-week tr[data-day="${today()}"] button[data-open]`).click();
  const panel = mgr.locator("#pl-day");
  await expect(panel.locator("section")).toHaveCount(2);
  for (const t of ["PZ/", "RW/", "PW/", "WZ/"]) await expect(panel).toContainText(t);
  await expect(panel).toContainText("Nadl. Rudziniec · leśn. Kłodnica");
  await panel.getByRole("button", { name: "Zamknij" }).click();
});

test("3. miesiące i rok: bieżący miesiąc z planem 250 i wykonaniem 220, wykres i tabela 12 miesięcy", async () => {
  await mgr.getByRole("tab", { name: "Miesiące i rok" }).click();
  await expect(mgr.locator("#pl-months tbody tr")).toHaveCount(12);
  const m = Number(today().slice(5, 7)) - 1;
  const row = mgr.locator("#pl-months tbody tr").nth(m);
  await expect(row.locator('td[data-label="Plan"]')).toHaveText("250");
  await expect(row.locator('td[data-label="Wykonanie"]')).toHaveText("220");
  await expect(mgr.locator("#pl-chart svg")).toBeVisible();
  await expect(mgr.locator("#pl-period")).toHaveText(today().slice(0, 4));
  await shot(mgr, "f4c-planer-rok");
});

test("4. kierowcy i kursy oraz źródła danych", async () => {
  await mgr.getByRole("tab", { name: "Kierowcy i kursy" }).click();
  await expect(mgr.locator("#pl-fleet-week")).toBeVisible();
  await mgr.getByRole("tab", { name: "Skąd są dane" }).click();
  await expect(mgr.locator("#pl-sources")).toContainText("0,33 t/MP");
});

test("5. dziennik audytu (administrator): zmiana planu z wartością było / jest", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await login(admin, ADMIN.email, ADMIN.password);
  await go(admin, "Dziennik audytu");
  await expect(admin.locator("tr", { hasText: "Planer zakupów — zmiana planu" }).first()).toContainText(MANAGER.email);
  await admin.context().close();
});

test("6. telefon (390 px): planer bez poziomego przewijania strony", async () => {
  await mgr.setViewportSize({ width: 390, height: 844 });
  await mgr.goto("/planer-zakupow");
  await expect(mgr.locator("#pl-week")).toBeVisible();
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f4c-planer-telefon");
});
