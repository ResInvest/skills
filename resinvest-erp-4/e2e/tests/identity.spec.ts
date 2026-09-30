import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, adminLink, expectNoHorizontalScroll, login, mailCount, mailLink, MANAGER, STOREKEEPER } from "./helpers";

/**
 * Faza F2 — tożsamość, scenariusze §34/§35 przeniesione z 3.x na prawdziwym stosie (PostgreSQL + API + build frontendu).
 * Kolejność ma znaczenie: każdy krok korzysta ze stanu poprzedniego (jak w rzeczywistym wdrożeniu).
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
/** Przejście przez główną nawigację (na pulpicie te same nazwy mają też skróty). */
const go = (p: Page, name: string) => p.getByRole("navigation", { name: "Główna nawigacja" }).getByRole("link", { name }).click();
const newPage = async (browser: Browser) => (await browser.newContext()).newPage();

test.beforeAll(async ({ browser }) => { admin = await newPage(browser); });

test("1. pierwszy administrator: link z CLI, token usunięty z adresu, link jednorazowy", async ({ browser }) => {
  const link = adminLink();
  await admin.goto(link);
  await expect(admin.getByRole("heading", { name: "Aktywacja konta" })).toBeVisible();
  await expect(admin.getByText(ADMIN.email)).toBeVisible();
  expect(new URL(admin.url()).search).toBe(""); // token nie zostaje w pasku adresu ani historii
  await admin.getByLabel(/^Nowe hasło/).fill("krotkie1");
  await admin.getByLabel(/^Powtórz hasło/).fill("krotkie1");
  await admin.getByRole("button", { name: "Aktywuj konto" }).click();
  await expect(admin.getByRole("alert")).toContainText(/12 znaków/); // polityka haseł po stronie serwera
  await admin.getByLabel(/^Nowe hasło/).fill(ADMIN.password);
  await admin.getByLabel(/^Powtórz hasło/).fill(ADMIN.password);
  await admin.getByRole("button", { name: "Aktywuj konto" }).click();
  await expect(admin.getByText("Konto zostało aktywowane")).toBeVisible();

  const other = await newPage(browser);
  await other.goto(link);
  await expect(other.getByRole("alert")).toContainText("Link został już wykorzystany");
  await other.context().close();
});

test("2. logowanie: domena spoza firmy, złe hasło, poprawne — pełne menu administratora", async () => {
  await login(admin, "ktos@gmail.com", "cokolwiek-123456");
  await expect(admin.getByRole("alert")).toContainText("Wymagany e-mail firmowy (@resinvest.group)");
  await login(admin, ADMIN.email, "Zle-Haslo-2026");
  await expect(admin.getByRole("alert")).toContainText("Nieprawidłowy e-mail lub hasło");
  await login(admin, ADMIN.email, ADMIN.password);
  await expect(admin.getByRole("heading", { name: "Dzień dobry, Administrator" })).toBeVisible();
  const nav = admin.getByRole("navigation", { name: "Główna nawigacja" });
  for (const t of ["Użytkownicy", "Role i uprawnienia", "Dziennik audytu", "Moje konto"]) await expect(nav.getByRole("link", { name: t })).toBeVisible();
  await expect(admin.getByText("RiC Zabrze")).toBeVisible();
  await expect(admin.getByText("połączona")).toBeVisible(); // stan bazy
  await expectNoHorizontalScroll(admin);
});

async function invite(u: { email: string; first: string; last: string }, role: string, warehouse: string) {
  await go(admin, "Użytkownicy");
  await admin.getByRole("button", { name: "Zaproś użytkownika" }).click();
  const d = admin.getByRole("dialog", { name: "Zaproś użytkownika" });
  await d.getByLabel(/^Firmowy e-mail/).fill(u.email);
  await d.getByLabel(/^Imię/).fill(u.first);
  await d.getByLabel(/^Nazwisko/).fill(u.last);
  await d.getByLabel(/^Rola/).selectOption({ label: role });
  await d.getByLabel(warehouse).check();
  await d.getByRole("button", { name: "Wyślij zaproszenie" }).click();
  await expect(admin.getByRole("heading", { name: `${u.first} ${u.last}` })).toBeVisible();
  await expect(admin.locator(".badge", { hasText: "zaproszony" })).toBeVisible();
}

async function activate(page: Page, email: string, password: string) {
  await page.goto(await mailLink(email, "/aktywacja"));
  await expect(page.getByText(email)).toBeVisible();
  await page.getByLabel(/^Nowe hasło/).fill(password);
  await page.getByLabel(/^Powtórz hasło/).fill(password);
  await page.getByRole("button", { name: "Aktywuj konto" }).click();
  await expect(page.getByText("Konto zostało aktywowane")).toBeVisible();
}

