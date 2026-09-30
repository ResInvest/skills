import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/** Konfiguracja Prisma: schemat, migracje i adres bazy z DATABASE_URL (plik .env — tylko lokalnie / na serwerze). */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
