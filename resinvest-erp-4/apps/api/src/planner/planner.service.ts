import { Injectable } from "@nestjs/common";
import { plannerDays, plannerDrivers, plannerTotals, type PlannerOp, type PlannerPlan } from "@resinvest/domain";
import { Prisma } from "../generated/prisma/client.js";
import { badRequest, conflict, forbidden } from "../common/errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { can, canAccessWarehouse, type AuthUser } from "../auth/auth-user.js";
import { companyRates } from "../stock/materials.js";
import { todayWarsaw } from "../opening/opening.service.js";

const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const MAX_RANGE_DAYS = 400;

/**
 * Planer zakupów (F4c). Plan dzienny — jedyna wartość wpisywana ręcznie (purchase_plans, audyt PLAN_UPDATED).
 * Wykonanie, tony, ceny, km, transport i kursy — z zatwierdzonych operacji zakupu (reguły w pakiecie domeny: plannerDays).
 * Operacje planera: zakup z produkcją (PW z zakupu), sprzedaż bezpośrednia (produkcja w lesie), zakup materiału w MP.
 */
@Injectable()
export class PlannerService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {}

  /** Magazyny zakresu: jeden (z kontrolą dostępu) albo wszystkie dostępne użytkownikowi („ALL”). */
  private async scope(actor: AuthUser, warehouseId: string): Promise<string[]> {
    if (warehouseId === "ALL") {
      const whs = await this.db.warehouse.findMany({ where: { active: true }, select: { id: true } });
      return whs.map(w => w.id).filter(id => canAccessWarehouse(actor, id));
    }
    if (!canAccessWarehouse(actor, warehouseId)) throw forbidden("Nie masz dostępu do tego magazynu.", "WAREHOUSE_FORBIDDEN");
    return [warehouseId];
  }

  async view(actor: AuthUser, q: { warehouseId: string; from: string; to: string }) {
    if (q.from > q.to) throw badRequest("VALIDATION", "Data „od” jest późniejsza niż „do”.");
    if ((asDate(q.to).getTime() - asDate(q.from).getTime()) / 864e5 > MAX_RANGE_DAYS) throw badRequest("VALIDATION", `Zakres planera: maksymalnie ${MAX_RANGE_DAYS} dni.`);
    const whs = await this.scope(actor, q.warehouseId);
    const today = todayWarsaw();
    const [ops, plans, rates] = await Promise.all([this.ops(whs, q.from, q.to), this.plans(whs, q.from, q.to), companyRates(this.db, asDate(today))]);
    const days = plannerDays(q.from, q.to, ops, plans, today, rates);
    return {
      warehouses: whs, today, tonPerMp: String(rates.tonPerMp),
      editable: q.warehouseId !== "ALL" && can(actor, "planner.edit"),
      days, totals: plannerTotals(days), drivers: plannerDrivers(ops),
      plans: plans.map(p => ({ date: p.date, warehouseId: p.warehouseId, planMp: p.planMp, note: p.note, version: p.version })),
      ops,
    };
  }

  /** Plan dnia: zapis / zmiana (wersja chroni przed nadpisaniem cudzej zmiany), audyt było / jest. */
  async savePlan(actor: AuthUser, input: { warehouseId: string; date: string; planMp: string; note?: string | null; version?: number | null }, meta: RequestMeta) {
    if (!can(actor, "planner.edit")) throw forbidden("Nie masz uprawnień do planu zakupów.");
    if (!canAccessWarehouse(actor, input.warehouseId)) throw forbidden("Nie masz dostępu do tego magazynu.", "WAREHOUSE_FORBIDDEN");
    const note = input.note?.trim().slice(0, 500) || null;
    return this.db.$transaction(async tx => {
      const prev = await tx.purchasePlan.findUnique({ where: { warehouseId_day: { warehouseId: input.warehouseId, day: asDate(input.date) } } });
      if (prev && input.version !== null && input.version !== undefined && input.version !== prev.version)
        throw conflict("VERSION_CONFLICT", "Plan tego dnia zmienił ktoś inny — odśwież planer i wprowadź zmianę ponownie.");
      const saved = prev
        ? await tx.purchasePlan.update({ where: { id: prev.id }, data: { planMp: input.planMp, note, updatedById: actor.id, version: { increment: 1 } } })
        : await tx.purchasePlan.create({ data: { warehouseId: input.warehouseId, day: asDate(input.date), planMp: input.planMp, note, createdById: actor.id, updatedById: actor.id } });
      await this.audit.log(tx, actor, meta, { action: "PLAN_UPDATED", entity: "purchase_plan", entityId: saved.id, warehouseId: input.warehouseId,
        before: prev ? { dzien: input.date, planMP: prev.planMp.toString(), uwagi: prev.note } : null,
        after: { dzien: input.date, planMP: saved.planMp.toString(), uwagi: saved.note } });
      return { date: input.date, warehouseId: saved.warehouseId, planMp: saved.planMp.toString(), note: saved.note, version: saved.version };
    });
  }

  private async plans(whs: string[], from: string, to: string): Promise<Array<PlannerPlan & { version: number }>> {
    const rows = await this.db.purchasePlan.findMany({ where: { warehouseId: { in: whs }, day: { gte: asDate(from), lte: asDate(to) } }, orderBy: { day: "asc" } });
    return rows.map(r => ({ warehouseId: r.warehouseId, date: isoDay(r.day), planMp: r.planMp.toString(), note: r.note, version: r.version }));
  }

  /** Operacje zakupu w zakresie → wejście reguł planera (ilość MP, koszt zakupu, miejsce, kursy, dokumenty). */
  private async ops(whs: string[], from: string, to: string): Promise<PlannerOp[]> {
    const rows = await this.db.operation.findMany({
      where: { warehouseId: { in: whs }, status: "POSTED", type: { in: ["PURCHASE", "SALE"] }, operationDate: { gte: asDate(from), lte: asDate(to) } },
      include: {
        productionRun: true, documents: { include: { lines: { select: { qtyStock: true, unitStock: true } } }, orderBy: { createdAt: "asc" } },
        transportRuns: { include: { vehicle: { select: { registration: true } }, driver: { select: { name: true } }, externalCompany: { select: { name: true } } }, orderBy: { runNo: "asc" } },
      },
      orderBy: [{ operationDate: "asc" }, { createdAt: "asc" }],
    });
    const out: PlannerOp[] = [];
    for (const o of rows) {
      const pr = o.productionRun;
      let mp: Prisma.Decimal | null = null;
      if (pr && (pr.mode === "FROM_PURCHASE" || pr.mode === "DIRECT")) mp = pr.outQty;
      else if (o.type === "PURCHASE") {
        // zakup materiału prowadzonego w MP (np. zrębka towarowa)
        const l = o.documents.find(d => d.type === "PZ")?.lines[0];
        if (l && l.unitStock === "MP") mp = l.qtyStock;
      }
      if (!mp) continue;
      const place = o.place ?? (pr?.forestDistrict ? `Nadl. ${pr.forestDistrict}${pr.forestry ? ` · leśn. ${pr.forestry}` : ""}` : pr?.investSite ?? null);
      out.push({
        id: o.id, warehouseId: o.warehouseId, date: isoDay(o.operationDate), mp: mp.toString(), purchaseCost: o.purchaseCost.toString(), place,
        documents: o.documents.map(d => ({ type: d.type, number: d.number })),
        runs: o.transportRuns.map(r => ({
          qty: r.qty?.toString() ?? null, weightT: r.weightT?.toString() ?? null, km: r.km.toString(), cost: r.cost.toString(),
          driver: r.driver?.name ?? r.driverName ?? null, registration: r.vehicle?.registration ?? r.registration ?? null, company: r.externalCompany?.name ?? null,
        })),
      });
    }
    return out;
  }
}
