import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError, errorText } from "../../api/client";
import type { SessionRow, UserRow } from "../../api/types";
import { useSession } from "../../auth/session";
import { Alert, Dialog, Field, fmtDateTime, StatusBadge, TextInput } from "../../ui/components";
import { SessionsTable, useWarehouses } from "../account/AccountPage";
import { assignableRoles, useRoles, WarehousePicker } from "./UserForm";
import { USERS_KEY } from "./UsersPage";

type Draft = Pick<UserRow, "firstName" | "lastName" | "warehouseIds" | "defaultWarehouseId"> & { roleCode: string; status: UserRow["status"] };
const draftOf = (u: UserRow): Draft => ({ firstName: u.firstName, lastName: u.lastName, roleCode: u.role.code, warehouseIds: u.warehouseIds, defaultWarehouseId: u.defaultWarehouseId, status: u.status });

/** Działania administracyjne na koncie (każde z potwierdzeniem; audyt po stronie serwera). */
const ACTIONS = {
  "resend-invite": { label: "Wyślij zaproszenie ponownie", confirm: "Poprzedni link aktywacyjny przestanie działać.", done: "Wysłano nowe zaproszenie." },
  "reset-link": { label: "Wyślij link resetu hasła", confirm: "Użytkownik otrzyma e-mail z linkiem do ustawienia nowego hasła.", done: "Wysłano link resetu hasła." },
  "force-password-change": { label: "Wymuś zmianę hasła", confirm: "Przy następnym żądaniu użytkownik będzie musiał ustawić nowe hasło.", done: "Wymuszono zmianę hasła." },
  unlock: { label: "Odblokuj logowanie", confirm: "Licznik nieudanych prób zostanie wyzerowany.", done: "Konto odblokowane." },
  "revoke-sessions": { label: "Wyloguj ze wszystkich urządzeń", confirm: "Wszystkie aktywne sesje użytkownika zostaną zakończone.", done: "Sesje zakończone." },
} as const;
type ActionKey = keyof typeof ACTIONS;

export function UserDetailPage() {
  const { id = "" } = useParams();
  const session = useSession();
  const qc = useQueryClient();
  const key = ["users", id];
  // karta edycji zawsze z aktualnych danych (wersja rekordu — blokada optymistyczna)
  const q = useQuery({ queryKey: key, queryFn: async ({ signal }) => (await api.get<{ user: UserRow }>(`/users/${id}`, signal)).user, staleTime: 0, refetchOnMount: "always" });
  const manage = session.can("users.manage");
  const sessions = useQuery({ queryKey: [...key, "sessions"], enabled: manage, queryFn: async ({ signal }) => (await api.get<{ sessions: SessionRow[] }>(`/users/${id}/sessions`, signal)).sessions });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ActionKey | null>(null);

  const action = useMutation({
    mutationFn: (a: ActionKey) => (a === "revoke-sessions" ? api.del(`/users/${id}/sessions`) : api.post(`/users/${id}/${a}`)),
    onSuccess: (_d, a) => setMsg({ kind: "ok", text: ACTIONS[a].done }),
    onError: e => setMsg({ kind: "err", text: errorText(e) }),
    onSettled: async () => { setConfirm(null); await qc.invalidateQueries({ queryKey: key }); await qc.invalidateQueries({ queryKey: USERS_KEY }); },
  });

  if (q.isPending) return <p className="muted">Wczytywanie…</p>;
  if (q.isError) return <><Alert kind="err">{errorText(q.error)}</Alert><Link to="/uzytkownicy">← Lista użytkowników</Link></>;
  const u = q.data;
  const self = u.id === session.user?.id;
  const available: ActionKey[] = [
    ...(u.status === "INVITED" ? ["resend-invite" as const] : []),
    ...(u.status === "ACTIVE" ? ["reset-link" as const, "force-password-change" as const] : []),
    ...(u.locked ? ["unlock" as const] : []),
    "revoke-sessions",
  ];
  return (
    <>
      <p><Link to="/uzytkownicy">← Lista użytkowników</Link></p>
      <div className="page-h">
        <h1>{u.firstName} {u.lastName}</h1>
        <div><StatusBadge status={u.status} locked={u.locked} />{u.selfRegistered && <span className="badge info">rejestracja</span>}{u.mustChangePassword && <span className="badge warn">zmiana hasła</span>}</div>
      </div>
      <p className="muted">{u.email} · utworzono {fmtDateTime(u.createdAt)} · ostatnie logowanie {fmtDateTime(u.lastLoginAt)}</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {manage ? !q.isFetchedAfterMount ? <p className="muted">Pobieranie aktualnych danych…</p> : <EditForm key={u.version} user={u} self={self} onMessage={(kind, text) => setMsg({ kind, text })} /> : (
        <section className="card"><dl className="kv"><dt>Rola</dt><dd>{u.role.name}</dd></dl></section>
      )}
      {manage && !self && (
        <section className="card" aria-labelledby="a-h">
          <header className="card-h"><h2 id="a-h">Działania</h2></header>
          <div className="actions">{available.map(a => <button key={a} type="button" className={`btn ${a === "revoke-sessions" ? "danger" : ""}`} onClick={() => { setMsg(null); setConfirm(a); }}>{ACTIONS[a].label}</button>)}</div>
        </section>
      )}
      {manage && (
        <section className="card" aria-labelledby="s-h">
          <header className="card-h"><h2 id="s-h">Aktywne sesje</h2></header>
          {sessions.isPending ? <p className="muted">Wczytywanie…</p> : sessions.isError ? <Alert kind="err">{errorText(sessions.error)}</Alert> : <SessionsTable sessions={sessions.data} />}
        </section>
      )}
      {confirm && (
        <Dialog title={ACTIONS[confirm].label} onClose={() => setConfirm(null)} footer={<>
          <button type="button" className="btn" onClick={() => setConfirm(null)}>Anuluj</button>
          <button type="button" className="btn primary" disabled={action.isPending} onClick={() => action.mutate(confirm)}>{action.isPending ? "Wykonywanie…" : "Potwierdź"}</button>
        </>}>
          <p>{ACTIONS[confirm].confirm}</p><p className="muted small">{u.email}</p>
        </Dialog>
      )}
    </>
  );
}

