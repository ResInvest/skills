import Decimal from "decimal.js";
import { DEFAULT_COMPANY_RATES, QTY_DP, UNIT_LABEL, type CompanyRates, type Unit } from "./units.js";
import { parseNumber } from "./number.js";
import { formatQty } from "./stock.js";

/**
 * Transport operacji (port reguł z ResInvest ERP 3.x): brak / własny / zewnętrzny / mieszany (własny + zewnętrzny) /
 * kolej / „zapewnia dostawca” (koszt w cenie zakupu). Kursy z pojazdem i kierowcą z floty (własny) albo nr rej. auta
 * przewoźnika (zewnętrzny), km × stawka albo fracht z faktury, ilość i waga kursu, kwity wywozowe (m³ × 4 = MP na aucie).
 * Transport NIE zmienia stanu magazynowego — tworzy dokument TR z kosztem.
 */

export type TransportMode = "NONE" | "OWN" | "EXTERNAL" | "MIXED" | "TRAIN" | "SUPPLIER";
export const TRANSPORT_MODE_LABEL: Record<TransportMode, string> = {
  NONE: "Brak transportu", OWN: "Transport własny", EXTERNAL: "Transport zewnętrzny", MIXED: "Transport własny + zewnętrzny",
  TRAIN: "Kolej", SUPPLIER: "Zapewnia dostawca (w cenie zakupu)",
};
/** Tryby, które tworzą dokument TR z kosztem. */
export const TR_MODES: readonly TransportMode[] = ["OWN", "EXTERNAL", "MIXED", "TRAIN"];
export const MAX_RUNS = 50;
export const MAX_WAGONS = 60;
export const KM_RATE_DEFAULT = "5";

export interface TransportRunInput {
  ownership: "OWN" | "EXTERNAL";
  vehicleId?: string | null; driverId?: string | null;
  registration?: string | null; driverName?: string | null;
  km?: unknown; rate?: unknown; freight?: unknown; qty?: unknown; weightT?: unknown;
  waybillNo?: string | null; waybillM3?: unknown;
}
export interface TrainInput { trainNo?: string | null; carrier?: string | null; wagonTons?: unknown[]; priceUnit?: Unit | null; price?: unknown }
export interface TransportInput {
  mode: TransportMode; place?: string | null;
  /** Firma przewozowa (kartoteka firm zewnętrznych) — transport zewnętrzny i mieszany. */
  externalCompanyId?: string | null;
  /** Fracht wliczony w cenę towaru — kursy zewnętrzne bez kosztu. */
  includedInPrice?: boolean;
  runs?: TransportRunInput[];
  train?: TrainInput | null;
}

export interface FleetVehicle { id: string; registration: string; status: "ACTIVE" | "SERVICE" | "RETIRED"; warehouseId: string | null; defaultDriverId: string | null; ownership: "OWN" | "EXTERNAL" }
export interface TransportFleet {
  vehicles: ReadonlyMap<string, FleetVehicle>;
  drivers: ReadonlyMap<string, { id: string; name: string; active: boolean }>;
  companies: ReadonlyMap<string, { id: string; name: string; active: boolean }>;
  warehouseNames?: ReadonlyMap<string, string>;
}
export interface TransportContext {
  warehouseId: string;
  /** Kartoteka floty — gdy podana, pojazdy, kierowcy i firmy są sprawdzane (API zawsze ją podaje). */
  fleet?: TransportFleet;
  rates?: CompanyRates;
  kmRateDefault?: Decimal.Value;
  /** Produkcja leśna bez kwitu przy produkcji: każdy kurs wymaga numeru kwitu wywozowego. */
  requireWaybill?: boolean;
  /** Drewno zużyte w produkcji (m³) — suma m³ z kwitów nie może go przekroczyć. */
  consumedM3?: string | null;
  /** Rodzaj operacji — „zapewnia dostawca” tylko przy zakupie. */
  purchase: boolean;
}
/** Towar przewożony w operacji (jednostka magazynowa). */
export interface Shipped { materialId: string | null; qty: string; unit: Unit | null; weightT: string | null }

