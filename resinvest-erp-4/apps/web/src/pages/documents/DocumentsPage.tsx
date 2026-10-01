import { useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, errorText } from "../../api/client";
import type { Unit } from "../../api/types";
import { useSession } from "../../auth/session";
import { Alert } from "../../ui/components";
import { useWorkWarehouse } from "../stock/StockPage";
import { DocBadge, OP_LABEL, OperationDetail, day, pln, tonLine } from "./OperationDetail";

interface DocRow {
  id: string; type: string; number: string; documentDate: string; movementDate: string; partner: string | null; operationId: string; operationType: string; status: string;
  externalNumber: string | null; value: string;
  lines: Array<{ material: string; qtySource: string; unitSource: Unit; qtyStock: string; unitStock: Unit; weightT: string | null; weightSource: string | null; value: string | null }>;
}
const PAGE = 50;

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
  return (
    <>
      <div className="page-h">
        <div><h1>Dokumenty</h1><p className="muted small">PZ — przyjęcia, WZ — wydania, MM — przesunięcia. Kliknij numer, aby zobaczyć operację z pozycjami.</p></div>
        {(can("receipts.create") || can("issues.create") || can("production.create")) && <Link className="btn primary" to="/nowa-operacja">+ Nowa operacja</Link>}
      </div>
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
                  <td data-label="Kontrahent">{d.partner ?? "—"}</td>
                  <td data-label="Wartość" className="r num">{Number(d.value) ? pln(d.value) : "—"}</td>
                </tr>))}
                {!q.data.rows.length && <tr><td colSpan={6} className="muted">Brak dokumentów dla wybranych filtrów.</td></tr>}
              </tbody>
            </table>
          </div>
          <nav className="pager" aria-label="Strony">
            <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Poprzednia</button>
            <span>Strona {page} z {pages} · {q.data.total} dokumentów</span>
            <button type="button" className="btn sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Następna →</button>
          </nav>
        </>
      )}
      {open && <OperationDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
