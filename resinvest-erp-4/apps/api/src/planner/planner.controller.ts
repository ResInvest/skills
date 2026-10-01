import { Body, Controller, Get, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { Meta, type RequestMeta } from "../common/request-meta.js";
import { ZodPipe, zbody } from "../common/zod.pipe.js";
import type { AuthUser } from "../auth/auth-user.js";
import { CurrentUser, RequirePermissions } from "../auth/decorators.js";
import { PlannerService } from "./planner.service.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Podaj datę w formacie RRRR-MM-DD");
const ViewQ = z.object({ warehouseId: z.union([z.string().uuid(), z.literal("ALL")], { message: "Wybierz magazyn" }), from: day, to: day });
const PlanBody = z.object({
  warehouseId: z.string().uuid("Wybierz magazyn"), date: day,
  // plan w MP: liczba ≥ 0, do 2 miejsc po przecinku (przecinek albo kropka)
  planMp: z.union([z.string(), z.number()]).transform(v => String(v).trim().replace(/\s/g, "").replace(",", "."))
    .refine(v => /^\d{1,7}(\.\d{1,2})?$/.test(v), { message: "Plan: liczba nie mniejsza od 0 (np. 260 albo 260,5)" }),
  note: z.string().max(500).nullable().optional(), version: z.number().int().positive().nullable().optional(),
});

/** Planer zakupów: GET /planner (dni, sumy, kierowcy, operacje źródłowe), PUT /planner/plan (plan dnia, planner.edit). */
@Controller("planner")
export class PlannerController {
  constructor(private readonly svc: PlannerService) {}

  @Get() @RequirePermissions("report.view")
  async view(@CurrentUser() u: AuthUser, @Query(new ZodPipe(ViewQ)) q: z.infer<typeof ViewQ>) {
    return { ok: true, ...(await this.svc.view(u, q)) };
  }

  @Put("plan") @RequirePermissions("planner.edit")
  async save(@CurrentUser() u: AuthUser, @Body(zbody(PlanBody)) dto: z.infer<typeof PlanBody>, @Meta() meta: RequestMeta) {
    return { ok: true, plan: await this.svc.savePlan(u, dto, meta) };
  }
}
