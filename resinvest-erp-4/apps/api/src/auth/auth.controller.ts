import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { ENV, type Env } from "../config/env.js";
import { AuditService } from "../audit/audit.service.js";
import { notFound } from "../common/errors.js";
import { Meta, type RequestMeta } from "../common/request-meta.js";
import { zbody } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { AuthService } from "./auth.service.js";
import type { AuthUser } from "./auth-user.js";
import { AllowPendingPassword, CurrentUser, Public } from "./decorators.js";
import { PASSWORD_RULES } from "./password.js";
import { HEX_RE, LANGS, THEMES } from "@resinvest/domain";
import { SessionService } from "./session.service.js";

const LoginDto = z.object({ email: z.string().max(254), password: z.string().max(256) });
const PasswordDto = z.object({ oldPassword: z.string().max(256), newPassword: z.string().max(256) });
const EmailDto = z.object({ email: z.string().max(254) });
const TokenDto = z.object({ token: z.string().max(100), kind: z.enum(["INVITE", "PASSWORD_RESET"]) });
const TokenPasswordDto = z.object({ token: z.string().max(100), password: z.string().max(256) });
const RegisterDto = z.object({ email: z.string().max(254), firstName: z.string().trim().min(1, "Podaj imię").max(80), lastName: z.string().trim().min(1, "Podaj nazwisko").max(80) });
const hex = z.string().trim().toLowerCase().regex(HEX_RE, "Kolor w formacie #rrggbb");
const PrefsDto = z.object({
  lang: z.enum(LANGS).optional(),
  theme: z.enum(THEMES).nullable().optional(),   // null = „Automatycznie” (wg ustawienia systemu)
  themePrimary: hex.optional(),
  themeSecondary: hex.optional(),
}).strict();
const DefaultWhDto = z.object({ warehouseId: z.string().uuid("Wybierz magazyn") });

