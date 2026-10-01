# Raport fazy F4b-1 — operacje z dokumentami ResInvest ERP 4

Data: 2026-10-01 · Wersja: 4.0.0-alpha.1 · Faza F4b podzielona na **F4b-1** (zakup PZ, sprzedaż WZ, produkcja RW + PW,
operacje dodatkowe, rejestr) i **F4b-2** (przesunięcia MM jedno- i dwuetapowe z przyjęciem, transport, sprzedaż bezpośrednia,
zakup z produkcją).

## 1. Co zostało zrobione

### Domena — `packages/domain/src/documents.ts`
`planOperation(input, kontekst)` to czysta funkcja, port reguł z 3.x. Na wejściu dostaje dane formularza oraz kartoteki
i przeliczniki firmowe. Zwraca dokumenty z pozycjami, ruchy magazynowe, kwoty, operacje dodatkowe i opis podsumowania,
albo listę błędów przy polach. **Tę samą funkcję** wywołuje podgląd w przeglądarce i decyzja w API, więc reguły nie mogą
się rozjechać.
* **Zakup (PZ):**
  * ilość w dowolnej dozwolonej jednostce, przeliczona na jednostkę magazynową;
  * cena za wybraną jednostkę;
  * tonaż RĘCZNY z wagi albo AUTO z przelicznika (wartość ręczna nigdy nie jest nadpisywana).
* **Sprzedaż z magazynu (WZ):** jak wyżej; opis w formacie 3.x, np. „60 MP | 19,8 t | RĘCZNY”.
* **Produkcja (RW + PW):**
  * surowiec w m³, produkt w MP;
  * zużycie = MP ÷ przelicznik surowca (gdy go brak — przelicznik firmowy);
  * koszt rąbania = MP × cena.
* **Operacje dodatkowe w każdej operacji** (do 20): koszt = kwota albo ilość × stawka (domyślnie stawka z kartoteki).
* **Numeracja:**
  * automatyczna `TYP/NNN/MM/RRRR`, albo ręczna (litery, cyfry, `/ . - _`);
  * unikalność ręcznego numeru w obrębie typu, magazynu i roku, bez względu na wielkość liter i spacje.

### API — `/api/v1/operations`, `/api/v1/documents`
* `GET operations/form-data`: kontrahenci, materiały, rodzaje operacji dodatkowych, flota i operatorzy magazynu,
  stany, przeliczniki.
* `POST operations/preview`: plan, numery dokumentów, stan przed / po, braki z komunikatem jak w 3.x. Zajęty numer
  ręczny jest zgłaszany już tutaj, przy polu.
* `POST operations` z **kluczem idempotencji**:
  * zapis przechodzi przez `LedgerService` (blokady wierszy, brak stanu ujemnego);
  * numeracja jest szeregowana blokadą doradczą (typ + magazyn + rok);
  * zamknięty okres inwentaryzacji blokuje miesiąc;
  * sprawdzana jest rola kontrahenta oraz pojazdy i rębaki magazynu;
  * zapis trafia do audytu `OPERATION_CREATED`;
  * podwójne kliknięcie albo ponowienie żądania po zerwaniu połączenia zwraca **tę samą** operację.
* `GET operations/:id`: szczegóły operacji (dokumenty, pozycje, produkcja, operacje dodatkowe, kwoty).
* `GET documents`: rejestr, domyślnie **PZ / WZ / MM**; dokumenty pomocnicze (RW, PW, BO) pojawiają się po zaznaczeniu.
  Filtry: typ, daty, wyszukiwanie; stronicowanie.
* Uprawnienia: `receipts.create` / `issues.create` / `production.create` oraz dostęp do magazynu, zawsze sprawdzane na serwerze.

### Interfejs
* **Nowa operacja** (zakładki Zakup PZ / Sprzedaż WZ / Produkcja):
  * podgląd na żywo: dokumenty, stan przed → po, kwoty;
  * numer PZ / WZ wybierany z listy „Automatycznie” albo „Ręcznie”;
  * operacje dodatkowe z pojazdem, ilością, stawką i kosztem.
