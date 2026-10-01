import { companyRatesFrom, type CompanyRates, type OpeningMaterial, type Unit } from "@resinvest/domain";
import type { Db } from "../prisma/tx.js";

/** Materiał z bazy → model jednostek domeny (Decimal Prisma → łańcuch dziesiętny, bez utraty precyzji). */
export function materialUnits(m: { id: string; name: string; active: boolean; stockUnit: Unit; allowedUnits: Unit[]; tonPerUnit: unknown; mpPerM3: unknown; tonPerM3: unknown }): OpeningMaterial {
  const dec = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return { id: m.id, name: m.name, active: m.active, stockUnit: m.stockUnit, allowedUnits: m.allowedUnits, tonPerUnit: dec(m.tonPerUnit), mpPerM3: dec(m.mpPerM3), tonPerM3: dec(m.tonPerM3) };
}

/** Przeliczniki firmowe obowiązujące w danym dniu (najnowszy wiersz o dacie obowiązywania ≤ dnia). */
export async function companyRates(db: Db, day: Date): Promise<CompanyRates> {
  const rows = await db.conversionRate.findMany({
    where: { materialId: null, validFrom: { lte: day }, OR: [{ validTo: null }, { validTo: { gte: day } }] },
    orderBy: { validFrom: "desc" },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(`${r.fromUnit}>${r.toUnit}`)) latest.set(`${r.fromUnit}>${r.toUnit}`, r);
  return companyRatesFrom([...latest.values()].map(r => ({ fromUnit: r.fromUnit, toUnit: r.toUnit, factor: r.factor.toString() })));
}
