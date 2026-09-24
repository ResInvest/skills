# ResInvest ERP — Demo v2.3 (2.3.0)

Samodzielny plik **`ResInvest_ERP_demo.html`** — funkcjonalnie kompletny prototyp logiki ResInvest ERP
(obrót i magazyn biomasy). Otwiera się dwuklikiem: bez serwera, bez internetu, bez bibliotek z CDN.

> Demo zapisuje dane w `localStorage` przeglądarki **wyłącznie do celów pokazowych**. To nie jest Production v1 —
> wdrożenie produkcyjne wymaga bazy danych z transakcjami i serwera (patrz `docs/RESINVEST_CHANGE_PLAN.md`, „Architektura Production v1”).

## Nowe w 2.3

* **Dostawca i nadleśnictwo wpisywane ręcznie:** pole tekstowe z podpowiedziami z kartoteki. Nazwa zgodna z kartoteką (bez względu na wielkość liter) wskazuje istniejącego kontrahenta i ustawia jego grupę oraz podstawę; nowa nazwa jest oznaczana „nowy dostawca” i przy zatwierdzeniu operacji dopisuje się do kartoteki Kontrahenci (z grupą firma / nadleśnictwo i wpisem w audycie). Leśnictwo — jak dotąd: z listy lub wpisane.

## Nowe w 2.2

* **Dostawca w dwóch grupach:** *Firma branży drzewnej / przedsiębiorstwo drzewne* (podstawa domyślnie **KZR**) albo *Nadleśnictwo* (podstawa domyślnie **Deklaracja** + pole **Leśnictwo** — wybór z zapisanych lub wpis nowego). Podstawę można zmienić ręcznie. Przy produkcji z drewna z nadleśnictwa nadleśnictwo i leśnictwo uzupełniają się same.
* **Transport własny — liczba kursów:** po wpisaniu np. 4 pojawiają się 4 rubryki (pojazd z floty, kierowca domyślny — można zmienić, km, stawka domyślna, ilość MP w kursie, waga rzeczywista t). Podsumowanie: łączna ilość, tony, km i koszt. Przykład: 4 × 100 MP = 400 MP z produkcji na magazyn Zabrze.
* Poprawka: opisy wyliczeń pod polami (np. „0 km × 5,00 zł/km”) nie powielają się przy kolejnych przeliczeniach.

## Co umie Demo v2.1

| Obszar | Zawartość |
|---|---|
| **Operacje** | Zakup (PZ, opcjonalnie łańcuch produkcja + sprzedaż) · Sprzedaż z magazynu (WZ) · Produkcja na magazyn (RW + PW) · Produkcja + sprzedaż bezpośrednia (PW + WZ, stan bez zmian) · Przesunięcie MM |
| **Produkcja na magazyn** | podajesz ilość produkcji (MP) → system liczy zużycie surowca (MP ÷ 4 = m³); blokada braku surowca („Dostępne / Wymagane / Brakuje”), surowiec ≠ produkt, kontrola przelicznika, pełna precyzja (6 miejsc) przed walidacją, **bez transportu** |
| **Zatwierdzanie** | podsumowanie przed zatwierdzeniem (stan przed/po, zużycie, masa, GJ, koszty, dokumenty); zapis atomowy; ochrona przed podwójnym kliknięciem i podwójnym zapisem |
| **Statusy** | ROBOCZY (wersja robocza bez numeru i wpływu na stan) · ZATWIERDZONY · SKORYGOWANY · ANULOWANY — kolumna „Status” w rejestrach |
| **Anulowanie** | nigdy nie usuwa dokumentu; dokument AN odwraca skutki; przyczyna wymagana; analiza zależności w czasie — blokada, gdy towar został wykorzystany później; potwierdzenie przy operacjach zależnych |
| **Korekty** | dokument KOR („KOREKTA dokumentu nr …”): ilościowe w obie strony, produkcji (ze zmianą zużycia), sprzedaży bezpośredniej, wartościowe (ceny, cena za rąbanie), opisowe; powód z listy + opis; podgląd oryginał / korekta / różnica / wpływ na stan; odwrócenie korekty nową korektą |
| **Historia** | rejestr ruchów: data, godzina, użytkownik, typ, dokument, magazyn, produkt, ilość, jednostka, stan przed / zmiana / stan po, kontrahent, powiązana operacja, uwagi, status; filtry: dzień/tydzień/miesiąc/rok/zakres, magazyn, produkt, typ, użytkownik, kontrahent, status; dziennik audytu |
| **Raporty** | okres: dzień / tydzień / miesiąc / rok / zakres własny; magazyn lub wszystkie; filtr produktu i kontrahenta; widok biznesowy (netto) i audytowy; bilans stan pocz. + przyjęcia + produkcja − zużycie − sprzedaż ± MM = stan końc. z kontrolą spójności; zakupy, produkcja i koszt rąbania, zużycie, sprzedaż, MM, transport, korekty, anulowania, wycena („brak wyceny”), status zamknięcia okresu; drill-down do operacji źródłowych; CSV |
| **Druk i PDF** | DRUKUJ (okno wydruku) i GENERUJ PDF (prawdziwy PDF: tekst wektorowy, osadzona czcionka z polskimi znakami, logo, numer raportu, magazyn, okres, data, użytkownik, tabele, podsumowania, pola podpisu, „Strona X z Y”) — dla raportów, historii, kwitu i pojedynczych dokumentów; każde wygenerowanie zapisane w audycie |
| **Kwit produkcji dnia** | data, magazyn, operator, surowiec, zużycie, produkt, MP, m³, t, GJ, cena i koszt rąbania, uwagi, nr dokumentu; druk i PDF |
| **Pulpit** | KPI (stany z ≈ t i ≈ GJ, wartość stanu, zakup, sprzedaż, produkcja, zużycie, operacje, transport), stany graficznie z linią 30 dni, **OBROTY WEDŁUG TYPU OPERACJI** z zakresem dzień/tydzień/miesiąc/rok/własny; jednostek się nie sumuje |
| **Pozostałe** | Przyjęcia, Wydania/WZ, MM, Transport, Stany, Dokumenty, Inwentaryzacja i zamknięcie miesiąca, Flota, Produkty, Kontrahenci, Magazyny, Administracja (role, macierz uprawnień, kopie, import) |

