import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError, errorText } from "../../api/client";
import { STATUS_LABEL, type UserRow, type UserStatus } from "../../api/types";
import { useSession } from "../../auth/session";
import { Alert, Dialog, Field, fmtDateTime, StatusBadge, TextInput } from "../../ui/components";
import { useWarehouses } from "../account/AccountPage";
import { assignableRoles, useRoles, WarehousePicker } from "./UserForm";

export const USERS_KEY = ["users"] as const;
export const useUsers = () => useQuery({ queryKey: USERS_KEY, queryFn: async ({ signal }) => (await api.get<{ users: UserRow[] }>("/users", signal)).users });

export function UsersPage() {
  const { can } = useSession();
  const users = useUsers();
  const wh = useWarehouses();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<UserStatus | "">("");
  const [whF, setWhF] = useState("");
  const [inviting, setInviting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const whName = useMemo(() => new Map((wh.data ?? []).map(w => [w.id, w.name])), [wh.data]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (users.data ?? []).filter(u =>
      (!t || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(t)) && (!status || u.status === status) && (!whF || u.warehouseIds.includes(whF)));
  }, [users.data, q, status, whF]);
  const pending = (users.data ?? []).filter(u => u.selfRegistered && u.status === "INVITED").length;

  return (
    <>
      <div className="page-h">
        <h1>Użytkownicy</h1>
        {can("users.manage") && <button type="button" className="btn primary" onClick={() => setInviting(true)}>Zaproś użytkownika</button>}
      </div>
      {info && <Alert kind="ok">{info}</Alert>}
      {pending > 0 && <Alert kind="warn">Zgłoszenia rejestracji oczekujące na decyzję: <strong>{pending}</strong> (status „zaproszony”, oznaczenie „rejestracja”).</Alert>}
      <div className="filters" role="search">
        <input className="ctrl" type="search" placeholder="Szukaj: imię, nazwisko, e-mail" aria-label="Szukaj użytkownika" value={q} onChange={e => setQ(e.target.value)} />
        <select className="ctrl" aria-label="Status" value={status} onChange={e => setStatus(e.target.value as UserStatus | "")}>
          <option value="">Wszystkie statusy</option>
          {(Object.keys(STATUS_LABEL) as UserStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="ctrl" aria-label="Magazyn" value={whF} onChange={e => setWhF(e.target.value)}>
          <option value="">Wszystkie magazyny</option>
          {wh.data?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      {users.isPending ? <p className="muted">Wczytywanie…</p> : users.isError ? <Alert kind="err">{errorText(users.error)}</Alert> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Lista użytkowników</caption>
            <thead><tr><th>Użytkownik</th><th>Rola</th><th>Status</th><th>Magazyny</th><th>Ostatnie logowanie</th></tr></thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id}>
                  <td data-label="Użytkownik"><Link to={`/uzytkownicy/${u.id}`}><strong>{u.lastName} {u.firstName}</strong></Link><br /><small className="muted">{u.email}</small></td>
                  <td data-label="Rola">{u.role.name}</td>
                  <td data-label="Status"><StatusBadge status={u.status} locked={u.locked} />{u.selfRegistered && <span className="badge info">rejestracja</span>}{u.mustChangePassword && <span className="badge warn">zmiana hasła</span>}</td>
                  <td data-label="Magazyny">{u.role.global ? <em>wszystkie</em> : u.warehouseIds.map(id => whName.get(id) ?? "(inny)").join(", ") || "—"}</td>
                  <td data-label="Logowanie">{fmtDateTime(u.lastLoginAt)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="muted">Brak użytkowników spełniających kryteria.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {inviting && <InviteDialog onClose={() => setInviting(false)} onDone={email => { setInviting(false); setInfo(`Wysłano zaproszenie do ${email}.`); }} />}
    </>
  );
}

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: (email: string) => void }) {
  const session = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const roles = useRoles();
  const wh = useWarehouses();
  const options = assignableRoles(roles.data ?? [], session);
  const [f, setF] = useState({ email: "", firstName: "", lastName: "", roleCode: "" });
  const [whs, setWhs] = useState<string[]>([]);
  const [def, setDef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiRequestError | null>(null);
  const role = roles.data?.find(r => r.code === (f.roleCode || options[0]?.code));

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api.post<{ user: UserRow }>("/users", { ...f, email: f.email.trim(), roleCode: role?.code ?? "", warehouseIds: role?.global ? [] : whs, defaultWarehouseId: role?.global ? null : def });
      await qc.invalidateQueries({ queryKey: USERS_KEY });
      onDone(r.user.email);
      void nav(`/uzytkownicy/${r.user.id}`);
    } catch (x) { setErr(x instanceof ApiRequestError ? x : new ApiRequestError(0, null)); }
    finally { setBusy(false); }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }));
  return (
    <Dialog title="Zaproś użytkownika" onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Anuluj</button>
      <button type="submit" form="invite-f" className="btn primary" disabled={busy}>{busy ? "Wysyłanie…" : "Wyślij zaproszenie"}</button>
    </>}>
      <form id="invite-f" onSubmit={e => void submit(e)} className="form">
        {err && !err.body?.details && <Alert kind="err">{err.message}</Alert>}
        <TextInput label="Firmowy e-mail" type="email" value={f.email} onChange={set("email")} error={err?.field("email")} required />
        <div className="grid2">
          <TextInput label="Imię" value={f.firstName} onChange={set("firstName")} error={err?.field("firstName")} required />
          <TextInput label="Nazwisko" value={f.lastName} onChange={set("lastName")} error={err?.field("lastName")} required />
        </div>
        <Field label="Rola" required hint={role?.description ?? undefined}>{(id, d) => (
          <select id={id} className="ctrl" aria-describedby={d} value={role?.code ?? ""} onChange={set("roleCode")}>
            {options.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
          </select>
        )}</Field>
        {role && !role.global && wh.data && <WarehousePicker warehouses={wh.data} value={whs} onChange={setWhs} def={def} onDefault={setDef} error={err?.code === "WAREHOUSE" ? err.message : undefined} />}
        {role?.global && <p className="muted small">Rola globalna — dostęp do wszystkich magazynów.</p>}
        <p className="muted small">Użytkownik otrzyma e-mail z linkiem aktywacyjnym i sam ustawi hasło.</p>
      </form>
    </Dialog>
  );
}
