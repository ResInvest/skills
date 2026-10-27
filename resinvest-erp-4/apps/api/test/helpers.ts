import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/bootstrap.js";
import { ENV, loadEnv } from "../src/config/env.js";

/** URL bazy testowej ustawiony przez global-setup (przekazany przez provide/inject vitest nie jest potrzebny — ten sam proces env). */
export function testDbUrl(): string {
  const u = new URL(process.env.DATABASE_URL ?? "");
  if (!u.pathname.endsWith("_test")) u.pathname = `${u.pathname}_test`;
  return u.toString();
}

/** Aplikacja NestJS na bazie testowej, z nadpisaną konfiguracją środowiska. */
export async function createTestApp(env: Record<string, string> = {}): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV).useValue(loadEnv({ ...process.env, NODE_ENV: "test", DATABASE_URL: testDbUrl(), MAIL_WORKER: "off", EMAIL_TRANSPORT: "file",
      MAIL_FILE_DIR: process.env.TEST_MAIL_DIR ?? "./test-results/mail", APP_URL: "http://localhost:5173",
      // testy wysyłają wszystkie żądania z 127.0.0.1 — limity sprawdza osobny test z wartościami produkcyjnymi
      LOGIN_RATE_PER_IP: "10000", LOGIN_RATE_PER_EMAIL: "10000", ...env }))
    .compile();
  const app = mod.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}