* **Podsumowanie przed zapisem:** numery nadane przez serwer, tabela stanów przed / zmiana / po. Przy braku towaru
  zatwierdzenie jest zablokowane i wyświetla się komunikat.
* **Dokumenty:**
  * mocne kolory PZ (zielony), WZ (pomarańczowy), MM (niebieski) — na plakietkach i pasku wiersza;
  * klik w numer otwiera szczegóły operacji.
* Na telefonie formularz układa się w jedną kolumnę, a rejestr wyświetla się jako karty, bez poziomego przewijania.

## 2. Testy (uruchomione 2026-10-01, wyniki rzeczywiste)

| Zestaw | Wynik |
|---|---|
| domena (`packages/domain`) | 38 / 38 |
| API (integracyjne, PostgreSQL) | 106 / 106, w tym operacje 13 / 13 (współbieżna numeracja, idempotencja, braki, zamknięty okres, izolacja magazynów) |
| web (jednostkowe) | 17 / 17 |
| E2E (Chromium, prawdziwy stos) | 34 / 34, w tym dokumenty 9 / 9 |

Scenariusz E2E „dokumenty”:
1. dostawca w kartotece;
2. zakup 100 m³ × 120 zł z pracą ładowarki;
3. produkcja 400 MP (zużycie 100 m³);
4. WZ 60 MP z numerem ręcznym „WZ 7/2026” i tonażem 19,8 t (RĘCZNY);
5. ponowne użycie tego numeru — błąd przy polu;
6. sprzedaż ponad stan PKS — blokada;
7. rejestr z kolorami;
8. stany po operacjach;
9. audyt u administratora;
10. telefon 390 px.

## 3. F4b-2a — przesunięcia MM (2026-10-01)

### Reguły (domena)
* `planOperation` typ **TRANSFER**: dokument MM z jedną pozycją (ilość w dowolnej dozwolonej jednostce → jednostka
  magazynowa, tonaż AUTO z przelicznika 0,33 t/MP albo RĘCZNY z wagi), numer automatyczny `MM/NNN/MM/RRRR` albo ręczny.
  * **dwuetapowe** (ustawienie `mm.mode = two`, domyślne): rozchód `TRANSFER_OUT` w źródle, stan „w drodze”,
  * **jednoetapowe** (`mm.mode = one`): rozchód w źródle i przychód `TRANSFER_IN` w celu jednym zatwierdzeniem.
  * ten sam magazyn / brak celu / ilość 0 — błędy przy polach.
* `planReceipt` (port `planReceive` z 3.x): ilość przyjęta (puste = cała wysłana), data nie wcześniejsza niż wysłanie
  i nie z przyszłości, **przy różnicy przyczyna** (ubytek w transporcie, różnica pomiaru, wilgotność, uszkodzenie,
  nadwyżka, inna — „inna” i przyjęcie zerowe wymagają opisu), tonaż AUTO / RĘCZNY.

### API
* `POST /operations` z `type: "TRANSFER"` — uprawnienie `mm.create`, dostęp do magazynu źródłowego, cel aktywny,
  przy MM jednoetapowym sprawdzany zamknięty okres w celu.
* `POST /operations/:id/receive` — uprawnienie `mm.receive` i dostęp do **magazynu docelowego**; blokada wiersza
  operacji (`SELECT … FOR UPDATE`) — z równoczesnych przyjęć skuteczne jest dokładnie jedno; klucz idempotencji
  (powtórzenie zwraca operację bez drugiego ruchu); zapis `transfer_receipts`, stan `RECEIVED`, audyt `MM_RECEIVED`.
* `GET /transfers/in-transit?warehouseId` — MM w drodze do magazynu (do przyjęcia) i z magazynu (wysłane).
* MM widać w rejestrze **obu** magazynów (z trasą i stanem); szczegóły operacji dostępne także dla magazynu docelowego.

### Interfejs
* Nowa operacja → zakładka **Przesunięcie MM** (magazyn docelowy, materiał ze stanem, ilość, tonaż z wagi, numer
  automatyczny / ręczny, operacje dodatkowe); podgląd: stan źródła przed → po i „W drodze do …”.
