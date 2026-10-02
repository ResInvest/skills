/**
 * Preferencje interfejsu użytkownika: język i motyw (zapisywane na koncie — te same na każdym urządzeniu).
 * Motyw własny: kolor przewodni (marka, przyciski, aktywne pozycje) i kolor drugi (tło programu); pozostałe
 * kolory (powierzchnie, tekst, linie, stany) są WYLICZANE tak, by zachować czytelność (kontrast WCAG 2.1):
 * tekst ≥ 7:1, tekst pomocniczy ≥ 4.5:1, kolor przewodni na tle ≥ 3:1, napis na przycisku ≥ 4.5:1.
 */

export const LANGS = ["pl", "cs", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_LABEL: Record<Lang, string> = { pl: "Polski", cs: "Čeština", en: "English" };
export const LANG_LOCALE: Record<Lang, string> = { pl: "pl-PL", cs: "cs-CZ", en: "en-GB" };
export const isLang = (x: unknown): x is Lang => typeof x === "string" && (LANGS as readonly string[]).includes(x);

export const THEMES = ["pearl", "graphite", "azure", "ultra", "premium", "custom"] as const;
export type Theme = (typeof THEMES)[number];
export const PRESET_THEMES = ["pearl", "graphite", "azure", "ultra", "premium"] as const satisfies readonly Theme[];
export const isTheme = (x: unknown): x is Theme => typeof x === "string" && (THEMES as readonly string[]).includes(x);

export const HEX_RE = /^#[0-9a-f]{6}$/;
export const isHex = (x: unknown): x is string => typeof x === "string" && HEX_RE.test(x);

/** Domyślne kolory motywu własnego (zieleń firmowa na jasnym, lekko ciepłym tle). */
export const CUSTOM_DEFAULT = { primary: "#1e6b45", secondary: "#eef2ef" } as const;

/** Zmienne CSS interfejsu (te same nazwy co w arkuszu stylów). */
export interface Palette {
  bg: string; bgGrad: string; surface: string; surface2: string; text: string; muted: string; line: string;
  brand: string; brandInk: string; focus: string;
  okBg: string; ok: string; errBg: string; err: string; warnBg: string; warn: string; infoBg: string; info: string;
  /** Pełne czerwone tło komunikatów (pasek „Brak połączenia”, przycisk braków) — zawsze z białym napisem. */
  errSolid: string;
  scheme: "light" | "dark";
}

const grad = (a: string, b: string, c: string) => `radial-gradient(1200px 640px at 12% -10%, ${a} 0%, ${b} 55%, ${c} 100%)`;

/** Motywy gotowe (te same co w ResInvest ERP 3.x). Czytelność każdego sprawdzana testami jak motyw własny. */
export const PRESET_PALETTES: Record<(typeof PRESET_THEMES)[number], Palette> = {
  /** Perła — jasny, zieleń firmowa. */
  pearl: { bg: "#eef2ef", bgGrad: grad("#ffffff", "#eef2ef", "#e7ece8"), surface: "#ffffff", surface2: "#f5f8f6", text: "#17241d", muted: "#55675c", line: "#d8e0da",
    brand: "#1e6b45", brandInk: "#ffffff", focus: "#1e6b45", okBg: "#e1f3e7", ok: "#15703c", errBg: "#fce9e6", err: "#b0271c", warnBg: "#fdf2dc", warn: "#7f5300",
    infoBg: "#e6eefa", info: "#1f5fb5", errSolid: "#b0271c", scheme: "light" },
  /** Grafit — ciemny, zieleń. */
  graphite: { bg: "#0d120f", bgGrad: grad("#16211b", "#0f1512", "#0b0f0c"), surface: "#141b17", surface2: "#19211c", text: "#e7efe9", muted: "#a9bbaf", line: "#25302a",
    brand: "#3aa76e", brandInk: "#08150e", focus: "#4fbf83", okBg: "#12281c", ok: "#5cc993", errBg: "#2e1614", err: "#ee8478", warnBg: "#2b2211", warn: "#e0b04a",
    infoBg: "#111f33", info: "#7fb0f3", errSolid: "#b42318", scheme: "dark" },
  /** Graphite Azure — ciemny, błękit. */
  azure: { bg: "#090c11", bgGrad: grad("#16202c", "#0d131a", "#080b0f"), surface: "#111823", surface2: "#161f2b", text: "#e8eef6", muted: "#a3b4c8", line: "#222d3c",
    brand: "#3e8ef7", brandInk: "#04101f", focus: "#63a6ff", okBg: "#0e2620", ok: "#4cc994", errBg: "#2c1512", err: "#ee8478", warnBg: "#2a2213", warn: "#e0ad4c",
    infoBg: "#0f2038", info: "#7fb6ff", errSolid: "#b42318", scheme: "dark" },
  /** Ultra Dark — czerń OLED. */
  ultra: { bg: "#000000", bgGrad: grad("#0b100d", "#030504", "#000000"), surface: "#0a0c0b", surface2: "#0f1211", text: "#d5ded8", muted: "#9aa9a0", line: "#1c221f",
    brand: "#2f9a66", brandInk: "#021009", focus: "#5cc996", okBg: "#0a1d14", ok: "#52c28d", errBg: "#220e0c", err: "#e8796c", warnBg: "#1f180a", warn: "#d4a344",
    infoBg: "#0a1626", info: "#6fa9ee", errSolid: "#b42318", scheme: "dark" },
  /** Light Premium — kość słoniowa, granat i złoto. */
  premium: { bg: "#f7f4ee", bgGrad: grad("#ffffff", "#f7f4ee", "#f0ebe1"), surface: "#ffffff", surface2: "#fbf9f4", text: "#1d2332", muted: "#5a6274", line: "#e6e0d4",
    brand: "#1b2a4a", brandInk: "#ffffff", focus: "#1b2a4a", okBg: "#e5f2ea", ok: "#1f6b45", errBg: "#fbeae7", err: "#a8261b", warnBg: "#fbf2de", warn: "#7d5200",
    infoBg: "#eceff6", info: "#24386a", errSolid: "#a8261b", scheme: "light" },
};

/** Paleta wybranego motywu (motyw własny — z kolorów użytkownika). */
export function themePalette(theme: Theme, primary?: string | null, secondary?: string | null): Palette {
  return theme === "custom" ? customPalette(primary ?? CUSTOM_DEFAULT.primary, secondary ?? CUSTOM_DEFAULT.secondary) : PRESET_PALETTES[theme];
}

// ---------------------------------------------------------------------------------------------------------------
// Kolor: sRGB ↔ HSL, luminancja i kontrast (WCAG 2.1)
// ---------------------------------------------------------------------------------------------------------------

type Rgb = [number, number, number];
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const hexToRgb = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const rgbToHex = ([r, g, b]: Rgb): string => "#" + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const hsl = (h: number, s: number, l: number) => rgbToHex(hslToRgb(((h % 360) + 360) % 360, clamp(s), clamp(l)));

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => { const c = v / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }) as Rgb;
  return .2126 * r + .7152 * g + .0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + .05) / (y + .05);
}

