import "reflect-metadata";
import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { configureApp } from "./bootstrap.js";
import { API_VERSION } from "./version.js";

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const env = configureApp(app);
  await app.listen(env.API_PORT, env.API_HOST);
  new Logger("Bootstrap").log(`ResInvest ERP API ${API_VERSION} — http://${env.API_HOST}:${env.API_PORT}/api/v1 (${env.NODE_ENV})`);
}

main().catch(e => {
  // błąd konfiguracji / bazy przy starcie — czytelny komunikat, kod wyjścia ≠ 0 (usługa Windows zrestartuje proces)
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
