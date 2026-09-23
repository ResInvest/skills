# ResInvest ERP — Demo v2 (2.0.0)

Samodzielny plik **`ResInvest_ERP_demo.html`** pokazujący logikę operacji ResInvest ERP.
Cztery niezależne scenariusze, każdy działa samodzielnie:

| Scenariusz | Przebieg | Dokumenty | Wpływ na stan |
|---|---|---|---|
| **Zakup** | dostawca → magazyn (opcjonalnie + produkcja z autozużyciem + sprzedaż wyniku) | PZ (+ RW, PW, WZ) | + towar |
| **Sprzedaż z magazynu** | magazyn → odbiorca | WZ | − towar (nie więcej niż stan) |
| **Produkcja na magazynie** | surowiec ze stanu → produkcja → produkt na stanie | RW + PW | − surowiec, + produkt |
| **Produkcja + sprzedaż bezpośrednia** | las → produkcja → odbiorca | PW + WZ | bez zmian |

Do tego: stany w jednostce produktu (drewno m³, zrębka MP, PKS i łupina nerkowca tylko t) z masą orientacyjną,
cena za rąbanie (domyślnie 10 zł/MP), transport kolejowy z tonażem wspólnym lub per wagon i podsumowaniem składu,
inwentaryzacja miesięczna, flota, historia zmian i jasny motyw. Otwiera się dwuklikiem — bez serwera, bez internetu, bez bibliotek z CDN.

> Demonstrator zapisuje dane w `localStorage` przeglądarki **wyłącznie do celów pokazowych**.
> Produkcyjne wdrożenie (FAZA 2) wymaga bazy danych z transakcjami — patrz `docs/RESINVEST_CHANGE_PLAN.md` §7.

## Szybki start

| Sposób | Kroki |
|---|---|
| Plik | Otwórz `ResInvest_ERP_demo.html` w Chrome / Edge / Firefox |
| Instalator Windows | Uruchom `ResInvestERP_Demo_Setup_2.0.0.exe` (budowanie: niżej) → skrót „ResInvest ERP — demonstrator” w menu Start |

Intro startuje z muzyką. Jeśli przeglądarka zablokuje dźwięk, film gra wyciszony, a pierwsze
kliknięcie włącza muzykę. „Pomiń intro” lub `Esc` zamyka ekran powitalny.

Użytkownika (a więc i **magazyn aktywny**) zmienia się w prawym górnym rogu:

| Użytkownik | Rola | Magazyn | Może |
|---|---|---|---|
| Mateusz Roesner | Administrator | RiC Zabrze | wszystko |
| Anna Górska *(domyślny)* | Kierownik | RiC Zabrze | operacje, korekty, zamknięcie inwentaryzacji, flota, kopie |
| Adrian Wojciechowski | Magazynier | RiC Zabrze | operacje, otwarcie okresu i spis |
| Paweł Kaczmarek | Magazynier | RiC Pyskowice | jw. w Pyskowicach |
| Beata Nowak | Podgląd | RiC Zabrze | tylko odczyt |

## Moduły

| Moduł | Zawartość |
|---|---|
| **Pulpit** | stany drewna (m³ ≈ t), zrębki (MP ≈ t) i produktów tonowych (t), przychód i koszty miesiąca (w tym rąbanie), ostatnie operacje, szybki start 4 scenariuszy |
| **Nowa operacja** | rodzaj: Zakup / Sprzedaż (z magazynu albo „bezpośrednia po produkcji / prosto z lasu”) / Produkcja na magazynie; cena za rąbanie; miejsce transportu; transport własny / zewnętrzny / pociąg (liczba wagonów, pojemność w t lub MP, tonaż wspólny albo osobno dla każdego wagonu, podsumowanie składu); samouczek pod polami; panel przebiegu, stanów przed/po, kosztów i planu dokumentów |
| **Stany** | stan w jednostce magazynowej produktu + masa orientacyjna (≈ t), stan na dzień, kartoteka z saldem, CSV |
| **Plan dokumentów** | PZ, RW, PW, WZ, TR, KO, IN, BO z kolumną **Miejsce transportu** i wpływem na stan; podgląd/wydruk; korekta (storno); CSV |
| **Inwentaryzacja** | okres `RRRR-MM` na magazyn, OTWARTA → ZAMKNIĘTA, lista ze stanu księgowego, spis, różnice, dokument IN, blokada okresu, automatyczne zamknięcie przy przełomie miesiąca |
| **Flota** | pojazdy (ruchome podłogi / ciężarowe) z rejestracją, statusem i kierowcą domyślnym; kierowcy; rębaki z operatorem; operatorzy; historia kursów z kierowcą kursu |
| **Historia zmian** | dziennik audytu (użytkownik, czas, obiekt, akcja, źródło, stan przed/po) z filtrami; rejestr operacji z rodzajem i kosztem rąbania; raport miesięczny i roczny (zakup, rąbanie, transport, przychód, wynik); CSV |
| **Dane i ustawienia** | kopia zapasowa JSON, import z kontrolą struktury, dane przykładowe, preferencje (samouczek, intro, muzyka), data systemowa demo, kontrola przełomu miesiąca |

## Zasady domenowe

