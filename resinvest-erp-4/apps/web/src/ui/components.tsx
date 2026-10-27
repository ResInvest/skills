import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { STATUS_LABEL, type UserStatus } from "../api/types";
import { t } from "../i18n";
export { fmtDateTime } from "../i18n";

/** Pole formularza z etykietą, komunikatem błędu i podpowiedzią (połączone przez aria-describedby). */
export function Field({ label, error, hint, children, required }: { label: string; error?: string | undefined; hint?: string | undefined; children: (id: string, describedBy: string | undefined) => ReactNode; required?: boolean }) {
  const id = useId(), eid = `${id}-e`, hid = `${id}-h`;
  const described = [error ? eid : "", hint ? hid : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${error ? "has-error" : ""}`}>
      <label htmlFor={id}>{label}{required && <span className="req" aria-hidden="true"> *</span>}</label>
      {children(id, described)}
      {hint && <small id={hid} className="hint">{hint}</small>}
      {error && <small id={eid} className="error" role="alert">{error}</small>}
    </div>
  );
}

export function TextInput({ label, error, hint, required, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | undefined; hint?: string | undefined }) {
  return <Field label={label} error={error} hint={hint} required={required}>{(id, d) => <input id={id} className="ctrl" aria-invalid={!!error} aria-describedby={d} required={required} {...rest} />}</Field>;
}

/** Hasło z przełącznikiem widoczności. */
export function PasswordInput({ label, error, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | undefined; hint?: string | undefined }) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} error={error} hint={hint} required>
      {(id, d) => (
        <div className="pw">
          <input id={id} className="ctrl" type={show ? "text" : "password"} aria-invalid={!!error} aria-describedby={d} required {...rest} />
          <button type="button" className="btn ghost sm" onClick={() => setShow(s => !s)} aria-pressed={show} aria-label={show ? t("Ukryj hasło") : t("Pokaż hasło")}>{show ? t("Ukryj") : t("Pokaż")}</button>
        </div>
      )}
    </Field>
  );
}

export function Alert({ kind = "info", children }: { kind?: "info" | "ok" | "err" | "warn"; children: ReactNode }) {
  return <div className={`alert ${kind}`} role={kind === "err" ? "alert" : "status"}>{children}</div>;
}

export function StatusBadge({ status, locked }: { status: UserStatus; locked?: boolean }) {
  const cls = status === "ACTIVE" ? "ok" : status === "INVITED" ? "info" : status === "SUSPENDED" ? "warn" : "err";
  return <><span className={`badge ${cls}`}>{STATUS_LABEL[status]}</span>{locked && <span className="badge err">{t("zablokowany")}</span>}</>;
}

/** Okno dialogowe (modalne): Escape zamyka, fokus na pierwszym polu, powrót fokusu po zamknięciu. */
export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);
  const id = useId();
  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="dialog-h"><h2 id={id}>{title}</h2><button type="button" className="btn ghost sm" onClick={onClose} aria-label={t("Zamknij")}>✕</button></header>
        <div className="dialog-b">{children}</div>
        {footer && <footer className="dialog-f">{footer}</footer>}
      </div>
    </div>
  );
}


/** Skrócony opis przeglądarki z User-Agent (lista sesji). */
export function uaLabel(ua: string | null | undefined): string {
  if (!ua) return "—";
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : t("przeglądarka");
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${b} · ${os}` : b;
}
