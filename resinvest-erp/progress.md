# ResInvest ERP — stan prac

Ostatnia aktualizacja: 2026-09-25 · etap: **ResInvest ERP 3.1.0 — prototyp końcowy przed kompilacją instalatora Windows**

## Wykonane — 3.1.0 (prototyp końcowy)

- [x] Naprawa logowania: w ramce z zablokowaną pamięcią / Web Locks (podgląd pliku) ekran po zalogowaniu pozostawał pusty
- [x] Logowanie i rejestracja e-mailem firmowym (@resinvest.group), administrator magazyn@resinvest.group, zgłoszenia rejestracji zatwierdzane przez administratora
- [x] Role: Administrator / Kierownik / Magazynier / Obserwator; obieg zatwierdzania (DO ZATWIERDZENIA → zatwierdzenie lub odrzucenie z powodem)
- [x] Magazyny RiC Zabrze, RiC Brąszewice, RiC Rokitki; ludzie i flota przypisani do magazynów; dodawanie, edycja, usuwanie (bez historii) i dezaktywacja
- [x] Administrator: magazyn roboczy, start pracy na czysto; Użytkownicy: filtry, opis ról, usuwanie kont bez historii
- [x] Nowe intro, stopka „Program stworzony przez Roesner Mateusz dla ResInvest Commodities”, LICENSE (autor / licencjobiorca), wersja 3.1.0
- [x] Tłumaczenia CS/EN: 1 669 tekstów, 0 braków; schemat danych 5 z migracją
- [x] Testy: silnik 68, PDF 4, platforma 28, serwer 9, E2E 164 — wszystkie zaliczone


## Wykonane — 3.0.0 (faza 2)

- [x] Restrukturyzacja: `demo/` → `app/`, jeden plik `ResInvest_ERP.html` dla trybu lokalnego i serwera; warstwa usług `RIW.Service` (komendy, uprawnienia, „wszystko albo nic”)
- [x] Logowanie: ekran logowania, pierwsze uruchomienie serwera, wymuszona zmiana hasła, zmiana hasła w profilu, blokady, limit prób IP, wylogowanie po bezczynności, dziennik logowań
- [x] Moduł Użytkownicy: konta, role, magazyn, dezaktywacja, reset hasła, odblokowanie, macierz uprawnień
- [x] ResInvest ERP Serwer: Node.js + SQLite (WAL, transakcje), dziennik append-only z łańcuchem SHA-256, sesje HttpOnly, CSRF, CSP, SSE, kopie codzienne, `--check`, `--restore`, `--reset-password`, HTTPS
- [x] Nowy pulpit: sekcja powitalna, szybkie akcje, 8 wskaźników z porównaniem miesiąc do miesiąca, wykres 6 miesięcy z tabelą, obroty, kafle stanów, aktywność, „Do załatwienia”
- [x] Języki PL/CS/EN — 1 542 teksty, 0 braków (test pokrycia); formaty liczb i dat wg języka; PDF w języku użytkownika
- [x] Motywy Perła / Grafit / Graphite Azure (tokeny CSS, palety wykresów zwalidowane)
- [x] Kartoteki z edycją: produkty, kontrahenci (NIP), magazyny; schemat danych 4 z migracją
- [x] Instalator Windows 3.0 (program + serwer + Node.js, PL/CS/EN), skrypty .cmd, dokumentacja, dane przykładowe
- [x] Testy: silnik 68, PDF 4, platforma 19, serwer 8, E2E 147 — wszystkie zaliczone

## Wykonane — Demo v2.6

- [x] Kwity wywozowe w każdym kursie (nr, m³, MP = m³ × 4, tony); limit sumy kursów względem produkcji i zużytego drewna

## Wykonane — Demo v2.5

- [x] Transport własny i zewnętrzny razem w jednej operacji (np. 3 kursy własne + 2 zewnętrzne), wspólne podsumowanie i podział kosztu

## Wykonane — Demo v2.4

- [x] Transport zewnętrzny: liczba kursów → rubryki (nr rej., kierowca, km, stawka, ilość, waga, opcjonalny fracht kursu) + podsumowanie

## Wykonane — Demo v2.3

- [x] Dostawca (firma) i nadleśnictwo wpisywane ręcznie z podpowiedziami; nowa nazwa dopisywana do kartoteki przy zatwierdzeniu

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

## Testy (3.0.0 — historycznie; 3.1.0 powyżej)

| Zestaw | Wynik |
|---|---|
| `npm run check`, `npm run i18n` | OK · CS/EN: 0 braków, 0 błędnych parametrów |
| `node --test tests/engine.test.mjs tests/pdf.test.mjs tests/platform.test.mjs` | 91/91 |
| `node --test tests/server.test.mjs` (HTTP + SQLite, restart serwera) | 8/8 |
| `node tests/e2e.cjs` — Chromium: desktop 1440 px, telefon 390 px, 2 karty, 2 profile autoplay | 147/147, konsola bez błędów |
| Skan interfejsu EN i CS (wszystkie moduły, szczegóły dokumentu) | 0 brakujących tłumaczeń; polskie pozostają tylko dane (nazwy produktów, firm, osób) |

## Znane problemy / ograniczenia

- GJ liczone z masy dokładnej (6 611 GJ dla 817 m³), przykład w specyfikacji używa masy zaokrąglonej (6 613 GJ) — do decyzji firmy.
- Masa drewna 0,952 t/m³ (z przykładu 817 m³ ≈ 778 t) — do potwierdzenia przez firmę.
- Instalator nie był jeszcze kompilowany (wymaga Windows z Inno Setup 6) — skrypt i plik .iss gotowe; NIEPOTWIERDZONE na Windows.
- Film intro nie jest odtwarzany w testowym Chromium (brak H.264) — NIEPOTWIERDZONE w Chrome/Edge.
- Serwer trzyma stan jako dokument JSON (+ dziennik) — wystarczające dla skali firmy; przy setkach tysięcy operacji rozbicie na tabele.

## Następny krok

Wdrożenie pilotażowe serwera w sieci firmy (instalator 3.0.0), przeniesienie danych kopią JSON, szkolenie na kontach demonstracyjnych.
Kolejna faza: pełna wycena magazynowa (FIFO / średnia ruchoma), archiwum PDF z sumą kontrolną, wiele magazynów na użytkownika.


## 3.2.0 — konta firmowe, role, izolacja magazynów (2026-09-25)

| Zestaw | Wynik |
|---|---|
| `npm run check`, `npm run i18n` | OK · CS/EN: 0 braków, 0 błędnych parametrów, 0 nieużywanych (1 826 tekstów) |
| `node --test tests/engine.test.mjs tests/pdf.test.mjs tests/platform.test.mjs` | 101/101 |
| `node --test tests/server.test.mjs tests/auth.test.mjs` (HTTP + SQLite, poczta `file`) | 34/34 (w tym §34 1–20, §35 1–5) |
| `node tests/e2e.cjs` — Chromium, tryb OFFLINE | 178/178, konsola bez błędów |
| `node tests/e2e-server.cjs` — Chromium + serwer, zaproszenie i reset linkiem z .eml | 24/24, konsola bez błędów |
| Wysyłka przez Resend (API/SMTP) | NIEPOTWIERDZONE — brak klucza API i dostępu do DNS w środowisku budowy |
| Instalator 3.2.0 (Inno Setup 7) | NIEPOTWIERDZONE — kompilacja wymaga Windows |