* Dokumenty → sekcja **Do przyjęcia** (przycisk „Przyjmij” tylko z uprawnieniem; bez niego informacja, kto przyjmuje),
  okno przyjęcia z podglądem różnicy i przyczyną; wiersz MM: „Zabrze → Brąszewice” + „w drodze / przyjęte”.
* Szczegóły operacji: trasa, tryb, przyjęcie (data, ilość, różnica, przyczyna, tonaż, kto).

### Poprawki przy okazji
* Podsumowanie przed zapisem: tabela stanów pokazywała „materiał” zamiast nazwy (zły separator klucza salda).
* Długie zdania podglądu nie zawijały się (strona szersza niż ekran) — wykryte testem E2E, poprawione.
* Komunikaty z pogrubieniem w treści (rejestracje oczekujące, wymuszona zmiana hasła, zapis operacji) rozbijały się
  na osobne wiersze — poprawione.

### Testy (uruchomione 2026-10-01)
| Zestaw | Wynik |
|---|---|
| domena | 45 / 45 (MM: 3, przyjęcie: 4) |
| API (PostgreSQL) | 117 / 117, w tym MM 11 / 11 (dwuetapowe z różnicą, idempotencja, równoczesne przyjęcia, jednoetapowe, uprawnienia, izolacja magazynów, spójność sald) |
| web | 17 / 17 |
| E2E | 39 / 39, w tym MM 5 / 5 (wysłanie, rejestr Zabrza, konto bez prawa przyjęcia, przyjęcie z ubytkiem, stany obu magazynów, telefon) |

## 4. F4b-2b-1 — transport (2026-10-01)

### Reguły (domena, `packages/domain/src/transport.ts`, port z 3.x)
* Tryby: **brak**, **własny** (pojazd z floty magazynu + kierowca — domyślny pojazdu albo wybrany), **zewnętrzny**
  (firma przewozowa z kartoteki, nr rej. auta przewoźnika, kierowca opisowo), **mieszany** (kursy obu rodzajów),
  **kolej** (wagony × tonaż, cena za t / MP / m³ — 0,33 t/MP, 1 m³ = 4 MP), **zapewnia dostawca** (tylko zakup, bez kosztu i TR).
* Miejsce załadunku / dostawy wymagane przy każdym transporcie.
* Koszt kursu: km × stawka (domyślnie 5 zł/km) albo fracht z faktury przewoźnika; „fracht wliczony w cenę” = 0 zł.
* Ilość kursu: podana, z kwitu (m³ × 4 = MP) albo — przy jednym kursie — cała ilość operacji; przy wielu kursach wymagana.
  Suma kursów ponad ilość operacji — błąd; mniej — ostrzeżenie „do rozwiezienia pozostało …”; brak wagi części kursów — ostrzeżenie.
* Pojazd: aktywny, z floty tego magazynu albo wspólny (komunikat z nazwą magazynu, gdy z innego); kierowca aktywny.
* Kwity wywozowe: numer wymagany, gdy reguła produkcji leśnej tego żąda (F4b-2b-2); suma m³ z kwitów ≤ drewno zużyte.
* Produkcja na magazynie — bez transportu (błąd przy polu).
* Transport **nie zmienia stanu** — tworzy dokument **TR** (pomocniczy) z kosztem; koszt wchodzi do wyniku operacji.

### API i interfejs
* `POST /operations` przyjmuje `transport`; zapis `transport_runs` (pojazd, kierowca, firma, km, stawka, fracht, koszt,
  ilość, waga, kwit, skład kolejowy), `operations.transport_mode / place / transport_cost`, dokument TR w tej samej transakcji.
* Rejestr: TR wśród dokumentów pomocniczych, wartością jest koszt transportu.
* Formularz: sekcja **Transport** (zakup, sprzedaż, MM) — kursy z pojazdem i kierowcą z floty, przewoźnik, kolej;
  podgląd kosztu na żywo; podsumowanie: „Transport własny · 2 kursy · 420,00 zł” i ostrzeżenia.
* Szczegóły operacji: tabela kursów (pojazd / przewoźnik, kierowca, km, ilość, waga, kwit, koszt) albo skład kolejowy.

