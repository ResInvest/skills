/** Klucz idempotencji żądania zapisu: jeden na otwarte podsumowanie / okno — ponowienie po błędzie sieci nie zdubluje zapisu. */
export const newKey = (): string =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
