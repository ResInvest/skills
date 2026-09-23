/* Testy jednostkowe silnika demonstratora.  Uruchomienie:  node --test tests/ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const R = require("../demo/src/engine.js");
require("../demo/src/seed.js");

const TODAY = "2026-09-23";
const fresh = () => R.Seed.build(TODAY);
const ctx = (s, uid = "u_kier", today = TODAY) => ({ user: s.users.find(u => u.id === uid), today, source: "test" });
const draft = over => R.Seed.draftOf(over.date || TODAY, Object.assign({ transport: { mode: "none", place: "RiC Zabrze" } }, over));
const bal = (s, pid, wh = "wh_zab") => R.Stock.balance(s, wh, pid);
const PURCHASE_A = { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "20", unit: "m3", price: "230", weightMode: "auto" };
const LESNA = { enabled: true, type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Stanica", kwit: "KW 0300/09/2026" };

/* ---------------------------- Scenariusz F ---------------------------- */
test("F: 12,50 / 12.50 / 1 250,50 / 1\\u00A0250,50 — normalizacja liczb", () => {
  assert.equal(R.NumParse.parse("12,50").value, 12.5);
  assert.equal(R.NumParse.parse("12.50").value, 12.5);
  assert.equal(R.NumParse.parse("1 250,50").value, 1250.5);
  assert.equal(R.NumParse.parse("1\u00A0250,50").value, 1250.5);
  assert.equal(R.NumParse.parse("1\u202F250,50").value, 1250.5);
  assert.equal(R.NumParse.parse("1.250,50").value, 1250.5);
  assert.equal(R.NumParse.parse("1,250.50").value, 1250.5);
  assert.equal(R.NumParse.parse(" 230 zł/m³ ").value, 230);
  assert.equal(R.NumParse.parse("12,5 m3").value, 12.5);
  assert.equal(R.NumParse.parse("26,4 t").value, 26.4);
  assert.equal(R.NumParse.parse("80 MP").value, 80);
  assert.equal(R.NumParse.parse("−5").value, -5);
});
test("F: błędne formaty są odrzucane, a nie liczone jako 0", () => {
  for (const bad of ["abc", "1,2,3.4", "12.5.3,1", "1 2a", "--5", "1.25.0"]) {
    const r = R.NumParse.parse(bad);
    assert.equal(r.ok, false, bad);
  }
  assert.equal(R.NumParse.parse("").empty, true);
});
test("F: ta sama ilość wpisana na 4 sposoby daje identyczny plan", () => {
  const s = fresh();
  const costs = ["12,50", "12.50", "1 250,50", "1\u00A0250,50"].map(q => {
    const p = R.planOperation(s, draft({ purchase: Object.assign({}, PURCHASE_A, { qty: q, unit: "MP", price: "10" }) }), ctx(s));
    return [p.totals.purchaseMP, p.totals.purchaseCost];
  });
  assert.deepEqual(costs[0], costs[1]);
  assert.deepEqual(costs[2], costs[3]);
  assert.deepEqual(costs[2], [1250.5, 12505]);
});

/* ---------------------------- Scenariusz A ---------------------------- */
test("A: zakup 20 m³ × 230 zł — 80 MP, 26,40 t, 4 600 zł", () => {
  const s = fresh();
  const before = bal(s, "pr_drewno");
  const r = R.commitOperation(s, draft({ purchase: PURCHASE_A }), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.op.purchase.mp, 80);
  assert.equal(r.op.purchase.weightT, 26.4);
  assert.equal(r.op.totals.purchaseCost, 4600);
  assert.equal(r.op.whId, "wh_zab");
  assert.equal(r.op.place, "RiC Zabrze");
  assert.equal(R.round(bal(s, "pr_drewno") - before, 3), 80);
  assert.deepEqual(r.op.documents.map(d => d.type), ["PZ"]);
  assert.equal(R.money(4600).replace(/\u00A0/g, " "), "4 600,00 zł");
});
test("A: waga ręczna nie zmienia ilości ewidencyjnej", () => {
  const s = fresh();
  const r = R.commitOperation(s, draft({ purchase: Object.assign({}, PURCHASE_A, { weightMode: "manual", weightManual: "27,10" }) }), ctx(s));
  assert.equal(r.ok, true);
  assert.equal(r.op.purchase.weightT, 27.1);
  assert.equal(r.op.purchase.mp, 80);
});
test("A: zakup w tonach normalizuje się do MP", () => {
  const s = fresh();
  const p = R.planOperation(s, draft({ purchase: Object.assign({}, PURCHASE_A, { qty: "26,4", unit: "t" }) }), ctx(s));
  assert.equal(p.totals.purchaseMP, 80);
});

