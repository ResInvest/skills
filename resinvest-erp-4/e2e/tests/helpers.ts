import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
export const STATE = resolve(here, "../.state");

export const ADMIN = { email: "admin.e2e@resinvest.group", password: "Plac-Zrebki-2026" };
export const MANAGER = { email: "kierownik.zabrze@resinvest.group", first: "Karol", last: "Kierownik", password: "Waga-Kontrola-2026" };
/** Hasło kierownika po wymuszonej zmianie w scenariuszu 6 tożsamości (używane przez kolejne projekty testów). */
export const MANAGER_NEW_PASSWORD = "Waga-Kontrola-Nowa-27";
export const STOREKEEPER = { email: "magazynier.braszewice@resinvest.group", first: "Marek", last: "Magazynier", password: "Brasz-Suwnica-26" };
/** Hasło magazyniera po resecie z e-maila w scenariuszu 8 tożsamości (używane przez kolejne projekty testów). */
export const STOREKEEPER_NEW_PASSWORD = "Brasz-Suwnica-Nowa-27";

export const adminLink = (): string => readFileSync(resolve(STATE, "admin-link.txt"), "utf8").trim();

/** Treść tekstowa wiadomości .eml (transport „file”): nagłówek To + część text/plain (base64). */
function readMails(): { to: string; text: string; file: string }[] {
  const dir = resolve(STATE, "mail");
  let files: string[];
  try { files = readdirSync(dir).filter(f => f.endsWith(".eml")).sort(); } catch { return []; }
  return files.map(f => {
    const raw = readFileSync(resolve(dir, f), "utf8");
    const to = /^To: (.+)$/m.exec(raw)?.[1]?.trim() ?? "";
    const part = /Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/.exec(raw)?.[1] ?? "";
    return { to, text: Buffer.from(part.replace(/\s/g, ""), "base64").toString("utf8"), file: f };
  });
}

/** Najnowszy link z poczty do adresata (kolejka wysyła co 5 s — czekamy do 30 s). */
export async function mailLink(to: string, path: "/aktywacja" | "/reset-hasla", after = 0): Promise<string> {
  let found: string | undefined;
  await expect.poll(() => {
    const mails = readMails().filter(m => m.to === to).slice(after);
    found = mails.map(m => new RegExp(`https?://\\S+${path}\\?token=[A-Za-z0-9_%-]+`).exec(m.text)?.[0]).filter(Boolean).pop();
    return !!found;
  }, { timeout: 30_000, message: `brak wiadomości ${path} do ${to}` }).toBe(true);
  return found as string;
}
export const mailCount = (to: string): number => readMails().filter(m => m.to === to).length;

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/logowanie");
  await page.getByLabel(/^Firmowy adres e-mail/).fill(email);
  await page.getByLabel(/^Hasło/).fill(password);
  await page.getByRole("button", { name: "Zaloguj" }).click();
}

/** Brak poziomego przewijania strony (wymaganie responsywności). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, "poziome przewijanie strony").toBeLessThanOrEqual(cw);
}
