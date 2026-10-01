import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { checkReason, formatQty, qtySum, MAX_EXTRAS, planOperation, TRANSPORT_MODE_LABEL, type TransportFleet, type CompanyRates, type ExtraInput, type OperationInput, type OperationPlan, type PlanExtraType, type PlanMaterial } from "@resinvest/domain";
import { ApiRequestError, api, errorText } from "../../api/client";
import { UNIT_LABEL, type Unit } from "../../api/types";
import { useSession } from "../../auth/session";
import { Alert, Dialog } from "../../ui/components";
import { Hint, TutorialToggle } from "../../ui/tutorial";
import { useWorkWarehouse } from "../stock/StockPage";
import { newKey } from "./idempotency";
import { elFor, goToField, guideSteps, OperationGuide } from "./guide";
import { opHelp } from "./help";
import { ChainProductionFields, EMPTY_CHAIN, EMPTY_SALE, fromChainInput, fromSaleInput, OutputSaleFields, toChainInput, toSaleInput, type ChainState, type SaleState } from "./ChainFields";
import { EMPTY_TRANSPORT, fromTransportInput, TransportFields, toTransportInput, type FleetData, type TransportState } from "./TransportFields";
import { canCorrectKind, ChangesTable, DocBadge, OperationDetail, type OperationView, pln } from "./OperationDetail";

type Kind = OperationInput["type"];
interface FormData {
  partners: Array<{ id: string; name: string; role: "SUPPLIER" | "BUYER" | "BOTH"; kind: "COMPANY" | "FOREST_DISTRICT"; forestries: string[] }>;
  materials: Array<PlanMaterial & { code: string }>;
  extraTypes: PlanExtraType[];
  vehicles: FleetData["vehicles"];
  drivers: FleetData["drivers"];
  companies: FleetData["companies"];
  kmRateDefault: string;
  chippers: Array<{ id: string; name: string; ownership: string; company: string | null; operatorId: string | null; externalOperator: string | null }>;
  operators: Array<{ id: string; name: string }>;
  balances: Record<string, string>;
  rates: CompanyRates;
  today: string;
  warehouses: Array<{ id: string; code: string; name: string }>;
  mmTwoStage: boolean;
}
interface Preview {
  plan: OperationPlan; numbers: string[];
  /** Korekta: pola BYŁO / JEST. */
  changes?: Array<{ field: string; before: string | null; after: string | null }>;
  steps: Array<{ key: string; before: string; qty: string; after: string }>;
  shortages: Array<{ materialId: string; message: string }>;
}
interface ExtraRow { key: number; typeId: string; vehicleId: string; qty: string; rate: string; cost: string; description: string }

const KINDS: ReadonlyArray<{ kind: Kind; label: string; doc: string; perm: string; also?: string }> = [
  { kind: "PURCHASE", label: "Zakup", doc: "PZ", perm: "receipts.create" },
  { kind: "SALE", label: "Sprzedaż z magazynu", doc: "WZ", perm: "issues.create" },
  { kind: "PRODUCTION", label: "Produkcja na magazynie", doc: "PW", perm: "production.create" },
  { kind: "TRANSFER", label: "Przesunięcie", doc: "MM", perm: "mm.create" },
  { kind: "DIRECT_SALE", label: "Sprzedaż bezpośrednia", doc: "WZ", perm: "issues.create", also: "production.create" },
];
const EMPTY = { partnerId: "", materialId: "", qty: "", unit: "" as Unit | "", price: "", priceUnit: "" as Unit | "", weightManual: "",
  targetWarehouseId: "", rawCost: "", rawMaterialId: "", outMaterialId: "", outQty: "", chipperId: "", operatorId: "", chipRate: "",
  documentDate: "", externalNumber: "", notes: "", numberMode: "AUTO" as "AUTO" | "MANUAL", number: "" };
let extraSeq = 0;

/**
 * Nowa operacja: zakup (PZ), sprzedaż z magazynu (WZ), produkcja (RW + PW) z operacjami dodatkowymi.
 * Podgląd liczy ta sama funkcja domeny co serwer (`planOperation`); przed zapisem serwer podaje numery dokumentów,
 * stan przed / po i ewentualne braki. Zapis z kluczem idempotencji — podwójne kliknięcie nie tworzy dwóch operacji.
 */
