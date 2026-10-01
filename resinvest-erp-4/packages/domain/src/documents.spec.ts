import { describe, expect, it } from "vitest";
import { planOperation, autoNumber, normalizeDocNumber, type PlanContext, type PlanMaterial } from "./documents.js";

const WH = "wh-1";
const mats: PlanMaterial[] = [
  { id: "drewno", name: "Drewno opałowe", active: true, category: "WOOD", stockUnit: "M3", allowedUnits: ["M3", "MP", "T"] },
  { id: "zrebka", name: "Zrębka leśna", active: true, category: "CHIPS", stockUnit: "MP", allowedUnits: ["MP", "M3", "T"] },
  { id: "pks", name: "PKS", active: true, category: "TONNAGE", stockUnit: "T", allowedUnits: ["T"] },
  { id: "stary", name: "Stary", active: false, category: "OTHER", stockUnit: "T", allowedUnits: ["T"] },
];
const ctx: PlanContext = {
  materials: new Map(mats.map(m => [m.id, m])), today: "2026-10-01",
  extraTypes: new Map([["hol", { id: "hol", name: "Holowanie", active: true, unit: null, defaultRate: null }], ["lad", { id: "lad", name: "Praca ładowarką", active: true, unit: "h", defaultRate: "160" }], ["off", { id: "off", name: "Stary rodzaj", active: false, unit: null, defaultRate: null }]]),
};
const base = { warehouseId: WH, date: "2026-09-23" };

describe("§22 TEST 4: zakup (PZ)", () => {
  it("20 m³ × 230 zł = 4 600 zł; ruch +20 m³; tonaż AUTO; numer automatyczny", () => {
    const r = planOperation({ ...base, type: "PURCHASE", partnerId: "p1", materialId: "drewno", qty: "20", unit: "M3", price: "230" }, ctx);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.plan.totals).toMatchObject({ purchaseCost: "4600.00", revenue: "0.00", result: "-4600.00" });
    expect(r.plan.movements).toEqual([{ warehouseId: WH, materialId: "drewno", qty: "20", kind: "PURCHASE", doc: 0, line: 0 }]);
    expect(r.plan.documents[0]).toMatchObject({ type: "PZ", main: true, lines: [{ qtyStock: "20", unitStock: "M3", weightSource: "COMPANY_RATE" }] });
    expect(r.plan.numbering).toEqual({ mode: "AUTO", number: null });
  });
  it("ilość w m³, cena za MP: 10 m³ = 40 MP × 57,50 zł = 2 300 zł", () => {
    const r = planOperation({ ...base, type: "PURCHASE", partnerId: "p1", materialId: "drewno", qty: "10", unit: "M3", price: "57,5", priceUnit: "MP" }, ctx);
    expect(r.ok && r.plan.totals.purchaseCost).toBe("2300.00");
  });
  it("numer ręczny: walidacja formatu; brak numeru przy trybie ręcznym = błąd", () => {
    expect(planOperation({ ...base, type: "PURCHASE", partnerId: "p1", materialId: "drewno", qty: "1", unit: "M3", price: "1", numbering: { mode: "MANUAL", number: " PZ/11 " } }, ctx)).toMatchObject({ ok: true, plan: { numbering: { mode: "MANUAL", number: "PZ/11" } } });
    expect(planOperation({ ...base, type: "PURCHASE", partnerId: "p1", materialId: "drewno", qty: "1", unit: "M3", price: "1", numbering: { mode: "MANUAL", number: "" } }, ctx)).toMatchObject({ ok: false, errors: [{ field: "numbering.number" }] });
    expect(planOperation({ ...base, type: "PURCHASE", partnerId: "p1", materialId: "drewno", qty: "1", unit: "M3", price: "1", numbering: { mode: "MANUAL", number: "<script>" } }, ctx)).toMatchObject({ ok: false });
  });
  it("błędy przy polach: brak dostawcy, ilość 0, jednostka niedozwolona, materiał nieaktywny, data z przyszłości", () => {
    const r = planOperation({ ...base, date: "2026-12-01", type: "PURCHASE", partnerId: "", materialId: "pks", qty: "5", unit: "MP", price: "10" }, ctx);
    expect(r.ok ? [] : r.errors.map(e => e.field)).toEqual(["date", "partnerId", "unit"]);
    const r2 = planOperation({ ...base, type: "PURCHASE", partnerId: "p", materialId: "stary", qty: "0", unit: "T", price: "1" }, ctx);
    expect(r2.ok ? [] : r2.errors.map(e => e.field)).toEqual(["materialId", "qty"]);
  });
});

