import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const base = { DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db" };

describe("konfiguracja środowiska", () => {
  it("uzupełnia wartości domyślne i dzieli listy", () => {
    const e = loadEnv({ ...base, COMPANY_DOMAINS: "ResInvest.group, example.pl", ALLOWED_NETWORKS: "10.0.0.0/8,10.212.134.0/24" });
    expect(e.API_PORT).toBe(3000);
    expect(e.COMPANY_DOMAINS).toEqual(["resinvest.group", "example.pl"]);
    expect(e.ALLOWED_NETWORKS).toHaveLength(2);
    expect(loadEnv(base).COMPANY_DOMAINS).toEqual(["resinvest.group"]);
  });
  it("odrzuca brak bazy i bazę inną niż PostgreSQL", () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ DATABASE_URL: "mysql://u:p@h/db" })).toThrow(/PostgreSQL/);
  });
  it("w produkcji wymaga HTTPS i listy sieci LAN/VPN", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production", APP_URL: "http://erp" })).toThrow(/HTTPS[\s\S]*ALLOWED_NETWORKS/);
    expect(loadEnv({ ...base, NODE_ENV: "production", APP_URL: "https://erp.resinvest.local", ALLOWED_NETWORKS: "10.0.0.0/8" }).NODE_ENV).toBe("production");
  });
});
