import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useSession } from "../auth/session";
import { LangSwitch } from "../app/prefs";
import { m, t } from "../i18n";

/** Pozycje nawigacji — widoczne wg uprawnień z serwera (API i tak sprawdza każde żądanie). */
export const NAV: ReadonlyArray<{ to: string; label: string; perm?: string }> = [
  { to: "/", label: m("Pulpit") },
  { to: "/stany", label: m("Stany magazynowe"), perm: "report.view" },
  { to: "/nowa-operacja", label: m("Nowa operacja"), perm: "receipts.create|issues.create|production.create" },
  { to: "/dokumenty", label: m("Dokumenty"), perm: "report.view" },
  { to: "/planer-zakupow", label: m("Planer zakupów"), perm: "report.view" },
  { to: "/raporty", label: m("Raporty"), perm: "report.view" },
  { to: "/kartoteki", label: m("Kartoteki"), perm: "report.view" },
  { to: "/bilans-otwarcia", label: m("Bilans otwarcia"), perm: "opening.manage|opening.approve" },
  { to: "/uzytkownicy", label: m("Użytkownicy"), perm: "users.read" },
  { to: "/role", label: m("Role i uprawnienia"), perm: "users.read" },
  { to: "/audyt", label: m("Dziennik audytu"), perm: "audit.read" },
  { to: "/poczta", label: m("Poczta"), perm: "notifications.manage" },
  { to: "/konto", label: m("Moje konto") },
];

export function Shell() {
  const { user, can, logout } = useSession();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  if (!user) return null;
  const doLogout = async () => { await logout(); void nav("/logowanie", { replace: true }); };
  return (
    <div className="shell">
      <a className="skip" href="#main">{t("Przejdź do treści")}</a>
      <header className="topbar">
        <div className="brand"><span className="mark" aria-hidden="true">RI</span><div><strong>{t("ResInvest ERP")}</strong><small>{user.role.name}</small></div></div>
        <button type="button" className="btn ghost menu-btn" aria-expanded={open} aria-controls="nav" onClick={() => setOpen(o => !o)}>{t("Menu")}</button>
        <nav id="nav" className={`nav ${open ? "open" : ""}`} aria-label={t("Główna nawigacja")} onClick={e => { if ((e.target as HTMLElement).closest("a")) setOpen(false); /* menu mobilne zamyka się po wyborze */ }}>
          {NAV.filter(n => !n.perm || n.perm.split("|").some(p => can(p))).map(n => <NavLink key={n.to} to={n.to} end={n.to === "/"}>{t(n.label)}</NavLink>)}
        </nav>
        <div className="who">
          <LangSwitch compact />
          <span className="who-name" title={user.email}>{user.firstName} {user.lastName}</span>
          <button type="button" className="btn sm" onClick={() => void doLogout()}>{t("Wyloguj")}</button>
        </div>
      </header>
      <main className="main" id="main"><Outlet /></main>
      <footer className="foot">{t("Program stworzony przez Roesner Mateusz dla ResInvest Commodities.")}</footer>
    </div>
  );
}
