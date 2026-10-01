import { TRANSPORT_MODE_LABEL, type TransportInput, type TransportMode } from "@resinvest/domain";
import { UNIT_LABEL, type Unit } from "../../api/types";

export interface FleetData {
  vehicles: Array<{ id: string; name: string; registration: string; status: string; ownership: "OWN" | "EXTERNAL"; defaultDriverId: string | null; warehouseId: string | null }>;
  drivers: Array<{ id: string; name: string }>;
  companies: Array<{ id: string; name: string; kind: string }>;
  kmRateDefault: string;
}
export interface RunState { key: number; ownership: "OWN" | "EXTERNAL"; vehicleId: string; driverId: string; registration: string; driverName: string; km: string; rate: string; freight: string; qty: string; weightT: string; waybillNo: string; waybillM3: string }
export interface TransportState {
  mode: TransportMode; place: string; externalCompanyId: string; includedInPrice: boolean; runs: RunState[];
  train: { trainNo: string; carrier: string; wagonTons: string; priceUnit: Unit | ""; price: string };
}
export const EMPTY_TRANSPORT: TransportState = {
  mode: "NONE", place: "", externalCompanyId: "", includedInPrice: false, runs: [],
  train: { trainNo: "", carrier: "", wagonTons: "", priceUnit: "T", price: "" },
};
let runSeq = 0;
const newRun = (ownership: "OWN" | "EXTERNAL"): RunState => ({ key: ++runSeq, ownership, vehicleId: "", driverId: "", registration: "", driverName: "", km: "", rate: "", freight: "", qty: "", weightT: "", waybillNo: "", waybillM3: "" });

/** Stan formularza → wejście domeny (`planTransport`); puste pola zostają puste — reguły i komunikaty są w domenie. */
export function toTransportInput(t: TransportState): TransportInput {
  if (t.mode === "NONE") return { mode: "NONE" };
  if (t.mode === "SUPPLIER") return { mode: "SUPPLIER", place: t.place };
  if (t.mode === "TRAIN") return { mode: "TRAIN", place: t.place, train: { trainNo: t.train.trainNo || null, carrier: t.train.carrier || null,
    wagonTons: t.train.wagonTons.split(/[;\n]+/).map(x => x.trim()).filter(Boolean), priceUnit: t.train.priceUnit || null, price: t.train.price } };
  return { mode: t.mode, place: t.place, externalCompanyId: t.externalCompanyId || null, includedInPrice: t.includedInPrice,
    runs: t.runs.map(r => ({ ownership: r.ownership, vehicleId: r.vehicleId || null, driverId: r.driverId || null, registration: r.registration || null, driverName: r.driverName || null,
      km: r.km, rate: r.rate, freight: r.freight, qty: r.qty, weightT: r.weightT, waybillNo: r.waybillNo || null, waybillM3: r.waybillM3 })) };
}

/**
 * Sekcja „Transport” formularza operacji: tryb, miejsce, firma przewozowa, kursy (pojazd i kierowca z floty albo nr rej.
 * przewoźnika, km, stawka, fracht, ilość, waga, kwit) lub skład kolejowy. Transport nie zmienia stanu — tworzy dokument TR.
 */
