import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError } from "../../api/client";
import { ME_KEY } from "../../auth/session";
import { Alert, PasswordInput } from "../../ui/components";
import { useAuthConfig } from "../auth/LoginPage";

/** Zmiana hasła (konto i ekran wymuszonej zmiany). Serwer kończy pozostałe sesje użytkownika. */
export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const qc = useQueryClient();
  const cfg = useAuthConfig();
  const [oldPassword, setOld] = useState(""), [newPassword, setNew] = useState(""), [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiRequestError | string | null>(null);
  const [ok, setOk] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setOk(false);
    if (newPassword !== repeat) { setErr("Nowe hasła nie są identyczne."); return; }
    setBusy(true);
    try {
      await api.post("/auth/password", { oldPassword, newPassword });
      setOld(""); setNew(""); setRepeat(""); setOk(true);
      await qc.invalidateQueries({ queryKey: ME_KEY });
      await qc.invalidateQueries({ queryKey: ["auth", "sessions"] });
      onDone?.();
    } catch (x) { setErr(x instanceof ApiRequestError ? x : "Nieznany błąd"); }
    finally { setBusy(false); }
  };
  const apiErr = err instanceof ApiRequestError ? err : null;
  // kody serwera → pole formularza
  const oldErr = apiErr?.code === "BAD_PASSWORD" ? apiErr.message : undefined;
  const newErr = apiErr && ["PASSWORD_POLICY", "PASSWORD_SAME"].includes(apiErr.code) ? apiErr.message : undefined;
  return (
    <form onSubmit={e => void submit(e)} className="form" aria-label="Zmiana hasła">
      {ok && <Alert kind="ok">Hasło zostało zmienione. Pozostałe sesje zostały wylogowane.</Alert>}
      {typeof err === "string" && <Alert kind="err">{err}</Alert>}
      {apiErr && !oldErr && !newErr && <Alert kind="err">{apiErr.message}</Alert>}
      <PasswordInput label="Obecne hasło" autoComplete="current-password" value={oldPassword} onChange={e => setOld(e.target.value)} error={oldErr} />
      <PasswordInput label="Nowe hasło" autoComplete="new-password" value={newPassword} onChange={e => setNew(e.target.value)} error={newErr} hint={cfg.data?.passwordRules} />
      <PasswordInput label="Powtórz nowe hasło" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} />
      <button className="btn primary" disabled={busy || !oldPassword || !newPassword || !repeat}>{busy ? "Zapisywanie…" : "Zmień hasło"}</button>
    </form>
  );
}