/* ---------------------------- Scenariusz B ---------------------------- */
test("B: zakup + produkcja leśna — drewno nie jest liczone podwójnie, zrębka +80 MP", () => {
  const s = fresh();
  const wood0 = bal(s, "pr_drewno"), chip0 = bal(s, "pr_zr_lesna");
  const r = R.commitOperation(s, draft({ purchase: PURCHASE_A, production: LESNA }), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.plan.postings.map(p => [p.kind, p.mp]), [["ZAKUP", 80], ["ZUZYCIE", -80], ["PRODUKCJA", 80]]);
  assert.equal(bal(s, "pr_drewno"), wood0);
  assert.equal(R.round(bal(s, "pr_zr_lesna") - chip0, 3), 80);
  const pw = r.op.documents.find(d => d.type === "PW");
  assert.deepEqual([pw.meta.ndl, pw.meta.lesnictwo, pw.meta.kwit], ["Rudy Raciborskie", "Stanica", "KW 0300/09/2026"]);
});
test("B: produkcja leśna wymaga NDL, leśnictwa i kwitu", () => {
  const s = fresh();
  const p = R.planOperation(s, draft({ purchase: PURCHASE_A, production: { enabled: true, type: "lesna" } }), ctx(s));
  for (const k of ["production.ndl", "production.lesnictwo", "production.kwit"]) assert.ok(p.errors[k], k);
});
test("B: produkcja inwestycyjna — typ źródła Wycinka inwestycyjna", () => {
  const s = fresh();
  const r = R.commitOperation(s, draft({ purchase: Object.assign({}, PURCHASE_A, { productId: "pr_drewno_inw" }), production: { enabled: true, type: "inwestycyjna", investSite: "DK88" } }), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.op.documents.find(d => d.type === "PW").meta.sourceType, "Wycinka inwestycyjna");
  assert.equal(r.op.production.outProductId, "pr_zr_inw");
});
test("B: zużycie większe niż stan + zakup jest blokowane", () => {
  const s = fresh(); // stan drewna Zabrze = 60 m³
  const p = R.planOperation(s, draft({ purchase: PURCHASE_A, production: Object.assign({}, LESNA, { consumeQty: "81" }) }), ctx(s));
  assert.ok(p.errors["production.consumeQty"]);
  const ok = R.planOperation(s, draft({ purchase: PURCHASE_A, production: Object.assign({}, LESNA, { consumeQty: "80" }) }), ctx(s));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
});
test("B: wynik produkcji nie może przekroczyć zużycia; mniejszy wymaga przyczyny", () => {
  const s = fresh();
  assert.ok(R.planOperation(s, draft({ purchase: PURCHASE_A, production: Object.assign({}, LESNA, { outMP: "81" }) }), ctx(s)).errors["production.outMP"]);
  assert.ok(R.planOperation(s, draft({ purchase: PURCHASE_A, production: Object.assign({}, LESNA, { outMP: "75" }) }), ctx(s)).errors["production.diffReason"]);
  assert.equal(R.planOperation(s, draft({ purchase: PURCHASE_A, production: Object.assign({}, LESNA, { outMP: "75", diffReason: "straty" }) }), ctx(s)).ok, true);
});
test("B: produkcja tylko z surowca drzewnego", () => {
  const s = fresh();
  const p = R.planOperation(s, draft({ purchase: Object.assign({}, PURCHASE_A, { productId: "pr_zr_tow", unit: "MP" }), production: LESNA }), ctx(s));
  assert.ok(p.errors["production.enabled"]);
});

