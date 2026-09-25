# TASKS — ResInvest ERP

## 3.2.0 — konta firmowe, role, uprawnienia, izolacja magazynów (kryteria gotowości §44)

| Kryterium | Status | Dowód |
|---|---|---|
| logowanie działa | DONE | `auth.test` §34.1, E2E (oba tryby) |
| logout działa (sesja unieważniona, stan wyczyszczony, `#/login`) | DONE | `server.test`, `e2e-server` „Wylogowanie” |
| reset hasła działa | DONE (transport `file`) | `auth.test` §34.7, `e2e-server` |
| zaproszenie działa | DONE (transport `file`) | `auth.test` §34.5–6, `e2e-server` |
| potwierdzenie e-mail działa (zmiana adresu) | DONE (transport `file`) | `auth.test` „Zmiana adresu e-mail” |
| `@resinvest.group` wymuszane po stronie serwera | DONE | `auth.test` §34.4, `platform.test` |
| `magazyn@resinvest.group` jest administratorem | DONE | seed, pierwsze uruchomienie |
| administrator tworzy użytkowników, nadaje / odbiera role, tworzy administratorów | DONE | `auth.test` §34.8, §34.17 |
| blokada usunięcia / degradacji ostatniego administratora | DONE | `auth.test` §34.17 / §35.5, `platform.test` |
| role i uprawnienia działają na backendzie | DONE | `auth.test` §34.8–12, §35.1–2 |
| dostęp do magazynów i izolacja danych | DONE | `auth.test` §34.13–14, §35.3–4, `e2e-server` |
| audit log (kody, IP, User-Agent) | DONE | `auth.test` §34.5, E2E „Dziennik audytu” |
| e-maile z marką ResInvest ERP (PL) | DONE | `server/mail.mjs`, `auth.test` (treść .eml) |
| sekrety poza frontendem i Gitem | DONE | `auth.test` „Sekrety”, `.gitignore`, `.env.example` |
| testy przechodzą | DONE | 101 + 34 + 178 + 24 (progress.md) |
| TypeScript przechodzi | NIE DOTYCZY | projekt w JavaScript (bez TypeScript); `npm run check` — składnia OK |
| build przechodzi | DONE | `npm run build` |
| dokumentacja gotowa | DONE | `docs/AUTHENTICATION.md`, `USERS_AND_ROLES.md`, `EMAIL_SETUP.md`, `SECURITY.md`, `SUPABASE_SETUP.md` |
| istniejące moduły ERP działają | DONE | `engine.test` 68/68, E2E 178/178 |
| wysyłka przez Resend na prawdziwym koncie | NIEPOTWIERDZONE | wymaga klucza API i weryfikacji domeny (DNS) — `docs/EMAIL_SETUP.md` |
| kompilacja instalatora 3.2.0 na Windows (Inno Setup 7) | NIEPOTWIERDZONE | wymaga Windows; `installer\build-installer.ps1` |

## 3.1.0 — prototyp końcowy

| Wymaganie | Status | Dowód |
|---|---|---|
| Logowanie działa (także w podglądzie pliku bez dostępu do pamięci) | DONE | E2E „ramka bez pamięci”, logowanie formularzem we wszystkich testach E2E |
| Rejestracja i logowanie e-mailem firmowym; admin magazyn@resinvest.group | DONE | platform + server + E2E (rejestracja → aktywacja → logowanie) |
| Admin dodaje adminów, kierowników, magazynierów, obserwatorów | DONE | platform („Administrator dodaje innych administratorów”) |
| Role: admin wszystko, obserwator podgląd, magazynier dodaje, kierownik zatwierdza | DONE | platform (role, obieg zatwierdzania), server, E2E |
| 3 magazyny: RiC Zabrze, RiC Brąszewice, RiC Rokitki | DONE | platform, E2E |
| Flota, ludzie, rębaki, magazynierzy i kierownicy przypisani do magazynów; dodawanie / edycja / usuwanie | DONE | platform (flota wg magazynu, usuwanie), E2E (rębaki w formularzu) |
| Nowe intro | DONE | `app/assets/intro.mp4` (10 s, 1280×720, H.264 + AAC, 2,8 MB) |
| Stopka autorska, pliki licencyjne | DONE | `.app-foot`, ekran logowania, `LICENSE`, instalator (AppCopyright) |
| Usunięcie śladów narzędzi w programie i plikach | DONE | przegląd plików projektu |
| Kompilacja instalatora Windows | NIEPOTWIERDZONE — następny krok (Windows + Inno Setup 6) | `installer\build-installer.ps1` |

