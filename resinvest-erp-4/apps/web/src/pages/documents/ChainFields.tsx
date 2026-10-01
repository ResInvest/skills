import { Hint } from "../../ui/tutorial";
import { OP_HELP } from "./help";
import { PRODUCTION_DIFF_REASONS, PRODUCTION_SOURCE_LABEL, type ChainProductionInput, type OutputSaleInput, type PlanMaterial, type ProductionSource } from "@resinvest/domain";

export interface ChainState {
  enabled: boolean; outMaterialId: string; consumeQty: string; outQty: string; diffReason: string; chipperId: string; operatorId: string; chipRate: string;
  source: ProductionSource; forestDistrict: string; forestry: string; waybill: string; investSite: string; sourceDoc: string;
}
export interface SaleState { enabled: boolean; buyerId: string; qty: string; price: string; priceUnit: "MP" | "T"; weightManual: string }
export const EMPTY_CHAIN: ChainState = { enabled: false, outMaterialId: "", consumeQty: "", outQty: "", diffReason: "", chipperId: "", operatorId: "", chipRate: "",
  source: "FOREST", forestDistrict: "", forestry: "", waybill: "", investSite: "", sourceDoc: "" };
export const EMPTY_SALE: SaleState = { enabled: false, buyerId: "", qty: "", price: "", priceUnit: "MP", weightManual: "" };

export const toChainInput = (c: ChainState): ChainProductionInput => ({
  enabled: c.enabled, outMaterialId: c.outMaterialId, consumeQty: c.consumeQty, outQty: c.outQty, diffReason: c.diffReason || null,
  chipperId: c.chipperId || null, operatorId: c.operatorId || null, chipRate: c.chipRate, source: c.source,
  forestDistrict: c.forestDistrict || null, forestry: c.forestry || null, waybill: c.waybill || null, investSite: c.investSite || null, sourceDoc: c.sourceDoc || null,
});
export const toSaleInput = (s: SaleState): OutputSaleInput => ({ buyerId: s.buyerId, qty: s.qty, price: s.price, priceUnit: s.priceUnit, weightManual: s.weightManual });

interface Lookups {
  materials: Array<PlanMaterial & { code: string }>;
  partners: Array<{ id: string; name: string; role: string; kind?: string; forestries?: string[] }>;
  chippers: Array<{ id: string; name: string; company: string | null; operatorId: string | null }>;
  operators: Array<{ id: string; name: string }>;
}

/**
 * Produkcja zrębki w operacji (zakup z produkcją albo sprzedaż bezpośrednia): produkt, zużycie / wynik, przyczyna różnicy,
 * rębak i operator, cena rąbania, pochodzenie surowca (las: nadleśnictwo, leśnictwo, kwit; wycinka: miejsce).
 */
