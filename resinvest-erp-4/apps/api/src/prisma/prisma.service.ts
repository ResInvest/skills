import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { ENV, type Env } from "../config/env.js";

/** Jedno połączenie (pula) z PostgreSQL dla całej aplikacji. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Prisma");
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }) });
  }
  async onModuleInit(): Promise<void> {
    try { await this.$connect(); } catch (e) { this.log.error("Brak połączenia z bazą danych", e instanceof Error ? e.message : String(e)); throw e; }
  }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
