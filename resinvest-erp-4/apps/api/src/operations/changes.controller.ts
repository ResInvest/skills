import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import type { OperationInput } from "@resinvest/domain";
import { Meta, type RequestMeta } from "../common/request-meta.js";
import { ZodPipe, zbody } from "../common/zod.pipe.js";
import type { AuthUser } from "../auth/auth-user.js";
import { CurrentUser, RequirePermissions } from "../auth/decorators.js";
import { ChangesService } from "./changes.service.js";
import { Input, Key } from "./operations.controller.js";

const version = z.number().int().min(1);
const reason = z.string().max(500);
const CorrectionPreview = z.object({ version, operation: Input });
const Correction = z.object({ idempotencyKey: Key, version, reason, operation: Input });
const Remove = z.object({ version, reason });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ChangesQ = z.object({
  warehouseId: z.string().uuid("Wybierz magazyn"), kind: z.enum(["corrections", "edited", "deleted"]), from: day.optional(), to: day.optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * F5 — zmiany dokumentów: korekta (podgląd BYŁO / JEST i zatwierdzenie), usunięcie z odwróceniem ruchów,
 * historia zmian operacji, zakładki „Korekty”, „Edytowane”, „Usunięte”. Uprawnienia (korekta wg rodzaju,
 * documents.delete, history.read) i dostęp do magazynu sprawdza serwis.
 */
@Controller()
export class ChangesController {
  constructor(private readonly svc: ChangesService) {}

  @Post("operations/:id/correction/preview") @HttpCode(200) @RequirePermissions("report.view")
  async preview(@CurrentUser() u: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Body(zbody(CorrectionPreview)) dto: z.infer<typeof CorrectionPreview>) {
    return { ok: true, ...(await this.svc.previewCorrection(u, id, dto.operation as OperationInput, dto.version)) };
  }

  @Post("operations/:id/correction") @HttpCode(200) @RequirePermissions("report.view")
  async correct(@CurrentUser() u: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Body(zbody(Correction)) dto: z.infer<typeof Correction>, @Meta() meta: RequestMeta) {
    return { ok: true, operation: await this.svc.correct(u, id, dto.operation as OperationInput, dto.reason, dto.version, dto.idempotencyKey, meta) };
  }

  @Post("operations/:id/delete") @HttpCode(200) @RequirePermissions("documents.delete")
  async remove(@CurrentUser() u: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Body(zbody(Remove)) dto: z.infer<typeof Remove>, @Meta() meta: RequestMeta) {
    return { ok: true, operation: await this.svc.remove(u, id, dto.reason, dto.version, meta) };
  }

  @Get("operations/:id/history") @RequirePermissions("history.read")
  async history(@CurrentUser() u: AuthUser, @Param("id", new ParseUUIDPipe()) id: string) {
    return { ok: true, ...(await this.svc.history(u, id)) };
  }

  @Get("documents/changes") @RequirePermissions("report.view")
  async changes(@CurrentUser() u: AuthUser, @Query(new ZodPipe(ChangesQ)) q: z.infer<typeof ChangesQ>) {
    return { ok: true, ...(await this.svc.changes(u, q)) };
  }
}
