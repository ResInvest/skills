import { I18nProvider } from "../i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import type { Me } from "../api/types";
import { SessionProvider } from "../auth/session";
import { AppRoutes } from "./App";
import { createQueryClient } from "./query";

/** Atrapa API: trasa "METODA /ścieżka" → [status, treść]. Zapisuje wywołania (do sprawdzenia nagłówków CSRF). */
function mockApi(routes: Record<string, [number, unknown] | ((body: unknown) => [number, unknown])>) {
  const calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const path = url.replace(/^\/api\/v1/, "").split("?")[0] ?? "";
    const body = init.body ? JSON.parse(init.body as string) as unknown : undefined;
    calls.push({ method, path, body, headers: init.headers as Record<string, string> });
    const r = routes[`${method} ${path}`];
    const [status, data] = typeof r === "function" ? r(body) : r ?? [404, { ok: false, code: "NOT_FOUND", error: "Nie znaleziono." }];
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}

const me = (over: Partial<Me> = {}): Me => ({
  id: "u1", email: "jan.kowalski@resinvest.pl", firstName: "Jan", lastName: "Kowalski", role: { code: "MAGAZYNIER", name: "Magazynier", global: false },
  permissions: ["report.view"], warehouseIds: ["w1"], defaultWarehouseId: "w1", mustChangePassword: false,
  prefs: { lang: "pl", theme: null, themePrimary: null, themeSecondary: null }, ...over,
});
const COMMON = {
  "GET /auth/config": [200, { ok: true, companyDomains: ["resinvest.pl"], allowSelfRegistration: false, passwordRules: "Min. 12 znaków" }],
  "GET /warehouses": [200, { ok: true, warehouses: [{ id: "w1", code: "ZAB", name: "RiC Zabrze", address: null, active: true }] }],
  "GET /health": [200, { ok: true, version: "4.0.0", time: "2026-09-30T10:00:00Z", database: { ok: true, latencyMs: 1, migrations: 2, pendingCheck: null } }],
} satisfies Record<string, [number, unknown]>;

const view = (path: string) => render(
  <QueryClientProvider client={createQueryClient()}>
    <MemoryRouter initialEntries={[path]}><SessionProvider><I18nProvider initial="pl"><AppRoutes /></I18nProvider></SessionProvider></MemoryRouter>
  </QueryClientProvider>,
);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

