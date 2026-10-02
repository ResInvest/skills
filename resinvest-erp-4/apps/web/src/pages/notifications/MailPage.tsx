import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorText } from "../../api/client";
import { Alert, fmtDateTime } from "../../ui/components";
import { ColumnHelp, TutorialToggle } from "../../ui/tutorial";

interface MailRow { id: string; template: string; toAddress: string; subject: string; status: Status; attempts: number; nextAttemptAt: string; lastError: string | null; createdAt: string; sentAt: string | null; retryable: boolean }
type Status = "QUEUED" | "SENDING" | "SENT" | "FAILED" | "DEAD";
interface Outbox { transport: string; worker: "on" | "off"; total: number; counts: Partial<Record<Status, number>>; rows: MailRow[] }

const STATUS: Record<Status, { label: string; cls: string }> = {
  QUEUED: { label: "w kolejce", cls: "info" }, SENDING: { label: "wysyłanie", cls: "info" }, SENT: { label: "wysłana", cls: "ok" },
  FAILED: { label: "błąd — ponowi", cls: "warn" }, DEAD: { label: "porzucona", cls: "err" },
};
const TEMPLATE: Record<string, string> = { notification: "Powiadomienie", invite: "Zaproszenie", "password-reset": "Reset hasła", "password-changed": "Zmiana hasła",
  "account-disabled": "Wyłączenie konta", "self-registration": "Zgłoszenie konta", test: "Test" };
const TRANSPORT: Record<string, string> = { smtp: "serwer SMTP", resend: "Resend (HTTPS)", file: "pliki .eml (bez wysyłki)" };
const PAGE = 50;
const HELP = [
  ["Status", "W kolejce → wysłana. Błąd: kolejna próba po 1 min, 5 min, 15 min, 1 h, 6 h; potem „porzucona”."],
  ["Próby", "Liczba prób wysyłki; ostatni błąd serwera poczty pod tematem."],
  ["Ponów", "Wiadomość nieudaną lub porzuconą wysyła od razu ponownie (licznik prób od zera). Treści z jednorazowym linkiem (zaproszenie, reset hasła) nie da się ponowić — wyślij nowy link z karty użytkownika."],
] as const;

