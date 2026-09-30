import Decimal from "decimal.js";

/**
 * Parser liczb wpisywanych przez użytkownika (format polski): „1 234,56”, „1234.56”, „19,8”.
 * Zwraca łańcuch dziesiętny (bez utraty precyzji) albo błąd z komunikatem dla użytkownika.
 */
export type ParsedNumber = { ok: true; value: string } | { ok: false; empty: boolean; error: string };

export function parseNumber(input: unknown): ParsedNumber {
  if (input === null || input === undefined) return { ok: false, empty: true, error: "Pole wymagane" };
  if (typeof input === "number") return Number.isFinite(input) ? { ok: true, value: new Decimal(input).toString() } : { ok: false, empty: false, error: "Nieprawidłowa liczba" };
  const raw = String(input).replace(/[\s\u00A0\u202F]/g, "");
  if (raw === "") return { ok: false, empty: true, error: "Pole wymagane" };
  let s = raw;
  const commas = (s.match(/,/g) ?? []).length, dots = (s.match(/\./g) ?? []).length;
  if (commas && dots) {
    // separator dziesiętny = ostatni z dwóch znaków; drugi to separator tysięcy
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (commas === 1) s = s.replace(",", ".");
  else if (commas > 1 || dots > 1) return { ok: false, empty: false, error: "Nieprawidłowa liczba — użyj jednego separatora dziesiętnego" };
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, empty: false, error: "Nieprawidłowa liczba" };
  return { ok: true, value: new Decimal(s).toString() };
}