* Księga w **jednostce magazynowej produktu**: drewno m³, zrębka MP, PKS / łupina nerkowca t (tylko t — bez przeliczeń na MP/m³).
* `1 m³ drewna = 4 MP zrębki`. Masa orientacyjna: zrębka × 0,33 t/MP, drewno × 0,952 t/m³ (817 m³ ≈ 778 t) — informacja pomocnicza; waga rzeczywista **nie zmienia** ilości na stanie.
* Koszt zakupu = ilość × cena; koszt rąbania = MP × cena za rąbanie (domyślnie 10 zł/MP); transport to osobny koszt.
* Księgowanie w stałej kolejności, symulowane krok po kroku; ujemny stan na dowolnym kroku = odrzucenie całej operacji.
* WZ ≤ stan magazynowy; zużycie ≤ stan (+ zakup w łańcuchu); wynik produkcji ≤ zużycie × 4; sprzedaż po produkcji ≤ wynik produkcji.
* Sprzedaż bezpośrednia zapisuje PW i WZ tej samej operacji — stan końcowy produktu się nie zmienia.
* **Transport nie tworzy zapisów w księdze** — tylko koszt i karta TR.
* Magazyn aktywny wynika z użytkownika; formularz nie ma pól magazynu/pryzmy źródłowej i docelowej.
* Każda zmiana ma wpis audytu ze stanem przed i po. Historii się nie edytuje — korekta tworzy dokument KO.

## Struktura projektu

```
resinvest-erp/
├── ResInvest_ERP_demo.html        ← Demo v2 (wynik budowania, ~2,3 MB z filmem intro)
├── demo/src/
│   ├── engine.js                  ← silnik domenowy (bez DOM, testowany w Node)
│   ├── seed.js                    ← dane przykładowe (księgowane przez silnik)
│   ├── app.js                     ← interfejs (moduły ekranów)
│   ├── intro.js                   ← intro + muzyka (autoplay, fallback Web Audio)
│   ├── styles.css                 ← styl ResInvest (jasny motyw, zielony akcent, responsywność)
│   └── index.template.html
├── demo/assets/intro.mp4          ← film intro z wersji 1.3.0 (H.264 + AAC)
├── config/demo.config.json        ← konfiguracja środowiska (przeliczniki, stawki)
├── data/sample_data.json          ← przykładowe dane testowe (kopia do wczytania)
├── tools/build-demo.mjs           ← składa jeden plik HTML
├── tools/export-sample-data.mjs
├── installer/                     ← instalator Windows (Inno Setup 6)
├── tests/engine.test.mjs          ← testy jednostkowe (node:test)
├── tests/e2e.cjs                  ← scenariusze v2 w przeglądarce (Playwright)
├── tests/resinvest_demo_scenarios.md
├── docs/RESINVEST_CHANGE_PLAN.md  ← rozpoznanie 1.3.0, decyzje, ryzyka, FAZA 2
├── docs/RESINVEST_UI_SUGGESTIONS.md
└── progress.md
```

## Budowanie i testy

Wymagany Node.js ≥ 18.

```bash
cd resinvest-erp
npm run check        # kontrola składni źródeł
npm run build        # → ResInvest_ERP_demo.html (wstrzykuje config/demo.config.json i film intro)
npm run test:unit    # 33 testy silnika Demo v2
npm i --no-save playwright && npx playwright install chromium   # jednorazowo
npm run test:e2e     # 83 kontrole w przeglądarce (16 punktów kontrolnych v2)
```

Konfiguracja: zmień `config/demo.config.json` (np. `chipRateDefault`, `woodTPerM3`, `kmRateDefault`) → `npm run build` →
w programie *Dane i ustawienia → Przywróć dane przykładowe*. Zapisane dokumenty zachowują swoje wartości.

### Instalator Windows

Wymaga [Inno Setup 6](https://jrsoftware.org/isdl.php).

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
# → installer\Output\ResInvestERP_Demo_Setup_2.0.0.exe
```

Instalacja per użytkownik (bez uprawnień administratora), skróty w menu Start i na pulpicie,
dokumentacja i `data/sample_data.json` w katalogu programu.

## Kopie zapasowe i dane

* *Dane i ustawienia → Pobierz kopię (JSON)* — pełny stan (operacje, księga, dokumenty, inwentaryzacja, flota, audyt).
* *Wczytaj kopię* — kontrola struktury przed zastąpieniem danych; import jest zapisywany w audycie.
* Uszkodzone dane w przeglądarce są zachowywane pod kluczem `riw.demo.state.v2.uszkodzone.<czas>`, a program startuje na danych przykładowych.
* Tryb prywatny / zablokowany `localStorage`: program działa w pamięci i ostrzega, że zmiany znikną.

## Ograniczenia demonstratora

* Dane żyją w jednej przeglądarce jednego komputera. Wieloużytkowość jest symulowana przełącznikiem użytkownika; blokada zapisu (Web Locks) działa między kartami tej samej przeglądarki.
* Brak logowania hasłem (w 1.3.0 istnieje — zostaje w FAZIE 2).
* Przeglądarki bez kodeka H.264/AAC (np. część dystrybucji Chromium/Firefox na Linuksie) pokazują planszę firmową z muzyką syntezowaną zamiast filmu.
* Użytkownicy z ustawieniem „ogranicz ruch” (`prefers-reduced-motion`) nie widzą intro — jak w 1.3.0.

## Dane z Demo v1

Demo v2 zmienia model księgi (jednostka produktu zamiast MP dla wszystkiego), dlatego zapisuje dane pod nowym kluczem
`riw.demo.state.v2`. Dane z v1 w tej samej przeglądarce pozostają nienaruszone pod `riw.demo.state.v1`; kopii JSON z v1
nie da się wczytać do v2 (kontrola struktury ją odrzuci).
