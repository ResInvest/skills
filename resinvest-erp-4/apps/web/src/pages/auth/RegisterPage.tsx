import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, ApiRequestError } from "../../api/client";
import { Alert, TextInput } from "../../ui/components";
import { AuthLayout } from "./AuthLayout";
import { useAuthConfig } from "./LoginPage";
import { t, tm } from "../../i18n";

/**
 * Samodzielna rejestracja (jeśli włączona w konfiguracji). Konto powstaje jako nieaktywne z rolą tylko do odczytu;
 * rolę i magazyny nadaje administrator — użytkownik nie może sam nadać sobie uprawnień.
 */
export function RegisterPage() {
  const cfg = useAuthConfig();
  const [f, setF] = useState({ email: "", firstName: "", lastName: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiRequestError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const back = <Link to="/logowanie">{t("Wróć do logowania")}</Link>;

  if (cfg.isSuccess && !cfg.data.allowSelfRegistration) return <AuthLayout title={t("Rejestracja")} footer={back}><Alert kind="info">{t("Rejestracja jest wyłączona. Konto zakłada administrator (zaproszenie e-mail).")}</Alert></AuthLayout>;

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { setDone((await api.post<{ message: string }>("/auth/register", { ...f, email: f.email.trim() })).message); }
    catch (x) { setErr(x instanceof ApiRequestError ? x : new ApiRequestError(0, null)); }
    finally { setBusy(false); }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }));
  return (
    <AuthLayout title={t("Rejestracja")} footer={back}>
      {done ? <Alert kind="ok">{tm(done)}</Alert> : (
        <form onSubmit={e => void submit(e)} className="form">
          {err && !err.body?.details && <Alert kind="err">{err.message}</Alert>}
          <TextInput label={t("Firmowy adres e-mail")} type="email" autoComplete="email" value={f.email} onChange={set("email")} error={err?.field("email")} required autoFocus
            hint={cfg.data?.companyDomains.length ? t("Tylko adresy: {list}", { list: cfg.data.companyDomains.map(d => "@" + d).join(", ") }) : undefined} />
          <div className="grid2">
            <TextInput label={t("Imię")} autoComplete="given-name" value={f.firstName} onChange={set("firstName")} error={err?.field("firstName")} required />
            <TextInput label={t("Nazwisko")} autoComplete="family-name" value={f.lastName} onChange={set("lastName")} error={err?.field("lastName")} required />
          </div>
          <p className="muted small">{t("Po akceptacji przez administratora otrzymasz e-mail z linkiem do ustawienia hasła.")}</p>
          <button className="btn primary block" disabled={busy}>{busy ? t("Wysyłanie…") : t("Wyślij zgłoszenie")}</button>
        </form>
      )}
    </AuthLayout>
  );
}
