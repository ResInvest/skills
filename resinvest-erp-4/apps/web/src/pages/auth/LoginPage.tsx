import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, ApiRequestError } from "../../api/client";
import type { AuthConfig, Me } from "../../api/types";
import { useSession } from "../../auth/session";
import { Alert, PasswordInput, TextInput } from "../../ui/components";
import { AuthLayout } from "./AuthLayout";

export const useAuthConfig = () => useQuery({ queryKey: ["auth", "config"], queryFn: ({ signal }) => api.get<AuthConfig & { ok: true }>("/auth/config", signal), staleTime: 300_000 });

/** Komunikaty kodów błędów logowania (treść z serwera ma pierwszeństwo — tu tylko podpowiedzi). */
const HINT: Record<string, string> = {
  LOCKED: "Konto jest czasowo zablokowane po nieudanych próbach. Poczekaj lub poproś administratora o odblokowanie.",
  NOT_ACTIVATED: "Konto nie zostało jeszcze aktywowane — użyj linku z zaproszenia (e-mail).",
  OFFLINE: "Sprawdź, czy FortiClient VPN jest połączony, i spróbuj ponownie.",
};

export function LoginPage() {
  const { user, setUser } = useSession();
  const cfg = useAuthConfig();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiRequestError | null>(null);
  const from = (loc.state as { from?: string } | null)?.from ?? "/";

  if (user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ user: Me }>("/auth/login", { email: email.trim(), password });
      setPassword("");
      setUser(r.user);
      void nav(from, { replace: true });
    } catch (x) {
      setErr(x instanceof ApiRequestError ? x : new ApiRequestError(0, null));
    } finally { setBusy(false); }
  };

  const domains = cfg.data?.companyDomains ?? [];
  return (
    <AuthLayout title="Logowanie" footer={<>
      <Link to="/zapomnialem-hasla">Nie pamiętasz hasła?</Link>
      {cfg.data?.allowSelfRegistration && <Link to="/rejestracja">Załóż konto (wymaga akceptacji administratora)</Link>}
    </>}>
      <form onSubmit={e => void submit(e)} noValidate className="form">
        {err && <Alert kind="err"><strong>{err.message}</strong>{HINT[err.code] && <span>{HINT[err.code]}</span>}</Alert>}
        <TextInput label="Firmowy adres e-mail" type="email" autoComplete="username" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} required
          hint={domains.length ? `Dozwolone domeny: ${domains.map(d => "@" + d).join(", ")}` : undefined} autoFocus />
        <PasswordInput label="Hasło" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
        <button className="btn primary block" disabled={busy || !email || !password}>{busy ? "Logowanie…" : "Zaloguj"}</button>
      </form>
    </AuthLayout>
  );
}
