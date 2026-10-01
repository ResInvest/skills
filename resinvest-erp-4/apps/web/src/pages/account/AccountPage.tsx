import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorText } from "../../api/client";
import type { SessionRow, Warehouse } from "../../api/types";
import { ME_KEY, useSession } from "../../auth/session";
import { Alert, Field, fmtDateTime, uaLabel } from "../../ui/components";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { NotificationSettings } from "../notifications/NotificationSettings";

export const useWarehouses = () => useQuery({ queryKey: ["warehouses"], queryFn: async ({ signal }) => (await api.get<{ warehouses: Warehouse[] }>("/warehouses", signal)).warehouses, staleTime: 60_000 });

/** Tabela sesji — wspólna dla „Moje konto” i karty użytkownika. */
export function SessionsTable({ sessions, onRevoke, busyId }: { sessions: SessionRow[]; onRevoke?: (s: SessionRow) => void; busyId?: string | null }) {
  if (!sessions.length) return <p className="muted">Brak aktywnych sesji.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Urządzenie</th><th>Adres IP</th><th>Ostatnia aktywność</th><th>Wygasa</th>{onRevoke && <th><span className="sr-only">Akcje</span></th>}</tr></thead>
        <tbody>
          {sessions.map(s => (
            <tr key={s.id}>
              <td data-label="Urządzenie">{uaLabel(s.userAgent)}{s.current && <span className="badge ok">ta sesja</span>}</td>
              <td data-label="Adres IP">{s.ip ?? "—"}</td>
              <td data-label="Aktywność">{fmtDateTime(s.lastSeenAt)}</td>
              <td data-label="Wygasa">{fmtDateTime(s.expiresAt)}</td>
              {onRevoke && <td>{!s.current && <button type="button" className="btn sm danger" disabled={busyId === s.id} onClick={() => onRevoke(s)}>Wyloguj</button>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AccountPage() {
  const { user } = useSession();
  const qc = useQueryClient();
  const wh = useWarehouses();
  const sessions = useQuery({ queryKey: ["auth", "sessions"], queryFn: async ({ signal }) => (await api.get<{ sessions: SessionRow[] }>("/auth/sessions", signal)).sessions });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const setDefault = useMutation({
    mutationFn: (warehouseId: string) => api.post("/auth/me/default-warehouse", { warehouseId }),
    onSuccess: async () => { setMsg({ kind: "ok", text: "Zapisano magazyn domyślny." }); await qc.invalidateQueries({ queryKey: ME_KEY }); },
    onError: e => setMsg({ kind: "err", text: errorText(e) }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/auth/sessions/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["auth", "sessions"] }),
    onError: e => setMsg({ kind: "err", text: errorText(e) }),
  });
  if (!user) return null;
  return (
    <>
      <h1>Moje konto</h1>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <section className="card" aria-labelledby="p-h">
        <header className="card-h"><h2 id="p-h">Profil</h2></header>
        <dl className="kv">
          <dt>Imię i nazwisko</dt><dd>{user.firstName} {user.lastName}</dd>
          <dt>E-mail</dt><dd>{user.email}</dd>
          <dt>Rola</dt><dd>{user.role.name}</dd>
          <dt>Uprawnienia</dt><dd className="small">{user.permissions.length ? user.permissions.join(", ") : "—"}</dd>
        </dl>
        <p className="muted small">Imię, nazwisko, rolę i magazyny zmienia administrator.</p>
      </section>
      <section className="card" aria-labelledby="w-h">
        <header className="card-h"><h2 id="w-h">Magazyn domyślny</h2></header>
        {wh.data && wh.data.length > 0 ? (
          <Field label="Magazyn otwierany po zalogowaniu">{(id, d) => (
            <select id={id} className="ctrl" aria-describedby={d} value={user.defaultWarehouseId ?? ""} disabled={setDefault.isPending} onChange={e => { setMsg(null); setDefault.mutate(e.target.value); }}>
              {!user.defaultWarehouseId && <option value="">— wybierz —</option>}
              {wh.data.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}</Field>
        ) : <p className="muted">Brak przydzielonych magazynów.</p>}
      </section>
      <section className="card" aria-labelledby="nt-h">
        <header className="card-h"><h2 id="nt-h">Powiadomienia e-mail</h2></header>
        <p className="muted small">Na adres {user.email}. Zdarzenie możesz włączyć, gdy administrator wyrazi na nie zgodę.</p>
        <NotificationSettings mode="own" />
      </section>
      <section className="card" aria-labelledby="pw-h">
        <header className="card-h"><h2 id="pw-h">Zmiana hasła</h2></header>
        <ChangePasswordForm />
      </section>
      <section className="card" aria-labelledby="s-h">
        <header className="card-h"><h2 id="s-h">Aktywne sesje</h2></header>
        <p className="muted small">Jeśli nie rozpoznajesz urządzenia — wyloguj je i zmień hasło.</p>
        {sessions.isPending ? <p className="muted">Wczytywanie…</p> : sessions.isError ? <Alert kind="err">{errorText(sessions.error)}</Alert> :
          <SessionsTable sessions={sessions.data} busyId={revoke.isPending ? revoke.variables : null} onRevoke={s => revoke.mutate(s.id)} />}
      </section>
    </>
  );
}
