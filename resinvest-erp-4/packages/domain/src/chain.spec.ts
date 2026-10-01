import { describe, expect, it } from "vitest";
import { planOperation, type PlanContext, type PlanMaterial } from "./documents.js";

const WH = "wh-1";
const mats: PlanMaterial[] = [
  { id: "drewno", name: "Drewno opałowe", active: true, category: "WOOD", stockUnit: "M3", allowedUnits: ["M3", "MP", "T"] },
  { id: "zrebka", name: "Zrębka leśna", active: true, category: "CHIPS", stockUnit: "MP", allowedUnits: ["MP", "M3", "T"] },
  { id: "pks", name: "PKS", active: true, category: "TONNAGE", stockUnit: "T", allowedUnits: ["T"] },
];
const ctx: PlanContext = { materials: new Map(mats.map(m => [m.id, m])), extraTypes: new Map(), today: "2026-10-01" };
const buy = { warehouseId: WH, date: "2026-10-01", type: "PURCHASE" as const, partnerId: "nadl", materialId: "drewno", qty: "50", unit: "M3" as const, price: "120" };
const forest = { source: "FOREST" as const, forestDistrict: "Rudziniec", forestry: "Kłodnica", waybill: "KW 1/2026" };
const errs = (r: ReturnType<typeof planOperation>) => (r.ok ? [] : r.errors.map(e => e.field));

describe("zakup z produkcją (łańcuch 3.x)", () => {
  it("50 m³ drewna → cały zakup zużyty → 200 MP (1 m³ = 4 MP); dokumenty PZ, RW, PW; kolejność ruchów + − +", () => {
    const r = planOperation({ ...buy, production: { enabled: true, outMaterialId: "zrebka", chipRate: "10", ...forest } }, ctx);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.plan.documents.map(d => [d.type, d.main])).toEqual([["PZ", true], ["RW", false], ["PW", false]]);
    expect(r.plan.movements.map(m => [m.kind, m.qty, m.doc])).toEqual([["PURCHASE", "50", 0], ["CONSUMPTION", "-50", 1], ["PRODUCTION", "200", 2]]);
    expect(r.plan.production).toMatchObject({ mode: "FROM_PURCHASE", consumeQty: "50", outQty: "200", maxOut: "200", chippingCost: "2000.00", source: "FOREST", forestDistrict: "Rudziniec", forestry: "Kłodnica", waybill: "KW 1/2026", diffReason: null });
    expect(r.plan.totals).toMatchObject({ purchaseCost: "6000.00", chippingCost: "2000.00", result: "-8000.00" });
  });
  it("zużycie podane (30 m³) i wynik niższy (110 MP < 120) — wymaga przyczyny; wynik ponad zużycie — błąd", () => {
    expect(errs(planOperation({ ...buy, production: { enabled: true, outMaterialId: "zrebka", consumeQty: "30", outQty: "110", ...forest } }, ctx))).toEqual(["production.diffReason"]);
    const ok = planOperation({ ...buy, production: { enabled: true, outMaterialId: "zrebka", consumeQty: "30", outQty: "110", diffReason: "MOISTURE", ...forest } }, ctx);
    expect(ok.ok && ok.plan.production).toMatchObject({ consumeQty: "30", outQty: "110", maxOut: "120", diffReason: "MOISTURE" });
    const over = planOperation({ ...buy, production: { enabled: true, outMaterialId: "zrebka", outQty: "201", ...forest } }, ctx);
    expect(over.ok ? [] : over.errors).toEqual([{ field: "production.outQty", message: "Wynik produkcji 201 MP przekracza zużyty surowiec (200 MP)" }]);
  });
  it("sprzedaż wyniku: cała produkcja (puste), cena za t z tonażem AUTO (0,33 t/MP); WZ po PW; wynik operacji", () => {
    const r = planOperation({ ...buy, production: { enabled: true, outMaterialId: "zrebka", ...forest }, sale: { buyerId: "ec", price: "300", priceUnit: "T" } }, ctx);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.plan.documents.map(d => d.type)).toEqual(["PZ", "RW", "PW", "WZ"]);
    expect(r.plan.documents[3]).toMatchObject({ partnerId: "ec", main: false, lines: [{ qtyStock: "200", weightT: "66", weightSource: "COMPANY_RATE", value: "19800.00", priceUnit: "T" }] });
    expect(r.plan.movements.at(-1)).toMatchObject({ kind: "SALE", qty: "-200", doc: 3 });
    expect(r.plan.totals).toMatchObject({ revenue: "19800.00", result: "13800.00" });
  });
  it("sprzedaż ponad produkcję, sprzedaż bez produkcji, surowiec nie-drewno — błędy", () => {
    expect(errs(planOperation({ ...buy, production: { enabled: true, outMaterialId: "zrebka", ...forest }, sale: { buyerId: "ec", qty: "250", price: "1", priceUnit: "MP" } }, ctx))).toEqual(["sale.qty"]);
    expect(errs(planOperation({ ...buy, sale: { buyerId: "ec", price: "1", priceUnit: "MP" } }, ctx))).toEqual(["sale.buyerId"]);
    expect(errs(planOperation({ ...buy, materialId: "pks", unit: "T", production: { enabled: true, outMaterialId: "zrebka", source: "OTHER" } }, ctx))).toEqual(["production.enabled"]);
  });
  it("pochodzenie: las wymaga nadleśnictwa, leśnictwa i kwitu (albo kwitów w kursach); wycinka — miejsca", () => {
    expect(errs(planOperation({ ...buy, production: { enabled: true, outMaterialId: "zrebka", source: "FOREST" } }, ctx))).toEqual(["production.forestDistrict", "production.forestry", "production.waybill"]);
    expect(errs(planOperation({ ...buy, production: { enabled: true, outMaterialId: "zrebka", source: "INVESTMENT" } }, ctx))).toEqual(["production.investSite"]);
    // kursy transportu: kwit przy każdym kursie zamiast przy produkcji; m³ z kwitów ≤ zużyte drewno
    const fleet = { vehicles: new Map([["v", { id: "v", registration: "A 1", status: "ACTIVE" as const, warehouseId: WH, defaultDriverId: "d", ownership: "OWN" as const }]]),
      drivers: new Map([["d", { id: "d", name: "D", active: true }]]), companies: new Map() };
    const t = (runs: object[]) => planOperation({ ...buy, production: { enabled: true, outMaterialId: "zrebka", source: "FOREST", forestDistrict: "R", forestry: "K" },
      transport: { mode: "OWN", place: "Las", runs: runs as never } }, { ...ctx, fleet });
    expect(errs(t([{ ownership: "OWN", vehicleId: "v", km: "20" }]))).toEqual(["transport.runs.0.waybillNo"]);
    // 60 m³ z kwitu = 240 MP: więcej niż wyprodukowane 200 MP i więcej niż zużyte 50 m³ — dwa osobne błędy
    const over = t([{ ownership: "OWN", vehicleId: "v", km: "20", waybillNo: "K1", waybillM3: "60" }]);
    expect(over.ok ? [] : over.errors.map(e => e.message)).toEqual([
      "Suma kursów 240 MP przekracza ilość operacji 200 MP (o 40 MP).", "Suma m³ z kwitów 60 m³ przekracza drewno zużyte w produkcji 50 m³."]);
    const ok = t([{ ownership: "OWN", vehicleId: "v", km: "20", waybillNo: "K1", waybillM3: "25" }, { ownership: "OWN", vehicleId: "v", km: "20", waybillNo: "K2", waybillM3: "25" }]);
    expect(ok.ok && ok.plan.transport!.runs.map(r => r.qty)).toEqual(["100", "100"]);   // m³ × 4 = MP; przewożony towar to zrębka z produkcji
  });
});

