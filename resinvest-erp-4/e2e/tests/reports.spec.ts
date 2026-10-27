import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, expectNoHorizontalScroll, login, MANAGER, MANAGER_NEW_PASSWORD, STOREKEEPER, STOREKEEPER_NEW_PASSWORD } from "./helpers";

/**
 * F6 — raporty na prawdziwym stosie (kierownik RiC Zabrze, dane z poprzednich projektów): pulpit miesiąca z kaflem
 * „Operacje dodatkowe”, obroty magazynowe z kontrolą spójności, zestawienie roczne, pobranie plików XLSX / PDF / DOCX / CSV
 * (rejestr wg filtrów), dziennik audytu, brak eksportu bez uprawnienia, telefon.
 */
test.describe.configure({ mode: "serial" });
const go = (p: Page, name: string) => p.getByRole("navigation", { name: "Główna nawigacja" }).getByRole("link", { name, exact: true }).click();
const shot = async (p: Page, name: string) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }); };
let mgr: Page;

test.beforeAll(async ({ browser }) => {
  mgr = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await login(mgr, MANAGER.email, MANAGER_NEW_PASSWORD);
  await expect(mgr.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
});

/** Kliknięcie przycisku eksportu → pobrany plik (nazwa, pierwsze bajty). */
const download = async (format: string, scope = mgr.locator("body")) => {
  const [d] = await Promise.all([mgr.waitForEvent("download"), scope.locator(`[data-export="${format}"]`).first().click()]);
  const bytes = readFileSync((await d.path())!);
  return { name: d.suggestedFilename(), bytes };
};

test("1. pulpit: miesiąc w liczbach, kafel „Operacje dodatkowe” (praca ładowarką z zakupu), stany", async () => {
  await go(mgr, "Pulpit");
  await expect(mgr.locator("#dash-kpis")).toContainText("Przychód");
  await expect(mgr.locator("#dash-extras")).toContainText("Praca ładowarką");
  await expect(mgr.locator("#dash-stock")).toContainText("Drewno opałowe");
  await shot(mgr, "f6-pulpit");
  // poprzedni miesiąc — kafel bez tegorocznych operacji dodatkowych z bieżącego miesiąca
  await mgr.getByRole("button", { name: "Poprzedni miesiąc" }).click();
  await expect(mgr.locator("#dash-extras")).not.toContainText("Praca ładowarką");
});

test("2. obroty magazynowe miesiąca: tabela, zgodność z saldami, eksport Excel i PDF", async () => {
  await go(mgr, "Raporty");
  await expect(mgr.locator("#rp-turnover tr[data-material='DRW-O']")).toBeVisible();
  await expect(mgr.locator("#rp-check")).toContainText("zgodne z saldami");
  await shot(mgr, "f6-obroty");
  const x = await download("xlsx");
  expect(x.name).toMatch(/^obroty_ZAB_\d{4}-\d{2}-01_\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(x.bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  const p = await download("pdf");
  expect(p.bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  // rok i zakres dat
  await mgr.locator("#rp-period").selectOption("year");
  await expect(mgr.locator("#rp-range")).toContainText("-01-01 –");
});

test("3. miesiące i rok: bieżący miesiąc z operacjami, suma roku, eksport Word", async () => {
  await mgr.locator("#rp-tab-summary").click();
  const m = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date()).slice(5, 7));
  await expect(mgr.locator(`#rp-summary tr[data-month="${m}"] td[data-label="Operacje"]`)).not.toHaveText("");
  await expect(mgr.locator("#rp-summary tfoot")).toContainText("Rok");
  const d = await download("docx");
  expect(d.name).toMatch(/^zestawienie_ZAB_\d{4}\.docx$/);
  expect(d.bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  await shot(mgr, "f6-rok");
});

test("4. rejestr dokumentów: eksport CSV wg filtra typu (tylko PZ)", async () => {
  await go(mgr, "Dokumenty");
  await mgr.getByLabel("Typ dokumentu").selectOption("PZ");
  const c = await download("csv");
  expect(c.name).toMatch(/^rejestr_ZAB_.*\.csv$/);
  const text = c.bytes.toString("utf8");
  expect(text).toContain("Nr dokumentu;Typ;Data ruchu");
  expect(text).toMatch(/PZ\/\d{3}\/\d{2}\/\d{4};PZ;/);
  expect(text).not.toMatch(/;WZ;/);
});

test("5. dziennik audytu (administrator): eksport raportu", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await login(admin, ADMIN.email, ADMIN.password);
  await go(admin, "Dziennik audytu");
  await expect(admin.locator("tr", { hasText: "Eksport raportu" }).first()).toContainText(MANAGER.email);
  await admin.context().close();
});

test("6. konto bez uprawnienia eksportu widzi raporty, ale bez przycisków eksportu", async ({ browser }) => {
  const sk = await (await browser.newContext()).newPage();
  await login(sk, STOREKEEPER.email, STOREKEEPER_NEW_PASSWORD);
  await expect(sk.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
  await sk.goto("/raporty");
  await expect(sk.locator("#rp-turnover")).toBeVisible();
  await expect(sk.locator("[data-export]")).toHaveCount(0);
  await sk.context().close();
});

test("7. telefon (390 px): pulpit i raporty bez poziomego przewijania", async () => {
  await mgr.setViewportSize({ width: 390, height: 844 });
  await mgr.goto("/");
  await expect(mgr.locator("#dash-kpis")).toBeVisible();
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f6-pulpit-telefon");
  await mgr.goto("/raporty");
  await expect(mgr.locator("#rp-turnover")).toBeVisible();
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f6-raporty-telefon");
});
