import { describe, expect, it } from "vitest";
import { eventsForDocuments, isOfferedEvent, NOTIFICATION_EVENTS, notificationSubject } from "./notifications.js";

describe("powiadomienia — reguły F7", () => {
  it("zdarzenia z dokumentów operacji: zakup z produkcją i sprzedażą wyniku, MM, operacje dodatkowe; TR i RW bez zdarzenia", () => {
    expect(eventsForDocuments(["PZ", "RW", "PW", "WZ", "TR"], 1)).toEqual(["PZ_CREATED", "WZ_CREATED", "PRODUCTION_CREATED", "ADDITIONAL_OPERATION"]);
    expect(eventsForDocuments(["MM"], 0)).toEqual(["STOCK_OPERATION"]);
    expect(eventsForDocuments(["RW", "TR"], 0)).toEqual([]);
  });
  it("oferowane zdarzenia: 7, bez zarezerwowanego DOCUMENT_EDITED", () => {
    expect(NOTIFICATION_EVENTS).toHaveLength(7);
    expect(isOfferedEvent("DOCUMENT_EDITED")).toBe(false);
    expect(isOfferedEvent("CORRECTION")).toBe(true);
  });
  it("temat: pierwsze zdarzenie, liczba pozostałych, numery", () => {
    expect(notificationSubject(["PZ_CREATED", "PRODUCTION_CREATED"], ["PZ/001/10/2026", "PW/001/10/2026"])).toBe("Przyjęcie / zakup (PZ) (+1): PZ/001/10/2026, PW/001/10/2026");
    expect(notificationSubject(["DOCUMENT_DELETED"], ["WZ 3/2026"])).toBe("Usunięcie dokumentu: WZ 3/2026");
  });
});
