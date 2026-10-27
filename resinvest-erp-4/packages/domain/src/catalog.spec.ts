import { describe, expect, it } from "vitest";
import { isValidCode, isValidNip, isValidRegistration, normalizeCode, normalizeNip, normalizeRegistration } from "./catalog.js";

describe("kartoteki — reguły pól", () => {
  it("NIP: suma kontrolna, separatory i prefiks PL", () => {
    expect(isValidNip("526-000-12-46")).toBe(true);
    expect(isValidNip("PL 5260001246")).toBe(true);
    expect(normalizeNip("PL 526-000-12-46")).toBe("5260001246");
    expect(isValidNip("5260001247")).toBe(false); // zła cyfra kontrolna
    expect(isValidNip("123")).toBe(false);
    expect(isValidNip("0000000000")).toBe(false);
  });
  it("numer rejestracyjny: wielkie litery, jedna spacja, 2–10 znaków", () => {
    expect(normalizeRegistration("  sgl   4t821 ")).toBe("SGL 4T821");
    expect(isValidRegistration("sgl 4t821")).toBe(true);
    expect(isValidRegistration("x")).toBe(false);
    expect(isValidRegistration("SGL-4T821")).toBe(false);
  });
  it("kod materiału", () => {
    expect(normalizeCode(" zr-pl ")).toBe("ZR-PL");
    expect(isValidCode("ZR-PL")).toBe(true);
    expect(isValidCode("-X")).toBe(false);
    expect(isValidCode("Z R")).toBe(false);
  });
});
