import { useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatQty, MM_DIFF_REASONS, planReceipt } from "@resinvest/domain";
import { ApiRequestError, api, errorText } from "../../api/client";
import { UNIT_LABEL, type Unit } from "../../api/types";
import { useSession } from "../../auth/session";
import { Alert, Dialog } from "../../ui/components";
import { ColumnHelp, Hint, TutorialToggle } from "../../ui/tutorial";
import { OP_HELP } from "./help";
import { useWorkWarehouse } from "../stock/StockPage";
import { newKey } from "./idempotency";
import { DocBadge, OP_LABEL, OperationDetail, TransferState, day, pln, tonLine } from "./OperationDetail";

interface DocRow {
  id: string; type: string; number: string; documentDate: string; movementDate: string; partner: string | null; operationId: string; operationType: string; status: string;
  externalNumber: string | null; value: string;
  transfer: { from: string; to: string; state: "IN_TRANSIT" | "RECEIVED" | null; direction: "IN" | "OUT" } | null;
  lines: Array<{ material: string; qtySource: string; unitSource: Unit; qtyStock: string; unitStock: Unit; weightT: string | null; weightSource: string | null; value: string | null }>;
}
const PAGE = 50;
interface InTransit {
  operationId: string; number: string; date: string; direction: "IN" | "OUT"; from: { id: string; name: string }; to: { id: string; name: string };
  material: { id: string; name: string; active: boolean; stockUnit: Unit; allowedUnits: Unit[]; tonPerUnit: string | null; mpPerM3: string | null; tonPerM3: string | null } | null; qtySource: string; unitSource: Unit; qtyStock: string; weightT: string | null;
}

