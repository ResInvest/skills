# ResInvest ERP — scenariusze walidacyjne demonstratora (FAZA 1)

Plik: `ResInvest_ERP_demo.html` (otwórz dwuklikiem, bez serwera i internetu).

Automaty:

| Zestaw | Polecenie | Wynik (23.09.2026) |
|---|---|---|
| Testy jednostkowe silnika | `npm run test:unit` | **33/33 OK** |
| Scenariusze w przeglądarce (Chromium) | `npm run test:e2e` | **85/85 OK**, konsola bez wyjątków |

## Przygotowanie

1. Otwórz plik. Intro startuje z muzyką (przy blokadzie autoplay: kliknij raz w ekran).
2. „Pomiń intro” albo `Esc`.
3. Użytkownik (prawy górny róg): **Anna Górska — Kierownik**, magazyn aktywny **RiC Zabrze**.
4. Czysty start: *Dane i ustawienia → Przywróć dane przykładowe*.

Stan startowy RiC Zabrze: drewno opałowe **60 m³ (240 MP)**, zrębka produkcyjna leśna **520 MP**,
zrębka inwestycyjna 120 MP, zrębka towar 300 MP.

---

## SCENARIUSZ A — zakup w m³

**Dane:** Nowa operacja → Dostawca *Lander Agro* · Podstawa *KZR* · Produkt *Drewno opałowe* ·
Ilość `20` · Jednostka *m³* · Cena `230` · Waga *Automatyczna* · Miejsce transportu *RiC Zabrze*.

**Oczekiwane:**

| Kontrola | Wartość |
|---|---|
| Pod polem Ilość | `= 80 MP · 20 m³ · 26,4 t` |
| Waga wyliczona | **26,4 t** (80 MP × 0,33) |
| Koszt całkowity zakupu | **4 600,00 zł** |
| Przebieg | `PZ 1. Zakup — Drewno opałowe +80 MP` |
| Po zapisie | dokument `PZ/…`; Stany: drewno **80 m³** (+20 m³) |

Dodatkowo: przełącz *Waga → Ręczna*, wpisz `27,10` — ilość na stanie nadal 80 MP.

## SCENARIUSZ B — zakup + produkcja leśna

**Dane:** jak A + zaznacz **Produkcja z automatycznym zużyciem** · Rodzaj *Zrębka produkcyjna leśna* ·
Nadleśnictwo `Rudy Raciborskie` · Leśnictwo `Stanica` · Nr kwitu `KW 0300/09/2026`.
Zużycie i Wynik zostaw puste (automatycznie: całość = 20 m³ → 80 MP).

**Oczekiwane:**

| Krok | Dokument | Zmiana |
|---|---|---|
| 1. Zakup | PZ | drewno +80 MP |
| 2. Zużycie | RW | drewno −80 MP |
| 3. Produkcja | PW | zrębka leśna +80 MP |

* Stan drewna po zapisie = stan przed (brak podwójnego liczenia).
* Zrębka produkcyjna leśna +80 MP.
* Wpisz Zużycie `500` → komunikat „przekracza dostępny materiał” i blokada zapisu.
* Wpisz Wynik `81` → blokada („nie może przekroczyć zużytego surowca”); `75` → wymagana przyczyna różnicy.
* Produkt *Zrębka towar* → pole produkcji nieaktywne (produkcja tylko z drewna).

## SCENARIUSZ C — zakup + produkcja + sprzedaż

**Dane:** jak B + zaznacz **Sprzedaż** · Odbiorca *Elektrociepłownia Zabrze S.A.* · Cena `90` zł/MP.

**Oczekiwane:**

* Ilość sprzedaży `80,01` → „Sprzedaż 80,01 MP przekracza wynik produkcji 80 MP”, zapis zablokowany.
* Ilość pusta lub `80` → Przychód **7 200,00 zł**.
* Miejsce transportu podpowiada odbiorcę (można zmienić).
* Przebieg: `PZ → RW → PW → WZ` (+ `TR` gdy wybrano transport, z wpływem na stan **0 MP**).
* Po zapisie: stan drewna i zrębki taki jak przed operacją; przychód w *Historia → Rejestr operacji*.

## SCENARIUSZ D — transport własny

W sekcji 4 zaznacz **Transport własny** · Pojazd *Scania R450 — SGL 4T821*.

| Kontrola | Oczekiwane |
|---|---|
| Numer rejestracyjny | SGL 4T821 (z Floty) |
| Kierowca domyślny / kierowca kursu | Jan Kowalski / Jan Kowalski (domyślny) |
| Kilometry `262`, stawka `5` | Koszt **1 310,00 zł** |
| Zmiana kierowcy kursu na *Tomasz Wójcik* | komunikat „kierowca zmieniony tylko dla tego kursu” |

Po zapisie: *Flota → Pojazdy* — kierowca domyślny Scanii nadal **Jan Kowalski**;
*Flota → Ostatnie kursy* — kurs z kierowcą **Tomasz Wójcik** i znacznikiem „zmieniony dla kursu”.
Pojazd *MAN TGX* (status „W serwisie”) jest niedostępny do wyboru.