/** Dziennik wysyłki poczty (administrator): statystyka, filtr, błędy, ponowienie, wiadomość testowa, wysyłka teraz. */
export function MailPage() {
  const qc = useQueryClient();
  const [f, setF] = useState({ status: "", q: "" });
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE), ...(f.status ? { status: f.status } : {}), ...(f.q ? { q: f.q } : {}) });
  const q = useQuery({ queryKey: ["mail", qs.toString()], staleTime: 0, refetchInterval: 15_000, placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<Outbox>(`/mail/outbox?${qs.toString()}`, signal) });
  const done = (text: string, kind: "ok" | "err" = "ok") => { setMsg({ kind, text }); void qc.invalidateQueries({ queryKey: ["mail"] }); };
  const retry = useMutation({ mutationFn: (id: string) => api.post<{ mail: { status: Status; lastError: string | null } }>(`/mail/${id}/retry`),
    onSuccess: r => done(r.mail.status === "SENT" ? "Wiadomość wysłana." : `Ponowiono — status: ${STATUS[r.mail.status].label}${r.mail.lastError ? ` (${r.mail.lastError})` : ""}.`, r.mail.status === "SENT" ? "ok" : "err"),
    onError: e => done(errorText(e), "err") });
  const test = useMutation({ mutationFn: () => api.post<{ mail: { status: Status; lastError: string | null } }>("/mail/test"),
    onSuccess: r => done(r.mail.status === "SENT" ? "Wysłano wiadomość testową na Twój adres." : `Wiadomość testowa nie wyszła: ${r.mail.lastError ?? STATUS[r.mail.status].label}.`, r.mail.status === "SENT" ? "ok" : "err"),
    onError: e => done(errorText(e), "err") });
  const drain = useMutation({ mutationFn: () => api.post<{ processed: number }>("/mail/drain"), onSuccess: r => done(`Przetworzono wiadomości: ${r.processed}.`), onError: e => done(errorText(e), "err") });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setPage(1); setF(s => ({ ...s, [k]: e.target.value })); };
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / PAGE));
  return (
    <>
      <div className="page-h">
        <div><h1>Poczta i powiadomienia</h1><p className="muted small">Kolejka wiadomości systemu: zaproszenia, resety haseł, powiadomienia o operacjach. Błąd poczty nie cofa operacji — wysyłka jest ponawiana.</p></div>
        <div className="actions"><TutorialToggle />
          <button type="button" className="btn" id="mail-test" disabled={test.isPending} onClick={() => { setMsg(null); test.mutate(); }}>Wyślij test do mnie</button>
          <button type="button" className="btn" id="mail-drain" disabled={drain.isPending} onClick={() => { setMsg(null); drain.mutate(); }}>Wyślij kolejkę teraz</button></div>
      </div>
      {msg && <Alert kind={msg.kind}><span id="mail-msg">{msg.text}</span></Alert>}
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">Wczytywanie…</p> : <>
        <ul className="kpis" id="mail-stats">
          <li><small>Kanał wysyłki</small><strong>{q.data.transport.split("+").map(t => TRANSPORT[t] ?? t).join(" → zapasowo ")}</strong><span className="muted small">proces wysyłki: {q.data.worker === "on" ? "włączony" : "wyłączony"}</span></li>
          {(["QUEUED", "SENT", "FAILED", "DEAD"] as const).map(s => <li key={s}><small>{STATUS[s].label}</small><strong>{q.data.counts[s] ?? 0}</strong></li>)}
        </ul>
        {q.data.transport === "file" && <Alert kind="warn">Poczta zapisuje wiadomości do plików .eml na serwerze — nic nie jest wysyłane. Ustaw EMAIL_TRANSPORT=smtp albo resend w konfiguracji serwera.</Alert>}
        <div className="filters" role="search">
          <select className="ctrl" aria-label="Status" id="mail-status" value={f.status} onChange={set("status")}><option value="">Wszystkie statusy</option>{(Object.keys(STATUS) as Status[]).map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}</select>
          <input className="ctrl" type="search" placeholder="Adres albo temat" aria-label="Szukaj" value={f.q} onChange={set("q")} />
        </div>
        <div className="table-wrap"><table className="table" id="mail-table">
          <thead><tr><th>Utworzono</th><th>Do</th><th>Rodzaj / temat</th><th>Status</th><th className="r">Próby</th><th /></tr></thead>
          <tbody>{q.data.rows.map(r => (
            <tr key={r.id} data-mail={r.status}>
              <td data-label="Utworzono">{fmtDateTime(r.createdAt)}{r.sentAt && <><br /><small className="muted">wysłano {fmtDateTime(r.sentAt)}</small></>}</td>
              <td data-label="Do">{r.toAddress}</td>
              <td data-label="Temat"><small className="muted">{TEMPLATE[r.template] ?? r.template}</small><br />{r.subject}{r.lastError && <><br /><small className="error">{r.lastError}</small></>}</td>
              <td data-label="Status"><span className={`badge ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>{r.status === "FAILED" && <><br /><small className="muted">następna próba {fmtDateTime(r.nextAttemptAt)}</small></>}</td>
              <td data-label="Próby" className="r num">{r.attempts}</td>
              <td>{r.retryable && <button type="button" className="btn sm" data-retry={r.id} disabled={retry.isPending} onClick={() => { setMsg(null); retry.mutate(r.id); }}>Ponów</button>}</td>
            </tr>))}
            {!q.data.rows.length && <tr><td colSpan={6} className="muted">Brak wiadomości.</td></tr>}</tbody>
        </table></div>
        <ColumnHelp items={HELP} />
        <nav className="pager" aria-label="Strony">
          <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Poprzednia</button>
          <span>Strona {page} z {pages} · {q.data.total}</span>
          <button type="button" className="btn sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Następna →</button>
        </nav>
      </>}
    </>
  );
}
