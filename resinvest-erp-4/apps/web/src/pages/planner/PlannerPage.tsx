import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatQty, plannerDrivers, plannerMonths, type PlannerDay, type PlannerOp, type PlannerTotals } from "@resinvest/domain";
import { ApiRequestError, api, errorText } from "../../api/client";
import { useSession } from "../../auth/session";
import { Alert } from "../../ui/components";
import { useWorkWarehouse } from "../stock/StockPage";
import { DocBadge, pln } from "../documents/OperationDetail";

interface PlannerView {
  warehouses: string[]; today: string; tonPerMp: string; editable: boolean;
  days: PlannerDay[]; totals: PlannerTotals; drivers: ReturnType<typeof plannerDrivers>;
  plans: Array<{ date: string; warehouseId: string; planMp: string; note: string | null; version: number }>;
  ops: PlannerOp[];
}
type Tab = "week" | "year" | "fleet" | "src";
const DN = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
const MN = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];

// --- daty (UTC, bez stref) ---
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dow = (s: string) => (D(s).getUTCDay() + 6) % 7;
const weekStart = (s: string) => addDays(s, -dow(s));
function isoWeek(s: string) { const d = D(s); d.setUTCDate(d.getUTCDate() + 3 - dow(s)); const y = d.getUTCFullYear(); const j = new Date(Date.UTC(y, 0, 4)); return 1 + Math.round(((d.getTime() - j.getTime()) / 864e5 - 3 + ((j.getUTCDay() + 6) % 7)) / 7); }
const ddmm = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
const todayLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
const nf = (v: string | number | null | undefined, dp = 0) => (v === null || v === undefined ? "–" : Number(v).toLocaleString("pl-PL", { minimumFractionDigits: dp, maximumFractionDigits: dp }));

/**
 * Planer zakupów: plan dnia wpisywany ręcznie (z historią w dzienniku audytu), a wykonanie, tony, ceny, km, transport
 * i kursy kierowców — z dokumentów (PZ / PW / TR). Wartości AUTO poprawia się korektą dokumentu, nie w planerze.
 */
