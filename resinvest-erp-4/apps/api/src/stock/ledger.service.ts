import { HttpStatus, Injectable } from "@nestjs/common";
import { lockOrder, shortageMessage, simulate, balanceKey, type Unit } from "@resinvest/domain";
import { Prisma } from "../generated/prisma/client.js";
import type { MovementKind } from "../generated/prisma/enums.js";
import { AppError } from "../common/errors.js";
import type { Db } from "../prisma/tx.js";

export interface LedgerMovement {
  warehouseId: string; materialId: string;
  /** Zmiana stanu w jednostce magazynowej (+ przychód, − rozchód), łańcuch dziesiętny. */
  qty: string;
  kind: MovementKind;
  documentId?: string | null; documentLineId?: string | null; reversalOfId?: string | null;
}
export interface LedgerPost { operationId: string; movementDate: Date; createdById: string; movements: LedgerMovement[] }

/**
 * Księga ruchów magazynowych — JEDYNE miejsce, które zmienia stan.
 * Wywoływana wewnątrz transakcji operacji (dokument + linie + ruchy + salda = jedna transakcja):
 *  1. wiersze sald dla wszystkich par (magazyn, materiał) istnieją (INSERT … ON CONFLICT DO NOTHING),
 *  2. blokada SELECT … FOR UPDATE w stałej kolejności — równoczesna operacja na tym samym materiale czeka,
 *     a po zwolnieniu blokady widzi saldo już zmniejszone (brak „podwójnej sprzedaży”, brak zakleszczeń),
 *  3. symulacja krok po kroku (reguły z pakietu domeny) — stan nie może zejść poniżej zera,
 *  4. dopisanie ruchów (tabela tylko do dopisywania) i aktualizacja sald.
 * Ostatnia linia obrony: CHECK (qty >= 0) na stock_balances.
 */
@Injectable()
export class LedgerService {
  async post(tx: Db, p: LedgerPost): Promise<Map<string, string>> {
    if (!p.movements.length) return new Map();
    const keys = lockOrder(p.movements);
    for (const k of keys) {
      await tx.$executeRaw`INSERT INTO "stock_balances" ("warehouse_id", "material_id", "qty", "updated_at") VALUES (${k.warehouseId}::uuid, ${k.materialId}::uuid, 0, now()) ON CONFLICT DO NOTHING`;
    }
    const current = new Map<string, string>();
    for (const k of keys) {
      const rows = await tx.$queryRaw<Array<{ qty: string }>>`SELECT "qty"::text AS qty FROM "stock_balances" WHERE "warehouse_id" = ${k.warehouseId}::uuid AND "material_id" = ${k.materialId}::uuid FOR UPDATE`;
      current.set(balanceKey(k.warehouseId, k.materialId), rows[0]?.qty ?? "0");
    }
    const sim = simulate(current, p.movements);
    if (sim.shortages.length) throw await this.shortageError(tx, sim.shortages);
    await tx.stockMovement.createMany({
      data: p.movements.map(m => ({
        warehouseId: m.warehouseId, materialId: m.materialId, operationId: p.operationId, documentId: m.documentId ?? null, documentLineId: m.documentLineId ?? null,
        reversalOfId: m.reversalOfId ?? null, kind: m.kind, qty: m.qty, movementDate: p.movementDate, createdById: p.createdById,
      })),
    });
    for (const k of keys) {
      const after = sim.after.get(balanceKey(k.warehouseId, k.materialId)) ?? "0";
      await tx.$executeRaw`UPDATE "stock_balances" SET "qty" = ${after}::numeric, "updated_at" = now() WHERE "warehouse_id" = ${k.warehouseId}::uuid AND "material_id" = ${k.materialId}::uuid`;
    }
    return sim.after;
  }

  private async shortageError(tx: Db, shortages: ReturnType<typeof simulate>["shortages"]): Promise<AppError> {
    const mats = new Map((await tx.material.findMany({ where: { id: { in: shortages.map(s => s.materialId) } }, select: { id: true, name: true, stockUnit: true } })).map(m => [m.id, m]));
    const whs = new Map((await tx.warehouse.findMany({ where: { id: { in: shortages.map(s => s.warehouseId) } }, select: { id: true, name: true } })).map(w => [w.id, w.name]));
    const s = shortages[0]!, m = mats.get(s.materialId);
    const msg = shortageMessage(s, m?.name ?? "materiał", (m?.stockUnit ?? "T") as Unit, whs.get(s.warehouseId));
    return new AppError(HttpStatus.CONFLICT, "STOCK_INSUFFICIENT", msg, shortages);
  }
}

/** Naruszenie CHECK stock_balances_non_negative_chk (ostatnia linia obrony) → czytelny błąd zamiast 500. */
export function isNegativeStockViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("stock_balances_non_negative_chk") || (e instanceof Prisma.PrismaClientKnownRequestError && msg.includes("23514"));
}
