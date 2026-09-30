# Raport fazy F2 — tożsamość ResInvest ERP 4

Data: 2026-09-30 · Wersja: 4.0.0-alpha.1 (faza F2) · Format raportu zgodny z MASTER PROMPT §34.

## 1. Co zostało zrobione

### Backend (API NestJS)
* **Logowanie e-mailem firmowym**: domena sprawdzana na serwerze (`COMPANY_DOMAINS`), hasła **Argon2id**
  (m = 19 MiB, t = 2, p = 1), polityka haseł (min. 12 znaków, litera + cyfra, bez fragmentów adresu e-mail,
  lista popularnych haseł), stały czas odpowiedzi dla nieistniejącego konta (prawdziwy skrót zastępczy).
* **Sesje**: nieprzezroczysty token 256 bit w ciasteczku `HttpOnly`, `SameSite=Strict` (`__Host-riw_sid` + `Secure`
  w produkcji); w bazie wyłącznie skrót SHA-256; czas życia + limit bezczynności; lista aktywnych sesji,
  wylogowanie zdalne (własne i — przez administratora — cudze), unieważnienie wszystkich sesji przy zmianie/resecie
  hasła, zawieszeniu i wyłączeniu konta.
* **Ochrona przed zgadywaniem**: blokada konta po `LOGIN_MAX_FAILS` nieudanych próbach na `LOGIN_LOCK_MINUTES`,
  limity prób na adres IP i na adres e-mail (okno przesuwne), dziennik prób logowania (`login_events`).
* **CSRF**: wymagany nagłówek `X-Requested-With: ResInvestERP` + lista dozwolonych `Origin`; CORS tylko dla adresu aplikacji.
* **Pierwszy administrator**: `node dist/cli.js bootstrap-admin` (tylko lokalnie na serwerze) — konto + jednorazowy link
  aktywacyjny; bez haseł w kodzie. Również `unlock <e-mail>` i `reset-link <e-mail>` (awaryjnie).
* **Zaproszenia i reset hasła** przez **kolejkę poczty** (`mail_outbox`: `FOR UPDATE SKIP LOCKED`, ponowienia
  1 min / 5 min / 15 min / 1 h / 6 h, potem DEAD, treść czyszczona po wysłaniu); transport: plik `.eml`, Resend, SMTP.
  Linki jednorazowe, ważne `INVITE_HOURS` / `RESET_MINUTES`; nowy link unieważnia poprzedni; reset hasła zawsze
  z tą samą odpowiedzią (nie zdradza, czy konto istnieje).
* **Wymuszona zmiana hasła**: do czasu zmiany API odrzuca wszystkie operacje (`PASSWORD_CHANGE_REQUIRED`).
* **Role i uprawnienia** (31 uprawnień, 5 ról): globalne strażniki API w kolejności sieć → sesja → uprawnienia;
  zmiana zestawu uprawnień roli (bez roli ADMINISTRATOR i bez własnej roli), blokada optymistyczna (`version`).
* **Konta użytkowników**: zapraszanie, edycja, zawieszanie/wyłączanie (bez fizycznego usuwania), zasady z 3.x:
  brak zmiany własnej roli/statusu/magazynów, rolę ADMINISTRATOR nadaje/odbiera tylko administrator,
  **ostatni aktywny administrator** nie może zostać zdegradowany, zawieszony ani wyłączony (blokada doradcza
  w PostgreSQL — odporna na równoczesne operacje), kierownik zarządza tylko osobami ze swoich magazynów.
* **Dostęp do magazynów**: role nieglobalne widzą tylko przydzielone magazyny (lista magazynów, użytkowników, audytu).
* **Audyt** logowań i działań administracyjnych (kto, kiedy, IP, urządzenie, było/jest, powód) — tylko do dopisywania
  (wyzwalacz w bazie); widok z filtrami i stronicowaniem.
* **Samodzielna rejestracja** (domyślnie wyłączona, ustawienie `auth.allowSelfRegistration`): zgłoszenie bez hasła
  i bez uprawnień czeka na administratora; administratorzy dostają powiadomienie e-mail.

### Frontend (React)
* Ekrany: **logowanie**, **reset hasła**, **aktywacja konta / nowe hasło z linku** (token usuwany z paska adresu
  i historii zaraz po odczycie), **rejestracja**, **wymuszona zmiana hasła**, **pulpit** (magazyny użytkownika, stan
  systemu), **moje konto** (profil, magazyn domyślny, zmiana hasła, aktywne sesje z wylogowaniem),
  **użytkownicy** (wyszukiwanie, filtry statusu i magazynu, zaproszenie), **karta użytkownika** (edycja z kontrolą
  wersji, działania z potwierdzeniem: ponowne zaproszenie, link resetu, wymuszenie zmiany hasła, odblokowanie,
  wylogowanie ze wszystkich urządzeń; lista sesji), **role i uprawnienia** (macierz, edycja dla `roles.assign`),
  **dziennik audytu** (działania / logowania, filtry dat, magazynu, tekstu, wyniku; stronicowanie).
