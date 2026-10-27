import { Inject, Injectable } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { AuditService } from "../audit/audit.service.js";
import { badRequest, conflict, forbidden, notFound } from "../common/errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Db } from "../prisma/tx.js";
import { AuthService } from "../auth/auth.service.js";
import { ADMIN_ROLE, can, displayName, type AuthUser } from "../auth/auth-user.js";
import { SessionService } from "../auth/session.service.js";
import type { UserStatus } from "../generated/prisma/enums.js";

export interface InviteInput { email: string; firstName: string; lastName: string; roleCode: string; warehouseIds: string[]; defaultWarehouseId: string | null }
export interface UpdateInput {
  version: number;
  firstName?: string; lastName?: string;
  roleCode?: string;
  warehouseIds?: string[]; defaultWarehouseId?: string | null;
  status?: "ACTIVE" | "SUSPENDED" | "DISABLED";
}

const USER_SELECT = {
  id: true, email: true, firstName: true, lastName: true, status: true, defaultWarehouseId: true, lastLoginAt: true, createdAt: true,
  mustChangePassword: true, lockedUntil: true, selfRegistered: true, version: true,
  role: { select: { code: true, name: true, global: true } }, warehouses: { select: { warehouseId: true } },
} as const;

type UserRow = { id: string; email: string; firstName: string; lastName: string; status: UserStatus; defaultWarehouseId: string | null; lockedUntil: Date | null;
  role: { code: string; name: string; global: boolean }; warehouses: { warehouseId: string }[] } & Record<string, unknown>;

export const userDto = (u: UserRow) => ({ ...u, warehouses: undefined, warehouseIds: u.warehouses.map(w => w.warehouseId), locked: !!u.lockedUntil && u.lockedUntil.getTime() > Date.now() });

