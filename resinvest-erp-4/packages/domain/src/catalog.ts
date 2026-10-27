/**
 * Reguły kartotek wspólne dla API i formularzy: NIP (suma kontrolna), numer rejestracyjny, kod materiału.
 */

/** NIP bez separatorów (spacje, myślniki, prefiks PL). */
export const normalizeNip = (v: string): string => v.replace(/^\s*PL/i, "").replace(/[\s-]/g, "");

/** Polski NIP: 10 cyfr, suma kontrolna (wagi 6,5,7,2,3,4,5,6,7; suma mod 11 = ostatnia cyfra). */
export function isValidNip(v: string): boolean {
  const n = normalizeNip(v);
  if (!/^\d{10}$/.test(n) || /^0{10}$/.test(n)) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = w.reduce((a, x, i) => a + x * Number(n[i]), 0) % 11;
  return sum !== 10 && sum === Number(n[9]);
}

/** Numer rejestracyjny: wielkie litery, pojedyncze spacje („sgl 4t821” → „SGL 4T821”). */
export const normalizeRegistration = (v: string): string => v.trim().toUpperCase().replace(/\s+/g, " ");
export const isValidRegistration = (v: string): boolean => /^[A-Z0-9][A-Z0-9 ]{1,9}$/.test(normalizeRegistration(v));

/** Kod materiału: wielkie litery, cyfry, myślnik (np. ZR-PL). */
export const normalizeCode = (v: string): string => v.trim().toUpperCase();
export const isValidCode = (v: string): boolean => /^[A-Z0-9][A-Z0-9-]{0,19}$/.test(normalizeCode(v));
