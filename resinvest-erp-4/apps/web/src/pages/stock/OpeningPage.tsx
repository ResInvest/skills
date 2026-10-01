import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { convert, formatQty, parseNumber, UnitError } from "@resinvest/domain";
import { ApiRequestError, api, errorText } from "../../api/client";
import { UNIT_LABEL, type Material, type OpeningBatch, type Unit } from "../../api/types";
import { useSession } from "../../auth/session";
import { Alert, Dialog, fmtDateTime } from "../../ui/components";
import { useWarehouses } from "../account/AccountPage";

const KEY = ["opening-balances"] as const;
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("pl-PL", { timeZone: "UTC" });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
export const useMaterials = () => useQuery({ queryKey: ["materials"], queryFn: async ({ signal }) => (await api.get<{ materials: Material[] }>("/materials", signal)).materials, staleTime: 60_000 });

/**
 * Bilans otwarcia (Administracja → Dane startowe): szkic wprowadza Manager lub Administrator,
 * zatwierdza Administrator. Zatwierdzenie księguje dokument BO i ruchy — od tej chwili stan magazynu
 * zmieniają wyłącznie dokumenty i korekty.
 */
export function OpeningPage() {
  const { can } = useSession();
  const wh = useWarehouses();
  const [whId, setWhId] = useState("");
  const [edit, setEdit] = useState<OpeningBatch | "new" | null>(null);
  const [approve, setApprove] = useState<OpeningBatch | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...KEY, whId], staleTime: 0, refetchOnMount: "always", queryFn: async ({ signal }) => (await api.get<{ batches: OpeningBatch[] }>(`/opening-balances${whId ? `?warehouseId=${whId}` : ""}`, signal)).batches });
  const del = useMutation({
    mutationFn: (b: OpeningBatch) => api.del(`/opening-balances/${b.id}?version=${b.version}`),
    onSuccess: () => { setMsg({ kind: "ok", text: "Szkic usunięty." }); void qc.invalidateQueries({ queryKey: KEY }); },
    onError: e => setMsg({ kind: "err", text: errorText(e) }),
  });
  const approved = new Set((q.data ?? []).filter(b => b.status === "APPROVED").map(b => b.warehouseId));
  return (
    <>
      <div className="page-h">
        <div><h1>Bilans otwarcia</h1><p className="muted small">Stan początkowy magazynu — pierwsze zdarzenie stanu. Szkic: Manager lub Administrator · zatwierdzenie: Administrator.</p></div>
        {can("opening.manage") && <button type="button" className="btn primary" id="opening-new" onClick={() => { setMsg(null); setEdit("new"); }}>+ Nowy bilans</button>}
      </div>
      <div className="filters">
        <select className="ctrl" aria-label="Magazyn" value={whId} onChange={e => setWhId(e.target.value)}>
          <option value="">Wszystkie magazyny</option>{wh.data?.map(w => <option key={w.id} value={w.id}>{w.name}{approved.has(w.id) ? " — bilans zatwierdzony" : ""}</option>)}
        </select>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">Wczytywanie…</p> : (
        <div className="table-wrap">
          <table className="table" id="opening-table">
            <thead><tr><th>Magazyn</th><th>Na dzień</th><th>Status</th><th className="r">Pozycje</th><th>Wprowadził</th><th>Zatwierdził</th><th><span className="sr-only">Akcje</span></th></tr></thead>
            <tbody>
              {q.data.map(b => (
                <tr key={b.id} data-id={b.id}>
                  <td data-label="Magazyn"><strong>{b.warehouse.name}</strong>{b.documentNumber && <><br /><span className="doc">{b.documentNumber}</span></>}</td>
                  <td data-label="Na dzień">{fmtDay(b.effectiveDate)}</td>
                  <td data-label="Status">{b.status === "APPROVED" ? <span className="badge ok">zatwierdzony</span> : <span className="badge warn">szkic</span>}</td>
                  <td data-label="Pozycje" className="r">{b.lines.length}</td>
                  <td data-label="Wprowadził">{b.createdBy ?? "—"}<br /><small className="muted">{fmtDateTime(b.createdAt)}</small></td>
                  <td data-label="Zatwierdził">{b.approvedBy ?? "—"}{b.approvedAt && <><br /><small className="muted">{fmtDateTime(b.approvedAt)}</small></>}</td>
                  <td data-label="Akcje"><div className="actions">
                    <button type="button" className="btn sm" onClick={() => { setMsg(null); setEdit(b); }}>{b.status === "DRAFT" && can("opening.manage") ? "Edytuj" : "Podgląd"}</button>
                    {b.status === "DRAFT" && can("opening.approve") && <button type="button" className="btn sm primary" data-approve={b.id} onClick={() => { setMsg(null); setApprove(b); }}>Zatwierdź…</button>}
                    {b.status === "DRAFT" && can("opening.manage") && <button type="button" className="btn sm danger" disabled={del.isPending} onClick={() => { if (window.confirm(`Usunąć szkic bilansu (${b.warehouse.name})?`)) del.mutate(b); }}>Usuń szkic</button>}
                  </div></td>
                </tr>
              ))}
              {!q.data.length && <tr><td colSpan={7} className="muted">Brak bilansów otwarcia.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {edit && <OpeningEditor batch={edit === "new" ? null : edit} readOnly={edit !== "new" && (edit.status === "APPROVED" || !can("opening.manage"))} onClose={() => setEdit(null)}
        onSaved={t => { setEdit(null); setMsg({ kind: "ok", text: t }); void qc.invalidateQueries({ queryKey: KEY }); }} />}
      {approve && <ApproveDialog batch={approve} onClose={() => setApprove(null)}
        onDone={t => { setApprove(null); setMsg({ kind: "ok", text: t }); void qc.invalidateQueries({ queryKey: KEY }); void qc.invalidateQueries({ queryKey: ["stock"] }); }} />}
    </>
  );
}

