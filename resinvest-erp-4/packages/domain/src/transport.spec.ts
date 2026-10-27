import { describe, expect, it } from "vitest";
import { planOperation, type PlanContext, type PlanMaterial } from "./documents.js";
import { planTransport, type TransportFleet } from "./transport.js";

const WH = "wh-1";
const mats: PlanMaterial[] = [
  { id: "zrebka", name: "Zrębka leśna", active: true, category: "CHIPS", stockUnit: "MP", allowedUnits: ["MP", "M3", "T"] },
  { id: "drewno", name: "Drewno", active: true, category: "WOOD", stockUnit: "M3", allowedUnits: ["M3", "MP", "T"] },
];
const fleet: TransportFleet = {
  vehicles: new Map([
    ["v1", { id: "v1", registration: "SGL 4T821", status: "ACTIVE", warehouseId: WH, defaultDriverId: "d1", ownership: "OWN" }],
    ["v2", { id: "v2", registration: "SZA 19052", status: "SERVICE", warehouseId: WH, defaultDriverId: null, ownership: "OWN" }],
    ["v3", { id: "v3", registration: "ESI 5H220", status: "ACTIVE", warehouseId: "wh-2", defaultDriverId: "d1", ownership: "OWN" }],
    ["v4", { id: "v4", registration: "SLU 9A145", status: "ACTIVE", warehouseId: null, defaultDriverId: null, ownership: "OWN" }],
  ]),
  drivers: new Map([["d1", { id: "d1", name: "Jan Nowak", active: true }], ["d2", { id: "d2", name: "Piotr Lis", active: false }]]),
  companies: new Map([["c1", { id: "c1", name: "Trans-Bud", active: true }]]),
  warehouseNames: new Map([["wh-2", "RiC Brąszewice"]]),
};
const ctx: PlanContext = { materials: new Map(mats.map(m => [m.id, m])), extraTypes: new Map(), today: "2026-10-01", fleet };
const sale = { warehouseId: WH, date: "2026-10-01", type: "SALE" as const, partnerId: "b1", materialId: "zrebka", qty: "120", unit: "MP" as const, price: "90" };
const errs = (r: ReturnType<typeof planOperation>) => (r.ok ? [] : r.errors.map(e => e.field));

