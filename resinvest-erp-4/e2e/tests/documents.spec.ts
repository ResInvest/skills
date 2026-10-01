import { expect, test, type Page } from "@playwright/test";
import { ADMIN, expectNoHorizontalScroll, login, MANAGER, MANAGER_NEW_PASSWORD } from "./helpers";

/**
 * F4b-1 — operacje z dokumentami na prawdziwym stosie (magazyn RiC Zabrze po bilansie otwarcia z projektu „magazyn”):
 * zakup PZ z operacją dodatkową, produkcja RW + PW, sprzedaż WZ z numerem ręcznym i tonażem z wagi,
 * blokada przy braku towaru, zajęty numer ręczny, rejestr PZ / WZ w mocnych kolorach, telefon.
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

test("1. kierownik dodaje dostawcę (kartoteka) — potrzebny do zakupu", async () => {
  await go(mgr, "Kartoteki");
  await mgr.getByRole("tab", { name: "Kontrahenci", exact: true }).click();
  await mgr.locator("#cat-new").click();
  const dlg = mgr.getByRole("dialog");
  await dlg.getByLabel(/^Nazwa/).fill("Nadleśnictwo Rudziniec");
  await dlg.getByLabel(/^Rola/).selectOption("SUPPLIER");
  await mgr.locator("#cat-save").click();
  await expect(mgr.locator("#catalog-table")).toContainText("Nadleśnictwo Rudziniec");
});

test("1b. panel „Co jeszcze uzupełnić”: czerwone braki, przejście do pola, samouczek pod polami, telefon", async () => {
  await go(mgr, "Nowa operacja");
  const guide = mgr.locator("#op-guide");
  const step = (k: string) => guide.locator(`li[data-step="${k}"]`);
  await expect(step("date")).toHaveAttribute("data-state", "done");
  await expect(step("partner")).toHaveAttribute("data-state", "missing");
  await expect(step("partner")).toHaveClass(/g-next/);                       // pierwszy brak — „teraz”
  await expect(step("transport")).toHaveAttribute("data-state", "optional");
  await expect(mgr.locator("#op-guide-count")).toHaveText("brakuje: 4");    // dostawca, materiał, ilość, cena
  // kliknięcie kroku przenosi do pola i od razu pokazuje brak przy polu
  await step("material").getByRole("button").click();
  await expect(mgr.locator("#op-mat")).toBeFocused();
  await expect(mgr.locator("#op-form")).toContainText("Wybierz materiał");
  await mgr.locator("#op-partner").selectOption({ label: "Nadleśnictwo Rudziniec" });
  await expect(step("partner")).toHaveAttribute("data-state", "done");
  await expect(step("material")).toHaveClass(/g-next/);
  // pole odwiedzone i zostawione puste świeci od razu (bez klikania „Dalej”)
  await mgr.locator("#op-qty").focus();
  await mgr.locator("#op-price").focus();
  await expect(mgr.locator("#op-form")).toContainText("Podaj: ilość");
  // samouczek: opis pod polem, wyłączenie i ponowne włączenie (pamiętane po odświeżeniu)
  await expect(mgr.locator('[data-tut="op-qty"]')).toContainText("jednostkę magazynową");
  await mgr.locator("#tut-toggle").click();
  await expect(mgr.locator('[data-tut="op-qty"]')).toHaveCount(0);
  await mgr.reload();
  await expect(mgr.locator("#op-guide")).toBeVisible();
  await expect(mgr.locator('[data-tut="op-qty"]')).toHaveCount(0);
  await mgr.locator("#tut-toggle").click();
  await expect(mgr.locator('[data-tut="op-qty"]')).toBeVisible();
  // zmiana trybu transportu dodaje wymagane kroki transportu
  await mgr.locator("#tr-mode").selectOption("OWN");
  await expect(mgr.locator("#op-guide li[data-step='transport']")).toHaveAttribute("data-state", "missing");
  await mgr.locator("#tr-mode").selectOption("NONE");
  await shot(mgr, "f4d-nowa-operacja-prowadzenie");
  // telefon: lista nad formularzem, pasek braków na dole przenosi do pierwszego braku
  await mgr.setViewportSize({ width: 390, height: 844 });
  await expect(mgr.locator("#op-guide-next")).toContainText("Dostawca");
  await mgr.locator("#op-guide-next").click();
  await expect(mgr.locator("#op-partner")).toBeFocused();
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f4d-nowa-operacja-telefon");
  await mgr.setViewportSize({ width: 1280, height: 800 });
});

test("2. zakup PZ: 100 m³ × 120 zł + praca ładowarką 2 h × 150 zł — podgląd, podsumowanie, zapis, szczegóły", async () => {
  await go(mgr, "Nowa operacja");
  await expect(mgr.getByRole("tab", { name: /Zakup/ })).toHaveAttribute("aria-selected", "true");
  // walidacja domeny przy polach (ta sama funkcja co na serwerze)
  await mgr.locator("#op-next").click();
  await expect(mgr.locator("#op-form")).toContainText("Wybierz dostawcę");
  await mgr.locator("#op-partner").selectOption({ label: "Nadleśnictwo Rudziniec" });
  await mgr.locator("#op-mat").selectOption({ label: "Drewno opałowe (stan 817 m³)" });
  await mgr.locator("#op-qty").fill("100");
  await mgr.locator("#op-price").fill("120");
  await mgr.locator("#op-extra-add").click();
  await mgr.getByLabel("Rodzaj operacji dodatkowej 1").selectOption({ label: "Praca ładowarką" });
  await mgr.getByLabel(/^Ilość \(h\), operacja dodatkowa 1/).fill("2");
  await mgr.getByLabel("Stawka, operacja dodatkowa 1").fill("150");
  const live = mgr.locator("#op-live");
  await expect(live).toContainText("817 → 917");
  await expect(live).toContainText("12 000,00");
  await expect(live).toContainText("300,00");
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f4b-nowa-operacja-zakup");
  await mgr.locator("#op-next").click();
  const sum = mgr.locator("#op-summary");
  await expect(sum.locator("[data-number]")).toHaveText(/^PZ\/\d{3}\/\d{2}\/\d{4}$/);
  await expect(sum).toContainText("Praca ładowarką");
  await mgr.locator("#op-confirm").click();
  const detail = mgr.locator("#op-detail");
  await expect(detail).toContainText("Nadleśnictwo Rudziniec");
  await expect(mgr.locator("#op-extras")).toContainText("Praca ładowarką");
  await mgr.getByRole("dialog").getByRole("button", { name: "Zamknij" }).click();
  await expect(mgr.getByText(/Zapisano operację — dokumenty: PZ\//)).toBeVisible();
});

test("3. produkcja: 400 MP zrębki z drewna — zużycie 100 m³ (RW), przychód (PW)", async () => {
  await mgr.getByRole("tab", { name: /Produkcja/ }).click();
  await mgr.locator("#op-raw").selectOption({ label: "Drewno opałowe (stan 917 m³)" });
  await mgr.locator("#op-out").selectOption({ label: "Zrębka produkcyjna leśna" });
  await mgr.locator("#op-outqty").fill("400");
  await expect(mgr.locator("#op-live")).toContainText("Zużycie 100 m³ → produkcja 400 MP");
  await mgr.locator("#op-next").click();
  const sum = mgr.locator("#op-summary");
  await expect(sum.locator("[data-number]").first()).toHaveText(/^RW\//);
  await expect(sum.locator("[data-number]").nth(1)).toHaveText(/^PW\//);
  await mgr.locator("#op-confirm").click();
  await expect(mgr.locator("#op-detail")).toContainText("zużycie 100 m³");
  await mgr.getByRole("dialog").getByRole("button", { name: "Zamknij" }).click();
});

test("4. sprzedaż WZ z numerem ręcznym i tonażem z wagi (RĘCZNY); ten sam numer drugi raz — błąd przy polu", async () => {
  await mgr.getByRole("tab", { name: /Sprzedaż z magazynu/ }).click();
  await mgr.locator("#op-partner").selectOption({ label: "Elektrociepłownia Zabrze S.A." });
  await mgr.locator("#op-mat").selectOption({ label: "Zrębka produkcyjna leśna (stan 8 693 MP)" });
  await mgr.locator("#op-qty").fill("60");
  await mgr.locator("#op-price").fill("90");
  await mgr.locator("#op-weight").fill("19,8");
  await mgr.locator("#op-numbering").selectOption("MANUAL");
  await mgr.locator("#op-number").fill("WZ 7/2026");
  await expect(mgr.locator("#op-live")).toContainText("60 MP | 19,8 t | RĘCZNY");
  await mgr.locator("#op-next").click();
  await expect(mgr.locator("#op-summary [data-number]")).toHaveText("WZ 7/2026");
  await mgr.locator("#op-confirm").click();
  await expect(mgr.locator("#op-detail")).toContainText("19,8 t | RĘCZNY");
  await mgr.getByRole("dialog").getByRole("button", { name: "Zamknij" }).click();

  await mgr.locator("#op-partner").selectOption({ label: "Elektrociepłownia Zabrze S.A." });
  await mgr.locator("#op-mat").selectOption({ label: "Zrębka produkcyjna leśna (stan 8 633 MP)" });
  await mgr.locator("#op-qty").fill("1");
  await mgr.locator("#op-price").fill("90");
  await mgr.locator("#op-numbering").selectOption("MANUAL");
  await mgr.locator("#op-number").fill("wz 7/2026");
  await mgr.locator("#op-next").click();
  await expect(mgr.locator("#op-form")).toContainText(/Numer wz 7\/2026 jest już użyty w magazynie RiC Zabrze/);
  await expect(mgr.getByRole("dialog")).toHaveCount(0);
});

test("5. sprzedaż ponad stan — podsumowanie pokazuje brak, zatwierdzenie zablokowane", async () => {
  await mgr.locator("#op-numbering").selectOption("AUTO");
  await mgr.locator("#op-mat").selectOption({ label: "PKS (łupina palmowa) (stan 728 t)" });
  await mgr.locator("#op-qty").fill("1000");
  await mgr.locator("#op-next").click();
  const sum = mgr.locator("#op-summary");
  await expect(sum).toContainText(/PKS \(łupina palmowa\)/);
  await expect(sum.locator(".alert").first()).toContainText("728");
  await expect(mgr.locator("#op-confirm")).toBeDisabled();
  await mgr.getByRole("button", { name: "Wróć do edycji" }).click();
});

test("6. rejestr: PZ / WZ w mocnych kolorach, dokumenty pomocnicze na żądanie, szczegóły po kliknięciu numeru", async () => {
  await go(mgr, "Dokumenty");
  const table = mgr.locator("#docs-table");
  await expect(table.locator("tr.doc-row-WZ")).toContainText("WZ 7/2026");
  await expect(table.locator("tr.doc-row-PZ")).toContainText("Nadleśnictwo Rudziniec");
  await expect(table).not.toContainText("RW/");
  await expect(table.locator("tr.doc-row-PZ .badge.doc-PZ")).toHaveCSS("background-color", "rgb(21, 128, 61)");
  await expect(table.locator("tr.doc-row-WZ .badge.doc-WZ")).toHaveCSS("background-color", "rgb(194, 65, 12)");
  await mgr.locator("#doc-aux").check();
  await expect(table.locator("tr.doc-row-aux")).toContainText(["BO/ZAB/2026"]);
  await expect(table).toContainText("RW/");
  await expect(table).toContainText("PW/");
  await mgr.locator("#doc-aux").uncheck();
  await shot(mgr, "f4b-rejestr");
  await table.getByRole("button", { name: "WZ 7/2026" }).click();
  await expect(mgr.locator("#op-detail")).toContainText("Elektrociepłownia Zabrze S.A.");
  await expect(mgr.locator("#op-detail")).toContainText("60 MP | 19,8 t | RĘCZNY");
  await mgr.getByRole("dialog").getByRole("button", { name: "Zamknij" }).click();
});

test("7. stany po operacjach: drewno 817 + 100 − 100, zrębka 8 293 + 400 − 60", async () => {
  await go(mgr, "Stany magazynowe");
  await expect(mgr.locator("tr", { hasText: "Drewno opałowe" }).first()).toContainText("817");
  await expect(mgr.locator("tr", { hasText: "Zrębka produkcyjna leśna" }).first()).toContainText("8 633");
});

test("8. dziennik audytu (administrator): zapis operacji przez kierownika", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await login(admin, ADMIN.email, ADMIN.password);
  await go(admin, "Dziennik audytu");
  const row = admin.locator("tr", { hasText: "Operacja magazynowa — zapis" }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(MANAGER.email);
  await admin.context().close();
});

test("9. telefon (390 px): formularz i rejestr bez poziomego przewijania", async () => {
  await mgr.setViewportSize({ width: 390, height: 844 });
  await mgr.goto("/nowa-operacja");
  await expect(mgr.locator("#op-form")).toBeVisible();
  await mgr.locator("#op-extra-add").click();
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f4b-telefon-formularz");
  await mgr.goto("/dokumenty");
  await expect(mgr.locator("#docs-table")).toContainText("WZ 7/2026");
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f4b-telefon-rejestr");
});
