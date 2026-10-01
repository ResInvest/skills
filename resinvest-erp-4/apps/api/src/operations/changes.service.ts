import { HttpStatus, Injectable } from "@nestjs/common";
import {
  checkReason, correctionNumber, diffSnapshots, effectiveMovements, netChange, postingOrder, reversalsOf, simulate, balanceKey, shortageMessage, snapshotFromPlan,
  type FieldChange, type LedgerRow, type OperationInput, type OperationPlan, type OperationSnapshot, type SnapshotNames, type Unit,
} from "@resinvest/domain";
import { Prisma } from "../generated/prisma/client.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../common/errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Db } from "../prisma/tx.js";
import { can, canAccessWarehouse, displayName, type AuthUser } from "../auth/auth-user.js";
import { LedgerService, isNegativeStockViolation } from "../stock/ledger.service.js";
import { chipperOf, OperationsService } from "./operations.service.js";

const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const invalid = (errors: Array<{ field: string; message: string }>) => badRequest("VALIDATION", errors[0]!.message, errors);
/** Prawo do korekty: ogólne (documents.correct) albo właściwe dla rodzaju operacji. */
const CORRECT_PERM: Record<OperationInput["type"], string> = {
  PURCHASE: "purchases.correct", SALE: "sales.correct", DIRECT_SALE: "sales.correct", PRODUCTION: "production.correct", TRANSFER: "inventory.correct",
};
export const canCorrect = (actor: AuthUser, kind: OperationInput["type"]) => can(actor, "documents.correct") || can(actor, CORRECT_PERM[kind]);
const CHANGEABLE = new Set(["PURCHASE", "SALE", "PRODUCTION", "TRANSFER"]);

const LOAD = {
  documents: { include: { lines: { orderBy: { lineNo: "asc" as const } } }, orderBy: { createdAt: "asc" as const } },
  movements: { orderBy: { seq: "asc" as const } }, productionRun: true, additionalOperations: true, transportRuns: true, transferReceipt: true,
} satisfies Prisma.OperationInclude;
type Loaded = Prisma.OperationGetPayload<{ include: typeof LOAD }>;

/**
 * F5 — zmiany dokumentów: korekta (BYŁO / JEST) i usunięcie (soft delete) z odwróceniem ruchów.
 * Ruchy magazynowe są tylko dopisywane: korekta odwraca ruchy bieżącej wersji (REVERSAL, z datą ruchu odwracanego)
 * i księguje ruchy nowej wersji; usunięcie tylko odwraca. Wszystko w jednej transakcji z blokadą wiersza operacji
 * i blokadą sald (LedgerService) — stan nie zejdzie poniżej zera, a równoczesna zmiana tej samej operacji czeka.
 * Numery dokumentów się nie zmieniają; historia: corrections + document_revisions (pole, było, jest, powód) + audyt.
 */
@Injectable()
export class ChangesService {
  constructor(private readonly db: PrismaService, private readonly ops: OperationsService, private readonly ledger: LedgerService, private readonly audit: AuditService) {}

  /** Podgląd korekty: zmiany BYŁO / JEST i stan przed / po (netto) — bez zapisu. */
  async previewCorrection(actor: AuthUser, id: string, input: OperationInput, version: number) {
    const op = await this.load(this.db, id);
    const plan = await this.checkCorrection(this.db, actor, op, input, version);
    const changes = await this.diff(this.db, op, plan, input);
    const net = netChange(effectiveMovements(this.rows(op)), plan.movements);
    const balances = new Map<string, string>();
    for (const m of net) {
      const b = await this.db.stockBalance.findUnique({ where: { warehouseId_materialId: { warehouseId: m.warehouseId, materialId: m.materialId } } });
      balances.set(balanceKey(m.warehouseId, m.materialId), b?.qty.toString() ?? "0");
    }
    const sim = simulate(balances, net);
    const shortages = await Promise.all(sim.shortages.map(async s => {
      const m = await this.db.material.findUnique({ where: { id: s.materialId }, select: { name: true, stockUnit: true } });
      return { ...s, message: `Korekta niemożliwa — ${shortageMessage(s, m?.name ?? "materiał", (m?.stockUnit ?? "T") as Unit)}` };
    }));
    return { plan, numbers: op.documents.map(d => d.number), changes, steps: sim.steps, shortages };
  }

