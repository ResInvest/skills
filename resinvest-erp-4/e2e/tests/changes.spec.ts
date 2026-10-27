import { expect, test, type Page } from "@playwright/test";
import { ADMIN, expectNoHorizontalScroll, login, MANAGER, MANAGER_NEW_PASSWORD } from "./helpers";

/**
 * F5 — korekta (BYŁO / JEST) i usunięcie na prawdziwym stosie (kierownik RiC Zabrze): zakup 10 m³ → korekta do 8 m³
 * z formularza wypełnionego danymi dokumentu (powód w liście kontrolnej), historia zmian, zakładki „Korekty”, „Edytowane”,
 * usunięcie z powodem i odwróceniem ruchów, zakładka „Usunięte”, dziennik audytu, telefon.
 */
test.describe.configure({ mode: "serial" });
const go = (p: Page, name: string) => p.getByRole("navigation", { name: "Główna nawigacja" }).getByRole("link", { name, exact: true }).click();
const shot = async (p: Page, name: string) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }); };
let mgr: Page;
let number = "";

test.beforeAll(async ({ browser }) => {
  mgr = await (await browser.newContext()).newPage();
  await login(mgr, MANAGER.email, MANAGER_NEW_PASSWORD);
  await expect(mgr.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
});

const openDoc = async () => {
  await go(mgr, "Dokumenty");
  await mgr.locator("#docs-tab-register").click();
  await mgr.locator("#docs-table").getByRole("button", { name: number, exact: true }).click();
  await expect(mgr.locator("#op-detail")).toBeVisible();
};

test("1. zakup 10 m³ × 100 zł", async () => {
  await go(mgr, "Nowa operacja");
  await mgr.locator("#op-partner").selectOption({ label: "Nadleśnictwo Rudziniec" });
  const v = await mgr.locator("#op-mat option", { hasText: "Drewno opałowe" }).getAttribute("value");
  await mgr.locator("#op-mat").selectOption(v!);
  await mgr.locator("#op-qty").fill("10");
  await mgr.locator("#op-price").fill("100");
  await mgr.locator("#op-next").click();
  number = (await mgr.locator("#op-summary [data-number]").first().textContent()) ?? "";
  expect(number).toMatch(/^PZ\//);
  await mgr.locator("#op-confirm").click();
  await expect(mgr.locator("#op-detail")).toContainText("Nadleśnictwo Rudziniec");
  await mgr.getByRole("dialog").getByRole("button", { name: "Zamknij" }).click();
});

test("2. korekta: formularz z danymi dokumentu, powód w liście kontrolnej, BYŁO / JEST, historia zmian", async () => {
  await openDoc();
  await mgr.locator("#op-correct").click();
  await expect(mgr.getByRole("heading", { name: new RegExp(`Korekta — ${number.replace(/\//g, "\\/")}`) })).toBeVisible();
  await expect(mgr.locator("#op-qty")).toHaveValue("10");
  await expect(mgr.locator("#op-wh")).toBeDisabled();
  await expect(mgr.locator("#op-guide li[data-step='reason']")).toHaveAttribute("data-state", "missing");
  await mgr.locator("#op-qty").fill("8");
  await mgr.locator("#op-next").click();                                    // bez powodu — nie przechodzi dalej
  await expect(mgr.locator("#op-form")).toContainText("Podaj powód");
  await mgr.locator("#op-reason").fill("błędna ilość z kwitu wagowego");
  await expect(mgr.locator("#op-guide li[data-step='reason']")).toHaveAttribute("data-state", "done");
  await shot(mgr, "f5-korekta-formularz");
  await mgr.locator("#op-next").click();
  const ch = mgr.locator("#op-changes");
  await expect(ch.locator("tr", { hasText: "PZ — ilość" })).toContainText("10 m³");
  await expect(ch.locator("tr", { hasText: "PZ — ilość" })).toContainText("8 m³");
  await shot(mgr, "f5-korekta-podsumowanie");
  await mgr.locator("#op-confirm").click();
  await expect(mgr.getByText(/Zapisano korektę — dokumenty:/)).toBeVisible();
  await expect(mgr.locator("#op-status")).toContainText("korygowany");
  await expect(mgr.locator("#op-history")).toContainText(/KOR\/\d{3}\//);
  await expect(mgr.locator("#op-history")).toContainText("błędna ilość z kwitu wagowego");
  await mgr.getByRole("dialog").getByRole("button", { name: "Zamknij" }).click();
});

test("3. rejestr: oznaczenie „korygowany”, zakładki Korekty i Edytowane", async () => {
  await go(mgr, "Dokumenty");
  await expect(mgr.locator("#docs-table tr", { hasText: number })).toContainText("korygowany");
  await mgr.locator("#docs-tab-corrections").click();
  const row = mgr.locator("#changes-corrections-table > tbody > tr", { hasText: number });
  await expect(row).toContainText("błędna ilość z kwitu wagowego");
  await expect(row).toContainText("8 m³");
  await shot(mgr, "f5-zakladka-korekty");
  await mgr.locator("#docs-tab-edited").click();
  await expect(mgr.locator("#changes-edited-table")).toContainText(number);
});

test("4. usunięcie: powód wymagany, ruchy odwrócone, dokument w zakładce Usunięte", async () => {
  await openDoc();
  await mgr.locator("#op-delete").click();
  await mgr.locator("#del-confirm").click();
  await expect(mgr.locator("#op-delete-form")).toContainText("Podaj powód");
  await mgr.locator("#del-reason").fill("zakup wprowadzony w złym magazynie");
  await mgr.locator("#del-confirm").click();
  await expect(mgr.locator("#op-deleted")).toContainText("zakup wprowadzony w złym magazynie");
  await expect(mgr.locator("#op-status")).toContainText("usunięty");
  await expect(mgr.locator("#op-correct")).toHaveCount(0);
  await mgr.getByRole("dialog").getByRole("button", { name: "Zamknij" }).click();
  await expect(mgr.locator("#docs-table")).not.toContainText(number);
  await mgr.locator("#docs-tab-deleted").click();
  await expect(mgr.locator("#changes-deleted-table tr", { hasText: number })).toContainText("zakup wprowadzony w złym magazynie");
});

test("5. dziennik audytu (administrator): korekta i usunięcie", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await login(admin, ADMIN.email, ADMIN.password);
  await go(admin, "Dziennik audytu");
  await expect(admin.locator("tr", { hasText: "Korekta dokumentu (było / jest)" }).first()).toContainText(MANAGER.email);
  await expect(admin.locator("tr", { hasText: "Usunięcie dokumentu (odwrócenie ruchów)" }).first()).toContainText("zakup wprowadzony w złym magazynie");
  await admin.context().close();
});

test("6. telefon (390 px): zakładki korekt bez poziomego przewijania", async () => {
  await mgr.setViewportSize({ width: 390, height: 844 });
  await mgr.goto("/dokumenty");
  await mgr.locator("#docs-tab-corrections").click();
  await expect(mgr.locator("#changes-corrections-table")).toBeVisible();
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, "f5-korekty-telefon");
});
