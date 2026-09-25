# ResInvest ERP 3.2 (3.2.0)

*Program stworzony przez Roesner Mateusz dla ResInvest Commodities.*

> Wersja 3.2.0 wprowadza **pełny system kont firmowych**: logowanie e-mailem `@resinvest.group` sprawdzanym
> po stronie serwera, dodawanie pracowników **zaproszeniem e-mail** (Resend), reset hasła linkiem, role
> ADMINISTRATOR / MANAGER / MAGAZYNIER / OBSERWATOR / AUDYTOR z edytowalnymi uprawnieniami, statusy kont,
> **izolację danych magazynów** i dziennik audytu z adresem IP. Instalator Windows: Inno Setup 7 (`installer\build-installer.ps1`).

System ERP do **obrotu i magazynowania biomasy drzewnej**: zakupy, produkcja zrębki, sprzedaż, przesunięcia MM,
transport (flota własna, przewoźnicy, kolej), inwentaryzacja z zamknięciem miesiąca, korekty i anulowania,
historia każdej zmiany, raporty dzienne / tygodniowe / miesięczne / roczne, druk i PDF.

Jeden interfejs — plik **`ResInvest_ERP.html`** — działa w dwóch trybach:

| Tryb | Dla kogo | Dane | Logowanie |
|---|---|---|---|
| **Serwer — FIRMOWY** (zalecany do pracy) | wiele stanowisk w sieci firmy, także telefon / tablet | baza **SQLite** na serwerze (transakcje, dziennik zmian z łańcuchem skrótów SHA-256, kopie codzienne) | konta na serwerze, hasła **scrypt**, sesja w ciasteczku HttpOnly, blokada po 5 próbach |
| **Lokalny — OFFLINE** | jedno stanowisko, szkolenie, pokaz | przeglądarka (`localStorage`), kopia JSON na żądanie | konta lokalne, hasła **PBKDF2-SHA256**, wylogowanie po bezczynności |

Program nie korzysta z bibliotek zewnętrznych (CDN) — wszystko jest w pliku HTML. Internet jest potrzebny tylko
serwerowi do wysyłki e-maili (Resend); bez poczty zaproszenia zapisują się jako pliki `.eml`.

## Nowe w 3.2

* **Logowanie e-mailem służbowym** — domena sprawdzana **na serwerze** (`validateCompanyEmail`: dokładnie `@resinvest.group`,
  bez subdomen i podobnych domen), komunikaty bez szczegółów technicznych („Nieprawidłowy e-mail lub hasło.”,
  „Twoje konto jest nieaktywne.”, „Twoje konto nie zostało jeszcze aktywowane.”).
* **Tylko zaproszenia** — *Użytkownicy → Dodaj użytkownika*: imię, nazwisko, e-mail, rola, magazyn domyślny,
  dostępne magazyny → **Wyślij zaproszenie**; pracownik klika link, ustawia hasło, konto staje się aktywne.
  Samodzielna rejestracja domyślnie wyłączona (można ją włączyć w *Administracji*).
* **Nie pamiętam hasła** — link resetu (1 h, jednorazowy), zawsze ta sama odpowiedź; zmiana adresu e-mail wymaga
  potwierdzenia linkiem; powiadomienia „hasło zmienione” i „konto dezaktywowane”. Szablony PL z marką ResInvest ERP.
* **Poczta Resend** (API lub SMTP) konfigurowana w `server.env` (wzór `.env.example`) — klucz tylko na serwerze.
* **Role** ADMINISTRATOR · MANAGER (Kierownik) · MAGAZYNIER · OBSERWATOR · **AUDYTOR** (nowa: odczyt wszystkich
  magazynów i audytu) i **edytor uprawnień ról** (`#/admin/roles`); statusy kont **INVITED / ACTIVE / SUSPENDED / DISABLED**.
* **Wiele magazynów na osobę** (magazyn domyślny + dostępne) i **izolacja danych**: serwer wysyła przeglądarce
  tylko dane dostępnych magazynów; korekty, anulowania i zatwierdzenia tylko w dostępnych magazynach.