export function PlannerPage() {
  const W = useWorkWarehouse();
  const { can } = useSession();
  const [wh, setWh] = useState<string>("");
  const whId = wh || W.id;
  const [tab, setTab] = useState<Tab>("week");
  const [week, setWeek] = useState(() => weekStart(todayLocal()));
  const [year, setYear] = useState(() => Number(todayLocal().slice(0, 4)));
  const [month, setMonth] = useState(() => Number(todayLocal().slice(5, 7)) - 1);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [fleetDay, setFleetDay] = useState<string | null>(null);
  const days7 = [...Array(7)].map((_, i) => addDays(week, i));
  const range = tab === "year" ? { from: `${year}-01-01`, to: `${year}-12-31` } : { from: days7[0]!, to: days7[6]! };
  const qs = `warehouseId=${whId}&from=${range.from}&to=${range.to}`;
  const q = useQuery({ queryKey: ["planner", qs], enabled: !!whId, staleTime: 0, refetchOnMount: "always", placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<PlannerView>(`/planner?${qs}`, signal) });
  // KPI zawsze dla wybranego tygodnia
  const weekQs = `warehouseId=${whId}&from=${days7[0]}&to=${days7[6]}`;
  const wq = useQuery({ queryKey: ["planner", weekQs], enabled: !!whId, staleTime: 0, placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<PlannerView>(`/planner?${weekQs}`, signal) });
  const shift = (n: number) => { if (tab === "year") setYear(y => y + n); else setWeek(w => addDays(w, 7 * n)); };
  const label = tab === "year" ? String(year) : `tydz. ${isoWeek(week)}: ${ddmm(days7[0]!)} – ${ddmm(days7[6]!)}.${days7[6]!.slice(0, 4)}`;

  return (
    <>
      <div className="page-h">
        <div><h1>Planer zakupów</h1>
          <p className="muted small">Plan wpisujesz ręcznie. Wykonanie, tony, ceny, kilometry, transport i kursy kierowców czyta się z dokumentów (PZ, PW, TR).</p></div>
      </div>
      <div className="filters" role="search">
        <select className="ctrl" aria-label="Magazyn" id="pl-wh" value={whId} onChange={e => setWh(e.target.value)}>
          {W.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          {W.warehouses.length > 1 && <option value="ALL">Wszystkie magazyny</option>}
        </select>
        <button type="button" className="btn sm" aria-label={tab === "year" ? "Poprzedni rok" : "Poprzedni tydzień"} onClick={() => shift(-1)}>‹</button>
        <strong className="num pl-period" id="pl-period">{label}</strong>
        <button type="button" className="btn sm" aria-label={tab === "year" ? "Następny rok" : "Następny tydzień"} onClick={() => shift(1)}>›</button>
        <button type="button" className="btn sm" onClick={() => { setWeek(weekStart(todayLocal())); setYear(Number(todayLocal().slice(0, 4))); }}>Bieżący okres</button>
      </div>
      <div className="tabs scroll" role="tablist" aria-label="Widok planera">
        {([["week", "Tydzień"], ["year", "Miesiące i rok"], ["fleet", "Kierowcy i kursy"], ["src", "Skąd są dane"]] as const).map(([k, l]) =>
          <button key={k} type="button" role="tab" id={`pl-tab-${k}`} aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {wq.data && <Kpis t={wq.data.totals} week={isoWeek(week)} />}
      {q.isError ? <Alert kind="err">{errorText(q.error)}</Alert> : !q.data ? <p className="muted">Wczytywanie…</p> : (
        tab === "week" ? <WeekView v={q.data} whId={whId} days7={days7} canEdit={q.data.editable && can("planner.edit")} onOpen={setOpenDay} />
        : tab === "year" ? <YearView v={q.data} year={year} month={month} setMonth={setMonth} />
        : tab === "fleet" ? <FleetView v={q.data} days7={days7} day={fleetDay ?? days7.find(d => d <= q.data.today) ?? days7[0]!} setDay={setFleetDay} />
        : <SourcesView tonPerMp={q.data.tonPerMp} />
      )}
      {openDay && q.data && <DayPanel day={openDay} ops={q.data.ops.filter(o => o.date === openDay)} onClose={() => setOpenDay(null)} />}
    </>
  );
}

function Kpis({ t, week }: { t: PlannerTotals; week: number }) {
  const r = t.realization ? Number(t.realization) : 0;
  return (
    <section className="pl-kpis" aria-label="Wskaźniki tygodnia" id="pl-kpis">
      <div className="pl-k lead"><small>Realizacja planu do dziś — tydzień {week}</small><strong className="num">{t.realization ? `${nf(t.realization, 1)}%` : "–"}</strong>
        <div className="pl-meter" role="meter" aria-label="Realizacja planu" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r)}><i style={{ width: `${Math.min(100, r)}%` }} /></div></div>
      <div className="pl-k"><small>Wykonanie tygodnia</small><strong className="num">{nf(t.act)} MP</strong><span className="muted small num">{nf(t.t, 1)} t · z wagi {t.weighedShare ? nf(t.weighedShare) : 0}%</span></div>
      <div className="pl-k"><small>Wartość zakupu</small><strong className="num">{pln(t.purchaseCost)}</strong><span className="muted small num">średnio {t.avgPrice ? pln(t.avgPrice) : "–"}/MP</span></div>
      <div className="pl-k"><small>Transport</small><strong className="num">{t.transportPerMp ? `${nf(t.transportPerMp, 2)} zł/MP` : "–"}</strong><span className="muted small num">{t.trips} kursów · {nf(t.km)} km</span></div>
    </section>
  );
}

function realPill(d: PlannerDay) {
  if (!Number(d.plan)) return "–";
  if (d.future) return <span className="badge">plan</span>;
  const r = (Number(d.act) / Number(d.plan)) * 100;
  return <span className={`badge ${r >= 100 ? "ok" : r >= 80 ? "warn" : "err"}`}>{nf(r, 1)}%</span>;
}

function WeekView({ v, whId, days7, canEdit, onOpen }: { v: PlannerView; whId: string; days7: string[]; canEdit: boolean; onOpen: (d: string) => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<{ day: string; msg: string } | null>(null);
  const save = useMutation({
    mutationFn: (p: { date: string; planMp: string; version: number | null }) => api.put<{ plan: { version: number } }>("/planner/plan", { warehouseId: whId, ...p }),
    onSuccess: (_r, p) => { setErr(null); setDraft(d => { const n = { ...d }; delete n[p.date]; return n; }); void qc.invalidateQueries({ queryKey: ["planner"] }); },
    onError: (e, p) => setErr({ day: p.date, msg: e instanceof ApiRequestError ? (e.field("planMp") ?? e.message) : errorText(e) }),
  });
  const commit = (date: string) => {
    const val = draft[date];
    if (val === undefined) return;
    const cur = v.plans.find(p => p.date === date && p.warehouseId === whId);
    if (cur && Number(cur.planMp) === Number(val.replace(",", "."))) { setDraft(d => { const n = { ...d }; delete n[date]; return n; }); return; }
    save.mutate({ date, planMp: val, version: cur?.version ?? null });
  };
  const tot = v.totals;
  return (
    <section className="card">
      <header className="card-h"><h2>Tydzień</h2><span className="legend small"><span className="src-man">■ RĘCZNIE — plan</span> <span className="src-auto">■ AUTO — z dokumentów</span></span></header>
      {err && <Alert kind="err">{ddmm(err.day)}: {err.msg}</Alert>}
      <div className="table-wrap"><table className="table" id="pl-week">
        <thead><tr><th>Dzień</th><th>Miejsce produkcji</th><th className="r">Plan [MP]</th><th className="r">Wykonanie [MP]</th><th className="r">Tony [t]</th><th>Realizacja</th>
          <th className="r">Cena [zł/MP]</th><th className="r">Km</th><th className="r">Transport [zł]</th><th className="r">Wartość zakupu [zł]</th><th className="r">Kursy</th><th>Dokumenty</th></tr></thead>
        <tbody>{days7.map((date, i) => {
          const d = v.days.find(x => x.date === date)!;
          const value = draft[date] ?? (Number(d.plan) ? nf(d.plan, Number(d.plan) % 1 ? 2 : 0).replace(/\s/g, "") : "");
          return (
            <tr key={date} className={`${date === v.today ? "pl-today" : ""} ${d.future ? "pl-future" : ""}`} data-day={date}>
              <td data-label="Dzień"><strong>{DN[i]}</strong> <span className="num">{ddmm(date)}</span></td>
              <td data-label="Miejsce" className="small">{d.places.length ? d.places.join("; ") : <span className="muted">{d.future ? "—" : "brak produkcji"}</span>}</td>
              <td data-label="Plan [MP]" className="r">{canEdit
                ? <input className="ctrl r pl-plan" inputMode="decimal" aria-label={`Plan na ${ddmm(date)} (MP)`} value={value} disabled={save.isPending}
                    onChange={e => setDraft(s => ({ ...s, [date]: e.target.value }))} onBlur={() => commit(date)} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                : <span className="num">{nf(d.plan)}</span>}</td>
              <td data-label="Wykonanie" className="r num src-auto">{d.future ? "" : nf(d.act)}</td>
              <td data-label="Tony" className="r num src-auto">{Number(d.act) ? nf(d.t, 1) : ""}</td>
              <td data-label="Realizacja">{realPill(d)}</td>
              <td data-label="Cena" className="r num src-auto">{Number(d.act) ? nf(Number(d.purchaseCost) / Number(d.act), 2) : ""}</td>
              <td data-label="Km" className="r num src-auto">{Number(d.km) ? nf(d.km) : ""}</td>
              <td data-label="Transport" className="r num src-auto">{Number(d.transportCost) ? nf(d.transportCost, 2) : ""}</td>
              <td data-label="Wartość zakupu" className="r num src-auto">{Number(d.purchaseCost) ? nf(d.purchaseCost, 2) : ""}</td>
              <td data-label="Kursy" className="r num src-auto">{d.trips || ""}</td>
              <td data-label="Dokumenty">{d.opIds.length > 0 && <button type="button" className="linkish" data-open={date} onClick={() => onOpen(date)}>{d.opIds.length} {d.opIds.length === 1 ? "operacja" : "operacje"}</button>}</td>
            </tr>
          );
        })}</tbody>
        <tfoot><tr><td>Razem</td><td /><td className="r num">{nf(tot.plan)}</td><td className="r num">{nf(tot.act)}</td><td className="r num">{nf(tot.t, 1)}</td>
          <td>{tot.realization ? <span className="badge info" title="wobec planu do dziś">{nf(tot.realization, 1)}%</span> : "–"}</td>
          <td className="r num">{tot.avgPrice ? nf(tot.avgPrice, 2) : "–"}</td><td className="r num">{nf(tot.km)}</td><td className="r num">{nf(tot.transportCost, 2)}</td>
          <td className="r num">{nf(tot.purchaseCost, 2)}</td><td className="r num">{tot.trips}</td><td /></tr></tfoot>
      </table></div>
      <p className="muted small">{canEdit ? "Zmień plan dnia w kolumnie „Plan” — zapis po wyjściu z pola (Enter). Każda zmiana trafia do dziennika audytu." : v.warehouses.length > 1 ? "Widok wszystkich magazynów sumuje plany — plan zmienia się w widoku konkretnego magazynu." : "Plan zmienia osoba z uprawnieniem „Planer zakupów — plan dzienny”."}
        {" "}Wartości AUTO są tylko do odczytu: poprawia się je korektą dokumentu.</p>
    </section>
  );
}

function YearView({ v, year, month, setMonth }: { v: PlannerView; year: number; month: number; setMonth: (m: number) => void }) {
  const months = plannerMonths(v.days, year);
  const Y = v.totals;
  const [tip, setTip] = useState<{ m: number; x: number } | null>(null);
  const max = Math.max(1, ...months.map(m => Math.max(Number(m.plan), Number(m.act))));
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(Math.max(raw, 1))), n = raw / p;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p, top = Math.ceil(max / step) * step;
  const Wd = 720, H = 240, L = 54, B = 26, T = 10, cw = (Wd - L - 8) / 12, ph = H - B - T, y = (val: number) => T + ph - (val / top) * ph;
  const sel = months[month]!;
  return (
    <>
      <div className="pl-grid2">
        <section className="card">
          <header className="card-h"><h2>Plan i wykonanie {year} [MP]</h2>
            <span className="legend small"><span><i className="sw pl-sw-plan" />Plan</span> <span><i className="sw pl-sw-act" />Wykonanie</span> <span><i className="sw pl-sw-sel" />Wybrany miesiąc</span></span></header>
          <div className="pl-chart" id="pl-chart">
            <svg viewBox={`0 0 ${Wd} ${H}`} role="img" aria-label={`Plan i wykonanie według miesięcy ${year}`}>
              {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map(val => (
                <g key={val}><line x1={L} x2={Wd - 4} y1={y(val)} y2={y(val)} className="pl-grid" /><text x={L - 6} y={y(val) + 4} textAnchor="end">{nf(val)}</text></g>))}
              {months.map((m, i) => {
                const cx = L + cw * i + cw / 2, bw = Math.min(16, cw / 2 - 4);
                return (
                  <g key={i} className="pl-mbar" tabIndex={0} role="button" aria-label={`${MN[i]}: plan ${nf(m.plan)} MP, wykonanie ${nf(m.act)} MP`}
                    onClick={() => setMonth(i)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMonth(i); } }}
                    onMouseEnter={() => setTip({ m: i, x: cx })} onMouseLeave={() => setTip(null)} onFocus={() => setTip({ m: i, x: cx })} onBlur={() => setTip(null)}>
                    <rect x={L + cw * i} y={T} width={cw} height={ph} fill="transparent" />
                    <rect x={cx - bw - 1} y={y(Number(m.plan))} width={bw} height={Math.max(0, T + ph - y(Number(m.plan)))} rx={3} className="pl-bar-plan" />
                    <rect x={cx + 1} y={y(Number(m.act))} width={bw} height={Math.max(0, T + ph - y(Number(m.act)))} rx={3} className={i === month ? "pl-bar-sel" : "pl-bar-act"} />
                    <text x={cx} y={H - 8} textAnchor="middle" className={i === month ? "pl-axis-sel" : ""}>{MN[i]!.slice(0, 3)}</text>
                  </g>);
              })}
            </svg>
            {tip && <div className="pl-tip" style={{ left: `${(tip.x / Wd) * 100}%` }}><b>{MN[tip.m]}</b> · plan {nf(months[tip.m]!.plan)} MP · wykonanie {nf(months[tip.m]!.act)} MP</div>}
          </div>
        </section>
        <section className="card" id="pl-month">
          <header className="card-h"><h2>{MN[month]} {year}</h2>{sel.realization && <span className="badge info">{nf(sel.realization, 1)}% planu do dziś</span>}</header>
          <dl className="kv">
            <dt>Plan</dt><dd className="num">{nf(sel.plan)} MP</dd>
            <dt>Wykonanie</dt><dd className="num">{nf(sel.act)} MP · {nf(sel.t, 1)} t</dd>
            <dt>Dni z produkcją</dt><dd className="num">{sel.productionDays}</dd>
            <dt>Wartość zakupu</dt><dd className="num">{pln(sel.purchaseCost)}{sel.avgPrice ? ` (średnio ${pln(sel.avgPrice)}/MP)` : ""}</dd>
            <dt>Transport</dt><dd className="num">{pln(sel.transportCost)} · {nf(sel.km)} km · {sel.trips} kursów</dd>
            <dt>Udział w roku</dt><dd className="num">{Number(Y.act) ? nf((Number(sel.act) / Number(Y.act)) * 100, 1) : 0}% wykonania rocznego</dd>
          </dl>
        </section>
      </div>
      <section className="card">
        <h2>Miesiące i rok {year}</h2>
        <div className="table-wrap"><table className="table" id="pl-months">
          <thead><tr><th>Miesiąc</th><th className="r">Plan [MP]</th><th className="r">Wykonanie [MP]</th><th className="r">Tony [t]</th><th>Realizacja</th><th className="r">Udział w roku</th>
            <th className="r">Śr. cena [zł/MP]</th><th className="r">Zakup [zł]</th><th className="r">Transport [zł]</th><th className="r">Transport [zł/MP]</th><th className="r">Kursy</th></tr></thead>
          <tbody>{months.map((m, i) => (
            <tr key={i} className={i === month ? "pl-today" : ""}>
              <td data-label="Miesiąc">{MN[i]}</td><td data-label="Plan" className="r num">{nf(m.plan)}</td><td data-label="Wykonanie" className="r num">{nf(m.act)}</td><td data-label="Tony" className="r num">{nf(m.t, 1)}</td>
              <td data-label="Realizacja">{m.realization ? <span className={`badge ${Number(m.realization) >= 100 ? "ok" : Number(m.realization) >= 80 ? "warn" : "err"}`}>{nf(m.realization, 1)}%</span> : "–"}</td>
              <td data-label="Udział" className="r num">{Number(Y.act) ? `${nf((Number(m.act) / Number(Y.act)) * 100, 1)}%` : "–"}</td>
              <td data-label="Śr. cena" className="r num">{m.avgPrice ? nf(m.avgPrice, 2) : "–"}</td><td data-label="Zakup" className="r num">{nf(m.purchaseCost)}</td>
              <td data-label="Transport" className="r num">{nf(m.transportCost)}</td><td data-label="Transport/MP" className="r num">{m.transportPerMp ? nf(m.transportPerMp, 2) : "–"}</td><td data-label="Kursy" className="r num">{m.trips}</td>
            </tr>))}</tbody>
          <tfoot><tr><td>Rok</td><td className="r num">{nf(Y.plan)}</td><td className="r num">{nf(Y.act)}</td><td className="r num">{nf(Y.t, 1)}</td>
            <td>{Y.realization ? <span className="badge info">{nf(Y.realization, 1)}%</span> : "–"}</td><td className="r num">100%</td>
            <td className="r num">{Y.avgPrice ? nf(Y.avgPrice, 2) : "–"}</td><td className="r num">{nf(Y.purchaseCost)}</td><td className="r num">{nf(Y.transportCost)}</td>
            <td className="r num">{Y.transportPerMp ? nf(Y.transportPerMp, 2) : "–"}</td><td className="r num">{Y.trips}</td></tr></tfoot>
        </table></div>
      </section>
    </>
  );
}