/**
 * Kolor czytelny na WSZYSTKICH podanych tłach: jasność przesuwana w jednym kierunku (ciemniej / jaśniej),
 * odcień zachowany; w ostateczności czerń lub biel.
 */
export function fit(color: string, backs: readonly string[], min: number, darker: boolean): string {
  const good = (c: string) => backs.every(b => contrast(c, b) >= min);
  if (good(color)) return color;
  const [h, s, l] = rgbToHsl(hexToRgb(color));
  for (let i = 1; i <= 100; i++) {
    const c = hsl(h, s, darker ? l - (l * i) / 100 : l + ((1 - l) * i) / 100);
    if (good(c)) return c;
  }
  return darker ? "#000000" : "#ffffff";
}

/** Mieszanie dwóch kolorów (t = udział koloru b). */
export function mix(a: string, b: string, t: number): string {
  const [p, q] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
}

/** Przesuwa jasność koloru (zachowując odcień) aż do osiągnięcia kontrastu `min` względem `against`. */
export function ensureContrast(color: string, against: string, min: number): string {
  if (contrast(color, against) >= min) return color;
  const [h, s, l] = rgbToHsl(hexToRgb(color));
  const darker = luminance(against) > .18;   // na jasnym tle przyciemniamy, na ciemnym rozjaśniamy
  for (let i = 1; i <= 100; i++) {
    const c = hsl(h, s, darker ? l - (l * i) / 100 : l + ((1 - l) * i) / 100);
    if (contrast(c, against) >= min) return c;
  }
  return darker ? "#000000" : "#ffffff";
}

// ---------------------------------------------------------------------------------------------------------------
// Motyw własny
// ---------------------------------------------------------------------------------------------------------------

