import type { OperationInput } from "@resinvest/domain";

type Kind = OperationInput["type"];
export type GuideState = "done" | "missing" | "optional";
export interface GuideStep { key: string; label: string; help: string; el: string; state: GuideState; message?: string }
export interface FieldError { field: string; message: string }

/**
 * Pole domeny (klucz błędu z `planOperation`) → id kontrolki w formularzu. Dzięki temu lista kontrolna przenosi
 * dokładnie do pola z błędem, a podświetlenie na czerwono dotyczy tej kontrolki, której dotyczy komunikat.
 */
const DIRECT: Record<string, string> = {
  date: "op-date", partnerId: "op-partner", materialId: "op-mat", qty: "op-qty", unit: "op-qty", price: "op-price", priceUnit: "op-price",
  weightManual: "op-weight", "numbering.number": "op-number", externalNumber: "op-ext", documentDate: "op-docdate", note: "op-notes",
  targetWarehouseId: "op-target", rawMaterialId: "op-raw", rawCost: "op-rawcost", outMaterialId: "op-out", outQty: "op-outqty",
  chipRate: "op-chiprate", chipperId: "op-chipper", operatorId: "op-operator", extras: "op-extra-add", form: "op-next",
  "production.enabled": "ch-out", "production.outMaterialId": "ch-out", "production.consumeQty": "ch-consume", "production.outQty": "ch-outqty",
  "production.diffReason": "ch-diff", "production.chipperId": "ch-chipper", "production.operatorId": "ch-operator", "production.chipRate": "ch-rate",
  "production.forestDistrict": "ch-ndl", "production.forestry": "ch-lesn", "production.waybill": "ch-kwit", "production.investSite": "ch-site",
  "sale.buyerId": "os-buyer", "sale.qty": "os-qty", "sale.price": "os-price", "sale.priceUnit": "os-price", "sale.weightManual": "os-weight",
  "transport.mode": "tr-mode", "transport.place": "tr-place", "transport.externalCompanyId": "tr-company", "transport.runs": "tr-run-add",
  "transport.train.wagonTons": "tr-wagons", "transport.train.price": "tr-tprice", "transport.train.priceUnit": "tr-tprice",
};
const RUN: Record<string, string> = { vehicleId: "tr-veh", ownership: "tr-veh", driverId: "tr-drv", registration: "tr-reg", km: "tr-km", rate: "tr-rate",
  freight: "tr-fr", qty: "tr-qty", weightT: "tr-w", waybillNo: "tr-wb", waybillM3: "tr-wb" };
const EXTRA: Record<string, string> = { typeId: "ex-type", vehicleId: "ex-veh", qty: "ex-qty", rate: "ex-rate", cost: "ex-cost", description: "ex-desc" };

export function elFor(field: string): string {
  if (DIRECT[field]) return DIRECT[field];
  let m = /^transport\.runs\.(\d+)\.(\w+)$/.exec(field);
  if (m) return `${RUN[m[2] ?? ""] ?? "tr-km"}-${m[1] ?? 0}`;
  if (/^transport\.train\.wagonTons\.\d+$/.test(field)) return "tr-wagons";
  m = /^extras\.(\d+)\.(\w+)$/.exec(field);
  if (m) return `${EXTRA[m[2] ?? ""] ?? "ex-type"}-${m[1] ?? 0}`;
  return "op-next";
}

interface Ctx {
  type: Kind;
  f: { partnerId: string; materialId: string; qty: string; price: string; weightManual: string; targetWarehouseId: string; rawMaterialId: string; outMaterialId: string;
    outQty: string; chipperId: string; chipRate: string; numberMode: string; number: string; externalNumber: string };
  day: string;
  chain: { enabled: boolean; outMaterialId: string; outQty: string; source: string; forestDistrict: string; forestry: string; waybill: string; investSite: string };
  sale: { enabled: boolean; buyerId: string; price: string };
  transportMode: string;
  extras: number;
  errors: FieldError[];
}
interface Def { key: string; label: string; help: string; el: string; fields: string[]; required: boolean; filled: boolean }