export function NewOperationPage() {
  const W = useWorkWarehouse();
  const { can } = useSession();
  const navigate = useNavigate();
  // korekta: /nowa-operacja?korekta=<id> — formularz z danymi zapisanego dokumentu, ten sam rodzaj i magazyn
  const [params] = useSearchParams();
  const corrId = params.get("korekta");
  const corrQ = useQuery({ queryKey: ["operation", corrId], enabled: !!corrId, staleTime: 0,
    queryFn: async ({ signal }) => (await api.get<{ operation: OperationView }>(`/operations/${corrId}`, signal)).operation });
  const corr = corrId && corrQ.data?.input && corrQ.data.status !== "DELETED" ? corrQ.data : null;
  const corrKind = corr?.input?.type;
  const allowed = corr ? KINDS.filter(k => k.kind === corrKind && canCorrectKind(can, corrKind)) : KINDS.filter(k => can(k.perm) && (!k.also || can(k.also)));
  const [kind, setKind] = useState<Kind | null>(null);
  const type: Kind | undefined = kind && allowed.some(k => k.kind === kind) ? kind : allowed[0]?.kind;
  const whId = corr ? corr.warehouse.id : W.id;
  const [f, setF] = useState(EMPTY);
  const [date, setDate] = useState("");
  const [extras, setExtras] = useState<ExtraRow[]>([]);
  const [transport, setTransport] = useState<TransportState>(EMPTY_TRANSPORT);
  const [chain, setChain] = useState<ChainState>(EMPTY_CHAIN);
  const [outSale, setOutSale] = useState<SaleState>(EMPTY_SALE);
  const [reason, setReason] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (corr?.input && loadedFor !== `${corr.id}:${corr.version}`) {
    // jednorazowe wypełnienie formularza migawką dokumentu (wzorzec „stan pochodny” — bez efektu)
    const i = corr.input as unknown as Record<string, unknown>, t = (k: string) => (i[k] === null || i[k] === undefined ? "" : String(i[k]));
    const num = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    setLoadedFor(`${corr.id}:${corr.version}`);
    setF({ ...EMPTY, partnerId: t("partnerId"), materialId: t("materialId"), qty: t("qty"), unit: t("unit") as Unit | "", price: t("price"), priceUnit: t("priceUnit") as Unit | "",
      weightManual: t("weightManual"), targetWarehouseId: t("targetWarehouseId"), rawCost: t("rawCost"), rawMaterialId: t("rawMaterialId"), outMaterialId: t("outMaterialId"),
      outQty: t("outQty"), chipperId: t("chipperId"), operatorId: t("operatorId"), chipRate: t("chipRate"), documentDate: t("documentDate"), externalNumber: t("externalNumber"), notes: t("notes") });
    setDate(t("date"));
    setExtras((corr.input.extras ?? []).map(x => ({ key: ++extraSeq, typeId: x.typeId, vehicleId: x.vehicleId ?? "", qty: num(x.qty), rate: num(x.rate), cost: num(x.cost), description: x.description ?? "" })));
    setTransport(fromTransportInput(corr.input.transport));
    const ci = corr.input;
    setChain(ci.type === "PURCHASE" || ci.type === "DIRECT_SALE" ? fromChainInput(ci.production) : EMPTY_CHAIN);
    setOutSale(ci.type === "PURCHASE" || ci.type === "DIRECT_SALE" ? fromSaleInput(ci.sale) : EMPTY_SALE);
  }
  const [tried, setTried] = useState(false);
  // pola, które użytkownik już odwiedził — ich braki świecą na czerwono od razu, reszta dopiero po „Dalej”
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const touch = (id: string) => { if (id && !touched.has(id)) setTouched(s => new Set(s).add(id)); };
  const [preview, setPreview] = useState<Preview | null>(null);
  const [serverErr, setServerErr] = useState<unknown>(null);
  const [created, setCreated] = useState<{ id: string; numbers: string[]; corrected?: boolean } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const form = useQuery({ queryKey: ["operations", "form-data", whId], enabled: !!whId, staleTime: 0, refetchOnMount: "always",
    queryFn: ({ signal }) => api.get<FormData>(`/operations/form-data?warehouseId=${whId}`, signal) });
  const fd = form.data;
  const day = date || fd?.today || "";
  const set = (k: keyof typeof EMPTY, v: string) => { setPreview(null); setF(s => ({ ...s, [k]: v })); };

  // React Compiler memoizuje te obliczenia — plan liczy się na nowo tylko po zmianie pól formularza
  const input = ((): OperationInput | null => {
    if (!type) return null;
    const base = {
      warehouseId: whId, date: day, documentDate: f.documentDate || null, externalNumber: f.externalNumber.trim() || null, notes: f.notes.trim() || null,
      numbering: { mode: f.numberMode, number: f.numberMode === "MANUAL" ? f.number : null },
      extras: extras.map<ExtraInput>(x => ({ typeId: x.typeId, vehicleId: x.vehicleId || null, qty: x.qty, rate: x.rate, cost: x.cost, description: x.description || null })),
      ...(type !== "PRODUCTION" ? { transport: toTransportInput(transport) } : {}),
    };
    if (type === "PRODUCTION") return { type, ...base, rawMaterialId: f.rawMaterialId, outMaterialId: f.outMaterialId, outQty: f.outQty, chipperId: f.chipperId || null, operatorId: f.operatorId || null, chipRate: f.chipRate };
    const unit = (f.unit || fd?.materials.find(m => m.id === f.materialId)?.stockUnit || "T") as Unit;
    if (type === "DIRECT_SALE") return { type, ...base, rawMaterialId: f.rawMaterialId, rawCost: f.rawCost, production: toChainInput({ ...chain, enabled: true }), sale: toSaleInput(outSale) };
    if (type === "PURCHASE") return { type, ...base, partnerId: f.partnerId, materialId: f.materialId, qty: f.qty, unit, price: f.price, priceUnit: f.priceUnit || null, weightManual: f.weightManual,
      production: chain.enabled ? toChainInput(chain) : null, sale: chain.enabled && outSale.enabled ? toSaleInput(outSale) : null };
    if (type === "SALE") return { type, ...base, partnerId: f.partnerId, materialId: f.materialId, qty: f.qty, unit, price: f.price, weightManual: f.weightManual };
    return { type, ...base, targetWarehouseId: f.targetWarehouseId, materialId: f.materialId, qty: f.qty, unit, weightManual: f.weightManual };
  })();

  const local = !fd || !input ? null
    : planOperation(input, { materials: new Map(fd.materials.map(m => [m.id, m])), extraTypes: new Map(fd.extraTypes.map(t => [t.id, t])), rates: fd.rates, today: fd.today, transferTwoStage: fd.mmTwoStage,
      kmRateDefault: fd.kmRateDefault, fleet: fleetOf(fd, whId) });
  const localErr = (field: string) => ((tried || touched.has(elFor(field))) && local && !local.ok ? local.errors.find(e => e.field === field)?.message : undefined);
  const fe = (field: string) => (serverErr instanceof ApiRequestError ? serverErr.field(field) : undefined) ?? localErr(field);

  const reasonErr = corr ? checkReason(reason) : null;
  const check = useMutation({
    mutationFn: (op: OperationInput) => corr ? api.post<Preview>(`/operations/${corr.id}/correction/preview`, { version: corr.version, operation: op }) : api.post<Preview>("/operations/preview", op),
    onSuccess: p => setPreview(p),
    onError: e => setServerErr(e),
  });
  const next = () => {
    setTried(true); setServerErr(null);
    if (!input || !local?.ok || reasonErr) return;
    check.mutate(input);
  };
  const reset = () => { setF(EMPTY); setExtras([]); setTransport(EMPTY_TRANSPORT); setChain(EMPTY_CHAIN); setOutSale(EMPTY_SALE); setTried(false); setTouched(new Set()); setPreview(null); setServerErr(null); };
  const go = (el: string) => { touch(el); goToField(el); };

  if (corrId && corrQ.isError) return <section className="card"><h1>Korekta</h1><Alert kind="err">{errorText(corrQ.error)}</Alert></section>;
  if (corrId && !corrQ.data) return <p className="muted">Wczytywanie dokumentu do korekty…</p>;
  if (corrId && !corr) return <section className="card"><h1>Korekta</h1><Alert kind="err">Tego dokumentu nie można korygować (usunięty albo bez danych formularza).</Alert></section>;
  if (!allowed.length) return <section className="card"><h1>{corr ? "Korekta" : "Nowa operacja"}</h1><p className="muted">{corr ? "Twoja rola nie pozwala korygować tego rodzaju dokumentów." : "Twoja rola nie pozwala wprowadzać operacji magazynowych."}</p></section>;
  const mats = fd?.materials.filter(m => m.active) ?? [];
  const mat = fd?.materials.find(m => m.id === f.materialId);
  const raw = fd?.materials.find(m => m.id === f.rawMaterialId);
  const whName = (id: string) => fd?.warehouses.find(w => w.id === id)?.name ?? W.warehouses.find(w => w.id === id)?.name ?? "magazyn";
  const corrNumbers = corr ? corr.documents.map(d => d.number).join(", ") : "";
  const partners = (fd?.partners ?? []).filter(p => p.role === "BOTH" || p.role === (type === "PURCHASE" ? "SUPPLIER" : "BUYER"));
  const bal = (id: string) => fd?.balances[id] ?? "0";
  const docLabel = KINDS.find(k => k.kind === type)?.doc ?? "";
  const plan = local?.ok ? local.plan : null;
  const steps = !type ? [] : guideSteps({
    type, f, day, extras: extras.length, transportMode: type === "PRODUCTION" ? "NONE" : transport.mode,
    chain: type === "DIRECT_SALE" ? { ...chain, enabled: true } : chain, sale: type === "DIRECT_SALE" ? { ...outSale, enabled: true } : outSale,
    errors: [...(serverErr instanceof ApiRequestError ? serverErr.body?.details ?? [] : []), ...(local && !local.ok ? local.errors : []), ...(reasonErr ? [{ field: "reason", message: reasonErr }] : [])],
    reason: corr ? reason : undefined,
  });
  const H = (id: string, variant?: string) => <Hint id={id} text={opHelp(id, variant)} />;

  return (
    <>
      <div className="page-h">
        {corr ? <div><h1>Korekta — <span className="doc">{corrNumbers}</span></h1><p className="muted small">Zmień pola i podaj powód. Numery dokumentów zostają; serwer odwróci ruchy poprzedniej wersji i zaksięguje nowe. Przed zatwierdzeniem zobaczysz zmiany BYŁO / JEST.</p></div>
          : <div><h1>Nowa operacja</h1><p className="muted small">Każda operacja tworzy dokumenty (PZ / WZ / RW + PW) i ruchy w księdze magazynu. Stan zmienia się dopiero po zatwierdzeniu.</p></div>}
        <div className="actions"><TutorialToggle /><Link className="btn" to="/dokumenty">Rejestr dokumentów</Link></div>
      </div>
      <div className="tabs scroll" role="tablist" aria-label="Rodzaj operacji">
        {allowed.map(k => <button key={k.kind} type="button" role="tab" aria-selected={type === k.kind} className={type === k.kind ? "on" : ""} id={`op-tab-${k.kind}`}
          onClick={() => { setKind(k.kind); setTried(false); setPreview(null); setServerErr(null); }}>{k.label} <DocBadge type={k.doc} /></button>)}
      </div>
      {created && <Alert kind="ok"><span>{created.corrected ? "Zapisano korektę — dokumenty: " : "Zapisano operację — dokumenty: "}<strong className="doc">{created.numbers.join(", ")}</strong>. <button type="button" className="linkish" id="op-created-open" onClick={() => setDetail(created.id)}>Pokaż szczegóły</button></span></Alert>}
      {form.isError ? <Alert kind="err">{errorText(form.error)}</Alert> : !fd ? <p className="muted">Wczytywanie…</p> : (
        <div className="op-layout">
          <form className="card form" id="op-form" noValidate onSubmit={e => { e.preventDefault(); next(); }}
            onBlur={e => touch(e.target.id)} onChange={e => { if (e.target instanceof HTMLSelectElement) touch(e.target.id); }}>
            {corr && <div className="field corr-reason"><label htmlFor="op-reason">Powód korekty <span className="req">*</span></label>
              <textarea id="op-reason" className="ctrl" rows={2} maxLength={500} placeholder="np. błędna ilość z kwitu wagowego, zły dostawca" value={reason} onChange={e => { setPreview(null); setReason(e.target.value); }} />
              <Hint id="op-reason" text="Powód trafi do historii zmian (BYŁO / JEST), zakładki „Korekty” i dziennika audytu. Co najmniej 5 znaków." />
              {(tried || touched.has("op-reason")) && reasonErr && <small className="error">{reasonErr}</small>}</div>}
            <div className="grid2">
              <div className="field"><label htmlFor="op-wh">Magazyn <span className="req">*</span></label>
                <select id="op-wh" className="ctrl" value={whId} disabled={!!corr} onChange={e => { reset(); W.setId(e.target.value); }}>{W.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>{H("op-wh")}</div>
              <div className="field"><label htmlFor="op-date">Data operacji (ruchu) <span className="req">*</span></label>
                <input id="op-date" className="ctrl" type="date" value={day} max={fd.today} onChange={e => { setPreview(null); setDate(e.target.value); }} />
                {H("op-date")}{fe("date") && <small className="error">{fe("date")}</small>}</div>
            </div>

            {type === "DIRECT_SALE" ? (
              <>
                <Alert kind="info">Produkcja w lesie i sprzedaż bezpośrednio odbiorcy: surowiec nie schodzi ze stanu (dokument PW + WZ). Niesprzedana reszta zostaje na stanie magazynu.</Alert>
                <div className="grid2">
                  <div className="field"><label htmlFor="op-raw">Surowiec wejściowy <span className="req">*</span></label>
                    <select id="op-raw" className="ctrl" value={f.rawMaterialId} onChange={e => set("rawMaterialId", e.target.value)}>
                      <option value="">— wybierz —</option>{mats.filter(m => m.category === "WOOD").map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>{H("op-raw", "DIRECT_SALE")}{fe("rawMaterialId") && <small className="error">{fe("rawMaterialId")}</small>}</div>
                  <div className="field"><label htmlFor="op-rawcost">Koszt surowca (zł)</label>
                    <input id="op-rawcost" className="ctrl r" inputMode="decimal" placeholder="opcjonalnie" value={f.rawCost} onChange={e => set("rawCost", e.target.value)} />{H("op-rawcost")}
                    {fe("rawCost") && <small className="error">{fe("rawCost")}</small>}</div>
                </div>
                <fieldset className="field"><legend>Produkcja</legend>
                  <ChainProductionFields value={chain} onChange={c => { setPreview(null); setChain(c); }} data={fd} mode="DIRECT" purchaseUnit="m³"
                    transportRuns={["OWN", "EXTERNAL", "MIXED"].includes(transport.mode)} fe={fe} /></fieldset>
                <fieldset className="field"><legend>Sprzedaż</legend>
                  <OutputSaleFields value={outSale} onChange={x => { setPreview(null); setOutSale(x); }} data={fd} fe={fe} /></fieldset>
                <div className="grid2">
                  <div className="field"><label htmlFor="op-numbering">Numer WZ</label>
                    <select id="op-numbering" className="ctrl" value={f.numberMode} disabled={!!corr} onChange={e => set("numberMode", e.target.value)}>
                      <option value="AUTO">Automatycznie (WZ/NNN/MM/RRRR)</option><option value="MANUAL">Ręcznie</option>
                    </select>
                    {f.numberMode === "MANUAL" && <input id="op-number" className="ctrl mt" aria-label="Numer ręczny WZ" maxLength={40} value={f.number} onChange={e => set("number", e.target.value)} />}
                    {H("op-numbering")}{fe("numbering.number") && <small className="error">{fe("numbering.number")}</small>}</div>
                  <div className="field"><label htmlFor="op-ext">Nr dokumentu zewnętrznego</label>
                    <input id="op-ext" className="ctrl" maxLength={60} value={f.externalNumber} onChange={e => set("externalNumber", e.target.value)} />{H("op-ext")}</div>
                </div>
              </>
            ) : type === "TRANSFER" ? (
              <>
                <Alert kind="info">{fd.mmTwoStage
                  ? "MM dwuetapowe: zatwierdzenie zdejmuje towar ze stanu tego magazynu. Magazyn docelowy przyjmuje go w „Dokumenty → Do przyjęcia”, podając ilość faktycznie przyjętą."
                  : "MM jednoetapowe: zatwierdzenie zdejmuje towar tutaj i od razu przyjmuje go w magazynie docelowym."}</Alert>
                <div className="grid2">
                  <div className="field"><label htmlFor="op-target">Magazyn docelowy <span className="req">*</span></label>
                    <select id="op-target" className="ctrl" value={f.targetWarehouseId} onChange={e => set("targetWarehouseId", e.target.value)}>
                      <option value="">— wybierz —</option>{fd.warehouses.filter(w => w.id !== whId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>{H("op-target")}{fe("targetWarehouseId") && <small className="error">{fe("targetWarehouseId")}</small>}</div>
                  <div className="field"><label htmlFor="op-mat">Materiał <span className="req">*</span></label>
                    <select id="op-mat" className="ctrl" value={f.materialId} onChange={e => { const m = fd.materials.find(x => x.id === e.target.value); setPreview(null); setF(s => ({ ...s, materialId: e.target.value, unit: m?.stockUnit ?? "" })); }}>
                      <option value="">— wybierz —</option>{mats.map(m => <option key={m.id} value={m.id}>{m.name} (stan {formatQty(bal(m.id))} {UNIT_LABEL[m.stockUnit]})</option>)}
                    </select>{H("op-mat", type)}{fe("materialId") && <small className="error">{fe("materialId")}</small>}</div>
                </div>
                <div className="grid2">
                  <div className="field"><label htmlFor="op-qty">Ilość <span className="req">*</span></label>
                    <div className="join">
                      <input id="op-qty" className="ctrl r" inputMode="decimal" placeholder="np. 120" value={f.qty} onChange={e => set("qty", e.target.value)} />
                      <select className="ctrl" aria-label="Jednostka ilości" value={f.unit} disabled={!mat} onChange={e => set("unit", e.target.value)}>
                        {(mat?.allowedUnits ?? ["T" as Unit]).map(u => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select>
                    </div>{H("op-qty")}{(fe("qty") ?? fe("unit")) && <small className="error">{fe("qty") ?? fe("unit")}</small>}</div>
                  <div className="field"><label htmlFor="op-weight">Tonaż z wagi (t)</label>
                    <input id="op-weight" className="ctrl r" inputMode="decimal" placeholder="puste = AUTO z przelicznika" value={f.weightManual} onChange={e => set("weightManual", e.target.value)} />
                    {H("op-weight")}{fe("weightManual") && <small className="error">{fe("weightManual")}</small>}</div>
                </div>
                <div className="grid2">
                  <div className="field"><label htmlFor="op-numbering">Numer MM</label>
                    <select id="op-numbering" className="ctrl" value={f.numberMode} disabled={!!corr} onChange={e => set("numberMode", e.target.value)}>
                      <option value="AUTO">Automatycznie (MM/NNN/MM/RRRR)</option><option value="MANUAL">Ręcznie</option>
                    </select>
                    {f.numberMode === "MANUAL" && <input id="op-number" className="ctrl mt" aria-label="Numer ręczny MM" maxLength={40} placeholder="np. MM 3/2026" value={f.number} onChange={e => set("number", e.target.value)} />}
                    {H("op-numbering")}{fe("numbering.number") && <small className="error">{fe("numbering.number")}</small>}</div>
                  <div className="field"><label htmlFor="op-ext">Nr dokumentu zewnętrznego</label>
                    <input id="op-ext" className="ctrl" maxLength={60} placeholder="np. kwit wagowy" value={f.externalNumber} onChange={e => set("externalNumber", e.target.value)} />{H("op-ext")}
                    {fe("externalNumber") && <small className="error">{fe("externalNumber")}</small>}</div>
                </div>
              </>
            ) : type !== "PRODUCTION" ? (
              <>
                <div className="field"><label htmlFor="op-partner">{type === "PURCHASE" ? "Dostawca" : "Odbiorca"} <span className="req">*</span></label>
                  <select id="op-partner" className="ctrl" value={f.partnerId} onChange={e => set("partnerId", e.target.value)}>
                    <option value="">— wybierz —</option>{partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>{H("op-partner", type)}{fe("partnerId") && <small className="error">{fe("partnerId")}</small>}</div>
                <div className="grid2">
                  <div className="field"><label htmlFor="op-mat">{type === "PURCHASE" ? "Materiał" : "Towar z magazynu"} <span className="req">*</span></label>
                    <select id="op-mat" className="ctrl" value={f.materialId} onChange={e => { const m = fd.materials.find(x => x.id === e.target.value); setPreview(null); setF(s => ({ ...s, materialId: e.target.value, unit: m?.stockUnit ?? "", priceUnit: "" })); }}>
                      <option value="">— wybierz —</option>{mats.map(m => <option key={m.id} value={m.id}>{m.name} (stan {formatQty(bal(m.id))} {UNIT_LABEL[m.stockUnit]})</option>)}
                    </select>{H("op-mat", type)}{fe("materialId") && <small className="error">{fe("materialId")}</small>}</div>
                  <div className="field"><label htmlFor="op-qty">Ilość <span className="req">*</span></label>
                    <div className="join">
                      <input id="op-qty" className="ctrl r" inputMode="decimal" placeholder="np. 60" value={f.qty} onChange={e => set("qty", e.target.value)} />
                      <select className="ctrl" aria-label="Jednostka ilości" value={f.unit} disabled={!mat} onChange={e => set("unit", e.target.value)}>
                        {(mat?.allowedUnits ?? ["T" as Unit]).map(u => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select>
                    </div>{H("op-qty")}{(fe("qty") ?? fe("unit")) && <small className="error">{fe("qty") ?? fe("unit")}</small>}</div>
                </div>
                <div className="grid2">
                  <div className="field"><label htmlFor="op-price">Cena netto (zł){type === "SALE" && mat ? ` za ${UNIT_LABEL[(f.unit || mat.stockUnit) as Unit]}` : ""} <span className="req">*</span></label>
                    <div className="join">
                      <input id="op-price" className="ctrl r" inputMode="decimal" placeholder="np. 85,50" value={f.price} onChange={e => set("price", e.target.value)} />
                      {type === "PURCHASE" && <select className="ctrl" aria-label="Jednostka ceny" value={f.priceUnit || f.unit} disabled={!mat} onChange={e => set("priceUnit", e.target.value)}>
                        {(mat?.allowedUnits ?? ["T" as Unit]).map(u => <option key={u} value={u}>za {UNIT_LABEL[u]}</option>)}</select>}
                    </div>{H("op-price", type)}{(fe("price") ?? fe("priceUnit")) && <small className="error">{fe("price") ?? fe("priceUnit")}</small>}</div>
                  <div className="field"><label htmlFor="op-weight">Tonaż z wagi (t)</label>
                    <input id="op-weight" className="ctrl r" inputMode="decimal" placeholder="puste = AUTO z przelicznika" value={f.weightManual} onChange={e => set("weightManual", e.target.value)} />
                    {H("op-weight")}
                    {fe("weightManual") && <small className="error">{fe("weightManual")}</small>}</div>
                </div>
                <div className="grid2">
                  <div className="field"><label htmlFor="op-numbering">Numer {docLabel}</label>
                    <select id="op-numbering" className="ctrl" value={f.numberMode} disabled={!!corr} onChange={e => set("numberMode", e.target.value)}>
                      <option value="AUTO">Automatycznie ({docLabel}/NNN/MM/RRRR)</option><option value="MANUAL">Ręcznie</option>
                    </select>
                    {f.numberMode === "MANUAL" && <input id="op-number" className="ctrl mt" aria-label={`Numer ręczny ${docLabel}`} maxLength={40} placeholder={`np. ${docLabel} 12/2026`} value={f.number} onChange={e => set("number", e.target.value)} />}
                    {H("op-numbering")}{fe("numbering.number") && <small className="error">{fe("numbering.number")}</small>}</div>
                  <div className="field"><label htmlFor="op-ext">Nr dokumentu zewnętrznego</label>
                    <input id="op-ext" className="ctrl" maxLength={60} placeholder="np. faktura, kwit wagowy" value={f.externalNumber} onChange={e => set("externalNumber", e.target.value)} />{H("op-ext")}
                    {fe("externalNumber") && <small className="error">{fe("externalNumber")}</small>}</div>
                </div>
                {type === "PURCHASE" && can("production.create") && (
                  <fieldset className="field">
                    <legend>Produkcja z zakupu</legend>
                    <label className="check"><input type="checkbox" id="op-chain-on" checked={chain.enabled} onChange={e => { setPreview(null); setChain(c => ({ ...c, enabled: e.target.checked })); }} /> Produkcja zrębki z tego zakupu (RW + PW)</label>
                    {chain.enabled && <ChainProductionFields value={chain} onChange={c => { setPreview(null); setChain(c); }} data={fd} mode="FROM_PURCHASE" purchaseUnit={UNIT_LABEL[(f.unit || mat?.stockUnit || "M3") as Unit]}
                      supplierId={f.partnerId} transportRuns={["OWN", "EXTERNAL", "MIXED"].includes(transport.mode)} fe={fe} />}
                    {chain.enabled && can("issues.create") && <>
                      <label className="check"><input type="checkbox" id="op-outsale-on" checked={outSale.enabled} onChange={e => { setPreview(null); setOutSale(x => ({ ...x, enabled: e.target.checked })); }} /> Sprzedaż wyniku produkcji odbiorcy (WZ)</label>
                      {outSale.enabled && <OutputSaleFields value={outSale} onChange={x => { setPreview(null); setOutSale(x); }} data={fd} fe={fe} />}
                    </>}
                  </fieldset>
                )}
              </>
            ) : (
              <>
                <div className="grid2">
                  <div className="field"><label htmlFor="op-raw">Surowiec (m³) <span className="req">*</span></label>
                    <select id="op-raw" className="ctrl" value={f.rawMaterialId} onChange={e => set("rawMaterialId", e.target.value)}>
                      <option value="">— wybierz —</option>{mats.filter(m => m.stockUnit === "M3").map(m => <option key={m.id} value={m.id}>{m.name} (stan {formatQty(bal(m.id))} m³)</option>)}
                    </select>{H("op-raw", "PRODUCTION")}{fe("rawMaterialId") && <small className="error">{fe("rawMaterialId")}</small>}</div>
                  <div className="field"><label htmlFor="op-out">Produkt — zrębka (MP) <span className="req">*</span></label>
                    <select id="op-out" className="ctrl" value={f.outMaterialId} onChange={e => set("outMaterialId", e.target.value)}>
                      <option value="">— wybierz —</option>{mats.filter(m => m.stockUnit === "MP").map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>{H("op-out")}{fe("outMaterialId") && <small className="error">{fe("outMaterialId")}</small>}</div>
                </div>
                <div className="grid2">
                  <div className="field"><label htmlFor="op-outqty">Ilość produkcji (MP) <span className="req">*</span></label>
                    <input id="op-outqty" className="ctrl r" inputMode="decimal" placeholder="np. 120" value={f.outQty} onChange={e => set("outQty", e.target.value)} />{H("op-outqty")}
                    <small className="hint">Zużycie = MP ÷ {formatQty(raw?.mpPerM3 ?? fd.rates.mpPerM3)} MP z 1 m³{raw?.mpPerM3 ? " (przelicznik surowca)" : " (przelicznik firmowy)"}.</small>
                    {fe("outQty") && <small className="error">{fe("outQty")}</small>}</div>
                  <div className="field"><label htmlFor="op-chiprate">Cena rąbania (zł / MP)</label>
                    <input id="op-chiprate" className="ctrl r" inputMode="decimal" placeholder="opcjonalnie" value={f.chipRate} onChange={e => set("chipRate", e.target.value)} />{H("op-chiprate")}
                    {fe("chipRate") && <small className="error">{fe("chipRate")}</small>}</div>
                </div>
                <div className="grid2">
                  <div className="field"><label htmlFor="op-chipper">Rębak</label>
                    <select id="op-chipper" className="ctrl" value={f.chipperId} onChange={e => { const c = fd.chippers.find(x => x.id === e.target.value); setPreview(null); setF(s => ({ ...s, chipperId: e.target.value, operatorId: c?.operatorId ?? s.operatorId })); }}>
                      <option value="">— bez rębaka —</option>{fd.chippers.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ""}</option>)}
                    </select>{H("op-chipper")}{fe("chipperId") && <small className="error">{fe("chipperId")}</small>}</div>
                  <div className="field"><label htmlFor="op-operator">Operator</label>
                    <select id="op-operator" className="ctrl" value={f.operatorId} onChange={e => set("operatorId", e.target.value)}>
                      <option value="">— brak —</option>{fd.operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>{H("op-operator")}{fe("operatorId") && <small className="error">{fe("operatorId")}</small>}</div>
                </div>
              </>
            )}

            <div className="grid2">
              <div className="field"><label htmlFor="op-docdate">Data dokumentu</label>
                <input id="op-docdate" className="ctrl" type="date" value={f.documentDate} max={fd.today} onChange={e => set("documentDate", e.target.value)} />
                {H("op-docdate")}{fe("documentDate") && <small className="error">{fe("documentDate")}</small>}</div>
              <div className="field"><label htmlFor="op-notes">Uwagi</label>
                <input id="op-notes" className="ctrl" maxLength={2000} value={f.notes} onChange={e => set("notes", e.target.value)} />{H("op-notes")}</div>
            </div>

            {type !== "PRODUCTION" && <TransportFields value={transport} onChange={t => { setPreview(null); setTransport(t); }}
              fleet={fd} unit={(type === "TRANSFER" || type === "SALE" || type === "PURCHASE") && mat ? mat.stockUnit : null} purchase={type === "PURCHASE"} fe={fe} />}

            <fieldset className="field" id="op-extras-form">
              <legend>Operacje dodatkowe (transport, załadunek, usługi)</legend>
              {extras.map((x, i) => {
                const t = fd.extraTypes.find(et => et.id === x.typeId);
                const upd = (p: Partial<ExtraRow>) => { setPreview(null); setExtras(xs => xs.map(r => (r.key === x.key ? { ...r, ...p } : r))); };
                const ef = (k: string) => fe(`extras.${i}.${k}`);
                return (
                  <div key={x.key} className="extra-row" data-extra={i}>
                    <select className="ctrl" id={`ex-type-${i}`} aria-label={`Rodzaj operacji dodatkowej ${i + 1}`} value={x.typeId} onChange={e => upd({ typeId: e.target.value })}>
                      <option value="">— rodzaj —</option>{fd.extraTypes.map(et => <option key={et.id} value={et.id}>{et.name}</option>)}</select>
                    <select className="ctrl" id={`ex-veh-${i}`} aria-label={`Pojazd, operacja dodatkowa ${i + 1}`} value={x.vehicleId} onChange={e => upd({ vehicleId: e.target.value })}>
                      <option value="">— pojazd —</option>{fd.vehicles.map(v => <option key={v.id} value={v.id}>{v.registration} {v.name}</option>)}</select>
                    <input className="ctrl r" inputMode="decimal" id={`ex-qty-${i}`} aria-label={`Ilość${t?.unit ? ` (${t.unit})` : ""}, operacja dodatkowa ${i + 1}`} placeholder={`ilość${t?.unit ? ` ${t.unit}` : ""}`} value={x.qty} onChange={e => upd({ qty: e.target.value })} />
                    <input className="ctrl r" inputMode="decimal" id={`ex-rate-${i}`} aria-label={`Stawka, operacja dodatkowa ${i + 1}`} placeholder={t?.defaultRate ? `stawka ${t.defaultRate}` : "stawka"} value={x.rate} onChange={e => upd({ rate: e.target.value })} />
                    <input className="ctrl r" inputMode="decimal" id={`ex-cost-${i}`} aria-label={`Koszt (zł), operacja dodatkowa ${i + 1}`} placeholder="koszt zł" value={x.cost} onChange={e => upd({ cost: e.target.value })} />
                    <input className="ctrl" id={`ex-desc-${i}`} aria-label={`Opis, operacja dodatkowa ${i + 1}`} placeholder="opis" maxLength={300} value={x.description} onChange={e => upd({ description: e.target.value })} />
                    <button type="button" className="btn sm ghost" aria-label={`Usuń operację dodatkową ${i + 1}`} onClick={() => { setPreview(null); setExtras(xs => xs.filter(r => r.key !== x.key)); }}>✕</button>
                    {(ef("typeId") ?? ef("qty") ?? ef("rate") ?? ef("cost") ?? ef("description")) && <small className="error">{ef("typeId") ?? ef("qty") ?? ef("rate") ?? ef("cost") ?? ef("description")}</small>}
                  </div>
                );
              })}
              {extras.length < MAX_EXTRAS && <button type="button" className="btn sm" id="op-extra-add" onClick={() => { setPreview(null); setExtras(xs => [...xs, { key: ++extraSeq, typeId: "", vehicleId: "", qty: "", rate: "", cost: "", description: "" }]); }}>+ Dodaj operację dodatkową</button>}
              {H("op-extras")}
              {fe("extras") && <small className="error">{fe("extras")}</small>}
            </fieldset>

            {serverErr !== null && !(serverErr instanceof ApiRequestError && serverErr.body?.details?.length) && <Alert kind="err">{errorText(serverErr)}</Alert>}
            {tried && local && !local.ok && local.errors.some(e => e.field === "form") && <Alert kind="err">{local.errors.find(e => e.field === "form")?.message}</Alert>}
            <div className="actions">
              <button type="submit" className="btn primary" id="op-next" disabled={check.isPending}>{check.isPending ? "Sprawdzanie…" : "Dalej — podsumowanie"}</button>
              <button type="button" className="btn" onClick={reset}>Wyczyść</button>
            </div>
          </form>

          <div className="op-side">
            <OperationGuide steps={steps} onGo={go} />
          <aside className="card op-preview" id="op-live" aria-live="polite">
            <header className="card-h"><h2>Podgląd</h2></header>
            {!plan ? <p className="muted small">Uzupełnij pola — podgląd dokumentów i kwot pojawi się automatycznie.</p> : (
              <>
                <ul className="plain">{plan.documents.map((d, i) => <li key={i}><DocBadge type={d.type} /> {d.lines.map(l => `${formatQty(l.qtyStock)} ${UNIT_LABEL[l.unitStock]}`).join(", ")}{d.type === "RW" ? " (zużycie)" : ""}</li>)}</ul>
                {plan.summary.map((s, i) => <p key={i} className="summary" data-summary>{s}</p>)}
                <ul className="plain small">{(() => {
                  // krok po kroku jak w księdze: zakup +, zużycie −, produkcja +, sprzedaż − — każdy ruch zaczyna od stanu po poprzednim
                  const running = new Map<string, string>();
                  return plan.movements.map((m, i) => {
                    const mm = fd.materials.find(x => x.id === m.materialId);
                    if (m.warehouseId !== whId) return <li key={i}>{mm?.name}: +{formatQty(m.qty)} {mm ? UNIT_LABEL[mm.stockUnit] : ""} w magazynie {whName(m.warehouseId)}</li>;
                    const before = running.get(m.materialId) ?? bal(m.materialId);
                    const after = qtySum(before, m.qty);
                    running.set(m.materialId, after);
                    return <li key={i}>{mm?.name}: {formatQty(before)} → <span className={after.startsWith("-") ? "neg" : ""}>{formatQty(after)}</span> {mm ? UNIT_LABEL[mm.stockUnit] : ""}</li>;
                  });
                })()}
                {plan.transfer?.twoStage && <li>W drodze do: <strong>{whName(plan.transfer.targetWarehouseId)}</strong> (przyjęcie w magazynie docelowym)</li>}</ul>
                <dl className="kv">
                  {Number(plan.totals.purchaseCost) > 0 && <><dt>Zakup</dt><dd className="num">{pln(plan.totals.purchaseCost)}</dd></>}
                  {Number(plan.totals.revenue) > 0 && <><dt>Przychód</dt><dd className="num">{pln(plan.totals.revenue)}</dd></>}
                  {Number(plan.totals.chippingCost) > 0 && <><dt>Rąbanie</dt><dd className="num">{pln(plan.totals.chippingCost)}</dd></>}
                  {Number(plan.totals.additionalCost) > 0 && <><dt>Dodatkowe</dt><dd className="num">{pln(plan.totals.additionalCost)}</dd></>}
                  {Number(plan.totals.transportCost) > 0 && <><dt>Transport</dt><dd className="num" id="op-live-transport">{pln(plan.totals.transportCost)}</dd></>}
                </dl>
              </>
            )}
            <p className="muted small mt">Stan „po” w podglądzie jest orientacyjny; ostateczną decyzję podejmuje serwer w chwili zapisu.</p>
          </aside>
          </div>
        </div>
      )}
      {preview && input && fd && <ConfirmDialog preview={preview} input={input} fd={fd} onClose={() => setPreview(null)}
        correction={corr ? { id: corr.id, version: corr.version, reason } : null}
        onDone={op => {
          setPreview(null); reset(); setReason("");
          setCreated({ id: op.id, numbers: op.documents.map(d => d.number), corrected: !!corr }); setDetail(op.id);
          if (corr) void navigate("/nowa-operacja", { replace: true });
        }} />}
      {detail && <OperationDetail id={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

/** Podsumowanie przed zatwierdzeniem: numery, pozycje, stan przed / po; przy braku towaru zapis jest zablokowany. */
function ConfirmDialog({ preview, input, fd, correction, onClose, onDone }: {
  preview: Preview; input: OperationInput; fd: FormData; correction: { id: string; version: number; reason: string } | null; onClose: () => void; onDone: (op: OperationView) => void;
}) {
  const qc = useQueryClient();
  const key = useRef(newKey()); // jeden klucz na to podsumowanie — ponowienie po błędzie sieci nie zdubluje operacji
  const save = useMutation({
    mutationFn: () => correction
      ? api.post<{ operation: OperationView }>(`/operations/${correction.id}/correction`, { idempotencyKey: key.current, version: correction.version, reason: correction.reason, operation: input })
      : api.post<{ operation: OperationView }>("/operations", { idempotencyKey: key.current, operation: input }),
    onSuccess: r => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({ queryKey: ["stock"] });
      void qc.invalidateQueries({ queryKey: ["operations"] });
      void qc.invalidateQueries({ queryKey: ["operation"] });
      onDone(r.operation);
    },
  });
  const multiWh = new Set(preview.steps.map(s => s.key.split("|")[0])).size > 1;
  const name = (k: string) => {
    const [wh, id] = k.split("|"); const m = fd.materials.find(x => x.id === id);
    const w = fd.warehouses.find(x => x.id === wh)?.name;
    return { name: `${m?.name ?? "materiał"}${multiWh && w ? ` — ${w}` : ""}`, unit: m ? UNIT_LABEL[m.stockUnit] : "" };
  };
  const p = preview.plan;
  const blocked = preview.shortages.length > 0;
  return (
    <Dialog title={correction ? "Podsumowanie korekty" : "Podsumowanie operacji"} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Wróć do edycji</button>
        <button type="button" className="btn primary" id="op-confirm" disabled={blocked || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Zapisywanie…" : correction ? "Zatwierdź korektę" : "Zatwierdź operację"}</button>
      </>}>
      <div id="op-summary">
        {save.isError && <Alert kind="err">{errorText(save.error)}</Alert>}
        {preview.shortages.map((s, i) => <Alert key={i} kind="err">{s.message}</Alert>)}
        {correction && <>
          <p className="small"><span className="muted">Powód korekty:</span> {correction.reason}</p>
          {preview.changes?.length ? <ChangesTable changes={preview.changes} id="op-changes" /> : <Alert kind="warn">Nic się nie zmieniło — korekta nie jest potrzebna.</Alert>}
        </>}
        <ul className="plain">{p.documents.map((d, i) => <li key={i}><DocBadge type={d.type} /> <strong className="doc" data-number>{preview.numbers[i]}</strong>
          {d.lines.map((l, j) => <span key={j}> — {formatQty(l.qtySource)} {UNIT_LABEL[l.unitSource]}{l.unitSource !== l.unitStock ? ` = ${formatQty(l.qtyStock)} ${UNIT_LABEL[l.unitStock]}` : ""}{l.value ? ` · ${pln(l.value)}` : ""}</span>)}</li>)}</ul>
        {p.summary.map((s, i) => <p key={i} className="summary">{s}</p>)}
        {correction && preview.steps.length > 0 && <p className="small muted mt">Zmiana stanów (netto — odwrócenie poprzedniej wersji i nowe ruchy):</p>}
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Materiał</th><th className="r">Przed</th><th className="r">Zmiana</th><th className="r">Po</th></tr></thead>
          <tbody>{preview.steps.map((s, i) => { const n = name(s.key); return (
            <tr key={i}><td data-label="Materiał">{n.name}</td><td data-label="Przed" className="r num">{formatQty(s.before)} {n.unit}</td>
              <td data-label="Zmiana" className={`r num ${Number(s.qty) < 0 ? "neg" : "pos"}`}>{Number(s.qty) > 0 ? "+" : ""}{formatQty(s.qty)}</td>
              <td data-label="Po" className={`r num ${Number(s.after) < 0 ? "neg" : ""}`}>{formatQty(s.after)} {n.unit}</td></tr>); })}</tbody>
        </table></div>
        {p.extras.length > 0 && <ul className="plain mt">{p.extras.map((x, i) => <li key={i}>{x.typeName}{x.quantity ? ` · ${formatQty(x.quantity)}` : ""} — {pln(x.cost)}</li>)}</ul>}
        <dl className="kv mt">
          {Number(p.totals.purchaseCost) > 0 && <><dt>Wartość zakupu</dt><dd>{pln(p.totals.purchaseCost)}</dd></>}
          {Number(p.totals.revenue) > 0 && <><dt>Przychód</dt><dd>{pln(p.totals.revenue)}</dd></>}
          {Number(p.totals.chippingCost) > 0 && <><dt>Rąbanie</dt><dd>{pln(p.totals.chippingCost)}</dd></>}
          {Number(p.totals.additionalCost) > 0 && <><dt>Operacje dodatkowe</dt><dd>{pln(p.totals.additionalCost)}</dd></>}
          {p.transport && p.transport.mode !== "NONE" && <><dt>Transport</dt><dd>{TRANSPORT_MODE_LABEL[p.transport.mode]} · {p.transport.runs.length > 0 ? `${p.transport.runs.length} ${p.transport.runs.length === 1 ? "kurs" : "kursy"} · ` : ""}{pln(p.totals.transportCost)}</dd></>}
        </dl>
        {p.warnings.map((w, i) => <Alert key={i} kind="warn">{w}</Alert>)}
        {blocked && <p className="muted small">Zapis zablokowany — w magazynie brakuje towaru. Zmniejsz ilość albo najpierw wprowadź przyjęcie.</p>}
      </div>
    </Dialog>
  );
}

/** Kartoteka floty z danych formularza — ten sam zestaw reguł w podglądzie co w API (planTransport). */
function fleetOf(fd: FormData, warehouseId: string): TransportFleet {
  return {
    vehicles: new Map(fd.vehicles.map(v => [v.id, { id: v.id, registration: v.registration, status: v.status as "ACTIVE" | "SERVICE" | "RETIRED", warehouseId: v.warehouseId ?? warehouseId, defaultDriverId: v.defaultDriverId, ownership: v.ownership }])),
    drivers: new Map(fd.drivers.map(d => [d.id, { id: d.id, name: d.name, active: true }])),
    companies: new Map(fd.companies.map(c => [c.id, { id: c.id, name: c.name, active: true }])),
    warehouseNames: new Map(fd.warehouses.map(w => [w.id, w.name])),
  };
}
