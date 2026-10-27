import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("GET /api/v1/health", () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  it("zwraca stan bazy i liczbę migracji, bez cache", async () => {
    const r = await request(app.getHttpServer()).get("/api/v1/health");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.database.ok).toBe(true);
    expect(r.body.database.migrations).toBeGreaterThanOrEqual(1);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-request-id"]).toMatch(/.{8,}/);
  });

  it("ustawia nagłówki bezpieczeństwa i ukrywa technologię", async () => {
    const r = await request(app.getHttpServer()).get("/api/v1/health");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["content-security-policy"]).toBe("default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'");
    expect(r.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });

  it("nieznana ścieżka — jednolity błąd JSON bez stack trace", async () => {
    const r = await request(app.getHttpServer()).get("/api/v1/nie-ma-takiej");
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(JSON.stringify(r.body)).not.toMatch(/at \w+ \(|node_modules/);
  });

  it("CORS: tylko adres aplikacji", async () => {
    const ok = await request(app.getHttpServer()).options("/api/v1/health").set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "GET");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const bad = await request(app.getHttpServer()).options("/api/v1/health").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "GET");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("ograniczenie do sieci LAN / VPN", () => {
  it("odrzuca adres spoza ALLOWED_NETWORKS (403 NETWORK)", async () => {
    const app = await createTestApp({ ALLOWED_NETWORKS: "10.212.134.0/24" });
    const r = await request(app.getHttpServer()).get("/api/v1/health");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("NETWORK");
    await app.close();
  });
  it("przepuszcza adres z listy", async () => {
    const app = await createTestApp({ ALLOWED_NETWORKS: "127.0.0.0/8,::1/128" });
    expect((await request(app.getHttpServer()).get("/api/v1/health")).status).toBe(200);
    await app.close();
  });
});
