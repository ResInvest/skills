import { useState } from "react";
import { fmtQty, m, monthName, t, tm } from "../../i18n";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { periodBounds, PERIOD_LABEL, TURNOVER_LABEL, type PeriodKind, type SummaryRow, type TurnoverRow } from "@resinvest/domain";
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
    <select className="ctrl" aria-label={t("Magazyn")} id="rp-wh" value={R.value} onChange={e => R.set(e.target.value)}>
      {R.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      {R.warehouses.length > 1 && <option value="ALL">{t("Wszystkie magazyny")}</option>}
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
        <div><h1>{t("Raporty")}</h1><p className="muted small">{t("Liczone z księgi ruchów i zatwierdzonych dokumentów (usunięte pominięte, korekty uwzględnione). Eksport: CSV, Excel, PDF, Word.")}</p></div>
        <TutorialToggle />
      </div>
      <div className="tabs" role="tablist" aria-label={t("Raport")}>
        <button type="button" role="tab" id="rp-tab-turnover" aria-selected={tab === "turnover"} className={tab === "turnover" ? "on" : ""} onClick={() => setTab("turnover")}>{t("Obroty magazynowe")}</button>
        <button type="button" role="tab" id="rp-tab-summary" aria-selected={tab === "summary"} className={tab === "summary" ? "on" : ""} onClick={() => setTab("summary")}>{t("Miesiące i rok")}</button>
      </div>
      {!R.value ? <p className="muted">{t("Wczytywanie…")}</p> : tab === "turnover" ? <Turnover R={R} /> : <Summary R={R} />}
    </>
  );
}

const TURNOVER_HELP = [
  [m("Stan początkowy"), m("Stan na koniec dnia poprzedzającego okres — suma wszystkich ruchów wcześniejszych.")],
  [m("Bilans otwarcia / Zakup (PZ) / Produkcja (PW) / MM przychód"), m("Przychody w okresie wg rodzaju dokumentu. Korekty i usunięcia są już uwzględnione w kolumnie dokumentu, którego dotyczą.")],
  [m("Sprzedaż (WZ) / Zużycie (RW) / MM rozchód"), m("Rozchody w okresie (liczby dodatnie).")],
  [m("W tym korekty"), m("Ile z powyższych to odwrócenia ruchów (korekty i usunięcia) — ze znakiem.")],
  [m("Stan końcowy"), m("Stan początkowy + przychody − rozchody. Dla okresu kończącego się dziś porównywany z saldami (kontrola spójności).")],
] as const;

