# ResInvest ERP — stan prac

Ostatnia aktualizacja: 2026-09-23 · etap: **Demo v2.2 (2.2.0) — prototyp funkcjonalnie kompletny, gotowy do oceny** (Production v1 nie rozpoczęta)

## Wykonane — Demo v2.2

- [x] Dostawca: grupa „Firma branży drzewnej / przedsiębiorstwo drzewne” (KZR) lub „Nadleśnictwo” (Deklaracja + leśnictwo z listy lub nowe), podstawa zmienialna
- [x] Transport własny: liczba kursów → osobne rubryki (pojazd, kierowca, km, stawka, ilość, waga rzeczywista) + podsumowanie
- [x] Poprawka powielających się opisów wyliczeń w formularzu

## Wykonane — Demo v2.1

- [x] Silnik 2.1 (schemat 3): przeliczniki centralne z GJ, precyzja 6 miejsc, produkcja na magazyn „podaj MP → zużycie liczy system”, MM, statusy, wersje robocze
- [x] Walidacja produkcji §31 (braki, surowiec ≠ produkt, przelicznik, precyzja, atomowość, podwójne kliknięcie, podsumowanie przed zatwierdzeniem)
- [x] Anulowanie z analizą zależności w czasie i korekty (ilościowe, produkcji, bezpośrednie, wartościowe, opisowe, odwrócenie) — §32
- [x] Historia: rejestr ruchów ze stanem przed / zmiana / po + dziennik audytu, pełne filtry
- [x] Raporty dzień / tydzień / miesiąc / rok / zakres; bilans ze spójnością; drill-down; widok biznesowy i audytowy; wycena z „brak wyceny”
- [x] Druk i prawdziwy PDF (czcionka osadzona, polskie znaki) — raporty, historia, kwit, dokumenty; zapis w audycie
- [x] Kwit produkcji dnia
- [x] Pulpit: KPI, stany graficznie z linią 30 dni, OBROTY WEDŁUG TYPU OPERACJI z zakresem
- [x] Menu §20: Operacje, Przyjęcia, Wydania/WZ, Produkcja, Kwit, MM, Transport, Stany, Dokumenty, Historia, Raporty, Inwentaryzacja, Flota, Produkty, Kontrahenci, Magazyny, Administracja
- [x] Dane przykładowe z MM, korektą i anulowaniem; instalator 2.1.0; dokumentacja; TASKS.md

## Testy

| Zestaw | Wynik |
|---|---|
| `npm run check` | OK |
| `npm run test:unit` (silnik + PDF) | 61/61 |
| `npm run test:e2e` z `PDF_PYTHON` (pypdf) — Chromium: desktop 1440 px, telefon 390 px, 2 karty, 2 profile autoplay | 119/119, konsola bez błędów |

## Znane problemy / ograniczenia

- GJ liczone z masy dokładnej (6 611 GJ dla 817 m³), przykład w poleceniu używa masy zaokrąglonej (6 613 GJ).
- Masa drewna 0,952 t/m³ (z przykładu 817 m³ ≈ 778 t) — do potwierdzenia przez firmę.
- Znacznik czasu audytu = czas rzeczywisty, data operacji = data systemowa demo.
- Film intro nie jest odtwarzany w testowym Chromium (brak H.264) — NIEPOTWIERDZONE w Chrome/Edge.
- Instalator nie był kompilowany w tej sesji (brak Windows / Inno Setup).

## Następny krok

Akceptacja Demo v2.1 → Production v1 według `docs/RESINVEST_CHANGE_PLAN.md` („Architektura Production v1”).
