import Decimal from "decimal.js";
import { DEFAULT_COMPANY_RATES, QTY_DP, type CompanyRates } from "./units.js";

/**
 * Planer zakupów (F4c): plan dzienny (MP) wpisywany ręcznie, wszystko inne liczone z operacji zakupu:
 *  - wykonanie [MP]: produkcja z zakupu (PZ → RW → PW), produkcja w lesie przy sprzedaży bezpośredniej oraz zakup
 *    materiału prowadzonego w MP (zakupiona zrębka),
 *  - tony: waga kursu, gdy kurs zważono; reszta ilości × przelicznik firmowy (0,33 t/MP),
 *  - cena [zł/MP] = wartość zakupu ÷ wykonanie, km / transport / kursy — z kursów (TR) tych operacji.
 * Poprawki wartości AUTO — wyłącznie korektą dokumentu; planer zawsze zgadza się z magazynem i raportami.
 */

export interface PlannerRun { qty: string | null; weightT: string | null; km: string; cost: string; driver: string | null; registration: string | null; company: string | null }
export interface PlannerOp {
  id: string; warehouseId: string; date: string; mp: string; purchaseCost: string; place: string | null;
  runs: PlannerRun[]; documents: Array<{ type: string; number: string }>;
}
export interface PlannerPlan { warehouseId: string; date: string; planMp: string; note: string | null; version?: number }
export interface PlannerDay {
  date: string; future: boolean;
  plan: string; note: string | null;
  act: string; t: string; tWeighed: string; tAuto: string;
  purchaseCost: string; km: string; transportCost: string; trips: number;
  places: string[]; opIds: string[];
}
export interface PlannerTotals {
  plan: string; planToDate: string; act: string; t: string; tWeighed: string; purchaseCost: string; km: string; transportCost: string;
  trips: number; productionDays: number;
  /** % planu do dziś (przyszłe dni nie zaniżają realizacji); null, gdy brak planu do dziś. */
  realization: string | null;
  avgPrice: string | null; transportPerMp: string | null;
  /** Udział wagi rzeczywistej w tonach (%). */
  weighedShare: string | null;
}

const D = (v: Decimal.Value) => new Decimal(v);
const q = (d: Decimal) => d.toDecimalPlaces(QTY_DP).toString();
const pct = (a: Decimal, b: Decimal) => (b.gt(0) ? a.div(b).mul(100).toDecimalPlaces(1).toString() : null);

/** Kolejne dni RRRR-MM-DD od `from` do `to` włącznie. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`);
  for (let i = 0; d <= end && i < 1000; i++, d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/** Tony operacji: waga zważonych kursów + niezważona reszta ilości × przelicznik. */
export function opTonnage(op: Pick<PlannerOp, "mp" | "runs">, rates: CompanyRates = DEFAULT_COMPANY_RATES): { weighed: Decimal; auto: Decimal } {
  const weighedRuns = op.runs.filter(r => r.weightT !== null);
  const weighed = weighedRuns.reduce((a, r) => a.plus(r.weightT!), D(0));
  const weighedQty = weighedRuns.reduce((a, r) => a.plus(r.qty ?? 0), D(0));
  const rest = Decimal.max(0, D(op.mp).minus(weighedQty));
  return { weighed, auto: rest.mul(rates.tonPerMp).toDecimalPlaces(QTY_DP) };
}

