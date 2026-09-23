# ResInvest ERP — stan prac

Ostatnia aktualizacja: 2026-09-23 · etap: **FAZA 1 — demonstrator HTML — zakończona, czeka na akceptację**

## Wykonane

- [x] FAZA 0: rozpoznanie repozytorium i `ResInvestERP_1.3.0.html` → `docs/RESINVEST_CHANGE_PLAN.md`
- [x] Silnik domenowy (`demo/src/engine.js`): parser liczb, jednostki, plan i zapis operacji (atomowo, idempotentnie), storno, inwentaryzacja, flota, raporty, audyt przed/po
- [x] Dane przykładowe księgowane przez silnik (`seed.js`, `data/sample_data.json`)
- [x] Intro z muzyką domyślnie włączoną, obsługa blokady autoplay, „Wycisz / Włącz muzykę”, „Pomiń intro”, fallback Web Audio
- [x] Nowa operacja: jedna ścieżka zakup → zużycie → produkcja → sprzedaż, transport własny / zewnętrzny / pociąg (tonaż per wagon lub wspólny, cena za MP / m³ / t), „Miejsce transportu / dostawy”, samouczek pod polami
- [x] Usunięte pola magazyn/pryzma źródłowa i docelowa — magazyn z kontekstu użytkownika
- [x] Plan dokumentów z kolumną „Miejsce transportu”, podgląd, wydruk, korekta, CSV
- [x] Stany z kartoteką i stanem na dzień
- [x] Inwentaryzacja miesięczna (OTWARTA → ZAMKNIĘTA, IN, blokada, automatyczne zamknięcie)
- [x] Flota (pojazdy, kierowcy, rębaki, operatorzy, kursy z kierowcą kursu)
- [x] Historia zmian: audyt, rejestr operacji, raport miesięczny/roczny, filtry, CSV
- [x] Dane: kopia JSON, import z kontrolą, reset, preferencje, data demo
- [x] Konfiguracja `config/demo.config.json` wstrzykiwana przy budowaniu
- [x] Instalator Windows (Inno Setup) + skrypt PowerShell
- [x] README, LICENSE, scenariusze, sugestie UI

## Aktualnie

Brak — oczekiwanie na akceptację demonstratora („KONTYNUUJ FAZĘ 2”).

## Testy zakończone powodzeniem

| Zestaw | Wynik |
|---|---|
| `npm run check` (składnia 5 plików) | OK |
| `npm run test:unit` | 33/33 |
| `npm run test:e2e` (Chromium 1.56, desktop 1440 px + telefon 390 px, 2 karty, 3 profile autoplay) | 85/85, konsola bez błędów |

## Błędy wykryte i poprawione w trakcie

1. Kliknięcie „Zapisz” tuż po wpisaniu wartości ginęło — `focusout` przebudowywał panel z przyciskiem między `mousedown` a `mouseup`. Panel ma teraz stały szkielet, odświeżane są tylko sekcje treści.
2. Budowanie wykryło `</style>` w kodzie okna wydruku (przerwałoby `<script>`) — zmienione na `<\/style>`, kontrola zostaje w `build-demo.mjs`.
3. Zduplikowane `id` kart wyboru transportu (dostępność etykiet) — nadane unikalne `id`.
4. Utrata fokusu przy wpisywaniu kolejnych pozycji spisu — fokus wraca do następnego pola po zapisie.

## Znane problemy / ograniczenia

- Chromium z Playwrighta nie ma kodeka H.264 — ścieżka filmu testowana przez symulację `HTMLMediaElement`; realne odtwarzanie filmu z dźwiękiem należy potwierdzić ręcznie w Chrome/Edge na Windows.
- Instalator nie był kompilowany w tej sesji (brak Windows / Inno Setup) — skrypt `.iss` wymaga uruchomienia `build-installer.ps1` na Windows.
- Wieloużytkowość demonstracyjna (jedna przeglądarka). Prawdziwa współbieżność — FAZA 2 (transakcje bazy danych).
- Brak statusów inwentaryzacji W TRAKCIE / GOTOWA DO ZAMKNIĘCIA (wymagane dopiero w FAZIE 2).

## Następny krok

Po akceptacji — **FAZA 2**: dołączyć produkcyjne repozytorium (React / NestJS / PostgreSQL) do sesji
albo potwierdzić, że FAZA 2 rozwija bazę 1.3.0; plan w `docs/RESINVEST_CHANGE_PLAN.md` §7.
