import { describe, expect, it } from "vitest";
import { checkReason, correctionNumber, describeSnapshot, diffSnapshots, effectiveMovements, netChange, postingOrder, reversalsOf, type LedgerRow, type OperationSnapshot, type SnapshotNames } from "./changes.js";

const row = (o: Partial<LedgerRow>): LedgerRow => ({ id: "m", warehouseId: "zab", materialId: "drw", qty: "100", kind: "PURCHASE", movementDate: "2026-09-28", documentId: "d", documentLineId: "l", reversalOfId: null, ...o });
const names: SnapshotNames = { material: id => ({ drw: "Drewno opałowe", zr: "Zrębka" }[id] ?? id), partner: id => ({ p1: "Nadl. Rudziniec", p2: "Nadl. Rybnik" }[id] ?? id), warehouse: id => id, extraType: id => id };
const snap = (o: Partial<OperationSnapshot> = {}): OperationSnapshot => ({
  date: "2026-09-28", documentDate: "2026-09-28", externalNumber: null, notes: null, targetWarehouseId: null,
  documents: [{ type: "PZ", partnerId: "p1", lines: [{ materialId: "drw", qtySource: "100", unitSource: "M3", qtyStock: "100", unitStock: "M3", weightT: null, weightSource: null, unitPrice: "120", priceUnit: "M3", value: "12000" }] }],
  totals: { purchaseCost: "12000", revenue: "0", chippingCost: "0", additionalCost: "0", transportCost: "0" }, transport: null, production: null, extras: [], ...o,
});

describe("zmiany dokumentów — reguły F5", () => {
  it("powód: wymagany, co najmniej 5 znaków; numer korekty KOR/NNN/MM/RRRR", () => {
    expect(checkReason("  ")).toMatch(/Podaj powód/);
    expect(checkReason("zła ilość z kwitu")).toBeNull();
    expect(checkReason("x".repeat(501))).toMatch(/maksymalnie 500/);
    expect(correctionNumber(7, "2026-10-01")).toBe("KOR/007/10/2026");
  });
  it("ruchy efektywne: bez odwracających i bez odwróconych — druga korekta odwraca tylko ruchy z pierwszej", () => {
    const rows = [row({ id: "a" }), row({ id: "r", kind: "REVERSAL", qty: "-100", reversalOfId: "a" }), row({ id: "b", qty: "90", movementDate: "2026-09-29" })];
    expect(effectiveMovements(rows).map(r => r.id)).toEqual(["b"]);
    expect(reversalsOf(rows)).toEqual([{ warehouseId: "zab", materialId: "drw", qty: "-90", kind: "REVERSAL", movementDate: "2026-09-29", documentId: "d", documentLineId: "l", reversalOfId: "b" }]);
  });
  it("zmiana netto i kolejność księgowania: przychody przed rozchodami", () => {
    expect(netChange([{ warehouseId: "zab", materialId: "drw", qty: "100" }, { warehouseId: "zab", materialId: "zr", qty: "-60" }],
      [{ warehouseId: "zab", materialId: "drw", qty: "90" }, { warehouseId: "zab", materialId: "zr", qty: "-60" }])).toEqual([{ warehouseId: "zab", materialId: "drw", qty: "-10" }]);
    expect(postingOrder([{ qty: "-100" }, { qty: "90" }, { qty: "-5" }, { qty: "1" }]).map(x => x.qty)).toEqual(["90", "1", "-100", "-5"]);
  });
  it("BYŁO / JEST: tylko zmienione pola, opis po polsku z jednostkami i kwotami", () => {
    const after = snap({ notes: "korekta z kwitu", documents: [{ type: "PZ", partnerId: "p2", lines: [{ materialId: "drw", qtySource: "90", unitSource: "M3", qtyStock: "90", unitStock: "M3", weightT: "31.5", weightSource: "MANUAL", unitPrice: "120", priceUnit: "M3", value: "10800" }] }],
      totals: { purchaseCost: "10800", revenue: "0", chippingCost: "0", additionalCost: "0", transportCost: "0" } });
    expect(diffSnapshots(snap(), after, names)).toEqual([
      { field: "Uwagi", before: null, after: "korekta z kwitu" },
      { field: "PZ — kontrahent", before: "Nadl. Rudziniec", after: "Nadl. Rybnik" },
      { field: "PZ — ilość", before: "100 m³", after: "90 m³" },
      { field: "PZ — tonaż", before: null, after: "31,5 t (RĘCZNY)" },
      { field: "PZ — wartość", before: "12000,00 zł", after: "10800,00 zł" },
      { field: "Wartość zakupu", before: "12000,00 zł", after: "10800,00 zł" },
    ]);
    expect(diffSnapshots(snap(), snap(), names)).toEqual([]);
  });
  it("opis migawki: produkcja, transport i dokument TR (bez pozycji) pominięty", () => {
    const d = describeSnapshot(snap({ documents: [...snap().documents, { type: "TR", partnerId: null, lines: [] }], transport: { mode: "OWN", place: "Nadl. Rudziniec", runs: 2, km: "80" },
      production: { consumeQty: "25", outQty: "100", diffReason: null, source: "FOREST", forestDistrict: "Rudziniec", forestry: "Kłodnica", waybill: null, investSite: null } }), names);
    expect(d.get("Transport")).toBe("Transport własny");
    expect(d.get("Transport — kursy")).toBe("2 · 80 km");
    expect(d.get("Produkcja — wynik")).toBe("100 MP");
    expect(d.get("Leśnictwo")).toBe("Kłodnica");
    expect([...d.keys()].some(k => k.startsWith("TR"))).toBe(false);
  });
});
