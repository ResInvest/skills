/* =========================================================================
   ResInvest ERP — Demo v2
   Warstwa E: silnik domenowy (bez DOM — uruchamiany także w Node do testów)

   Zasady:
   * księga prowadzona jest w JEDNOSTCE MAGAZYNOWEJ PRODUKTU: drewno m³,
     zrębka MP, produkty tonowe (PKS, łupina nerkowca) t — bez sztucznych przeliczeń,
   * masa (t) przy m³ i MP jest orientacyjna (informacja pomocnicza); waga
     rzeczywista wpisana przez użytkownika jej nie zastępuje w ewidencji ilości,
   * rodzaje operacji są niezależne:
       ZAKUP                     dostawca → magazyn (opcjonalnie z autozużyciem i sprzedażą)
       SPRZEDAZ (z magazynu)     magazyn → odbiorca (WZ)
       SPRZEDAZ (bezpośrednia)   las → produkcja → odbiorca (PW + WZ, bez wzrostu stanu)
       PRODUKCJA (na magazynie)  surowiec ze stanu → produkcja → produkt na stanie (RW + PW)
   * każda operacja księgowana atomowo w stałej kolejności, z symulacją sald,
   * transport nie tworzy zapisów w księdze — tylko koszt i karta TR,
   * każda zmiana ma wpis audytu ze stanem przed/po.
   ========================================================================= */
