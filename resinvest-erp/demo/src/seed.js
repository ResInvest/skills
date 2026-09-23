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
      { id: "pr_zr_tow", code: "ZR-T", name: "Zrębka towar", cat: "zrebka", unit: "MP", active: true }
    ];
    s.partners = [
      { id: "pa_lander", name: "Lander Agro", role: "supplier", city: "Gliwice", active: true },
      { id: "pa_ndl_rr", name: "Nadleśnictwo Rudy Raciborskie", role: "supplier", city: "Kuźnia Raciborska", active: true },
      { id: "pa_ndl_ryb", name: "Nadleśnictwo Rybnik", role: "supplier", city: "Rybnik", active: true },
      { id: "pa_drwal", name: "Usługi Leśne Drwal sp. z o.o.", role: "supplier", city: "Gliwice", active: true },
      { id: "pa_ec_zab", name: "Elektrociepłownia Zabrze S.A.", role: "buyer", city: "Zabrze", active: true },
      { id: "pa_ec_kat", name: "EC Katowice — biomasa", role: "buyer", city: "Katowice", active: true },
      { id: "pa_ciep_ryb", name: "Ciepłownia Rybnik", role: "buyer", city: "Rybnik", active: true },
      { id: "pa_tartak", name: "Tartak Beskid s.c.", role: "both", city: "Żywiec", active: true }
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
    for (const k of ["purchase", "production", "sale"]) Object.assign(d[k], over[k] || {});
    if (over.transport) {
      const t = over.transport;
      d.transport.mode = t.mode || "none";
      d.transport.place = t.place || "";
      Object.assign(d.transport.own, t.own || {});
      Object.assign(d.transport.external, t.external || {});
      Object.assign(d.transport.train, t.train || {});
    }
    d.notes = over.notes || "";
    return d;
  }

  /** Buduje kompletny stan przykładowy. `today` — data „systemowa” (RRRR-MM-DD). */
  function build(today) {
    const s = base();
    const user = id => s.users.find(u => u.id === id);
    const ctx = (uid, date) => ({ user: user(uid), today: date, now: date + "T08:00:00.000Z", source: "Dane przykładowe" });

    RIW.openingBalance(s, "wh_zab", "2026-08-01", [
      { productId: "pr_drewno", qty: 60 }, { productId: "pr_zr_lesna", qty: 400 },
      { productId: "pr_zr_inw", qty: 120 }, { productId: "pr_zr_tow", qty: 200 }
    ], ctx("u_admin", "2026-08-01"));
    RIW.openingBalance(s, "wh_pys", "2026-08-01", [
      { productId: "pr_drewno", qty: 30 }, { productId: "pr_zr_lesna", qty: 250 }
    ], ctx("u_admin", "2026-08-01"));

    const ops = [
      ["u_mag", "2026-08-05", {
        purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "30", unit: "m3", price: "230" },
        production: { enabled: true, type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Stanica", kwit: "KW 0142/08/2026", chipperId: "ch_jenz" },
        transport: { mode: "own", place: "RiC Zabrze", own: { vehicleId: "ve_scania", km: "45", rate: "5" } }
      }],
      ["u_mag", "2026-08-12", {
        purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: "100", unit: "MP", price: "55" },
        transport: { mode: "external", place: "RiC Zabrze", external: { company: "ESI Logistics", reg: "ESI 18734", km: "80", freight: "900" } }
      }],
      ["u_kier", "2026-08-20", {
        purchase: { supplierId: "pa_tartak", basis: "KZR", productId: "pr_drewno_inw", qty: "25", unit: "m3", price: "180" },
        production: { enabled: true, type: "inwestycyjna", investSite: "Obwodnica Gliwic — odcinek II", sourceDoc: "Protokół wycinki 17/2026", chipperId: "ch_biber" },
        sale: { enabled: true, buyerId: "pa_ec_kat", qtyMP: "100", price: "95", priceUnit: "MP" },
        transport: { mode: "train", place: "EC Katowice — bocznica", train: { trainNo: "RC 44120", carrier: "PKP Cargo", wagonCount: "2", wagonMP: "120", sameForAll: true, sameT: "16,5", price: "28", priceUnit: "t" } }
      }],
      ["u_mag", "2026-09-03", {
        purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "20", unit: "m3", price: "230" },
        production: { enabled: true, type: "lesna", ndl: "Rybnik", lesnictwo: "Wielopole", kwit: "KW 0217/09/2026", chipperId: "ch_jenz" },
        sale: { enabled: true, buyerId: "pa_ec_zab", price: "90", priceUnit: "MP" },
        transport: { mode: "own", place: "Elektrociepłownia Zabrze S.A.", own: { vehicleId: "ve_volvo", km: "262", rate: "5" } }
      }],
      ["u_pys", "2026-09-08", {
        purchase: { supplierId: "pa_ndl_ryb", basis: "DEKL", productId: "pr_drewno", qty: "15", unit: "m3", price: "210" },
        transport: { mode: "external", place: "RiC Pyskowice", external: { company: "Transport Kowalski", reg: "SPY 92FR", km: "40", includedInPrice: true } }
      }]
    ];
    for (const [uid, date, over] of ops) {
      const r = RIW.commitOperation(s, draftOf(date, over), ctx(uid, date));
      if (!r.ok) throw new Error("Dane przykładowe: " + r.error);
    }
    s.meta.createdAt = new Date().toISOString();
    s.meta.lastMonthCheck = RIW.Dates.ym(today);
    return s;
  }

  RIW.Seed = { build, draftOf };
})(typeof globalThis !== "undefined" ? globalThis : this);