/**
 * Paleta motywu własnego. Tło = kolor drugi; jasność tła decyduje o trybie (jasny / ciemny). Powierzchnie (karty,
 * pola) są odsunięte od tła w stronę bieli / czerni, tekst wybierany z największym kontrastem, kolor przewodni
 * dopasowany tak, by był widoczny na tle i na kartach. Kolory stanów (OK / błąd / ostrzeżenie / informacja) mają
 * stałe odcienie (zielony / czerwony / bursztynowy / niebieski) — nie mogą zależeć od wyboru użytkownika.
 */
export function customPalette(primary: string, secondary: string): Palette {
  const p = isHex(primary) ? primary : CUSTOM_DEFAULT.primary;
  const bg = readableBackground(isHex(secondary) ? secondary : CUSTOM_DEFAULT.secondary);
  const dark = luminance(bg) < .18;
  const away = dark ? "#ffffff" : "#000000";        // kierunek tekstu: na ciemnym tle jaśniej, na jasnym ciemniej
  // powierzchnie (karty, kafle) lekko odsunięte od tła — ale nigdy tak, by tekst przestał być czytelny
  const layer = (target: string, t: number) => {
    for (let k = t; k > 0; k -= .01) { const c = mix(bg, target, k); if (contrast(away, c) >= 7.5) return c; }
    return bg;
  };
  const surface = dark ? layer("#ffffff", .06) : layer("#ffffff", .75);
  const surface2 = dark ? layer("#ffffff", .10) : layer("#000000", .03);
  const backs = [bg, surface, surface2];
  const text = fit(dark ? mix("#ffffff", p, .06) : mix("#000000", p, .12), backs, 7, !dark);
  const muted = fit(mix(text, bg, .38), backs, 4.5, !dark);
  const line = dark ? mix(bg, "#ffffff", .16) : mix(bg, "#000000", .13);
  const brand = fit(p, backs, 3, !dark);
  const brandInk = contrast("#ffffff", brand) >= contrast("#000000", brand) ? "#ffffff" : "#000000";
  const tint = (h: number, l: number) => hsl(h, .55, l);
  const state = (h: number) => {
    const back = dark ? mix(bg, tint(h, .40), .28) : mix(surface, tint(h, .80), .55);
    return { fg: fit(dark ? tint(h, .72) : tint(h, .30), [back, surface, bg], 4.5, !dark), back };
  };
  const ok = state(145), err = state(4), warn = state(36), info = state(213);
  return {
    bg, bgGrad: `radial-gradient(1200px 640px at 12% -10%, ${mix(bg, p, dark ? .22 : .14)} 0%, ${bg} 55%, ${mix(bg, dark ? "#000000" : p, .06)} 100%)`,
    surface, surface2, text, muted, line, brand, brandInk, focus: brand,
    okBg: ok.back, ok: ok.fg, errBg: err.back, err: err.fg, warnBg: warn.back, warn: warn.fg, infoBg: info.back, info: info.fg,
    errSolid: "#b42318", scheme: dark ? "dark" : "light",
  };
}

/**
 * Tło, na którym da się uzyskać tekst o kontraście ≥ 7:1. Kolory o średniej jasności (np. #a54b00) tego nie
 * pozwalają — wtedy jasność tła jest przesuwana (odcień i nasycenie bez zmian) w stronę bliższego końca skali.
 * Zwraca kolor wybrany przez użytkownika bez zmian, gdy jest czytelny.
 */
export function readableBackground(c: string): string {
  const ok = (x: string) => Math.max(contrast(x, "#ffffff"), contrast(x, "#000000")) >= 7.5;
  if (ok(c)) return c;
  const [h, s, l] = rgbToHsl(hexToRgb(c));
  const lighten = luminance(c) > .18;
  for (let i = 1; i <= 100; i++) {
    const x = hsl(h, s, lighten ? l + ((1 - l) * i) / 100 : l - (l * i) / 100);
    if (ok(x)) return x;
  }
  return lighten ? "#ffffff" : "#000000";
}

/** Zmienne CSS z palety (do ustawienia na <html>). */
export function paletteVars(x: Palette): Record<string, string> {
  return {
    "--bg": x.bg, "--bg-grad": x.bgGrad, "--surface": x.surface, "--surface-2": x.surface2, "--text": x.text, "--muted": x.muted, "--line": x.line,
    "--brand": x.brand, "--brand-ink": x.brandInk, "--focus": x.focus, "--ok-bg": x.okBg, "--ok": x.ok, "--err-bg": x.errBg, "--err": x.err,
    "--warn-bg": x.warnBg, "--warn": x.warn, "--info-bg": x.infoBg, "--info": x.info, "--err-solid": x.errSolid,
  };
}
