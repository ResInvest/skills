import { useEffect, useRef, useState } from "react";
import { CUSTOM_DEFAULT, customPalette, isHex, LANG_LABEL, LANGS, PRESET_PALETTES, type Palette, type Theme } from "@resinvest/domain";
import { useSession } from "../../auth/session";
import { usePrefs } from "../../app/prefs";
import { m, t } from "../../i18n";
import { applyTheme, paletteFor, type ThemeChoice } from "../../theme";
import { Alert } from "../../ui/components";

const THEME_CARDS: ReadonlyArray<{ id: Theme | null; name: string; desc: string }> = [
  { id: null, name: m("Automatycznie"), desc: m("Jasny lub ciemny — wg ustawienia systemu (Perła / Grafit)") },
  { id: "pearl", name: m("Perła"), desc: m("Jasny, zieleń firmowa") },
  { id: "graphite", name: m("Grafit"), desc: m("Ciemny, zieleń") },
  { id: "azure", name: m("Graphite Azure"), desc: m("Ciemny, błękit") },
  { id: "ultra", name: m("Ultra Dark"), desc: m("Czerń OLED — oszczędza baterię telefonu") },
  { id: "premium", name: m("Light Premium"), desc: m("Kość słoniowa, granat i złoto") },
  { id: "custom", name: m("Własny"), desc: m("Twój kolor przewodni i kolor tła") },
];

/** Miniatura motywu: tło, karta, tekst, przycisk w kolorze przewodnim. */
function Swatch({ p }: { p: Palette }) {
  return (
    <span className="swatch" aria-hidden="true" style={{ background: p.bg, borderColor: p.line }}>
      <span className="swatch-card" style={{ background: p.surface, borderColor: p.line }}>
        <span className="swatch-line" style={{ background: p.text }} />
        <span className="swatch-line short" style={{ background: p.muted }} />
        <span className="swatch-btn" style={{ background: p.brand }} />
      </span>
    </span>
  );
}

/** Pole koloru: próbnik systemowy + zapis #rrggbb (klawiatura, wklejanie). */
function ColorField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint: string }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) { setShown(value); setText(value); }   // kolor zmieniony próbnikiem albo przyciskiem „domyślne”
  const commit = (v: string) => { const x = v.trim().toLowerCase(); if (isHex(x)) onChange(x); };
  return (
    <div className="field color-field">
      <label htmlFor={id}>{label}</label>
      <div className="color-row">
        <input type="color" aria-label={label} value={value} onChange={e => onChange(e.target.value.toLowerCase())} data-color={id} />
        <input id={id} className="ctrl mono" value={text} maxLength={7} spellCheck={false} aria-describedby={`${id}-h`}
          onChange={e => { setText(e.target.value); commit(e.target.value); }} onBlur={() => setText(value)} />
      </div>
      <small id={`${id}-h`} className="hint">{hint}</small>
    </div>
  );
}

/**
 * Moje konto → Wygląd i język. Wybór motywu działa od razu na całym ekranie i zapisuje się na koncie
 * (ten sam wygląd na każdym urządzeniu). Motyw własny: podgląd na żywo; zapis przyciskiem, a wyjście bez
 * zapisu przywraca poprzedni wygląd.
 */
