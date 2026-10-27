import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthUser } from "../auth/auth-user.js";
import { AllowPendingPassword, CurrentUser } from "../auth/decorators.js";

/** Magazyny dostępne dla zalogowanego (izolacja: rola bez dostępu globalnego widzi tylko przydzielone). */
@Controller("warehouses")
export class WarehousesController {
  constructor(private readonly db: PrismaService) {}

  @AllowPendingPassword() @Get()
  async list(@CurrentUser() user: AuthUser) {
    const where = user.global ? {} : { id: { in: [...user.warehouseIds] } };
    const rows = await this.db.warehouse.findMany({ where, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, address: true, active: true } });
    return { ok: true, warehouses: rows };
  }
}
