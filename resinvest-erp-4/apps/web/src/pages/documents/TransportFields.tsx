import { t, tm } from "../../i18n";
import { TRANSPORT_MODE_LABEL, type TransportInput, type TransportMode } from "@resinvest/domain";
import { UNIT_LABEL, type Unit } from "../../api/types";
import { Hint } from "../../ui/tutorial";
import { OP_HELP } from "./help";

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
export function toTransportInput(tr: TransportState): TransportInput {
  if (tr.mode === "NONE") return { mode: "NONE" };
  if (tr.mode === "SUPPLIER") return { mode: "SUPPLIER", place: tr.place };
  if (tr.mode === "TRAIN") return { mode: "TRAIN", place: tr.place, train: { trainNo: tr.train.trainNo || null, carrier: tr.train.carrier || null,
    wagonTons: tr.train.wagonTons.split(/[;\n]+/).map(x => x.trim()).filter(Boolean), priceUnit: tr.train.priceUnit || null, price: tr.train.price } };
  return { mode: tr.mode, place: tr.place, externalCompanyId: tr.externalCompanyId || null, includedInPrice: tr.includedInPrice,
    runs: tr.runs.map(r => ({ ownership: r.ownership, vehicleId: r.vehicleId || null, driverId: r.driverId || null, registration: r.registration || null, driverName: r.driverName || null,
      km: r.km, rate: r.rate, freight: r.freight, qty: r.qty, weightT: r.weightT, waybillNo: r.waybillNo || null, waybillM3: r.waybillM3 })) };
}

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
/** Migawka zapisanej operacji → stan formularza (korekta otwiera formularz z danymi dokumentu). */
export function fromTransportInput(tr: TransportInput | null | undefined): TransportState {
  if (!tr || tr.mode === "NONE") return EMPTY_TRANSPORT;
  const train = tr.train ?? null;
  return {
    mode: tr.mode, place: txt(tr.place), externalCompanyId: txt(tr.externalCompanyId), includedInPrice: !!tr.includedInPrice,
    runs: (tr.runs ?? []).map(r => ({ key: ++runSeq, ownership: r.ownership, vehicleId: txt(r.vehicleId), driverId: txt(r.driverId), registration: txt(r.registration),
      driverName: txt(r.driverName), km: txt(r.km), rate: txt(r.rate), freight: txt(r.freight), qty: txt(r.qty), weightT: txt(r.weightT), waybillNo: txt(r.waybillNo), waybillM3: txt(r.waybillM3) })),
    train: train ? { trainNo: txt(train.trainNo), carrier: txt(train.carrier), wagonTons: (train.wagonTons ?? []).map(txt).join("; "), priceUnit: train.priceUnit ?? "T", price: txt(train.price) } : EMPTY_TRANSPORT.train,
  };
}

/**
 * Sekcja „Transport” formularza operacji: tryb, miejsce, firma przewozowa, kursy (pojazd i kierowca z floty albo nr rej.
 * przewoźnika, km, stawka, fracht, ilość, waga, kwit) lub skład kolejowy. Transport nie zmienia stanu — tworzy dokument TR.
 */
