import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, errorText } from "../api/client";
import type { AuditRow, LoginRow } from "../api/types";
import { Alert, fmtDateTime, uaLabel } from "../ui/components";
import { useWarehouses } from "./account/AccountPage";

/** Czytelne nazwy zdarzeń audytu (kod pozostaje widoczny w podpowiedzi). */
export const ACTION_LABEL: Record<string, string> = {
  LOGIN: "Logowanie", LOGOUT: "Wylogowanie", ACCOUNT_LOCKED: "Blokada konta", PASSWORD_CHANGED: "Zmiana hasła", PASSWORD_RESET: "Reset hasła",
  PASSWORD_RESET_REQUESTED: "Prośba o reset hasła", PASSWORD_RESET_LINK_SENT: "Wysłano link resetu", PASSWORD_RESET_LINK_CLI: "Link resetu z konsoli serwera", INVITE_ACCEPTED: "Aktywacja konta", USER_INVITED: "Zaproszenie użytkownika",
  USER_INVITE_RESENT: "Ponowne zaproszenie", USER_SELF_REGISTERED: "Rejestracja", USER_UPDATED: "Zmiana danych użytkownika", ROLE_CHANGED: "Zmiana roli",
  WAREHOUSE_ACCESS_CHANGED: "Zmiana dostępu do magazynów", USER_STATUS_CHANGED: "Zmiana statusu", ACCOUNT_UNLOCKED: "Odblokowanie konta",
  FORCE_PASSWORD_CHANGE: "Wymuszenie zmiany hasła", SESSION_REVOKED: "Zakończenie sesji", SESSIONS_REVOKED: "Zakończenie sesji użytkownika",
  ROLE_PERMISSIONS_CHANGED: "Zmiana uprawnień roli", DEFAULT_WAREHOUSE_CHANGED: "Zmiana magazynu domyślnego", ADMIN_BOOTSTRAP: "Utworzenie pierwszego administratora",
  OPENING_BALANCE_CREATED: "Bilans otwarcia — szkic", OPENING_BALANCE_UPDATED: "Bilans otwarcia — zmiana szkicu", OPENING_BALANCE_DRAFT_DELETED: "Bilans otwarcia — usunięcie szkicu", OPENING_BALANCE_APPROVED: "Bilans otwarcia — zatwierdzenie",
};
const LOGIN_REASON: Record<string, string> = { BAD_PASSWORD: "złe hasło", NO_USER: "brak konta", LOCKED: "konto zablokowane", DOMAIN: "domena spoza firmy", NOT_ACTIVATED: "nieaktywowane", INACTIVE: "konto nieaktywne", RATE: "limit prób" };

