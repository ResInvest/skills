import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { SystemStatus } from "./SystemStatus";
import { createQueryClient } from "./query";

const view = () => render(<QueryClientProvider client={createQueryClient()}><SystemStatus /></QueryClientProvider>);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("SystemStatus", () => {
  it("pokazuje stan serwera i bazy z /api/v1/health", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, version: "4.0.0-alpha.1", time: "2026-09-30T10:00:00.000Z", database: { ok: true, latencyMs: 1.2, migrations: 1, pendingCheck: null } }), { status: 200 })));
    view();
    expect(await screen.findByText("połączona")).toBeTruthy();
    expect(screen.getByText(/wersja 4\.0\.0-alpha\.1/)).toBeTruthy();
  });
  it("brak połączenia — komunikat o VPN", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    view();
    expect((await screen.findByRole("alert")).textContent).toMatch(/VPN/);
  });
  it("adres spoza sieci firmy — komunikat NETWORK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, code: "NETWORK", error: "Dostęp do systemu możliwy tylko z sieci firmowej lub przez VPN." }), { status: 403 })));
    view();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Brak dostępu z tej sieci/);
  });
});
