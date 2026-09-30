import Decimal from "decimal.js";

/**
 * Jednostki i przeliczniki — jedno źródło reguł dla API (autorytatywnie) i frontendu (podgląd).
 *
 * Model (przeniesiony z ResInvest ERP 3.x, `Units`):
 *  * każda konwersja przechodzi przez m³: ilość → m³ → jednostka docelowa,
 *  * MP ↔ m³: `mpPerM3` materiału, a gdy brak — przelicznik firmowy (1 m³ = 4 MP),
 *  * t ↔ m³: dla materiałów w m³/MP — masa jednostki (`tonPerUnit`) lub firmowa (MP: 0,33 t; drewno: 0,952 t/m³);
 *    dla materiałów w tonach — gęstość `tonPerM3` (bez niej materiał w tonach nie przelicza się na m³ / MP),
 *  * źródło wyniku: AUTO (przelicznik materiału), COMPANY_RATE (przelicznik firmowy), MANUAL (wpis użytkownika).
 * Przeliczników nie zaszywa się w kodzie wywołującym — pochodzą z konfiguracji (tabela conversion_rates / settings).
 */
export type Unit = "M3" | "MP" | "T";
export const UNITS: readonly Unit[] = ["M3", "MP", "T"] as const;
export type ValueSource = "AUTO" | "MANUAL" | "COMPANY_RATE";

export const UNIT_LABEL: Record<Unit, string> = { M3: "m³", MP: "MP", T: "t" };

/** Przeliczniki firmowe (domyślne wartości biznesowe; nadpisywane konfiguracją). */
export interface CompanyRates {
  /** MP z 1 m³ (1 m³ = 4 MP ⇒ 1 MP = 0,25 m³). */
  mpPerM3: Decimal.Value;
  /** Masa 1 MP zrębki [t] (1 MP = 0,33 t). */
  tonPerMp: Decimal.Value;
  /** Masa 1 m³ drewna [t]. */
  woodTonPerM3: Decimal.Value;
}
export const DEFAULT_COMPANY_RATES: CompanyRates = { mpPerM3: 4, tonPerMp: 0.33, woodTonPerM3: 0.952 };

export interface MaterialUnits {
  stockUnit: Unit;
  allowedUnits: readonly Unit[];
  /** Masa 1 jednostki magazynowej [t] (m³ lub MP). */
  tonPerUnit?: Decimal.Value | null;
  /** MP z 1 m³ dla tego materiału. */
  mpPerM3?: Decimal.Value | null;
  /** Gęstość t/m³ materiału prowadzonego w tonach. */
  tonPerM3?: Decimal.Value | null;
}

export class UnitError extends Error {
  constructor(message: string, readonly code: "UNIT_NOT_ALLOWED" | "NO_FACTOR" | "INVALID_QTY") { super(message); this.name = "UnitError"; }
}

/** Precyzja zapisu ilości (numeric(18,6)) i masy. */
export const QTY_DP = 6;
const D = (v: Decimal.Value) => new Decimal(v);
const has = (v: Decimal.Value | null | undefined): v is Decimal.Value => v !== null && v !== undefined && new Decimal(v).gt(0);

interface Factor { value: Decimal; source: ValueSource }

/** m³ w 1 jednostce `u` materiału (+ źródło przelicznika). */
function m3PerUnit(u: Unit, m: MaterialUnits, r: CompanyRates): Factor {
  if (u === "M3") return { value: D(1), source: "AUTO" };
  if (u === "MP") return has(m.mpPerM3) ? { value: D(1).div(m.mpPerM3), source: "AUTO" } : { value: D(1).div(r.mpPerM3), source: "COMPANY_RATE" };
  // tony → m³
  if (m.stockUnit === "T") {
    if (!has(m.tonPerM3)) throw new UnitError("Materiał prowadzony w tonach nie ma gęstości t/m³ — nie można przeliczyć na m³ / MP", "NO_FACTOR");
    return { value: D(1).div(m.tonPerM3), source: "AUTO" };
  }
  const t = tonPerStockUnit(m, r);
  return { value: m3PerUnit(m.stockUnit, m, r).value.div(t.value), source: worst(t.source, m3PerUnit(m.stockUnit, m, r).source) };
}

