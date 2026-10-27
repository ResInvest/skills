import { describe, expect, it } from "vitest";
import { PRESET_PALETTES, PRESET_THEMES, themePalette, type Palette, contrast, readableBackground, customPalette, ensureContrast, isHex, isLang, isTheme, mix, paletteVars } from "./preferences.js";

/** Deterministyczny generator kolorów (bez losowości w testach). */
function* colors(n: number) {
  let s = 12345;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2 ** 31; yield "#" + (s % 0x1000000).toString(16).padStart(6, "0"); }
}

/** Wymagania czytelności wspólne dla motywów gotowych i własnego (WCAG 2.1). */
function readable(p: Palette, why: string) {
  for (const b of [p.bg, p.surface, p.surface2]) {
    expect(contrast(p.text, b), `${why}: tekst`).toBeGreaterThanOrEqual(7);
    expect(contrast(p.muted, b), `${why}: tekst pomocniczy`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.brand, b), `${why}: kolor przewodni`).toBeGreaterThanOrEqual(3);
  }
  expect(contrast(p.brandInk, p.brand), `${why}: napis na przycisku`).toBeGreaterThanOrEqual(4.5);
  expect(contrast("#ffffff", p.errSolid), `${why}: pasek błędu`).toBeGreaterThanOrEqual(4.5);
  for (const [fg, bg, n] of [[p.ok, p.okBg, "ok"], [p.err, p.errBg, "błąd"], [p.warn, p.warnBg, "ostrzeżenie"], [p.info, p.infoBg, "informacja"]] as const) {
    expect(contrast(fg, bg), `${why}: ${n}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fg, p.surface), `${why}: ${n} na karcie`).toBeGreaterThanOrEqual(4.5);
  }
}

describe("preferencje", () => {
  it("motywy gotowe: wszystkie spełniają wymagania czytelności", () => {
    for (const t of PRESET_THEMES) readable(PRESET_PALETTES[t], t);
    expect(themePalette("custom", "#3e8ef7", "#0a0f16").scheme).toBe("dark");
    expect(themePalette("premium")).toBe(PRESET_PALETTES.premium);
  });
  it("walidacja języka, motywu i koloru", () => {
    expect(isLang("cs")).toBe(true); expect(isLang("de")).toBe(false);
    expect(isTheme("ultra")).toBe(true); expect(isTheme("custom")).toBe(true); expect(isTheme("neon")).toBe(false);
    expect(isHex("#1e6b45")).toBe(true); expect(isHex("#1E6B45")).toBe(false); expect(isHex("red")).toBe(false); expect(isHex("#123")).toBe(false);
  });
  it("kontrast WCAG: czerń/biel 21:1, ten sam kolor 1:1; mieszanie", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(mix("#000000", "#ffffff", .5)).toBe("#808080");
    expect(contrast(ensureContrast("#cccccc", "#ffffff", 4.5), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ensureContrast("#333333", "#000000", 4.5), "#000000")).toBeGreaterThanOrEqual(4.5);
  });
  it("motyw własny: dla 400 par kolorów (także skrajnych) tekst, kolor przewodni i stany pozostają czytelne", () => {
    const list = [...colors(400), "#ffffff", "#000000", "#808080", "#ffff00", "#0000ff", "#777777"];
    for (let i = 0; i < list.length; i++) {
      const primary = list[i]!, secondary = list[(i * 7 + 3) % list.length]!;
      const p = customPalette(primary, secondary);
      const why = `${primary} / ${secondary}`;
      readable(p, why);
      if (Math.max(contrast(secondary, "#ffffff"), contrast(secondary, "#000000")) >= 7.5) expect(p.bg, why).toBe(secondary);
      expect(contrast(p.text, p.bg), why).toBeGreaterThanOrEqual(7);
      expect(contrast(p.text, p.surface), why).toBeGreaterThanOrEqual(7);
      expect(contrast(p.muted, p.bg), why).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.muted, p.surface), why).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.brand, p.bg), why).toBeGreaterThanOrEqual(3);
      expect(contrast(p.brand, p.surface), why).toBeGreaterThanOrEqual(3);
      expect(contrast(p.text, p.surface2), why).toBeGreaterThanOrEqual(7);
      expect(contrast(p.brandInk, p.brand), why).toBeGreaterThanOrEqual(4.5);
      for (const [fg, bg] of [[p.ok, p.okBg], [p.err, p.errBg], [p.warn, p.warnBg], [p.info, p.infoBg]] as const) expect(contrast(fg, bg), why).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("tło o średniej jasności jest przyciemniane / rozjaśniane z zachowaniem odcienia; czytelne tło bez zmian", () => {
    expect(readableBackground("#eef2ef")).toBe("#eef2ef");
    expect(readableBackground("#0a0f16")).toBe("#0a0f16");
    const x = readableBackground("#a54b00");
    expect(x).not.toBe("#a54b00");
    expect(Math.max(contrast(x, "#ffffff"), contrast(x, "#000000"))).toBeGreaterThanOrEqual(7.5);
    const [r, g, b] = [x.slice(1, 3), x.slice(3, 5), x.slice(5, 7)].map(v => parseInt(v, 16)) as [number, number, number];
    expect(r).toBeGreaterThan(g); expect(g).toBeGreaterThan(b);   // nadal odcień pomarańczowo-brązowy
  });
  it("tryb jasny / ciemny wynika z tła; nieprawidłowe kolory → wartości domyślne; zmienne CSS", () => {
    expect(customPalette("#1e6b45", "#f7f4ee").scheme).toBe("light");
    expect(customPalette("#3e8ef7", "#0a0f16").scheme).toBe("dark");
    expect(customPalette("zły", "<script>").bg).toBe("#eef2ef");
    const v = paletteVars(customPalette("#1e6b45", "#eef2ef"));
    expect(Object.keys(v)).toContain("--brand");
    expect(Object.values(v).every(x => /^(#[0-9a-f]{6}|radial-gradient\([^;{}<>]*\))$/.test(x))).toBe(true);
  });
});
