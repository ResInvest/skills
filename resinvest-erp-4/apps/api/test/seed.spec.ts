import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { seedReferenceData } from "../src/seed/seed.js";
import { MATERIALS, PERMISSIONS, ROLES, WAREHOUSES } from "../src/seed/reference-data.js";
import { testDbUrl } from "./helpers.js";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDbUrl() }) });
afterAll(async () => { await db.$disconnect(); });

describe("dane słownikowe (seed)", () => {
  it("tworzy role, uprawnienia, magazyny, materiały, przeliczniki i rodzaje operacji dodatkowych", async () => {
    await seedReferenceData(db);
    expect(await db.permission.count()).toBe(PERMISSIONS.length);
    const admin = await db.role.findUnique({ where: { code: "ADMINISTRATOR" }, include: { permissions: true } });
    expect(admin?.permissions).toHaveLength(PERMISSIONS.length);
    const mag = await db.role.findUnique({ where: { code: "MAGAZYNIER" }, include: { permissions: true } });
    expect(mag?.permissions.map(p => p.permissionCode)).toContain("mm.receive");
    expect(mag?.permissions.map(p => p.permissionCode)).not.toContain("documents.delete");
    for (const w of WAREHOUSES) expect(await db.warehouse.findUnique({ where: { code: w.code } })).not.toBeNull();
    for (const m of MATERIALS) expect(await db.material.findUnique({ where: { code: m.code } })).not.toBeNull();
    expect((await db.conversionRate.findFirst({ where: { materialId: null, fromUnit: "MP", toUnit: "T" } }))?.factor.toString()).toBe("0.33");
    expect(await db.additionalOperationType.findUnique({ where: { name: "Holowanie" } })).not.toBeNull();
  });
  it("jest idempotentny i nie nadpisuje zmian administratora", async () => {
    await db.material.update({ where: { code: "ZR-T" }, data: { name: "Zrębka towar (zmiana)" } });
    const n = await seedReferenceData(db);
    expect(n.roles).toBe(0);
    expect(n.permissions).toBe(0);
    expect(n.materials).toBe(0);
    // tylko role słownikowe — inne pliki testów mogą tworzyć własne role w tej samej bazie testowej
    expect(await db.role.count({ where: { code: { in: ROLES.map(r => r.code) } } })).toBe(ROLES.length);
    expect((await db.material.findUnique({ where: { code: "ZR-T" } }))?.name).toBe("Zrębka towar (zmiana)");
  });
});