## 3.0.0 — FAZA 2 (logowanie, serwer, pulpit, języki, motywy)

| Wymaganie | Status | Dowód |
|---|---|---|
| Pulpit główny poprawiony graficznie (sekcja powitalna, szybkie akcje, wskaźniki z trendem, wykres 6 mies., obroty, kafle stanów, aktywność, do załatwienia) | DONE | E2E §13–§15, zrzuty 1440 / 390 px, 3 motywy |
| System logowania — tryb lokalny (PBKDF2, blokada, bezczynność, zmiana hasła) | DONE | `tests/platform.test.mjs` (LocalAuth), E2E (logowanie kontami demo) |
| System logowania — serwer (scrypt, sesje HttpOnly, CSRF, blokada, limit IP, wymuszona zmiana) | DONE | `tests/server.test.mjs` |
| Użytkownicy i uprawnienia (Administrator), ostatni administrator chroniony | DONE | platform + server + E2E (macierz tylko dla Administratora) |
| Praca wielostanowiskowa: SQLite, transakcje, dziennik z łańcuchem skrótów, SSE | DONE | server test (komendy, idempotencja, autor z sesji, restart, `--check`) |
| Kopie zapasowe (codzienne, przy starcie, ręczne), przywracanie, kontrola spójności | DONE | server test (kopia + `--check`) |
| Języki PL / CS / EN — kompletne (interfejs, silnik, serwer, audyt, PDF) | DONE | `npm run i18n` 0 braków; test pokrycia; skan EN/CS |
| Motywy Perła / Grafit / Graphite Azure | DONE | E2E (jasny motyw), zrzuty 3 motywów |
| Kartoteki z edycją (produkty, kontrahenci z NIP, magazyny) | DONE | platform test (NIP, unikalny kod) |
| Migracja schematu 3 → 4 i danych Demo 2.x | DONE | platform test (migracja), E2E |
| Instalator Windows z serwerem i Node.js (PL/CS/EN) | DONE (kod) · kompilacja NIEPOTWIERDZONA | `installer/ResInvestERP.iss`, `build-installer.ps1` |
| README, LICENSE, konfiguracja środowiska, dane przykładowe | DONE | `README.md`, `LICENSE`, `config/*.json`, `data/sample_data.json` |

---

# Demo v2 (domknięcie przed Production v1) — historia

Status: `TODO` · `IN PROGRESS` · `DONE` (= zaimplementowane **i** sprawdzone testem) · `BLOCKED` · `PRODUKCJA` (celowo na etap pełnego ERP)

## 0. Rozpoznanie istniejącego kodu (wykonane przed zmianami)

