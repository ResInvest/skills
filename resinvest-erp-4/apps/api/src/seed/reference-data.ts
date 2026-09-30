/**
 * Dane słownikowe ResInvest ERP 4 (instalacja i środowisko testowe).
 * Uprawnienia i role przeniesione z 3.x (engine.js: PERMS, ROLE_DEFAULTS) + nowe uprawnienia 4.0.
 * Wyłącznie kartoteki — bez stanów magazynowych (stan wprowadza administrator bilansem otwarcia).
 */
export const PERMISSIONS: ReadonlyArray<{ code: string; description: string; group: string }> = [
  { code: "receipts.create", description: "Przyjęcia i zakupy — wprowadzanie", group: "Operacje" },
  { code: "issues.create", description: "Wydania i sprzedaż — wprowadzanie", group: "Operacje" },
  { code: "production.create", description: "Produkcja na magazynie — wprowadzanie", group: "Operacje" },
  { code: "mm.create", description: "Przesunięcia MM — wysyłanie", group: "Operacje" },
  { code: "mm.receive", description: "Przyjęcie MM na magazynie docelowym", group: "Operacje" },
  { code: "additional.create", description: "Operacje dodatkowe — wprowadzanie", group: "Operacje" },
  { code: "op.approve", description: "Zatwierdzanie operacji (gdy obieg zatwierdzania jest włączony)", group: "Operacje" },
  { code: "documents.correct", description: "Korekty dokumentów", group: "Dokumenty" },
  { code: "documents.delete", description: "Usuwanie dokumentów (soft delete z odwróceniem ruchów)", group: "Dokumenty" },
  { code: "purchases.correct", description: "Korekty zakupów", group: "Dokumenty" },
  { code: "sales.correct", description: "Korekty sprzedaży", group: "Dokumenty" },
  { code: "production.correct", description: "Korekty produkcji", group: "Dokumenty" },
  { code: "inventory.correct", description: "Korekty stanów / MM", group: "Dokumenty" },
  { code: "opening.manage", description: "Bilans otwarcia — wprowadzanie", group: "Dane startowe" },
  { code: "opening.approve", description: "Bilans otwarcia — zatwierdzanie", group: "Dane startowe" },
  { code: "inv.open", description: "Otwarcie okresu inwentaryzacji", group: "Inwentaryzacja" },
  { code: "inv.count", description: "Spis z natury", group: "Inwentaryzacja" },
  { code: "inv.close", description: "Zamknięcie okresu", group: "Inwentaryzacja" },
  { code: "fleet.edit", description: "Flota, rębaki i firmy zewnętrzne — edycja", group: "Kartoteki" },
  { code: "master.edit", description: "Kartoteki (materiały, kontrahenci, operacje dodatkowe) — edycja", group: "Kartoteki" },
  { code: "warehouses.edit", description: "Magazyny — dodawanie i edycja", group: "Kartoteki" },
  { code: "report.view", description: "Stany, dokumenty i raporty — odczyt", group: "Raporty" },
  { code: "reports.export", description: "Eksport (CSV, XLSX, PDF, DOCX)", group: "Raporty" },
  { code: "history.read", description: "Historia zmian — odczyt", group: "Raporty" },
  { code: "audit.read", description: "Dziennik audytu — odczyt", group: "Administracja" },
  { code: "users.read", description: "Użytkownicy — podgląd", group: "Administracja" },
  { code: "users.manage", description: "Użytkownicy — zapraszanie, edycja, blokowanie, hasła, sesje", group: "Administracja" },
  { code: "roles.assign", description: "Role i uprawnienia — zmiana", group: "Administracja" },
  { code: "notifications.manage", description: "Powiadomienia — włączanie użytkownikom", group: "Administracja" },
  { code: "settings.edit", description: "Konfiguracja systemu (przeliczniki, tryb MM, poczta)", group: "Administracja" },
  { code: "data.backup", description: "Kopie zapasowe — tworzenie i odtwarzanie", group: "Administracja" },
];

