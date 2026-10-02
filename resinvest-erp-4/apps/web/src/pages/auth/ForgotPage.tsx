import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, errorText } from "../../api/client";
import { Alert, TextInput } from "../../ui/components";
import { AuthLayout } from "./AuthLayout";
import { t, tm } from "../../i18n";

/** Reset hasła — serwer zawsze odpowiada tak samo (nie ujawnia, czy konto istnieje). */
export function ForgotPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { setDone((await api.post<{ message: string }>("/auth/forgot", { email: email.trim() })).message); }
    catch (x) { setErr(errorText(x)); }
    finally { setBusy(false); }
  };
  return (
    <AuthLayout title={t("Reset hasła")} footer={<Link to="/logowanie">{t("Wróć do logowania")}</Link>}>
      {done ? <Alert kind="ok">{tm(done)}</Alert> : (
        <form onSubmit={e => void submit(e)} className="form">
          <p className="muted">{t("Podaj firmowy adres e-mail. Jeśli konto istnieje i jest aktywne, wyślemy link do ustawienia nowego hasła.")}</p>
          {err && <Alert kind="err">{err}</Alert>}
          <TextInput label={t("Firmowy adres e-mail")} type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          <button className="btn primary block" disabled={busy || !email}>{busy ? t("Wysyłanie…") : t("Wyślij link")}</button>
        </form>
      )}
    </AuthLayout>
  );
}
