import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError, api, errorText } from "../../api/client";
import { UNIT_LABEL } from "../../api/types";
import { useSession } from "../../auth/session";
import { Alert, Dialog } from "../../ui/components";
import { useWarehouses } from "../account/AccountPage";
import { KIND_UI, kindUi, statusLabel, type FieldDef, type Kind, type KindUi, type Row } from "./catalogDefs";

const useRows = (kind: Kind, enabled = true) => useQuery({
  queryKey: ["catalog", kind], enabled, staleTime: 0, refetchOnMount: "always",
  queryFn: async ({ signal }) => (await api.get<{ rows: Row[] }>(`/catalog/${kind}`, signal)).rows,
});

/**
 * Kartoteki: materiały, kontrahenci, rodzaje operacji dodatkowych, pojazdy, rębaki (własne i firm zewnętrznych),
 * kierowcy, operatorzy, firmy zewnętrzne. Rekordu użytego w dokumentach nie usuwa się — dezaktywacja / „Wycofany”.
 */
export function CatalogPage() {
  const { kind = "materials" } = useParams();
  const nav = useNavigate();
  const ui = kindUi(kind);
  const { can } = useSession();
  const editable = can(ui.perm);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"" | "1" | "0">("1");
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const rows = useRows(ui.kind);
  const refs = useRefs(ui);
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (r: Row) => api.del(`/catalog/${ui.kind}/${r.id}?version=${r.version}`),
    onSuccess: () => { setMsg({ kind: "ok", text: "Usunięto." }); void qc.invalidateQueries({ queryKey: ["catalog"] }); },
    onError: e => setMsg({ kind: "err", text: errorText(e) }),
  });
  const shown = (rows.data ?? []).filter(r => {
    const active = ui.activeField === "active" ? r.active !== false : r.status !== "RETIRED";
    if (only === "1" && !active) return false;
    if (only === "0" && active) return false;
    const t = q.trim().toLowerCase();
    return !t || ui.columns.some(c => String(c.render ? c.render(r, refs.name) : r[c.key] ?? "").toLowerCase().includes(t));
  });
  return (
    <>
      <div className="page-h">
        <div><h1>Kartoteki</h1><p className="muted small">Rekordu użytego w dokumentach nie usuwa się — ustawiasz go jako nieaktywny (historia zostaje). Każda zmiana trafia do dziennika audytu.</p></div>
        {editable && <button type="button" className="btn primary" id="cat-new" onClick={() => { setMsg(null); setEdit("new"); }}>+ Dodaj {ui.single}</button>}
      </div>
      <div className="tabs scroll" role="tablist" aria-label="Rodzaj kartoteki">
        {KIND_UI.map(k => <button key={k.kind} role="tab" type="button" aria-selected={k.kind === ui.kind} className={k.kind === ui.kind ? "on" : ""} onClick={() => { setMsg(null); setEdit(null); void nav(`/kartoteki/${k.kind}`); }}>{k.title}</button>)}
      </div>
      <div className="filters">
        <input className="ctrl" type="search" placeholder={`Szukaj: ${ui.title.toLowerCase()}`} aria-label="Szukaj" value={q} onChange={e => setQ(e.target.value)} />
        <select className="ctrl" aria-label="Status" value={only} onChange={e => setOnly(e.target.value as typeof only)}>
          <option value="1">Aktywne</option><option value="0">{ui.activeField === "active" ? "Nieaktywne" : "Wycofane"}</option><option value="">Wszystkie</option>
        </select>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {rows.isError ? <Alert kind="err">{errorText(rows.error)}</Alert> : !rows.data ? <p className="muted">Wczytywanie…</p> : (
        <div className="table-wrap">
          <table className="table" id="catalog-table">
            <thead><tr>{ui.columns.map(c => <th key={c.key} className={c.num ? "r" : ""}>{c.label}</th>)}{editable && <th><span className="sr-only">Akcje</span></th>}</tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id}>
                  {ui.columns.map((c, i) => <td key={c.key} data-label={c.label} className={c.num ? "r num" : ""}>{i === 0 ? <strong>{c.render ? c.render(r, refs.name) : String(r[c.key] ?? "")}</strong> : c.render ? c.render(r, refs.name) : String(r[c.key] ?? "")}</td>)}
                  {editable && <td data-label="Akcje"><div className="actions">
                    <button type="button" className="btn sm" onClick={() => { setMsg(null); setEdit(r); }} aria-label={`Edytuj: ${ui.label(r)}`}>Edytuj</button>
                    <button type="button" className="btn sm danger" disabled={del.isPending} onClick={() => { if (window.confirm(`Usunąć: ${ui.label(r)}? Jeśli rekord występuje w dokumentach, program zaproponuje dezaktywację.`)) del.mutate(r); }} aria-label={`Usuń: ${ui.label(r)}`}>Usuń</button>
                  </div></td>}
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={ui.columns.length + 1} className="muted">Brak pozycji.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {edit && <EditDialog ui={ui} row={edit === "new" ? null : edit} refs={refs} onClose={() => setEdit(null)}
        onSaved={t => { setEdit(null); setMsg({ kind: "ok", text: t }); void qc.invalidateQueries({ queryKey: ["catalog"] }); }} />}
    </>
  );
}

