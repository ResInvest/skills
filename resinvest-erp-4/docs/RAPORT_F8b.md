# Raport F8b — motywy (5 + własny) i języki PL / CS / EN

Data: 2026-10-02 · Wersja: 4.0.0-alpha.1 · Uzupełnienie po F8 (funkcje znane z ResInvest ERP 3.x przeniesione do 4.0).

## 1. Języki

* **Polski, czeski, angielski** — cały interfejs: menu, wszystkie ekrany, formularze, samouczek pod polami i kolumnami,
  lista kontrolna „Co jeszcze uzupełnić”, opisy kolumn, komunikaty.
* Przełącznik w pasku górnym (PL / CS / EN), na ekranie logowania i w **Moje konto → Wygląd i język**.
* Wybór zapisuje się **na koncie** (`users.lang`) — ten sam po zalogowaniu na innym urządzeniu; przed zalogowaniem
  pamiętany na urządzeniu. Domyślnie polski.
* **Komunikaty serwera** (walidacja, błędy, nazwy ról i uprawnień, rodzaje zdarzeń) są tłumaczone w interfejsie:
  dokładne dopasowanie albo wzorzec z wartościami (np. „Numer {a} jest już użyty w magazynie {b} w roku {c}”).
* Daty, kwoty i ilości w formacie języka (cs: „1 234,5”, en: „1,234.5”; precyzja dziesiętna bez zaokrągleń).
* Dokumenty magazynowe i eksporty (PDF, Excel, Word) oraz e-maile pozostają po polsku (dokumenty firmy).
* Słowniki: `apps/web/src/i18n/{cs,en}.ts` — kluczem jest tekst polski (1557 wpisów); przeglądarka pobiera tylko słownik
  wybranego języka (osobny plik ~37 kB po kompresji).

## 2. Motywy

| Motyw | Opis |
|---|---|
| Automatycznie | Perła albo Grafit wg ustawienia systemu (zmienia się razem z systemem) |
| Perła | jasny, zieleń firmowa |
| Grafit | ciemny, zieleń |
| Graphite Azure | ciemny, błękit |
| Ultra Dark | czerń OLED (oszczędza baterię telefonu) |
| Light Premium | kość słoniowa, granat i złoto |
| **Własny** | **kolor przewodni** (przyciski, aktywne pozycje, odnośniki) i **kolor tła** całego programu — wybierane przez użytkownika |

Motyw własny: podgląd na żywo na całym ekranie, zapis przyciskiem, wyjście bez zapisu przywraca poprzedni wygląd.
Pozostałe kolory (tekst, karty, linie, komunikaty OK / błąd / ostrzeżenie / informacja) są **wyliczane** tak, by zachować
czytelność wg WCAG 2.1: tekst ≥ 7:1, tekst pomocniczy ≥ 4,5:1, kolor przewodni ≥ 3:1, napis na przycisku ≥ 4,5:1.
Tło o średniej jasności (na którym żaden tekst nie byłby czytelny) jest przyciemniane lub rozjaśniane z zachowaniem
odcienia — użytkownik widzi komunikat. Jasne tło = tryb jasny, ciemne = tryb ciemny.

Motyw zapisuje się na koncie (`users.theme`, `theme_primary`, `theme_secondary`); skrypt startowy ustawia ostatnio
użyte kolory przed pierwszym malowaniem (bez mignięcia jasnego tła w motywie ciemnym).

## 3. Serwer i baza

* Migracja `20261002100000_user_preferences`: kolumny `theme_primary`, `theme_secondary` + ograniczenia CHECK
  (`lang ∈ {pl, cs, en}`, `theme ∈ {pearl, graphite, azure, ultra, premium, custom}`, kolory `#rrggbb`). Tylko dodanie
  kolumn i ograniczeń — dane bez zmian.
* `PUT /api/v1/auth/me/preferences` — wyłącznie własne konto (identyfikator z sesji, nie z żądania), ścisła walidacja
  (obce pola, np. `userId` / `role` → 400), audyt `PREFERENCES_CHANGED` (było / jest). Profil `/auth/me` zawiera `prefs`.

## 4. Testy (wyniki rzeczywiste)

| Zestaw | Wynik |
|---|---|
| domena | 85 / 85 — m.in. czytelność 5 motywów gotowych i **406 par kolorów** motywu własnego (także skrajnych) |
| API | preferencje (4 nowe testy, przechodzą):  zapis, normalizacja kolorów, audyt, walidacja i odrzucenie obcych pól, CHECK w bazie, 401 bez sesji |
| web | 23 / 23 — kompletność słowników (każdy tekst interfejsu ma tłumaczenie cs i en), zgodność wstawek, przełączanie języka, wzorce komunikatów serwera, formaty liczb |
| E2E | w toku — wynik zostanie dopisany (scenariusz „wygląd”: języki z konta i paska, motywy gotowe, motyw własny z korektą tła, przełącznik na ekranie logowania, telefon) |

## 5. Wersja demonstracyjna (jeden plik HTML)

`apps/web/demo/` — prawdziwy interfejs na nagranych odpowiedziach API (np. z bazy testów E2E), atrapa API w przeglądarce,
podgląd operacji liczony tą samą funkcją domeny co serwer, zapis danych wyłączony. Budowa: `node demo/build.mjs`
(opis w README). Pliki wynikowe nie są wersjonowane.