function FleetView({ v, days7, day, setDay }: { v: PlannerView; days7: string[]; day: string; setDay: (d: string) => void }) {
  const dayDrivers = plannerDrivers(v.ops.filter(o => o.date === day));
  return (
    <>
      <section className="card">
        <header className="card-h"><h2>Kursy dnia</h2>
          <div className="pl-days">{days7.map((d, i) => <button key={d} type="button" className={`btn sm ${d === day ? "primary" : ""}`} disabled={d > v.today} onClick={() => setDay(d)}>{DN[i]} {ddmm(d)}</button>)}</div></header>
        <div className="table-wrap"><table className="table" id="pl-fleet-day">
          <thead><tr><th>Kierowca</th><th>Pojazd</th><th className="r">Kursy</th><th className="r">MP</th><th className="r">Km</th><th className="r">Koszt [zł]</th></tr></thead>
          <tbody>{dayDrivers.length ? dayDrivers.map(r => (
            <tr key={`${r.driver}|${r.registration}`}><td data-label="Kierowca">{r.driver}{r.company && <><br /><small className="muted">{r.company}</small></>}</td><td data-label="Pojazd" className="doc">{r.registration}</td>
              <td data-label="Kursy" className="r num">{r.trips}</td><td data-label="MP" className="r num">{nf(r.qty)}</td><td data-label="Km" className="r num">{nf(r.km)}</td><td data-label="Koszt" className="r num">{nf(r.cost, 2)}</td></tr>))
            : <tr><td colSpan={6} className="muted">Brak kursów w tym dniu.</td></tr>}</tbody>
        </table></div>
        <p className="muted small">Lista powstaje z kursów zapisanych w operacjach (dokument TR: pojazd z floty, kierowca, km, ilość, waga) — bez przepisywania.</p>
      </section>
      <section className="card">
        <h2>Kursy w tygodniu według kierowców</h2>
        <div className="table-wrap matrix"><table className="table" id="pl-fleet-week">
          <thead><tr><th>Kierowca i pojazd</th>{days7.map((d, i) => <th key={d} className="c">{DN[i]} {ddmm(d)}</th>)}<th className="r">Razem</th></tr></thead>
          <tbody>{v.drivers.length ? v.drivers.map(r => (
            <tr key={`${r.driver}|${r.registration}`}><td>{r.driver} <span className="doc muted">{r.registration}</span></td>
              {days7.map(d => <td key={d} className="c">{r.perDay[d] ? <span className="pl-heat">{r.perDay[d]}</span> : <span className="muted">·</span>}</td>)}<td className="r num"><b>{r.trips}</b></td></tr>))
            : <tr><td colSpan={9} className="muted">Brak kursów w tym tygodniu.</td></tr>}</tbody>
        </table></div>
      </section>
    </>
  );
}