## Przeliczniki (centralnie w silniku i `config/demo.config.json`)

| Przelicznik | Wartość |
|---|---|
| 1 m³ drewna | 4 MP zrębki (1 MP = 0,25 m³) |
| 1 MP zrębki | 0,33 t (orientacyjnie) |
| 1 m³ drewna | 0,952 t (orientacyjnie; 817 m³ ≈ 778 t) |
| 1 t biomasy | 8,5 GJ (orientacyjnie) |
| PKS, łupina nerkowca | tylko t |

Masa i energia są orientacyjne i nie zmieniają ilości na stanie. GJ liczone z masy dokładnej: 817 m³ → 777,784 t → 6 611 GJ
(przykład w poleceniu — 6 613 GJ — liczy z masy zaokrąglonej do 778 t; różnica < 0,02 %).

## Szybki start

| Sposób | Kroki |
|---|---|
| Plik | Otwórz `ResInvest_ERP_demo.html` w Chrome / Edge / Firefox |
| Instalator Windows | `ResInvestERP_Demo_Setup_2.3.0.exe` (budowanie: niżej) → skrót „ResInvest ERP — demonstrator” |

Użytkownika (a więc magazyn aktywny i uprawnienia) zmienia się w prawym górnym rogu:

| Użytkownik | Rola | Magazyn | Może |
|---|---|---|---|
| Mateusz Roesner | Administrator | RiC Zabrze | wszystko, także korekty/anulowania w innych magazynach |
| Anna Górska *(domyślny)* | Kierownik | RiC Zabrze | operacje, `documents.cancel`, `documents.correct`, `*.correct`, zamknięcie okresu, flota, kopie |
| Adrian Wojciechowski | Magazynier | RiC Zabrze | operacje, wersje robocze, spis — **bez** anulowania i korekt |
| Paweł Kaczmarek | Magazynier | RiC Pyskowice | jw. w Pyskowicach |
| Beata Nowak | Podgląd | RiC Zabrze | tylko odczyt, raporty |

Dane przykładowe: bilans otwarcia 01.08.2026 (Zabrze: drewno 817 m³, zrębka leśna 8 173 MP, PKS i łupina po 728 t),
operacje każdego rodzaju, MM Zabrze → Pyskowice, korekta WZ (100 → 90 MP) i anulowany zakup. Zabrze po danych przykładowych:
drewno **817 m³**, zrębka leśna **8 293 MP**, PKS **728 t**.

