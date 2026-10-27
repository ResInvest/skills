import { Injectable } from "@nestjs/common";
import {
  consistencyCheck, extrasByType, MONTH_NAMES, stockTurnover, yearSummary, periodBounds, TURNOVER_LABEL, UNIT_LABEL,
  type TurnoverMovement, type TurnoverRow, type Unit,
} from "@resinvest/domain";
import { Prisma } from "../generated/prisma/client.js";
import { badRequest, forbidden } from "../common/errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { can, canAccessWarehouse, displayName, type AuthUser } from "../auth/auth-user.js";
import { todayWarsaw } from "../opening/opening.service.js";
import { OperationsService } from "../operations/operations.service.js";
import { renderReport, type ExportFormat, type ReportTable } from "./export.js";

const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const nextDay = (iso: string) => new Date(asDate(iso).getTime() + 864e5);
export const MAX_TURNOVER_DAYS = 3700;   // ok. 10 lat — raport wieloletni nadal w jednym zapytaniu
const OP_TYPES = ["PURCHASE", "SALE", "PRODUCTION", "TRANSFER"] as const;
const OP_LABEL: Record<string, string> = { PURCHASE: "Zakup", SALE: "Sprzedaż", PRODUCTION: "Produkcja", TRANSFER: "Przesunięcie MM", OPENING_BALANCE: "Bilans otwarcia", INVENTORY: "Inwentaryzacja" };

export type ReportKind = "turnover" | "summary" | "documents";
export interface ExportQuery { report: ReportKind; format: ExportFormat; warehouseId: string; from?: string; to?: string; year?: number; type?: string; q?: string; aux?: boolean }

