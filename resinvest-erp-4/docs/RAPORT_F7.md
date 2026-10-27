# Raport fazy F7 — powiadomienia e-mail

Data: 2026-10-01 · Wersja: 4.0.0-alpha.1 · Zakres wg planu `resinvest-erp/docs/AUDYT_REPOZYTORIUM_4.0.md` (F7): ustawienia
użytkownika, kolejka, ponawianie, dziennik wysyłki; błąd e-maila nie cofa operacji (kryterium: test awarii serwera poczty).

## 1. Zasada działania

* **Kolejka w transakcji (outbox)**: powiadomienie jest dopisywane do `mail_outbox` w tej samej transakcji co operacja.
  Zapisana operacja = zapisane powiadomienie; awaria serwera poczty niczego nie cofa ani nie blokuje.
* **Wysyłka w tle** (proces co 5 s, blokada `SKIP LOCKED` — bezpieczne przy wielu procesach API). Po błędzie kolejne próby po
  1 min, 5 min, 15 min, 1 h, 6 h; potem wiadomość jest „porzucona” (DEAD).
* **Treść**: po wysłaniu usuwana z bazy. Wiadomości z jednorazowym linkiem (zaproszenie, reset hasła) tracą treść także po
  porzuceniu; powiadomienia o operacjach zachowują ją, żeby administrator mógł je ponowić.

## 2. Zdarzenia i odbiorcy (domena: `packages/domain/src/notifications.ts`)

| Zdarzenie | Kiedy |
|---|---|
| Przyjęcie / zakup (PZ) | nowa operacja z dokumentem PZ (także zakup z produkcją) |
| Wydanie / sprzedaż (WZ) | sprzedaż z magazynu, sprzedaż wyniku produkcji, sprzedaż bezpośrednia |
| Produkcja (PW) | produkcja na magazynie, z zakupu, w lesie |
| Przesunięcie MM | wysłanie MM i przyjęcie MM (magazyn źródłowy i docelowy) |
| Operacje dodatkowe | operacja z kosztami dodatkowymi |
| Korekta dokumentu | korekta — numer KOR, powód, pola BYŁO → JEST |
| Usunięcie dokumentu | usunięcie z odwróceniem ruchów — powód |

Odbiorca: konto aktywne, dostęp do magazynu operacji (rola globalna albo przydział; przy MM — źródło lub cel), zdarzenie
**dozwolone przez administratora i włączone przez użytkownika**; autor operacji nie dostaje powiadomienia o własnej zmianie.
Jedna wiadomość na odbiorcę i operację (temat: zdarzenie + numery dokumentów; treść: magazyn, data, dokumenty, podsumowanie,
kwoty, operacje dodatkowe, autor, przycisk „Otwórz w ResInvest ERP”).

## 3. API

| Endpoint | Działanie |
|---|---|
| `GET / PUT /account/notifications` | własne ustawienia (każdy zalogowany; włączyć można tylko zdarzenie dozwolone) |
| `GET / PUT /users/:id/notifications` | zgody administratora (`notifications.manage`); odebranie zgody wyłącza wysyłkę |
| `GET /mail/outbox` | dziennik: status, próby, ostatni błąd, następna próba, statystyka, kanał wysyłki |
| `POST /mail/:id/retry` | ponowienie wiadomości nieudanej / porzuconej (licznik prób od zera, wysyłka od razu) |
| `POST /mail/test` | wiadomość testowa na adres administratora |
| `POST /mail/drain` | przetworzenie kolejki teraz |

Audyt: `NOTIFICATIONS_CHANGED`, `NOTIFICATIONS_ALLOWED`, `MAIL_RETRIED`, `MAIL_TEST`. Bez zmian w schemacie bazy (tabele
`notification_settings` i `mail_outbox` istniały od F1).

## 4. Interfejs

* **Moje konto → Powiadomienia e-mail**: lista zdarzeń z opisami; niedozwolone wyszarzone z plakietką „wymaga zgody
  administratora”; „Włącz wszystkie dozwolone / Wyłącz wszystkie”; zmiana zapisuje się od razu.
* **Użytkownicy → karta użytkownika → Powiadomienia e-mail — zgody**: zgody per zdarzenie z informacją, czy użytkownik włączył.
* **Poczta** (administrator): kanał wysyłki (SMTP / Resend / pliki .eml z ostrzeżeniem), liczniki statusów, filtr, tabela
  z błędami i terminem następnej próby, „Ponów”, „Wyślij test do mnie”, „Wyślij kolejkę teraz”, opis kolumn.

## 5. Testy (2026-10-01, wyniki rzeczywiste)

| Zestaw | Wynik |
|---|---|
| domena | 79 / 79 (powiadomienia: 3 — zdarzenia z dokumentów, oferowane zdarzenia, temat) |
| API | 159 / 159 (powiadomienia: 6 — zgody i ustawienia z audytem, odbiorcy i treść, **awaria SMTP: operacja zapisana, FAILED z kolejną próbą, ponowienie → SENT**, porzucenie i treść jednorazowych linków, korekta i usunięcie, odebranie zgody, test i uprawnienia) |
| web | 17 / 17 |
| E2E | 71 / 71 (powiadomienia: 5 — blokada bez zgody, zgoda i włączenie, MM Zabrze → Brąszewice dostarcza e-mail do magazyniera, Poczta z wiadomością testową i audytem, telefon) |
| lint, typecheck | bez błędów |

## 6. Następny krok

F8 — klienci: PWA (telefon), aplikacja Windows, build instalatora na runnerze Windows.