## Struktura projektu

```
resinvest-erp/
├── ResInvest_ERP_demo.html        ← wynik budowania (jeden plik, ~2,5 MB z filmem intro)
├── demo/src/
│   ├── engine.js                  ← silnik domenowy (bez DOM, testowany w Node): walidacja, księga, anulowanie, korekty, raporty
│   ├── seed.js                    ← dane przykładowe (księgowane przez silnik)
│   ├── pdf.js                     ← generator PDF + HTML do druku (jeden model treści)
│   ├── app.js                     ← rdzeń interfejsu: nawigacja, zapis, formularz operacji / korekty
│   ├── views.js                   ← ekrany modułów, szczegóły dokumentu, anulowanie, raporty, kwit, wykresy
│   ├── intro.js · styles.css · index.template.html
├── demo/assets/intro.mp4
├── demo/assets/fonts/             ← ResInvestDocSans (podzbiór Liberation Sans, SIL OFL 1.1) + metrics.json + LICENSE-OFL.txt
├── config/demo.config.json        ← konfiguracja środowiska (przeliczniki, stawki)
├── data/sample_data.json          ← przykładowe dane testowe (kopia do wczytania)
├── tools/build-demo.mjs · tools/pdf-fonts.mjs · tools/make-pdf-fonts.py · tools/export-sample-data.mjs
├── installer/                     ← instalator Windows (Inno Setup 6)
├── tests/engine.test.mjs          ← testy silnika (§22, §31.16, §32.23, testy 11–42)
├── tests/pdf.test.mjs             ← testy generatora PDF
├── tests/e2e.cjs                  ← scenariusze w przeglądarce (Playwright)
├── tests/resinvest_demo_scenarios.md
├── docs/RESINVEST_CHANGE_PLAN.md  ← rozpoznanie, decyzje, architektura Production v1
├── docs/RESINVEST_UI_SUGGESTIONS.md
├── TASKS.md                       ← wymagania → status → dowód
└── progress.md
```

## Budowanie i testy

Wymagany Node.js ≥ 18.

```bash
cd resinvest-erp
npm run check        # kontrola składni źródeł
npm run build        # → ResInvest_ERP_demo.html (wstrzykuje konfigurację, czcionki PDF i film intro)
npm run test:unit    # 63 testy: silnik + generator PDF
npm i --no-save playwright && npx playwright install chromium   # jednorazowo
npm run test:e2e     # 128 kontroli w przeglądarce
# pełna kontrola tekstu PDF (polskie znaki) — Python z pypdf:
PDF_PYTHON=/ścieżka/do/python npm run test:e2e
```

Czcionek PDF nie trzeba generować — są w repozytorium. Odtworzenie: `pip install fonttools && python3 tools/make-pdf-fonts.py`.

### Instalator Windows

Wymaga [Inno Setup 6](https://jrsoftware.org/isdl.php).

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
# → installer\Output\ResInvestERP_Demo_Setup_2.3.0.exe
```

## Kopie zapasowe i dane

* *Administracja → Pobierz kopię (JSON)* — pełny stan (operacje, dokumenty, korekty, anulowania, księga, inwentaryzacja, flota, audyt).
* *Wczytaj kopię* — kontrola struktury (schemat 3) przed zastąpieniem danych; import zapisywany w audycie.
* Uszkodzone dane są zachowywane pod kluczem `riw.demo.state.v3.uszkodzone.<czas>`, a program startuje na danych przykładowych.
* Dane z wersji 2.0 (`riw.demo.state.v2`) i 1.x pozostają nienaruszone pod starymi kluczami; 2.1 startuje na danych przykładowych.

## Ograniczenia demonstratora

* Dane żyją w jednej przeglądarce; wieloużytkowość jest symulowana przełącznikiem użytkownika, blokada zapisu (Web Locks) działa między kartami tej samej przeglądarki.
* Brak logowania hasłem i serwerowej kontroli uprawnień — uprawnienia sprawdza silnik w przeglądarce.
* Wycena orientacyjna (średnia cena zakupu); pełna wycena magazynowa — etap produkcyjny.
* Znacznik czasu audytu to czas rzeczywisty komputera, a data operacji — data systemowa demo (ustawiana w Administracji).
* Przeglądarki bez kodeka H.264/AAC pokazują planszę firmową z muzyką syntezowaną zamiast filmu intro.
