import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { checkReason, formatQty, TRANSPORT_MODE_LABEL, type OperationInput, type TransportMode } from "@resinvest/domain";
import { ApiRequestError, api, errorText } from "../../api/client";
import { UNIT_LABEL, type Unit } from "../../api/types";
import { useSession } from "../../auth/session";
import { Alert, Dialog, fmtDateTime } from "../../ui/components";

export interface OperationView {
  id: string; type: "PURCHASE" | "SALE" | "PRODUCTION" | "TRANSFER" | "OPENING_BALANCE" | "INVENTORY"; status: string;
  warehouse: { id: string; code: string; name: string }; operationDate: string; notes: string | null; createdAt: string; createdBy: string | null;
  /** Wersja (ochrona przed nadpisaniem cudzej zmiany), migawka formularza, liczba korekt, usunięcie. */
  version: number; input: OperationInput | null; corrections: number; deleted: { at: string; reason: string | null } | null;
  totals: { purchaseCost: string | null; revenue: string | null; chippingCost: string | null; additionalCost: string | null; transportCost: string | null };
  documents: Array<{ id: string; type: string; number: string; documentDate: string; movementDate: string; externalNumber: string | null; partner: { id: string; name: string } | null;
    lines: Array<{ lineNo: number; material: { id: string; code: string; name: string }; qtySource: string; unitSource: Unit; qtyStock: string; unitStock: Unit; factor: string; source: string;
      weightT: string | null; weightSource: string | null; unitPrice: string | null; priceUnit: Unit | null; value: string | null }> }>;
  production: {
    mode: "FROM_STOCK" | "FROM_PURCHASE" | "DIRECT"; consumeQty: string; outQty: string; factor: string; chipRate: string | null; chippingCost: string; chipper: string | null; operator: string | null;
    diffReason: string | null; diffReasonLabel: string | null; forestDistrict: string | null; forestry: string | null; waybill: string | null; investSite: string | null; sourceDoc: string | null;
  } | null;
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
/** Dokument główny do tytułu: kolejność ważności (zakup → PZ, sprzedaż bezpośrednia → WZ, produkcja → PW), nie kolejność zapisu. */
const titleDoc = (op: OperationView) => ["PZ", "WZ", "MM", "PW", "BO"].map(t => op.documents.find(d => d.type === t)).find(Boolean);
/** Nazwa operacji z uwzględnieniem produkcji w zakupie i sprzedaży bezpośredniej. */
export const opLabel = (type: string, productionMode?: string | null) =>
  type === "PURCHASE" && productionMode === "FROM_PURCHASE" ? "Zakup z produkcją" : type === "SALE" && productionMode === "DIRECT" ? "Sprzedaż bezpośrednia" : OP_LABEL[type] ?? type;
export const pln = (v: string | number | null | undefined) => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(Number(v ?? 0));
export const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("pl-PL", { timeZone: "UTC" });
const SRC: Record<string, string> = { AUTO: "AUTO", COMPANY_RATE: "AUTO", MANUAL: "RĘCZNY" };
/** Linia jak w 3.x: „60 MP | 20,35 t | RĘCZNY”. */
export const tonLine = (l: { qtySource: string; unitSource: Unit; weightT: string | null; weightSource: string | null }) =>
  `${formatQty(l.qtySource)} ${UNIT_LABEL[l.unitSource]}${l.weightT ? ` | ${formatQty(l.weightT)} t | ${SRC[l.weightSource ?? ""] ?? ""}` : ""}`;
/** Prawo do korekty: ogólne albo właściwe dla rodzaju (jak na serwerze). */
const CORRECT_PERM: Record<string, string> = { PURCHASE: "purchases.correct", SALE: "sales.correct", DIRECT_SALE: "sales.correct", PRODUCTION: "production.correct", TRANSFER: "inventory.correct" };
export const canCorrectKind = (can: (p: string) => boolean, kind: string | undefined) => !!kind && !!CORRECT_PERM[kind] && (can("documents.correct") || can(CORRECT_PERM[kind]!));
/** Plakietka stanu dokumentu: zatwierdzony / korygowany / usunięty. */
export const StatusBadge = ({ status, corrections }: { status: string; corrections?: number }) =>
  status === "DELETED" ? <span className="badge err">usunięty</span>
    : corrections ? <span className="badge warn" title="Dokument po korekcie — historia zmian w szczegółach">korygowany{corrections > 1 ? ` ×${corrections}` : ""}</span>
      : <span className="badge ok">zatwierdzony</span>;
export const DocBadge = ({ type }: { type: string }) => <span className={`badge doc doc-${["PZ", "WZ", "MM"].includes(type) ? type : "aux"}`}>{type}</span>;

/** Szczegóły operacji: dokumenty z pozycjami (ilość źródłowa i magazynowa, przelicznik, tonaż), produkcja, operacje dodatkowe, kwoty. */
export function OperationDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useSession();
  const q = useQuery({ queryKey: ["operation", id], queryFn: async ({ signal }) => (await api.get<{ operation: OperationView }>(`/operations/${id}`, signal)).operation, staleTime: 0 });
  const op = q.data;
  const [removing, setRemoving] = useState(false);
  const live = op && op.status !== "DELETED";
  const mayCorrect = live && !op.transfer?.receipt && canCorrectKind(can, op.input?.type);
  const mayDelete = live && can("documents.delete") && ["PURCHASE", "SALE", "PRODUCTION", "TRANSFER"].includes(op.type);
  return (
    <Dialog title={op ? `${opLabel(op.type, op.production?.mode)} — ${titleDoc(op)?.number ?? ""}` : "Operacja"} onClose={onClose}
      footer={op && (mayCorrect || mayDelete) ? <>
        {mayCorrect && <Link className="btn" id="op-correct" to={`/nowa-operacja?korekta=${op.id}`} onClick={onClose}>Koryguj</Link>}
        {mayDelete && <button type="button" className="btn danger" id="op-delete" onClick={() => setRemoving(true)}>Usuń…</button>}
        {op.transfer?.receipt && <small className="muted">MM przyjęte — korekta niemożliwa; można usunąć (odwraca oba magazyny).</small>}
      </> : undefined}>
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !op ? <p className="muted">Wczytywanie…</p> : (
        <div id="op-detail">
          <dl className="kv">
            <dt>Magazyn</dt><dd>{op.warehouse.name}</dd>
            <dt>Data operacji</dt><dd>{day(op.operationDate)}</dd>
            <dt>Utworzono</dt><dd>{fmtDateTime(op.createdAt)} · {op.createdBy ?? "—"}</dd>
            <dt>Status</dt><dd id="op-status"><StatusBadge status={op.status} corrections={op.corrections} /></dd>
            {op.notes && <><dt>Uwagi</dt><dd>{op.notes}</dd></>}
            {op.transfer && <><dt>Przesunięcie</dt><dd id="op-transfer">{op.warehouse.name} → <strong>{op.transfer.target.name}</strong> <TransferState state={op.transfer.state} />
              <small className="muted"> · {op.transfer.twoStage ? "dwuetapowe" : "jednoetapowe"}</small></dd></>}
          </dl>
          {op.deleted && <Alert kind="err"><span id="op-deleted">Operacja usunięta {fmtDateTime(op.deleted.at)} — ruchy magazynowe odwrócone. Powód: {op.deleted.reason ?? "—"}</span></Alert>}
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
          {op.production && <p id="op-production">{op.production.mode === "DIRECT" ? "Produkcja w lesie (surowiec nie ze stanu): ok." : "Produkcja: zużycie"} <strong>{formatQty(op.production.consumeQty)} m³</strong> → <strong>{formatQty(op.production.outQty)} MP</strong> (1 m³ = {formatQty(op.production.factor)} MP)
            {op.production.diffReasonLabel && <> · przyczyna niższego wyniku: {op.production.diffReasonLabel}</>}
            {op.production.forestDistrict && <> · Nadl. {op.production.forestDistrict}, leśn. {op.production.forestry}</>}
            {op.production.waybill && <> · kwit {op.production.waybill}</>}
            {op.production.investSite && <> · wycinka: {op.production.investSite}{op.production.sourceDoc ? ` (${op.production.sourceDoc})` : ""}</>}
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
          {can("history.read") && (op.corrections > 0 || op.deleted) && <History id={op.id} />}
        </div>
      )}
      {removing && op && <DeleteDialog op={op} onClose={() => setRemoving(false)} />}
    </Dialog>
  );
}

