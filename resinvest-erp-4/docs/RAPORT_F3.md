# Raport fazy F3 — silnik stanów ResInvest ERP 4

Data: 2026-10-01 · Wersja: 4.0.0-alpha.1 (faza F3) · Zakres wg planu `resinvest-erp/docs/AUDYT_REPOZYTORIUM_4.0.md` §6:
`packages/domain` (port reguł z `engine.js` 3.x), `stock_movements` / `stock_balances`, bilans otwarcia z zatwierdzaniem.

## 1. Co zostało zrobione

### Reguły domenowe (`packages/domain/src/stock.ts`) — wspólne dla API i interfejsu
* **Symulacja sald krok po kroku** (jak w 3.x): ruchy jednej operacji sprawdzane po kolei (np. zakup → zużycie →
  produkcja); żaden krok nie może zejść poniżej zera; wynik: saldo po, kroki, braki (dostępne / wymagane / brakuje).
* **Stała kolejność blokad** (magazyn, materiał) — identyczna z porządkiem `uuid` w PostgreSQL; brak zakleszczeń.
* **Komunikat jak w 3.x**: „Brak wystarczającej ilości: Drewno opałowe (RiC Zabrze). Dostępne: 817 m³. Wymagane: 1 000 m³. Brakuje: 183 m³.”
* **Bilans otwarcia — walidacja i przeliczenie**: materiał istnieje i jest aktywny, bez powtórzeń, ilość nieujemna,
  jednostka dozwolona; ilość przeliczana na jednostkę magazynową z zapisem przelicznika i jego źródła (AUTO / COMPANY_RATE).
* Przeliczniki firmowe budowane z tabeli `conversion_rates` (obowiązujące w dniu bilansu), arytmetyka dziesiętna (`decimal.js`).

### API (NestJS)
* **`LedgerService`** — jedyne miejsce zmieniające stan; działa wewnątrz transakcji operacji:
  1. wiersze sald dla wszystkich par istnieją (`INSERT … ON CONFLICT DO NOTHING`),
  2. `SELECT … FOR UPDATE` w stałej kolejności — równoczesna operacja czeka i po zwolnieniu blokady widzi saldo już zmniejszone,
  3. symulacja regułami domeny — przy braku: błąd 409 `STOCK_INSUFFICIENT` z komunikatem i szczegółami, nic nie jest zapisane,
  4. dopisanie ruchów (tabela tylko do dopisywania — wyzwalacz w bazie) i aktualizacja sald.
  Ostatnia linia obrony: `CHECK (qty >= 0)` na `stock_balances`.
* **Stany**: `GET /materials`, `GET /stock/balances?warehouseId=` (saldo, liczba ruchów, ostatni ruch, informacja o bilansie),
  `GET /stock/movements` — karta materiału: ruchy ze stanem przed / po (suma narastająca z całej historii), dokumentem,
  rodzajem operacji i użytkownikiem; filtr dat. Izolacja magazynów (403 `WAREHOUSE_FORBIDDEN`).
* **Bilans otwarcia** (`/opening-balances`): lista, szczegóły, szkic (`opening.manage` — Manager, Administrator), edycja
  i usunięcie szkicu z kontrolą wersji (409 `VERSION_CONFLICT`), **zatwierdzenie** (`opening.approve` — Administrator).
  Zatwierdzenie w jednej transakcji: operacja `OPENING_BALANCE` → dokument **BO/<kod magazynu>/<rok>** z pozycjami
  (ilość i jednostka źródłowa, ilość magazynowa, przelicznik, źródło) → ruchy `OPENING` przez `LedgerService` →
  status APPROVED → wpis w audycie. Reguły: jeden zatwierdzony bilans na magazyn (także przy równoczesnym zatwierdzaniu —
  indeks unikalny), bilans tylko w magazynie bez wcześniejszych ruchów (`OPENING_AFTER_MOVEMENTS`), data nie z przyszłości
  (strefa Europe/Warsaw), zatwierdzonego bilansu nie zmienia się ani nie usuwa.
* Audyt: `OPENING_BALANCE_CREATED`, `…_UPDATED`, `…_DRAFT_DELETED`, `…_APPROVED` (było / jest, IP, przeglądarka).

### Interfejs (React)
* **Stany magazynowe**: wybór magazynu, salda pogrupowane (Drewno / Zrębka / Produkty tonowe), informacja o bilansie
  otwarcia, **karta materiału** z historią ruchów (stan przed / zmiana / po, dokument, użytkownik, filtr dat).
  Dane zawsze świeże przy wejściu na ekran (inni użytkownicy księgują równocześnie).
* **Bilans otwarcia**: lista ze statusem, kto wprowadził / zatwierdził, numer dokumentu BO; formularz szkicu z pozycjami
  i **podglądem przeliczenia** (np. 2 073,25 m³ zrębki → 8 293 MP), błędy serwera przy właściwych polach;
  okno zatwierdzenia z podsumowaniem i ostrzeżeniem, że operacji nie cofa się.
* Menu wg uprawnień, etykiety nowych zdarzeń w dzienniku audytu, telefon: tabele jako karty, bez poziomego przewijania.

## 2. Pliki

* `packages/domain/src/{stock,stock.spec}.ts`, `packages/domain/src/index.ts`
* `apps/api/src/stock/{ledger.service,stock.controller,materials}.ts`, `apps/api/src/opening/{opening.service,opening.controller}.ts`,
  `apps/api/src/app.module.ts`, `apps/api/test/stock.spec.ts`, `apps/api/package.json` (zależność `@resinvest/domain`)