function SourcesView({ tonPerMp }: { tonPerMp: string }) {
  const rows: Array<[string, string, string]> = [
    ["Plan [MP]", "purchase_plans", "Jedyna wartość wpisywana ręcznie: magazyn × dzień, każda zmiana w dzienniku audytu (było / jest)."],
    ["Wykonanie [MP]", "production_runs / PZ", "Produkcja z zakupu (PW), produkcja w lesie przy sprzedaży bezpośredniej i zakup materiału w MP."],
    ["Tony [t]", "transport_runs.weight_t", `Waga kursu, gdy jest; reszta ilości × przelicznik firmowy (${formatQty(tonPerMp)} t/MP).`],
    ["Cena [zł/MP]", "operations.purchase_cost", "Wartość zakupu ÷ wykonanie (średnia ważona w okresie)."],
    ["Miejsce produkcji", "operations.place / pochodzenie", "Miejsce transportu albo nadleśnictwo i leśnictwo z produkcji."],
    ["Km, transport, kursy", "transport_runs", "Suma km, kosztów (km × stawka albo fracht) i liczba kursów operacji zakupu."],
    ["Kierowcy i auta", "transport_runs.driver_id, vehicle_id", "Kursy pogrupowane po kierowcy i pojeździe z kartoteki floty."],
  ];
  return (
    <section className="card" id="pl-sources">
      <h2>Pola planera i ich źródło</h2>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Pole</th><th>Źródło</th><th>Reguła</th></tr></thead>
        <tbody>{rows.map(([a, b, c]) => <tr key={a}><td data-label="Pole">{a}</td><td data-label="Źródło" className="doc">{b}</td><td data-label="Reguła">{c}</td></tr>)}</tbody>
      </table></div>
      <p className="muted small">Liczby planera to sumy zatwierdzonych dokumentów: błąd poprawia się korektą dokumentu, a planer pokaże nową wartość automatycznie.</p>
    </section>
  );
}

