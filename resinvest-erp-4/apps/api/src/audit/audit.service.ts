import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import type { RequestMeta } from "../common/request-meta.js";
import type { Db } from "../prisma/tx.js";

export interface AuditActor { id: string | null; email: string | null }
export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  warehouseId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

const json = (v: unknown) => (v === undefined || v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue));

/**
 * Centralny dziennik audytu (tabela tylko do dopisywania). Zapis w tej samej transakcji co zmiana —
 * nie ma zmiany bez wpisu i wpisu bez zmiany.
 */
@Injectable()
export class AuditService {
  async log(db: Db, actor: AuditActor | null, meta: RequestMeta, e: AuditEntry): Promise<void> {
    await db.auditLog.create({
      data: {
        userId: actor?.id ?? null, userEmail: actor?.email ?? null, action: e.action, entity: e.entity, entityId: e.entityId ?? null,
        warehouseId: e.warehouseId ?? null, before: json(e.before), after: json(e.after), reason: e.reason ?? null,
        ip: meta.ip, userAgent: meta.userAgent, requestId: meta.requestId,
      },
    });
  }
}
