import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { forbidden, unauthorized } from "../common/errors.js";
import type { AuthUser } from "./auth-user.js";
import { ALLOW_PENDING_PASSWORD, IS_PUBLIC, PERMISSIONS } from "./decorators.js";
import { SessionService } from "./session.service.js";

/** Globalny: każdy endpoint wymaga sesji, chyba że oznaczony @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly sessions: SessionService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = (req.cookies as Record<string, string> | undefined)?.[this.sessions.cookieName];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      // endpointy publiczne mogą znać zalogowanego (np. /auth/me w trybie opcjonalnym) — bez wymogu
      if (token) req.user = (await this.sessions.resolve(token)) ?? undefined;
      return true;
    }
    const user = await this.sessions.resolve(token);
    if (!user) throw unauthorized();
    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets))
      throw forbidden("Administrator wymaga zmiany hasła przed dalszą pracą.", "PASSWORD_CHANGE_REQUIRED");
    req.user = user;
    return true;
  }
}

/** Globalny, po AuthGuard: wymagane uprawnienia z @RequirePermissions(). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const perms = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS, [ctx.getHandler(), ctx.getClass()]);
    if (!perms?.length) return true;
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !perms.every(p => user.permissions.has(p))) throw forbidden();
    return true;
  }
}
