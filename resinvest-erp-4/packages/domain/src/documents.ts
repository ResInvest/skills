import Decimal from "decimal.js";
import { convert, tonnage, UnitError, DEFAULT_COMPANY_RATES, QTY_DP, UNIT_LABEL, type CompanyRates, type MaterialUnits, type Unit, type ValueSource } from "./units.js";
import { parseNumber } from "./number.js";
import { formatQty } from "./stock.js";
import { planTransport, TR_MODES, type PlannedTransport, type TransportFleet, type TransportInput } from "./transport.js";

/**
 * Planowanie operacji magazynowych (port reguł `planOperation` z ResInvest ERP 3.x) — czysta funkcja:
 * na wejściu dane formularza i kartoteki, na wyjściu dokumenty z pozycjami, ruchy magazynowe, kwoty i operacje
 * dodatkowe albo lista błędów przy polach. Ten sam kod liczy podgląd w formularzu i decyzję w API.
 * Stan (czy wystarczy towaru) sprawdza księga ruchów w transakcji — tutaj tylko reguły danych.
 */

export type OperationKind = "PURCHASE" | "SALE" | "PRODUCTION" | "TRANSFER";
export type DocType = "PZ" | "WZ" | "RW" | "PW" | "MM" | "TR";
export type NumberingMode = "AUTO" | "MANUAL";

export interface PlanMaterial extends MaterialUnits { id: string; name: string; active: boolean; category: string }
export interface PlanExtraType { id: string; name: string; active: boolean; unit: string | null; defaultRate: string | null }
export interface PlanContext {
  materials: ReadonlyMap<string, PlanMaterial>;
  extraTypes: ReadonlyMap<string, PlanExtraType>;
  rates?: CompanyRates;
  /** Dzień „dzisiaj” w strefie firmy (RRRR-MM-DD). */
  today: string;
  /** Tryb MM z konfiguracji: dwuetapowy (wysłanie → „W drodze” → przyjęcie) albo jednoetapowy. Domyślnie dwuetapowy. */
  transferTwoStage?: boolean;
  /** Flota i firmy przewozowe — sprawdzanie kursów transportu (API zawsze podaje). */
  fleet?: TransportFleet;
  /** Domyślna stawka transportu za km (zł). */
  kmRateDefault?: string;
}

export interface ExtraInput { typeId: string; vehicleId?: string | null; qty?: unknown; rate?: unknown; cost?: unknown; description?: string | null }
interface Base {
  warehouseId: string; date: string; documentDate?: string | null; externalNumber?: string | null; notes?: string | null;
  numbering?: { mode: NumberingMode; number?: string | null };
  extras?: ExtraInput[];
  /** Transport (zakup, sprzedaż, MM) — nie zmienia stanu, tworzy dokument TR z kosztem. */
  transport?: TransportInput | null;
}
export interface PurchaseInput extends Base { type: "PURCHASE"; partnerId: string; materialId: string; qty: unknown; unit: Unit; price: unknown; priceUnit?: Unit | null; weightManual?: unknown }
export interface SaleInput extends Base { type: "SALE"; partnerId: string; materialId: string; qty: unknown; unit: Unit; price: unknown; weightManual?: unknown }
export interface ProductionInput extends Base { type: "PRODUCTION"; rawMaterialId: string; outMaterialId: string; outQty: unknown; chipperId?: string | null; operatorId?: string | null; chipRate?: unknown }
export interface TransferInput extends Base { type: "TRANSFER"; targetWarehouseId: string; materialId: string; qty: unknown; unit: Unit; weightManual?: unknown }
export type OperationInput = PurchaseInput | SaleInput | ProductionInput | TransferInput;