export function AppearanceSettings() {
  const { user } = useSession();
  const { lang, changeLang, changeTheme, error, saving } = usePrefs();
  const saved: ThemeChoice = { theme: user?.prefs.theme ?? null, primary: user?.prefs.themePrimary ?? null, secondary: user?.prefs.themeSecondary ?? null };
  const [primary, setPrimary] = useState(saved.primary ?? CUSTOM_DEFAULT.primary);
  const [secondary, setSecondary] = useState(saved.secondary ?? CUSTOM_DEFAULT.secondary);
  const [editing, setEditing] = useState(saved.theme === "custom");
  const [ok, setOk] = useState<string | null>(null);
  const savedRef = useRef(saved);
  useEffect(() => { savedRef.current = saved; });
  const dirty = editing && (saved.theme !== "custom" || primary !== saved.primary || secondary !== saved.secondary);

  // podgląd motywu własnego na żywo (bez zapisu)
  useEffect(() => { if (editing) applyTheme({ theme: "custom", primary, secondary }, false); }, [editing, primary, secondary]);
  // wyjście z ekranu bez zapisu — powrót do zapisanego motywu
  useEffect(() => () => { applyTheme(savedRef.current, false); }, []);

  const choose = async (id: Theme | null) => {
    setOk(null);
    if (id === "custom") { setEditing(true); return; }
    setEditing(false);
    if (await changeTheme({ theme: id, primary: null, secondary: null })) setOk(t("Zapisano motyw."));
  };
  const saveCustom = async () => {
    setOk(null);
    if (await changeTheme({ theme: "custom", primary, secondary })) setOk(t("Zapisano motyw własny."));
  };
  const preview = customPalette(primary, secondary);
  const adjusted = preview.bg !== secondary;
  const active = editing ? "custom" : saved.theme;

  return (
    <div className="appearance">
      <fieldset className="fs">
        <legend>{t("Język interfejsu")}</legend>
        <div className="lang-cards" role="radiogroup" aria-label={t("Język interfejsu")}>
          {LANGS.map(l => (
            <button key={l} type="button" role="radio" aria-checked={l === lang} className={`opt-card${l === lang ? " sel" : ""}`} lang={l} data-lang-card={l}
              onClick={() => changeLang(l)}><strong>{LANG_LABEL[l]}</strong><small>{l.toUpperCase()}</small></button>
          ))}
        </div>
        <small className="hint">{t("Język zapisuje się na koncie. Dokumenty magazynowe i eksporty (PDF, Excel, Word) pozostają po polsku.")}</small>
      </fieldset>

      <fieldset className="fs">
        <legend>{t("Motyw")}</legend>
        <div className="theme-cards" role="radiogroup" aria-label={t("Motyw")}>
          {THEME_CARDS.map(c => {
            const p = c.id === "custom" ? preview : c.id ? PRESET_PALETTES[c.id] : paletteFor({ theme: null, primary: null, secondary: null });
            const sel = active === c.id;
            return (
              <button key={c.id ?? "auto"} type="button" role="radio" aria-checked={sel} className={`opt-card theme-card${sel ? " sel" : ""}`} data-theme-card={c.id ?? "auto"}
                disabled={saving} onClick={() => void choose(c.id)}>
                <Swatch p={p} /><strong>{t(c.name)}</strong><small>{t(c.desc)}</small>
              </button>
            );
          })}
        </div>
      </fieldset>

      {editing && (
        <fieldset className="fs custom-theme" id="custom-theme">
          <legend>{t("Motyw własny")}</legend>
          <div className="grid2">
            <ColorField id="theme-primary" label={t("Kolor przewodni")} value={primary} onChange={setPrimary}
              hint={t("Przyciski, aktywne pozycje menu, odnośniki i wyróżnienia.")} />
            <ColorField id="theme-secondary" label={t("Kolor tła")} value={secondary} onChange={setSecondary}
              hint={t("Tło całego programu. Jasne tło = tryb jasny, ciemne = tryb ciemny.")} />
          </div>
          <p className="small muted">{t("Kolory tekstu, kart i komunikatów dobierane są automatycznie tak, by wszystko pozostało czytelne (kontrast wg WCAG). Podgląd działa od razu na całym ekranie.")}</p>
          {adjusted && <Alert kind="info">{t("Wybrany kolor tła ma średnią jasność — na takim tle tekst byłby słabo widoczny, dlatego tło zostało przyciemnione lub rozjaśnione (odcień bez zmian): {color}.", { color: preview.bg })}</Alert>}
          <div className="actions">
            <button type="button" className="btn primary" id="theme-save" disabled={saving || !dirty} onClick={() => void saveCustom()}>{saving ? t("Zapisywanie…") : t("Zapisz motyw własny")}</button>
            <button type="button" className="btn" onClick={() => { setPrimary(CUSTOM_DEFAULT.primary); setSecondary(CUSTOM_DEFAULT.secondary); }}>{t("Kolory domyślne")}</button>
            {saved.theme !== "custom" && <button type="button" className="btn ghost" onClick={() => { setEditing(false); applyTheme(saved, false); }}>{t("Anuluj")}</button>}
          </div>
        </fieldset>
      )}
      {ok && <Alert kind="ok">{ok}</Alert>}
      {error && <Alert kind="err">{error}</Alert>}
    </div>
  );
}