| Obszar | Stan zastany (Demo v2 2.0.0, commit `ac6d479`) | Plik |
|---|---|---|
| Operacje | `planOperation` / `commitOperation`, typy ZAKUP, SPRZEDAZ (z magazynu / `direct`), PRODUKCJA | `demo/src/engine.js` |
| Produkcja na magazyn | użytkownik wpisuje **zużycie** m³, wynik = zużycie × 4 — **odwrotnie niż wymaga §3/§6** (ma być: podaję MP, zużycie liczone) | engine `planProduction("stock")` |
| Produkcja na magazyn — transport | sekcja transportu **jest widoczna** — sprzeczne z §5 | `app.js` `transportHtml` zawsze renderowane |
| Produkt wyjściowy | wynika z „rodzaju produkcji”, brak jawnego wyboru; brak kontroli surowiec ≠ produkt | engine |
| Przeliczniki | m³↔MP (4), MP→t (0,33), drewno 0,952 t/m³; **brak GJ** (1 t = 8,5 GJ) | engine `Units` |
| Precyzja | ilości zaokrąglane do 0,001 **przed** walidacją — sprzeczne z §31.6 | engine `round(…,3)` |
| WZ | działa (stan przed/po, blokada ponad stan) | engine |
| Sprzedaż bezpośrednia | PW+WZ `direct`, surowiec opcjonalny — §31.10 wymaga walidacji surowca | engine |
| MM | **brak** | — |
| Statusy | `posted` / `storno` — brak DRAFT/CANCELLED/CORRECTED | engine |
| Anulowanie | `stornoOperation` (odwrócenie, blokada gdy stan < 0 **dziś**) — brak analizy zależności w czasie, brak potwierdzenia | engine |
| Korekty ilościowe/wartościowe/opisowe | **brak** | — |
| Historia | dziennik audytu (JSON przed/po) + rejestr operacji; brak rejestru ruchów ze stanem przed/zmiana/po per produkt | `app.js` Views.historia |
| Raport miesięczny | KPI + ruchy wg produktu; brak bilansu stan pocz. + ruchy = stan końc., brak MM, brak transportu, brak drill-down | engine `Reports.summary` |
| Druk | tylko pojedynczy dokument (okno + `window.print`) | `app.js` printDoc |
| PDF | **brak** | — |
| Kwit produkcji dnia | **brak** | — |
| Pulpit | KPI liczbowe, bez wykresów, bez obrotów wg typu | `app.js` Views.pulpit |
| Menu | 8 pozycji; brak Przyjęć, WZ, Produkcji, MM, Transportu, Produktów, Kontrahentów, Magazynów, Administracji | `app.js` NAV |
| Jasny motyw | wdrożony w 2.0.0 | `styles.css` |
| Uprawnienia | role → `op.create`, `op.storno`, … — brak `documents.cancel` itd. | engine `ROLES` |
| Zapis | localStorage + Web Locks + idempotencja (bez zmian) | `app.js` Store |

NIEPOTWIERDZONE (stan przed zmianami): zachowanie filmu intro w Chrome/Edge z kodekiem H.264 (środowisko testowe nie ma kodeka).

## 1. Zadania

Dowody: `U:` test jednostkowy w `tests/engine.test.mjs` / `tests/pdf.test.mjs`, `E:` kontrola w `tests/e2e.cjs` (nazwa testu).

