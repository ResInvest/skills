import Decimal from "decimal.js";
import { QTY_DP } from "./units.js";

/**
 * F6 — reguły raportów: obroty magazynowe (stan początkowy, przychody i rozchody wg rodzaju ruchu, stan końcowy),
 * zestawienie miesięczne i roczne, zakresy okresów, kontrola spójności z saldami. Liczby jako łańcuchy dziesiętne.
 */
const D = (v: Decimal.Value) => new Decimal(v);

export type PeriodKind = "day" | "week" | "month" | "quarter" | "year";
export const PERIOD_LABEL: Record<PeriodKind, string> = { day: "Dzień", week: "Tydzień", month: "Miesiąc", quarter: "Kwartał", year: "Rok" };
export const MONTH_NAMES = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Zakres okresu zawierającego dzień `anchor` (RRRR-MM-DD): dzień, tydzień (pon–nd), miesiąc, kwartał, rok — włącznie. */
export function periodBounds(kind: PeriodKind, anchor: string): { from: string; to: string } {
  const d = utc(anchor), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (kind === "day") return { from: anchor, to: anchor };
  if (kind === "week") {
    const shift = (d.getUTCDay() + 6) % 7;
    const mon = new Date(d.getTime() - shift * 864e5);
    return { from: iso(mon), to: iso(new Date(mon.getTime() + 6 * 864e5)) };
  }
  if (kind === "month") return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
  if (kind === "quarter") { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(Date.UTC(y, q, 1))), to: iso(new Date(Date.UTC(y, q + 3, 0))) }; }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/** Dzień przed datą (stan początkowy okresu = stan na koniec dnia poprzedniego). */
export const dayBefore = (s: string) => iso(new Date(utc(s).getTime() - 864e5));

// ---------------------------------------------------------------------------------------------------------
// Obroty magazynowe
// ---------------------------------------------------------------------------------------------------------

export type TurnoverIn = "opening" | "purchase" | "production" | "transferIn";
export type TurnoverOut = "sale" | "consumption" | "transferOut";
/** Rodzaj ruchu → kolumna raportu. Inwentaryzacja i inne korekty stanu — kolumna „inne” (ze znakiem). */
export const KIND_COLUMN: Record<string, TurnoverIn | TurnoverOut | "other"> = {
  OPENING: "opening", PURCHASE: "purchase", PRODUCTION: "production", TRANSFER_IN: "transferIn",
  SALE: "sale", CONSUMPTION: "consumption", TRANSFER_OUT: "transferOut", INVENTORY: "other", CORRECTION: "other",
};
export const TURNOVER_LABEL: Record<TurnoverIn | TurnoverOut | "other", string> = {
  opening: "Bilans otwarcia", purchase: "Zakup (PZ)", production: "Produkcja (PW)", transferIn: "MM przychód",
  sale: "Sprzedaż (WZ)", consumption: "Zużycie (RW)", transferOut: "MM rozchód", other: "Inne",
};

/**
 * Ruch do raportu. Ruch odwracający (korekta / usunięcie) ma rodzaj ruchu odwracanego i `reversal = true` —
 * dzięki temu zakup skorygowany ze 100 na 90 daje w kolumnie „zakup” 90, a nie 100 + 90 − 100 w różnych kolumnach.
 */
export interface TurnoverMovement { materialId: string; kind: string; qty: string; reversal?: boolean }
export interface TurnoverRow {
  materialId: string; start: string;
  opening: string; purchase: string; production: string; transferIn: string;
  sale: string; consumption: string; transferOut: string; other: string;
  /** W tym odwrócenia (korekty i usunięcia) — ze znakiem, informacyjnie. */
  reversals: string;
  inTotal: string; outTotal: string; end: string;
}
const IN: TurnoverIn[] = ["opening", "purchase", "production", "transferIn"];
const OUT: TurnoverOut[] = ["sale", "consumption", "transferOut"];

/** Obroty: stan na początek + ruchy okresu → wiersz na materiał (rozchody jako liczby dodatnie). Materiały bez stanu i ruchów pomija. */
export function stockTurnover(start: ReadonlyMap<string, string>, movements: readonly TurnoverMovement[]): TurnoverRow[] {
  type Acc = Record<TurnoverIn | TurnoverOut | "other" | "reversals", Decimal>;
  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) { a = { opening: D(0), purchase: D(0), production: D(0), transferIn: D(0), sale: D(0), consumption: D(0), transferOut: D(0), other: D(0), reversals: D(0) }; acc.set(id, a); }
    return a;
  };
  for (const id of start.keys()) get(id);
  for (const m of movements) {
    const a = get(m.materialId), q = D(m.qty), col = KIND_COLUMN[m.kind] ?? "other";
    if ((OUT as string[]).includes(col)) a[col] = a[col].minus(q); else a[col] = a[col].plus(q);
    if (m.reversal) a.reversals = a.reversals.plus(q);
  }
  const s = (d: Decimal) => d.toDecimalPlaces(QTY_DP).toString();
  const rows: TurnoverRow[] = [];
  for (const [id, a] of acc) {
    const st = D(start.get(id) ?? 0);
    const inT = IN.reduce((x, k) => x.plus(a[k]), D(0)), outT = OUT.reduce((x, k) => x.plus(a[k]), D(0));
    const end = st.plus(inT).minus(outT).plus(a.other);
    if (st.isZero() && inT.isZero() && outT.isZero() && a.other.isZero() && end.isZero()) continue;
    rows.push({ materialId: id, start: s(st), opening: s(a.opening), purchase: s(a.purchase), production: s(a.production), transferIn: s(a.transferIn),
      sale: s(a.sale), consumption: s(a.consumption), transferOut: s(a.transferOut), other: s(a.other), reversals: s(a.reversals),
      inTotal: s(inT), outTotal: s(outT), end: s(end) });
  }
  return rows;
}

