import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, ApiRequestError } from "../../api/client";
import { Alert, PasswordInput } from "../../ui/components";
import { AuthLayout } from "./AuthLayout";

type Kind = "INVITE" | "PASSWORD_RESET";
const TEXT: Record<Kind, { title: string; submit: string; done: string; path: string }> = {
  INVITE: { title: "Aktywacja konta", submit: "Aktywuj konto", done: "Konto zostało aktywowane. Możesz się zalogować.", path: "/auth/invite/accept" },
  PASSWORD_RESET: { title: "Ustaw nowe hasło", submit: "Zapisz hasło", done: "Hasło zostało zmienione. Wszystkie wcześniejsze sesje zostały zakończone.", path: "/auth/reset" },
};

/**
 * Token jednorazowy z linku e-mail (?token=…). Po odczycie token jest usuwany z paska adresu i historii
 * (nie trafia do zakładek ani nagłówka Referer); trzymany wyłącznie w pamięci.
 */
function useTokenFromUrl(): string | null {
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token"));
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("token")) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);
  return token;
}

export function TokenPasswordPage({ kind }: { kind: Kind }) {
  const token = useTokenFromUrl();
  const t = TEXT[kind];
  const check = useQuery({
    queryKey: ["auth", "token", kind, token],
    queryFn: () => api.post<{ email: string; name: string; passwordRules: string }>("/auth/token", { token, kind }),
    enabled: !!token, retry: false, staleTime: Infinity, gcTime: 0,
  });
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (pw !== pw2) { setErr("Hasła nie są identyczne."); return; }
    setBusy(true);
    try { await api.post(t.path, { token, password: pw }); setDone(true); setPw(""); setPw2(""); }
    catch (x) { setErr(x instanceof ApiRequestError ? x.message : "Nieznany błąd"); }
    finally { setBusy(false); }
  };

  const back = <Link to="/logowanie">Przejdź do logowania</Link>;
  if (!token) return <AuthLayout title={t.title} footer={back}><Alert kind="err">Brak tokenu w linku. Otwórz link z wiadomości e-mail jeszcze raz.</Alert></AuthLayout>;
  if (done) return <AuthLayout title={t.title} footer={back}><Alert kind="ok">{t.done}</Alert></AuthLayout>;
  return (
    <AuthLayout title={t.title} footer={back}>
      {check.isPending && <p className="muted">Sprawdzanie linku…</p>}
      {check.isError && <Alert kind="err"><strong>{check.error.message}</strong><span>{kind === "INVITE" ? "Poproś administratora o ponowne wysłanie zaproszenia." : <>Wygeneruj nowy link: <Link to="/zapomnialem-hasla">reset hasła</Link>.</>}</span></Alert>}
      {check.isSuccess && (
        <form onSubmit={e => void submit(e)} className="form">
          <p>{check.data.name} · <strong>{check.data.email}</strong></p>
          {err && <Alert kind="err">{err}</Alert>}
          <input type="email" autoComplete="username" value={check.data.email} readOnly hidden />
          <PasswordInput label="Nowe hasło" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} hint={check.data.passwordRules} autoFocus />
          <PasswordInput label="Powtórz hasło" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
          <button className="btn primary block" disabled={busy || !pw || !pw2}>{busy ? "Zapisywanie…" : t.submit}</button>
        </form>
      )}
    </AuthLayout>
  );
}
