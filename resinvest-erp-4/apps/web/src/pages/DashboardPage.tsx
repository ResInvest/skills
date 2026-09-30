import { Link } from "react-router";
import { SystemStatus } from "../app/SystemStatus";
import { useSession } from "../auth/session";
import { useWarehouses } from "./account/AccountPage";

/** Pulpit (F2): powitanie, magazyny użytkownika, stan systemu. Kafle operacyjne — od fazy F3. */
export function DashboardPage() {
  const { user, can } = useSession();
  const wh = useWarehouses();
  if (!user) return null;
  const def = wh.data?.find(w => w.id === user.defaultWarehouseId);
  return (
    <>
      <h1>Dzień dobry, {user.firstName}</h1>
      <p className="muted">Rola: <strong>{user.role.name}</strong>{def && <> · magazyn domyślny: <strong>{def.name}</strong></>}</p>
      <section className="card" aria-labelledby="wh-h">
        <header className="card-h"><h2 id="wh-h">Twoje magazyny</h2>{user.role.global && <span className="badge info">dostęp do wszystkich</span>}</header>
        {wh.isPending ? <p className="muted">Wczytywanie…</p> : wh.data?.length ? (
          <ul className="tiles">
            {wh.data.map(w => <li key={w.id} className="tile"><strong>{w.name}</strong><small className="muted">{w.code}{w.address ? ` · ${w.address}` : ""}</small>{!w.active && <span className="badge warn">nieaktywny</span>}</li>)}
          </ul>
        ) : <p className="muted">Nie masz przydzielonych magazynów — skontaktuj się z administratorem.</p>}
      </section>
      {(can("users.read") || can("audit.read")) && (
        <section className="card" aria-labelledby="adm-h">
          <header className="card-h"><h2 id="adm-h">Administracja</h2></header>
          <div className="actions">
            {can("users.read") && <Link className="btn" to="/uzytkownicy">Użytkownicy</Link>}
            {can("users.read") && <Link className="btn" to="/role">Role i uprawnienia</Link>}
            {can("audit.read") && <Link className="btn" to="/audyt">Dziennik audytu</Link>}
          </div>
        </section>
      )}
      <SystemStatus />
    </>
  );
}