/** Rejestr dokumentów: domyślnie PZ / WZ / MM w mocnych kolorach; dokumenty pomocnicze (RW, PW, BO) po zaznaczeniu. */
export function DocumentsPage() {
  const W = useWorkWarehouse();
  const { can } = useSession();
  const [f, setF] = useState({ type: "", from: "", to: "", q: "", aux: false });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const qs = new URLSearchParams({ warehouseId: W.id, page: String(page), pageSize: String(PAGE), aux: f.aux ? "1" : "0", ...(f.type ? { type: f.type } : {}), ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}), ...(f.q ? { q: f.q } : {}) });
  const q = useQuery({ queryKey: ["documents", qs.toString()], enabled: !!W.id, staleTime: 0, refetchOnMount: "always", placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<{ total: number; rows: DocRow[] }>(`/documents?${qs.toString()}`, signal) });
  const set = (k: keyof typeof f, v: string | boolean) => { setPage(1); setF(s => ({ ...s, [k]: v })); };
  const types = f.aux ? ["PZ", "WZ", "MM", "RW", "PW", "BO"] : ["PZ", "WZ", "MM"];
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / PAGE));
  const transit = useQuery({ queryKey: ["documents", "in-transit", W.id], enabled: !!W.id, staleTime: 0, refetchOnMount: "always",
    queryFn: async ({ signal }) => (await api.get<{ transfers: InTransit[] }>(`/transfers/in-transit?warehouseId=${W.id}`, signal)).transfers });
  const [receiving, setReceiving] = useState<InTransit | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inbound = (transit.data ?? []).filter(t => t.direction === "IN"), outbound = (transit.data ?? []).filter(t => t.direction === "OUT");
  return (
    <>
      <div className="page-h">
        <div><h1>Dokumenty</h1><p className="muted small">PZ — przyjęcia, WZ — wydania, MM — przesunięcia. Kliknij numer, aby zobaczyć operację z pozycjami.</p></div>
        <div className="actions"><TutorialToggle />
          {(can("receipts.create") || can("issues.create") || can("production.create")) && <Link className="btn primary" to="/nowa-operacja">+ Nowa operacja</Link>}</div>
      </div>
      {done && <Alert kind="ok">{done}</Alert>}
      {inbound.length > 0 && (
        <section className="card" id="mm-inbound" aria-labelledby="mm-in-h">
          <header className="card-h"><h2 id="mm-in-h">Do przyjęcia — MM w drodze do tego magazynu</h2><span className="badge warn">{inbound.length}</span></header>
          <ul className="plain">{inbound.map(t => (
            <li key={t.operationId} className="transit-row">
              <span><DocBadge type="MM" /> <span className="doc">{t.number}</span> · {day(t.date)} · z: <strong>{t.from.name}</strong></span>
              <span className="num">{t.material?.name}: {formatQty(t.qtySource)} {UNIT_LABEL[t.unitSource]}{t.weightT ? ` · ${formatQty(t.weightT)} t` : ""}</span>
              {can("mm.receive") ? <button type="button" className="btn sm primary" data-receive={t.number} onClick={() => { setDone(null); setReceiving(t); }}>Przyjmij</button>
                : <small className="muted">przyjmuje osoba z uprawnieniem „Przyjęcie MM”</small>}
            </li>))}</ul>
        </section>)}
      {outbound.length > 0 && <p className="muted small" id="mm-outbound">Wysłane, czekają na przyjęcie: {outbound.map(t => `${t.number} → ${t.to.name}`).join(" · ")}</p>}
      <div className="filters" role="search">
        <select className="ctrl" aria-label="Magazyn" value={W.id} onChange={e => { setPage(1); W.setId(e.target.value); }}>{W.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select className="ctrl" aria-label="Typ dokumentu" value={f.type} onChange={e => set("type", e.target.value)}><option value="">Wszystkie typy</option>{types.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <label className="inline">Od <input className="ctrl" type="date" value={f.from} onChange={e => set("from", e.target.value)} /></label>
        <label className="inline">Do <input className="ctrl" type="date" value={f.to} onChange={e => set("to", e.target.value)} /></label>
        <input className="ctrl" type="search" placeholder="Numer, kontrahent, nr zewnętrzny" aria-label="Szukaj" value={f.q} onChange={e => set("q", e.target.value)} />
        <label className="inline check"><input type="checkbox" id="doc-aux" checked={f.aux} onChange={e => set("aux", e.target.checked)} /> Pokaż dokumenty pomocnicze (RW, PW, BO)</label>
      </div>
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">Wczytywanie…</p> : (
        <>
          <div className="table-wrap">
            <table className="table" id="docs-table">
              <thead><tr><th>Nr dokumentu</th><th>Typ</th><th>Data</th><th>Treść</th><th>Kontrahent</th><th className="r">Wartość</th></tr></thead>
              <tbody>{q.data.rows.map(d => (
                <tr key={d.id} className={`doc-row doc-row-${["PZ", "WZ", "MM"].includes(d.type) ? d.type : "aux"}`}>
                  <td data-label="Nr dokumentu"><button type="button" className="linkish doc" onClick={() => setOpen(d.operationId)}>{d.number}</button></td>
                  <td data-label="Typ"><DocBadge type={d.type} /></td>
                  <td data-label="Data">{day(d.movementDate)}{d.documentDate !== d.movementDate && <><br /><small className="muted">dok. {day(d.documentDate)}</small></>}</td>
                  <td data-label="Treść">{d.lines.map((l, i) => <div key={i}>{l.material}: <span className="num">{tonLine(l)}</span></div>)}<small className="muted">{OP_LABEL[d.operationType] ?? d.operationType}</small></td>
                  <td data-label="Kontrahent">{d.transfer ? <span className="mm-route">{d.transfer.from} → {d.transfer.to} <TransferState state={d.transfer.state} /></span> : d.partner ?? "—"}</td>
                  <td data-label="Wartość" className="r num">{Number(d.value) ? pln(d.value) : "—"}</td>
                </tr>))}
                {!q.data.rows.length && <tr><td colSpan={6} className="muted">Brak dokumentów dla wybranych filtrów.</td></tr>}
              </tbody>
            </table>
          </div>
          <ColumnHelp id="docs-cols" items={DOC_COLUMNS} />
          <nav className="pager" aria-label="Strony">
            <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Poprzednia</button>
            <span>Strona {page} z {pages} · {q.data.total} dokumentów</span>
            <button type="button" className="btn sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Następna →</button>
          </nav>
        </>
      )}
      {open && <OperationDetail id={open} onClose={() => setOpen(null)} />}
      {receiving && <ReceiveDialog t={receiving} onClose={() => setReceiving(null)} onDone={msg => { setReceiving(null); setDone(msg); }} />}
    </>
  );
}

const DOC_COLUMNS = [
  ["Nr dokumentu", "Numer nadany przy zapisie (automatyczny albo ręczny). Kliknij, aby zobaczyć całą operację z pozycjami i historią."],
  ["Typ", "PZ — przyjęcie, WZ — wydanie, MM — przesunięcie, TR — transport; pomocnicze: RW — zużycie, PW — produkcja, BO — bilans otwarcia."],
  ["Data", "Data ruchu w księdze; pod nią data dokumentu, jeśli jest inna."],
  ["Treść", "Materiały z ilością w jednostce dokumentu i magazynowej oraz rodzaj operacji."],
  ["Kontrahent", "Dostawca albo odbiorca; przy MM trasa magazynów i stan przyjęcia."],
  ["Wartość", "Wartość netto dokumentu (zakup, sprzedaż albo koszt transportu)."],
] as const;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());

/**
 * Przyjęcie MM: ilość faktycznie przyjęta (domyślnie wysłana), data, tonaż z wagi i — przy różnicy — przyczyna.
 * Podgląd różnicy liczy ta sama funkcja domeny co serwer (planReceipt); zapis z kluczem idempotencji.
 */
