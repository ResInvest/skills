import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "./password.js";

describe("polityka haseł", () => {
  it("wymaga długości, litery i cyfry", () => {
    expect(passwordProblem("krotkie1")).toMatch(/12 znaków/);
    expect(passwordProblem("bezcyfrbezcyfr")).toMatch(/cyfrę/);
    expect(passwordProblem("123456789012345")).toMatch(/literę/);
    expect(passwordProblem("Zrebka-Brasz-2026")).toBeNull();
  });
  it("odrzuca hasło z nazwą konta i hasła popularne", () => {
    expect(passwordProblem("anna.gorska2026x", "anna.gorska@resinvest.group")).toMatch(/nazwy konta/);
    expect(passwordProblem("Gorska-Plac-77", "anna.gorska@resinvest.group")).toMatch(/nazwy konta/);
    expect(passwordProblem("Resinvest2026")).toMatch(/popularne/);
  });
});

describe("Argon2id", () => {
  it("skrót argon2id, weryfikacja poprawnego i błędnego hasła", async () => {
    const h = await hashPassword("Zrebka-Brasz-2026");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "Zrebka-Brasz-2026")).toBe(true);
    expect(await verifyPassword(h, "zrebka-brasz-2026")).toBe(false);
    expect(await verifyPassword(null, "cokolwiek-123456")).toBe(false);
  });
});

describe("wyrównanie czasu", () => {
  it("weryfikacja bez konta trwa porównywalnie do weryfikacji z kontem", async () => {
    const h = await hashPassword("Zrebka-Brasz-2026");
    await verifyPassword(null, "x"); // rozgrzewka (utworzenie skrótu pomocniczego)
    const t0 = performance.now(); await verifyPassword(h, "Zle-Haslo-12345"); const withUser = performance.now() - t0;
    const t1 = performance.now(); await verifyPassword(null, "Zle-Haslo-12345"); const noUser = performance.now() - t1;
    expect(noUser).toBeGreaterThan(withUser * 0.3);
  });
});