test("3. zaproszenia e-mail: kierownik (Zabrze) i magazynier (Brąszewice) aktywują konta z linków", async ({ browser }) => {
  await invite(MANAGER, "Manager", "RiC Zabrze");
  await invite(STOREKEEPER, "Magazynier", "RiC Brąszewice");
  // zaproszony nie zaloguje się przed aktywacją
  const p = await newPage(browser);
  await login(p, MANAGER.email, "Dowolne-Haslo-2026");
  await expect(p.getByRole("alert")).toContainText("Nieprawidłowy e-mail lub hasło");
  await activate(p, MANAGER.email, MANAGER.password);
  await activate(p, STOREKEEPER.email, STOREKEEPER.password);
  await p.context().close();
});

test("4. izolacja magazynów: kierownik widzi tylko swój magazyn, bez audytu i bez edycji ról", async ({ browser }) => {
  const m = await newPage(browser);
  await login(m, MANAGER.email, MANAGER.password);
  await expect(m.getByRole("heading", { name: "Dzień dobry, Karol" })).toBeVisible();
  const nav = m.getByRole("navigation", { name: "Główna nawigacja" });
  await expect(nav.getByRole("link", { name: "Dziennik audytu" })).toHaveCount(0);
  await expect(m.locator(".tiles")).toContainText("RiC Zabrze");
  await expect(m.locator(".tiles")).not.toContainText("RiC Brąszewice");

  await go(m, "Użytkownicy");
  await expect(m.getByRole("table")).toContainText(MANAGER.email);
  await expect(m.getByRole("table")).toContainText(ADMIN.email);
  await expect(m.getByRole("table")).not.toContainText(STOREKEEPER.email); // magazynier z innego magazynu
  await expect(m.getByRole("button", { name: "Zaproś użytkownika" })).toHaveCount(0); // Manager: users.read bez users.manage

  await go(m, "Role i uprawnienia");
  await expect(m.getByRole("table", { name: "Macierz uprawnień" })).toBeVisible();
  await expect(m.getByRole("button", { name: "Edytuj uprawnienia" })).toHaveCount(0);

  await m.goto("/audyt");
  await expect(m.getByRole("heading", { name: "Brak uprawnień" })).toBeVisible();
  // API potwierdza izolację niezależnie od interfejsu
  const r = await m.request.get("/api/v1/audit", { headers: { "X-Requested-With": "ResInvestERP" } });
  expect(r.status()).toBe(403);
  await m.context().close();
});

test("5. administrator nie zmieni własnej roli ani statusu", async () => {
  await go(admin, "Użytkownicy");
  await admin.getByRole("link", { name: /Systemu Administrator/ }).click();
  await expect(admin.getByText("To Twoje konto")).toBeVisible();
  await expect(admin.getByLabel(/^Rola/)).toBeDisabled();
  await expect(admin.getByLabel(/^Status/)).toBeDisabled();
});