* Nawigacja i ekrany zależne od uprawnień z serwera (API i tak sprawdza każde żądanie); wygaśnięcie sesji w trakcie
  pracy → powrót do logowania i usunięcie danych z pamięci.
* Responsywność: menu rozwijane na telefonie, tabele jako karty (≤ 640 px), macierz uprawnień przewijana we własnym
  kontenerze; dostępność: etykiety pól, komunikaty błędów powiązane z polami (`aria-describedby`), okna dialogowe
  z obsługą klawiatury, łącze „Przejdź do treści”, jasny/ciemny motyw.

### Testy E2E (nowy pakiet `e2e/`)
Playwright na prawdziwym stosie: Chromium → build produkcyjny frontendu (Vite preview) → zbudowane API → PostgreSQL
w osobnej bazie `*_e2e` (tworzonej od zera; usuwana jest wyłącznie baza z tym sufiksem). Pierwszy administrator
powstaje przez CLI, linki z zaproszeń i resetów są odczytywane z prawdziwych wiadomości `.eml` wysłanych przez kolejkę.
Dołączone do CI (GitHub Actions).

## 2. Pliki

* `apps/api/src/{auth,users,roles,warehouses,audit,mail,settings}/**`, `apps/api/src/cli.ts`, `apps/api/test/{auth,users,cli}.spec.ts`
  (zatwierdzone wcześniej jako „F2 (backend)”).
* `apps/web/src/api/{client,types}.ts`, `apps/web/src/auth/session.tsx`, `apps/web/src/ui/components.tsx`,
  `apps/web/src/pages/**` (auth, account, users, Shell, Dashboard, Roles, Audit), `apps/web/src/app/{App,App.spec}.tsx`,
  `apps/web/src/pages/users/UserForm.spec.ts`, `apps/web/src/styles/app.css`, `apps/web/vite.config.ts` (`API_PROXY`, `WEB_PORT`).
* `e2e/` (package.json, playwright.config.ts, start-api.mjs, tests/{helpers,identity,mobile}.spec.ts), `pnpm-workspace.yaml`,
  `eslint.config.mjs`, `.gitignore`, `.github/workflows/resinvest-erp-4-ci.yml`, `docs/RAPORT_F2.md`, `README.md`.

## 3. Migracje

`20260930213315_user_self_registered` — kolumna `users.self_registered` (oznaczenie zgłoszeń rejestracji).
Zastosowana na bazie deweloperskiej, testowej (`*_test`) i E2E (`*_e2e`). Migracja addytywna — bez usuwania danych.

## 4–5. Testy i wyniki (rzeczywiste, 2026-09-30)

| Zestaw | Wynik |
|---|---|
| `pnpm lint` (cały monorepo) | 0 błędów, 0 ostrzeżeń |
| `pnpm typecheck` (api, web, domain, e2e) | OK |
| `apps/api` (vitest, integracja na PostgreSQL 16) | **63/63** — logowanie i sesje 15, użytkownicy/role/ostatni administrator 19, CLI 1, ograniczenia bazy 10, health/nagłówki 6, dane słownikowe 2, hasła 4, sieci 3, konfiguracja 3 |
| `apps/web` (jsdom) | **17/17** — routing i strażnicy, logowanie (CSRF, błąd, sukces), menu wg uprawnień, wylogowanie, wygaśnięcie sesji, wymuszona zmiana hasła, linki z e-maila (usunięcie tokenu, wygasły link, brak tokenu), reguły nadawania ról, stan systemu |
| `packages/domain` | 13/13 |
| **E2E Playwright** (desktop 1280 px + telefon 390 px) | **12/12** |
| `pnpm build` | OK |

