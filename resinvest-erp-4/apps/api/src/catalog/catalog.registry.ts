import { z } from "zod";
import { isValidCode, isValidNip, isValidRegistration, normalizeCode, normalizeNip, normalizeRegistration } from "@resinvest/domain";
import type { Db } from "../prisma/tx.js";

/**
 * Rejestr kartotek: dla każdego rodzaju — model Prisma, uprawnienie do edycji, schemat danych (walidacja serwera),
 * reguły spójności i powiązania, które blokują fizyczne usunięcie (rekord użyty w dokumentach → tylko dezaktywacja).
 */
export type CatalogKind = "materials" | "partners" | "external-companies" | "drivers" | "operators" | "vehicles" | "chippers" | "additional-operation-types";
export type ModelName = "material" | "partner" | "externalCompany" | "driver" | "operator" | "vehicle" | "chipper" | "additionalOperationType";

export interface Issue { field: string; message: string }
type Data = Record<string, unknown>;

export interface KindDef {
  model: ModelName;
  label: string;
  /** Uprawnienie do zmian (odczyt: report.view). */
  perm: "master.edit" | "fleet.edit";
  /** Schemat pełnego rekordu (tworzenie); przy edycji — częściowy. */
  schema: z.ZodObject<z.ZodRawShape>;
  /** Pole „aktywny” (true/false) albo status zasobu (ACTIVE / SERVICE / RETIRED). */
  activeField: "active" | "status";
  /** Pola unikalne (nazwa, kod, rejestracja) — czytelny komunikat zamiast błędu bazy. */
  unique: Array<{ field: string; message: string }>;
  /** Powiązania blokujące usunięcie: [model, pole]. */
  usage: Array<[string, string]>;
  orderBy: Record<string, "asc" | "desc">;
  /** Dodatkowe reguły (po scaleniu z poprzednią wersją rekordu). */
  check?: (db: Db, d: Data, prev: Data | null) => Promise<Issue[]>;
  /** Pole magazynu (izolacja magazynów dla floty). */
  warehouseField?: "warehouseId";
}

const txt = (max: number, label: string) => z.string().trim().min(1, `Podaj ${label}`).max(max, `${label}: maksymalnie ${max} znaków`);
const opt = (max: number) => z.string().trim().max(max).nullable().optional().transform(v => (v ? v : null));
const dec = (label: string) => z.union([z.string(), z.number()]).nullable().optional().transform((v, ctx) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) { ctx.addIssue({ code: "custom", message: `${label}: liczba większa od 0` }); return z.NEVER; }
  return String(n);
});
const uuidOrNull = z.string().uuid().nullable().optional().transform(v => v ?? null);
const UNIT = z.enum(["M3", "MP", "T"]);

const exists = async (db: Db, model: ModelName, id: unknown): Promise<boolean> =>
  typeof id !== "string" || !!(await (db[model] as unknown as { findUnique(a: object): Promise<unknown> }).findUnique({ where: { id }, select: { id: true } }));