/** Kroki listy kontrolnej dla rodzaju operacji; stan kroku = błąd domeny w jego polach albo brak wymaganej wartości. */
export function guideSteps(c: Ctx): GuideStep[] {
  const { type, f, chain, sale } = c;
  const defs: Def[] = [{ key: "date", label: "Magazyn i data", help: "Data ruchu w księdze", el: "op-date", fields: ["date"], required: true, filled: !!c.day }];
  const partner = (label: string, help: string) => defs.push({ key: "partner", label, help, el: "op-partner", fields: ["partnerId"], required: true, filled: !!f.partnerId });
  const material = (label: string) => defs.push({ key: "material", label, help: "Pozycja z kartoteki materiałów", el: "op-mat", fields: ["materialId"], required: true, filled: !!f.materialId });
  const qty = () => defs.push({ key: "qty", label: "Ilość", help: "Ilość i jednostka", el: "op-qty", fields: ["qty", "unit"], required: true, filled: !!f.qty.trim() });
  const price = (help: string) => defs.push({ key: "price", label: "Cena netto", help, el: "op-price", fields: ["price", "priceUnit"], required: true, filled: !!f.price.trim() });
  const weight = () => defs.push({ key: "weight", label: "Tonaż z wagi", help: "Opcjonalnie — puste = AUTO", el: "op-weight", fields: ["weightManual"], required: false, filled: !!f.weightManual.trim() });
  const origin = () => {
    if (chain.source === "FOREST") defs.push({ key: "origin", label: "Pochodzenie: las", help: "Nadleśnictwo, leśnictwo, kwit", el: "ch-ndl",
      fields: ["production.forestDistrict", "production.forestry", "production.waybill"], required: true, filled: !!chain.forestDistrict.trim() && !!chain.forestry.trim() });
    else if (chain.source === "INVESTMENT") defs.push({ key: "origin", label: "Pochodzenie: wycinka", help: "Miejsce wycinki / inwestycja", el: "ch-site",
      fields: ["production.investSite"], required: true, filled: !!chain.investSite.trim() });
    else defs.push({ key: "origin", label: "Pochodzenie surowca", help: "Inne — bez dodatkowych danych", el: "ch-source", fields: [], required: false, filled: true });
  };
  const chainStep = (direct: boolean) => defs.push({ key: "production", label: direct ? "Produkcja w lesie" : "Produkcja z zakupu", help: "Produkt (zrębka) i wynik w MP", el: "ch-out",
    fields: ["production.enabled", "production.outMaterialId", "production.consumeQty", "production.outQty", "production.diffReason", "production.chipRate", "production.chipperId", "production.operatorId"],
    required: true, filled: !!chain.outMaterialId && (!direct || !!chain.outQty.trim()) });
  const saleStep = () => defs.push({ key: "sale", label: "Sprzedaż wyniku", help: "Odbiorca i cena", el: "os-buyer", fields: ["sale."], required: true, filled: !!sale.buyerId && !!sale.price.trim() });

  if (type === "PURCHASE") {
    partner("Dostawca", "Kontrahent z kartoteki");
    material("Materiał"); qty(); price("Cena za jednostkę"); weight();
    if (chain.enabled) { chainStep(false); origin(); if (sale.enabled) saleStep(); }
  } else if (type === "SALE") {
    partner("Odbiorca", "Kontrahent z kartoteki");
    material("Towar z magazynu"); qty(); price("Cena za jednostkę"); weight();
  } else if (type === "TRANSFER") {
    defs.push({ key: "target", label: "Magazyn docelowy", help: "Dokąd przesuwasz towar", el: "op-target", fields: ["targetWarehouseId"], required: true, filled: !!f.targetWarehouseId });
    material("Materiał"); qty(); weight();
  } else if (type === "PRODUCTION") {
    defs.push({ key: "raw", label: "Surowiec (m³)", help: "Drewno ze stanu", el: "op-raw", fields: ["rawMaterialId"], required: true, filled: !!f.rawMaterialId });
    defs.push({ key: "out", label: "Produkt — zrębka", help: "Materiał w MP", el: "op-out", fields: ["outMaterialId"], required: true, filled: !!f.outMaterialId });
    defs.push({ key: "outqty", label: "Ilość produkcji", help: "MP zrębki", el: "op-outqty", fields: ["outQty"], required: true, filled: !!f.outQty.trim() });
    defs.push({ key: "chipper", label: "Rębak i stawka", help: "Opcjonalnie", el: "op-chipper", fields: ["chipperId", "operatorId", "chipRate"], required: false, filled: !!f.chipperId || !!f.chipRate.trim() });
  } else {
    defs.push({ key: "raw", label: "Surowiec wejściowy", help: "Drewno z lasu (nie ze stanu)", el: "op-raw", fields: ["rawMaterialId", "rawCost"], required: true, filled: !!f.rawMaterialId });
    chainStep(true); origin(); saleStep();
  }
  if (type !== "PRODUCTION") {
    defs.push({ key: "number", label: "Numer dokumentu", help: f.numberMode === "MANUAL" ? "Numer ręczny" : "Automatyczny", el: f.numberMode === "MANUAL" ? "op-number" : "op-numbering",
      fields: ["numbering.number", "externalNumber", "documentDate"], required: f.numberMode === "MANUAL", filled: f.numberMode !== "MANUAL" || !!f.number.trim() });
    defs.push({ key: "transport", label: "Transport", help: c.transportMode === "NONE" ? "Opcjonalnie — brak transportu" : "Kursy, miejsce, koszt", el: "tr-mode",
      fields: ["transport."], required: c.transportMode !== "NONE", filled: c.transportMode !== "NONE" });
  }
  defs.push({ key: "extras", label: "Operacje dodatkowe", help: "Opcjonalnie — koszty dodatkowe", el: "op-extra-add", fields: ["extras"], required: false, filled: c.extras > 0 });

  const hit = (d: Def) => c.errors.find(e => d.fields.some(p => (p.endsWith(".") ? e.field.startsWith(p) : e.field === p || e.field.startsWith(`${p}.`))));
  return defs.map(d => {
    const e = hit(d);
    const state: GuideState = e || (d.required && !d.filled) ? "missing" : d.filled ? "done" : "optional";
    return { key: d.key, label: d.label, help: d.help, el: e ? elFor(e.field) : d.el, state, message: e?.message };
  });
}

