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

// ---- F3: materiały, stany, bilans otwarcia ----
export type Unit = "M3" | "MP" | "T";
export const UNIT_LABEL: Record<Unit, string> = { M3: "m³", MP: "MP", T: "t" };
export interface Material { id: string; code: string; name: string; category: "WOOD" | "CHIPS" | "TONNAGE" | "OTHER"; stockUnit: Unit; allowedUnits: Unit[]; active: boolean; tonPerUnit: string | null; mpPerM3: string | null; tonPerM3: string | null }
export const CATEGORY_LABEL: Record<Material["category"], string> = { WOOD: "Drewno", CHIPS: "Zrębka", TONNAGE: "Produkty tonowe", OTHER: "Inne" };
export interface BalanceRow { materialId: string; code: string; name: string; category: Material["category"]; unit: Unit; active: boolean; qty: string; movements: number; lastMovementAt: string | null }
export interface BalancesResponse { warehouseId: string; opening: { id: string; effectiveDate: string; approvedAt: string } | null; balances: BalanceRow[] }
export interface MovementRow { id: string; seq: string; kind: string; qty: string; before: string; after: string; movementDate: string; createdAt: string; document: { type: string; number: string } | null; operationId: string; operationType: string; user: string | null }
export interface OpeningLine { id: string; materialId: string; code: string; name: string; qty: string; unit: Unit; qtyStock: string; stockUnit: Unit; note: string | null }
export interface OpeningBatch {
  id: string; warehouseId: string; warehouse: { code: string; name: string }; effectiveDate: string; status: "DRAFT" | "APPROVED"; note: string | null; version: number;
  createdAt: string; createdBy: string | null; approvedAt: string | null; approvedBy: string | null; operationId: string | null; documentNumber: string | null; lines: OpeningLine[];
}
export const MOVEMENT_LABEL: Record<string, string> = {
  OPENING: "Bilans otwarcia", PURCHASE: "Zakup", SALE: "Sprzedaż", CONSUMPTION: "Zużycie", PRODUCTION: "Produkcja", TRANSFER_OUT: "MM — rozchód",
  TRANSFER_IN: "MM — przychód", INVENTORY: "Inwentaryzacja", CORRECTION: "Korekta", REVERSAL: "Odwrócenie",
};
