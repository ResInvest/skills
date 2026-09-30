import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { testDbUrl, createTestApp } from "./helpers.js";
import { PW } from "./fixtures.js";

/** Pierwsza instalacja: czysta baza → dane słownikowe → `cli bootstrap-admin` → aktywacja linkiem → logowanie. */
const url = new URL(testDbUrl()); url.pathname = `${url.pathname}_cli`;
const CLI_DB = url.toString();
const admin = new URL(testDbUrl()); admin.pathname = "/postgres";

beforeAll(async () => {
  const c = new Client({ connectionString: admin.toString() }); await c.connect();
  const name = url.pathname.slice(1);
  await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await c.query(`CREATE DATABASE "${name}"`); await c.end();
  const root = resolve(__dirname, "../../..");
  execFileSync(resolve(root, "node_modules/.bin/prisma"), ["migrate", "deploy"], { cwd: root, env: { ...process.env, DATABASE_URL: CLI_DB }, stdio: "pipe" });
});

describe("CLI administratora", () => {
  it("bootstrap-admin: konto INVITED + jednorazowy link; aktywacja i logowanie; ponowne uruchomienie bez zmian", async () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = CLI_DB;
    process.env.APP_URL = "http://localhost:5173";
    const { runCli } = await import("../src/cli.js");
    const { seedReferenceData } = await import("../src/seed/seed.js");
    const { PrismaClient } = await import("../src/generated/prisma/client.js");
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: CLI_DB }) });
    try {
      await seedReferenceData(db);
      const lines: string[] = [];
      expect(await runCli(["bootstrap-admin"], s => lines.push(s))).toBe(0);
      const link = lines.find(l => l.includes("/aktywacja?token="));
      expect(link).toBeTruthy();
      const u = await db.user.findUniqueOrThrow({ where: { email: "magazyn@resinvest.group" }, include: { role: true } });
      expect(u).toMatchObject({ status: "INVITED", role: { code: "ADMINISTRATOR" } });
      expect(await db.auditLog.count({ where: { action: "ADMIN_BOOTSTRAP" } })).toBe(1);

      const app = await createTestApp({ DATABASE_URL: CLI_DB });
      const token = decodeURIComponent(link!.split("token=")[1]!);
      const h = { "X-Requested-With": "ResInvestERP", Origin: "http://localhost:5173" };
      expect((await request(app.getHttpServer()).post("/api/v1/auth/invite/accept").set(h).send({ token, password: PW })).status).toBe(200);
      expect((await request(app.getHttpServer()).post("/api/v1/auth/login").set(h).send({ email: "magazyn@resinvest.group", password: PW })).status).toBe(200);
      await app.close();

      const again: string[] = [];
      expect(await runCli(["bootstrap-admin"], s => again.push(s))).toBe(0);
      expect(again.join(" ")).toMatch(/już istnieje/);
      expect(await runCli(["nieznane"], () => {})).toBe(2);
    } finally { await db.$disconnect(); process.env.DATABASE_URL = prev; }
  });
});
