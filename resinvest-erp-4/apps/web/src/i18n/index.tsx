import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatQty, isLang, LANG_LOCALE, type Lang } from "@resinvest/domain";

/**
 * Tłumaczenia interfejsu (pl — język źródłowy, cs, en). Kluczem jest polski tekst (jak w gettext): kod pozostaje
 * czytelny, a brak tłumaczenia pokazuje tekst polski zamiast pustego miejsca. Test `i18n.spec.ts` wyciąga wszystkie
 * teksty z wywołań t("…") i m("…") i wymaga ich obecności w słownikach cs i en.
 *
 * Wstawki: t("Brakuje {n} pozycji", { n: 3 }). Komunikaty z serwera (walidacja, błędy) tłumaczy `tm()` —
 * dokładne dopasowanie albo wzorzec z {…} (np. „Na stanie jest {qty} — za mało”); bez dopasowania — oryginał.
 */
export type Dict = Readonly<Record<string, string>>;
/** Słowniki ładowane na żądanie (osobne pliki w buildzie) — przeglądarka pobiera tylko wybrany język. */
const DICTS: Partial<Record<Lang, Dict>> = {};
const LOADERS: Record<Exclude<Lang, "pl">, () => Promise<Dict>> = {
  cs: () => import("./cs").then(x => x.cs),
  en: () => import("./en").then(x => x.en),
};
const loading = new Map<Lang, Promise<void>>();
export const dictReady = (l: Lang): boolean => l === "pl" || !!DICTS[l];
/** Słownik dostarczony z góry (wersja demonstracyjna w jednym pliku — bez doładowywania). */
export function registerDict(l: Exclude<Lang, "pl">, d: Dict): void { DICTS[l] = d; patterns.delete(l); }
/** Ładuje słownik języka (jednorazowo); polski nie wymaga słownika. */
export function ensureDict(l: Lang): Promise<void> {
  if (dictReady(l)) return Promise.resolve();
  let p = loading.get(l);
  if (!p) {
    p = LOADERS[l as Exclude<Lang, "pl">]().then(d => { DICTS[l] = d; patterns.delete(l); });
    loading.set(l, p);
  }
  return p;
}

let current: Lang = "pl";
export const getLang = (): Lang => current;
export const getLocale = (): string => LANG_LOCALE[current];

const fill = (s: string, p?: Record<string, string | number>) => (p ? s.replace(/\{(\w+)\}/g, (all, k: string) => (k in p ? String(p[k]) : all)) : s);

/** Tłumaczenie tekstu interfejsu (polski tekst = klucz). */
export function t(pl: string, params?: Record<string, string | number>): string {
  const d = DICTS[current];
  return fill((d && d[pl]) || pl, params);
}

/** Znacznik tekstu do tłumaczenia w stałych (etykiety menu, kolumn) — tłumaczony później przez t(). */
export const m = (pl: string): string => pl;

/**
 * Słownik etykiet (np. status → nazwa) tłumaczony przy każdym odczycie — w bieżącym języku bez zmian w miejscach
 * użycia (`STATUS_LABEL[s]`, `Object.entries(...)`). Wartości oznaczone m("…").
 */
export function tmap<T extends Record<string, string>>(o: T): T {
  return new Proxy(o, { get: (target, k) => (typeof k === "string" && Object.hasOwn(target, k) ? t(target[k]!) : Reflect.get(target, k)) });
}

// ---------------------------------------------------------------------------------------------------------------
// Komunikaty serwera: dokładne dopasowanie albo wzorce z {nazwa}
// ---------------------------------------------------------------------------------------------------------------

