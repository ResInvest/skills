import { fmtQty, m, t, tm } from "../../i18n";
import { useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MM_DIFF_REASONS, planReceipt } from "@resinvest/domain";
import { ApiRequestError, api, errorText } from "../../api/client";
import { UNIT_LABEL, type Unit } from "../../api/types";
import { useSession } from "../../auth/session";
import { Alert, Dialog } from "../../ui/components";
import { ColumnHelp, Hint, TutorialToggle } from "../../ui/tutorial";
import { ExportButtons } from "../../ui/download";
import { OP_HELP } from "./help";
import { useWorkWarehouse } from "../stock/StockPage";
import { newKey } from "./idempotency";
import { DocBadge, OP_LABEL, OperationDetail, StatusBadge, TransferState, day, pln, tonLine } from "./OperationDetail";
import { ChangesList, type ChangesKind } from "./ChangesList";

interface DocRow {
  id: string; type: string; number: string; documentDate: string; movementDate: string; partner: string | null; operationId: string; operationType: string; status: string;
  externalNumber: string | null; value: string; corrections: number;
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
  const [view, setView] = useState<"register" | ChangesKind>("register");
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
  const inbound = (transit.data ?? []).filter(x => x.direction === "IN"), outbound = (transit.data ?? []).filter(x => x.direction === "OUT");
  return (
    <>
      <div className="page-h">
        <div><h1>{t("Dokumenty")}</h1><p className="muted small">{t("PZ — przyjęcia, WZ — wydania, MM — przesunięcia. Kliknij numer, aby zobaczyć operację z pozycjami.")}</p></div>
        <div className="actions"><TutorialToggle />
          {(can("receipts.create") || can("issues.create") || can("production.create")) && <Link className="btn primary" to="/nowa-operacja">{t("+ Nowa operacja")}</Link>}</div>
      </div>
      {done && <Alert kind="ok">{done}</Alert>}
      {inbound.length > 0 && (
        <section className="card" id="mm-inbound" aria-labelledby="mm-in-h">
          <header className="card-h"><h2 id="mm-in-h">{t("Do przyjęcia — MM w drodze do tego magazynu")}</h2><span className="badge warn">{inbound.length}</span></header>
          <ul className="plain">{inbound.map(x => (
            <li key={x.operationId} className="transit-row">
              <span><DocBadge type="MM" /> <span className="doc">{x.number}</span> · {day(x.date)} · {t("z:")} <strong>{x.from.name}</strong></span>
              <span className="num">{x.material?.name}: {fmtQty(x.qtySource)} {UNIT_LABEL[x.unitSource]}{x.weightT ? ` · ${fmtQty(x.weightT)} t` : ""}</span>
              {can("mm.receive") ? <button type="button" className="btn sm primary" data-receive={x.number} onClick={() => { setDone(null); setReceiving(x); }}>{t("Przyjmij")}</button>
                : <small className="muted">{t("przyjmuje osoba z uprawnieniem „Przyjęcie MM”")}</small>}
            </li>))}</ul>
        </section>)}
      {outbound.length > 0 && <p className="muted small" id="mm-outbound">{t("Wysłane, czekają na przyjęcie:")} {outbound.map(x => `${x.number} → ${x.to.name}`).join(" · ")}</p>}
      <div className="tabs scroll" role="tablist" aria-label={t("Widok rejestru")}>
        {([["register", m("Rejestr")], ["corrections", m("Korekty")], ["edited", m("Edytowane")], ["deleted", m("Usunięte")]] as const).map(([k, l]) =>
          <button key={k} type="button" role="tab" id={`docs-tab-${k}`} aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{t(l)}</button>)}
      </div>
      {view !== "register" ? <>
        <div className="filters"><select className="ctrl" aria-label={t("Magazyn")} value={W.id} onChange={e => W.setId(e.target.value)}>{W.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
        <ChangesList key={`${view}-${W.id}`} kind={view} warehouseId={W.id} onOpen={setOpen} />
      </> : <>
      <div className="filters" role="search">
        <select className="ctrl" aria-label={t("Magazyn")} value={W.id} onChange={e => { setPage(1); W.setId(e.target.value); }}>{W.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select className="ctrl" aria-label={t("Typ dokumentu")} value={f.type} onChange={e => set("type", e.target.value)}><option value="">{t("Wszystkie typy")}</option>{types.map(x => <option key={x} value={x}>{x}</option>)}</select>
        <label className="inline">{t("Od")} <input className="ctrl" type="date" value={f.from} onChange={e => set("from", e.target.value)} /></label>
        <label className="inline">{t("Do")} <input className="ctrl" type="date" value={f.to} onChange={e => set("to", e.target.value)} /></label>
        <input className="ctrl" type="search" placeholder={t("Numer, kontrahent, nr zewnętrzny")} aria-label={t("Szukaj")} value={f.q} onChange={e => set("q", e.target.value)} />
        <label className="inline check"><input type="checkbox" id="doc-aux" checked={f.aux} onChange={e => set("aux", e.target.checked)} /> {t("Pokaż dokumenty pomocnicze (RW, PW, BO)")}</label>
      </div>
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">{t("Wczytywanie…")}</p> : (
        <>
          <div className="table-wrap">
            <table className="table" id="docs-table">
              <thead><tr><th>{t("Nr dokumentu")}</th><th>{t("Typ")}</th><th>{t("Data")}</th><th>{t("Treść")}</th><th>{t("Kontrahent")}</th><th className="r">{t("Wartość")}</th></tr></thead>
              <tbody>{q.data.rows.map(d => (
                <tr key={d.id} className={`doc-row doc-row-${["PZ", "WZ", "MM"].includes(d.type) ? d.type : "aux"}`}>
                  <td data-label={t("Nr dokumentu")}><button type="button" className="linkish doc" onClick={() => setOpen(d.operationId)}>{d.number}</button>{d.corrections > 0 && <> <StatusBadge status={d.status} corrections={d.corrections} /></>}</td>
                  <td data-label={t("Typ")}><DocBadge type={d.type} /></td>
                  <td data-label={t("Data")}>{day(d.movementDate)}{d.documentDate !== d.movementDate && <><br /><small className="muted">{t("dok. {date}", { date: day(d.documentDate) })}</small></>}</td>
                  <td data-label={t("Treść")}>{d.lines.map((l, i) => <div key={i}>{l.material}: <span className="num">{tonLine(l)}</span></div>)}<small className="muted">{OP_LABEL[d.operationType] ?? d.operationType}</small></td>
                  <td data-label={t("Kontrahent")}>{d.transfer ? <span className="mm-route">{d.transfer.from} → {d.transfer.to} <TransferState state={d.transfer.state} /></span> : d.partner ?? "—"}</td>
                  <td data-label={t("Wartość")} className="r num">{Number(d.value) ? pln(d.value) : "—"}</td>
                </tr>))}
                {!q.data.rows.length && <tr><td colSpan={6} className="muted">{t("Brak dokumentów dla wybranych filtrów.")}</td></tr>}
              </tbody>
            </table>
          </div>
          <ColumnHelp id="docs-cols" items={DOC_COLUMNS} />
          <ExportButtons label={t("Eksport rejestru (wg filtrów)")} query={{ report: "documents", warehouseId: W.id, type: f.type || undefined, from: f.from || undefined, to: f.to || undefined, q: f.q || undefined, aux: f.aux ? "1" : undefined }} />
          <nav className="pager" aria-label={t("Strony")}>
            <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("← Poprzednia")}</button>
            <span>{t("Strona {page} z {pages}", { page, pages })} · {t("{n} dokumentów", { n: q.data.total })}</span>
            <button type="button" className="btn sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>{t("Następna →")}</button>
          </nav>
        </>
      )}
      </>}
      {open && <OperationDetail id={open} onClose={() => setOpen(null)} />}
      {receiving && <ReceiveDialog transfer={receiving} onClose={() => setReceiving(null)} onDone={msg => { setReceiving(null); setDone(msg); }} />}
    </>
  );
}