export function TransportFields({ value, onChange, fleet, unit, purchase, fe }: {
  value: TransportState; onChange: (tr: TransportState) => void; fleet: FleetData; unit: Unit | null; purchase: boolean; fe: (field: string) => string | undefined;
}) {
  const tr = value;
  const set = (p: Partial<TransportState>) => onChange({ ...tr, ...p });
  const setRun = (key: number, p: Partial<RunState>) => set({ runs: tr.runs.map(r => (r.key === key ? { ...r, ...p } : r)) });
  const modes = (Object.keys(TRANSPORT_MODE_LABEL) as TransportMode[]).filter(x => purchase || x !== "SUPPLIER");
  const changeMode = (mode: TransportMode) => {
    // przy zmianie trybu kursy innego rodzaju znikają; pierwszy kurs dodaje się sam
    const keep = tr.runs.filter(r => mode === "MIXED" || (mode === "OWN" ? r.ownership === "OWN" : r.ownership === "EXTERNAL"));
    const runs = ["OWN", "EXTERNAL", "MIXED"].includes(mode) && !keep.length ? [newRun(mode === "EXTERNAL" ? "EXTERNAL" : "OWN")] : keep;
    set({ mode, runs });
  };
  const ownVehicles = fleet.vehicles.filter(v => v.status === "ACTIVE" && v.ownership === "OWN");
  const hasExt = tr.mode === "EXTERNAL" || tr.mode === "MIXED";
  const U = unit ? UNIT_LABEL[unit] : "";
  const err = (f: string) => fe(f) && <small className="error">{fe(f)}</small>;
  const H = (id: string) => <Hint id={id} text={OP_HELP[id]} />;
  return (
    <fieldset className="field" id="op-transport">
      <legend>{t("Transport")}</legend>
      <div className="grid2">
        <div className="field"><label htmlFor="tr-mode">{t("Rodzaj transportu")}</label>
          <select id="tr-mode" className="ctrl" value={tr.mode} onChange={e => changeMode(e.target.value as TransportMode)}>
            {modes.map(x => <option key={x} value={x}>{tm(TRANSPORT_MODE_LABEL[x])}</option>)}
          </select>{H("tr-mode")}{err("transport.mode")}</div>
        {tr.mode !== "NONE" && <div className="field"><label htmlFor="tr-place">{t("Miejsce załadunku / dostawy")} <span className="req">*</span></label>
          <input id="tr-place" className="ctrl" maxLength={250} placeholder={t("np. Nadl. Rudziniec, EC Zabrze")} value={tr.place} onChange={e => set({ place: e.target.value })} />{H("tr-place")}{err("transport.place")}</div>}
      </div>
      {tr.mode === "SUPPLIER" && <p className="muted small">{t("Dostawę organizuje i opłaca dostawca (koszt w cenie zakupu) — bez kursów i bez dokumentu TR.")}</p>}
      {hasExt && <div className="grid2">
        <div className="field"><label htmlFor="tr-company">{t("Firma przewozowa")} <span className="req">*</span></label>
          <select id="tr-company" className="ctrl" value={tr.externalCompanyId} onChange={e => set({ externalCompanyId: e.target.value })}>
            <option value="">{t("— wybierz —")}</option>{fleet.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>{H("tr-company")}{err("transport.externalCompanyId")}</div>
        <label className="check"><input type="checkbox" id="tr-included" checked={tr.includedInPrice} onChange={e => set({ includedInPrice: e.target.checked })} /> {t("Fracht wliczony w cenę towaru (kursy zewnętrzne bez kosztu)")}{H("tr-included")}</label>
      </div>}
      {["OWN", "EXTERNAL", "MIXED"].includes(tr.mode) && <>
        {tr.runs.map((r, i) => {
          const K = (f: string) => `transport.runs.${i}.${f}`;
          const v = fleet.vehicles.find(x => x.id === r.vehicleId);
          const RH = (id: string) => (i === 0 ? H(id) : null); // opisy tylko przy pierwszym kursie — kolejne mają te same pola
          return (
            <div key={r.key} className="run-row" data-run={i}>
              <div className="run-h"><strong>{t("Kurs {n}", { n: i + 1 })}</strong>
                {tr.mode === "MIXED" ? <select className="ctrl" aria-label={t("Rodzaj kursu {n}", { n: i + 1 })} value={r.ownership} onChange={e => setRun(r.key, { ownership: e.target.value as "OWN" | "EXTERNAL" })}>
                  <option value="OWN">{t("własny")}</option><option value="EXTERNAL">{t("zewnętrzny")}</option></select> : <span className="muted small">{r.ownership === "OWN" ? t("flota własna") : t("przewoźnik")}</span>}
                {tr.runs.length > 1 && <button type="button" className="btn sm ghost" aria-label={t("Usuń kurs {n}", { n: i + 1 })} onClick={() => set({ runs: tr.runs.filter(x => x.key !== r.key) })}>✕</button>}
              </div>
              <div className="run-grid">
                {r.ownership === "OWN" ? <>
                  <div className="field"><label htmlFor={`tr-veh-${i}`}>{t("Pojazd")}</label>
                    <select id={`tr-veh-${i}`} className="ctrl" value={r.vehicleId} onChange={e => { const nv = fleet.vehicles.find(x => x.id === e.target.value); setRun(r.key, { vehicleId: e.target.value, driverId: r.driverId || nv?.defaultDriverId || "" }); }}>
                      <option value="">{t("— pojazd —")}</option>{ownVehicles.map(x => <option key={x.id} value={x.id}>{x.registration} {x.name}</option>)}
                    </select>{RH("tr-veh")}{err(K("vehicleId"))}</div>
                  <div className="field"><label htmlFor={`tr-drv-${i}`}>{t("Kierowca")}</label>
                    <select id={`tr-drv-${i}`} className="ctrl" value={r.driverId} onChange={e => setRun(r.key, { driverId: e.target.value })}>
                      <option value="">{v?.defaultDriverId ? t("— domyślny pojazdu —") : t("— kierowca —")}</option>{fleet.drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>{RH("tr-drv")}{err(K("driverId"))}</div>
                </> : <>
                  <div className="field"><label htmlFor={`tr-reg-${i}`}>{t("Nr rej. przewoźnika")}</label>
                    <input id={`tr-reg-${i}`} className="ctrl" maxLength={20} value={r.registration} onChange={e => setRun(r.key, { registration: e.target.value })} />{RH("tr-reg")}{err(K("registration"))}</div>
                  <div className="field"><label htmlFor={`tr-dname-${i}`}>{t("Kierowca (opisowo)")}</label>
                    <input id={`tr-dname-${i}`} className="ctrl" maxLength={120} value={r.driverName} onChange={e => setRun(r.key, { driverName: e.target.value })} />{RH("tr-dname")}</div>
                </>}
                <div className="field"><label htmlFor={`tr-km-${i}`}>{t("Km")}</label>
                  <input id={`tr-km-${i}`} className="ctrl r" inputMode="decimal" value={r.km} onChange={e => setRun(r.key, { km: e.target.value })} />{RH("tr-km")}{err(K("km"))}</div>
                <div className="field"><label htmlFor={`tr-rate-${i}`}>{t("Stawka zł/km")}</label>
                  <input id={`tr-rate-${i}`} className="ctrl r" inputMode="decimal" placeholder={fleet.kmRateDefault} value={r.rate} onChange={e => setRun(r.key, { rate: e.target.value })} />{RH("tr-rate")}{err(K("rate"))}</div>
                {r.ownership === "EXTERNAL" && <div className="field"><label htmlFor={`tr-fr-${i}`}>{t("Fracht kursu (zł)")}</label>
                  <input id={`tr-fr-${i}`} className="ctrl r" inputMode="decimal" placeholder={t("z faktury")} value={r.freight} onChange={e => setRun(r.key, { freight: e.target.value })} />{RH("tr-fr")}{err(K("freight"))}</div>}
                <div className="field"><label htmlFor={`tr-qty-${i}`}>{t("Ilość")}{U ? ` (${U})` : ""}</label>
                  <input id={`tr-qty-${i}`} className="ctrl r" inputMode="decimal" placeholder={tr.runs.length === 1 ? t("cała ilość") : ""} value={r.qty} onChange={e => setRun(r.key, { qty: e.target.value })} />{RH("tr-qty")}{err(K("qty"))}</div>
                <div className="field"><label htmlFor={`tr-w-${i}`}>{t("Waga z wagi (t)")}</label>
                  <input id={`tr-w-${i}`} className="ctrl r" inputMode="decimal" value={r.weightT} onChange={e => setRun(r.key, { weightT: e.target.value })} />{RH("tr-w")}{err(K("weightT"))}</div>
                <div className="field"><label htmlFor={`tr-wb-${i}`}>{t("Nr kwitu")}</label>
                  <input id={`tr-wb-${i}`} className="ctrl" maxLength={60} value={r.waybillNo} onChange={e => setRun(r.key, { waybillNo: e.target.value })} />{RH("tr-wb")}{err(K("waybillNo"))}</div>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn sm" id="tr-run-add" onClick={() => set({ runs: [...tr.runs, newRun(tr.mode === "EXTERNAL" ? "EXTERNAL" : "OWN")] })}>{t("+ Dodaj kurs")}</button>
        {err("transport.runs")}
        <small className="hint">{t("Koszt kursu = km × stawka (domyślnie {rate} zł/km) albo fracht z faktury przewoźnika. Transport nie zmienia stanu magazynowego.", { rate: fleet.kmRateDefault })}</small>
      </>}
      {tr.mode === "TRAIN" && <div className="grid2">
        <div className="field"><label htmlFor="tr-train-no">{t("Nr składu")}</label><input id="tr-train-no" className="ctrl" maxLength={40} value={tr.train.trainNo} onChange={e => set({ train: { ...tr.train, trainNo: e.target.value } })} />{H("tr-train-no")}</div>
        <div className="field"><label htmlFor="tr-carrier">{t("Przewoźnik kolejowy")}</label><input id="tr-carrier" className="ctrl" maxLength={120} value={tr.train.carrier} onChange={e => set({ train: { ...tr.train, carrier: e.target.value } })} />{H("tr-carrier")}</div>
        <div className="field"><label htmlFor="tr-wagons">{t("Tonaż wagonów (t, rozdzielone średnikiem)")}</label>
          <input id="tr-wagons" className="ctrl" placeholder={t("np. 33; 32,8; 33,4")} value={tr.train.wagonTons} onChange={e => set({ train: { ...tr.train, wagonTons: e.target.value } })} />
          {H("tr-wagons")}{err("transport.train.wagonTons")}
          {tr.train.wagonTons.split(/[;\n]+/).filter(x => x.trim()).map((_, i) => <span key={i}>{err(`transport.train.wagonTons.${i}`)}</span>)}</div>
        <div className="field"><label htmlFor="tr-tprice">{t("Cena frachtu (zł)")}</label>
          <div className="join"><input id="tr-tprice" className="ctrl r" inputMode="decimal" value={tr.train.price} onChange={e => set({ train: { ...tr.train, price: e.target.value } })} />
            <select className="ctrl" aria-label={t("Jednostka ceny frachtu")} value={tr.train.priceUnit} onChange={e => set({ train: { ...tr.train, priceUnit: e.target.value as Unit } })}>
              <option value="T">{t("za t")}</option><option value="MP">{t("za MP")}</option><option value="M3">{t("za m³")}</option></select></div>
          {H("tr-tprice")}{err("transport.train.price") ?? err("transport.train.priceUnit")}</div>
      </div>}
    </fieldset>
  );
}
