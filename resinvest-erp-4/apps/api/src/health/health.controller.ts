import { Controller, Get, HttpCode, HttpStatus, Res } from "@nestjs/common";
import type { Response } from "express";
import { PrismaService } from "../prisma/prisma.service.js";
import { API_VERSION } from "../version.js";

interface HealthReport {
  ok: boolean;
  version: string;
  time: string;
  database: { ok: boolean; latencyMs: number | null; migrations: number | null; pendingCheck: string | null };
}

/** Stan systemu dla klienta (sprawdzenie VPN / serwera) i monitoringu. Bez danych biznesowych. */
@Controller("health")
export class HealthController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async health(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const t0 = performance.now();
    const report: HealthReport = { ok: true, version: API_VERSION, time: new Date().toISOString(), database: { ok: false, latencyMs: null, migrations: null, pendingCheck: null } };
    try {
      const rows = await this.db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      report.database = { ok: true, latencyMs: Math.round((performance.now() - t0) * 10) / 10, migrations: Number(rows[0]?.n ?? 0), pendingCheck: null };
    } catch {
      report.ok = false;
      report.database.pendingCheck = "Baza danych niedostępna";
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    res.setHeader("Cache-Control", "no-store");
    return report;
  }
}
