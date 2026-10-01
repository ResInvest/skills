import Decimal from "decimal.js";
import { convert, UnitError, DEFAULT_COMPANY_RATES, QTY_DP, UNIT_LABEL, type CompanyRates, type MaterialUnits, type Unit, type ValueSource } from "./units.js";
import { parseNumber } from "./number.js";

/**
 * Silnik stanów — reguły księgowania wspólne dla API (autorytatywnie) i frontendu (podgląd).
 * Przeniesione z ResInvest ERP 3.x (engine.js: symulacja sald krok po kroku, brak stanu ujemnego):
 *  * stan = suma ruchów (ruchy tylko dopisywane, saldo aktualizowane w tej samej transakcji),
 *  * ruchy jednej operacji sprawdzane po kolei (np. zakup → zużycie → produkcja) — żaden krok nie może zejść poniżej zera,
 *  * blokady sald zakładane w stałej kolejności (magazyn, materiał) — brak zakleszczeń przy równoczesnych operacjach.
 */

/** Ruch do zaksięgowania: zmiana stanu w jednostce magazynowej materiału (+ przychód, − rozchód). */
export interface MovementRequest { warehouseId: string; materialId: string; qty: Decimal.Value }

export interface StockShortage {
  warehouseId: string; materialId: string;
  /** Stan przed krokiem, który zszedłby poniżej zera. */
  available: string;
  /** Ilość wymagana przez ten krok (wartość bezwzględna rozchodu). */
  required: string;
  missing: string;
}

export interface StockSimulation {
  /** Saldo po wszystkich ruchach (klucz `magazyn|materiał`). */
  after: Map<string, string>;
  steps: Array<{ key: string; before: string; qty: string; after: string }>;
  shortages: StockShortage[];
}

export const balanceKey = (warehouseId: string, materialId: string) => `${warehouseId}|${materialId}`;
const D = (v: Decimal.Value) => new Decimal(v);

/** Pary (magazyn, materiał) w stałej kolejności blokowania — identycznej z ORDER BY w bazie (uuid porównywane bajtowo). */
export function lockOrder(reqs: readonly MovementRequest[]): Array<{ warehouseId: string; materialId: string }> {
  const seen = new Map<string, { warehouseId: string; materialId: string }>();
  for (const r of reqs) seen.set(balanceKey(r.warehouseId.toLowerCase(), r.materialId.toLowerCase()), { warehouseId: r.warehouseId.toLowerCase(), materialId: r.materialId.toLowerCase() });
  return [...seen.values()].sort((a, b) => (a.warehouseId < b.warehouseId ? -1 : a.warehouseId > b.warehouseId ? 1 : a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0));
}

/**
 * Symulacja ruchów na saldach (krok po kroku). Ruch o ilości 0 jest błędem programisty (w bazie CHECK qty <> 0).
 * `balances` — saldo bieżące (brak klucza = 0).
 */
export function simulate(balances: ReadonlyMap<string, Decimal.Value>, reqs: readonly MovementRequest[]): StockSimulation {
  const cur = new Map<string, Decimal>();
  for (const [k, v] of balances) cur.set(k.toLowerCase(), D(v));
  const steps: StockSimulation["steps"] = [], shortages: StockShortage[] = [];
  for (const r of reqs) {
    const q = D(r.qty);
    if (!q.isFinite() || q.isZero()) throw new UnitError("Ruch magazynowy musi mieć ilość różną od zera", "INVALID_QTY");
    const key = balanceKey(r.warehouseId.toLowerCase(), r.materialId.toLowerCase());
    const before = cur.get(key) ?? D(0), after = before.plus(q).toDecimalPlaces(QTY_DP);
    if (after.isNeg()) shortages.push({ warehouseId: r.warehouseId, materialId: r.materialId, available: before.toString(), required: q.abs().toString(), missing: after.abs().toString() });
    cur.set(key, after);
    steps.push({ key, before: before.toString(), qty: q.toString(), after: after.toString() });
  }
  return { after: new Map([...cur].map(([k, v]) => [k, v.toString()])), steps, shortages };
}

/** Komunikat jak w 3.x: „Brak wystarczającej ilości: Zrębka. Dostępne: 100 MP. Wymagane: 125 MP. Brakuje: 25 MP.” */
export function shortageMessage(s: StockShortage, materialName: string, unit: Unit, warehouseName?: string): string {
  const f = (v: string) => `${formatQty(v)} ${UNIT_LABEL[unit]}`;
  return `Brak wystarczającej ilości: ${materialName}${warehouseName ? ` (${warehouseName})` : ""}. Dostępne: ${f(s.available)}. Wymagane: ${f(s.required)}. Brakuje: ${f(s.missing)}.`;
}

