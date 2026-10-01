import { useQuery } from "@tanstack/react-query";
import { formatQty } from "@resinvest/domain";
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
}

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
          </dl>
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
          {op.extras.length > 0 && <section className="card" id="op-extras"><header className="card-h"><h2>Operacje dodatkowe</h2></header>
            <ul className="plain">{op.extras.map(x => <li key={x.id}><strong>{x.type}</strong>{x.vehicle ? ` · ${x.vehicle}` : ""}{x.quantity ? ` · ${formatQty(x.quantity)}` : ""} — {pln(x.cost)}{x.description ? <small className="muted"> — {x.description}</small> : null}</li>)}</ul></section>}
          <dl className="kv mt">
            {Number(op.totals.purchaseCost) > 0 && <><dt>Wartość zakupu</dt><dd>{pln(op.totals.purchaseCost)}</dd></>}
            {Number(op.totals.revenue) > 0 && <><dt>Przychód</dt><dd>{pln(op.totals.revenue)}</dd></>}
            {Number(op.totals.chippingCost) > 0 && <><dt>Rąbanie</dt><dd>{pln(op.totals.chippingCost)}</dd></>}
            {Number(op.totals.additionalCost) > 0 && <><dt>Operacje dodatkowe</dt><dd>{pln(op.totals.additionalCost)}</dd></>}
          </dl>
        </div>
      )}
    </Dialog>
  );
}
