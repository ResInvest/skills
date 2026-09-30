import { SystemStatus } from "./SystemStatus";

export function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark" aria-hidden="true">RI</span><div><strong>ResInvest ERP</strong><small>wersja 4 · środowisko przedprodukcyjne</small></div></div>
      </header>
      <main className="main" id="main">
        <h1>ResInvest ERP 4</h1>
        <p className="muted">System magazynowy i obrotu biomasą — wielu użytkowników, wiele magazynów, centralna baza PostgreSQL.</p>
        <SystemStatus />
      </main>
      <footer className="foot">Program stworzony przez Roesner Mateusz dla ResInvest Commodities.</footer>
    </div>
  );
}
