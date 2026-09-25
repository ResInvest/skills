# ResInvest ERP 3.0 (3.0.0)

System ERP do **obrotu i magazynowania biomasy drzewnej**: zakupy, produkcja zrębki, sprzedaż, przesunięcia MM,
transport (flota własna, przewoźnicy, kolej), inwentaryzacja z zamknięciem miesiąca, korekty i anulowania,
historia każdej zmiany, raporty dzienne / tygodniowe / miesięczne / roczne, druk i PDF.

Jeden interfejs — plik **`ResInvest_ERP.html`** — działa w dwóch trybach:

| Tryb | Dla kogo | Dane | Logowanie |
|---|---|---|---|
| **Serwer** (zalecany do pracy) | wiele stanowisk w sieci firmy, także telefon / tablet | baza **SQLite** na serwerze (transakcje, dziennik zmian z łańcuchem skrótów SHA-256, kopie codzienne) | konta na serwerze, hasła **scrypt**, sesja w ciasteczku HttpOnly, blokada po 5 próbach |
| **Lokalny** | jedno stanowisko, szkolenie, pokaz | przeglądarka (`localStorage`), kopia JSON na żądanie | konta lokalne, hasła **PBKDF2-SHA256**, wylogowanie po bezczynności |

Program nie korzysta z internetu ani bibliotek zewnętrznych (CDN) — wszystko jest w pliku HTML.

## Nowe w 3.0 (faza 2)

* **System logowania** — ekran logowania (PL / CS / EN, wybór motywu), pierwsze uruchomienie serwera z kontem administratora,
  wymuszona zmiana hasła tymczasowego, zmiana hasła w profilu, blokada konta po 5 nieudanych próbach na 15 min
  (odblokowanie przez administratora), limit prób z jednego adresu IP, wylogowanie po 30 min bezczynności,
  dziennik logowań. Autor każdej operacji pochodzi **wyłącznie z sesji** — nie z danych przesłanych przez przeglądarkę.
* **Moduł Użytkownicy** (Administrator) — zakładanie kont z hasłem startowym, role, przypisanie do magazynu,
  dezaktywacja (bez usuwania — historia zostaje), reset hasła, odblokowanie, macierz uprawnień, dziennik logowań.
  Ochrona: nie można odebrać sobie roli ani dezaktywować ostatniego administratora.
* **ResInvest ERP Serwer** — praca wielostanowiskowa: Node.js + SQLite (WAL, `synchronous=FULL`), każda zmiana
  w jednej transakcji, dziennik zmian tylko do dopisywania (wyzwalacze blokują UPDATE/DELETE) z łańcuchem skrótów,
  odświeżanie na żywo u innych użytkowników (SSE), kopie codzienne + przy starcie (30 dni), kontrola spójności,
  przywracanie kopii, reset hasła z konsoli, HTTPS (opcjonalnie), ochrona CSRF, nagłówki bezpieczeństwa (CSP).
* **Nowy pulpit** — sekcja powitalna z wynikiem miesiąca, szybkie akcje, 8 wskaźników z porównaniem do poprzedniego
  miesiąca i liniami trendu, wykres sprzedaży i zakupów z 6 miesięcy (z tabelą), obroty według typu operacji,
  kafle stanów z linią 30 dni, ostatnia aktywność, lista „Do załatwienia” (niezamknięte okresy, wersje robocze,
  pozycje bez wyceny).
* **Języki PL · CS · EN — kompletne** (1 542 teksty): interfejs, komunikaty silnika i serwera, podpowiedzi formularza,
  dziennik audytu, raporty, wydruki i PDF. Liczby i daty wg języka (1 234,50 · 1,234.50; 23.09.2026 · 23/09/2026).
  Język i motyw zapisują się w profilu użytkownika.
* **Motywy Perła (jasny) · Grafit (ciemny) · Graphite Azure** — jak w 1.3.0; wszystkie kolory przez tokeny,
  palety wykresów sprawdzone pod kątem daltonizmu i kontrastu. Skrót: Ctrl+D.
* **Kartoteki z edycją** — Produkty (jednostka magazynowa zablokowana po pierwszym ruchu), Kontrahenci (NIP z sumą
  kontrolną), Magazyny (dezaktywacja tylko przy zerowych stanach).
* **Warstwa usług** — jedna ścieżka zmian danych (`Store.exec` → komendy `RIW.Service`) wspólna dla przeglądarki
  i serwera; komenda pracuje na kopii stanu i zapisuje wynik tylko przy powodzeniu („wszystko albo nic”).
* Schemat danych 4 (migracja 3 → 4 automatyczna; dane z Demo 2.x przenoszone przy pierwszym uruchomieniu).

## Instalacja (Windows)

