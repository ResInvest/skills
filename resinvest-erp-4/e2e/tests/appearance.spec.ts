import { expect, test, type Page } from "@playwright/test";
import { ADMIN, expectNoHorizontalScroll, login } from "./helpers";

/**
 * Wygląd i język: 5 motywów gotowych + motyw własny (kolor przewodni i kolor tła), języki PL / CS / EN.
 * Wybór zapisuje się na koncie (ten sam po odświeżeniu i na innym urządzeniu); przed zalogowaniem — przełącznik
 * języka na ekranie logowania. Projekt uruchamiany po wszystkich pozostałych; na końcu przywraca ustawienia konta.
 */
test.describe.configure({ mode: "serial" });

const cssVar = (page: Page, name: string) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const prefs = (page: Page) => page.evaluate(async () => (await (await fetch("/api/v1/auth/me", { credentials: "include" })).json()).user.prefs);

test("1. język: angielski i czeski z „Moje konto” — cały interfejs, zapis na koncie, po odświeżeniu bez zmian", async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole("link", { name: "Moje konto" }).click();
  await page.locator('[data-lang-card="en"]').click();
  await expect(page.getByRole("heading", { name: "My account", level: 1 })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Stock levels" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect.poll(() => prefs(page)).toMatchObject({ lang: "en" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Appearance and language" })).toBeVisible();
  await page.goto("/dokumenty");
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  // przełącznik w pasku górnym
  await page.locator('.topbar [data-lang="cs"]').click();
  await expect(page.getByRole("heading", { name: "Doklady", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hlavní navigace" }).getByRole("link", { name: "Skladové zásoby" })).toBeVisible();
  await expect.poll(() => prefs(page)).toMatchObject({ lang: "cs" });
  await page.locator('.topbar [data-lang="pl"]').click();
  await expect(page.getByRole("heading", { name: "Dokumenty", level: 1 })).toBeVisible();
});

test("2. motywy gotowe: Ultra Dark (czerń OLED) i Light Premium — zmiana od razu, zapis na koncie", async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/konto");
  await page.locator('[data-theme-card="ultra"]').click();
  await expect.poll(() => cssVar(page, "--bg")).toBe("#000000");
  await expect.poll(() => bodyBg(page)).toBe("rgb(0, 0, 0)");
  await expect.poll(() => prefs(page)).toMatchObject({ theme: "ultra" });
  await page.reload();
  await expect.poll(() => cssVar(page, "--bg")).toBe("#000000");
  await page.locator('[data-theme-card="premium"]').click();
  await expect.poll(() => cssVar(page, "--brand")).toBe("#1b2a4a");
  await expect.poll(() => prefs(page)).toMatchObject({ theme: "premium" });
});

test("3. motyw własny: kolor przewodni i kolor tła ustawiają program; tło o średniej jasności jest korygowane dla czytelności", async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/konto");
  await page.locator('[data-theme-card="custom"]').click();
  await expect(page.locator("#custom-theme")).toBeVisible();
  await page.locator("#theme-primary").fill("#7a1fa2");
  await page.locator("#theme-secondary").fill("#f4eefa");
  await expect.poll(() => cssVar(page, "--bg")).toBe("#f4eefa");          // podgląd na żywo, przed zapisem
  await expect.poll(() => cssVar(page, "--brand")).toBe("#7a1fa2");
  await page.locator("#theme-save").click();
  await expect(page.getByText("Zapisano motyw własny.")).toBeVisible();
  await expect.poll(() => prefs(page)).toMatchObject({ theme: "custom", themePrimary: "#7a1fa2", themeSecondary: "#f4eefa" });
  await page.reload();
  await expect.poll(() => cssVar(page, "--bg")).toBe("#f4eefa");
  // tło średnio jasne (#a54b00) — tekst byłby nieczytelny: tło skorygowane, komunikat
  await page.locator("#theme-secondary").fill("#a54b00");
  await expect(page.getByText(/tło zostało przyciemnione lub rozjaśnione/)).toBeVisible();
  expect(await cssVar(page, "--bg")).not.toBe("#a54b00");
  // ciemne tło → tryb ciemny (jasny tekst)
  await page.locator("#theme-secondary").fill("#0a0f16");
  await expect.poll(() => page.evaluate(() => document.documentElement.style.colorScheme)).toBe("dark");
  // wyjście bez zapisu przywraca zapisany motyw własny
  await page.goto("/");
  await expect.poll(() => cssVar(page, "--bg")).toBe("#f4eefa");
});

test("4. ekran logowania: przełącznik języka przed zalogowaniem, zapamiętany na urządzeniu", async ({ page }) => {
  await page.goto("/logowanie");
  await page.locator('[data-lang="en"]').click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/^Company e-mail address/)).toBeVisible();
  await page.locator('[data-lang="pl"]').click();
  await expect(page.getByRole("button", { name: "Zaloguj" })).toBeVisible();
});

test("5. telefon: sekcja wyglądu bez poziomego przewijania; przywrócenie ustawień konta", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/konto");
  await expect(page.locator("#appearance")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.locator('[data-theme-card="auto"]').click();
  await expect.poll(() => prefs(page)).toMatchObject({ theme: null, lang: "pl" });
});
