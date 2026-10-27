import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { Meta, type RequestMeta } from "../common/request-meta.js";
import { ZodPipe, zbody } from "../common/zod.pipe.js";
import type { AuthUser } from "../auth/auth-user.js";
import { CurrentUser, RequirePermissions } from "../auth/decorators.js";
import { OpeningService } from "./opening.service.js";

const Line = z.object({
  materialId: z.string().max(40),
  qty: z.union([z.string().max(30), z.number()]),
  unit: z.enum(["M3", "MP", "T"], { message: "Wybierz jednostkę" }),
  note: z.string().max(300).nullable().optional(),
});
const Body_ = z.object({
  warehouseId: z.string().uuid("Wybierz magazyn"),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Podaj datę w formacie RRRR-MM-DD"),
  note: z.string().max(500).nullable().optional(),
  lines: z.array(Line).max(500, "Maksymalnie 500 pozycji"),
});
const Update = Body_.extend({ version: z.number().int().positive() });
const Version = z.object({ version: z.number().int().positive() });
const ListQ = z.object({ warehouseId: z.string().uuid().optional() });

/** Bilans otwarcia: szkic (opening.manage) → zatwierdzenie (opening.approve). Odczyt dla osób wprowadzających i zatwierdzających. */
@Controller("opening-balances")
export class OpeningController {
  constructor(private readonly svc: OpeningService) {}

  @Get() @RequirePermissions("report.view")
  async list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(ListQ)) q: z.infer<typeof ListQ>) { return { ok: true, batches: await this.svc.list(u, q.warehouseId) }; }

  @Get(":id") @RequirePermissions("report.view")
  async get(@CurrentUser() u: AuthUser, @Param("id", new ParseUUIDPipe()) id: string) { return { ok: true, batch: await this.svc.get(u, id) }; }

  @Post() @RequirePermissions("opening.manage")
  async create(@CurrentUser() u: AuthUser, @Body(zbody(Body_)) dto: z.infer<typeof Body_>, @Meta() meta: RequestMeta) {
    return { ok: true, batch: await this.svc.create(u, dto, meta) };
  }

  @Put(":id") @RequirePermissions("opening.manage")
  async update(@CurrentUser() u: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Body(zbody(Update)) dto: z.infer<typeof Update>, @Meta() meta: RequestMeta) {
    const { version, ...input } = dto;
    return { ok: true, batch: await this.svc.update(u, id, version, input, meta) };
  }

  @Delete(":id") @RequirePermissions("opening.manage")
  async remove(@CurrentUser() u: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Query(new ZodPipe(z.object({ version: z.coerce.number().int().positive() }))) q: { version: number }, @Meta() meta: RequestMeta) {
    await this.svc.remove(u, id, q.version, meta); return { ok: true };
  }

  @Post(":id/approve") @HttpCode(200) @RequirePermissions("opening.approve")
  async approve(@CurrentUser() u: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Body(zbody(Version)) dto: z.infer<typeof Version>, @Meta() meta: RequestMeta) {
    return { ok: true, batch: await this.svc.approve(u, id, dto.version, meta) };
  }
}
