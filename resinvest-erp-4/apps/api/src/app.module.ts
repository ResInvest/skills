import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "./config/config.module.js";
import { ApiErrorFilter } from "./common/api-error.filter.js";
import { NetworkGuard } from "./common/network.guard.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { HealthController } from "./health/health.controller.js";
import { AuditService } from "./audit/audit.service.js";
import { AuditController } from "./audit/audit.controller.js";
import { MailService } from "./mail/mail.service.js";
import { SettingsService } from "./settings/settings.service.js";
import { SessionService } from "./auth/session.service.js";
import { AuthService } from "./auth/auth.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthGuard, PermissionsGuard } from "./auth/auth.guard.js";
import { UsersService } from "./users/users.service.js";
import { UsersController } from "./users/users.controller.js";
import { RolesController } from "./roles/roles.controller.js";
import { WarehousesController } from "./warehouses/warehouses.controller.js";
import { LedgerService } from "./stock/ledger.service.js";
import { StockController } from "./stock/stock.controller.js";
import { OpeningService } from "./opening/opening.service.js";
import { OpeningController } from "./opening/opening.controller.js";
import { CatalogService } from "./catalog/catalog.service.js";
import { CatalogController } from "./catalog/catalog.controller.js";
import { OperationsService } from "./operations/operations.service.js";
import { OperationsController } from "./operations/operations.controller.js";

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [HealthController, AuthController, UsersController, RolesController, WarehousesController, AuditController, StockController, OpeningController, CatalogController, OperationsController],
  providers: [
    AuditService, MailService, SettingsService, SessionService, AuthService, UsersService, LedgerService, OpeningService, CatalogService, OperationsService,
    { provide: APP_FILTER, useClass: ApiErrorFilter },
    // kolejność: sieć (LAN/VPN) → sesja → uprawnienia
    { provide: APP_GUARD, useClass: NetworkGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
