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

## 5. Środowisko testowe (Docker Compose)

`docker-compose.yml` uruchamia PostgreSQL, migracje, API i Nginx w kontenerach (serwer Linux / środowisko testowe).
Wymaga pliku `.env` z `POSTGRES_PASSWORD` i certyfikatu w `deploy/tls/`.
