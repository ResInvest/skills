import { Injectable } from "@nestjs/common";
import { planOpening, type OpeningLineInput, type OpeningLinePlan } from "@resinvest/domain";
import { Prisma } from "../generated/prisma/client.js";
import { badRequest, conflict, forbidden, notFound } from "../common/errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Db } from "../prisma/tx.js";
import { canAccessWarehouse, displayName, type AuthUser } from "../auth/auth-user.js";
import { LedgerService, isNegativeStockViolation } from "../stock/ledger.service.js";
import { companyRates, materialUnits } from "../stock/materials.js";

export interface OpeningInput { warehouseId: string; effectiveDate: string; note?: string | null; lines: OpeningLineInput[] }

/** Dzień w strefie firmy (Europe/Warsaw) w formacie RRRR-MM-DD. */
export const todayWarsaw = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Bilans otwarcia (Administracja → Dane startowe). Obieg:
 *  szkic (opening.manage: Manager / Administrator) → zatwierdzenie (opening.approve: Administrator).
 * Zatwierdzenie w jednej transakcji tworzy operację OPENING_BALANCE, dokument BO z pozycjami i ruchy OPENING
 * (przez LedgerService), a szkic dostaje status APPROVED. Jeden zatwierdzony bilans na magazyn (indeks unikalny),
 * zatwierdzenie tylko w magazynie bez wcześniejszych ruchów — bilans otwarcia jest pierwszym zdarzeniem stanu.
 * Zatwierdzonego bilansu nie edytuje się (zmiany — korektą, faza F5).
 */
@Injectable()
export class OpeningService {
  constructor(private readonly db: PrismaService, private readonly ledger: LedgerService, private readonly audit: AuditService) {}

  async list(actor: AuthUser, warehouseId?: string) {
    if (warehouseId && !canAccessWarehouse(actor, warehouseId)) throw forbidden("Nie masz dostępu do tego magazynu.", "WAREHOUSE_FORBIDDEN");
    const where = warehouseId ? { warehouseId } : actor.global ? {} : { warehouseId: { in: [...actor.warehouseIds] } };
    const rows = await this.db.openingBalanceBatch.findMany({ where, orderBy: [{ createdAt: "desc" }], include: { warehouse: true, lines: { include: { material: true } } } });
    return this.present(rows);
  }

  async get(actor: AuthUser, id: string) {
    const b = await this.db.openingBalanceBatch.findUnique({ where: { id }, include: { warehouse: true, lines: { include: { material: true } } } });
    if (!b || !canAccessWarehouse(actor, b.warehouseId)) throw notFound("Nie znaleziono bilansu otwarcia.");
    return (await this.present([b]))[0]!;
  }

  async create(actor: AuthUser, input: OpeningInput, meta: RequestMeta) {
    const lines = await this.prepare(this.db, actor, input);
    return this.db.$transaction(async tx => {
      if (await tx.openingBalanceBatch.findFirst({ where: { warehouseId: input.warehouseId, status: "APPROVED" } })) throw conflict("OPENING_EXISTS", "Ten magazyn ma już zatwierdzony bilans otwarcia — zmiany stanu wprowadza się dokumentami lub korektą.");
      const b = await tx.openingBalanceBatch.create({
        data: { warehouseId: input.warehouseId, effectiveDate: asDate(input.effectiveDate), note: input.note?.trim() || null, createdById: actor.id,
          lines: { create: lines.map(l => ({ materialId: l.materialId, qty: l.qty, unit: l.unit, qtyStock: l.qtyStock, note: l.note })) } },
      });
      await this.audit.log(tx, actor, meta, { action: "OPENING_BALANCE_CREATED", entity: "opening_balance", entityId: b.id, warehouseId: b.warehouseId, after: summary(input.effectiveDate, lines) });
      return b.id;
    }).then(id => this.get(actor, id));
  }

  async update(actor: AuthUser, id: string, version: number, input: OpeningInput, meta: RequestMeta) {
    const lines = await this.prepare(this.db, actor, input);
    await this.db.$transaction(async tx => {
      const b = await this.lockDraft(tx, actor, id, version);
      if (b.warehouseId !== input.warehouseId) throw badRequest("VALIDATION", "Magazynu bilansu nie można zmienić — usuń szkic i utwórz nowy.");
      const before = await tx.openingBalanceLine.findMany({ where: { batchId: id }, include: { material: true } });
      await tx.openingBalanceLine.deleteMany({ where: { batchId: id } });
      await tx.openingBalanceBatch.update({ where: { id }, data: { effectiveDate: asDate(input.effectiveDate), note: input.note?.trim() || null, version: { increment: 1 },
        lines: { create: lines.map(l => ({ materialId: l.materialId, qty: l.qty, unit: l.unit, qtyStock: l.qtyStock, note: l.note })) } } });
      await this.audit.log(tx, actor, meta, { action: "OPENING_BALANCE_UPDATED", entity: "opening_balance", entityId: id, warehouseId: b.warehouseId,
        before: { data: isoDay(b.effectiveDate), pozycje: before.map(l => ({ material: l.material.code, ilosc: l.qty.toString(), jednostka: l.unit })) }, after: summary(input.effectiveDate, lines) });
    });
    return this.get(actor, id);
  }