const patterns = new Map<Lang, Array<{ re: RegExp; names: string[]; out: string }>>();
function compiled(lang: Lang) {
  let list = patterns.get(lang);
  if (list) return list;
  list = [];
  const d = DICTS[lang];
  if (d) for (const [k, v] of Object.entries(d)) {
    if (!k.includes("{")) continue;
    const names: string[] = [];
    const src = k.split(/(\{\w+\})/).map(part => {
      const mm = /^\{(\w+)\}$/.exec(part);
      if (mm) { names.push(mm[1]!); return "(.+?)"; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    list.push({ re: new RegExp(`^${src}$`, "s"), names, out: v });
  }
  patterns.set(lang, list);
  return list;
}

/** Tłumaczenie komunikatu z serwera (tekst polski z API / domeny). Zdania łączone kropką tłumaczone osobno. */
export function tm(msg: string): string {
  const d = DICTS[current];
  if (!d || !msg) return msg;
  const one = (s: string): string => {
    if (d[s]) return d[s]!;
    for (const p of compiled(current)) {
      const x = p.re.exec(s);
      if (x) return p.names.reduce((acc, n, i) => acc.replace(`{${n}}`, x[i + 1]!), p.out);
    }
    return s;
  };
  const whole = one(msg);
  if (whole !== msg) return whole;
  const parts = msg.split(/(?<=[.!?])\s+/);
  return parts.length > 1 ? parts.map(one).join(" ") : msg;
}

// ---------------------------------------------------------------------------------------------------------------
// Formatowanie wg języka
// ---------------------------------------------------------------------------------------------------------------

/**
 * Ilość z pełną precyzją dziesiętną (bez zaokrągleń liczby zmiennoprzecinkowej): format domenowy „1 234,5”
 * (pl, cs) albo „1,234.5” (en).
 */
export function fmtQty(v: Parameters<typeof formatQty>[0], dp?: number): string {
  const s = formatQty(v, dp);
  return current === "en" ? s.replace(/,/g, ".").replace(/ /g, ",") : s;
}
export const fmtNum = (v: string | number | null | undefined, dp = 0, maxDp = dp) =>
  v === null || v === undefined || v === "" ? "–" : Number(v).toLocaleString(getLocale(), { minimumFractionDigits: dp, maximumFractionDigits: maxDp });
export const fmtMoney = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "–" : new Intl.NumberFormat(getLocale(), { style: "currency", currency: "PLN" }).format(Number(v));
/** Data dnia (YYYY-MM-DD albo ISO) bez przesunięcia strefy. */
export const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(getLocale(), { timeZone: "UTC" }) : "—";
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(getLocale(), { dateStyle: "short", timeStyle: "short" }) : "—";
export const monthName = (month: number, style: "long" | "short" = "long") =>
  new Date(Date.UTC(2026, month - 1, 1)).toLocaleDateString(getLocale(), { month: style, timeZone: "UTC" });

// ---------------------------------------------------------------------------------------------------------------
// Dostawca języka
// ---------------------------------------------------------------------------------------------------------------

const LS_KEY = "riw.lang";
/** Język przed zalogowaniem: ostatnio wybrany na tym urządzeniu (ekran logowania), domyślnie polski. */
export function initialLang(): Lang {
  try { const v = localStorage.getItem(LS_KEY); if (isLang(v)) return v; } catch { /* tryb prywatny — bez pamięci */ }
  return "pl";
}

/** Ustawia język bieżący modułu (t(), formaty) — wywoływane przy starcie dostawcy i przy zmianie języka. */
function activate(l: Lang): Lang { current = l; return l; }

interface I18nCtx { lang: Lang; setLang: (l: Lang) => void }
const Ctx = createContext<I18nCtx | null>(null);

/**
 * Zmiana języka przebudowuje drzewo interfejsu (klucz = język) — wszystkie teksty, daty i liczby od razu w nowym
 * języku; dane z serwera zostają w pamięci podręcznej zapytań.
 */
export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [want] = useState<Lang>(() => initial ?? initialLang());
  const [lang, setLangState] = useState<Lang>(() => activate(dictReady(want) ? want : "pl"));
  // język startowy inny niż polski: interfejs po polsku do czasu pobrania słownika (ułamek sekundy)
  useEffect(() => { if (want !== "pl" && !dictReady(want)) void ensureDict(want).then(() => setLangState(activate(want)), () => undefined); }, [want]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((l: Lang) => {
    try { localStorage.setItem(LS_KEY, l); } catch { /* bez pamięci urządzenia */ }
    void ensureDict(l).then(() => setLangState(activate(l)), () => undefined);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}><LangRoot key={lang}>{children}</LangRoot></Ctx.Provider>;
}
const LangRoot = ({ children }: { children: ReactNode }) => <>{children}</>;

export function useI18n(): I18nCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n poza I18nProvider");
  return c;
}