/** Kontrola spójności: stan końcowy z ruchów = saldo w tabeli sald (dla raportu kończącego się dziś). */
export function consistencyCheck(rows: ReadonlyArray<Pick<TurnoverRow, "materialId" | "end">>, balances: ReadonlyMap<string, string>) {
  const ids = new Set([...rows.map(r => r.materialId), ...balances.keys()]);
  const byId = new Map(rows.map(r => [r.materialId, r.end]));
  const mismatches: Array<{ materialId: string; fromMovements: string; balance: string }> = [];
  for (const id of ids) {
    const a = D(byId.get(id) ?? 0), b = D(balances.get(id) ?? 0);
    if (!a.eq(b)) mismatches.push({ materialId: id, fromMovements: a.toString(), balance: b.toString() });
  }
  return { ok: mismatches.length === 0, mismatches };
}

// ---------------------------------------------------------------------------------------------------------
// Zestawienie miesięczne i roczne
// ---------------------------------------------------------------------------------------------------------

export interface SummaryOp {
  date: string; type: string; purchaseCost: string; revenue: string; chippingCost: string; transportCost: string; additionalCost: string;
  /** Wynik produkcji w MP (produkcja na magazynie, z zakupu, w lesie). */
  productionMp: string | null;
}
export interface SummaryRow {
  month: number; operations: number; purchases: number; sales: number; productions: number; transfers: number;
  purchaseCost: string; revenue: string; chippingCost: string; transportCost: string; additionalCost: string;
  /** Przychód − zakup − rąbanie − transport − operacje dodatkowe (orientacyjnie, bez wyceny zapasu). */
  result: string; productionMp: string; corrections: number; deletions: number;
}
const MONEY = ["purchaseCost", "revenue", "chippingCost", "transportCost", "additionalCost"] as const;

/** Rok w 12 miesiącach + suma roku. Korekty i usunięcia liczone wg daty ich wykonania. */
export function yearSummary(year: number, ops: readonly SummaryOp[], correctionDates: readonly string[] = [], deletionDates: readonly string[] = []) {
  const empty = (month: number) => ({ month, operations: 0, purchases: 0, sales: 0, productions: 0, transfers: 0,
    money: Object.fromEntries(MONEY.map(k => [k, D(0)])) as Record<(typeof MONEY)[number], Decimal>, mp: D(0), corrections: 0, deletions: 0 });
  const months = Array.from({ length: 12 }, (_, i) => empty(i + 1));
  const inYear = (d: string) => Number(d.slice(0, 4)) === year;
  for (const o of ops) {
    if (!inYear(o.date)) continue;
    const m = months[Number(o.date.slice(5, 7)) - 1]!;
    m.operations++;
    if (o.type === "PURCHASE") m.purchases++; else if (o.type === "SALE") m.sales++; else if (o.type === "PRODUCTION") m.productions++; else if (o.type === "TRANSFER") m.transfers++;
    for (const k of MONEY) m.money[k] = m.money[k].plus(o[k] || 0);
    if (o.productionMp) m.mp = m.mp.plus(o.productionMp);
  }
  for (const d of correctionDates) if (inYear(d)) months[Number(d.slice(5, 7)) - 1]!.corrections++;
  for (const d of deletionDates) if (inYear(d)) months[Number(d.slice(5, 7)) - 1]!.deletions++;
  const out = (m: ReturnType<typeof empty>): SummaryRow => ({
    month: m.month, operations: m.operations, purchases: m.purchases, sales: m.sales, productions: m.productions, transfers: m.transfers,
    purchaseCost: m.money.purchaseCost.toFixed(2), revenue: m.money.revenue.toFixed(2), chippingCost: m.money.chippingCost.toFixed(2),
    transportCost: m.money.transportCost.toFixed(2), additionalCost: m.money.additionalCost.toFixed(2),
    result: m.money.revenue.minus(m.money.purchaseCost).minus(m.money.chippingCost).minus(m.money.transportCost).minus(m.money.additionalCost).toFixed(2),
    productionMp: m.mp.toDecimalPlaces(QTY_DP).toString(), corrections: m.corrections, deletions: m.deletions,
  });
  const total = empty(0);
  for (const m of months) {
    total.operations += m.operations; total.purchases += m.purchases; total.sales += m.sales; total.productions += m.productions; total.transfers += m.transfers;
    for (const k of MONEY) total.money[k] = total.money[k].plus(m.money[k]);
    total.mp = total.mp.plus(m.mp); total.corrections += m.corrections; total.deletions += m.deletions;
  }
  return { year, months: months.map(out), total: out(total) };
}

/** Operacje dodatkowe w okresie pogrupowane po rodzaju (kafel pulpitu): liczba, ilość, koszt; malejąco po koszcie. */
export function extrasByType(rows: ReadonlyArray<{ type: string; quantity: string | null; cost: string }>) {
  const m = new Map<string, { type: string; count: number; quantity: Decimal; cost: Decimal }>();
  for (const r of rows) {
    const a = m.get(r.type) ?? { type: r.type, count: 0, quantity: D(0), cost: D(0) };
    a.count++; a.quantity = a.quantity.plus(r.quantity ?? 0); a.cost = a.cost.plus(r.cost);
    m.set(r.type, a);
  }
  const list = [...m.values()].sort((a, b) => b.cost.cmp(a.cost) || a.type.localeCompare(b.type, "pl"));
  return { rows: list.map(a => ({ type: a.type, count: a.count, quantity: a.quantity.toString(), cost: a.cost.toFixed(2) })),
    total: list.reduce((x, a) => x.plus(a.cost), D(0)).toFixed(2) };
}