/** Masa 1 jednostki magazynowej [t] (+ źródło). */
export function tonPerStockUnit(m: MaterialUnits, r: CompanyRates = DEFAULT_COMPANY_RATES): Factor {
  if (m.stockUnit === "T") return { value: D(1), source: "AUTO" };
  if (has(m.tonPerUnit)) return { value: D(m.tonPerUnit), source: "AUTO" };
  return m.stockUnit === "MP" ? { value: D(r.tonPerMp), source: "COMPANY_RATE" } : { value: D(r.woodTonPerM3), source: "COMPANY_RATE" };
}

const worst = (a: ValueSource, b: ValueSource): ValueSource => (a === "COMPANY_RATE" || b === "COMPANY_RATE" ? "COMPANY_RATE" : a);

export function assertAllowed(unit: Unit, m: MaterialUnits): void {
  const allowed = m.allowedUnits.includes(m.stockUnit) ? m.allowedUnits : [m.stockUnit, ...m.allowedUnits];
  if (!allowed.includes(unit)) throw new UnitError(`Jednostka ${UNIT_LABEL[unit]} nie jest dozwolona dla tego materiału (dozwolone: ${allowed.map(u => UNIT_LABEL[u]).join(", ")})`, "UNIT_NOT_ALLOWED");
}

export interface Conversion {
  /** Wartość źródłowa i jednostka źródłowa. */
  qty: string; from: Unit;
  /** Wartość przeliczona i jednostka docelowa. */
  value: string; to: Unit;
  /** Zastosowany przelicznik: value = qty × factor. */
  factor: string;
  source: ValueSource;
}

/** Przeliczenie ilości między jednostkami materiału (wynik zaokrąglony do 6 miejsc). */
export function convert(qty: Decimal.Value, from: Unit, to: Unit, m: MaterialUnits, r: CompanyRates = DEFAULT_COMPANY_RATES): Conversion {
  const q = D(qty);
  if (!q.isFinite() || q.isNeg()) throw new UnitError("Ilość musi być liczbą nieujemną", "INVALID_QTY");
  assertAllowed(from, m); assertAllowed(to, m);
  if (from === to) return { qty: q.toString(), from, value: q.toDecimalPlaces(QTY_DP).toString(), to, factor: "1", source: "AUTO" };
  const a = m3PerUnit(from, m, r), b = m3PerUnit(to, m, r);
  const factor = a.value.div(b.value);
  return { qty: q.toString(), from, value: q.mul(factor).toDecimalPlaces(QTY_DP).toString(), to, factor: factor.toDecimalPlaces(QTY_DP).toString(), source: worst(a.source, b.source) };
}

export interface Tonnage { weightT: string; source: ValueSource; autoWeightT: string }

/**
 * Tonaż pozycji dokumentu: AUTO / przelicznik firmowy z ilości magazynowej albo MANUAL (np. kwit wagowy).
 * Wartość ręczna jest wartością dokumentu — nigdy nie jest nadpisywana przeliczeniem.
 */
export function tonnage(qtyStock: Decimal.Value, m: MaterialUnits, manual: Decimal.Value | null | undefined, r: CompanyRates = DEFAULT_COMPANY_RATES): Tonnage {
  const t = tonPerStockUnit(m, r);
  const auto = D(qtyStock).mul(t.value).toDecimalPlaces(QTY_DP);
  if (manual !== null && manual !== undefined && String(manual).trim() !== "") {
    const w = D(manual);
    if (!w.isFinite() || w.lte(0)) throw new UnitError("Tonaż ręczny musi być większy od 0", "INVALID_QTY");
    return { weightT: w.toDecimalPlaces(QTY_DP).toString(), source: "MANUAL", autoWeightT: auto.toString() };
  }
  return { weightT: auto.toString(), source: t.source, autoWeightT: auto.toString() };
}