describe("routing i sesja", () => {
  it("bez sesji przekierowuje na ekran logowania", async () => {
    mockApi({ ...COMMON, "GET /auth/me": [401, { ok: false, code: "AUTH", error: "Sesja wygasła" }] });
    view("/uzytkownicy");
    expect(await screen.findByRole("heading", { name: "Logowanie" })).toBeTruthy();
    expect(await screen.findByText(/Dozwolone domeny: @resinvest\.pl/)).toBeTruthy();
  });

  it("logowanie: nagłówek CSRF, błąd serwera, po sukcesie pulpit", async () => {
    let attempts = 0;
    const calls = mockApi({
      ...COMMON,
      "GET /auth/me": [401, { ok: false, code: "AUTH", error: "x" }],
      "POST /auth/login": () => (++attempts === 1 ? [401, { ok: false, code: "BAD_CREDENTIALS", error: "Nieprawidłowy e-mail lub hasło." }] : [200, { ok: true, user: me() }]),
    });
    view("/");
    fireEvent.change(await screen.findByLabelText(/Firmowy adres e-mail/), { target: { value: "jan.kowalski@resinvest.pl" } });
    fireEvent.change(screen.getByLabelText(/^Hasło/), { target: { value: "zle-haslo" } });
    fireEvent.click(screen.getByRole("button", { name: "Zaloguj" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Nieprawidłowy e-mail lub hasło/);
    fireEvent.change(screen.getByLabelText(/^Hasło/), { target: { value: "Plac-Zrebki-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Zaloguj" }));
    expect(await screen.findByRole("heading", { name: "Dzień dobry, Jan" })).toBeTruthy();
    const login = calls.find(c => c.path === "/auth/login");
    expect(login?.headers["X-Requested-With"]).toBe("ResInvestERP");
  });

  it("nawigacja zależy od uprawnień z serwera; ekran bez uprawnienia — komunikat", async () => {
    mockApi({ ...COMMON, "GET /auth/me": [200, { ok: true, user: me() }] });
    view("/audyt");
    expect(await screen.findByRole("heading", { name: "Brak uprawnień" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Główna nawigacja" });
    expect(nav.textContent).toContain("Pulpit");
    expect(nav.textContent).not.toContain("Użytkownicy");
    expect(nav.textContent).not.toContain("Dziennik audytu");
  });

  it("administrator widzi pełne menu", async () => {
    mockApi({ ...COMMON, "GET /auth/me": [200, { ok: true, user: me({ role: { code: "ADMINISTRATOR", name: "Administrator", global: true }, permissions: ["users.read", "users.manage", "audit.read", "roles.assign"] }) }] });
    view("/");
    const nav = await screen.findByRole("navigation", { name: "Główna nawigacja" });
    for (const t of ["Użytkownicy", "Role i uprawnienia", "Dziennik audytu", "Moje konto"]) expect(nav.textContent).toContain(t);
  });

  it("wylogowanie: ekran logowania, dane usunięte z pamięci (regresja: obserwator profilu po clear())", async () => {
    let loggedIn = true;
    mockApi({
      ...COMMON,
      "GET /auth/me": () => (loggedIn ? [200, { ok: true, user: me() }] : [401, { ok: false, code: "AUTH", error: "x" }]),
      "POST /auth/logout": () => { loggedIn = false; return [200, { ok: true }]; },
    });
    view("/");
    expect(await screen.findByRole("heading", { name: "Dzień dobry, Jan" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Wyloguj" }));
    expect(await screen.findByRole("heading", { name: "Logowanie" })).toBeTruthy();
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole("heading", { name: "Dzień dobry, Jan" })).toBeNull();
    expect(screen.queryByText("RiC Zabrze")).toBeNull();
  });

  it("sesja wygasła w trakcie pracy (401 z API) — powrót do logowania", async () => {
    mockApi({ ...COMMON, "GET /auth/me": [200, { ok: true, user: me() }], "GET /warehouses": [401, { ok: false, code: "AUTH", error: "Sesja wygasła" }] });
    view("/");
    expect(await screen.findByRole("heading", { name: "Logowanie" })).toBeTruthy();
  });

  it("wymuszona zmiana hasła blokuje resztę aplikacji", async () => {
    let changed = false;
    mockApi({
      ...COMMON,
      "GET /auth/me": () => [200, { ok: true, user: me({ mustChangePassword: !changed }) }],
      "POST /auth/password": () => { changed = true; return [200, { ok: true }]; },
    });
    view("/uzytkownicy");
    expect(await screen.findByRole("heading", { name: "Wymagana zmiana hasła" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Obecne hasło/), { target: { value: "Stare-Haslo-2026" } });
    fireEvent.change(screen.getByLabelText(/^Nowe hasło/), { target: { value: "Plac-Brasz-Nowe-7" } });
    fireEvent.change(screen.getByLabelText(/^Powtórz nowe hasło/), { target: { value: "Plac-Brasz-Nowe-X" } });
    fireEvent.click(screen.getByRole("button", { name: "Zmień hasło" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/nie są identyczne/);
    fireEvent.change(screen.getByLabelText(/^Powtórz nowe hasło/), { target: { value: "Plac-Brasz-Nowe-7" } });
    fireEvent.click(screen.getByRole("button", { name: "Zmień hasło" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Wymagana zmiana hasła" })).toBeNull());
  });
});

describe("linki z e-maila", () => {
  it("aktywacja: token usuwany z paska adresu, hasło ustawiane jednorazowo", async () => {
    window.history.replaceState(null, "", "/aktywacja?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
    const calls = mockApi({
      ...COMMON,
      "GET /auth/me": [401, { ok: false, code: "AUTH", error: "x" }],
      "POST /auth/token": [200, { ok: true, email: "nowy@resinvest.pl", name: "Anna Nowak", passwordRules: "Min. 12 znaków" }],
      "POST /auth/invite/accept": [200, { ok: true }],
    });
    view("/aktywacja");
    expect(await screen.findByText("nowy@resinvest.pl")).toBeTruthy();
    expect(window.location.search).toBe("");
    fireEvent.change(screen.getByLabelText(/^Nowe hasło/), { target: { value: "Plac-Zrebki-2026" } });
    fireEvent.change(screen.getByLabelText(/^Powtórz hasło/), { target: { value: "Plac-Zrebki-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Aktywuj konto" }));
    expect(await screen.findByText(/Konto zostało aktywowane/)).toBeTruthy();
    expect(calls.find(c => c.path === "/auth/invite/accept")?.body).toEqual({ token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG", password: "Plac-Zrebki-2026" });
  });

  it("wygasły link — czytelny komunikat", async () => {
    window.history.replaceState(null, "", "/reset-hasla?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
    mockApi({ ...COMMON, "GET /auth/me": [401, { ok: false, code: "AUTH", error: "x" }], "POST /auth/token": [400, { ok: false, code: "TOKEN_EXPIRED", error: "Link wygasł. Poproś o nowy." }] });
    view("/reset-hasla");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Link wygasł/);
  });

  it("brak tokenu w linku", async () => {
    mockApi({ ...COMMON, "GET /auth/me": [401, { ok: false, code: "AUTH", error: "x" }] });
    view("/aktywacja");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Brak tokenu/);
  });
});
