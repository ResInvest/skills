import { Controller, Get, Query, StreamableFile } from "@nestjs/common";
import { z } from "zod";
import { Meta, type RequestMeta } from "../common/request-meta.js";
import { ZodPipe } from "../common/zod.pipe.js";
import type { AuthUser } from "../auth/auth-user.js";
import { CurrentUser, RequirePermissions } from "../auth/decorators.js";
import { EXPORT_MIME } from "./export.js";
import { ReportsService } from "./reports.service.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data w formacie RRRR-MM-DD");
const wh = z.union([z.string().uuid("Wybierz magazyn"), z.literal("ALL")]);
const year = z.coerce.number().int().min(2000).max(2100);
const TurnoverQ = z.object({ warehouseId: wh, from: day, to: day });
const SummaryQ = z.object({ warehouseId: wh, year });
const DashboardQ = z.object({ warehouseId: wh, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Miesiąc w formacie RRRR-MM") });
const ExportQ = z.object({
  report: z.enum(["turnover", "summary", "documents"]), format: z.enum(["csv", "xlsx", "pdf", "docx"]), warehouseId: wh,
  from: day.optional(), to: day.optional(), year: year.optional(), type: z.enum(["PZ", "WZ", "MM", "RW", "PW", "TR", "BO", "IN"]).optional(),
  q: z.string().max(100).optional(), aux: z.enum(["0", "1"]).optional(),
});

/** Nazwa pliku w nagłówku: wersja ASCII (stare przeglądarki) i UTF-8 (RFC 5987). */
const disposition = (name: string) => `attachment; filename="${name.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** F6 — raporty: obroty magazynowe, zestawienie roczne, pulpit miesiąca, eksport plików. */
@Controller()
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get("reports/turnover") @RequirePermissions("report.view")
  async turnover(@CurrentUser() u: AuthUser, @Query(new ZodPipe(TurnoverQ)) q: z.infer<typeof TurnoverQ>) {
    return { ok: true, ...(await this.svc.turnover(u, q)) };
  }

  @Get("reports/summary") @RequirePermissions("report.view")
  async summary(@CurrentUser() u: AuthUser, @Query(new ZodPipe(SummaryQ)) q: z.infer<typeof SummaryQ>) {
    return { ok: true, ...(await this.svc.summary(u, q)) };
  }

  @Get("dashboard") @RequirePermissions("report.view")
  async dashboard(@CurrentUser() u: AuthUser, @Query(new ZodPipe(DashboardQ)) q: z.infer<typeof DashboardQ>) {
    return { ok: true, ...(await this.svc.dashboard(u, q)) };
  }

  @Get("reports/export") @RequirePermissions("reports.export")
  async export(@CurrentUser() u: AuthUser, @Query(new ZodPipe(ExportQ)) q: z.infer<typeof ExportQ>, @Meta() meta: RequestMeta) {
    const f = await this.svc.export(u, { ...q, aux: q.aux === "1" }, meta);
    return new StreamableFile(f.buffer, { type: EXPORT_MIME[q.format], disposition: disposition(f.filename), length: f.buffer.length });
  }
}
