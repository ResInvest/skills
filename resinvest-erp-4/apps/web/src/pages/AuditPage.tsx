import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, errorText } from "../api/client";
import type { AuditRow, LoginRow } from "../api/types";
import { Alert, fmtDateTime, uaLabel } from "../ui/components";
import { useWarehouses } from "./account/AccountPage";
import { m, t, tmap } from "../i18n";

/** Czytelne nazwy zdarzeń audytu (kod pozostaje widoczny w podpowiedzi). */
export const ACTION_LABEL: Record<string, string> = tmap({
  LOGIN: m("Logowanie"), LOGOUT: m("Wylogowanie"), ACCOUNT_LOCKED: m("Blokada konta"), PASSWORD_CHANGED: m("Zmiana hasła"), PASSWORD_RESET: m("Reset hasła"),
  PASSWORD_RESET_REQUESTED: m("Prośba o reset hasła"), PASSWORD_RESET_LINK_SENT: m("Wysłano link resetu"), PASSWORD_RESET_LINK_CLI: m("Link resetu z konsoli serwera"), INVITE_ACCEPTED: m("Aktywacja konta"), USER_INVITED: m("Zaproszenie użytkownika"),
  USER_INVITE_RESENT: m("Ponowne zaproszenie"), USER_SELF_REGISTERED: m("Rejestracja"), USER_UPDATED: m("Zmiana danych użytkownika"), ROLE_CHANGED: m("Zmiana roli"),
  WAREHOUSE_ACCESS_CHANGED: m("Zmiana dostępu do magazynów"), USER_STATUS_CHANGED: m("Zmiana statusu"), ACCOUNT_UNLOCKED: m("Odblokowanie konta"),
  FORCE_PASSWORD_CHANGE: m("Wymuszenie zmiany hasła"), SESSION_REVOKED: m("Zakończenie sesji"), SESSIONS_REVOKED: m("Zakończenie sesji użytkownika"),
  ROLE_PERMISSIONS_CHANGED: m("Zmiana uprawnień roli"), DEFAULT_WAREHOUSE_CHANGED: m("Zmiana magazynu domyślnego"), ADMIN_BOOTSTRAP: m("Utworzenie pierwszego administratora"),
  OPENING_BALANCE_CREATED: m("Bilans otwarcia — szkic"), OPENING_BALANCE_UPDATED: m("Bilans otwarcia — zmiana szkicu"), OPENING_BALANCE_DRAFT_DELETED: m("Bilans otwarcia — usunięcie szkicu"), OPENING_BALANCE_APPROVED: m("Bilans otwarcia — zatwierdzenie"),
  OPERATION_CREATED: m("Operacja magazynowa — zapis"),
  MM_RECEIVED: m("Przyjęcie MM"), PLAN_UPDATED: m("Planer zakupów — zmiana planu"),
  OPERATION_CORRECTED: m("Korekta dokumentu (było / jest)"), OPERATION_DELETED: m("Usunięcie dokumentu (odwrócenie ruchów)"), REPORT_EXPORTED: m("Eksport raportu"), NOTIFICATIONS_CHANGED: m("Powiadomienia — zmiana ustawień"), NOTIFICATIONS_ALLOWED: m("Powiadomienia — zgoda administratora"),
  MAIL_RETRIED: m("Poczta — ponowienie wysyłki"), MAIL_TEST: m("Poczta — wiadomość testowa"),
  PREFERENCES_CHANGED: m("Wygląd i język — zmiana ustawień"),
  CATALOG_CREATED: m("Kartoteka — dodanie"), CATALOG_UPDATED: m("Kartoteka — zmiana"), CATALOG_DELETED: m("Kartoteka — usunięcie"),
});
const LOGIN_REASON: Record<string, string> = tmap({ BAD_PASSWORD: m("złe hasło"), NO_USER: m("brak konta"), LOCKED: m("konto zablokowane"), DOMAIN: m("domena spoza firmy"), NOT_ACTIVATED: m("nieaktywowane"), INACTIVE: m("konto nieaktywne"), RATE: m("limit prób") });

