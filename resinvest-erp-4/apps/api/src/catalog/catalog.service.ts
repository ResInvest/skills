import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { badRequest, conflict, forbidden, notFound } from "../common/errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Db } from "../prisma/tx.js";
import { can, canAccessWarehouse, type AuthUser } from "../auth/auth-user.js";
import { KINDS, type CatalogKind, type Issue, type KindDef } from "./catalog.registry.js";

type Row = Record<string, unknown> & { id: string; version: number };
interface Delegate {
  findMany(a: object): Promise<Row[]>; findUnique(a: object): Promise<Row | null>; findFirst(a: object): Promise<Row | null>;
  create(a: object): Promise<Row>; update(a: object): Promise<Row>; delete(a: object): Promise<Row>;
}
interface Counter { count(a: object): Promise<number> }
const model = (db: Db, def: KindDef) => db[def.model] as unknown as Delegate;

/** Wartości z bazy do JSON: Decimal → łańcuch dziesiętny (bez utraty precyzji). */
function plain(r: Row): Row {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) out[k] = Prisma.Decimal.isDecimal(v) ? (v as Prisma.Decimal).toString() : v;
  return out as Row;
}
const invalid = (issues: Issue[]) => badRequest("VALIDATION", issues[0]!.message, issues);

/**
 * Kartoteki: materiały, kontrahenci, firmy zewnętrzne, kierowcy, operatorzy, pojazdy, rębaki, rodzaje operacji dodatkowych.
 * Zasady (jak w 3.x): walidacja na serwerze, blokada optymistyczna (version), audyt było/jest, rekordu użytego
 * w dokumentach nie usuwa się — tylko dezaktywacja; flota: izolacja magazynów (rola nieglobalna — swoje magazyny i wspólne).
 */