/** Listy powiązanych kartotek (firmy, kierowcy, operatorzy, magazyny) — do pól wyboru i nazw w tabeli. */
function useRefs(ui: KindUi) {
  const need = new Set(ui.fields.filter((f): f is Extract<FieldDef, { type: "ref" }> => f.type === "ref").map(f => f.ref));
  const companies = useRows("external-companies", need.has("external-companies"));
  const drivers = useRows("drivers", need.has("drivers"));
  const operators = useRows("operators", need.has("operators"));
  const wh = useWarehouses();
  const lists: Record<string, Array<{ id: string; label: string; active: boolean }>> = useMemo(() => ({
    "external-companies": (companies.data ?? []).map(r => ({ id: r.id, label: String(r.name), active: r.active !== false })),
    drivers: (drivers.data ?? []).map(r => ({ id: r.id, label: String(r.name), active: r.active !== false })),
    operators: (operators.data ?? []).map(r => ({ id: r.id, label: String(r.name), active: r.active !== false })),
    warehouses: (wh.data ?? []).map(w => ({ id: w.id, label: w.name, active: w.active })),
  }), [companies.data, drivers.data, operators.data, wh.data]);
  const name = (k: Kind | "warehouses", id: unknown) => lists[k]?.find(x => x.id === id)?.label ?? "—";
  return { lists, name };
}