function Turnover({ R }: { R: ReturnType<typeof useReportWarehouse> }) {
  const [kind, setKind] = useState<PeriodKind | "range">("month");
  const [anchor, setAnchor] = useState(today());
  const [range, setRange] = useState({ from: today().slice(0, 8) + "01", to: today() });
  const { from, to } = kind === "range" ? range : periodBounds(kind, anchor || today());
  const ok = !!from && !!to && from <= to;
  const q = useQuery({ queryKey: ["reports", "turnover", R.value, from, to], enabled: ok, staleTime: 0, placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<TurnoverView>(`/reports/turnover?warehouseId=${R.value}&from=${from}&to=${to}`, signal) });
  const n = (v: string) => (Number(v) ? fmtQty(v) : "");
  return (
    <section className="card">
      <div className="filters" role="search">
        <WarehouseSelect R={R} />
        <select className="ctrl" aria-label={t("Okres")} id="rp-period" value={kind} onChange={e => setKind(e.target.value as PeriodKind | "range")}>
          {(Object.keys(PERIOD_LABEL) as PeriodKind[]).map(k => <option key={k} value={k}>{tm(PERIOD_LABEL[k])}</option>)}<option value="range">{t("Zakres dat")}</option>
        </select>
        {kind === "range" ? <>
          <label className="inline">{t("Od")} <input className="ctrl" type="date" id="rp-from" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} /></label>
          <label className="inline">{t("Do")} <input className="ctrl" type="date" id="rp-to" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} /></label>
        </> : <label className="inline">{t("Dzień w okresie")} <input className="ctrl" type="date" id="rp-anchor" value={anchor} onChange={e => setAnchor(e.target.value)} /></label>}
      </div>
      <p className="muted small" id="rp-range">{t("Okres:")} <strong>{from} – {to}</strong></p>
      {!ok ? <Alert kind="err">{t("Data „od” jest późniejsza niż „do”.")}</Alert> : q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">{t("Wczytywanie…")}</p> : (
        <>
          {q.data.check && (q.data.check.ok
            ? <Alert kind="ok"><span id="rp-check">{t("Kontrola spójności: stany końcowe zgodne z saldami magazynu.")}</span></Alert>
            : <Alert kind="err"><span id="rp-check">{t("Kontrola spójności: niezgodność w {n} pozycjach — zgłoś administratorowi.", { n: q.data.check.mismatches.length })}</span></Alert>)}
          <div className="table-wrap"><table className="table" id="rp-turnover">
            <thead><tr><th>{t("Materiał")}</th><th className="r">{t("Stan początkowy")}</th><th className="r">{tm(TURNOVER_LABEL.opening)}</th><th className="r">{tm(TURNOVER_LABEL.purchase)}</th>
              <th className="r">{tm(TURNOVER_LABEL.production)}</th><th className="r">{tm(TURNOVER_LABEL.transferIn)}</th><th className="r">{tm(TURNOVER_LABEL.sale)}</th>
              <th className="r">{tm(TURNOVER_LABEL.consumption)}</th><th className="r">{tm(TURNOVER_LABEL.transferOut)}</th><th className="r">{t("W tym korekty")}</th><th className="r">{t("Stan końcowy")}</th></tr></thead>
            <tbody>{q.data.rows.map(r => (
              <tr key={r.materialId} data-material={r.material.code}>
                <td data-label={t("Materiał")}>{r.material.name} <small className="muted">{UNIT_LABEL[r.material.unit]}</small></td>
                <td data-label={t("Stan początkowy")} className="r num">{fmtQty(r.start)}</td>
                <td data-label={tm(TURNOVER_LABEL.opening)} className="r num">{n(r.opening)}</td>
                <td data-label={tm(TURNOVER_LABEL.purchase)} className="r num">{n(r.purchase)}</td>
                <td data-label={tm(TURNOVER_LABEL.production)} className="r num">{n(r.production)}</td>
                <td data-label={tm(TURNOVER_LABEL.transferIn)} className="r num">{n(r.transferIn)}</td>
                <td data-label={tm(TURNOVER_LABEL.sale)} className="r num">{n(r.sale)}</td>
                <td data-label={tm(TURNOVER_LABEL.consumption)} className="r num">{n(r.consumption)}</td>
                <td data-label={tm(TURNOVER_LABEL.transferOut)} className="r num">{n(r.transferOut)}</td>
                <td data-label={t("W tym korekty")} className="r num muted">{n(r.reversals)}</td>
                <td data-label={t("Stan końcowy")} className="r num"><strong>{fmtQty(r.end)}</strong></td>
              </tr>))}
              {!q.data.rows.length && <tr><td colSpan={11} className="muted">{t("Brak stanów i ruchów w tym okresie.")}</td></tr>}</tbody>
          </table></div>
          <ColumnHelp id="rp-turnover-cols" items={TURNOVER_HELP} />
          <ExportButtons query={{ report: "turnover", warehouseId: R.value, from, to }} />
        </>
      )}
    </section>
  );
}