/** Widok zalogowanego użytkownika dla frontendu (bez danych wrażliwych). */
export function publicUser(u: AuthUser) {
  return { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: { code: u.roleCode, name: u.roleName, global: u.global },
    permissions: [...u.permissions].sort(), warehouseIds: u.warehouseIds, defaultWarehouseId: u.defaultWarehouseId, mustChangePassword: u.mustChangePassword,
    prefs: u.prefs };
}

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly settings: SettingsService,
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Konfiguracja ekranu logowania (publiczna). */
  @Public() @Get("config")
  async config() {
    return { ok: true, companyDomains: this.env.COMPANY_DOMAINS, allowSelfRegistration: await this.settings.get("auth.allowSelfRegistration"), passwordRules: PASSWORD_RULES };
  }

  @Public() @Post("login") @HttpCode(200)
  async login(@Body(zbody(LoginDto)) dto: z.infer<typeof LoginDto>, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto.email, dto.password, meta);
    this.sessions.setCookie(res, r.token, r.expiresAt);
    return { ok: true, user: publicUser(r.user) };
  }

  @AllowPendingPassword() @Post("logout") @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user, meta);
    this.sessions.clearCookie(res);
    return { ok: true };
  }

  @AllowPendingPassword() @Get("me")
  me(@CurrentUser() user: AuthUser) { return { ok: true, user: publicUser(user) }; }

  @AllowPendingPassword() @Post("password") @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body(zbody(PasswordDto)) dto: z.infer<typeof PasswordDto>, @Meta() meta: RequestMeta) {
    await this.auth.changePassword(user, dto.oldPassword, dto.newPassword, meta);
    return { ok: true };
  }

  /** Magazyn domyślny — tylko spośród magazynów dostępnych dla użytkownika (sprawdzane na serwerze). */
  @Post("me/default-warehouse") @HttpCode(200)
  async defaultWarehouse(@CurrentUser() user: AuthUser, @Body(zbody(DefaultWhDto)) dto: z.infer<typeof DefaultWhDto>, @Meta() meta: RequestMeta) {
    if (!user.warehouseIds.includes(dto.warehouseId)) throw notFound("Magazyn niedostępny dla Twojego konta.");
    await this.db.$transaction(async tx => {
      await tx.user.update({ where: { id: user.id }, data: { defaultWarehouseId: dto.warehouseId } });
      await this.audit.log(tx, user, meta, { action: "DEFAULT_WAREHOUSE_CHANGED", entity: "user", entityId: user.id, before: { magazyn: user.defaultWarehouseId }, after: { magazyn: dto.warehouseId } });
    });
    return { ok: true };
  }

  /**
   * Preferencje interfejsu — wyłącznie własnego konta (identyfikator z sesji, nie z żądania). Dozwolone także przy
   * wymuszonej zmianie hasła (język ekranu zmiany hasła). Zmiana zapisywana w audycie.
   */
  @AllowPendingPassword() @Put("me/preferences")
  async preferences(@CurrentUser() user: AuthUser, @Body(zbody(PrefsDto)) dto: z.infer<typeof PrefsDto>, @Meta() meta: RequestMeta) {
    const before = user.prefs;
    const after = { ...before, ...dto };
    const changed = (Object.keys(dto) as (keyof typeof dto)[]).filter(k => before[k] !== after[k]);
    if (changed.length) {
      await this.db.$transaction(async tx => {
        await tx.user.update({ where: { id: user.id }, data: Object.fromEntries(changed.map(k => [k, after[k]])) });
        await this.audit.log(tx, user, meta, { action: "PREFERENCES_CHANGED", entity: "user", entityId: user.id,
          before: Object.fromEntries(changed.map(k => [k, before[k]])), after: Object.fromEntries(changed.map(k => [k, after[k]])) });
      });
    }
    return { ok: true, prefs: after };
  }

  @AllowPendingPassword() @Get("sessions")
  async sessionsList(@CurrentUser() user: AuthUser) {
    const list = await this.sessions.active(user.id);
    return { ok: true, sessions: list.map(s => ({ ...s, current: s.id === user.sessionId })) };
  }

  @AllowPendingPassword() @Delete("sessions/:id")
  async revokeSession(@CurrentUser() user: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    const s = await this.db.session.findFirst({ where: { id, userId: user.id, revokedAt: null } });
    if (!s) throw notFound("Nie znaleziono aktywnej sesji.");
    await this.db.$transaction(async tx => {
      await this.sessions.revoke(id, "USER_REVOKED", tx);
      await this.audit.log(tx, user, meta, { action: "SESSION_REVOKED", entity: "session", entityId: id, after: { ip: s.ip, przegladarka: s.userAgent } });
    });
    return { ok: true };
  }

  @Public() @Post("forgot") @HttpCode(200)
  async forgot(@Body(zbody(EmailDto)) dto: z.infer<typeof EmailDto>, @Meta() meta: RequestMeta) {
    return { ok: true, message: await this.auth.forgot(dto.email, meta) };
  }

  @Public() @Post("token") @HttpCode(200)
  async token(@Body(zbody(TokenDto)) dto: z.infer<typeof TokenDto>) {
    return { ok: true, ...(await this.auth.checkToken(dto.token, dto.kind)), passwordRules: PASSWORD_RULES };
  }

  @Public() @Post("reset") @HttpCode(200)
  async reset(@Body(zbody(TokenPasswordDto)) dto: z.infer<typeof TokenPasswordDto>, @Meta() meta: RequestMeta) {
    await this.auth.resetPassword(dto.token, dto.password, meta);
    return { ok: true };
  }

  @Public() @Post("invite/accept") @HttpCode(200)
  async acceptInvite(@Body(zbody(TokenPasswordDto)) dto: z.infer<typeof TokenPasswordDto>, @Meta() meta: RequestMeta) {
    await this.auth.acceptInvite(dto.token, dto.password, meta);
    return { ok: true };
  }

  @Public() @Post("register") @HttpCode(200)
  async register(@Body(zbody(RegisterDto)) dto: z.infer<typeof RegisterDto>, @Meta() meta: RequestMeta) {
    return { ok: true, message: await this.auth.register(dto, meta) };
  }
}