export function TransportFields({ value, onChange, fleet, unit, purchase, fe }: {
  value: TransportState; onChange: (t: TransportState) => void; fleet: FleetData; unit: Unit | null; purchase: boolean; fe: (field: string) => string | undefined;
}) {
  const t = value;
  const set = (p: Partial<TransportState>) => onChange({ ...t, ...p });
  const setRun = (key: number, p: Partial<RunState>) => set({ runs: t.runs.map(r => (r.key === key ? { ...r, ...p } : r)) });
  const modes = (Object.keys(TRANSPORT_MODE_LABEL) as TransportMode[]).filter(m => purchase || m !== "SUPPLIER");
  const changeMode = (mode: TransportMode) => {
    // przy zmianie trybu kursy innego rodzaju znikają; pierwszy kurs dodaje się sam
    const keep = t.runs.filter(r => mode === "MIXED" || (mode === "OWN" ? r.ownership === "OWN" : r.ownership === "EXTERNAL"));
    const runs = ["OWN", "EXTERNAL", "MIXED"].includes(mode) && !keep.length ? [newRun(mode === "EXTERNAL" ? "EXTERNAL" : "OWN")] : keep;
    set({ mode, runs });
  };
  const ownVehicles = fleet.vehicles.filter(v => v.status === "ACTIVE" && v.ownership === "OWN");
  const hasExt = t.mode === "EXTERNAL" || t.mode === "MIXED";
  const U = unit ? UNIT_LABEL[unit] : "";
  const err = (f: string) => fe(f) && <small className="error">{fe(f)}</small>;
  return (
    <fieldset className="field" id="op-transport">
      <legend>Transport</legend>
      <div className="grid2">
        <div className="field"><label htmlFor="tr-mode">Rodzaj transportu</label>
          <select id="tr-mode" className="ctrl" value={t.mode} onChange={e => changeMode(e.target.value as TransportMode)}>
            {modes.map(m => <option key={m} value={m}>{TRANSPORT_MODE_LABEL[m]}</option>)}
          </select>{err("transport.mode")}</div>
        {t.mode !== "NONE" && <div className="field"><label htmlFor="tr-place">Miejsce załadunku / dostawy <span className="req">*</span></label>
          <input id="tr-place" className="ctrl" maxLength={250} placeholder="np. Nadl. Rudziniec, EC Zabrze" value={t.place} onChange={e => set({ place: e.target.value })} />{err("transport.place")}</div>}
      </div>
      {t.mode === "SUPPLIER" && <p className="muted small">Dostawę organizuje i opłaca dostawca (koszt w cenie zakupu) — bez kursów i bez dokumentu TR.</p>}
      {hasExt && <div className="grid2">
        <div className="field"><label htmlFor="tr-company">Firma przewozowa <span className="req">*</span></label>
          <select id="tr-company" className="ctrl" value={t.externalCompanyId} onChange={e => set({ externalCompanyId: e.target.value })}>
            <option value="">— wybierz —</option>{fleet.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>{err("transport.externalCompanyId")}</div>
        <label className="check"><input type="checkbox" id="tr-included" checked={t.includedInPrice} onChange={e => set({ includedInPrice: e.target.checked })} /> Fracht wliczony w cenę towaru (kursy zewnętrzne bez kosztu)</label>
      </div>}
      {["OWN", "EXTERNAL", "MIXED"].includes(t.mode) && <>
        {t.runs.map((r, i) => {
          const K = (f: string) => `transport.runs.${i}.${f}`;
          const v = fleet.vehicles.find(x => x.id === r.vehicleId);
          return (
            <div key={r.key} className="run-row" data-run={i}>
              <div className="run-h"><strong>Kurs {i + 1}</strong>
                {t.mode === "MIXED" ? <select className="ctrl" aria-label={`Rodzaj kursu ${i + 1}`} value={r.ownership} onChange={e => setRun(r.key, { ownership: e.target.value as "OWN" | "EXTERNAL" })}>
                  <option value="OWN">własny</option><option value="EXTERNAL">zewnętrzny</option></select> : <span className="muted small">{r.ownership === "OWN" ? "flota własna" : "przewoźnik"}</span>}
                {t.runs.length > 1 && <button type="button" className="btn sm ghost" aria-label={`Usuń kurs ${i + 1}`} onClick={() => set({ runs: t.runs.filter(x => x.key !== r.key) })}>✕</button>}
              </div>
              <div className="run-grid">
                {r.ownership === "OWN" ? <>
                  <div className="field"><label htmlFor={`tr-veh-${i}`}>Pojazd</label>
                    <select id={`tr-veh-${i}`} className="ctrl" value={r.vehicleId} onChange={e => { const nv = fleet.vehicles.find(x => x.id === e.target.value); setRun(r.key, { vehicleId: e.target.value, driverId: r.driverId || nv?.defaultDriverId || "" }); }}>
                      <option value="">— pojazd —</option>{ownVehicles.map(x => <option key={x.id} value={x.id}>{x.registration} {x.name}</option>)}
                    </select>{err(K("vehicleId"))}</div>
                  <div className="field"><label htmlFor={`tr-drv-${i}`}>Kierowca</label>
                    <select id={`tr-drv-${i}`} className="ctrl" value={r.driverId} onChange={e => setRun(r.key, { driverId: e.target.value })}>
                      <option value="">{v?.defaultDriverId ? "— domyślny pojazdu —" : "— kierowca —"}</option>{fleet.drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>{err(K("driverId"))}</div>
                </> : <>
                  <div className="field"><label htmlFor={`tr-reg-${i}`}>Nr rej. przewoźnika</label>
                    <input id={`tr-reg-${i}`} className="ctrl" maxLength={20} value={r.registration} onChange={e => setRun(r.key, { registration: e.target.value })} />{err(K("registration"))}</div>
                  <div className="field"><label htmlFor={`tr-dname-${i}`}>Kierowca (opisowo)</label>
                    <input id={`tr-dname-${i}`} className="ctrl" maxLength={120} value={r.driverName} onChange={e => setRun(r.key, { driverName: e.target.value })} /></div>
                </>}
                <div className="field"><label htmlFor={`tr-km-${i}`}>Km</label>
                  <input id={`tr-km-${i}`} className="ctrl r" inputMode="decimal" value={r.km} onChange={e => setRun(r.key, { km: e.target.value })} />{err(K("km"))}</div>
                <div className="field"><label htmlFor={`tr-rate-${i}`}>Stawka zł/km</label>
                  <input id={`tr-rate-${i}`} className="ctrl r" inputMode="decimal" placeholder={fleet.kmRateDefault} value={r.rate} onChange={e => setRun(r.key, { rate: e.target.value })} />{err(K("rate"))}</div>
                {r.ownership === "EXTERNAL" && <div className="field"><label htmlFor={`tr-fr-${i}`}>Fracht kursu (zł)</label>
                  <input id={`tr-fr-${i}`} className="ctrl r" inputMode="decimal" placeholder="z faktury" value={r.freight} onChange={e => setRun(r.key, { freight: e.target.value })} />{err(K("freight"))}</div>}
                <div className="field"><label htmlFor={`tr-qty-${i}`}>Ilość{U ? ` (${U})` : ""}</label>
                  <input id={`tr-qty-${i}`} className="ctrl r" inputMode="decimal" placeholder={t.runs.length === 1 ? "cała ilość" : ""} value={r.qty} onChange={e => setRun(r.key, { qty: e.target.value })} />{err(K("qty"))}</div>
                <div className="field"><label htmlFor={`tr-w-${i}`}>Waga z wagi (t)</label>
                  <input id={`tr-w-${i}`} className="ctrl r" inputMode="decimal" value={r.weightT} onChange={e => setRun(r.key, { weightT: e.target.value })} />{err(K("weightT"))}</div>
                <div className="field"><label htmlFor={`tr-wb-${i}`}>Nr kwitu</label>
                  <input id={`tr-wb-${i}`} className="ctrl" maxLength={60} value={r.waybillNo} onChange={e => setRun(r.key, { waybillNo: e.target.value })} />{err(K("waybillNo"))}</div>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn sm" id="tr-run-add" onClick={() => set({ runs: [...t.runs, newRun(t.mode === "EXTERNAL" ? "EXTERNAL" : "OWN")] })}>+ Dodaj kurs</button>
        {err("transport.runs")}
        <small className="hint">Koszt kursu = km × stawka (domyślnie {fleet.kmRateDefault} zł/km) albo fracht z faktury przewoźnika. Transport nie zmienia stanu magazynowego.</small>
      </>}
      {t.mode === "TRAIN" && <div className="grid2">
        <div className="field"><label htmlFor="tr-train-no">Nr składu</label><input id="tr-train-no" className="ctrl" maxLength={40} value={t.train.trainNo} onChange={e => set({ train: { ...t.train, trainNo: e.target.value } })} /></div>
        <div className="field"><label htmlFor="tr-carrier">Przewoźnik kolejowy</label><input id="tr-carrier" className="ctrl" maxLength={120} value={t.train.carrier} onChange={e => set({ train: { ...t.train, carrier: e.target.value } })} /></div>
        <div className="field"><label htmlFor="tr-wagons">Tonaż wagonów (t, rozdzielone średnikiem)</label>
          <input id="tr-wagons" className="ctrl" placeholder="np. 33; 32,8; 33,4" value={t.train.wagonTons} onChange={e => set({ train: { ...t.train, wagonTons: e.target.value } })} />
          {err("transport.train.wagonTons")}
          {t.train.wagonTons.split(/[;\n]+/).filter(x => x.trim()).map((_, i) => <span key={i}>{err(`transport.train.wagonTons.${i}`)}</span>)}</div>
        <div className="field"><label htmlFor="tr-tprice">Cena frachtu (zł)</label>
          <div className="join"><input id="tr-tprice" className="ctrl r" inputMode="decimal" value={t.train.price} onChange={e => set({ train: { ...t.train, price: e.target.value } })} />
            <select className="ctrl" aria-label="Jednostka ceny frachtu" value={t.train.priceUnit} onChange={e => set({ train: { ...t.train, priceUnit: e.target.value as Unit } })}>
              <option value="T">za t</option><option value="MP">za MP</option><option value="M3">za m³</option></select></div>
          {err("transport.train.price") ?? err("transport.train.priceUnit")}</div>
      </div>}
    </fieldset>
  );
}
