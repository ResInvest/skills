# ResInvest ERP — Demo v2 — scenariusze walidacyjne

Plik: `ResInvest_ERP_demo.html` (dwuklik — bez serwera i internetu).

| Zestaw | Polecenie | Wynik |
|---|---|---|
| Testy jednostkowe silnika | `npm run test:unit` | **33/33 OK** |
| Scenariusze w przeglądarce (Chromium) | `npm run test:e2e` | **83/83 OK**, konsola bez wyjątków |

## Przygotowanie

1. Otwórz plik, pomiń intro (`Esc`).
2. Użytkownik: **Anna Górska — Kierownik**, magazyn **RiC Zabrze**.
3. Czysty start: *Dane i ustawienia → Przywróć dane przykładowe*.

Stan startowy RiC Zabrze (Stany):

| Produkt | Stan (jednostka magazynowa) | Masa orientacyjna |
|---|---|---|
| Zrębka produkcyjna leśna | **8 293 MP** | ≈ 2 737 t (× 0,33) |
| Drewno opałowe | **817 m³** | ≈ 778 t (× 0,952) |
| PKS (łupina palmowa) | **728 t** | — (produkt tonowy) |
| Łupina nerkowca | **728 t** | — |

Szybki start z Pulpitu: **Zakup · Sprzedaż z magazynu · Produkcja na magazynie · Produkcja + sprzedaż bezpośrednia**.

---

## 1–2. Sprzedaż z magazynu (WZ)

Nowa operacja → **Sprzedaż** (bez zaznaczenia „bezpośredniej”).

| Krok | Oczekiwane |
|---|---|
| Towar: *Zrębka produkcyjna leśna* | Stan na magazynie **8 293 MP**; jednostki do wyboru: MP, t |
| Ilość `8293,01` | błąd „Na magazynie jest 8 293 MP — nie można sprzedać …”, zapis zablokowany |
| Ilość `500`, cena `90`, odbiorca *Elektrociepłownia Zabrze S.A.* | Stan po WZ **7 793 MP**, wartość **45 000,00 zł**, miejsce dostawy = odbiorca |
| Przebieg | tylko `WZ` — bez zakupu i produkcji |
| Zapis | dokument WZ; Stany: **7 793 MP**; Historia: stan przed 8 293 → po 7 793 |

Wariant: WZ w tonach — `33 t` zrębki = 100 MP ze stanu. PKS: jedyna jednostka **t**; `28 t` → 700 t.

## 3–4. Produkcja na magazynie

Nowa operacja → **Produkcja na magazynie**.

| Krok | Oczekiwane |
|---|---|
| Surowiec | *Drewno opałowe*, stan **817 m³**; brak pól zakupu i dostawcy |
| Zużycie `818` | błąd „Na magazynie jest 817 m³” |
| Zużycie `817` | Wyprodukowano (auto) **3 268 MP** ≈ 1 078 t |
| Cena za rąbanie | **10,00 zł/MP** (domyślnie) → koszt rąbania **32 680,00 zł** |
| Przebieg / zapis | `RW → PW`; drewno **0 m³**, zrębka **+3 268 MP**; PW ma pole „Z dokumentu zużycia: RW/…” |

Wynik ręczny mniejszy niż zużycie (np. 100 m³ → 380 MP) wymaga przyczyny różnicy; większy (401 MP) jest blokowany.

## 5–6. Produkcja + sprzedaż bezpośrednia (las → odbiorca)

Nowa operacja → **Sprzedaż** → zaznacz **Sprzedaż bezpośrednia po produkcji / prosto z lasu**.

| Krok | Oczekiwane |
|---|---|
| Formularz | brak zakupu i wyboru towaru z magazynu; sekcje „Produkcja (w lesie)” i „Odbiorca i cena” |
| Produkcja leśna: NDL, leśnictwo, kwit; Wyprodukowano `600` | masa ≈ 198 t |
| Odbiorca *Elektrownia Łaziska*, cena `88` zł/MP | przychód **52 800,00 zł** |
| Ilość sprzedaży `600,5` | błąd „przekracza wynik produkcji 600 MP” |
| Cena za rąbanie `12,50` | koszt rąbania **7 500,00 zł** (widoczny w „Koszty i przychód”) |
| Przebieg | `PW → WZ` (bezpośrednio); tabela „Stan w magazynie”: przed = po |
| Zapis | stan zrębki i drewna **bez zmian**; zapisane: wyprodukowano 600 MP, sprzedano 600 MP, odbiorca, cena, miejsce dostawy, transport, dokumenty, historia |