const PAGE = 50;
const json = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v, null, 1).replace(/[{}"]/g, "").trim());

export function AuditPage() {
  const [tab, setTab] = useState<"ops" | "logins">("ops");
  return (
    <>
      <h1>{t("Dziennik audytu")}</h1>
      <p className="muted small">{t("Zapisy są tylko do dopisywania — nie można ich zmienić ani usunąć (blokada w bazie danych).")}</p>
      <div className="tabs" role="tablist">
        <button role="tab" type="button" aria-selected={tab === "ops"} className={tab === "ops" ? "on" : ""} onClick={() => setTab("ops")}>{t("Działania")}</button>
        <button role="tab" type="button" aria-selected={tab === "logins"} className={tab === "logins" ? "on" : ""} onClick={() => setTab("logins")}>{t("Logowania")}</button>
      </div>
      {tab === "ops" ? <AuditOps /> : <AuditLogins />}
    </>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <nav className="pager" aria-label={t("Strony")}>
      <button type="button" className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t("← Poprzednia")}</button>
      <span>{t("Strona {page} z {pages}", { page, pages })} · {t("{n} zapisów", { n: total })}</span>
      <button type="button" className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t("Następna →")}</button>
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
        <label className="inline">{t("Od")} <input className="ctrl" type="date" value={f.from} onChange={set("from")} /></label>
        <label className="inline">{t("Do")} <input className="ctrl" type="date" value={f.to} onChange={set("to")} /></label>
        <select className="ctrl" aria-label={t("Magazyn")} value={f.warehouseId} onChange={set("warehouseId")}>
          <option value="">{t("Wszystkie magazyny")}</option>{wh.data?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input className="ctrl" type="search" placeholder={t("Szukaj: e-mail, akcja, powód")} aria-label={t("Szukaj w audycie")} value={f.q} onChange={set("q")} />
      </div>
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">{t("Wczytywanie…")}</p> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t("Czas")}</th><th>{t("Użytkownik")}</th><th>{t("Zdarzenie")}</th><th>{t("Szczegóły")}</th><th>{t("IP / urządzenie")}</th></tr></thead>
              <tbody>
                {q.data.rows.map(r => (
                  <tr key={r.id}>
                    <td data-label={t("Czas")}>{fmtDateTime(r.ts)}</td>
                    <td data-label={t("Użytkownik")}>{r.userEmail ?? <em>{t("system")}</em>}</td>
                    <td data-label={t("Zdarzenie")}><span title={r.action}>{ACTION_LABEL[r.action] ?? r.action}</span><br /><small className="muted">{r.entity}{r.warehouseId ? ` · ${whName.get(r.warehouseId) ?? t("magazyn")}` : ""}</small></td>
                    <td data-label={t("Szczegóły")} className="small pre">
                      {r.before !== null && <><span className="muted">{t("było:")}</span> {json(r.before)}<br /></>}
                      {r.after !== null && <><span className="muted">{t("jest:")}</span> {json(r.after)}</>}
                      {r.reason && <><br /><span className="muted">{t("powód:")}</span> {r.reason}</>}
                    </td>
                    <td data-label="IP">{r.ip ?? "—"}<br /><small className="muted">{uaLabel(r.userAgent)}</small></td>
                  </tr>
                ))}
                {!q.data.rows.length && <tr><td colSpan={5} className="muted">{t("Brak zapisów.")}</td></tr>}
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
        <label className="inline">{t("Od")} <input className="ctrl" type="date" value={f.from} onChange={set("from")} /></label>
        <label className="inline">{t("Do")} <input className="ctrl" type="date" value={f.to} onChange={set("to")} /></label>
        <select className="ctrl" aria-label={t("Wynik")} value={f.success} onChange={set("success")}>
          <option value="">{t("Wszystkie")}</option><option value="true">{t("Udane")}</option><option value="false">{t("Nieudane")}</option>
        </select>
        <input className="ctrl" type="search" placeholder={t("E-mail")} aria-label={t("E-mail")} value={f.email} onChange={set("email")} />
      </div>
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">{t("Wczytywanie…")}</p> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t("Czas")}</th><th>{t("E-mail")}</th><th>{t("Wynik")}</th><th>IP</th><th>{t("Urządzenie")}</th></tr></thead>
              <tbody>
                {q.data.rows.map(r => (
                  <tr key={r.id}>
                    <td data-label={t("Czas")}>{fmtDateTime(r.ts)}</td>
                    <td data-label={t("E-mail")}>{r.email}</td>
                    <td data-label={t("Wynik")}>{r.success ? <span className="badge ok">{t("udane")}</span> : <span className="badge err">{LOGIN_REASON[r.reason ?? ""] ?? r.reason ?? t("nieudane")}</span>}</td>
                    <td data-label="IP">{r.ip ?? "—"}</td>
                    <td data-label={t("Urządzenie")}>{uaLabel(r.userAgent)}</td>
                  </tr>
                ))}
                {!q.data.rows.length && <tr><td colSpan={5} className="muted">{t("Brak zapisów.")}</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={q.data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