interface LineState { key: number; materialId: string; qty: string; unit: Unit; note: string }
let seq = 0;

/** Formularz szkicu: magazyn, data, uwagi, pozycje (materiał, ilość, jednostka) z podglądem przeliczenia na jednostkę magazynową. */
function OpeningEditor({ batch, readOnly, onClose, onSaved }: { batch: OpeningBatch | null; readOnly: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const wh = useWarehouses(), mats = useMaterials();
  const [warehouseId, setWarehouseId] = useState(batch?.warehouseId ?? "");
  const [date, setDate] = useState(batch?.effectiveDate ?? today());
  const [note, setNote] = useState(batch?.note ?? "");
  const [lines, setLines] = useState<LineState[]>(() => batch?.lines.map(l => ({ key: ++seq, materialId: l.materialId, qty: l.qty.replace(".", ","), unit: l.unit, note: l.note ?? "" })) ?? []);
  const [err, setErr] = useState<ApiRequestError | Error | null>(null);
  const byId = useMemo(() => new Map((mats.data ?? []).map(m => [m.id, m])), [mats.data]);
  const save = useMutation({
    mutationFn: () => {
      const body = { warehouseId, effectiveDate: date, note: note.trim() || null, lines: lines.map(l => ({ materialId: l.materialId, qty: l.qty, unit: l.unit, note: l.note.trim() || null })) };
      return batch ? api.put(`/opening-balances/${batch.id}`, { ...body, version: batch.version }) : api.post("/opening-balances", body);
    },
    onSuccess: () => onSaved(batch ? "Szkic bilansu zapisany." : "Szkic bilansu utworzony — czeka na zatwierdzenie przez administratora."),
    onError: e => setErr(e as Error),
  });
  const fe = (f: string) => (err instanceof ApiRequestError ? err.field(f) : undefined);
  const used = new Set(lines.map(l => l.materialId));
  const addAll = () => setLines(ls => [...ls, ...(mats.data ?? []).filter(m => m.active && !used.has(m.id)).map(m => ({ key: ++seq, materialId: m.id, qty: "", unit: m.stockUnit, note: "" }))]);
  const upd = (key: number, p: Partial<LineState>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...p } : l)));
  return (
    <Dialog title={batch ? `Bilans otwarcia — ${batch.warehouse.name}` : "Nowy bilans otwarcia"} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>{readOnly ? "Zamknij" : "Anuluj"}</button>
        {!readOnly && <button type="button" className="btn primary" id="opening-save" disabled={save.isPending} onClick={() => { setErr(null); save.mutate(); }}>{save.isPending ? "Zapisywanie…" : "Zapisz szkic"}</button>}
      </>}>
      {err && <Alert kind="err">{errorText(err)}</Alert>}
      {batch?.status === "APPROVED" && <Alert kind="ok">Zatwierdzony {fmtDateTime(batch.approvedAt)} przez {batch.approvedBy} · dokument {batch.documentNumber}. Zmiany stanu — wyłącznie dokumentami i korektami.</Alert>}
      <div className="grid2">
        <div className="field"><label htmlFor="ob-wh">Magazyn <span className="req">*</span></label>
          <select id="ob-wh" className="ctrl" value={warehouseId} disabled={readOnly || !!batch} onChange={e => setWarehouseId(e.target.value)}>
            <option value="">— wybierz magazyn —</option>{wh.data?.filter(w => w.active).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>{fe("warehouseId") && <small className="error">{fe("warehouseId")}</small>}</div>
        <div className="field"><label htmlFor="ob-date">Stan na dzień <span className="req">*</span></label>
          <input id="ob-date" className="ctrl" type="date" value={date} max={today()} disabled={readOnly} onChange={e => setDate(e.target.value)} />
          {fe("effectiveDate") && <small className="error">{fe("effectiveDate")}</small>}</div>
      </div>
      <div className="field"><label htmlFor="ob-note">Uwagi (np. podstawa — remanent, protokół)</label>
        <input id="ob-note" className="ctrl" value={note} maxLength={500} disabled={readOnly} onChange={e => setNote(e.target.value)} /></div>
      <h3>Pozycje</h3>
      <div className="table-wrap">
        <table className="table" id="opening-lines">
          <thead><tr><th>Materiał</th><th className="r">Ilość</th><th>Jednostka</th><th className="r">Stan (jedn. magazynowa)</th><th>Uwagi</th>{!readOnly && <th><span className="sr-only">Usuń</span></th>}</tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const m = byId.get(l.materialId);
              const preview = (() => {
                if (!m) return "—";
                const p = parseNumber(l.qty);
                if (!p.ok) return "—";
                try { return `${formatQty(convert(p.value, l.unit, m.stockUnit, m).value)} ${UNIT_LABEL[m.stockUnit]}`; } catch (e) { return e instanceof UnitError ? e.message : "—"; }
              })();
              return (
                <tr key={l.key}>
                  <td data-label="Materiał">
                    <select className="ctrl" aria-label={`Materiał, pozycja ${i + 1}`} value={l.materialId} disabled={readOnly} onChange={e => { const nm = byId.get(e.target.value); upd(l.key, { materialId: e.target.value, unit: nm?.stockUnit ?? l.unit }); }}>
                      <option value="">— wybierz —</option>
                      {mats.data?.filter(x => x.active || x.id === l.materialId).map(x => <option key={x.id} value={x.id} disabled={used.has(x.id) && x.id !== l.materialId}>{x.name}</option>)}
                    </select>{fe(`lines.${i}.materialId`) && <small className="error">{fe(`lines.${i}.materialId`)}</small>}
                  </td>
                  <td data-label="Ilość"><input className="ctrl r" inputMode="decimal" aria-label={`Ilość, pozycja ${i + 1}`} value={l.qty} disabled={readOnly} placeholder="np. 817" onChange={e => upd(l.key, { qty: e.target.value })} />
                    {fe(`lines.${i}.qty`) && <small className="error">{fe(`lines.${i}.qty`)}</small>}</td>
                  <td data-label="Jednostka"><select className="ctrl" aria-label={`Jednostka, pozycja ${i + 1}`} value={l.unit} disabled={readOnly || !m} onChange={e => upd(l.key, { unit: e.target.value as Unit })}>
                    {(m?.allowedUnits ?? [l.unit]).map(u => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select>
                    {fe(`lines.${i}.unit`) && <small className="error">{fe(`lines.${i}.unit`)}</small>}</td>
                  <td data-label="Stan" className="r num" data-preview>{preview}</td>
                  <td data-label="Uwagi"><input className="ctrl" aria-label={`Uwagi, pozycja ${i + 1}`} value={l.note} maxLength={300} disabled={readOnly} onChange={e => upd(l.key, { note: e.target.value })} /></td>
                  {!readOnly && <td><button type="button" className="btn sm ghost" aria-label={`Usuń pozycję ${i + 1}`} onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}>✕</button></td>}
                </tr>
              );
            })}
            {!lines.length && <tr><td colSpan={6} className="muted">Brak pozycji — dodaj materiały.</td></tr>}
          </tbody>
        </table>
      </div>
      {fe("lines") && <Alert kind="err">{fe("lines")}</Alert>}
      {!readOnly && <div className="actions mt">
        <button type="button" className="btn sm" id="opening-add" onClick={() => setLines(ls => [...ls, { key: ++seq, materialId: "", qty: "", unit: "M3", note: "" }])}>+ Dodaj pozycję</button>
        <button type="button" className="btn sm" onClick={addAll}>+ Wszystkie aktywne materiały</button>
      </div>}
      <p className="muted small">Podgląd przelicza ilość przelicznikami domyślnymi; wartość ostateczną (z przelicznikiem firmowym obowiązującym w dniu bilansu) wylicza i zapisuje serwer.</p>
    </Dialog>
  );
}

