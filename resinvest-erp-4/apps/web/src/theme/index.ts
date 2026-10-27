import { CUSTOM_DEFAULT, isHex, isTheme, paletteVars, PRESET_PALETTES, themePalette, type Palette, type Theme } from "@resinvest/domain";

/**
 * Motyw interfejsu: zmienne CSS ustawiane na <html> z palety (motywy gotowe i własny — wspólna definicja
 * w @resinvest/domain, sprawdzana testami czytelności). Brak wyboru = „Automatycznie”: Perła albo Grafit wg
 * ustawienia systemu. Ostatnio użyte zmienne są zapamiętywane na urządzeniu, żeby skrypt w index.html ustawił
 * je przed pierwszym malowaniem (bez mignięcia jasnego tła w motywie ciemnym).
 */
export interface ThemeChoice { theme: Theme | null; primary: string | null; secondary: string | null }

const LS_KEY = "riw.theme";
const LS_VARS = "riw.theme.vars";
const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let active: ThemeChoice = { theme: null, primary: null, secondary: null };

export function paletteFor(c: ThemeChoice): Palette {
  if (!c.theme) return media?.matches ? PRESET_PALETTES.graphite : PRESET_PALETTES.pearl;
  return themePalette(c.theme, c.primary ?? CUSTOM_DEFAULT.primary, c.secondary ?? CUSTOM_DEFAULT.secondary);
}

/** Ustawia motyw na stronie (bez zapisu na serwerze). */
export function applyTheme(c: ThemeChoice, remember = true): void {
  active = c;
  const p = paletteFor(c);
  const vars = paletteVars(p);
  const root = document.documentElement;
  root.classList.add("theme-switching");
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = p.scheme;
  root.dataset.theme = c.theme ?? "auto";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", p.surface);
  requestAnimationFrame(() => root.classList.remove("theme-switching"));
  if (!remember) return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); localStorage.setItem(LS_VARS, JSON.stringify({ ...vars, scheme: p.scheme })); } catch { /* bez pamięci urządzenia */ }
}

/** Motyw zapamiętany na urządzeniu (przed zalogowaniem). */
export function storedTheme(): ThemeChoice {
  try {
    const x = JSON.parse(localStorage.getItem(LS_KEY) ?? "null") as Partial<ThemeChoice> | null;
    if (x) return { theme: isTheme(x.theme) ? x.theme : null, primary: isHex(x.primary) ? x.primary : null, secondary: isHex(x.secondary) ? x.secondary : null };
  } catch { /* uszkodzony wpis — motyw domyślny */ }
  return { theme: null, primary: null, secondary: null };
}

export const currentTheme = (): ThemeChoice => active;

/** Start: motyw z urządzenia; w trybie „Automatycznie” reaguje na zmianę ustawienia systemu. */
export function startTheme(): void {
  applyTheme(storedTheme());
  media?.addEventListener("change", () => { if (!active.theme) applyTheme(active); });
}
