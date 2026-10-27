import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { Meta, type RequestMeta } from "../common/request-meta.js";
import { ZodPipe, zbody } from "../common/zod.pipe.js";
import type { AuthUser } from "../auth/auth-user.js";
import { CurrentUser, RequirePermissions } from "../auth/decorators.js";
import { NotificationsService } from "./notifications.service.js";

const Changes = z.object({ changes: z.record(z.string().max(40), z.boolean()).refine(o => Object.keys(o).length <= 20, "Za dużo zmian naraz") });
const OutboxQ = z.object({
  status: z.enum(["QUEUED", "SENDING", "SENT", "FAILED", "DEAD"]).optional(), q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * F7 — powiadomienia: ustawienia własne (każdy zalogowany), zgody administratora dla użytkownika,
 * dziennik wysyłki poczty z ponowieniem, wiadomością testową i wysyłką „teraz” (uprawnienie notifications.manage).
 */
@Controller()
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get("account/notifications")
  async mine(@CurrentUser() u: AuthUser) { return { ok: true, settings: await this.svc.settings(u.id) }; }

  @Put("account/notifications")
  async setMine(@CurrentUser() u: AuthUser, @Body(zbody(Changes)) dto: z.infer<typeof Changes>, @Meta() meta: RequestMeta) {
    return { ok: true, settings: await this.svc.setOwn(u, dto.changes, meta) };
  }

  @Get("users/:id/notifications") @RequirePermissions("notifications.manage")
  async user(@Param("id", new ParseUUIDPipe()) id: string) { return { ok: true, settings: await this.svc.settings(id) }; }

  @Put("users/:id/notifications") @RequirePermissions("notifications.manage")
  async setUser(@CurrentUser() u: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Body(zbody(Changes)) dto: z.infer<typeof Changes>, @Meta() meta: RequestMeta) {
    return { ok: true, settings: await this.svc.setAllowed(u, id, dto.changes, meta) };
  }

  @Get("mail/outbox") @RequirePermissions("notifications.manage")
  async outbox(@Query(new ZodPipe(OutboxQ)) q: z.infer<typeof OutboxQ>) { return { ok: true, ...(await this.svc.outbox(q)) }; }

  @Post("mail/:id/retry") @HttpCode(200) @RequirePermissions("notifications.manage")
  async retry(@CurrentUser() u: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return { ok: true, mail: await this.svc.retry(u, id, meta) };
  }

  @Post("mail/test") @HttpCode(200) @RequirePermissions("notifications.manage")
  async test(@CurrentUser() u: AuthUser, @Meta() meta: RequestMeta) { return { ok: true, mail: await this.svc.test(u, meta) }; }

  @Post("mail/drain") @HttpCode(200) @RequirePermissions("notifications.manage")
  async drain() { return { ok: true, ...(await this.svc.drainNow()) }; }
}