* **Dziennik audytu** (`#/admin/audit`): kody zdarzeń (USER_INVITED, ROLE_CHANGED, WAREHOUSE_ACCESS_CHANGED,
  PASSWORD_RESET_REQUESTED…), adres IP i przeglądarka, dziennik logowań, dziennik wysyłek e-mail, CSV.
* **Obieg zatwierdzania wyłączony domyślnie** — magazynier zatwierdza operację sam; włączenie w *Administracji*.
* Zabezpieczenia: brak zmiany własnej roli, rolę ADMINISTRATOR nadaje tylko administrator, ostatniego aktywnego
  administratora nie można zdegradować / zawiesić / dezaktywować / usunąć; magazyny zmienia tylko Administrator.
* Schemat danych **6** (migracja 5 → 6 automatyczna, bez utraty danych). Dokumentacja: `docs/AUTHENTICATION.md`,
  `docs/USERS_AND_ROLES.md`, `docs/EMAIL_SETUP.md`, `docs/SECURITY.md`, `docs/SUPABASE_SETUP.md`.

## Nowe w 3.1

* **Logowanie i rejestracja e-mailem firmowym** (`@resinvest.group`, lista domen w `config/app.config.json` → `companyDomains`).
  Konto administratora: **`magazyn@resinvest.group`**. Rejestracja z ekranu logowania tworzy konto „oczekuje na zatwierdzenie” —
  administrator nadaje rolę i magazyn (moduł Użytkownicy → *Zgłoszenia rejestracji*) albo odrzuca zgłoszenie.
* **Role:** *Administrator* — wszystko, w tym dodawanie innych administratorów, kierowników, magazynierów i obserwatorów;
  *Kierownik* — zatwierdza operacje swojego magazynu, korekty, anulowania, zamknięcia okresów, flota i kartoteki;
  *Magazynier* — wprowadza operacje i **przekazuje je do zatwierdzenia**; *Obserwator* — tylko podgląd.
* **Obieg zatwierdzania:** operacja magazyniera ma status **DO ZATWIERDZENIA** — bez numeru i bez wpływu na stany.
  Kierownik (lub administrator) widzi kolejkę w *Operacjach* i na pulpicie, sprawdza (może poprawić), **zatwierdza**
  (powstają dokumenty, stan sprawdzany w chwili zatwierdzenia) albo **odrzuca z powodem** (wraca do autora jako wersja robocza).
  Dokument zapisuje, kto wprowadził i kto zatwierdził.
* **Magazyny RiC Zabrze, RiC Brąszewice, RiC Rokitki** — ludzie (kierownicy, magazynierzy, obserwatorzy) oraz flota
  (pojazdy, kierowcy, rębaki, operatorzy) **przypisani do magazynów**; formularz podpowiada tylko zasoby magazynu operacji
  (lub „wspólne”). Administrator przełącza swój magazyn roboczy kliknięciem w znacznik magazynu na górnym pasku.
* **Dodawanie, edycja i usuwanie** użytkowników, magazynów, produktów, kontrahentów i floty — usunąć można rekord bez historii;
  rekord użyty w dokumentach się dezaktywuje (historia zostaje nienaruszona).
* **Start pracy na czysto** (Administracja, tylko Administrator): usuwa operacje i dokumenty po szkoleniu,
  zachowuje magazyny, kartoteki, flotę i konta.
* **Nowe intro wejściowe** (film ResInvest Commodities z dźwiękiem), **stopka autorska** w programie i na ekranie logowania.
* Poprawka: logowanie działa także w podglądzie pliku / ramce, w której przeglądarka blokuje pamięć i Web Locks
  (wcześniej po zalogowaniu ekran pozostawał pusty). Program pracuje wtedy w trybie „bez zapisu”.