export interface PlannedLine {
  materialId: string; qtySource: string; unitSource: Unit; qtyStock: string; unitStock: Unit; factor: string; source: ValueSource;
  weightT: string | null; weightSource: ValueSource | null; autoWeightT: string | null; unitPrice: string | null; priceUnit: Unit | null; value: string | null;
}
export interface PlannedDocument { type: DocType; partnerId: string | null; lines: PlannedLine[]; main: boolean }
export interface PlannedMovement { warehouseId: string; materialId: string; qty: string; kind: "PURCHASE" | "SALE" | "CONSUMPTION" | "PRODUCTION" | "TRANSFER_OUT" | "TRANSFER_IN"; doc: number; line: number }
export interface PlannedExtra { typeId: string; typeName: string; vehicleId: string | null; quantity: string | null; rate: string | null; cost: string; description: string | null }
export interface OperationPlan {
  type: OperationKind; warehouseId: string; date: string; documentDate: string;
  documents: PlannedDocument[]; movements: PlannedMovement[]; extras: PlannedExtra[];
  production: { rawMaterialId: string; outMaterialId: string; consumeQty: string; outQty: string; factor: string; chipRate: string | null; chippingCost: string } | null;
  /** MM: magazyn docelowy i tryb; przy dwuetapowym przychód w celu powstaje dopiero przy przyjęciu. */
  transfer: { targetWarehouseId: string; twoStage: boolean } | null;
  transport: PlannedTransport | null;
  /** Ostrzeżenia do podsumowania (nie blokują zapisu). */
  warnings: string[];
  totals: { purchaseCost: string; revenue: string; chippingCost: string; additionalCost: string; transportCost: string; result: string };
  numbering: { mode: NumberingMode; number: string | null };
  /** Opis do podsumowania przed zatwierdzeniem (np. „60 MP | 19,8 t | AUTO”). */
  summary: string[];
}
export type PlanResult = { ok: true; plan: OperationPlan } | { ok: false; errors: Array<{ field: string; message: string }> };

export const MAX_EXTRAS = 20;
export const DOC_NUMBER_RE = /^[\p{L}0-9][\p{L}0-9 /._-]{0,39}$/u;
const D = (v: Decimal.Value) => new Decimal(v);
const money = (v: Decimal.Value) => D(v).toDecimalPlaces(2).toFixed(2);
const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_LABEL: Record<ValueSource, string> = { AUTO: "AUTO", COMPANY_RATE: "AUTO", MANUAL: "RĘCZNY" };

