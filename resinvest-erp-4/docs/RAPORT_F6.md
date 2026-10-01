# Raport fazy F6 — raporty i eksporty

Data: 2026-10-01 · Wersja: 4.0.0-alpha.1 · Zakres wg planu `resinvest-erp/docs/AUDYT_REPOZYTORIUM_4.0.md` (F6): rejestr dokumentów
z filtrami, raporty okresowe (miesięczne, roczne), CSV / XLSX / PDF / DOCX, pulpit z kaflem „Operacje dodatkowe”.

## 1. Reguły (domena: `packages/domain/src/reports.ts`)

* **Okresy**: dzień, tydzień (pon–nd), miesiąc, kwartał, rok albo dowolny zakres dat.
* **Obroty magazynowe** na materiał: stan początkowy (wszystkie ruchy sprzed okresu) + przychody (bilans otwarcia, zakup PZ,
  produkcja PW, MM przychód) − rozchody (sprzedaż WZ, zużycie RW, MM rozchód) ± inne = stan końcowy.
  Ruch odwracający (korekta, usunięcie) trafia do kolumny ruchu, który odwraca — zakup skorygowany ze 100 na 90 m³ to 90 w kolumnie
  „Zakup”; kolumna „W tym korekty” pokazuje, ile z tego to odwrócenia.
* **Kontrola spójności**: dla okresu kończącego się dziś stan końcowy z ruchów musi równać się saldom w tabeli sald — wynik
  widoczny w raporcie i w nagłówku eksportu.
* **Zestawienie roczne**: 12 miesięcy + rok — liczba operacji (zakupy, sprzedaże, produkcje, MM), zakup, przychód, rąbanie,
  transport, operacje dodatkowe, wynik (przychód − koszty, orientacyjnie, bez wyceny zapasu), produkcja MP, korekty i usunięcia
  (wg daty wykonania). Usunięte operacje pominięte, korekty uwzględnione.
* **Operacje dodatkowe wg rodzaju**: liczba, ilość, koszt, suma (pozycje sprzed korekty i z usuniętych operacji pominięte).

## 2. API (`apps/api/src/reports/*`)

| Endpoint | Działanie |
|---|---|
| `GET /reports/turnover?warehouseId=<id\|ALL>&from&to` | obroty + kontrola spójności (≤ 10 lat) |
| `GET /reports/summary?warehouseId=<id\|ALL>&year` | zestawienie 12 miesięcy i roku |
| `GET /dashboard?warehouseId=<id\|ALL>&month=RRRR-MM` | pulpit miesiąca: wskaźniki, operacje dodatkowe wg rodzaju, stany, MM do przyjęcia |
| `GET /reports/export?report=turnover\|summary\|documents&format=csv\|xlsx\|pdf\|docx&…` | plik do pobrania (uprawnienie `reports.export`), audyt `REPORT_EXPORTED` |

„ALL” = magazyny dostępne użytkownikowi. Rejestr dokumentów eksportuje się dla jednego magazynu z filtrami rejestru (typ, daty,
szukaj, dokumenty pomocnicze).

Formaty (`export.ts`, jeden model tabeli dla wszystkich):
* **CSV** — UTF-8 z BOM, średnik, przecinek dziesiętny (Excel w polskich ustawieniach otwiera bez importu);
* **XLSX** — liczby jako liczby (sumowanie w Excelu), formaty kwot i ilości, filtr, zamrożony nagłówek, wiersz sumy;
* **PDF** — A4 poziomo, font DejaVu Sans (polskie znaki; licencja `apps/api/assets/fonts/LICENSE-DejaVu.txt`), nagłówek tabeli
  na każdej stronie, stopka „kto, kiedy, strona X z Y”;
* **DOCX** — tabela w Word, poziomo, nagłówek i suma wyróżnione.
Pliki powstają w pamięci serwera (bez plików tymczasowych). Nazwa pliku: `obroty_ZAB_2026-10-01_2026-10-31.xlsx`,
`zestawienie_ZAB_2026.pdf`, `rejestr_ZAB_….csv`. Obraz Docker kopiuje `apps/api/assets`.

## 3. Interfejs

* **Pulpit** — „Miesiąc w liczbach” (magazyn albo wszystkie, wybór miesiąca ‹ ›): zakup, przychód, wynik, produkcja MP, operacje
  i korekty, MM do przyjęcia; kafel **Operacje dodatkowe** wg rodzaju z sumą; stany teraz.
* **Raporty** (nowa zakładka): „Obroty magazynowe” (okres i magazyn, kontrola spójności, opis kolumn) i „Miesiące i rok”;
  pod każdym raportem przyciski **CSV / Excel / PDF / Word** (tylko z uprawnieniem eksportu).
* **Dokumenty** — eksport rejestru wg bieżących filtrów.
* Dziennik audytu: „Eksport raportu” (raport, format, liczba wierszy, zakres).

## 4. Testy (2026-10-01, wyniki rzeczywiste)

| Zestaw | Wynik |
|---|---|
| domena | 76 / 76 (raporty: 5 — okresy, obroty z odwróceniem, pomijanie pustych i spójność, rok, operacje dodatkowe) |
| API | 153 / 153 (raporty: 7 — obroty dnia z korektą i spójnością, okres przeszły i limity, izolacja i „wszystkie”, rok, pulpit, eksport 4 formatów z audytem, uprawnienia) |
| web | 17 / 17 |
| E2E | 66 / 66 (raporty: 7 — pulpit i kafel operacji dodatkowych, obroty z eksportem Excel i PDF, rok z eksportem Word, rejestr CSV wg filtra, audyt, brak eksportu bez uprawnienia, telefon) |
| lint, typecheck | bez błędów |

Sprawdzono ręcznie: PDF z polskimi znakami i podziałem na strony (nagłówek powtórzony, suma, „strona 2 z 2”), CSV w układzie Excela PL.

## 5. Następny krok

F7 — powiadomienia (ustawienia użytkownika, kolejka, ponawianie, dziennik wysyłki; błąd e-maila nie cofa operacji).