interface HistoryView {
  corrections: Array<{ id: string; number: string; reason: string; createdAt: string; createdBy: string | null; changes: Array<{ field: string; before: string | null; after: string | null }> }>;
  deleted: { at: string; by: string | null; reason: string | null } | null;
}

/** Historia zmian: każda korekta (numer, kto, kiedy, powód) z polami BYŁO / JEST; usunięcie z powodem. */
function History({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["operation", id, "history"], queryFn: ({ signal }) => api.get<HistoryView>(`/operations/${id}/history`, signal), staleTime: 0 });
  if (q.isError) return <Alert kind="err">{errorText(q.error)}</Alert>;
  if (!q.data) return <p className="muted small">Wczytywanie historii…</p>;
  return (
    <section className="card" id="op-history">
      <header className="card-h"><h2>Historia zmian</h2></header>
      {q.data.corrections.map(c => (
        <div key={c.id} className="hist" data-correction={c.number}>
          <p className="small"><strong className="doc">{c.number}</strong> · {fmtDateTime(c.createdAt)} · {c.createdBy ?? "—"}<br /><span className="muted">Powód:</span> {c.reason}</p>
          <ChangesTable changes={c.changes} />
        </div>
      ))}
      {q.data.deleted && <p className="small"><span className="badge err">usunięcie</span> {fmtDateTime(q.data.deleted.at)} · {q.data.deleted.by ?? "—"} · <span className="muted">Powód:</span> {q.data.deleted.reason}</p>}
    </section>
  );
}

