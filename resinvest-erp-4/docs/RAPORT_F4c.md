# Raport fazy F4c — Planer zakupów ResInvest ERP 4

Data: 2026-10-01 · Wersja: 4.0.0-alpha.1 · Decyzje użytkownika (2026-10-01): planer jako osobna zakładka po F4b-2,
przelicznik **0,33 t/MP** (wartość 0,63 t/MP z dawnego planera nie jest używana). Prototyp: `docs/prototypy/planer-zakupow.html`.

## 1. Założenie

Dawny planer (plik HTML) trzymał wszystko w jednej przeglądarce i wymagał przepisywania wykonania, cen, transportu i kursów.
W 4.0 **ręcznie wpisuje się tylko plan dnia [MP]**; resztę planer czyta z zatwierdzonych dokumentów. Wartości AUTO są tylko do
odczytu — błąd poprawia się korektą dokumentu, więc planer zawsze zgadza się ze stanami i raportami.

## 2. Reguły (domena, `packages/domain/src/planner.ts`)

| Pole | Źródło | Reguła |
|---|---|---|
| Plan [MP] | `purchase_plans` | ręcznie: magazyn × dzień; widok „Wszystkie magazyny” sumuje plany |
| Wykonanie [MP] | `production_runs`, PZ | produkcja z zakupu (PW), produkcja w lesie (sprzedaż bezpośrednia), zakup materiału w MP |
| Tony [t] | `transport_runs.weight_t` | waga zważonych kursów + niezważona reszta ilości × 0,33 t/MP |
| Cena [zł/MP] | `operations.purchase_cost` | wartość zakupu ÷ wykonanie |
| Miejsce | `operations.place`, pochodzenie | miejsce transportu albo nadleśnictwo i leśnictwo / wycinka |
| Km, transport, kursy | `transport_runs` | sumy kursów operacji zakupu |
| Kierowcy i auta | `transport_runs` | kursy pogrupowane po kierowcy i pojeździe, liczba kursów na dzień |
| Realizacja | — | wykonanie ÷ plan **do dziś** (przyszłe dni nie zaniżają wyniku) |

Sprzedaż z magazynu, produkcja ze stanu, MM i zakup drewna bez produkcji **nie** wchodzą do planera (to nie są zakupy MP).

## 3. Baza, API, uprawnienia

* Tabela `purchase_plans` (migracja `20261001190000_purchase_planner`): unikalna para magazyn + dzień, `CHECK plan_mp >= 0`,
  wersja (ochrona przed nadpisaniem cudzej zmiany). Migracja dodaje uprawnienie **`planner.edit`** i nadaje je rolom
  systemowym Administrator i Manager także w istniejących instalacjach. Sprawdzono: schemat = migracje (`prisma migrate diff`: brak różnic).
* `GET /api/v1/planner?warehouseId=<id|ALL>&from&to` (≤ 400 dni) — dni, sumy, kierowcy, plany z wersjami, operacje źródłowe;
  „ALL” = magazyny dostępne użytkownikowi, bez edycji planu.
* `PUT /api/v1/planner/plan` — plan dnia (liczba ≥ 0, przecinek albo kropka, do 2 miejsc), uwagi, wersja; audyt
  **PLAN_UPDATED** z wartościami było / jest; konflikt wersji 409.

## 4. Interfejs — „Planer zakupów”

* **Tydzień**: wskaźniki (realizacja do dziś, wykonanie i tony z udziałem wagi, wartość i średnia cena, transport zł/MP, kursy, km),
  tabela dni z polem planu (zapis po wyjściu z pola / Enter), realizacja dnia, dokumenty źródłowe dnia (PZ, RW, PW, WZ, TR) w oknie.
* **Miesiące i rok**: wykres plan / wykonanie (12 miesięcy, podpowiedź, wybór miesiąca), podsumowanie miesiąca, tabela roku.
* **Kierowcy i kursy**: kursy dnia według kierowcy i pojazdu oraz tabela tygodnia kierowca × dzień.
* **Skąd są dane**: pola planera i ich źródło.
* Telefon: tabele jako karty, bez poziomego przewijania strony.

## 5. Testy (2026-10-01, wyniki rzeczywiste)

| Zestaw | Wynik |
|---|---|
| domena | 66 / 66 (planer: 6 — zakres dni, tony z wagi i przelicznika, suma dnia z wielu magazynów, realizacja do dziś, miesiące, kierowcy) |
| API | 135 / 135 (planer: 5 — zapis planu z wersją i audytem, walidacja i uprawnienia, wykonanie 350 MP z trzech rodzajów zakupu z pominięciem innych operacji, zakres „wszystkie”, limity zakresu) |
| web | 17 / 17 |
| E2E | 52 / 52 (planer: 6 — wykonanie z dokumentów i plan dnia zapisany w bazie, błąd wartości, dokumenty źródłowe dnia, rok, kierowcy i źródła, audyt, telefon) |

## 6. Następny krok

F5 — zmiany dokumentów: korekty (BYŁO / JEST), usuwanie z odwróceniem ruchów, historia zmian (plan w `resinvest-erp/docs/AUDYT_REPOZYTORIUM_4.0.md`).
