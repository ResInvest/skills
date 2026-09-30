import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Token jednorazowy / sesji: 256 bitów losowości (base64url). W bazie zapisywany wyłącznie skrót SHA-256. */
export const newToken = (): string => randomBytes(32).toString("base64url");
export const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
export const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
/** Format tokenu z linku — odrzuca śmieci przed zapytaniem do bazy. */
export const isTokenShape = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(t);
