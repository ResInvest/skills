import { describe, expect, it } from "vitest";
import { balanceKey, companyRatesFrom, formatQty, lockOrder, planOpening, shortageMessage, simulate, type OpeningMaterial } from "./stock.js";

const WH1 = "0199a000-0000-7000-8000-000000000001", WH2 = "0199a000-0000-7000-8000-000000000002";
const WOOD = "0199b000-0000-7000-8000-00000000000a", CHIPS = "0199b000-0000-7000-8000-00000000000b";

describe("symulacja sald (krok po kroku, jak w 3.x)", () => {
  it("produkcja na magazynie: 817 m³ − 125 m³ = 692 m³; zrębka 8 293 + 500 = 8 793 MP", () => {
    const s = simulate(new Map([[balanceKey(WH1, WOOD), "817"], [balanceKey(WH1, CHIPS), "8293"]]), [
      { warehouseId: WH1, materialId: WOOD, qty: "-125" }, { warehouseId: WH1, materialId: CHIPS, qty: "500" }]);
    expect(s.shortages).toEqual([]);
    expect(s.after.get(balanceKey(WH1, WOOD))).toBe("692");
    expect(s.after.get(balanceKey(WH1, CHIPS))).toBe("8793");
  });
  it("brak surowca: dostępne 100, wymagane 125, brakuje 25 — także dla salda nieistniejącego (0)", () => {
    const s = simulate(new Map([[balanceKey(WH1, WOOD), "100"]]), [{ warehouseId: WH1, materialId: WOOD, qty: "-125" }, { warehouseId: WH2, materialId: WOOD, qty: "-1" }]);
    expect(s.shortages).toEqual([
      { warehouseId: WH1, materialId: WOOD, available: "100", required: "125", missing: "25" },
      { warehouseId: WH2, materialId: WOOD, available: "0", required: "1", missing: "1" }]);
  });
  it("kolejność kroków ma znaczenie: zakup → zużycie w jednej operacji przechodzi, odwrotnie — nie", () => {
    const ok = simulate(new Map(), [{ warehouseId: WH1, materialId: WOOD, qty: "20" }, { warehouseId: WH1, materialId: WOOD, qty: "-20" }]);
    expect(ok.shortages).toEqual([]);
    const bad = simulate(new Map(), [{ warehouseId: WH1, materialId: WOOD, qty: "-20" }, { warehouseId: WH1, materialId: WOOD, qty: "20" }]);
    expect(bad.shortages).toHaveLength(1);
  });
  it("precyzja dziesiętna: 0,1 + 0,2 − 0,3 = 0 (bez błędów binarnych); ruch 0 odrzucony", () => {
    const s = simulate(new Map(), [{ warehouseId: WH1, materialId: WOOD, qty: "0.1" }, { warehouseId: WH1, materialId: WOOD, qty: "0.2" }, { warehouseId: WH1, materialId: WOOD, qty: "-0.3" }]);
    expect(s.shortages).toEqual([]); expect(s.after.get(balanceKey(WH1, WOOD))).toBe("0");
    expect(() => simulate(new Map(), [{ warehouseId: WH1, materialId: WOOD, qty: 0 }])).toThrow(/różną od zera/);
  });
  it("kolejność blokad stała (magazyn, materiał) i bez powtórzeń — niezależnie od kolejności ruchów", () => {
    const a = lockOrder([{ warehouseId: WH2, materialId: CHIPS, qty: 1 }, { warehouseId: WH1, materialId: CHIPS, qty: 1 }, { warehouseId: WH1, materialId: WOOD, qty: -1 }, { warehouseId: WH1, materialId: WOOD, qty: 2 }]);
    expect(a).toEqual([{ warehouseId: WH1, materialId: WOOD }, { warehouseId: WH1, materialId: CHIPS }, { warehouseId: WH2, materialId: CHIPS }]);
  });
  it("komunikat o braku jak w 3.x, liczby w formacie polskim", () => {
    expect(shortageMessage({ warehouseId: WH1, materialId: WOOD, available: "100", required: "125", missing: "25" }, "Drewno opałowe", "M3"))
      .toBe("Brak wystarczającej ilości: Drewno opałowe. Dostępne: 100 m³. Wymagane: 125 m³. Brakuje: 25 m³.");
    expect(formatQty("8793.5")).toBe("8 793,5"); expect(formatQty("-1234567")).toBe("−1 234 567");
  });
});

