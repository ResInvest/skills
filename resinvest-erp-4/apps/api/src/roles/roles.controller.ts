import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { badRequest, conflict, forbidden, notFound } from "../common/errors.js";
import { Meta, type RequestMeta } from "../common/request-meta.js";
import { zbody } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ADMIN_ROLE, type AuthUser } from "../auth/auth-user.js";
import { CurrentUser, RequirePermissions } from "../auth/decorators.js";

const PermsDto = z.object({ version: z.number().int().positive(), permissions: z.array(z.string().max(60)).max(100) });

/** Role i uprawnienia: odczyt (users.read), zmiana zestawu uprawnień (roles.assign). ADMINISTRATOR — zawsze pełny zestaw. */
@Controller()
export class RolesController {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {}

  @Get("permissions") @RequirePermissions("users.read")
  async permissions() { return { ok: true, permissions: await this.db.permission.findMany({ orderBy: [{ group: "asc" }, { code: "asc" }] }) }; }

  @Get("roles") @RequirePermissions("users.read")
  async roles() {
    const roles = await this.db.role.findMany({ orderBy: { name: "asc" }, include: { permissions: true, _count: { select: { users: true } } } });
    return { ok: true, roles: roles.map(r => ({ id: r.id, code: r.code, name: r.name, description: r.description, global: r.global, system: r.system, version: r.version,
      users: r._count.users, permissions: r.permissions.map(p => p.permissionCode).sort() })) };
  }

  @Put("roles/:code/permissions") @RequirePermissions("roles.assign")
  async setPermissions(@CurrentUser() actor: AuthUser, @Param("code") code: string, @Body(zbody(PermsDto)) dto: z.infer<typeof PermsDto>, @Meta() meta: RequestMeta) {
    const role = await this.db.role.findUnique({ where: { code }, include: { permissions: true } });
    if (!role) throw notFound("Nie znaleziono roli.");
    if (role.code === ADMIN_ROLE) throw forbidden("Rola ADMINISTRATOR ma zawsze pełny zestaw uprawnień.");
    if (role.code === actor.roleCode) throw forbidden("Nie możesz zmieniać uprawnień własnej roli.");
    const all = new Set((await this.db.permission.findMany({ select: { code: true } })).map(p => p.code));
    const next = [...new Set(dto.permissions)].sort();
    const unknown = next.filter(p => !all.has(p));
    if (unknown.length) throw badRequest("PERMISSION", `Nieznane uprawnienia: ${unknown.join(", ")}`);
    const before = role.permissions.map(p => p.permissionCode).sort();
    await this.db.$transaction(async tx => {
      const upd = await tx.role.updateMany({ where: { id: role.id, version: dto.version }, data: { version: { increment: 1 } } });
      if (!upd.count) throw conflict("VERSION", "Rola została w międzyczasie zmieniona — odśwież dane.");
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (next.length) await tx.rolePermission.createMany({ data: next.map(permissionCode => ({ roleId: role.id, permissionCode })) });
      await this.audit.log(tx, actor, meta, { action: "ROLE_PERMISSIONS_CHANGED", entity: "role", entityId: role.code, before: { uprawnienia: before }, after: { uprawnienia: next } });
    });
    return { ok: true };
  }
}
