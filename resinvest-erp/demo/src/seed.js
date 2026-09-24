/* =========================================================================
   Warstwa S: dane przykładowe demonstratora.
   Wszystkie operacje przechodzą przez ten sam silnik co formularz — dane
   startowe są więc spójne z regułami (salda, numeracja, audyt).
   Wyłącznie do demonstracji i testów — nie przenosić do produkcji.
   ========================================================================= */
(function (root) {
  "use strict";
  const RIW = root.RIW;

  function base() {
    const s = RIW.emptyState(root.RIW_CONFIG || null);
    s.warehouses = [
      { id: "wh_zab", code: "ZAB", name: "RiC Zabrze", address: "ul. Gwarecka 16, 41-800 Zabrze" },
      { id: "wh_pys", code: "PYS", name: "RiC Pyskowice", address: "ul. Wyszyńskiego, 44-120 Pyskowice" }
    ];
    s.users = [
      { id: "u_admin", name: "Mateusz Roesner", role: "admin", whId: "wh_zab", active: true },
      { id: "u_kier", name: "Anna Górska", role: "kierownik", whId: "wh_zab", active: true },
      { id: "u_mag", name: "Adrian Wojciechowski", role: "magazynier", whId: "wh_zab", active: true },
      { id: "u_pys", name: "Paweł Kaczmarek", role: "magazynier", whId: "wh_pys", active: true },
      { id: "u_view", name: "Beata Nowak", role: "podglad", whId: "wh_zab", active: true }
    ];
    s.products = [
      { id: "pr_drewno", code: "DRW-O", name: "Drewno opałowe", cat: "drewno", unit: "m3", active: true },
      { id: "pr_drewno_inw", code: "DRW-I", name: "Drewno z wycinki inwestycyjnej", cat: "drewno", unit: "m3", active: true },
      { id: "pr_zr_lesna", code: "ZR-PL", name: "Zrębka produkcyjna leśna", cat: "zrebka", unit: "MP", active: true },
      { id: "pr_zr_inw", code: "ZR-PI", name: "Zrębka produkcyjna inwestycyjna", cat: "zrebka", unit: "MP", active: true },
      { id: "pr_zr_tow", code: "ZR-T", name: "Zrębka towar", cat: "zrebka", unit: "MP", active: true },
      { id: "pr_pks", code: "PKS", name: "PKS (łupina palmowa)", cat: "agro", unit: "t", active: true },
      { id: "pr_lupina", code: "LUP-N", name: "Łupina nerkowca", cat: "agro", unit: "t", active: true }
    ];
    s.partners = [
      { id: "pa_lander", name: "Lander Agro", role: "supplier", kind: "firma", city: "Gliwice", active: true },
      { id: "pa_ndl_rr", name: "Nadleśnictwo Rudy Raciborskie", role: "supplier", kind: "nadlesnictwo", lesnictwa: ["Stanica", "Kuźnia", "Jankowice", "Rudy"], city: "Kuźnia Raciborska", active: true },
      { id: "pa_ndl_ryb", name: "Nadleśnictwo Rybnik", role: "supplier", kind: "nadlesnictwo", lesnictwa: ["Wielopole", "Paruszowiec", "Golejów"], city: "Rybnik", active: true },
      { id: "pa_drwal", name: "Usługi Leśne Drwal sp. z o.o.", role: "supplier", kind: "firma", city: "Gliwice", active: true },
      { id: "pa_ec_zab", name: "Elektrociepłownia Zabrze S.A.", role: "buyer", city: "Zabrze", active: true },
      { id: "pa_ec_kat", name: "EC Katowice — biomasa", role: "buyer", city: "Katowice", active: true },
      { id: "pa_ciep_ryb", name: "Ciepłownia Rybnik", role: "buyer", city: "Rybnik", active: true },
      { id: "pa_tartak", name: "Tartak Beskid s.c.", role: "both", kind: "firma", city: "Żywiec", active: true },
      { id: "pa_agro", name: "Biomass Trading B.V.", role: "supplier", kind: "firma", city: "Rotterdam", active: true },
      { id: "pa_elektrownia", name: "Elektrownia Łaziska", role: "buyer", city: "Łaziska Górne", active: true }
    ];
    s.carriers = ["ESI Logistics", "DAP Trans", "Transport Kowalski", "PKP Cargo"];
    s.fleet = {
      drivers: [
        { id: "dr_kowalski", name: "Jan Kowalski", phone: "600 100 200" },
        { id: "dr_nowak", name: "Piotr Nowak", phone: "600 300 400" },
        { id: "dr_zielinski", name: "Marek Zieliński", phone: "600 500 600" },
        { id: "dr_wojcik", name: "Tomasz Wójcik", phone: "600 700 800" }
      ],
      vehicles: [
        { id: "ve_scania", name: "Scania R450 — ruchoma podłoga", reg: "SGL 4T821", type: "ruchoma_podloga", status: "aktywny", driverId: "dr_kowalski" },
        { id: "ve_volvo", name: "Volvo FH 500 — ruchoma podłoga", reg: "SZA 12345", type: "ruchoma_podloga", status: "aktywny", driverId: "dr_nowak" },
        { id: "ve_man", name: "MAN TGX — ciężarowy", reg: "SK 7788X", type: "ciezarowy", status: "serwis", driverId: "dr_zielinski" }
      ],
      operators: [
        { id: "op_lis", name: "Krzysztof Lis", phone: "601 111 222" },
        { id: "op_mazur", name: "Adam Mazur", phone: "601 333 444" }
      ],
      chippers: [
        { id: "ch_jenz", name: "Jenz HEM 583", status: "aktywny", operatorId: "op_lis" },
        { id: "ch_biber", name: "Eschlböck Biber 92", status: "aktywny", operatorId: "op_mazur" }
      ]
    };
    return s;
  }

  function draftOf(date, over) {
    const d = RIW.blankDraft({ today: date });
    d.date = date;
    d.type = over.type || "ZAKUP";
    for (const k of ["purchase", "production", "sale", "mm"]) Object.assign(d[k], over[k] || {});
    // grupa dostawcy wynika z kartoteki kontrahenta, jeśli nie podano jej wprost
    if (over.purchase && !over.purchase.supplierKind) d.purchase.supplierKind = "";
    if (over.transport) {
      const t = over.transport;
      d.transport.mode = t.mode || "none";
      d.transport.place = t.place || "";
      if (t.own) {
        // zapis skrócony { vehicleId, km, … } = jeden kurs
        if (Array.isArray(t.own.runs)) Object.assign(d.transport.own, t.own);
        else d.transport.own = { runCount: "1", runs: [Object.assign(RIW.blankRun(), t.own)] };
      }
      if (t.external) {
        // zapis skrócony { company, reg, km, freight, includedInPrice } = jeden kurs z frachtem
        const X = t.external;
        if (Array.isArray(X.runs)) Object.assign(d.transport.external, X);
        else d.transport.external = { company: X.company || "", includedInPrice: !!X.includedInPrice, runCount: "1",
          runs: [Object.assign(RIW.blankExtRun(), { reg: X.reg || "", km: X.km || "", freight: X.includedInPrice ? "" : (X.freight || "") })] };
      }
      Object.assign(d.transport.train, t.train || {});
    }
    d.notes = over.notes || "";
    d.extDoc = over.extDoc || "";
    return d;
  }

  /** Buduje kompletny stan przykładowy. `today` — data „systemowa” (RRRR-MM-DD). */
  function build(today) {
    const s = base();
    const user = id => s.users.find(u => u.id === id);
    const ctx = (uid, date) => ({ user: user(uid), today: date, now: date + "T08:00:00.000Z", source: "Dane przykładowe" });

    // ilości w jednostce magazynowej produktu: drewno m³, zrębka MP, PKS / łupina t
    RIW.openingBalance(s, "wh_zab", "2026-08-01", [
      { productId: "pr_drewno", qty: 817 }, { productId: "pr_zr_lesna", qty: 8173 },
      { productId: "pr_zr_inw", qty: 120 }, { productId: "pr_zr_tow", qty: 200 },
      { productId: "pr_pks", qty: 728 }, { productId: "pr_lupina", qty: 728 }
    ], ctx("u_admin", "2026-08-01"));
    RIW.openingBalance(s, "wh_pys", "2026-08-01", [
      { productId: "pr_drewno", qty: 30 }, { productId: "pr_zr_lesna", qty: 250 }
    ], ctx("u_admin", "2026-08-01"));

    const ops = [
      ["u_mag", "2026-08-05", {
        purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "30", unit: "m3", price: "230" },
        production: { enabled: true, type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Stanica", kwit: "KW 0142/08/2026", chipperId: "ch_jenz" },
        // trzy kursy własne z rębakiem w lesie → magazyn Zabrze; każdy kurs z własnym kwitem wywozowym (3 × 10 m³ × 4 = 120 MP)
        transport: { mode: "own", place: "RiC Zabrze", own: { runCount: "3", runs: [
          { vehicleId: "ve_scania", driverId: "", km: "45", rate: "5", kwit: "KW 0142/1/08/2026", kwitM3: "10", qty: "40", weightT: "13,4" },
          { vehicleId: "ve_volvo", driverId: "", km: "45", rate: "5", kwit: "KW 0142/2/08/2026", kwitM3: "10", qty: "40", weightT: "12,9" },
          { vehicleId: "ve_scania", driverId: "dr_wojcik", km: "45", rate: "5", kwit: "KW 0142/3/08/2026", kwitM3: "10", qty: "40", weightT: "13,1" }] } }
      }],
      ["u_mag", "2026-08-12", {
        purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: "100", unit: "MP", price: "55" },
        // przewoźnik zewnętrzny, 2 kursy rozliczane km × stawka
        transport: { mode: "external", place: "RiC Zabrze", external: { company: "ESI Logistics", runCount: "2", runs: [
          { reg: "ESI 18734", driver: "Tomasz Lis", km: "80", rate: "5,50", freight: "", qty: "50", weightT: "16,4" },
          { reg: "ESI 20511", driver: "Robert Kania", km: "80", rate: "5,50", freight: "", qty: "50", weightT: "16,9" }] } }
      }],
      ["u_kier", "2026-08-20", {
        purchase: { supplierId: "pa_tartak", basis: "KZR", productId: "pr_drewno_inw", qty: "25", unit: "m3", price: "180" },
        production: { enabled: true, type: "inwestycyjna", investSite: "Obwodnica Gliwic — odcinek II", sourceDoc: "Protokół wycinki 17/2026", chipperId: "ch_biber" },
        sale: { enabled: true, buyerId: "pa_ec_kat", qtyMP: "100", price: "95", priceUnit: "MP" },
        transport: { mode: "train", place: "EC Katowice — bocznica", train: { trainNo: "RC 44120", carrier: "PKP Cargo", docNo: "CIM 4412/08", loadPlace: "Bocznica Gliwice Port", wagonCount: "2", capUnit: "MP", capacity: "120", tonMode: "same", sameT: "16,5", price: "28", priceUnit: "t" } }
      }],
      ["u_mag", "2026-09-03", {
        purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "20", unit: "m3", price: "230" },
        production: { enabled: true, type: "lesna", ndl: "Rybnik", lesnictwo: "Wielopole", kwit: "KW 0217/09/2026", chipperId: "ch_jenz" },
        sale: { enabled: true, buyerId: "pa_ec_zab", price: "90", priceUnit: "MP" },
        // jedna produkcja, dwa rodzaje transportu: 3 kursy flotą własną + 2 kursy firmą zewnętrzną (5 × 16 MP = 80 MP)
        transport: { mode: "mixed", place: "Elektrociepłownia Zabrze S.A.",
          own: { runCount: "3", runs: [
            { vehicleId: "ve_volvo", driverId: "", km: "26", rate: "5", kwit: "KW 0217/1/09/2026", kwitM3: "4", qty: "16", weightT: "5,4" },
            { vehicleId: "ve_scania", driverId: "", km: "26", rate: "5", kwit: "KW 0217/2/09/2026", kwitM3: "4", qty: "16", weightT: "5,2" },
            { vehicleId: "ve_volvo", driverId: "", km: "26", rate: "5", kwit: "KW 0217/3/09/2026", kwitM3: "4", qty: "16", weightT: "5,3" }] },
          external: { company: "DAP Trans", includedInPrice: false, runCount: "2", runs: [
            { reg: "SZA 7K901", driver: "Marek Pawlik", km: "26", rate: "6", freight: "", kwit: "KW 0217/4/09/2026", kwitM3: "4", qty: "16", weightT: "5,5" },
            { reg: "SZA 7K902", driver: "Leszek Mróz", km: "26", rate: "6", freight: "", kwit: "KW 0217/5/09/2026", kwitM3: "4", qty: "16", weightT: "5,1" }] } }
      }],
      ["u_pys", "2026-09-08", {
        purchase: { supplierKind: "nadlesnictwo", supplierId: "pa_ndl_ryb", lesnictwo: "Wielopole", basis: "DEKL", productId: "pr_drewno", qty: "15", unit: "m3", price: "210" },
        transport: { mode: "external", place: "RiC Pyskowice", external: { company: "Transport Kowalski", reg: "SPY 92FR", km: "40", includedInPrice: true } }
      }],
      // produkcja na magazynie: drewno ze stanu → zrębka na stan
      ["u_pys", "2026-09-10", {
        type: "PRODUKCJA",
        production: { rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "40", chipperId: "ch_biber", chipRate: "10" },
        notes: "Rębanie na placu — pryzma P2", extDoc: "KP 12/09/2026"
      }],
      // sprzedaż z magazynu (WZ)
      ["u_pys", "2026-09-12", {
        type: "SPRZEDAZ",
        sale: { productId: "pr_zr_lesna", qty: "100", unit: "MP", buyerId: "pa_ciep_ryb", price: "85" },
        transport: { mode: "external", place: "Ciepłownia Rybnik", external: { company: "DAP Trans", reg: "SZA 7K901", km: "35", freight: "650" } }
      }],
      // produkcja w lesie + sprzedaż bezpośrednia: stan zrębki bez zmian
      ["u_kier", "2026-09-15", {
        type: "SPRZEDAZ",
        production: { type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Kuźnia", kwit: "KW 0233/09/2026", rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "600", chipperId: "ch_jenz", chipRate: "10" },
        sale: { direct: true, buyerId: "pa_elektrownia", qtyMP: "600", price: "88", priceUnit: "MP" },
        transport: { mode: "train", place: "Elektrownia Łaziska", train: { trainNo: "RC 50931", carrier: "PKP Cargo", docNo: "CIM 5093/09", loadPlace: "Bocznica Kuźnia Raciborska", wagonCount: "5", capUnit: "t", capacity: "60", tonMode: "each", wagonT: ["39,6", "39,8", "39,4", "39,7", "39,5"], price: "25", priceUnit: "t" } }
      }]
    ];
    ops.push(
      // przesunięcie międzymagazynowe (MM): Zabrze → Pyskowice
      ["u_kier", "2026-09-16", {
        type: "MM", mm: { productId: "pr_zr_tow", qty: "50", unit: "MP", toWhId: "wh_pys" },
        transport: { mode: "own", place: "RiC Pyskowice", own: { vehicleId: "ve_scania", km: "28", rate: "5" } }
      }],
      // zakup wprowadzony omyłkowo — w danych przykładowych jest później anulowany
      ["u_pys", "2026-09-17", {
        purchase: { supplierId: "pa_agro", basis: "DEKL", productId: "pr_lupina", qty: "5", unit: "t", price: "610" },
        transport: { mode: "none", place: "RiC Pyskowice" }, notes: "Pomyłka — dostawa nie dotarła"
      }],
      // produkcja na magazyn z wczoraj (kwit produkcji dnia)
      ["u_pys", "2026-09-22", {
        type: "PRODUKCJA",
        production: { rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "20", chipperId: "ch_biber", chipRate: "10" },
        notes: "Pryzma P3"
      }]
    );
    const byNo = {};
    for (const [uid, date, over] of ops) {
      const r = RIW.commitOperation(s, draftOf(date, over), ctx(uid, date));
      if (!r.ok) throw new Error("Dane przykładowe: " + r.error);
      byNo[`${over.type || "ZAKUP"}@${date}`] = r.op;
    }
    // korekta ilościowa WZ (100 → 90 MP) i anulowanie błędnego zakupu — przez ten sam silnik
    const wz = byNo["SPRZEDAZ@2026-09-12"], cd = RIW.clone(wz.input);
    cd.sale.qty = "90";
    let r = RIW.correctOperation(s, wz.id, cd, "błędnie wpisana ilość — kwit wagowy 90 MP", Object.assign(ctx("u_admin", "2026-09-14"), { user: Object.assign({}, user("u_admin"), { whId: "wh_pys" }) }));
    if (!r.ok) throw new Error("Dane przykładowe (korekta): " + r.error);
    r = RIW.cancelOperation(s, byNo["ZAKUP@2026-09-17"].id, Object.assign(ctx("u_admin", "2026-09-18"), { user: Object.assign({}, user("u_admin"), { whId: "wh_pys" }) }), "pomyłka operatora — dostawa nie dotarła");
    if (!r.ok) throw new Error("Dane przykładowe (anulowanie): " + r.error);
    s.meta.createdAt = new Date().toISOString();
    s.meta.lastMonthCheck = RIW.Dates.ym(today);
    return s;
  }

  RIW.Seed = { build, draftOf };
})(typeof globalThis !== "undefined" ? globalThis : this);
