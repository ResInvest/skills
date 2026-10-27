import { describe, expect, it } from "vitest";
import { consistencyCheck, dayBefore, extrasByType, periodBounds, stockTurnover, yearSummary, type SummaryOp } from "./reports.js";

const op = (o: Partial<SummaryOp>): SummaryOp => ({ date: "2026-03-10", type: "PURCHASE", purchaseCost: "0", revenue: "0", chippingCost: "0", transportCost: "0", additionalCost: "0", productionMp: null, ...o });

describe("raporty — reguły F6", () => {
  it("okresy: tydzień pon–nd, miesiąc (luty przestępny), kwartał, rok; dzień poprzedni", () => {
    expect(periodBounds("week", "2026-10-01")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(periodBounds("month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodBounds("quarter", "2026-11-15")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodBounds("year", "2026-05-05")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  });
  it("obroty: stan początkowy + przychody − rozchody = stan końcowy; odwrócenie trafia do kolumny ruchu odwracanego", () => {
    const rows = stockTurnover(new Map([["drw", "817"]]), [
      { materialId: "drw", kind: "PURCHASE", qty: "100" },
      { materialId: "drw", kind: "PURCHASE", qty: "90" },
      { materialId: "drw", kind: "PURCHASE", qty: "-100", reversal: true },   // korekta zakupu 100 → 90
      { materialId: "drw", kind: "CONSUMPTION", qty: "-25" },
      { materialId: "zr", kind: "PRODUCTION", qty: "100" },
      { materialId: "zr", kind: "SALE", qty: "-60" },
    ]);
    expect(rows.find(r => r.materialId === "drw")).toMatchObject({ start: "817", purchase: "90", consumption: "25", reversals: "-100", inTotal: "90", outTotal: "25", end: "882" });
    expect(rows.find(r => r.materialId === "zr")).toMatchObject({ start: "0", production: "100", sale: "60", end: "40" });
  });
  it("obroty: materiał bez stanu i ruchów pominięty; kontrola spójności z saldami", () => {
    const rows = stockTurnover(new Map([["x", "0"], ["a", "5"]]), []);
    expect(rows.map(r => r.materialId)).toEqual(["a"]);
    expect(consistencyCheck(rows, new Map([["a", "5"]]))).toEqual({ ok: true, mismatches: [] });
    expect(consistencyCheck(rows, new Map([["a", "4"], ["b", "1"]])).mismatches).toEqual([
      { materialId: "a", fromMovements: "5", balance: "4" }, { materialId: "b", fromMovements: "0", balance: "1" }]);
  });
  it("rok: 12 miesięcy, kwoty, wynik, produkcja MP, korekty i usunięcia wg daty wykonania, suma roku; inne lata pominięte", () => {
    const s = yearSummary(2026, [
      op({ purchaseCost: "12000", transportCost: "400.5" }),
      op({ type: "SALE", revenue: "9000", date: "2026-03-20" }),
      op({ type: "PRODUCTION", chippingCost: "800", productionMp: "400", date: "2026-03-21" }),
      op({ type: "SALE", revenue: "100", date: "2025-12-31" }),
    ], ["2026-03-22", "2026-04-01"], ["2026-04-02"]);
    expect(s.months).toHaveLength(12);
    expect(s.months[2]).toMatchObject({ operations: 3, purchases: 1, sales: 1, productions: 1, revenue: "9000.00", result: "-4200.50", productionMp: "400", corrections: 1 });
    expect(s.months[3]).toMatchObject({ operations: 0, corrections: 1, deletions: 1 });
    expect(s.total).toMatchObject({ operations: 3, purchaseCost: "12000.00", corrections: 2, deletions: 1 });
  });
  it("operacje dodatkowe wg rodzaju: liczba, ilość, koszt malejąco, suma", () => {
    expect(extrasByType([{ type: "Holowanie", quantity: null, cost: "200" }, { type: "Praca ładowarką", quantity: "2", cost: "300" }, { type: "Praca ładowarką", quantity: "1.5", cost: "225" }]))
      .toEqual({ rows: [{ type: "Praca ładowarką", count: 2, quantity: "3.5", cost: "525.00" }, { type: "Holowanie", count: 1, quantity: "0", cost: "200.00" }], total: "725.00" });
  });
});