(function (root) {
  "use strict";

  const VERSION = "2.0.0-demo";
  const SCHEMA = 2;
  const EPS = 0.0005;

  /* ------------------------------------------------------------------ */
  /* Liczby                                                              */
  /* ------------------------------------------------------------------ */
  const SPACES = /[\s\u00A0\u2007\u2009\u202F']/g;
  const UNIT_SUFFIX = /(?:zł|zl|pln|m³|m3|mp|km|kg|t|\/)+$/i;

  const NumParse = {
    /**
     * Zamienia tekst wpisany lub wklejony przez użytkownika na liczbę.
     * Obsługuje: 12,50 · 12.50 · 1 250,50 · 1\u00A0250,50 · 1.250,50 · 1,250.50
     * oraz jednostki na końcu (m³, MP, t, zł, zł/m³, km). Zwraca {ok, value, empty, error}.
     */
    parse(input) {
      if (typeof input === "number") {
        return Number.isFinite(input) ? { ok: true, value: input } : { ok: false, value: NaN, error: "Niepoprawna liczba" };
      }
      let s = String(input == null ? "" : input).trim();
      if (!s) return { ok: false, value: NaN, empty: true, error: "Pole jest puste" };
      s = s.replace(SPACES, "").replace(/\u2212/g, "-");
      let guard = 0;
      while (UNIT_SUFFIX.test(s) && guard++ < 4) s = s.replace(UNIT_SUFFIX, "");
      if (!/^[+-]?[\d.,]*\d[\d.,]*$/.test(s) && !/^[+-]?[.,]\d+$/.test(s)) {
        return { ok: false, value: NaN, error: "To nie jest liczba" };
      }
      let sign = 1;
      if (s[0] === "-" || s[0] === "+") { if (s[0] === "-") sign = -1; s = s.slice(1); }
      const lastC = s.lastIndexOf(","), lastD = s.lastIndexOf(".");
      const nC = s.split(",").length - 1, nD = s.split(".").length - 1;
      let dec = null, thou = null;
      if (nC && nD) { dec = lastC > lastD ? "," : "."; thou = dec === "," ? "." : ","; }
      else if (nC) { if (nC === 1) dec = ","; else thou = ","; }
      else if (nD) { if (nD === 1) dec = "."; else thou = "."; }
      let intPart = s, frac = "";
      if (dec) {
        const i = s.lastIndexOf(dec);
        intPart = s.slice(0, i); frac = s.slice(i + 1);
        if (frac.includes(",") || frac.includes(".")) return { ok: false, value: NaN, error: "Niepoprawny separator" };
      }
      if (thou && intPart.includes(thou)) {
        const groups = intPart.split(thou);
        const okGroups = groups[0].length >= 1 && groups[0].length <= 3 && groups.slice(1).every(g => g.length === 3);
        if (!okGroups) return { ok: false, value: NaN, error: "Niepoprawne grupowanie tysięcy" };
        intPart = groups.join("");
      }
      if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return { ok: false, value: NaN, error: "To nie jest liczba" };
      const v = sign * Number((intPart || "0") + (frac ? "." + frac : ""));
      if (!Number.isFinite(v)) return { ok: false, value: NaN, error: "To nie jest liczba" };
      return { ok: true, value: v };
    },
    value(input, def = 0) { const r = this.parse(input); return r.ok ? r.value : def; }
  };

  function round(n, p = 2) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    const f = Math.pow(10, p);
    const r = Math.sign(x) * Math.round(Math.abs(x) * f * (1 + Number.EPSILON)) / f;
    return r === 0 ? 0 : r;
  }
  /** Format polski: grupy tysięcy NBSP, przecinek dziesiętny (także dla 4 cyfr). */
  function fmt(n, dec = 2) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    const r = round(x, dec);
    const [i, f] = Math.abs(r).toFixed(dec).split(".");
    return (r < 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0") + (f ? "," + f : "");
  }
  /** Ilość bez zbędnych zer: 80 → „80”, 26,4 → „26,4”. */
  function fmtQ(n, maxDec = 3) {
    let s = fmt(round(n, maxDec), maxDec);
    if (s.includes(",")) s = s.replace(/0+$/, "").replace(/,$/, "");
    return s;
  }
  function money(n, cur = "zł") { return fmt(n, 2) + "\u00A0" + cur; }

  /* ------------------------------------------------------------------ */
  /* Daty                                                                */
  /* ------------------------------------------------------------------ */
  const Dates = {
    isISO(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) && !Number.isNaN(Date.parse(d + "T00:00:00Z")); },
    isYM(ym) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || "")); },
    ym(d) { return String(d).slice(0, 7); },
    monthEnd(ym) {
      const [y, m] = ym.split("-").map(Number);
      return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    },
    localToday() {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
    label(ym) {
      const M = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
      const [y, m] = ym.split("-").map(Number);
      return `${M[m - 1]} ${y}`;
    }
  };

  /* ------------------------------------------------------------------ */
  /* Jednostki — zależne od produktu                                     */
  /* ------------------------------------------------------------------ */
  const Units = {
    LIST: ["m3", "MP", "t"],
    label(u) { return u === "m3" ? "m³" : u; },
    /** Orientacyjna masa jednej jednostki magazynowej (t). */
    massPerUnit(p, cfg) {
      if (!p) return 0;
      if (p.unit === "t") return 1;
      if (p.unit === "MP") return cfg.mp_t;
      return p.tPerUnit || cfg.woodTPerM3;
    },
    /** Jednostki, w których wolno podać ilość danego produktu. Produkty tonowe — tylko t. */
    allowed(p) {
      if (!p) return [];
      if (p.unit === "t") return ["t"];
      if (p.unit === "MP") return ["MP", "t"];
      return ["m3", "MP", "t"];
    },
    /** Przeliczenie ilości produktu między jednostkami dozwolonymi dla tego produktu. */
    convert(q, from, to, p, cfg) {
      const x = Number(q);
      if (from === to) return round(x, 3);
      const ok = this.allowed(p);
      if (!ok.includes(from) || !ok.includes(to)) throw new Error(`Brak przelicznika ${this.label(from)} → ${this.label(to)} dla „${p ? p.name : "?"}”`);
      const m = this.massPerUnit(p, cfg);
      const toBase = u => {                                   // wartość w jednostce magazynowej produktu
        if (u === p.unit) return x;
        if (u === "t") return x / m;
        if (p.unit === "m3" && u === "MP") return x / cfg.m3_mp;
        throw new Error("Brak przelicznika");
      };
      const b = toBase(from);
      let r;
      if (to === p.unit) r = b;
      else if (to === "t") r = b * m;
      else if (p.unit === "m3" && to === "MP") r = b * cfg.m3_mp;
      else throw new Error("Brak przelicznika");
      return round(r, 3);
    },
    mass(qtyStock, p, cfg) { return round(Number(qtyStock) * this.massPerUnit(p, cfg), 3); }
  };

  /* ------------------------------------------------------------------ */
  /* Słowniki stałe                                                      */
  /* ------------------------------------------------------------------ */
  const ROLES = {
    admin: { label: "Administrator", perms: ["*"] },
    kierownik: { label: "Kierownik", perms: ["op.create", "op.storno", "inv.open", "inv.count", "inv.close", "fleet.edit", "data.backup", "data.import"] },
    magazynier: { label: "Magazynier", perms: ["op.create", "inv.open", "inv.count"] },
    podglad: { label: "Podgląd", perms: [] }
  };
  function can(user, perm) {
    if (!user || user.active === false) return false;
    const p = (ROLES[user.role] || ROLES.podglad).perms;
    return p.includes("*") || p.includes(perm);
  }
  const OP_TYPES = {
    ZAKUP: { label: "Zakup", flow: "dostawca → magazyn" },
    SPRZEDAZ: { label: "Sprzedaż", flow: "magazyn → odbiorca (WZ)" },
    PRODUKCJA: { label: "Produkcja na magazynie", flow: "surowiec ze stanu → produkcja → produkt na stanie" }
  };
  const KINDS = {
    BO: { doc: "BO", label: "Bilans otwarcia" },
    ZAKUP: { doc: "PZ", label: "Zakup — przyjęcie" },
    ZUZYCIE: { doc: "RW", label: "Zużycie produkcyjne" },
    PRODUKCJA: { doc: "PW", label: "Przyjęcie z produkcji" },
    SPRZEDAZ: { doc: "WZ", label: "Sprzedaż — wydanie" },
    KOREKTA: { doc: "KO", label: "Korekta (storno)" },
    INW: { doc: "IN", label: "Różnica inwentaryzacyjna" }
  };
  const DOC_LABEL = {
    PZ: "Przyjęcie zewnętrzne", RW: "Rozchód wewnętrzny (zużycie)", PW: "Przyjęcie wewnętrzne (produkcja)",
    WZ: "Wydanie zewnętrzne (sprzedaż)", TR: "Karta transportu", KO: "Korekta", IN: "Inwentaryzacja", BO: "Bilans otwarcia"
  };
  const BASIS = { DEKL: "Deklaracja", KZR: "KZR" };
  const PROD_TYPES = {
    lesna: { label: "Zrębka produkcyjna leśna", productId: "pr_zr_lesna" },
    inwestycyjna: { label: "Zrębka produkcyjna inwestycyjna", productId: "pr_zr_inw", sourceType: "Wycinka inwestycyjna" }
  };
  const DIFF_REASONS = {
    wilgotnosc: "Wilgotność / osiadanie", jakosc: "Jakość surowca", straty: "Straty przy rębaniu",
    pomiar: "Różnica pomiaru", inna: "Inna przyczyna"
  };
  const TRANSPORT_MODES = { none: "Brak transportu", own: "Transport własny", external: "Transport zewnętrzny", train: "Pociąg" };
  const VEHICLE_TYPES = { ruchoma_podloga: "Ruchoma podłoga", ciezarowy: "Samochód ciężarowy", wywrotka: "Wywrotka" };
  const ASSET_STATUS = { aktywny: "Aktywny", serwis: "W serwisie", wycofany: "Wycofany" };
  const INV_STATUS = { OTWARTA: "OTWARTA", ZAMKNIETA: "ZAMKNIĘTA" };

  /* ------------------------------------------------------------------ */
  /* Narzędzia                                                           */
  /* ------------------------------------------------------------------ */
  let uidSeq = 0;
  function uid(prefix) {
    uidSeq = (uidSeq + 1) % 1e6;
    return `${prefix}_${Date.now().toString(36)}${uidSeq.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
  const clone = o => JSON.parse(JSON.stringify(o));
  const byId = (list, id) => (list || []).find(x => x.id === id) || null;
  const str = v => String(v == null ? "" : v).trim();

  function emptyState(config) {
    return {
      schema: SCHEMA, version: VERSION, rev: 0,
      config: Object.assign({ m3_mp: 4, mp_t: 0.33, woodTPerM3: 0.952, currency: "zł", kmRateDefault: 5, chipRateDefault: 10, wagonMPDefault: 120, maxWagons: 60 }, config || {}),
      warehouses: [], users: [], products: [], partners: [], carriers: [],
      fleet: { vehicles: [], drivers: [], chippers: [], operators: [] },
      operations: [], ledger: [], inventory: [], audit: [], seq: {},
      meta: { lastMonthCheck: null, createdAt: null }
    };
  }

  function validateStateShape(s) {
    const e = [];
    if (!s || typeof s !== "object") return ["Brak danych"];
    if (s.schema !== SCHEMA) e.push(`Nieobsługiwana wersja schematu: ${s.schema} (oczekiwano ${SCHEMA})`);
    for (const k of ["warehouses", "users", "products", "partners", "operations", "ledger", "inventory", "audit"]) {
      if (!Array.isArray(s[k])) e.push(`Brak kolekcji „${k}”`);
    }
    if (!s.fleet || !["vehicles", "drivers", "chippers", "operators"].every(k => Array.isArray(s.fleet[k]))) e.push("Brak kartotek floty");
    if (!s.config || !(s.config.m3_mp > 0) || !(s.config.mp_t > 0)) e.push("Brak przeliczników");
    if (Array.isArray(s.products) && s.products.some(p => !Units.LIST.includes(p.unit))) e.push("Produkt bez jednostki magazynowej");
    if (Array.isArray(s.ledger)) {
      for (const l of s.ledger) {
        if (!Number.isFinite(l.qty) || !l.productId || !l.whId || !Dates.isISO(l.date)) { e.push("Uszkodzony zapis księgi: " + (l.id || "?")); break; }
      }
    }
    return e;
  }

  /* ------------------------------------------------------------------ */
  /* Stany (z księgi, w jednostce magazynowej produktu)                  */
  /* ------------------------------------------------------------------ */
  const Stock = {
    balance(state, whId, productId, to) {
      let n = 0;
      for (const l of state.ledger) {
        if (l.whId !== whId || l.productId !== productId) continue;
        if (to && l.date > to) continue;
        n += l.qty;
      }
      return round(n, 3);
    },
    byProduct(state, whId, to) {
      const m = new Map();
      for (const l of state.ledger) {
        if (whId && l.whId !== whId) continue;
        if (to && l.date > to) continue;
        m.set(l.productId, round((m.get(l.productId) || 0) + l.qty, 3));
      }
      return m;
    },
    lastMove(state, whId, productId) {
      let d = null;
      for (const l of state.ledger) if (l.whId === whId && l.productId === productId && (!d || l.date > d)) d = l.date;
      return d;
    },
    card(state, whId, productId) {
      const rows = state.ledger.filter(l => l.whId === whId && l.productId === productId)
        .slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq);
      let bal = 0;
      return rows.map(r => { bal = round(bal + r.qty, 3); return Object.assign({}, r, { balance: bal }); });
    }
  };

  function lockedMonth(state, whId) {
    let ym = null;
    for (const p of state.inventory) if (p.whId === whId && p.status === "ZAMKNIETA" && (!ym || p.ym > ym)) ym = p.ym;
    return ym;
  }
  function isLocked(state, whId, date) { const ym = lockedMonth(state, whId); return !!ym && Dates.ym(date) <= ym; }

  /* ------------------------------------------------------------------ */
  /* Szkic formularza                                                    */
  /* ------------------------------------------------------------------ */
  function blankDraft(ctx) {
    return {
      idemKey: uid("idem"),
      type: "ZAKUP",
      date: ctx && ctx.today ? ctx.today : Dates.localToday(),
      purchase: { supplierId: "", basis: "KZR", productId: "", qty: "", unit: "m3", price: "", weightMode: "auto", weightManual: "" },
      production: {
        enabled: false, type: "lesna", rawProductId: "", consumeQty: "", outMP: "", diffReason: "",
        rawQty: "", rawCost: "", ndl: "", lesnictwo: "", kwit: "", investSite: "", sourceDoc: "",
        chipperId: "", operatorId: "", chipRate: ""
      },
      sale: { enabled: false, direct: false, productId: "", qty: "", unit: "MP", buyerId: "", qtyMP: "", price: "", priceUnit: "MP" },
      transport: {
        mode: "none", place: "", placeTouched: false,
        own: { vehicleId: "", driverId: "", km: "", rate: "" },
        external: { company: "", reg: "", km: "", freight: "", includedInPrice: false },
        train: { trainNo: "", carrier: "", docNo: "", loadPlace: "", wagonCount: "", capUnit: "t", capacity: "", tonMode: "same", sameT: "", wagonT: [], price: "", priceUnit: "t" }
      },
      notes: ""
    };
  }

  /* ------------------------------------------------------------------ */
  /* Plan operacji — walidacja i skutki (jedno źródło prawdy)            */
  /* ------------------------------------------------------------------ */
  function planOperation(state, draft, ctx) {
    const cfg = state.config;
    const errors = {}, warnings = [];
    const err = (k, m) => { if (!errors[k]) errors[k] = m; };
    const user = ctx && ctx.user;
    const today = (ctx && ctx.today) || Dates.localToday();
    const num = (key, raw, { required = true, min = null, gt = null, integer = false } = {}) => {
      const r = NumParse.parse(raw);
      if (r.empty) { if (required) err(key, "Pole wymagane"); return null; }
      if (!r.ok) { err(key, r.error + " — wpisz np. 12,50"); return null; }
      if (integer && !Number.isInteger(r.value)) { err(key, "Wpisz liczbę całkowitą"); return null; }
      if (gt !== null && !(r.value > gt)) { err(key, gt === 0 ? "Wartość musi być większa od 0" : `Wartość musi być większa od ${fmtQ(gt)}`); return null; }
      if (min !== null && r.value < min) { err(key, `Wartość nie może być mniejsza niż ${fmtQ(min)}`); return null; }
      return r.value;
    };
    const prodOf = id => byId(state.products, id);
    const partyName = id => (byId(state.partners, id) || {}).name || "";

    if (!user) err("_user", "Brak zalogowanego użytkownika");
    else if (!can(user, "op.create")) err("_user", "Twoja rola nie pozwala tworzyć operacji");
    const wh = user ? byId(state.warehouses, user.whId) : null;
    if (user && !wh) err("_wh", "Użytkownik nie ma przypisanego aktywnego magazynu");
    const whId = wh ? wh.id : null;
    const stockOf = pid => (whId && pid ? Stock.balance(state, whId, pid) : 0);

    const type = OP_TYPES[draft.type] ? draft.type : null;
    if (!type) err("type", "Wybierz rodzaj operacji");

    const date = str(draft.date);
    if (!Dates.isISO(date)) err("date", "Podaj datę w formacie RRRR-MM-DD");
    else if (date > today) err("date", "Data operacji nie może być z przyszłości");
    else if (whId && isLocked(state, whId, date)) err("date", `Okres ${lockedMonth(state, whId)} jest zamknięty inwentaryzacją — wybierz datę po zamknięciu`);

    const postings = [];          // {kind, productId, qty (jednostka magazynowa), direct?}
    const documents = [];
    const norm = { type, purchase: null, production: null, sale: null };
    const totals = { purchaseCost: 0, rawCost: 0, chippingCost: 0, revenue: 0, transportCost: 0, result: 0 };
    const R_ = draft.production || {}, S = draft.sale || {}, P = draft.purchase || {};

    /* ---------- produkcja (wspólna dla trzech ścieżek) ---------- */
    /** input: {mode:"chain"|"stock"|"direct", rawProduct, consumeStock (ilość surowca w jedn. magazynowej) | null} */
    function planProduction(mode, rawProduct, consumeStock) {
      const pt = PROD_TYPES[R_.type];
      if (!pt) err("production.type", "Wybierz rodzaj produkcji");
      const outProduct = pt ? prodOf(pt.productId) : null;
      if (pt && !outProduct) err("production.type", "Brak produktu wynikowego w kartotece");
      let maxMP = null;
      if (rawProduct && consumeStock !== null) maxMP = Units.convert(consumeStock, rawProduct.unit, "MP", rawProduct, cfg);
      let outMP = 0;
      if (str(R_.outMP) === "") {
        if (maxMP !== null) outMP = maxMP;
        else err("production.outMP", "Podaj ilość wyprodukowanej zrębki (MP)");
      } else {
        const o = num("production.outMP", R_.outMP, { gt: 0 });
        outMP = o === null ? 0 : round(o, 3);
      }
      if (maxMP !== null && outMP > maxMP + EPS && maxMP > 0) err("production.outMP", `Wynik produkcji nie może przekroczyć zużytego surowca (${fmtQ(maxMP)} MP)`);
      if (maxMP !== null && outMP > 0 && outMP < maxMP - EPS && !DIFF_REASONS[R_.diffReason]) err("production.diffReason", `Wynik niższy od zużycia o ${fmtQ(maxMP - outMP)} MP — wskaż przyczynę`);
      // pochodzenie: wymagane przy produkcji z lasu (zakup + autozużycie, sprzedaż bezpośrednia)
      if (mode !== "stock") {
        if (R_.type === "lesna") {
          if (!str(R_.ndl)) err("production.ndl", "Podaj nadleśnictwo");
          if (!str(R_.lesnictwo)) err("production.lesnictwo", "Podaj leśnictwo");
          if (!str(R_.kwit)) err("production.kwit", "Podaj numer kwitu wywozowego");
        } else if (R_.type === "inwestycyjna" && !str(R_.investSite)) err("production.investSite", "Podaj miejsce wycinki / inwestycję");
      }
      if (R_.chipperId) {
        const ch = byId(state.fleet.chippers, R_.chipperId);
        if (!ch) err("production.chipperId", "Nieznany rębak");
        else if (ch.status !== "aktywny") err("production.chipperId", `Rębak ma status „${ASSET_STATUS[ch.status] || ch.status}”`);
        if (!byId(state.fleet.operators, R_.operatorId || (ch && ch.operatorId))) err("production.operatorId", "Wybierz operatora rębaka");
      }
      const chipRate = str(R_.chipRate) === "" ? cfg.chipRateDefault : num("production.chipRate", R_.chipRate, { min: 0 });
      const chippingCost = chipRate !== null ? round(outMP * chipRate, 2) : 0;
      totals.chippingCost = chippingCost;
      const ch = byId(state.fleet.chippers, R_.chipperId);
      norm.production = {
        mode, type: R_.type, typeLabel: pt ? pt.label : "", outProductId: outProduct ? outProduct.id : "",
        rawProductId: rawProduct ? rawProduct.id : "", consumeQty: consumeStock, consumeUnit: rawProduct ? rawProduct.unit : null,
        maxMP, outMP, diffReason: R_.diffReason || "", chipRate: chipRate || 0, chippingCost,
        ndl: str(R_.ndl), lesnictwo: str(R_.lesnictwo), kwit: str(R_.kwit),
        sourceType: R_.type === "inwestycyjna" ? PROD_TYPES.inwestycyjna.sourceType : "",
        investSite: str(R_.investSite), sourceDoc: str(R_.sourceDoc),
        chipperId: R_.chipperId || "", chipperName: ch ? ch.name : "",
        operatorId: R_.chipperId ? (R_.operatorId || (ch ? ch.operatorId : "")) : ""
      };
      return { outProduct, outMP, chippingCost };
    }
    const prodMeta = () => {
      const x = norm.production;
      const m = { productionType: x.typeLabel, chipRate: x.chipRate, chippingCost: x.chippingCost };
      if (x.chipperName) m.chipper = x.chipperName;
      if (x.mode !== "stock" && x.type === "lesna") Object.assign(m, { ndl: x.ndl, lesnictwo: x.lesnictwo, kwit: x.kwit });
      if (x.mode !== "stock" && x.type === "inwestycyjna") Object.assign(m, { sourceType: x.sourceType, investSite: x.investSite, sourceDoc: x.sourceDoc });
      return m;
    };

    /* ---------- sprzedaż wyniku produkcji (łańcuch / bezpośrednia) ---------- */
    function planSaleOfOutput(outProduct, outMP, direct) {
      const buyer = byId(state.partners, S.buyerId);
      if (!S.buyerId) err("sale.buyerId", "Odbiorca jest wymagany przy sprzedaży");
      else if (!buyer || !["buyer", "both"].includes(buyer.role) || buyer.active === false) err("sale.buyerId", "Nieznany lub nieaktywny odbiorca");
      let saleMP = outMP;
      if (str(S.qtyMP) !== "") { const q = num("sale.qtyMP", S.qtyMP, { gt: 0 }); saleMP = q === null ? 0 : round(q, 3); }
      if (saleMP > outMP + EPS) err("sale.qtyMP", `Sprzedaż ${fmtQ(saleMP)} MP przekracza wynik produkcji ${fmtQ(outMP)} MP`);
      if (!["MP", "t"].includes(S.priceUnit)) err("sale.priceUnit", "Wybierz jednostkę ceny");
      const price = num("sale.price", S.price, { min: 0 });
      if (price === 0) warnings.push("Cena sprzedaży wynosi 0 zł.");
      const weightT = outProduct ? Units.mass(saleMP, outProduct, cfg) : 0;
      const revenue = price !== null ? round((S.priceUnit === "t" ? weightT : saleMP) * price, 2) : 0;
      totals.revenue = revenue;
      if (direct && outMP - saleMP > EPS) warnings.push(`Nie cała produkcja jest sprzedana — pozostałe ${fmtQ(outMP - saleMP)} MP zostanie przyjęte na stan magazynu.`);
      norm.sale = { direct, fromStock: false, buyerId: S.buyerId, productId: outProduct ? outProduct.id : "", qty: saleMP, unit: "MP", stockQty: saleMP, price, priceUnit: S.priceUnit, revenue, weightT };
      return saleMP;
    }

    if (type === "ZAKUP") {
      /* ============================ A. ZAKUP ============================ */
      const supplier = byId(state.partners, P.supplierId);
      if (!P.supplierId) err("purchase.supplierId", "Wybierz dostawcę");
      else if (!supplier || !["supplier", "both"].includes(supplier.role) || supplier.active === false) err("purchase.supplierId", "Nieznany lub nieaktywny dostawca");
      if (!BASIS[P.basis]) err("purchase.basis", "Wybierz podstawę: Deklaracja albo KZR");
      const product = prodOf(P.productId);
      if (!P.productId) err("purchase.productId", "Wybierz produkt / surowiec");
      else if (!product || product.active === false) err("purchase.productId", "Nieznany produkt");
      const unitOk = product && Units.allowed(product).includes(P.unit);
      if (product && !unitOk) err("purchase.unit", `Dla „${product.name}” dozwolone: ${Units.allowed(product).map(Units.label).join(", ")}`);
      const qty = num("purchase.qty", P.qty, { gt: 0 });
      const price = num("purchase.price", P.price, { min: 0 });
      if (price === 0) warnings.push("Cena zakupu wynosi 0 zł — upewnij się, że to zamierzone.");
      const stockQty = qty !== null && unitOk ? Units.convert(qty, P.unit, product.unit, product, cfg) : 0;
      const autoWeight = product ? Units.mass(stockQty, product, cfg) : 0;
      let weightT = autoWeight;
      if (P.weightMode === "manual") {
        const w = num("purchase.weightManual", P.weightManual, { gt: 0 });
        if (w !== null) {
          weightT = round(w, 3);
          if (autoWeight > 0 && product.unit !== "t" && Math.abs(weightT - autoWeight) / autoWeight > 0.25) {
            warnings.push(`Waga rzeczywista ${fmtQ(weightT)} t różni się o ponad 25% od orientacyjnej ${fmtQ(autoWeight)} t — sprawdź kwit wagowy.`);
          }
        }
      } else if (P.weightMode !== "auto") err("purchase.weightMode", "Wybierz sposób ustalenia wagi");
      totals.purchaseCost = qty !== null && price !== null ? round(qty * price, 2) : 0;
      norm.purchase = { supplierId: P.supplierId, basis: P.basis, productId: P.productId, qty, unit: P.unit, stockQty, stockUnit: product ? product.unit : null, price, cost: totals.purchaseCost, weightMode: P.weightMode, weightT, autoWeight };
      if (product && stockQty > 0) {
        postings.push({ kind: "ZAKUP", productId: product.id, qty: stockQty });
        documents.push({ type: "PZ", kind: "ZAKUP", productId: product.id, qty, unit: P.unit, stockQty, stockUnit: product.unit, weightT, weightMode: P.weightMode, value: totals.purchaseCost, partnerId: P.supplierId, partner: partyName(P.supplierId), basis: P.basis, stock: "+" });
      }
      // opcjonalny łańcuch: + produkcja z autozużyciem (+ sprzedaż)
      if (R_.enabled) {
        if (product && product.cat !== "drewno") err("production.enabled", "Produkcja zrębki jest możliwa tylko z surowca drzewnego (drewno)");
        let consumeStock = null;
        if (product && product.cat === "drewno") {
          let cq = qty;
          if (str(R_.consumeQty) !== "") cq = num("production.consumeQty", R_.consumeQty, { gt: 0 });
          if (cq !== null && unitOk) {
            consumeStock = Units.convert(cq, P.unit, product.unit, product, cfg);
            const avail = round(stockOf(product.id) + stockQty, 3);
            norm.available = { stock: stockOf(product.id), purchase: stockQty, total: avail, unit: product.unit };
            if (consumeStock > avail + EPS) err("production.consumeQty", `Zużycie ${fmtQ(consumeStock)} ${Units.label(product.unit)} przekracza dostępny materiał ${fmtQ(avail)} ${Units.label(product.unit)} (stan ${fmtQ(stockOf(product.id))} + zakup ${fmtQ(stockQty)})`);
          }
        }
        const { outProduct, outMP } = planProduction("chain", product && product.cat === "drewno" ? product : null, consumeStock);
        if (product && consumeStock > 0) {
          postings.push({ kind: "ZUZYCIE", productId: product.id, qty: -consumeStock });
          documents.push({ type: "RW", kind: "ZUZYCIE", productId: product.id, qty: consumeStock, unit: product.unit, stockQty: consumeStock, stockUnit: product.unit, weightT: Units.mass(consumeStock, product, cfg), value: 0, stock: "−" });
        }
        if (outProduct && outMP > 0) {
          postings.push({ kind: "PRODUKCJA", productId: outProduct.id, qty: outMP });
          documents.push({ type: "PW", kind: "PRODUKCJA", productId: outProduct.id, qty: outMP, unit: "MP", stockQty: outMP, stockUnit: "MP", weightT: Units.mass(outMP, outProduct, cfg), value: totals.chippingCost, stock: "+", meta: prodMeta() });
        }
        if (S.enabled) {
          const saleMP = planSaleOfOutput(outProduct, outMP, false);
          if (outProduct && saleMP > 0) {
            postings.push({ kind: "SPRZEDAZ", productId: outProduct.id, qty: -saleMP });
            documents.push({ type: "WZ", kind: "SPRZEDAZ", productId: outProduct.id, qty: saleMP, unit: "MP", stockQty: saleMP, stockUnit: "MP", weightT: norm.sale.weightT, value: totals.revenue, price: norm.sale.price, priceUnit: S.priceUnit, partnerId: S.buyerId, partner: partyName(S.buyerId), stock: "−" });
          }
        }
      } else if (S.enabled) err("sale.enabled", "W zakupie sprzedaż korzysta z wyniku produkcji — zaznacz produkcję albo użyj operacji „Sprzedaż” (WZ z magazynu)");
    } else if (type === "SPRZEDAZ" && !S.direct) {
      /* ===================== B. SPRZEDAŻ Z MAGAZYNU (WZ) ===================== */
      const product = prodOf(S.productId);
      if (!S.productId) err("sale.productId", "Wybierz towar z magazynu");
      else if (!product) err("sale.productId", "Nieznany produkt");
      const unitOk = product && Units.allowed(product).includes(S.unit);
      if (product && !unitOk) err("sale.unit", `Dla „${product.name}” dozwolone: ${Units.allowed(product).map(Units.label).join(", ")}`);
      const qty = num("sale.qty", S.qty, { gt: 0 });
      const stockQty = qty !== null && unitOk ? Units.convert(qty, S.unit, product.unit, product, cfg) : 0;
      const onStock = product ? stockOf(product.id) : 0;
      if (product && qty !== null && stockQty > onStock + EPS) err("sale.qty", `Na magazynie jest ${fmtQ(onStock)} ${Units.label(product.unit)} — nie można sprzedać ${fmtQ(stockQty)} ${Units.label(product.unit)}`);
      const buyer = byId(state.partners, S.buyerId);
      if (!S.buyerId) err("sale.buyerId", "Wybierz kupującego / odbiorcę");
      else if (!buyer || !["buyer", "both"].includes(buyer.role) || buyer.active === false) err("sale.buyerId", "Nieznany lub nieaktywny odbiorca");
      const price = num("sale.price", S.price, { min: 0 });
      if (price === 0) warnings.push("Cena sprzedaży wynosi 0 zł.");
      totals.revenue = qty !== null && price !== null ? round(qty * price, 2) : 0;
      const weightT = product ? Units.mass(stockQty, product, cfg) : 0;
      norm.sale = { direct: false, fromStock: true, buyerId: S.buyerId, productId: S.productId, qty, unit: S.unit, stockQty, stockUnit: product ? product.unit : null, onStock, after: round(onStock - stockQty, 3), price, priceUnit: S.unit, revenue: totals.revenue, weightT };
      if (product && stockQty > 0) {
        postings.push({ kind: "SPRZEDAZ", productId: product.id, qty: -stockQty });
        documents.push({ type: "WZ", kind: "SPRZEDAZ", productId: product.id, qty, unit: S.unit, stockQty, stockUnit: product.unit, weightT, value: totals.revenue, price, priceUnit: S.unit, partnerId: S.buyerId, partner: partyName(S.buyerId), stock: "−" });
      }
    } else if (type === "SPRZEDAZ" && S.direct) {
      /* ============ D. PRODUKCJA + SPRZEDAŻ BEZPOŚREDNIA (las → odbiorca) ============ */
      const rawP = prodOf(R_.rawProductId);
      if (R_.rawProductId && (!rawP || rawP.cat !== "drewno")) err("production.rawProductId", "Surowiec musi być drewnem");
      let rawQty = null;
      if (str(R_.rawQty) !== "") rawQty = num("production.rawQty", R_.rawQty, { gt: 0 });
      if (rawQty !== null && !rawP) err("production.rawProductId", "Wskaż rodzaj surowca dla podanej ilości");
      // surowiec z lasu NIE jest pobierany ze stanu — ilość służy tylko do wyliczenia wydajności
      const consume = rawP && rawQty !== null ? rawQty : null;
      const rawCost = str(R_.rawCost) === "" ? 0 : num("production.rawCost", R_.rawCost, { min: 0 });
      totals.rawCost = rawCost || 0;
      const { outProduct, outMP } = planProduction("direct", rawP, consume);
      norm.production.rawQty = consume; norm.production.rawCost = totals.rawCost;
      const saleMP = planSaleOfOutput(outProduct, outMP, true);
      if (outProduct && outMP > 0) {
        postings.push({ kind: "PRODUKCJA", productId: outProduct.id, qty: outMP, direct: true });
        documents.push({ type: "PW", kind: "PRODUKCJA", productId: outProduct.id, qty: outMP, unit: "MP", stockQty: outMP, stockUnit: "MP", weightT: Units.mass(outMP, outProduct, cfg), value: totals.chippingCost, stock: "+", meta: Object.assign(prodMeta(), { direct: "tak — produkcja w lesie", rawInfo: consume !== null ? `${fmtQ(consume)} ${Units.label(rawP.unit)} ${rawP.name}` : "" }) });
      }
      if (outProduct && saleMP > 0) {
        postings.push({ kind: "SPRZEDAZ", productId: outProduct.id, qty: -saleMP, direct: true });
        documents.push({ type: "WZ", kind: "SPRZEDAZ", productId: outProduct.id, qty: saleMP, unit: "MP", stockQty: saleMP, stockUnit: "MP", weightT: norm.sale.weightT, value: totals.revenue, price: norm.sale.price, priceUnit: S.priceUnit, partnerId: S.buyerId, partner: partyName(S.buyerId), stock: "−", meta: { direct: "sprzedaż bezpośrednia po produkcji / prosto z lasu" } });
      }
    } else if (type === "PRODUKCJA") {
      /* ================= C. PRODUKCJA NA MAGAZYNIE (ze stanu) ================= */
      const rawP = prodOf(R_.rawProductId);
      if (!R_.rawProductId) err("production.rawProductId", "Wybierz surowiec ze stanu magazynu");
      else if (!rawP || rawP.cat !== "drewno") err("production.rawProductId", "Produkcja zrębki jest możliwa tylko z drewna");
      const consume = num("production.consumeQty", R_.consumeQty, { gt: 0 });
      const onStock = rawP ? stockOf(rawP.id) : 0;
      if (rawP && consume !== null) {
        norm.available = { stock: onStock, purchase: 0, total: onStock, unit: rawP.unit };
        if (consume > onStock + EPS) err("production.consumeQty", `Na magazynie jest ${fmtQ(onStock)} ${Units.label(rawP.unit)} — nie można zużyć ${fmtQ(consume)} ${Units.label(rawP.unit)}`);
      }
      const { outProduct, outMP } = planProduction("stock", rawP && rawP.cat === "drewno" ? rawP : null, consume);
      if (rawP && consume > 0) {
        postings.push({ kind: "ZUZYCIE", productId: rawP.id, qty: -round(consume, 3) });
        documents.push({ type: "RW", kind: "ZUZYCIE", productId: rawP.id, qty: consume, unit: rawP.unit, stockQty: consume, stockUnit: rawP.unit, weightT: Units.mass(consume, rawP, cfg), value: 0, stock: "−" });
      }
      if (outProduct && outMP > 0) {
        postings.push({ kind: "PRODUKCJA", productId: outProduct.id, qty: outMP });
        documents.push({ type: "PW", kind: "PRODUKCJA", productId: outProduct.id, qty: outMP, unit: "MP", stockQty: outMP, stockUnit: "MP", weightT: Units.mass(outMP, outProduct, cfg), value: totals.chippingCost, stock: "+", meta: prodMeta() });
      }
    }

    /* ---------- miejsce i transport ---------- */
    const T = draft.transport || {};
    const place = str(T.place);
    if (!place) err("transport.place", "Podaj miejsce transportu / dostawy");
    const mode = T.mode || "none";
    const transport = { mode, place, cost: 0 };
    if (!TRANSPORT_MODES[mode]) err("transport.mode", "Nieznany tryb transportu");
    // masa ładunku, z którą porównujemy tonaż składu
    const shippedT = norm.sale ? norm.sale.weightT : norm.purchase ? norm.purchase.weightT : 0;
    if (mode === "own") {
      const O = T.own || {};
      const v = byId(state.fleet.vehicles, O.vehicleId);
      if (!O.vehicleId) err("transport.own.vehicleId", "Wybierz pojazd z floty");
      else if (!v) err("transport.own.vehicleId", "Nieznany pojazd");
      else if (v.status !== "aktywny") err("transport.own.vehicleId", `Pojazd ma status „${ASSET_STATUS[v.status] || v.status}” — wybierz aktywny`);
      const driverId = O.driverId || (v && v.driverId) || "";
      const d = byId(state.fleet.drivers, driverId);
      if (!driverId) err("transport.own.driverId", "Pojazd nie ma kierowcy domyślnego — wybierz kierowcę");
      else if (!d) err("transport.own.driverId", "Nieznany kierowca");
      const km = num("transport.own.km", O.km, { gt: 0 });
      const rate = str(O.rate) === "" ? cfg.kmRateDefault : num("transport.own.rate", O.rate, { gt: 0 });
      Object.assign(transport, {
        vehicleId: v ? v.id : "", vehicleName: v ? v.name : "", reg: v ? v.reg : "",
        driverId, driverName: d ? d.name : "", defaultDriverId: v ? v.driverId : "",
        driverOverridden: !!(v && d && v.driverId !== d.id),
        km: km || 0, rate: rate || 0, cost: km !== null && rate !== null ? round(km * rate, 2) : 0
      });
    } else if (mode === "external") {
      const X = T.external || {};
      if (!str(X.company)) err("transport.external.company", "Podaj firmę transportową");
      if (!str(X.reg)) err("transport.external.reg", "Podaj numer rejestracyjny");
      const km = str(X.km) === "" ? 0 : num("transport.external.km", X.km, { min: 0 });
      const included = !!X.includedInPrice;
      let freight = 0;
      if (!included) freight = num("transport.external.freight", X.freight, { min: 0 }) || 0;
      Object.assign(transport, { company: str(X.company), reg: str(X.reg).toUpperCase(), km: km || 0, freight: included ? 0 : freight, includedInPrice: included, cost: included ? 0 : round(freight, 2) });
    } else if (mode === "train") {
      const Tr = T.train || {};
      const n = num("transport.train.wagonCount", Tr.wagonCount, { gt: 0, integer: true });
      if (n !== null && n > cfg.maxWagons) err("transport.train.wagonCount", `Maksymalnie ${cfg.maxWagons} wagonów w jednym składzie`);
      const count = n && n <= cfg.maxWagons ? n : 0;
      const capUnit = Tr.capUnit === "MP" ? "MP" : "t";
      const capacity = str(Tr.capacity) === "" ? null : num("transport.train.capacity", Tr.capacity, { gt: 0 });
      const capT = capacity === null ? null : capUnit === "t" ? capacity : round(capacity * cfg.mp_t, 3);
      const tonMode = Tr.tonMode === "each" ? "each" : "same";
      const tons = [];
      if (tonMode === "same") {
        const t = num("transport.train.sameT", Tr.sameT, { gt: 0 });
        for (let i = 0; i < count; i++) tons.push(t || 0);
      } else {
        for (let i = 0; i < count; i++) tons.push(num(`transport.train.wagonT.${i}`, (Tr.wagonT || [])[i], { gt: 0 }) || 0);
      }
      const totalT = round(tons.reduce((a, b) => a + b, 0), 3);
      if (capT) tons.forEach((t, i) => { if (t > capT + EPS) warnings.push(`Wagon ${i + 1}: ${fmtQ(t)} t przekracza ładowność ${fmtQ(capacity)} ${capUnit}${capUnit === "MP" ? ` ≈ ${fmtQ(capT)} t` : ""}`); });
      if (!["MP", "m3", "t"].includes(Tr.priceUnit)) err("transport.train.priceUnit", "Wybierz jednostkę ceny");
      const tprice = num("transport.train.price", Tr.price, { min: 0 });
      const totalMP = round(totalT / cfg.mp_t, 3);
      const basisQty = Tr.priceUnit === "t" ? totalT : Tr.priceUnit === "MP" ? totalMP : round(totalMP / cfg.m3_mp, 3);
      Object.assign(transport, {
        trainNo: str(Tr.trainNo), carrier: str(Tr.carrier), docNo: str(Tr.docNo), loadPlace: str(Tr.loadPlace),
        wagonCount: count, capUnit, capacity, totalCapacity: capacity !== null ? round(capacity * count, 3) : null,
        totalCapacityMP: capacity !== null && capUnit === "MP" ? round(capacity * count, 3) : null,
        tonMode, wagonT: tons, totalT, totalMP, price: tprice || 0, priceUnit: Tr.priceUnit, basisQty,
        cost: tprice !== null ? round(basisQty * tprice, 2) : 0
      });
      if (totalT > 0 && shippedT > 0 && Math.abs(totalT - shippedT) / shippedT > 0.05) {
        warnings.push(`Tonaż składu ${fmtQ(totalT)} t różni się od orientacyjnej masy ładunku ${fmtQ(shippedT)} t. Transport nie zmienia stanu magazynowego.`);
      }
    }
    totals.transportCost = transport.cost;
    norm.transport = transport;
    if (mode !== "none") documents.push({ type: "TR", kind: "TRANSPORT", productId: null, qty: null, unit: null, value: transport.cost, stock: "brak", transport: clone(transport) });
    documents.forEach(d => { d.place = place; });

    /* ---------- symulacja sald: żaden krok nie może zejść poniżej zera ---------- */
    postings.forEach((p, i) => { p.step = i + 1; p.doc = KINDS[p.kind].doc; });
    const balances = [];
    if (whId) {
      const sim = new Map();
      const get = pid => sim.has(pid) ? sim.get(pid) : stockOf(pid);
      for (const p of postings) {
        const before = get(p.productId), after = round(before + p.qty, 3);
        p.before = before; p.after = after;
        const pr = prodOf(p.productId);
        if (after < -EPS) err("_stock", `Krok ${p.step} (${KINDS[p.kind].label}) daje stan ujemny: ${fmtQ(after)} ${Units.label(pr ? pr.unit : "")}`);
        sim.set(p.productId, after);
      }
      for (const [pid, after] of sim) balances.push({ productId: pid, before: stockOf(pid), after });
    }
    totals.result = round(totals.revenue - totals.purchaseCost - totals.rawCost - totals.chippingCost - totals.transportCost, 2);

    const errorList = Object.keys(errors).map(k => ({ field: k, msg: errors[k] }));
    return { ok: errorList.length === 0, errors, errorList, warnings, whId, date, type, norm, postings, balances, documents, totals, user: user ? { id: user.id, name: user.name } : null };
  }

  /* ------------------------------------------------------------------ */
  /* Numeracja, audyt, zapis                                             */
  /* ------------------------------------------------------------------ */
  function nextNo(state, type, date) {
    const ym = Dates.ym(date), key = `${type}-${ym}`;
    state.seq[key] = (state.seq[key] || 0) + 1;
    return `${type}/${String(state.seq[key]).padStart(3, "0")}/${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
  }
  function nextLedgerSeq(state) { return state.ledger.length ? Math.max(...state.ledger.map(l => l.seq)) + 1 : 1; }
  function audit(state, ctx, rec) {
    const user = ctx && ctx.user;
    state.audit.push(Object.assign({
      id: uid("a"), ts: (ctx && ctx.now) || new Date().toISOString(),
      userId: user ? user.id : "system", userName: user ? user.name : "System",
      whId: user ? user.whId : null, source: (ctx && ctx.source) || "Aplikacja"
    }, rec));
  }
  const snapshot = (state, whId, ids) => { const o = {}; for (const pid of ids) o[pid] = Stock.balance(state, whId, pid); return o; };

  function commitOperation(state, draft, ctx) {
    if (!draft || !draft.idemKey) return { ok: false, error: "Brak klucza idempotencji formularza" };
    const dup = state.operations.find(o => o.idemKey === draft.idemKey);
    if (dup) return { ok: true, duplicate: true, op: dup };
    const plan = planOperation(state, draft, ctx);
    if (!plan.ok) return { ok: false, plan, error: plan.errorList[0].msg };

    const ids = [...new Set(plan.postings.map(p => p.productId))];
    const before = snapshot(state, plan.whId, ids);
    const opId = uid("op");
    const docs = plan.documents.map(d => Object.assign({}, d, { no: nextNo(state, d.type, plan.date) }));
    const docNo = t => (docs.find(d => d.type === t) || {}).no || null;
    // powiązanie wejście → wyjście: PW wskazuje RW, z którego powstał produkt
    const pw = docs.find(d => d.type === "PW"), rw = docs.find(d => d.type === "RW");
    if (pw && rw) pw.meta = Object.assign({}, pw.meta, { fromDoc: rw.no });
    let seq = nextLedgerSeq(state);
    const ledger = plan.postings.map(p => {
      const pr = byId(state.products, p.productId);
      return { id: uid("l"), seq: seq++, opId, step: p.step, date: plan.date, whId: plan.whId, productId: p.productId, kind: p.kind, qty: p.qty, unit: pr.unit, t: Units.mass(p.qty, pr, state.config), docNo: docNo(p.doc), direct: !!p.direct };
    });
    const main = plan.type === "ZAKUP" ? plan.norm.purchase : plan.type === "SPRZEDAZ" && !plan.norm.sale.direct ? plan.norm.sale : null;
    const op = {
      id: opId, idemKey: draft.idemKey, type: plan.type, no: docs.length ? docs[0].no : null,
      date: plan.date, whId: plan.whId, status: "posted", userId: ctx.user.id, userName: ctx.user.name,
      createdAt: (ctx && ctx.now) || new Date().toISOString(),
      scope: plan.type === "ZAKUP" ? ["ZAKUP"].concat(plan.norm.production ? ["PRODUKCJA"] : []).concat(plan.norm.sale ? ["SPRZEDAZ"] : [])
        : plan.type === "PRODUKCJA" ? ["PRODUKCJA"] : plan.norm.sale.direct ? ["PRODUKCJA", "SPRZEDAZ"] : ["SPRZEDAZ"],
      direct: !!(plan.norm.sale && plan.norm.sale.direct),
      purchase: plan.norm.purchase, production: plan.norm.production, sale: plan.norm.sale,
      mainProductId: main ? main.productId : plan.norm.production ? (plan.norm.production.rawProductId || plan.norm.production.outProductId) : null,
      transport: plan.norm.transport, place: plan.norm.transport.place,
      documents: docs, ledgerIds: ledger.map(l => l.id), totals: plan.totals,
      notes: str(draft.notes), warnings: plan.warnings
    };
    state.operations.push(op);
    state.ledger.push(...ledger);
    state.rev += 1;
    audit(state, ctx, {
      entity: "operation", entityId: op.id, opNo: op.no, action: `Utworzenie operacji: ${OP_TYPES[op.type].label}${op.direct ? " (bezpośrednia)" : ""}`,
      before: { stan: before },
      after: { stan: snapshot(state, plan.whId, ids), dokumenty: docs.map(d => d.no), koszty: plan.totals },
      source: (ctx && ctx.source) || "Formularz „Nowa operacja”"
    });
    return { ok: true, op, plan };
  }

  function stornoOperation(state, opId, ctx, reason) {
    const user = ctx && ctx.user;
    if (!can(user, "op.storno")) return { ok: false, error: "Twoja rola nie pozwala wykonać korekty" };
    const op = byId(state.operations, opId);
    if (!op) return { ok: false, error: "Nie znaleziono operacji" };
    if (op.status !== "posted") return { ok: false, error: "Operacja jest już skorygowana" };
    if (user.whId !== op.whId && user.role !== "admin") return { ok: false, error: "Korekty wykonuje się w magazynie operacji" };
    if (!str(reason)) return { ok: false, error: "Podaj przyczynę korekty" };
    const today = (ctx && ctx.today) || Dates.localToday();
    if (isLocked(state, op.whId, today)) return { ok: false, error: "Bieżący okres jest zamknięty — korekta niemożliwa" };
    const src = state.ledger.filter(l => l.opId === op.id).sort((a, b) => b.step - a.step);
    const sim = new Map();
    const get = pid => sim.has(pid) ? sim.get(pid) : Stock.balance(state, op.whId, pid);
    for (const l of src) {
      const after = round(get(l.productId) - l.qty, 3);
      if (after < -EPS) {
        const p = byId(state.products, l.productId);
        return { ok: false, error: `Korekta niemożliwa: stan „${p ? p.name : l.productId}” spadłby do ${fmtQ(after)} ${Units.label(p ? p.unit : "")} (materiał został już rozchodowany)` };
      }
      sim.set(l.productId, after);
    }
    const ids = [...new Set(src.map(l => l.productId))];
    const before = snapshot(state, op.whId, ids);
    const no = nextNo(state, "KO", today);
    let seq = nextLedgerSeq(state);
    state.ledger.push(...src.map((l, i) => ({ id: uid("l"), seq: seq++, opId: op.id, step: 100 + i, date: today, whId: op.whId, productId: l.productId, kind: "KOREKTA", qty: -l.qty, unit: l.unit, t: -l.t, docNo: no, refDoc: l.docNo })));
    op.status = "storno";
    op.storno = { no, date: today, reason: str(reason), userId: user.id, userName: user.name };
    state.rev += 1;
    audit(state, ctx, { entity: "operation", entityId: op.id, opNo: op.no, action: "Korekta (storno)", before: { status: "posted", stan: before }, after: { status: "storno", dokument: no, przyczyna: str(reason), stan: snapshot(state, op.whId, ids) }, source: (ctx && ctx.source) || "Plan dokumentów — korekta" });
    return { ok: true, no };
  }

  /** Bilans otwarcia (dane przykładowe / migracja). Ilości w jednostce magazynowej produktu. */
  function openingBalance(state, whId, date, lines, ctx) {
    const no = nextNo(state, "BO", date);
    let seq = nextLedgerSeq(state);
    for (const ln of lines) {
      const p = byId(state.products, ln.productId);
      state.ledger.push({ id: uid("l"), seq: seq++, opId: null, step: 1, date, whId, productId: p.id, kind: "BO", qty: round(ln.qty, 3), unit: p.unit, t: Units.mass(ln.qty, p, state.config), docNo: no });
    }
    state.rev += 1;
    audit(state, ctx, { entity: "ledger", entityId: no, opNo: no, action: "Bilans otwarcia", before: null, after: { magazyn: whId, pozycje: lines.length }, source: (ctx && ctx.source) || "Migracja" });
    return no;
  }

  /* ------------------------------------------------------------------ */
  /* Inwentaryzacja miesięczna (ilości w jednostce magazynowej)          */
  /* ------------------------------------------------------------------ */
  const Inventory = {
    find(state, whId, ym) { return state.inventory.find(p => p.whId === whId && p.ym === ym) || null; },
    cutoff(ym, today) { const end = Dates.monthEnd(ym); return end < today ? end : today; },
    open(state, ym, ctx) {
      const user = ctx && ctx.user, today = (ctx && ctx.today) || Dates.localToday();
      if (!can(user, "inv.open")) return { ok: false, error: "Twoja rola nie pozwala otwierać okresów" };
      if (!Dates.isYM(ym)) return { ok: false, error: "Podaj miesiąc w formacie RRRR-MM" };
      if (ym > Dates.ym(today)) return { ok: false, error: "Nie można otworzyć okresu z przyszłości" };
      if (this.find(state, user.whId, ym)) return { ok: false, error: `Okres ${ym} już istnieje` };
      const locked = lockedMonth(state, user.whId);
      if (locked && ym <= locked) return { ok: false, error: `Miesiące do ${locked} włącznie są już zamknięte` };
      const p = { id: uid("inv"), whId: user.whId, ym, status: "OTWARTA", openedAt: (ctx && ctx.now) || new Date().toISOString(), openedBy: user.name, generatedAt: null, closedAt: null, closedBy: null, auto: false, docNo: null, lines: [] };
      state.inventory.push(p); state.rev += 1;
      audit(state, ctx, { entity: "inventory", entityId: p.id, opNo: ym, action: "Otwarcie okresu inwentaryzacji", before: null, after: { okres: ym, status: "OTWARTA" }, source: (ctx && ctx.source) || "Moduł Inwentaryzacja" });
      return { ok: true, period: p };
    },
    generate(state, ym, ctx) {
      const user = ctx && ctx.user, today = (ctx && ctx.today) || Dates.localToday();
      if (!can(user, "inv.count")) return { ok: false, error: "Brak uprawnień" };
      const p = this.find(state, user.whId, ym);
      if (!p) return { ok: false, error: "Najpierw otwórz okres" };
      if (p.status !== "OTWARTA") return { ok: false, error: "Okres jest zamknięty — tylko do odczytu" };
      const cut = this.cutoff(ym, today);
      const book = Stock.byProduct(state, user.whId, cut);
      const prev = new Map(p.lines.map(l => [l.productId, l]));
      const lines = [];
      for (const pr of state.products) {
        const q = book.get(pr.id) || 0, old = prev.get(pr.id);
        if (Math.abs(q) < EPS && !old) continue;
        lines.push({ productId: pr.id, unit: pr.unit, bookQty: round(q, 3), countQty: old ? old.countQty : null, countText: old ? old.countText : "" });
      }
      const before = { pozycje: p.lines.length };
      p.lines = lines; p.generatedAt = (ctx && ctx.now) || new Date().toISOString(); p.cutoff = cut; state.rev += 1;
      audit(state, ctx, { entity: "inventory", entityId: p.id, opNo: ym, action: "Wygenerowanie listy spisowej", before, after: { pozycje: lines.length, stan_na: cut }, source: (ctx && ctx.source) || "Moduł Inwentaryzacja" });
      return { ok: true, period: p };
    },
    setCount(state, ym, productId, text, ctx) {
      const user = ctx && ctx.user;
      if (!can(user, "inv.count")) return { ok: false, error: "Brak uprawnień" };
      const p = this.find(state, user.whId, ym);
      if (!p) return { ok: false, error: "Brak okresu" };
      if (p.status !== "OTWARTA") return { ok: false, error: "Okres jest zamknięty — tylko do odczytu" };
      const line = p.lines.find(l => l.productId === productId);
      if (!line) return { ok: false, error: "Brak pozycji na liście" };
      const before = { spis: line.countQty };
      if (str(text) === "") { line.countQty = null; line.countText = ""; }
      else {
        const r = NumParse.parse(text);
        if (!r.ok) return { ok: false, error: r.error };
        if (r.value < 0) return { ok: false, error: "Stan ze spisu nie może być ujemny" };
        line.countQty = round(r.value, 3); line.countText = str(text);
      }
      state.rev += 1;
      audit(state, ctx, { entity: "inventory", entityId: p.id, opNo: ym, action: "Wpis stanu ze spisu", before, after: { produkt: productId, spis: line.countQty, jednostka: line.unit }, source: (ctx && ctx.source) || "Moduł Inwentaryzacja" });
      return { ok: true, line };
    },
    close(state, ym, ctx, opts = {}) {
      const user = ctx && ctx.user, today = (ctx && ctx.today) || Dates.localToday();
      const whId = opts.whId || (user && user.whId);
      if (!opts.auto && !can(user, "inv.close")) return { ok: false, error: "Zamknięcie okresu wymaga roli Kierownik lub Administrator" };
      const p = this.find(state, whId, ym);
      if (!p) return { ok: false, error: "Brak okresu" };
      if (p.status !== "OTWARTA") return { ok: false, error: "Okres jest już zamknięty" };
      if (!p.lines.length && !opts.auto) return { ok: false, error: "Wygeneruj listę spisową przed zamknięciem" };
      const missing = p.lines.filter(l => l.countQty === null);
      if (missing.length && !opts.auto) return { ok: false, error: `Brak stanu ze spisu dla ${missing.length} pozycji` };
      const cut = this.cutoff(ym, today);
      const book = Stock.byProduct(state, whId, cut);
      const diffs = [];
      for (const l of p.lines) {
        l.bookQty = round(book.get(l.productId) || 0, 3);
        if (l.countQty === null) { l.countQty = l.bookQty; l.assumed = true; }
        l.diff = round(l.countQty - l.bookQty, 3);
        if (Math.abs(l.diff) > EPS) diffs.push({ productId: l.productId, qty: l.diff });
      }
      for (const d of diffs) {
        if (Stock.balance(state, whId, d.productId) + d.qty < -EPS) return { ok: false, error: `Różnica dla „${(byId(state.products, d.productId) || {}).name}” dałaby dziś stan ujemny — sprawdź operacje po ${cut}` };
      }
      let docNo = null;
      if (diffs.length) {
        docNo = nextNo(state, "IN", cut);
        let seq = nextLedgerSeq(state);
        for (const d of diffs) {
          const pr = byId(state.products, d.productId);
          state.ledger.push({ id: uid("l"), seq: seq++, opId: null, invId: p.id, step: 1, date: cut, whId, productId: d.productId, kind: "INW", qty: d.qty, unit: pr.unit, t: Units.mass(d.qty, pr, state.config), docNo });
        }
      }
      p.status = "ZAMKNIETA"; p.closedAt = (ctx && ctx.now) || new Date().toISOString();
      p.closedBy = opts.auto ? "System (przełom miesiąca)" : user.name; p.auto = !!opts.auto; p.docNo = docNo; p.cutoff = cut;
      state.rev += 1;
      audit(state, ctx, {
        entity: "inventory", entityId: p.id, opNo: ym, action: opts.auto ? "Automatyczne zamknięcie okresu" : "Zamknięcie okresu inwentaryzacji",
        before: { status: "OTWARTA" }, after: { status: "ZAMKNIĘTA", dokument: docNo, roznice: diffs.length, przyjeto_stan_ksiegowy: missing.length },
        source: opts.auto ? "Automat: początek kolejnego miesiąca" : ((ctx && ctx.source) || "Moduł Inwentaryzacja")
      });
      return { ok: true, period: p, docNo, diffs };
    },
    autoClose(state, ctx) {
      const today = (ctx && ctx.today) || Dates.localToday(), cur = Dates.ym(today), done = [];
      if (state.meta.lastMonthCheck === cur) return done;
      for (const p of state.inventory.filter(x => x.status === "OTWARTA" && x.ym < cur).sort((a, b) => a.ym < b.ym ? -1 : 1)) {
        const r = this.close(state, p.ym, Object.assign({}, ctx, { user: null }), { auto: true, whId: p.whId });
        done.push({ ym: p.ym, whId: p.whId, ok: r.ok, error: r.error || null, docNo: r.docNo || null });
      }
      state.meta.lastMonthCheck = cur; state.rev += 1;
      return done;
    }
  };

  /* ------------------------------------------------------------------ */
  /* Flota                                                               */
  /* ------------------------------------------------------------------ */
  const Fleet = {
    KINDS: {
      vehicles: { label: "Pojazd", fields: ["name", "reg", "type", "status", "driverId"] },
      drivers: { label: "Kierowca", fields: ["name", "phone"] },
      chippers: { label: "Rębak", fields: ["name", "status", "operatorId"] },
      operators: { label: "Operator rębaka", fields: ["name", "phone"] }
    },
    validate(state, kind, rec) {
      const e = {}, list = state.fleet[kind];
      if (!str(rec.name)) e.name = "Podaj nazwę";
      if (kind === "vehicles") {
        const reg = str(rec.reg).toUpperCase().replace(/\s+/g, " ");
        if (!reg) e.reg = "Podaj numer rejestracyjny";
        else if (!/^[A-Z0-9 ]{4,10}$/.test(reg)) e.reg = "Numer rejestracyjny: litery i cyfry, 4–10 znaków (np. SGL 4T821)";
        else if (list.some(v => v.id !== rec.id && v.reg.replace(/\s/g, "") === reg.replace(/\s/g, ""))) e.reg = "Taki numer rejestracyjny już istnieje";
        if (!VEHICLE_TYPES[rec.type]) e.type = "Wybierz typ pojazdu";
        if (!ASSET_STATUS[rec.status]) e.status = "Wybierz status";
        if (!byId(state.fleet.drivers, rec.driverId)) e.driverId = "Wybierz kierowcę domyślnego";
      }
      if (kind === "chippers") {
        if (!ASSET_STATUS[rec.status]) e.status = "Wybierz status";
        if (!byId(state.fleet.operators, rec.operatorId)) e.operatorId = "Wybierz operatora domyślnego";
      }
      if ((kind === "drivers" || kind === "operators") && list.some(x => x.id !== rec.id && x.name.toLowerCase() === str(rec.name).toLowerCase())) e.name = "Taka osoba już istnieje";
      return e;
    },
    save(state, kind, rec, ctx) {
      if (!this.KINDS[kind]) return { ok: false, error: "Nieznana kartoteka" };
      if (!can(ctx && ctx.user, "fleet.edit")) return { ok: false, error: "Edycja floty wymaga roli Kierownik lub Administrator" };
      const e = this.validate(state, kind, rec);
      if (Object.keys(e).length) return { ok: false, errors: e, error: Object.values(e)[0] };
      const list = state.fleet[kind];
      const clean = { id: rec.id || uid(kind.slice(0, 2)) };
      for (const f of this.KINDS[kind].fields) clean[f] = f === "reg" ? str(rec.reg).toUpperCase().replace(/\s+/g, " ") : str(rec[f]);
      const idx = list.findIndex(x => x.id === clean.id);
      const before = idx >= 0 ? clone(list[idx]) : null;
      if (idx >= 0) list[idx] = Object.assign({}, list[idx], clean); else list.push(clean);
      state.rev += 1;
      audit(state, ctx, { entity: "fleet", entityId: clean.id, opNo: clean.name, action: `${before ? "Zmiana" : "Dodanie"}: ${this.KINDS[kind].label}`, before, after: clean, source: (ctx && ctx.source) || "Moduł Flota" });
      return { ok: true, rec: clean };
    },
    remove(state, kind, id, ctx) {
      if (!can(ctx && ctx.user, "fleet.edit")) return { ok: false, error: "Brak uprawnień" };
      const list = state.fleet[kind], rec = byId(list, id);
      if (!rec) return { ok: false, error: "Nie znaleziono" };
      if (kind === "drivers" && state.fleet.vehicles.some(v => v.driverId === id)) return { ok: false, error: "Kierowca jest domyślny dla pojazdu — najpierw zmień przypisanie" };
      if (kind === "operators" && state.fleet.chippers.some(c => c.operatorId === id)) return { ok: false, error: "Operator jest domyślny dla rębaka — najpierw zmień przypisanie" };
      if (kind === "vehicles" || kind === "chippers") return { ok: false, error: "Pojazdów i rębaków nie usuwa się — ustaw status „Wycofany” (historia kursów zostaje)" };
      state.fleet[kind] = list.filter(x => x.id !== id); state.rev += 1;
      audit(state, ctx, { entity: "fleet", entityId: id, opNo: rec.name, action: `Usunięcie: ${this.KINDS[kind].label}`, before: rec, after: null, source: (ctx && ctx.source) || "Moduł Flota" });
      return { ok: true };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Raporty okresowe                                                    */
  /* ------------------------------------------------------------------ */
  const Reports = {
    summary(state, whId, period) {
      const inP = d => d.startsWith(period);
      const ops = state.operations.filter(o => (!whId || o.whId === whId) && inP(o.date));
      const posted = ops.filter(o => o.status === "posted");
      const sum = k => round(posted.reduce((a, o) => a + (o.totals[k] || 0), 0), 2);
      const byProduct = new Map();
      for (const l of state.ledger) {
        if ((whId && l.whId !== whId) || !inP(l.date)) continue;
        const r = byProduct.get(l.productId) || { productId: l.productId, inQty: 0, outQty: 0, net: 0 };
        if (l.qty > 0) r.inQty = round(r.inQty + l.qty, 3); else r.outQty = round(r.outQty - l.qty, 3);
        r.net = round(r.net + l.qty, 3);
        byProduct.set(l.productId, r);
      }
      return {
        period, count: ops.length, storno: ops.length - posted.length,
        purchaseCost: sum("purchaseCost"), rawCost: sum("rawCost"), chippingCost: sum("chippingCost"),
        revenue: sum("revenue"), transportCost: sum("transportCost"), result: sum("result"),
        byType: Object.keys(OP_TYPES).map(t => ({ type: t, count: posted.filter(o => o.type === t).length })),
        byProduct: [...byProduct.values()]
      };
    }
  };

  const RIW = {
    VERSION, SCHEMA, EPS, NumParse, round, fmt, fmtQ, money, Dates, Units, ROLES, can, OP_TYPES, KINDS, DOC_LABEL, BASIS,
    PROD_TYPES, DIFF_REASONS, TRANSPORT_MODES, VEHICLE_TYPES, ASSET_STATUS, INV_STATUS, uid, clone, byId,
    emptyState, validateStateShape, Stock, lockedMonth, isLocked, blankDraft, planOperation, commitOperation,
    stornoOperation, openingBalance, Inventory, Fleet, Reports
  };
  root.RIW = RIW;
  if (typeof module !== "undefined" && module.exports) module.exports = RIW;
})(typeof globalThis !== "undefined" ? globalThis : this);
