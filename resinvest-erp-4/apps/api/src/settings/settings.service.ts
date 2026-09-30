import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

/** Ustawienia systemu (tabela settings) z wartościami domyślnymi. */
const DEFAULTS = { "auth.allowSelfRegistration": false, "mm.mode": "two", "operations.requireApproval": false } as const;
export type SettingKey = keyof typeof DEFAULTS;

@Injectable()
export class SettingsService {
  constructor(private readonly db: PrismaService) {}
  async get<K extends SettingKey>(key: K): Promise<(typeof DEFAULTS)[K]> {
    const row = await this.db.setting.findUnique({ where: { key } });
    return (row?.value ?? DEFAULTS[key]) as (typeof DEFAULTS)[K];
  }
}
