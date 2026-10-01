import { useQuery } from "@tanstack/react-query";
import { formatQty, TRANSPORT_MODE_LABEL, type TransportMode } from "@resinvest/domain";
import { api, errorText } from "../../api/client";
import { UNIT_LABEL, type Unit } from "../../api/types";
import { Alert, Dialog, fmtDateTime } from "../../ui/components";

export interface OperationView {
  id: string; type: "PURCHASE" | "SALE" | "PRODUCTION" | "TRANSFER" | "OPENING_BALANCE" | "INVENTORY"; status: string;
  warehouse: { id: string; code: string; name: string }; operationDate: string; notes: string | null; createdAt: string; createdBy: string | null;
  totals: { purchaseCost: string | null; revenue: string | null; chippingCost: string | null; additionalCost: string | null; transportCost: string | null };
  documents: Array<{ id: string; type: string; number: string; documentDate: string; movementDate: string; externalNumber: string | null; partner: { id: string; name: string } | null;
    lines: Array<{ lineNo: number; material: { id: string; code: string; name: string }; qtySource: string; unitSource: Unit; qtyStock: string; unitStock: Unit; factor: string; source: string;
      weightT: string | null; weightSource: string | null; unitPrice: string | null; priceUnit: Unit | null; value: string | null }> }>;
  production: { consumeQty: string; outQty: string; factor: string; chipRate: string | null; chippingCost: string; chipper: string | null; operator: string | null } | null;
  extras: Array<{ id: string; type: string; vehicle: string | null; quantity: string | null; cost: string; description: string | null }>;
  transport: {
    mode: TransportMode; place: string | null; cost: string;
    runs: Array<{ runNo: number; ownership: "OWN" | "EXTERNAL"; vehicle: string | null; registration: string | null; driver: string | null; company: string | null;
      km: string; ratePerKm: string | null; freight: string | null; cost: string; qty: string | null; unit: Unit | null; weightT: string | null;
      waybillNo: string | null; waybillM3: string | null; train: { trainNo: string | null; carrier: string | null; wagonTons: string[]; totalT: string; priceUnit: Unit; price: string } | null }>;
  } | null;
  transfer: {
    target: { id: string; code: string; name: string }; state: "IN_TRANSIT" | "RECEIVED" | null; twoStage: boolean;
    receipt: { date: string; qty: string; unit: Unit; qtyStock: string; diffStock: string; reason: string | null; reasonLabel: string | null; note: string | null;
      weightT: string | null; weightSource: string | null; createdAt: string; createdBy: string | null } | null;
  } | null;
}
/** Stan MM: plakietka „w drodze” / „przyjęte”. */
export const TransferState = ({ state }: { state: string | null | undefined }) =>
  state === "IN_TRANSIT" ? <span className="badge warn">w drodze</span> : state === "RECEIVED" ? <span className="badge ok">przyjęte</span> : null;

export const OP_LABEL: Record<string, string> = { PURCHASE: "Zakup", SALE: "Sprzedaż z magazynu", PRODUCTION: "Produkcja na magazynie", TRANSFER: "Przesunięcie MM", OPENING_BALANCE: "Bilans otwarcia", INVENTORY: "Inwentaryzacja" };
export const pln = (v: string | number | null | undefined) => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(Number(v ?? 0));
export const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("pl-PL", { timeZone: "UTC" });
const SRC: Record<string, string> = { AUTO: "AUTO", COMPANY_RATE: "AUTO", MANUAL: "RĘCZNY" };
/** Linia jak w 3.x: „60 MP | 20,35 t | RĘCZNY”. */
export const tonLine = (l: { qtySource: string; unitSource: Unit; weightT: string | null; weightSource: string | null }) =>
  `${formatQty(l.qtySource)} ${UNIT_LABEL[l.unitSource]}${l.weightT ? ` | ${formatQty(l.weightT)} t | ${SRC[l.weightSource ?? ""] ?? ""}` : ""}`;
export const DocBadge = ({ type }: { type: string }) => <span className={`badge doc doc-${["PZ", "WZ", "MM"].includes(type) ? type : "aux"}`}>{type}</span>;