/**
 * F6 — raporty z księgi ruchów i operacji (tylko odczyt): obroty magazynowe za dowolny okres z kontrolą spójności,
 * zestawienie miesięczne i roczne, pulpit miesiąca (z kaflem „Operacje dodatkowe”), eksport do CSV / XLSX / PDF / DOCX.
 * Zakres magazynów: jeden (z kontrolą dostępu) albo „ALL” = magazyny dostępne użytkownikowi.
 * Liczby liczą funkcje domeny (stockTurnover, yearSummary, extrasByType) — te same w testach i w raportach.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly db: PrismaService, private readonly ops: OperationsService, private readonly audit: AuditService) {}

  private async scope(actor: AuthUser, warehouseId: string): Promise<Array<{ id: string; code: string; name: string }>> {
    if (warehouseId === "ALL") {
      const whs = await this.db.warehouse.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true } });
      return whs.filter(w => canAccessWarehouse(actor, w.id));
    }
    if (!canAccessWarehouse(actor, warehouseId)) throw forbidden("Nie masz dostępu do tego magazynu.", "WAREHOUSE_FORBIDDEN");
    const w = await this.db.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, code: true, name: true } });
    if (!w) throw forbidden("Nie masz dostępu do tego magazynu.", "WAREHOUSE_FORBIDDEN");
    return [w];
  }

  /** Obroty magazynowe: stan na początek okresu, przychody i rozchody wg rodzaju (z korektami), stan na koniec. */
  async turnover(actor: AuthUser, q: { warehouseId: string; from: string; to: string }) {
    if (q.from > q.to) throw badRequest("VALIDATION", "Data „od” jest późniejsza niż „do”.");
    if ((asDate(q.to).getTime() - asDate(q.from).getTime()) / 864e5 > MAX_TURNOVER_DAYS) throw badRequest("VALIDATION", "Zakres raportu: maksymalnie 10 lat.");
    const whs = await this.scope(actor, q.warehouseId);
    const ids = whs.map(w => w.id);
    const [startRows, moves, materials] = await Promise.all([
      this.db.stockMovement.groupBy({ by: ["materialId"], where: { warehouseId: { in: ids }, movementDate: { lt: asDate(q.from) } }, _sum: { qty: true } }),
      this.db.stockMovement.findMany({ where: { warehouseId: { in: ids }, movementDate: { gte: asDate(q.from), lt: nextDay(q.to) } }, select: { materialId: true, kind: true, qty: true, reversalOfId: true } }),
      this.db.material.findMany({ select: { id: true, code: true, name: true, stockUnit: true, category: true } }),
    ]);
    // ruch odwracający dostaje rodzaj ruchu odwracanego — korekta zakupu zostaje w kolumnie „zakup”
    const revIds = [...new Set(moves.filter(m => m.reversalOfId).map(m => m.reversalOfId!))];
    const origKind = new Map((revIds.length ? await this.db.stockMovement.findMany({ where: { id: { in: revIds } }, select: { id: true, kind: true } }) : []).map(m => [m.id, m.kind]));
    const movements: TurnoverMovement[] = moves.map(m => ({ materialId: m.materialId, qty: m.qty.toString(),
      kind: m.reversalOfId ? origKind.get(m.reversalOfId) ?? "CORRECTION" : m.kind, reversal: !!m.reversalOfId }));
    const start = new Map(startRows.map(r => [r.materialId, (r._sum.qty ?? new Prisma.Decimal(0)).toString()]));
    const mat = new Map(materials.map(m => [m.id, m]));
    const rows = stockTurnover(start, movements)
      .map(r => ({ ...r, material: { id: r.materialId, code: mat.get(r.materialId)?.code ?? "", name: mat.get(r.materialId)?.name ?? "materiał", unit: (mat.get(r.materialId)?.stockUnit ?? "T") as Unit } }))
      .sort((a, b) => a.material.name.localeCompare(b.material.name, "pl"));
    // kontrola spójności: raport do dziś (albo dalej) musi kończyć się dokładnie na saldach z tabeli sald
    const today = todayWarsaw();
    let check: { ok: boolean; mismatches: Array<{ materialId: string; fromMovements: string; balance: string }> } | null = null;
    if (q.to >= today) {
      const bal = await this.db.stockBalance.groupBy({ by: ["materialId"], where: { warehouseId: { in: ids } }, _sum: { qty: true } });
      const future = await this.db.stockMovement.count({ where: { warehouseId: { in: ids }, movementDate: { gte: nextDay(q.to) } } });
      if (!future) check = consistencyCheck(rows, new Map(bal.map(b => [b.materialId, (b._sum.qty ?? new Prisma.Decimal(0)).toString()])));
    }
    return { from: q.from, to: q.to, warehouses: whs, rows, check };
  }

  /** Zestawienie roku: 12 miesięcy (operacje, kwoty, produkcja MP, korekty, usunięcia) i suma roku. */
  async summary(actor: AuthUser, q: { warehouseId: string; year: number }) {
    const whs = await this.scope(actor, q.warehouseId);
    const ids = whs.map(w => w.id);
    const from = asDate(`${q.year}-01-01`), to = asDate(`${q.year + 1}-01-01`);
    const [ops, cors, dels] = await Promise.all([
      this.db.operation.findMany({ where: { warehouseId: { in: ids }, status: { not: "DELETED" }, type: { in: [...OP_TYPES] }, operationDate: { gte: from, lt: to } },
        select: { type: true, operationDate: true, purchaseCost: true, revenue: true, chippingCost: true, transportCost: true, additionalCost: true, productionRun: { select: { outQty: true } } } }),
      this.db.correction.findMany({ where: { createdAt: { gte: from, lt: to }, operation: { warehouseId: { in: ids } } }, select: { createdAt: true } }),
      this.db.operation.findMany({ where: { warehouseId: { in: ids }, status: "DELETED", deletedAt: { gte: from, lt: to } }, select: { deletedAt: true } }),
    ]);
    const warsaw = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(d);
    const s = yearSummary(q.year, ops.map(o => ({ date: isoDay(o.operationDate), type: o.type, purchaseCost: o.purchaseCost.toString(), revenue: o.revenue.toString(),
      chippingCost: o.chippingCost.toString(), transportCost: o.transportCost.toString(), additionalCost: o.additionalCost.toString(), productionMp: o.productionRun?.outQty.toString() ?? null })),
      cors.map(c => warsaw(c.createdAt)), dels.map(d => warsaw(d.deletedAt!)));
    return { warehouses: whs, ...s };
  }

  /** Pulpit miesiąca: kwoty i liczba operacji, operacje dodatkowe wg rodzaju (kafel z wyborem miesiąca), stany, MM w drodze. */
  async dashboard(actor: AuthUser, q: { warehouseId: string; month: string }) {
    const whs = await this.scope(actor, q.warehouseId);
    const ids = whs.map(w => w.id);
    const { from, to } = periodBounds("month", `${q.month}-01`);
    const range = { gte: asDate(from), lt: nextDay(to) };
    const [ops, extras, balances, inbound, corrections] = await Promise.all([
      this.db.operation.findMany({ where: { warehouseId: { in: ids }, status: { not: "DELETED" }, type: { in: [...OP_TYPES] }, operationDate: range },
        select: { type: true, operationDate: true, purchaseCost: true, revenue: true, chippingCost: true, transportCost: true, additionalCost: true, productionRun: { select: { outQty: true } } } }),
      this.db.additionalOperation.findMany({ where: { warehouseId: { in: ids }, deletedAt: null, performedOn: range, operation: { status: { not: "DELETED" } } },
        select: { quantity: true, cost: true, type: { select: { name: true, unit: true } } } }),
      this.db.stockBalance.findMany({ where: { warehouseId: { in: ids }, qty: { not: 0 } }, include: { material: { select: { name: true, stockUnit: true } } } }),
      this.db.operation.count({ where: { type: "TRANSFER", status: "POSTED", transferState: "IN_TRANSIT", targetWarehouseId: { in: ids } } }),
      this.db.correction.count({ where: { createdAt: range, operation: { warehouseId: { in: ids } } } }),
    ]);
    const s = yearSummary(Number(q.month.slice(0, 4)), ops.map(o => ({ date: isoDay(o.operationDate), type: o.type, purchaseCost: o.purchaseCost.toString(), revenue: o.revenue.toString(),
      chippingCost: o.chippingCost.toString(), transportCost: o.transportCost.toString(), additionalCost: o.additionalCost.toString(), productionMp: o.productionRun?.outQty.toString() ?? null })));
    const month = s.months[Number(q.month.slice(5, 7)) - 1]!;
    const stock = new Map<string, { name: string; unit: Unit; qty: Prisma.Decimal }>();
    for (const b of balances) {
      const cur = stock.get(b.materialId) ?? { name: b.material.name, unit: b.material.stockUnit as Unit, qty: new Prisma.Decimal(0) };
      cur.qty = cur.qty.plus(b.qty); stock.set(b.materialId, cur);
    }
    return {
      warehouses: whs, month: q.month, from, to, totals: { ...month, corrections }, inbound,
      extras: extrasByType(extras.map(x => ({ type: x.type.name, quantity: x.quantity?.toString() ?? null, cost: x.cost.toString() }))),
      stock: [...stock.entries()].map(([id, v]) => ({ materialId: id, name: v.name, unit: v.unit, qty: v.qty.toString() })).sort((a, b) => a.name.localeCompare(b.name, "pl")),
    };
  }

  /** Eksport raportu do pliku (CSV / XLSX / PDF / DOCX); zdarzenie w dzienniku audytu. */
  async export(actor: AuthUser, q: ExportQuery, meta: RequestMeta): Promise<{ buffer: Buffer; filename: string }> {
    if (!can(actor, "reports.export")) throw forbidden("Nie masz uprawnień do eksportu raportów.");
    const whs = await this.scope(actor, q.warehouseId);
    const whLabel = q.warehouseId === "ALL" ? "Wszystkie magazyny" : whs[0]!.name;
    const whCode = q.warehouseId === "ALL" ? "WSZYSTKIE" : whs[0]!.code;
    const stamp = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "short" }).format(new Date());
    const by = `Wygenerowano ${stamp} · ${displayName(actor)} · ResInvest ERP`;
    let table: ReportTable, name: string;
    if (q.report === "turnover") {
      if (!q.from || !q.to) throw badRequest("VALIDATION", "Podaj zakres dat raportu.");
      const r = await this.turnover(actor, { warehouseId: q.warehouseId, from: q.from, to: q.to });
      table = turnoverTable(r.rows, `Obroty magazynowe — ${whLabel}`, `Okres ${q.from} – ${q.to}${r.check ? (r.check.ok ? " · zgodne z saldami" : ` · NIEZGODNOŚCI: ${r.check.mismatches.length}`) : ""}`, by);
      name = `obroty_${whCode}_${q.from}_${q.to}`;
    } else if (q.report === "summary") {
      const year = q.year ?? Number(todayWarsaw().slice(0, 4));
      const r = await this.summary(actor, { warehouseId: q.warehouseId, year });
      table = summaryTable(r, `Zestawienie roczne ${year} — ${whLabel}`, by);
      name = `zestawienie_${whCode}_${year}`;
    } else {
      if (q.warehouseId === "ALL") throw badRequest("VALIDATION", "Rejestr dokumentów eksportuje się dla jednego magazynu.");
      const r = await this.ops.register(actor, { warehouseId: q.warehouseId, type: q.type, from: q.from, to: q.to, q: q.q, aux: !!q.aux, page: 1, pageSize: 10000 });
      table = documentsTable(r.rows, `Rejestr dokumentów — ${whLabel}`, `${q.from || q.to ? `Okres ${q.from ?? "…"} – ${q.to ?? "…"}` : "Wszystkie daty"}${q.type ? ` · typ ${q.type}` : ""} · ${r.total} dokumentów`, by);
      name = `rejestr_${whCode}_${q.from ?? "od-poczatku"}_${q.to ?? todayWarsaw()}`;
    }
    const buffer = await renderReport(table, q.format);
    await this.audit.log(this.db, actor, meta, { action: "REPORT_EXPORTED", entity: "report", warehouseId: q.warehouseId === "ALL" ? null : q.warehouseId,
      after: { raport: table.title, format: q.format.toUpperCase(), wiersze: table.rows.length, zakres: table.subtitle } });
    return { buffer, filename: `${name}.${q.format}` };
  }
}