test("6. wymuszona zmiana hasła i wylogowanie ze wszystkich urządzeń", async ({ browser }) => {
  const m = await newPage(browser);
  await login(m, MANAGER.email, MANAGER.password);
  await expect(m.getByRole("heading", { name: "Dzień dobry, Karol" })).toBeVisible();

  await go(admin, "Użytkownicy");
  await admin.getByRole("link", { name: /Kierownik Karol/ }).click();
  await admin.getByRole("button", { name: "Wymuś zmianę hasła" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Potwierdź" }).click();
  await expect(admin.getByText("Wymuszono zmianę hasła.")).toBeVisible();

  await m.reload();
  await expect(m.getByRole("heading", { name: "Wymagana zmiana hasła" })).toBeVisible();
  await m.getByLabel(/^Obecne hasło/).fill(MANAGER.password);
  MANAGER.password = "Waga-Kontrola-Nowa-27";
  await m.getByLabel(/^Nowe hasło/).fill(MANAGER.password);
  await m.getByLabel(/^Powtórz nowe hasło/).fill(MANAGER.password);
  await m.getByRole("button", { name: "Zmień hasło" }).click();
  await expect(m.getByRole("heading", { name: "Dzień dobry, Karol" })).toBeVisible();

  await go(m, "Moje konto");
  await expect(m.getByText("ta sesja")).toBeVisible();

  await admin.reload();
  await admin.getByRole("button", { name: "Wyloguj ze wszystkich urządzeń" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Potwierdź" }).click();
  await expect(admin.getByText("Sesje zakończone.")).toBeVisible();
  await go(m, "Pulpit");
  await m.reload();
  await expect(m.getByRole("heading", { name: "Logowanie" })).toBeVisible();
  await m.context().close();
});

test("7. blokada po 5 nieudanych próbach, odblokowanie przez administratora", async ({ browser }) => {
  const p = await newPage(browser);
  for (let i = 0; i < 5; i++) {
    await login(p, STOREKEEPER.email, `Zle-Haslo-${i}-2026`);
    await expect(p.getByRole("alert")).toBeVisible();
  }
  await login(p, STOREKEEPER.email, STOREKEEPER.password);
  await expect(p.getByRole("alert")).toContainText("zablokowane");

  await go(admin, "Użytkownicy");
  await admin.getByRole("link", { name: /Magazynier Marek/ }).click();
  await expect(admin.locator(".badge", { hasText: "zablokowany" })).toBeVisible();
  await admin.getByRole("button", { name: "Odblokuj logowanie" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Potwierdź" }).click();
  await expect(admin.getByText("Konto odblokowane.")).toBeVisible();

  await login(p, STOREKEEPER.email, STOREKEEPER.password);
  await expect(p.getByRole("heading", { name: "Dzień dobry, Marek" })).toBeVisible();
  await p.context().close();
});

test("8. reset hasła z e-maila: ta sama odpowiedź dla nieistniejącego konta, nowe hasło działa", async ({ browser }) => {
  const p = await newPage(browser);
  await p.goto("/zapomnialem-hasla");
  await p.getByLabel(/^Firmowy adres e-mail/).fill("nie.istnieje@resinvest.group");
  await p.getByRole("button", { name: "Wyślij link" }).click();
  const same = await p.getByRole("status").textContent();

  const before = mailCount(STOREKEEPER.email);
  await p.goto("/zapomnialem-hasla");
  await p.getByLabel(/^Firmowy adres e-mail/).fill(STOREKEEPER.email);
  await p.getByRole("button", { name: "Wyślij link" }).click();
  await expect(p.getByRole("status")).toHaveText(same ?? "");

  await p.goto(await mailLink(STOREKEEPER.email, "/reset-hasla", before));
  await expect(p.getByRole("heading", { name: "Ustaw nowe hasło" })).toBeVisible();
  STOREKEEPER.password = "Brasz-Suwnica-Nowa-27";
  await p.getByLabel(/^Nowe hasło/).fill(STOREKEEPER.password);
  await p.getByLabel(/^Powtórz hasło/).fill(STOREKEEPER.password);
  await p.getByRole("button", { name: "Zapisz hasło" }).click();
  await expect(p.getByText("Hasło zostało zmienione")).toBeVisible();
  await login(p, STOREKEEPER.email, STOREKEEPER.password);
  await expect(p.getByRole("heading", { name: "Dzień dobry, Marek" })).toBeVisible();
  await p.context().close();
});

test("9. zmiana roli przez administratora i dziennik audytu (działania + logowania)", async () => {
  await go(admin, "Użytkownicy");
  await admin.getByRole("link", { name: /Magazynier Marek/ }).click();
  await admin.getByLabel(/^Rola/).selectOption({ label: "Obserwator" });
  await admin.getByRole("button", { name: "Zapisz zmiany" }).click();
  await expect(admin.getByText("Zapisano zmiany.")).toBeVisible();

  await go(admin, "Dziennik audytu");
  const table = admin.getByRole("table");
  for (const t of ["Zmiana roli", "Zaproszenie użytkownika", "Aktywacja konta", "Blokada konta", "Odblokowanie konta", "Reset hasła", "Wymuszenie zmiany hasła", "Utworzenie pierwszego administratora"])
    await expect(table.getByText(t, { exact: true }).first()).toBeVisible();
  await admin.getByPlaceholder("Szukaj: e-mail, akcja, powód").fill("ROLE_CHANGED");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("OBSERWATOR");

  await admin.getByRole("tab", { name: "Logowania" }).click();
  await admin.getByLabel("Wynik").selectOption("false");
  await expect(admin.getByRole("table")).toContainText("złe hasło");
  await expect(admin.getByRole("table")).toContainText("domena spoza firmy");
  await expect(admin.getByRole("table")).toContainText("konto zablokowane");
});

test("9b. równoczesna edycja tego samego konta: druga zmiana odrzucona (wersja), bez nadpisania", async () => {
  const other = await admin.context().newPage();
  await go(admin, "Użytkownicy");
  await admin.getByRole("link", { name: /Magazynier Marek/ }).click();
  await expect(admin.getByLabel(/^Imię/)).toHaveValue("Marek");
  await other.goto(admin.url());
  await other.getByLabel(/^Nazwisko/).fill("Magazynier-Kowalski");
  await other.getByRole("button", { name: "Zapisz zmiany" }).click();
  await expect(other.getByText("Zapisano zmiany.")).toBeVisible();

  await admin.getByLabel(/^Imię/).fill("Mariusz");
  await admin.getByRole("button", { name: "Zapisz zmiany" }).click();
  await expect(admin.getByRole("alert")).toContainText("wprowadź zmiany ponownie");
  await expect(admin.getByLabel(/^Nazwisko/)).toHaveValue("Magazynier-Kowalski"); // formularz z aktualnymi danymi
  await expect(admin.getByLabel(/^Imię/)).toHaveValue("Marek"); // zmiana na nieaktualnej wersji nie została zapisana
  await other.close();
});

test("10. wylogowanie kończy sesję po stronie serwera", async () => {
  await admin.getByRole("button", { name: "Wyloguj", exact: true }).click();
  await expect(admin.getByRole("heading", { name: "Logowanie" })).toBeVisible();
  const r = await admin.request.get("/api/v1/auth/me", { headers: { "X-Requested-With": "ResInvestERP" } });
  expect(r.status()).toBe(401);
});
