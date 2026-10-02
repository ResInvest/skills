import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { cs } from "./cs";
import { en } from "./en";
import { ensureDict, fmtQty, I18nProvider, t, tm, tmap, m, useI18n } from ".";

/** Wszystkie teksty interfejsu: wywołania t("…") / m("…") z dosłownym tekstem w kodzie frontendu. */
const SOURCES = import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.spec.{ts,tsx}", "!./*.ts", "!./index.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const KEYS = new Set<string>();
for (const src of Object.values(SOURCES)) for (const x of src.matchAll(/\b[tm]\(\s*"((?:[^"\\]|\\.)*)"/g)) KEYS.add(JSON.parse(`"${x[1]}"`) as string);

function Switch({ to }: { to: "pl" | "cs" | "en" }) {
  const { setLang } = useI18n();
  return <button type="button" onClick={() => setLang(to)}>{t("Zapisz")}</button>;
}

describe("tłumaczenia", () => {
  afterEach(() => { cleanup(); localStorage.clear(); });

  it("każdy tekst interfejsu ma tłumaczenie czeskie i angielskie (bez pustych)", () => {
    expect(KEYS.size).toBeGreaterThan(1000);
    const missing = (d: Record<string, string>) => [...KEYS].filter(k => !d[k]?.trim());
    expect(missing(cs), "brak w cs").toEqual([]);
    expect(missing(en), "brak w en").toEqual([]);
  });

  it("wstawki {…} w tłumaczeniu są te same co w tekście polskim", () => {
    const ph = (s: string) => [...s.matchAll(/\{\w+\}/g)].map(x => x[0]).sort().join();
    for (const d of [cs, en]) for (const [k, v] of Object.entries(d)) expect(ph(v), k).toBe(ph(k));
  });

  it("słownik ładowany na żądanie: język startowy inny niż polski — interfejs przełącza się po pobraniu", async () => {
    render(<I18nProvider initial="cs"><Switch to="pl" /></I18nProvider>);
    expect(await screen.findByRole("button", { name: "Uložit" })).toBeTruthy();
  });

  it("t(): wstawki, przełączenie języka przebudowuje interfejs i zapamiętuje wybór na urządzeniu", async () => {
    render(<I18nProvider initial="pl"><Switch to="en" /></I18nProvider>);
    expect(t("Strona {page} z {pages}", { page: 2, pages: 5 })).toBe("Strona 2 z 5");
    screen.getByRole("button", { name: "Zapisz" }).click();
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
    expect(t("Strona {page} z {pages}", { page: 2, pages: 5 })).toBe("Page 2 of 5");
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("riw.lang")).toBe("en");
  });

  it("tm(): komunikaty serwera — dokładne, wzorce z wartościami, zdania osobno; nieznane bez zmian", async () => {
    await ensureDict("cs");
    render(<I18nProvider initial="cs"><span /></I18nProvider>);
    expect(tm("Nieprawidłowy e-mail lub hasło.")).toBe("Nesprávný e-mail nebo heslo.");
    expect(tm("Numer PZ/001/10/2026 jest już użyty w magazynie RiC Zabrze w roku 2026")).toBe("Číslo PZ/001/10/2026 je již použito ve skladu RiC Zabrze v roce 2026");
    expect(tm("Link wygasł. Poproś o nowy.")).toBe("Platnost odkazu vypršela. Požádejte o nový.");
    expect(tm("Komunikat spoza słownika")).toBe("Komunikat spoza słownika");
  });

  it("tmap(): etykiety tłumaczone przy odczycie; fmtQty wg języka", async () => {
    await ensureDict("en");
    const L = tmap({ A: m("Zakup"), B: m("Sprzedaż") });
    render(<I18nProvider initial="en"><span /></I18nProvider>);
    expect(L.A).toBe("Purchase");
    expect(Object.values(L)).toEqual(["Purchase", "Sale"]);
    expect(fmtQty("1234.5")).toBe("1,234.5");
    render(<I18nProvider initial="pl"><span /></I18nProvider>);
    expect(fmtQty("1234.5")).toBe("1 234,5");
  });
});