/* ---------------------------- Scenariusz C ---------------------------- */
test("C: zakup + produkcja + sprzedaż 80 MP — stan zrębki bez zmian, przychód zapisany", () => {
  const s = fresh();
  const wood0 = bal(s, "pr_drewno"), chip0 = bal(s, "pr_zr_lesna");
  const r = R.commitOperation(s, draft({ purchase: PURCHASE_A, production: LESNA, sale: { enabled: true, buyerId: "pa_ec_zab", price: "90", priceUnit: "MP" }, transport: { mode: "own", place: "Elektrociepłownia Zabrze S.A.", own: { vehicleId: "ve_scania", km: "262", rate: "5" } } }), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.plan.postings.map(p => p.kind), ["ZAKUP", "ZUZYCIE", "PRODUKCJA", "SPRZEDAZ"]);
  assert.equal(bal(s, "pr_drewno"), wood0);
  assert.equal(bal(s, "pr_zr_lesna"), chip0);
  assert.equal(r.op.totals.revenue, 7200);
  assert.deepEqual(r.op.documents.map(d => d.type), ["PZ", "RW", "PW", "WZ", "TR"]);
  assert.ok(r.op.documents.every(d => d.place === "Elektrociepłownia Zabrze S.A."));
});
test("C: sprzedaż większa niż wynik produkcji jest blokowana", () => {
  const s = fresh();
  const p = R.planOperation(s, draft({ purchase: PURCHASE_A, production: LESNA, sale: { enabled: true, buyerId: "pa_ec_zab", qtyMP: "80,01", price: "90" } }), ctx(s));
  assert.ok(p.errors["sale.qtyMP"]);
});
test("C: odbiorca wymagany; sprzedaż wymaga produkcji", () => {
  const s = fresh();
  assert.ok(R.planOperation(s, draft({ purchase: PURCHASE_A, production: LESNA, sale: { enabled: true, price: "90" } }), ctx(s)).errors["sale.buyerId"]);
  assert.ok(R.planOperation(s, draft({ purchase: PURCHASE_A, sale: { enabled: true, buyerId: "pa_ec_zab", price: "90" } }), ctx(s)).errors["sale.enabled"]);
});

/* ------------------------- Transport: D, E, pociąg ------------------------- */
test("D: transport własny 262 km × 5 zł = 1 310 zł, kierowca domyślny i zmiana dla kursu", () => {
  const s = fresh();
  const base = { purchase: PURCHASE_A, transport: { mode: "own", place: "RiC Zabrze", own: { vehicleId: "ve_scania", km: "262", rate: "5" } } };
  const p = R.planOperation(s, draft(base), ctx(s));
  assert.equal(p.norm.transport.cost, 1310);
  assert.equal(p.norm.transport.driverName, "Jan Kowalski");
  assert.equal(p.norm.transport.driverOverridden, false);
  const d2 = draft(base); d2.transport.own.driverId = "dr_wojcik";
  const r = R.commitOperation(s, d2, ctx(s));
  assert.equal(r.op.transport.driverName, "Tomasz Wójcik");
  assert.equal(r.op.transport.driverOverridden, true);
  assert.equal(s.fleet.vehicles.find(v => v.id === "ve_scania").driverId, "dr_kowalski", "kartoteka pojazdu bez zmian");
  // późniejsza zmiana kierowcy domyślnego nie zmienia zapisanego kursu
  R.Fleet.save(s, "vehicles", Object.assign({}, s.fleet.vehicles.find(v => v.id === "ve_scania"), { driverId: "dr_nowak" }), ctx(s));
  assert.equal(s.operations.find(o => o.id === r.op.id).transport.driverName, "Tomasz Wójcik");
});
test("D: pojazd w serwisie nie może wykonać kursu", () => {
  const s = fresh();
  const p = R.planOperation(s, draft({ purchase: PURCHASE_A, transport: { mode: "own", place: "X", own: { vehicleId: "ve_man", km: "10" } } }), ctx(s));
  assert.ok(p.errors["transport.own.vehicleId"]);
});
test("E: transport zewnętrzny — fracht 1 250 zł; wliczony w cenę → 0 zł", () => {
  const s = fresh();
  const ext = { company: "ESI Logistics", reg: "esi 18734", km: "262", freight: "1 250" };
  const p = R.planOperation(s, draft({ purchase: PURCHASE_A, transport: { mode: "external", place: "RiC Zabrze", external: ext } }), ctx(s));
  assert.equal(p.norm.transport.cost, 1250);
  assert.equal(p.norm.transport.reg, "ESI 18734");
  const p0 = R.planOperation(s, draft({ purchase: PURCHASE_A, transport: { mode: "external", place: "RiC Zabrze", external: Object.assign({}, ext, { includedInPrice: true }) } }), ctx(s));
  assert.equal(p0.norm.transport.cost, 0);
  assert.equal(p0.ok, true);
});
test("Transport nie zmienia stanu magazynowego (każdy tryb daje identyczne zapisy księgi)", () => {
  const s = fresh();
  const modes = [
    { mode: "none", place: "RiC Zabrze" },
    { mode: "own", place: "RiC Zabrze", own: { vehicleId: "ve_scania", km: "262" } },
    { mode: "external", place: "RiC Zabrze", external: { company: "DAP", reg: "SZA 7K901", freight: "900" } },
    { mode: "train", place: "RiC Zabrze", train: { wagonCount: "3", sameForAll: true, sameT: "20", price: "30", priceUnit: "t" } }
  ];
  const sig = modes.map(t => JSON.stringify(R.planOperation(s, draft({ purchase: PURCHASE_A, production: LESNA, transport: t }), ctx(s)).postings.map(p => [p.kind, p.productId, p.mp])));
  assert.equal(new Set(sig).size, 1);
});
test("Pociąg: tonaż wspólny i ręczny per wagon, cena za t / MP / m³", () => {
  const s = fresh();
  const tr = over => R.planOperation(s, draft({ purchase: PURCHASE_A, transport: { mode: "train", place: "Bocznica", train: Object.assign({ wagonCount: "2", sameForAll: true, sameT: "16,5", price: "28", priceUnit: "t" }, over) } }), ctx(s)).norm.transport;
  assert.deepEqual([tr({}).totalT, tr({}).cost], [33, 924]);
  assert.deepEqual(tr({}).wagonT, [16.5, 16.5]);
  const manual = tr({ sameForAll: false, wagonT: ["16", "17,5"] });
  assert.deepEqual([manual.totalT, manual.cost], [33.5, 938]);
  assert.equal(tr({ priceUnit: "MP", price: "2" }).cost, 200);   // 33 t = 100 MP
  assert.equal(tr({ priceUnit: "m3", price: "10" }).cost, 250);  // 100 MP = 25 m³
  const p = R.planOperation(s, draft({ purchase: PURCHASE_A, transport: { mode: "train", place: "B", train: { wagonCount: "2", sameForAll: false, wagonT: ["16", ""], price: "1", priceUnit: "t" } } }), ctx(s));
  assert.ok(p.errors["transport.train.wagonT.1"]);
});

