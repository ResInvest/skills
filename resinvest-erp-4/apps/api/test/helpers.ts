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
    .overrideProvider(ENV).useValue(loadEnv({ ...process.env, NODE_ENV: "test", DATABASE_URL: testDbUrl(), ...env }))
    .compile();
  const app = mod.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}
