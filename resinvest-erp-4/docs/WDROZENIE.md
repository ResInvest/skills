# Wdrożenie ResInvest ERP 4 — Windows Server

Dokument roboczy (faza F1). Pełna procedura, instalator serwera i skrypty powstają w fazie **F9**.

## 1. Topologia

```
Klienci (LAN / FortiClient VPN) ──► FortiGate ──► Windows Server (serwer aplikacji)
                                                   ├─ Nginx              :443  (usługa Windows)
                                                   ├─ ResInvest ERP API  :3000 (usługa Windows, tylko 127.0.0.1)
                                                   └─ PostgreSQL 16      :5432 (usługa Windows, tylko 127.0.0.1)
                                                   Kopie ──► \\dysk-firmowy\backup_primary, \\dysk-firmowy\backup_secondary
```

* **PostgreSQL pracuje na dysku lokalnym serwera.** Na dysk firmowy trafiają wyłącznie kopie zapasowe i pliki wdrożeniowe.
* API i PostgreSQL nasłuchują tylko na `127.0.0.1`; z sieci dostępny jest wyłącznie Nginx (443).
* FortiGate: reguła dopuszczająca pulę FortiClient VPN i LAN do portu 443 serwera; pozostałe porty zamknięte.
  Zapora Windows: 443 z tych samych sieci. API dodatkowo sprawdza `ALLOWED_NETWORKS`.

## 2. Składniki (planowane usługi Windows)

| Usługa | Opis | Konto |
|---|---|---|
| `postgresql-x64-16` | instalator EnterpriseDB, dane na dysku lokalnym, `listen_addresses = 'localhost'` | konto usługi PostgreSQL |
| `ResInvestERP-API` | `node dist/main.js` jako usługa (WinSW), restart przy awarii, logi z rotacją | konto wirtualne `NT SERVICE\ResInvestERP-API` |
| `ResInvestERP-Nginx` | `deploy/nginx/resinvest.conf` + certyfikat (firmowe CA lub Let's Encrypt przez DNS) | konto wirtualne |
| `ResInvestERP-Backup` | zadanie harmonogramu: `pg_dump -Fc` → kopia A + kopia B, sumy SHA-256, test odtworzenia | konto z zapisem na dysk firmowy |

## 3. Kopie zapasowe (wymaganie §22)

* Kopia automatyczna codziennie i przy zatrzymaniu usługi; **dwie kopie**: `backup_primary/` i `backup_secondary/`.
* Każda kopia: suma SHA-256, wpis w tabeli `backup_runs`, retencja (`BACKUP_KEEP_DAYS`), cotygodniowy **test odtworzenia**
  do bazy tymczasowej z porównaniem liczby rekordów i sald.
* **Ryzyko:** dwa katalogi na tym samym fizycznym dysku firmowym nie chronią przed awarią tego dysku —
  zalecana trzecia kopia poza serwerem i poza tym dyskiem (np. drugi NAS / lokalizacja zewnętrzna).

## 4. Konfiguracja

Zmienne środowiskowe usługi API (wzór: `.env.example`): `DATABASE_URL`, `APP_URL` (HTTPS), `ALLOWED_NETWORKS`,
`TRUSTED_PROXIES=127.0.0.1`, poczta (`EMAIL_TRANSPORT`, klucz Resend lub SMTP), katalogi kopii.
Plik konfiguracyjny tylko na serwerze, prawa odczytu: administratorzy i konto usługi API.

### 4.1 Poczta — Resend (główny kanał) i SMTP Resend (zapasowy)

Wpisy w pliku konfiguracyjnym usługi API na serwerze (klucz **tylko** tam — nigdy w repozytorium, w e-mailu ani na dysku współdzielonym):

```
EMAIL_TRANSPORT=resend
EMAIL_FALLBACK_TRANSPORT=smtp
RESEND_API_KEY=<klucz re_… z panelu Resend>
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=<ten sam klucz re_…>
EMAIL_FROM="ResInvest ERP <erp@resinvest.group>"
```

* Gdy Resend API nie odpowiada, ta sama wiadomość od razu idzie przez SMTP; błąd obu kanałów → ponowienie z kolejki
  (1 min, 5 min, 15 min, 1 h, 6 h). Status: **Poczta** w aplikacji (administrator), przycisk „Wyślij test do mnie”.
* `EMAIL_FROM` musi używać domeny zweryfikowanej w Resend (rekordy SPF i DKIM w DNS domeny `resinvest.group`).
* Zapora / FortiGate: wyjście z serwera do `api.resend.com:443` oraz `smtp.resend.com:465`.
* Własny serwer pocztowy firmy zamiast Resend: `EMAIL_TRANSPORT=smtp` i jego dane `SMTP_*`.

## 4.2 Klienci (F8)

* **Przeglądarka i telefon (PWA)** — adres `APP_URL`; „Zainstaluj aplikację” (Chrome / Edge / Android) albo Safari →
  Udostępnij → Do ekranu początkowego (iPhone). W urządzeniu zapisywane są tylko pliki programu; dane i sesja — na serwerze.
  Nginx: `sw.js` i `manifest.webmanifest` bez cache (reguły w `deploy/nginx/resinvest.conf`).
* **Aplikacja Windows** — instalator `ResInvest ERP_4.0.0_x64-setup.exe` z GitHub Actions (workflow
  „ResInvest ERP 4 — aplikacja Windows”, artefakt z sumą SHA-256). Przy pierwszym uruchomieniu pyta o adres serwera;
  wdrożenie przez dział IT bez pytania: instalacja cicha `"ResInvest ERP_4.0.0_x64-setup.exe" /S`, adres serwera
  ze zmiennej `RESINVEST_SERVER_URL` (np. GPO) albo skrót z parametrem `--server=https://erp.resinvest.group`.
  Certyfikat serwera musi być zaufany w Windows (firmowe CA w magazynie „Zaufane główne urzędy certyfikacji”).
  Instalator nie jest jeszcze podpisany certyfikatem wydawcy — Windows SmartScreen pokaże ostrzeżenie do czasu
  zakupu certyfikatu podpisywania kodu (decyzja firmy).

## 5. Środowisko testowe (Docker Compose)

`docker-compose.yml` uruchamia PostgreSQL, migracje, API i Nginx w kontenerach (serwer Linux / środowisko testowe).
Wymaga pliku `.env` z `POSTGRES_PASSWORD` i certyfikatu w `deploy/tls/`.