/* ------------------------- Atomowość, idempotencja, wyścig ------------------------- */
test("Idempotencja: dwa zapisy tego samego formularza tworzą jedną operację", () => {
  const s = fresh();
  const d = draft({ purchase: PURCHASE_A });
  const n0 = s.operations.length, l0 = s.ledger.length;
  assert.equal(R.commitOperation(s, d, ctx(s)).ok, true);
  const again = R.commitOperation(s, d, ctx(s));
  assert.equal(again.duplicate, true);
  assert.equal(s.operations.length, n0 + 1);
  assert.equal(s.ledger.length, l0 + 1);
});
test("Atomowość: odrzucona operacja nie zostawia żadnego zapisu", () => {
  const s = fresh();
  const snap = JSON.stringify(s);
  const r = R.commitOperation(s, draft({ purchase: PURCHASE_A, production: Object.assign({}, LESNA, { kwit: "" }), sale: { enabled: true, buyerId: "pa_ec_zab", price: "90" } }), ctx(s));
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(s), snap);
});
test("Wyścig: dwóch użytkowników zużywa ten sam stan — drugi zapis odrzucony, brak stanu ujemnego", () => {
  const s = fresh(); // 60 m³ drewna w Zabrzu
  const a = draft({ purchase: Object.assign({}, PURCHASE_A, { qty: "1" }), production: Object.assign({}, LESNA, { consumeQty: "61" }) });
  const b = draft({ purchase: Object.assign({}, PURCHASE_A, { qty: "1" }), production: Object.assign({}, LESNA, { consumeQty: "61" }) });
  // oba formularze zaplanowane na tym samym stanie — oba wyglądają poprawnie
  assert.equal(R.planOperation(s, a, ctx(s, "u_mag")).ok, true);
  assert.equal(R.planOperation(s, b, ctx(s, "u_kier")).ok, true);
  // zapis jest ponownie walidowany na bieżącym stanie
  assert.equal(R.commitOperation(s, a, ctx(s, "u_mag")).ok, true);
  const second = R.commitOperation(s, b, ctx(s, "u_kier"));
  assert.equal(second.ok, false);
  assert.ok(bal(s, "pr_drewno") >= 0);
});
test("Kolejność księgowania jest deterministyczna, numery dokumentów rosną", () => {
  const s = fresh();
  const r1 = R.commitOperation(s, draft({ purchase: PURCHASE_A, production: LESNA, sale: { enabled: true, buyerId: "pa_ec_zab", price: "90" } }), ctx(s));
  const steps = s.ledger.filter(l => l.opId === r1.op.id).sort((a, b) => a.seq - b.seq).map(l => l.kind);
  assert.deepEqual(steps, ["ZAKUP", "ZUZYCIE", "PRODUKCJA", "SPRZEDAZ"]);
  assert.equal(r1.op.no, "PZ/003/09/2026");   // numeracja firmowa: PZ/001 i PZ/002 są w danych przykładowych
  const r2 = R.commitOperation(s, draft({ purchase: PURCHASE_A }), ctx(s));
  assert.equal(r2.op.no, "PZ/004/09/2026");
});

