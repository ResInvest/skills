import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { notFound } from "../common/errors.js";
import { Meta, type RequestMeta } from "../common/request-meta.js";
import { ZodPipe } from "../common/zod.pipe.js";
import type { AuthUser } from "../auth/auth-user.js";
import { CurrentUser, RequirePermissions } from "../auth/decorators.js";
import { CatalogService } from "./catalog.service.js";
import { isKind, type CatalogKind } from "./catalog.registry.js";

const ListQ = z.object({ q: z.string().max(100).optional(), active: z.enum(["1", "0", ""]).optional() });
const Ver = z.object({ version: z.coerce.number().int().positive() });
const kindOf = (k: string): CatalogKind => { if (!isKind(k)) throw notFound("Nieznana kartoteka."); return k; };

/**
 * Kartoteki: /catalog/:kind — materials, partners, external-companies, drivers, operators, vehicles, chippers,
 * additional-operation-types. Odczyt: report.view; zmiany: master.edit (materiały, kontrahenci, operacje dodatkowe)
 * albo fleet.edit (flota) — sprawdzane w serwisie wg rodzaju kartoteki.
 */
@Controller("catalog")
export class CatalogController {
  constructor(private readonly svc: CatalogService) {}

  @Get(":kind") @RequirePermissions("report.view")
  async list(@CurrentUser() u: AuthUser, @Param("kind") kind: string, @Query(new ZodPipe(ListQ)) q: z.infer<typeof ListQ>) {
    return { ok: true, rows: await this.svc.list(u, kindOf(kind), q) };
  }

  @Post(":kind") @RequirePermissions("report.view")
  async create(@CurrentUser() u: AuthUser, @Param("kind") kind: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return { ok: true, row: await this.svc.create(u, kindOf(kind), body, meta) };
  }

  @Patch(":kind/:id") @RequirePermissions("report.view")
  async update(@CurrentUser() u: AuthUser, @Param("kind") kind: string, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    new ZodPipe(Ver).transform(b);
    return { ok: true, row: await this.svc.update(u, kindOf(kind), id, b, meta) };
  }

  @Delete(":kind/:id") @RequirePermissions("report.view")
  async remove(@CurrentUser() u: AuthUser, @Param("kind") kind: string, @Param("id", new ParseUUIDPipe()) id: string, @Query(new ZodPipe(Ver)) q: z.infer<typeof Ver>, @Meta() meta: RequestMeta) {
    await this.svc.remove(u, kindOf(kind), id, q.version, meta); return { ok: true };
  }
}