/** Liczba w formacie polskim (spacja tysięcy, przecinek), bez zbędnych zer. */
export function formatQty(v: Decimal.Value, dp = 3): string {
  const d = D(v).toDecimalPlaces(dp);
  const [i, f] = d.abs().toFixed().split(".");
  const int = (i ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${d.isNeg() ? "−" : ""}${int}${f ? "," + f : ""}`;
}

// ---------------------------------------------------------------------------------------------------------
// Bilans otwarcia
// ---------------------------------------------------------------------------------------------------------

export interface OpeningLineInput { materialId: string; qty: unknown; unit: Unit; note?: string | null }
export interface OpeningLinePlan {
  materialId: string; qty: string; unit: Unit;
  /** Ilość w jednostce magazynowej materiału. */
  qtyStock: string; stockUnit: Unit; factor: string; source: ValueSource; note: string | null;
}
export interface OpeningMaterial extends MaterialUnits { id: string; name: string; active: boolean }
export type OpeningPlan = { ok: true; lines: OpeningLinePlan[] } | { ok: false; errors: Array<{ field: string; message: string }> };

export const MAX_OPENING_LINES = 500;

/**
 * Walidacja i przeliczenie pozycji bilansu otwarcia: materiał istnieje i jest aktywny, bez powtórzeń,
 * ilość nieujemna, jednostka dozwolona; ilość przeliczana na jednostkę magazynową (przelicznik + źródło).
 */
export function planOpening(lines: readonly OpeningLineInput[], materials: ReadonlyMap<string, OpeningMaterial>, rates: CompanyRates = DEFAULT_COMPANY_RATES): OpeningPlan {
  const errors: Array<{ field: string; message: string }> = [];
  if (!lines.length) errors.push({ field: "lines", message: "Dodaj co najmniej jedną pozycję bilansu" });
  if (lines.length > MAX_OPENING_LINES) errors.push({ field: "lines", message: `Maksymalnie ${MAX_OPENING_LINES} pozycji w jednym bilansie` });
  const seen = new Set<string>(), out: OpeningLinePlan[] = [];
  lines.forEach((l, i) => {
    const f = (k: string) => `lines.${i}.${k}`;
    const m = materials.get(l.materialId);
    if (!m) { errors.push({ field: f("materialId"), message: "Wybierz materiał z kartoteki" }); return; }
    if (!m.active) { errors.push({ field: f("materialId"), message: `Materiał „${m.name}” jest nieaktywny` }); return; }
    if (seen.has(m.id)) { errors.push({ field: f("materialId"), message: `Materiał „${m.name}” występuje w bilansie więcej niż raz` }); return; }
    seen.add(m.id);
    const p = parseNumber(l.qty);
    if (!p.ok) { errors.push({ field: f("qty"), message: p.empty ? "Podaj ilość" : p.error }); return; }
    if (D(p.value).isNeg()) { errors.push({ field: f("qty"), message: "Ilość nie może być ujemna" }); return; }
    try {
      const c = convert(p.value, l.unit, m.stockUnit, m, rates);
      out.push({ materialId: m.id, qty: D(p.value).toDecimalPlaces(QTY_DP).toString(), unit: l.unit, qtyStock: c.value, stockUnit: m.stockUnit, factor: c.factor, source: c.source, note: l.note?.trim() ? l.note.trim().slice(0, 300) : null });
    } catch (e) {
      errors.push({ field: f("unit"), message: e instanceof UnitError ? e.message : "Nie można przeliczyć ilości" });
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, lines: out };
}

/** Przeliczniki firmowe z wierszy tabeli conversion_rates (materialId = null); brak wiersza = wartość domyślna. */
export function companyRatesFrom(rows: ReadonlyArray<{ fromUnit: Unit; toUnit: Unit; factor: Decimal.Value }>): CompanyRates {
  const get = (a: Unit, b: Unit) => rows.find(r => r.fromUnit === a && r.toUnit === b)?.factor;
  return {
    mpPerM3: get("M3", "MP") ?? (get("MP", "M3") ? D(1).div(get("MP", "M3")!) : DEFAULT_COMPANY_RATES.mpPerM3),
    tonPerMp: get("MP", "T") ?? DEFAULT_COMPANY_RATES.tonPerMp,
    woodTonPerM3: get("M3", "T") ?? DEFAULT_COMPANY_RATES.woodTonPerM3,
  };
}

/** a − b na łańcuchach dziesiętnych (np. stan przed ruchem = stan po − ruch). */
export const qtySub = (a: Decimal.Value, b: Decimal.Value): string => D(a).minus(b).toString();
/** Suma ilości bez błędów zmiennoprzecinkowych (łańcuch dziesiętny). */
export const qtySum = (a: Decimal.Value, b: Decimal.Value): string => D(a).plus(b).toString();
/** Postać kanoniczna liczby dziesiętnej („817.000000” → „817”). */
export const qtyNorm = (a: Decimal.Value): string => D(a).toString();