/* ------------------------- Uprawnienia, magazyn z kontekstu ------------------------- */
test("Magazyn wynika z użytkownika; rola Podgląd nie tworzy operacji", () => {
  const s = fresh();
  const r = R.commitOperation(s, draft({ purchase: PURCHASE_A }), ctx(s, "u_pys"));
  assert.equal(r.op.whId, "wh_pys");
  assert.equal(R.planOperation(s, draft({ purchase: PURCHASE_A }), ctx(s, "u_view")).errors._user !== undefined, true);
});
test("Data z przyszłości jest odrzucana", () => {
  const s = fresh();
  assert.ok(R.planOperation(s, draft({ date: "2026-09-24", purchase: PURCHASE_A }), ctx(s)).errors.date);
});

/* ---------------------------- Scenariusz G ---------------------------- */
test("G: inwentaryzacja 2026-08 — otwarcie, lista, spis, zamknięcie, tylko odczyt, blokada okresu", () => {
  const s = fresh();
  const c = ctx(s);
  assert.equal(R.Inventory.open(s, "2026-08", c).ok, true);
  const g = R.Inventory.generate(s, "2026-08", c);
  assert.equal(g.ok, true);
  const line = g.period.lines.find(l => l.productId === "pr_drewno");
  assert.equal(line.bookMP, 240);                     // 60 + 30 − 30 m³ = 60 m³ = 240 MP na 31.08
  for (const l of g.period.lines) assert.equal(R.Inventory.setCount(s, "2026-08", l.productId, R.fmtQ(R.Units.fromMP(l.bookMP, l.unit, s.config)), c).ok, true);
  assert.equal(R.Inventory.setCount(s, "2026-08", "pr_drewno", "58,5", c).ok, true);   // różnica −1,5 m³
  assert.equal(R.Inventory.close(s, "2026-08", ctx(s, "u_mag")).ok, false, "magazynier nie zamyka");
  const cl = R.Inventory.close(s, "2026-08", c);
  assert.equal(cl.ok, true, cl.error);
  assert.equal(cl.docNo, "IN/001/08/2026");
  assert.deepEqual(cl.diffs, [{ productId: "pr_drewno", mp: -6 }]);
  assert.equal(R.Inventory.setCount(s, "2026-08", "pr_drewno", "1", c).ok, false);
  assert.equal(R.Inventory.generate(s, "2026-08", c).ok, false);
  assert.ok(R.planOperation(s, draft({ date: "2026-08-30", purchase: PURCHASE_A }), c).errors.date);
  assert.equal(R.planOperation(s, draft({ date: "2026-09-01", purchase: PURCHASE_A }), c).ok, true);
  assert.equal(R.Stock.balance(s, "wh_zab", "pr_drewno", "2026-08-31"), 234);
});
test("G: zamknięcie wymaga kompletnego spisu", () => {
  const s = fresh(); const c = ctx(s);
  R.Inventory.open(s, "2026-09", c); R.Inventory.generate(s, "2026-09", c);
  assert.match(R.Inventory.close(s, "2026-09", c).error, /Brak stanu ze spisu/);
});
test("G: poprzedni miesiąc zamyka się automatycznie na początku kolejnego", () => {
  const s = fresh(); const c = ctx(s);
  R.Inventory.open(s, "2026-09", c); R.Inventory.generate(s, "2026-09", c);
  assert.deepEqual(R.Inventory.autoClose(s, ctx(s)), [], "w tym samym miesiącu nic się nie dzieje");
  const done = R.Inventory.autoClose(s, ctx(s, "u_kier", "2026-10-01"));
  assert.equal(done.length, 1);
  assert.equal(done[0].ok, true);
  const p = R.Inventory.find(s, "wh_zab", "2026-09");
  assert.equal(p.status, "ZAMKNIETA");
  assert.equal(p.auto, true);
  assert.ok(p.lines.every(l => l.assumed));
  assert.equal(s.audit.at(-1).source, "Automat: początek kolejnego miesiąca");
});

