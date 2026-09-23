/* Testy jednostkowe silnika Demo v2.  Uruchomienie:  node --test tests/engine.test.mjs */
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
const prod = (s, id) => s.products.find(p => p.id === id);
const PURCHASE_A = { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "20", unit: "m3", price: "230", weightMode: "auto" };
const LESNA = { enabled: true, type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Stanica", kwit: "KW 0300/09/2026" };
const WZ = over => draft({ type: "SPRZEDAZ", sale: Object.assign({ productId: "pr_zr_lesna", qty: "500", unit: "MP", buyerId: "pa_ec_zab", price: "90" }, over) });
const DIRECT = (sale = {}, production = {}) => draft({ type: "SPRZEDAZ",
  production: Object.assign({ type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Kuźnia", kwit: "KW 1/09/2026", outMP: "600" }, production),
  sale: Object.assign({ direct: true, buyerId: "pa_elektrownia", price: "88", priceUnit: "MP" }, sale) });
const PROD = over => draft({ type: "PRODUKCJA", production: Object.assign({ rawProductId: "pr_drewno", consumeQty: "817", type: "lesna" }, over) });

/* ------------------------- dane startowe = przykłady z polecenia ------------------------- */
test("Stan startowy: zrębka 8 293 MP ≈ 2 737 t, drewno 817 m³ ≈ 778 t, PKS i łupina 728 t", () => {
  const s = fresh();
  assert.equal(bal(s, "pr_zr_lesna"), 8293);
  assert.equal(Math.round(R.Units.mass(8293, prod(s, "pr_zr_lesna"), s.config)), 2737);
  assert.equal(bal(s, "pr_drewno"), 817);
  assert.equal(Math.round(R.Units.mass(817, prod(s, "pr_drewno"), s.config)), 778);
  assert.equal(bal(s, "pr_pks"), 728);
  assert.equal(bal(s, "pr_lupina"), 728);
  assert.deepEqual(R.validateStateShape(s), []);
});

/* ------------------------------- jednostki produktu ------------------------------- */
test("Jednostki: drewno m³, zrębka MP, PKS/łupina wyłącznie t — bez sztucznych przeliczeń", () => {
  const s = fresh();
  assert.deepEqual(R.Units.allowed(prod(s, "pr_drewno")), ["m3", "MP", "t"]);
  assert.deepEqual(R.Units.allowed(prod(s, "pr_zr_lesna")), ["MP", "t"]);
  assert.deepEqual(R.Units.allowed(prod(s, "pr_pks")), ["t"]);
  assert.deepEqual(R.Units.allowed(prod(s, "pr_lupina")), ["t"]);
  assert.throws(() => R.Units.convert(10, "t", "MP", prod(s, "pr_pks"), s.config));
  assert.equal(R.Units.convert(20, "m3", "MP", prod(s, "pr_drewno"), s.config), 80);
  assert.equal(R.Units.convert(33, "t", "MP", prod(s, "pr_zr_lesna"), s.config), 100);
  // zakup PKS w MP jest odrzucany
  const p = R.planOperation(s, draft({ purchase: { supplierId: "pa_agro", basis: "DEKL", productId: "pr_pks", qty: "10", unit: "MP", price: "500" } }), ctx(s));
  assert.ok(p.errors["purchase.unit"]);
  const ok = R.commitOperation(s, draft({ purchase: { supplierId: "pa_agro", basis: "DEKL", productId: "pr_pks", qty: "12,5", unit: "t", price: "500" } }), ctx(s));
  assert.equal(ok.ok, true, ok.error);
  assert.equal(bal(s, "pr_pks"), 740.5);
  assert.equal(s.ledger.at(-1).unit, "t");
});

/* ---------------------------- liczby / przecinek ---------------------------- */
test("Liczby: 12,50 / 12.50 / 1 250,50 / 1\\u00A0250,50 / 1.250,50 — ta sama wartość", () => {
  for (const [t, v] of [["12,50", 12.5], ["12.50", 12.5], ["1 250,50", 1250.5], ["1\u00A0250,50", 1250.5], ["1\u202F250,50", 1250.5], ["1.250,50", 1250.5], ["1,250.50", 1250.5], [" 230 zł/m³ ", 230], ["26,4 t", 26.4], ["−5", -5]]) {
    assert.equal(R.NumParse.parse(t).value, v, t);
  }
  for (const bad of ["abc", "1,2,3.4", "12.5.3,1", "1 2a", "--5", "1.25.0"]) assert.equal(R.NumParse.parse(bad).ok, false, bad);
});
test("Liczby: przecinek dziesiętny w WZ, rąbaniu i pociągu liczy poprawnie", () => {
  const s = fresh();
  assert.equal(R.planOperation(s, WZ({ qty: "500,5", price: "90,10" }), ctx(s)).totals.revenue, 45095.05);
  assert.equal(R.planOperation(s, DIRECT({}, { chipRate: "12,50" }), ctx(s)).totals.chippingCost, 7500);
  const tr = R.planOperation(s, draft({ purchase: PURCHASE_A, transport: { mode: "train", place: "X", train: { wagonCount: "2", tonMode: "each", wagonT: ["58,4", "60.1"], price: "25,5", priceUnit: "t" } } }), ctx(s)).norm.transport;
  assert.equal(tr.totalT, 118.5);
  assert.equal(tr.cost, 3021.75);
});

/* ------------------------------ A. Zakup ------------------------------ */
test("A: zakup 20 m³ × 230 zł — +20 m³ na stanie (= 80 MP), koszt 4 600 zł, masa orientacyjna", () => {
  const s = fresh();
  const r = R.commitOperation(s, draft({ purchase: PURCHASE_A }), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.op.purchase.stockQty, 20);
  assert.equal(R.Units.convert(r.op.purchase.stockQty, "m3", "MP", prod(s, "pr_drewno"), s.config), 80);
  assert.equal(r.op.totals.purchaseCost, 4600);
  assert.equal(r.op.purchase.weightT, 19.04);
  assert.equal(bal(s, "pr_drewno"), 837);
  assert.deepEqual(r.op.documents.map(d => d.type), ["PZ"]);
});
test("A: waga ręczna nie zmienia ilości na stanie", () => {
  const s = fresh();
  const r = R.commitOperation(s, draft({ purchase: Object.assign({}, PURCHASE_A, { weightMode: "manual", weightManual: "19,80" }) }), ctx(s));
  assert.equal(r.op.purchase.weightT, 19.8);
  assert.equal(bal(s, "pr_drewno"), 837);
});
test("A + łańcuch: zakup + autozużycie + produkcja (+ sprzedaż) nadal działa", () => {
  const s = fresh();
  const r = R.commitOperation(s, draft({ purchase: PURCHASE_A, production: LESNA, sale: { enabled: true, buyerId: "pa_ec_zab", price: "90" } }), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.plan.postings.map(p => [p.kind, p.qty]), [["ZAKUP", 20], ["ZUZYCIE", -20], ["PRODUKCJA", 80], ["SPRZEDAZ", -80]]);
  assert.equal(bal(s, "pr_drewno"), 817);
  assert.equal(bal(s, "pr_zr_lesna"), 8293);
  assert.equal(r.op.totals.chippingCost, 800);
  assert.equal(r.op.totals.revenue, 7200);
  assert.equal(r.op.documents.find(d => d.type === "PW").meta.fromDoc, r.op.documents.find(d => d.type === "RW").no);
});

/* ------------------------ B. Sprzedaż z magazynu (WZ) ------------------------ */
test("B: WZ 500 MP z 8 293 MP → 7 793 MP, bez produkcji, zapis w audycie", () => {
  const s = fresh();
  const r = R.commitOperation(s, WZ(), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.op.documents.map(d => d.type), ["WZ"]);
  assert.equal(bal(s, "pr_zr_lesna"), 7793);
  assert.equal(r.op.production, null);
  assert.equal(r.op.totals.revenue, 45000);
  assert.equal(r.op.sale.after, 7793);
  const a = s.audit.at(-1);
  assert.equal(a.before.stan.pr_zr_lesna, 8293);
  assert.equal(a.after.stan.pr_zr_lesna, 7793);
});
test("B: WZ większe niż stan jest blokowane", () => {
  const s = fresh();
  const p = R.planOperation(s, WZ({ qty: "8293,01" }), ctx(s));
  assert.match(p.errors["sale.qty"], /Na magazynie jest 8\u00A0293 MP/);
  assert.equal(R.planOperation(s, WZ({ qty: "8293" }), ctx(s)).ok, true);
});
test("B: WZ w jednostce zgodnej z towarem — zrębka w t, PKS tylko w t", () => {
  const s = fresh();
  const r = R.commitOperation(s, WZ({ qty: "33", unit: "t", price: "280" }), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(bal(s, "pr_zr_lesna"), 8193);            // 33 t = 100 MP
  assert.equal(r.op.totals.revenue, 9240);              // 33 t × 280 zł
  assert.ok(R.planOperation(s, WZ({ productId: "pr_pks", qty: "10", unit: "MP" }), ctx(s)).errors["sale.unit"]);
  const pks = R.commitOperation(s, WZ({ productId: "pr_pks", qty: "100", unit: "t", price: "600" }), ctx(s));
  assert.equal(pks.ok, true);
  assert.equal(bal(s, "pr_pks"), 628);
});
test("B: WZ wymaga odbiorcy i towaru", () => {
  const s = fresh();
  const p = R.planOperation(s, WZ({ productId: "", buyerId: "" }), ctx(s));
  assert.ok(p.errors["sale.productId"] && p.errors["sale.buyerId"]);
});
test("E: zakup → magazynowanie → późniejsza sprzedaż WZ", () => {
  const s = fresh();
  R.commitOperation(s, draft({ purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: "250", unit: "MP", price: "55" } }), ctx(s));
  assert.equal(bal(s, "pr_zr_tow"), 550);
  const wz = R.commitOperation(s, WZ({ productId: "pr_zr_tow", qty: "550", unit: "MP" }), ctx(s));
  assert.equal(wz.ok, true, wz.error);
  assert.equal(bal(s, "pr_zr_tow"), 0);
});

/* ------------------------ C. Produkcja na magazynie ------------------------ */
test("C: drewno 817 m³ ze stanu → RW −817 m³, PW +3 268 MP, powiązanie wejście→wyjście", () => {
  const s = fresh();
  const r = R.commitOperation(s, PROD(), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.op.purchase, null);
  assert.deepEqual(r.op.documents.map(d => d.type), ["RW", "PW"]);
  assert.equal(bal(s, "pr_drewno"), 0);
  assert.equal(bal(s, "pr_zr_lesna"), 8293 + 3268);
  const pw = r.op.documents.find(d => d.type === "PW"), rw = r.op.documents.find(d => d.type === "RW");
  assert.equal(pw.meta.fromDoc, rw.no);
  assert.equal(r.op.production.rawProductId, "pr_drewno");
  assert.equal(r.op.production.outProductId, "pr_zr_lesna");
  assert.equal(r.op.totals.chippingCost, 32680);        // 3 268 MP × 10 zł
});
test("C: zużycie większe niż stan blokowane; produkcja nie wymaga zakupu ani kwitu", () => {
  const s = fresh();
  const p = R.planOperation(s, PROD({ consumeQty: "817,5" }), ctx(s));
  assert.match(p.errors["production.consumeQty"], /Na magazynie jest 817 m³/);
  const ok = R.planOperation(s, PROD({ consumeQty: "100" }), ctx(s));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.ok(!Object.keys(ok.errors).some(k => k.startsWith("purchase.")));
});
test("C: wynik niższy od zużycia wymaga przyczyny, wyższy jest blokowany", () => {
  const s = fresh();
  assert.ok(R.planOperation(s, PROD({ consumeQty: "100", outMP: "401" }), ctx(s)).errors["production.outMP"]);
  assert.ok(R.planOperation(s, PROD({ consumeQty: "100", outMP: "380" }), ctx(s)).errors["production.diffReason"]);
  assert.equal(R.planOperation(s, PROD({ consumeQty: "100", outMP: "380", diffReason: "straty" }), ctx(s)).ok, true);
});

/* ------------------ D. Produkcja + sprzedaż bezpośrednia (las) ------------------ */
test("D: las → 600 MP → sprzedaż 600 MP do elektrowni; stan zrębki i drewna bez zmian", () => {
  const s = fresh();
  const r = R.commitOperation(s, DIRECT(), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.op.documents.map(d => d.type), ["PW", "WZ"]);
  assert.equal(bal(s, "pr_zr_lesna"), 8293);
  assert.equal(bal(s, "pr_drewno"), 817);
  assert.equal(r.op.direct, true);
  assert.equal(r.op.production.outMP, 600);
  assert.equal(r.op.sale.qty, 600);
  assert.equal(r.op.totals.revenue, 52800);
  assert.equal(r.op.totals.chippingCost, 6000);
  assert.ok(s.ledger.filter(l => l.opId === r.op.id).every(l => l.direct));
});
test("D: sprzedaż bezpośrednia nie pobiera ze stanu — działa nawet przy zerowym stanie zrębki", () => {
  const s = fresh();
  R.commitOperation(s, WZ({ qty: "8293" }), ctx(s));            // wyprzedaj cały stan
  assert.equal(bal(s, "pr_zr_lesna"), 0);
  const r = R.commitOperation(s, DIRECT(), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(bal(s, "pr_zr_lesna"), 0);
});
test("D: sprzedaż > produkcji blokowana; bez wymogu zakupu; niesprzedana reszta trafia na stan z ostrzeżeniem", () => {
  const s = fresh();
  assert.ok(R.planOperation(s, DIRECT({ qtyMP: "600,01" }), ctx(s)).errors["sale.qtyMP"]);
  const p = R.planOperation(s, DIRECT(), ctx(s));
  assert.ok(!Object.keys(p.errors).some(k => k.startsWith("purchase.")));
  const part = R.commitOperation(s, DIRECT({ qtyMP: "500" }), ctx(s));
  assert.ok(part.op.warnings.some(w => w.includes("100 MP")));
  assert.equal(bal(s, "pr_zr_lesna"), 8393);
});
test("D: surowiec z lasu (opcjonalnie) ogranicza wynik: 150 m³ → maks. 600 MP", () => {
  const s = fresh();
  assert.ok(R.planOperation(s, DIRECT({}, { rawProductId: "pr_drewno", rawQty: "150", outMP: "601" }), ctx(s)).errors["production.outMP"]);
  const r = R.commitOperation(s, DIRECT({}, { rawProductId: "pr_drewno", rawQty: "150", rawCost: "34 500" }), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(bal(s, "pr_drewno"), 817, "drewno z lasu nie jest zdejmowane ze stanu");
  assert.equal(r.op.totals.rawCost, 34500);
  assert.equal(r.op.totals.result, 52800 - 34500 - 6000);
});

/* ------------------------------ Cena za rąbanie ------------------------------ */
test("Rąbanie: domyślnie 10 zł/MP (500 MP → 5 000 zł), cenę można zmienić", () => {
  const s = fresh();
  assert.equal(s.config.chipRateDefault, 10);
  assert.equal(R.planOperation(s, DIRECT({}, { outMP: "500" }), ctx(s)).totals.chippingCost, 5000);
  assert.equal(R.planOperation(s, DIRECT({}, { outMP: "500", chipRate: "10,00" }), ctx(s)).totals.chippingCost, 5000);
  assert.equal(R.planOperation(s, DIRECT({}, { outMP: "500", chipRate: "8" }), ctx(s)).totals.chippingCost, 4000);
  assert.ok(R.planOperation(s, DIRECT({}, { chipRate: "-1" }), ctx(s)).errors["production.chipRate"]);
  const rep = R.Reports.summary(s, "wh_zab", "2026-09");
  assert.equal(rep.chippingCost, 800 + 6000);                     // dane przykładowe: łańcuch + bezpośrednia
});

/* ------------------------------- Transport ------------------------------- */
test("Pociąg: tonaż wspólny 20 × 60 t = 1 200 t", () => {
  const s = fresh();
  const t = R.planOperation(s, WZ({ qty: "3636,364" }), ctx(s)) && R.planOperation(s, draft({ type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "3636", unit: "MP", buyerId: "pa_ec_zab", price: "80" }, transport: { mode: "train", place: "EC", train: { wagonCount: "20", tonMode: "same", sameT: "60", capUnit: "t", capacity: "60", price: "25", priceUnit: "t", carrier: "PKP Cargo", docNo: "CIM 1", loadPlace: "Bocznica Zabrze" } } }), ctx(s)).norm.transport;
  assert.equal(t.wagonCount, 20);
  assert.equal(t.totalT, 1200);
  assert.deepEqual(new Set(t.wagonT), new Set([60]));
  assert.equal(t.totalCapacity, 1200);
  assert.equal(t.cost, 30000);
  assert.deepEqual([t.carrier, t.docNo, t.loadPlace, t.place], ["PKP Cargo", "CIM 1", "Bocznica Zabrze", "EC"]);
});
test("Pociąg: tonaż indywidualny — lista zgodna z liczbą wagonów, suma automatyczna, brakujący wagon = błąd", () => {
  const s = fresh();
  const tons = ["58,4", "60,1", "59,7", "61,2"];
  const t = R.planOperation(s, draft({ purchase: PURCHASE_A, transport: { mode: "train", place: "X", train: { wagonCount: "4", tonMode: "each", wagonT: tons, capUnit: "MP", capacity: "200", price: "1", priceUnit: "t" } } }), ctx(s)).norm.transport;
  assert.deepEqual(t.wagonT, [58.4, 60.1, 59.7, 61.2]);
  assert.equal(t.totalT, 239.4);
  assert.equal(t.totalCapacityMP, 800);
  const p = R.planOperation(s, draft({ purchase: PURCHASE_A, transport: { mode: "train", place: "X", train: { wagonCount: "3", tonMode: "each", wagonT: ["60", "", "59"], price: "1", priceUnit: "t" } } }), ctx(s));
  assert.ok(p.errors["transport.train.wagonT.1"]);
  // pojemność w MP: 120 MP ≈ 39,6 t — przeładowanie ostrzega
  const w = R.planOperation(s, draft({ purchase: PURCHASE_A, transport: { mode: "train", place: "X", train: { wagonCount: "1", tonMode: "same", sameT: "45", capUnit: "MP", capacity: "120", price: "1", priceUnit: "t" } } }), ctx(s));
  assert.ok(w.warnings.some(x => x.includes("przekracza ładowność")));
});
test("Transport własny 262 × 5 = 1 310 zł; zewnętrzny 1 250 zł, wliczony → 0 zł", () => {
  const s = fresh();
  assert.equal(R.planOperation(s, WZ({ }), ctx(s)) && R.planOperation(s, draft({ type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "80", unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "own", place: "EC", own: { vehicleId: "ve_scania", km: "262", rate: "5" } } }), ctx(s)).norm.transport.cost, 1310);
  const ext = x => R.planOperation(s, draft({ purchase: PURCHASE_A, transport: { mode: "external", place: "X", external: Object.assign({ company: "ESI", reg: "ESI 18734", freight: "1 250" }, x) } }), ctx(s)).norm.transport.cost;
  assert.equal(ext({}), 1250);
  assert.equal(ext({ includedInPrice: true }), 0);
});
test("Transport nie zmienia stanu — w każdym rodzaju operacji", () => {
  const s = fresh();
  const modes = [
    { mode: "none", place: "X" },
    { mode: "own", place: "X", own: { vehicleId: "ve_scania", km: "262" } },
    { mode: "external", place: "X", external: { company: "DAP", reg: "SZA 7K901", freight: "900" } },
    { mode: "train", place: "X", train: { wagonCount: "3", tonMode: "same", sameT: "20", price: "30", priceUnit: "t" } }
  ];
  for (const base of [{ purchase: PURCHASE_A }, { type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "500", unit: "MP", buyerId: "pa_ec_zab", price: "90" } }, { type: "PRODUKCJA", production: { rawProductId: "pr_drewno", consumeQty: "10", type: "lesna" } }]) {
    const sig = modes.map(t => JSON.stringify(R.planOperation(s, draft(Object.assign({}, base, { transport: t })), ctx(s)).postings.map(p => [p.kind, p.productId, p.qty])));
    assert.equal(new Set(sig).size, 1, JSON.stringify(base));
  }
});

/* ------------------------- Bezpieczeństwo zapisu ------------------------- */
test("Idempotencja: podwójny zapis tego samego formularza = jedna operacja", () => {
  const s = fresh(); const d = WZ();
  const n0 = s.operations.length;
  R.commitOperation(s, d, ctx(s));
  assert.equal(R.commitOperation(s, d, ctx(s)).duplicate, true);
  assert.equal(s.operations.length, n0 + 1);
  assert.equal(bal(s, "pr_zr_lesna"), 7793);
});
test("Atomowość: odrzucona operacja nie zostawia żadnego zapisu", () => {
  const s = fresh(); const snap = JSON.stringify(s);
  assert.equal(R.commitOperation(s, DIRECT({ buyerId: "" }), ctx(s)).ok, false);
  assert.equal(JSON.stringify(s), snap);
});
test("Wyścig: dwa WZ na ten sam stan — drugi odrzucony, stan nieujemny", () => {
  const s = fresh();
  const a = WZ({ qty: "5000" }), b = WZ({ qty: "5000" });
  assert.equal(R.planOperation(s, a, ctx(s, "u_mag")).ok, true);
  assert.equal(R.planOperation(s, b, ctx(s, "u_kier")).ok, true);
  assert.equal(R.commitOperation(s, a, ctx(s, "u_mag")).ok, true);
  assert.equal(R.commitOperation(s, b, ctx(s, "u_kier")).ok, false);
  assert.equal(bal(s, "pr_zr_lesna"), 3293);
});
test("Magazyn z kontekstu użytkownika; rola Podgląd bez operacji; data z przyszłości odrzucona", () => {
  const s = fresh();
  const r = R.commitOperation(s, WZ({ qty: "90" }), ctx(s, "u_pys"));
  assert.equal(r.op.whId, "wh_pys");
  assert.equal(R.Stock.balance(s, "wh_pys", "pr_zr_lesna"), 100);
  assert.ok(R.planOperation(s, WZ(), ctx(s, "u_view")).errors._user);
  assert.ok(R.planOperation(s, Object.assign(WZ(), { date: "2026-09-24" }), ctx(s)).errors.date);
});
test("Storno WZ przywraca stan; storno produkcji niemożliwe po rozchodzie produktu", () => {
  const s = fresh(); const c = ctx(s);
  const wz = R.commitOperation(s, WZ(), c);
  assert.equal(R.stornoOperation(s, wz.op.id, c, "błędny odbiorca").ok, true);
  assert.equal(bal(s, "pr_zr_lesna"), 8293);
  const pr = R.commitOperation(s, PROD(), c);                   // +3 268 MP
  R.commitOperation(s, WZ({ qty: "11561" }), c);                // wyprzedaż do zera
  assert.equal(R.stornoOperation(s, pr.op.id, c, "test").ok, false);
});

/* ------------------------------ Inwentaryzacja ------------------------------ */
test("G: inwentaryzacja w jednostkach produktu — drewno m³, zrębka MP, PKS t; zamknięcie blokuje okres", () => {
  const s = fresh(); const c = ctx(s);
  assert.equal(R.Inventory.open(s, "2026-08", c).ok, true);
  const g = R.Inventory.generate(s, "2026-08", c);
  const line = id => g.period.lines.find(l => l.productId === id);
  assert.deepEqual([line("pr_drewno").bookQty, line("pr_drewno").unit], [817, "m3"]);
  assert.deepEqual([line("pr_zr_lesna").bookQty, line("pr_zr_lesna").unit], [8293, "MP"]);
  assert.deepEqual([line("pr_pks").bookQty, line("pr_pks").unit], [728, "t"]);
  for (const l of g.period.lines) R.Inventory.setCount(s, "2026-08", l.productId, R.fmtQ(l.bookQty), c);
  R.Inventory.setCount(s, "2026-08", "pr_drewno", "815,5", c);
  assert.equal(R.Inventory.close(s, "2026-08", ctx(s, "u_mag")).ok, false);
  const cl = R.Inventory.close(s, "2026-08", c);
  assert.equal(cl.ok, true, cl.error);
  assert.deepEqual(cl.diffs, [{ productId: "pr_drewno", qty: -1.5 }]);
  assert.equal(R.Inventory.setCount(s, "2026-08", "pr_drewno", "1", c).ok, false);
  assert.ok(R.planOperation(s, Object.assign(WZ(), { date: "2026-08-30" }), c).errors.date);
  assert.equal(bal(s, "pr_drewno"), 815.5);
});
test("G: poprzedni miesiąc zamyka się automatycznie na początku kolejnego", () => {
  const s = fresh(); const c = ctx(s);
  R.Inventory.open(s, "2026-09", c); R.Inventory.generate(s, "2026-09", c);
  assert.deepEqual(R.Inventory.autoClose(s, ctx(s)), []);
  const done = R.Inventory.autoClose(s, ctx(s, "u_kier", "2026-10-01"));
  assert.equal(done[0].ok, true);
  assert.equal(R.Inventory.find(s, "wh_zab", "2026-09").status, "ZAMKNIETA");
});

/* ------------------------------ Flota, kopia ------------------------------ */
test("Flota: walidacja i uprawnienia; kurs zachowuje kierowcę kursu", () => {
  const s = fresh();
  const d = draft({ type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "80", unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "own", place: "EC", own: { vehicleId: "ve_scania", km: "262", driverId: "dr_wojcik" } } });
  const r = R.commitOperation(s, d, ctx(s));
  assert.equal(r.op.transport.driverName, "Tomasz Wójcik");
  assert.equal(r.op.transport.driverOverridden, true);
  R.Fleet.save(s, "vehicles", Object.assign({}, s.fleet.vehicles[0], { driverId: "dr_nowak" }), ctx(s));
  assert.equal(s.operations.at(-1).transport.driverName, "Tomasz Wójcik");
  assert.equal(R.Fleet.save(s, "vehicles", { name: "DAF", reg: "SGL4T821", type: "ciezarowy", status: "aktywny", driverId: "dr_nowak" }, ctx(s)).ok, false);
  assert.equal(R.Fleet.save(s, "chippers", { name: "Rębak 3", status: "aktywny", operatorId: "op_lis" }, ctx(s, "u_mag")).ok, false);
});
test("Kontrola struktury odrzuca dane v1 i uszkodzoną księgę", () => {
  const s = fresh();
  const v1 = JSON.parse(JSON.stringify(s)); v1.schema = 1;
  assert.ok(R.validateStateShape(v1).length);
  const bad = JSON.parse(JSON.stringify(s)); bad.ledger[0].qty = "x";
  assert.ok(R.validateStateShape(bad).length);
});
