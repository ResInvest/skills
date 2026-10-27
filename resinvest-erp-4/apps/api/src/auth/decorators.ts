import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { AuthUser } from "./auth-user.js";

export const IS_PUBLIC = "riw:public";
export const PERMISSIONS = "riw:permissions";
export const ALLOW_PENDING_PASSWORD = "riw:allow-pending-password";

/** Endpoint bez logowania (health, logowanie, reset hasła, aktywacja zaproszenia). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Wymagane uprawnienia (wszystkie). Sprawdzane na serwerze przy każdym żądaniu. */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS, perms);
/** Dostępne także, gdy administrator wymusił zmianę hasła (zmiana hasła, wylogowanie, „kim jestem”). */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<{ user: AuthUser }>().user);
