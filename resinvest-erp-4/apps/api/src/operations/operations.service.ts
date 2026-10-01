import { HttpStatus, Injectable } from "@nestjs/common";
import { autoNumber, normalizeDocNumber, planOperation, planReceipt, simulate, balanceKey, shortageMessage, MM_DIFF_REASONS, type OperationInput, type OperationPlan, type PlanContext, type ReceiptInput, type Unit } from "@resinvest/domain";
import { Prisma } from "../generated/prisma/client.js";
import type { DocumentType } from "../generated/prisma/enums.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../common/errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Db } from "../prisma/tx.js";
import { can, canAccessWarehouse, displayName, type AuthUser } from "../auth/auth-user.js";
import { LedgerService, isNegativeStockViolation } from "../stock/ledger.service.js";
import { companyRates, materialUnits } from "../stock/materials.js";
import { todayWarsaw } from "../opening/opening.service.js";
import { SettingsService } from "../settings/settings.service.js";

const PERM: Record<OperationInput["type"], string> = { PURCHASE: "receipts.create", SALE: "issues.create", PRODUCTION: "production.create", TRANSFER: "mm.create" };
const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const invalid = (errors: Array<{ field: string; message: string }>) => badRequest("VALIDATION", errors[0]!.message, errors);

/**
 * Operacje z dokumentami: zakup (PZ), sprzedaż z magazynu (WZ), produkcja na magazynie (RW + PW).
 * Reguły danych — pakiet domeny (planOperation, ten sam kod co podgląd w formularzu); tutaj: uprawnienia, izolacja
 * magazynów, kartoteki (aktywne, właściwa rola kontrahenta), zamknięte okresy, numeracja i JEDNA transakcja:
 * operacja + dokumenty + pozycje + ruchy (LedgerService, blokada sald) + produkcja + operacje dodatkowe + audyt.
 */
@Injectable()
export class OperationsService {
  constructor(private readonly db: PrismaService, private readonly ledger: LedgerService, private readonly audit: AuditService, private readonly settings: SettingsService) {}

  /** Podgląd przed zatwierdzeniem: plan + numery + stan przed / po (bez zapisu, bez blokad). */
  async preview(actor: AuthUser, input: OperationInput) {
    const { plan } = await this.prepare(this.db, actor, input);
    const balances = new Map<string, string>();
    for (const m of plan.movements) {
      const b = await this.db.stockBalance.findUnique({ where: { warehouseId_materialId: { warehouseId: m.warehouseId, materialId: m.materialId } } });
      balances.set(balanceKey(m.warehouseId, m.materialId), b?.qty.toString() ?? "0");
    }
    const sim = simulate(balances, plan.movements);
    if (plan.numbering.mode === "MANUAL" && plan.numbering.number) {
      // wczesna informacja przy polu; ostateczne sprawdzenie i tak następuje pod blokadą przy zapisie
      const year = Number(plan.documentDate.slice(0, 4));
      const type = plan.documents[this.mainIndex(plan)]!.type;
      if (await this.numberTaken(this.db, type, plan.warehouseId, year, plan.numbering.number)) {
        const wh = await this.db.warehouse.findUnique({ where: { id: plan.warehouseId }, select: { name: true } });
        throw invalid([{ field: "numbering.number", message: `Numer ${plan.numbering.number} jest już użyty w magazynie ${wh?.name ?? ""} w roku ${year}` }]);
      }
    }
    const numbers = await Promise.all(plan.documents.map(async (d, i) => (i === this.mainIndex(plan) && plan.numbering.mode === "MANUAL" ? plan.numbering.number : this.nextNumber(this.db, d.type, plan.warehouseId, plan.date, Number(plan.documentDate.slice(0, 4))))));
    const shortages = await Promise.all(sim.shortages.map(async s => {
      const m = await this.db.material.findUnique({ where: { id: s.materialId }, select: { name: true, stockUnit: true } });
      return { ...s, message: shortageMessage(s, m?.name ?? "materiał", (m?.stockUnit ?? "T") as Unit) };
    }));
    return { plan, numbers, steps: sim.steps, shortages };
  }

