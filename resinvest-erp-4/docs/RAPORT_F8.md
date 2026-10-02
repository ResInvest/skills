# Raport fazy F8 — klienci: PWA, aplikacja Windows, instalator; poczta Resend + zapasowy SMTP

Data: 2026-10-02 · Wersja: 4.0.0-alpha.1 · Zakres wg planu `resinvest-erp/docs/AUDYT_REPOZYTORIUM_4.0.md` (F8): PWA (telefon),
Tauri (Windows), build instalatora na runnerze Windows (kryterium: E2E desktop + mobile).

## 1. Poczta: Resend (główny kanał) i SMTP Resend (zapasowy)

* Nowa zmienna `EMAIL_FALLBACK_TRANSPORT` (`none` | `resend` | `smtp`). Gdy główny kanał zwróci błąd, ta sama wiadomość
  idzie kanałem zapasowym; dopiero błąd obu kanałów daje status FAILED i ponowienie wg harmonogramu z F7.
* Walidacja konfiguracji przy starcie: `resend` wymaga `RESEND_API_KEY`, `smtp` wymaga `SMTP_HOST`, kanał zapasowy musi być
  inny niż główny — błędna konfiguracja zatrzymuje start API z czytelnym komunikatem.
* Zalecana konfiguracja produkcyjna: `EMAIL_TRANSPORT=resend` + `EMAIL_FALLBACK_TRANSPORT=smtp` z `SMTP_HOST=smtp.resend.com`,
  `SMTP_PORT=465` (SSL), `SMTP_USER=resend`, `SMTP_PASS=<klucz API Resend>` (szczegóły: `docs/WDROZENIE.md` §4.1).
* **Klucz API jest wyłącznie w pliku konfiguracyjnym serwera** (`.env` poza repozytorium). W repozytorium i w `.env.example`
  są tylko miejsca na wartości; frontend nigdy nie zna klucza.
* Ekran **Poczta** pokazuje kanał w postaci „resend → zapasowo smtp”.

## 2. PWA (telefon i komputer)

* `manifest.webmanifest`: nazwa, tryb `standalone`, ikony 192 / 512 / maskowalna / SVG, skróty (Nowa operacja, Stany, Raporty).
  Ikony PNG generuje `apps/web/scripts/make-icons.mjs` z jednego wzorca SVG (także ikona aplikacji Windows).
* Service worker (`sw.template.js` → `sw.js` generowany przy buildzie z listą plików i identyfikatorem wersji):
  * zapisuje w pamięci podręcznej **tylko powłokę aplikacji** (HTML, JS, CSS, ikony);
  * **nigdy nie zapisuje odpowiedzi `/api/`** — żadnych danych biznesowych w urządzeniu, zgodnie z zasadą systemu;
  * nawigacja: najpierw sieć, bez sieci — zapisana powłoka i pasek „Brak połączenia z serwerem”;
  * nowa wersja: pasek „Dostępna nowa wersja — Odśwież”; przeładowanie **tylko po kliknięciu** (poprawiony błąd: automatyczne
    przeładowanie przy pierwszej instalacji gubiło jednorazowy token aktywacji konta z e-maila).
* **Moje konto → Aplikacja na telefon i komputer**: przycisk „Zainstaluj” (Chrome / Edge / Android), instrukcja dla iPhone
  (Udostępnij → Do ekranu początkowego), informacja „Aplikacja jest zainstalowana”.

## 3. Nginx

* Wspólne nagłówki bezpieczeństwa w `deploy/nginx/riw-security.inc` (HSTS, nosniff, X-Frame-Options, Referrer-Policy,
  Permissions-Policy, CSP z `worker-src 'self'`) dołączane w serwerze i w każdym bloku `location` z własnym `add_header`.
  Naprawia to błąd dziedziczenia Nginx: blok z `add_header` gubił nagłówki z poziomu serwera.
* `/sw.js` i `/manifest.webmanifest` bez buforowania (`no-cache`), poprawny typ `application/manifest+json`.
  Sprawdzone lokalnie na Nginx — nagłówki obecne we wszystkich lokalizacjach.

## 4. Aplikacja Windows (Tauri 2) — `apps/desktop`

* Okno ładuje **serwer ERP firmy** (ten sam frontend co w przeglądarce — jedna wersja interfejsu, aktualizacja tylko po stronie serwera).
* Adres serwera: argument `--server`, zmienna `RESINVEST_SERVER_URL` (wdrożenie masowe) albo ekran pierwszego uruchomienia
  (sprawdzenie dostępności `/api/v1/health`) zapisany w `server.json` w katalogu konfiguracji użytkownika.
  Zmiana: menu **Plik → Zmień adres serwera…**.
* Model bezpieczeństwa:
  * adres tylko `https://` (wyjątek `http://localhost` do testów), bez danych logowania w adresie, tylko źródło (origin);
  * strona serwera **nie ma dostępu do poleceń aplikacji** (IPC) — uprawnienia ma wyłącznie lokalny ekran adresu;
  * strażnik nawigacji: w oknie tylko adresy serwera ERP; inne linki otwierają się w przeglądarce systemowej;
  * jedna instancja aplikacji, zapamiętany rozmiar i położenie okna, polskie menu.
* Instalator NSIS: po polsku, instalacja dla użytkownika lub dla wszystkich, WebView2 dołączony; cicha instalacja `/S`.
* Testy Rust (`server.rs`): normalizacja adresu, odrzucanie `http` poza localhost i danych logowania, porównanie źródeł, argumenty.

## 5. Build instalatora — GitHub Actions

`.github/workflows/resinvest-erp-4-desktop.yml` na `windows-latest`: testy Rust, `clippy -D warnings`, build instalatora,
skrót SHA-256 w podsumowaniu, artefakt `resinvest-erp-windows-instalator` (30 dni). Instalator nie jest podpisany
certyfikatem — Windows SmartScreen pokaże ostrzeżenie (podpis: decyzja i certyfikat po stronie firmy).

## 6. Testy (2026-10-02, wyniki rzeczywiste)

| Zestaw | Wynik |
|---|---|
| domena | 79 / 79 |
| API | 161 / 161 (nowe: kanał zapasowy poczty, walidacja konfiguracji kanałów) |
| web | 17 / 17 |
| E2E (Playwright) | 74 / 74 — w tym PWA: manifest i ikony; service worker kontroluje stronę, brak `/api/` w pamięci podręcznej, powłoka bez sieci z paskiem „Brak połączenia”; sekcja instalacji na telefonie |
| Rust (`cargo test`) | 4 / 4; `cargo clippy -D warnings` — bez uwag |
| aplikacja Windows (Linux, Xvfb) | bez konfiguracji — ekran adresu; z `--server` — logowanie ERP i zapis `server.json` |
| lint, typecheck | bez błędów |

Weryfikacja kanału Resend z tego środowiska nie była możliwa (połączenie z `api.resend.com` blokowane przez sieć środowiska
budowania) — test wykonuje się po wdrożeniu przyciskiem **Poczta → Wyślij test do mnie**.

## 7. Następna faza

F9 — eksploatacja: instalator serwera Windows (z pytaniem o klucz poczty), kopie zapasowe, monitoring.