export function ChainProductionFields({ value, onChange, data, mode, purchaseUnit, supplierId, transportRuns, fe }: {
  value: ChainState; onChange: (c: ChainState) => void; data: Lookups; mode: "FROM_PURCHASE" | "DIRECT"; purchaseUnit: string;
  supplierId?: string; transportRuns: boolean; fe: (f: string) => string | undefined;
}) {
  const c = value;
  const set = (p: Partial<ChainState>) => onChange({ ...c, ...p });
  const err = (f: string) => fe(f) && <small className="error">{fe(f)}</small>;
  const H = (id: string) => <Hint id={id} text={OP_HELP[id]} />;
  const supplier = data.partners.find(p => p.id === supplierId);
  const forestries = supplier?.forestries ?? [];
  return (
    <div className="grid2 chain" id="op-chain">
      <div className="field"><label htmlFor="ch-out">Produkt — zrębka (MP) <span className="req">*</span></label>
        <select id="ch-out" className="ctrl" value={c.outMaterialId} onChange={e => set({ outMaterialId: e.target.value })}>
          <option value="">— wybierz —</option>{data.materials.filter(m => m.active && m.stockUnit === "MP").map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>{H("ch-out")}{err("production.outMaterialId")}{err("production.enabled")}</div>
      {mode === "FROM_PURCHASE" && <div className="field"><label htmlFor="ch-consume">Zużycie surowca ({purchaseUnit})</label>
        <input id="ch-consume" className="ctrl r" inputMode="decimal" placeholder="puste = cały zakup" value={c.consumeQty} onChange={e => set({ consumeQty: e.target.value })} />{H("ch-consume")}{err("production.consumeQty")}</div>}
      <div className="field"><label htmlFor="ch-outqty">Wynik produkcji (MP){mode === "DIRECT" && <span className="req"> *</span>}</label>
        <input id="ch-outqty" className="ctrl r" inputMode="decimal" placeholder={mode === "FROM_PURCHASE" ? "puste = zużycie × 4" : "np. 120"} value={c.outQty} onChange={e => set({ outQty: e.target.value })} /><Hint id="ch-outqty" text={OP_HELP[mode === "DIRECT" ? "ch-outqty-DIRECT" : "ch-outqty"]} />{err("production.outQty")}</div>
      {mode === "FROM_PURCHASE" && <div className="field"><label htmlFor="ch-diff">Przyczyna niższego wyniku</label>
        <select id="ch-diff" className="ctrl" value={c.diffReason} onChange={e => set({ diffReason: e.target.value })}>
          <option value="">— brak różnicy —</option>{Object.entries(PRODUCTION_DIFF_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>{H("ch-diff")}{err("production.diffReason")}</div>}
      <div className="field"><label htmlFor="ch-chipper">Rębak</label>
        <select id="ch-chipper" className="ctrl" value={c.chipperId} onChange={e => { const ch = data.chippers.find(x => x.id === e.target.value); set({ chipperId: e.target.value, operatorId: ch?.operatorId ?? c.operatorId }); }}>
          <option value="">— bez rębaka —</option>{data.chippers.map(x => <option key={x.id} value={x.id}>{x.name}{x.company ? ` (${x.company})` : ""}</option>)}
        </select>{H("ch-chipper")}{err("production.chipperId")}</div>
      <div className="field"><label htmlFor="ch-operator">Operator</label>
        <select id="ch-operator" className="ctrl" value={c.operatorId} onChange={e => set({ operatorId: e.target.value })}>
          <option value="">— brak —</option>{data.operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>{H("ch-operator")}{err("production.operatorId")}</div>
      <div className="field"><label htmlFor="ch-rate">Cena rąbania (zł / MP)</label>
        <input id="ch-rate" className="ctrl r" inputMode="decimal" placeholder="opcjonalnie" value={c.chipRate} onChange={e => set({ chipRate: e.target.value })} />{H("ch-rate")}{err("production.chipRate")}</div>
      <div className="field"><label htmlFor="ch-source">Pochodzenie surowca</label>
        <select id="ch-source" className="ctrl" value={c.source} onChange={e => {
          const source = e.target.value as ProductionSource;
          // nadleśnictwo z kartoteki dostawcy (rodzaj „nadleśnictwo”) — bez przepisywania
          const fd = source === "FOREST" && !c.forestDistrict && supplier?.kind === "FOREST_DISTRICT" ? supplier.name.replace(/^nadle[sś]nictwo\s+/i, "") : c.forestDistrict;
          set({ source, forestDistrict: fd });
        }}>
          {(Object.keys(PRODUCTION_SOURCE_LABEL) as ProductionSource[]).map(k => <option key={k} value={k}>{PRODUCTION_SOURCE_LABEL[k]}</option>)}
        </select>{H("ch-source")}</div>
      {c.source === "FOREST" && <>
        <div className="field"><label htmlFor="ch-ndl">Nadleśnictwo <span className="req">*</span></label>
          <input id="ch-ndl" className="ctrl" maxLength={120} placeholder={supplier?.kind === "FOREST_DISTRICT" ? supplier.name : ""} value={c.forestDistrict} onChange={e => set({ forestDistrict: e.target.value })} />{H("ch-ndl")}{err("production.forestDistrict")}</div>
        <div className="field"><label htmlFor="ch-lesn">Leśnictwo <span className="req">*</span></label>
          <input id="ch-lesn" className="ctrl" maxLength={120} list="ch-lesn-list" value={c.forestry} onChange={e => set({ forestry: e.target.value })} />
          <datalist id="ch-lesn-list">{forestries.map(f => <option key={f} value={f} />)}</datalist>{H("ch-lesn")}{err("production.forestry")}</div>
        {!transportRuns && <div className="field"><label htmlFor="ch-kwit">Nr kwitu wywozowego <span className="req">*</span></label>
          <input id="ch-kwit" className="ctrl" maxLength={200} value={c.waybill} onChange={e => set({ waybill: e.target.value })} />{H("ch-kwit")}{err("production.waybill")}</div>}
        {transportRuns && <p className="muted small">Kwity wywozowe wpisz przy kursach transportu (numer i m³ z kwitu).</p>}
      </>}
      {c.source === "INVESTMENT" && <>
        <div className="field"><label htmlFor="ch-site">Miejsce wycinki / inwestycja <span className="req">*</span></label>
          <input id="ch-site" className="ctrl" maxLength={250} value={c.investSite} onChange={e => set({ investSite: e.target.value })} />{H("ch-site")}{err("production.investSite")}</div>
        <div className="field"><label htmlFor="ch-srcdoc">Dokument źródłowy</label>
          <input id="ch-srcdoc" className="ctrl" maxLength={120} placeholder="np. decyzja, umowa" value={c.sourceDoc} onChange={e => set({ sourceDoc: e.target.value })} />{H("ch-srcdoc")}</div>
      </>}
    </div>
  );
}

/** Sprzedaż wyniku produkcji: odbiorca, ilość (puste = cała produkcja), cena za MP albo za t, tonaż z wagi. */
export function OutputSaleFields({ value, onChange, data, fe }: { value: SaleState; onChange: (s: SaleState) => void; data: Lookups; fe: (f: string) => string | undefined }) {
  const s = value;
  const set = (p: Partial<SaleState>) => onChange({ ...s, ...p });
  const err = (f: string) => fe(f) && <small className="error">{fe(f)}</small>;
  const H = (id: string) => <Hint id={id} text={OP_HELP[id]} />;
  return (
    <div className="grid2" id="op-outsale">
      <div className="field"><label htmlFor="os-buyer">Odbiorca <span className="req">*</span></label>
        <select id="os-buyer" className="ctrl" value={s.buyerId} onChange={e => set({ buyerId: e.target.value })}>
          <option value="">— wybierz —</option>{data.partners.filter(p => p.role === "BUYER" || p.role === "BOTH").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>{H("os-buyer")}{err("sale.buyerId")}</div>
      <div className="field"><label htmlFor="os-qty">Ilość sprzedaży (MP)</label>
        <input id="os-qty" className="ctrl r" inputMode="decimal" placeholder="puste = cała produkcja" value={s.qty} onChange={e => set({ qty: e.target.value })} />{H("os-qty")}{err("sale.qty")}</div>
      <div className="field"><label htmlFor="os-price">Cena netto (zł) <span className="req">*</span></label>
        <div className="join"><input id="os-price" className="ctrl r" inputMode="decimal" value={s.price} onChange={e => set({ price: e.target.value })} />
          <select className="ctrl" aria-label="Jednostka ceny sprzedaży" value={s.priceUnit} onChange={e => set({ priceUnit: e.target.value as "MP" | "T" })}>
            <option value="MP">za MP</option><option value="T">za t</option></select></div>
        {H("os-price")}{err("sale.price") ?? err("sale.priceUnit")}</div>
      <div className="field"><label htmlFor="os-weight">Tonaż z wagi (t)</label>
        <input id="os-weight" className="ctrl r" inputMode="decimal" placeholder="puste = AUTO (0,33 t/MP)" value={s.weightManual} onChange={e => set({ weightManual: e.target.value })} />{H("os-weight")}{err("sale.weightManual")}</div>
    </div>
  );
}