  async remove(actor: AuthUser, id: string, version: number, meta: RequestMeta) {
    await this.db.$transaction(async tx => {
      const b = await this.lockDraft(tx, actor, id, version);
      await tx.openingBalanceBatch.delete({ where: { id } });
      await this.audit.log(tx, actor, meta, { action: "OPENING_BALANCE_DRAFT_DELETED", entity: "opening_balance", entityId: id, warehouseId: b.warehouseId, before: { data: isoDay(b.effectiveDate), status: b.status } });
    });
  }

  async approve(actor: AuthUser, id: string, version: number, meta: RequestMeta) {
    try {
      await this.db.$transaction(async tx => {
        const b = await this.lockDraft(tx, actor, id, version);
        const wh = await tx.warehouse.findUniqueOrThrow({ where: { id: b.warehouseId } });
        if (!wh.active) throw badRequest("WAREHOUSE_INACTIVE", `Magazyn ${wh.name} jest nieaktywny.`);
        if (await tx.openingBalanceBatch.findFirst({ where: { warehouseId: b.warehouseId, status: "APPROVED" } })) throw conflict("OPENING_EXISTS", "Ten magazyn ma już zatwierdzony bilans otwarcia.");
        if (await tx.stockMovement.count({ where: { warehouseId: b.warehouseId } })) throw conflict("OPENING_AFTER_MOVEMENTS", `Magazyn ${wh.name} ma już ruchy magazynowe — bilans otwarcia musi być pierwszym zdarzeniem stanu. Różnice wprowadza się dokumentem lub korektą.`);
        const day = isoDay(b.effectiveDate);
        // ponowne przeliczenie z aktualną kartoteką (materiał mógł zostać dezaktywowany po zapisaniu szkicu)
        const raw = await tx.openingBalanceLine.findMany({ where: { batchId: id }, orderBy: { id: "asc" } });
        const lines = await this.plan(tx, b.effectiveDate, raw.map(l => ({ materialId: l.materialId, qty: l.qty.toString(), unit: l.unit, note: l.note })));
        const now = new Date();
        const op = await tx.operation.create({ data: {
          type: "OPENING_BALANCE", status: "POSTED", warehouseId: b.warehouseId, operationDate: b.effectiveDate, idempotencyKey: `opening:${b.id}`,
          notes: b.note, createdById: b.createdById, postedAt: now, postedById: actor.id, input: { batchId: b.id, lines: lines as unknown as Prisma.InputJsonValue },
        } });
        const year = Number(day.slice(0, 4));
        const doc = await tx.document.create({ data: { operationId: op.id, type: "BO", number: `BO/${wh.code}/${year}`, year, warehouseId: b.warehouseId, documentDate: b.effectiveDate, movementDate: b.effectiveDate, createdById: actor.id } });
        const positive = lines.filter(l => Number(l.qtyStock) > 0);
        const movements = [];
        for (const [i, l] of positive.entries()) {
          const line = await tx.documentLine.create({ data: { documentId: doc.id, lineNo: i + 1, materialId: l.materialId, qtySource: l.qty, unitSource: l.unit, qtyStock: l.qtyStock, unitStock: l.stockUnit, conversionFactor: l.factor, conversionSource: l.source } });
          movements.push({ warehouseId: b.warehouseId, materialId: l.materialId, qty: l.qtyStock, kind: "OPENING" as const, documentId: doc.id, documentLineId: line.id });
        }
        await this.ledger.post(tx, { operationId: op.id, movementDate: b.effectiveDate, createdById: actor.id, movements });
        await tx.openingBalanceBatch.update({ where: { id }, data: { status: "APPROVED", approvedAt: now, approvedById: actor.id, operationId: op.id, version: { increment: 1 } } });
        await this.audit.log(tx, actor, meta, { action: "OPENING_BALANCE_APPROVED", entity: "opening_balance", entityId: id, warehouseId: b.warehouseId,
          before: { status: "DRAFT" }, after: { status: "APPROVED", dokument: doc.number, ...summary(day, lines) } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("OPENING_EXISTS", "Ten magazyn ma już zatwierdzony bilans otwarcia (zatwierdzony równocześnie przez inną osobę).");
      if (isNegativeStockViolation(e)) throw conflict("STOCK_INSUFFICIENT", "Operacja zmniejszyłaby stan poniżej zera.");
      throw e;
    }
    return this.get(actor, id);
  }

  /** Szkic zablokowany do zmiany (FOR UPDATE) + kontrola wersji i dostępu. */
  private async lockDraft(tx: Db, actor: AuthUser, id: string, version: number) {
    await tx.$queryRaw`SELECT "id" FROM "opening_balance_batches" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const b = await tx.openingBalanceBatch.findUnique({ where: { id } });
    if (!b || !canAccessWarehouse(actor, b.warehouseId)) throw notFound("Nie znaleziono bilansu otwarcia.");
    if (b.status !== "DRAFT") throw conflict("OPENING_APPROVED", "Bilans jest już zatwierdzony — nie można go zmienić ani usunąć.");
    if (b.version !== version) throw conflict("VERSION_CONFLICT", "Bilans został w międzyczasie zmieniony przez inną osobę. Odśwież widok i wprowadź zmiany ponownie.");
    return b;
  }

  /** Walidacja danych szkicu: magazyn (dostęp, aktywny), data (nie z przyszłości), pozycje (reguły domeny). */
  private async prepare(db: Db, actor: AuthUser, input: OpeningInput): Promise<OpeningLinePlan[]> {
    const wh = await db.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!wh || !canAccessWarehouse(actor, wh.id)) throw forbidden("Nie masz dostępu do tego magazynu.", "WAREHOUSE_FORBIDDEN");
    if (!wh.active) throw badRequest("WAREHOUSE_INACTIVE", `Magazyn ${wh.name} jest nieaktywny.`);
    if (input.effectiveDate > todayWarsaw()) throw badRequest("VALIDATION", "Data bilansu otwarcia nie może być z przyszłości.", [{ field: "effectiveDate", message: "Data nie może być z przyszłości" }]);
    return this.plan(db, asDate(input.effectiveDate), input.lines);
  }

  private async plan(db: Db, day: Date, lines: OpeningLineInput[]): Promise<OpeningLinePlan[]> {
    const mats = await db.material.findMany({ where: { id: { in: lines.map(l => l.materialId).filter(isUuid) } } });
    const p = planOpening(lines, new Map(mats.map(m => [m.id, materialUnits(m)])), await companyRates(db, day));
    if (!p.ok) throw badRequest("VALIDATION", p.errors[0]!.message, p.errors);
    return p.lines;
  }

  private async present(rows: Array<Prisma.OpeningBalanceBatchGetPayload<{ include: { warehouse: true; lines: { include: { material: true } } } }>>) {
    const ids = [...new Set(rows.flatMap(b => [b.createdById, b.approvedById].filter((x): x is string => !!x)))];
    const users = new Map((await this.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })).map(u => [u.id, displayName(u)]));
    const docs = new Map((await this.db.document.findMany({ where: { operationId: { in: rows.map(b => b.operationId).filter((x): x is string => !!x) }, type: "BO" }, select: { operationId: true, number: true } })).map(d => [d.operationId, d.number]));
    return rows.map(b => ({
      id: b.id, warehouseId: b.warehouseId, warehouse: { code: b.warehouse.code, name: b.warehouse.name }, effectiveDate: isoDay(b.effectiveDate), status: b.status, note: b.note, version: b.version,
      createdAt: b.createdAt, createdBy: users.get(b.createdById) ?? null, approvedAt: b.approvedAt, approvedBy: b.approvedById ? users.get(b.approvedById) ?? null : null,
      operationId: b.operationId, documentNumber: b.operationId ? docs.get(b.operationId) ?? null : null,
      lines: b.lines.slice().sort((x, y) => x.material.name.localeCompare(y.material.name, "pl")).map(l => ({ id: l.id, materialId: l.materialId, code: l.material.code, name: l.material.name,
        qty: l.qty.toString(), unit: l.unit, qtyStock: l.qtyStock.toString(), stockUnit: l.material.stockUnit, note: l.note })),
    }));
  }
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const summary = (day: string, lines: OpeningLinePlan[]) => ({ data: day, pozycje: lines.map(l => ({ material: l.materialId, ilosc: l.qty, jednostka: l.unit, stan: l.qtyStock, jednostkaStanu: l.stockUnit, przelicznik: l.factor, zrodlo: l.source })) });