## SCENARIUSZ E — transport zewnętrzny

Zaznacz **Transport zewnętrzny** · Firma `ESI Logistics` · Rejestracja `ESI 18734` · Odległość `262` · Fracht `1 250`.

* Koszt transportu **1 250,00 zł**.
* Zaznacz **Transport wliczony w cenę** → koszt **0,00 zł**, pole frachtu „wliczony w cenę”.
* Stan magazynu zmienia się wyłącznie o zakup (transport = 0 MP).

## SCENARIUSZ F — przecinek i wklejanie

Produkt *Zrębka towar*, jednostka *MP*, cena `2`. Wklej / wpisz kolejno w pole Ilość:

| Wpis | Odczytano | Koszt |
|---|---|---|
| `12,50` | 12,5 | 25,00 zł |
| `12.50` | 12,5 | 25,00 zł |
| `1 250,50` | 1 250,5 | 2 501,00 zł |
| `1 250,50` (spacja nierozdzielająca U+00A0, np. z Excela) | 1 250,5 | 2 501,00 zł |
| `1.250,50` | 1 250,5 | 2 501,00 zł |
| `12,5x` | komunikat błędu — **nie** liczy jako 0 | — |

Po opuszczeniu pola wartość zostaje zapisana w formacie polskim (`1 250,5`).

## SCENARIUSZ G — zamknięcie inwentaryzacji

1. *Inwentaryzacja* → Miesiąc `2026-08` → **Otwórz okres** (status OTWARTA).
2. **Generuj listę** — pozycje ze stanu księgowego na 31.08.2026 (drewno 60 m³, zrębka leśna 520 MP, …).
3. Wpisz stan ze spisu dla każdej pozycji (Enter / Tab zapisuje); dla drewna `58,5` → Różnica **−1,5 m³ / −6 MP**.
4. **Zamknij okres** (wymaga roli Kierownik lub Administrator) → potwierdź.

**Oczekiwane:** status **ZAMKNIĘTA**, brak pól do wpisywania i przycisków (tylko odczyt), dokument
**IN/001/08/2026** w Planie dokumentów; Nowa operacja z datą `2026-08-30` → błąd „Okres 2026-08 jest zamknięty”.

**Przełom miesiąca:** *Dane i ustawienia → Data systemowa demo* `2026-10-01` → *Kontrola przełomu miesiąca*
zamyka otwarte okresy z poprzednich miesięcy (brakujący spis = stan księgowy, oznaczony w tabeli).

---

## Kontrole przekrojowe

| # | Kontrola | Jak sprawdzić |
|---|---|---|
| 1 | Brak pól magazyn/pryzma źródłowa/docelowa | Nowa operacja — nie ma takich pól; magazyn wynika z użytkownika |
| 2 | Plan dokumentów pokazuje „Miejsce transportu” | *Plan dokumentów* — kolumna „Miejsce transportu”, TR ma „Wpływ na stan: brak” |
| 3 | Transport nie zmienia stanu | Ten sam zakup z każdym trybem transportu daje identyczne zapisy księgi (test jednostkowy) |
| 4 | Podwójne kliknięcie „Zapisz” | powstaje jedna operacja (blokada przycisku + klucz idempotencji) |
| 5 | Dwie karty, ten sam stan | otwórz plik w dwóch kartach, w obu zużycie `61` m³ przy zakupie `1` m³ → pierwsza zapisuje, druga odrzucona |
| 6 | Korekta | Plan dokumentów → PZ → *Korekta* → przyczyna → dokument KO, stan przywrócony, operacja „skorygowana” |
| 7 | Uprawnienia | *Beata Nowak — Podgląd*: brak formularza; *Magazynier*: brak zamknięcia okresu i edycji floty |
| 8 | Historia | *Historia zmian*: filtr miesiąca/roku, użytkownika, obszaru; stan przed/po; CSV |
| 9 | Kopia | *Dane i ustawienia*: pobierz JSON, wczytaj `data/sample_data.json` |
| 10 | Telefon | szerokość 390 px: brak przewijania w poziomie, dolny pasek „Zapisz operację” |

## Intro i muzyka

| Sytuacja | Oczekiwane |
|---|---|
| Przeglądarka pozwala na dźwięk | muzyka gra od startu intro; przycisk **Wycisz** |
| Autoplay zablokowany (typowy pierwszy start) | film gra wyciszony, komunikat „kliknij, aby włączyć muzykę”; pierwsze kliknięcie/klawisz włącza muzykę; aplikacja działa pod spodem |
| Przycisk **Wycisz** | wycisza i zapamiętuje wybór na kolejne uruchomienia |
| **Pomiń intro** / `Esc` / `Enter` | natychmiast zamyka intro |
| Brak kodeka H.264/AAC | plansza firmowa + krótka muzyka syntezowana, zamknięcie po ~6,5 s |
