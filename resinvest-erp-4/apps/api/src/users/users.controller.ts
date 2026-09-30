import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Delete } from "@nestjs/common";
import { z } from "zod";
import { Meta, type RequestMeta } from "../common/request-meta.js";
import { zbody } from "../common/zod.pipe.js";
import type { AuthUser } from "../auth/auth-user.js";
import { CurrentUser, RequirePermissions } from "../auth/decorators.js";
import { UsersService } from "./users.service.js";

const name = (label: string) => z.string().trim().min(1, `Podaj ${label}`).max(80);
const InviteDto = z.object({
  email: z.string().max(254), firstName: name("imię"), lastName: name("nazwisko"), roleCode: z.string().max(40),
  warehouseIds: z.array(z.string().uuid()).max(50).default([]), defaultWarehouseId: z.string().uuid().nullable().default(null),
});
const UpdateDto = z.object({
  version: z.number().int().positive(), firstName: name("imię").optional(), lastName: name("nazwisko").optional(), roleCode: z.string().max(40).optional(),
  warehouseIds: z.array(z.string().uuid()).max(50).optional(), defaultWarehouseId: z.string().uuid().nullable().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]).optional(),
}).strict();

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get() @RequirePermissions("users.read")
  async list(@CurrentUser() actor: AuthUser) { return { ok: true, users: await this.users.list(actor) }; }

  @Get(":id") @RequirePermissions("users.read")
  async get(@CurrentUser() actor: AuthUser, @Param("id", new ParseUUIDPipe()) id: string) { return { ok: true, user: await this.users.get(actor, id) }; }

  @Post() @RequirePermissions("users.manage")
  async invite(@CurrentUser() actor: AuthUser, @Body(zbody(InviteDto)) dto: z.infer<typeof InviteDto>, @Meta() meta: RequestMeta) {
    return { ok: true, user: await this.users.invite(actor, dto, meta) };
  }

  @Patch(":id") @RequirePermissions("users.manage")
  async update(@CurrentUser() actor: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Body(zbody(UpdateDto)) dto: z.infer<typeof UpdateDto>, @Meta() meta: RequestMeta) {
    return { ok: true, user: await this.users.update(actor, id, dto, meta) };
  }

  @Post(":id/resend-invite") @HttpCode(200) @RequirePermissions("users.manage")
  async resend(@CurrentUser() actor: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) { await this.users.resendInvite(actor, id, meta); return { ok: true }; }

  @Post(":id/unlock") @HttpCode(200) @RequirePermissions("users.manage")
  async unlock(@CurrentUser() actor: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) { await this.users.unlock(actor, id, meta); return { ok: true }; }

  @Post(":id/force-password-change") @HttpCode(200) @RequirePermissions("users.manage")
  async force(@CurrentUser() actor: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) { await this.users.forcePasswordChange(actor, id, meta); return { ok: true }; }

  @Post(":id/reset-link") @HttpCode(200) @RequirePermissions("users.manage")
  async resetLink(@CurrentUser() actor: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) { await this.users.sendResetLink(actor, id, meta); return { ok: true }; }

  @Get(":id/sessions") @RequirePermissions("users.manage")
  async sessions(@CurrentUser() actor: AuthUser, @Param("id", new ParseUUIDPipe()) id: string) { return { ok: true, sessions: await this.users.sessionsOf(actor, id) }; }

  @Delete(":id/sessions") @RequirePermissions("users.manage")
  async revoke(@CurrentUser() actor: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) { return { ok: true, revoked: await this.users.revokeSessions(actor, id, meta) }; }
}