describe("transport (§ transport 3.x)", () => {
  it("własny: 2 kursy km × stawka (domyślnie 5 zł/km), kierowca domyślny pojazdu, dokument TR, koszt w wyniku", () => {
    const r = planOperation({ ...sale, transport: { mode: "OWN", place: "EC Zabrze", runs: [
      { ownership: "OWN", vehicleId: "v1", km: "42", qty: "60", weightT: "19,8" }, { ownership: "OWN", vehicleId: "v4", driverId: "d1", km: "42", rate: "6", qty: "60" },
    ] } }, ctx);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.plan.transport).toMatchObject({ mode: "OWN", km: "84", cost: "462.00", totalQty: "120", totalWeightT: "19.8", weighedRuns: 1 });
    expect(r.plan.transport!.runs[0]).toMatchObject({ driverId: "d1", registration: "SGL 4T821", ratePerKm: "5.00", cost: "210.00", costBasis: "KM" });
    expect(r.plan.documents.map(d => d.type)).toEqual(["WZ", "TR"]);
    expect(r.plan.totals).toMatchObject({ revenue: "10800.00", transportCost: "462.00", result: "10338.00" });
    expect(r.plan.warnings).toEqual(["Brak wagi rzeczywistej dla 1 z 2 kursów."]);
  });
  it("jeden kurs bez ilości = cała ilość operacji; pojazd w serwisie, z innego magazynu, kierowca nieaktywny — błędy przy kursach", () => {
    const one = planOperation({ ...sale, transport: { mode: "OWN", place: "X", runs: [{ ownership: "OWN", vehicleId: "v1", km: "10" }] } }, ctx);
    expect(one.ok && one.plan.transport!.runs[0]!.qty).toBe("120");
    const r = planOperation({ ...sale, transport: { mode: "OWN", place: "X", runs: [
      { ownership: "OWN", vehicleId: "v2", km: "1", qty: "1" }, { ownership: "OWN", vehicleId: "v3", km: "1", qty: "1" }, { ownership: "OWN", vehicleId: "v4", driverId: "d2", km: "0", qty: "1" },
    ] } }, ctx);
    expect(r.ok ? [] : r.errors).toEqual(expect.arrayContaining([
      { field: "transport.runs.0.vehicleId", message: expect.stringContaining("w serwisie") },
      { field: "transport.runs.0.driverId", message: expect.stringContaining("kierowcy domyślnego") },
      { field: "transport.runs.1.vehicleId", message: expect.stringContaining("RiC Brąszewice") },
      { field: "transport.runs.2.driverId", message: expect.stringContaining("nieaktywny") },
      { field: "transport.runs.2.km", message: expect.stringContaining("większa od 0") },
    ]));
  });
  it("zewnętrzny: firma wymagana, fracht kursu albo km × stawka, „wliczony w cenę” = 0 zł; nr rej. normalizowany", () => {
    expect(errs(planOperation({ ...sale, transport: { mode: "EXTERNAL", place: "X", runs: [{ ownership: "EXTERNAL", registration: "", qty: "120" }] } }, ctx)))
      .toEqual(["transport.externalCompanyId", "transport.runs.0.registration", "transport.runs.0.km"]);
    const r = planOperation({ ...sale, transport: { mode: "EXTERNAL", place: "X", externalCompanyId: "c1", runs: [
      { ownership: "EXTERNAL", registration: "wgm  7712c", freight: "800", qty: "60" }, { ownership: "EXTERNAL", registration: "WGM 1180K", km: "50", qty: "60" },
    ] } }, ctx);
    expect(r.ok && r.plan.transport!.runs.map(x => [x.registration, x.costBasis, x.cost])).toEqual([["WGM 7712C", "FREIGHT", "800.00"], ["WGM 1180K", "KM", "250.00"]]);
    const inc = planOperation({ ...sale, transport: { mode: "EXTERNAL", place: "X", externalCompanyId: "c1", includedInPrice: true, runs: [{ ownership: "EXTERNAL", registration: "WGM 1" }] } }, ctx);
    expect(inc.ok && inc.plan.transport).toMatchObject({ cost: "0.00", runs: [{ costBasis: "INCLUDED", cost: "0.00" }] });
  });
  it("mieszany wymaga kursów obu rodzajów; tryb własny nie przyjmie kursu przewoźnika", () => {
    expect(errs(planOperation({ ...sale, transport: { mode: "MIXED", place: "X", runs: [{ ownership: "OWN", vehicleId: "v1", km: "5" }] } }, ctx))).toContain("transport.mode");
    expect(errs(planOperation({ ...sale, transport: { mode: "OWN", place: "X", runs: [{ ownership: "EXTERNAL", registration: "A", km: "5" }] } }, ctx))).toContain("transport.mode");
    const m = planOperation({ ...sale, transport: { mode: "MIXED", place: "X", externalCompanyId: "c1", runs: [
      { ownership: "OWN", vehicleId: "v1", km: "10", qty: "60" }, { ownership: "EXTERNAL", registration: "WGM 1", freight: "300", qty: "60" }] } }, ctx);
    expect(m.ok && m.plan.transport!.cost).toBe("350.00");
  });
  it("suma kursów ponad ilość operacji — błąd; mniej przy wielu kursach — ostrzeżenie; przy wielu kursach ilość wymagana", () => {
    const over = planOperation({ ...sale, transport: { mode: "OWN", place: "X", runs: [{ ownership: "OWN", vehicleId: "v1", km: "1", qty: "100" }, { ownership: "OWN", vehicleId: "v1", km: "1", qty: "40" }] } }, ctx);
    expect(over.ok ? [] : over.errors).toEqual([{ field: "transport.runs", message: "Suma kursów 140 MP przekracza ilość operacji 120 MP (o 20 MP)." }]);
    const less = planOperation({ ...sale, transport: { mode: "OWN", place: "X", runs: [{ ownership: "OWN", vehicleId: "v1", km: "1", qty: "60", weightT: "20" }, { ownership: "OWN", vehicleId: "v1", km: "1", qty: "40", weightT: "13" }] } }, ctx);
    expect(less.ok && less.plan.warnings[0]).toMatch(/pozostało 20 MP z/);
    expect(errs(planOperation({ ...sale, transport: { mode: "OWN", place: "X", runs: [{ ownership: "OWN", vehicleId: "v1", km: "1" }, { ownership: "OWN", vehicleId: "v1", km: "1" }] } }, ctx)))
      .toEqual(["transport.runs.0.qty", "transport.runs.1.qty"]);
  });
  it("kwity: m³ z kwitu × 4 = MP na aucie; wymagany numer kwitu; suma m³ ≤ drewno zużyte", () => {
    const err: Array<[string, string]> = [];
    const t = planTransport({ mode: "OWN", place: "Nadl. Rudziniec", runs: [{ ownership: "OWN", vehicleId: "v1", km: "30", waybillM3: "15" }, { ownership: "OWN", vehicleId: "v1", km: "30", waybillNo: "K/2", waybillM3: "20" }] },
      { materialId: "zrebka", qty: "140", unit: "MP", weightT: null }, { warehouseId: WH, fleet, requireWaybill: true, consumedM3: "30", purchase: true }, (f, m) => err.push([f, m]));
    expect(t!.runs.map(r => r.qty)).toEqual(["60", "80"]);
    expect(err).toEqual([["transport.runs.0.waybillNo", "Podaj numer kwitu wywozowego (kurs 1)"], ["transport.runs", "Suma m³ z kwitów 35 m³ przekracza drewno zużyte w produkcji 30 m³."]]);
  });
  it("kolej: wagony × tonaż, cena za t / MP / m³ (0,33 t/MP, 1 m³ = 4 MP)", () => {
    const tr = (priceUnit: "T" | "MP" | "M3", price: string) => planOperation({ ...sale, transport: { mode: "TRAIN", place: "Bocznica Zabrze", train: { trainNo: "PKP 4411", carrier: "PKP Cargo", wagonTons: ["33", "33"], priceUnit, price } } }, ctx);
    const t = tr("T", "25");
    expect(t.ok && t.plan.transport).toMatchObject({ cost: "1650.00", totalWeightT: "66", runs: [{ costBasis: "TRAIN", train: { totalT: "66", basisQty: "66" } }] });
    expect(t.ok && t.plan.documents.map(d => d.type)).toEqual(["WZ", "TR"]);
    expect(tr("MP", "10").ok && (tr("MP", "10") as { plan: { transport: { cost: string } } }).plan.transport.cost).toBe("2000.00");
    expect((tr("M3", "40") as { plan: { transport: { cost: string } } }).plan.transport.cost).toBe("2000.00");
    expect(errs(planOperation({ ...sale, transport: { mode: "TRAIN", place: "X", train: { wagonTons: ["0"], priceUnit: null, price: "" } } }, ctx)))
      .toEqual(["transport.train.wagonTons.0", "transport.train.priceUnit", "transport.train.price"]);
  });
  it("zapewnia dostawca — tylko zakup, bez TR i kosztu; brak miejsca — błąd; produkcja na magazynie — bez transportu", () => {
    const p = planOperation({ warehouseId: WH, date: "2026-10-01", type: "PURCHASE", partnerId: "s", materialId: "drewno", qty: "10", unit: "M3", price: "100", transport: { mode: "SUPPLIER", place: "Las" } }, ctx);
    expect(p.ok && [p.plan.documents.map(d => d.type), p.plan.totals.transportCost]).toEqual([["PZ"], "0.00"]);
    expect(errs(planOperation({ ...sale, transport: { mode: "SUPPLIER", place: "" } }, ctx))).toEqual(["transport.place", "transport.mode"]);
    expect(errs(planOperation({ warehouseId: WH, date: "2026-10-01", type: "PRODUCTION", rawMaterialId: "drewno", outMaterialId: "zrebka", outQty: "40", transport: { mode: "OWN", place: "X", runs: [] } }, ctx))).toContain("transport.mode");
    expect(planOperation({ ...sale, transport: { mode: "NONE" } }, ctx)).toMatchObject({ ok: true, plan: { transport: { mode: "NONE", cost: "0.00" }, documents: [{ type: "WZ" }] } });
  });
});