/** Formularz dodania / edycji — pola z opisu kartoteki; błędy serwera przy polach; kontrola wersji. */
function EditDialog({ ui, row, refs, onClose, onSaved }: { ui: KindUi; row: Row | null; refs: ReturnType<typeof useRefs>; onClose: () => void; onSaved: (t: string) => void }) {
  const { user } = useSession();
  // zasób wspólny dla wszystkich magazynów dodaje administrator; kierownik — w swoim magazynie (domyślnym)
  const shared = !!user?.role.global;
  const [f, setF] = useState<Record<string, unknown>>(() => ({ ...ui.defaults, ...(!row && !shared && ui.fields.some(x => x.key === "warehouseId") ? { warehouseId: user?.defaultWarehouseId ?? user?.warehouseIds[0] ?? null } : {}), ...(row ?? {}) }));
  const [err, setErr] = useState<Error | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      for (const fd of ui.fields) if (!("when" in fd && fd.when && !fd.when(f))) body[fd.key] = f[fd.key] === "" ? null : f[fd.key];
      return row ? api.patch(`/catalog/${ui.kind}/${row.id}`, { ...body, version: row.version }) : api.post(`/catalog/${ui.kind}`, body);
    },
    onSuccess: () => onSaved(row ? "Zapisano zmiany." : `Dodano ${ui.single}.`),
    onError: e => setErr(e as Error),
  });
  const fe = (k: string) => (err instanceof ApiRequestError ? err.field(k) : undefined);
  const set = (k: string, v: unknown) => setF(s => ({ ...s, [k]: v }));
  return (
    <Dialog title={row ? `Edycja — ${ui.label(row)}` : `Nowy rekord — ${ui.title}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary" id="cat-save" disabled={save.isPending} onClick={() => { setErr(null); save.mutate(); }}>{save.isPending ? "Zapisywanie…" : "Zapisz"}</button></>}>
      {err && <Alert kind="err">{errorText(err)}</Alert>}
      <div className="grid2">
        {ui.fields.filter(fd => !("when" in fd && fd.when && !fd.when(f))).map(fd => {
          const id = `cf-${fd.key}`, e = fe(fd.key);
          const label = <label htmlFor={id}>{fd.label}{"required" in fd && fd.required && <span className="req" aria-hidden="true"> *</span>}</label>;
          const hint = "hint" in fd && fd.hint ? <small className="hint">{fd.hint}</small> : null;
          const error = e ? <small className="error" role="alert">{e}</small> : null;
          if (fd.type === "bool") return <div key={fd.key} className="field"><label className="check"><input id={id} type="checkbox" checked={f[fd.key] !== false} onChange={x => set(fd.key, x.target.checked)} /> {fd.label}</label>{error}</div>;
          if (fd.type === "units") return (
            <fieldset key={fd.key} className="field"><legend>{fd.label}</legend><div className="checks">
              {(["M3", "MP", "T"] as const).map(u => { const cur = (f.allowedUnits as string[] | undefined) ?? []; return <label key={u} className="check"><input type="checkbox" checked={cur.includes(u) || f.stockUnit === u} disabled={f.stockUnit === u} onChange={x => set("allowedUnits", x.target.checked ? [...cur, u] : cur.filter(c => c !== u))} /> {UNIT_LABEL[u]}</label>; })}
            </div>{error}</fieldset>);
          if (fd.type === "select") return <div key={fd.key} className="field">{label}<select id={id} className="ctrl" value={String(f[fd.key] ?? "")} aria-invalid={!!e} onChange={x => set(fd.key, x.target.value)}>
            {!fd.required && <option value="">—</option>}{fd.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>{hint}{error}</div>;
          if (fd.type === "ref") return <div key={fd.key} className="field">{label}<select id={id} className="ctrl" value={String(f[fd.key] ?? "")} aria-invalid={!!e} onChange={x => set(fd.key, x.target.value || null)}>
            {(fd.ref !== "warehouses" || shared || !f[fd.key]) && <option value="">{fd.empty}</option>}{(refs.lists[fd.ref] ?? []).filter(o => o.active || o.id === f[fd.key]).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>{hint}{error}</div>;
          if (fd.type === "tags") return <div key={fd.key} className="field">{label}<input id={id} className="ctrl" value={((f[fd.key] as string[] | undefined) ?? []).join(", ")} onChange={x => set(fd.key, x.target.value.split(",").map(s => s.trim()).filter(Boolean))} />{hint}{error}</div>;
          return <div key={fd.key} className="field">{label}<input id={id} className="ctrl" inputMode={fd.type === "decimal" ? "decimal" : undefined} value={String(f[fd.key] ?? "").replace(fd.type === "decimal" ? "." : "\u0000", ",")} aria-invalid={!!e}
            maxLength={fd.type === "text" ? fd.max : 30} onChange={x => set(fd.key, fd.type === "text" && fd.upper ? x.target.value.toUpperCase() : x.target.value)} />{hint}{error}</div>;
        })}
      </div>
      {row && ui.activeField === "status" && <p className="muted small">Status: {statusLabel(row.status)}. Zasobu użytego w operacjach nie usuwa się — ustaw „Wycofany”.</p>}
    </Dialog>
  );
}