function EditForm({ user, self, onMessage }: { user: UserRow; self: boolean; onMessage: (kind: "ok" | "err", text: string) => void }) {
  const session = useSession();
  const qc = useQueryClient();
  const roles = useRoles();
  const wh = useWarehouses();
  const [d, setD] = useState<Draft>(() => draftOf(user));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiRequestError | null>(null);
  const role = roles.data?.find(r => r.code === d.roleCode);
  const options = assignableRoles(roles.data ?? [], session, user.role.code);
  const canRole = !self && (session.can("roles.assign") || user.role.code !== "ADMINISTRATOR");
  const statusOpts: Draft["status"][] = user.status === "INVITED" ? ["INVITED"] : ["ACTIVE", "SUSPENDED", "DISABLED"];

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const o = draftOf(user);
    // wysyłamy tylko zmienione pola (serwer i tak weryfikuje uprawnienia i wersję)
    const body: Record<string, unknown> = { version: user.version };
    if (d.firstName !== o.firstName) body.firstName = d.firstName;
    if (d.lastName !== o.lastName) body.lastName = d.lastName;
    if (d.roleCode !== o.roleCode) body.roleCode = d.roleCode;
    const whs = role?.global ? [] : d.warehouseIds;
    if (JSON.stringify([...whs].sort()) !== JSON.stringify([...o.warehouseIds].sort()) || d.roleCode !== o.roleCode) body.warehouseIds = whs;
    if ((role?.global ? null : d.defaultWarehouseId) !== o.defaultWarehouseId) body.defaultWarehouseId = role?.global ? null : d.defaultWarehouseId;
    if (d.status !== o.status && d.status !== "INVITED") body.status = d.status;
    if (Object.keys(body).length === 1) { setBusy(false); onMessage("ok", "Brak zmian do zapisania."); return; }
    try {
      const r = await api.patch<{ user: UserRow }>(`/users/${user.id}`, body);
      qc.setQueryData(["users", user.id], r.user);
      await qc.invalidateQueries({ queryKey: USERS_KEY, exact: true });
      onMessage("ok", "Zapisano zmiany.");
    } catch (x) {
      const ae = x instanceof ApiRequestError ? x : new ApiRequestError(0, null);
      if (ae.code === "VERSION") {
        // ktoś zmienił konto w międzyczasie: komunikat na karcie (formularz zostanie odświeżony nowymi danymi)
        onMessage("err", `${ae.message} Formularz pokazuje aktualne dane — wprowadź zmiany ponownie.`);
        await qc.invalidateQueries({ queryKey: ["users", user.id] });
      } else setErr(ae);
    } finally { setBusy(false); }
  };
  const set = (k: "firstName" | "lastName" | "roleCode" | "status") => (e: { target: { value: string } }) => setD(s => ({ ...s, [k]: e.target.value }));

  return (
    <section className="card" aria-labelledby="e-h">
      <header className="card-h"><h2 id="e-h">Dane konta</h2></header>
      <form onSubmit={e => void submit(e)} className="form">
        {err && !err.body?.details && <Alert kind="err"><strong>{err.message}</strong>{err.code === "LAST_ADMIN" && <span>W systemie musi pozostać co najmniej jeden aktywny administrator.</span>}</Alert>}
        {self && <Alert kind="info">To Twoje konto — rolę, status i magazyny zmienia inny administrator.</Alert>}
        <div className="grid2">
          <TextInput label="Imię" value={d.firstName} onChange={set("firstName")} error={err?.field("firstName")} required />
          <TextInput label="Nazwisko" value={d.lastName} onChange={set("lastName")} error={err?.field("lastName")} required />
        </div>
        <div className="grid2">
          <Field label="Rola" hint={role?.description ?? undefined}>{(id, h) => (
            <select id={id} className="ctrl" aria-describedby={h} value={d.roleCode} onChange={set("roleCode")} disabled={!canRole}>
              {options.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
          )}</Field>
          <Field label="Status">{(id, h) => (
            <select id={id} className="ctrl" aria-describedby={h} value={d.status} onChange={set("status")} disabled={self || user.status === "INVITED"}>
              {statusOpts.map(s => <option key={s} value={s}>{{ INVITED: "zaproszony (oczekuje na aktywację)", ACTIVE: "aktywny", SUSPENDED: "zawieszony", DISABLED: "wyłączony" }[s]}</option>)}
            </select>
          )}</Field>
        </div>
        {role && !role.global && wh.data && <WarehousePicker warehouses={wh.data} value={d.warehouseIds} onChange={ids => setD(s => ({ ...s, warehouseIds: ids }))}
          def={d.defaultWarehouseId} onDefault={v => setD(s => ({ ...s, defaultWarehouseId: v }))} disabled={self} error={err?.code === "WAREHOUSE" ? err.message : undefined} />}
        {role?.global && <p className="muted small">Rola globalna — dostęp do wszystkich magazynów.</p>}
        {d.status === "DISABLED" && user.status !== "DISABLED" && <Alert kind="warn">Wyłączenie kończy wszystkie sesje użytkownika. Konto i jego historia pozostają w systemie.</Alert>}
        <div className="actions"><button className="btn primary" disabled={busy}>{busy ? "Zapisywanie…" : "Zapisz zmiany"}</button></div>
      </form>
    </section>
  );
}