/** Przewinięcie do kontrolki i fokus — z krótkim podświetleniem, żeby było widać, gdzie uzupełnić. */
export function goToField(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.focus({ preventScroll: true });
  el.classList.add("flash");
  window.setTimeout(() => el.classList.remove("flash"), 1600);
}

/**
 * Panel „Co jeszcze uzupełnić”: kroki operacji w kolejności formularza, czerwone braki, zielone gotowe, szare opcjonalne.
 * Pierwszy brak jest oznaczony jako „teraz”; kliknięcie przenosi do pola. Na telefonie pasek na dole ekranu prowadzi do
 * kolejnego braku.
 */
export function OperationGuide({ steps, onGo }: { steps: GuideStep[]; onGo: (el: string) => void }) {
  const required = steps.filter(s => s.state !== "optional");
  const done = required.filter(s => s.state === "done").length;
  const missing = steps.filter(s => s.state === "missing");
  const first = missing[0];
  const pct = required.length ? Math.round((done / required.length) * 100) : 100;
  return (
    <>
      <section className="card op-guide" id="op-guide" aria-label="Co jeszcze uzupełnić">
        <header className="card-h"><h2>Co jeszcze uzupełnić</h2><span className={`badge ${missing.length ? "err" : "ok"}`} id="op-guide-count">{missing.length ? `brakuje: ${missing.length}` : "komplet"}</span></header>
        <div className="guide-bar" role="progressbar" aria-label="Postęp uzupełniania" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
        <p className="muted small">{done} z {required.length} wymaganych kroków gotowe</p>
        <ol className="guide">
          {steps.map(s => (
            <li key={s.key} data-step={s.key} data-state={s.state} className={`g-${s.state}${s.key === first?.key ? " g-next" : ""}`}>
              <button type="button" title={s.help} onClick={() => onGo(s.el)}>
                <span className="g-ico" aria-hidden="true">{s.state === "done" ? "✓" : s.state === "missing" ? "!" : "○"}</span>
                <span className="g-txt"><strong>{s.label}</strong>{s.key === first?.key && <em> — teraz</em>}
                  <small>{s.state === "missing" ? (s.message ?? "Do uzupełnienia") : s.help}</small></span>
                <span className="sr-only">{s.state === "done" ? "gotowe" : s.state === "missing" ? "brak" : "opcjonalne"}</span>
              </button>
            </li>
          ))}
        </ol>
        {!missing.length && <p className="guide-ok small">Wszystko uzupełnione — kliknij „Dalej — podsumowanie”.</p>}
      </section>
      {first && <button type="button" className="guide-float" id="op-guide-next" onClick={() => onGo(first.el)}>
        <span className="g-ico" aria-hidden="true">!</span> Brakuje {missing.length}: <strong>{first.label}</strong> →</button>}
    </>
  );
}
