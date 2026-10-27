import Decimal from "decimal.js";
import { QTY_DP, UNIT_LABEL, type Unit, type ValueSource } from "./units.js";
import { formatQty } from "./stock.js";
import { TRANSPORT_MODE_LABEL, type TransportMode } from "./transport.js";
import { PRODUCTION_DIFF_REASONS, PRODUCTION_SOURCE_LABEL, type OperationPlan, type ProductionSource } from "./documents.js";

/**
 * F5 — zmiany dokumentów: korekta (BYŁO / JEST) i usunięcie z odwróceniem ruchów.
 * Reguły są tu, w domenie, żeby podgląd korekty w przeglądarce i zapis na serwerze liczyły to samo.
 */

export const CORRECTION_REASON_MIN = 5;
export const CORRECTION_REASON_MAX = 500;

/** Powód korekty / usunięcia: wymagany, 5–500 znaków. */
export function checkReason(reason: unknown): string | null {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < CORRECTION_REASON_MIN) return `Podaj powód (co najmniej ${CORRECTION_REASON_MIN} znaków) — trafi do historii zmian i dziennika audytu`;
  if (r.length > CORRECTION_REASON_MAX) return `Powód: maksymalnie ${CORRECTION_REASON_MAX} znaków`;
  return null;
}

/** Numer korekty: KOR/NNN/MM/RRRR (kolejny w miesiącu, wspólny dla firmy). */
export const correctionNumber = (seq: number, date: string) => `KOR/${String(seq).padStart(3, "0")}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

const D = (v: Decimal.Value) => new Decimal(v);

// ---------------------------------------------------------------------------------------------------------
// Ruchy efektywne i odwrócenie
// ---------------------------------------------------------------------------------------------------------

export interface LedgerRow { id: string; warehouseId: string; materialId: string; qty: string; kind: string; movementDate: string; documentId: string | null; documentLineId: string | null; reversalOfId: string | null }
export interface ReversalMovement { warehouseId: string; materialId: string; qty: string; kind: "REVERSAL"; movementDate: string; documentId: string | null; documentLineId: string | null; reversalOfId: string }

/**
 * Ruchy, które dziś tworzą stan operacji: bez ruchów odwracających i bez ruchów już odwróconych.
 * Ruchy są tylko dopisywane — korekta i usunięcie nie zmieniają historii, tylko ją uzupełniają.
 */
export function effectiveMovements<T extends Pick<LedgerRow, "id" | "kind" | "reversalOfId">>(rows: readonly T[]): T[] {
  const reversed = new Set(rows.filter(r => r.reversalOfId).map(r => r.reversalOfId));
  return rows.filter(r => r.kind !== "REVERSAL" && !reversed.has(r.id));
}

/** Odwrócenie ruchów efektywnych: ta sama ilość z przeciwnym znakiem, z datą ruchu odwracanego i wskazaniem na niego. */
export function reversalsOf(rows: readonly LedgerRow[]): ReversalMovement[] {
  return effectiveMovements(rows).map(r => ({
    warehouseId: r.warehouseId, materialId: r.materialId, qty: D(r.qty).neg().toString(), kind: "REVERSAL", movementDate: r.movementDate,
    documentId: r.documentId, documentLineId: r.documentLineId, reversalOfId: r.id,
  }));
}

/** Zmiana stanu netto (magazyn × materiał) po korekcie: −stare + nowe; pary bez zmiany pomija. */
export function netChange(oldRows: ReadonlyArray<{ warehouseId: string; materialId: string; qty: string }>, newRows: ReadonlyArray<{ warehouseId: string; materialId: string; qty: string }>) {
  const m = new Map<string, { warehouseId: string; materialId: string; qty: Decimal }>();
  const add = (r: { warehouseId: string; materialId: string; qty: string }, sign: 1 | -1) => {
    const k = `${r.warehouseId}|${r.materialId}`.toLowerCase();
    const cur = m.get(k) ?? { warehouseId: r.warehouseId, materialId: r.materialId, qty: D(0) };
    cur.qty = cur.qty.plus(D(r.qty).mul(sign)).toDecimalPlaces(QTY_DP);
    m.set(k, cur);
  };
  oldRows.forEach(r => add(r, -1)); newRows.forEach(r => add(r, 1));
  return [...m.values()].filter(x => !x.qty.isZero()).map(x => ({ warehouseId: x.warehouseId, materialId: x.materialId, qty: x.qty.toString() }));
}

/**
 * Kolejność księgowania korekty: najpierw przychody, potem rozchody. Saldo końcowe jest takie samo, a sprawdzenie
 * „stan nie poniżej zera” nie zgłasza fałszywego braku w połowie (np. odwrócenie zakupu przed nowym zakupem).
 */
export function postingOrder<T extends { qty: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Number(D(a.qty).isNeg()) - Number(D(b.qty).isNeg()));
}

// ---------------------------------------------------------------------------------------------------------
// Migawka operacji i porównanie BYŁO / JEST
// ---------------------------------------------------------------------------------------------------------

export interface SnapshotLine { materialId: string; qtySource: string; unitSource: Unit; qtyStock: string; unitStock: Unit; weightT: string | null; weightSource: ValueSource | null; unitPrice: string | null; priceUnit: Unit | null; value: string | null }
/** Jednolity opis operacji — z planu (nowa wersja) albo z zapisu w bazie (poprzednia wersja). */
export interface OperationSnapshot {
  date: string; documentDate: string; externalNumber: string | null; notes: string | null; targetWarehouseId: string | null;
  documents: Array<{ type: string; partnerId: string | null; lines: SnapshotLine[] }>;
  totals: { purchaseCost: string; revenue: string; chippingCost: string; additionalCost: string; transportCost: string };
  transport: { mode: TransportMode; place: string | null; runs: number; km: string } | null;
  production: { consumeQty: string; outQty: string; diffReason: string | null; source: ProductionSource | null; forestDistrict: string | null; forestry: string | null; waybill: string | null; investSite: string | null } | null;
  extras: Array<{ typeId: string; cost: string }>;
}
export interface SnapshotNames { material: (id: string) => string; partner: (id: string) => string; warehouse: (id: string) => string; extraType: (id: string) => string }
export interface FieldChange { field: string; before: string | null; after: string | null }

/** Migawka z planu domeny (wersja po korekcie). */
export function snapshotFromPlan(plan: OperationPlan, input: { externalNumber?: string | null; notes?: string | null }): OperationSnapshot {
  return {
    date: plan.date, documentDate: plan.documentDate, externalNumber: input.externalNumber?.trim() || null, notes: input.notes?.trim() || null,
    targetWarehouseId: plan.transfer?.targetWarehouseId ?? null,
    documents: plan.documents.map(d => ({ type: d.type, partnerId: d.partnerId, lines: d.lines.map(l => ({
      materialId: l.materialId, qtySource: l.qtySource, unitSource: l.unitSource, qtyStock: l.qtyStock, unitStock: l.unitStock,
      weightT: l.weightT, weightSource: l.weightSource, unitPrice: l.unitPrice, priceUnit: l.priceUnit, value: l.value })) })),
    totals: { purchaseCost: plan.totals.purchaseCost, revenue: plan.totals.revenue, chippingCost: plan.totals.chippingCost, additionalCost: plan.totals.additionalCost, transportCost: plan.totals.transportCost },
    transport: plan.transport && plan.transport.mode !== "NONE" ? { mode: plan.transport.mode, place: plan.transport.place, runs: plan.transport.runs.length, km: plan.transport.km } : null,
    production: plan.production ? { consumeQty: plan.production.consumeQty, outQty: plan.production.outQty, diffReason: plan.production.diffReason, source: plan.production.source,
      forestDistrict: plan.production.forestDistrict, forestry: plan.production.forestry, waybill: plan.production.waybill, investSite: plan.production.investSite } : null,
    extras: plan.extras.map(x => ({ typeId: x.typeId, cost: x.cost })),
  };
}

const money = (v: string | null | undefined) => (v === null || v === undefined || D(v).isZero() ? null : `${D(v).toFixed(2).replace(".", ",")} zł`);
const qty = (v: string, u: Unit) => `${formatQty(v)} ${UNIT_LABEL[u]}`;
const SRC: Record<ValueSource, string> = { AUTO: "AUTO", MANUAL: "RĘCZNY", COMPANY_RATE: "przelicznik firmowy" };

/** Migawka → pola opisane po polsku (klucz = nazwa pola widoczna w historii zmian). */
export function describeSnapshot(s: OperationSnapshot, n: SnapshotNames): Map<string, string> {
  const out = new Map<string, string>();
  const put = (k: string, v: string | null | undefined) => { if (v !== null && v !== undefined && v !== "") out.set(k, v); };
  put("Data operacji", s.date);
  put("Data dokumentu", s.documentDate);
  put("Nr dokumentu zewnętrznego", s.externalNumber);
  put("Uwagi", s.notes);
  if (s.targetWarehouseId) put("Magazyn docelowy", n.warehouse(s.targetWarehouseId));
  // typ dokumentu powtarza się tylko przy kilku dokumentach tego samego typu — wtedy z numerem kolejnym
  const seen = new Map<string, number>();
  for (const d of s.documents) {
    if (d.type === "TR") continue;
    const k = (seen.get(d.type) ?? 0) + 1; seen.set(d.type, k);
    const p = k > 1 ? `${d.type} (${k})` : d.type;
    if (d.partnerId) put(`${p} — kontrahent`, n.partner(d.partnerId));
    d.lines.forEach((l, i) => {
      const q = d.lines.length > 1 ? `${p} poz. ${i + 1}` : p;
      put(`${q} — materiał`, n.material(l.materialId));
      put(`${q} — ilość`, l.unitSource === l.unitStock ? qty(l.qtySource, l.unitSource) : `${qty(l.qtySource, l.unitSource)} = ${qty(l.qtyStock, l.unitStock)}`);
      if (l.weightT) put(`${q} — tonaż`, `${formatQty(l.weightT)} t${l.weightSource ? ` (${SRC[l.weightSource]})` : ""}`);
      if (l.unitPrice && l.priceUnit) put(`${q} — cena`, `${D(l.unitPrice).toFixed(2).replace(".", ",")} zł / ${UNIT_LABEL[l.priceUnit]}`);
      put(`${q} — wartość`, money(l.value));
    });
  }
  if (s.production) {
    put("Produkcja — zużycie", `${formatQty(s.production.consumeQty)} m³`);
    put("Produkcja — wynik", `${formatQty(s.production.outQty)} MP`);
    if (s.production.diffReason) put("Produkcja — przyczyna różnicy", (PRODUCTION_DIFF_REASONS as Record<string, string>)[s.production.diffReason] ?? s.production.diffReason);
    if (s.production.source) put("Pochodzenie", PRODUCTION_SOURCE_LABEL[s.production.source]);
    put("Nadleśnictwo", s.production.forestDistrict); put("Leśnictwo", s.production.forestry); put("Kwit wywozowy", s.production.waybill); put("Miejsce wycinki", s.production.investSite);
  }
  put("Transport", s.transport ? TRANSPORT_MODE_LABEL[s.transport.mode] : "Brak transportu");
  if (s.transport) {
    put("Transport — miejsce", s.transport.place);
    if (s.transport.runs) put("Transport — kursy", `${s.transport.runs} · ${formatQty(s.transport.km)} km`);
  }
  put("Wartość zakupu", money(s.totals.purchaseCost));
  put("Przychód", money(s.totals.revenue));
  put("Koszt rąbania", money(s.totals.chippingCost));
  put("Koszt transportu", money(s.totals.transportCost));
  put("Operacje dodatkowe", s.extras.length ? `${s.extras.map(x => n.extraType(x.typeId)).join(", ")} · ${money(s.totals.additionalCost) ?? "0,00 zł"}` : null);
  return out;
}

/** BYŁO / JEST: pola, które się zmieniły, dodały albo zniknęły — w kolejności opisu (najpierw wersja po korekcie). */
export function diffSnapshots(before: OperationSnapshot, after: OperationSnapshot, names: SnapshotNames): FieldChange[] {
  const a = describeSnapshot(before, names), b = describeSnapshot(after, names);
  const keys = [...new Set([...b.keys(), ...a.keys()])];
  return keys.filter(k => a.get(k) !== b.get(k)).map(k => ({ field: k, before: a.get(k) ?? null, after: b.get(k) ?? null }));
}