| # | Wymaganie (§) | Status | Dowód |
|---|---|---|---|
| 1 | Przeliczniki centralne + GJ (§4) | DONE | U: „Przeliczniki centralne…”, „Stan startowy…”; E: „§4 Stany…”, „§13 Pulpit: KPI stanów z ≈ t i ≈ GJ” |
| 2 | Produkcja na magazyn: podaję MP → zużycie = MP ÷ 4, bez transportu (§3, §5, §6) | DONE | U: §22 TEST 1; E: „§5 Produkcja na magazyn: brak transportu…”, „§22 T1…” |
| 3 | Walidacja produkcji 31.1–31.15 | DONE | U: §31.16 A–J; E: §31.16 B, C, F, §31.15 |
| 4 | Sprzedaż bezpośrednia — surowiec, przelicznik, sprzedaż ≤ produkcja (§8, §31.10–31.11) | DONE | U: §22 TEST 3, §31.16 I; E: „§31.16 I”, „§22 T3” |
| 5 | WZ — stan dostępny / po WZ (§9) | DONE | U: §22 TEST 2; E: „§9 WZ…” |
| 6 | MM — przesunięcie międzymagazynowe | DONE | U: „MM…”, TEST 19–20; E: „MM: …” |
| 7 | Statusy DRAFT / POSTED / CANCELLED / CORRECTED (§32.1) | DONE | U: „§32: wersja robocza…”; E: „§32.1 Wersja robocza…”, „§32.1 Rejestr: kolumna Status…” |
| 8 | Anulowanie z analizą zależności (§32.2–32.4) | DONE | U: §32.23 TEST 1–3; E: „§32.23 T1”, „§32.4 Blokada…” |
| 9 | Korekty: ilościowe, wartościowe, opisowe, produkcji, bezpośredniej, odwrócenie (§32.5–32.17) | DONE | U: §32.23 TEST 4–9; E: „§32.5”, „§32.9 Podgląd…”, „§32.8”, „§32.16” |
| 10 | Uprawnienia `documents.cancel`, `documents.correct`, `*.correct` (§32.22) | DONE | U: §32.23 TEST 10; E: „§32.22 Magazynier…”, „Administracja: uprawnienia…” |
| 11 | Historia operacji (przed / zmiana / po) + filtry (§10, §23, §32.18) | DONE | U: TEST 41; E: „§10 Historia: kolumny…”, „§32.18…”, „§23 Historia: zakres dat” |
| 12 | Raport okresowy: sekcje, bilans, spójność, wiele magazynów, drill-down, wycena, zamknięty miesiąc (§11, testy 11–42) | DONE | U: TEST 11–42; E: „§11 Raport…”, „§11 Drill-down…”, „Test 31/33/35” |
| 13 | Druk + prawdziwy PDF (czcionka osadzona, polskie znaki) (§12) | DONE | U: `pdf.test.mjs` (4 testy); E: „§12 GENERUJ PDF…”, „§12 PDF: polskie znaki…” (pypdf), „§12 DRUKUJ…” |
| 14 | Kwit produkcji dnia + druk/PDF (§16) | DONE | U: TEST 40; E: „§16 Kwit…” (3 kontrole) |
| 15 | Pulpit: KPI, stany graficznie, obroty wg typu z zakresem (§13–15) | DONE | E: „§13”, „§14”, „§15” (5 kontroli) |
| 16 | Transport kolejowy — oba tryby (§17) | DONE | U: §22 TEST 5–6; E: „§22 T5”, „§22 T6”, „Pociąg: podsumowanie…” |
| 17 | Cena za rąbanie (§18) | DONE | U: §22 TEST 7; E: „§18…”, „§22 T7…” |
| 18 | Menu główne (§20) | DONE | E: „§20 Menu: wszystkie wymagane pozycje” |
| 19 | Formularze zależne od typu (§21) | DONE | E: „§5…”, „§6 Produkcja: …pola”, testy WZ / bezpośredniej / MM |
| 20 | Testy akceptacyjne (§22, §31.16, §32.23, testy 11–42) | DONE | `npm run test:unit` 56/56, `npm run test:e2e` 104/104 |
| 21 | Review końcowy diffu (§29) | DONE | sekcja 2 poniżej (znalezione i poprawione w trakcie) |

### Demo v2.2 (uwagi z oceny)

| # | Wymaganie | Status | Dowód |
|---|---|---|---|
| 22 | Dostawca: firma drzewna (KZR) / nadleśnictwo (Deklaracja + leśnictwo z listy lub nowe), podstawa ręcznie zmienialna | DONE | U: „2.2 Dostawca…”, „2.2 Zakup z nadleśnictwa + produkcja…”; E: „2.2 Dostawca…”, „2.2 Nadleśnictwo…”, „2.2 Leśnictwo…”, „2.2 Nowe leśnictwo zapisane…” |
| 23 | Transport własny: liczba kursów, rubryka na kurs (pojazd, kierowca domyślny, km, stawka, ilość MP, waga rzeczywista), podsumowanie MP / t / koszt | DONE | U: „2.2 Kursy…” (3 testy); E: „2.2 Liczba kursów 4…”, „2.2 Podsumowanie kursów: 400 MP, 132 t…”, „2.2 Zapisane…” |
| 24 | Błąd: opisy wyliczeń powielały się („0 km × 5,00 zł/km · 0 km × …”) | DONE | E: „Poprawka: opis wyliczenia nie powiela się…” |