function DayPanel({ day, ops, onClose }: { day: string; ops: PlannerOp[]; onClose: () => void }) {
  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="pl-day-h" id="pl-day">
        <header className="dialog-h"><h2 id="pl-day-h">{DN[dow(day)]} {ddmm(day)}.{day.slice(0, 4)} — dokumenty źródłowe</h2>
          <button type="button" className="btn ghost sm" aria-label="Zamknij" onClick={onClose}>✕</button></header>
        <div className="dialog-b">
          {ops.map(o => (
            <section key={o.id} className="card">
              <div className="pl-docs">{o.documents.map(d => <span key={d.number}><DocBadge type={d.type} /> <span className="doc">{d.number}</span></span>)}</div>
              <p className="small num">{o.place ?? "—"} · {nf(o.mp)} MP · {pln(o.purchaseCost)}{o.runs.length ? ` · ${o.runs.length} ${o.runs.length === 1 ? "kurs" : "kursy"}` : ""}</p>
              {o.runs.length > 0 && <ul className="plain small">{o.runs.map((r, i) => <li key={i}>{i + 1}. {r.driver ?? "—"} · <span className="doc">{r.registration ?? "—"}</span> · {nf(r.km)} km · {r.qty ? `${nf(r.qty)} MP` : "—"}
                {r.weightT ? ` · ${nf(r.weightT, 2)} t (waga)` : ""} · {pln(r.cost)}</li>)}</ul>}
            </section>
          ))}
          <p className="muted small">Liczby w planerze to sumy tych dokumentów. Błąd poprawia się korektą dokumentu (z historią i audytem).</p>
        </div>
      </div>
    </div>
  );
}
