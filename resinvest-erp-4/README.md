# ResInvest ERP 4

*Program stworzony przez Roesner Mateusz dla ResInvest Commodities.*

Produkcyjny system ERP/WMS dla **ResInvest Commodities PL S.A.**: obrót i magazynowanie biomasy, wiele magazynów,
wielu użytkowników jednocześnie, centralna baza **PostgreSQL**, dostęp przez przeglądarkę, telefon (PWA) i klienta
Windows (Tauri) — w sieci firmy lub przez FortiClient VPN.

> **Status: 4.0.0-alpha.1 — faza F1 (fundament) ukończona.** Wersja produkcyjna do dnia przełączenia to
> **ResInvest ERP 3.3** (`../resinvest-erp`). Plan i decyzje: [`../resinvest-erp/docs/AUDYT_REPOZYTORIUM_4.0.md`](../resinvest-erp/docs/AUDYT_REPOZYTORIUM_4.0.md),
> raport fazy: [`docs/RAPORT_F1.md`](docs/RAPORT_F1.md).

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
```

| Pakiet | Zakres |
|---|---|
| `apps/api` | konfiguracja, sieci LAN/VPN, healthcheck, nagłówki, CORS, format błędów, **ograniczenia bazy** (audyt i ruchy tylko do dopisywania, brak stanu ujemnego przy równoczesnej sprzedaży, MM, unikalność numerów PZ/WZ, e-mail, rębaki zewnętrzne, bilans otwarcia), dane słownikowe |
| `packages/domain` | przeliczniki (1 m³ = 4 MP, 1 MP = 0,25 m³, 1 MP = 0,33 t), źródło AUTO / MANUAL / COMPANY_RATE, tonaż ręczny / automatyczny, liczby w formacie polskim |
| `apps/web` | ekran stanu systemu: serwer, baza, brak VPN, sieć spoza firmy |

CI: [`.github/workflows/resinvest-erp-4-ci.yml`](../.github/workflows/resinvest-erp-4-ci.yml) — PostgreSQL 16 jako usługa, migracje, lint, typecheck, testy, build.

## Struktura

```
resinvest-erp-4/
├── apps/api/            NestJS: src/{config,common,prisma,health,seed}, test/ (integracja), Dockerfile
├── apps/web/            React + Vite: src/{api,app,styles}, public/ (manifest PWA), Dockerfile
├── packages/domain/     reguły domenowe (przeliczniki, tonaż, liczby)
├── prisma/              schema.prisma + migrations/
├── deploy/nginx/        konfiguracja Nginx (TLS, nagłówki, limity, proxy)
├── docs/                RAPORT_F1.md, WDROZENIE.md
├── docker-compose.yml   środowisko testowe / serwer Linux
├── .env.example         wzór konfiguracji
└── LICENSE
```

## Licencja

Zob. [`LICENSE`](LICENSE).
