import { fmtDay, fmtQty, t } from "../../i18n";
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "../../api/client";
import { CATEGORY_LABEL, MOVEMENT_LABEL, UNIT_LABEL, type BalanceRow, type BalancesResponse, type MovementRow, type Material } from "../../api/types";
import { useSession } from "../../auth/session";
import { Alert, Dialog, fmtDateTime } from "../../ui/components";
import { useWarehouses } from "../account/AccountPage";


/** Magazyn roboczy ekranu: wybrany przez użytkownika, a do czasu wyboru — domyślny albo pierwszy dostępny. */
export function useWorkWarehouse() {
  const { user } = useSession();
  const wh = useWarehouses();
  const [picked, setId] = useState("");
  const list = wh.data ?? [];
  const id = picked || (list.find(w => w.id === user?.defaultWarehouseId) ?? list[0])?.id || "";
  return { warehouses: list, loading: wh.isLoading, error: wh.error, id, setId };
}

/** Stany magazynowe: saldo każdego materiału w jednostce magazynowej (z księgi ruchów) + karta materiału. */
export function StockPage() {
  const W = useWorkWarehouse();
  const { can } = useSession();
  const [showAll, setShowAll] = useState(false);
  const [card, setCard] = useState<BalanceRow | null>(null);
  const q = useQuery({
    // stan musi być aktualny (inni użytkownicy księgują równocześnie) — zawsze świeży odczyt przy wejściu na ekran
    queryKey: ["stock", "balances", W.id, showAll], enabled: !!W.id, staleTime: 0, refetchOnMount: "always",
    queryFn: ({ signal }) => api.get<BalancesResponse>(`/stock/balances?warehouseId=${W.id}&all=${showAll ? 1 : 0}`, signal),
  });
  const groups = new Map<string, BalanceRow[]>();
  for (const b of q.data?.balances ?? []) groups.set(b.category, [...(groups.get(b.category) ?? []), b]);
  return (
    <>
      <h1>{t("Stany magazynowe")}</h1>
      <p className="muted small">{t("Stan = suma ruchów magazynowych (ruchów nie można zmienić ani usunąć). Ilości w jednostce magazynowej materiału.")}</p>
      <div className="filters">
        <label className="inline">{t("Magazyn")}{" "}
          <select className="ctrl" value={W.id} onChange={e => setW(e.target.value)} aria-label={t("Magazyn")}>
            {W.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="inline check"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> {t("Pokaż materiały nieaktywne")}</label>
      </div>
      {W.error ? <Alert kind="err">{errorText(W.error)}</Alert> : q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">{t("Wczytywanie…")}</p> : (
        <>
          {q.data.opening
            ? <Alert kind="ok">{t("Bilans otwarcia zatwierdzony na dzień {date}.", { date: fmtDay(q.data.opening.effectiveDate) })}</Alert>
            : <Alert kind="warn">{t("Magazyn nie ma jeszcze zatwierdzonego bilansu otwarcia.")} {(can("opening.manage") || can("opening.approve")) && <Link to="/bilans-otwarcia">{t("Przejdź do bilansu otwarcia")}</Link>}</Alert>}
          <div className="table-wrap">
            <table className="table" id="balances">
              <thead><tr><th>{t("Materiał")}</th><th className="r">{t("Stan")}</th><th>{t("Jedn.")}</th><th className="r">{t("Ruchy")}</th><th>{t("Ostatni ruch")}</th><th><span className="sr-only">{t("Akcje")}</span></th></tr></thead>
              {[...groups].map(([cat, rows]) => (
                <tbody key={cat}>
                  <tr className="group"><th colSpan={6}>{CATEGORY_LABEL[cat as Material["category"]] ?? cat}</th></tr>
                  {rows.map(b => (
                    <tr key={b.materialId} className={b.active ? "" : "dim"}>
                      <td data-label={t("Materiał")}><strong>{b.name}</strong> <small className="muted">{b.code}{b.active ? "" : ` · ${t("nieaktywny")}`}</small></td>
                      <td data-label={t("Stan")} className="r num"><strong>{fmtQty(b.qty)}</strong></td>
                      <td data-label={t("Jedn.")}>{UNIT_LABEL[b.unit]}</td>
                      <td data-label={t("Ruchy")} className="r">{b.movements}</td>
                      <td data-label={t("Ostatni ruch")}>{fmtDateTime(b.lastMovementAt)}</td>
                      <td data-label={t("Akcje")}><button type="button" className="btn sm" onClick={() => setCard(b)} disabled={!b.movements} aria-label={`${t("Karta materiału")} ${b.name}`}>{t("Karta materiału")}</button></td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}
      {card && <MaterialCard warehouseId={W.id} row={card} onClose={() => setCard(null)} />}
    </>
  );
  function setW(id: string) { setCard(null); W.setId(id); }
}

/** Karta materiału: ruchy ze stanem przed / po, dokumentem i użytkownikiem; filtr dat. */
function MaterialCard({ warehouseId, row, onClose }: { warehouseId: string; row: BalanceRow; onClose: () => void }) {
  const [f, setF] = useState({ from: "", to: "" });
  const q = useQuery({
    queryKey: ["stock", "movements", warehouseId, row.materialId, f], staleTime: 0, refetchOnMount: "always",
    queryFn: ({ signal }) => api.get<{ balance: string; movements: MovementRow[] }>(`/stock/movements?warehouseId=${warehouseId}&materialId=${row.materialId}${f.from ? `&from=${f.from}` : ""}${f.to ? `&to=${f.to}` : ""}`, signal),
  });
  const u = UNIT_LABEL[row.unit];
  return (
    <Dialog title={`${t("Karta materiału")} — ${row.name}`} onClose={onClose}>
      <p>{t("Stan bieżący:")} <strong id="card-balance">{q.data ? `${fmtQty(q.data.balance)} ${u}` : "…"}</strong></p>
      <div className="filters">
        <label className="inline">{t("Od")} <input className="ctrl" type="date" value={f.from} onChange={e => setF(s => ({ ...s, from: e.target.value }))} /></label>
        <label className="inline">{t("Do")} <input className="ctrl" type="date" value={f.to} onChange={e => setF(s => ({ ...s, to: e.target.value }))} /></label>
      </div>
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">{t("Wczytywanie…")}</p> : (
        <div className="table-wrap">
          <table className="table" id="movements">
            <thead><tr><th>{t("Data")}</th><th>{t("Rodzaj")}</th><th>{t("Dokument")}</th><th className="r">{t("Przed")}</th><th className="r">{t("Zmiana")}</th><th className="r">{t("Po")}</th><th>{t("Użytkownik")}</th></tr></thead>
            <tbody>
              {q.data.movements.map(m => (
                <tr key={m.id}>
                  <td data-label={t("Data")}>{fmtDay(m.movementDate)}</td>
                  <td data-label={t("Rodzaj")}>{MOVEMENT_LABEL[m.kind] ?? m.kind}</td>
                  <td data-label={t("Dokument")}>{m.document ? <span className="doc">{m.document.number}</span> : "—"}</td>
                  <td data-label={t("Przed")} className="r num">{fmtQty(m.before)} {u}</td>
                  <td data-label={t("Zmiana")} className={`r num ${Number(m.qty) < 0 ? "neg" : "pos"}`}>{Number(m.qty) > 0 ? "+" : ""}{fmtQty(m.qty)}</td>
                  <td data-label={t("Po")} className="r num"><strong>{fmtQty(m.after)} {u}</strong></td>
                  <td data-label={t("Użytkownik")}>{m.user ?? "—"}</td>
                </tr>
              ))}
              {!q.data.movements.length && <tr><td colSpan={7} className="muted">{t("Brak ruchów w wybranym zakresie.")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