const unitOf = (u: Unit) => UNIT_LABEL[u];
function turnoverTable(rows: Array<TurnoverRow & { material: { code: string; name: string; unit: Unit } }>, title: string, subtitle: string, by: string): ReportTable {
  return { title, subtitle, generatedBy: by,
    columns: [
      { key: "name", label: "Materiał", kind: "text", width: 26 }, { key: "unit", label: "J.m.", kind: "text", width: 6 }, { key: "start", label: "Stan początkowy", kind: "qty" },
      { key: "opening", label: TURNOVER_LABEL.opening, kind: "qty" }, { key: "purchase", label: TURNOVER_LABEL.purchase, kind: "qty" }, { key: "production", label: TURNOVER_LABEL.production, kind: "qty" },
      { key: "transferIn", label: TURNOVER_LABEL.transferIn, kind: "qty" }, { key: "sale", label: TURNOVER_LABEL.sale, kind: "qty" }, { key: "consumption", label: TURNOVER_LABEL.consumption, kind: "qty" },
      { key: "transferOut", label: TURNOVER_LABEL.transferOut, kind: "qty" }, { key: "other", label: TURNOVER_LABEL.other, kind: "qty" }, { key: "end", label: "Stan końcowy", kind: "qty" },
    ],
    rows: rows.map(({ material, ...r }) => ({ ...r, name: material.name, unit: unitOf(material.unit) })) };
}

