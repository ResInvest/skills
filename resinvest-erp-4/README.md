# ResInvest ERP 4

*Program stworzony przez Roesner Mateusz dla ResInvest Commodities.*

Produkcyjny system ERP/WMS dla **ResInvest Commodities PL S.A.**: obrót i magazynowanie biomasy, wiele magazynów,
wielu użytkowników jednocześnie, centralna baza **PostgreSQL**, dostęp przez przeglądarkę, telefon (PWA) i klienta
Windows (Tauri) — w sieci firmy lub przez FortiClient VPN.

> **Status: 4.0.0-alpha.1 — fazy F1 (fundament), F2 (tożsamość: logowanie, sesje, konta, role, magazyny, audyt)
> F3 (silnik stanów: księga ruchów z blokadą, salda, karta materiału, bilans otwarcia z zatwierdzaniem)
> F4a (kartoteki: materiały, kontrahenci, flota, rębaki własne i zewnętrzne, operacje dodatkowe)
> F4b-1 (operacje z dokumentami: zakup PZ, sprzedaż WZ, produkcja RW + PW, operacje dodatkowe, rejestr dokumentów)
> i F4b-2a (przesunięcia MM jedno- i dwuetapowe z przyjęciem w magazynie docelowym) ukończone. F4b-2b-1 (transport: własny, zewnętrzny, mieszany, kolej, dostawca; dokument TR) ukończone. F4b-2b-2 (zakup z produkcją i sprzedażą wyniku, sprzedaż bezpośrednia z lasu, pochodzenie i kwity) ukończone — faza F4b zamknięta. F4c (Planer zakupów: plan dzienny ręcznie, wykonanie / tony / ceny / transport / kursy kierowców z dokumentów) ukończone. F4d (prowadzenie w „Nowej operacji”: lista „Co jeszcze uzupełnić” z czerwonymi brakami, samouczek pod polami i kolumnami) ukończone. Następna: F5 (korekty, usuwanie, historia zmian).**
> Wersja produkcyjna do dnia przełączenia to **ResInvest ERP 3.4** (`../resinvest-erp`).
> Plan i decyzje: [`../resinvest-erp/docs/AUDYT_REPOZYTORIUM_4.0.md`](../resinvest-erp/docs/AUDYT_REPOZYTORIUM_4.0.md),
> raporty faz: [`docs/RAPORT_F1.md`](docs/RAPORT_F1.md), [`docs/RAPORT_F2.md`](docs/RAPORT_F2.md), [`docs/RAPORT_F3.md`](docs/RAPORT_F3.md), [`docs/RAPORT_F4a.md`](docs/RAPORT_F4a.md), [`docs/RAPORT_F4b.md`](docs/RAPORT_F4b.md), [`docs/RAPORT_F4c.md`](docs/RAPORT_F4c.md), [`docs/RAPORT_F4d.md`](docs/RAPORT_F4d.md).

## Architektura

```
Windows / laptop / telefon ─► przeglądarka · ResInvest ERP.exe (Tauri) · PWA
        │  FortiClient VPN → FortiGate
        ▼
      Nginx (TLS, nagłówki, limity żądań, frontend)  ──►  NestJS API /api/v1  ──►  PostgreSQL 16
                                                                    └─ kolejka e-mail, kopie zapasowe
```

| Warstwa | Technologia | Katalog |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite 8, TanStack Query | `apps/web` |
| Backend | NestJS 12 + TypeScript | `apps/api` |
| Baza | PostgreSQL 16 + Prisma 7 (migracje SQL z ograniczeniami CHECK i wyzwalaczami) | `prisma/` |
| Reguły domenowe | TypeScript, `decimal.js` — wspólne dla API i frontendu | `packages/domain` |
| Klient Windows | Tauri 2 (faza F8), build w GitHub Actions | `apps/desktop` |
| Wdrożenie | Windows Server (usługi) — produkcja; Docker Compose — test / Linux | `deploy/`, `docker-compose.yml` |

Zasady: stan magazynu wynika wyłącznie z ruchów (`stock_movements`, tylko dopisywanie), saldo `stock_balances`
zmieniane w tej samej transakcji pod blokadą wiersza z `CHECK (qty >= 0)`; audyt tylko do dopisywania (wyzwalacz);
żadnych danych biznesowych w przeglądarce; uprawnienia zawsze sprawdza backend.

## Wymagania

* Node.js **22.13+**, pnpm **10** (`corepack enable`)
* PostgreSQL **16** (na serwerze aplikacji — **nie** na udziale sieciowym)

## Instalacja (środowisko deweloperskie)

```bash
cd resinvest-erp-4
corepack enable
pnpm install
cp .env.example .env               # uzupełnij DATABASE_URL (użytkownik z prawem CREATEDB — testy tworzą bazę *_test)
pnpm exec prisma migrate deploy    # schemat bazy
pnpm build
node apps/api/dist/seed/seed.js    # dane słownikowe: role, uprawnienia, magazyny RiC, materiały, przeliczniki, operacje dodatkowe
```

Pierwszy administrator (jednorazowo, lokalnie na serwerze — hasło ustawia sam administrator z linku):

```bash
node apps/api/dist/cli.js bootstrap-admin               # konto BOOTSTRAP_ADMIN_EMAIL + jednorazowy link aktywacyjny
node apps/api/dist/cli.js unlock jan.kowalski@resinvest.group     # odblokowanie po nieudanych logowaniach
node apps/api/dist/cli.js reset-link jan.kowalski@resinvest.group # awaryjny link ustawienia hasła
```

Kolejnych użytkowników zaprasza administrator w module **Użytkownicy** (e-mail z linkiem aktywacyjnym).
Bez skonfigurowanej poczty (`EMAIL_TRANSPORT=file`) wiadomości trafiają jako pliki `.eml` do `MAIL_FILE_DIR`.