  async correct(actor: AuthUser, id: string, input: OperationInput, reason: string, version: number, idempotencyKey: string, meta: RequestMeta) {
    const done = await this.db.correction.findUnique({ where: { idempotencyKey } });
    if (done) {
      if (done.operationId !== id || done.createdById !== actor.id) throw conflict("IDEMPOTENCY_KEY", "Ten identyfikator żądania został już użyty.");
      return this.ops.get(actor, id);
    }
    const why = checkReason(reason);
    if (why) throw invalid([{ field: "reason", message: why }]);
    try {
      await this.db.$transaction(async tx => {
        await this.lockRow(tx, id);
        if (await tx.correction.findUnique({ where: { idempotencyKey } })) return;
        const op = await this.load(tx, id);
        const plan = await this.checkCorrection(tx, actor, op, input, version);
        const changes = await this.diff(tx, op, plan, input);
        if (!changes.length) throw invalid([{ field: "form", message: "Nic się nie zmieniło — korekta nie jest potrzebna" }]);

        // 1) pozycje i dokumenty — te same numery, nowe wartości
        const lineIds: string[][] = [];
        for (const [i, d] of plan.documents.entries()) {
          const doc = op.documents[i]!;
          await tx.document.update({ where: { id: doc.id }, data: {
            documentDate: asDate(plan.documentDate), movementDate: asDate(plan.date), partnerId: d.partnerId, externalNumber: input.externalNumber?.trim() || null, version: { increment: 1 },
          } });
          lineIds.push([]);
          for (const [j, l] of d.lines.entries()) {
            const line = doc.lines[j]!;
            await tx.documentLine.update({ where: { id: line.id }, data: {
              materialId: l.materialId, qtySource: l.qtySource, unitSource: l.unitSource, qtyStock: l.qtyStock, unitStock: l.unitStock, conversionFactor: l.factor,
              conversionSource: l.source, weightT: l.weightT, weightSource: l.weightSource, unitPrice: l.unitPrice, priceUnit: l.priceUnit, value: l.value,
            } });
            lineIds[i]!.push(line.id);
          }
        }
        // 2) księga: odwrócenie bieżących ruchów + ruchy nowej wersji (najpierw przychody — bez fałszywego braku w połowie)
        const reversals = reversalsOf(this.rows(op));
        const fresh = plan.movements.map(m => ({ warehouseId: m.warehouseId, materialId: m.materialId, qty: m.qty, kind: m.kind,
          documentId: op.documents[m.doc]!.id, documentLineId: lineIds[m.doc]![m.line]! }));
        await this.postOrExplain(tx, op.id, asDate(plan.date), actor.id, [
          ...reversals.map(r => ({ ...r, movementDate: asDate(r.movementDate) })), ...fresh,
        ], "Korekta niemożliwa");
        // 3) produkcja, transport, operacje dodatkowe — zastąpione wersją po korekcie
        await this.replaceChildren(tx, op, plan, input, actor);
        await tx.operation.update({ where: { id: op.id }, data: {
          operationDate: asDate(plan.date), notes: input.notes?.trim() || null, purchaseCost: plan.totals.purchaseCost, revenue: plan.totals.revenue,
          chippingCost: plan.totals.chippingCost, additionalCost: plan.totals.additionalCost, transportCost: plan.totals.transportCost,
          transportMode: plan.transport?.mode ?? "NONE", place: plan.transport?.place ?? null, targetWarehouseId: plan.transfer?.targetWarehouseId ?? op.targetWarehouseId,
          input: input as unknown as Prisma.InputJsonValue, version: { increment: 1 },
        } });
        // 4) historia: numer korekty, pola BYŁO / JEST, audyt
        const number = await this.nextCorrectionNumber(tx);
        const cor = await tx.correction.create({ data: { operationId: op.id, number, reason: reason.trim(), createdById: actor.id, idempotencyKey } });
        await tx.documentRevision.createMany({ data: changes.map(c => ({ operationId: op.id, documentId: op.documents[0]?.id ?? null, correctionId: cor.id,
          field: c.field.slice(0, 80), before: c.before ?? Prisma.DbNull, after: c.after ?? Prisma.DbNull, reason: reason.trim(), createdById: actor.id })) });
        await this.audit.log(tx, actor, meta, { action: "OPERATION_CORRECTED", entity: "operation", entityId: op.id, warehouseId: op.warehouseId, reason: reason.trim(),
          before: Object.fromEntries(changes.map(c => [c.field, c.before])), after: { korekta: number, dokumenty: op.documents.map(d => d.number), ...Object.fromEntries(changes.map(c => [c.field, c.after])) } });
      }, { timeout: 30_000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const c = await this.db.correction.findUnique({ where: { idempotencyKey } });
        if (c && c.operationId === id && c.createdById === actor.id) return this.ops.get(actor, id);
      }
      if (isNegativeStockViolation(e)) throw new AppError(HttpStatus.CONFLICT, "STOCK_INSUFFICIENT", "Korekta zmniejszyłaby stan poniżej zera.");
      throw e;
    }
    return this.ops.get(actor, id);
  }

  /**
   * Usunięcie: odwrócenie wszystkich ruchów operacji (także przyjęcia MM w magazynie docelowym), status „usunięta”,
   * powód. Blokada, gdy towar z dokumentu został już wydany (stan spadłby poniżej zera) albo okres jest zamknięty.
   */
  async remove(actor: AuthUser, id: string, reason: string, version: number, meta: RequestMeta) {
    if (!can(actor, "documents.delete")) throw forbidden("Usuwać dokumenty może Administrator albo Manager (uprawnienie „Usuwanie dokumentów”).");
    const why = checkReason(reason);
    if (why) throw invalid([{ field: "reason", message: why }]);
    try {
      await this.db.$transaction(async tx => {
        await this.lockRow(tx, id);
        const op = await this.load(tx, id);
        this.checkAccess(actor, op);
        if (op.status === "DELETED") throw conflict("ALREADY_DELETED", `Operacja ${op.documents[0]?.number ?? ""} jest już usunięta.`);
        if (op.version !== version) throw this.versionConflict();
        await this.checkOpen(tx, op.warehouseId, isoDay(op.operationDate));
        if (op.transferReceipt && op.targetWarehouseId) await this.checkOpen(tx, op.targetWarehouseId, isoDay(op.transferReceipt.receivedDate));
        const reversals = reversalsOf(this.rows(op));
        await this.postOrExplain(tx, op.id, op.operationDate, actor.id, reversals.map(r => ({ ...r, movementDate: asDate(r.movementDate) })),
          "Nie można usunąć — towar z dokumentu został już wydany");
        const now = new Date();
        await tx.operation.update({ where: { id: op.id }, data: { status: "DELETED", deletedAt: now, deletedById: actor.id, deleteReason: reason.trim(), version: { increment: 1 } } });
        await tx.document.updateMany({ where: { operationId: op.id }, data: { status: "DELETED", deletedAt: now } });
        await tx.additionalOperation.updateMany({ where: { operationId: op.id, deletedAt: null }, data: { deletedAt: now } });
        await tx.documentRevision.create({ data: { operationId: op.id, documentId: op.documents[0]?.id ?? null, field: "Status", before: "zatwierdzona", after: "usunięta",
          reason: reason.trim(), createdById: actor.id } });
        await this.audit.log(tx, actor, meta, { action: "OPERATION_DELETED", entity: "operation", entityId: op.id, warehouseId: op.warehouseId, reason: reason.trim(),
          before: { status: "zatwierdzona", dokumenty: op.documents.map(d => d.number), data: isoDay(op.operationDate) },
          after: { status: "usunięta", ruchyOdwrocone: reversals.length } });
      }, { timeout: 30_000 });
    } catch (e) {
      if (isNegativeStockViolation(e)) throw new AppError(HttpStatus.CONFLICT, "STOCK_INSUFFICIENT", "Nie można usunąć — stan spadłby poniżej zera.");
      throw e;
    }
    return this.ops.get(actor, id);
  }

  /** Historia zmian operacji: korekty (numer, kto, kiedy, powód) i pola BYŁO / JEST. */
  async history(actor: AuthUser, id: string) {
    const op = await this.db.operation.findUnique({ where: { id }, select: { id: true, warehouseId: true, targetWarehouseId: true, status: true, deletedAt: true, deletedById: true, deleteReason: true } });
    if (!op || !(canAccessWarehouse(actor, op.warehouseId) || (op.targetWarehouseId && canAccessWarehouse(actor, op.targetWarehouseId)))) throw notFound("Nie znaleziono operacji.");
    if (!can(actor, "history.read")) throw forbidden("Nie masz uprawnień do historii zmian.");
    const [corrections, revisions] = await Promise.all([
      this.db.correction.findMany({ where: { operationId: id }, orderBy: { createdAt: "asc" } }),
      this.db.documentRevision.findMany({ where: { operationId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    ]);
    const names = await this.userNames([...corrections.map(c => c.createdById), ...revisions.map(r => r.createdById)]);
    const text = (v: Prisma.JsonValue | null) => (v === null ? null : typeof v === "string" ? v : JSON.stringify(v));
    return {
      corrections: corrections.map(c => ({ id: c.id, number: c.number, reason: c.reason, createdAt: c.createdAt, createdBy: names.get(c.createdById) ?? null,
        changes: revisions.filter(r => r.correctionId === c.id).map(r => ({ field: r.field, before: text(r.before), after: text(r.after) })) })),
      deleted: op.status === "DELETED" ? { at: op.deletedAt, by: op.deletedById ? names.get(op.deletedById) ?? null : null, reason: op.deleteReason } : null,
    };
  }

  /** Zakładki rejestru: korekty (lista KOR), edytowane (operacje po korekcie), usunięte. */
  async changes(actor: AuthUser, q: { warehouseId: string; kind: "corrections" | "edited" | "deleted"; from?: string; to?: string; page: number; pageSize: number }) {
    if (!canAccessWarehouse(actor, q.warehouseId)) throw forbidden("Nie masz dostępu do tego magazynu.", "WAREHOUSE_FORBIDDEN");
    const inWh: Prisma.OperationWhereInput = { OR: [{ warehouseId: q.warehouseId }, { targetWarehouseId: q.warehouseId }] };
    const range = (q.from || q.to) ? { ...(q.from ? { gte: asDate(q.from) } : {}), ...(q.to ? { lt: new Date(asDate(q.to).getTime() + 864e5) } : {}) } : undefined;
    const docs = { select: { type: true, number: true }, orderBy: { createdAt: "asc" as const } };
    if (q.kind === "corrections") {
      const where: Prisma.CorrectionWhereInput = { operation: inWh, ...(range ? { createdAt: range } : {}) };
      const [total, rows] = await Promise.all([
        this.db.correction.count({ where }),
        this.db.correction.findMany({ where, include: { revisions: { orderBy: { id: "asc" } }, operation: { select: { id: true, type: true, status: true, operationDate: true, documents: docs } } },
          orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      ]);
      const names = await this.userNames(rows.map(r => r.createdById));
      const text = (v: Prisma.JsonValue | null) => (v === null ? null : typeof v === "string" ? v : JSON.stringify(v));
      return { total, rows: rows.map(c => ({ id: c.id, number: c.number, createdAt: c.createdAt, createdBy: names.get(c.createdById) ?? null, reason: c.reason,
        operationId: c.operationId, operationType: c.operation.type, status: c.operation.status, documents: c.operation.documents,
        changes: c.revisions.map(r => ({ field: r.field, before: text(r.before), after: text(r.after) })) })) };
    }
    const where: Prisma.OperationWhereInput = q.kind === "deleted"
      ? { ...inWh, status: "DELETED", ...(range ? { deletedAt: range } : {}) }
      : { ...inWh, status: { not: "DELETED" }, corrections: { some: range ? { createdAt: range } : {} } };
    const [total, rows] = await Promise.all([
      this.db.operation.count({ where }),
      this.db.operation.findMany({ where, include: { documents: docs, corrections: { orderBy: { createdAt: "desc" }, select: { number: true, createdAt: true, createdById: true, reason: true } } },
        orderBy: q.kind === "deleted" ? { deletedAt: "desc" } : { updatedAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const names = await this.userNames(rows.flatMap(o => [o.deletedById ?? "", ...o.corrections.map(c => c.createdById)]).filter(Boolean));
    return { total, rows: rows.map(o => ({
      operationId: o.id, operationType: o.type, status: o.status, operationDate: isoDay(o.operationDate), documents: o.documents,
      corrections: o.corrections.length, last: o.corrections[0] ? { number: o.corrections[0].number, at: o.corrections[0].createdAt, by: names.get(o.corrections[0].createdById) ?? null, reason: o.corrections[0].reason } : null,
      deleted: o.status === "DELETED" ? { at: o.deletedAt, by: o.deletedById ? names.get(o.deletedById) ?? null : null, reason: o.deleteReason } : null,
    })) };
  }

  // ---------------------------------------------------------------------------------------------------------

  private async load(db: Db, id: string): Promise<Loaded> {
    const op = await db.operation.findUnique({ where: { id }, include: LOAD });
    if (!op) throw notFound("Nie znaleziono operacji.");
    return op;
  }

  private async lockRow(tx: Db, id: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "operations" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (!locked.length) throw notFound("Nie znaleziono operacji.");
  }

  private checkAccess(actor: AuthUser, op: Loaded) {
    if (!canAccessWarehouse(actor, op.warehouseId)) throw notFound("Nie znaleziono operacji.");
    if (!CHANGEABLE.has(op.type)) throw badRequest("NOT_CHANGEABLE", "Bilans otwarcia i inwentaryzację zmienia się w module Dane startowe / Inwentaryzacja.");
  }

  private versionConflict() {
    return conflict("VERSION_CONFLICT", "Operację zmienił w międzyczasie ktoś inny — odśwież szczegóły i wprowadź zmianę ponownie.");
  }

  private async checkOpen(db: Db, warehouseId: string, day: string) {
    const closed = await db.inventoryPeriod.findFirst({ where: { warehouseId, period: day.slice(0, 7), status: "CLOSED" }, include: { warehouse: { select: { name: true } } } });
    if (closed) throw invalid([{ field: "date", message: `W magazynie ${closed.warehouse.name} okres ${closed.period} jest zamknięty — zmiana niemożliwa` }]);
  }

  /** Wspólne warunki korekty; zwraca plan nowej wersji (reguły domeny jak przy zapisie). */
  private async checkCorrection(db: Db, actor: AuthUser, op: Loaded, input: OperationInput, version: number): Promise<OperationPlan> {
    this.checkAccess(actor, op);
    const prev = op.input as unknown as OperationInput | null;
    const kind = prev?.type ?? (op.type as OperationInput["type"]);
    if (!canCorrect(actor, kind)) throw forbidden("Nie masz uprawnień do korekty tego rodzaju dokumentów.");
    if (op.status === "DELETED") throw conflict("DELETED", "Operacja jest usunięta — korekta niemożliwa.");
    if (op.version !== version) throw this.versionConflict();
    if (input.type !== kind) throw invalid([{ field: "form", message: "Korekta nie zmienia rodzaju operacji — usuń operację i wprowadź nową" }]);
    if (input.warehouseId !== op.warehouseId) throw invalid([{ field: "form", message: "Korekta nie zmienia magazynu — usuń operację i wprowadź nową w innym magazynie" }]);
    if (op.transferReceipt) throw conflict("MM_RECEIVED", "MM zostało przyjęte w magazynie docelowym — korekta niemożliwa. Usuń dokument i wprowadź nowy.");
    await this.checkOpen(db, op.warehouseId, isoDay(op.operationDate));
    // numery dokumentów zostają — numeracja z formularza nie ma znaczenia przy korekcie
    const corrected = { ...input, numbering: { mode: "AUTO" as const, number: null } } as OperationInput;
    const twoStage = op.type === "TRANSFER" ? op.transferState === "IN_TRANSIT" : undefined;
    const { plan } = await this.ops.prepare(db, actor, corrected, { correction: true, ...(twoStage !== undefined ? { twoStage } : {}) });
    const year = Number(plan.documentDate.slice(0, 4));
    if (op.documents.some(d => d.year !== year)) throw invalid([{ field: "documentDate", message: `Korekta nie zmienia roku dokumentu (numeracja jest roczna: ${op.documents[0]?.year ?? ""})` }]);
    // ten sam zestaw dokumentów (rodzaje i liczba pozycji) — inaczej to inna operacja
    const shapeA = op.documents.map(d => `${d.type}:${d.lines.length}`).join(","), shapeB = plan.documents.map(d => `${d.type}:${d.lines.length}`).join(",");
    if (shapeA !== shapeB) throw invalid([{ field: "form", message: `Korekta nie zmienia zestawu dokumentów (było: ${op.documents.map(d => d.type).join(" + ")}, byłoby: ${plan.documents.map(d => d.type).join(" + ")}). Włączenie lub wyłączenie produkcji, sprzedaży czy transportu wymaga usunięcia operacji i wprowadzenia nowej` }]);
    return plan;
  }

  private rows(op: Loaded): LedgerRow[] {
    return op.movements.map(m => ({ id: m.id, warehouseId: m.warehouseId, materialId: m.materialId, qty: m.qty.toString(), kind: m.kind, movementDate: isoDay(m.movementDate),
      documentId: m.documentId, documentLineId: m.documentLineId, reversalOfId: m.reversalOfId }));
  }

  private async postOrExplain(tx: Db, operationId: string, date: Date, actorId: string, movements: Array<Parameters<LedgerService["post"]>[1]["movements"][number]>, prefix: string) {
    try {
      await this.ledger.post(tx, { operationId, movementDate: date, createdById: actorId, movements: postingOrder(movements) });
    } catch (e) {
      if (e instanceof AppError && (e.getResponse() as { code?: string }).code === "STOCK_INSUFFICIENT") {
        const r = e.getResponse() as { error: string; details?: unknown };
        throw new AppError(HttpStatus.CONFLICT, "STOCK_INSUFFICIENT", `${prefix}: ${r.error}`, r.details);
      }
      throw e;
    }
  }

  private async replaceChildren(tx: Db, op: Loaded, plan: OperationPlan, input: OperationInput, actor: AuthUser) {
    if (plan.production) {
      const pr = plan.production, who = chipperOf(input);
      const data = { mode: pr.mode, rawMaterialId: pr.rawMaterialId || null, outMaterialId: pr.outMaterialId, consumeQty: pr.consumeQty, outQty: pr.outQty, factor: pr.factor,
        chipRate: pr.chipRate, chippingCost: pr.chippingCost, chipperId: who.chipperId, operatorId: who.operatorId, diffReason: pr.diffReason,
        forestDistrict: pr.forestDistrict, forestry: pr.forestry, waybill: pr.waybill, investSite: pr.investSite, sourceDoc: pr.sourceDoc };
      await tx.productionRun.upsert({ where: { operationId: op.id }, update: data, create: { operationId: op.id, ...data } });
    }
    await tx.transportRun.deleteMany({ where: { operationId: op.id } });
    for (const r of plan.transport?.runs ?? []) {
      await tx.transportRun.create({ data: {
        operationId: op.id, runNo: r.runNo, ownership: r.ownership, vehicleId: r.vehicleId, driverId: r.driverId, externalCompanyId: r.externalCompanyId,
        registration: r.registration, driverName: r.driverName, km: r.km, ratePerKm: r.ratePerKm, freight: r.freight, cost: r.cost,
        qty: r.qty, unit: r.unit, weightT: r.weightT, waybillNo: r.waybillNo, waybillM3: r.waybillM3, train: r.train ? (r.train as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      } });
    }
    // operacje dodatkowe: poprzednie oznaczone jako usunięte (zostają w historii), nowe dopisane
    const now = new Date();
    await tx.additionalOperation.updateMany({ where: { operationId: op.id, deletedAt: null }, data: { deletedAt: now } });
    for (const x of plan.extras) {
      await tx.additionalOperation.create({ data: { operationId: op.id, typeId: x.typeId, warehouseId: op.warehouseId, vehicleId: x.vehicleId, performedOn: asDate(plan.date),
        quantity: x.quantity, cost: x.cost, description: x.description, createdById: actor.id } });
    }
  }

  private async diff(db: Db, op: Loaded, plan: OperationPlan, input: OperationInput): Promise<FieldChange[]> {
    const before = this.snapshotFromDb(op), after = snapshotFromPlan(plan, input);
    return diffSnapshots(before, after, await this.names(db, [before, after]));
  }

  private snapshotFromDb(op: Loaded): OperationSnapshot {
    const S = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? null : v.toString());
    const main = op.documents[0], pr = op.productionRun;
    return {
      date: isoDay(op.operationDate), documentDate: main ? isoDay(main.documentDate) : isoDay(op.operationDate), externalNumber: main?.externalNumber ?? null, notes: op.notes,
      targetWarehouseId: op.type === "TRANSFER" ? op.targetWarehouseId : null,
      documents: op.documents.map(d => ({ type: d.type, partnerId: d.partnerId, lines: d.lines.map(l => ({
        materialId: l.materialId, qtySource: l.qtySource.toString(), unitSource: l.unitSource, qtyStock: l.qtyStock.toString(), unitStock: l.unitStock,
        weightT: S(l.weightT), weightSource: l.weightSource, unitPrice: S(l.unitPrice), priceUnit: l.priceUnit, value: S(l.value) })) })),
      totals: { purchaseCost: op.purchaseCost.toString(), revenue: op.revenue.toString(), chippingCost: op.chippingCost.toString(), additionalCost: op.additionalCost.toString(), transportCost: op.transportCost.toString() },
      transport: op.transportMode === "NONE" ? null : { mode: op.transportMode, place: op.place, runs: op.transportRuns.length,
        km: op.transportRuns.reduce((a, r) => a.plus(r.km), new Prisma.Decimal(0)).toString() },
      production: pr ? { consumeQty: S(pr.consumeQty) ?? "0", outQty: pr.outQty.toString(), diffReason: pr.diffReason,
        source: pr.mode === "FROM_STOCK" ? null : pr.forestDistrict ? "FOREST" : pr.investSite ? "INVESTMENT" : "OTHER",
        forestDistrict: pr.forestDistrict, forestry: pr.forestry, waybill: pr.waybill, investSite: pr.investSite } : null,
      extras: op.additionalOperations.filter(x => !x.deletedAt).map(x => ({ typeId: x.typeId, cost: x.cost.toString() })),
    };
  }

  private async names(db: Db, snaps: OperationSnapshot[]): Promise<SnapshotNames> {
    const mats = new Set<string>(), parts = new Set<string>(), whs = new Set<string>(), types = new Set<string>();
    for (const s of snaps) {
      s.documents.forEach(d => { if (d.partnerId) parts.add(d.partnerId); d.lines.forEach(l => mats.add(l.materialId)); });
      if (s.targetWarehouseId) whs.add(s.targetWarehouseId);
      s.extras.forEach(x => types.add(x.typeId));
    }
    const [m, p, w, t] = await Promise.all([
      db.material.findMany({ where: { id: { in: [...mats] } }, select: { id: true, name: true } }),
      db.partner.findMany({ where: { id: { in: [...parts] } }, select: { id: true, name: true } }),
      db.warehouse.findMany({ where: { id: { in: [...whs] } }, select: { id: true, name: true } }),
      db.additionalOperationType.findMany({ where: { id: { in: [...types] } }, select: { id: true, name: true } }),
    ]);
    const map = (rows: Array<{ id: string; name: string }>) => { const x = new Map(rows.map(r => [r.id, r.name])); return (id: string) => x.get(id) ?? id; };
    return { material: map(m), partner: map(p), warehouse: map(w), extraType: map(t) };
  }

  /** KOR/NNN/MM/RRRR — kolejny w miesiącu, pod blokadą doradczą (równoczesne korekty nie dostaną tego samego numeru). */
  private async nextCorrectionNumber(tx: Db): Promise<string> {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kor:${today.slice(0, 7)}`}))`;
    const prefix = `KOR/%/${today.slice(5, 7)}/${today.slice(0, 4)}`;
    const rows = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "corrections" WHERE "number" LIKE ${prefix}`;
    return correctionNumber(Number(rows[0]?.n ?? 0) + 1, today);
  }

  private async userNames(ids: string[]) {
    const users = await this.db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, firstName: true, lastName: true } });
    return new Map(users.map(u => [u.id, displayName(u)]));
  }
}
