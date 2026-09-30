import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "./config/config.module.js";
import { ApiErrorFilter } from "./common/api-error.filter.js";
import { NetworkGuard } from "./common/network.guard.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { HealthController } from "./health/health.controller.js";

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ApiErrorFilter },
    { provide: APP_GUARD, useClass: NetworkGuard },
  ],
})
export class AppModule {}
