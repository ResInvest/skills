import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorText } from "../../api/client";
import { Alert } from "../../ui/components";

export interface NotificationRow { event: string; label: string; description: string; enabled: boolean; allowed: boolean }

/**
 * Powiadomienia e-mail — własne (Moje konto: włączasz te, na które administrator wyraził zgodę) albo administratora
 * (karta użytkownika: zgody). Każda zmiana zapisuje się od razu i trafia do dziennika audytu.
 */
export function NotificationSettings({ mode, userId }: { mode: "own" | "admin"; userId?: string }) {
  const qc = useQueryClient();
  const path = mode === "own" ? "/account/notifications" : `/users/${userId}/notifications`;
  const key = ["notifications", mode, userId ?? "me"];
  const q = useQuery({ queryKey: key, queryFn: async ({ signal }) => (await api.get<{ settings: NotificationRow[] }>(path, signal)).settings });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const field = mode === "own" ? "enabled" : "allowed";
  // zmiana widoczna od razu (stan lokalny ustawiany w obsłudze kliknięcia); po odpowiedzi serwera — stan z serwera,
  // przy błędzie wraca poprzedni
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const save = useMutation({
    mutationFn: (changes: Record<string, boolean>) => api.put<{ settings: NotificationRow[] }>(path, { changes }),
    onSuccess: r => { qc.setQueryData(key, r.settings); setMsg({ kind: "ok", text: "Zapisano ustawienia powiadomień." }); },
    onError: e => setMsg({ kind: "err", text: errorText(e) }),
    onSettled: () => setPending({}),
  });
  const change = (changes: Record<string, boolean>) => { setMsg(null); setPending(changes); save.mutate(changes); };
  if (q.isPending) return <p className="muted">Wczytywanie…</p>;
  if (q.isError) return <Alert kind="err">{errorText(q.error)}</Alert>;
  const all = (on: boolean) => change(Object.fromEntries(q.data.filter(r => mode === "admin" || r.allowed).map(r => [r.event, on])));
  return (
    <div id={`nt-${mode}`}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <ul className="plain nt-list">
        {q.data.map(r => {
          const locked = mode === "own" && !r.allowed;
          return (
            <li key={r.event} className={locked ? "locked" : ""}>
              <label className="check">
                <input type="checkbox" id={`nt-${mode}-${r.event}`} checked={pending[r.event] ?? r[field]} disabled={locked || save.isPending}
                  onChange={e => change({ [r.event]: e.target.checked })} />
                <span><strong>{r.label}</strong><small className="muted"> — {r.description}</small>
                  {locked && <small className="badge warn">wymaga zgody administratora</small>}
                  {mode === "admin" && r.allowed && <small className={`badge ${r.enabled ? "ok" : "info"}`}>{r.enabled ? "użytkownik włączył" : "użytkownik nie włączył"}</small>}</span>
              </label>
            </li>);
        })}
      </ul>
      <div className="actions">
        <button type="button" className="btn sm" disabled={save.isPending} onClick={() => all(true)}>{mode === "admin" ? "Zezwól na wszystkie" : "Włącz wszystkie dozwolone"}</button>
        <button type="button" className="btn sm" disabled={save.isPending} onClick={() => all(false)}>{mode === "admin" ? "Odbierz wszystkie" : "Wyłącz wszystkie"}</button>
      </div>
      <p className="muted small">{mode === "own"
        ? "Wiadomości dotyczą magazynów, do których masz dostęp; o własnych operacjach nie dostajesz powiadomień. Błąd poczty nie wstrzymuje pracy — wysyłka jest ponawiana."
        : "Zgoda pozwala użytkownikowi włączyć powiadomienie w „Moje konto”. Odebranie zgody od razu wyłącza wysyłkę."}</p>
    </div>
  );
}