/** Dni planera dla zakresu i magazynów (plany z wielu magazynów sumują się). */
export function plannerDays(from: string, to: string, ops: readonly PlannerOp[], plans: readonly PlannerPlan[], today: string, rates: CompanyRates = DEFAULT_COMPANY_RATES): PlannerDay[] {
  return dayRange(from, to).map(date => {
    const dayOps = ops.filter(o => o.date === date);
    const dayPlans = plans.filter(p => p.date === date);
    let act = D(0), tw = D(0), ta = D(0), cost = D(0), km = D(0), tr = D(0), trips = 0;
    for (const o of dayOps) {
      act = act.plus(o.mp); cost = cost.plus(o.purchaseCost);
      const t = opTonnage(o, rates); tw = tw.plus(t.weighed); ta = ta.plus(t.auto);
      for (const r of o.runs) { km = km.plus(r.km); tr = tr.plus(r.cost); trips++; }
    }
    return {
      date, future: date > today,
      plan: dayPlans.reduce((a, p) => a.plus(p.planMp), D(0)).toString(),
      note: dayPlans.map(p => p.note).filter(Boolean).join(" · ") || null,
      act: q(act), t: q(tw.plus(ta)), tWeighed: q(tw), tAuto: q(ta),
      purchaseCost: cost.toFixed(2), km: q(km), transportCost: tr.toFixed(2), trips,
      places: [...new Set(dayOps.map(o => o.place).filter((p): p is string => !!p))], opIds: dayOps.map(o => o.id),
    };
  });
}

/** Sumy okresu: realizacja wobec planu DO DZIŚ, średnia cena (zł/MP), transport (zł/MP), udział wagi rzeczywistej. */
export function plannerTotals(days: readonly PlannerDay[]): PlannerTotals {
  let plan = D(0), planToDate = D(0), act = D(0), t = D(0), tw = D(0), cost = D(0), km = D(0), tr = D(0), trips = 0, productionDays = 0;
  for (const d of days) {
    plan = plan.plus(d.plan); if (!d.future) planToDate = planToDate.plus(d.plan);
    act = act.plus(d.act); t = t.plus(d.t); tw = tw.plus(d.tWeighed); cost = cost.plus(d.purchaseCost); km = km.plus(d.km); tr = tr.plus(d.transportCost);
    trips += d.trips; if (D(d.act).gt(0)) productionDays++;
  }
  return {
    plan: plan.toString(), planToDate: planToDate.toString(), act: q(act), t: q(t), tWeighed: q(tw), purchaseCost: cost.toFixed(2), km: q(km), transportCost: tr.toFixed(2),
    trips, productionDays, realization: pct(act, planToDate),
    avgPrice: act.gt(0) ? cost.div(act).toFixed(2) : null, transportPerMp: act.gt(0) ? tr.div(act).toFixed(2) : null, weighedShare: pct(tw, t),
  };
}

/** Sumy 12 miesięcy roku (indeks 0 = styczeń). */
export function plannerMonths(days: readonly PlannerDay[], year: number): PlannerTotals[] {
  return Array.from({ length: 12 }, (_, m) => plannerTotals(days.filter(d => d.date.startsWith(`${year}-${String(m + 1).padStart(2, "0")}`))));
}

/** Kursy pogrupowane po kierowcy i pojeździe (widok „Kierowcy i kursy”). */
export function plannerDrivers(ops: readonly PlannerOp[]): Array<{ driver: string; registration: string; company: string | null; trips: number; qty: string; km: string; cost: string; perDay: Record<string, number> }> {
  const map = new Map<string, { driver: string; registration: string; company: string | null; trips: number; qty: Decimal; km: Decimal; cost: Decimal; perDay: Record<string, number> }>();
  for (const o of ops) for (const r of o.runs) {
    const k = `${r.driver ?? "—"}|${r.registration ?? "—"}`;
    const a = map.get(k) ?? { driver: r.driver ?? "—", registration: r.registration ?? "—", company: r.company, trips: 0, qty: D(0), km: D(0), cost: D(0), perDay: {} };
    a.trips++; a.qty = a.qty.plus(r.qty ?? 0); a.km = a.km.plus(r.km); a.cost = a.cost.plus(r.cost); a.perDay[o.date] = (a.perDay[o.date] ?? 0) + 1;
    map.set(k, a);
  }
  return [...map.values()].sort((a, b) => b.trips - a.trips || a.driver.localeCompare(b.driver, "pl"))
    .map(a => ({ driver: a.driver, registration: a.registration, company: a.company, trips: a.trips, qty: q(a.qty), km: q(a.km), cost: a.cost.toFixed(2), perDay: a.perDay }));
}
