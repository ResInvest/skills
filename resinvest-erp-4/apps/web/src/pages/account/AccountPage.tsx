import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorText } from "../../api/client";
import type { SessionRow, Warehouse } from "../../api/types";
import { ME_KEY, useSession } from "../../auth/session";
import { Alert, Field, fmtDateTime, uaLabel } from "../../ui/components";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { NotificationSettings } from "../notifications/NotificationSettings";
import { InstallApp } from "../../app/pwa";
import { AppearanceSettings } from "./AppearanceSettings";
import { t, tm } from "../../i18n";

export const useWarehouses = () => useQuery({ queryKey: ["warehouses"], queryFn: async ({ signal }) => (await api.get<{ warehouses: Warehouse[] }>("/warehouses", signal)).warehouses, staleTime: 60_000 });

/** Tabela sesji — wspólna dla „Moje konto” i karty użytkownika. */
export function SessionsTable({ sessions, onRevoke, busyId }: { sessions: SessionRow[]; onRevoke?: (s: SessionRow) => void; busyId?: string | null }) {
  if (!sessions.length) return <p className="muted">{t("Brak aktywnych sesji.")}</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>{t("Urządzenie")}</th><th>{t("Adres IP")}</th><th>{t("Ostatnia aktywność")}</th><th>{t("Wygasa")}</th>{onRevoke && <th><span className="sr-only">{t("Akcje")}</span></th>}</tr></thead>
        <tbody>
          {sessions.map(s => (
            <tr key={s.id}>
              <td data-label={t("Urządzenie")}>{uaLabel(s.userAgent)}{s.current && <span className="badge ok">{t("ta sesja")}</span>}</td>
              <td data-label={t("Adres IP")}>{s.ip ?? "—"}</td>
              <td data-label={t("Aktywność")}>{fmtDateTime(s.lastSeenAt)}</td>
              <td data-label={t("Wygasa")}>{fmtDateTime(s.expiresAt)}</td>
              {onRevoke && <td>{!s.current && <button type="button" className="btn sm danger" disabled={busyId === s.id} onClick={() => onRevoke(s)}>{t("Wyloguj")}</button>}</td>}
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
    onSuccess: async () => { setMsg({ kind: "ok", text: t("Zapisano magazyn domyślny.") }); await qc.invalidateQueries({ queryKey: ME_KEY }); },
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
      <h1>{t("Moje konto")}</h1>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <section className="card" aria-labelledby="p-h">
        <header className="card-h"><h2 id="p-h">{t("Profil")}</h2></header>
        <dl className="kv">
          <dt>{t("Imię i nazwisko")}</dt><dd>{user.firstName} {user.lastName}</dd>
          <dt>{t("E-mail")}</dt><dd>{user.email}</dd>
          <dt>{t("Rola")}</dt><dd>{tm(user.role.name)}</dd>
          <dt>{t("Uprawnienia")}</dt><dd className="small">{user.permissions.length ? user.permissions.join(", ") : "—"}</dd>
        </dl>
        <p className="muted small">{t("Imię, nazwisko, rolę i magazyny zmienia administrator.")}</p>
      </section>
      <section className="card" aria-labelledby="ap-h" id="appearance">
        <header className="card-h"><h2 id="ap-h">{t("Wygląd i język")}</h2></header>
        <AppearanceSettings />
      </section>
      <section className="card" aria-labelledby="w-h">
        <header className="card-h"><h2 id="w-h">{t("Magazyn domyślny")}</h2></header>
        {wh.data && wh.data.length > 0 ? (
          <Field label={t("Magazyn otwierany po zalogowaniu")}>{(id, d) => (
            <select id={id} className="ctrl" aria-describedby={d} value={user.defaultWarehouseId ?? ""} disabled={setDefault.isPending} onChange={e => { setMsg(null); setDefault.mutate(e.target.value); }}>
              {!user.defaultWarehouseId && <option value="">{t("— wybierz —")}</option>}
              {wh.data.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}</Field>
        ) : <p className="muted">{t("Brak przydzielonych magazynów.")}</p>}
      </section>
      <section className="card" aria-labelledby="nt-h">
        <header className="card-h"><h2 id="nt-h">{t("Powiadomienia e-mail")}</h2></header>
        <p className="muted small">{t("Na adres {email}. Zdarzenie możesz włączyć, gdy administrator wyrazi na nie zgodę.", { email: user.email })}</p>
        <NotificationSettings mode="own" />
      </section>
      <section className="card" aria-labelledby="app-h">
        <header className="card-h"><h2 id="app-h">{t("Aplikacja na telefon i komputer")}</h2></header>
        <InstallApp />
      </section>
      <section className="card" aria-labelledby="pw-h">
        <header className="card-h"><h2 id="pw-h">{t("Zmiana hasła")}</h2></header>
        <ChangePasswordForm />
      </section>
      <section className="card" aria-labelledby="s-h">
        <header className="card-h"><h2 id="s-h">{t("Aktywne sesje")}</h2></header>
        <p className="muted small">{t("Jeśli nie rozpoznajesz urządzenia — wyloguj je i zmień hasło.")}</p>
        {sessions.isPending ? <p className="muted">{t("Wczytywanie…")}</p> : sessions.isError ? <Alert kind="err">{errorText(sessions.error)}</Alert> :
          <SessionsTable sessions={sessions.data} busyId={revoke.isPending ? revoke.variables : null} onRevoke={s => revoke.mutate(s.id)} />}
      </section>
    </>
  );
}
