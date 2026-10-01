import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, errorText } from "../../api/client";
import { Alert, fmtDateTime } from "../../ui/components";
import { ColumnHelp } from "../../ui/tutorial";
import { ChangesTable, DocBadge, OP_LABEL, day } from "./OperationDetail";

export type ChangesKind = "corrections" | "edited" | "deleted";
type Docs = Array<{ type: string; number: string }>;
interface CorrectionRow { id: string; number: string; createdAt: string; createdBy: string | null; reason: string; operationId: string; operationType: string; status: string; documents: Docs;
  changes: Array<{ field: string; before: string | null; after: string | null }> }
interface OpRow { operationId: string; operationType: string; status: string; operationDate: string; documents: Docs; corrections: number;
  last: { number: string; at: string; by: string | null; reason: string } | null; deleted: { at: string; by: string | null; reason: string | null } | null }

const PAGE = 50;
const DocList = ({ docs }: { docs: Docs }) => <>{docs.filter(d => d.type !== "TR").map(d => <span key={d.number} className="nowrap"><DocBadge type={d.type} /> <span className="doc">{d.number}</span> </span>)}</>;
const HELP: Record<ChangesKind, ReadonlyArray<readonly [string, string]>> = {
  corrections: [["Korekta", "Numer KOR/NNN/MM/RRRR, data i osoba. Numery dokumentów korygowanych się nie zmieniają."], ["Dokumenty", "Dokumenty operacji objęte korektą — kliknij, aby zobaczyć operację i pełną historię."],
    ["Powód", "Powód podany przy korekcie (wymagany)."], ["Było / Jest", "Pola, które zmieniła korekta: wartość przed i po."]],
  edited: [["Dokumenty", "Operacje zmienione co najmniej jedną korektą."], ["Korekty", "Liczba korekt tej operacji."], ["Ostatnia", "Numer, data, osoba i powód ostatniej korekty."]],
  deleted: [["Dokumenty", "Usunięte operacje — ich ruchy magazynowe zostały odwrócone; numery pozostają zajęte."], ["Usunięto", "Data i osoba."], ["Powód", "Powód podany przy usunięciu (wymagany)."]],
};

/** Zakładki rejestru „Korekty”, „Edytowane”, „Usunięte” — z filtrem dat i stronicowaniem; kliknięcie otwiera operację. */
export function ChangesList({ kind, warehouseId, onOpen }: { kind: ChangesKind; warehouseId: string; onOpen: (operationId: string) => void }) {
  const [f, setF] = useState({ from: "", to: "" });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ warehouseId, kind, page: String(page), pageSize: String(PAGE), ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) });
  const q = useQuery({ queryKey: ["documents", "changes", qs.toString()], enabled: !!warehouseId, staleTime: 0, refetchOnMount: "always", placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<{ total: number; rows: Array<CorrectionRow & OpRow> }>(`/documents/changes?${qs.toString()}`, signal) });
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / PAGE));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setPage(1); setF(s => ({ ...s, [k]: e.target.value })); };
  const open = (id: string, docs: Docs) => <button type="button" className="linkish" onClick={() => onOpen(id)}><DocList docs={docs} /></button>;
  return (
    <section id={`changes-${kind}`}>
      <div className="filters" role="search">
        <label className="inline">Od <input className="ctrl" type="date" value={f.from} onChange={set("from")} /></label>
        <label className="inline">Do <input className="ctrl" type="date" value={f.to} onChange={set("to")} /></label>
      </div>
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">Wczytywanie…</p> : (
        <>
          <div className="table-wrap"><table className="table" id={`changes-${kind}-table`}>
            {kind === "corrections" ? <>
              <thead><tr><th>Korekta</th><th>Dokumenty</th><th>Powód</th><th>Było / Jest</th></tr></thead>
              <tbody>{q.data.rows.map(r => (
                <tr key={r.id} data-correction={r.number}>
                  <td data-label="Korekta"><strong className="doc">{r.number}</strong><br /><small className="muted">{fmtDateTime(r.createdAt)} · {r.createdBy ?? "—"}</small></td>
                  <td data-label="Dokumenty">{open(r.operationId, r.documents)}<br /><small className="muted">{OP_LABEL[r.operationType] ?? r.operationType}{r.status === "DELETED" ? " · usunięta później" : ""}</small></td>
                  <td data-label="Powód">{r.reason}</td>
                  <td data-label="Było / Jest"><ChangesTable changes={r.changes} /></td>
                </tr>))}</tbody>
            </> : kind === "edited" ? <>
              <thead><tr><th>Dokumenty</th><th>Data</th><th className="r">Korekty</th><th>Ostatnia korekta</th></tr></thead>
              <tbody>{q.data.rows.map(r => (
                <tr key={r.operationId}>
                  <td data-label="Dokumenty">{open(r.operationId, r.documents)}<br /><small className="muted">{OP_LABEL[r.operationType] ?? r.operationType}</small></td>
                  <td data-label="Data">{day(r.operationDate)}</td>
                  <td data-label="Korekty" className="r num">{r.corrections}</td>
                  <td data-label="Ostatnia">{r.last && <><span className="doc">{r.last.number}</span> · {fmtDateTime(r.last.at)} · {r.last.by ?? "—"}<br /><small className="muted">{r.last.reason}</small></>}</td>
                </tr>))}</tbody>
            </> : <>
              <thead><tr><th>Dokumenty</th><th>Data operacji</th><th>Usunięto</th><th>Powód</th></tr></thead>
              <tbody>{q.data.rows.map(r => (
                <tr key={r.operationId} className="deleted-row">
                  <td data-label="Dokumenty">{open(r.operationId, r.documents)}<br /><small className="muted">{OP_LABEL[r.operationType] ?? r.operationType}</small></td>
                  <td data-label="Data">{day(r.operationDate)}</td>
                  <td data-label="Usunięto">{r.deleted ? `${fmtDateTime(r.deleted.at)} · ${r.deleted.by ?? "—"}` : "—"}</td>
                  <td data-label="Powód">{r.deleted?.reason ?? "—"}</td>
                </tr>))}</tbody>
            </>}
            {!q.data.rows.length && <tbody><tr><td colSpan={4} className="muted">{kind === "corrections" ? "Brak korekt." : kind === "edited" ? "Brak dokumentów po korekcie." : "Brak usuniętych dokumentów."}</td></tr></tbody>}
          </table></div>
          <ColumnHelp items={HELP[kind]} />
          <nav className="pager" aria-label="Strony">
            <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Poprzednia</button>
            <span>Strona {page} z {pages} · {q.data.total}</span>
            <button type="button" className="btn sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Następna →</button>
          </nav>
        </>
      )}
    </section>
  );
}
