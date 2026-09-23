# ResInvest ERP — stan prac

Ostatnia aktualizacja: 2026-09-23 · etap: **Demo v2 (2.0.0) — gotowe do oceny**

## Wykonane — Demo v2

- [x] Sprzedaż z magazynu (WZ): towar ze stanu, ilość, jednostka zgodna z towarem, cena, odbiorca, miejsce dostawy, blokada ponad stan, audyt
- [x] Sprzedaż bezpośrednia po produkcji / prosto z lasu: PW + WZ bez wzrostu stanu, bez wymogu zakupu i pobrania z magazynu
- [x] Produkcja na magazynie: RW (surowiec ze stanu) + PW (produkt), powiązanie PW ← RW, bez zakupu
- [x] Księga w jednostce magazynowej produktu (m³ / MP / t); PKS i łupina nerkowca wyłącznie w t
- [x] Masa orientacyjna: zrębka 0,33 t/MP, drewno 0,952 t/m³ (konfigurowalne)
- [x] Cena za rąbanie (domyślnie 10,00 zł/MP, edytowalna) w podsumowaniu, na PW i w raportach
- [x] Pociąg: liczba wagonów, pojemność w t lub MP, tonaż wspólny albo osobno dla każdego wagonu, podsumowanie składu (załadunek, dostawa, przewoźnik, nr dokumentu, koszt)
- [x] Cztery niezależne scenariusze + zachowany łańcuch zakup → produkcja → sprzedaż z v1
- [x] Jasny motyw
- [x] Dane przykładowe zgodne z przykładami z polecenia (8 293 MP, 817 m³, 728 t)
- [x] Inwentaryzacja, stany, plan dokumentów, historia i raporty w jednostkach produktów
- [x] Instalator 2.0.0, dokumentacja, scenariusze

## Wykonane — FAZA 1 (1.4.0)

Silnik z atomowym zapisem i idempotencją, parser liczb, intro z muzyką, flota, inwentaryzacja miesięczna, historia zmian, kopie zapasowe — wszystko zachowane w v2.

## Testy

| Zestaw | Wynik |
|---|---|
| `npm run check` | OK |
| `npm run test:unit` | 33/33 |
| `npm run test:e2e` (Chromium: desktop 1440 px, telefon 390 px, 2 karty, 2 profile autoplay) | 83/83, konsola bez błędów |

## Znane problemy / ograniczenia

- **Zmiana masy drewna względem v1:** v1 liczyło 20 m³ → 80 MP × 0,33 = 26,4 t; v2 używa 0,952 t/m³ z przykładu „817 m³ ≈ 778 t” (20 m³ ≈ 19,04 t). Do potwierdzenia przez firmę — przełącznik `woodTPerM3` w `config/demo.config.json`.
- Dane v1 nie są migrowane (inny model księgi); v2 startuje na danych przykładowych.
- Film intro nie jest odtwarzany w testowym Chromium (brak H.264) — w Chrome/Edge do potwierdzenia ręcznie.
- Instalator nie był kompilowany w tej sesji (brak Windows / Inno Setup).

## Następny krok

Akceptacja Demo v2 → „KONTYNUUJ FAZĘ 2” (wymaga dołączenia repozytorium produkcyjnego; model danych v2 opisany w `docs/RESINVEST_CHANGE_PLAN.md`).
