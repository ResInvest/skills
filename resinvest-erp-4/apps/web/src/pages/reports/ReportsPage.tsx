import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatQty, MONTH_NAMES, periodBounds, PERIOD_LABEL, TURNOVER_LABEL, type PeriodKind, type SummaryRow, type TurnoverRow } from "@resinvest/domain";
import { api, errorText } from "../../api/client";
import { UNIT_LABEL, type Unit } from "../../api/types";
import { Alert } from "../../ui/components";
import { ExportButtons } from "../../ui/download";
import { ColumnHelp, TutorialToggle } from "../../ui/tutorial";
import { useWorkWarehouse } from "../stock/StockPage";
import { pln } from "../documents/OperationDetail";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
type Wh = { id: string; code: string; name: string };
interface TurnoverView { from: string; to: string; warehouses: Wh[]; rows: Array<TurnoverRow & { material: { id: string; code: string; name: string; unit: Unit } }>; check: { ok: boolean; mismatches: Array<{ materialId: string; fromMovements: string; balance: string }> } | null }
interface SummaryView { year: number; warehouses: Wh[]; months: SummaryRow[]; total: SummaryRow }

/** Magazyn raportu: magazyn roboczy albo „wszystkie dostępne” (gdy użytkownik ma więcej niż jeden). */
function useReportWarehouse() {
  const W = useWorkWarehouse();
  const [all, setAll] = useState(false);
  return { ...W, value: all ? "ALL" : W.id, set: (v: string) => { if (v === "ALL") setAll(true); else { setAll(false); W.setId(v); } } };
}
function WarehouseSelect({ R }: { R: ReturnType<typeof useReportWarehouse> }) {
  return (
    <select className="ctrl" aria-label="Magazyn" id="rp-wh" value={R.value} onChange={e => R.set(e.target.value)}>
      {R.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      {R.warehouses.length > 1 && <option value="ALL">Wszystkie magazyny</option>}
    </select>
  );
}

/**
 * Raporty (F6): obroty magazynowe za dowolny okres (dzień, tydzień, miesiąc, kwartał, rok albo zakres) z kontrolą
 * spójności z saldami oraz zestawienie miesięczne i roczne. Każdy raport można wyeksportować do CSV, Excela, PDF i Worda.
 */
export function ReportsPage() {
  const [tab, setTab] = useState<"turnover" | "summary">("turnover");
  const R = useReportWarehouse();
  return (
    <>
      <div className="page-h">
        <div><h1>Raporty</h1><p className="muted small">Liczone z księgi ruchów i zatwierdzonych dokumentów (usunięte pominięte, korekty uwzględnione). Eksport: CSV, Excel, PDF, Word.</p></div>
        <TutorialToggle />
      </div>
      <div className="tabs" role="tablist" aria-label="Raport">
        <button type="button" role="tab" id="rp-tab-turnover" aria-selected={tab === "turnover"} className={tab === "turnover" ? "on" : ""} onClick={() => setTab("turnover")}>Obroty magazynowe</button>
        <button type="button" role="tab" id="rp-tab-summary" aria-selected={tab === "summary"} className={tab === "summary" ? "on" : ""} onClick={() => setTab("summary")}>Miesiące i rok</button>
      </div>
      {!R.value ? <p className="muted">Wczytywanie…</p> : tab === "turnover" ? <Turnover R={R} /> : <Summary R={R} />}
    </>
  );
}

const TURNOVER_HELP = [
  ["Stan początkowy", "Stan na koniec dnia poprzedzającego okres — suma wszystkich ruchów wcześniejszych."],
  [`${TURNOVER_LABEL.purchase} / ${TURNOVER_LABEL.production} / ${TURNOVER_LABEL.transferIn} / ${TURNOVER_LABEL.opening}`, "Przychody w okresie wg rodzaju dokumentu. Korekty i usunięcia są już uwzględnione w kolumnie dokumentu, którego dotyczą."],
  [`${TURNOVER_LABEL.sale} / ${TURNOVER_LABEL.consumption} / ${TURNOVER_LABEL.transferOut}`, "Rozchody w okresie (liczby dodatnie)."],
  ["W tym korekty", "Ile z powyższych to odwrócenia ruchów (korekty i usunięcia) — ze znakiem."],
  ["Stan końcowy", "Stan początkowy + przychody − rozchody. Dla okresu kończącego się dziś porównywany z saldami (kontrola spójności)."],
] as const;

function Turnover({ R }: { R: ReturnType<typeof useReportWarehouse> }) {
  const [kind, setKind] = useState<PeriodKind | "range">("month");
  const [anchor, setAnchor] = useState(today());
  const [range, setRange] = useState({ from: today().slice(0, 8) + "01", to: today() });
  const { from, to } = kind === "range" ? range : periodBounds(kind, anchor || today());
  const ok = !!from && !!to && from <= to;
  const q = useQuery({ queryKey: ["reports", "turnover", R.value, from, to], enabled: ok, staleTime: 0, placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<TurnoverView>(`/reports/turnover?warehouseId=${R.value}&from=${from}&to=${to}`, signal) });
  const n = (v: string) => (Number(v) ? formatQty(v) : "");
  return (
    <section className="card">
      <div className="filters" role="search">
        <WarehouseSelect R={R} />
        <select className="ctrl" aria-label="Okres" id="rp-period" value={kind} onChange={e => setKind(e.target.value as PeriodKind | "range")}>
          {(Object.keys(PERIOD_LABEL) as PeriodKind[]).map(k => <option key={k} value={k}>{PERIOD_LABEL[k]}</option>)}<option value="range">Zakres dat</option>
        </select>
        {kind === "range" ? <>
          <label className="inline">Od <input className="ctrl" type="date" id="rp-from" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} /></label>
          <label className="inline">Do <input className="ctrl" type="date" id="rp-to" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} /></label>
        </> : <label className="inline">Dzień w okresie <input className="ctrl" type="date" id="rp-anchor" value={anchor} onChange={e => setAnchor(e.target.value)} /></label>}
      </div>
      <p className="muted small" id="rp-range">Okres: <strong>{from} – {to}</strong></p>
      {!ok ? <Alert kind="err">Data „od” jest późniejsza niż „do”.</Alert> : q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">Wczytywanie…</p> : (
        <>
          {q.data.check && (q.data.check.ok
            ? <Alert kind="ok"><span id="rp-check">Kontrola spójności: stany końcowe zgodne z saldami magazynu.</span></Alert>
            : <Alert kind="err"><span id="rp-check">Kontrola spójności: niezgodność w {q.data.check.mismatches.length} pozycjach — zgłoś administratorowi.</span></Alert>)}
          <div className="table-wrap"><table className="table" id="rp-turnover">
            <thead><tr><th>Materiał</th><th className="r">Stan początkowy</th><th className="r">{TURNOVER_LABEL.opening}</th><th className="r">{TURNOVER_LABEL.purchase}</th>
              <th className="r">{TURNOVER_LABEL.production}</th><th className="r">{TURNOVER_LABEL.transferIn}</th><th className="r">{TURNOVER_LABEL.sale}</th>
              <th className="r">{TURNOVER_LABEL.consumption}</th><th className="r">{TURNOVER_LABEL.transferOut}</th><th className="r">W tym korekty</th><th className="r">Stan końcowy</th></tr></thead>
            <tbody>{q.data.rows.map(r => (
              <tr key={r.materialId} data-material={r.material.code}>
                <td data-label="Materiał">{r.material.name} <small className="muted">{UNIT_LABEL[r.material.unit]}</small></td>
                <td data-label="Stan początkowy" className="r num">{formatQty(r.start)}</td>
                <td data-label={TURNOVER_LABEL.opening} className="r num">{n(r.opening)}</td>
                <td data-label={TURNOVER_LABEL.purchase} className="r num">{n(r.purchase)}</td>
                <td data-label={TURNOVER_LABEL.production} className="r num">{n(r.production)}</td>
                <td data-label={TURNOVER_LABEL.transferIn} className="r num">{n(r.transferIn)}</td>
                <td data-label={TURNOVER_LABEL.sale} className="r num">{n(r.sale)}</td>
                <td data-label={TURNOVER_LABEL.consumption} className="r num">{n(r.consumption)}</td>
                <td data-label={TURNOVER_LABEL.transferOut} className="r num">{n(r.transferOut)}</td>
                <td data-label="W tym korekty" className="r num muted">{n(r.reversals)}</td>
                <td data-label="Stan końcowy" className="r num"><strong>{formatQty(r.end)}</strong></td>
              </tr>))}
              {!q.data.rows.length && <tr><td colSpan={11} className="muted">Brak stanów i ruchów w tym okresie.</td></tr>}</tbody>
          </table></div>
          <ColumnHelp id="rp-turnover-cols" items={TURNOVER_HELP} />
          <ExportButtons query={{ report: "turnover", warehouseId: R.value, from, to }} />
        </>
      )}
    </section>
  );
}