* Schemat danych 5 (migracja 4 → 5 automatyczna: loginy → adresy e-mail, „Podgląd” → „Obserwator”, flota bez magazynu = wspólna).
  Dane przykładowe z 3.0 w tej samej przeglądarce są zastępowane nowymi (poprzednie zostają w kopii przeglądarki).

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
* **Języki PL · CS · EN — kompletne** (1 542 teksty; w 3.1: 1 669): interfejs, komunikaty silnika i serwera, podpowiedzi formularza,
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

Uruchom **`ResInvestERP_Setup_3.2.0.exe`** (budowanie — niżej) i wybierz:

* **Pełna instalacja** — program + serwer. Instalator dołącza środowisko Node.js (`runtime\node.exe`),
  tworzy folder danych `C:\ProgramData\ResInvestERP` i skróty w menu Start:
  *ResInvest ERP Serwer — uruchom*, *ResInvest ERP (serwer) — otwórz w przeglądarce*, *Kopia zapasowa bazy teraz*,
  *Kontrola spójności bazy*, *Folder danych serwera*, *Konfiguracja poczty i adresu (server.env)*, *Instrukcja*. Opcjonalnie: autostart serwera przy logowaniu
  do Windows i reguła zapory dla portu 8080 (dostęp z sieci lokalnej).
* **Tylko program** — sam plik HTML (tryb lokalny), bez serwera.

Instalator jest dostępny po polsku, czesku i angielsku. Odinstalowanie **nie usuwa** danych serwera, pliku
`config\server.config.json` ani `C:\ProgramData\ResInvestERP\server.env` (aktualizacja też ich nie nadpisuje).

### Pierwsze uruchomienie serwera

1. Menu Start → *ResInvest ERP Serwer — uruchom* (okno konsoli musi pozostać otwarte; przy autostarcie działa zminimalizowane).
2. Przeglądarka otworzy `http://localhost:8080/` → ekran **Pierwsze uruchomienie**: imię i nazwisko administratora,
   e-mail firmowy (domyślnie `magazyn@resinvest.group`), hasło (min. 8 znaków, litery i cyfry); powstają magazyny
   RiC Zabrze, RiC Brąszewice i RiC Rokitki; opcjonalnie dane przykładowe do nauki.
3. **Poczta:** Menu Start → *Konfiguracja poczty i adresu* → uzupełnij `APP_URL` (adres programu w sieci, np.
   `http://192.168.1.20:8080`) i `RESEND_API_KEY`; uruchom serwer ponownie. Konfiguracja Resend i DNS (SPF, DKIM, DMARC):
   [`docs/EMAIL_SETUP.md`](docs/EMAIL_SETUP.md). Bez klucza zaproszenia zapisują się w `C:\ProgramData\ResInvestERP\mail-outbox`.
4. Administrator dodaje pracowników w **Użytkownicy → Dodaj użytkownika → Wyślij zaproszenie** (albo z hasłem
   tymczasowym, gdy poczta nie jest skonfigurowana).
5. Inne komputery / telefony w sieci: `http://<adres-serwera>:8080/` (adres IP pokazuje konsola serwera).

### Tryb lokalny (bez serwera)

Otwórz `ResInvest_ERP.html` w Chrome / Edge / Firefox (zapisany na dysku — podgląd pliku w komunikatorze lub poczcie
działa w trybie „bez zapisu”). Dane przykładowe zawierają konta demonstracyjne — hasło **`demo1234`**
(zmień je w *Mój profil* przed pracą na prawdziwych danych; pulpit przypomina o tym w „Do załatwienia”):

