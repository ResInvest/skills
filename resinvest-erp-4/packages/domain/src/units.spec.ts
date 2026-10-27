import { describe, expect, it } from "vitest";
import { convert, tonnage, UnitError, DEFAULT_COMPANY_RATES, type MaterialUnits } from "./units.js";
import { parseNumber } from "./number.js";

const chips: MaterialUnits = { stockUnit: "MP", allowedUnits: ["MP", "M3", "T"] };
const wood: MaterialUnits = { stockUnit: "M3", allowedUnits: ["M3", "MP", "T"] };
const shells: MaterialUnits = { stockUnit: "T", allowedUnits: ["T", "M3"], tonPerM3: 0.4 };

describe("przeliczniki firmowe (§7)", () => {
  it("1 m³ = 4 MP, 1 MP = 0,25 m³, 1 MP = 0,33 t — źródło: przelicznik firmowy", () => {
    expect(convert(1, "M3", "MP", wood)).toMatchObject({ value: "4", factor: "4", source: "COMPANY_RATE" });
    expect(convert(1, "MP", "M3", chips)).toMatchObject({ value: "0.25", factor: "0.25", source: "COMPANY_RATE" });
    expect(convert(1, "MP", "T", chips)).toMatchObject({ value: "0.33", source: "COMPANY_RATE" });
  });
  it("zapisuje wartość i jednostkę źródłową, wartość przeliczoną, przelicznik i źródło", () => {
    const c = convert("60", "MP", "T", chips);
    expect(c).toEqual({ qty: "60", from: "MP", value: "19.8", to: "T", factor: "0.33", source: "COMPANY_RATE" });
  });
  it("przelicznik materiału ma pierwszeństwo przed firmowym (źródło AUTO)", () => {
    const own: MaterialUnits = { ...chips, mpPerM3: 3.8, tonPerUnit: 0.3 };
    expect(convert(38, "MP", "M3", own)).toMatchObject({ value: "10", source: "AUTO" });
    expect(convert(10, "MP", "T", own)).toMatchObject({ value: "3", source: "AUTO" });
  });
  it("przelicznik firmowy pochodzi z konfiguracji, nie z kodu", () => {
    const rates = { ...DEFAULT_COMPANY_RATES, mpPerM3: 3.5 };
    expect(convert(2, "M3", "MP", wood, rates).value).toBe("7");
  });
  it("materiał w tonach: przez gęstość t/m³; bez gęstości — błąd", () => {
    expect(convert(4, "T", "M3", shells)).toMatchObject({ value: "10", source: "AUTO" });
    expect(() => convert(1, "T", "M3", { stockUnit: "T", allowedUnits: ["T", "M3"] })).toThrow(UnitError);
  });
  it("jednostka niedozwolona dla materiału — błąd UNIT_NOT_ALLOWED", () => {
    try { convert(1, "MP", "M3", shells); expect.unreachable(); } catch (e) { expect((e as UnitError).code).toBe("UNIT_NOT_ALLOWED"); }
  });
  it("ta sama jednostka — przelicznik 1; ilość ujemna odrzucona", () => {
    expect(convert("12.5", "MP", "MP", chips)).toMatchObject({ value: "12.5", factor: "1" });
    expect(() => convert(-1, "MP", "T", chips)).toThrow(/nieujemną/);
  });
  it("brak błędów zaokrągleń binarnych (0,1 + 0,2)", () => {
    expect(convert("0.3", "M3", "MP", wood).value).toBe("1.2");
  });
});

describe("tonaż (§8): AUTO / RĘCZNY", () => {
  it("60 MP | 19,80 t | przelicznik firmowy", () => {
    expect(tonnage(60, chips, null)).toEqual({ weightT: "19.8", source: "COMPANY_RATE", autoWeightT: "19.8" });
  });
  it("60 MP | 20,35 t | RĘCZNY — wartość ręczna zachowana, obok informacja o wyliczonej", () => {
    expect(tonnage(60, chips, "20.35")).toEqual({ weightT: "20.35", source: "MANUAL", autoWeightT: "19.8" });
  });
  it("materiał w tonach: tonaż = ilość; ręczny tonaż ≤ 0 odrzucony", () => {
    expect(tonnage(12, shells, null)).toMatchObject({ weightT: "12", source: "AUTO" });
    expect(() => tonnage(60, chips, "0")).toThrow(UnitError);
  });
});

describe("liczby wpisywane przez użytkownika", () => {
  it("format polski i angielski", () => {
    expect(parseNumber("1 234,56")).toEqual({ ok: true, value: "1234.56" });
    expect(parseNumber("19,8")).toEqual({ ok: true, value: "19.8" });
    expect(parseNumber("1,234.5")).toEqual({ ok: true, value: "1234.5" });
    expect(parseNumber("1.234,5")).toEqual({ ok: true, value: "1234.5" });
  });
  it("puste i błędne wartości", () => {
    expect(parseNumber("")).toMatchObject({ ok: false, empty: true });
    expect(parseNumber("12,3,4")).toMatchObject({ ok: false, empty: false });
    expect(parseNumber("abc")).toMatchObject({ ok: false });
  });
});
