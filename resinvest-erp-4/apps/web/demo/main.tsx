import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { AppRoutes } from "../src/app/App";
import { createQueryClient } from "../src/app/query";
import { PwaBanners } from "../src/app/pwa";
import { PrefsSync } from "../src/app/prefs";
import { SessionProvider } from "../src/auth/session";
import { I18nProvider, registerDict, t } from "../src/i18n";
import { cs } from "../src/i18n/cs";
import { en } from "../src/i18n/en";
import { startTheme } from "../src/theme";
import "../src/styles/app.css";
import { DEMO_MSG, installMockApi, type Snapshot } from "./mock-api";

/**
 * Wersja demonstracyjna ResInvest ERP 4 w jednym pliku HTML: prawdziwy interfejs (te same ekrany, motywy i języki)
 * na nagranych danych z przebiegu testowego. Router w pamięci (plik może być otwarty pod dowolnym adresem).
 */
const BANNER = "Wersja demonstracyjna — prawdziwy interfejs na danych z przebiegu testowego. Przeglądanie, motywy i języki działają w pełni; zapis zmian w danych jest wyłączony.";
const DEMO_CS: Record<string, string> = {
  [BANNER]: "Demonstrační verze — skutečné rozhraní s daty ze zkušebního provozu. Prohlížení, motivy a jazyky fungují naplno; ukládání změn dat je vypnuté.",
  [DEMO_MSG]: "Demonstrační verze — ukládání je vypnuté. Data pocházejí ze zkušebního provozu systému.",
};
const DEMO_EN: Record<string, string> = {
  [BANNER]: "Demo version — the real interface on data from a test run. Browsing, themes and languages work fully; saving changes to data is turned off.",
  [DEMO_MSG]: "Demo version — saving is turned off. The data comes from a test run of the system.",
};
registerDict("cs", { ...cs, ...DEMO_CS });
registerDict("en", { ...en, ...DEMO_EN });
// nagranie (demo/record.mjs) — import przez glob, żeby typy i lint działały także bez wygenerowanego pliku
const snap = Object.values(import.meta.glob("./snapshot.json", { eager: true, import: "default" }))[0] as Snapshot | undefined;
if (!snap) throw new Error("Brak demo/snapshot.json — uruchom demo/build.mjs");
installMockApi(snap);
startTheme();

function DemoBanner() {
  return <div className="pwa-bar update demo-bar" role="note">{t(BANNER)}</div>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Brak elementu #root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={["/"]}>
        <SessionProvider><I18nProvider><DemoBanner /><PwaBanners /><PrefsSync /><AppRoutes /></I18nProvider></SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>
  </StrictMode>,
);