function ReceiveDialog({ t, onClose, onDone }: { t: InTransit; onClose: () => void; onDone: (msg: string) => void }) {
  const qc = useQueryClient();
  const [key] = useState(newKey);
  const [f, setF] = useState({ qty: t.qtySource, unit: t.unitSource, date: today(), weightManual: "", reason: "", note: "" });
  const m = t.material;
  const plan = m ? planReceipt({ ...f, reason: f.reason || null }, { material: m,
    sentQtyStock: t.qtyStock, sentDate: t.date, sentUnit: t.unitSource, today: today() }) : null;
  const diff = plan?.ok ? Number(plan.plan.diffStock) : 0;
  const save = useMutation({
    mutationFn: () => api.post(`/operations/${t.operationId}/receive`, { idempotencyKey: key, receipt: { ...f, reason: f.reason || null, note: f.note || null, weightManual: f.weightManual || null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents"] }); void qc.invalidateQueries({ queryKey: ["stock"] }); void qc.invalidateQueries({ queryKey: ["operations"] });
      onDone(`Przyjęto ${t.number} na magazyn ${t.to.name}.`);
    },
  });
  const fe = (k: string) => (save.error instanceof ApiRequestError ? save.error.field(k) : undefined);
  // przed wskazaniem przyczyny reguła domeny zgłasza różnicę jako brak przyczyny — pokazujemy ją od razu
  const reasonHint = plan && !plan.ok && !save.isError ? plan.errors.find(e => e.field === "reason")?.message : undefined;
  const set = (k: keyof typeof f, v: string) => { if (save.isError) save.reset(); setF(s => ({ ...s, [k]: v })); };
  return (
    <Dialog title={`Przyjęcie ${t.number}`} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary" id="mm-receive-save" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Zapisywanie…" : "Przyjmij na stan"}</button>
      </>}>
      <div className="form" id="mm-receive">
        {save.isError && !(save.error instanceof ApiRequestError && save.error.body?.details?.length) && <Alert kind="err">{errorText(save.error)}</Alert>}
        <p className="muted small">Z magazynu <strong>{t.from.name}</strong> wysłano {day(t.date)}: <strong className="num">{formatQty(t.qtySource)} {UNIT_LABEL[t.unitSource]}</strong>
          {m && t.unitSource !== m.stockUnit ? ` (${formatQty(t.qtyStock)} ${UNIT_LABEL[m.stockUnit]})` : ""} — {m?.name}.</p>
        <div className="grid2">
          <div className="field"><label htmlFor="rc-qty">Ilość przyjęta <span className="req">*</span></label>
            <div className="join">
              <input id="rc-qty" className="ctrl r" inputMode="decimal" value={f.qty} onChange={e => set("qty", e.target.value)} />
              <select className="ctrl" aria-label="Jednostka ilości przyjętej" value={f.unit} onChange={e => set("unit", e.target.value)}>
                {(m?.allowedUnits ?? [t.unitSource]).map(u => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select>
            </div><Hint id="rc-qty" text={OP_HELP["rc-qty"]} />{(fe("qty") ?? fe("unit")) && <small className="error">{fe("qty") ?? fe("unit")}</small>}</div>
          <div className="field"><label htmlFor="rc-date">Data przyjęcia <span className="req">*</span></label>
            <input id="rc-date" className="ctrl" type="date" min={t.date} max={today()} value={f.date} onChange={e => set("date", e.target.value)} />
            <Hint id="rc-date" text={OP_HELP["rc-date"]} />{fe("date") && <small className="error">{fe("date")}</small>}</div>
        </div>
        {plan?.ok && diff !== 0 && <Alert kind="warn"><span>Różnica: {diff > 0 ? "ubytek" : "nadwyżka"} <strong className="num">{formatQty(Math.abs(diff).toString())} {m ? UNIT_LABEL[m.stockUnit] : ""}</strong> · {MM_DIFF_REASONS[f.reason as keyof typeof MM_DIFF_REASONS] ?? ""}</span></Alert>}
        {reasonHint && <Alert kind="warn">{reasonHint}</Alert>}
        <div className="grid2">
          <div className="field"><label htmlFor="rc-reason">Przyczyna różnicy</label>
            <select id="rc-reason" className="ctrl" value={f.reason} onChange={e => set("reason", e.target.value)}>
              <option value="">— brak różnicy —</option>{Object.entries(MM_DIFF_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select><Hint id="rc-reason" text={OP_HELP["rc-reason"]} />{fe("reason") && <small className="error">{fe("reason")}</small>}</div>
          <div className="field"><label htmlFor="rc-weight">Tonaż z wagi (t)</label>
            <input id="rc-weight" className="ctrl r" inputMode="decimal" placeholder="puste = AUTO" value={f.weightManual} onChange={e => set("weightManual", e.target.value)} />
            <Hint id="rc-weight" text={OP_HELP["rc-weight"]} />{fe("weightManual") && <small className="error">{fe("weightManual")}</small>}</div>
        </div>
        <div className="field"><label htmlFor="rc-note">Opis</label>
          <input id="rc-note" className="ctrl" maxLength={300} placeholder="wymagany przy „Inna przyczyna” i przyjęciu zerowym" value={f.note} onChange={e => set("note", e.target.value)} />
          <Hint id="rc-note" text={OP_HELP["rc-note"]} />{fe("note") && <small className="error">{fe("note")}</small>}</div>
      </div>
    </Dialog>
  );
}