const CREATE = ["receipts.create", "issues.create", "production.create", "mm.create", "mm.receive", "additional.create"];
export const ROLES: ReadonlyArray<{ code: string; name: string; description: string; global: boolean; permissions: string[] | "*" }> = [
  { code: "ADMINISTRATOR", name: "Administrator", global: true, permissions: "*", description: "Pełny dostęp: wszystkie magazyny, użytkownicy i role, dane startowe, kopie, konfiguracja." },
  { code: "MANAGER", name: "Manager", global: false, description: "Operacje, korekty i usuwanie w przydzielonych magazynach, zamykanie okresów, flota i kartoteki, podgląd użytkowników.",
    permissions: [...CREATE, "op.approve", "documents.correct", "documents.delete", "purchases.correct", "sales.correct", "production.correct", "inventory.correct", "opening.manage", "inv.open", "inv.count", "inv.close", "fleet.edit", "master.edit", "report.view", "reports.export", "history.read", "users.read"] },
  { code: "MAGAZYNIER", name: "Magazynier", global: false, description: "Przyjęcia, wydania, produkcja, MM i operacje dodatkowe w przydzielonych magazynach; stany, dokumenty, spis z natury.",
    permissions: [...CREATE, "inv.count", "report.view", "history.read"] },
  { code: "OBSERWATOR", name: "Obserwator", global: false, description: "Tylko odczyt w przydzielonych magazynach.", permissions: ["report.view", "history.read"] },
  { code: "AUDYTOR", name: "Audytor", global: true, description: "Odczyt wszystkich magazynów, raporty, historia i dziennik audytu — bez zmian w danych.", permissions: ["report.view", "reports.export", "history.read", "audit.read", "users.read"] },
];

export const WAREHOUSES = [
  { code: "ZAB", name: "RiC Zabrze", address: "ul. Gwarecka 16, 41-800 Zabrze" },
  { code: "BRA", name: "RiC Brąszewice", address: "Brąszewice" },
  { code: "ROK", name: "RiC Rokitki", address: "Rokitki" },
] as const;

export const MATERIALS = [
  { code: "DRW-O", name: "Drewno opałowe", category: "WOOD", stockUnit: "M3", allowedUnits: ["M3", "MP", "T"] },
  { code: "DRW-I", name: "Drewno z wycinki inwestycyjnej", category: "WOOD", stockUnit: "M3", allowedUnits: ["M3", "MP", "T"] },
  { code: "ZR-PL", name: "Zrębka produkcyjna leśna", category: "CHIPS", stockUnit: "MP", allowedUnits: ["MP", "M3", "T"] },
  { code: "ZR-PI", name: "Zrębka produkcyjna inwestycyjna", category: "CHIPS", stockUnit: "MP", allowedUnits: ["MP", "M3", "T"] },
  { code: "ZR-T", name: "Zrębka towar", category: "CHIPS", stockUnit: "MP", allowedUnits: ["MP", "M3", "T"] },
  { code: "PKS", name: "PKS (łupina palmowa)", category: "TONNAGE", stockUnit: "T", allowedUnits: ["T"] },
  { code: "LUP-N", name: "Łupina nerkowca", category: "TONNAGE", stockUnit: "T", allowedUnits: ["T"] },
] as const;

/** Przeliczniki firmowe (materialId = null) obowiązujące od początku pracy systemu. */
export const COMPANY_RATES = [
  { fromUnit: "M3", toUnit: "MP", factor: "4", note: "1 m³ = 4 MP" },
  { fromUnit: "MP", toUnit: "M3", factor: "0.25", note: "1 MP = 0,25 m³" },
  { fromUnit: "MP", toUnit: "T", factor: "0.33", note: "1 MP = 0,33 t" },
  { fromUnit: "M3", toUnit: "T", factor: "0.952", note: "1 m³ drewna ≈ 0,952 t" },
] as const;

export const ADDITIONAL_OPERATION_TYPES = [
  { name: "Holowanie", description: "Holowanie pojazdu / maszyny" },
  { name: "Podgarnianie pryzm ładowarką", description: "Formowanie i podgarnianie pryzm" },
  { name: "Czyszczenie placu", description: "Sprzątanie placu składowego" },
  { name: "Praca ładowarką", description: "Praca ładowarki (godziny)", unit: "h" },
  { name: "Przemieszczanie biomasy", description: "Przemieszczanie materiału w obrębie placu" },
] as const;

export const SETTINGS = {
  "mm.mode": "two",
  "operations.requireApproval": false,
  "auth.allowSelfRegistration": false,
  "rates.effectiveFrom": "2026-10-01",
} as const;
