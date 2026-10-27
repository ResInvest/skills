# Raport fazy F5 — zmiany dokumentów: korekty, usuwanie, historia zmian

Data: 2026-10-01 · Wersja: 4.0.0-alpha.1 · Zakres wg planu `resinvest-erp/docs/AUDYT_REPOZYTORIUM_4.0.md` (F5) i decyzji §7:
„Usuń” = soft delete z automatycznym odwróceniem ruchów, tylko Administrator i Manager, z powodem, blokada gdy towar został już wydany.

## 1. Zasady (domena: `packages/domain/src/changes.ts`)

* **Ruchy magazynowe są tylko dopisywane.** Korekta i usunięcie niczego nie zmieniają w historii ruchów — dopisują ruchy
  odwracające (`REVERSAL`, z datą ruchu odwracanego i wskazaniem `reversal_of_id`).
* **Ruchy efektywne** operacji = bez ruchów odwracających i bez ruchów już odwróconych (druga korekta odwraca tylko wersję
  po pierwszej).
* **Korekta** = odwrócenie ruchów bieżącej wersji + ruchy nowej wersji (ta sama funkcja `planOperation`, co przy zapisie).
  Kolejność księgowania: przychody przed rozchodami — saldo końcowe to samo, bez fałszywego braku w połowie.
* **BYŁO / JEST**: migawka poprzedniej wersji (z bazy) i nowej (z planu) opisana po polsku (data, kontrahent, materiał, ilość,
  tonaż i jego źródło, cena, wartość, produkcja, pochodzenie, transport, operacje dodatkowe, kwoty); zapisywane są tylko
  pola, które się zmieniły.
* **Powód** wymagany (5–500 znaków) przy korekcie i usunięciu.
* **Numer korekty** KOR/NNN/MM/RRRR (kolejny w miesiącu, blokada doradcza przy nadawaniu).

## 2. API (`apps/api/src/operations/changes.*`)

| Endpoint | Działanie |
|---|---|
| `POST /operations/:id/correction/preview` | zmiany BYŁO / JEST, stan przed / po (netto), braki — bez zapisu |
| `POST /operations/:id/correction` | korekta: `idempotencyKey`, `version`, `reason`, `operation` |
| `POST /operations/:id/delete` | usunięcie: `version`, `reason` (uprawnienie `documents.delete`) |
| `GET /operations/:id/history` | korekty (numer, kto, kiedy, powód, pola było / jest) i usunięcie (`history.read`) |
| `GET /documents/changes?kind=corrections\|edited\|deleted` | zakładki rejestru, filtr dat, stronicowanie |

Jedna transakcja: blokada wiersza operacji (`FOR UPDATE`) → kontrola wersji → reguły domeny → pozycje dokumentów (te same
numery) → księga (`LedgerService`: blokada sald, stan nie poniżej zera) → produkcja / kursy / operacje dodatkowe (poprzednie
oznaczone jako usunięte) → `corrections` + `document_revisions` → audyt `OPERATION_CORRECTED` / `OPERATION_DELETED` z powodem.

Ograniczenia (z komunikatem dla użytkownika):
* korekta nie zmienia rodzaju operacji, magazynu, roku dokumentu (numeracja roczna) ani zestawu dokumentów — włączenie /
  wyłączenie produkcji, sprzedaży wyniku czy transportu = usunięcie i nowa operacja;
* MM przyjęte w magazynie docelowym — korekta zablokowana; usunięcie odwraca oba magazyny (jeśli towar jest na stanie);
* korekta lub usunięcie, które zeszłyby poniżej zera — 409 „Korekta niemożliwa / Nie można usunąć — towar z dokumentu został już wydany”;
* zamknięty okres (stara albo nowa data) — odmowa;
* nieaktualna wersja — 409 `VERSION_CONFLICT`; podwójne kliknięcie — ten sam klucz idempotencji, jedna korekta;
* bilans otwarcia i inwentaryzacja — nie przez ten moduł.

Uprawnienia: korekta — `documents.correct` albo właściwe dla rodzaju (`purchases.correct`, `sales.correct`, `production.correct`,
`inventory.correct` dla MM); usunięcie — `documents.delete` (Administrator, Manager); historia — `history.read`.
Baza: migracja `20261001200000_corrections` (klucz idempotencji korekty, indeks daty). Sprawdzono: schemat = migracje.

## 3. Interfejs

* **Szczegóły operacji**: plakietka zatwierdzony / korygowany ×N / usunięty, przyciski **Koryguj** i **Usuń…**,
  sekcja **Historia zmian** (BYŁO przekreślone na czerwono, JEST na zielono), informacja o usunięciu z powodem.
* **Korekta** otwiera formularz „Nowa operacja” wypełniony danymi dokumentu (rodzaj i magazyn zablokowane, numery bez zmian),
  pole **Powód korekty** jest pierwszym krokiem listy „Co jeszcze uzupełnić”; podsumowanie pokazuje tabelę BYŁO / JEST
  i zmianę stanów netto.
* **Usuń** — okno z ostrzeżeniem i wymaganym powodem.
* **Dokumenty**: zakładki Rejestr / **Korekty** / **Edytowane** / **Usunięte** (filtr dat, opis kolumn); rejestr nie pokazuje
  usuniętych, przy dokumencie po korekcie plakietka „korygowany”.
* Dziennik audytu: „Korekta dokumentu (było / jest)”, „Usunięcie dokumentu (odwrócenie ruchów)”.

## 4. Testy (2026-10-01, wyniki rzeczywiste)

| Zestaw | Wynik |
|---|---|
| domena | 71 / 71 (zmiany: 5 — powód i numer, ruchy efektywne i odwrócenie, zmiana netto i kolejność, BYŁO / JEST, opis migawki) |
| API | 146 / 146 (zmiany: 11 — podgląd, korekta z ruchami i KOR, idempotencja, historia, wersja / brak zmian / powód, zestaw dokumentów i rodzaj, uprawnienia, blokada po wydaniu towaru, zakładki, usunięcie i „Usunięte”, MM w drodze / po przyjęciu) |
| web | 17 / 17 |
| E2E | 59 / 59 (korekty: 6 — zakup, korekta z formularza z powodem i BYŁO / JEST, oznaczenie i zakładki, usunięcie z powodem, audyt, telefon) |
| lint, typecheck | bez błędów |

## 5. Następny krok

F6 — raporty i eksporty (rejestr z filtrami, raporty okresowe miesięczne i roczne, CSV / XLSX / PDF / DOCX, pulpit).