| E-mail (login) | Osoba | Rola | Magazyn |
|---|---|---|---|
| `magazyn@resinvest.group` | Mateusz Roesner | Administrator | wszystkie (domyślny RiC Zabrze) |
| `anna.gorska@resinvest.group` | Anna Górska | Kierownik | RiC Zabrze + RiC Brąszewice |
| `adrian.wojciechowski@resinvest.group` | Adrian Wojciechowski | Magazynier | RiC Zabrze |
| `tomasz.zajac@resinvest.group` | Tomasz Zając | Kierownik | RiC Brąszewice |
| `pawel.kaczmarek@resinvest.group` | Paweł Kaczmarek | Magazynier | RiC Brąszewice |
| `michal.lewandowski@resinvest.group` | Michał Lewandowski | Kierownik | RiC Rokitki |
| `karolina.wisniewska@resinvest.group` | Karolina Wiśniewska | Magazynier | RiC Rokitki |
| `beata.nowak@resinvest.group` | Beata Nowak | Obserwator | RiC Zabrze |
| `ewa.krawczyk@resinvest.group` | Ewa Krawczyk | Audytor | wszystkie (odczyt) |
| `jan.mazur@resinvest.group` | Jan Mazur | Magazynier — **zaproszony** (nie loguje się do aktywacji) | RiC Rokitki |

Flota przykładowa: Zabrze — Scania R450, Volvo FH 500, rębak Jenz HEM 583; Brąszewice — MAN TGX (serwis),
rębak Eschlböck Biber 92; Rokitki — DAF XF 480, rębak Albach Diamant 2000 (z kierowcami i operatorami).

Dane przykładowe: bilans otwarcia 01.08.2026 (Zabrze: drewno 817 m³, zrębka leśna 8 173 MP, PKS i łupina po 728 t),
operacje każdego rodzaju, MM Zabrze → Brąszewice, korekta WZ i anulowany zakup; plik `data/sample_data.json`
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
| **Konta i dostęp** | zaproszenia e-mail, reset hasła, statusy kont, role z edytowalnymi uprawnieniami, magazyn domyślny + dostępne, izolacja danych magazynów, dziennik audytu z IP |
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

Zmienne środowiskowe: `RIW_PORT`, `RIW_HOST`, `RIW_DATA`, `RIW_TODAY` (tylko testy), `RIW_CONFIG` (inna ścieżka pliku konfiguracji).