### Testy (2026-10-01)
| Zestaw | Wynik |
|---|---|
| domena | 53 / 53 (transport: 8) |
| API | 124 / 124 (transport: 7 — własny z kierowcą domyślnym, zewnętrzny z frachtem i „w cenie”, kolej, dostawca, flota innego magazynu, brak zapisu przy braku towaru, dane formularza) |
| web | 17 / 17 |
| E2E | 42 / 42 (transport: 3 — sprzedaż z dwoma kursami, TR w rejestrze, telefon) |

## 5. F4b-2b-2 — zakup z produkcją i sprzedaż bezpośrednia (2026-10-01)

### Reguły (domena, port `planProduction` / `planSaleOfOutput` z 3.x)
* **Zakup z produkcją** (zaznaczenie w zakładce Zakup): PZ → RW (zużycie: podane w jednostce zakupu albo cały zakup) →
  PW (wynik: podany albo zużycie × przelicznik, 1 m³ = 4 MP). Wynik ponad zużycie — błąd; niższy — wymagana przyczyna
  (wilgotność, jakość surowca, straty przy rębaniu, różnica pomiaru, inna). Surowiec tylko drewno w m³, produkt w MP.
  Dostępność surowca (stan + zakup) sprawdza księga krok po kroku.
* **Sprzedaż wyniku** (opcjonalnie): WZ do odbiorcy, ilość ≤ produkcja (puste = cała), cena za MP albo za t,
  tonaż AUTO (0,33 t/MP) albo RĘCZNY z wagi.
* **Sprzedaż bezpośrednia** (nowa zakładka): produkcja w lesie — surowiec nie schodzi ze stanu (koszt surowca opcjonalnie),
  PW + WZ (WZ dokumentem głównym, numer ręczny dotyczy WZ); niesprzedana reszta zostaje na stanie (ostrzeżenie).
* **Pochodzenie surowca**: las — nadleśnictwo (podpowiadane z kartoteki dostawcy „nadleśnictwo”), leśnictwo (lista z
  kartoteki), kwit wywozowy przy produkcji albo — gdy są kursy transportu — przy każdym kursie (m³ z kwitu × 4 = MP
  na aucie, suma m³ ≤ drewno zużyte); wycinka inwestycyjna — miejsce i dokument źródłowy.
* Wszystkie braki pokazywane naraz (pola sprzedaży sprawdzane także przy błędach produkcji).

### API i interfejs
* `POST /operations`: zakup z `production` / `sale`, typ `DIRECT_SALE` (w bazie operacja sprzedaży z produkcją DIRECT);
  uprawnienia: dodatkowo `production.create` (produkcja) i `issues.create` (sprzedaż wyniku); odbiorca w roli odbiorcy;
  rębak magazynu; zapis `production_runs` z trybem, przyczyną różnicy i pochodzeniem.
* Szczegóły operacji: „Zakup z produkcją” / „Sprzedaż bezpośrednia”, pochodzenie (nadleśnictwo, leśnictwo, kwit / wycinka).
* Poprawki przy okazji: podgląd stanów liczy ruchy **krok po kroku** (817 → 842 → 817 m³), tytuł szczegółów według dokumentu
  głównego (PZ / WZ / MM / PW), nie kolejności zapisu.

### Testy (2026-10-01)
| Zestaw | Wynik |
|---|---|
| domena | 60 / 60 (zakup z produkcją i sprzedaż bezpośrednia: 7) |
| API | 130 / 130 (6 nowych: łańcuch PZ-RW-PW-WZ z saldami, brak surowca, przyczyna różnicy, rola odbiorcy, kwity w kursach, sprzedaż bezpośrednia z resztą na stanie) |
| web | 17 / 17 |
| E2E | 46 / 46 (4 nowe: zakup z produkcją i sprzedażą, sprzedaż bezpośrednia, stany, telefon) |

## 6. Następny krok — F4c Planer zakupów
Zakładka „Planer zakupów” (decyzja 2026-10-01, przelicznik 0,33 t/MP): plan dzienny MP wpisywany ręcznie z historią
zmian; wykonanie, tony, ceny, km, transport i kursy kierowców czytane z PZ / PW / TR (prototyp `docs/prototypy/planer-zakupow.html`).