### Demo v2.3

| # | Wymaganie | Status | Dowód |
|---|---|---|---|
| 25 | Dostawca (firma) i nadleśnictwo — możliwość wpisania ręcznie; nowy kontrahent dopisywany do kartoteki | DONE | U: „2.3 Dostawca wpisany ręcznie…” (2 testy); E: „2.3 …” (9 kontroli) |

### Demo v2.4

| # | Wymaganie | Status | Dowód |
|---|---|---|---|
| 26 | Transport zewnętrzny: liczba kursów, rubryka na kurs (pojazd przewoźnika, kierowca, km, stawka domyślna, ilość MP, waga rzeczywista), podsumowanie MP / t / koszt | DONE | U: „2.4 Zewnętrzny…” (3 testy); E: „2.4 …” (5 kontroli) |

### Demo v2.5

| # | Wymaganie | Status | Dowód |
|---|---|---|---|
| 27 | Jedna produkcja: kursy flotą własną i firmą zewnętrzną razem (np. 3 + 2), wspólne podsumowanie | DONE | U: „2.5 Mieszany…” (3 testy); E: „2.5 …” (6 kontroli) |

### Demo v2.6

| # | Wymaganie | Status | Dowód |
|---|---|---|---|
| 28 | Kwit wywozowy usunięty z produkcji (przy kursach) — w każdym kursie: nr kwitu, m³, MP, tony; m³ × 4 = MP automatycznie; suma kursów ≤ produkcja | DONE | U: „2.6 Kwit…” (3 testy); E: „2.6 …” (8 kontroli) |

## 2. Znalezione problemy

| Problem | Status |
|---|---|
| 2.0: produkcja na magazyn przyjmowała zużycie zamiast ilości produkcji; pokazywała transport | poprawione |
| 2.0: zaokrąglanie ilości do 0,001 przed walidacją | poprawione (6 miejsc) |
| Raport: operacja łańcuchowa (zakup + sprzedaż) przypisywała sprzedaż dostawcy i wartość zakupu odbiorcy | poprawione + test |
| Historia: wiersz sprzedaży z operacji łańcuchowej pokazywał dostawcę | poprawione |
| Anulowanie: dokument anulowany wcześniej (rozchód + odwrócenie w tym samym dniu) dawał fałszywą blokadę | poprawione (operacje anulowane pomijane w osi czasu) + test |
| Przykłady GJ ze specyfikacji (6 613 / 23 265 GJ) liczone z masy zaokrąglonej — system: 6 611 / 23 262 GJ | do decyzji firmy |
| Masa drewna 0,952 t/m³ vs 1,32 t/m³ w v1 | do decyzji firmy |
| Czas audytu (rzeczywisty) vs data operacji (data demo) — filtr dziennika audytu działa po czasie rzeczywistym | ograniczenie demo |
| Film intro w Chrome/Edge z H.264 | NIEPOTWIERDZONE (środowisko testowe bez kodeka) |
| Instalator Windows jeszcze niekompilowany | NIEPOTWIERDZONE (brak Windows / Inno Setup) |

## 3. Na etap produkcyjny

| Temat | Uwagi |
|---|---|
| Baza PostgreSQL, księga append-only, transakcje z blokadą sald, numeracja w transakcji | `docs/RESINVEST_CHANGE_PLAN.md` → „Architektura Production v1” |
| Logowanie, uprawnienia po stronie serwera | DONE w 3.0.0 |
| Wiele magazynów na użytkownika | kolejna faza |
| Wycena magazynu (średnia ruchoma / FIFO), koszty rąbania i transportu w wartości zapasu | wymaga decyzji biznesowej |
| Korekta daty / magazynu dokumentu | obecnie: anulowanie + nowy dokument |
| Edycja kartotek produktów i kontrahentów | DONE w 3.0.0 |
| Archiwum wygenerowanych PDF z sumą kontrolną | w demo: numer + wpis audytu |
| Migracja danych 1.3.0 | bilans otwarcia + archiwum dokumentów |