const PAGE = 50;
const json = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v, null, 1).replace(/[{}"]/g, "").trim());

export function AuditPage() {
  const [tab, setTab] = useState<"ops" | "logins">("ops");
  return (
    <>
      <h1>Dziennik audytu</h1>
      <p className="muted small">Zapisy są tylko do dopisywania — nie można ich zmienić ani usunąć (blokada w bazie danych).</p>
      <div className="tabs" role="tablist">
        <button role="tab" type="button" aria-selected={tab === "ops"} className={tab === "ops" ? "on" : ""} onClick={() => setTab("ops")}>Działania</button>
        <button role="tab" type="button" aria-selected={tab === "logins"} className={tab === "logins" ? "on" : ""} onClick={() => setTab("logins")}>Logowania</button>
      </div>
      {tab === "ops" ? <AuditOps /> : <AuditLogins />}
    </>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <nav className="pager" aria-label="Strony">
      <button type="button" className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Poprzednia</button>
      <span>Strona {page} z {pages} · {total} zapisów</span>
      <button type="button" className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Następna →</button>
    </nav>
  );
}

const qs = (o: Record<string, string | number>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "").map(([k, v]) => [k, String(v)])).toString();

function AuditOps() {
  const wh = useWarehouses();
  const [f, setF] = useState({ from: "", to: "", q: "", warehouseId: "" });
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["audit", f, page],
    queryFn: ({ signal }) => api.get<{ total: number; rows: AuditRow[] }>(`/audit?${qs({ ...f, page, pageSize: PAGE })}`, signal),
    placeholderData: keepPreviousData,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setPage(1); setF(s => ({ ...s, [k]: e.target.value })); };
  const whName = new Map((wh.data ?? []).map(w => [w.id, w.name]));
  return (
    <>
      <div className="filters" role="search">
        <label className="inline">Od <input className="ctrl" type="date" value={f.from} onChange={set("from")} /></label>
        <label className="inline">Do <input className="ctrl" type="date" value={f.to} onChange={set("to")} /></label>
        <select className="ctrl" aria-label="Magazyn" value={f.warehouseId} onChange={set("warehouseId")}>
          <option value="">Wszystkie magazyny</option>{wh.data?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input className="ctrl" type="search" placeholder="Szukaj: e-mail, akcja, powód" aria-label="Szukaj w audycie" value={f.q} onChange={set("q")} />
      </div>
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">Wczytywanie…</p> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Czas</th><th>Użytkownik</th><th>Zdarzenie</th><th>Szczegóły</th><th>IP / urządzenie</th></tr></thead>
              <tbody>
                {q.data.rows.map(r => (
                  <tr key={r.id}>
                    <td data-label="Czas">{fmtDateTime(r.ts)}</td>
                    <td data-label="Użytkownik">{r.userEmail ?? <em>system</em>}</td>
                    <td data-label="Zdarzenie"><span title={r.action}>{ACTION_LABEL[r.action] ?? r.action}</span><br /><small className="muted">{r.entity}{r.warehouseId ? ` · ${whName.get(r.warehouseId) ?? "magazyn"}` : ""}</small></td>
                    <td data-label="Szczegóły" className="small pre">
                      {r.before !== null && <><span className="muted">było:</span> {json(r.before)}<br /></>}
                      {r.after !== null && <><span className="muted">jest:</span> {json(r.after)}</>}
                      {r.reason && <><br /><span className="muted">powód:</span> {r.reason}</>}
                    </td>
                    <td data-label="IP">{r.ip ?? "—"}<br /><small className="muted">{uaLabel(r.userAgent)}</small></td>
                  </tr>
                ))}
                {!q.data.rows.length && <tr><td colSpan={5} className="muted">Brak zapisów.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={q.data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

function AuditLogins() {
  const [f, setF] = useState({ from: "", to: "", email: "", success: "" });
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["audit", "logins", f, page],
    queryFn: ({ signal }) => api.get<{ total: number; rows: LoginRow[] }>(`/audit/logins?${qs({ ...f, page, pageSize: PAGE })}`, signal),
    placeholderData: keepPreviousData,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setPage(1); setF(s => ({ ...s, [k]: e.target.value })); };
  return (
    <>
      <div className="filters" role="search">
        <label className="inline">Od <input className="ctrl" type="date" value={f.from} onChange={set("from")} /></label>
        <label className="inline">Do <input className="ctrl" type="date" value={f.to} onChange={set("to")} /></label>
        <select className="ctrl" aria-label="Wynik" value={f.success} onChange={set("success")}>
          <option value="">Wszystkie</option><option value="true">Udane</option><option value="false">Nieudane</option>
        </select>
        <input className="ctrl" type="search" placeholder="E-mail" aria-label="E-mail" value={f.email} onChange={set("email")} />
      </div>
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">Wczytywanie…</p> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Czas</th><th>E-mail</th><th>Wynik</th><th>IP</th><th>Urządzenie</th></tr></thead>
              <tbody>
                {q.data.rows.map(r => (
                  <tr key={r.id}>
                    <td data-label="Czas">{fmtDateTime(r.ts)}</td>
                    <td data-label="E-mail">{r.email}</td>
                    <td data-label="Wynik">{r.success ? <span className="badge ok">udane</span> : <span className="badge err">{LOGIN_REASON[r.reason ?? ""] ?? r.reason ?? "nieudane"}</span>}</td>
                    <td data-label="IP">{r.ip ?? "—"}</td>
                    <td data-label="Urządzenie">{uaLabel(r.userAgent)}</td>
                  </tr>
                ))}
                {!q.data.rows.length && <tr><td colSpan={5} className="muted">Brak zapisów.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={q.data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
