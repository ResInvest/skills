import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Client } from "pg";

/**
 * Baza testów integracyjnych: <baza z DATABASE_URL>_test, tworzona od zera i migrowana (prisma migrate deploy)
 * przed każdym uruchomieniem — testy nie dotykają bazy deweloperskiej ani produkcyjnej.
 */
export default async function setup(): Promise<void> {
  config({ path: resolve(__dirname, "../../../.env"), quiet: true });
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("Brak DATABASE_URL (plik .env w katalogu głównym)");
  const url = new URL(base);
  const dbName = `${url.pathname.slice(1)}_test`;
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`Nieprawidłowa nazwa bazy testowej: ${dbName}`);
  const admin = new URL(base); admin.pathname = "/postgres"; admin.search = "";
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await c.query(`CREATE DATABASE "${dbName}"`);
  await c.end();
  url.pathname = `/${dbName}`;
  process.env.DATABASE_URL = url.toString();
  process.env.TEST_DATABASE_URL = url.toString();
  const root = resolve(__dirname, "../../..");
  execFileSync(resolve(root, "node_modules/.bin/prisma"), ["migrate", "deploy"], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
}
