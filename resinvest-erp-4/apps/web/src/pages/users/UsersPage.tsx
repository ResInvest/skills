import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError, errorText } from "../../api/client";
import { STATUS_LABEL, type UserRow, type UserStatus } from "../../api/types";
import { useSession } from "../../auth/session";
import { Alert, Dialog, Field, fmtDateTime, StatusBadge, TextInput } from "../../ui/components";
import { useWarehouses } from "../account/AccountPage";
import { assignableRoles, useRoles, WarehousePicker } from "./UserForm";
import { t, tm } from "../../i18n";

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
    const needle = q.trim().toLowerCase();
    return (users.data ?? []).filter(u =>
      (!needle || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(needle)) && (!status || u.status === status) && (!whF || u.warehouseIds.includes(whF)));
  }, [users.data, q, status, whF]);
  const pending = (users.data ?? []).filter(u => u.selfRegistered && u.status === "INVITED").length;

  return (
    <>
      <div className="page-h">
        <h1>{t("Użytkownicy")}</h1>
        {can("users.manage") && <button type="button" className="btn primary" onClick={() => setInviting(true)}>{t("Zaproś użytkownika")}</button>}
      </div>
      {info && <Alert kind="ok">{info}</Alert>}
      {pending > 0 && <Alert kind="warn"><span>{t("Zgłoszenia rejestracji oczekujące na decyzję: {n} (status „zaproszony”, oznaczenie „rejestracja”).", { n: pending })}</span></Alert>}
      <div className="filters" role="search">
        <input className="ctrl" type="search" placeholder={t("Szukaj: imię, nazwisko, e-mail")} aria-label={t("Szukaj użytkownika")} value={q} onChange={e => setQ(e.target.value)} />
        <select className="ctrl" aria-label={t("Status")} value={status} onChange={e => setStatus(e.target.value as UserStatus | "")}>
          <option value="">{t("Wszystkie statusy")}</option>
          {(Object.keys(STATUS_LABEL) as UserStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="ctrl" aria-label={t("Magazyn")} value={whF} onChange={e => setWhF(e.target.value)}>
          <option value="">{t("Wszystkie magazyny")}</option>
          {wh.data?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      {users.isPending ? <p className="muted">{t("Wczytywanie…")}</p> : users.isError ? <Alert kind="err">{errorText(users.error)}</Alert> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">{t("Lista użytkowników")}</caption>
            <thead><tr><th>{t("Użytkownik")}</th><th>{t("Rola")}</th><th>{t("Status")}</th><th>{t("Magazyny")}</th><th>{t("Ostatnie logowanie")}</th></tr></thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id}>
                  <td data-label={t("Użytkownik")}><Link to={`/uzytkownicy/${u.id}`}><strong>{u.lastName} {u.firstName}</strong></Link><br /><small className="muted">{u.email}</small></td>
                  <td data-label={t("Rola")}>{tm(u.role.name)}</td>
                  <td data-label={t("Status")}><StatusBadge status={u.status} locked={u.locked} />{u.selfRegistered && <span className="badge info">{t("rejestracja")}</span>}{u.mustChangePassword && <span className="badge warn">{t("zmiana hasła")}</span>}</td>
                  <td data-label={t("Magazyny")}>{u.role.global ? <em>{t("wszystkie")}</em> : u.warehouseIds.map(id => whName.get(id) ?? t("(inny)")).join(", ") || "—"}</td>
                  <td data-label={t("Logowanie")}>{fmtDateTime(u.lastLoginAt)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="muted">{t("Brak użytkowników spełniających kryteria.")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {inviting && <InviteDialog onClose={() => setInviting(false)} onDone={email => { setInviting(false); setInfo(t("Wysłano zaproszenie do {email}.", { email })); }} />}
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
    <Dialog title={t("Zaproś użytkownika")} onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>{t("Anuluj")}</button>
      <button type="submit" form="invite-f" className="btn primary" disabled={busy}>{busy ? t("Wysyłanie…") : t("Wyślij zaproszenie")}</button>
    </>}>
      <form id="invite-f" onSubmit={e => void submit(e)} className="form">
        {err && !err.body?.details && <Alert kind="err">{err.message}</Alert>}
        <TextInput label={t("Firmowy e-mail")} type="email" value={f.email} onChange={set("email")} error={err?.field("email")} required />
        <div className="grid2">
          <TextInput label={t("Imię")} value={f.firstName} onChange={set("firstName")} error={err?.field("firstName")} required />
          <TextInput label={t("Nazwisko")} value={f.lastName} onChange={set("lastName")} error={err?.field("lastName")} required />
        </div>
        <Field label={t("Rola")} required hint={role?.description ? tm(role.description) : undefined}>{(id, d) => (
          <select id={id} className="ctrl" aria-describedby={d} value={role?.code ?? ""} onChange={set("roleCode")}>
            {options.map(r => <option key={r.code} value={r.code}>{tm(r.name)}</option>)}
          </select>
        )}</Field>
        {role && !role.global && wh.data && <WarehousePicker warehouses={wh.data} value={whs} onChange={setWhs} def={def} onDefault={setDef} error={err?.code === "WAREHOUSE" ? err.message : undefined} />}
        {role?.global && <p className="muted small">{t("Rola globalna — dostęp do wszystkich magazynów.")}</p>}
        <p className="muted small">{t("Użytkownik otrzyma e-mail z linkiem aktywacyjnym i sam ustawi hasło.")}</p>
      </form>
    </Dialog>
  );
}