export function planOperation(input: OperationInput, ctx: PlanContext): PlanResult {
  const errors: Array<{ field: string; message: string }> = [];
  const err = (field: string, message: string) => { errors.push({ field, message }); };
  const rates = ctx.rates ?? DEFAULT_COMPANY_RATES;
  const num = (field: string, v: unknown, opts: { positive?: boolean; optional?: boolean; label: string }): Decimal | null => {
    const p = parseNumber(v);
    if (!p.ok) { if (!(p.empty && opts.optional)) err(field, p.empty ? `Podaj: ${opts.label}` : p.error); return null; }
    const d = D(p.value);
    if (opts.positive ? d.lte(0) : d.lt(0)) { err(field, `${opts.label}: ${opts.positive ? "liczba większa od 0" : "liczba nie mniejsza od 0"}`); return null; }
    return d;
  };
  const material = (field: string, id: string, label: string): PlanMaterial | null => {
    const m = ctx.materials.get(id);
    if (!id || !m) { err(field, `Wybierz ${label}`); return null; }
    if (!m.active) { err(field, `Materiał „${m.name}” jest nieaktywny`); return null; }
    return m;
  };

  // --- daty i numeracja (wspólne) ---
  if (!isoDay.test(input.date ?? "")) err("date", "Podaj datę operacji");
  else if (input.date > ctx.today) err("date", "Data operacji nie może być z przyszłości");
  const documentDate = input.documentDate && input.documentDate.trim() ? input.documentDate : input.date;
  if (input.documentDate && input.documentDate.trim()) {
    if (!isoDay.test(input.documentDate)) err("documentDate", "Podaj datę dokumentu w formacie RRRR-MM-DD");
    else if (input.documentDate > ctx.today) err("documentDate", "Data dokumentu nie może być z przyszłości");
  }
  const mode: NumberingMode = input.numbering?.mode === "MANUAL" ? "MANUAL" : "AUTO";
  let manualNumber: string | null = null;
  if (input.type !== "PRODUCTION" && mode === "MANUAL") {
    const n = (input.numbering?.number ?? "").trim().replace(/\s+/g, " ");
    if (!n) err("numbering.number", "Wpisz numer dokumentu albo wybierz numerację automatyczną");
    else if (!DOC_NUMBER_RE.test(n)) err("numbering.number", "Numer dokumentu: litery, cyfry oraz znaki / . - _ (do 40 znaków)");
    else manualNumber = n;
  }
  if (input.externalNumber && input.externalNumber.length > 60) err("externalNumber", "Numer dokumentu zewnętrznego: maksymalnie 60 znaków");

  const documents: PlannedDocument[] = [], movements: PlannedMovement[] = [], summary: string[] = [];
  let purchaseCost = D(0), revenue = D(0), chippingCost = D(0);
  let production: OperationPlan["production"] = null;
  let transfer: OperationPlan["transfer"] = null;
  const wh = input.warehouseId;

  try {
    if (input.type === "PURCHASE" || input.type === "SALE") {
      const isBuy = input.type === "PURCHASE";
      if (!input.partnerId) err("partnerId", isBuy ? "Wybierz dostawcę" : "Wybierz odbiorcę");
      const m = material("materialId", input.materialId, isBuy ? "materiał" : "towar z magazynu");
      const qty = num("qty", input.qty, { positive: true, label: "ilość" });
      const price = num("price", input.price, { label: "cena" });
      if (m && qty) {
        let conv;
        try { conv = convert(qty, input.unit, m.stockUnit, m, rates); } catch (e) { err("unit", e instanceof UnitError ? e.message : "Nieprawidłowa jednostka"); }
        if (conv) {
          // tonaż: RĘCZNY z wagi (gdy podany) albo AUTO z przelicznika — wartość ręczna nigdy nie jest nadpisywana
          let manualW: string | null = null;
          if (input.weightManual !== undefined && input.weightManual !== null && String(input.weightManual).trim() !== "") {
            const p = parseNumber(input.weightManual);
            if (p.ok) manualW = p.value; else err("weightManual", p.error);
          }
          let w: ReturnType<typeof tonnage> | null = null;
          try { w = tonnage(conv.value, m, manualW, rates); } catch { err("weightManual", "Tonaż z wagi: liczba większa od 0"); }
          // cena: zakup — za wybraną jednostkę ceny (domyślnie jednostka ilości); sprzedaż z magazynu — za jednostkę ilości
          const priceUnit: Unit = isBuy && input.priceUnit ? input.priceUnit : input.unit;
          let priceQty: Decimal | null = null;
          try { priceQty = D(priceUnit === input.unit ? qty : convert(qty, input.unit, priceUnit, m, rates).value); } catch (e) { err("priceUnit", e instanceof UnitError ? e.message : "Nieprawidłowa jednostka ceny"); }
          const value = price && priceQty ? money(priceQty.mul(price)) : null;
          if (value) { if (isBuy) purchaseCost = D(value); else revenue = D(value); }
          documents.push({ type: isBuy ? "PZ" : "WZ", partnerId: input.partnerId || null, main: true, lines: [{
            materialId: m.id, qtySource: qty.toString(), unitSource: input.unit, qtyStock: conv.value, unitStock: m.stockUnit, factor: conv.factor, source: conv.source,
            weightT: w?.weightT ?? null, weightSource: w?.source ?? null, autoWeightT: w?.autoWeightT ?? null,
            unitPrice: price ? price.toString() : null, priceUnit, value }] });
          movements.push({ warehouseId: wh, materialId: m.id, qty: isBuy ? conv.value : D(conv.value).neg().toString(), kind: isBuy ? "PURCHASE" : "SALE", doc: 0, line: 0 });
          if (w) summary.push(`${formatQty(qty)} ${UNIT_LABEL[input.unit]} | ${formatQty(w.weightT)} t | ${SOURCE_LABEL[w.source]}`);
        }
      }
    } else if (input.type === "TRANSFER") {
      const twoStage = ctx.transferTwoStage !== false;
      if (!input.targetWarehouseId) err("targetWarehouseId", "Wybierz magazyn docelowy przesunięcia");
      else if (input.targetWarehouseId === wh) err("targetWarehouseId", "Magazyn źródłowy i docelowy nie mogą być takie same");
      const m = material("materialId", input.materialId, "materiał");
      const qty = num("qty", input.qty, { positive: true, label: "ilość" });
      if (m && qty) {
        let conv;
        try { conv = convert(qty, input.unit, m.stockUnit, m, rates); } catch (e) { err("unit", e instanceof UnitError ? e.message : "Nieprawidłowa jednostka"); }
        if (conv) {
          let manualW: string | null = null;
          if (input.weightManual !== undefined && input.weightManual !== null && String(input.weightManual).trim() !== "") {
            const p = parseNumber(input.weightManual);
            if (p.ok) manualW = p.value; else err("weightManual", p.error);
          }
          let w: ReturnType<typeof tonnage> | null = null;
          try { w = tonnage(conv.value, m, manualW, rates); } catch { err("weightManual", "Tonaż z wagi: liczba większa od 0"); }
          documents.push({ type: "MM", partnerId: null, main: true, lines: [{
            materialId: m.id, qtySource: qty.toString(), unitSource: input.unit, qtyStock: conv.value, unitStock: m.stockUnit, factor: conv.factor, source: conv.source,
            weightT: w?.weightT ?? null, weightSource: w?.source ?? null, autoWeightT: w?.autoWeightT ?? null, unitPrice: null, priceUnit: null, value: null }] });
          movements.push({ warehouseId: wh, materialId: m.id, qty: D(conv.value).neg().toString(), kind: "TRANSFER_OUT", doc: 0, line: 0 });
          if (!twoStage && input.targetWarehouseId && input.targetWarehouseId !== wh) movements.push({ warehouseId: input.targetWarehouseId, materialId: m.id, qty: conv.value, kind: "TRANSFER_IN", doc: 0, line: 0 });
          if (w) summary.push(`${formatQty(qty)} ${UNIT_LABEL[input.unit]} | ${formatQty(w.weightT)} t | ${SOURCE_LABEL[w.source]}`);
          summary.push(twoStage ? "MM dwuetapowe: towar „W drodze” do przyjęcia w magazynie docelowym" : "MM jednoetapowe: przychód w magazynie docelowym przy zatwierdzeniu");
        }
      }
      transfer = input.targetWarehouseId && input.targetWarehouseId !== wh ? { targetWarehouseId: input.targetWarehouseId, twoStage } : null;
    } else {
      const raw = material("rawMaterialId", input.rawMaterialId, "surowiec");
      const out = material("outMaterialId", input.outMaterialId, "produkt wyjściowy");
      const outQty = num("outQty", input.outQty, { positive: true, label: "ilość produkcji" });
      const chipRate = num("chipRate", input.chipRate, { optional: true, label: "cena za rąbanie" });
      if (raw && out && raw.id === out.id) err("outMaterialId", "Surowiec i produkt wyjściowy muszą być różnymi materiałami");
      if (raw && raw.stockUnit !== "M3") err("rawMaterialId", "Surowiec do produkcji zrębki musi być prowadzony w m³");
      if (out && out.stockUnit !== "MP") err("outMaterialId", "Produkt wyjściowy (zrębka) musi być prowadzony w MP");
      if (raw && out && outQty && raw.id !== out.id && raw.stockUnit === "M3" && out.stockUnit === "MP") {
        // zużycie = produkcja ÷ przelicznik MP z 1 m³ (surowca, a gdy brak — firmowy); precyzja przed zaokrągleniem jak w 3.x
        const factor = D(raw.mpPerM3 ?? rates.mpPerM3);
        const consume = outQty.div(factor).toDecimalPlaces(QTY_DP);
        chippingCost = chipRate ? D(money(outQty.mul(chipRate))) : D(0);
        documents.push({ type: "RW", partnerId: null, main: false, lines: [line(raw, consume, "M3", "1")] });
        documents.push({ type: "PW", partnerId: null, main: true, lines: [line(out, outQty, "MP", "1")] });
        movements.push({ warehouseId: wh, materialId: raw.id, qty: consume.neg().toString(), kind: "CONSUMPTION", doc: 0, line: 0 });
        movements.push({ warehouseId: wh, materialId: out.id, qty: outQty.toString(), kind: "PRODUCTION", doc: 1, line: 0 });
        production = { rawMaterialId: raw.id, outMaterialId: out.id, consumeQty: consume.toString(), outQty: outQty.toString(), factor: factor.toString(), chipRate: chipRate ? chipRate.toFixed(2) : null, chippingCost: money(chippingCost) };
        summary.push(`Zużycie ${formatQty(consume)} m³ → produkcja ${formatQty(outQty)} MP (1 m³ = ${formatQty(factor)} MP)`);
      }
    }
  } catch (e) {
    err("form", e instanceof Error ? e.message : "Nie można zaplanować operacji");
  }

  // --- transport (zakup, sprzedaż, MM; produkcja na magazynie — bez transportu) ---
  let transport: PlannedTransport | null = null;
  if (input.type === "PRODUCTION") {
    if (input.transport && input.transport.mode !== "NONE") err("transport.mode", "Produkcja na magazynie nie ma transportu");
  } else {
    const main = documents.find(d => d.main)?.lines[0];
    transport = planTransport(input.transport, { materialId: main?.materialId ?? null, qty: main?.qtyStock ?? "0", unit: main?.unitStock ?? null, weightT: main?.weightT ?? null },
      { warehouseId: wh, rates, purchase: input.type === "PURCHASE", ...(ctx.fleet ? { fleet: ctx.fleet } : {}), ...(ctx.kmRateDefault ? { kmRateDefault: ctx.kmRateDefault } : {}) }, err);
    if (transport && TR_MODES.includes(transport.mode)) documents.push({ type: "TR", partnerId: null, main: false, lines: [] });
  }
  const transportCost = D(transport?.cost ?? 0);

  // --- operacje dodatkowe (każda operacja) ---
  const extras: PlannedExtra[] = [];
  const items = input.extras ?? [];
  if (items.length > MAX_EXTRAS) err("extras", `Maksymalnie ${MAX_EXTRAS} operacji dodatkowych w jednej operacji`);
  items.slice(0, MAX_EXTRAS).forEach((x, i) => {
    const f = (k: string) => `extras.${i}.${k}`;
    const t = ctx.extraTypes.get(x.typeId);
    if (!t) { err(f("typeId"), "Wybierz rodzaj operacji dodatkowej"); return; }
    if (!t.active) { err(f("typeId"), `Rodzaj „${t.name}” jest nieaktywny w kartotece`); return; }
    const q = num(f("qty"), x.qty, { optional: true, positive: true, label: "ilość" });
    const r = num(f("rate"), x.rate, { optional: true, label: "stawka" });
    const c = num(f("cost"), x.cost, { optional: true, label: "koszt" });
    const rate = r ?? (t.defaultRate ? D(t.defaultRate) : null);
    const cost = c ?? (q && rate ? D(money(q.mul(rate))) : null);
    if (cost === null) { err(f("cost"), "Podaj koszt (kwotę) albo ilość i stawkę"); return; }
    if ((x.description ?? "").length > 300) err(f("description"), "Opis: maksymalnie 300 znaków");
    extras.push({ typeId: t.id, typeName: t.name, vehicleId: x.vehicleId || null, quantity: q ? q.toString() : null, rate: rate ? rate.toFixed(2) : null, cost: money(cost), description: x.description?.trim() || null });
  });
  const additionalCost = extras.reduce((a, x) => a.plus(x.cost), D(0));
  if (errors.length) return { ok: false, errors };
  const result = revenue.minus(purchaseCost).minus(chippingCost).minus(additionalCost).minus(transportCost);
  return { ok: true, plan: {
    type: input.type, warehouseId: wh, date: input.date, documentDate, documents, movements, extras, production, transfer, transport, warnings: transport?.warnings ?? [],
    totals: { purchaseCost: money(purchaseCost), revenue: money(revenue), chippingCost: money(chippingCost), additionalCost: money(additionalCost), transportCost: money(transportCost), result: money(result) },
    numbering: { mode: input.type === "PRODUCTION" ? "AUTO" : mode, number: manualNumber }, summary,
  } };
}

