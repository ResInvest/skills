import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthUser } from "../auth/auth-user.js";
import { CurrentUser, RequirePermissions } from "../auth/decorators.js";
import type { Prisma } from "../generated/prisma/client.js";

const Q = z.object({
  from: z.string().date().optional(), to: z.string().date().optional(), action: z.string().max(60).optional(), entity: z.string().max(40).optional(),
  userId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(), q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(10).max(200).default(50),
});
const LQ = z.object({ from: z.string().date().optional(), to: z.string().date().optional(), email: z.string().max(254).optional(), success: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(10).max(200).default(50) });

const range = (from?: string, to?: string) => (from || to ? { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) } : {}) } : undefined);

/** Dziennik audytu i logowań — tylko odczyt (audit.read); zapisów audytu nie można zmieniać ani usuwać. */
@Controller("audit")
export class AuditController {
  constructor(private readonly db: PrismaService) {}

  @Get() @RequirePermissions("audit.read")
  async list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(Q)) f: z.infer<typeof Q>) {
    const where: Prisma.AuditLogWhereInput = {
      ts: range(f.from, f.to), action: f.action, entity: f.entity, userId: f.userId, warehouseId: f.warehouseId,
      ...(f.q ? { OR: [{ userEmail: { contains: f.q, mode: "insensitive" } }, { entityId: { contains: f.q } }, { action: { contains: f.q.toUpperCase() } }, { reason: { contains: f.q, mode: "insensitive" } }] } : {}),
      ...(user.global ? {} : { OR: [{ warehouseId: { in: [...user.warehouseIds] } }, { userId: user.id }] }),
    };
    const [total, rows] = await this.db.$transaction([this.db.auditLog.count({ where }), this.db.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize })]);
    return { ok: true, total, page: f.page, pageSize: f.pageSize, rows: rows.map(r => ({ ...r, id: r.id.toString() })) };
  }

  @Get("logins") @RequirePermissions("audit.read")
  async logins(@Query(new ZodPipe(LQ)) f: z.infer<typeof LQ>) {
    const where: Prisma.LoginEventWhereInput = { ts: range(f.from, f.to), email: f.email ? { contains: f.email.toLowerCase() } : undefined, success: f.success ? f.success === "true" : undefined };
    const [total, rows] = await this.db.$transaction([this.db.loginEvent.count({ where }), this.db.loginEvent.findMany({ where, orderBy: { id: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize })]);
    return { ok: true, total, rows: rows.map(r => ({ ...r, id: r.id.toString() })) };
  }
}
