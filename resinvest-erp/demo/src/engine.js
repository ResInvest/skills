/* =========================================================================
   ResInvest ERP — demonstrator 1.4.0
   Warstwa E: silnik domenowy (bez DOM — uruchamiany także w Node do testów)

   Zasady:
   * jednostka bazowa księgi = MP; drewno prezentujemy w m³, tony są pochodną
     (MP × przelicznik) albo wagą rzeczywistą, która NIE zmienia ilości,
   * operacja to agregat: zakup → zużycie → produkcja → sprzedaż (+ transport),
     księgowana atomowo w stałej kolejności,
   * transport nie tworzy zapisów w księdze — tylko koszt i dokument TR,
   * każda zmiana stanu ma źródło (dokument) i wpis audytu ze stanem przed/po.
   ========================================================================= */
(function (root) {
  "use strict";

  const VERSION = "1.4.0-demo";
  const SCHEMA = 1;
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
     * oraz jednostki na końcu (m³, MP, t, zł, zł/m³, km).
     * Zwraca {ok, value, empty, error}.
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
        if (dec === thou) return { ok: false, value: NaN, error: "Niepoprawny separator" };
      }
      if (thou && intPart.includes(thou)) {
        const groups = intPart.split(thou);
        const okGroups = groups[0].length >= 1 && groups[0].length <= 3 && groups.slice(1).every(g => g.length === 3);
        if (!okGroups) return { ok: false, value: NaN, error: "Niepoprawne grupowanie tysięcy" };
        intPart = groups.join("");
      }
      const other = dec === "," ? "." : ",";
      if (dec && intPart.includes(other) && !thou) return { ok: false, value: NaN, error: "Niepoprawny separator" };
      if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return { ok: false, value: NaN, error: "To nie jest liczba" };
      const v = sign * Number((intPart || "0") + (frac ? "." + frac : ""));
      if (!Number.isFinite(v)) return { ok: false, value: NaN, error: "To nie jest liczba" };
      return { ok: true, value: v };
    },
    /** Wartość albo `def`, gdy tekstu nie da się odczytać. */
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
    const fixed = Math.abs(r).toFixed(dec);
    const [i, f] = fixed.split(".");
    const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
    return (r < 0 ? "-" : "") + grouped + (f ? "," + f : "");
  }
  /** Ilość bez zbędnych zer: 80 → „80”, 26,4 → „26,4”. */
  function fmtQ(n, maxDec = 3) {
    const r = round(n, maxDec);
    let s = fmt(r, maxDec);
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
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return `${ym}-${String(last).padStart(2, "0")}`;
    },
    monthStart(ym) { return ym + "-01"; },
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
  /* Jednostki                                                           */
  /* ------------------------------------------------------------------ */
  const Units = {
    LIST: ["m3", "MP", "t"],
    label(u) { return u === "m3" ? "m³" : u; },
    toMP(qty, unit, cfg) {
      const q = Number(qty);
      switch (unit) {
        case "m3": return round(q * cfg.m3_mp, 3);
        case "MP": return round(q, 3);
        case "t": return cfg.mp_t ? round(q / cfg.mp_t, 3) : 0;
        default: throw new Error("Nieznana jednostka: " + unit);
      }
    },
    fromMP(mp, unit, cfg) {
      const m = Number(mp);
      switch (unit) {
        case "m3": return cfg.m3_mp ? round(m / cfg.m3_mp, 3) : 0;
        case "MP": return round(m, 3);
        case "t": return round(m * cfg.mp_t, 3);
        default: throw new Error("Nieznana jednostka: " + unit);
      }
    },
    weightT(mp, cfg) { return round(Number(mp) * cfg.mp_t, 3); }
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

  const KINDS = {
    BO: { doc: "BO", label: "Bilans otwarcia", sign: +1 },
    ZAKUP: { doc: "PZ", label: "Zakup — przyjęcie", sign: +1 },
    ZUZYCIE: { doc: "RW", label: "Zużycie produkcyjne", sign: -1 },
    PRODUKCJA: { doc: "PW", label: "Przyjęcie z produkcji", sign: +1 },
    SPRZEDAZ: { doc: "WZ", label: "Sprzedaż — wydanie", sign: -1 },
    KOREKTA: { doc: "KO", label: "Korekta (storno)", sign: 0 },
    INW: { doc: "IN", label: "Różnica inwentaryzacyjna", sign: 0 }
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
    const rnd = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${Date.now().toString(36)}${uidSeq.toString(36)}${rnd}`;
  }
  const clone = o => JSON.parse(JSON.stringify(o));
  const byId = (list, id) => (list || []).find(x => x.id === id) || null;
  const str = v => String(v == null ? "" : v).trim();

  /* ------------------------------------------------------------------ */
  /* Stan (pusty szkielet)                                               */
  /* ------------------------------------------------------------------ */
  function emptyState(config) {
    return {
      schema: SCHEMA, version: VERSION, rev: 0,
      config: Object.assign({ m3_mp: 4, mp_t: 0.33, currency: "zł", kmRateDefault: 5, wagonMPDefault: 120, maxWagons: 60 }, config || {}),
      warehouses: [], users: [], products: [], partners: [],
      fleet: { vehicles: [], drivers: [], chippers: [], operators: [] },
      carriers: [], operations: [], ledger: [], inventory: [], audit: [], seq: {},
      meta: { lastMonthCheck: null, createdAt: null }
    };
  }

  /** Kontrola struktury wczytanej kopii — zanim trafi do pamięci aplikacji. */
  function validateStateShape(s) {
    const e = [];
    if (!s || typeof s !== "object") return ["Brak danych"];
    if (s.schema !== SCHEMA) e.push(`Nieobsługiwana wersja schematu: ${s.schema}`);
    for (const k of ["warehouses", "users", "products", "partners", "operations", "ledger", "inventory", "audit"]) {
      if (!Array.isArray(s[k])) e.push(`Brak kolekcji „${k}”`);
    }
    if (!s.fleet || !["vehicles", "drivers", "chippers", "operators"].every(k => Array.isArray(s.fleet[k]))) e.push("Brak kartotek floty");
    if (!s.config || !(s.config.m3_mp > 0) || !(s.config.mp_t > 0)) e.push("Brak przeliczników");
    if (Array.isArray(s.ledger)) {
      for (const l of s.ledger) {
        if (!Number.isFinite(l.mp) || !l.productId || !l.whId || !Dates.isISO(l.date)) { e.push("Uszkodzony zapis księgi: " + (l.id || "?")); break; }
      }
    }
    return e;
  }

  /* ------------------------------------------------------------------ */
  /* Stany (z księgi)                                                    */
  /* ------------------------------------------------------------------ */
  const Stock = {
    /** Saldo MP produktu w magazynie; `to` — data graniczna włącznie. */
    balance(state, whId, productId, to) {
      let n = 0;
      for (const l of state.ledger) {
        if (l.whId !== whId || l.productId !== productId) continue;
        if (to && l.date > to) continue;
        n += l.mp;
      }
      return round(n, 3);
    },
    /** Mapa productId → MP dla magazynu. */
    byProduct(state, whId, to) {
      const m = new Map();
      for (const l of state.ledger) {
        if (whId && l.whId !== whId) continue;
        if (to && l.date > to) continue;
        m.set(l.productId, round((m.get(l.productId) || 0) + l.mp, 3));
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
      return rows.map(r => { bal = round(bal + r.mp, 3); return Object.assign({}, r, { balance: bal }); });
    }
  };

  /* ------------------------------------------------------------------ */
  /* Okresy inwentaryzacyjne — blokada                                   */
  /* ------------------------------------------------------------------ */
  function lockedMonth(state, whId) {
    let ym = null;
    for (const p of state.inventory) if (p.whId === whId && p.status === "ZAMKNIETA" && (!ym || p.ym > ym)) ym = p.ym;
    return ym;
  }
  function isLocked(state, whId, date) {
    const ym = lockedMonth(state, whId);
    return !!ym && Dates.ym(date) <= ym;
  }

  /* ------------------------------------------------------------------ */
  /* Nowa operacja — plan (walidacja + skutki), bez zapisu               */
  /* ------------------------------------------------------------------ */
  function blankDraft(ctx) {
    return {
      idemKey: uid("idem"),
      date: ctx && ctx.today ? ctx.today : Dates.localToday(),
      purchase: { supplierId: "", basis: "KZR", productId: "", qty: "", unit: "m3", price: "", weightMode: "auto", weightManual: "" },
      production: {
        enabled: false, type: "lesna", consumeQty: "", outMP: "", diffReason: "",
        ndl: "", lesnictwo: "", kwit: "", investSite: "", sourceDoc: "", chipperId: "", operatorId: ""
      },
      sale: { enabled: false, buyerId: "", qtyMP: "", price: "", priceUnit: "MP" },
      transport: {
        mode: "none", place: "", placeTouched: false,
        own: { vehicleId: "", driverId: "", km: "", rate: "" },
        external: { company: "", reg: "", km: "", freight: "", includedInPrice: false },
        train: { trainNo: "", carrier: "", wagonCount: "", wagonMP: "", sameForAll: true, sameT: "", wagonT: [], price: "", priceUnit: "t" }
      },
      notes: ""
    };
  }

  /**
   * Wylicza pełny skutek operacji na podstawie szkicu z formularza.
   * Wynik służy zarówno do podglądu na żywo, jak i do zapisu — jedno źródło prawdy.
   */
  function planOperation(state, draft, ctx) {
    const cfg = state.config;
    const errors = {};
    const warnings = [];
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

    if (!user) err("_user", "Brak zalogowanego użytkownika");
    else if (!can(user, "op.create")) err("_user", "Twoja rola nie pozwala tworzyć operacji");

    const wh = user ? byId(state.warehouses, user.whId) : null;
    if (user && !wh) err("_wh", "Użytkownik nie ma przypisanego aktywnego magazynu");
    const whId = wh ? wh.id : null;

    // --- data ---
    const date = str(draft.date);
    if (!Dates.isISO(date)) err("date", "Podaj datę w formacie RRRR-MM-DD");
    else if (date > today) err("date", "Data operacji nie może być z przyszłości");
    else if (whId && isLocked(state, whId, date)) {
      err("date", `Okres ${lockedMonth(state, whId)} jest zamknięty inwentaryzacją — wybierz datę po zamknięciu`);
    }

    // --- zakup ---
    const P = draft.purchase || {};
    const supplier = byId(state.partners, P.supplierId);
    if (!P.supplierId) err("purchase.supplierId", "Wybierz dostawcę");
    else if (!supplier || !["supplier", "both"].includes(supplier.role) || supplier.active === false) err("purchase.supplierId", "Nieznany lub nieaktywny dostawca");
    if (!BASIS[P.basis]) err("purchase.basis", "Wybierz podstawę: Deklaracja albo KZR");
    const product = byId(state.products, P.productId);
    if (!P.productId) err("purchase.productId", "Wybierz produkt / surowiec");
    else if (!product || product.active === false) err("purchase.productId", "Nieznany produkt");
    const unit = P.unit;
    if (!Units.LIST.includes(unit)) err("purchase.unit", "Wybierz jednostkę m³, MP lub t");
    const qty = num("purchase.qty", P.qty, { gt: 0 });
    const price = num("purchase.price", P.price, { min: 0 });
    if (price === 0) warnings.push("Cena zakupu wynosi 0 zł — upewnij się, że to zamierzone.");
    const unitOk = Units.LIST.includes(unit);
    const purchaseMP = qty !== null && unitOk ? Units.toMP(qty, unit, cfg) : 0;
    const autoWeight = Units.weightT(purchaseMP, cfg);
    let weightT = autoWeight;
    if (P.weightMode === "manual") {
      const w = num("purchase.weightManual", P.weightManual, { gt: 0 });
      if (w !== null) {
        weightT = round(w, 3);
        if (autoWeight > 0 && Math.abs(weightT - autoWeight) / autoWeight > 0.25) {
          warnings.push(`Waga rzeczywista ${fmtQ(weightT)} t różni się o ponad 25% od wyliczonej ${fmtQ(autoWeight)} t — sprawdź kwit wagowy.`);
        }
      }
    } else if (P.weightMode !== "auto") err("purchase.weightMode", "Wybierz sposób ustalenia wagi");
    const purchaseCost = qty !== null && price !== null ? round(qty * price, 2) : 0;

    // --- produkcja ---
    const R = draft.production || {};
    const prodOn = !!R.enabled;
    let consumeQty = null, consumeMP = 0, outMP = 0, available = null, outProduct = null, prodType = null;
    if (prodOn) {
      if (product && product.cat !== "drewno") err("production.enabled", "Produkcja zrębki jest możliwa tylko z surowca drzewnego (drewno)");
      prodType = PROD_TYPES[R.type];
      if (!prodType) err("production.type", "Wybierz rodzaj produkcji");
      else outProduct = byId(state.products, prodType.productId);
      if (prodType && !outProduct) err("production.type", "Brak produktu wynikowego w kartotece");
      // zużycie wpisujemy w jednostce zakupu; puste = całość zakupu
      if (str(R.consumeQty) === "") consumeQty = qty;
      else consumeQty = num("production.consumeQty", R.consumeQty, { gt: 0 });
      if (consumeQty !== null && unitOk) {
        consumeMP = Units.toMP(consumeQty, unit, cfg);
        const stockMP = whId && product ? Stock.balance(state, whId, product.id) : 0;
        const availMP = round(stockMP + purchaseMP, 3);
        available = { mp: availMP, qty: Units.fromMP(availMP, unit, cfg), stockMP };
        if (consumeMP > availMP + EPS) {
          err("production.consumeQty", `Zużycie ${fmtQ(consumeQty)} ${Units.label(unit)} przekracza dostępny materiał ${fmtQ(available.qty)} ${Units.label(unit)} (stan ${fmtQ(Units.fromMP(stockMP, unit, cfg))} + zakup ${fmtQ(qty || 0)})`);
        }
      }
      if (str(R.outMP) === "") outMP = consumeMP;
      else {
        const o = num("production.outMP", R.outMP, { gt: 0 });
        outMP = o === null ? 0 : round(o, 3);
      }
      if (outMP > consumeMP + EPS && consumeMP > 0) {
        err("production.outMP", `Wynik produkcji nie może przekroczyć zużytego surowca (${fmtQ(consumeMP)} MP) — transport ani przeliczenie nie tworzą dodatkowego materiału`);
      }
      if (consumeMP > 0 && outMP > 0 && outMP < consumeMP - EPS && !DIFF_REASONS[R.diffReason]) {
        err("production.diffReason", `Wynik niższy od zużycia o ${fmtQ(consumeMP - outMP)} MP — wskaż przyczynę`);
      }
      if (R.type === "lesna") {
        if (!str(R.ndl)) err("production.ndl", "Podaj nadleśnictwo");
        if (!str(R.lesnictwo)) err("production.lesnictwo", "Podaj leśnictwo");
        if (!str(R.kwit)) err("production.kwit", "Podaj numer kwitu wywozowego");
      } else if (R.type === "inwestycyjna") {
        if (!str(R.investSite)) err("production.investSite", "Podaj miejsce wycinki / inwestycję");
      }
      if (R.chipperId) {
        const ch = byId(state.fleet.chippers, R.chipperId);
        if (!ch) err("production.chipperId", "Nieznany rębak");
        else if (ch.status !== "aktywny") err("production.chipperId", `Rębak ma status „${ASSET_STATUS[ch.status] || ch.status}”`);
        const opId = R.operatorId || (ch && ch.operatorId);
        if (!byId(state.fleet.operators, opId)) err("production.operatorId", "Wybierz operatora rębaka");
      }
    }

    // --- sprzedaż ---
    const S = draft.sale || {};
    const saleOn = !!S.enabled;
    let saleMP = 0, salePrice = null, revenue = 0, buyer = null;
    if (saleOn) {
      if (!prodOn) err("sale.enabled", "Sprzedaż równoległa korzysta z wyniku produkcji — najpierw zaznacz produkcję");
      buyer = byId(state.partners, S.buyerId);
      if (!S.buyerId) err("sale.buyerId", "Odbiorca jest wymagany przy sprzedaży");
      else if (!buyer || !["buyer", "both"].includes(buyer.role) || buyer.active === false) err("sale.buyerId", "Nieznany lub nieaktywny odbiorca");
      if (str(S.qtyMP) === "") saleMP = outMP;
      else { const q = num("sale.qtyMP", S.qtyMP, { gt: 0 }); saleMP = q === null ? 0 : round(q, 3); }
      if (saleMP > outMP + EPS) err("sale.qtyMP", `Sprzedaż ${fmtQ(saleMP)} MP przekracza wynik produkcji ${fmtQ(outMP)} MP`);
      if (!["MP", "t"].includes(S.priceUnit)) err("sale.priceUnit", "Wybierz jednostkę ceny");
      salePrice = num("sale.price", S.price, { min: 0 });
      if (salePrice === 0) warnings.push("Cena sprzedaży wynosi 0 zł.");
      if (salePrice !== null) {
        const base = S.priceUnit === "t" ? Units.weightT(saleMP, cfg) : saleMP;
        revenue = round(base * salePrice, 2);
      }
    }

    // --- miejsce i transport ---
    const T = draft.transport || {};
    const place = str(T.place);
    if (!place) err("transport.place", "Podaj miejsce transportu / dostawy");
    const mode = T.mode || "none";
    const transport = { mode, place, cost: 0 };
    if (!TRANSPORT_MODES[mode]) err("transport.mode", "Nieznany tryb transportu");
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
      if (!included) { const f = num("transport.external.freight", X.freight, { min: 0 }); freight = f || 0; }
      Object.assign(transport, {
        company: str(X.company), reg: str(X.reg).toUpperCase(), km: km || 0,
        freight: included ? 0 : freight, includedInPrice: included, cost: included ? 0 : round(freight, 2)
      });
    } else if (mode === "train") {
      const Tr = T.train || {};
      const n = num("transport.train.wagonCount", Tr.wagonCount, { gt: 0, integer: true });
      if (n !== null && n > cfg.maxWagons) err("transport.train.wagonCount", `Maksymalnie ${cfg.maxWagons} wagonów w jednym składzie`);
      const wagonMP = str(Tr.wagonMP) === "" ? cfg.wagonMPDefault : num("transport.train.wagonMP", Tr.wagonMP, { gt: 0 });
      const count = n && n <= cfg.maxWagons ? n : 0;
      const tons = [];
      if (Tr.sameForAll) {
        const t = num("transport.train.sameT", Tr.sameT, { gt: 0 });
        for (let i = 0; i < count; i++) tons.push(t || 0);
      } else {
        for (let i = 0; i < count; i++) {
          const t = num(`transport.train.wagonT.${i}`, (Tr.wagonT || [])[i], { gt: 0 });
          tons.push(t || 0);
        }
      }
      const totalT = round(tons.reduce((a, b) => a + b, 0), 3);
      const cap = wagonMP ? Units.weightT(wagonMP, cfg) : 0;
      tons.forEach((t, i) => { if (cap && t > cap + EPS) warnings.push(`Wagon ${i + 1}: ${fmtQ(t)} t przekracza pojemność ${fmtQ(wagonMP)} MP ≈ ${fmtQ(cap)} t`); });
      if (!["MP", "m3", "t"].includes(Tr.priceUnit)) err("transport.train.priceUnit", "Wybierz jednostkę ceny");
      const tprice = num("transport.train.price", Tr.price, { min: 0 });
      const totalMP = cfg.mp_t ? round(totalT / cfg.mp_t, 3) : 0;
      const basisQty = Tr.priceUnit === "t" ? totalT : Tr.priceUnit === "MP" ? totalMP : round(totalMP / cfg.m3_mp, 3);
      Object.assign(transport, {
        trainNo: str(Tr.trainNo), carrier: str(Tr.carrier), wagonCount: count, wagonMP: wagonMP || 0,
        sameForAll: !!Tr.sameForAll, wagonT: tons, totalT, totalMP, price: tprice || 0,
        priceUnit: Tr.priceUnit, basisQty, cost: tprice !== null ? round(basisQty * tprice, 2) : 0
      });
      const shipped = saleOn ? Units.weightT(saleMP, cfg) : weightT;
      if (totalT > 0 && shipped > 0 && Math.abs(totalT - shipped) / shipped > 0.05) {
        warnings.push(`Tonaż składu ${fmtQ(totalT)} t różni się od wagi ładunku ${fmtQ(shipped)} t. Transport nie zmienia stanu magazynowego — stan liczony jest z ilości zakupu/sprzedaży.`);
      }
    }

    // --- księgowania (stała kolejność) ---
    const postings = [];
    if (product && purchaseMP > 0) postings.push({ kind: "ZAKUP", productId: product.id, mp: purchaseMP });
    if (prodOn && product && consumeMP > 0) postings.push({ kind: "ZUZYCIE", productId: product.id, mp: -consumeMP });
    if (prodOn && outProduct && outMP > 0) postings.push({ kind: "PRODUKCJA", productId: outProduct.id, mp: outMP });
    if (saleOn && outProduct && saleMP > 0) postings.push({ kind: "SPRZEDAZ", productId: outProduct.id, mp: -saleMP });
    postings.forEach((p, i) => { p.step = i + 1; p.doc = KINDS[p.kind].doc; });

    // --- symulacja sald: żaden krok nie może zejść poniżej zera ---
    const balances = [];
    if (whId) {
      const sim = new Map();
      const get = pid => sim.has(pid) ? sim.get(pid) : Stock.balance(state, whId, pid);
      for (const p of postings) {
        const before = get(p.productId);
        const after = round(before + p.mp, 3);
        p.before = before; p.after = after;
        if (after < -EPS) err("_stock", `Krok ${p.step} (${KINDS[p.kind].label}) daje stan ujemny: ${fmtQ(after)} MP`);
        sim.set(p.productId, after);
      }
      for (const [pid, after] of sim) {
        balances.push({ productId: pid, before: Stock.balance(state, whId, pid), after });
      }
    }

    // --- dokumenty ---
    const partyName = id => (byId(state.partners, id) || {}).name || "";
    const documents = [];
    if (postings.find(p => p.kind === "ZAKUP")) {
      documents.push({
        type: "PZ", kind: "ZAKUP", productId: product.id, qty, unit, mp: purchaseMP, weightT,
        weightMode: P.weightMode, value: purchaseCost, partnerId: P.supplierId, partner: partyName(P.supplierId),
        basis: P.basis, place, stock: "+"
      });
    }
    if (postings.find(p => p.kind === "ZUZYCIE")) {
      documents.push({ type: "RW", kind: "ZUZYCIE", productId: product.id, qty: consumeQty, unit, mp: consumeMP, weightT: Units.weightT(consumeMP, cfg), value: 0, place, stock: "−" });
    }
    if (postings.find(p => p.kind === "PRODUKCJA")) {
      const meta = R.type === "lesna"
        ? { productionType: prodType.label, ndl: str(R.ndl), lesnictwo: str(R.lesnictwo), kwit: str(R.kwit) }
        : { productionType: prodType.label, sourceType: PROD_TYPES.inwestycyjna.sourceType, investSite: str(R.investSite), sourceDoc: str(R.sourceDoc) };
      documents.push({ type: "PW", kind: "PRODUKCJA", productId: outProduct.id, qty: outMP, unit: "MP", mp: outMP, weightT: Units.weightT(outMP, cfg), value: 0, place, stock: "+", meta });
    }
    if (postings.find(p => p.kind === "SPRZEDAZ")) {
      documents.push({
        type: "WZ", kind: "SPRZEDAZ", productId: outProduct.id, qty: saleMP, unit: "MP", mp: saleMP, weightT: Units.weightT(saleMP, cfg),
        value: revenue, price: salePrice, priceUnit: S.priceUnit, partnerId: S.buyerId, partner: partyName(S.buyerId), place, stock: "−"
      });
    }
    if (mode !== "none") {
      documents.push({ type: "TR", kind: "TRANSPORT", productId: null, qty: null, unit: null, mp: 0, value: transport.cost, place, stock: "brak", transport: clone(transport) });
    }

    const totals = {
      purchaseCost, revenue, transportCost: transport.cost,
      result: round(revenue - purchaseCost - transport.cost, 2),
      purchaseMP, consumeMP, outMP, saleMP, weightT
    };

    const errorList = Object.keys(errors).map(k => ({ field: k, msg: errors[k] }));
    return {
      ok: errorList.length === 0, errors, errorList, warnings,
      whId, date, user: user ? { id: user.id, name: user.name } : null,
      norm: {
        purchase: { supplierId: P.supplierId, basis: P.basis, productId: P.productId, qty, unit, mp: purchaseMP, price, cost: purchaseCost, weightMode: P.weightMode, weightT, autoWeight },
        production: prodOn ? {
          type: R.type, typeLabel: prodType ? prodType.label : "", outProductId: outProduct ? outProduct.id : "",
          consumeQty, consumeMP, outMP, diffReason: R.diffReason || "", available,
          ndl: str(R.ndl), lesnictwo: str(R.lesnictwo), kwit: str(R.kwit),
          sourceType: R.type === "inwestycyjna" ? PROD_TYPES.inwestycyjna.sourceType : "",
          investSite: str(R.investSite), sourceDoc: str(R.sourceDoc),
          chipperId: R.chipperId || "", operatorId: R.chipperId ? (R.operatorId || ((byId(state.fleet.chippers, R.chipperId) || {}).operatorId || "")) : ""
        } : null,
        sale: saleOn ? { buyerId: S.buyerId, qtyMP: saleMP, price: salePrice, priceUnit: S.priceUnit, revenue, weightT: Units.weightT(saleMP, cfg) } : null,
        transport
      },
      postings, balances, documents, totals
    };
  }

  /* ------------------------------------------------------------------ */
  /* Numeracja dokumentów {TYP}/{NR}/{MM}/{RRRR}                         */
  /* ------------------------------------------------------------------ */
  function nextNo(state, type, date) {
    const ym = Dates.ym(date);
    const key = `${type}-${ym}`;
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

  function stockSnapshot(state, whId, productIds) {
    const o = {};
    for (const pid of productIds) o[pid] = Stock.balance(state, whId, pid);
    return o;
  }

  /* ------------------------------------------------------------------ */
  /* Zapis operacji — atomowo (całość albo nic)                          */
  /* ------------------------------------------------------------------ */
  function commitOperation(state, draft, ctx) {
    if (!draft || !draft.idemKey) return { ok: false, error: "Brak klucza idempotencji formularza" };
    const dup = state.operations.find(o => o.idemKey === draft.idemKey);
    if (dup) return { ok: true, duplicate: true, op: dup };

    const plan = planOperation(state, draft, ctx);
    if (!plan.ok) return { ok: false, plan, error: plan.errorList[0].msg };

    const productIds = [...new Set(plan.postings.map(p => p.productId))];
    const before = stockSnapshot(state, plan.whId, productIds);
    const opId = uid("op");
    const docs = plan.documents.map(d => Object.assign({}, d, { no: nextNo(state, d.type, plan.date) }));
    const docNo = t => (docs.find(d => d.type === t) || {}).no || null;
    let seq = nextLedgerSeq(state);
    const ledger = plan.postings.map(p => ({
      id: uid("l"), seq: seq++, opId, step: p.step, date: plan.date, whId: plan.whId,
      productId: p.productId, kind: p.kind, mp: p.mp, t: Units.weightT(p.mp, state.config), docNo: docNo(p.doc)
    }));
    const op = {
      id: opId, idemKey: draft.idemKey, no: docs.length ? docs[0].no : null,
      date: plan.date, whId: plan.whId, status: "posted",
      userId: ctx.user.id, userName: ctx.user.name,
      createdAt: (ctx && ctx.now) || new Date().toISOString(),
      scope: ["ZAKUP"].concat(plan.norm.production ? ["PRODUKCJA"] : []).concat(plan.norm.sale ? ["SPRZEDAZ"] : []),
      purchase: plan.norm.purchase, production: plan.norm.production, sale: plan.norm.sale,
      transport: plan.norm.transport, place: plan.norm.transport.place,
      documents: docs, ledgerIds: ledger.map(l => l.id), totals: plan.totals,
      notes: str(draft.notes), warnings: plan.warnings
    };
    state.operations.push(op);
    state.ledger.push(...ledger);
    state.rev += 1;
    audit(state, ctx, {
      entity: "operation", entityId: op.id, opNo: op.no, action: "Utworzenie operacji",
      before: { stanMP: before },
      after: { stanMP: stockSnapshot(state, plan.whId, productIds), dokumenty: docs.map(d => d.no), koszt_transportu: op.transport.cost },
      source: (ctx && ctx.source) || "Formularz „Nowa operacja”"
    });
    return { ok: true, op, plan };
  }

  /** Storno: nowe zapisy z bieżącą datą w odwrotnej kolejności. Historia zostaje nietknięta. */
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
      const after = round(get(l.productId) - l.mp, 3);
      if (after < -EPS) {
        const p = byId(state.products, l.productId);
        return { ok: false, error: `Korekta niemożliwa: stan „${p ? p.name : l.productId}” spadłby do ${fmtQ(after)} MP (materiał został już rozchodowany)` };
      }
      sim.set(l.productId, after);
    }
    const productIds = [...new Set(src.map(l => l.productId))];
    const before = stockSnapshot(state, op.whId, productIds);
    const no = nextNo(state, "KO", today);
    let seq = nextLedgerSeq(state);
    const entries = src.map((l, i) => ({
      id: uid("l"), seq: seq++, opId: op.id, step: 100 + i, date: today, whId: op.whId, productId: l.productId,
      kind: "KOREKTA", mp: -l.mp, t: -l.t, docNo: no, refDoc: l.docNo
    }));
    state.ledger.push(...entries);
    op.status = "storno";
    op.storno = { no, date: today, reason: str(reason), userId: user.id, userName: user.name };
    state.rev += 1;
    audit(state, ctx, {
      entity: "operation", entityId: op.id, opNo: op.no, action: "Korekta (storno)",
      before: { status: "posted", stanMP: before }, after: { status: "storno", dokument: no, przyczyna: str(reason), stanMP: stockSnapshot(state, op.whId, productIds) },
      source: (ctx && ctx.source) || "Plan dokumentów — korekta"
    });
    return { ok: true, no };
  }

  /** Bilans otwarcia (tylko dane przykładowe / migracja). */
  function openingBalance(state, whId, date, lines, ctx) {
    const no = nextNo(state, "BO", date);
    let seq = nextLedgerSeq(state);
    for (const ln of lines) {
      const p = byId(state.products, ln.productId);
      const mp = Units.toMP(ln.qty, p.unit, state.config);
      state.ledger.push({ id: uid("l"), seq: seq++, opId: null, step: 1, date, whId, productId: p.id, kind: "BO", mp, t: Units.weightT(mp, state.config), docNo: no });
    }
    state.rev += 1;
    audit(state, ctx, { entity: "ledger", entityId: no, opNo: no, action: "Bilans otwarcia", before: null, after: { magazyn: whId, pozycje: lines.length }, source: (ctx && ctx.source) || "Migracja" });
    return no;
  }

  /* ------------------------------------------------------------------ */
  /* Inwentaryzacja miesięczna                                           */
  /* ------------------------------------------------------------------ */
  const Inventory = {
    find(state, whId, ym) { return state.inventory.find(p => p.whId === whId && p.ym === ym) || null; },
    cutoff(ym, today) { const end = Dates.monthEnd(ym); return end < today ? end : today; },

    open(state, ym, ctx) {
      const user = ctx && ctx.user;
      const today = (ctx && ctx.today) || Dates.localToday();
      if (!can(user, "inv.open")) return { ok: false, error: "Twoja rola nie pozwala otwierać okresów" };
      if (!Dates.isYM(ym)) return { ok: false, error: "Podaj miesiąc w formacie RRRR-MM" };
      if (ym > Dates.ym(today)) return { ok: false, error: "Nie można otworzyć okresu z przyszłości" };
      if (this.find(state, user.whId, ym)) return { ok: false, error: `Okres ${ym} już istnieje` };
      const locked = lockedMonth(state, user.whId);
      if (locked && ym <= locked) return { ok: false, error: `Miesiące do ${locked} włącznie są już zamknięte` };
      const p = { id: uid("inv"), whId: user.whId, ym, status: "OTWARTA", openedAt: (ctx && ctx.now) || new Date().toISOString(), openedBy: user.name, generatedAt: null, closedAt: null, closedBy: null, auto: false, docNo: null, lines: [] };
      state.inventory.push(p);
      state.rev += 1;
      audit(state, ctx, { entity: "inventory", entityId: p.id, opNo: ym, action: "Otwarcie okresu inwentaryzacji", before: null, after: { okres: ym, status: "OTWARTA" }, source: (ctx && ctx.source) || "Moduł Inwentaryzacja" });
      return { ok: true, period: p };
    },

    generate(state, ym, ctx) {
      const user = ctx && ctx.user;
      const today = (ctx && ctx.today) || Dates.localToday();
      if (!can(user, "inv.count")) return { ok: false, error: "Brak uprawnień" };
      const p = this.find(state, user.whId, ym);
      if (!p) return { ok: false, error: "Najpierw otwórz okres" };
      if (p.status !== "OTWARTA") return { ok: false, error: "Okres jest zamknięty — tylko do odczytu" };
      const cut = this.cutoff(ym, today);
      const book = Stock.byProduct(state, user.whId, cut);
      const prev = new Map(p.lines.map(l => [l.productId, l]));
      const lines = [];
      for (const pr of state.products) {
        const mp = book.get(pr.id) || 0;
        const old = prev.get(pr.id);
        if (Math.abs(mp) < EPS && !old) continue;
        lines.push({ productId: pr.id, unit: pr.unit, bookMP: round(mp, 3), countMP: old ? old.countMP : null, countText: old ? old.countText : "" });
      }
      const before = { pozycje: p.lines.length };
      p.lines = lines; p.generatedAt = (ctx && ctx.now) || new Date().toISOString(); p.cutoff = cut;
      state.rev += 1;
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
      const before = { spis: line.countMP };
      if (str(text) === "") { line.countMP = null; line.countText = ""; }
      else {
        const r = NumParse.parse(text);
        if (!r.ok) return { ok: false, error: r.error };
        if (r.value < 0) return { ok: false, error: "Stan ze spisu nie może być ujemny" };
        line.countMP = Units.toMP(r.value, line.unit, state.config);
        line.countText = str(text);
      }
      state.rev += 1;
      audit(state, ctx, { entity: "inventory", entityId: p.id, opNo: ym, action: "Wpis stanu ze spisu", before, after: { produkt: productId, spis: line.countMP }, source: (ctx && ctx.source) || "Moduł Inwentaryzacja" });
      return { ok: true, line };
    },

    /** Zamknięcie: przeliczenie stanu księgowego na dzień odcięcia, dokument IN z różnicami, blokada okresu. */
    close(state, ym, ctx, opts = {}) {
      const user = ctx && ctx.user;
      const today = (ctx && ctx.today) || Dates.localToday();
      const whId = opts.whId || (user && user.whId);
      if (!opts.auto && !can(user, "inv.close")) return { ok: false, error: "Zamknięcie okresu wymaga roli Kierownik lub Administrator" };
      const p = this.find(state, whId, ym);
      if (!p) return { ok: false, error: "Brak okresu" };
      if (p.status !== "OTWARTA") return { ok: false, error: "Okres jest już zamknięty" };
      if (!p.lines.length && !opts.auto) return { ok: false, error: "Wygeneruj listę spisową przed zamknięciem" };
      const missing = p.lines.filter(l => l.countMP === null);
      if (missing.length && !opts.auto) return { ok: false, error: `Brak stanu ze spisu dla ${missing.length} pozycji` };
      const cut = this.cutoff(ym, today);
      const book = Stock.byProduct(state, whId, cut);
      const diffs = [];
      for (const l of p.lines) {
        l.bookMP = round(book.get(l.productId) || 0, 3);
        if (l.countMP === null) { l.countMP = l.bookMP; l.assumed = true; }
        const d = round(l.countMP - l.bookMP, 3);
        l.diffMP = d;
        if (Math.abs(d) > EPS) diffs.push({ productId: l.productId, mp: d });
      }
      for (const d of diffs) {
        const nowBal = Stock.balance(state, whId, d.productId);
        if (nowBal + d.mp < -EPS) {
          return { ok: false, error: `Różnica dla „${(byId(state.products, d.productId) || {}).name}” dałaby dziś stan ujemny — sprawdź operacje po ${cut}` };
        }
      }
      let docNo = null;
      if (diffs.length) {
        docNo = nextNo(state, "IN", cut);
        let seq = nextLedgerSeq(state);
        for (const d of diffs) {
          state.ledger.push({ id: uid("l"), seq: seq++, opId: null, invId: p.id, step: 1, date: cut, whId, productId: d.productId, kind: "INW", mp: d.mp, t: Units.weightT(d.mp, state.config), docNo });
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

    /** Uruchamiane przy starcie: pierwszy start w nowym miesiącu zamyka otwarte okresy wcześniejszych miesięcy. */
    autoClose(state, ctx) {
      const today = (ctx && ctx.today) || Dates.localToday();
      const cur = Dates.ym(today);
      const done = [];
      if (state.meta.lastMonthCheck === cur) return done;
      for (const p of state.inventory.filter(x => x.status === "OTWARTA" && x.ym < cur).sort((a, b) => a.ym < b.ym ? -1 : 1)) {
        const r = this.close(state, p.ym, Object.assign({}, ctx, { user: null }), { auto: true, whId: p.whId });
        done.push({ ym: p.ym, whId: p.whId, ok: r.ok, error: r.error || null, docNo: r.docNo || null });
      }
      state.meta.lastMonthCheck = cur;
      state.rev += 1;
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
      const e = {};
      const list = state.fleet[kind];
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
      const list = state.fleet[kind];
      const rec = byId(list, id);
      if (!rec) return { ok: false, error: "Nie znaleziono" };
      if (kind === "drivers" && state.fleet.vehicles.some(v => v.driverId === id)) return { ok: false, error: "Kierowca jest domyślny dla pojazdu — najpierw zmień przypisanie" };
      if (kind === "operators" && state.fleet.chippers.some(c => c.operatorId === id)) return { ok: false, error: "Operator jest domyślny dla rębaka — najpierw zmień przypisanie" };
      if (kind === "vehicles" || kind === "chippers") return { ok: false, error: "Pojazdów i rębaków nie usuwa się — ustaw status „Wycofany” (historia kursów zostaje)" };
      state.fleet[kind] = list.filter(x => x.id !== id);
      state.rev += 1;
      audit(state, ctx, { entity: "fleet", entityId: id, opNo: rec.name, action: `Usunięcie: ${this.KINDS[kind].label}`, before: rec, after: null, source: (ctx && ctx.source) || "Moduł Flota" });
      return { ok: true };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Raporty okresowe                                                    */
  /* ------------------------------------------------------------------ */
  const Reports = {
    /** period: "RRRR" albo "RRRR-MM" */
    summary(state, whId, period) {
      const inP = d => d.startsWith(period);
      const ops = state.operations.filter(o => (!whId || o.whId === whId) && inP(o.date));
      const posted = ops.filter(o => o.status === "posted");
      const byProduct = new Map();
      for (const l of state.ledger) {
        if ((whId && l.whId !== whId) || !inP(l.date)) continue;
        const r = byProduct.get(l.productId) || { productId: l.productId, inMP: 0, outMP: 0, net: 0 };
        if (l.mp > 0) r.inMP = round(r.inMP + l.mp, 3); else r.outMP = round(r.outMP - l.mp, 3);
        r.net = round(r.net + l.mp, 3);
        byProduct.set(l.productId, r);
      }
      return {
        period, count: ops.length, storno: ops.length - posted.length,
        purchaseCost: round(posted.reduce((a, o) => a + (o.totals.purchaseCost || 0), 0), 2),
        revenue: round(posted.reduce((a, o) => a + (o.totals.revenue || 0), 0), 2),
        transportCost: round(posted.reduce((a, o) => a + (o.totals.transportCost || 0), 0), 2),
        result: round(posted.reduce((a, o) => a + (o.totals.result || 0), 0), 2),
        byProduct: [...byProduct.values()]
      };
    }
  };

  const RIW = {
    VERSION, SCHEMA, EPS, NumParse, round, fmt, fmtQ, money, Dates, Units, ROLES, can, KINDS, DOC_LABEL, BASIS,
    PROD_TYPES, DIFF_REASONS, TRANSPORT_MODES, VEHICLE_TYPES, ASSET_STATUS, INV_STATUS, uid, clone, byId,
    emptyState, validateStateShape, Stock, lockedMonth, isLocked, blankDraft, planOperation, commitOperation,
    stornoOperation, openingBalance, Inventory, Fleet, Reports
  };
  root.RIW = RIW;
  if (typeof module !== "undefined" && module.exports) module.exports = RIW;
})(typeof globalThis !== "undefined" ? globalThis : this);