const DOC_COLUMNS = [
  [m("Nr dokumentu"), m("Numer nadany przy zapisie (automatyczny albo ręczny); „korygowany” — dokument po korekcie. Kliknij, aby zobaczyć operację, historię zmian, „Koryguj” i „Usuń”.")],
  [m("Typ"), m("PZ — przyjęcie, WZ — wydanie, MM — przesunięcie, TR — transport; pomocnicze: RW — zużycie, PW — produkcja, BO — bilans otwarcia.")],
  [m("Data"), m("Data ruchu w księdze; pod nią data dokumentu, jeśli jest inna.")],
  [m("Treść"), m("Materiały z ilością w jednostce dokumentu i magazynowej oraz rodzaj operacji.")],
  [m("Kontrahent"), m("Dostawca albo odbiorca; przy MM trasa magazynów i stan przyjęcia.")],
  [m("Wartość"), m("Wartość netto dokumentu (zakup, sprzedaż albo koszt transportu).")],
] as const;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());

/**
 * Przyjęcie MM: ilość faktycznie przyjęta (domyślnie wysłana), data, tonaż z wagi i — przy różnicy — przyczyna.
 * Podgląd różnicy liczy ta sama funkcja domeny co serwer (planReceipt); zapis z kluczem idempotencji.
 */