Uruchom **`ResInvestERP_Setup_3.0.0.exe`** (budowanie — niżej) i wybierz:

* **Pełna instalacja** — program + serwer. Instalator dołącza środowisko Node.js (`runtime\node.exe`),
  tworzy folder danych `C:\ProgramData\ResInvestERP` i skróty w menu Start:
  *ResInvest ERP Serwer — uruchom*, *ResInvest ERP (serwer) — otwórz w przeglądarce*, *Kopia zapasowa bazy teraz*,
  *Kontrola spójności bazy*, *Folder danych serwera*, *Instrukcja*. Opcjonalnie: autostart serwera przy logowaniu
  do Windows i reguła zapory dla portu 8080 (dostęp z sieci lokalnej).
* **Tylko program** — sam plik HTML (tryb lokalny), bez serwera.

Instalator jest dostępny po polsku, czesku i angielsku. Odinstalowanie **nie usuwa** danych serwera ani pliku
`config\server.config.json`.

### Pierwsze uruchomienie serwera

1. Menu Start → *ResInvest ERP Serwer — uruchom* (okno konsoli musi pozostać otwarte; przy autostarcie działa zminimalizowane).
2. Przeglądarka otworzy `http://localhost:8080/` → ekran **Pierwsze uruchomienie**: imię i nazwisko administratora,
   login, hasło (min. 8 znaków, litery i cyfry), nazwa magazynu głównego; opcjonalnie dane przykładowe do nauki.
3. W module **Użytkownicy** załóż konta pracowników (hasło startowe — użytkownik zmieni je przy pierwszym logowaniu).
4. Inne komputery / telefony w sieci: `http://<adres-serwera>:8080/` (adres IP pokazuje konsola serwera).

### Tryb lokalny (bez serwera)

Otwórz `ResInvest_ERP.html` w Chrome / Edge / Firefox. Dane przykładowe zawierają konta demonstracyjne
(hasło **`demo1234`** — zmień je w *Mój profil* przed pracą na prawdziwych danych):

| Login | Osoba | Rola | Magazyn | Może |
|---|---|---|---|---|
| `admin` | Mateusz Roesner | Administrator | RiC Zabrze | wszystko, w tym użytkownicy i hasła |
| `kierownik` | Anna Górska | Kierownik | RiC Zabrze | operacje, korekty, anulowania, zamknięcie okresu, kartoteki, kopie |
| `magazynier` | Adrian Wojciechowski | Magazynier | RiC Zabrze | operacje, wersje robocze, spis — bez korekt i anulowań |
| `pyskowice` | Paweł Kaczmarek | Magazynier | RiC Pyskowice | jw. w Pyskowicach |
| `podglad` | Beata Nowak | Podgląd | RiC Zabrze | tylko odczyt i raporty |

Dane przykładowe: bilans otwarcia 01.08.2026 (Zabrze: drewno 817 m³, zrębka leśna 8 173 MP, PKS i łupina po 728 t),
operacje każdego rodzaju, MM Zabrze → Pyskowice, korekta WZ i anulowany zakup; plik `data/sample_data.json`
(kopia do wczytania w *Administracja → Wczytaj kopię*).

## Funkcje

| Obszar | Zawartość |
|---|---|
| **Operacje** | Zakup (PZ, opcjonalnie łańcuch produkcja + sprzedaż) · Sprzedaż z magazynu (WZ) · Produkcja na magazyn (RW + PW) · Produkcja + sprzedaż bezpośrednia (PW + WZ) · Przesunięcie MM; transport własny / zewnętrzny / mieszany / kolej z kursami, kwitami wywozowymi i kosztami |
| **Zatwierdzanie** | podsumowanie przed zatwierdzeniem (stan przed / po, zużycie, masa, GJ, koszty, dokumenty); zapis atomowy; ochrona przed podwójnym kliknięciem i podwójnym zapisem (klucz idempotencji) |
| **Statusy** | ROBOCZY · ZATWIERDZONY · SKORYGOWANY · ANULOWANY |
| **Korekty i anulowania** | dokument KOR (ilościowe, produkcji, sprzedaży bezpośredniej, wartościowe, opisowe; podgląd oryginał / korekta / różnica / wpływ na stan; odwrócenie korekty) · dokument AN (nigdy nie usuwa dokumentu; analiza zależności w czasie; wymagana przyczyna) |
| **Historia** | rejestr ruchów ze stanem przed / zmianą / stanem po; dziennik audytu (kto, kiedy, co, powód, źródło); filtry: dzień / tydzień / miesiąc / rok / zakres, magazyn, produkt, typ, użytkownik, kontrahent, status |
| **Raporty** | dzienny / tygodniowy / miesięczny / roczny / zakres własny; magazyn lub wszystkie; widok biznesowy i audytowy; bilans stanów z kontrolą spójności z księgą; zakupy, produkcja, sprzedaż, MM, transport, korekty, anulowania, wycena; zestawienie miesięcy roku; drill-down do operacji; CSV |
| **Druk i PDF** | okno wydruku i prawdziwy PDF (osadzona czcionka z polskimi i czeskimi znakami, numer, strony „X z Y”, pola podpisu) — w języku użytkownika; każde wygenerowanie w audycie |
| **Inwentaryzacja** | okres miesięczny OTWARTA → ZAMKNIĘTA, lista spisowa, różnice dokumentem IN, blokada okresu; automatyczna kontrola przełomu miesiąca |
| **Import / eksport** | kopia JSON (pełny stan, bez haseł), import z kontrolą struktury i migracją, CSV stanów / historii / bilansu, kopie SQLite serwera |
| **Kartoteki** | Produkty, Kontrahenci, Magazyny, Flota (pojazdy, kierowcy, rębaki, operatorzy) |
| **Bezpieczeństwo** | role i macierz uprawnień sprawdzane w silniku przy każdej komendzie (na serwerze — po stronie serwera), hasła z solą, blokady, sesje, CSRF, CSP, dziennik zmian z łańcuchem skrótów |