* `apps/web/src/pages/stock/{StockPage,OpeningPage}.tsx`, `apps/web/src/api/types.ts`, `apps/web/src/app/App.tsx`,
  `apps/web/src/pages/{Shell,AuditPage}.tsx`, `apps/web/src/styles/app.css`, `apps/web/package.json`
* `e2e/tests/stock.spec.ts`, `e2e/tests/{helpers,identity}.spec.ts`, `e2e/playwright.config.ts` (projekt „magazyn”)

## 3. Migracje

Brak nowych — tabele `stock_movements`, `stock_balances`, `opening_balance_*`, ograniczenia (`CHECK`, indeks
„jeden zatwierdzony bilans na magazyn”) i wyzwalacze niezmienności powstały w migracji `init` (F1).

## 4–5. Testy i wyniki (rzeczywiste, 2026-10-01)

| Zestaw | Wynik |
|---|---|
| `pnpm lint` | 0 błędów, 0 ostrzeżeń |
| `pnpm typecheck` (api, web, domain, e2e) | OK |
| `packages/domain` | **24/24** (11 nowych: symulacja sald, kolejność blokad, precyzja, komunikat, bilans otwarcia, przeliczniki z bazy) |
| `apps/api` (integracja, PostgreSQL 16) | **80/80** (17 nowych, poniżej) |
| `apps/web` | **17/17** |
| **E2E Playwright** | **19/19** (7 nowych scenariuszy F3) |
| `pnpm build` | OK |

Nowe testy integracyjne API (`test/stock.spec.ts`):
* walidacja na serwerze (data z przyszłości, powtórzony materiał, jednostka niedozwolona, brak pozycji),
* uprawnienia i izolacja (obserwator/magazynier nie wprowadzają, kierownik bez dostępu do Rokitek, kierownik nie zatwierdza),
* szkic → edycja z kontrolą wersji → zatwierdzenie (operacja + BO + ruchy + salda + audyt w jednej transakcji),
* zatwierdzonego nie można zmienić / usunąć / zatwierdzić ponownie; drugi bilans magazynu odrzucony; usunięcie szkicu,
* karta materiału (stan przed / po), rozchód ponad stan (komunikat jak w 3.x, nic nie zapisane),
* **dwie równoczesne sprzedaże 600 MP przy stanie 1 000 MP** — jedna przechodzi, druga odrzucona, stan 400,
* **20 równoczesnych rozchodów po 50 przy stanie 400** — dokładnie 8 udanych, saldo 0 = suma ruchów,
* krzyżowa kolejność materiałów w dwóch transakcjach — bez zakleszczenia,
* bilans po ruchach w magazynie odrzucony; ruchy niezmienne (UPDATE/DELETE blokowane w bazie); saldo nieujemne (CHECK);
* spójność księgi: saldo każdej pary magazyn × materiał = suma jej ruchów.

Scenariusze E2E (projekt „magazyn”, konta z projektu tożsamości):
1. stany przed bilansem (ostrzeżenie, zera), 2. szkic kierownika z podglądem przeliczenia i błędem walidacji przy polu,
3. zatwierdzenie przez administratora (BO/ZAB/2026, podgląd tylko do odczytu), 4. stany i karta materiału,
5. drugi bilans odrzucony, 6. dziennik audytu, 7. telefon 390 px bez poziomego przewijania.

## 6–7. Wykryte i naprawione problemy

1. **Nieaktualny stan po zatwierdzeniu przez innego użytkownika**: ekran stanów korzystał z pamięci podręcznej
   zapytań (15 s) i pokazywał stan sprzed bilansu. Wykryte przez E2E. Poprawka: stany, karta materiału i lista bilansów
   zawsze pobierają świeże dane przy wejściu na ekran.
2. Liczby z zapytań SQL wracały w postaci `817.000000` — normalizacja w API (`qtyNorm`).
3. Kolumny liczbowe wyrównane do lewej (reguła tabeli nadpisywała `.r`) — poprawione.
4. Słaby test (blok `try/catch` przechodził także bez błędu) — zastąpiony asercją, która wymaga odrzucenia z komunikatem.

## 8. Pozostałe ryzyka i zakres na kolejne fazy

| Temat | Uwagi |
|---|---|
| Kartoteki — edycja | API i ekrany edycji materiałów, kontrahentów, floty, rębaków (własnych/zewnętrznych), firm i operacji dodatkowych: **F4** (razem z dokumentami, które z nich korzystają). W F3 materiały są tylko do odczytu (dane słownikowe z instalacji). |
| Przeliczniki firmowe — edycja | odczyt z `conversion_rates` gotowy; ekran zmiany przeliczników z datą obowiązywania — F4 / ustawienia |
| Dokumenty PZ/WZ/MM, produkcja | księgują przez `LedgerService` — F4 |
| Korekta zatwierdzonego bilansu | wyłącznie korektą (BYŁO/JEST) — F5 |
| Wydajność karty materiału | suma narastająca liczona z całej historii pary magazyn × materiał (indeks istnieje); przy milionach ruchów — migawki sald miesięcznych (F6) |

## 9. Następny etap — F4 Dokumenty

PZ / WZ (numer automatyczny lub ręczny z listy), zakup, sprzedaż (MP / m³ / t + tonaż AUTO / RĘCZNY), produkcja na
magazynie, MM dwuetapowe, rębaki własne i zewnętrzne, flota, transport, operacje dodatkowe w każdej operacji
+ kartoteki z edycją; scenariusze E2E z 3.x przeniesione na stos 4.0.