Opcjonalnie: surowiec *Drewno opałowe* `150 m³` (nie jest zdejmowany ze stanu) → wynik maks. 600 MP; koszt surowca wlicza się w wynik.
Sprzedaż mniejsza od produkcji (np. 500 z 600 MP) → ostrzeżenie; reszta 100 MP trafia na stan.

## A / E. Zakup i zakup → magazyn → późniejsza WZ

* **Zakup** *Zrębka towar* 250 MP × 55 zł → tylko `PZ`, stan 300 → 550 MP.
* Następnie **Sprzedaż (WZ)** 550 MP → stan 0 MP.
* Zakup *PKS*: jednostka wyłącznie **t**, produkcja niedostępna.
* Zakup *Drewno opałowe* 20 m³ × 230 zł → +20 m³ (= 80 MP zrębki po przerobie), koszt 4 600 zł, masa ≈ 19,04 t.
* Zakup z „+ Produkcja” i „+ Sprzedaż wyniku” (łańcuch z v1) działa dalej: `PZ → RW → PW → WZ`.

## 10–12. Pociąg

W sekcji „Miejsce i transport” zaznacz **Pociąg**.

| Krok | Oczekiwane |
|---|---|
| Liczba wagonów `20`, pojemność `60` t, **Tonaż taki sam dla wszystkich** `60` | Łączny tonaż **1 200 t** (20 × 60) |
| Cena `25` zł/t | koszt **30 000,00 zł** |
| Podsumowanie składu | liczba wagonów, łączna pojemność, tonaż, **łączny tonaż składu**, miejsce załadunku, miejsce dostawy, przewoźnik, nr dokumentu, koszt |
| **Wpisz tonaż każdego wagonu osobno** | tabela 20 wagonów; wpisy 58,4 / 60,1 / 59,7 / 61,2 / 59,8 … → suma liczona automatycznie (**1 196,8 t**) |
| Puste pole wagonu | błąd przy tym wagonie |
| Jednostka pojemności **MP** | „Łączna pojemność (MP): 20 × 60 = 1 200 MP” |
| Zapis | `WZ + TR`; stan zmienia się tylko o WZ — transport = 0 |

## 13–14. Cena za rąbanie

Pole **Cena za rąbanie [zł/MP]** w każdej produkcji: domyślnie **10,00**. 500 MP × 10 zł = **5 000 zł**. Zmiana na `12,50` przelicza koszt natychmiast.
Koszt widoczny w podsumowaniu, na dokumencie PW, w *Historia → Rejestr operacji* (kolumna „Rąbanie”) i w *Raporcie miesięcznym/rocznym*.

## 15. Przecinek dziesiętny

WZ zrębki, cena `2`: `12,50` / `12.50` → 25,00 zł; `1 250,50` / `1 250,50` (spacja nierozdzielająca) / `1.250,50` → 2 501,00 zł. `12,5x` → komunikat błędu (nie 0).

## 16. Jasny motyw

Jasne tło, białe karty, grafitowy tekst, ciemniejsze nagłówki, zielony akcent ResInvest. Intro pozostaje ciemne (film).

## Kontrole przekrojowe

| Kontrola | Oczekiwane |
|---|---|
| Formularze (4 rodzaje) | brak pól magazyn/pryzma źródłowa i docelowa |
| Plan dokumentów | kolumna „Miejsce transportu”; korekta (storno) WZ przywraca stan |
| Podwójne kliknięcie „Zapisz” | jedna operacja |
| Dwie karty, dwie WZ po 5 000 MP z 8 293 MP | pierwsza zapisana, druga odrzucona; stan 3 293 MP |
| Inwentaryzacja 2026-08 | pozycje w jednostkach produktów (m³ / MP / t); PKS 727,5 → różnica −0,5 t; po zamknięciu tylko odczyt |
| Telefon 390 px | wszystkie ekrany bez przewijania w poziomie, lista wagonów mieści się |
| Intro | muzyka domyślnie włączona; przy blokadzie autoplay pierwsze kliknięcie ją włącza |