/** Zatwierdzenie: podsumowanie pozycji i ostrzeżenie — operacji nie cofa się (zmiany tylko korektą). */
function ApproveDialog({ batch, onClose, onDone }: { batch: OpeningBatch; onClose: () => void; onDone: (msg: string) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<{ batch: OpeningBatch }>(`/opening-balances/${batch.id}/approve`, { version: batch.version }),
    onSuccess: r => onDone(`Bilans otwarcia zatwierdzony — dokument ${r.batch.documentNumber}. Stany magazynu ${batch.warehouse.name} ustawione.`),
    onError: e => setErr(errorText(e)),
  });
  return (
    <Dialog title={`Zatwierdzenie bilansu — ${batch.warehouse.name}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary" id="approve-yes" disabled={m.isPending} onClick={() => { setErr(null); m.mutate(); }}>{m.isPending ? "Zatwierdzanie…" : "Zatwierdź i zaksięguj"}</button></>}>
      {err && <Alert kind="err">{err}</Alert>}
      <p>Stan na dzień <strong>{fmtDay(batch.effectiveDate)}</strong> · wprowadził: {batch.createdBy ?? "—"}</p>
      <ul className="plain">{batch.lines.map(l => <li key={l.id}>{l.name}: <strong>{formatQty(l.qtyStock)} {UNIT_LABEL[l.stockUnit]}</strong>{l.unit !== l.stockUnit && <small className="muted"> (wprowadzono {formatQty(l.qty)} {UNIT_LABEL[l.unit]})</small>}</li>)}</ul>
      <Alert kind="warn">Zatwierdzenie utworzy dokument BO i ruchy magazynowe. Zatwierdzonego bilansu nie można edytować ani usunąć — późniejsze różnice wprowadza się dokumentami lub korektą.</Alert>
    </Dialog>
  );
}
