# Raport fazy F1 — fundament ResInvest ERP 4

Data: 2026-09-30 · Wersja: 4.0.0-alpha.1 · Format raportu zgodny z MASTER PROMPT §34.

## 1. Co zostało zrobione

* **Monorepo pnpm** `resinvest-erp-4/` obok produkcyjnej wersji 3.3 (metoda „strangler”, decyzja z audytu).
* **Model danych PostgreSQL (Prisma 7)** dla całej domeny: tożsamość (użytkownicy, role, uprawnienia, magazyny
  użytkownika, sesje, tokeny, logowania, przygotowanie pod Entra ID/LDAP), kartoteki (magazyny, materiały z jednostkami,
  przeliczniki firmowe z datą obowiązywania, kontrahenci, firmy zewnętrzne, kierowcy, operatorzy, pojazdy, rębaki
  własne i zewnętrzne, rodzaje operacji dodatkowych), operacje i dokumenty (numer PZ/WZ unikalny w typie + magazynie + roku,
  daty dokumentu / ruchu / utworzenia), pozycje z ilością źródłową i przeliczoną, przelicznikiem i źródłem
  AUTO/MANUAL/COMPANY_RATE, tonażem i jego źródłem, księga ruchów i salda, bilans otwarcia z zatwierdzaniem,
  transport, produkcja, operacje dodatkowe (FK do operacji), przyjęcie MM, korekty i historia zmian BYŁO/JEST,
  inwentaryzacja, audyt, ustawienia powiadomień, kolejka poczty z ponowieniami, idempotencja, rejestr kopii zapasowych.
* **Ograniczenia w bazie** (niezależne od kodu): 24 ograniczenia CHECK, indeks częściowy „jeden zatwierdzony bilans
  otwarcia na magazyn”, wyzwalacze blokujące UPDATE/DELETE/TRUNCATE w `audit_log` i `stock_movements`.
* **API NestJS 12**: walidowana konfiguracja (fail fast; w produkcji wymagany HTTPS i lista sieci), połączenie
  PostgreSQL (pula), `GET /api/v1/health` (stan bazy, migracje), ograniczenie dostępu do sieci LAN/VPN (CIDR,
  IPv4/IPv6), nagłówki bezpieczeństwa (helmet: CSP, DENY, HSTS w produkcji), CORS tylko dla adresu aplikacji,
  identyfikator żądania, jednolity format błędów bez stack trace, zaufane proxy.
* **`packages/domain`**: przeliczniki (1 m³ = 4 MP, 1 MP = 0,25 m³, 1 MP = 0,33 t) z konfiguracji, z zapisem wartości
  i jednostki źródłowej, wartości przeliczonej, przelicznika i źródła; tonaż automatyczny / ręczny (wartość ręczna
  nigdy nie jest nadpisywana); parser liczb w formacie polskim; arytmetyka dziesiętna (`decimal.js`).
* **Frontend React 19 + Vite 8**: szkielet aplikacji (semantyczny HTML, jasny/ciemny motyw, responsywny, manifest PWA),
  ekran „Stan systemu” z rozróżnieniem: brak VPN / serwer niedostępny / sieć spoza firmy. Dane serwera przez
  TanStack Query (pamięć, bez `localStorage`).
* **Dane słownikowe** (idempotentne): 31 uprawnień, 5 ról (ADMINISTRATOR, MANAGER, MAGAZYNIER, OBSERWATOR, AUDYTOR),
  3 magazyny RiC, 7 materiałów, 4 przeliczniki firmowe, 5 rodzajów operacji dodatkowych, ustawienia (tryb MM dwuetapowy).
* **Wdrożenie**: Dockerfile API (etapy build / migrate / runtime, użytkownik bez uprawnień root) i frontendu (Nginx),
  konfiguracja Nginx (TLS 1.2/1.3, HSTS, CSP, limity żądań — osobny, ostrzejszy dla `/api/v1/auth/`), Docker Compose
  (baza niewystawiona na zewnątrz), plan wdrożenia na Windows Server (`docs/WDROZENIE.md`).
* **CI** (GitHub Actions): PostgreSQL 16, migracje, lint, typecheck, testy, build, artefakt frontendu.
* **Jakość**: ESLint (typescript-eslint, React Hooks) — 0 błędów i ostrzeżeń; TypeScript `strict` + `noUncheckedIndexedAccess`.

## 2. Pliki

Nowy katalog `resinvest-erp-4/` (package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json,
eslint.config.mjs, prisma.config.ts, .env.example, .gitignore, .dockerignore, .editorconfig, docker-compose.yml,
LICENSE, README.md), `prisma/schema.prisma`, `prisma/migrations/20260930204019_init/migration.sql`,
`apps/api/**`, `apps/web/**`, `packages/domain/**`, `deploy/nginx/**`, `docs/RAPORT_F1.md`, `docs/WDROZENIE.md`;
`.github/workflows/resinvest-erp-4-ci.yml`; w 3.3: `docs/AUDYT_REPOZYTORIUM_4.0.md` (decyzje).