function ReceiveDialog({ transfer: tr, onClose, onDone }: { transfer: InTransit; onClose: () => void; onDone: (msg: string) => void }) {
  const qc = useQueryClient();
  const [key] = useState(newKey);
  const [f, setF] = useState({ qty: tr.qtySource, unit: tr.unitSource, date: today(), weightManual: "", reason: "", note: "" });
  const m = tr.material;
  const plan = m ? planReceipt({ ...f, reason: f.reason || null }, { material: m,
    sentQtyStock: tr.qtyStock, sentDate: tr.date, sentUnit: tr.unitSource, today: today() }) : null;
  const diff = plan?.ok ? Number(plan.plan.diffStock) : 0;
  const save = useMutation({
    mutationFn: () => api.post(`/operations/${tr.operationId}/receive`, { idempotencyKey: key, receipt: { ...f, reason: f.reason || null, note: f.note || null, weightManual: f.weightManual || null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents"] }); void qc.invalidateQueries({ queryKey: ["stock"] }); void qc.invalidateQueries({ queryKey: ["operations"] });
      onDone(t("Przyjęto {doc} na magazyn {warehouse}.", { doc: tr.number, warehouse: tr.to.name }));
    },
  });
  const fe = (k: string) => (save.error instanceof ApiRequestError ? save.error.field(k) : undefined);   // field() tłumaczy komunikat
  // przed wskazaniem przyczyny reguła domeny zgłasza różnicę jako brak przyczyny — pokazujemy ją od razu
  const reasonRaw = plan && !plan.ok && !save.isError ? plan.errors.find(e => e.field === "reason")?.message : undefined;
  const reasonHint = reasonRaw ? tm(reasonRaw) : undefined;
  const set = (k: keyof typeof f, v: string) => { if (save.isError) save.reset(); setF(s => ({ ...s, [k]: v })); };
  return (
    <Dialog title={t("Przyjęcie {doc}", { doc: tr.number })} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>{t("Anuluj")}</button>
        <button type="button" className="btn primary" id="mm-receive-save" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? t("Zapisywanie…") : t("Przyjmij na stan")}</button>
      </>}>
      <div className="form" id="mm-receive">
        {save.isError && !(save.error instanceof ApiRequestError && save.error.body?.details?.length) && <Alert kind="err">{errorText(save.error)}</Alert>}
        <p className="muted small">{t("Z magazynu")} <strong>{tr.from.name}</strong> {t("wysłano {date}:", { date: day(tr.date) })} <strong className="num">{fmtQty(tr.qtySource)} {UNIT_LABEL[tr.unitSource]}</strong>
          {m && tr.unitSource !== m.stockUnit ? ` (${fmtQty(tr.qtyStock)} ${UNIT_LABEL[m.stockUnit]})` : ""} — {m?.name}.</p>
        <div className="grid2">
          <div className="field"><label htmlFor="rc-qty">{t("Ilość przyjęta")} <span className="req">*</span></label>
            <div className="join">
              <input id="rc-qty" className="ctrl r" inputMode="decimal" value={f.qty} onChange={e => set("qty", e.target.value)} />
              <select className="ctrl" aria-label={t("Jednostka ilości przyjętej")} value={f.unit} onChange={e => set("unit", e.target.value)}>
                {(m?.allowedUnits ?? [tr.unitSource]).map(u => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select>
            </div><Hint id="rc-qty" text={OP_HELP["rc-qty"]} />{(fe("qty") ?? fe("unit")) && <small className="error">{fe("qty") ?? fe("unit")}</small>}</div>
          <div className="field"><label htmlFor="rc-date">{t("Data przyjęcia")} <span className="req">*</span></label>
            <input id="rc-date" className="ctrl" type="date" min={tr.date} max={today()} value={f.date} onChange={e => set("date", e.target.value)} />
            <Hint id="rc-date" text={OP_HELP["rc-date"]} />{fe("date") && <small className="error">{fe("date")}</small>}</div>
        </div>
        {plan?.ok && diff !== 0 && <Alert kind="warn"><span>{t("Różnica:")} {diff > 0 ? t("ubytek") : t("nadwyżka")} <strong className="num">{fmtQty(Math.abs(diff).toString())} {m ? UNIT_LABEL[m.stockUnit] : ""}</strong> · {f.reason ? tm(MM_DIFF_REASONS[f.reason as keyof typeof MM_DIFF_REASONS] ?? "") : ""}</span></Alert>}
        {reasonHint && <Alert kind="warn">{reasonHint}</Alert>}
        <div className="grid2">
          <div className="field"><label htmlFor="rc-reason">{t("Przyczyna różnicy")}</label>
            <select id="rc-reason" className="ctrl" value={f.reason} onChange={e => set("reason", e.target.value)}>
              <option value="">{t("— brak różnicy —")}</option>{Object.entries(MM_DIFF_REASONS).map(([k, v]) => <option key={k} value={k}>{tm(v)}</option>)}
            </select><Hint id="rc-reason" text={OP_HELP["rc-reason"]} />{fe("reason") && <small className="error">{fe("reason")}</small>}</div>
          <div className="field"><label htmlFor="rc-weight">{t("Tonaż z wagi (t)")}</label>
            <input id="rc-weight" className="ctrl r" inputMode="decimal" placeholder={t("puste = AUTO")} value={f.weightManual} onChange={e => set("weightManual", e.target.value)} />
            <Hint id="rc-weight" text={OP_HELP["rc-weight"]} />{fe("weightManual") && <small className="error">{fe("weightManual")}</small>}</div>
        </div>
        <div className="field"><label htmlFor="rc-note">{t("Opis")}</label>
          <input id="rc-note" className="ctrl" maxLength={300} placeholder={t("wymagany przy „Inna przyczyna” i przyjęciu zerowym")} value={f.note} onChange={e => set("note", e.target.value)} />
          <Hint id="rc-note" text={OP_HELP["rc-note"]} />{fe("note") && <small className="error">{fe("note")}</small>}</div>
      </div>
    </Dialog>
  );
}
