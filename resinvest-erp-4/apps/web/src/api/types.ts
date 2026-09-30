/** Typy odpowiedzi API (zgodne z kontrolerami NestJS). */
export type UserStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";

export interface Me {
  id: string; email: string; firstName: string; lastName: string;
  role: { code: string; name: string; global: boolean };
  permissions: string[]; warehouseIds: string[]; defaultWarehouseId: string | null; mustChangePassword: boolean;
}
export interface Warehouse { id: string; code: string; name: string; address: string | null; active: boolean }
export interface UserRow {
  id: string; email: string; firstName: string; lastName: string; status: UserStatus; defaultWarehouseId: string | null;
  lastLoginAt: string | null; createdAt: string; mustChangePassword: boolean; locked: boolean; selfRegistered: boolean; version: number;
  role: { code: string; name: string; global: boolean }; warehouseIds: string[];
}
export interface Role { id: string; code: string; name: string; description: string | null; global: boolean; system: boolean; version: number; users: number; permissions: string[] }
export interface Permission { code: string; description: string; group: string }
export interface SessionRow { id: string; createdAt: string; lastSeenAt: string; expiresAt: string; ip: string | null; userAgent: string | null; current?: boolean }
export interface AuditRow { id: string; ts: string; userId: string | null; userEmail: string | null; action: string; entity: string; entityId: string | null; warehouseId: string | null; before: unknown; after: unknown; reason: string | null; ip: string | null; userAgent: string | null }
export interface LoginRow { id: string; ts: string; email: string; success: boolean; reason: string | null; ip: string | null; userAgent: string | null }
export interface AuthConfig { companyDomains: string[]; allowSelfRegistration: boolean; passwordRules: string }

export const STATUS_LABEL: Record<UserStatus, string> = { INVITED: "zaproszony", ACTIVE: "aktywny", SUSPENDED: "zawieszony", DISABLED: "wyłączony" };
