# Poczta e-mail (Resend) — konfiguracja ResInvest ERP Serwer 3.2

Serwer wysyła: **zaproszenia**, **potwierdzenie adresu e-mail**, **reset hasła**, powiadomienia
**zmiana adresu e-mail**, **hasło zmienione**, **konto dezaktywowane**. Szablony (język polski, marka ResInvest ERP,
wersja HTML + tekstowa) są w `server/mail.mjs` (`TEMPLATES`).

> **Stan weryfikacji:** wysyłka przez Resend (API i SMTP) jest zaimplementowana, ale w środowisku, w którym powstał
> program, **nie mogła zostać sprawdzona na prawdziwym koncie** (brak klucza API i dostępu do DNS domeny).
> Testy automatyczne sprawdzają pełny przebieg z transportem `file` (wiadomości `.eml` z linkami) oraz zachowanie
> przy błędzie wysyłki. Pierwszą prawdziwą wysyłkę wykonaj poleceniem `--mail-test` (punkt 5).

## 1. Konto i domena w Resend

1. Załóż konto na https://resend.com (administrator IT firmy).
2. **Domains → Add Domain** → `resinvest.group` (albo subdomena, np. `mail.resinvest.group` — wtedy nadawca
   `no-reply@mail.resinvest.group`).
3. Resend pokaże rekordy DNS do dodania u operatora domeny. **Wpisz dokładnie wartości z panelu Resend** —
   ten dokument nie podaje ich na sztywno (klucz DKIM jest unikalny dla konta):

| Rekord | Typ | Cel |
|---|---|---|
| SPF (np. `send.resinvest.group`) | TXT (+ MX dla domeny zwrotnej) | autoryzacja serwerów Resend |
| DKIM (`resend._domainkey…`) | TXT | podpis wiadomości |
| DMARC (`_dmarc.resinvest.group`) | TXT | polityka dla nieautoryzowanej poczty — zalecany start: `v=DMARC1; p=none; rua=mailto:…` a po sprawdzeniu raportów `p=quarantine` |

4. Poczekaj na status **Verified** (zwykle minuty–godziny, zależnie od DNS). Bez weryfikacji Resend odrzuci wysyłkę
   z adresu w domenie `resinvest.group`.
5. **API Keys → Create API Key** — uprawnienie **Sending access**, ograniczone do domeny. Klucz (`re_…`) pokazuje się
   tylko raz.

Program **nie tworzy rekordów DNS** — wykonuje to osoba z dostępem do panelu domeny.

## 2. Konfiguracja serwera (`server.env`)

Instalator Windows tworzy przy pierwszej instalacji plik **`C:\ProgramData\ResInvestERP\server.env`**
(skrót: *Menu Start → ResInvest ERP → Konfiguracja poczty i adresu*). Wzór: `.env.example`.

```ini
APP_URL=http://192.168.1.20:8080          # adres, pod którym pracownicy otwierają program (linki w e-mailach)
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx     # klucz z punktu 1.5 — NIE commituj do repozytorium
EMAIL_FROM=ResInvest ERP <no-reply@resinvest.group>
EMAIL_REPLY_TO=magazyn@resinvest.group     # opcjonalnie
EMAIL_TRANSPORT=                           # puste = resend (gdy jest klucz), inaczej file
```

Kolejność odczytu (późniejsze nadpisują wcześniejsze): `<program>\.env` → `<program>\config\server.env` →
`<dataDir>\server.env` → zmienne środowiskowe systemu. Po zmianie pliku **uruchom serwer ponownie**.
Konsola serwera pokazuje przy starcie: transport, nadawcę, adres linków i ewentualny brak klucza (bez wartości klucza).

Uprawnienia pliku (zalecane na komputerze z wieloma kontami Windows):

```bat
icacls "C:\ProgramData\ResInvestERP\server.env" /inheritance:r /grant:r Administratorzy:F SYSTEM:F "%USERNAME%":R
```

(konto, na którym działa serwer, musi mieć prawo odczytu).

## 3. Transporty

| `EMAIL_TRANSPORT` | Działanie |
|---|---|
| `resend` (domyślny przy kluczu) | `POST https://api.resend.com/emails`, nagłówek `Authorization: Bearer <klucz>`, limit czasu 15 s |
| `smtp` | TLS `smtp.resend.com:465`, użytkownik `resend`, hasło = klucz API (`SMTP_HOST/PORT/USER/PASS` do zmiany) |
| `file` (domyślny bez klucza) | wiadomość `.eml` zapisana w `<dataDir>\mail-outbox` — **bez wysyłki**; administrator może otworzyć plik i przekazać link ręcznie |

Każda wysyłka jest zapisywana w tabeli `outbox` (czas, szablon, adresat, wynik, błąd) — widok:
*Dziennik audytu → Wiadomości e-mail*. Treść linków nie jest przechowywana.

## 4. APP_URL

Linki w wiadomościach budowane są **wyłącznie** z `APP_URL` (lub — gdy go brak — z adresu IP serwera ustalonego
przez sam serwer). Nagłówek `Host` żądania nie jest używany (ochrona przed podmianą linku resetu hasła).
Dla dostępu spoza sieci lokalnej ustaw HTTPS (`tls.cert` / `tls.key` w `config/server.config.json` lub reverse proxy)
i `APP_URL=https://…`.

## 5. Test wysyłki

```bat
cd "C:\Program Files\ResInvest ERP"
runtime\node.exe --disable-warning=ExperimentalWarning server\riw-server.mjs --data "%ProgramData%\ResInvestERP" --mail-test twoj.adres@resinvest.group
```

Wynik `Wysłano (resend)` oznacza przyjęcie wiadomości przez Resend. Sprawdź skrzynkę (także SPAM) i w panelu Resend
zakładkę *Emails* (status *Delivered*).

## 6. Błędy i rozwiązania

| Objaw (dziennik serwera `logs\server-RRRR-MM-DD.log`) | Przyczyna |
|---|---|
| `brak klucza RESEND_API_KEY / SMTP_PASS` | transport `resend`/`smtp` bez klucza |
| `Resend HTTP 401` / `403` | błędny lub cofnięty klucz, klucz bez uprawnienia do domeny nadawcy albo domena niezweryfikowana (punkt 1.4) — treść błędu Resend jest w dzienniku |
| `Resend HTTP 422` | niepoprawne dane wiadomości (np. format `EMAIL_FROM`) |
| `Resend HTTP 429` | przekroczony limit wysyłki konta |
| `SMTP 535` | złe hasło SMTP (klucz API) |
| `SMTP: przekroczony czas` | zapora blokuje port 465 |

Przy błędzie wysyłki zaproszenia konto pozostaje INVITED, a administrator widzi komunikat i może wysłać ponownie.
Użytkownik nigdy nie widzi szczegółów technicznych.