## Przeliczniki (`config/app.config.json`)

| Przelicznik | Wartość |
|---|---|
| 1 m³ drewna | 4 MP zrębki (1 MP = 0,25 m³) |
| 1 MP zrębki | 0,33 t (orientacyjnie) |
| 1 m³ drewna | 0,952 t (orientacyjnie; 817 m³ ≈ 778 t) |
| 1 t biomasy | 8,5 GJ (orientacyjnie) |
| PKS, łupina nerkowca | tylko t |

Masa i energia są orientacyjne i nie zmieniają ilości na stanie. Jednostek różnych produktów się nie sumuje.
Symbol **MP** (metr przestrzenny zrębki) jest taki sam we wszystkich językach — tak jak na dokumentach.

## Serwer — konfiguracja i obsługa

Plik `config/server.config.json` (w instalacji: `C:\Program Files\ResInvest ERP\config\`):

| Klucz | Znaczenie | Domyślnie |
|---|---|---|
| `port`, `host` | adres nasłuchu; `0.0.0.0` = sieć lokalna, `127.0.0.1` = tylko ten komputer | 8080, 0.0.0.0 |
| `dataDir` | baza, kopie, logi (instalator ustawia `%ProgramData%\ResInvestERP` przez `RIW_DATA`) | `data-server` |
| `session.idleMinutes` / `absoluteHours` | wylogowanie po bezczynności / maksymalny czas sesji | 30 / 12 |
| `security.maxFailed` / `lockMinutes` / `ipAttemptsPer15Min` | blokada konta i limit prób z adresu IP | 5 / 15 / 40 |
| `backup.hour` / `keepDays` / `dir` | godzina kopii codziennej, przechowywanie, folder | 2 / 30 / `<dataDir>/backups` |
| `tls.cert` / `tls.key` | pliki PEM — włączają HTTPS (zalecane poza siecią lokalną) | — |

Zmienne środowiskowe: `RIW_PORT`, `RIW_HOST`, `RIW_DATA`, `RIW_TODAY` (tylko testy).

```bash
npm run server                          # uruchomienie (Node.js ≥ 22.13)
node server/riw-server.mjs --open       # … i otwarcie przeglądarki
node server/riw-server.mjs --backup-now # kopia bazy teraz (działa także przy pracującym serwerze)
node server/riw-server.mjs --check      # kontrola spójności bazy i łańcucha skrótów dziennika
node server/riw-server.mjs --restore <plik.sqlite>      # przywrócenie kopii (serwer zatrzymany)
node server/riw-server.mjs --reset-password <login>     # hasło tymczasowe (serwer zatrzymany)
```

Folder danych: `resinvest.sqlite` (baza), `backups/` (kopie `VACUUM INTO`), `logs/` (dzienne logi serwera).
Przywrócenie zachowuje bieżącą bazę jako kopię bezpieczeństwa przed podmianą.

## Struktura projektu

```
resinvest-erp/
├── ResInvest_ERP.html             ← wynik budowania: jeden plik (tryb lokalny i interfejs serwera)
├── app/src/
│   ├── i18n.js · i18n.d01–d10.js  ← tłumaczenia (tekst PL = klucz; słowniki CS/EN), formaty liczb i dat
│   ├── engine.js                  ← silnik domenowy (bez DOM): walidacja, księga, korekty, anulowania, raporty, migracje
│   ├── service.js                 ← komendy zmieniające dane (wspólne: przeglądarka i serwer), uprawnienia
│   ├── seed.js                    ← dane przykładowe i minimalne (pierwsze uruchomienie)
│   ├── auth.js                    ← hasła (PBKDF2), polityka haseł, logowanie w trybie lokalnym
│   ├── pdf.js                     ← generator PDF + HTML do druku
│   ├── core.js                    ← rdzeń interfejsu: magazyn danych, logowanie, nawigacja, motywy, języki
│   ├── form.js                    ← formularz „Nowa operacja” i korekty
│   ├── views.js · dashboard.js · admin.js  ← ekrany modułów, pulpit, kartoteki / użytkownicy / administracja
│   └── intro.js · styles.css · index.template.html
├── app/assets/                    ← film intro, czcionki PDF (SIL OFL 1.1)
├── server/core.mjs · riw-server.mjs ← ResInvest ERP Serwer (SQLite, sesje, API, kopie)
├── config/app.config.json         ← przeliczniki i wartości domyślne
├── config/server.config.json      ← konfiguracja serwera (środowisko)
├── data/sample_data.json          ← przykładowe dane testowe
├── tools/                         ← build.mjs, i18n-extract.mjs, export-sample-data.mjs, czcionki PDF
├── installer/                     ← instalator Windows (Inno Setup 6), skrypty uruchomieniowe .cmd
├── tests/                         ← engine, pdf, platform, server (node:test) · e2e.cjs (Playwright) · scenariusze
├── docs/                          ← plan zmian i architektura, sugestie UI
├── TASKS.md · progress.md
└── LICENSE
```

## Budowanie i testy

Wymagany **Node.js ≥ 22.13** (moduł `node:sqlite`).

```bash
cd resinvest-erp
npm run check         # kontrola składni
npm run i18n          # pokrycie tłumaczeń CS/EN (kod wyjścia 1 przy brakach)
npm run build         # → ResInvest_ERP.html (konfiguracja, słowniki, czcionki PDF, film intro)
npm run test:unit     # silnik (68), PDF (4), platforma: i18n, hasła, logowanie, usługi, migracja (19)
npm run test:server   # serwer: setup, logowanie, CSRF, komendy, blokady, kopie, restart (8)
npm i --no-save playwright && npx playwright install chromium   # jednorazowo
npm run test:e2e      # 147 kontroli w przeglądarce (logowanie kontami demonstracyjnymi)
```

### Instalator Windows

Wymaga [Inno Setup 6](https://jrsoftware.org/isdl.php) i dostępu do nodejs.org (pobranie `node.exe`, weryfikacja SHA-256).

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
# → installer\Output\ResInvestERP_Setup_3.0.0.exe   (skrypt uruchamia też testy; -SkipTests pomija)
```

## Kopie zapasowe i bezpieczeństwo danych

* **Serwer:** kopia przy każdym starcie i codziennie o `backup.hour`; przechowywanie `keepDays` dni; kopia ręczna
  (menu Start / *Administracja → Utwórz kopię teraz*). Każda zmiana danych to jedna transakcja SQLite: stan, rewizja
  i wpis dziennika zapisują się razem albo wcale. `--check` sprawdza sumy kontrolne stanu i łańcuch dziennika.
* **Tryb lokalny:** *Administracja → Pobierz kopię (JSON)*; zapis chroniony blokadą między kartami (Web Locks);
  uszkodzone dane są zachowywane pod kluczem `riw.v3.state.uszkodzone.<czas>`.
* **Import kopii** (oba tryby): kontrola struktury, migracja do schematu 4, zachowanie zalogowanego administratora;
  hasła nigdy nie trafiają do kopii JSON.

## Migracja z Demo 2.x

Przy pierwszym uruchomieniu 3.0 w tej samej przeglądarce dane Demo 2.x (`riw.demo.state.v3`) są przenoszone do 3.0
(schemat 4, loginy tworzone z nazwisk). Konta demonstracyjne otrzymują hasło `demo1234`. Na serwer dane przenosi się
kopią JSON: *Administracja → Pobierz kopię* w trybie lokalnym → *Wczytaj kopię* na serwerze.

## Ograniczenia i dalszy rozwój

* Wycena stanu orientacyjna (średnia cena zakupu); pełna wycena magazynowa (FIFO / średnia ruchoma) — kolejna faza.
* Serwer przechowuje stan jako dokument JSON w jednej tabeli (+ dziennik zmian); przy bardzo dużej liczbie operacji
  (setki tysięcy) planowane jest rozbicie na tabele relacyjne — interfejs komend `RIW.Service` pozostaje bez zmian.
* Tryb lokalny chroni dostęp w obrębie programu, ale dane w przeglądarce może odczytać osoba z dostępem do konta
  Windows — do pracy na danych firmy używaj serwera.
* Przeglądarki bez kodeka H.264/AAC pokazują w intro planszę firmową z muzyką syntezowaną.