export const KINDS: Record<CatalogKind, KindDef> = {
  materials: {
    model: "material", label: "Materiał", perm: "master.edit", activeField: "active", orderBy: { name: "asc" },
    schema: z.object({
      code: z.string().trim().transform(normalizeCode).refine(isValidCode, "Kod: litery, cyfry i myślnik (do 20 znaków), np. ZR-PL"),
      name: txt(160, "nazwę"),
      category: z.enum(["WOOD", "CHIPS", "TONNAGE", "OTHER"], { message: "Wybierz grupę" }),
      stockUnit: UNIT,
      allowedUnits: z.array(UNIT).min(1, "Wybierz co najmniej jedną jednostkę").transform(a => [...new Set(a)]),
      tonPerUnit: dec("Masa jednostki [t]"), mpPerM3: dec("MP z 1 m³"), tonPerM3: dec("Gęstość [t/m³]"),
      active: z.boolean().default(true),
    }),
    unique: [{ field: "code", message: "Materiał o takim kodzie już istnieje" }, { field: "name", message: "Materiał o takiej nazwie już istnieje" }],
    usage: [["documentLine", "materialId"], ["stockMovement", "materialId"], ["openingBalanceLine", "materialId"]],
    check: async (db, d, prev) => {
      const out: Issue[] = [];
      const units = d.allowedUnits as string[];
      if (!units.includes(d.stockUnit as string)) units.unshift(d.stockUnit as string);
      if (prev && prev.stockUnit !== d.stockUnit && (await db.stockMovement.count({ where: { materialId: prev.id as string } })))
        out.push({ field: "stockUnit", message: "Jednostki magazynowej nie można zmienić po pierwszym ruchu magazynowym" });
      if (prev && prev.active === true && d.active === false) {
        const b = await db.stockBalance.findFirst({ where: { materialId: prev.id as string, qty: { not: 0 } }, include: { warehouse: true } });
        if (b) out.push({ field: "active", message: `Materiał ma stan ${b.qty.toString()} w magazynie ${b.warehouse.name} — nie można go dezaktywować` });
      }
      if (d.stockUnit === "T" && units.some(u => u !== "T") && !d.tonPerM3) out.push({ field: "tonPerM3", message: "Materiał w tonach przyjmowany w m³ / MP wymaga gęstości [t/m³]" });
      return out;
    },
  },
  partners: {
    model: "partner", label: "Kontrahent", perm: "master.edit", activeField: "active", orderBy: { name: "asc" },
    schema: z.object({
      name: txt(200, "nazwę"),
      nip: z.string().trim().nullable().optional().transform(v => (v ? normalizeNip(v) : null)).refine(v => v === null || isValidNip(v), "Nieprawidłowy NIP (10 cyfr, suma kontrolna)"),
      role: z.enum(["SUPPLIER", "BUYER", "BOTH"], { message: "Wybierz rolę: dostawca / odbiorca / obie" }),
      kind: z.enum(["COMPANY", "FOREST_DISTRICT"]).default("COMPANY"),
      city: opt(120), address: opt(250),
      forestries: z.array(z.string().trim().min(1).max(120)).max(100).default([]).transform(a => [...new Set(a)]),
      active: z.boolean().default(true),
    }),
    unique: [{ field: "name", message: "Kontrahent o takiej nazwie już istnieje" }],
    usage: [["document", "partnerId"]],
    check: async (db, d, prev) => {
      if (!d.nip) return [];
      const dup = await db.partner.findFirst({ where: { nip: d.nip as string, ...(prev ? { id: { not: prev.id as string } } : {}) }, select: { name: true } });
      return dup ? [{ field: "nip", message: `Ten NIP ma już kontrahent „${dup.name}”` }] : [];
    },
  },
  "external-companies": {
    model: "externalCompany", label: "Firma zewnętrzna", perm: "fleet.edit", activeField: "active", orderBy: { name: "asc" },
    schema: z.object({
      name: txt(200, "nazwę"),
      nip: z.string().trim().nullable().optional().transform(v => (v ? normalizeNip(v) : null)).refine(v => v === null || isValidNip(v), "Nieprawidłowy NIP (10 cyfr, suma kontrolna)"),
      kind: z.enum(["TRANSPORT", "CHIPPING", "SERVICES", "OTHER"], { message: "Wybierz rodzaj firmy" }),
      contact: opt(250), active: z.boolean().default(true),
    }),
    unique: [{ field: "name", message: "Firma o takiej nazwie już istnieje" }],
    usage: [["vehicle", "externalCompanyId"], ["chipper", "externalCompanyId"], ["transportRun", "externalCompanyId"]],
  },
  drivers: {
    model: "driver", label: "Kierowca", perm: "fleet.edit", activeField: "active", orderBy: { name: "asc" },
    schema: z.object({ name: txt(120, "imię i nazwisko"), phone: opt(30), active: z.boolean().default(true) }),
    unique: [], usage: [["vehicle", "defaultDriverId"], ["transportRun", "driverId"]],
  },
  operators: {
    model: "operator", label: "Operator", perm: "fleet.edit", activeField: "active", orderBy: { name: "asc" },
    schema: z.object({ name: txt(120, "imię i nazwisko"), phone: opt(30), active: z.boolean().default(true) }),
    unique: [], usage: [["chipper", "operatorId"], ["productionRun", "operatorId"]],
  },
  vehicles: {
    model: "vehicle", label: "Pojazd", perm: "fleet.edit", activeField: "status", orderBy: { registration: "asc" }, warehouseField: "warehouseId",
    schema: z.object({
      name: txt(120, "nazwę pojazdu"),
      registration: z.string().trim().transform(normalizeRegistration).refine(isValidRegistration, "Numer rejestracyjny: litery i cyfry, 2–10 znaków"),
      vehicleType: opt(40),
      ownership: z.enum(["OWN", "EXTERNAL"]).default("OWN"),
      externalCompanyId: uuidOrNull, status: z.enum(["ACTIVE", "SERVICE", "RETIRED"]).default("ACTIVE"),
      warehouseId: uuidOrNull, defaultDriverId: uuidOrNull,
    }),
    unique: [{ field: "registration", message: "Pojazd o takim numerze rejestracyjnym już istnieje" }],
    usage: [["transportRun", "vehicleId"], ["additionalOperation", "vehicleId"]],
    check: async (db, d) => {
      const out: Issue[] = [];
      if (d.ownership === "EXTERNAL" && !d.externalCompanyId) out.push({ field: "externalCompanyId", message: "Wybierz firmę — właściciela pojazdu" });
      if (d.ownership === "OWN") d.externalCompanyId = null;
      if (!(await exists(db, "externalCompany", d.externalCompanyId))) out.push({ field: "externalCompanyId", message: "Nie znaleziono firmy" });
      if (!(await exists(db, "driver", d.defaultDriverId))) out.push({ field: "defaultDriverId", message: "Nie znaleziono kierowcy" });
      return out;
    },
  },
  chippers: {
    model: "chipper", label: "Rębak", perm: "fleet.edit", activeField: "status", orderBy: { name: "asc" }, warehouseField: "warehouseId",
    schema: z.object({
      name: txt(120, "nazwę / model rębaka"),
      registration: z.string().trim().nullable().optional().transform(v => (v ? normalizeRegistration(v) : null)).refine(v => v === null || isValidRegistration(v), "Numer rejestracyjny: litery i cyfry, 2–10 znaków"),
      ownership: z.enum(["OWN", "EXTERNAL"]).default("OWN"),
      externalCompanyId: uuidOrNull, operatorId: uuidOrNull, externalOperator: opt(120), notes: opt(500),
      status: z.enum(["ACTIVE", "SERVICE", "RETIRED"]).default("ACTIVE"), warehouseId: uuidOrNull,
    }),
    unique: [], usage: [["productionRun", "chipperId"]],
    check: async (db, d) => {
      const out: Issue[] = [];
      if (d.ownership === "EXTERNAL") {
        if (!d.externalCompanyId) out.push({ field: "externalCompanyId", message: "Wybierz firmę — właściciela rębaka" });
        d.operatorId = null; // operator firmy zewnętrznej — opisowo (externalOperator)
      } else { d.externalCompanyId = null; d.externalOperator = null; }
      if (!(await exists(db, "externalCompany", d.externalCompanyId))) out.push({ field: "externalCompanyId", message: "Nie znaleziono firmy" });
      if (!(await exists(db, "operator", d.operatorId))) out.push({ field: "operatorId", message: "Nie znaleziono operatora" });
      return out;
    },
  },
  "additional-operation-types": {
    model: "additionalOperationType", label: "Rodzaj operacji dodatkowej", perm: "master.edit", activeField: "active", orderBy: { name: "asc" },
    schema: z.object({
      name: txt(120, "nazwę"), description: opt(500), unit: opt(20),
      defaultRate: z.union([z.string(), z.number()]).nullable().optional().transform((v, ctx) => {
        if (v === null || v === undefined || String(v).trim() === "") return null;
        const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(n) || n < 0) { ctx.addIssue({ code: "custom", message: "Stawka: liczba nie mniejsza od 0" }); return z.NEVER; }
        return n.toFixed(2);
      }),
      active: z.boolean().default(true),
    }),
    unique: [{ field: "name", message: "Rodzaj o takiej nazwie już istnieje" }],
    usage: [["additionalOperation", "typeId"]],
  },
};

export const isKind = (k: string): k is CatalogKind => Object.hasOwn(KINDS, k);
