# Raport fazy F4d — prowadzenie użytkownika w „Nowej operacji” i samouczek

Data: 2026-10-01 · Wersja: 4.0.0-alpha.1 · Prośba użytkownika: kontrola z boku, która prowadzi i podpowiada, co i gdzie trzeba
jeszcze uzupełnić, świeci na czerwono przy brakach; samouczek z opisem pod każdym polem i kolumną.

## 1. Panel „Co jeszcze uzupełnić” (`apps/web/src/pages/documents/guide.tsx`)

* Kroki zależą od rodzaju operacji (zakup, sprzedaż, produkcja, MM, sprzedaż bezpośrednia) i od włączonych sekcji
  (produkcja z zakupu, sprzedaż wyniku, pochodzenie leśne / wycinka, transport inny niż „brak”).
* Stan kroku liczy ta sama funkcja domeny co serwer (`planOperation`) — **brak** (czerwony, z komunikatem), **gotowe** (zielony),
  **opcjonalne** (szary). Błędy pola z serwera (np. zajęty numer ręczny) też trafiają do listy.
* Pierwszy brak jest oznaczony „teraz”; pasek postępu pokazuje gotowe kroki wymagane.
* Kliknięcie kroku przewija i ustawia kursor dokładnie w polu z błędem (także w kursie transportu czy operacji dodatkowej)
  i podświetla je.
* Pola: komunikat i czerwone obramowanie pokazują się po odwiedzeniu pola (wyjście z pola / wybór z listy) albo po „Dalej”.
* Telefon / tablet: lista nad formularzem jako kafelki, na dole ekranu czerwony pasek „Brakuje N: …” prowadzi do kolejnego braku.

## 2. Samouczek (`apps/web/src/ui/tutorial.tsx`, `pages/documents/help.ts`)

* Opis pod każdym polem: nowa operacja (wszystkie rodzaje), transport (kursy — opisy przy pierwszym kursie), produkcja,
  sprzedaż wyniku, przyjęcie MM.
* Opis kolumn: rejestr dokumentów, planer (tydzień, miesiące i rok, kursy dnia) — rozwijana lista pod tabelą (działa także
  na telefonie, gdzie tabele są kartami).
* Przełącznik „Samouczek: włączony / wyłączony” na stronach Nowa operacja, Dokumenty i Planer; wybór pamięta przeglądarka
  (tylko ustawienie widoku — bez danych firmy). Domyślnie włączony.

## 3. Testy (2026-10-01, wyniki rzeczywiste)

| Zestaw | Wynik |
|---|---|
| web | 17 / 17 |
| E2E | 53 / 53 (nowy: stany kroków, „teraz”, przejście do pola, brak po odwiedzeniu pola, samouczek włącz / wyłącz po odświeżeniu, kroki transportu, telefon z paskiem braków bez poziomego przewijania) |
| lint, typecheck | bez błędów |
