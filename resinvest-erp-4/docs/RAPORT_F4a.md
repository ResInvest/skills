# Raport fazy F4a — kartoteki ResInvest ERP 4

Data: 2026-10-01 · Wersja: 4.0.0-alpha.1 · Faza F4 podzielona na **F4a (kartoteki)** i **F4b (dokumenty PZ/WZ/MM, produkcja, transport)**.

## 1. Co zostało zrobione

### API — `/api/v1/catalog/:kind`
Jeden moduł z rejestrem rodzajów (`apps/api/src/catalog/catalog.registry.ts`): materiały, kontrahenci, rodzaje operacji
dodatkowych, pojazdy, rębaki, kierowcy, operatorzy, firmy zewnętrzne. Dla każdego rodzaju:
* **walidacja na serwerze** (zod) — komunikaty przy polach; wszystkie błędy formularza naraz,
* **uprawnienia**: odczyt `report.view`; zmiany `master.edit` (materiały, kontrahenci, operacje dodatkowe) albo `fleet.edit` (flota),
* **blokada optymistyczna** (`version`, 409 `VERSION_CONFLICT`) i blokada wiersza na czas zmiany,
* **audyt** `CATALOG_CREATED / UPDATED / DELETED` — przy zmianie zapisywane są tylko zmienione pola (było / jest),
* **rekord użyty nie znika**: usunięcie tylko, gdy nie ma powiązań (dokumenty, ruchy, bilans, przejazdy, produkcja,
  operacje dodatkowe, inne kartoteki); inaczej 409 `IN_USE` z podpowiedzią „ustaw jako nieaktywny / Wycofany”,
* edycja częściowa — pominięte pola zachowują wartości (nie wartości domyślne).

Reguły szczególne:
* **materiał**: kod normalizowany (np. `zr-pl` → `ZR-PL`), unikalny kod i nazwa (bez względu na wielkość liter),
  jednostka magazynowa zawsze wśród dozwolonych i **niezmienna po pierwszym ruchu**, brak dezaktywacji przy niezerowym
  stanie (komunikat ze stanem i magazynem), przeliczniki > 0, materiał w tonach przyjmowany w m³/MP wymaga gęstości,
* **kontrahent i firma**: NIP z **sumą kontrolną** (separatory i prefiks PL usuwane), NIP unikalny wśród kontrahentów,
  leśnictwa nadleśnictwa bez powtórzeń,
* **pojazd**: numer rejestracyjny normalizowany (`sgl  4t821` → `SGL 4T821`) i unikalny; pojazd obcy wymaga firmy,
* **rębak**: własny (operator z kartoteki) albo **firmy zewnętrznej** (firma wymagana, operator opisowo — pola
  niepasujące do rodzaju są czyszczone na serwerze),
* **izolacja magazynów (flota)**: rola nieglobalna widzi swoje magazyny i zasoby wspólne, zmienia tylko zasoby swoich
  magazynów; zasób wspólny dodaje administrator.

Reguły pól wspólne z formularzami: `packages/domain/src/catalog.ts` (NIP, rejestracja, kod materiału).

### Interfejs — „Kartoteki”
Zakładki dla 8 kartotek, wyszukiwanie, filtr aktywne / nieaktywne (wycofane) / wszystkie, formularz dodania i edycji
z błędami serwera przy polach, pola zależne (firma i operator opisowy tylko dla zasobu zewnętrznego), magazyn
domyślny kierownika podstawiony automatycznie, potwierdzenie usunięcia. Telefon: karty, przewijane zakładki.

## 4–5. Testy (rzeczywiste, 2026-10-01)

| Zestaw | Wynik |
|---|---|
| `pnpm lint`, `pnpm typecheck` | OK |
| `packages/domain` | **27/27** (3 nowe: NIP, rejestracja, kod) |
| `apps/api` | **93/93** (13 nowych w `test/catalog.spec.ts`) |
| `apps/web` | **17/17** |
| **E2E** | **25/25** (6 nowych: materiał z błędem serwera i edycją, NIP, firma + rębak zewnętrzny + kierowca + pojazd, blokada usunięcia, audyt, telefon) |

## 6–7. Wykryte i naprawione problemy
1. Kierownik dodający rębak dostawał błąd „zasób wspólny dodaje administrator”, a formularz domyślnie proponował
   magazyn „wspólny” — oraz serwer zwracał błędy pojedynczo. Naprawa: formularz podstawia magazyn domyślny kierownika
   i nie pokazuje opcji „wspólny” rolom nieglobalnym; serwer zwraca wszystkie błędy naraz. Wykryte przez E2E.
2. Izolacja danych testów: test kartotek zapisywał ruch w magazynie używanym przez test bilansu otwarcia — przeniesiony
   do osobnego magazynu.

## 8. Następny etap — F4b dokumenty
PZ (zakup), WZ (sprzedaż z magazynu i bezpośrednia), produkcja na magazynie, MM (jedno- i dwuetapowe), transport,
operacje dodatkowe w każdej operacji, numeracja automatyczna / ręczna z listy — księgowanie przez `LedgerService`.