@Injectable()
export class CatalogService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {}

  async list(actor: AuthUser, kind: CatalogKind, q: { q?: string; active?: "1" | "0" | "" }) {
    const def = KINDS[kind];
    const where: Record<string, unknown> = {};
    if (def.warehouseField && !actor.global) where.OR = [{ warehouseId: null }, { warehouseId: { in: [...actor.warehouseIds] } }];
    if (q.active === "1") Object.assign(where, def.activeField === "active" ? { active: true } : { status: { not: "RETIRED" } });
    if (q.active === "0") Object.assign(where, def.activeField === "active" ? { active: false } : { status: "RETIRED" });
    if (q.q?.trim()) where.name = { contains: q.q.trim(), mode: "insensitive" };
    const rows = await model(this.db, def).findMany({ where, orderBy: def.orderBy, take: 2000 });
    return rows.map(plain);
  }

  async create(actor: AuthUser, kind: CatalogKind, body: unknown, meta: RequestMeta) {
    const def = this.allowed(actor, kind);
    const data = this.parse(def, body);
    return this.db.$transaction(async tx => {
      await this.validate(tx, actor, def, data, null);
      const row = await this.save(() => model(tx, def).create({ data: { ...data, ...(def.model === "partner" ? { createdById: actor.id } : {}) } }), def);
      await this.audit.log(tx, actor, meta, { action: "CATALOG_CREATED", entity: kind, entityId: row.id, warehouseId: (data.warehouseId as string | null) ?? null, after: data });
      return plain(row);
    });
  }

  async update(actor: AuthUser, kind: CatalogKind, id: string, body: Record<string, unknown>, meta: RequestMeta) {
    const def = this.allowed(actor, kind);
    const version = Number(body.version);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM ${Prisma.raw(`"${tableOf(def)}"`)} WHERE "id" = ${id}::uuid FOR UPDATE`;
      const prev = await model(tx, def).findUnique({ where: { id } });
      if (!prev) throw notFound(`Nie znaleziono: ${def.label.toLowerCase()}.`);
      this.checkWarehouse(actor, def, prev.warehouseId);
      if (prev.version !== version) throw conflict("VERSION_CONFLICT", "Rekord został w międzyczasie zmieniony przez inną osobę. Odśwież widok i wprowadź zmiany ponownie.");
      const before = plain(prev);
      // edycja = pełny rekord po scaleniu z poprzednią wersją (pominięte pola zachowują wartości, nie wartości domyślne)
      const merged: Record<string, unknown> = {};
      for (const k of Object.keys(def.schema.shape)) merged[k] = k in body ? body[k] : before[k];
      const data = this.parse(def, merged);
      await this.validate(tx, actor, def, data, before);
      const row = await this.save(() => model(tx, def).update({ where: { id }, data: { ...data, version: { increment: 1 } } }), def);
      const changedBefore: Record<string, unknown> = {}, changedAfter: Record<string, unknown> = {};
      for (const k of Object.keys(data)) if (JSON.stringify(before[k]) !== JSON.stringify(data[k])) { changedBefore[k] = before[k]; changedAfter[k] = data[k]; }
      if (Object.keys(changedAfter).length) await this.audit.log(tx, actor, meta, { action: "CATALOG_UPDATED", entity: kind, entityId: id, warehouseId: (data.warehouseId as string | null) ?? null, before: changedBefore, after: changedAfter });
      return plain(row);
    });
  }

  async remove(actor: AuthUser, kind: CatalogKind, id: string, version: number, meta: RequestMeta) {
    const def = this.allowed(actor, kind);
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM ${Prisma.raw(`"${tableOf(def)}"`)} WHERE "id" = ${id}::uuid FOR UPDATE`;
      const prev = await model(tx, def).findUnique({ where: { id } });
      if (!prev) throw notFound(`Nie znaleziono: ${def.label.toLowerCase()}.`);
      this.checkWarehouse(actor, def, prev.warehouseId);
      if (prev.version !== version) throw conflict("VERSION_CONFLICT", "Rekord został w międzyczasie zmieniony przez inną osobę. Odśwież widok.");
      for (const [m, field] of def.usage) {
        const n = await (tx[m as keyof Db] as unknown as Counter).count({ where: { [field]: id } });
        if (n) throw conflict("IN_USE", `${def.label} „${String(prev.name ?? prev.registration ?? "")}” występuje w dokumentach lub innych kartotekach — nie można go usunąć; ${def.activeField === "active" ? "ustaw jako nieaktywny" : "ustaw status „Wycofany”"} (historia zostaje).`);
      }
      await model(tx, def).delete({ where: { id } });
      await this.audit.log(tx, actor, meta, { action: "CATALOG_DELETED", entity: kind, entityId: id, before: plain(prev) });
    });
  }

  private allowed(actor: AuthUser, kind: CatalogKind): KindDef {
    const def = KINDS[kind];
    if (!can(actor, def.perm)) throw forbidden(def.perm === "fleet.edit" ? "Edycja floty wymaga roli Manager lub Administrator." : "Edycja kartotek wymaga roli Manager lub Administrator.");
    return def;
  }
  private parse(def: KindDef, body: unknown): Record<string, unknown> {
    const r = def.schema.safeParse(body);
    if (!r.success) throw invalid(r.error.issues.map(i => ({ field: i.path.join("."), message: i.message })));
    return r.data as Record<string, unknown>;
  }
  private checkWarehouse(actor: AuthUser, def: KindDef, warehouseId: unknown) {
    if (def.warehouseField && typeof warehouseId === "string" && !canAccessWarehouse(actor, warehouseId)) throw forbidden("Nie masz dostępu do magazynu tego zasobu.", "WAREHOUSE_FORBIDDEN");
  }
  private async validate(tx: Db, actor: AuthUser, def: KindDef, data: Record<string, unknown>, prev: Row | null) {
    const issues: Issue[] = [];
    if (def.warehouseField) {
      const w = data.warehouseId as string | null;
      if (w && !(await tx.warehouse.findUnique({ where: { id: w }, select: { id: true } }))) issues.push({ field: "warehouseId", message: "Nie znaleziono magazynu" });
      else this.checkWarehouse(actor, def, w);
      if (!w && !actor.global) issues.push({ field: "warehouseId", message: "Zasób wspólny dla wszystkich magazynów może dodać administrator — wybierz swój magazyn" });
    }
    for (const u of def.unique) {
      const v = data[u.field];
      if (v === null || v === undefined) continue;
      const dup = await model(tx, def).findFirst({ where: { [u.field]: { equals: v, mode: "insensitive" }, ...(prev ? { id: { not: prev.id } } : {}) }, select: { id: true } });
      if (dup) issues.push({ field: u.field, message: u.message });
    }
    if (def.check) issues.push(...(await def.check(tx, data, prev)));
    if (issues.length) throw invalid(issues);
  }
  private async save(fn: () => Promise<Row>, def: KindDef): Promise<Row> {
    try { return await fn(); } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("DUPLICATE", def.unique[0]?.message ?? "Taki rekord już istnieje");
      throw e;
    }
  }
}

const TABLES: Record<KindDef["model"], string> = {
  material: "materials", partner: "partners", externalCompany: "external_companies", driver: "drivers", operator: "operators",
  vehicle: "vehicles", chipper: "chippers", additionalOperationType: "additional_operation_types",
};
const tableOf = (def: KindDef) => TABLES[def.model];