const SUMMARY_HELP = [
  ["Operacje", "Liczba zatwierdzonych operacji w miesiącu (zakupy, sprzedaże, produkcje, MM); usunięte pominięte."],
  ["Zakup / Przychód", "Wartości netto z dokumentów PZ i WZ po korektach."],
  ["Rąbanie / Transport / Dodatkowe", "Koszty z produkcji, dokumentów TR i operacji dodatkowych."],
  ["Wynik", "Przychód − zakup − rąbanie − transport − operacje dodatkowe (orientacyjnie, bez wyceny zapasu)."],
  ["Produkcja [MP]", "Zrębka wyprodukowana w miesiącu: na magazynie, z zakupu i w lesie."],
  ["Korekty / Usunięcia", "Ile korekt i usunięć wykonano w miesiącu (wg daty wykonania)."],
] as const;

function Summary({ R }: { R: ReturnType<typeof useReportWarehouse> }) {
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const q = useQuery({ queryKey: ["reports", "summary", R.value, year], staleTime: 0, placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<SummaryView>(`/reports/summary?warehouseId=${R.value}&year=${year}`, signal) });
  const row = (m: SummaryRow, label: string, cls = "") => (
    <tr key={label} className={cls} data-month={m.month || "total"}>
      <td data-label="Miesiąc">{label}</td><td data-label="Operacje" className="r num">{m.operations || ""}</td>
      <td data-label="Zakup" className="r num">{Number(m.purchaseCost) ? pln(m.purchaseCost) : ""}</td>
      <td data-label="Przychód" className="r num">{Number(m.revenue) ? pln(m.revenue) : ""}</td>
      <td data-label="Rąbanie" className="r num">{Number(m.chippingCost) ? pln(m.chippingCost) : ""}</td>
      <td data-label="Transport" className="r num">{Number(m.transportCost) ? pln(m.transportCost) : ""}</td>
      <td data-label="Dodatkowe" className="r num">{Number(m.additionalCost) ? pln(m.additionalCost) : ""}</td>
      <td data-label="Wynik" className={`r num ${Number(m.result) < 0 ? "neg" : Number(m.result) > 0 ? "pos" : ""}`}>{m.operations ? pln(m.result) : ""}</td>
      <td data-label="Produkcja [MP]" className="r num">{Number(m.productionMp) ? formatQty(m.productionMp) : ""}</td>
      <td data-label="Korekty" className="r num">{m.corrections || ""}</td><td data-label="Usunięcia" className="r num">{m.deletions || ""}</td>
    </tr>);
  return (
    <section className="card">
      <div className="filters">
        <WarehouseSelect R={R} />
        <button type="button" className="btn sm" aria-label="Poprzedni rok" onClick={() => setYear(y => y - 1)}>‹</button>
        <strong className="num" id="rp-year">{year}</strong>
        <button type="button" className="btn sm" aria-label="Następny rok" onClick={() => setYear(y => y + 1)}>›</button>
      </div>
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">Wczytywanie…</p> : (
        <>
          <div className="table-wrap"><table className="table" id="rp-summary">
            <thead><tr><th>Miesiąc</th><th className="r">Operacje</th><th className="r">Zakup</th><th className="r">Przychód</th><th className="r">Rąbanie</th><th className="r">Transport</th>
              <th className="r">Dodatkowe</th><th className="r">Wynik</th><th className="r">Produkcja [MP]</th><th className="r">Korekty</th><th className="r">Usunięcia</th></tr></thead>
            <tbody>{q.data.months.map((m, i) => row(m, MONTH_NAMES[i]!))}</tbody>
            <tfoot>{row(q.data.total, `Rok ${q.data.year}`, "total")}</tfoot>
          </table></div>
          <ColumnHelp id="rp-summary-cols" items={SUMMARY_HELP} />
          <ExportButtons query={{ report: "summary", warehouseId: R.value, year }} />
        </>
      )}
    </section>
  );
}
