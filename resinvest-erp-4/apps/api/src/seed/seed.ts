import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { ADDITIONAL_OPERATION_TYPES, COMPANY_RATES, MATERIALS, PERMISSIONS, ROLES, SETTINGS, WAREHOUSES } from "./reference-data.js";

/**
 * Dane słownikowe — idempotentnie (upsert): można uruchamiać wielokrotnie, także po aktualizacji.
 * Nie nadpisuje zmian administratora w kartotekach (tworzy tylko brakujące pozycje), uprawnienia ról
 * uzupełnia wyłącznie przy pierwszym utworzeniu roli.
 *   node apps/api/dist/seed/seed.js
 */
export async function seedReferenceData(db: PrismaClient): Promise<Record<string, number>> {
  const n: Record<string, number> = { permissions: 0, roles: 0, warehouses: 0, materials: 0, rates: 0, additionalTypes: 0, settings: 0 };
  await db.$transaction(async tx => {
    for (const p of PERMISSIONS) {
      const had = await tx.permission.findUnique({ where: { code: p.code } });
      await tx.permission.upsert({ where: { code: p.code }, create: p, update: { description: p.description, group: p.group } });
      if (!had) n.permissions!++;
    }
    for (const r of ROLES) {
      const existing = await tx.role.findUnique({ where: { code: r.code } });
      if (existing) continue;
      const perms = r.permissions === "*" ? PERMISSIONS.map(p => p.code) : r.permissions;
      await tx.role.create({ data: { code: r.code, name: r.name, description: r.description, global: r.global, system: true, permissions: { create: perms.map(permissionCode => ({ permissionCode })) } } });
      n.roles!++;
    }
    for (const w of WAREHOUSES) if (!(await tx.warehouse.findUnique({ where: { code: w.code } }))) { await tx.warehouse.create({ data: w }); n.warehouses!++; }
    for (const m of MATERIALS) if (!(await tx.material.findUnique({ where: { code: m.code } }))) { await tx.material.create({ data: { ...m, allowedUnits: [...m.allowedUnits] } }); n.materials!++; }
    for (const r of COMPANY_RATES) {
      const found = await tx.conversionRate.findFirst({ where: { materialId: null, fromUnit: r.fromUnit, toUnit: r.toUnit } });
      if (!found) { await tx.conversionRate.create({ data: { ...r, validFrom: new Date(`${SETTINGS["rates.effectiveFrom"]}T00:00:00Z`) } }); n.rates!++; }
    }
    for (const a of ADDITIONAL_OPERATION_TYPES) if (!(await tx.additionalOperationType.findUnique({ where: { name: a.name } }))) { await tx.additionalOperationType.create({ data: a }); n.additionalTypes!++; }
    for (const [key, value] of Object.entries(SETTINGS)) if (!(await tx.setting.findUnique({ where: { key } }))) { await tx.setting.create({ data: { key, value } }); n.settings!++; }
  });
  return n;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Brak DATABASE_URL");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const n = await seedReferenceData(db);
    console.warn(`Dane słownikowe: ${Object.entries(n).map(([k, v]) => `${k} +${v}`).join(", ")}`);
  } finally { await db.$disconnect(); }
}

if (require.main === module) main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
