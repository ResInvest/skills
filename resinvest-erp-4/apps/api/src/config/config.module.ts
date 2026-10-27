import { Global, Module } from "@nestjs/common";
import { ENV, loadEnv } from "./env.js";

/** Konfiguracja środowiska dostępna we wszystkich modułach (token ENV). */
@Global()
@Module({ providers: [{ provide: ENV, useFactory: () => loadEnv() }], exports: [ENV] })
export class ConfigModule {}