function line(m: PlanMaterial, qty: Decimal, unit: Unit, factor: string): PlannedLine {
  return { materialId: m.id, qtySource: qty.toString(), unitSource: unit, qtyStock: qty.toString(), unitStock: m.stockUnit, factor, source: "AUTO", weightT: null, weightSource: null, autoWeightT: null, unitPrice: null, priceUnit: null, value: null };
}

/** Numer automatyczny: TYP/NNN/MM/RRRR (kolejny w miesiącu dla typu i magazynu). */
export const autoNumber = (type: string, seq: number, date: string) => `${type}/${String(seq).padStart(3, "0")}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
/** Porównanie numerów bez względu na wielkość liter i spacje (unikalność typ + magazyn + rok). */
export const normalizeDocNumber = (n: string) => n.replace(/\s+/g, "").toUpperCase();

/** Przyczyny różnicy między ilością wysłaną a przyjętą na MM (jak w 3.x). */
export const MM_DIFF_REASONS = {
  LOSS: "Ubytek w transporcie", MEASUREMENT: "Różnica pomiaru", MOISTURE: "Wilgotność / osiadanie",
  DAMAGE: "Uszkodzenie / zanieczyszczenie", SURPLUS: "Nadwyżka przy przyjęciu", OTHER: "Inna przyczyna",
} as const;
export type MmDiffReason = keyof typeof MM_DIFF_REASONS;

export interface ReceiptInput { date?: string | null; qty?: unknown; unit?: Unit | null; weightManual?: unknown; reason?: string | null; note?: string | null }
export interface ReceiptContext {
  material: MaterialUnits & { name: string };
  /** Wysłano (jednostka magazynowa) i data wysłania MM. */
  sentQtyStock: string; sentDate: string; sentUnit: Unit;
  today: string; rates?: CompanyRates;
}
export interface ReceiptPlan {
  date: string; qtySource: string; unitSource: Unit; qtyStock: string; factor: string;
  /** wysłano − przyjęto (jednostka magazynowa): > 0 ubytek, < 0 nadwyżka, 0 bez różnicy. */
  diffStock: string; reason: MmDiffReason | null; note: string | null;
  weightT: string | null; weightSource: ValueSource | null;
}
export type ReceiptResult = { ok: true; plan: ReceiptPlan } | { ok: false; errors: Array<{ field: string; message: string }> };

/**
 * Przyjęcie MM dwuetapowego w magazynie docelowym (port `planReceive` z 3.x): ilość faktycznie przyjęta
 * (puste = cała wysłana), data nie wcześniejsza niż wysłanie i nie z przyszłości, przy różnicy — przyczyna
 * („Inna przyczyna” i przyjęcie zerowe wymagają opisu), tonaż AUTO z przelicznika albo RĘCZNY z wagi.
 */
export function planReceipt(input: ReceiptInput, ctx: ReceiptContext): ReceiptResult {
  const errors: Array<{ field: string; message: string }> = [];
  const err = (field: string, message: string) => { errors.push({ field, message }); };
  const rates = ctx.rates ?? DEFAULT_COMPANY_RATES;
  const m = ctx.material;
  const date = input.date && input.date.trim() ? input.date : ctx.today;
  if (!isoDay.test(date)) err("date", "Podaj datę przyjęcia w formacie RRRR-MM-DD");
  else if (date > ctx.today) err("date", "Data przyjęcia nie może być z przyszłości");
  else if (date < ctx.sentDate) err("date", `Data przyjęcia nie może być wcześniejsza niż data wysłania (${ctx.sentDate})`);
  const unit: Unit = input.unit ?? ctx.sentUnit;
  if (!m.allowedUnits.includes(unit)) err("unit", `Dla „${m.name}” dozwolone: ${m.allowedUnits.map(u => UNIT_LABEL[u]).join(", ")}`);
  let qty: Decimal | null = null;
  if (input.qty === undefined || input.qty === null || String(input.qty).trim() === "") {
    try { qty = D(convert(ctx.sentQtyStock, m.stockUnit, unit, m, rates).value); } catch (e) { err("unit", e instanceof UnitError ? e.message : "Nieprawidłowa jednostka"); }
  } else {
    const p = parseNumber(input.qty);
    if (!p.ok) err("qty", p.error);
    else if (D(p.value).lt(0)) err("qty", "Ilość przyjęta nie może być ujemna");
    else qty = D(p.value);
  }
  let qtyStock: string | null = null, factor = "1";
  if (qty !== null && !errors.some(e => e.field === "unit")) {
    try { const c = convert(qty, unit, m.stockUnit, m, rates); qtyStock = c.value; factor = c.factor; } catch (e) { err("unit", e instanceof UnitError ? e.message : "Nieprawidłowa jednostka"); }
  }
  const note = (input.note ?? "").trim().slice(0, 300) || null;
  const reasonRaw = (input.reason ?? "").trim();
  const reason = reasonRaw in MM_DIFF_REASONS ? (reasonRaw as MmDiffReason) : null;
  const diff = qtyStock !== null ? D(ctx.sentQtyStock).minus(qtyStock) : D(0);
  if (qtyStock !== null && !diff.isZero()) {
    if (!reason) err("reason", `Ilość przyjęta różni się od wysłanej o ${formatQty(diff.abs())} ${UNIT_LABEL[m.stockUnit]} — wskaż przyczynę`);
    else if (reason === "OTHER" && !note) err("note", "Opisz przyczynę różnicy");
  }
  if (qtyStock !== null && D(qtyStock).isZero() && !note) err("note", "Przyjęcie zerowe (cała dostawa utracona) wymaga opisu");
  let weightT: string | null = null, weightSource: ValueSource | null = null;
  if (qtyStock !== null && D(qtyStock).gt(0)) {
    let manual: string | null = null;
    if (input.weightManual !== undefined && input.weightManual !== null && String(input.weightManual).trim() !== "") {
      const p = parseNumber(input.weightManual);
      if (p.ok) manual = p.value; else err("weightManual", p.error);
    }
    try { const w = tonnage(qtyStock, m, manual, rates); weightT = w.weightT; weightSource = w.source; } catch { err("weightManual", "Tonaż z wagi: liczba większa od 0"); }
  }
  if (errors.length || qty === null || qtyStock === null) return { ok: false, errors: errors.length ? errors : [{ field: "qty", message: "Podaj ilość przyjętą" }] };
  return { ok: true, plan: { date, qtySource: qty.toString(), unitSource: unit, qtyStock, factor, diffStock: diff.toString(), reason: diff.isZero() ? null : reason, note, weightT, weightSource } };
}
