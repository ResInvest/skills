import type { ReactNode } from "react";

/** Układ ekranów bez logowania (logowanie, aktywacja, reset hasła, rejestracja). */
export function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth">
      <main className="auth-card" id="main">
        <div className="brand"><span className="mark" aria-hidden="true">RI</span><div><strong>ResInvest ERP</strong><small>ResInvest Commodities PL S.A.</small></div></div>
        <h1>{title}</h1>
        {children}
        {footer && <div className="auth-foot">{footer}</div>}
      </main>
      <footer className="foot">Program stworzony przez Roesner Mateusz dla ResInvest Commodities.</footer>
    </div>
  );
}