## 3. Migracje

`20260930204019_init` — pełny schemat + ograniczenia CHECK + wyzwalacze tylko-do-dopisywania.
Zastosowana na: bazie deweloperskiej, świeżej bazie „CI” oraz bazie testowej tworzonej przy każdym uruchomieniu testów.

## 4–5. Testy i wyniki (rzeczywiste, 2026-09-30)

| Zestaw | Wynik |
|---|---|
| `pnpm lint` | 0 błędów, 0 ostrzeżeń |
| `pnpm typecheck` (3 pakiety) | OK |
| `apps/api` (vitest; integracja na PostgreSQL 16.13) | 24/24 — konfiguracja 3, sieci 3, health/nagłówki/CORS/błędy 6, ograniczenia bazy 10, dane słownikowe 2 |
| `packages/domain` | 13/13 |
| `apps/web` (jsdom) | 3/3 |
| `pnpm build` | OK (frontend 223 kB JS / 70 kB gzip) |
| Symulacja CI (czysta instalacja `--frozen-lockfile`, pusta baza, bez `.env`) | wszystkie kroki OK |
| Przepływ na żywo: przeglądarka → Vite → API (build) → PostgreSQL | OK; desktop 1280 px i telefon 390 px bez poziomego przewijania, konsola bez błędów |
| Równoczesna sprzedaż tego samego towaru (dwie transakcje) | jedna zatwierdzona, druga odrzucona przez `CHECK qty >= 0`; saldo 30 |

## 6. Wykryte problemy

1. `typescript-eslint` nie obsługuje TypeScript 7 (komunikat narzędzia; śledzone w repozytorium typescript-eslint).
2. Reguła React Compiler `set-state-in-effect` odrzuciła ręczne pobieranie danych w `useEffect`.
3. Znacznik `latest` Prisma wskazuje wydanie kandydujące 8.0.0-rc.
4. Ścieżka konfiguracji: token `ENV` niedostępny w module Prisma (błąd wstrzykiwania zależności).
5. Parser `COMPANY_DOMAINS` zwracał tekst zamiast listy przy wartości domyślnej.
6. Testy integracyjne współdzieliły kody ról/magazynów z danymi słownikowymi (kolizja).
7. Nagłówek `X-Frame-Options: SAMEORIGIN` i domyślna CSP helmet — łagodniejsze niż zakładane.

## 7. Naprawione problemy

1. Cały projekt na **TypeScript 6.0.3** (ostatnia stabilna linia wspierana przez narzędzia); TS 7 — po wsparciu w typescript-eslint.
2. Dane serwera przez **TanStack Query** (zgodnie z planem architektury).
3. **Prisma 7.10** (stabilna).
4. Globalny `ConfigModule`.
5. Parser list z wartością domyślną przed transformacją + test.
6. Rozdzielone dane testowe; test idempotencji danych słownikowych.
7. `DENY` + minimalna CSP dla API; test nagłówków.

## 8. Pozostałe ryzyka techniczne

| Ryzyko | Uwagi |
|---|---|
| Obrazy Docker i `docker compose up` nie zostały uruchomione | w środowisku budowania brak demona Docker; plik Compose zweryfikowany składniowo (`docker compose config`) |
| Konfiguracja Nginx nie przeszła `nginx -t` | brak Nginx w środowisku budowania — do sprawdzenia w F9 na serwerze testowym |
| Workflow CI nie był jeszcze uruchomiony w GitHub | kroki odtworzone lokalnie 1:1; pierwsze uruchomienie po wypchnięciu |
| Wydajność modelu przy dużej liczbie ruchów | indeksy na (magazyn, materiał, data); testy obciążeniowe w F10 |
| TypeScript 7 | migracja po wsparciu w typescript-eslint |

## 9. Następny etap — F2 Tożsamość

Logowanie e-mailem firmowym (domena sprawdzana na serwerze), hasła Argon2id, sesje w ciasteczku HttpOnly z listą
aktywnych sesji i wylogowaniem zdalnym, blokada po nieudanych próbach, rate limiting, inicjalizacja pierwszego
administratora (`BOOTSTRAP_ADMIN_EMAIL`), zaproszenia i reset hasła (kolejka poczty), wymuszenie zmiany hasła,
role i uprawnienia (guard w API), dostęp do magazynów, audyt logowań i działań administracyjnych, ekrany logowania
i zarządzania użytkownikami; przeniesienie scenariuszy §34/§35 z 3.x jako testy integracyjne i E2E.
