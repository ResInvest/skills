import { expect, test } from "@playwright/test";
import { ADMIN, expectNoHorizontalScroll, login } from "./helpers";

/** Telefon 390 px: menu rozwijane, tabele jako karty, brak poziomego przewijania (dane z projektu „desktop”). */
test("telefon: logowanie, menu, użytkownicy, audyt, konto — bez poziomego przewijania", async ({ page }) => {
  await page.goto("/logowanie");
  await expectNoHorizontalScroll(page);
  await login(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole("heading", { name: "Dzień dobry, Administrator" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  const nav = page.getByRole("navigation", { name: "Główna nawigacja" });
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Użytkownicy" }).click();
  await expect(nav).toBeHidden(); // menu zamyka się po wyborze
  await expect(page.getByRole("heading", { name: "Użytkownicy" })).toBeVisible();
  await expect(page.locator("td[data-label='Użytkownik']").first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  for (const [link, heading] of [["Dziennik audytu", "Dziennik audytu"], ["Moje konto", "Moje konto"], ["Role i uprawnienia", "Role i uprawnienia"]] as const) {
    await page.getByRole("button", { name: "Menu" }).click();
    await nav.getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
  await page.screenshot({ path: "test-results/telefon-role.png", fullPage: true });
});
