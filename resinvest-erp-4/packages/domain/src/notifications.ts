/**
 * F7 — powiadomienia e-mail: zdarzenia, opisy dla użytkownika i reguła „które zdarzenia wywołuje operacja”.
 * Wysyłka idzie przez kolejkę poczty (outbox) zapisywaną w tej samej transakcji co operacja: błąd serwera poczty
 * nie cofa operacji, a zapisana operacja nie zgubi powiadomienia.
 */
export type NotificationEvent =
  | "PZ_CREATED" | "WZ_CREATED" | "PRODUCTION_CREATED" | "STOCK_OPERATION" | "ADDITIONAL_OPERATION" | "CORRECTION" | "DOCUMENT_DELETED" | "DOCUMENT_EDITED";

/**
 * Zdarzenia oferowane użytkownikom (kolejność = kolejność w ustawieniach). `DOCUMENT_EDITED` istnieje w bazie od F1,
 * ale zmiany dokumentów mają własne zdarzenia (korekta, usunięcie) — nie jest oferowane ani wysyłane.
 */
export const NOTIFICATION_EVENTS: ReadonlyArray<{ event: NotificationEvent; label: string; description: string }> = [
  { event: "PZ_CREATED", label: "Przyjęcie / zakup (PZ)", description: "Nowy dokument PZ w Twoim magazynie (także zakup z produkcją)." },
  { event: "WZ_CREATED", label: "Wydanie / sprzedaż (WZ)", description: "Nowy dokument WZ — sprzedaż z magazynu, sprzedaż wyniku produkcji, sprzedaż bezpośrednia." },
  { event: "PRODUCTION_CREATED", label: "Produkcja (PW)", description: "Nowa produkcja zrębki — na magazynie, z zakupu albo w lesie." },
  { event: "STOCK_OPERATION", label: "Przesunięcie MM", description: "Wysłanie MM z Twojego magazynu lub do niego i przyjęcie MM w magazynie docelowym." },
  { event: "ADDITIONAL_OPERATION", label: "Operacje dodatkowe", description: "Operacja z kosztami dodatkowymi (załadunek, usługa, praca sprzętu)." },
  { event: "CORRECTION", label: "Korekta dokumentu", description: "Korekta dokumentu z polami BYŁO / JEST i powodem." },
  { event: "DOCUMENT_DELETED", label: "Usunięcie dokumentu", description: "Usunięcie dokumentu z odwróceniem ruchów i powodem." },
];
export const NOTIFICATION_LABEL = Object.fromEntries(NOTIFICATION_EVENTS.map(e => [e.event, e.label])) as Record<NotificationEvent, string>;
export const isOfferedEvent = (e: string): e is NotificationEvent => NOTIFICATION_EVENTS.some(x => x.event === e);

/** Zdarzenia nowej operacji: z rodzajów jej dokumentów (PZ, WZ, PW, MM) i z operacji dodatkowych. */
export function eventsForDocuments(docTypes: readonly string[], extras: number): NotificationEvent[] {
  const out = new Set<NotificationEvent>();
  if (docTypes.includes("PZ")) out.add("PZ_CREATED");
  if (docTypes.includes("WZ")) out.add("WZ_CREATED");
  if (docTypes.includes("PW")) out.add("PRODUCTION_CREATED");
  if (docTypes.includes("MM")) out.add("STOCK_OPERATION");
  if (extras > 0) out.add("ADDITIONAL_OPERATION");
  return [...out];
}

/** Temat wiadomości: zdarzenie (pierwsze z listy, które odbiorca włączył) + numery dokumentów. */
export function notificationSubject(events: readonly NotificationEvent[], numbers: readonly string[]): string {
  const first = events[0];
  const head = first ? NOTIFICATION_LABEL[first] : "Powiadomienie";
  const more = events.length > 1 ? ` (+${events.length - 1})` : "";
  return `${head}${more}: ${numbers.filter(Boolean).join(", ")}`.slice(0, 240);
}