Uruchomienie:

```bash
node apps/api/dist/main.js                 # API: http://127.0.0.1:3000/api/v1/health
pnpm --filter @resinvest/web dev           # interfejs: http://localhost:5173 (proxy /api → API)
```

## Konfiguracja

Wszystkie ustawienia w zmiennych środowiskowych — wzór z opisem: [`.env.example`](.env.example). Plik `.env` nie trafia
do repozytorium. API przy starcie waliduje konfigurację i nie uruchamia się przy błędach (np. w produkcji wymagany
jest HTTPS w `APP_URL` i lista sieci `ALLOWED_NETWORKS` — LAN + pula FortiClient VPN).

## Testy i jakość

```bash
pnpm lint          # ESLint (TypeScript, React Hooks) — 0 ostrzeżeń
pnpm typecheck     # TypeScript strict
pnpm test          # jednostkowe + integracyjne na prawdziwym PostgreSQL (osobna baza <nazwa>_test tworzona od zera)
pnpm build
pnpm --filter @resinvest/e2e e2e   # E2E (Playwright): przeglądarka → build → API → PostgreSQL (osobna baza <nazwa>_e2e)
```

E2E wymaga zbudowanego projektu (`pnpm build`) i przeglądarki Chromium (`pnpm --filter @resinvest/e2e exec playwright install chromium`).

| Pakiet | Zakres |
|---|---|
| `apps/api` | konfiguracja, sieci LAN/VPN, healthcheck, nagłówki, CORS, format błędów, **ograniczenia bazy** (audyt i ruchy tylko do dopisywania, brak stanu ujemnego przy równoczesnej sprzedaży, MM, unikalność numerów PZ/WZ, e-mail, rębaki zewnętrzne, bilans otwarcia), dane słownikowe |
| `packages/domain` | przeliczniki (1 m³ = 4 MP, 1 MP = 0,25 m³, 1 MP = 0,33 t), źródło AUTO / MANUAL / COMPANY_RATE, tonaż ręczny / automatyczny, liczby w formacie polskim |
| `apps/api` (F2) | logowanie, blokada, limity prób, sesje, CSRF, zaproszenia i reset (kolejka poczty), wymuszona zmiana hasła, role, ostatni administrator (także równoczesne operacje), izolacja magazynów, audyt, CLI |
| `packages/domain` (F3) | silnik stanów: symulacja sald krok po kroku (brak stanu ujemnego), stała kolejność blokad, komunikaty braków jak w 3.x, walidacja i przeliczenie bilansu otwarcia |
| `apps/api` (F3) | `LedgerService` (jedyne miejsce zmiany stanu: `SELECT … FOR UPDATE`, ruchy tylko do dopisywania), stany i karta materiału, bilans otwarcia: szkic → zatwierdzenie (dokument BO, ruchy, audyt) |
| `apps/api` + `apps/web` (F4a) | kartoteki `/catalog/:kind` — walidacja serwera (NIP z sumą kontrolną, rejestracja, kody), wersje, audyt było/jest, „użyte → tylko dezaktywacja”, izolacja floty; ekran Kartoteki |
| `packages/domain` + `apps/api` + `apps/web` (F4b-1) | `planOperation` (ta sama funkcja w formularzu i w API): PZ / WZ / RW + PW, tonaż AUTO/RĘCZNY, operacje dodatkowe; `/operations` z kluczem idempotencji, numeracją pod blokadą (auto / ręczna), zamkniętym okresem; ekrany Nowa operacja (podgląd, podsumowanie przed zapisem, blokada braków) i Dokumenty (PZ / WZ / MM w mocnych kolorach) |
| `apps/web` (F3) | Stany magazynowe (karta materiału z historią ruchów), Bilans otwarcia (szkic z podglądem przeliczenia, zatwierdzenie) |
| `apps/web` | stan systemu; routing i strażnicy, logowanie, menu wg uprawnień, wylogowanie, wygaśnięcie sesji, wymuszona zmiana hasła, linki z e-maila |
| `e2e` | 7 scenariuszy silnika stanów (bilans otwarcia, stany, karta materiału, telefon) + 11 scenariuszy tożsamości na komputerze (1280 px) + telefon (390 px): aktywacja, zaproszenia z e-maila, izolacja magazynów, blokada, reset, audyt, równoczesna edycja |

CI: [`.github/workflows/resinvest-erp-4-ci.yml`](../.github/workflows/resinvest-erp-4-ci.yml) — PostgreSQL 16 jako usługa, migracje, lint, typecheck, testy, build.

## Struktura

```
resinvest-erp-4/
├── apps/api/            NestJS: src/{config,common,prisma,health,seed,auth,users,roles,warehouses,audit,mail,settings}, cli.ts, test/, Dockerfile
├── apps/web/            React + Vite: src/{api,app,auth,pages,ui,styles}, public/ (manifest PWA), Dockerfile
├── e2e/                 testy E2E (Playwright): start-api.mjs (baza *_e2e), tests/
├── packages/domain/     reguły domenowe (przeliczniki, tonaż, liczby)
├── prisma/              schema.prisma + migrations/
├── deploy/nginx/        konfiguracja Nginx (TLS, nagłówki, limity, proxy)
├── docs/                RAPORT_F1.md, RAPORT_F2.md, RAPORT_F3.md, RAPORT_F4a.md, RAPORT_F4b.md, RAPORT_F4c.md, RAPORT_F4d.md, prototypy/, WDROZENIE.md
├── docker-compose.yml   środowisko testowe / serwer Linux
├── .env.example         wzór konfiguracji
└── LICENSE
```

## Licencja

Zob. [`LICENSE`](LICENSE).