  async create(actor: AuthUser, input: OperationInput, idempotencyKey: string, meta: RequestMeta) {
    const existing = await this.db.operation.findUnique({ where: { idempotencyKey } });
    if (existing) {
      // powtórzone wysłanie formularza (podwójne kliknięcie, ponowienie po zerwaniu połączenia) — ta sama operacja
      if (existing.createdById !== actor.id) throw conflict("IDEMPOTENCY_KEY", "Ten identyfikator żądania został już użyty.");
      return this.get(actor, existing.id);
    }
    let opId: string;
    try {
      opId = await this.db.$transaction(async tx => {
        // równoczesne żądania z tym samym kluczem czekają na siebie — drugie zwraca operację utworzoną przez pierwsze
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`idem:${idempotencyKey}`}))`;
        const dup = await tx.operation.findUnique({ where: { idempotencyKey }, select: { id: true, createdById: true } });
        if (dup) { if (dup.createdById !== actor.id) throw conflict("IDEMPOTENCY_KEY", "Ten identyfikator żądania został już użyty."); return dup.id; }
        const { plan } = await this.prepare(tx, actor, input);
        const main = this.mainIndex(plan);
        const numbers: string[] = [];
        for (const [i, d] of plan.documents.entries()) {
          // numeracja szeregowana blokadą doradczą (typ + magazyn + rok) — dwa równoczesne zapisy nie dostaną tego samego numeru
          const year = Number(plan.documentDate.slice(0, 4));
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`docno:${d.type}:${plan.warehouseId}:${year}`}))`;
          if (i === main && plan.numbering.mode === "MANUAL") {
            const n = plan.numbering.number!;
            if (await this.numberTaken(tx, d.type, plan.warehouseId, year, n)) {
              const wh = await tx.warehouse.findUnique({ where: { id: plan.warehouseId }, select: { name: true } });
              throw invalid([{ field: "numbering.number", message: `Numer ${n} jest już użyty w magazynie ${wh?.name ?? ""} w roku ${year}` }]);
            }
            numbers.push(n);
          } else numbers.push(await this.nextNumber(tx, d.type, plan.warehouseId, plan.date, year));
        }
        const now = new Date();
        const op = await tx.operation.create({ data: {
          type: plan.type, status: "POSTED", warehouseId: plan.warehouseId, operationDate: asDate(plan.date), idempotencyKey,
          targetWarehouseId: plan.transfer?.targetWarehouseId ?? null, transferState: plan.transfer ? (plan.transfer.twoStage ? "IN_TRANSIT" : "RECEIVED") : null,
          notes: input.notes?.trim() || null, purchaseCost: plan.totals.purchaseCost, revenue: plan.totals.revenue, chippingCost: plan.totals.chippingCost,
          additionalCost: plan.totals.additionalCost, input: input as unknown as Prisma.InputJsonValue, createdById: actor.id, postedAt: now, postedById: actor.id,
        } });
        const docs: Array<{ doc: { id: string }; lines: Array<{ id: string }> }> = [];
        for (const [i, d] of plan.documents.entries()) {
          const doc = await tx.document.create({ data: {
            operationId: op.id, type: d.type, number: numbers[i]!, year: Number(plan.documentDate.slice(0, 4)), warehouseId: plan.warehouseId,
            documentDate: asDate(plan.documentDate), movementDate: asDate(plan.date), partnerId: d.partnerId, externalNumber: input.externalNumber?.trim() || null, createdById: actor.id,
          } });
          const lines: Array<{ id: string }> = [];
          for (const [j, l] of d.lines.entries()) {
            lines.push(await tx.documentLine.create({ data: {
              documentId: doc.id, lineNo: j + 1, materialId: l.materialId, qtySource: l.qtySource, unitSource: l.unitSource, qtyStock: l.qtyStock, unitStock: l.unitStock,
              conversionFactor: l.factor, conversionSource: l.source, weightT: l.weightT, weightSource: l.weightSource, unitPrice: l.unitPrice, priceUnit: l.priceUnit, value: l.value,
            } }));
          }
          docs.push({ doc, lines });
        }
        await this.ledger.post(tx, { operationId: op.id, movementDate: asDate(plan.date), createdById: actor.id, movements: plan.movements.map(m => ({
          warehouseId: m.warehouseId, materialId: m.materialId, qty: m.qty, kind: m.kind, documentId: docs[m.doc]!.doc.id, documentLineId: docs[m.doc]!.lines[m.line]!.id,
        })) });
        if (plan.production && input.type === "PRODUCTION") {
          await tx.productionRun.create({ data: {
            operationId: op.id, mode: "FROM_STOCK", rawMaterialId: plan.production.rawMaterialId, outMaterialId: plan.production.outMaterialId, consumeQty: plan.production.consumeQty,
            outQty: plan.production.outQty, factor: plan.production.factor, chipRate: plan.production.chipRate, chippingCost: plan.production.chippingCost,
            chipperId: input.chipperId || null, operatorId: input.operatorId || null,
          } });
        }
        for (const x of plan.extras) {
          await tx.additionalOperation.create({ data: { operationId: op.id, typeId: x.typeId, warehouseId: plan.warehouseId, vehicleId: x.vehicleId, performedOn: asDate(plan.date),
            quantity: x.quantity, cost: x.cost, description: x.description, createdById: actor.id } });
        }
        await this.audit.log(tx, actor, meta, { action: "OPERATION_CREATED", entity: "operation", entityId: op.id, warehouseId: plan.warehouseId,
          after: { rodzaj: plan.type, dokumenty: numbers, data: plan.date, kwoty: plan.totals, operacjeDodatkowe: plan.extras.length,
            ...(plan.transfer ? { magazynDocelowy: plan.transfer.targetWarehouseId, mm: plan.transfer.twoStage ? "dwuetapowe — w drodze" : "jednoetapowe — przyjęte" } : {}) } });
        return op.id;
      }, { timeout: 20_000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const op = await this.db.operation.findUnique({ where: { idempotencyKey } });
        if (op && op.createdById === actor.id) return this.get(actor, op.id);
        throw invalid([{ field: "numbering.number", message: "Ten numer dokumentu jest już użyty w tym magazynie i roku" }]);
      }
      if (isNegativeStockViolation(e)) throw new AppError(HttpStatus.CONFLICT, "STOCK_INSUFFICIENT", "Operacja zmniejszyłaby stan poniżej zera.");
      throw e;
    }
    return this.get(actor, opId);
  }

  async get(actor: AuthUser, id: string) {
    const op = await this.db.operation.findUnique({ where: { id }, include: {
      warehouse: true, documents: { include: { lines: { include: { material: true } }, partner: true }, orderBy: { createdAt: "asc" } },
      movements: { orderBy: { seq: "asc" } }, productionRun: { include: { chipper: true, operator: true } }, additionalOperations: { include: { type: true, vehicle: true } },
      targetWarehouse: true, transferReceipt: true,
    } });
    // MM widzi także magazyn docelowy (przyjęcie); pozostałe operacje — tylko magazyn operacji
    if (!op || !(canAccessWarehouse(actor, op.warehouseId) || (op.targetWarehouseId && canAccessWarehouse(actor, op.targetWarehouseId)))) throw notFound("Nie znaleziono operacji.");
    const userIds = [op.createdById, ...(op.transferReceipt ? [op.transferReceipt.createdById] : [])];
    const users = new Map((await this.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })).map(u => [u.id, displayName(u)]));
    const rc = op.transferReceipt;
    const S = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? null : v.toString());
    return {
      id: op.id, type: op.type, status: op.status, warehouse: { id: op.warehouse.id, code: op.warehouse.code, name: op.warehouse.name }, operationDate: isoDay(op.operationDate),
      notes: op.notes, createdAt: op.createdAt, createdBy: users.get(op.createdById) ?? null, version: op.version,
      totals: { purchaseCost: S(op.purchaseCost), revenue: S(op.revenue), chippingCost: S(op.chippingCost), additionalCost: S(op.additionalCost), transportCost: S(op.transportCost) },
      documents: op.documents.map(d => ({ id: d.id, type: d.type, number: d.number, documentDate: isoDay(d.documentDate), movementDate: isoDay(d.movementDate), externalNumber: d.externalNumber,
        partner: d.partner ? { id: d.partner.id, name: d.partner.name } : null,
        lines: d.lines.map(l => ({ lineNo: l.lineNo, material: { id: l.material.id, code: l.material.code, name: l.material.name }, qtySource: S(l.qtySource), unitSource: l.unitSource,
          qtyStock: S(l.qtyStock), unitStock: l.unitStock, factor: S(l.conversionFactor), source: l.conversionSource, weightT: S(l.weightT), weightSource: l.weightSource,
          unitPrice: S(l.unitPrice), priceUnit: l.priceUnit, value: S(l.value) })) })),
      production: op.productionRun ? { consumeQty: S(op.productionRun.consumeQty), outQty: S(op.productionRun.outQty), factor: S(op.productionRun.factor), chipRate: S(op.productionRun.chipRate),
        chippingCost: S(op.productionRun.chippingCost), chipper: op.productionRun.chipper?.name ?? null, operator: op.productionRun.operator?.name ?? op.productionRun.chipper?.externalOperator ?? null } : null,
      extras: op.additionalOperations.map(x => ({ id: x.id, type: x.type.name, vehicle: x.vehicle ? `${x.vehicle.registration} · ${x.vehicle.name}` : null, quantity: S(x.quantity), cost: S(x.cost), description: x.description })),
      movements: op.movements.map(m => ({ warehouseId: m.warehouseId, materialId: m.materialId, kind: m.kind, qty: m.qty.toString(), movementDate: isoDay(m.movementDate) })),
      transfer: op.type === "TRANSFER" && op.targetWarehouse ? {
        target: { id: op.targetWarehouse.id, code: op.targetWarehouse.code, name: op.targetWarehouse.name }, state: op.transferState,
        twoStage: !!rc || op.transferState === "IN_TRANSIT",
        receipt: rc ? { date: isoDay(rc.receivedDate), qty: S(rc.qty), unit: rc.unit, qtyStock: S(rc.qtyStock), diffStock: S(rc.diffStock), reason: rc.reason,
          reasonLabel: rc.reason ? (MM_DIFF_REASONS as Record<string, string>)[rc.reason] ?? rc.reason : null, note: rc.note, weightT: S(rc.weightT), weightSource: rc.weightSource,
          createdAt: rc.createdAt, createdBy: users.get(rc.createdById) ?? null } : null,
      } : null,
    };
  }

  /** Rejestr dokumentów: domyślnie PZ / WZ / MM (dokumenty pomocnicze RW, PW, BO — na żądanie). */
  async register(actor: AuthUser, q: { warehouseId: string; type?: string; from?: string; to?: string; q?: string; aux?: boolean; page: number; pageSize: number }) {
    if (!canAccessWarehouse(actor, q.warehouseId)) throw forbidden("Nie masz dostępu do tego magazynu.", "WAREHOUSE_FORBIDDEN");
    const MAIN = ["PZ", "WZ", "MM"] as const;
    const types = q.type ? [q.type] : q.aux ? undefined : [...MAIN];
    const where: Prisma.DocumentWhereInput = {
      // MM jest w rejestrze magazynu źródłowego i docelowego
      OR: [{ warehouseId: q.warehouseId }, { type: "MM", operation: { targetWarehouseId: q.warehouseId } }],
      ...(types ? { type: { in: types as DocumentType[] } } : {}),
      ...(q.from || q.to ? { movementDate: { ...(q.from ? { gte: asDate(q.from) } : {}), ...(q.to ? { lte: asDate(q.to) } : {}) } } : {}),
      ...(q.q?.trim() ? { AND: [{ OR: [{ number: { contains: q.q.trim(), mode: "insensitive" } }, { partner: { name: { contains: q.q.trim(), mode: "insensitive" } } }, { externalNumber: { contains: q.q.trim(), mode: "insensitive" } }] }] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.db.document.count({ where }),
      this.db.document.findMany({ where, include: { partner: true, lines: { include: { material: true } }, operation: { select: { id: true, type: true, status: true, transferState: true, warehouse: { select: { id: true, name: true } }, targetWarehouse: { select: { id: true, name: true } } } } },
        orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { total, rows: rows.map(d => ({
      id: d.id, type: d.type, number: d.number, documentDate: isoDay(d.documentDate), movementDate: isoDay(d.movementDate), createdAt: d.createdAt,
      partner: d.partner?.name ?? null, operationId: d.operationId, operationType: d.operation.type, status: d.operation.status, externalNumber: d.externalNumber,
      transfer: d.type === "MM" && d.operation.targetWarehouse ? { from: d.operation.warehouse.name, to: d.operation.targetWarehouse.name, state: d.operation.transferState,
        direction: d.operation.targetWarehouse.id === q.warehouseId ? "IN" : "OUT" } : null,
      lines: d.lines.map(l => ({ material: l.material.name, qtySource: l.qtySource.toString(), unitSource: l.unitSource, qtyStock: l.qtyStock.toString(), unitStock: l.unitStock,
        weightT: l.weightT?.toString() ?? null, weightSource: l.weightSource, value: l.value?.toString() ?? null })),
      value: d.lines.reduce((a, l) => a.plus(l.value ?? 0), new Prisma.Decimal(0)).toString(),
    })) };
  }

  /** Dane formularza: kontrahenci, materiały, rodzaje operacji dodatkowych, pojazdy i rębaki magazynu, operatorzy, stany. */
  async formData(actor: AuthUser, warehouseId: string) {
    if (!canAccessWarehouse(actor, warehouseId)) throw forbidden("Nie masz dostępu do tego magazynu.", "WAREHOUSE_FORBIDDEN");
    const fleetWh = { OR: [{ warehouseId: null }, { warehouseId }] };
    const [partners, materials, extraTypes, vehicles, chippers, operators, balances] = await Promise.all([
      this.db.partner.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
      this.db.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      this.db.additionalOperationType.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      this.db.vehicle.findMany({ where: { status: { not: "RETIRED" }, ...fleetWh }, orderBy: { registration: "asc" }, select: { id: true, name: true, registration: true } }),
      this.db.chipper.findMany({ where: { status: { not: "RETIRED" }, ...fleetWh }, orderBy: { name: "asc" }, include: { externalCompany: true } }),
      this.db.operator.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      this.db.stockBalance.findMany({ where: { warehouseId } }),
    ]);
    return {
      partners, operators, vehicles,
      materials: materials.map(m => ({ ...materialUnits(m), code: m.code, category: m.category })),
      extraTypes: extraTypes.map(t => ({ id: t.id, name: t.name, active: t.active, unit: t.unit, defaultRate: t.defaultRate?.toString() ?? null })),
      chippers: chippers.map(c => ({ id: c.id, name: c.name, ownership: c.ownership, company: c.externalCompany?.name ?? null, operatorId: c.operatorId, externalOperator: c.externalOperator })),
      balances: Object.fromEntries(balances.map(b => [b.materialId, b.qty.toString()])),
      rates: await companyRates(this.db, asDate(todayWarsaw())),
      today: todayWarsaw(),
      // MM: cel może być dowolnym aktywnym magazynem firmy (przyjmuje go użytkownik magazynu docelowego)
      warehouses: await this.db.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
      mmTwoStage: (await this.settings.get("mm.mode")) !== "one",
    };
  }

  /**
   * Przyjęcie MM dwuetapowego w magazynie docelowym: blokada wiersza operacji (dwa równoczesne przyjęcia — drugie
   * widzi stan „przyjęte”), reguły domeny (planReceipt), ruch TRANSFER_IN w księdze, zapis przyjęcia, stan RECEIVED, audyt.
   * Powtórzenie z tym samym kluczem idempotencji zwraca operację bez drugiego ruchu.
   */
  async receive(actor: AuthUser, id: string, input: ReceiptInput, idempotencyKey: string, meta: RequestMeta) {
    const done = await this.db.transferReceipt.findUnique({ where: { idempotencyKey } });
    if (done) {
      if (done.operationId !== id || done.createdById !== actor.id) throw conflict("IDEMPOTENCY_KEY", "Ten identyfikator żądania został już użyty.");
      return this.get(actor, id);
    }
    if (!can(actor, "mm.receive")) throw forbidden("Nie masz uprawnień do przyjmowania MM.");
    try {
      await this.db.$transaction(async tx => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "operations" WHERE "id" = ${id}::uuid FOR UPDATE`;
        if (!locked.length) throw notFound("Nie znaleziono dokumentu MM.");
        const dup = await tx.transferReceipt.findUnique({ where: { idempotencyKey } });
        if (dup) return;
        const op = await tx.operation.findUnique({ where: { id }, include: { documents: { where: { type: "MM" }, include: { lines: { include: { material: true } } } }, targetWarehouse: true } });
        if (!op || op.type !== "TRANSFER" || !op.targetWarehouse) throw notFound("Nie znaleziono dokumentu MM.");
        const doc = op.documents[0], line = doc?.lines[0];
        if (!doc || !line) throw notFound("Nie znaleziono dokumentu MM.");
        if (!canAccessWarehouse(actor, op.targetWarehouse.id)) throw forbidden(`MM przyjmuje użytkownik magazynu docelowego (${op.targetWarehouse.name}) albo Administrator.`, "WAREHOUSE_FORBIDDEN");
        if (op.status !== "POSTED") throw conflict("MM_NOT_POSTED", `Dokument ${doc.number} nie jest zatwierdzony — nie można go przyjąć.`);
        if (op.transferState === "RECEIVED") {
          const prev = await tx.transferReceipt.findUnique({ where: { operationId: op.id } });
          throw conflict("MM_RECEIVED", prev ? `Dokument ${doc.number} został już przyjęty (${isoDay(prev.receivedDate)}).` : `Dokument ${doc.number} został przyjęty automatycznie (MM jednoetapowe).`);
        }
        const rates = await companyRates(tx, asDate(todayWarsaw()));
        const r = planReceipt(input, { material: { ...materialUnits(line.material), name: line.material.name }, sentQtyStock: line.qtyStock.toString(), sentDate: isoDay(op.operationDate),
          sentUnit: line.unitSource, today: todayWarsaw(), rates });
        if (!r.ok) throw invalid(r.errors);
        const closed = await tx.inventoryPeriod.findFirst({ where: { warehouseId: op.targetWarehouse.id, period: r.plan.date.slice(0, 7), status: "CLOSED" } });
        if (closed) throw invalid([{ field: "date", message: `W magazynie ${op.targetWarehouse.name} okres ${closed.period} jest zamknięty` }]);
        if (Number(r.plan.qtyStock) > 0) {
          await this.ledger.post(tx, { operationId: op.id, movementDate: asDate(r.plan.date), createdById: actor.id, movements: [
            { warehouseId: op.targetWarehouse.id, materialId: line.materialId, qty: r.plan.qtyStock, kind: "TRANSFER_IN", documentId: doc.id, documentLineId: line.id },
          ] });
        }
        await tx.transferReceipt.create({ data: {
          operationId: op.id, receivedDate: asDate(r.plan.date), qty: r.plan.qtySource, unit: r.plan.unitSource, qtyStock: r.plan.qtyStock, diffStock: r.plan.diffStock,
          reason: r.plan.reason, note: r.plan.note, weightT: r.plan.weightT, weightSource: r.plan.weightSource, idempotencyKey, createdById: actor.id,
        } });
        await tx.operation.update({ where: { id: op.id }, data: { transferState: "RECEIVED", version: { increment: 1 } } });
        await this.audit.log(tx, actor, meta, { action: "MM_RECEIVED", entity: "operation", entityId: op.id, warehouseId: op.targetWarehouse.id,
          before: { mm: "w drodze", wyslano: line.qtyStock.toString() },
          after: { mm: "przyjęte", dokument: doc.number, przyjeto: r.plan.qtyStock, roznica: r.plan.diffStock, przyczyna: r.plan.reason ? MM_DIFF_REASONS[r.plan.reason] : null, opis: r.plan.note, data: r.plan.date, tonaz: r.plan.weightT } });
      }, { timeout: 20_000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const rc = await this.db.transferReceipt.findUnique({ where: { idempotencyKey } });
        if (rc && rc.operationId === id && rc.createdById === actor.id) return this.get(actor, id);
        throw conflict("MM_RECEIVED", "Dokument MM został już przyjęty.");
      }
      throw e;
    }
    return this.get(actor, id);
  }

  /** MM w drodze (dwuetapowe, nieprzyjęte) dla magazynu: IN — do przyjęcia, OUT — wysłane. */
  async inTransit(actor: AuthUser, warehouseId: string) {
    if (!canAccessWarehouse(actor, warehouseId)) throw forbidden("Nie masz dostępu do tego magazynu.", "WAREHOUSE_FORBIDDEN");
    const ops = await this.db.operation.findMany({
      where: { type: "TRANSFER", status: "POSTED", transferState: "IN_TRANSIT", OR: [{ warehouseId }, { targetWarehouseId: warehouseId }] },
      include: { warehouse: true, targetWarehouse: true, documents: { where: { type: "MM" }, include: { lines: { include: { material: true } } } } },
      orderBy: [{ operationDate: "asc" }, { createdAt: "asc" }],
    });
    return ops.map(op => {
      const d = op.documents[0], l = d?.lines[0];
      return { operationId: op.id, number: d?.number ?? "", date: isoDay(op.operationDate), direction: op.targetWarehouseId === warehouseId ? "IN" as const : "OUT" as const,
        from: { id: op.warehouse.id, name: op.warehouse.name }, to: { id: op.targetWarehouse?.id ?? "", name: op.targetWarehouse?.name ?? "" },
        material: l ? { id: l.material.id, name: l.material.name, stockUnit: l.material.stockUnit, allowedUnits: l.material.allowedUnits } : null,
        qtySource: l?.qtySource.toString() ?? "0", unitSource: l?.unitSource ?? "T", qtyStock: l?.qtyStock.toString() ?? "0", weightT: l?.weightT?.toString() ?? null };
    });
  }

  /** Kolejny numer automatyczny (podgląd albo rezerwacja w transakcji pod blokadą). */
  async nextNumber(db: Db, type: string, warehouseId: string, date: string, year = Number(date.slice(0, 4))): Promise<string> {
    const month = await db.document.count({ where: { type: type as never, warehouseId, movementDate: { gte: asDate(`${date.slice(0, 7)}-01`), lt: asDate(nextMonth(date)) } } });
    for (let seq = month + 1; seq < month + 1000; seq++) {
      const n = autoNumber(type, seq, date);
      if (!(await this.numberTaken(db, type, warehouseId, year, n))) return n;
    }
    throw conflict("NUMBERING", "Nie można nadać numeru dokumentu.");
  }

  private async numberTaken(db: Db, type: string, warehouseId: string, year: number, n: string): Promise<boolean> {
    const rows = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "documents" WHERE "type"::text = ${type} AND "warehouse_id" = ${warehouseId}::uuid AND "year" = ${year}
      AND upper(regexp_replace("number", '\\s', '', 'g')) = ${normalizeDocNumber(n)}`;
    return Number(rows[0]?.n ?? 0) > 0;
  }

  private mainIndex(plan: OperationPlan) { return Math.max(0, plan.documents.findIndex(d => d.main)); }

  /** Uprawnienia, magazyn, okres, kartoteki — i plan z reguł domeny. */
  private async prepare(db: Db, actor: AuthUser, input: OperationInput): Promise<{ plan: OperationPlan }> {
    if (!PERM[input.type]) throw badRequest("VALIDATION", "Nieznany rodzaj operacji");
    if (!can(actor, PERM[input.type]!)) throw forbidden("Nie masz uprawnień do tego rodzaju operacji.");
    if ((input.extras ?? []).length && !can(actor, "additional.create")) throw forbidden("Nie masz uprawnień do operacji dodatkowych.");
    const wh = await db.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!wh || !canAccessWarehouse(actor, wh.id)) throw forbidden("Nie masz dostępu do tego magazynu.", "WAREHOUSE_FORBIDDEN");
    if (!wh.active) throw badRequest("WAREHOUSE_INACTIVE", `Magazyn ${wh.name} jest nieaktywny.`);
    const today = todayWarsaw();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "") ? input.date : today;
    const closed = await db.inventoryPeriod.findFirst({ where: { warehouseId: wh.id, period: day.slice(0, 7), status: "CLOSED" } });
    if (closed) throw invalid([{ field: "date", message: `Okres ${closed.period} jest zamknięty — zmiany tylko przez korektę z bieżącą datą` }]);

    const [materials, extraTypes, rates, mmMode] = await Promise.all([
      db.material.findMany(), db.additionalOperationType.findMany(), companyRates(db, asDate(day)), this.settings.get("mm.mode"),
    ]);
    const twoStage = mmMode !== "one";
    const targetErrors: Array<{ field: string; message: string }> = [];
    if (input.type === "TRANSFER" && input.targetWarehouseId && input.targetWarehouseId !== wh.id) {
      const tw = isUuid(input.targetWarehouseId) ? await db.warehouse.findUnique({ where: { id: input.targetWarehouseId } }) : null;
      if (!tw) targetErrors.push({ field: "targetWarehouseId", message: "Nieznany magazyn docelowy" });
      else if (!tw.active) targetErrors.push({ field: "targetWarehouseId", message: `Magazyn docelowy ${tw.name} jest nieaktywny` });
      else if (!twoStage) {
        // jednoetapowe: przychód w celu z datą operacji — okres celu musi być otwarty
        const tc = await db.inventoryPeriod.findFirst({ where: { warehouseId: tw.id, period: day.slice(0, 7), status: "CLOSED" } });
        if (tc) targetErrors.push({ field: "date", message: `W magazynie ${tw.name} okres ${tc.period} jest zamknięty` });
      }
    }
    const ctx: PlanContext = {
      materials: new Map(materials.map(m => [m.id, { ...materialUnits(m), category: m.category }])),
      extraTypes: new Map(extraTypes.map(t => [t.id, { id: t.id, name: t.name, active: t.active, unit: t.unit, defaultRate: t.defaultRate?.toString() ?? null }])),
      rates, today, transferTwoStage: twoStage,
    };
    const r = planOperation(input, ctx);
    const errors = [...(r.ok ? [] : r.errors), ...targetErrors];
    // kartoteki: kontrahent we właściwej roli, pojazdy operacji dodatkowych i rębak z dostępnych magazynów
    if (input.type === "PURCHASE" || input.type === "SALE") {
      const p = input.partnerId ? await db.partner.findUnique({ where: { id: isUuid(input.partnerId) ? input.partnerId : "00000000-0000-0000-0000-000000000000" } }) : null;
      const okRole = input.type === "PURCHASE" ? ["SUPPLIER", "BOTH"] : ["BUYER", "BOTH"];
      if (input.partnerId && (!p || !p.active)) errors.push({ field: "partnerId", message: "Wybierz aktywnego kontrahenta z kartoteki" });
      else if (p && !okRole.includes(p.role)) errors.push({ field: "partnerId", message: input.type === "PURCHASE" ? `„${p.name}” nie jest dostawcą` : `„${p.name}” nie jest odbiorcą` });
    }
    for (const [i, x] of (input.extras ?? []).entries()) {
      if (!x.vehicleId) continue;
      const v = isUuid(x.vehicleId) ? await db.vehicle.findUnique({ where: { id: x.vehicleId } }) : null;
      if (!v || v.status === "RETIRED" || (v.warehouseId && !canAccessWarehouse(actor, v.warehouseId))) errors.push({ field: `extras.${i}.vehicleId`, message: "Wybierz pojazd z floty tego magazynu" });
    }
    if (input.type === "PRODUCTION") {
      if (input.chipperId) {
        const c = isUuid(input.chipperId) ? await db.chipper.findUnique({ where: { id: input.chipperId } }) : null;
        if (!c || c.status === "RETIRED" || (c.warehouseId && c.warehouseId !== wh.id)) errors.push({ field: "chipperId", message: "Wybierz rębak tego magazynu (własny albo firmy zewnętrznej)" });
      }
      if (input.operatorId && !(isUuid(input.operatorId) && await db.operator.findUnique({ where: { id: input.operatorId } }))) errors.push({ field: "operatorId", message: "Nie znaleziono operatora" });
    }
    if (errors.length || !r.ok) throw invalid(errors);
    return { plan: r.plan };
  }
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
function nextMonth(date: string): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