/**
 * Konta użytkowników. Zasady (jak w 3.x, §34/§35):
 *  * brak zmiany własnej roli, statusu i magazynów; rolę ADMINISTRATOR nadaje / odbiera wyłącznie administrator,
 *  * nie można zdegradować, zawiesić ani wyłączyć ostatniego aktywnego administratora,
 *  * kierownik bez roli globalnej zarządza tylko osobami ze swoich magazynów i nadaje tylko swoje magazyny,
 *  * konta nie usuwa się fizycznie (status DISABLED) — historia pozostaje.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /** Lista: role globalne — wszyscy; pozostali — osoby dzielące przynajmniej jeden magazyn (i administratorzy). */
  async list(actor: AuthUser) {
    const where = actor.global ? {} : { OR: [{ warehouses: { some: { warehouseId: { in: [...actor.warehouseIds] } } } }, { role: { code: ADMIN_ROLE } }, { id: actor.id }] };
    const rows = await this.db.user.findMany({ where, select: USER_SELECT, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
    return rows.map(userDto);
  }

  async get(actor: AuthUser, id: string) {
    const u = await this.db.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!u || !this.visible(actor, u.warehouses.map(w => w.warehouseId), u.role.code, u.id)) throw notFound("Nie znaleziono użytkownika.");
    return userDto(u);
  }

  private visible(actor: AuthUser, whs: string[], roleCode: string, id: string): boolean {
    return actor.global || id === actor.id || roleCode === ADMIN_ROLE || whs.some(w => actor.warehouseIds.includes(w));
  }
  /** Zarządzać można tylko kontem, którego wszystkie magazyny są w zasięgu zarządzającego (role globalne — każdym). */
  private manageable(actor: AuthUser, whs: string[], roleCode: string): boolean {
    if (actor.global) return true;
    if (roleCode === ADMIN_ROLE) return false;
    return whs.length > 0 && whs.every(w => actor.warehouseIds.includes(w));
  }

  private async validateWarehouses(actor: AuthUser, roleGlobal: boolean, ids: string[], def: string | null): Promise<{ ids: string[]; def: string | null }> {
    const uniq = [...new Set(ids)];
    if (uniq.length) {
      const found = await this.db.warehouse.findMany({ where: { id: { in: uniq }, active: true }, select: { id: true } });
      if (found.length !== uniq.length) throw badRequest("WAREHOUSE", "Wybrano nieistniejący lub nieaktywny magazyn");
    }
    if (!actor.global && uniq.some(w => !actor.warehouseIds.includes(w))) throw forbidden("Możesz przydzielać tylko magazyny, do których masz dostęp.");
    if (!roleGlobal && !uniq.length) throw badRequest("WAREHOUSE", "Wybierz co najmniej jeden magazyn");
    if (def && !uniq.includes(def) && !roleGlobal) throw badRequest("WAREHOUSE", "Magazyn domyślny musi należeć do przydzielonych magazynów");
    return { ids: uniq, def: def ?? uniq[0] ?? null };
  }

  private async role(code: string) {
    const r = await this.db.role.findUnique({ where: { code } });
    if (!r) throw badRequest("ROLE", "Nieznana rola");
    return r;
  }

  private async activeAdminCount(db: Db): Promise<number> {
    return db.user.count({ where: { status: "ACTIVE", role: { code: ADMIN_ROLE } } });
  }

  async invite(actor: AuthUser, input: InviteInput, meta: RequestMeta) {
    const email = this.auth.companyEmail(input.email);
    const role = await this.role(input.roleCode);
    // bez „roles.assign” można zapraszać tylko do ról podstawowych
    if (!["MAGAZYNIER", "OBSERWATOR"].includes(role.code) && !can(actor, "roles.assign")) throw forbidden("Nadanie tej roli wymaga uprawnienia „roles.assign”.");
    if (role.code === ADMIN_ROLE && actor.roleCode !== ADMIN_ROLE) throw forbidden("Rolę ADMINISTRATOR nadaje wyłącznie administrator.");
    const wh = await this.validateWarehouses(actor, role.global, input.warehouseIds, input.defaultWarehouseId);
    const existing = await this.db.user.findUnique({ where: { email } });
    if (existing && !(existing.status === "INVITED" && existing.selfRegistered)) throw conflict("EMAIL_TAKEN", "Konto z tym adresem już istnieje");
    return this.db.$transaction(async tx => {
      const data = { firstName: input.firstName, lastName: input.lastName, roleId: role.id, status: "INVITED" as const, defaultWarehouseId: wh.def, createdById: actor.id };
      const u = existing
        ? await tx.user.update({ where: { id: existing.id }, data: { ...data, selfRegistered: false, version: { increment: 1 } } })
        : await tx.user.create({ data: { email, ...data } });
      await tx.userWarehouse.deleteMany({ where: { userId: u.id } });
      if (wh.ids.length) await tx.userWarehouse.createMany({ data: wh.ids.map(warehouseId => ({ userId: u.id, warehouseId })) });
      const token = await this.auth.issueToken(tx, u.id, "INVITE", email, actor.id);
      await this.mail.enqueue(tx, "invite", email, { name: displayName(u), invitedBy: displayName(actor), role: role.name, url: this.auth.link("/aktywacja", token), hours: String(this.env.INVITE_HOURS) }, `user:${u.id}`);
      await this.audit.log(tx, actor, meta, { action: "USER_INVITED", entity: "user", entityId: u.id, warehouseId: wh.def, after: { email, rola: role.code, magazyny: wh.ids } });
      return userDto(await tx.user.findUniqueOrThrow({ where: { id: u.id }, select: USER_SELECT }));
    });
  }

  async resendInvite(actor: AuthUser, id: string, meta: RequestMeta) {
    const u = await this.db.user.findUnique({ where: { id }, include: { role: true, warehouses: true } });
    if (!u || !this.manageable(actor, u.warehouses.map(w => w.warehouseId), u.role.code)) throw notFound("Nie znaleziono użytkownika.");
    if (u.status !== "INVITED") throw conflict("NOT_INVITED", "Konto jest już aktywne — zaproszenie nie jest potrzebne.");
    await this.db.$transaction(async tx => {
      const token = await this.auth.issueToken(tx, u.id, "INVITE", u.email, actor.id);
      await this.mail.enqueue(tx, "invite", u.email, { name: displayName(u), invitedBy: displayName(actor), role: u.role.name, url: this.auth.link("/aktywacja", token), hours: String(this.env.INVITE_HOURS) }, `user:${u.id}`);
      await this.audit.log(tx, actor, meta, { action: "USER_INVITE_RESENT", entity: "user", entityId: u.id });
    });
  }

  async update(actor: AuthUser, id: string, input: UpdateInput, meta: RequestMeta) {
    const u = await this.db.user.findUnique({ where: { id }, include: { role: true, warehouses: true } });
    const whs = u?.warehouses.map(w => w.warehouseId) ?? [];
    if (!u || !this.visible(actor, whs, u.role.code, u.id)) throw notFound("Nie znaleziono użytkownika.");
    const self = u.id === actor.id;
    if (!self && !this.manageable(actor, whs, u.role.code)) throw forbidden(u.role.code === ADMIN_ROLE ? "Konto administratora zmienia wyłącznie administrator." : "Możesz zarządzać tylko kontami ze swoich magazynów.");
    if (u.version !== input.version) throw conflict("VERSION", "Konto zostało w międzyczasie zmienione przez inną osobę — odśwież dane i spróbuj ponownie.");

    const roleChange = input.roleCode !== undefined && input.roleCode !== u.role.code;
    const whChange = input.warehouseIds !== undefined && (input.warehouseIds.length !== whs.length || input.warehouseIds.some(w => !whs.includes(w)) || (input.defaultWarehouseId ?? u.defaultWarehouseId) !== u.defaultWarehouseId);
    const statusChange = input.status !== undefined && input.status !== u.status;
    if (self && (roleChange || statusChange || whChange)) throw forbidden("Nie możesz zmienić własnej roli, statusu ani magazynów.");
    if (roleChange && !can(actor, "roles.assign")) throw forbidden("Zmiana roli wymaga uprawnienia „roles.assign”.");
    const newRole = roleChange ? await this.role(input.roleCode!) : u.role;
    if ((newRole.code === ADMIN_ROLE || u.role.code === ADMIN_ROLE) && roleChange && actor.roleCode !== ADMIN_ROLE) throw forbidden("Rolę ADMINISTRATOR nadaje i odbiera wyłącznie administrator.");
    if (statusChange && u.status === "INVITED" && input.status === "ACTIVE") throw badRequest("STATUS", "Konto aktywuje się samo po ustawieniu hasła z zaproszenia.");
    const losesAdmin = u.role.code === ADMIN_ROLE && u.status === "ACTIVE" && (newRole.code !== ADMIN_ROLE || (statusChange && input.status !== "ACTIVE"));
    const wh = input.warehouseIds !== undefined || roleChange
      ? await this.validateWarehouses(actor, newRole.global, input.warehouseIds ?? whs, input.defaultWarehouseId !== undefined ? input.defaultWarehouseId : u.defaultWarehouseId)
      : null;

    return this.db.$transaction(async tx => {
      // blokada doradcza: dwie równoczesne degradacje administratorów nie mogą obie przejść kontroli
      if (losesAdmin) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('riw:last-admin'))`;
      if (losesAdmin && (await this.activeAdminCount(tx)) <= 1) throw conflict("LAST_ADMIN", "Nie można zdegradować, zawiesić ani wyłączyć ostatniego aktywnego administratora.");
      const upd = await tx.user.updateMany({ where: { id, version: input.version }, data: {
        firstName: input.firstName ?? undefined, lastName: input.lastName ?? undefined, roleId: newRole.id, status: input.status ?? undefined,
        defaultWarehouseId: wh ? wh.def : undefined, version: { increment: 1 },
      } });
      if (!upd.count) throw conflict("VERSION", "Konto zostało w międzyczasie zmienione przez inną osobę — odśwież dane i spróbuj ponownie.");
      if (wh) {
        await tx.userWarehouse.deleteMany({ where: { userId: id } });
        if (wh.ids.length) await tx.userWarehouse.createMany({ data: wh.ids.map(warehouseId => ({ userId: id, warehouseId })) });
      }
      const base = { entity: "user", entityId: id, warehouseId: u.defaultWarehouseId };
      if (roleChange) await this.audit.log(tx, actor, meta, { ...base, action: "ROLE_CHANGED", before: { rola: u.role.code }, after: { rola: newRole.code } });
      if (whChange && wh) await this.audit.log(tx, actor, meta, { ...base, action: "WAREHOUSE_ACCESS_CHANGED", before: { magazyny: whs, domyslny: u.defaultWarehouseId }, after: { magazyny: wh.ids, domyslny: wh.def } });
      if (statusChange) {
        await this.audit.log(tx, actor, meta, { ...base, action: "USER_STATUS_CHANGED", before: { status: u.status }, after: { status: input.status } });
        if (input.status !== "ACTIVE") {
          await this.sessions.revokeAllForUser(tx, id, `STATUS_${input.status}`);
          await this.mail.enqueue(tx, "account-disabled", u.email, { email: u.email, status: input.status === "SUSPENDED" ? "zawieszone" : "wyłączone" }, `user:${id}`);
        }
      }
      if ((input.firstName && input.firstName !== u.firstName) || (input.lastName && input.lastName !== u.lastName))
        await this.audit.log(tx, actor, meta, { ...base, action: "USER_UPDATED", before: { imie: u.firstName, nazwisko: u.lastName }, after: { imie: input.firstName ?? u.firstName, nazwisko: input.lastName ?? u.lastName } });
      if (roleChange) await this.sessions.revokeAllForUser(tx, id, "ROLE_CHANGED", self ? actor.sessionId : undefined);
      return userDto(await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT }));
    });
  }

  private async managed(actor: AuthUser, id: string) {
    const u = await this.db.user.findUnique({ where: { id }, include: { role: true, warehouses: true } });
    if (!u || !this.visible(actor, u.warehouses.map(w => w.warehouseId), u.role.code, u.id)) throw notFound("Nie znaleziono użytkownika.");
    if (u.id !== actor.id && !this.manageable(actor, u.warehouses.map(w => w.warehouseId), u.role.code)) throw forbidden("Możesz zarządzać tylko kontami ze swoich magazynów.");
    return u;
  }

  async unlock(actor: AuthUser, id: string, meta: RequestMeta) {
    const u = await this.managed(actor, id);
    await this.db.$transaction(async tx => {
      await tx.user.update({ where: { id }, data: { lockedUntil: null, failedLogins: 0 } });
      await this.audit.log(tx, actor, meta, { action: "ACCOUNT_UNLOCKED", entity: "user", entityId: id, before: { zablokowane_do: u.lockedUntil } });
    });
  }

  async forcePasswordChange(actor: AuthUser, id: string, meta: RequestMeta) {
    await this.managed(actor, id);
    if (id === actor.id) throw badRequest("SELF", "Własne hasło zmieniasz w „Moje konto”.");
    await this.db.$transaction(async tx => {
      await tx.user.update({ where: { id }, data: { mustChangePassword: true, version: { increment: 1 } } });
      await this.audit.log(tx, actor, meta, { action: "FORCE_PASSWORD_CHANGE", entity: "user", entityId: id });
    });
  }

  async sendResetLink(actor: AuthUser, id: string, meta: RequestMeta) {
    const u = await this.managed(actor, id);
    if (u.status !== "ACTIVE") throw badRequest("STATUS", "Link resetu można wysłać tylko do aktywnego konta.");
    await this.db.$transaction(async tx => {
      const token = await this.auth.issueToken(tx, id, "PASSWORD_RESET", u.email, actor.id);
      await this.mail.enqueue(tx, "password-reset", u.email, { url: this.auth.link("/reset-hasla", token), minutes: String(this.env.RESET_MINUTES) }, `user:${id}`);
      await this.audit.log(tx, actor, meta, { action: "PASSWORD_RESET_LINK_SENT", entity: "user", entityId: id });
    });
  }

  async sessionsOf(actor: AuthUser, id: string) {
    await this.managed(actor, id);
    return this.sessions.active(id);
  }

  async revokeSessions(actor: AuthUser, id: string, meta: RequestMeta): Promise<number> {
    await this.managed(actor, id);
    return this.db.$transaction(async tx => {
      const n = await this.sessions.revokeAllForUser(tx, id, "ADMIN_REVOKED", id === actor.id ? actor.sessionId : undefined);
      await this.audit.log(tx, actor, meta, { action: "SESSIONS_REVOKED", entity: "user", entityId: id, after: { sesje: n } });
      return n;
    });
  }
}