function summaryTable(r: Awaited<ReturnType<ReportsService["summary"]>>, title: string, by: string): ReportTable {
  const row = (m: (typeof r.months)[number], label: string): Record<string, string | number> => ({ ...m, label });
  return { title, subtitle: "Kwoty netto w zł; wynik = przychód − zakup − rąbanie − transport − operacje dodatkowe (bez wyceny zapasu)", generatedBy: by,
    columns: [
      { key: "label", label: "Miesiąc", kind: "text", width: 14 }, { key: "operations", label: "Operacje", kind: "int", width: 9 }, { key: "purchaseCost", label: "Zakup", kind: "money" },
      { key: "revenue", label: "Przychód", kind: "money" }, { key: "chippingCost", label: "Rąbanie", kind: "money" }, { key: "transportCost", label: "Transport", kind: "money" },
      { key: "additionalCost", label: "Operacje dodatkowe", kind: "money" }, { key: "result", label: "Wynik", kind: "money" }, { key: "productionMp", label: "Produkcja [MP]", kind: "qty" },
      { key: "corrections", label: "Korekty", kind: "int", width: 8 }, { key: "deletions", label: "Usunięcia", kind: "int", width: 8 },
    ],
    rows: r.months.map((m, i) => row(m, MONTH_NAMES[i]!)), total: row(r.total, `Rok ${r.year}`) };
}

function documentsTable(rows: Awaited<ReturnType<OperationsService["register"]>>["rows"], title: string, subtitle: string, by: string): ReportTable {
  return { title, subtitle, generatedBy: by,
    columns: [
      { key: "number", label: "Nr dokumentu", kind: "text", width: 18 }, { key: "type", label: "Typ", kind: "text", width: 6 }, { key: "date", label: "Data ruchu", kind: "text", width: 11 },
      { key: "docDate", label: "Data dokumentu", kind: "text", width: 11 }, { key: "op", label: "Operacja", kind: "text", width: 14 }, { key: "content", label: "Treść", kind: "text", width: 34 },
      { key: "partner", label: "Kontrahent / trasa", kind: "text", width: 24 }, { key: "ext", label: "Nr zewnętrzny", kind: "text", width: 14 }, { key: "value", label: "Wartość", kind: "money" },
      { key: "state", label: "Stan", kind: "text", width: 10 },
    ],
    rows: rows.map(d => ({
      number: d.number, type: d.type, date: d.movementDate, docDate: d.documentDate, op: OP_LABEL[d.operationType] ?? d.operationType,
      content: d.lines.map(l => `${l.material}: ${l.qtySource.replace(".", ",")} ${unitOf(l.unitSource as Unit)}${l.weightT ? ` | ${l.weightT.replace(".", ",")} t` : ""}`).join("; "),
      partner: d.transfer ? `${d.transfer.from} → ${d.transfer.to}` : d.partner ?? "", ext: d.externalNumber ?? "", value: Number(d.value) ? d.value : null,
      state: d.corrections ? `korygowany ×${d.corrections}` : "zatwierdzony",
    })) };
}
