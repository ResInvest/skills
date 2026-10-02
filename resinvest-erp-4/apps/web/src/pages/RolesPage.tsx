import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorText } from "../api/client";
import type { Permission, Role } from "../api/types";
import { useSession } from "../auth/session";
import { Alert } from "../ui/components";
import { useRoles } from "./users/UserForm";
import { t, tm } from "../i18n";

/** Macierz uprawnień ról. Edycja (roles.assign): bez roli ADMINISTRATOR i bez własnej roli — tak samo jak na serwerze. */
export function RolesPage() {
  const { user, can } = useSession();
  const qc = useQueryClient();
  const roles = useRoles();
  const perms = useQuery({ queryKey: ["permissions"], queryFn: async ({ signal }) => (await api.get<{ permissions: Permission[] }>("/permissions", signal)).permissions, staleTime: 300_000 });
  const [editing, setEditing] = useState<Role | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, Permission[]>();
    for (const p of perms.data ?? []) m.set(p.group, [...(m.get(p.group) ?? []), p]);
    return [...m];
  }, [perms.data]);

  if (roles.isPending || perms.isPending) return <p className="muted">{t("Wczytywanie…")}</p>;
  if (roles.isError || perms.isError) return <Alert kind="err">{errorText(roles.error ?? perms.error)}</Alert>;

  const editable = (r: Role) => can("roles.assign") && r.code !== "ADMINISTRATOR" && r.code !== user?.role.code;
  const start = (r: Role) => { setMsg(null); setEditing(r); setSel(new Set(r.permissions)); };
  const toggle = (p: string) => setSel(s => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api.put(`/roles/${editing.code}/permissions`, { version: editing.version, permissions: [...sel] });
      setMsg({ kind: "ok", text: t("Zapisano uprawnienia roli {role}. Zmiana obowiązuje od następnego żądania użytkowników.", { role: tm(editing.name) }) });
      setEditing(null);
    } catch (e) { setMsg({ kind: "err", text: errorText(e) }); }
    finally { setBusy(false); await qc.invalidateQueries({ queryKey: ["roles"] }); }
  };
  const has = (r: Role, p: string) => (editing?.code === r.code ? sel.has(p) : r.permissions.includes(p));

  return (
    <>
      <div className="page-h">
        <h1>{t("Role i uprawnienia")}</h1>
        {editing && <div className="actions">
          <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>{t("Anuluj")}</button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? t("Zapisywanie…") : t("Zapisz: {role}", { role: tm(editing.name) })}</button>
        </div>}
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="role-cards">
        {roles.data.map(r => (
          <article key={r.code} className={`card role ${editing?.code === r.code ? "sel" : ""}`}>
            <header className="card-h"><h2>{tm(r.name)}</h2>{r.global && <span className="badge info">{t("wszystkie magazyny")}</span>}</header>
            <p className="muted small">{r.description ? tm(r.description) : ""}</p>
            <p className="small">{t("Użytkownicy: {n} · uprawnienia: {p}", { n: r.users, p: r.permissions.length })}</p>
            {editable(r) && editing?.code !== r.code && <button type="button" className="btn sm" onClick={() => start(r)} disabled={!!editing}>{t("Edytuj uprawnienia")}</button>}
          </article>
        ))}
      </div>
      <div className="table-wrap matrix">
        <table className="table">
          <caption className="sr-only">{t("Macierz uprawnień")}</caption>
          <thead><tr><th scope="col">{t("Uprawnienie")}</th>{roles.data.map(r => <th key={r.code} scope="col" className="c">{tm(r.name)}</th>)}</tr></thead>
          {groups.map(([g, list]) => (
            <tbody key={g}>
              <tr className="grp"><th colSpan={roles.data.length + 1} scope="colgroup">{tm(g)}</th></tr>
              {list.map(p => (
                <tr key={p.code}>
                  <th scope="row"><span>{tm(p.description)}</span><br /><code className="muted small">{p.code}</code></th>
                  {roles.data.map(r => (
                    <td key={r.code} className="c">
                      {editing?.code === r.code
                        ? <input type="checkbox" checked={sel.has(p.code)} onChange={() => toggle(p.code)} aria-label={`${tm(r.name)}: ${tm(p.description)}`} />
                        : has(r, p.code) ? <span aria-label={t("tak")} className="yes">✓</span> : <span aria-label={t("nie")} className="muted">·</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </>
  );
}