export interface PlannedRun {
  runNo: number; ownership: "OWN" | "EXTERNAL";
  vehicleId: string | null; driverId: string | null; externalCompanyId: string | null;
  registration: string | null; driverName: string | null;
  km: string; ratePerKm: string | null; freight: string | null; cost: string; costBasis: "KM" | "FREIGHT" | "INCLUDED" | "TRAIN";
  qty: string | null; unit: Unit | null; weightT: string | null; waybillNo: string | null; waybillM3: string | null;
  train: { trainNo: string | null; carrier: string | null; wagonTons: string[]; totalT: string; priceUnit: Unit; price: string; basisQty: string } | null;
}
export interface PlannedTransport {
  mode: TransportMode; place: string | null; externalCompanyId: string | null; includedInPrice: boolean;
  runs: PlannedRun[]; totalQty: string; totalWeightT: string | null; weighedRuns: number; km: string; cost: string;
  waybills: string[]; totalWaybillM3: string | null;
  /** Ostrzeżenia (nie blokują zapisu), np. brak wagi części kursów, nierozwieziona ilość. */
  warnings: string[];
}
export type ErrFn = (field: string, message: string) => void;

const D = (v: Decimal.Value) => new Decimal(v);
const money = (v: Decimal.Value) => D(v).toDecimalPlaces(2).toFixed(2);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** Plan transportu albo null (gdy wejście jest niepoprawne na poziomie trybu). Błędy przy polach przez `err`. */
export function planTransport(input: TransportInput | null | undefined, shipped: Shipped, ctx: TransportContext, err: ErrFn): PlannedTransport | null {
  const rates = ctx.rates ?? DEFAULT_COMPANY_RATES;
  const mode: TransportMode = input?.mode ?? "NONE";
  if (!(mode in TRANSPORT_MODE_LABEL)) { err("transport.mode", "Nieznany tryb transportu"); return null; }
  const place = str(input?.place).slice(0, 250) || null;
  const empty: PlannedTransport = { mode, place, externalCompanyId: null, includedInPrice: false, runs: [], totalQty: "0", totalWeightT: null, weighedRuns: 0, km: "0", cost: "0.00", waybills: [], totalWaybillM3: null, warnings: [] };
  if (mode === "NONE") return empty;
  if (!place) err("transport.place", "Podaj miejsce załadunku / dostawy");
  if (mode === "SUPPLIER") {
    if (!ctx.purchase) err("transport.mode", "Transport zapewniany przez dostawcę dotyczy tylko zakupu");
    return empty;
  }
  const num = (field: string, v: unknown, o: { positive?: boolean; label: string; optional?: boolean }): Decimal | null => {
    const p = parseNumber(v);
    if (!p.ok) { if (!(p.empty && o.optional)) err(field, p.empty ? `Podaj: ${o.label}` : p.error); return null; }
    const d = D(p.value);
    if (o.positive ? d.lte(0) : d.lt(0)) { err(field, `${o.label}: ${o.positive ? "liczba większa od 0" : "liczba nie mniejsza od 0"}`); return null; }
    return d;
  };
  const kmRate = D(ctx.kmRateDefault ?? KM_RATE_DEFAULT);
  const U = shipped.unit ? UNIT_LABEL[shipped.unit] : "";

  if (mode === "TRAIN") {
    const T = input?.train ?? {};
    const tons = Array.isArray(T.wagonTons) ? T.wagonTons : [];
    if (!tons.length) err("transport.train.wagonTons", "Podaj tonaż wagonów (co najmniej jeden wagon)");
    if (tons.length > MAX_WAGONS) err("transport.train.wagonTons", `Maksymalnie ${MAX_WAGONS} wagonów w jednym składzie`);
    const list = tons.slice(0, MAX_WAGONS).map((t, i) => num(`transport.train.wagonTons.${i}`, t, { positive: true, label: `tonaż wagonu ${i + 1}` }));
    const priceUnit: Unit | null = T.priceUnit && ["T", "MP", "M3"].includes(T.priceUnit) ? T.priceUnit : null;
    if (!priceUnit) err("transport.train.priceUnit", "Wybierz jednostkę ceny frachtu (t, MP albo m³)");
    const price = num("transport.train.price", T.price, { label: "cena frachtu" });
    const totalT = list.reduce<Decimal>((a, t) => a.plus(t ?? 0), D(0));
    const totalMP = totalT.div(rates.tonPerMp).toDecimalPlaces(QTY_DP);
    const basis = priceUnit === "T" ? totalT : priceUnit === "MP" ? totalMP : totalMP.div(rates.mpPerM3).toDecimalPlaces(QTY_DP);
    const cost = price ? money(basis.mul(price)) : "0.00";
    const warnings: string[] = [];
    if (shipped.weightT && D(shipped.weightT).gt(0) && totalT.gt(0) && totalT.minus(shipped.weightT).abs().div(shipped.weightT).gt(0.05))
      warnings.push(`Tonaż składu ${formatQty(totalT)} t różni się od masy ładunku ${formatQty(shipped.weightT)} t. Transport nie zmienia stanu magazynowego.`);
    return { ...empty, runs: [{
      runNo: 1, ownership: "EXTERNAL", vehicleId: null, driverId: null, externalCompanyId: null, registration: null, driverName: null,
      km: "0", ratePerKm: null, freight: price ? price.toFixed(2) : null, cost, costBasis: "TRAIN", qty: null, unit: null, weightT: totalT.toString(), waybillNo: null, waybillM3: null,
      train: { trainNo: str(T.trainNo).slice(0, 40) || null, carrier: str(T.carrier).slice(0, 120) || null, wagonTons: list.map(t => (t ?? D(0)).toString()), totalT: totalT.toString(), priceUnit: priceUnit ?? "T", price: price ? price.toFixed(2) : "0", basisQty: basis.toString() },
    }], totalWeightT: totalT.toString(), weighedRuns: 1, cost, warnings };
  }

  // kursy samochodowe: własne, zewnętrzne albo mieszane
  const runsIn = Array.isArray(input?.runs) ? input.runs : [];
  if (!runsIn.length) err("transport.runs", "Dodaj co najmniej jeden kurs");
  if (runsIn.length > MAX_RUNS) err("transport.runs", `Maksymalnie ${MAX_RUNS} kursów w jednej operacji`);
  const hasOwn = runsIn.some(r => r.ownership === "OWN"), hasExt = runsIn.some(r => r.ownership === "EXTERNAL");
  if (mode === "OWN" && hasExt) err("transport.mode", "Transport własny — wszystkie kursy pojazdami z floty; dla przewoźnika wybierz „własny + zewnętrzny”");
  if (mode === "EXTERNAL" && hasOwn) err("transport.mode", "Transport zewnętrzny — kursy przewoźnika; dla floty wybierz „własny + zewnętrzny”");
  if (mode === "MIXED" && runsIn.length && !(hasOwn && hasExt)) err("transport.mode", "Transport mieszany wymaga kursów własnych i zewnętrznych");
  const included = !!input?.includedInPrice;
  let companyId: string | null = null;
  if (hasExt) {
    companyId = str(input?.externalCompanyId) || null;
    if (!companyId) err("transport.externalCompanyId", "Wybierz firmę przewozową");
    else if (ctx.fleet) {
      const c = ctx.fleet.companies.get(companyId);
      if (!c) err("transport.externalCompanyId", "Nieznana firma przewozowa");
      else if (!c.active) err("transport.externalCompanyId", `Firma „${c.name}” jest nieaktywna`);
    }
  }
  const runs: PlannedRun[] = [];
  runsIn.slice(0, MAX_RUNS).forEach((r, i) => {
    const K = (f: string) => `transport.runs.${i}.${f}`;
    const own = r.ownership === "OWN";
    if (r.ownership !== "OWN" && r.ownership !== "EXTERNAL") { err(K("ownership"), "Wybierz: kurs własny albo zewnętrzny"); return; }
    let vehicleId: string | null = null, driverId: string | null = null, registration: string | null;
    if (own) {
      vehicleId = str(r.vehicleId) || null;
      const v = vehicleId && ctx.fleet ? ctx.fleet.vehicles.get(vehicleId) : null;
      if (!vehicleId) err(K("vehicleId"), "Wybierz pojazd z floty");
      else if (ctx.fleet && !v) err(K("vehicleId"), "Nieznany pojazd");
      else if (v && v.status !== "ACTIVE") err(K("vehicleId"), `Pojazd ${v.registration} ma status „${v.status === "SERVICE" ? "w serwisie" : "wycofany"}” — wybierz aktywny`);
      else if (v && v.warehouseId && v.warehouseId !== ctx.warehouseId) err(K("vehicleId"), `Pojazd ${v.registration} jest przypisany do magazynu ${ctx.fleet?.warehouseNames?.get(v.warehouseId) ?? "innego"}`);
      registration = v?.registration ?? null;
      driverId = str(r.driverId) || v?.defaultDriverId || null;
      const d = driverId && ctx.fleet ? ctx.fleet.drivers.get(driverId) : null;
      if (!driverId) err(K("driverId"), "Pojazd nie ma kierowcy domyślnego — wybierz kierowcę");
      else if (ctx.fleet && !d) err(K("driverId"), "Nieznany kierowca");
      else if (d && !d.active) err(K("driverId"), `Kierowca ${d.name} jest nieaktywny`);
    } else {
      registration = str(r.registration).replace(/\s+/g, " ").toUpperCase().slice(0, 20) || null;
      if (!registration) err(K("registration"), "Podaj numer rejestracyjny pojazdu przewoźnika");
    }
    const freight = own ? null : num(K("freight"), r.freight, { optional: true, label: "fracht kursu" });
    const needKm = own || (!included && freight === null);
    const km = str(r.km) === "" && !needKm ? D(0) : num(K("km"), r.km, { positive: own, label: own ? "liczba km" : "liczba km (albo fracht kursu)" });
    const rate = str(r.rate) === "" ? kmRate : num(K("rate"), r.rate, { positive: true, label: "stawka za km" });
    const wbNo = str(r.waybillNo).slice(0, 60) || null;
    if (ctx.requireWaybill && !wbNo) err(K("waybillNo"), `Podaj numer kwitu wywozowego (kurs ${i + 1})`);
    const wbM3 = num(K("waybillM3"), r.waybillM3, { optional: true, positive: true, label: "ilość m³ z kwitu" });
    let qty: Decimal | null = null;
    if (str(r.qty) !== "") qty = num(K("qty"), r.qty, { positive: true, label: "ilość w kursie" });
    else if (wbM3 && shipped.unit === "MP") qty = wbM3.mul(rates.mpPerM3).toDecimalPlaces(QTY_DP);       // m³ z kwitu × 4 = MP na aucie
    else if (runsIn.length > 1) err(K("qty"), `Podaj ilość przewożoną w kursie ${i + 1}${U ? ` (${U})` : ""}`);
    else qty = shipped.qty && D(shipped.qty).gt(0) ? D(shipped.qty) : null;
    const w = num(K("weightT"), r.weightT, { optional: true, positive: true, label: "waga rzeczywista" });
    const ext = !own;
    const cost = ext && included ? D(0) : freight ?? (km && rate ? km.mul(rate) : D(0));
    runs.push({
      runNo: i + 1, ownership: own ? "OWN" : "EXTERNAL", vehicleId, driverId, externalCompanyId: ext ? companyId : null, registration,
      driverName: ext ? (str(r.driverName).slice(0, 120) || null) : null,
      km: (km ?? D(0)).toString(), ratePerKm: freight === null && !(ext && included) && rate ? rate.toFixed(2) : null, freight: freight ? freight.toFixed(2) : null,
      cost: money(cost), costBasis: ext && included ? "INCLUDED" : freight !== null ? "FREIGHT" : "KM",
      qty: qty ? qty.toString() : null, unit: qty ? shipped.unit : null, weightT: w ? w.toString() : null, waybillNo: wbNo, waybillM3: wbM3 ? wbM3.toString() : null, train: null,
    });
  });
  const totalQty = runs.reduce((a, r) => a.plus(r.qty ?? 0), D(0));
  const weighed = runs.filter(r => r.weightT !== null);
  const withM3 = runs.filter(r => r.waybillM3 !== null);
  const totalM3 = withM3.length ? withM3.reduce((a, r) => a.plus(r.waybillM3!), D(0)) : null;
  const warnings: string[] = [];
  if (shipped.qty && D(shipped.qty).gt(0)) {
    if (totalQty.gt(shipped.qty)) err("transport.runs", `Suma kursów ${formatQty(totalQty)} ${U} przekracza ilość operacji ${formatQty(shipped.qty)} ${U} (o ${formatQty(totalQty.minus(shipped.qty))} ${U}).`);
    else if (runs.length > 1 && totalQty.lt(shipped.qty)) warnings.push(`Suma kursów ${formatQty(totalQty)} ${U} — do rozwiezienia pozostało ${formatQty(D(shipped.qty).minus(totalQty))} ${U} z ${formatQty(shipped.qty)} ${U}. Transport nie zmienia stanu magazynowego.`);
  }
  if (ctx.consumedM3 && totalM3 && totalM3.gt(ctx.consumedM3)) err("transport.runs", `Suma m³ z kwitów ${formatQty(totalM3)} m³ przekracza drewno zużyte w produkcji ${formatQty(ctx.consumedM3)} m³.`);
  if (runs.length && weighed.length < runs.length) warnings.push(`Brak wagi rzeczywistej dla ${runs.length - weighed.length} z ${runs.length} kursów.`);
  return {
    mode, place, externalCompanyId: companyId, includedInPrice: included, runs,
    totalQty: totalQty.toString(), totalWeightT: weighed.length ? weighed.reduce((a, r) => a.plus(r.weightT!), D(0)).toString() : null, weighedRuns: weighed.length,
    km: runs.reduce((a, r) => a.plus(r.km), D(0)).toString(), cost: money(runs.reduce((a, r) => a.plus(r.cost), D(0))),
    waybills: runs.map(r => r.waybillNo).filter((x): x is string => !!x), totalWaybillM3: totalM3 ? totalM3.toString() : null, warnings,
  };
}
