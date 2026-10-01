import { useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatQty, MONTH_NAMES, type SummaryRow } from "@resinvest/domain";
import { api, errorText } from "../api/client";
import { UNIT_LABEL, type Unit } from "../api/types";
import { SystemStatus } from "../app/SystemStatus";
import { useSession } from "../auth/session";
import { Alert } from "../ui/components";
import { useWarehouses } from "./account/AccountPage";
import { pln } from "./documents/OperationDetail";
import { useWorkWarehouse } from "./stock/StockPage";

interface DashboardView {
  month: string; from: string; to: string; warehouses: Array<{ id: string; name: string }>; inbound: number;
  totals: SummaryRow & { corrections: number };
  extras: { rows: Array<{ type: string; count: number; quantity: string; cost: string }>; total: string };
  stock: Array<{ materialId: string; name: string; unit: Unit; qty: string }>;
}
const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date()).slice(0, 7);
const shiftMonth = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/**
 * Pulpit miesiąca: wskaźniki (zakup, przychód, wynik, produkcja MP, operacje, korekty, MM do przyjęcia), kafel
 * „Operacje dodatkowe” wg rodzaju z wyborem miesiąca i bieżące stany. Magazyn roboczy albo wszystkie dostępne.
 */
function MonthBoard() {
  const W = useWorkWarehouse();
  const [all, setAll] = useState(false);
  const [month, setMonth] = useState(thisMonth());
  const wh = all ? "ALL" : W.id;
  const q = useQuery({ queryKey: ["dashboard", wh, month], enabled: !!wh, staleTime: 0, refetchOnMount: "always", placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<DashboardView>(`/dashboard?warehouseId=${wh}&month=${month}`, signal) });
  const label = `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
  const t = q.data?.totals;
  return (
    <section className="card" aria-labelledby="mb-h" id="dash-month">
      <header className="card-h"><h2 id="mb-h">Miesiąc w liczbach</h2>
        <div className="filters">
          <select className="ctrl" aria-label="Magazyn" id="dash-wh" value={wh} onChange={e => { if (e.target.value === "ALL") setAll(true); else { setAll(false); W.setId(e.target.value); } }}>
            {W.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}{W.warehouses.length > 1 && <option value="ALL">Wszystkie magazyny</option>}
          </select>
          <span className="month-nav">
            <button type="button" className="btn sm" aria-label="Poprzedni miesiąc" onClick={() => setMonth(m => shiftMonth(m, -1))}>‹</button>
            <input className="ctrl" type="month" id="dash-month-pick" aria-label="Miesiąc" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
            <button type="button" className="btn sm" aria-label="Następny miesiąc" onClick={() => setMonth(m => shiftMonth(m, 1))}>›</button>
          </span>
        </div></header>
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data || !t ? <p className="muted">Wczytywanie…</p> : <>
        <ul className="kpis" id="dash-kpis">
          <li><small>Zakup</small><strong>{pln(t.purchaseCost)}</strong><span className="muted small">{t.purchases} PZ</span></li>
          <li><small>Przychód</small><strong>{pln(t.revenue)}</strong><span className="muted small">{t.sales} WZ</span></li>
          <li><small>Wynik</small><strong className={Number(t.result) < 0 ? "neg" : "pos"}>{pln(t.result)}</strong><span className="muted small">bez wyceny zapasu</span></li>
          <li><small>Produkcja</small><strong>{formatQty(t.productionMp)} MP</strong><span className="muted small">{t.productions} PW na magazynie</span></li>
          <li><small>Operacje</small><strong>{t.operations}</strong><span className="muted small">korekty: {t.corrections}</span></li>
          <li><small>MM do przyjęcia</small><strong>{q.data.inbound}</strong>{q.data.inbound > 0 && <Link className="small" to="/dokumenty">przyjmij →</Link>}</li>
        </ul>
        <div className="dash-grid">
          <section className="tile-box" id="dash-extras" aria-labelledby="ex-h">
            <h3 id="ex-h">Operacje dodatkowe — {label}</h3>
            {q.data.extras.rows.length ? <div className="table-wrap"><table className="table">
              <thead><tr><th>Rodzaj</th><th className="r">Liczba</th><th className="r">Ilość</th><th className="r">Koszt</th></tr></thead>
              <tbody>{q.data.extras.rows.map(x => <tr key={x.type}><td data-label="Rodzaj">{x.type}</td><td data-label="Liczba" className="r num">{x.count}</td>
                <td data-label="Ilość" className="r num">{Number(x.quantity) ? formatQty(x.quantity) : "—"}</td><td data-label="Koszt" className="r num">{pln(x.cost)}</td></tr>)}</tbody>
              <tfoot><tr><td>Razem</td><td /><td /><td className="r num" id="dash-extras-total">{pln(q.data.extras.total)}</td></tr></tfoot>
            </table></div> : <p className="muted small">Brak operacji dodatkowych w tym miesiącu.</p>}
          </section>
          <section className="tile-box" id="dash-stock" aria-labelledby="st-h">
            <h3 id="st-h">Stany teraz</h3>
            {q.data.stock.length ? <ul className="plain">{q.data.stock.map(s => <li key={s.materialId} className="kv-row"><span>{s.name}</span><strong className="num">{formatQty(s.qty)} {UNIT_LABEL[s.unit]}</strong></li>)}</ul>
              : <p className="muted small">Brak towaru na stanie.</p>}
            <Link className="btn sm" to="/raporty">Raporty i eksport →</Link>
          </section>
        </div>
      </>}
    </section>
  );
}

/** Pulpit: powitanie, miesiąc w liczbach (z kaflem operacji dodatkowych), magazyny użytkownika, stan systemu. */
export function DashboardPage() {
  const { user, can } = useSession();
  const wh = useWarehouses();
  if (!user) return null;
  const def = wh.data?.find(w => w.id === user.defaultWarehouseId);
  return (
    <>
      <h1>Dzień dobry, {user.firstName}</h1>
      <p className="muted">Rola: <strong>{user.role.name}</strong>{def && <> · magazyn domyślny: <strong>{def.name}</strong></>}</p>
      {can("report.view") && <MonthBoard />}
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