Scenariusze E2E (desktop, po kolei, na jednej bazie):
1. pierwszy administrator z linku CLI; token znika z adresu; polityka haseł; link jednorazowy,
2. logowanie: domena spoza firmy, złe hasło, poprawne; pełne menu; stan bazy; brak poziomego przewijania,
3. zaproszenia kierownika (Zabrze) i magazyniera (Brąszewice) — aktywacja z linków w wiadomościach e-mail; zaproszony nie loguje się przed aktywacją,
4. izolacja magazynów: kierownik widzi tylko swój magazyn i osoby z niego; brak audytu (także 403 z API); role tylko do odczytu,
5. administrator nie zmieni własnej roli ani statusu,
6. wymuszona zmiana hasła w trakcie sesji; lista sesji; wylogowanie ze wszystkich urządzeń przez administratora,
7. blokada po 5 nieudanych próbach i odblokowanie przez administratora,
8. reset hasła: identyczna odpowiedź dla nieistniejącego konta; link z e-maila; logowanie nowym hasłem,
9. zmiana roli i dziennik audytu (działania i logowania, filtry),
9b. **dwóch użytkowników edytuje to samo konto** — druga zmiana odrzucona (wersja), bez nadpisania, formularz z aktualnymi danymi,
10. wylogowanie unieważnia sesję po stronie serwera (401).
Telefon: logowanie, menu rozwijane, użytkownicy (karty), audyt, konto, role — bez poziomego przewijania.

## 6. Wykryte problemy

1. **Wylogowanie w interfejsie** pozostawiało widok zalogowanego użytkownika (sesja na serwerze była już unieważniona —
   kolejne żądania dostawały 401): `QueryClient.clear()` odłączał obserwatora profilu. Wykryte przez E2E.
2. **Edycja konta na nieaktualnych danych**: karta użytkownika pokazywała dane z pamięci podręcznej; zapis kończył się
   poprawnie odrzuconym konfliktem wersji (409), ale komunikat znikał przy odświeżeniu formularza — zmiana „przepadała
   bez słowa”. Wykryte przez E2E.
3. Po poprawce (1) każde 401 (także oczekiwane 401 z `/auth/me` na ekranach publicznych) czyściło pamięć zapytań —
   ekran aktywacji konta zawieszał się na „Sprawdzanie linku…”. Wykryte przez testy jednostkowe.
4. Telefon: szeroka macierz uprawnień poszerzała całą stronę (siatka układu z `min-width: auto`); długie adresy e-mail
   i oznaczenia statusu rozpychały karty tabel. Wykryte przez E2E (390 px).
5. Przycisk „Menu” widoczny na komputerze (kolejność reguł CSS); nierówne wyrównanie pól formularza.
6. Dane testowe E2E: hasło zawierające fragment adresu e-mail zostało (słusznie) odrzucone przez politykę haseł.

## 7. Naprawione problemy

1. Wspólna funkcja `resetSession`: profil = `null`, usunięcie pozostałych danych bez odłączania obserwatora; test regresyjny
   (czerwony na starym kodzie, zielony po poprawce).
2. Karta użytkownika zawsze pobiera świeże dane (`refetchOnMount: "always"`), formularz edycji pojawia się dopiero po
   pobraniu aktualnej wersji; konflikt wersji — trwały komunikat na karcie + odświeżone dane; scenariusz E2E 9b.
3. Reset sesji tylko, gdy ktoś był zalogowany; 401 z `/auth/me` nie emituje zdarzenia; test „sesja wygasła w trakcie pracy”.
4. `grid-template-columns: minmax(0, 1fr)` dla układu; karty tabel z etykietą pozycjonowaną absolutnie i zawijaniem długich wartości.
5. Poprawione reguły CSS (`.btn.menu-btn`, `align-content: start`).
6. Hasła testowe zgodne z polityką.

## 8. Pozostałe ryzyka techniczne

| Ryzyko | Uwagi |
|---|---|
| Czas odpowiedzi „reset hasła” | dla istniejącego konta nieco dłuższy (zapis tokenu i kolejki) — możliwe rozróżnienie kont po czasie; do rozważenia: zapis asynchroniczny (F9, testy bezpieczeństwa) |
| Limity prób w pamięci procesu | przy kilku instancjach API limity nie są współdzielone; produkcja zakłada jedną instancję + limity Nginx (osobna strefa dla `/api/v1/auth/`) |
| Rzeczywista wysyłka poczty | testowana na transporcie plikowym; Resend/SMTP wymagają klucza/serwera firmy (domena `resinvest.group`, rekordy SPF/DKIM — poza tym środowiskiem) |
| Obrazy Docker, `nginx -t`, usługi Windows, Tauri | bez zmian względem F1 — weryfikacja w F8/F9 |

## 9. Następny etap — F3 Kartoteki i bilans otwarcia

Magazyny, materiały z jednostkami i przelicznikami (AUTO / MANUAL / COMPANY_RATE), kontrahenci, firmy zewnętrzne,
kierowcy, operatorzy, pojazdy, rębaki własne i zewnętrzne, katalog operacji dodatkowych; bilans otwarcia
z zatwierdzaniem; historia zmian było/jest; import/eksport kartotek.
