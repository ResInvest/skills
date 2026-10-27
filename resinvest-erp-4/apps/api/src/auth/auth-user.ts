import type { Db } from "../prisma/tx.js";
import type { UserStatus } from "../generated/prisma/enums.js";

/** Zalogowany użytkownik (budowany z bazy przy każdym żądaniu — zmiana roli działa natychmiast). */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  roleCode: string;
  roleName: string;
  /** Rola z dostępem do wszystkich magazynów (ADMINISTRATOR, AUDYTOR). */
  global: boolean;
  permissions: ReadonlySet<string>;
  /** Magazyny dostępne dla użytkownika; dla ról globalnych — wszystkie aktywne. */
  warehouseIds: readonly string[];
  defaultWarehouseId: string | null;
  mustChangePassword: boolean;
  /** Preferencje interfejsu (język, motyw, kolory motywu własnego). */
  prefs: { lang: string; theme: string | null; themePrimary: string | null; themeSecondary: string | null };
  sessionId: string;
  version: number;
}

export const ADMIN_ROLE = "ADMINISTRATOR";

export async function loadAuthUser(db: Db, userId: string, sessionId: string): Promise<AuthUser | null> {
  const u = await db.user.findUnique({ where: { id: userId }, include: { role: { include: { permissions: true } }, warehouses: true } });
  if (!u) return null;
  const warehouseIds = u.role.global
    ? (await db.warehouse.findMany({ where: { active: true }, select: { id: true }, orderBy: { code: "asc" } })).map(w => w.id)
    : u.warehouses.map(w => w.warehouseId);
  return {
    id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, status: u.status, roleCode: u.role.code, roleName: u.role.name,
    global: u.role.global, permissions: new Set(u.role.permissions.map(p => p.permissionCode)), warehouseIds,
    defaultWarehouseId: u.defaultWarehouseId, mustChangePassword: u.mustChangePassword,
    prefs: { lang: u.lang, theme: u.theme, themePrimary: u.themePrimary, themeSecondary: u.themeSecondary }, sessionId, version: u.version,
  };
}

export const can = (u: AuthUser | null | undefined, perm: string): boolean => !!u && u.status === "ACTIVE" && u.permissions.has(perm);
export const canAccessWarehouse = (u: AuthUser, warehouseId: string): boolean => u.global || u.warehouseIds.includes(warehouseId);
export const displayName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();