describe("sprzedaż bezpośrednia (produkcja w lesie → odbiorca)", () => {
  const direct = { warehouseId: WH, date: "2026-10-01", type: "DIRECT_SALE" as const, rawMaterialId: "drewno", rawCost: "3000",
    production: { outMaterialId: "zrebka", outQty: "120", chipRate: "10", ...forest }, sale: { buyerId: "ec", qty: "100", price: "90", priceUnit: "MP" as const } };
  it("PW 120 MP (surowiec nie ze stanu), WZ 100 MP (dokument główny), reszta 20 MP na stan — ostrzeżenie; koszt surowca", () => {
    const r = planOperation(direct, ctx);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.plan.documents.map(d => [d.type, d.main])).toEqual([["PW", false], ["WZ", true]]);
    expect(r.plan.movements.map(m => [m.kind, m.qty])).toEqual([["PRODUCTION", "120"], ["SALE", "-100"]]);
    expect(r.plan.production).toMatchObject({ mode: "DIRECT", consumeQty: "30", outQty: "120", chippingCost: "1200.00" });
    expect(r.plan.totals).toMatchObject({ purchaseCost: "3000.00", revenue: "9000.00", chippingCost: "1200.00", result: "4800.00" });
    expect(r.plan.warnings).toEqual(["Nie cała produkcja jest sprzedana — pozostałe 20 MP zostanie przyjęte na stan magazynu."]);
    expect(r.plan.summary[0]).toBe("Produkcja w lesie 120 MP (surowiec nie ze stanu: ok. 30 m³)");
  });
  it("wymagane: ilość produkcji, odbiorca, jednostka ceny; numer ręczny dotyczy WZ", () => {
    expect(errs(planOperation({ ...direct, production: { ...direct.production, outQty: "" }, sale: { buyerId: "", price: "1", priceUnit: null } }, ctx)))
      .toEqual(["production.outQty", "sale.buyerId", "sale.priceUnit"]);
    expect(planOperation({ ...direct, numbering: { mode: "MANUAL", number: "WZ 9/2026" } }, ctx)).toMatchObject({ ok: true, plan: { numbering: { mode: "MANUAL", number: "WZ 9/2026" } } });
  });
});