describe("§8 sprzedaż z magazynu (WZ) — tonaż AUTO / RĘCZNY", () => {
  it("60 MP × 90 zł; AUTO 19,8 t; ruch −60 MP", () => {
    const r = planOperation({ ...base, type: "SALE", partnerId: "b", materialId: "zrebka", qty: "60", unit: "MP", price: "90" }, ctx);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.plan.totals.revenue).toBe("5400.00");
    expect(r.plan.movements[0]).toMatchObject({ qty: "-60", kind: "SALE" });
    expect(r.plan.summary[0]).toBe("60 MP | 19,8 t | AUTO");
  });
  it("RĘCZNY 20,35 t z wagi — zapisany na pozycji, nie nadpisany", () => {
    const r = planOperation({ ...base, type: "SALE", partnerId: "b", materialId: "zrebka", qty: "60", unit: "MP", price: "90", weightManual: "20,35" }, ctx);
    expect(r.ok && r.plan.documents[0]!.lines[0]).toMatchObject({ weightT: "20.35", weightSource: "MANUAL", autoWeightT: "19.8" });
    expect(r.ok && r.plan.summary[0]).toBe("60 MP | 20,35 t | RĘCZNY");
    expect(planOperation({ ...base, type: "SALE", partnerId: "b", materialId: "zrebka", qty: "60", unit: "MP", price: "90", weightManual: "0" }, ctx)).toMatchObject({ ok: false, errors: [{ field: "weightManual" }] });
  });
});

describe("§22 TEST 1 / §31.16: produkcja na magazynie (RW + PW)", () => {
  it("500 MP → zużycie 125 m³; koszt rąbania 500 × 10 = 5 000 zł", () => {
    const r = planOperation({ ...base, type: "PRODUCTION", rawMaterialId: "drewno", outMaterialId: "zrebka", outQty: "500", chipRate: "10" }, ctx);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.plan.movements.map(m => [m.materialId, m.qty, m.kind])).toEqual([["drewno", "-125", "CONSUMPTION"], ["zrebka", "500", "PRODUCTION"]]);
    expect(r.plan.documents.map(d => d.type)).toEqual(["RW", "PW"]);
    expect(r.plan.totals).toMatchObject({ chippingCost: "5000.00", result: "-5000.00" });
  });
  it("precyzja: 250,0001 MP → 62,500025 m³ (bez zaokrąglenia przed walidacją stanu)", () => {
    const r = planOperation({ ...base, type: "PRODUCTION", rawMaterialId: "drewno", outMaterialId: "zrebka", outQty: "250,0001" }, ctx);
    expect(r.ok && r.plan.production?.consumeQty).toBe("62.500025");
  });
  it("surowiec = produkt — błąd; przelicznik materiału ma pierwszeństwo przed firmowym", () => {
    expect(planOperation({ ...base, type: "PRODUCTION", rawMaterialId: "zrebka", outMaterialId: "zrebka", outQty: "1" }, ctx)).toMatchObject({ ok: false });
    const own = new Map(ctx.materials); own.set("drewno", { ...mats[0]!, mpPerM3: "3.8" });
    const r = planOperation({ ...base, type: "PRODUCTION", rawMaterialId: "drewno", outMaterialId: "zrebka", outQty: "38" }, { ...ctx, materials: own });
    expect(r.ok && r.plan.production?.consumeQty).toBe("10");
  });
});

describe("operacje dodatkowe — w każdej operacji", () => {
  it("koszt kwotą albo ilość × stawka domyślna; obniża wynik; nieaktywny rodzaj i brak kosztu — błąd", () => {
    const r = planOperation({ ...base, type: "SALE", partnerId: "b", materialId: "zrebka", qty: "10", unit: "MP", price: "90",
      extras: [{ typeId: "hol", cost: "500", vehicleId: "v1", description: "Holowanie" }, { typeId: "lad", qty: "2" }] }, ctx);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.plan.extras.map(x => x.cost)).toEqual(["500.00", "320.00"]);
    expect(r.plan.totals).toMatchObject({ additionalCost: "820.00", result: "80.00" });
    const bad = planOperation({ ...base, type: "SALE", partnerId: "b", materialId: "zrebka", qty: "1", unit: "MP", price: "1", extras: [{ typeId: "hol" }, { typeId: "off", cost: "1" }] }, ctx);
    expect(bad.ok ? [] : bad.errors.map(e => e.field)).toEqual(["extras.0.cost", "extras.1.typeId"]);
  });
});

describe("numeracja", () => {
  it("TYP/NNN/MM/RRRR; porównanie bez wielkości liter i spacji", () => {
    expect(autoNumber("PZ", 4, "2026-09-23")).toBe("PZ/004/09/2026");
    expect(normalizeDocNumber("wz / 27")).toBe(normalizeDocNumber("WZ/27"));
  });
});
