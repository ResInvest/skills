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

## 3. Następny krok — F4b-2
Przesunięcia MM (jedno- i dwuetapowe, przyjęcie w magazynie docelowym, tonaż), transport, sprzedaż bezpośrednia,
zakup z produkcją.