const SUMMARY_HELP = [
  [m("Operacje"), m("Liczba zatwierdzonych operacji w miesiącu (zakupy, sprzedaże, produkcje, MM); usunięte pominięte.")],
  [m("Zakup / Przychód"), m("Wartości netto z dokumentów PZ i WZ po korektach.")],
  [m("Rąbanie / Transport / Dodatkowe"), m("Koszty z produkcji, dokumentów TR i operacji dodatkowych.")],
  [m("Wynik"), m("Przychód − zakup − rąbanie − transport − operacje dodatkowe (orientacyjnie, bez wyceny zapasu).")],
  [m("Produkcja [MP]"), m("Zrębka wyprodukowana w miesiącu: na magazynie, z zakupu i w lesie.")],
  [m("Korekty / Usunięcia"), m("Ile korekt i usunięć wykonano w miesiącu (wg daty wykonania).")],
] as const;

function Summary({ R }: { R: ReturnType<typeof useReportWarehouse> }) {
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const q = useQuery({ queryKey: ["reports", "summary", R.value, year], staleTime: 0, placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<SummaryView>(`/reports/summary?warehouseId=${R.value}&year=${year}`, signal) });
  const row = (r: SummaryRow, label: string, cls = "") => (
    <tr key={label} className={cls} data-month={r.month || "total"}>
      <td data-label={t("Miesiąc")}>{label}</td><td data-label={t("Operacje")} className="r num">{r.operations || ""}</td>
      <td data-label={t("Zakup")} className="r num">{Number(r.purchaseCost) ? pln(r.purchaseCost) : ""}</td>
      <td data-label={t("Przychód")} className="r num">{Number(r.revenue) ? pln(r.revenue) : ""}</td>
      <td data-label={t("Rąbanie")} className="r num">{Number(r.chippingCost) ? pln(r.chippingCost) : ""}</td>
      <td data-label={t("Transport")} className="r num">{Number(r.transportCost) ? pln(r.transportCost) : ""}</td>
      <td data-label={t("Dodatkowe")} className="r num">{Number(r.additionalCost) ? pln(r.additionalCost) : ""}</td>
      <td data-label={t("Wynik")} className={`r num ${Number(r.result) < 0 ? "neg" : Number(r.result) > 0 ? "pos" : ""}`}>{r.operations ? pln(r.result) : ""}</td>
      <td data-label={t("Produkcja [MP]")} className="r num">{Number(r.productionMp) ? fmtQty(r.productionMp) : ""}</td>
      <td data-label={t("Korekty")} className="r num">{r.corrections || ""}</td><td data-label={t("Usunięcia")} className="r num">{r.deletions || ""}</td>
    </tr>);
  return (
    <section className="card">
      <div className="filters">
        <WarehouseSelect R={R} />
        <button type="button" className="btn sm" aria-label={t("Poprzedni rok")} onClick={() => setYear(y => y - 1)}>‹</button>
        <strong className="num" id="rp-year">{year}</strong>
        <button type="button" className="btn sm" aria-label={t("Następny rok")} onClick={() => setYear(y => y + 1)}>›</button>
      </div>
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">{t("Wczytywanie…")}</p> : (
        <>
          <div className="table-wrap"><table className="table" id="rp-summary">
            <thead><tr><th>{t("Miesiąc")}</th><th className="r">{t("Operacje")}</th><th className="r">{t("Zakup")}</th><th className="r">{t("Przychód")}</th><th className="r">{t("Rąbanie")}</th><th className="r">{t("Transport")}</th>
              <th className="r">{t("Dodatkowe")}</th><th className="r">{t("Wynik")}</th><th className="r">{t("Produkcja [MP]")}</th><th className="r">{t("Korekty")}</th><th className="r">{t("Usunięcia")}</th></tr></thead>
            <tbody>{q.data.months.map((x, i) => row(x, monthName(i + 1)))}</tbody>
            <tfoot>{row(q.data.total, t("Rok {year}", { year: q.data.year }), "total")}</tfoot>
          </table></div>
          <ColumnHelp id="rp-summary-cols" items={SUMMARY_HELP} />
          <ExportButtons query={{ report: "summary", warehouseId: R.value, year }} />
        </>
      )}
    </section>
  );
}