/* ---------------------------- Korekta, audyt ---------------------------- */
test("Storno odwraca zapisy w odwrotnej kolejności; blokada gdy materiał rozchodowany", () => {
  const s = fresh(); const c = ctx(s);
  const wood0 = bal(s, "pr_drewno"), chip0 = bal(s, "pr_zr_lesna");
  const r = R.commitOperation(s, draft({ purchase: PURCHASE_A, production: LESNA }), c);
  assert.equal(R.stornoOperation(s, r.op.id, ctx(s, "u_mag"), "x").ok, false, "magazynier nie koryguje");
  assert.equal(R.stornoOperation(s, r.op.id, c, "").ok, false, "wymagana przyczyna");
  const st = R.stornoOperation(s, r.op.id, c, "błędna ilość");
  assert.equal(st.ok, true, st.error);
  assert.equal(bal(s, "pr_drewno"), wood0);
  assert.equal(bal(s, "pr_zr_lesna"), chip0);
  assert.equal(R.stornoOperation(s, r.op.id, c, "ponownie").ok, false);
  // materiał sprzedany → storno zakupu zrębki niemożliwe
  const s2 = fresh();
  const buy = R.commitOperation(s2, draft({ purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: "10", unit: "MP", price: "50" } }), ctx(s2));
  s2.ledger.push({ id: "x", seq: 9999, opId: null, date: TODAY, whId: "wh_zab", productId: "pr_zr_tow", kind: "SPRZEDAZ", mp: -305, t: 0, docNo: "WZ/X" });
  assert.equal(R.stornoOperation(s2, buy.op.id, ctx(s2), "test").ok, false);
});
test("Audyt: użytkownik, czas, operacja, akcja, stan przed/po, źródło", () => {
  const s = fresh();
  const r = R.commitOperation(s, draft({ purchase: PURCHASE_A }), ctx(s));
  const a = s.audit.at(-1);
  assert.equal(a.userName, "Anna Górska");
  assert.ok(a.ts);
  assert.equal(a.opNo, r.op.no);
  assert.equal(a.action, "Utworzenie operacji");
  assert.equal(a.before.stanMP.pr_drewno + 80, a.after.stanMP.pr_drewno);
  assert.equal(a.source, "test");
});
test("Flota: walidacja rejestracji i kierowcy domyślnego, uprawnienia", () => {
  const s = fresh();
  assert.equal(R.Fleet.save(s, "vehicles", { name: "DAF", reg: "SGL4T821", type: "ciezarowy", status: "aktywny", driverId: "dr_nowak" }, ctx(s)).ok, false, "duplikat rejestracji");
  assert.equal(R.Fleet.save(s, "vehicles", { name: "DAF", reg: "SZ 1111A", type: "ciezarowy", status: "aktywny", driverId: "" }, ctx(s)).errors.driverId !== undefined, true);
  assert.equal(R.Fleet.save(s, "vehicles", { name: "DAF", reg: "SZ 1111A", type: "ciezarowy", status: "aktywny", driverId: "dr_nowak" }, ctx(s, "u_mag")).ok, false);
  assert.equal(R.Fleet.save(s, "chippers", { name: "Rębak 3", status: "aktywny", operatorId: "op_lis" }, ctx(s)).ok, true);
  assert.equal(R.Fleet.remove(s, "drivers", "dr_kowalski", ctx(s)).ok, false, "kierowca domyślny pojazdu");
  assert.equal(R.Fleet.remove(s, "drivers", "dr_wojcik", ctx(s)).ok, true);
});
test("Kontrola struktury kopii odrzuca uszkodzone dane", () => {
  const s = fresh();
  assert.deepEqual(R.validateStateShape(s), []);
  const bad = JSON.parse(JSON.stringify(s)); delete bad.ledger;
  assert.ok(R.validateStateShape(bad).length);
  const bad2 = JSON.parse(JSON.stringify(s)); bad2.ledger[0].mp = "x";
  assert.ok(R.validateStateShape(bad2).length);
});