**Poczta i adres linków** — plik `server.env` (wzór [`.env.example`](.env.example); w instalacji:
`C:\ProgramData\ResInvestERP\server.env`): `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
`EMAIL_TRANSPORT` (`resend` / `smtp` / `file`), `SMTP_*`, `INVITE_HOURS` (72), `RESET_HOURS` (1), `CONFIRM_HOURS` (48).
Plik z kluczem nie trafia do repozytorium (`.gitignore`).

```bash
npm run server                          # uruchomienie (Node.js ≥ 22.13)
node server/riw-server.mjs --open       # … i otwarcie przeglądarki
node server/riw-server.mjs --backup-now # kopia bazy teraz (działa także przy pracującym serwerze)
node server/riw-server.mjs --check      # kontrola spójności bazy i łańcucha skrótów dziennika
node server/riw-server.mjs --restore <plik.sqlite>      # przywrócenie kopii (serwer zatrzymany)
node server/riw-server.mjs --reset-password <login>     # hasło tymczasowe (serwer zatrzymany)
node server/riw-server.mjs --mail-test <adres>          # wiadomość próbna — sprawdzenie konfiguracji poczty
```

Folder danych: `resinvest.sqlite` (baza: stan, dziennik zmian, konta, sesje, tokeny e-mail, kolejka wysyłek),
`backups/` (kopie `VACUUM INTO`), `logs/` (dzienne logi serwera), `mail-outbox/` (transport `file`), `server.env`.
Przywrócenie zachowuje bieżącą bazę jako kopię bezpieczeństwa przed podmianą.

## Struktura projektu

```
resinvest-erp/
├── ResInvest_ERP.html             ← wynik budowania: jeden plik (tryb lokalny i interfejs serwera)
├── app/src/
│   ├── i18n.js · i18n.d01–d12.js  ← tłumaczenia (tekst PL = klucz; słowniki CS/EN), formaty liczb i dat
│   ├── engine.js                  ← silnik domenowy (bez DOM): walidacja, księga, korekty, anulowania, raporty, migracje
│   ├── service.js                 ← komendy zmieniające dane (wspólne: przeglądarka i serwer), uprawnienia
│   ├── seed.js                    ← dane przykładowe i minimalne (pierwsze uruchomienie)
│   ├── auth.js                    ← hasła (PBKDF2), polityka haseł, logowanie w trybie lokalnym
│   ├── pdf.js                     ← generator PDF + HTML do druku
│   ├── core.js                    ← rdzeń interfejsu: magazyn danych, logowanie, nawigacja, motywy, języki
│   ├── form.js                    ← formularz „Nowa operacja” i korekty
│   ├── views.js · dashboard.js · admin.js  ← ekrany modułów, pulpit, kartoteki, użytkownicy, role, audyt, administracja
│   └── intro.js · styles.css · index.template.html
├── app/assets/                    ← film intro, czcionki PDF (SIL OFL 1.1)
├── server/core.mjs · riw-server.mjs ← ResInvest ERP Serwer (SQLite, sesje, tokeny, API, kopie)
├── server/mail.mjs                ← poczta: szablony PL, Resend (API / SMTP), zapis .eml
├── .env.example                   ← wzór zmiennych środowiskowych serwera (bez sekretów)
├── config/app.config.json         ← przeliczniki i wartości domyślne
├── config/server.config.json      ← konfiguracja serwera (środowisko)
├── data/sample_data.json          ← przykładowe dane testowe
├── tools/                         ← build.mjs, i18n-extract.mjs, export-sample-data.mjs, czcionki PDF
├── installer/                     ← instalator Windows (Inno Setup 7 / 6.3+), skrypty uruchomieniowe .cmd
├── tests/                         ← engine, pdf, platform, server, auth (node:test) · e2e.cjs, e2e-server.cjs (Playwright)
├── docs/                          ← uwierzytelnianie, użytkownicy i role, poczta, bezpieczeństwo, audyt i plan zmian
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
npm run test:unit     # silnik (68), PDF (4), platforma: i18n, hasła, logowanie, role, statusy, magazyny, uprawnienia (29)
npm run test:server   # serwer (9) + konta i bezpieczeństwo §34/§35: zaproszenia, reset, izolacja magazynów, 403 (25)
npm i --no-save playwright && npx playwright install chromium   # jednorazowo
npm run test:e2e      # przeglądarka: tryb OFFLINE (178 kontroli) + tryb FIRMOWY z serwerem i pocztą .eml (24 kontrole)
```

### Instalator Windows

Wymaga [Inno Setup 7](https://jrsoftware.org/isdl.php) (lub 6.3+) i dostępu do nodejs.org (pobranie `node.exe`,
weryfikacja SHA-256). Skrypt odnajduje `ISCC.exe` w PATH, w `Program Files` (Inno Setup 7 i 6) i w rejestrze.
Plik `.iss` jest zapisany w UTF-8 z BOM (polskie i czeskie znaki w Inno Setup 7).

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
# → installer\Output\ResInvestERP_Setup_3.2.0.exe   (skrypt uruchamia też testy; -SkipTests pomija)
```

## Kopie zapasowe i bezpieczeństwo danych

* **Serwer:** kopia przy każdym starcie i codziennie o `backup.hour`; przechowywanie `keepDays` dni; kopia ręczna
  (menu Start / *Administracja → Utwórz kopię teraz*). Każda zmiana danych to jedna transakcja SQLite: stan, rewizja
  i wpis dziennika zapisują się razem albo wcale. `--check` sprawdza sumy kontrolne stanu i łańcuch dziennika.
* **Tryb lokalny:** *Administracja → Pobierz kopię (JSON)*; zapis chroniony blokadą między kartami (Web Locks);
  uszkodzone dane są zachowywane pod kluczem `riw.v3.state.uszkodzone.<czas>`.
* **Import kopii** (oba tryby): kontrola struktury, migracja do bieżącego schematu (6), zachowanie zalogowanego administratora;
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
