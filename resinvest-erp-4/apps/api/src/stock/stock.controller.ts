import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { qtyNorm, qtySub } from "@resinvest/domain";
import { ZodPipe } from "../common/zod.pipe.js";
import { forbidden, notFound } from "../common/errors.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { canAccessWarehouse, type AuthUser } from "../auth/auth-user.js";
import { CurrentUser, RequirePermissions } from "../auth/decorators.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data w formacie RRRR-MM-DD");
const BalancesQ = z.object({ warehouseId: z.string().uuid("Wybierz magazyn"), all: z.enum(["0", "1"]).default("0") });
const MovesQ = z.object({ warehouseId: z.string().uuid("Wybierz magazyn"), materialId: z.string().uuid("Wybierz materiał"), from: day.optional(), to: day.optional(), limit: z.coerce.number().int().min(1).max(500).default(200) });

interface MoveRow { id: string; seq: string; kind: string; qty: string; after: string; movement_date: Date; created_at: Date; doc_type: string | null; doc_no: string | null; operation_id: string; operation_type: string; user_name: string | null }

/** Stany magazynowe (odczyt): salda magazyn × materiał i karta materiału z historią ruchów (stan po każdym ruchu). */
@Controller()
export class StockController {
  constructor(private readonly db: PrismaService) {}

  @Get("materials") @RequirePermissions("report.view")
  async materials() {
    const rows = await this.db.material.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
    return { ok: true, materials: rows.map(m => ({ id: m.id, code: m.code, name: m.name, category: m.category, stockUnit: m.stockUnit, allowedUnits: m.allowedUnits, active: m.active,
      tonPerUnit: m.tonPerUnit?.toString() ?? null, mpPerM3: m.mpPerM3?.toString() ?? null, tonPerM3: m.tonPerM3?.toString() ?? null })) };
  }

  @Get("stock/balances") @RequirePermissions("report.view")
  async balances(@CurrentUser() user: AuthUser, @Query(new ZodPipe(BalancesQ)) q: z.infer<typeof BalancesQ>) {
    await this.checkWarehouse(user, q.warehouseId);
    const [mats, bal, last] = await Promise.all([
      this.db.material.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
      this.db.stockBalance.findMany({ where: { warehouseId: q.warehouseId } }),
      this.db.$queryRaw<Array<{ material_id: string; last: Date; n: bigint }>>`SELECT "material_id", max("created_at") AS last, count(*) AS n FROM "stock_movements" WHERE "warehouse_id" = ${q.warehouseId}::uuid GROUP BY "material_id"`,
    ]);
    const b = new Map(bal.map(x => [x.materialId, x.qty.toString()])), l = new Map(last.map(x => [x.material_id, x]));
    const rows = mats.filter(m => q.all === "1" || b.has(m.id) || m.active).map(m => ({
      materialId: m.id, code: m.code, name: m.name, category: m.category, unit: m.stockUnit, active: m.active,
      qty: b.get(m.id) ?? "0", movements: Number(l.get(m.id)?.n ?? 0), lastMovementAt: l.get(m.id)?.last ?? null,
    }));
    const opening = await this.db.openingBalanceBatch.findFirst({ where: { warehouseId: q.warehouseId, status: "APPROVED" }, select: { id: true, effectiveDate: true, approvedAt: true } });
    return { ok: true, warehouseId: q.warehouseId, opening, balances: rows };
  }

  @Get("stock/movements") @RequirePermissions("report.view")
  async movements(@CurrentUser() user: AuthUser, @Query(new ZodPipe(MovesQ)) q: z.infer<typeof MovesQ>) {
    await this.checkWarehouse(user, q.warehouseId);
    const material = await this.db.material.findUnique({ where: { id: q.materialId }, select: { id: true, code: true, name: true, stockUnit: true } });
    if (!material) throw notFound("Nie znaleziono materiału.");
    const from = q.from ?? "1900-01-01", to = q.to ?? "2999-12-31";
    // stan po ruchu liczony z całej historii (suma narastająca w kolejności księgowania), potem filtr dat
    const rows = await this.db.$queryRaw<MoveRow[]>`
      SELECT * FROM (
        SELECT m."id", m."seq"::text AS seq, m."kind"::text AS kind, m."qty"::text AS qty, m."movement_date", m."created_at", m."operation_id",
               (SUM(m."qty") OVER (ORDER BY m."seq"))::text AS after,
               d."type"::text AS doc_type, d."number" AS doc_no, o."type"::text AS operation_type,
               NULLIF(btrim(coalesce(u."first_name", '') || ' ' || coalesce(u."last_name", '')), '') AS user_name
        FROM "stock_movements" m
        JOIN "operations" o ON o."id" = m."operation_id"
        LEFT JOIN "documents" d ON d."id" = m."document_id"
        LEFT JOIN "users" u ON u."id" = m."created_by_id"
        WHERE m."warehouse_id" = ${q.warehouseId}::uuid AND m."material_id" = ${q.materialId}::uuid
      ) x WHERE x."movement_date" BETWEEN ${from}::date AND ${to}::date
      ORDER BY x."seq"::bigint DESC LIMIT ${q.limit}`;
    const balance = await this.db.stockBalance.findUnique({ where: { warehouseId_materialId: { warehouseId: q.warehouseId, materialId: q.materialId } } });
    return { ok: true, material, balance: balance?.qty.toString() ?? "0", movements: rows.map(r => ({
      id: r.id, seq: r.seq, kind: r.kind, qty: qtyNorm(r.qty), before: qtySub(r.after, r.qty), after: qtyNorm(r.after), movementDate: r.movement_date, createdAt: r.created_at,
      document: r.doc_no ? { type: r.doc_type, number: r.doc_no } : null, operationId: r.operation_id, operationType: r.operation_type, user: r.user_name })) };
  }

  private async checkWarehouse(user: AuthUser, id: string) {
    const wh = await this.db.warehouse.findUnique({ where: { id }, select: { id: true } });
    if (!wh) throw notFound("Nie znaleziono magazynu.");
    if (!canAccessWarehouse(user, id)) throw forbidden("Nie masz dostępu do tego magazynu.", "WAREHOUSE_FORBIDDEN");
  }
}
