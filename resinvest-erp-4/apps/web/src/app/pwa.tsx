import { useSyncExternalStore } from "react";
import { t } from "../i18n";

/**
 * PWA po stronie aplikacji: rejestracja service workera (tylko build produkcyjny), informacja o nowej wersji,
 * stan sieci i instalacja aplikacji (Android / Chrome / Edge: okno systemowe; iOS: instrukcja „Do ekranu początkowego”).
 * Stan w pamięci strony — nic nie jest zapisywane w urządzeniu.
 */
interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
interface PwaState { online: boolean; update: ServiceWorker | null; install: BeforeInstallPromptEvent | null; installed: boolean }

let state: PwaState = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  update: null, install: null,
  installed: typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true),
};
const listeners = new Set<() => void>();
const set = (p: Partial<PwaState>) => { state = { ...state, ...p }; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const usePwa = () => useSyncExternalStore(subscribe, () => state, () => state);

export function startPwa(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => set({ online: true }));
  window.addEventListener("offline", () => set({ online: false }));
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); set({ install: e as BeforeInstallPromptEvent }); });
  window.addEventListener("appinstalled", () => set({ install: null, installed: true }));
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(reg => {
      const watch = (w: ServiceWorker | null) => w?.addEventListener("statechange", () => {
        // nowa wersja gotowa, a stronę obsługuje jeszcze poprzednia — pytamy użytkownika
        if (w.state === "installed" && navigator.serviceWorker.controller) set({ update: w });
      });
      if (reg.waiting && navigator.serviceWorker.controller) set({ update: reg.waiting });
      reg.addEventListener("updatefound", () => watch(reg.installing));
      // sprawdzanie aktualizacji co godzinę (aplikacja bywa otwarta cały dzień)
      setInterval(() => void reg.update().catch(() => undefined), 3_600_000);
    }).catch(() => undefined);
    // przeładowanie tylko po „Odśwież” przy nowej wersji — pierwsza instalacja (clients.claim) też zmienia kontrolera,
    // a przeładowanie wtedy zgubiłoby stan strony (np. token aktywacji usunięty już z adresu)
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (updating) { updating = false; window.location.reload(); } });
  });
}

let updating = false;
export const applyUpdate = () => { if (!state.update) return; updating = true; state.update.postMessage("SKIP_WAITING"); };
export async function promptInstall(): Promise<boolean> {
  const p = state.install;
  if (!p) return false;
  await p.prompt();
  const r = await p.userChoice;
  set({ install: null, installed: r.outcome === "accepted" });
  return r.outcome === "accepted";
}

/** Paski u góry ekranu: brak połączenia (praca wstrzymana do powrotu sieci) i dostępna nowa wersja. */
export function PwaBanners() {
  const s = usePwa();
  return (
    <>
      {!s.online && <div className="pwa-bar offline" role="status" id="pwa-offline">{t("Brak połączenia z serwerem — sprawdź Wi-Fi / VPN. Dane nie są zapisywane w urządzeniu; zapisz operację po powrocie sieci.")}</div>}
      {s.update && <div className="pwa-bar update" role="status" id="pwa-update">{t("Dostępna nowa wersja ResInvest ERP.")}
        <button type="button" className="btn sm" id="pwa-reload" onClick={applyUpdate}>{t("Odśwież")}</button></div>}
    </>
  );
}

const isIos = () => typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);

/** Sekcja „Aplikacja” w Moim koncie: instalacja na telefonie / komputerze. */
export function InstallApp() {
  const s = usePwa();
  if (s.installed) return <p className="muted" id="pwa-installed">{t("Aplikacja jest zainstalowana na tym urządzeniu.")}</p>;
  return (
    <div id="pwa-install">
      {s.install ? <button type="button" className="btn primary" id="pwa-install-btn" onClick={() => void promptInstall()}>{t("Zainstaluj aplikację")}</button>
        : isIos() ? <p className="small">{t("iPhone / iPad: w Safari dotknij „Udostępnij” → „Do ekranu początkowego”.")}</p>
          : <p className="small muted">{t("Instalacja: w Chrome / Edge menu przeglądarki → „Zainstaluj ResInvest ERP” (na Androidzie: „Dodaj do ekranu głównego”). Na komputerach firmowych można też użyć aplikacji Windows „ResInvest ERP”.")}</p>}
      <p className="small muted">{t("Aplikacja otwiera się w osobnym oknie z ikoną ResInvest. Dane pozostają na serwerze firmy — w urządzeniu są tylko pliki programu.")}</p>
    </div>
  );
}