/** Tabela BYŁO / JEST (historia zmian, podgląd korekty, zakładka „Korekty”). */
export function ChangesTable({ changes, id }: { changes: Array<{ field: string; before: string | null; after: string | null }>; id?: string }) {
  return (
    <div className="table-wrap"><table className="table changes" id={id}>
      <thead><tr><th>Pole</th><th>Było</th><th>Jest</th></tr></thead>
      <tbody>{changes.map((c, i) => (
        <tr key={i}><td data-label="Pole">{c.field}</td><td data-label="Było" className="was">{c.before ?? "—"}</td><td data-label="Jest" className="is">{c.after ?? "—"}</td></tr>))}</tbody>
    </table></div>
  );
}

/**
 * Usunięcie (soft delete): powód wymagany; serwer odwraca ruchy magazynowe w jednej transakcji i odmawia, gdy towar
 * z dokumentu został już wydany. Dokument zostaje w zakładce „Usunięte”, w historii i w dzienniku audytu.
 */
function DeleteDialog({ op, onClose }: { op: OperationView; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const local = checkReason(reason);
  const del = useMutation({
    mutationFn: () => api.post<{ operation: OperationView }>(`/operations/${op.id}/delete`, { version: op.version, reason }),
    onSuccess: () => {
      for (const k of ["documents", "stock", "operations", "operation"]) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
  });
  const fieldErr = (tried ? local : null) ?? (del.error instanceof ApiRequestError ? del.error.field("reason") : undefined);
  return (
    <Dialog title={`Usunięcie — ${op.documents.map(d => d.number).join(", ")}`} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn danger" id="del-confirm" disabled={del.isPending} onClick={() => { setTried(true); if (!local) del.mutate(); }}>{del.isPending ? "Usuwanie…" : "Usuń i odwróć ruchy"}</button>
      </>}>
      <div className="form" id="op-delete-form">
        <Alert kind="warn">Usunięcie odwraca ruchy magazynowe tej operacji (stan wraca do wartości sprzed dokumentu). Numery dokumentów zostają zajęte,
          a dokument trafia do zakładki „Usunięte”, historii zmian i dziennika audytu. Nie da się usunąć, jeśli towar z dokumentu został już wydany.</Alert>
        {del.isError && !(del.error instanceof ApiRequestError && del.error.field("reason")) && <Alert kind="err">{errorText(del.error)}</Alert>}
        <div className="field"><label htmlFor="del-reason">Powód usunięcia <span className="req">*</span></label>
          <textarea id="del-reason" className="ctrl" rows={3} maxLength={500} value={reason} onChange={e => { if (del.isError) del.reset(); setReason(e.target.value); }} />
          {fieldErr && <small className="error">{fieldErr}</small>}</div>
      </div>
    </Dialog>
  );
}