/** Szczegóły operacji: dokumenty z pozycjami (ilość źródłowa i magazynowa, przelicznik, tonaż), produkcja, operacje dodatkowe, kwoty. */
export function OperationDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["operation", id], queryFn: async ({ signal }) => (await api.get<{ operation: OperationView }>(`/operations/${id}`, signal)).operation, staleTime: 0 });
  const op = q.data;
  return (
    <Dialog title={op ? `${OP_LABEL[op.type] ?? op.type} — ${op.documents.find(d => ["PZ", "WZ", "PW", "MM", "BO"].includes(d.type))?.number ?? ""}` : "Operacja"} onClose={onClose}>
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !op ? <p className="muted">Wczytywanie…</p> : (
        <div id="op-detail">
          <dl className="kv">
            <dt>Magazyn</dt><dd>{op.warehouse.name}</dd>
            <dt>Data operacji</dt><dd>{day(op.operationDate)}</dd>
            <dt>Utworzono</dt><dd>{fmtDateTime(op.createdAt)} · {op.createdBy ?? "—"}</dd>
            <dt>Status</dt><dd><span className="badge ok">{op.status === "POSTED" ? "zatwierdzony" : op.status}</span></dd>
            {op.notes && <><dt>Uwagi</dt><dd>{op.notes}</dd></>}
            {op.transfer && <><dt>Przesunięcie</dt><dd id="op-transfer">{op.warehouse.name} → <strong>{op.transfer.target.name}</strong> <TransferState state={op.transfer.state} />
              <small className="muted"> · {op.transfer.twoStage ? "dwuetapowe" : "jednoetapowe"}</small></dd></>}
          </dl>
          {op.transfer?.receipt && (() => { const r = op.transfer.receipt, diff = Number(r.diffStock); return (
            <Alert kind={diff === 0 ? "ok" : "warn"}>
              <span id="op-receipt">Przyjęto {day(r.date)}: <strong className="num">{formatQty(r.qty)} {UNIT_LABEL[r.unit]}</strong>
                {diff !== 0 && <> · {diff > 0 ? "ubytek" : "nadwyżka"} <strong className="num">{formatQty(Math.abs(diff).toString())}</strong> ({r.reasonLabel}{r.note ? ` — ${r.note}` : ""})</>}
                {r.weightT && <> · {formatQty(r.weightT)} t {r.weightSource === "MANUAL" ? "RĘCZNY" : "AUTO"}</>}
                {r.createdBy && <> · {r.createdBy}</>}</span>
            </Alert>); })()}
          {op.documents.map(d => (
            <section key={d.id} className="card">
              <header className="card-h"><h2><DocBadge type={d.type} /> <span className="doc">{d.number}</span></h2>
                <small className="muted">dokument {day(d.documentDate)} · ruch {day(d.movementDate)}{d.partner ? ` · ${d.partner.name}` : ""}{d.externalNumber ? ` · nr zewn. ${d.externalNumber}` : ""}</small></header>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Materiał</th><th>Ilość | tonaż | źródło</th><th className="r">Stan (jedn. magazynowa)</th><th className="r">Cena</th><th className="r">Wartość</th></tr></thead>
                <tbody>{d.lines.map(l => (
                  <tr key={l.lineNo}>
                    <td data-label="Materiał">{l.material.name}</td>
                    <td data-label="Ilość | tonaż | źródło" className="num">{tonLine(l)}</td>
                    <td data-label="Stan" className="r num">{formatQty(l.qtyStock)} {UNIT_LABEL[l.unitStock]}{l.unitSource !== l.unitStock && <small className="muted"> (× {formatQty(l.factor, 6)})</small>}</td>
                    <td data-label="Cena" className="r num">{l.unitPrice ? `${pln(l.unitPrice)}/${UNIT_LABEL[l.priceUnit ?? l.unitSource]}` : "—"}</td>
                    <td data-label="Wartość" className="r num">{l.value ? pln(l.value) : "—"}</td>
                  </tr>))}</tbody>
              </table></div>
            </section>
          ))}
          {op.production && <p>Produkcja: zużycie <strong>{formatQty(op.production.consumeQty)} m³</strong> → <strong>{formatQty(op.production.outQty)} MP</strong> (1 m³ = {formatQty(op.production.factor)} MP)
            {op.production.chipper && <> · rębak: {op.production.chipper}{op.production.operator ? ` (${op.production.operator})` : ""}</>}
            {Number(op.production.chippingCost) > 0 && <> · rąbanie: {pln(op.production.chippingCost)}</>}</p>}
          {op.transport && <section className="card" id="op-transport-detail"><header className="card-h"><h2>Transport — {TRANSPORT_MODE_LABEL[op.transport.mode]}</h2>
            <small className="muted">{op.transport.place ?? ""}{Number(op.transport.cost) > 0 ? ` · ${pln(op.transport.cost)}` : ""}</small></header>
            {op.transport.runs.some(r => r.train) ? op.transport.runs.map(r => r.train && <p key={r.runNo} className="summary">Skład {r.train.trainNo ?? ""} {r.train.carrier ? `(${r.train.carrier})` : ""}: {r.train.wagonTons.length} wagonów,
              {" "}{formatQty(r.train.totalT)} t · {pln(r.train.price)}/{UNIT_LABEL[r.train.priceUnit]} = {pln(r.cost)}</p>)
            : op.transport.runs.length > 0 && <div className="table-wrap"><table className="table">
              <thead><tr><th>Kurs</th><th>Pojazd / przewoźnik</th><th>Kierowca</th><th className="r">Km</th><th className="r">Ilość</th><th className="r">Waga</th><th>Kwit</th><th className="r">Koszt</th></tr></thead>
              <tbody>{op.transport.runs.map(r => (
                <tr key={r.runNo}>
                  <td data-label="Kurs">{r.runNo} <small className="muted">{r.ownership === "OWN" ? "własny" : "zewn."}</small></td>
                  <td data-label="Pojazd">{r.vehicle ?? r.registration ?? "—"}{r.company && <><br /><small className="muted">{r.company}</small></>}</td>
                  <td data-label="Kierowca">{r.driver ?? "—"}</td>
                  <td data-label="Km" className="r num">{formatQty(r.km)}</td>
                  <td data-label="Ilość" className="r num">{r.qty ? `${formatQty(r.qty)} ${r.unit ? UNIT_LABEL[r.unit] : ""}` : "—"}</td>
                  <td data-label="Waga" className="r num">{r.weightT ? `${formatQty(r.weightT)} t` : "—"}</td>
                  <td data-label="Kwit">{r.waybillNo ?? "—"}{r.waybillM3 ? ` · ${formatQty(r.waybillM3)} m³` : ""}</td>
                  <td data-label="Koszt" className="r num">{r.freight ? `${pln(r.cost)} (fracht)` : r.ratePerKm ? `${pln(r.cost)} (${pln(r.ratePerKm)}/km)` : pln(r.cost)}</td>
                </tr>))}</tbody></table></div>}
          </section>}
          {op.extras.length > 0 && <section className="card" id="op-extras"><header className="card-h"><h2>Operacje dodatkowe</h2></header>
            <ul className="plain">{op.extras.map(x => <li key={x.id}><strong>{x.type}</strong>{x.vehicle ? ` · ${x.vehicle}` : ""}{x.quantity ? ` · ${formatQty(x.quantity)}` : ""} — {pln(x.cost)}{x.description ? <small className="muted"> — {x.description}</small> : null}</li>)}</ul></section>}
          <dl className="kv mt">
            {Number(op.totals.purchaseCost) > 0 && <><dt>Wartość zakupu</dt><dd>{pln(op.totals.purchaseCost)}</dd></>}
            {Number(op.totals.revenue) > 0 && <><dt>Przychód</dt><dd>{pln(op.totals.revenue)}</dd></>}
            {Number(op.totals.chippingCost) > 0 && <><dt>Rąbanie</dt><dd>{pln(op.totals.chippingCost)}</dd></>}
            {Number(op.totals.additionalCost) > 0 && <><dt>Operacje dodatkowe</dt><dd>{pln(op.totals.additionalCost)}</dd></>}
            {Number(op.totals.transportCost) > 0 && <><dt>Transport</dt><dd>{pln(op.totals.transportCost)}</dd></>}
          </dl>
        </div>
      )}
    </Dialog>
  );
}