describe("bilans otwarcia — walidacja i przeliczenie na jednostkę magazynową", () => {
  const mats = new Map<string, OpeningMaterial>([
    [WOOD, { id: WOOD, name: "Drewno opałowe", active: true, stockUnit: "M3", allowedUnits: ["M3", "MP", "T"] }],
    [CHIPS, { id: CHIPS, name: "Zrębka", active: true, stockUnit: "MP", allowedUnits: ["MP", "M3", "T"] }],
  ]);
  it("817 m³ drewna i 2 073,25 m³ zrębki (= 8 293 MP, przelicznik firmowy)", () => {
    const p = planOpening([{ materialId: WOOD, qty: "817", unit: "M3" }, { materialId: CHIPS, qty: "2 073,25", unit: "M3" }], mats);
    expect(p).toMatchObject({ ok: true, lines: [
      { materialId: WOOD, qtyStock: "817", stockUnit: "M3", factor: "1", source: "AUTO" },
      { materialId: CHIPS, qty: "2073.25", qtyStock: "8293", stockUnit: "MP", factor: "4", source: "COMPANY_RATE" }] });
  });
  it("błędy: brak pozycji, powtórzony materiał, ilość ujemna / pusta, nieznany i nieaktywny materiał", () => {
    expect(planOpening([], mats)).toMatchObject({ ok: false, errors: [{ field: "lines" }] });
    const inactive = new Map(mats); inactive.set("x", { ...mats.get(WOOD)!, id: "x", name: "Stary", active: false });
    const p = planOpening([{ materialId: WOOD, qty: "1", unit: "M3" }, { materialId: WOOD, qty: "2", unit: "M3" }, { materialId: CHIPS, qty: "-5", unit: "MP" }, { materialId: "nope", qty: "1", unit: "MP" }, { materialId: "x", qty: "1", unit: "M3" }], inactive);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors.map(e => e.field)).toEqual(["lines.1.materialId", "lines.2.qty", "lines.3.materialId", "lines.4.materialId"]);
    expect(planOpening([{ materialId: WOOD, qty: "", unit: "M3" }], mats)).toMatchObject({ ok: false, errors: [{ message: "Podaj ilość" }] });
  });
  it("jednostka niedozwolona dla materiału — błąd przy polu jednostki", () => {
    const pks = new Map<string, OpeningMaterial>([["p", { id: "p", name: "PKS", active: true, stockUnit: "T", allowedUnits: ["T"] }]]);
    expect(planOpening([{ materialId: "p", qty: "5", unit: "MP" }], pks)).toMatchObject({ ok: false, errors: [{ field: "lines.0.unit" }] });
  });
  it("ilość 0 dozwolona (materiał bez stanu na start)", () => {
    expect(planOpening([{ materialId: WOOD, qty: "0", unit: "M3" }], mats)).toMatchObject({ ok: true, lines: [{ qtyStock: "0" }] });
  });
  it("przeliczniki firmowe z tabeli conversion_rates", () => {
    const r = companyRatesFrom([{ fromUnit: "M3", toUnit: "MP", factor: "3.5" }, { fromUnit: "MP", toUnit: "T", factor: "0.3" }]);
    expect(String(r.mpPerM3)).toBe("3.5"); expect(String(r.tonPerMp)).toBe("0.3"); expect(String(r.woodTonPerM3)).toBe("0.952");
    expect(planOpening([{ materialId: CHIPS, qty: "2", unit: "M3" }], mats, r)).toMatchObject({ ok: true, lines: [{ qtyStock: "7" }] });
  });
});
