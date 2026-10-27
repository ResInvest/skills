import { useCallback, useEffect, useRef, useState } from "react";
import { LANG_LABEL, LANGS, type Lang } from "@resinvest/domain";
import { api, errorText } from "../api/client";
import type { Me } from "../api/types";
import { useSession } from "../auth/session";
import { t, useI18n } from "../i18n";
import { applyTheme, type ThemeChoice } from "../theme";

/**
 * Preferencje interfejsu: zalogowany użytkownik — zapisywane na koncie (te same na każdym urządzeniu);
 * przed zalogowaniem — tylko na tym urządzeniu. Po zalogowaniu ustawienia konta mają pierwszeństwo.
 */
export function PrefsSync() {
  const { user } = useSession();
  const { lang, setLang } = useI18n();
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!user) { applied.current = null; return; }
    const sig = `${user.id}:${user.prefs.lang}:${user.prefs.theme}:${user.prefs.themePrimary}:${user.prefs.themeSecondary}`;
    if (applied.current === sig) return;
    applied.current = sig;
    applyTheme({ theme: user.prefs.theme, primary: user.prefs.themePrimary, secondary: user.prefs.themeSecondary });
    if (user.prefs.lang !== lang) setLang(user.prefs.lang);
  }, [user, lang, setLang]);
  return null;
}

type PrefsPatch = Partial<Pick<Me["prefs"], "lang" | "theme" | "themePrimary" | "themeSecondary">>;

/**
 * Zapis preferencji: od razu na ekranie i w profilu sesji (PrefsSync nie cofa wtedy wyboru), potem na koncie;
 * przy błędzie zapisu — komunikat, wybór na ekranie zostaje.
 */
export function usePrefs() {
  const { user, setUser } = useSession();
  const { lang, setLang } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = useCallback(async (patch: PrefsPatch) => {
    if (!user) return true;
    setUser({ ...user, prefs: { ...user.prefs, ...patch } });
    setSaving(true); setError(null);
    try {
      const r = await api.put<{ prefs: Me["prefs"] }>("/auth/me/preferences", patch);
      setUser({ ...user, prefs: r.prefs });
      return true;
    } catch (e) { setError(errorText(e)); return false; }
    finally { setSaving(false); }
  }, [user, setUser]);
  const changeLang = useCallback((l: Lang) => { void save({ lang: l }); setLang(l); }, [setLang, save]);
  const changeTheme = useCallback(async (c: ThemeChoice) => {
    applyTheme(c);
    return save({ theme: c.theme, ...(c.primary ? { themePrimary: c.primary } : {}), ...(c.secondary ? { themeSecondary: c.secondary } : {}) });
  }, [save]);
  return { lang, changeLang, changeTheme, error, saving };
}

/** Przełącznik języka (pasek górny, ekran logowania). */
export function LangSwitch({ compact = false }: { compact?: boolean }) {
  const { lang, changeLang } = usePrefs();
  return (
    <div className="lang-switch" role="group" aria-label={t("Język")}>
      {LANGS.map(l => (
        <button key={l} type="button" className={`btn sm${l === lang ? " on" : ""}`} aria-pressed={l === lang} lang={l} data-lang={l}
          title={LANG_LABEL[l]} onClick={() => changeLang(l)}>{compact ? l.toUpperCase() : LANG_LABEL[l]}</button>
      ))}
    </div>
  );
}
