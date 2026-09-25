/* =========================================================================
   ResInvest ERP 3.0 (FAZA 2)
   Warstwa E: silnik domenowy (bez DOM — uruchamiany w przeglądarce, na serwerze i w testach)

   Zasady:
   * księga w JEDNOSTCE MAGAZYNOWEJ PRODUKTU (drewno m³, zrębka MP, PKS/łupina t),
     precyzja wewnętrzna 6 miejsc — zaokrąglenie dopiero przy prezentacji,
   * masa (t) i energia (GJ) są orientacyjne; waga rzeczywista ich nie zastępuje,
   * operacje: ZAKUP · SPRZEDAZ (WZ / bezpośrednia) · PRODUKCJA (na magazyn) · MM,
   * każda operacja: pełna walidacja → symulacja sald → zapis atomowy,
   * dokument zatwierdzony nigdy nie jest usuwany ani zmieniany po cichu:
     anulowanie i korekta tworzą nowe zapisy księgi z powiązaniem i audytem,
   * transport nie tworzy zapisów w księdze — tylko koszt i karta TR,
   * komunikaty przechodzą przez t() (i18n.js); teksty zapisywane w danych są
     kanoniczne (PL) i tłumaczone przy wyświetlaniu.
   ========================================================================= */
(function (root) {
  "use strict";

  const I18N = root.RIW_I18N || (typeof require === "function" ? require("./i18n.js") : null);
  const t = (s, p) => I18N.t(s, p);
  const tp = (s, n, p) => I18N.tp(s, n, p);
  const N_ = s => s;
  /** Tekst do zapisania w danych: struktura {k, p} (tłumaczona przy wyświetlaniu). */
  const Lx = (k, p) => ({ k, p: p || {} });

  const VERSION = "3.2.0";
  const SCHEMA = 6;
  const Q = 6;                 // precyzja wewnętrzna ilości
  const EPS = 1e-6;

  /* ------------------------------------------------------------------ */
  /* Liczby                                                              */
  /* ------------------------------------------------------------------ */
  const SPACES = /[\s\u00A0\u2007\u2009\u202F']/g;
  const UNIT_SUFFIX = /(?:zł|zl|pln|m³|m3|mp|km|kg|gj|t|\/)+$/i;

  const NumParse = {
    /** Tekst wpisany / wklejony → liczba. 1000 · 1000,5 · 1 000,5 · 1.000,5 · 12.50 · NBSP · jednostki na końcu. */
    parse(input) {
      if (typeof input === "number") {
        return Number.isFinite(input) ? { ok: true, value: input } : { ok: false, value: NaN, error: t("Niepoprawna liczba") };
      }
      let s = String(input == null ? "" : input).trim();
      if (!s) return { ok: false, value: NaN, empty: true, error: t("Pole jest puste") };
      s = s.replace(SPACES, "").replace(/\u2212/g, "-");
      let guard = 0;
      while (UNIT_SUFFIX.test(s) && guard++ < 4) s = s.replace(UNIT_SUFFIX, "");
      if (!/^[+-]?[\d.,]*\d[\d.,]*$/.test(s) && !/^[+-]?[.,]\d+$/.test(s)) return { ok: false, value: NaN, error: t("To nie jest liczba") };
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
        if (frac.includes(",") || frac.includes(".")) return { ok: false, value: NaN, error: t("Niepoprawny separator") };
      }
      if (thou && intPart.includes(thou)) {
        const g = intPart.split(thou);
        if (!(g[0].length >= 1 && g[0].length <= 3 && g.slice(1).every(x => x.length === 3))) return { ok: false, value: NaN, error: t("Niepoprawne grupowanie tysięcy") };
        intPart = g.join("");
      }
      if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return { ok: false, value: NaN, error: t("To nie jest liczba") };
      const v = sign * Number((intPart || "0") + (frac ? "." + frac : ""));
      if (!Number.isFinite(v)) return { ok: false, value: NaN, error: t("To nie jest liczba") };
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
  const rq = n => round(n, Q);
  function fmt(n, dec = 2) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    const r = round(x, dec);
    const [i, f] = Math.abs(r).toFixed(dec).split(".");
    return (r < 0 ? "-" : "") + I18N.num(i, f);
  }
  /** Ilość bez zbędnych zer po przecinku (separator zależny od języka). */
  function fmtQ(n, maxDec = 3) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    const r = round(x, maxDec);
    const [i, f] = Math.abs(r).toFixed(maxDec).split(".");
    const s = (r < 0 ? "-" : "") + I18N.num(i, (f || "").replace(/0+$/, ""));
    return s === "-0" ? "0" : s;
  }
  function money(n, cur = "zł") { return fmt(n, 2) + "\u00A0" + cur; }

  /* ------------------------------------------------------------------ */
  /* Daty                                                                */
  /* ------------------------------------------------------------------ */
  const Dates = {
    isISO(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) && !Number.isNaN(Date.parse(d + "T00:00:00Z")); },
    isYM(ym) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || "")); },
    ym(d) { return String(d).slice(0, 7); },
    monthStart(ym) { return ym + "-01"; },
    monthEnd(ym) {
      const [y, m] = ym.split("-").map(Number);
      return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    },
    addDays(d, n) { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); },
    weekStart(d) { const t = new Date(d + "T00:00:00Z"); const wd = (t.getUTCDay() + 6) % 7; return this.addDays(d, -wd); },
    localToday() {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
    /** Data do wyświetlenia (dd.mm.rrrr; w języku angielskim dd/mm/rrrr). */
    pl(d) { return d ? I18N.date(d) : ""; },
    /** Znacznik czasu ISO → data w formacie języka + godzina (hh:mm lub hh:mm:ss). */
    ts(iso, sec) { const v = String(iso || ""); return v ? `${I18N.date(v.slice(0, 10))} ${v.slice(11, sec ? 19 : 16)}`.trim() : ""; },
    MONTHS: [N_("styczeń"), N_("luty"), N_("marzec"), N_("kwiecień"), N_("maj"), N_("czerwiec"), N_("lipiec"), N_("sierpień"), N_("wrzesień"), N_("październik"), N_("listopad"), N_("grudzień")],
    MONTHS_SHORT: [N_("sty"), N_("lut"), N_("mar"), N_("kwi"), N_("maj."), N_("cze"), N_("lip"), N_("sie"), N_("wrz"), N_("paź"), N_("lis"), N_("gru")],
    label(ym) {
      const [y, m] = ym.split("-").map(Number);
      return `${t(this.MONTHS[m - 1])} ${y}`;
    },
    short(ym) { const [y, m] = ym.split("-").map(Number); return `${t(this.MONTHS_SHORT[m - 1])} ${String(y).slice(2)}`; },
    addMonths(ym, n) { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); },
    /** Zakres raportu: dzień / tydzień (pon–niedz) / miesiąc / rok / zakres własny. */
    range(spec, today) {
      const td = today || this.localToday();
      if (spec.mode === "day") { const d = spec.date || td; return { mode: "day", from: d, to: d, label: t("dzień {d}", { d: this.pl(d) }) }; }
      if (spec.mode === "week") { const s = this.weekStart(spec.date || td); const e = this.addDays(s, 6); return { mode: "week", from: s, to: e, label: t("tydzień {a} – {b}", { a: this.pl(s), b: this.pl(e) }) }; }
      if (spec.mode === "custom") {
        const from = spec.from || td, to = spec.to || td;
        return { mode: "custom", from: from <= to ? from : to, to: from <= to ? to : from, label: `${this.pl(from)} – ${this.pl(to)}` };
      }
      if (spec.mode === "year") { const y = String(spec.year || td.slice(0, 4)); return { mode: "year", year: y, from: `${y}-01-01`, to: `${y}-12-31`, label: t("ROK {y}", { y }) }; }
      const ym = spec.ym || this.ym(td);
      return { mode: "month", ym, from: this.monthStart(ym), to: this.monthEnd(ym), label: this.label(ym).toUpperCase() };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Jednostki, przeliczniki (centralnie)                                */
  /*   1 m³ = 4 MP · 1 MP = 0,25 m³ · 1 MP = 0,33 t · 1 t = 8,5 GJ       */
  /* ------------------------------------------------------------------ */
  const Units = {
    LIST: ["m3", "MP", "t"],
    label(u) { return u === "m3" ? "m³" : u; },
    massPerUnit(p, cfg) {
      if (!p) return 0;
      if (p.unit === "t") return 1;
      if (p.unit === "MP") return cfg.mp_t;
      return p.tPerUnit || cfg.woodTPerM3;
    },
    allowed(p) {
      if (!p) return [];
      if (p.unit === "t") return ["t"];
      if (p.unit === "MP") return ["MP", "t"];
      return ["m3", "MP", "t"];
    },
    convert(q, from, to, p, cfg) {
      const x = Number(q);
      if (from === to) return rq(x);
      const ok = this.allowed(p);
      if (!ok.includes(from) || !ok.includes(to)) throw new Error(t("Brak przelicznika {a} → {b} dla „{p}”", { a: this.label(from), b: this.label(to), p: p ? p.name : "?" }));
      const m = this.massPerUnit(p, cfg);
      const toBase = u => { if (u === p.unit) return x; if (u === "t") return x / m; if (p.unit === "m3" && u === "MP") return x / cfg.m3_mp; throw new Error(t("Brak przelicznika")); };
      const b = toBase(from);
      if (to === p.unit) return rq(b);
      if (to === "t") return rq(b * m);
      if (p.unit === "m3" && to === "MP") return rq(b * cfg.m3_mp);
      throw new Error(t("Brak przelicznika"));
    },
    mass(q, p, cfg) { return rq(Number(q) * this.massPerUnit(p, cfg)); },
    energy(t, cfg) { return rq(Number(t) * cfg.t_gj); },
    /** Orientacyjna masa i energia; dla produktu tonowego masa = ilość (bez przeliczeń na MP/m³). */
    orient(q, p, cfg) { const t = this.mass(q, p, cfg); return { t, gj: this.energy(t, cfg) }; },
    /**
     * Przelicznik produkcji: ile jednostek produktu powstaje z 1 jednostki surowca.
     * Obecnie jedyny zdefiniowany: drewno (m³) → zrębka (MP), 1 m³ = 4 MP.
     */
    prodFactor(raw, out, cfg) {
      if (!raw || !out) return { error: t("Wybierz surowiec i produkt wyjściowy") };
      if (raw.id === out.id) return { error: t("Surowiec i produkt wyjściowy muszą być różnymi produktami") };
      if (raw.unit === "m3" && out.unit === "MP") {
        if (!(Number.isFinite(cfg.m3_mp) && cfg.m3_mp > 0)) return { error: t("Nie można zatwierdzić produkcji. Brak prawidłowego przelicznika jednostek (m³ → MP).") };
        return { factor: cfg.m3_mp, from: "m3", to: "MP" };
      }
      return { error: t("Brak przelicznika {a} → {b} dla wybranego produktu ({r} → {o}).", { a: this.label(raw.unit), b: this.label(out.unit), r: raw.name, o: out.name }) };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Słowniki, uprawnienia, statusy                                      */
  /* ------------------------------------------------------------------ */
  /**
   * Uprawnienia (nazwy zgodne ze specyfikacją tam, gdzie to możliwe). Role mają domyślne zestawy,
   * które administrator może zmienić (state.rolePerms) — z wyjątkiem ADMINISTRATOR (zawsze pełny dostęp).
   */
  const PERMS = {
    "receipts.create": N_("Przyjęcia i zakupy — wprowadzanie"), "issues.create": N_("Wydania i sprzedaż — wprowadzanie"),
    "production.create": N_("Produkcja — wprowadzanie"), "mm.create": N_("Przesunięcia MM — wprowadzanie"),
    "op.approve": N_("Zatwierdzanie operacji (gdy obieg zatwierdzania jest włączony)"),
    "documents.cancel": N_("Anulowanie dokumentów"), "documents.correct": N_("Korekty dokumentów"),
    "inventory.correct": N_("Korekty stanów / MM"), "production.correct": N_("Korekty produkcji"), "sales.correct": N_("Korekty sprzedaży"),
    "purchases.correct": N_("Korekty zakupów"), "inv.open": N_("Otwarcie okresu inwentaryzacji"), "inv.count": N_("Spis z natury"),
    "inv.close": N_("Zamknięcie okresu"), "fleet.edit": N_("Edycja floty"), "master.edit": N_("Edycja kartotek (produkty, kontrahenci)"),
    "report.view": N_("Stany, dokumenty i raporty — odczyt"), "reports.export": N_("Eksport raportów (CSV, PDF)"),
    "history.read": N_("Historia operacji — odczyt"), "audit.read": N_("Dziennik audytu — odczyt"),
    "users.read": N_("Użytkownicy — podgląd"), "users.manage": N_("Użytkownicy — zapraszanie, edycja, blokowanie, hasła"),
    "roles.assign": N_("Role i uprawnienia — zmiana"), "warehouses.edit": N_("Magazyny — dodawanie i edycja"),
    "settings.edit": N_("Konfiguracja systemu"), "data.backup": N_("Kopia zapasowa"), "data.import": N_("Import kopii")
  };
  const CREATE_PERMS = ["receipts.create", "issues.create", "production.create", "mm.create"];
  const ROLE_DEFAULTS = {
    admin: ["*"],
    kierownik: [...CREATE_PERMS, "op.approve", "documents.cancel", "documents.correct", "inventory.correct", "production.correct", "sales.correct", "purchases.correct", "inv.open", "inv.count", "inv.close", "fleet.edit", "master.edit", "report.view", "reports.export", "history.read", "users.read"],
    magazynier: [...CREATE_PERMS, "inv.count", "report.view", "history.read"],
    obserwator: ["report.view", "history.read"],
    audytor: ["report.view", "reports.export", "history.read", "audit.read", "users.read"]
  };
  /** Role: kod (specyfikacja), etykieta, dostęp do wszystkich magazynów (global). */
  const ROLES = {
    admin: { code: "ADMINISTRATOR", label: N_("Administrator"), global: true, perms: ROLE_DEFAULTS.admin },
    kierownik: { code: "MANAGER", label: N_("Kierownik"), global: false, perms: ROLE_DEFAULTS.kierownik },
    magazynier: { code: "MAGAZYNIER", label: N_("Magazynier"), global: false, perms: ROLE_DEFAULTS.magazynier },
    obserwator: { code: "OBSERWATOR", label: N_("Obserwator"), global: false, perms: ROLE_DEFAULTS.obserwator },
    audytor: { code: "AUDYTOR", label: N_("Audytor"), global: true, perms: ROLE_DEFAULTS.audytor }
  };
  /** Opis ról (ekran użytkowników): kto co może. */
  const ROLE_INFO = {
    admin: N_("Pełny dostęp: wszystkie magazyny, użytkownicy i role, kartoteki, kopie, konfiguracja, korekty i anulowania."),
    kierownik: N_("Operacje, dokumenty, korekty i anulowania w przydzielonych magazynach, zamykanie okresów, flota i kartoteki, podgląd użytkowników."),
    magazynier: N_("Przyjęcia, wydania, produkcja i MM w przydzielonych magazynach; stany, dokumenty, raporty podstawowe, spis z natury."),
    obserwator: N_("Tylko odczyt: stany, dokumenty, raporty i historia w przydzielonych magazynach."),
    audytor: N_("Odczyt wszystkich magazynów, raporty, historia zmian i dziennik audytu — bez zmian w danych.")
  };
  /** Statusy kont. ACTIVE — jedyny pozwalający się zalogować. */
  const USER_STATUS = { INVITED: N_("zaproszony"), ACTIVE: N_("aktywny"), SUSPENDED: N_("zawieszony"), DISABLED: N_("dezaktywowany") };
  const statusOf = u => !u ? "DISABLED" : u.status || (u.pending ? "INVITED" : u.active === false ? "DISABLED" : "ACTIVE");
  /** Zestawy uprawnień ról nadpisane przez administratora (ładowane z danych przy każdej komendzie i odświeżeniu stanu). */
  let rolePermsOverride = {};
  function applyRoles(state) { rolePermsOverride = (state && state.rolePerms && typeof state.rolePerms === "object") ? state.rolePerms : {}; }
  function permsOf(role) { if (role === "admin") return ["*"]; return Array.isArray(rolePermsOverride[role]) ? rolePermsOverride[role] : (ROLES[role] || ROLES.obserwator).perms; }
  /** Dostęp do magazynu: role globalne — wszystkie; pozostałe — magazyn domyślny i przydzielone. */
  function whAccess(user) { if (!user) return []; if ((ROLES[user.role] || {}).global) return null; return [...new Set([user.whId].concat(user.warehouseIds || []).filter(Boolean))]; }
  function canAccessWh(user, whId) { const a = whAccess(user); return a === null || a.includes(whId); }
  function can(user, perm) {
    if (!user || user.active === false || user.pending || (user.status && user.status !== "ACTIVE")) return false;
    const p = permsOf(user.role);
    if (p.includes("*")) return true;
    if (perm === "op.create") return CREATE_PERMS.some(x => p.includes(x));      // „dowolna operacja”
    return p.includes(perm);
  }
  const OP_TYPES = {
    ZAKUP: { label: N_("Zakup"), flow: N_("dostawca → magazyn"), correctPerm: "purchases.correct", createPerm: "receipts.create" },
    SPRZEDAZ: { label: N_("Sprzedaż"), flow: N_("magazyn → odbiorca (WZ)"), correctPerm: "sales.correct", createPerm: "issues.create" },
    PRODUKCJA: { label: N_("Produkcja na magazyn"), flow: N_("surowiec ze stanu → produkcja → produkt na stanie"), correctPerm: "production.correct", createPerm: "production.create" },
    MM: { label: N_("Przesunięcie MM"), flow: N_("magazyn → magazyn"), correctPerm: "inventory.correct", createPerm: "mm.create" }
  };
  const STATUS = { DRAFT: N_("ROBOCZY"), PENDING: N_("DO ZATWIERDZENIA"), POSTED: N_("ZATWIERDZONY"), CANCELLED: N_("ANULOWANY"), CORRECTED: N_("SKORYGOWANY") };
  const KINDS = {
    BO: { doc: "BO", label: N_("Bilans otwarcia") }, ZAKUP: { doc: "PZ", label: N_("Zakup — przyjęcie") },
    ZUZYCIE: { doc: "RW", label: N_("Zużycie produkcyjne") }, PRODUKCJA: { doc: "PW", label: N_("Przyjęcie z produkcji") },
    SPRZEDAZ: { doc: "WZ", label: N_("Sprzedaż — wydanie") }, MM: { doc: "MM", label: N_("Przesunięcie międzymagazynowe") },
    INW: { doc: "IN", label: N_("Różnica inwentaryzacyjna") }, KOREKTA: { doc: "KOR", label: N_("Korekta") }, ANULOWANIE: { doc: "AN", label: N_("Anulowanie") }
  };
  const CATS = { ZAKUP: N_("Zakup"), PRODUKCJA: N_("Produkcja"), ZUZYCIE: N_("Zużycie"), SPRZEDAZ: N_("Sprzedaż"), MM: "MM", INW: N_("Inwentaryzacja"), BO: N_("Bilans otwarcia") };
  const DOC_LABEL = {
    PZ: N_("Przyjęcie zewnętrzne (zakup)"), RW: N_("Rozchód wewnętrzny (zużycie)"), PW: N_("Przyjęcie wewnętrzne (produkcja)"),
    WZ: N_("Wydanie zewnętrzne (sprzedaż)"), MM: N_("Przesunięcie międzymagazynowe"), TR: N_("Karta transportu"),
    KOR: N_("Korekta dokumentu"), AN: N_("Anulowanie dokumentu"), IN: N_("Inwentaryzacja"), BO: N_("Bilans otwarcia")
  };
  const BASIS = { DEKL: N_("Deklaracja"), KZR: "KZR" };
  /** Grupy dostawców: firma branży drzewnej → domyślnie KZR; nadleśnictwo → domyślnie Deklaracja + leśnictwo. */
  const SUPPLIER_KINDS = {
    firma: { label: N_("Firma branży drzewnej / przedsiębiorstwo drzewne"), basis: "KZR" },
    nadlesnictwo: { label: N_("Nadleśnictwo"), basis: "DEKL" }
  };
  const partnerKind = p => !p ? null : SUPPLIER_KINDS[p.kind] ? p.kind : /^nadle[sś]nictwo/i.test(p.name || "") ? "nadlesnictwo" : "firma";
  const ndlName = p => String((p && p.name) || "").replace(/^nadle[sś]nictwo\s+/i, "").trim();
  const MAX_RUNS = 50;
  const PROD_TYPES = {
    lesna: { label: N_("Zrębka produkcyjna leśna"), productId: "pr_zr_lesna" },
    inwestycyjna: { label: N_("Zrębka produkcyjna inwestycyjna"), productId: "pr_zr_inw", sourceType: N_("Wycinka inwestycyjna") }
  };
  const DIFF_REASONS = { wilgotnosc: N_("Wilgotność / osiadanie"), jakosc: N_("Jakość surowca"), straty: N_("Straty przy rębaniu"), pomiar: N_("Różnica pomiaru"), inna: N_("Inna przyczyna") };
  const CORRECTION_REASONS = [N_("błędnie wpisana ilość"), N_("błędna cena"), N_("błędna jednostka"), N_("błędny kontrahent"), N_("błędny magazyn"), N_("błędne zużycie surowca"), N_("błędny transport"), N_("pomyłka operatora"), N_("korekta dokumentu zewnętrznego"), N_("inny")];
  const TRANSPORT_MODES = { none: N_("Brak transportu"), own: N_("Transport własny"), external: N_("Transport zewnętrzny"), mixed: N_("Transport własny + zewnętrzny"), train: N_("Pociąg") };
  const VEHICLE_TYPES = { ruchoma_podloga: N_("Ruchoma podłoga"), ciezarowy: N_("Samochód ciężarowy"), wywrotka: N_("Wywrotka") };
  const ASSET_STATUS = { aktywny: N_("Aktywny"), serwis: N_("W serwisie"), wycofany: N_("Wycofany") };
  const INV_STATUS = { OTWARTA: N_("OTWARTA"), ZAMKNIETA: N_("ZAMKNIĘTA") };
  const PRODUCT_CATS = { drewno: N_("Drewno"), zrebka: N_("Zrębka"), agro: N_("Produkt tonowy") };
  const PARTNER_ROLES = { supplier: N_("Dostawca"), buyer: N_("Odbiorca"), both: N_("Dostawca i odbiorca") };
  /** Rozpoznanie tekstu zapisanego jako „powód — opis”: kategoria kanoniczna jest tłumaczona. */
  function trReason(r) {
    const s = String(r == null ? "" : r), i = s.indexOf(" — ");
    return i < 0 ? t(s) : t(s.slice(0, i)) + s.slice(i);
  }

  /* ------------------------------------------------------------------ */
  /* Narzędzia                                                           */
  /* ------------------------------------------------------------------ */
  let uidSeq = 0;
  function uid(prefix) { uidSeq = (uidSeq + 1) % 1e6; return `${prefix}_${Date.now().toString(36)}${uidSeq.toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
  const clone = o => JSON.parse(JSON.stringify(o));
  const byId = (list, id) => (list || []).find(x => x.id === id) || null;
  const str = v => String(v == null ? "" : v).trim();
  const nowIso = ctx => (ctx && ctx.now) || new Date().toISOString();
  const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  /** Normalizacja adresu: bez spacji (także wewnątrz), małe litery. */
  function normalizeEmail(email) { return String(email == null ? "" : email).replace(/\s+/g, "").toLowerCase(); }
  /**
   * Adres firmowy: poprawny składniowo i z domeną DOKŁADNIE z listy (sub.resinvest.group ani resinvest.group.pl nie przechodzą).
   * Wywoływane po stronie serwera (silnik) — walidacja w przeglądarce jest tylko pomocnicza.
   */
  function validateCompanyEmail(email, domains) {
    const e = normalizeEmail(email);
    if (!EMAIL_RE.test(e) || e.split("@").length !== 2) return { ok: false, email: e, error: t("Podaj adres e-mail") };
    const doms = (domains || []).map(d => String(d).toLowerCase());
    if (doms.length && !doms.includes(e.split("@")[1])) return { ok: false, email: e, error: t("Wymagany e-mail firmowy ({d})", { d: doms.map(d => "@" + d).join(", ") }) };
    return { ok: true, email: e };
  }
  function companyEmail(state, email) { return validateCompanyEmail(email, state && state.config && state.config.companyDomains).ok; }

  function emptyState(config) {
    return {
      schema: SCHEMA, version: VERSION, rev: 0,
      config: Object.assign({ m3_mp: 4, mp_t: 0.33, woodTPerM3: 0.952, t_gj: 8.5, currency: "zł", kmRateDefault: 5, chipRateDefault: 10, wagonMPDefault: 120, maxWagons: 60, companyDomains: ["resinvest.group"], requireApproval: false, allowSelfRegistration: false }, config || {}),
      warehouses: [], users: [], products: [], partners: [], carriers: [],
      fleet: { vehicles: [], drivers: [], chippers: [], operators: [] },
      operations: [], drafts: [], ledger: [], inventory: [], audit: [], seq: {}, rolePerms: {},
      meta: { lastMonthCheck: null, createdAt: null }
    };
  }
  function validateStateShape(s) {
    const e = [];
    if (!s || typeof s !== "object") return [t("Brak danych")];
    if (s.schema !== SCHEMA) e.push(t("Nieobsługiwana wersja schematu: {a} (oczekiwano {b})", { a: s.schema, b: SCHEMA }));
    for (const k of ["warehouses", "users", "products", "partners", "operations", "drafts", "ledger", "inventory", "audit"]) if (!Array.isArray(s[k])) e.push(t("Brak kolekcji „{k}”", { k }));
    if (!s.fleet || !["vehicles", "drivers", "chippers", "operators"].every(k => Array.isArray(s.fleet[k]))) e.push(t("Brak kartotek floty"));
    if (!s.config || !(s.config.m3_mp > 0) || !(s.config.mp_t > 0) || !(s.config.t_gj > 0)) e.push(t("Brak przeliczników"));
    if (Array.isArray(s.products) && s.products.some(p => !Units.LIST.includes(p.unit))) e.push(t("Produkt bez jednostki magazynowej"));
    if (Array.isArray(s.users) && s.users.some(u => !u.id || !u.login)) e.push(t("Użytkownik bez identyfikatora lub loginu"));
    if (Array.isArray(s.users) && s.users.some(u => !ROLES[u.role])) e.push(t("Użytkownik z nieznaną rolą"));
    if (Array.isArray(s.ledger)) for (const l of s.ledger) {
      if (!Number.isFinite(l.qty) || !l.productId || !l.whId || !Dates.isISO(l.date) || !l.cat) { e.push(t("Uszkodzony zapis księgi: {id}", { id: l.id || "?" })); break; }
    }
    return e;
  }
  /** Login z imienia i nazwiska / identyfikatora: małe litery bez polskich znaków, np. „a.gorska”. */
  function loginFrom(name, fallback) {
    const base = String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
    const l = base.length >= 2 ? `${base[0][0]}.${base[base.length - 1]}` : (base[0] || String(fallback || "user").replace(/^u_/, ""));
    return l.slice(0, 32);
  }
  /**
   * Migracja danych do bieżącego schematu (kopie zapasowe i dane z wcześniejszych wersji).
   * 3 → 4: użytkownicy dostają login, język i motyw; kartoteki — flagę „aktywny”.
   * Zwraca { state, from, to, notes } albo { error }. Nie modyfikuje wejścia.
   */
  function migrate(input) {
    if (!input || typeof input !== "object") return { error: t("Brak danych") };
    const s = clone(input), notes = [], from = s.schema;
    if (s.schema === 3) {
      const used = new Set();
      for (const u of s.users || []) {
        let l = u.login || loginFrom(u.name, u.id), i = 2;
        while (used.has(l)) l = `${l.replace(/\d+$/, "")}${i++}`;
        used.add(l); u.login = l;
        if (!u.lang) u.lang = "";
        if (!u.theme) u.theme = "";
      }
      for (const k of ["products", "partners", "warehouses"]) for (const x of s[k] || []) if (x.active === undefined) x.active = true;
      s.schema = 4; s.version = VERSION;
      notes.push(t("Schemat 3 → 4: loginy użytkowników, preferencje języka i motywu"));
    }
    if (s.schema === 4) {
      if (!s.config) s.config = {};
      if (!Array.isArray(s.config.companyDomains)) s.config.companyDomains = ["resinvest.group"];
      for (const u of s.users || []) {
        if (u.role === "podglad") u.role = "obserwator";
        const mail = str(u.email).toLowerCase();
        if (EMAIL_RE.test(mail)) u.login = mail;
        else if (!EMAIL_RE.test(str(u.login))) u.login = `${str(u.login).toLowerCase()}@${s.config.companyDomains[0] || "resinvest.group"}`;   // dawny login → adres firmowy
        u.email = EMAIL_RE.test(str(u.login)) ? str(u.login).toLowerCase() : mail;
      }
      for (const k of ["vehicles", "drivers", "chippers", "operators"]) for (const x of (s.fleet && s.fleet[k]) || []) if (x.whId === undefined) x.whId = "";
      s.schema = 5; s.version = VERSION;
      notes.push(t("Schemat 4 → 5: logowanie e-mailem firmowym, rola Obserwator, flota przypisana do magazynów, zatwierdzanie operacji"));
    }
    if (s.schema === 5) {
      if (s.config.requireApproval === undefined) s.config.requireApproval = false;
      if (s.config.allowSelfRegistration === undefined) s.config.allowSelfRegistration = false;
      if (!s.rolePerms || typeof s.rolePerms !== "object") s.rolePerms = {};
      for (const u of s.users || []) {
        u.status = statusOf(u); u.active = u.status === "ACTIVE"; delete u.pending;
        if (!u.firstName && !u.lastName) { const parts = str(u.name).split(/\s+/); u.firstName = parts[0] || ""; u.lastName = parts.slice(1).join(" "); }
        if (!Array.isArray(u.warehouseIds)) u.warehouseIds = u.whId ? [u.whId] : [];
      }
      // obieg zatwierdzania wyłączony: operacje „do zatwierdzenia” wracają do autorów jako wersje robocze
      for (const d of s.drafts || []) if (d.status === "PENDING" && !s.config.requireApproval) d.status = "DRAFT";
      s.schema = 6; s.version = VERSION;
      notes.push(t("Schemat 5 → 6: statusy kont, wiele magazynów na użytkownika, role AUDYTOR i edytowalne uprawnienia"));
    }
    if (s.schema !== SCHEMA) return { error: t("Nieobsługiwana wersja schematu: {a} (oczekiwano {b})", { a: from, b: SCHEMA }) };
    return { state: s, from, to: SCHEMA, notes };
  }

  /* ------------------------------------------------------------------ */
  /* Stany                                                               */
  /* ------------------------------------------------------------------ */
  const Stock = {
    balance(state, whId, productId, to) {
      let n = 0;
      for (const l of state.ledger) {
        if ((whId && l.whId !== whId) || l.productId !== productId) continue;
        if (to && l.date > to) continue;
        n += l.qty;
      }
      return rq(n);
    },
    /** Mapa productId → ilość; `whId` = null → wszystkie magazyny; `to` włącznie; `before` — ściśle przed datą. */
    byProduct(state, whId, to, before) {
      const m = new Map();
      for (const l of state.ledger) {
        if (whId && l.whId !== whId) continue;
        if (to && l.date > to) continue;
        if (before && l.date >= before) continue;
        m.set(l.productId, rq((m.get(l.productId) || 0) + l.qty));
      }
      return m;
    },
    lastMove(state, whId, productId) {
      let d = null;
      for (const l of state.ledger) if (l.whId === whId && l.productId === productId && (!d || l.date > d)) d = l.date;
      return d;
    },
    sorted(entries) { return entries.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq); },
    card(state, whId, productId) {
      let bal = 0;
      return this.sorted(state.ledger.filter(l => l.whId === whId && l.productId === productId))
        .map(r => { bal = rq(bal + r.qty); return Object.assign({}, r, { balance: bal }); });
    },
    /** Saldo dzienne z ostatnich `days` dni (do wykresów). */
    series(state, whId, productId, to, days) {
      const out = [];
      const start = Dates.addDays(to, -(days - 1));
      let bal = this.balance(state, whId, productId, Dates.addDays(start, -1));
      const byDay = new Map();
      for (const l of state.ledger) if ((!whId || l.whId === whId) && l.productId === productId && l.date >= start && l.date <= to) byDay.set(l.date, (byDay.get(l.date) || 0) + l.qty);
      for (let i = 0; i < days; i++) { const d = Dates.addDays(start, i); bal = rq(bal + (byDay.get(d) || 0)); out.push({ date: d, qty: bal }); }
      return out;
    }
  };
  function lockedMonth(state, whId) {
    let ym = null;
    for (const p of state.inventory) if (p.whId === whId && p.status === "ZAMKNIETA" && (!ym || p.ym > ym)) ym = p.ym;
    return ym;
  }
  function isLocked(state, whId, date) { const ym = lockedMonth(state, whId); return !!ym && Dates.ym(date) <= ym; }

  /* ------------------------------------------------------------------ */
  /* Szkic operacji                                                      */
  /* ------------------------------------------------------------------ */
  function blankExtRun() { return { reg: "", driver: "", km: "", rate: "", freight: "", kwit: "", kwitM3: "", qty: "", weightT: "" }; }
  function blankRun() { return { vehicleId: "", driverId: "", km: "", rate: "", kwit: "", kwitM3: "", qty: "", weightT: "" }; }
  function blankDraft(ctx) {
    return {
      idemKey: uid("idem"), draftId: null, type: "ZAKUP",
      date: ctx && ctx.today ? ctx.today : Dates.localToday(),
      purchase: { supplierKind: "firma", supplierId: "", supplierName: "", lesnictwo: "", basis: "KZR", productId: "", qty: "", unit: "m3", price: "", weightMode: "auto", weightManual: "" },
      production: { enabled: false, type: "lesna", rawProductId: "", outProductId: "", outQty: "", consumeQty: "", diffReason: "", rawCost: "", ndl: "", lesnictwo: "", kwit: "", investSite: "", sourceDoc: "", chipperId: "", operatorId: "", chipRate: "" },
      sale: { enabled: false, direct: false, productId: "", qty: "", unit: "MP", buyerId: "", qtyMP: "", price: "", priceUnit: "MP" },
      mm: { productId: "", qty: "", unit: "MP", toWhId: "" },
      transport: {
        mode: "none", place: "", placeTouched: false,
        own: { runCount: "1", runs: [blankRun()] },
        external: { company: "", includedInPrice: false, runCount: "1", runs: [blankExtRun()] },
        train: { trainNo: "", carrier: "", docNo: "", loadPlace: "", wagonCount: "", capUnit: "t", capacity: "", tonMode: "same", sameT: "", wagonT: [], price: "", priceUnit: "t" }
      },
      notes: "", extDoc: ""
    };
  }

  /* ------------------------------------------------------------------ */
  /* Plan operacji — pełna walidacja i skutki (jedno źródło prawdy)      */
  /* ------------------------------------------------------------------ */
  function planOperation(state, draft, ctx) {
    const cfg = state.config;
    const errors = {}, warnings = [], codes = {};
    const err = (k, m, code) => { if (!errors[k]) { errors[k] = m; if (code) codes[k] = code; } };
    const user = ctx && ctx.user;
    const today = (ctx && ctx.today) || Dates.localToday();
    const num = (key, raw, { required = true, min = null, gt = null, integer = false, label = "" } = {}) => {
      const r = NumParse.parse(raw);
      if (r.empty) { if (required) err(key, label ? t("Podaj {x}", { x: t(label) }) : t("Pole wymagane")); return null; }
      if (!r.ok) { err(key, t("{e} — wpisz np. {x}", { e: r.error, x: fmt(1000.5, 1) })); return null; }
      if (integer && !Number.isInteger(r.value)) { err(key, t("Wpisz liczbę całkowitą")); return null; }
      if (gt !== null && !(r.value > gt)) { err(key, label ? t("Podaj {x} większą od 0", { x: t(label) }) : t("Wartość musi być większa od 0")); return null; }
      if (min !== null && r.value < min) { err(key, t("Wartość nie może być ujemna")); return null; }
      return r.value;
    };
    const prodOf = id => byId(state.products, id);
    const partyName = id => (byId(state.partners, id) || {}).name || "";
    const U = u => Units.label(u);

    if (!user) err("_user", t("Brak zalogowanego użytkownika"));
    else if (!can(user, "op.create")) err("_user", t("Twoja rola nie pozwala tworzyć operacji"));
    const wh = user ? byId(state.warehouses, user.whId) : null;
    if (user && !wh) err("_wh", t("Nie wybrano magazynu — użytkownik nie ma przypisanego magazynu"));
    const whId = wh ? wh.id : null;
    const stockAt = (w, pid) => (w && pid ? Stock.balance(state, w, pid) : 0);
    const stockOf = pid => stockAt(whId, pid);

    const type = OP_TYPES[draft.type] ? draft.type : null;
    if (!type) err("type", t("Wybierz rodzaj operacji"));
    else if (user && !can(user, OP_TYPES[type].createPerm)) err("type", t("Twoja rola nie pozwala wprowadzać operacji tego rodzaju"), "FORBIDDEN");
    if (user && wh && !canAccessWh(user, wh.id)) err("_wh", t("Brak dostępu do magazynu {w}", { w: wh.name }), "FORBIDDEN");
    const date = str(draft.date);
    if (!Dates.isISO(date)) err("date", t("Podaj datę w formacie RRRR-MM-DD"));
    else if (!(ctx && ctx.correction)) {
      if (date > today) err("date", t("Data operacji nie może być z przyszłości"));
      else if (whId && isLocked(state, whId, date)) err("date", t("Okres {ym} jest zamknięty — zmiany tylko przez korektę z bieżącą datą", { ym: lockedMonth(state, whId) }), "LOCKED");
    }

    const postings = [], documents = [];
    const norm = { type, purchase: null, production: null, sale: null, mm: null };
    const totals = { purchaseCost: 0, rawCost: 0, chippingCost: 0, revenue: 0, transportCost: 0, result: 0 };
    const R_ = Object.assign({}, draft.production || {}), S = draft.sale || {}, P = draft.purchase || {}, M = draft.mm || {};

    /* ---------- produkcja (wspólna dla trzech ścieżek) ----------
       mode "chain":  surowiec z zakupu w tej samej operacji, zużycie podane (domyślnie cały zakup)
       mode "stock":  surowiec ze stanu, użytkownik podaje ilość PRODUKCJI → zużycie = produkcja ÷ przelicznik
       mode "direct": surowiec z lasu (nie ze stanu), produkcja podana, zużycie informacyjne              */
    function planProduction(mode, rawProduct, consumeGiven) {
      const pt = PROD_TYPES[R_.type];
      if (mode !== "stock" && !pt) err("production.type", t("Wybierz rodzaj produkcji"));
      const outId = R_.outProductId || (pt ? pt.productId : "");
      const outProduct = prodOf(outId);
      if (!outId) err("production.outProductId", t("Wybierz produkt wyjściowy"));
      else if (!outProduct) err("production.outProductId", t("Nieznany produkt wyjściowy"));
      let factor = null;
      if (rawProduct && outProduct) {
        const f = Units.prodFactor(rawProduct, outProduct, cfg);
        if (f.error) err(rawProduct.id === outProduct.id ? "production.outProductId" : "production.factor", f.error); else factor = f.factor;
      }
      let outQty = 0, consume = null, maxOut = null;
      if (mode === "chain") {
        consume = consumeGiven;
        if (factor && consume !== null) maxOut = rq(consume * factor);
        if (str(R_.outQty) === "") outQty = maxOut || 0;
        else { const o = num("production.outQty", R_.outQty, { gt: 0, label: N_("ilość produkcji") }); outQty = o === null ? 0 : rq(o); }
        if (maxOut !== null && outQty > maxOut + EPS) err("production.outQty", t("Wynik produkcji {a} {u} przekracza zużyty surowiec ({b} {u})", { a: fmtQ(outQty), b: fmtQ(maxOut), u: U(outProduct.unit) }));
        if (maxOut !== null && outQty > 0 && outQty < maxOut - EPS && !DIFF_REASONS[R_.diffReason]) err("production.diffReason", t("Wynik niższy od zużycia o {a} {u} — wskaż przyczynę", { a: fmtQ(maxOut - outQty), u: U(outProduct.unit) }));
      } else {
        const o = num("production.outQty", R_.outQty, { gt: 0, label: N_("ilość produkcji") });
        outQty = o === null ? 0 : rq(o);
        if (factor && outQty > 0) consume = rq(outQty / factor);           // pełna precyzja — bez zaokrąglania przed walidacją
        if (factor && outQty > 0 && !(consume > 0)) err("production.outQty", t("Obliczone zużycie surowca musi być większe od 0"));
      }
      if (mode !== "stock") {
        if (R_.type === "lesna") {
          if (!str(R_.ndl)) err("production.ndl", t("Podaj nadleśnictwo"));
          if (!str(R_.lesnictwo)) err("production.lesnictwo", t("Podaj leśnictwo"));
        } else if (R_.type === "inwestycyjna" && !str(R_.investSite)) err("production.investSite", t("Podaj miejsce wycinki / inwestycję"));
      }
      const ch = byId(state.fleet.chippers, R_.chipperId);
      if (R_.chipperId) {
        if (!ch) err("production.chipperId", t("Nieznany rębak"));
        else if (ch.status !== "aktywny") err("production.chipperId", t("Rębak ma status „{s}”", { s: t(ASSET_STATUS[ch.status] || ch.status) }));
        else if (ch.whId && whId && ch.whId !== whId) err("production.chipperId", t("Rębak jest przypisany do magazynu {w}", { w: (byId(state.warehouses, ch.whId) || {}).name || "" }));
        if (!byId(state.fleet.operators, R_.operatorId || (ch && ch.operatorId))) err("production.operatorId", t("Wybierz operatora rębaka"));
      }
      let chipRate = 0, chippingCost = 0;
      if (outProduct && outProduct.unit === "MP") {
        chipRate = str(R_.chipRate) === "" ? cfg.chipRateDefault : num("production.chipRate", R_.chipRate, { min: 0, label: N_("cenę za rąbanie") });
        chippingCost = chipRate !== null ? round(outQty * chipRate, 2) : 0;
      }
      totals.chippingCost = chippingCost;
      const op = byId(state.fleet.operators, R_.chipperId ? (R_.operatorId || (ch && ch.operatorId)) : "");
      norm.production = {
        mode, type: R_.type || "", typeLabel: pt ? pt.label : "", outProductId: outProduct ? outProduct.id : "", outUnit: outProduct ? outProduct.unit : null,
        rawProductId: rawProduct ? rawProduct.id : "", consumeQty: consume, consumeUnit: rawProduct ? rawProduct.unit : null,
        factor, maxOut, outQty, diffReason: R_.diffReason || "", chipRate: chipRate || 0, chippingCost,
        ndl: str(R_.ndl), lesnictwo: str(R_.lesnictwo), kwit: str(R_.kwit),
        sourceType: R_.type === "inwestycyjna" && mode !== "stock" ? PROD_TYPES.inwestycyjna.sourceType : "",
        investSite: str(R_.investSite), sourceDoc: str(R_.sourceDoc),
        chipperId: R_.chipperId || "", chipperName: ch ? ch.name : "", operatorId: op ? op.id : "", operatorName: op ? op.name : ""
      };
      return { outProduct, outQty, consume };
    }
    const prodMeta = () => {
      const x = norm.production;
      const m = { productionType: x.typeLabel || "", chipRate: x.chipRate, chippingCost: x.chippingCost };
      if (x.chipperName) m.chipper = x.chipperName;
      if (x.operatorName) m.operator = x.operatorName;
      if (x.mode !== "stock" && x.type === "lesna") Object.assign(m, { ndl: x.ndl, lesnictwo: x.lesnictwo, kwit: x.kwit });
      if (x.mode !== "stock" && x.type === "inwestycyjna") Object.assign(m, { sourceType: x.sourceType, investSite: x.investSite, sourceDoc: x.sourceDoc });
      return m;
    };
    /** Sprzedaż wyniku produkcji (łańcuch zakupu / sprzedaż bezpośrednia). */
    function planSaleOfOutput(outProduct, outQty, direct) {
      const buyer = byId(state.partners, S.buyerId);
      if (!S.buyerId) err("sale.buyerId", t("Wybierz odbiorcę"));
      else if (!buyer || !["buyer", "both"].includes(buyer.role) || buyer.active === false) err("sale.buyerId", t("Nieznany lub nieaktywny odbiorca"));
      let saleQ = outQty;
      if (str(S.qtyMP) !== "") { const q = num("sale.qtyMP", S.qtyMP, { gt: 0, label: N_("ilość sprzedaży") }); saleQ = q === null ? 0 : rq(q); }
      if (outProduct && saleQ > outQty + EPS) err("sale.qtyMP", t("Nie można sprzedać {a} {u} z produkcji {b} {u}", { a: fmtQ(saleQ), b: fmtQ(outQty), u: U(outProduct.unit) }));
      if (!["MP", "t"].includes(S.priceUnit)) err("sale.priceUnit", t("Wybierz jednostkę ceny"));
      const price = num("sale.price", S.price, { min: 0, label: N_("cenę sprzedaży") });
      if (price === 0) warnings.push(t("Cena sprzedaży wynosi 0 zł."));
      const weightT = outProduct ? Units.mass(saleQ, outProduct, cfg) : 0;
      totals.revenue = price !== null ? round((S.priceUnit === "t" ? weightT : saleQ) * price, 2) : 0;
      if (direct && outQty - saleQ > EPS) warnings.push(t("Nie cała produkcja jest sprzedana — pozostałe {a} {u} zostanie przyjęte na stan magazynu.", { a: fmtQ(outQty - saleQ), u: outProduct ? U(outProduct.unit) : "" }));
      norm.sale = { direct, fromStock: false, buyerId: S.buyerId, productId: outProduct ? outProduct.id : "", qty: saleQ, unit: outProduct ? outProduct.unit : "MP", stockQty: saleQ, price, priceUnit: S.priceUnit, revenue: totals.revenue, weightT };
      return saleQ;
    }
    const push = (kind, productId, qty, extra) => postings.push(Object.assign({ kind, cat: kind, whId, productId, qty: rq(qty) }, extra || {}));

    if (type === "ZAKUP") {
      /* ============================ A. ZAKUP ============================ */
      /* Dostawca: wybór z kartoteki albo nazwa wpisana ręcznie. Nazwa zgodna z kartoteką (bez względu na wielkość liter)
         wskazuje istniejącego kontrahenta; nowa nazwa = nowy dostawca, dopisywany do kartoteki przy zatwierdzeniu. */
      const typed = str(P.supplierName).replace(/\s+/g, " ");
      let supplier = byId(state.partners, P.supplierId), newSupplier = null;
      if (!supplier && typed) {
        supplier = state.partners.find(p => str(p.name).toLowerCase() === typed.toLowerCase()) || null;
        if (!supplier) newSupplier = { name: typed, kind: SUPPLIER_KINDS[P.supplierKind] ? P.supplierKind : "firma" };
      }
      if (!supplier && !newSupplier) err("purchase.supplierName", t("Wpisz nazwę dostawcy albo wybierz z listy"));
      else if (newSupplier && typed.length < 3) err("purchase.supplierName", t("Nazwa dostawcy musi mieć co najmniej 3 znaki"));
      else if (supplier && !["supplier", "both"].includes(supplier.role)) err("purchase.supplierName", t("„{n}” jest w kartotece jako odbiorca, nie dostawca", { n: supplier.name }));
      else if (supplier && supplier.active === false) err("purchase.supplierName", t("Dostawca „{n}” jest nieaktywny", { n: supplier.name }));
      const sObj = supplier || newSupplier;
      const sKind = supplier ? partnerKind(supplier) : newSupplier ? newSupplier.kind : null;
      if (supplier && P.supplierKind && SUPPLIER_KINDS[P.supplierKind] && P.supplierKind !== sKind) err("purchase.supplierName", t("Dostawca „{n}” nie należy do grupy „{g}”", { n: supplier.name, g: t(SUPPLIER_KINDS[P.supplierKind].label) }));
      if (sKind === "nadlesnictwo" && !str(P.lesnictwo)) err("purchase.lesnictwo", t("Podaj leśnictwo (wpisz nowe albo wybierz z listy)"));
      // drewno z nadleśnictwa: pochodzenie produkcji uzupełnia się z zakupu
      if (sKind === "nadlesnictwo") { if (!str(R_.ndl)) R_.ndl = ndlName(sObj); if (!str(R_.lesnictwo)) R_.lesnictwo = str(P.lesnictwo); }
      if (!BASIS[P.basis]) err("purchase.basis", t("Wybierz podstawę: Deklaracja albo KZR"));
      const product = prodOf(P.productId);
      if (!P.productId) err("purchase.productId", t("Wybierz produkt / surowiec"));
      else if (!product || product.active === false) err("purchase.productId", t("Nieznany produkt"));
      const unitOk = product && Units.allowed(product).includes(P.unit);
      if (product && !unitOk) err("purchase.unit", t("Dla „{p}” dozwolone: {u}", { p: product.name, u: Units.allowed(product).map(U).join(", ") }));
      const qty = num("purchase.qty", P.qty, { gt: 0, label: N_("ilość") });
      const price = num("purchase.price", P.price, { min: 0, label: N_("cenę") });
      if (price === 0) warnings.push(t("Cena zakupu wynosi 0 zł — upewnij się, że to zamierzone."));
      const stockQty = qty !== null && unitOk ? Units.convert(qty, P.unit, product.unit, product, cfg) : 0;
      const autoWeight = product ? Units.mass(stockQty, product, cfg) : 0;
      let weightT = autoWeight;
      if (P.weightMode === "manual") {
        const w = num("purchase.weightManual", P.weightManual, { gt: 0, label: N_("wagę rzeczywistą") });
        if (w !== null) {
          weightT = rq(w);
          if (autoWeight > 0 && product.unit !== "t" && Math.abs(weightT - autoWeight) / autoWeight > 0.25) warnings.push(t("Waga rzeczywista {a} t różni się o ponad 25% od orientacyjnej {b} t — sprawdź kwit wagowy.", { a: fmtQ(weightT), b: fmtQ(autoWeight) }));
        }
      } else if (P.weightMode !== "auto") err("purchase.weightMode", t("Wybierz sposób ustalenia wagi"));
      totals.purchaseCost = qty !== null && price !== null ? round(qty * price, 2) : 0;
      norm.purchase = { supplierId: supplier ? supplier.id : "", supplierName: sObj ? sObj.name : "", newSupplier, supplierKind: sKind, lesnictwo: sKind === "nadlesnictwo" ? str(P.lesnictwo) : "", basis: P.basis, productId: P.productId, qty, unit: P.unit, stockQty, stockUnit: product ? product.unit : null, price, cost: totals.purchaseCost, weightMode: P.weightMode, weightT, autoWeight };
      if (product && stockQty > 0) {
        push("ZAKUP", product.id, stockQty);
        documents.push({ type: "PZ", kind: "ZAKUP", productId: product.id, qty, unit: P.unit, stockQty, stockUnit: product.unit, weightT, weightMode: P.weightMode, value: totals.purchaseCost, partnerId: supplier ? supplier.id : "", partner: sObj ? sObj.name : "", basis: P.basis, stock: "+" });
      }
      if (R_.enabled) {
        if (product && product.cat !== "drewno") err("production.enabled", t("Produkcja zrębki jest możliwa tylko z surowca drzewnego (drewno)"));
        let consume = null;
        if (product && product.cat === "drewno") {
          let cq = qty;
          if (str(R_.consumeQty) !== "") cq = num("production.consumeQty", R_.consumeQty, { gt: 0, label: N_("zużycie") });
          if (cq !== null && unitOk) {
            consume = Units.convert(cq, P.unit, product.unit, product, cfg);
            const avail = rq(stockOf(product.id) + stockQty);
            norm.available = { stock: stockOf(product.id), purchase: stockQty, total: avail, unit: product.unit };
            if (consume > avail + EPS) err("production.consumeQty", t("Brak wystarczającej ilości surowca. Dostępne: {a} {u}. Wymagane: {b} {u}. Brakuje: {c} {u}.", { a: fmtQ(avail), b: fmtQ(consume), c: fmtQ(consume - avail), u: U(product.unit) }), "STOCK");
          }
        }
        const { outProduct, outQty } = planProduction("chain", product && product.cat === "drewno" ? product : null, consume);
        if (product && consume > 0) {
          push("ZUZYCIE", product.id, -consume);
          documents.push({ type: "RW", kind: "ZUZYCIE", productId: product.id, qty: consume, unit: product.unit, stockQty: consume, stockUnit: product.unit, weightT: Units.mass(consume, product, cfg), value: 0, stock: "−" });
        }
        if (outProduct && outQty > 0) {
          push("PRODUKCJA", outProduct.id, outQty);
          documents.push({ type: "PW", kind: "PRODUKCJA", productId: outProduct.id, qty: outQty, unit: outProduct.unit, stockQty: outQty, stockUnit: outProduct.unit, weightT: Units.mass(outQty, outProduct, cfg), value: totals.chippingCost, stock: "+", meta: prodMeta() });
        }
        if (S.enabled) {
          const saleQ = planSaleOfOutput(outProduct, outQty, false);
          if (outProduct && saleQ > 0) {
            push("SPRZEDAZ", outProduct.id, -saleQ);
            documents.push({ type: "WZ", kind: "SPRZEDAZ", productId: outProduct.id, qty: saleQ, unit: outProduct.unit, stockQty: saleQ, stockUnit: outProduct.unit, weightT: norm.sale.weightT, value: totals.revenue, price: norm.sale.price, priceUnit: S.priceUnit, partnerId: S.buyerId, partner: partyName(S.buyerId), stock: "−" });
          }
        }
      } else if (S.enabled) err("sale.enabled", t("W zakupie sprzedaż korzysta z wyniku produkcji — zaznacz produkcję albo użyj operacji „Sprzedaż” (WZ z magazynu)"));
    } else if (type === "SPRZEDAZ" && !S.direct) {
      /* ===================== B. SPRZEDAŻ Z MAGAZYNU (WZ) ===================== */
      const product = prodOf(S.productId);
      if (!S.productId) err("sale.productId", t("Wybierz produkt z magazynu"));
      else if (!product) err("sale.productId", t("Nieznany produkt"));
      const unitOk = product && Units.allowed(product).includes(S.unit);
      if (product && !unitOk) err("sale.unit", t("Dla „{p}” dozwolone: {u}", { p: product.name, u: Units.allowed(product).map(U).join(", ") }));
      const qty = num("sale.qty", S.qty, { gt: 0, label: N_("ilość") });
      const stockQty = qty !== null && unitOk ? Units.convert(qty, S.unit, product.unit, product, cfg) : 0;
      const onStock = product ? stockOf(product.id) : 0;
      if (product && qty !== null && stockQty > onStock + EPS) err("sale.qty", t("Nie można sprzedać {a} {u}. Dostępny stan: {b} {u}.", { a: fmtQ(stockQty), b: fmtQ(onStock), u: U(product.unit) }), "STOCK");
      const buyer = byId(state.partners, S.buyerId);
      if (!S.buyerId) err("sale.buyerId", t("Wybierz odbiorcę"));
      else if (!buyer || !["buyer", "both"].includes(buyer.role) || buyer.active === false) err("sale.buyerId", t("Nieznany lub nieaktywny odbiorca"));
      const price = num("sale.price", S.price, { min: 0, label: N_("cenę sprzedaży") });
      if (price === 0) warnings.push(t("Cena sprzedaży wynosi 0 zł."));
      totals.revenue = qty !== null && price !== null ? round(qty * price, 2) : 0;
      const weightT = product ? Units.mass(stockQty, product, cfg) : 0;
      norm.sale = { direct: false, fromStock: true, buyerId: S.buyerId, productId: S.productId, qty, unit: S.unit, stockQty, stockUnit: product ? product.unit : null, onStock, after: rq(onStock - stockQty), price, priceUnit: S.unit, revenue: totals.revenue, weightT };
      if (product && stockQty > 0) {
        push("SPRZEDAZ", product.id, -stockQty);
        documents.push({ type: "WZ", kind: "SPRZEDAZ", productId: product.id, qty, unit: S.unit, stockQty, stockUnit: product.unit, weightT, value: totals.revenue, price, priceUnit: S.unit, partnerId: S.buyerId, partner: partyName(S.buyerId), stock: "−" });
      }
    } else if (type === "SPRZEDAZ" && S.direct) {
      /* ============ D. PRODUKCJA + SPRZEDAŻ BEZPOŚREDNIA (las → odbiorca) ============ */
      const rawP = prodOf(R_.rawProductId);
      if (!R_.rawProductId) err("production.rawProductId", t("Wybierz surowiec wejściowy (np. drewno z lasu)"));
      else if (!rawP) err("production.rawProductId", t("Nieznany surowiec"));
      const rawCost = str(R_.rawCost) === "" ? 0 : num("production.rawCost", R_.rawCost, { min: 0 });
      totals.rawCost = rawCost || 0;
      const { outProduct, outQty, consume } = planProduction("direct", rawP, null);
      norm.production.rawQty = consume; norm.production.rawCost = totals.rawCost;
      const saleQ = planSaleOfOutput(outProduct, outQty, true);
      if (outProduct && outQty > 0) {
        push("PRODUKCJA", outProduct.id, outQty, { direct: true });
        documents.push({ type: "PW", kind: "PRODUKCJA", productId: outProduct.id, qty: outQty, unit: outProduct.unit, stockQty: outQty, stockUnit: outProduct.unit, weightT: Units.mass(outQty, outProduct, cfg), value: totals.chippingCost, stock: "+", meta: Object.assign(prodMeta(), { direct: N_("tak — produkcja w lesie"), rawInfo: rawP && consume !== null ? Lx("{q} {u} {p} (nie ze stanu)", { q: rq(consume), u: U(rawP.unit), p: rawP.name }) : "" }) });
      }
      if (outProduct && saleQ > 0) {
        push("SPRZEDAZ", outProduct.id, -saleQ, { direct: true });
        documents.push({ type: "WZ", kind: "SPRZEDAZ", productId: outProduct.id, qty: saleQ, unit: outProduct.unit, stockQty: saleQ, stockUnit: outProduct.unit, weightT: norm.sale.weightT, value: totals.revenue, price: norm.sale.price, priceUnit: S.priceUnit, partnerId: S.buyerId, partner: partyName(S.buyerId), stock: "−", meta: { direct: N_("sprzedaż bezpośrednia po produkcji / prosto z lasu") } });
      }
    } else if (type === "PRODUKCJA") {
      /* ================= C. PRODUKCJA NA MAGAZYN (surowiec ze stanu) ================= */
      const rawP = prodOf(R_.rawProductId);
      if (!R_.rawProductId) err("production.rawProductId", t("Wybierz surowiec"));
      else if (!rawP) err("production.rawProductId", t("Nieznany surowiec"));
      const { outProduct, outQty, consume } = planProduction("stock", rawP, null);
      const onStock = rawP ? stockOf(rawP.id) : 0;
      if (rawP) norm.available = { stock: onStock, purchase: 0, total: onStock, unit: rawP.unit };
      if (rawP && consume !== null && consume > onStock + EPS) {
        err("production.outQty", t("Brak wystarczającej ilości surowca. Dostępne: {a} {u}. Wymagane: {b} {u}. Brakuje: {c} {u}.", { a: fmtQ(onStock), b: fmtQ(consume), c: fmtQ(consume - onStock), u: U(rawP.unit) }), "STOCK");
      }
      if (rawP && consume > 0) {
        push("ZUZYCIE", rawP.id, -consume);
        documents.push({ type: "RW", kind: "ZUZYCIE", productId: rawP.id, qty: consume, unit: rawP.unit, stockQty: consume, stockUnit: rawP.unit, weightT: Units.mass(consume, rawP, cfg), value: 0, stock: "−" });
      }
      if (outProduct && outQty > 0 && consume > 0) {
        push("PRODUKCJA", outProduct.id, outQty);
        documents.push({ type: "PW", kind: "PRODUKCJA", productId: outProduct.id, qty: outQty, unit: outProduct.unit, stockQty: outQty, stockUnit: outProduct.unit, weightT: Units.mass(outQty, outProduct, cfg), value: totals.chippingCost, stock: "+", meta: prodMeta() });
      }
    } else if (type === "MM") {
      /* ================= E. MM — przesunięcie międzymagazynowe ================= */
      const product = prodOf(M.productId);
      if (!M.productId) err("mm.productId", t("Wybierz produkt"));
      else if (!product) err("mm.productId", t("Nieznany produkt"));
      const unitOk = product && Units.allowed(product).includes(M.unit);
      if (product && !unitOk) err("mm.unit", t("Dla „{p}” dozwolone: {u}", { p: product.name, u: Units.allowed(product).map(U).join(", ") }));
      const toWh = byId(state.warehouses, M.toWhId);
      if (!M.toWhId) err("mm.toWhId", t("Wybierz magazyn docelowy przesunięcia"));
      else if (!toWh) err("mm.toWhId", t("Nieznany magazyn"));
      else if (toWh.id === whId) err("mm.toWhId", t("Magazyn docelowy musi być inny niż magazyn źródłowy"));
      else if (toWh.active === false) err("mm.toWhId", t("Magazyn docelowy jest nieaktywny"));
      if (toWh && Dates.isISO(date) && !(ctx && ctx.correction) && isLocked(state, toWh.id, date)) err("date", t("W magazynie {w} okres {ym} jest zamknięty", { w: toWh.name, ym: lockedMonth(state, toWh.id) }), "LOCKED");
      const qty = num("mm.qty", M.qty, { gt: 0, label: N_("ilość") });
      const stockQty = qty !== null && unitOk ? Units.convert(qty, M.unit, product.unit, product, cfg) : 0;
      const onStock = product ? stockOf(product.id) : 0;
      if (product && qty !== null && stockQty > onStock + EPS) err("mm.qty", t("Nie można przesunąć {a} {u}. Dostępny stan: {b} {u}.", { a: fmtQ(stockQty), b: fmtQ(onStock), u: U(product.unit) }), "STOCK");
      norm.mm = { productId: M.productId, qty, unit: M.unit, stockQty, stockUnit: product ? product.unit : null, toWhId: toWh ? toWh.id : "", toWhName: toWh ? toWh.name : "", fromWhName: wh ? wh.name : "", onStock };
      if (product && toWh && toWh.id !== whId && stockQty > 0) {
        push("MM", product.id, -stockQty);
        push("MM", product.id, stockQty, { whId: toWh.id });
        documents.push({ type: "MM", kind: "MM", productId: product.id, qty, unit: M.unit, stockQty, stockUnit: product.unit, weightT: Units.mass(stockQty, product, cfg), value: 0, stock: "±", fromWh: wh ? wh.name : "", toWh: toWh.name, toWhId: toWh.id });
      }
    }

    /* ---------- miejsce i transport (nie dotyczy produkcji na magazyn) ---------- */
    const T = draft.transport || {};
    let transport = { mode: "none", place: "", cost: 0 };
    if (type !== "PRODUKCJA") {
      const place = str(T.place);
      if (!place) err("transport.place", t("Podaj miejsce transportu / dostawy"));
      const mode = T.mode || "none";
      transport = { mode, place, cost: 0 };
      if (!TRANSPORT_MODES[mode]) err("transport.mode", t("Nieznany tryb transportu"));
      /** Towar przewożony w operacji (jednostka magazynowa produktu). */
      const shipped = () => {
        if (norm.sale && norm.sale.productId) return { productId: norm.sale.productId, qty: norm.sale.stockQty || 0, unit: (prodOf(norm.sale.productId) || {}).unit };
        if (norm.production && norm.production.outProductId && norm.production.outQty) return { productId: norm.production.outProductId, qty: norm.production.outQty, unit: norm.production.outUnit };
        if (norm.purchase && norm.purchase.productId) return { productId: norm.purchase.productId, qty: norm.purchase.stockQty || 0, unit: norm.purchase.stockUnit };
        if (norm.mm && norm.mm.productId) return { productId: norm.mm.productId, qty: norm.mm.stockQty || 0, unit: norm.mm.stockUnit };
        return { productId: null, qty: 0, unit: null };
      };
      const shippedT = norm.sale ? norm.sale.weightT : norm.purchase ? norm.purchase.weightT : norm.mm && norm.mm.productId ? Units.mass(norm.mm.stockQty, prodOf(norm.mm.productId), cfg) : 0;
      /* Kursy transportu własnego / zewnętrznego — liczone osobno, łączone w trybie „mixed”. */
      /* Kwity wywozowe (produkcja leśna z nadleśnictwa): numer kwitu i m³ wpisywane w każdym kursie.
         m³ × 4 = MP na aucie; suma kursów nie może przekroczyć produkcji (MP) ani zużytego drewna (m³). */
      const X_ = norm.production;
      const forest = !!(X_ && X_.mode !== "stock" && X_.type === "lesna");
      const waybill = (r, K, i) => {
        const no = str(r.kwit);
        if (forest && !no) err(K(i, "kwit"), t("Podaj numer kwitu wywozowego (kurs {n})", { n: i + 1 }));
        const m3 = str(r.kwitM3) === "" ? null : num(K(i, "kwitM3"), r.kwitM3, { gt: 0, label: N_("ilość m³ z kwitu") });
        return { no, m3: m3 === null ? null : rq(m3) };
      };
      const ownPart = () => {
        const part = { kind: "own" };
        /* Transport własny: liczba kursów → osobne kursy (pojazd, kierowca, km, stawka, ilość, waga rzeczywista).
           Dane z wersji ≤ 2.1 (jeden kurs bez tablicy runs) są traktowane jako jeden kurs. */
        const O = T.own || {};
        const legacy = !Array.isArray(O.runs);
        const K = (i, f) => legacy ? `transport.own.${f}` : `transport.own.runs.${i}.${f}`;
        let count = 1;
        if (!legacy) {
          const n = num("transport.own.runCount", O.runCount, { gt: 0, integer: true, label: N_("liczbę kursów") });
          if (n !== null && n > MAX_RUNS) err("transport.own.runCount", t("Maksymalnie {n} kursów w jednej operacji", { n: MAX_RUNS }));
          count = n && n <= MAX_RUNS ? n : 0;
        }
        const src = legacy ? [O] : O.runs;
        const sp = shipped();
        const runs = [];
        for (let i = 0; i < count; i++) {
          const r = src[i] || {};
          const v = byId(state.fleet.vehicles, r.vehicleId);
          if (!r.vehicleId) err(K(i, "vehicleId"), t("Wybierz pojazd z floty"));
          else if (!v) err(K(i, "vehicleId"), t("Nieznany pojazd"));
          else if (v.status !== "aktywny") err(K(i, "vehicleId"), t("Pojazd ma status „{s}” — wybierz aktywny", { s: t(ASSET_STATUS[v.status] || v.status) }));
          else if (v.whId && whId && v.whId !== whId) err(K(i, "vehicleId"), t("Pojazd jest przypisany do magazynu {w}", { w: (byId(state.warehouses, v.whId) || {}).name || "" }));
          const driverId = r.driverId || (v && v.driverId) || "";
          const d = byId(state.fleet.drivers, driverId);
          if (!driverId) err(K(i, "driverId"), t("Pojazd nie ma kierowcy domyślnego — wybierz kierowcę"));
          else if (!d) err(K(i, "driverId"), t("Nieznany kierowca"));
          const km = num(K(i, "km"), r.km, { gt: 0, label: N_("liczbę km") });
          const rate = str(r.rate) === "" ? cfg.kmRateDefault : num(K(i, "rate"), r.rate, { gt: 0, label: N_("stawkę za km") });
          // ilość w kursie: przy jednym kursie domyślnie cała ilość operacji, przy wielu — wymagana
          const kw = waybill(r, K, i);
          let q = null;
          if (str(r.qty) !== "") q = num(K(i, "qty"), r.qty, { gt: 0, label: N_("ilość w kursie") });
          else if (kw.m3 !== null && sp.unit === "MP") q = rq(kw.m3 * cfg.m3_mp);          // m³ z kwitu × 4 = MP na aucie
          else if (count > 1) err(K(i, "qty"), sp.unit ? t("Podaj ilość przewożoną w kursie {n} ({u})", { n: i + 1, u: Units.label(sp.unit) }) : t("Podaj ilość przewożoną w kursie {n}", { n: i + 1 }));
          else q = sp.qty || null;
          const w = str(r.weightT) === "" ? null : num(K(i, "weightT"), r.weightT, { gt: 0, label: N_("wagę rzeczywistą") });
          runs.push({ no: i + 1, vehicleId: v ? v.id : "", vehicleName: v ? v.name : "", reg: v ? v.reg : "", driverId, driverName: d ? d.name : "", defaultDriverId: v ? v.driverId : "",
            driverOverridden: !!(v && d && v.driverId !== d.id), km: km || 0, rate: rate || 0, cost: km !== null && rate !== null ? round(km * rate, 2) : 0, qty: q === null ? 0 : rq(q), weightT: w, kwit: kw.no, kwitM3: kw.m3 });
        }
        const totalQty = rq(runs.reduce((a, r) => a + r.qty, 0));
        const weighed = runs.filter(r => r.weightT !== null);
        const f = runs[0] || {};
        Object.assign(part, {
          runs, runCount: runs.length, qtyUnit: sp.unit, totalQty, totalWeightT: weighed.length ? rq(weighed.reduce((a, r) => a + r.weightT, 0)) : null, weightMissing: runs.length - weighed.length,
          km: rq(runs.reduce((a, r) => a + r.km, 0)), cost: round(runs.reduce((a, r) => a + r.cost, 0), 2),
          vehicleId: f.vehicleId || "", vehicleName: f.vehicleName || "", reg: [...new Set(runs.map(r => r.reg).filter(Boolean))].join(", "),
          driverId: f.driverId || "", driverName: [...new Set(runs.map(r => r.driverName).filter(Boolean))].join(", "), defaultDriverId: f.defaultDriverId || "",
          driverOverridden: runs.some(r => r.driverOverridden), rate: f.rate || 0
        });
        if (runs.length && weighed.length < runs.length) warnings.push(t("Brak wagi rzeczywistej dla {a} z {b} kursów.", { a: runs.length - weighed.length, b: runs.length }));
        part.runs.forEach(r => { r.kind = "own"; });
        return part;
      };
      const extPart = () => {
        const part = { kind: "external" };
        /* Transport zewnętrzny: firma przewozowa + liczba kursów; każdy kurs: nr rej. auta przewoźnika, kierowca,
           km, stawka (domyślna), opcjonalnie fracht kursu z faktury, ilość, waga rzeczywista.
           Koszt kursu = fracht kursu (jeśli podany) albo km × stawka; „wliczony w cenę” → 0 zł.
           Dane ≤ 2.3 (jeden kurs bez listy: reg, km, freight) = jeden kurs z frachtem. */
        const X = T.external || {};
        if (!str(X.company)) err("transport.external.company", t("Podaj firmę transportową"));
        const included = !!X.includedInPrice;
        const legacy = !Array.isArray(X.runs);
        const K = (i, f) => legacy ? `transport.external.${f === "freight" || f === "km" || f === "reg" ? f : "runs.0." + f}` : `transport.external.runs.${i}.${f}`;
        let count = 1;
        if (!legacy) {
          const n = num("transport.external.runCount", X.runCount, { gt: 0, integer: true, label: N_("liczbę kursów") });
          if (n !== null && n > MAX_RUNS) err("transport.external.runCount", t("Maksymalnie {n} kursów w jednej operacji", { n: MAX_RUNS }));
          count = n && n <= MAX_RUNS ? n : 0;
        }
        const src = legacy ? [{ reg: X.reg, driver: "", km: X.km, rate: "", freight: included ? "" : (str(X.freight) === "" ? "0" : X.freight), qty: "", weightT: "" }] : X.runs;
        if (legacy && !included && str(X.freight) === "") err("transport.external.freight", t("Podaj kwotę frachtu"));
        const sp = shipped();
        const runs = [];
        for (let i = 0; i < count; i++) {
          const r = src[i] || {};
          if (!str(r.reg)) err(K(i, "reg"), t("Podaj numer rejestracyjny pojazdu przewoźnika"));
          const freight = str(r.freight) === "" ? null : num(K(i, "freight"), r.freight, { min: 0, label: N_("fracht kursu") });
          const needKm = !included && freight === null && !legacy;
          const km = str(r.km) === "" ? (needKm ? (err(K(i, "km"), t("Podaj liczbę km (albo fracht kursu)")), null) : 0) : num(K(i, "km"), r.km, { min: 0, label: N_("liczbę km") });
          const rate = str(r.rate) === "" ? cfg.kmRateDefault : num(K(i, "rate"), r.rate, { gt: 0, label: N_("stawkę za km") });
          const kw = waybill(r, K, i);
          let q = null;
          if (str(r.qty) !== "") q = num(K(i, "qty"), r.qty, { gt: 0, label: N_("ilość w kursie") });
          else if (kw.m3 !== null && sp.unit === "MP") q = rq(kw.m3 * cfg.m3_mp);          // m³ z kwitu × 4 = MP na aucie
          else if (count > 1) err(K(i, "qty"), sp.unit ? t("Podaj ilość przewożoną w kursie {n} ({u})", { n: i + 1, u: Units.label(sp.unit) }) : t("Podaj ilość przewożoną w kursie {n}", { n: i + 1 }));
          else q = sp.qty || null;
          const w = str(r.weightT) === "" ? null : num(K(i, "weightT"), r.weightT, { gt: 0, label: N_("wagę rzeczywistą") });
          const cost = included ? 0 : freight !== null ? round(freight, 2) : km !== null && rate !== null ? round(km * rate, 2) : 0;
          runs.push({ no: i + 1, reg: str(r.reg).toUpperCase(), driver: str(r.driver), km: km || 0, rate: rate || 0, freight, cost, costBasis: included ? N_("wliczony w cenę") : freight !== null ? N_("fracht") : N_("km × stawka"), qty: q === null ? 0 : rq(q), weightT: w, kwit: kw.no, kwitM3: kw.m3 });
        }
        const totalQty = rq(runs.reduce((a, r) => a + r.qty, 0));
        const weighed = runs.filter(r => r.weightT !== null);
        Object.assign(part, {
          company: str(X.company), includedInPrice: included, runs, runCount: runs.length, qtyUnit: sp.unit, totalQty,
          totalWeightT: weighed.length ? rq(weighed.reduce((a, r) => a + r.weightT, 0)) : null, weightMissing: runs.length - weighed.length,
          reg: [...new Set(runs.map(r => r.reg).filter(Boolean))].join(", "), driverName: [...new Set(runs.map(r => r.driver).filter(Boolean))].join(", "),
          km: rq(runs.reduce((a, r) => a + r.km, 0)), freight: round(runs.reduce((a, r) => a + (r.freight || 0), 0), 2), cost: round(runs.reduce((a, r) => a + r.cost, 0), 2)
        });
        if (!legacy && runs.length && weighed.length < runs.length) warnings.push(t("Brak wagi rzeczywistej dla {a} z {b} kursów.", { a: runs.length - weighed.length, b: runs.length }));
        part.runs.forEach(r => { r.kind = "external"; r.company = part.company; });
        return part;
      };
      if (mode === "own") Object.assign(transport, ownPart());
      else if (mode === "external") Object.assign(transport, extPart());
      else if (mode === "mixed") {
        // jedna operacja (np. produkcja w lesie → magazyn): część kursów flotą własną, część firmą zewnętrzną
        const a = ownPart(), b = extPart();
        const runs = a.runs.concat(b.runs).map((r, i) => Object.assign(r, { no: i + 1 }));
        const weighed = runs.filter(r => r.weightT !== null);
        Object.assign(transport, {
          own: a, external: b, runs, runCount: runs.length, qtyUnit: a.qtyUnit || b.qtyUnit, totalQty: rq(a.totalQty + b.totalQty),
          totalWeightT: weighed.length ? rq(weighed.reduce((s, r) => s + r.weightT, 0)) : null, weightMissing: runs.length - weighed.length,
          km: rq(a.km + b.km), cost: round(a.cost + b.cost, 2), company: b.company, includedInPrice: b.includedInPrice,
          reg: [a.reg, b.reg].filter(Boolean).join(", "), driverName: [a.driverName, b.driverName].filter(Boolean).join(", "), driverOverridden: a.driverOverridden
        });
      }
      if (["own", "external", "mixed"].includes(mode)) {
        const sp = shipped(), U = Units.label(sp.unit);
        const withM3 = transport.runs.filter(r => r.kwitM3 !== null);
        transport.totalM3 = withM3.length ? rq(withM3.reduce((a, r) => a + r.kwitM3, 0)) : null;
        transport.kwity = transport.runs.map(r => r.kwit).filter(Boolean);
        transport.limitQty = sp.qty || 0;
        transport.remainingQty = rq((sp.qty || 0) - transport.totalQty);
        // suma kursów nie może przekroczyć ilości operacji (np. produkcji)
        if (sp.qty > 0 && transport.totalQty > sp.qty + EPS) err("transport.runs", (X_ && X_.outQty ? t("Suma kursów {a} {u} przekracza ilość z produkcji {b} {u} (o {c} {u}).", { a: fmtQ(transport.totalQty), b: fmtQ(sp.qty), c: fmtQ(transport.totalQty - sp.qty), u: U }) : t("Suma kursów {a} {u} przekracza ilość operacji {b} {u} (o {c} {u}).", { a: fmtQ(transport.totalQty), b: fmtQ(sp.qty), c: fmtQ(transport.totalQty - sp.qty), u: U })));
        else if (transport.runs.length > 1 && sp.qty > 0 && sp.qty - transport.totalQty > EPS) warnings.push(t("Suma kursów {a} {u} — do rozwiezienia pozostało {b} {u} z {c} {u}. Transport nie zmienia stanu magazynowego.", { a: fmtQ(transport.totalQty), b: fmtQ(sp.qty - transport.totalQty), c: fmtQ(sp.qty), u: U }));
        const consumed = X_ && X_.consumeQty !== null && X_.consumeUnit === "m3" ? X_.consumeQty : null;
        if (consumed !== null && transport.totalM3 !== null && transport.totalM3 > consumed + EPS) err("transport.runs", t("Suma m³ z kwitów {a} m³ przekracza drewno zużyte w produkcji {b} m³.", { a: fmtQ(transport.totalM3), b: fmtQ(consumed) }));
      }
      // produkcja leśna bez kursów (brak transportu / pociąg): kwit wpisywany przy produkcji
      if (forest) {
        const hasRuns = !!(transport.runs && transport.runs.length);
        const runKw = hasRuns ? transport.runs.map(r => r.kwit).filter(Boolean) : [];
        if (!hasRuns && !str(R_.kwit)) err("production.kwit", t("Podaj numer kwitu wywozowego (bez kursów transportu kwit wpisuje się przy produkcji)"));
        X_.kwit = hasRuns ? runKw.join(", ") : str(R_.kwit);
        documents.forEach(d => { if (d.type === "PW" && d.meta) d.meta.kwit = X_.kwit; });
      }
      if (mode === "train") {
        const Tr = T.train || {};
        const n = num("transport.train.wagonCount", Tr.wagonCount, { gt: 0, integer: true, label: N_("liczbę wagonów") });
        if (n !== null && n > cfg.maxWagons) err("transport.train.wagonCount", t("Maksymalnie {n} wagonów w jednym składzie", { n: cfg.maxWagons }));
        const count = n && n <= cfg.maxWagons ? n : 0;
        const capUnit = Tr.capUnit === "MP" ? "MP" : "t";
        const capacity = str(Tr.capacity) === "" ? null : num("transport.train.capacity", Tr.capacity, { gt: 0 });
        const capT = capacity === null ? null : capUnit === "t" ? capacity : rq(capacity * cfg.mp_t);
        const tonMode = Tr.tonMode === "each" ? "each" : "same";
        const tons = [];
        if (tonMode === "same") { const t = num("transport.train.sameT", Tr.sameT, { gt: 0, label: N_("tonaż wagonu") }); for (let i = 0; i < count; i++) tons.push(t || 0); }
        else for (let i = 0; i < count; i++) tons.push(num(`transport.train.wagonT.${i}`, (Tr.wagonT || [])[i], { gt: 0, label: t("tonaż wagonu {n}", { n: i + 1 }) }) || 0);
        const totalT = rq(tons.reduce((a, b) => a + b, 0));
        if (capT) tons.forEach((tn, i) => { if (tn > capT + EPS) warnings.push(capUnit === "MP" ? t("Wagon {n}: {a} t przekracza ładowność {b} {u} ≈ {c} t", { n: i + 1, a: fmtQ(tn), b: fmtQ(capacity), u: capUnit, c: fmtQ(capT) }) : t("Wagon {n}: {a} t przekracza ładowność {b} {u}", { n: i + 1, a: fmtQ(tn), b: fmtQ(capacity), u: capUnit })); });
        if (!["MP", "m3", "t"].includes(Tr.priceUnit)) err("transport.train.priceUnit", t("Wybierz jednostkę ceny"));
        const tprice = num("transport.train.price", Tr.price, { min: 0, label: N_("cenę frachtu") });
        const totalMP = rq(totalT / cfg.mp_t);
        const basisQty = Tr.priceUnit === "t" ? totalT : Tr.priceUnit === "MP" ? totalMP : rq(totalMP / cfg.m3_mp);
        Object.assign(transport, {
          trainNo: str(Tr.trainNo), carrier: str(Tr.carrier), docNo: str(Tr.docNo), loadPlace: str(Tr.loadPlace),
          wagonCount: count, capUnit, capacity, totalCapacity: capacity !== null ? rq(capacity * count) : null,
          totalCapacityMP: capacity !== null && capUnit === "MP" ? rq(capacity * count) : null,
          tonMode, wagonT: tons, totalT, totalMP, price: tprice || 0, priceUnit: Tr.priceUnit, basisQty,
          cost: tprice !== null ? round(basisQty * tprice, 2) : 0
        });
        if (totalT > 0 && shippedT > 0 && Math.abs(totalT - shippedT) / shippedT > 0.05) warnings.push(t("Tonaż składu {a} t różni się od orientacyjnej masy ładunku {b} t. Transport nie zmienia stanu magazynowego.", { a: fmtQ(totalT), b: fmtQ(shippedT) }));
      }
      if (mode !== "none") documents.push({ type: "TR", kind: "TRANSPORT", productId: null, qty: null, unit: null, value: transport.cost, stock: "brak", transport: clone(transport) });
    } else {
      transport.place = wh ? wh.name : "";
    }
    totals.transportCost = transport.cost;
    norm.transport = transport;
    documents.forEach(d => { d.place = transport.place; });

    /* ---------- symulacja sald krok po kroku (magazyn × produkt) ---------- */
    postings.forEach((p, i) => { p.step = i + 1; p.doc = KINDS[p.kind].doc; });
    const balances = [];
    const sim = new Map();
    const key = p => `${p.whId}|${p.productId}`;
    for (const p of postings) {
      if (!p.whId) continue;
      const k = key(p);
      const before = sim.has(k) ? sim.get(k) : stockAt(p.whId, p.productId);
      const after = rq(before + p.qty);
      p.before = before; p.after = after;
      const pr = prodOf(p.productId);
      if (after < -EPS) err("_stock", t("Krok {n} ({k}) daje stan ujemny: {a} {u} w magazynie {w}", { n: p.step, k: t(KINDS[p.kind].label), a: fmtQ(after), u: U(pr ? pr.unit : ""), w: (byId(state.warehouses, p.whId) || {}).name || p.whId }), "STOCK");
      sim.set(k, after);
    }
    for (const [k, after] of sim) { const [w, pid] = k.split("|"); balances.push({ whId: w, productId: pid, before: stockAt(w, pid), after }); }
    totals.result = round(totals.revenue - totals.purchaseCost - totals.rawCost - totals.chippingCost - totals.transportCost, 2);

    const errorList = Object.keys(errors).map(k => ({ field: k, msg: errors[k] }));
    return { ok: errorList.length === 0, errors, errorCodes: codes, errorList, warnings, whId, date, type, norm, postings, balances, documents, totals, user: user ? { id: user.id, name: user.name } : null };
  }

  /* ------------------------------------------------------------------ */
  /* Numeracja, audyt                                                    */
  /* ------------------------------------------------------------------ */
  function nextNo(state, type, date) {
    const ym = Dates.ym(date), k = `${type}-${ym}`;
    state.seq[k] = (state.seq[k] || 0) + 1;
    return `${type}/${String(state.seq[k]).padStart(3, "0")}/${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
  }
  function nextLedgerSeq(state) { let m = 0; for (const l of state.ledger) if (l.seq > m) m = l.seq; return m + 1; }
  /** Wpis audytu. `act` = {k, p} (tłumaczony przy wyświetlaniu); `action` = postać kanoniczna (PL) do CSV i wyszukiwania. */
  function audit(state, ctx, rec) {
    const user = ctx && ctx.user;
    const r = Object.assign({ id: uid("a"), ts: nowIso(ctx), userId: user ? user.id : "system", userName: user ? user.name : "System", whId: user ? user.whId : null, source: (ctx && ctx.source) || N_("Aplikacja") }, rec);
    if (ctx && ctx.ip) r.ip = String(ctx.ip).slice(0, 64);
    if (ctx && ctx.ua) r.ua = String(ctx.ua).slice(0, 200);
    if (r.act && !r.action) r.action = I18N.canon(r.act);
    state.audit.push(r);
    return r;
  }
  /** Tekst akcji audytu w bieżącym języku. */
  const auditText = a => a.act ? I18N.tr(a.act) : t(a.action || "");
  const snap = (state, keys) => { const o = {}; for (const k of keys) { const [w, p] = k.split("|"); o[k] = Stock.balance(state, w, p); } return o; };
  const netKey = e => `${e.whId}|${e.productId}|${e.cat}|${e.direct ? 1 : 0}`;
  function ledgerEntry(state, seq, ctx, e) {
    const pr = byId(state.products, e.productId);
    return Object.assign({ id: uid("l"), seq, ts: nowIso(ctx), userName: ctx.user ? ctx.user.name : "System", unit: pr.unit, t: Units.mass(e.qty, pr, state.config), direct: !!e.direct }, e, { qty: rq(e.qty) });
  }

  /* ------------------------------------------------------------------ */
  /* Zapis operacji — atomowo                                            */
  /* ------------------------------------------------------------------ */
  /**
   * Zatwierdzenie operacji: numer dokumentów, zapis w księdze, audyt.
   * opts.author — autor (magazynier), gdy zatwierdza kierownik; domyślnie zatwierdzający.
   */
  function commitOperation(state, draft, ctx, opts = {}) {
    if (!draft || !draft.idemKey) return { ok: false, error: t("Brak klucza idempotencji formularza") };
    const dup = state.operations.find(o => o.idemKey === draft.idemKey);
    if (dup) return { ok: true, duplicate: true, op: dup };
    const plan = planOperation(state, draft, ctx);
    if (!plan.ok) return { ok: false, plan, error: plan.errorList[0].msg };
    const keys = [...new Set(plan.postings.map(p => `${p.whId}|${p.productId}`))];
    const before = snap(state, keys);
    const opId = uid("op");
    const docs = plan.documents.map(d => Object.assign({}, d, { no: nextNo(state, d.type, plan.date) }));
    const docNo = t => (docs.find(d => d.type === t) || {}).no || null;
    const pw = docs.find(d => d.type === "PW"), rw = docs.find(d => d.type === "RW");
    if (pw && rw) pw.meta = Object.assign({}, pw.meta, { fromDoc: rw.no });
    let seq = nextLedgerSeq(state);
    const ledger = plan.postings.map(p => ledgerEntry(state, seq++, ctx, { opId, step: p.step, date: plan.date, whId: p.whId, productId: p.productId, kind: p.kind, cat: p.cat, qty: p.qty, direct: !!p.direct, docNo: docNo(p.doc) }));
    const n = plan.norm;
    const main = plan.type === "PRODUKCJA" ? docs.find(d => d.type === "PW") : docs[0];
    const mainNo = main ? main.no : null;
    const input = clone(draft); delete input.idemKey; delete input.draftId;
    // nowy dostawca wpisany ręcznie → kartoteka kontrahentów (w tej samej, atomowej zmianie)
    if (n.purchase && n.purchase.newSupplier) {
      const ns = { id: uid("pa"), name: n.purchase.newSupplier.name, role: "supplier", kind: n.purchase.newSupplier.kind, city: "", active: true, createdAt: nowIso(ctx), createdBy: ctx.user.name };
      if (ns.kind === "nadlesnictwo") ns.lesnictwa = [];
      state.partners.push(ns);
      n.purchase.supplierId = ns.id; n.purchase.newSupplier = null;
      docs.forEach(d => { if (d.type === "PZ") d.partnerId = ns.id; });
      input.purchase.supplierId = ns.id; input.purchase.supplierName = ns.name;
      audit(state, ctx, { entity: "partner", entityId: ns.id, opNo: ns.name, event: "partner", act: Lx("Nowy dostawca ({g}) — dodany przy zakupie", { g: { t: SUPPLIER_KINDS[ns.kind].label } }), before: null, after: { nazwa: ns.name, grupa: SUPPLIER_KINDS[ns.kind].label }, source: (ctx && ctx.source) || N_("Formularz „Nowa operacja”") });
    }
    const op = {
      id: opId, idemKey: draft.idemKey, type: plan.type, no: mainNo,
      date: plan.date, whId: plan.whId, toWhId: n.mm ? n.mm.toWhId : null, status: "POSTED",
      userId: (opts.author || ctx.user).id, userName: (opts.author || ctx.user).name, createdAt: opts.submittedAt || nowIso(ctx),
      approvedById: (opts.approver || ctx.user).id, approvedByName: (opts.approver || ctx.user).name, approvedAt: nowIso(ctx),
      scope: plan.type === "ZAKUP" ? ["ZAKUP"].concat(n.production ? ["PRODUKCJA"] : []).concat(n.sale ? ["SPRZEDAZ"] : [])
        : plan.type === "PRODUKCJA" ? ["PRODUKCJA"] : plan.type === "MM" ? ["MM"] : n.sale.direct ? ["PRODUKCJA", "SPRZEDAZ"] : ["SPRZEDAZ"],
      direct: !!(n.sale && n.sale.direct),
      input, purchase: n.purchase, production: n.production, sale: n.sale, mm: n.mm,
      transport: n.transport, place: n.transport.place, notes: str(draft.notes), extDoc: str(draft.extDoc),
      documents: docs, totals: plan.totals, warnings: plan.warnings,
      original: clone({ purchase: n.purchase, production: n.production, sale: n.sale, mm: n.mm, transport: n.transport, totals: plan.totals }),
      corrections: [], cancel: null,
      valueEvents: [Object.assign({ date: plan.date, ts: nowIso(ctx), kind: "create", no: mainNo }, plan.totals)]
    };
    state.operations.push(op);
    state.ledger.push(...ledger);
    if (draft.draftId) state.drafts = state.drafts.filter(d => d.id !== draft.draftId);
    state.rev += 1;
    audit(state, ctx, {
      entity: "operation", entityId: op.id, opNo: op.no, event: "create", act: opts.author && opts.author.id !== ctx.user.id
        ? Lx("Zatwierdzenie operacji: {type} (wprowadził: {a})", { type: { t: OP_TYPES[op.type].label }, a: opts.author.name }) : op.direct ? Lx("Utworzenie i zatwierdzenie: {type} (bezpośrednia)", { type: { t: OP_TYPES[op.type].label } }) : Lx("Utworzenie i zatwierdzenie: {type}", { type: { t: OP_TYPES[op.type].label } }),
      before: { stan: before }, after: { stan: snap(state, keys), dokumenty: docs.map(d => d.no), koszty: plan.totals },
      source: (ctx && ctx.source) || N_("Formularz „Nowa operacja”")
    });
    return { ok: true, op, plan };
  }

  /* ------------------------------------------------------------------ */
  /* Wersje robocze (DRAFT) — bez wpływu na stan i bez numeru            */
  /* ------------------------------------------------------------------ */
  function saveDraft(state, draft, ctx) {
    if (!can(ctx && ctx.user, "op.create")) return { ok: false, error: t("Twoja rola nie pozwala tworzyć operacji"), code: "FORBIDDEN" };
    const id = draft.draftId || uid("dr");
    const rec = { id, status: "DRAFT", type: draft.type, draft: Object.assign(clone(draft), { draftId: id }), userId: ctx.user.id, userName: ctx.user.name, whId: ctx.user.whId, savedAt: nowIso(ctx) };
    const i = state.drafts.findIndex(d => d.id === id);
    const before = i >= 0 ? { zapisano: state.drafts[i].savedAt } : null;
    if (i >= 0) state.drafts[i] = rec; else state.drafts.push(rec);
    state.rev += 1;
    audit(state, ctx, { entity: "draft", entityId: id, opNo: "roboczy", event: "draft", act: Lx(before ? N_("Aktualizacja wersji roboczej: {type}") : N_("Zapis wersji roboczej: {type}"), { type: { t: OP_TYPES[draft.type] ? OP_TYPES[draft.type].label : "" } }), before, after: { status: "ROBOCZY" }, source: (ctx && ctx.source) || N_("Formularz „Nowa operacja”") });
    return { ok: true, id };
  }
  function deleteDraft(state, id, ctx) {
    const d = byId(state.drafts, id);
    if (!d) return { ok: false, error: t("Nie znaleziono wersji roboczej") };
    if (d.userId !== (ctx.user && ctx.user.id) && !can(ctx.user, "documents.cancel")) return { ok: false, error: t("Wersję roboczą usuwa jej autor lub kierownik"), code: "FORBIDDEN" };
    state.drafts = state.drafts.filter(x => x.id !== id); state.rev += 1;
    audit(state, ctx, { entity: "draft", entityId: id, opNo: "roboczy", event: "draft-delete", action: N_("Usunięcie wersji roboczej (niezatwierdzona — bez wpływu na stan)"), before: { status: "ROBOCZY" }, after: null, source: (ctx && ctx.source) || N_("Rejestr operacji") });
    return { ok: true };
  }

  /* ------------------------------------------------------------------ */
  /* Obieg zatwierdzania: magazynier przekazuje → kierownik zatwierdza   */
  /*   Operacja „DO ZATWIERDZENIA” nie ma numeru i nie zmienia stanów.    */
  /* ------------------------------------------------------------------ */
  /** Czy użytkownik może zatwierdzać operacje danego magazynu (kierownik — tylko swojego). */
  function canApprove(user, whId) { return can(user, "op.approve") && canAccessWh(user, whId); }
  function submitOperation(state, draft, ctx) {
    const user = ctx && ctx.user;
    if (!can(user, "op.create")) return { ok: false, error: t("Twoja rola nie pozwala tworzyć operacji"), code: "FORBIDDEN" };
    if (!draft || !draft.idemKey) return { ok: false, error: t("Brak klucza idempotencji formularza") };
    const dup = state.operations.find(o => o.idemKey === draft.idemKey);
    if (dup) return { ok: true, duplicate: true, op: dup };
    const plan = planOperation(state, draft, ctx);
    if (!plan.ok) return { ok: false, plan, error: plan.errorList[0].msg };
    const id = draft.draftId || uid("dr");
    const prev = byId(state.drafts, id);
    if (prev && prev.userId !== user.id) return { ok: false, error: t("Operację przekazuje do zatwierdzenia jej autor"), code: "FORBIDDEN" };
    const rec = { id, status: "PENDING", type: draft.type, draft: Object.assign(clone(draft), { draftId: id }), userId: user.id, userName: user.name, whId: user.whId,
      savedAt: nowIso(ctx), submittedAt: nowIso(ctx), totals: plan.totals, summary: planSummary(state, plan) };
    if (prev) state.drafts = state.drafts.map(d => d.id === id ? rec : d); else state.drafts.push(rec);
    state.rev += 1;
    audit(state, ctx, { entity: "draft", entityId: id, opNo: "—", event: "submit", act: Lx("Przekazanie do zatwierdzenia: {type}", { type: { t: OP_TYPES[draft.type].label } }), before: prev ? { status: prev.status } : null, after: { status: "DO ZATWIERDZENIA", podsumowanie: rec.summary }, source: (ctx && ctx.source) || N_("Formularz „Nowa operacja”") });
    return { ok: true, id, pending: true };
  }
  /** Krótki opis operacji do kolejki zatwierdzania (produkt, ilość, kontrahent). */
  function planSummary(state, plan) {
    const n = plan.norm, name = id => (byId(state.products, id) || {}).name || "", party = id => (byId(state.partners, id) || {}).name || "";
    const q = (v, u) => v === null || v === undefined ? "" : `${fmtQ(v)} ${Units.label(u)}`;
    if (plan.type === "ZAKUP") return [name(n.purchase.productId), q(n.purchase.qty, n.purchase.unit), party(n.purchase.supplierId) || (n.purchase.newSupplier ? n.purchase.newSupplier.name : "")].filter(Boolean).join(" · ");
    if (plan.type === "PRODUKCJA") return [name(n.production.outProductId), q(n.production.outQty, n.production.outUnit)].filter(Boolean).join(" · ");
    if (plan.type === "MM") return [name(n.mm.productId), q(n.mm.qty, n.mm.unit), (byId(state.warehouses, n.mm.toWhId) || {}).name].filter(Boolean).join(" · ");
    return [name(n.sale.productId), q(n.sale.qty, n.sale.unit), party(n.sale.buyerId)].filter(Boolean).join(" · ");
  }
  /** Zatwierdzenie operacji przekazanej przez magazyniera (opcjonalnie z poprawionym formularzem). */
  function approvePending(state, id, draftOverride, ctx) {
    const rec = byId(state.drafts, id), user = ctx && ctx.user;
    if (!rec || rec.status !== "PENDING") return { ok: false, error: t("Nie znaleziono operacji do zatwierdzenia") };
    if (!canApprove(user, rec.whId)) return { ok: false, error: t("Zatwierdzać może kierownik magazynu {w} albo administrator", { w: (byId(state.warehouses, rec.whId) || {}).name || "" }), code: "FORBIDDEN" };
    const author = byId(state.users, rec.userId) || { id: rec.userId, name: rec.userName };
    const draft = Object.assign(clone(draftOverride || rec.draft), { draftId: id, idemKey: rec.draft.idemKey });
    const c = Object.assign({}, ctx, { user: Object.assign({}, user, { whId: rec.whId }) });
    return commitOperation(state, draft, c, { author, approver: user, submittedAt: rec.submittedAt });
  }
  function rejectPending(state, id, reason, ctx) {
    const rec = byId(state.drafts, id), user = ctx && ctx.user;
    if (!rec || rec.status !== "PENDING") return { ok: false, error: t("Nie znaleziono operacji do zatwierdzenia") };
    if (!canApprove(user, rec.whId)) return { ok: false, error: t("Odrzucić może kierownik magazynu {w} albo administrator", { w: (byId(state.warehouses, rec.whId) || {}).name || "" }), code: "FORBIDDEN" };
    if (!str(reason)) return { ok: false, error: t("Podaj powód odrzucenia") };
    rec.status = "DRAFT"; rec.rejectReason = str(reason).slice(0, 300); rec.rejectedBy = user.name; rec.rejectedAt = nowIso(ctx);
    state.rev += 1;
    audit(state, ctx, { entity: "draft", entityId: id, opNo: "—", event: "reject", act: Lx("Odrzucenie operacji: {type} (wprowadził: {a})", { type: { t: OP_TYPES[rec.type].label }, a: rec.userName }), reason: rec.rejectReason, before: { status: "DO ZATWIERDZENIA" }, after: { status: "ROBOCZY" }, source: (ctx && ctx.source) || N_("Operacje do zatwierdzenia") });
    return { ok: true };
  }

  /* ------------------------------------------------------------------ */
  /* ANULOWANIE — odwrócenie skutków z analizą zależności w czasie        */
  /* ------------------------------------------------------------------ */
  function planCancel(state, opId, ctx) {
    const user = ctx && ctx.user, today = (ctx && ctx.today) || Dates.localToday();
    const op = byId(state.operations, opId);
    if (!op) return { ok: false, error: t("Nie znaleziono operacji") };
    if (op.status === "CANCELLED") return { ok: false, error: t("Dokument {no} jest już anulowany", { no: op.no }) };
    if (!can(user, "documents.cancel")) return { ok: false, error: t("Brak uprawnienia „documents.cancel” — anulowanie wymaga roli Kierownik lub Administrator"), code: "FORBIDDEN" };
    if (!canAccessWh(user, op.whId)) return { ok: false, error: t("Brak dostępu do magazynu tej operacji"), code: "FORBIDDEN" };
    const entries = state.ledger.filter(l => l.opId === op.id);
    const whs = [...new Set(entries.map(e => e.whId))];
    for (const w of whs) if (isLocked(state, w, today)) return { ok: false, error: t("Bieżący okres jest zamknięty — anulowanie niemożliwe"), code: "LOCKED" };
    const net = new Map();
    for (const e of entries) { const k = netKey(e); const c = net.get(k) || { whId: e.whId, productId: e.productId, cat: e.cat, direct: !!e.direct, qty: 0 }; c.qty = rq(c.qty + e.qty); net.set(k, c); }
    const reversal = [...net.values()].filter(x => Math.abs(x.qty) > EPS).map(x => Object.assign({}, x, { qty: -x.qty }));
    // oś czasu bez skutków tej operacji — stan nie może nigdy spaść poniżej zera
    const firstSeq = entries.length ? Math.min(...entries.map(e => e.seq)) : Infinity;
    const keys = [...new Set(entries.map(e => `${e.whId}|${e.productId}`))];
    const problems = [], dependents = new Map();
    const cancelled = new Set(state.operations.filter(o => o.status === "CANCELLED").map(o => o.id));
    for (const k of keys) {
      const [w, pid] = k.split("|");
      const rows = Stock.sorted(state.ledger.filter(l => l.whId === w && l.productId === pid));
      const opNet = rq(entries.filter(e => e.whId === w && e.productId === pid).reduce((a, e) => a + e.qty, 0));
      let bal = 0, min = 0, minAt = null;
      for (const r of rows) {
        if (r.opId === op.id) continue;
        if (r.opId && cancelled.has(r.opId)) continue;            // anulowana operacja: skutki i odwrócenie znoszą się
        bal = rq(bal + r.qty);
        if (bal < min - EPS) { min = bal; minAt = r; }
        if (opNet > EPS && r.seq > firstSeq && r.qty < 0 && r.opId && r.opId !== op.id) {
          const d = byId(state.operations, r.opId);
          if (d && d.status !== "CANCELLED") dependents.set(d.id, { id: d.id, no: d.no, date: d.date, type: OP_TYPES[d.type].label, opType: d.type, docNo: r.docNo });
        }
      }
      if (min < -EPS) {
        const pr = byId(state.products, pid);
        problems.push(t("{p} ({w}): bez tego dokumentu stan spadłby do {q} {u} ({doc} z {d})", { p: pr.name, w: (byId(state.warehouses, w) || {}).name, q: fmtQ(min), u: Units.label(pr.unit), doc: minAt.docNo || "", d: Dates.pl(minAt.date) }));
      }
    }
    const deps = [...dependents.values()];
    if (problems.length) {
      return { ok: false, blocked: true, code: "BLOCKED", dependents: deps, error: t("Nie można bezpośrednio anulować dokumentu {no}. Towar z tego dokumentu został wykorzystany w późniejszych operacjach{deps}. Najpierw należy wykonać korektę lub anulowanie operacji zależnych. {why}", { no: op.no, deps: deps.length ? ` (${deps.map(d => d.no).join(", ")})` : "", why: problems.join("; ") }) };
    }
    const rev = reversal.map(r => { const b = Stock.balance(state, r.whId, r.productId); return Object.assign({}, r, { before: b }); });
    const sim = new Map();
    for (const r of rev) { const k = `${r.whId}|${r.productId}`; const b = sim.has(k) ? sim.get(k) : r.before; r.before = b; r.after = rq(b + r.qty); sim.set(k, r.after); }
    const valueDelta = {}; for (const k of Object.keys(op.totals)) valueDelta[k] = round(-op.totals[k], 2);
    return { ok: true, op, reversal: rev, dependents: deps, needAck: deps.length > 0, valueDelta };
  }
  function cancelOperation(state, opId, ctx, reason, opts = {}) {
    if (!str(reason)) return { ok: false, error: t("Podaj przyczynę anulowania") };
    const pc = planCancel(state, opId, ctx);
    if (!pc.ok) return pc;
    if (pc.needAck && !opts.ack) return { ok: false, needAck: true, code: "NEED_ACK", dependents: pc.dependents, error: t("Po dokumencie wykonano operacje na tym samym towarze ({list}). Potwierdź, że anulowanie jest zamierzone.", { list: pc.dependents.map(d => d.no).join(", ") }) };
    const op = pc.op, today = (ctx && ctx.today) || Dates.localToday();
    const keys = [...new Set(pc.reversal.map(r => `${r.whId}|${r.productId}`))];
    const before = snap(state, keys);
    const no = nextNo(state, "AN", today);
    let seq = nextLedgerSeq(state);
    state.ledger.push(...pc.reversal.map((r, i) => ledgerEntry(state, seq++, ctx, { opId: op.id, step: 200 + i, date: today, whId: r.whId, productId: r.productId, kind: "ANULOWANIE", cat: r.cat, qty: r.qty, direct: r.direct, docNo: no, refDoc: op.no })));
    const prevStatus = op.status;
    op.status = "CANCELLED";
    op.cancel = { no, date: today, ts: nowIso(ctx), reason: str(reason), userId: ctx.user.id, userName: ctx.user.name, ack: !!opts.ack, dependents: pc.dependents, effect: pc.reversal.map(r => ({ whId: r.whId, productId: r.productId, qty: r.qty, before: r.before, after: r.after })) };
    op.valueEvents.push(Object.assign({ date: today, ts: nowIso(ctx), kind: "cancel", no }, pc.valueDelta));
    state.rev += 1;
    audit(state, ctx, { entity: "operation", entityId: op.id, opNo: op.no, relatedNo: no, event: "cancel", action: N_("Anulowanie dokumentu"), before: { status: STATUS[prevStatus], stan: before }, after: { status: STATUS.CANCELLED, dokument: no, stan: snap(state, keys) }, reason: str(reason), source: (ctx && ctx.source) || N_("Anulowanie") });
    return { ok: true, no, op };
  }

  /* ------------------------------------------------------------------ */
  /* KOREKTA — nowy dokument z różnicą; pełna walidacja jak zwykła operacja */
  /* ------------------------------------------------------------------ */
  const CORR_FIELDS = [
    ["purchase.qty", N_("Ilość zakupu"), o => o.purchase && o.purchase.qty, o => o.purchase && Units.label(o.purchase.unit)],
    ["purchase.price", N_("Cena zakupu"), o => o.purchase && o.purchase.price, () => "zł"],
    ["purchase.supplierId", N_("Dostawca"), o => o.purchase && o.purchase.supplierId],
    ["sale.qty", N_("Ilość sprzedaży"), o => o.sale && o.sale.qty, o => o.sale && Units.label(o.sale.unit)],
    ["sale.price", N_("Cena sprzedaży"), o => o.sale && o.sale.price, () => "zł"],
    ["sale.buyerId", N_("Odbiorca"), o => o.sale && o.sale.buyerId],
    ["production.outQty", N_("Produkcja"), o => o.production && o.production.outQty, o => o.production && Units.label(o.production.outUnit)],
    ["production.consumeQty", N_("Zużycie surowca"), o => o.production && o.production.consumeQty, o => o.production && Units.label(o.production.consumeUnit)],
    ["production.chipRate", N_("Cena za rąbanie"), o => o.production && o.production.chipRate, () => "zł/MP"],
    ["mm.qty", N_("Ilość MM"), o => o.mm && o.mm.qty, o => o.mm && Units.label(o.mm.unit)],
    ["transport.place", N_("Miejsce dostawy"), o => o.transport && o.transport.place],
    ["transport.reg", N_("Nr rejestracyjny"), o => o.transport && o.transport.reg],
    ["transport.driverName", N_("Kierowca"), o => o.transport && o.transport.driverName],
    ["transport.cost", N_("Koszt transportu"), o => o.transport && o.transport.cost, () => "zł"],
    ["notes", N_("Uwagi"), o => o.notes],
    ["extDoc", N_("Nr dokumentu zewnętrznego"), o => o.extDoc]
  ];
  function planCorrection(state, opId, newDraft, ctx) {
    const user = ctx && ctx.user, today = (ctx && ctx.today) || Dates.localToday();
    const op = byId(state.operations, opId);
    if (!op) return { ok: false, error: t("Nie znaleziono operacji") };
    if (op.status === "CANCELLED") return { ok: false, error: t("Dokument {no} jest anulowany — nie można go korygować. Wprowadź nową operację.", { no: op.no }) };
    if (!can(user, "documents.correct")) return { ok: false, error: t("Brak uprawnienia „{p}”", { p: "documents.correct" }), code: "FORBIDDEN" };
    if (!can(user, OP_TYPES[op.type].correctPerm)) return { ok: false, error: t("Brak uprawnienia „{p}”", { p: OP_TYPES[op.type].correctPerm }), code: "FORBIDDEN" };
    if (!canAccessWh(user, op.whId)) return { ok: false, error: t("Brak dostępu do magazynu tej operacji"), code: "FORBIDDEN" };
    if (newDraft.type !== op.type || !!(newDraft.sale && newDraft.sale.direct) !== !!op.direct) return { ok: false, error: t("Korekta nie może zmienić rodzaju operacji — anuluj i wprowadź nową") };
    const d = Object.assign(clone(newDraft), { date: op.date, idemKey: "corr" });
    // stan „bez tej operacji” — nowa wersja przechodzi te same zabezpieczenia co zwykła operacja
    const view = Object.assign({}, state, { ledger: state.ledger.filter(l => l.opId !== op.id) });
    const p = planOperation(view, d, Object.assign({}, ctx, { user: Object.assign({}, user, { whId: op.whId }), correction: true }));
    if (!p.ok) return { ok: false, plan: p, error: p.errorList[0].msg };
    const cur = new Map(), tgt = new Map();
    for (const e of state.ledger.filter(l => l.opId === op.id)) { const k = netKey(e); const c = cur.get(k) || { whId: e.whId, productId: e.productId, cat: e.cat, direct: !!e.direct, qty: 0 }; c.qty = rq(c.qty + e.qty); cur.set(k, c); }
    for (const e of p.postings) { const k = netKey(e); const c = tgt.get(k) || { whId: e.whId, productId: e.productId, cat: e.cat, direct: !!e.direct, qty: 0 }; c.qty = rq(c.qty + e.qty); tgt.set(k, c); }
    const deltas = [];
    for (const k of new Set([...cur.keys(), ...tgt.keys()])) {
      const a = cur.get(k), b = tgt.get(k), base = a || b;
      const q = rq((b ? b.qty : 0) - (a ? a.qty : 0));
      if (Math.abs(q) > EPS) deltas.push({ whId: base.whId, productId: base.productId, cat: base.cat, direct: base.direct, qty: q });
    }
    for (const w of new Set(deltas.map(x => x.whId))) if (isLocked(state, w, today)) return { ok: false, error: t("Bieżący okres jest zamknięty — korekta niemożliwa"), code: "LOCKED" };
    const sim = new Map();
    for (const x of deltas.slice().sort((a, b) => b.qty - a.qty)) {   // najpierw przychody, potem rozchody
      const k = `${x.whId}|${x.productId}`;
      x.before = sim.has(k) ? sim.get(k) : Stock.balance(state, x.whId, x.productId);
      x.after = rq(x.before + x.qty); sim.set(k, x.after);
      if (x.after < -EPS) { const pr = byId(state.products, x.productId); return { ok: false, code: "STOCK", error: t("Korekta niemożliwa: stan „{p}” spadłby do {a} {u}. Dostępny stan: {b} {u}.", { p: pr.name, a: fmtQ(x.after), b: fmtQ(x.before), u: Units.label(pr.unit) }) }; }
    }
    const nextOp = { purchase: p.norm.purchase, production: p.norm.production, sale: p.norm.sale, mm: p.norm.mm, transport: p.norm.transport, notes: str(d.notes), extDoc: str(d.extDoc) };
    const partner = id => (byId(state.partners, id) || {}).name || id || "";
    const changes = [];
    for (const [f, label, get, unit] of CORR_FIELDS) {
      const a = get(op), b = get(nextOp);
      if ((a == null || a === "") && (b == null || b === "")) continue;
      const same = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= EPS : String(a == null ? "" : a) === String(b == null ? "" : b);
      if (same) continue;
      const u = unit ? (unit(op) || unit(nextOp) || "") : "";
      const show = v => /Id$/.test(f) ? partner(v) : typeof v === "number" ? fmtQ(v) + (u ? " " + u : "") : String(v == null ? "" : v);
      changes.push({ field: f, label, before: a, after: b, beforeText: show(a), afterText: show(b), diff: typeof a === "number" && typeof b === "number" ? rq(b - a) : null, unit: u });
    }
    const valueDelta = {}; let valueChanged = false;
    for (const k of Object.keys(p.totals)) { valueDelta[k] = round(p.totals[k] - (op.totals[k] || 0), 2); if (Math.abs(valueDelta[k]) > 0.004) valueChanged = true; }
    if (!changes.length && !deltas.length && !valueChanged) return { ok: false, code: "NO_CHANGE", error: t("Korekta nie zawiera żadnej zmiany") };
    return { ok: true, op, plan: p, nextOp, deltas, changes, valueDelta, valueChanged, descriptiveOnly: !deltas.length && !valueChanged, totalsBefore: op.totals, totalsAfter: p.totals };
  }
  function correctOperation(state, opId, newDraft, reason, ctx, opts = {}) {
    if (!str(reason)) return { ok: false, error: t("Podaj powód korekty — pole nie może być puste") };
    const op0 = byId(state.operations, opId);
    if (op0 && opts.corrKey && op0.corrections.some(c => c.corrKey === opts.corrKey)) return { ok: true, duplicate: true, op: op0 };
    if (op0 && opts.reverses) {
      const last = op0.corrections[op0.corrections.length - 1];
      if (!last || last.no !== opts.reverses) return { ok: false, error: t("Odwrócić można tylko ostatnią korektę dokumentu ({no}). Wcześniejsze korekty odwraca się po kolei.", { no: last ? last.no : t("brak korekt") }) };
      if (last.reverses) return { ok: false, error: t("Korekta {no} sama jest odwróceniem — wprowadź nową korektę.", { no: last.no }) };
    }
    const pc = planCorrection(state, opId, newDraft, ctx);
    if (!pc.ok) return pc;
    const op = pc.op, today = (ctx && ctx.today) || Dates.localToday();
    const keys = [...new Set(pc.deltas.map(x => `${x.whId}|${x.productId}`))];
    const before = snap(state, keys);
    const no = nextNo(state, "KOR", today);
    let seq = nextLedgerSeq(state);
    state.ledger.push(...pc.deltas.map((x, i) => ledgerEntry(state, seq++, ctx, { opId: op.id, step: 100 + op.corrections.length * 10 + i, date: today, whId: x.whId, productId: x.productId, kind: "KOREKTA", cat: x.cat, qty: x.qty, direct: x.direct, docNo: no, refDoc: op.no })));
    const rec = { no, date: today, ts: nowIso(ctx), reason: str(reason), userId: ctx.user.id, userName: ctx.user.name, corrKey: opts.corrKey || null, reverses: opts.reverses || null, inputBefore: clone(op.input),
      changes: pc.changes, deltas: pc.deltas, valueDelta: pc.valueDelta, descriptiveOnly: pc.descriptiveOnly, totalsBefore: pc.totalsBefore, totalsAfter: pc.totalsAfter };
    op.corrections.push(rec);
    const prevStatus = op.status;
    op.input = Object.assign(clone(newDraft), { date: op.date }); delete op.input.idemKey; delete op.input.draftId;
    Object.assign(op, pc.nextOp, { place: pc.nextOp.transport.place, totals: pc.plan.totals, status: "CORRECTED" });
    if (pc.valueChanged) op.valueEvents.push(Object.assign({ date: today, ts: nowIso(ctx), kind: "correct", no }, pc.valueDelta));
    state.rev += 1;
    audit(state, ctx, { entity: "operation", entityId: op.id, opNo: op.no, relatedNo: no, event: opts.reverses ? "correction-reverse" : "correction", act: opts.reverses ? Lx("Odwrócenie korekty {no}", { no: opts.reverses }) : Lx(pc.descriptiveOnly ? N_("Korekta danych opisowych") : N_("Korekta dokumentu")),
      before: { status: STATUS[prevStatus], stan: before, wartosci: pc.changes.map(c => `${c.label}: ${c.beforeText}`) },
      after: { status: STATUS.CORRECTED, dokument: no, stan: snap(state, keys), wartosci: pc.changes.map(c => `${c.label}: ${c.afterText}`) }, reason: str(reason), source: (ctx && ctx.source) || N_("Korekta") });
    return { ok: true, no, op, correction: rec };
  }

  /** Odwrócenie ostatniej korekty = nowa korekta przywracająca dane sprzed niej (korekt się nie usuwa). */
  function reverseCorrection(state, opId, corrNo, reason, ctx) {
    const op = byId(state.operations, opId);
    if (!op) return { ok: false, error: t("Nie znaleziono operacji") };
    const c = op.corrections.find(x => x.no === corrNo);
    if (!c) return { ok: false, error: t("Nie znaleziono korekty") };
    return correctOperation(state, opId, Object.assign(clone(c.inputBefore), { type: op.type }), reason, ctx, { reverses: corrNo });
  }

  /** Rejestracja wydruku / PDF: numer dokumentu raportu i ślad w audycie (kto, kiedy, jaki zakres). */
  function registerPrint(state, ctx, info) {
    const today = (ctx && ctx.today) || Dates.localToday();
    const kind = info.kind === "KWIT" ? "KP" : info.kind === "DOC" ? "WYD" : "RAP";
    const no = nextNo(state, kind, today);
    state.rev += 1;
    audit(state, ctx, { entity: "report", entityId: no, opNo: no, event: "print", act: Lx(info.format === "pdf" ? N_("Wygenerowanie PDF: {title}") : N_("Wydruk: {title}"), { title: String(info.title || "").slice(0, 200) }), before: null, after: { zakres: info.range || "", magazyn: info.wh || "", format: info.format }, source: (ctx && ctx.source) || N_("Raporty") });
    return { ok: true, no };
  }

  /** Bilans otwarcia (dane przykładowe / migracja). */
  function openingBalance(state, whId, date, lines, ctx) {
    const no = nextNo(state, "BO", date);
    let seq = nextLedgerSeq(state);
    for (const ln of lines) state.ledger.push(ledgerEntry(state, seq++, ctx, { opId: null, step: 1, date, whId, productId: ln.productId, kind: "BO", cat: "BO", qty: ln.qty, docNo: no }));
    state.rev += 1;
    audit(state, ctx, { entity: "ledger", entityId: no, opNo: no, event: "create", action: N_("Bilans otwarcia"), before: null, after: { magazyn: whId, pozycje: lines.length }, source: (ctx && ctx.source) || N_("Migracja") });
    return no;
  }

  /* ------------------------------------------------------------------ */
  /* Inwentaryzacja miesięczna / zamknięcie miesiąca                      */
  /* ------------------------------------------------------------------ */
  const Inventory = {
    find(state, whId, ym) { return state.inventory.find(p => p.whId === whId && p.ym === ym) || null; },
    cutoff(ym, today) { const end = Dates.monthEnd(ym); return end < today ? end : today; },
    open(state, ym, ctx) {
      const user = ctx && ctx.user, today = (ctx && ctx.today) || Dates.localToday();
      if (!can(user, "inv.open")) return { ok: false, error: t("Twoja rola nie pozwala otwierać okresów"), code: "FORBIDDEN" };
      if (!Dates.isYM(ym)) return { ok: false, error: t("Podaj miesiąc w formacie RRRR-MM") };
      if (ym > Dates.ym(today)) return { ok: false, error: t("Nie można otworzyć okresu z przyszłości") };
      if (this.find(state, user.whId, ym)) return { ok: false, error: t("Okres {ym} już istnieje", { ym }) };
      const locked = lockedMonth(state, user.whId);
      if (locked && ym <= locked) return { ok: false, error: t("Miesiące do {ym} włącznie są już zamknięte", { ym: locked }) };
      const p = { id: uid("inv"), whId: user.whId, ym, status: "OTWARTA", openedAt: nowIso(ctx), openedBy: user.name, generatedAt: null, closedAt: null, closedBy: null, auto: false, docNo: null, lines: [] };
      state.inventory.push(p); state.rev += 1;
      audit(state, ctx, { entity: "inventory", entityId: p.id, opNo: ym, event: "inv", action: N_("Otwarcie okresu inwentaryzacji"), before: null, after: { okres: ym, status: "OTWARTA" }, source: (ctx && ctx.source) || N_("Moduł Inwentaryzacja") });
      return { ok: true, period: p };
    },
    generate(state, ym, ctx) {
      const user = ctx && ctx.user, today = (ctx && ctx.today) || Dates.localToday();
      if (!can(user, "inv.count")) return { ok: false, error: t("Brak uprawnień"), code: "FORBIDDEN" };
      const p = this.find(state, user.whId, ym);
      if (!p) return { ok: false, error: t("Najpierw otwórz okres") };
      if (p.status !== "OTWARTA") return { ok: false, error: t("Okres jest zamknięty — tylko do odczytu") };
      const cut = this.cutoff(ym, today), book = Stock.byProduct(state, user.whId, cut), prev = new Map(p.lines.map(l => [l.productId, l]));
      const lines = [];
      for (const pr of state.products) {
        const q = book.get(pr.id) || 0, old = prev.get(pr.id);
        if (Math.abs(q) < EPS && !old) continue;
        lines.push({ productId: pr.id, unit: pr.unit, bookQty: rq(q), countQty: old ? old.countQty : null, countText: old ? old.countText : "" });
      }
      const before = { pozycje: p.lines.length };
      p.lines = lines; p.generatedAt = nowIso(ctx); p.cutoff = cut; state.rev += 1;
      audit(state, ctx, { entity: "inventory", entityId: p.id, opNo: ym, event: "inv", action: N_("Wygenerowanie listy spisowej"), before, after: { pozycje: lines.length, stan_na: cut }, source: (ctx && ctx.source) || N_("Moduł Inwentaryzacja") });
      return { ok: true, period: p };
    },
    setCount(state, ym, productId, text, ctx) {
      const user = ctx && ctx.user;
      if (!can(user, "inv.count")) return { ok: false, error: t("Brak uprawnień"), code: "FORBIDDEN" };
      const p = this.find(state, user.whId, ym);
      if (!p) return { ok: false, error: t("Brak okresu") };
      if (p.status !== "OTWARTA") return { ok: false, error: t("Okres jest zamknięty — tylko do odczytu") };
      const line = p.lines.find(l => l.productId === productId);
      if (!line) return { ok: false, error: t("Brak pozycji na liście") };
      const before = { spis: line.countQty };
      if (str(text) === "") { line.countQty = null; line.countText = ""; }
      else {
        const r = NumParse.parse(text);
        if (!r.ok) return { ok: false, error: r.error };
        if (r.value < 0) return { ok: false, error: t("Stan ze spisu nie może być ujemny") };
        line.countQty = rq(r.value); line.countText = str(text);
      }
      state.rev += 1;
      audit(state, ctx, { entity: "inventory", entityId: p.id, opNo: ym, event: "inv", action: N_("Wpis stanu ze spisu"), before, after: { produkt: productId, spis: line.countQty, jednostka: line.unit }, source: (ctx && ctx.source) || N_("Moduł Inwentaryzacja") });
      return { ok: true, line };
    },
    close(state, ym, ctx, opts = {}) {
      const user = ctx && ctx.user, today = (ctx && ctx.today) || Dates.localToday();
      const whId = opts.whId || (user && user.whId);
      if (!opts.auto && !can(user, "inv.close")) return { ok: false, error: t("Zamknięcie okresu wymaga roli Kierownik lub Administrator"), code: "FORBIDDEN" };
      const p = this.find(state, whId, ym);
      if (!p) return { ok: false, error: t("Brak okresu") };
      if (p.status !== "OTWARTA") return { ok: false, error: t("Okres jest już zamknięty") };
      if (!p.lines.length && !opts.auto) return { ok: false, error: t("Wygeneruj listę spisową przed zamknięciem") };
      const missing = p.lines.filter(l => l.countQty === null);
      if (missing.length && !opts.auto) return { ok: false, error: t("Brak stanu ze spisu dla {n} pozycji", { n: missing.length }) };
      const cut = this.cutoff(ym, today), book = Stock.byProduct(state, whId, cut), diffs = [];
      for (const l of p.lines) {
        l.bookQty = rq(book.get(l.productId) || 0);
        if (l.countQty === null) { l.countQty = l.bookQty; l.assumed = true; }
        l.diff = rq(l.countQty - l.bookQty);
        if (Math.abs(l.diff) > EPS) diffs.push({ productId: l.productId, qty: l.diff });
      }
      for (const d of diffs) if (Stock.balance(state, whId, d.productId) + d.qty < -EPS) return { ok: false, error: t("Różnica dla „{p}” dałaby dziś stan ujemny — sprawdź operacje po {d}", { p: (byId(state.products, d.productId) || {}).name, d: cut }) };
      let docNo = null;
      if (diffs.length) {
        docNo = nextNo(state, "IN", cut);
        let seq = nextLedgerSeq(state);
        const c = Object.assign({}, ctx, { user: user || { name: "System" } });
        for (const d of diffs) state.ledger.push(ledgerEntry(state, seq++, c, { opId: null, invId: p.id, step: 1, date: cut, whId, productId: d.productId, kind: "INW", cat: "INW", qty: d.qty, docNo }));
      }
      p.status = "ZAMKNIETA"; p.closedAt = nowIso(ctx); p.closedBy = opts.auto ? N_("System (przełom miesiąca)") : user.name; p.auto = !!opts.auto; p.docNo = docNo; p.cutoff = cut;
      state.rev += 1;
      audit(state, ctx, { entity: "inventory", entityId: p.id, opNo: ym, event: "inv", action: opts.auto ? N_("Automatyczne zamknięcie okresu") : N_("Zamknięcie miesiąca / okresu inwentaryzacji"), before: { status: "OTWARTA" }, after: { status: "ZAMKNIĘTA", dokument: docNo, roznice: diffs.length, przyjeto_stan_ksiegowy: missing.length }, source: opts.auto ? N_("Automat: początek kolejnego miesiąca") : ((ctx && ctx.source) || N_("Moduł Inwentaryzacja")) });
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
      vehicles: { label: N_("Pojazd"), fields: ["name", "reg", "type", "status", "driverId", "whId"] },
      drivers: { label: N_("Kierowca"), fields: ["name", "phone", "whId"] },
      chippers: { label: N_("Rębak"), fields: ["name", "status", "operatorId", "whId"] },
      operators: { label: N_("Operator rębaka"), fields: ["name", "phone", "whId"] }
    },
    /** Czy zasób występuje w zapisanych operacjach lub wersjach roboczych (wtedy nie usuwa się go — tylko wycofuje). */
    used(state, id) {
      const needle = `"${id}"`;
      return state.operations.some(o => JSON.stringify([o.input, o.transport, o.production]).includes(needle)) || state.drafts.some(d => JSON.stringify(d.draft).includes(needle));
    },
    validate(state, kind, rec) {
      const e = {}, list = state.fleet[kind];
      if (!str(rec.name)) e.name = t("Podaj nazwę");
      if (str(rec.whId) && !byId(state.warehouses, rec.whId)) e.whId = t("Nieznany magazyn");
      if (kind === "vehicles") {
        const reg = str(rec.reg).toUpperCase().replace(/\s+/g, " ");
        if (!reg) e.reg = t("Podaj numer rejestracyjny");
        else if (!/^[A-Z0-9 ]{4,10}$/.test(reg)) e.reg = t("Numer rejestracyjny: litery i cyfry, 4–10 znaków (np. SGL 4T821)");
        else if (list.some(v => v.id !== rec.id && v.reg.replace(/\s/g, "") === reg.replace(/\s/g, ""))) e.reg = t("Taki numer rejestracyjny już istnieje");
        if (!VEHICLE_TYPES[rec.type]) e.type = t("Wybierz typ pojazdu");
        if (!ASSET_STATUS[rec.status]) e.status = t("Wybierz status");
        if (!byId(state.fleet.drivers, rec.driverId)) e.driverId = t("Wybierz kierowcę domyślnego");
      }
      if (kind === "chippers") {
        if (!ASSET_STATUS[rec.status]) e.status = t("Wybierz status");
        if (!byId(state.fleet.operators, rec.operatorId)) e.operatorId = t("Wybierz operatora domyślnego");
      }
      if ((kind === "drivers" || kind === "operators") && list.some(x => x.id !== rec.id && x.name.toLowerCase() === str(rec.name).toLowerCase())) e.name = t("Taka osoba już istnieje");
      return e;
    },
    save(state, kind, rec, ctx) {
      if (!this.KINDS[kind]) return { ok: false, error: t("Nieznana kartoteka") };
      if (!can(ctx && ctx.user, "fleet.edit")) return { ok: false, error: t("Edycja floty wymaga roli Kierownik lub Administrator"), code: "FORBIDDEN" };
      const e = this.validate(state, kind, rec);
      if (Object.keys(e).length) return { ok: false, errors: e, error: Object.values(e)[0] };
      const list = state.fleet[kind], clean = { id: rec.id || uid(kind.slice(0, 2)) };
      for (const f of this.KINDS[kind].fields) clean[f] = f === "reg" ? str(rec.reg).toUpperCase().replace(/\s+/g, " ") : str(rec[f]);
      const idx = list.findIndex(x => x.id === clean.id), before = idx >= 0 ? clone(list[idx]) : null;
      if (idx >= 0) list[idx] = Object.assign({}, list[idx], clean); else list.push(clean);
      state.rev += 1;
      audit(state, ctx, { entity: "fleet", entityId: clean.id, opNo: clean.name, event: "fleet", act: Lx(before ? N_("Zmiana: {k}") : N_("Dodanie: {k}"), { k: { t: this.KINDS[kind].label } }), before, after: clean, source: (ctx && ctx.source) || N_("Moduł Flota") });
      return { ok: true, rec: clean };
    },
    remove(state, kind, id, ctx) {
      if (!this.KINDS[kind]) return { ok: false, error: t("Nieznana kartoteka") };
      if (!can(ctx && ctx.user, "fleet.edit")) return { ok: false, error: t("Brak uprawnień"), code: "FORBIDDEN" };
      const list = state.fleet[kind], rec = byId(list, id);
      if (!rec) return { ok: false, error: t("Nie znaleziono") };
      if (kind === "drivers" && state.fleet.vehicles.some(v => v.driverId === id)) return { ok: false, error: t("Kierowca jest domyślny dla pojazdu — najpierw zmień przypisanie") };
      if (kind === "operators" && state.fleet.chippers.some(c => c.operatorId === id)) return { ok: false, error: t("Operator jest domyślny dla rębaka — najpierw zmień przypisanie") };
      if ((kind === "vehicles" || kind === "chippers") && this.used(state, id)) return { ok: false, error: t("Pojazd lub rębak występuje w operacjach — nie można go usunąć; ustaw status „Wycofany” (historia kursów zostaje)") };
      state.fleet[kind] = list.filter(x => x.id !== id); state.rev += 1;
      audit(state, ctx, { entity: "fleet", entityId: id, opNo: rec.name, event: "fleet", act: Lx("Usunięcie: {k}", { k: { t: this.KINDS[kind].label } }), before: rec, after: null, source: (ctx && ctx.source) || N_("Moduł Flota") });
      return { ok: true };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Kartoteki: produkty, kontrahenci, magazyny                          */
  /*   Rekordów użytych w dokumentach nie usuwa się — tylko dezaktywacja. */
  /* ------------------------------------------------------------------ */
  const CAT_UNIT = { drewno: "m3", zrebka: "MP", agro: "t" };
  /** Kontrola sumy NIP (10 cyfr, wagi 6-5-7-2-3-4-5-6-7). Pusty NIP jest dozwolony. */
  function nipValid(v) {
    const d = String(v || "").replace(/[\s-]/g, "");
    if (!d) return true;
    if (!/^\d{10}$/.test(d)) return false;
    const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
    const sum = w.reduce((a, x, i) => a + x * Number(d[i]), 0);
    return sum % 11 === Number(d[9]);
  }
  const Master = {
    KINDS: {
      products: { label: N_("Produkt"), prefix: "pr", fields: ["code", "name", "cat", "unit", "tPerUnit", "active"] },
      partners: { label: N_("Kontrahent"), prefix: "pa", fields: ["name", "role", "kind", "city", "address", "nip", "phone", "email", "lesnictwa", "active"] },
      warehouses: { label: N_("Magazyn"), prefix: "wh", fields: ["code", "name", "address", "active"] }
    },
    usedProduct(state, id) { return state.ledger.some(l => l.productId === id) || state.operations.some(o => JSON.stringify(o.input || {}).includes(`"${id}"`)); },
    validate(state, kind, rec) {
      const e = {}, list = state[kind], same = (a, b) => str(a).toLowerCase() === str(b).toLowerCase();
      const other = x => x.id !== rec.id;
      if (!str(rec.name) || str(rec.name).length < 2) e.name = t("Podaj nazwę (co najmniej 2 znaki)");
      else if (list.some(x => other(x) && same(x.name, rec.name))) e.name = t("Taka nazwa już istnieje");
      if (kind === "products" || kind === "warehouses") {
        const code = str(rec.code).toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9-]{1,11}$/.test(code)) e.code = t("Kod: 2–12 znaków (litery, cyfry, myślnik)");
        else if (list.some(x => other(x) && same(x.code, code))) e.code = t("Taki kod już istnieje");
      }
      if (kind === "products") {
        if (!PRODUCT_CATS[rec.cat]) e.cat = t("Wybierz kategorię");
        else if (rec.unit !== CAT_UNIT[rec.cat]) e.unit = t("Dla kategorii „{c}” jednostką magazynową jest {u}", { c: t(PRODUCT_CATS[rec.cat]), u: Units.label(CAT_UNIT[rec.cat]) });
        const prev = byId(list, rec.id);
        if (prev && prev.unit !== rec.unit && this.usedProduct(state, rec.id)) e.unit = t("Produkt ma ruchy w księdze — jednostki magazynowej nie można zmienić");
        if (str(rec.tPerUnit) !== "" && rec.tPerUnit !== null && rec.tPerUnit !== undefined) {
          const r = NumParse.parse(rec.tPerUnit);
          if (!r.ok || !(r.value > 0) || r.value > 5) e.tPerUnit = t("Masa jednostki: liczba większa od 0 (t)");
        }
      }
      if (kind === "partners") {
        if (!PARTNER_ROLES[rec.role]) e.role = t("Wybierz rolę kontrahenta");
        if (rec.role !== "buyer" && !SUPPLIER_KINDS[rec.kind]) e.kind = t("Wybierz grupę dostawcy");
        if (!nipValid(rec.nip)) e.nip = t("Niepoprawny NIP (10 cyfr z sumą kontrolną)");
        if (str(rec.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(rec.email))) e.email = t("Niepoprawny adres e-mail");
      }
      if (kind === "warehouses" && rec.active === false) {
        const prev = byId(list, rec.id);
        if (prev) {
          const stock = Stock.byProduct(state, prev.id);
          if ([...stock.values()].some(q => Math.abs(q) > EPS)) e.active = t("Magazyn ma niezerowe stany — nie można go dezaktywować");
          else if (state.users.some(u => u.whId === prev.id && u.active !== false)) e.active = t("Do magazynu są przypisani aktywni użytkownicy — najpierw zmień ich magazyn");
        }
      }
      if (kind === "products" && rec.active === false) {
        const prev = byId(list, rec.id);
        if (prev && [...Stock.byProduct(state, null).entries()].some(([pid, q]) => pid === prev.id && Math.abs(q) > EPS)) e.active = t("Produkt ma niezerowy stan — nie można go dezaktywować");
      }
      return e;
    },
    save(state, kind, rec, ctx) {
      const K = this.KINDS[kind];
      if (!K) return { ok: false, error: t("Nieznana kartoteka") };
      if (!can(ctx && ctx.user, "master.edit")) return { ok: false, error: t("Edycja kartotek wymaga roli Kierownik lub Administrator"), code: "FORBIDDEN" };
      if (kind === "warehouses" && !can(ctx.user, "warehouses.edit")) return { ok: false, error: t("Magazyny dodaje i zmienia administrator"), code: "FORBIDDEN" };
      const prev = rec.id ? byId(state[kind], rec.id) : null;
      if (rec.id && !prev) return { ok: false, error: t("Nie znaleziono") };
      const r = Object.assign({}, prev || {}, rec);
      r.active = rec.active === undefined ? (prev ? prev.active !== false : true) : !!rec.active && rec.active !== "false";
      if (kind === "products") { r.code = str(r.code).toUpperCase(); if (!r.unit) r.unit = CAT_UNIT[r.cat]; }
      if (kind === "warehouses") r.code = str(r.code).toUpperCase();
      if (kind === "partners") {
        if (r.role === "buyer") delete r.kind;
        r.nip = str(r.nip).replace(/[\s-]/g, "");
        r.lesnictwa = (Array.isArray(r.lesnictwa) ? r.lesnictwa : str(r.lesnictwa).split(/[,;\n]/)).map(str).filter(Boolean);
        if (r.kind !== "nadlesnictwo") delete r.lesnictwa;
      }
      const e = this.validate(state, kind, r);
      if (Object.keys(e).length) return { ok: false, errors: e, error: Object.values(e)[0] };
      const clean = { id: prev ? prev.id : uid(K.prefix) };
      for (const f of K.fields) if (r[f] !== undefined) clean[f] = typeof r[f] === "string" ? str(r[f]) : r[f];
      if (kind === "products") clean.tPerUnit = str(r.tPerUnit) === "" || r.tPerUnit == null ? undefined : rq(NumParse.value(r.tPerUnit, 0));
      if (prev && prev.createdBy) clean.createdBy = prev.createdBy;
      if (prev && prev.createdAt) clean.createdAt = prev.createdAt; else if (!prev) { clean.createdAt = nowIso(ctx); clean.createdBy = ctx.user.name; }
      const list = state[kind], idx = list.findIndex(x => x.id === clean.id);
      if (idx >= 0) list[idx] = clean; else list.push(clean);
      state.rev += 1;
      audit(state, ctx, { entity: "master", entityId: clean.id, opNo: clean.name, event: "master", act: Lx(prev ? N_("Zmiana: {k}") : N_("Dodanie: {k}"), { k: { t: K.label } }), before: prev ? clone(prev) : null, after: clean, source: (ctx && ctx.source) || N_("Kartoteki") });
      return { ok: true, rec: clean };
    }
  };

  /** Usunięcie rekordu kartoteki — tylko gdy nie ma go w żadnym dokumencie (inaczej dezaktywacja). */
  Master.remove = function (state, kind, id, ctx) {
    const K = this.KINDS[kind];
    if (!K) return { ok: false, error: t("Nieznana kartoteka") };
    if (!can(ctx && ctx.user, "master.edit")) return { ok: false, error: t("Edycja kartotek wymaga roli Kierownik lub Administrator"), code: "FORBIDDEN" };
    if (kind === "warehouses" && !can(ctx.user, "warehouses.edit")) return { ok: false, error: t("Magazyny dodaje i zmienia administrator"), code: "FORBIDDEN" };
    const rec = byId(state[kind], id);
    if (!rec) return { ok: false, error: t("Nie znaleziono") };
    const inOps = state.operations.some(o => JSON.stringify(o).includes(`"${id}"`)) || state.drafts.some(d => JSON.stringify(d).includes(`"${id}"`));
    if (kind === "products" && (this.usedProduct(state, id) || inOps)) return { ok: false, error: t("Produkt występuje w dokumentach — nie można go usunąć; dezaktywuj go") };
    if (kind === "partners" && inOps) return { ok: false, error: t("Kontrahent występuje w dokumentach — nie można go usunąć; dezaktywuj go") };
    if (kind === "warehouses") {
      if (state.ledger.some(l => l.whId === id) || state.operations.some(o => o.whId === id || o.toWhId === id) || state.drafts.some(d => d.whId === id)) return { ok: false, error: t("Magazyn ma dokumenty lub ruchy w księdze — nie można go usunąć; dezaktywuj go") };
      if (state.users.some(u => u.whId === id || (u.warehouseIds || []).includes(id))) return { ok: false, error: t("Do magazynu są przypisani użytkownicy — najpierw przenieś ich do innego magazynu") };
      if (Object.values(state.fleet).some(list => list.some(x => x.whId === id))) return { ok: false, error: t("Do magazynu jest przypisana flota — najpierw zmień jej magazyn") };
      if (state.warehouses.length <= 1) return { ok: false, error: t("W systemie musi pozostać co najmniej jeden magazyn") };
    }
    state[kind] = state[kind].filter(x => x.id !== id); state.rev += 1;
    audit(state, ctx, { entity: "master", entityId: id, opNo: rec.name, event: "master", act: Lx("Usunięcie: {k}", { k: { t: K.label } }), before: clone(rec), after: null, source: (ctx && ctx.source) || N_("Kartoteki") });
    return { ok: true };
  };

  /* ------------------------------------------------------------------ */
  /* Użytkownicy — profil w danych (hasła przechowuje osobno moduł Auth)  */
  /* ------------------------------------------------------------------ */
  const THEMES = { pearl: N_("Perła (jasny)"), graphite: N_("Grafit (ciemny)"), azure: N_("Graphite Azure") };
  const Users = {
    fullName(r) { return [str(r.firstName), str(r.lastName)].filter(Boolean).join(" ") || str(r.name); },
    validate(state, rec, prev) {
      const e = {};
      if (str(rec.firstName).length < 2) e.firstName = t("Podaj imię (co najmniej 2 znaki)");
      if (str(rec.lastName).length < 2) e.lastName = t("Podaj nazwisko (co najmniej 2 znaki)");
      const em = validateCompanyEmail(rec.email || rec.login, state.config.companyDomains);
      if (!em.ok) e.email = em.error;
      else if (state.users.some(u => u.id !== rec.id && (normalizeEmail(u.login) === em.email || normalizeEmail(u.email) === em.email))) e.email = t("Konto z tym adresem e-mail już istnieje");
      if (!ROLES[rec.role]) e.role = t("Wybierz rolę");
      const wh = byId(state.warehouses, rec.whId);
      if (!wh) e.whId = t("Wybierz magazyn domyślny");
      else if (wh.active === false && !(prev && prev.whId === rec.whId)) e.whId = t("Magazyn jest nieaktywny");
      if ((rec.warehouseIds || []).some(id => !byId(state.warehouses, id))) e.warehouseIds = t("Nieznany magazyn");
      if (!USER_STATUS[rec.status]) e.status = t("Wybierz status");
      if (rec.lang && !I18N.has(rec.lang)) e.lang = t("Nieznany język");
      if (rec.theme && !THEMES[rec.theme]) e.theme = t("Nieznany motyw");
      return e;
    },
    /** Liczba aktywnych administratorów po zmianie (zabezpieczenie przed zablokowaniem systemu). */
    adminsAfter(state, rec) { return state.users.map(u => u.id === rec.id ? rec : u).filter(u => u.role === "admin" && statusOf(u) === "ACTIVE").length; },
    /** Ochrona przed eskalacją: kontami administratorów i rolą ADMINISTRATOR zarządza wyłącznie administrator. */
    guard(actor, prev, next) {
      if (!actor || actor.role === "admin") return null;
      if (next.role === "admin" || (prev && prev.role === "admin")) return t("Rolę ADMINISTRATOR nadaje i odbiera wyłącznie administrator");
      return null;
    },
    /**
     * Zapis profilu (nowe konto lub zmiana). Nowe konto: status ACTIVE (hasło nadaje administrator — tryb OFFLINE)
     * albo INVITED (zaproszenie e-mailem — tryb FIRMOWY). Każda zmiana roli, dostępu do magazynów i statusu — osobny wpis audytu.
     */
    save(state, rec, ctx) {
      const actor = ctx && ctx.user;
      if (!can(actor, "users.manage")) return { ok: false, error: t("Zarządzanie użytkownikami wymaga roli Administrator"), code: "FORBIDDEN" };
      const prev = rec.id ? byId(state.users, rec.id) : null;
      if (rec.id && !prev) return { ok: false, error: t("Nie znaleziono użytkownika") };
      const r = Object.assign({ lang: "", theme: "", phone: "" }, prev ? clone(prev) : {}, clone(rec));
      if (!r.firstName && !r.lastName && r.name && !prev) { const parts = str(r.name).split(/\s+/); r.firstName = parts[0]; r.lastName = parts.slice(1).join(" "); }
      r.email = normalizeEmail(rec.email || rec.login || r.email || r.login); r.login = r.email;
      // status: jawna zmiana statusu ma pierwszeństwo; zgodność wstecz — pole `active` (aktywny / nieaktywny)
      const prevSt = prev ? statusOf(prev) : null;
      r.status = rec.status && (!prev || rec.status !== prevSt) ? rec.status : (prevSt || "ACTIVE");
      if (prev && r.status === prevSt && rec.active !== undefined) {
        const want = !(rec.active === false || rec.active === "false");
        if (want !== (prevSt === "ACTIVE")) r.status = want ? (prevSt === "INVITED" && !prev.selfRegistered ? "INVITED" : "ACTIVE") : "DISABLED";
      }
      r.warehouseIds = [...new Set([r.whId].concat(Array.isArray(r.warehouseIds) ? r.warehouseIds : []).filter(Boolean))];
      if (ROLES[r.role] && ROLES[r.role].global) r.warehouseIds = [r.whId];
      const e = this.validate(state, r, prev);
      const escal = this.guard(actor, prev, r); if (escal) e.role = escal;
      if (prev && prev.id === actor.id && statusOf(r) !== "ACTIVE") e.status = t("Nie możesz zablokować ani dezaktywować własnego konta");
      if (prev && prev.id === actor.id && r.role !== prev.role) e.role = t("Nie możesz zmienić własnej roli");
      if (this.adminsAfter(state, Object.assign({ id: r.id || "__new" }, r)) === 0) e.role = t("W systemie musi pozostać co najmniej jeden aktywny administrator");
      if (Object.keys(e).length) return { ok: false, errors: e, error: Object.values(e)[0], code: escal ? "FORBIDDEN" : undefined };
      const clean = { id: prev ? prev.id : uid("u"), firstName: str(r.firstName), lastName: str(r.lastName), name: this.fullName(r), login: r.email, email: r.email,
        role: r.role, whId: r.whId, warehouseIds: r.warehouseIds, status: r.status, active: r.status === "ACTIVE", phone: str(r.phone), lang: r.lang || "", theme: r.theme || "",
        createdAt: prev ? (prev.createdAt || null) : nowIso(ctx) };
      for (const k of ["invitedAt", "activatedAt", "emailVerifiedAt", "emailUnverified", "registeredAt", "selfRegistered", "approvedAt", "approvedBy"]) if (prev && prev[k] !== undefined) clean[k] = prev[k];
      if (prev && statusOf(prev) === "INVITED" && clean.status === "ACTIVE" && prev.selfRegistered) { clean.approvedAt = nowIso(ctx); clean.approvedBy = actor.name; delete clean.selfRegistered; }
      if (!prev && clean.status === "INVITED") clean.invitedAt = nowIso(ctx);
      const idx = state.users.findIndex(u => u.id === clean.id);
      if (idx >= 0) state.users[idx] = clean; else state.users.push(clean);
      state.rev += 1;
      const src = (ctx && ctx.source) || N_("Administracja — użytkownicy");
      const A = (code, act, before, after) => audit(state, ctx, { entity: "user", entityId: clean.id, opNo: clean.login, event: "user", code, act, before, after, source: src });
      if (!prev) A(clean.status === "INVITED" ? "USER_INVITED" : "USER_CREATED", Lx(clean.status === "INVITED" ? N_("Zaproszenie użytkownika {l}") : N_("Utworzenie konta użytkownika {l}"), { l: clean.login }), null, { rola: ROLES[clean.role].code, magazyny: clean.warehouseIds, status: clean.status });
      else {
        let any = false;
        if (prev.role !== clean.role) { any = true; A("ROLE_CHANGED", Lx("Zmiana roli {l}: {a} → {b}", { l: clean.login, a: ROLES[prev.role] ? ROLES[prev.role].code : prev.role, b: ROLES[clean.role].code }), { rola: prev.role }, { rola: clean.role }); }
        const wa = JSON.stringify([prev.whId, [...(prev.warehouseIds || [])].sort()]), wb = JSON.stringify([clean.whId, [...clean.warehouseIds].sort()]);
        if (wa !== wb) { any = true; A("WAREHOUSE_ACCESS_CHANGED", Lx("Zmiana dostępu do magazynów: {l}", { l: clean.login }), { domyslny: prev.whId, magazyny: prev.warehouseIds || [] }, { domyslny: clean.whId, magazyny: clean.warehouseIds }); }
        if (statusOf(prev) !== clean.status) {
          any = true; const code = { ACTIVE: "USER_ACTIVATED", SUSPENDED: "USER_SUSPENDED", DISABLED: "USER_DISABLED", INVITED: "USER_INVITED" }[clean.status];
          A(code, Lx("Zmiana statusu konta {l}: {a} → {b}", { l: clean.login, a: { t: USER_STATUS[statusOf(prev)] }, b: { t: USER_STATUS[clean.status] } }), { status: statusOf(prev) }, { status: clean.status });
        }
        if (normalizeEmail(prev.email || prev.login) !== clean.email) { any = true; A("EMAIL_CHANGED", Lx("Zmiana adresu e-mail: {a} → {b}", { a: prev.login, b: clean.login }), { email: prev.login }, { email: clean.login }); }
        if (!any) A("USER_UPDATED", Lx(N_("Zmiana konta użytkownika {l}"), { l: clean.login }), clone(prev), clean);
      }
      return { ok: true, rec: clean, created: !prev, before: prev ? clone(prev) : null };
    },
    /** Aktywacja zaproszenia (link z e-maila) — adres potwierdzony, konto ACTIVE. Wykonuje host po weryfikacji tokenu. */
    activate(state, userId, ctx) {
      const u = byId(state.users, userId);
      if (!u) return { ok: false, error: t("Nie znaleziono użytkownika") };
      const st = statusOf(u);
      if (st !== "INVITED" && st !== "ACTIVE") return { ok: false, error: t("Twoje konto jest nieaktywne."), code: "INACTIVE" };
      if (st === "INVITED" && u.selfRegistered) return { ok: false, error: t("Twoje konto nie zostało jeszcze aktywowane."), code: "INVITED" };
      u.status = "ACTIVE"; u.active = true; u.emailVerifiedAt = nowIso(ctx); if (!u.activatedAt) u.activatedAt = nowIso(ctx); delete u.pending;
      state.rev += 1;
      audit(state, Object.assign({}, ctx, { user: u }), { entity: "user", entityId: u.id, opNo: u.login, event: "user", code: "USER_ACTIVATED", act: Lx("Aktywacja konta z zaproszenia: {l} (adres e-mail potwierdzony)", { l: u.login }), before: { status: st }, after: { status: "ACTIVE" }, source: N_("Zaproszenie e-mail") });
      return { ok: true, rec: u };
    },
    /**
     * Rejestracja z ekranu logowania — domyślnie WYŁĄCZONA (konta zakłada administrator zaproszeniem).
     * Po włączeniu w konfiguracji: konto INVITED (samodzielne), rolę i magazyn nadaje administrator.
     */
    register(state, rec, ctx) {
      if (!state.config.allowSelfRegistration) return { ok: false, error: t("Rejestracja jest wyłączona — konto zakłada administrator (zaproszenie e-mailem)."), code: "DISABLED" };
      const parts = str(rec.name).split(/\s+/);
      const r = { firstName: str(rec.firstName) || parts[0] || "", lastName: str(rec.lastName) || parts.slice(1).join(" "), email: normalizeEmail(rec.email), role: "obserwator", status: "INVITED", phone: str(rec.phone),
        whId: (state.warehouses.find(w => w.active !== false) || {}).id, warehouseIds: [] };
      const e = this.validate(state, r);
      if (Object.keys(e).length) return { ok: false, errors: e, error: Object.values(e)[0] };
      const clean = { id: uid("u"), firstName: r.firstName, lastName: r.lastName, name: this.fullName(r), login: r.email, email: r.email, role: "obserwator", whId: r.whId, warehouseIds: [r.whId],
        status: "INVITED", active: false, selfRegistered: true, phone: r.phone, lang: str(rec.lang), theme: "", registeredAt: nowIso(ctx), createdAt: nowIso(ctx) };
      state.users.push(clean); state.rev += 1;
      audit(state, Object.assign({}, ctx, { user: null }), { entity: "user", entityId: clean.id, opNo: clean.login, event: "register", code: "USER_REGISTERED", act: Lx("Rejestracja konta {l} — oczekuje na zatwierdzenie", { l: clean.login }), before: null, after: { nazwa: clean.name, email: clean.login }, source: N_("Rejestracja") });
      return { ok: true, rec: clean };
    },
    /** Usunięcie konta bez historii (np. zaproszenie wysłane omyłkowo). Konto z historią — tylko dezaktywacja. */
    remove(state, id, ctx) {
      if (!can(ctx && ctx.user, "users.manage")) return { ok: false, error: t("Zarządzanie użytkownikami wymaga roli Administrator"), code: "FORBIDDEN" };
      const u = byId(state.users, id);
      if (!u) return { ok: false, error: t("Nie znaleziono użytkownika") };
      if (u.id === ctx.user.id) return { ok: false, error: t("Nie możesz usunąć własnego konta") };
      const g = this.guard(ctx.user, u, u); if (g) return { ok: false, error: g, code: "FORBIDDEN" };
      if (this.adminsAfter(state, Object.assign({}, u, { status: "DISABLED" })) === 0) return { ok: false, error: t("W systemie musi pozostać co najmniej jeden aktywny administrator") };
      const hist = state.operations.some(o => o.userId === id || o.approvedById === id) || state.ledger.some(l => l.userId === id) || state.drafts.some(d => d.userId === id) || state.audit.some(a => a.userId === id);
      if (hist) return { ok: false, error: t("Konto ma historię operacji — nie można go usunąć; dezaktywuj je (historia zostaje)") };
      state.users = state.users.filter(x => x.id !== id); state.rev += 1;
      audit(state, ctx, { entity: "user", entityId: id, opNo: u.login, event: "user", code: "USER_DELETED", act: Lx("Usunięcie konta użytkownika {l}", { l: u.login }), before: clone(u), after: null, source: (ctx && ctx.source) || N_("Administracja — użytkownicy") });
      return { ok: true };
    },
    /** Zmiana magazynu roboczego — tylko na magazyn, do którego użytkownik ma dostęp. */
    setMyWarehouse(state, whId, ctx) {
      const u = ctx && ctx.user && byId(state.users, ctx.user.id);
      if (!u) return { ok: false, error: t("Brak zalogowanego użytkownika") };
      const wh = byId(state.warehouses, whId);
      if (!wh || wh.active === false) return { ok: false, error: t("Wybierz magazyn") };
      if (!canAccessWh(u, whId)) return { ok: false, error: t("Brak dostępu do magazynu {w}", { w: wh.name }), code: "FORBIDDEN" };
      if (u.whId === whId) return { ok: true, unchanged: true };
      if (!(ROLES[u.role] || {}).global) u.warehouseIds = [...new Set([u.whId].concat(u.warehouseIds || []))];
      u.whId = whId; state.rev += 1;
      return { ok: true };
    },
    /** Preferencje własne (język, motyw) — każdy zalogowany użytkownik. */
    setPrefs(state, prefs, ctx) {
      const u = ctx && ctx.user && byId(state.users, ctx.user.id);
      if (!u) return { ok: false, error: t("Brak zalogowanego użytkownika") };
      const next = { lang: prefs.lang === undefined ? u.lang : prefs.lang, theme: prefs.theme === undefined ? u.theme : prefs.theme };
      if (next.lang && !I18N.has(next.lang)) return { ok: false, error: t("Nieznany język") };
      if (next.theme && !THEMES[next.theme]) return { ok: false, error: t("Nieznany motyw") };
      if (next.lang === u.lang && next.theme === u.theme) return { ok: true, unchanged: true };
      u.lang = next.lang || ""; u.theme = next.theme || "";
      state.rev += 1;
      return { ok: true };
    }
  };

  /** Role: zmiana zestawu uprawnień (tylko administrator; ADMINISTRATOR zawsze pełny). */
  const Roles = {
    save(state, role, perms, ctx) {
      const actor = ctx && ctx.user;
      if (!actor || actor.role !== "admin" || !can(actor, "roles.assign")) return { ok: false, error: t("Role i uprawnienia zmienia wyłącznie administrator"), code: "FORBIDDEN" };
      if (!ROLES[role]) return { ok: false, error: t("Wybierz rolę") };
      if (role === "admin") return { ok: false, error: t("Rola ADMINISTRATOR ma zawsze pełne uprawnienia") };
      const list = [...new Set((perms || []).filter(p => PERMS[p]))].sort();
      const before = permsOf(role).slice().sort();
      if (JSON.stringify(before) === JSON.stringify(list)) return { ok: true, unchanged: true };
      state.rolePerms = Object.assign({}, state.rolePerms, { [role]: list }); applyRoles(state); state.rev += 1;
      audit(state, ctx, { entity: "role", entityId: role, opNo: ROLES[role].code, event: "role", code: "ROLE_PERMISSIONS_CHANGED", act: Lx("Zmiana uprawnień roli {r}", { r: ROLES[role].code }), before: { uprawnienia: before }, after: { uprawnienia: list }, source: (ctx && ctx.source) || N_("Administracja — role") });
      return { ok: true };
    },
    reset(state, role, ctx) { return this.save(state, role, (ROLES[role] || {}).perms, ctx); }
  };
  /** Konfiguracja systemu (obieg zatwierdzania, rejestracja samodzielna). */
  const Settings = {
    KEYS: { requireApproval: "bool", allowSelfRegistration: "bool" },
    save(state, next, ctx) {
      if (!can(ctx && ctx.user, "settings.edit")) return { ok: false, error: t("Konfigurację zmienia administrator"), code: "FORBIDDEN" };
      const before = {}, after = {};
      for (const [k, ty] of Object.entries(this.KEYS)) if (next[k] !== undefined) { const v = ty === "bool" ? !!next[k] && next[k] !== "false" : next[k]; if (state.config[k] !== v) { before[k] = state.config[k]; after[k] = v; state.config[k] = v; } }
      if (!Object.keys(after).length) return { ok: true, unchanged: true };
      state.rev += 1;
      audit(state, ctx, { entity: "system", entityId: "settings", opNo: "—", event: "settings", code: "SETTINGS_CHANGED", act: Lx(N_("Zmiana konfiguracji systemu")), before, after, source: (ctx && ctx.source) || N_("Administracja") });
      return { ok: true };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Raporty                                                             */
  /* ------------------------------------------------------------------ */
  const REPORT_COLS = ["ZAKUP", "PRODUKCJA", "ZUZYCIE", "SPRZEDAZ", "BEZP", "MM", "INNE"];
  const HISTORY_TYPES = {
    ZAKUP: N_("Zakup"), PRZYJECIE: N_("Przyjęcie (PW)"), ZUZYCIE: N_("Zużycie"), SPRZEDAZ_BEZP: N_("Sprzedaż bezpośrednia"), WZ: N_("WZ"),
    MM: N_("MM"), TRANSPORT: N_("Transport"), KOREKTA: N_("Korekta"), ANULOWANIE: N_("Anulowanie"), INW: N_("Inwentaryzacja"), BO: N_("Bilans otwarcia")
  };
  const opPartner = op => op ? (op.purchase ? op.purchase.supplierId : op.sale ? op.sale.buyerId : "") : "";
  const opPartners = op => op ? [op.purchase && op.purchase.supplierId, op.sale && op.sale.buyerId].filter(Boolean) : [];
  const opLiveAt = (op, to) => op.status !== "CANCELLED" || (op.cancel && op.cancel.date > to);

  const Reports = {
    /** Rejestr ruchów magazynowych: każdy zapis księgi + transport, ze stanem przed / zmianą / po. */
    history(state, f = {}) {
      const wh = id => (byId(state.warehouses, id) || {}).name || id || "";
      const pr = id => byId(state.products, id);
      const run = new Map(), rows = [];
      for (const l of Stock.sorted(state.ledger)) {
        const k = `${l.whId}|${l.productId}`, before = run.get(k) || 0, after = rq(before + l.qty);
        run.set(k, after);
        const op = l.opId ? byId(state.operations, l.opId) : null;
        const ty = l.kind === "ZAKUP" ? "ZAKUP" : l.kind === "PRODUKCJA" ? (l.direct ? "SPRZEDAZ_BEZP" : "PRZYJECIE") : l.kind === "ZUZYCIE" ? "ZUZYCIE"
          : l.kind === "SPRZEDAZ" ? (l.direct ? "SPRZEDAZ_BEZP" : "WZ") : l.kind;
        const p = pr(l.productId);
        const partnerId = !op ? "" : l.cat === "SPRZEDAZ" && op.sale ? op.sale.buyerId : l.cat === "ZAKUP" && op.purchase ? op.purchase.supplierId : opPartner(op);
        const mmSide = l.cat === "MM" ? (l.qty > 0 ? t("z: {w}", { w: wh(op && op.whId) }) : t("do: {w}", { w: wh(op && op.toWhId) })) : "";
        rows.push({
          id: l.id, seq: l.seq, date: l.date, time: (l.ts || "").slice(11, 16), user: l.userName || (op ? op.userName : t("System")),
          type: ty, typeLabel: ty === "SPRZEDAZ_BEZP" ? (l.kind === "PRODUKCJA" ? t("Sprzedaż bezp. — przyjęcie PW") : t("Sprzedaż bezp. — wydanie WZ")) : t(HISTORY_TYPES[ty]), cat: l.cat, docNo: l.docNo, whId: l.whId, whName: wh(l.whId),
          productId: l.productId, productName: p ? p.name : l.productId, qty: Math.abs(l.qty), change: l.qty, unit: p ? p.unit : "",
          before, after, partnerId, partner: partnerId ? ((byId(state.partners, partnerId) || {}).name || "") : mmSide,
          related: l.refDoc ? `${l.refDoc}` : (op && op.no !== l.docNo ? op.no : ""), opId: l.opId, opNo: op ? op.no : "",
          partnerIds: opPartners(op), notes: l.kind === "KOREKTA" ? trReason((op && (op.corrections.find(c => c.no === l.docNo) || {}).reason) || "") : l.kind === "ANULOWANIE" ? trReason((op && op.cancel && op.cancel.reason) || "") : (op ? op.notes : ""),
          status: op ? op.status : "POSTED", userId: op ? (l.kind === "KOREKTA" ? ((op.corrections.find(c => c.no === l.docNo) || {}).userId) : l.kind === "ANULOWANIE" ? (op.cancel || {}).userId : op.userId) : null
        });
      }
      for (const op of state.operations) {
        const tr = op.documents.find(d => d.type === "TR");
        if (!tr) continue;
        const T = op.transport;
        rows.push({ id: "tr_" + op.id, seq: 1e12 + state.operations.indexOf(op), date: op.date, time: (op.createdAt || "").slice(11, 16), user: op.userName, type: "TRANSPORT", typeLabel: t(HISTORY_TYPES.TRANSPORT), cat: "TRANSPORT", docNo: tr.no, whId: op.whId, whName: wh(op.whId), productId: null, productName: t(TRANSPORT_MODES[T.mode]), qty: null, change: null, unit: "", before: null, after: null, partnerId: opPartner(op), partnerIds: opPartners(op), partner: T.company || T.carrier || T.driverName || "", related: op.no, opId: op.id, opNo: op.no, notes: `${fmtQ(T.km || 0)} km · ${money(T.cost)}${T.mode === "train" ? " · " + t("{n} wag.", { n: T.wagonCount }) + ` · ${fmtQ(T.totalT)} t` : ""}`, status: op.status, userId: op.userId });
      }
      const q = str(f.q).toLowerCase();
      return rows.filter(r =>
        (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to) && (!f.whId || r.whId === f.whId) &&
        (!f.productId || r.productId === f.productId) && (!f.type || r.type === f.type) && (!f.userId || r.userId === f.userId) &&
        (!f.partnerId || (r.partnerIds || []).includes(f.partnerId)) && (!f.status || r.status === f.status) &&
        (!q || [r.docNo, r.related, r.productName, r.partner, r.notes, r.user].join(" ").toLowerCase().includes(q))
      ).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq);
    },

    /** Raport biznesowy okresu — wynik netto po korektach i anulowaniach. */
    business(state, f) {
      const cfg = state.config, from = f.from, to = f.to, whId = f.whId || null;
      const inR = d => d >= from && d <= to;
      const pr = id => byId(state.products, id);
      const opOk = op => (!whId || op.whId === whId || op.toWhId === whId) && (!f.partnerId || opPartners(op).includes(f.partnerId)) &&
        (!f.productId || state.ledger.some(l => l.opId === op.id && l.productId === f.productId) || (op.purchase && op.purchase.productId === f.productId) || (op.sale && op.sale.productId === f.productId));
      const L = state.ledger.filter(l => (!whId || l.whId === whId) && (!f.productId || l.productId === f.productId) &&
        (!f.partnerId || (l.opId && opPartners(byId(state.operations, l.opId)).includes(f.partnerId))));
      const LR = L.filter(l => inR(l.date));
      const col = l => l.direct ? "BEZP" : (l.cat === "BO" || l.cat === "INW") ? "INNE" : l.cat;

      /* bilans stanów */
      const recon = [];
      if (!f.partnerId) {
        const opening = Stock.byProduct(state, whId, null, from);
        const actual = Stock.byProduct(state, whId, to);
        const ids = new Set([...opening.keys(), ...actual.keys(), ...LR.map(l => l.productId)]);
        for (const p of state.products) {
          if (!ids.has(p.id) || (f.productId && p.id !== f.productId)) continue;
          const r = { productId: p.id, name: p.name, unit: p.unit, opening: opening.get(p.id) || 0 };
          REPORT_COLS.forEach(c => { r[c] = 0; });
          for (const l of LR) if (l.productId === p.id) r[col(l)] = rq(r[col(l)] + l.qty);
          r.closing = rq(REPORT_COLS.reduce((a, c) => a + r[c], r.opening));
          r.actual = actual.get(p.id) || 0;
          r.consistent = Math.abs(r.closing - r.actual) <= EPS;
          if (Math.abs(r.opening) < EPS && Math.abs(r.closing) < EPS && REPORT_COLS.every(c => Math.abs(r[c]) < EPS)) continue;
          const o = Units.orient(r.closing, p, cfg); r.closingT = o.t; r.closingGJ = o.gj;
          recon.push(r);
        }
      }
      /* zdarzenia wartościowe (utworzenie / korekta / anulowanie) w okresie */
      const ops = state.operations.filter(opOk);
      const ev = [];
      for (const op of ops) for (const e of op.valueEvents) if (inR(e.date)) ev.push(Object.assign({ op }, e));
      const vsum = (pred, k) => round(ev.filter(e => pred(e.op)).reduce((a, e) => a + (e[k] || 0), 0), 2);
      const qsum = (pred) => { const m = {}; for (const l of LR) if (pred(l)) { const u = pr(l.productId).unit; m[u] = rq((m[u] || 0) + l.qty); } return m; };
      const byProd = (pred, sign = 1) => {
        const m = new Map();
        for (const l of LR) if (pred(l)) { const c = m.get(l.productId) || { productId: l.productId, name: pr(l.productId).name, unit: pr(l.productId).unit, qty: 0, opIds: new Set() }; c.qty = rq(c.qty + sign * l.qty); if (l.opId) c.opIds.add(l.opId); m.set(l.productId, c); }
        return [...m.values()].filter(x => Math.abs(x.qty) > EPS || x.opIds.size).map(x => Object.assign(x, { opIds: [...x.opIds] }));
      };
      /* side: "supplier" (zakupy) albo "buyer" (sprzedaż) — operacja łańcuchowa ma obu kontrahentów */
      const partnersOf = (pred, qtyPred, sign, side) => {
        const m = new Map();
        const pidOf = op => side === "supplier" ? (op.purchase ? op.purchase.supplierId : "") : (op.sale ? op.sale.buyerId : "");
        const vKey = side === "supplier" ? "purchaseCost" : "revenue";
        for (const l of LR) if (qtyPred(l) && l.opId) {
          const op = byId(state.operations, l.opId); const pid = pidOf(op); if (!pid) continue;
          const c = m.get(pid) || { partnerId: pid, name: (byId(state.partners, pid) || {}).name, byUnit: {}, value: 0, opIds: new Set() };
          const u = pr(l.productId).unit; c.byUnit[u] = rq((c.byUnit[u] || 0) + sign * l.qty); c.opIds.add(op.id); m.set(pid, c);
        }
        for (const e of ev) if (pred(e.op)) { const c = m.get(pidOf(e.op)); if (c) c.value = round(c.value + (e[vKey] || 0), 2); }
        // kontrahent wyłącznie z dokumentami anulowanymi (netto 0) nie zaśmieca raportu biznesowego
        return [...m.values()].filter(x => Math.abs(x.value) > 0.004 || Object.values(x.byUnit).some(v => Math.abs(v) > EPS)).map(x => Object.assign(x, { opIds: [...x.opIds] }));
      };
      const countLive = pred => ops.filter(op => pred(op) && inR(op.date) && opLiveAt(op, to)).length;
      const purchases = {
        count: countLive(op => op.type === "ZAKUP"), byUnit: qsum(l => l.cat === "ZAKUP"), value: vsum(op => op.type === "ZAKUP", "purchaseCost"),
        products: byProd(l => l.cat === "ZAKUP"), suppliers: partnersOf(op => op.type === "ZAKUP", l => l.cat === "ZAKUP", 1, "supplier")
      };
      const production = {
        count: countLive(op => !!op.production), byUnit: qsum(l => l.cat === "PRODUKCJA" && !l.direct), byUnitDirect: qsum(l => l.cat === "PRODUKCJA" && l.direct),
        products: byProd(l => l.cat === "PRODUKCJA" && !l.direct), directProducts: byProd(l => l.cat === "PRODUKCJA" && l.direct),
        consumed: byProd(l => l.cat === "ZUZYCIE", -1), chippingCost: vsum(op => !!op.production, "chippingCost"),
        chippingMP: rq(LR.filter(l => l.cat === "PRODUKCJA" && pr(l.productId).unit === "MP").reduce((a, l) => a + l.qty, 0))
      };
      const sales = {
        count: countLive(op => !!op.sale), countDirect: countLive(op => op.direct),
        byUnit: qsum(l => l.cat === "SPRZEDAZ" && !l.direct), byUnitDirect: qsum(l => l.cat === "SPRZEDAZ" && l.direct),
        value: vsum(op => !!op.sale && !op.direct, "revenue"), valueDirect: vsum(op => op.direct, "revenue"),
        products: byProd(l => l.cat === "SPRZEDAZ" && !l.direct, -1), directProducts: byProd(l => l.cat === "SPRZEDAZ" && l.direct, -1),
        buyers: partnersOf(op => !!op.sale, l => l.cat === "SPRZEDAZ", -1, "buyer")
      };
      const consumption = (() => {
        const m = new Map();
        for (const l of LR) if (l.cat === "ZUZYCIE") { const k = `${l.productId}|${l.whId}`; const c = m.get(k) || { productId: l.productId, name: pr(l.productId).name, unit: pr(l.productId).unit, whName: (byId(state.warehouses, l.whId) || {}).name, qty: 0, opIds: new Set() }; c.qty = rq(c.qty - l.qty); c.opIds.add(l.opId); m.set(k, c); }
        return [...m.values()].map(x => Object.assign(x, { opIds: [...x.opIds] }));
      })();
      const mm = ops.filter(op => op.type === "MM" && LR.some(l => l.opId === op.id)).map(op => {
        const ins = LR.filter(l => l.opId === op.id && l.cat === "MM");
        const moved = rq(ins.filter(l => l.whId === op.toWhId).reduce((a, l) => a + l.qty, 0));
        return { opId: op.id, no: op.no, date: op.date, from: (byId(state.warehouses, op.whId) || {}).name, to: (byId(state.warehouses, op.toWhId) || {}).name, productId: op.mm.productId, name: pr(op.mm.productId).name, unit: pr(op.mm.productId).unit, qty: moved, status: op.status };
      });
      const trOps = ops.filter(op => op.transport && op.transport.mode !== "none" && inR(op.date) && opLiveAt(op, to));
      const transport = {
        count: trOps.length, cost: vsum(op => op.transport && op.transport.mode !== "none", "transportCost"),
        km: rq(trOps.reduce((a, op) => a + (op.transport.km || 0), 0)),
        wagons: trOps.reduce((a, op) => a + (op.transport.wagonCount || 0), 0),
        trainT: rq(trOps.reduce((a, op) => a + (op.transport.totalT || 0), 0)),
        trips: trOps.reduce((a, op) => a + (op.transport.mode !== "train" ? (op.transport.runs || [1]).length : 1), 0),
        carriers: (() => {
          const m = new Map();
          const addC = (n, cost, km) => { const c = m.get(n) || { name: n, count: 0, cost: 0, km: 0 }; c.count++; c.cost = round(c.cost + cost, 2); c.km = rq(c.km + (km || 0)); m.set(n, c); };
          for (const op of trOps) {
            const T = op.transport;
            if (T.mode === "own" || T.mode === "external" || T.mode === "mixed") for (const r of (T.runs || [T])) addC((r.kind || T.mode) === "own" ? t("Transport własny ({reg})", { reg: r.reg }) : (r.company || T.company), r.cost, r.km);
            else addC(t("{c} (kolej)", { c: T.carrier || t("Pociąg") }), T.cost, T.km);
          }
          return [...m.values()];
        })(),
        rows: trOps.map(op => ({ opId: op.id, no: (op.documents.find(d => d.type === "TR") || {}).no, date: op.date, mode: t(TRANSPORT_MODES[op.transport.mode]), place: op.transport.place, km: op.transport.km || 0, wagons: op.transport.wagonCount || 0, totalT: op.transport.totalT || 0, cost: op.transport.cost }))
      };
      const corrections = [], cancellations = [];
      for (const op of ops) {
        for (const c of op.corrections) if (inR(c.date)) corrections.push({ opId: op.id, no: c.no, orig: op.no, date: c.date, reason: trReason(c.reason), user: c.userName, changes: c.changes, deltas: c.deltas, valueDelta: c.valueDelta, totalsBefore: c.totalsBefore, totalsAfter: c.totalsAfter, descriptiveOnly: c.descriptiveOnly });
        if (op.cancel && inR(op.cancel.date)) cancellations.push({ opId: op.id, no: op.cancel.no, orig: op.no, date: op.cancel.date, reason: trReason(op.cancel.reason), user: op.cancel.userName, effect: op.cancel.effect });
      }
      /* wycena orientacyjna: średnia ważona cena zakupu (efektywna) do końca okresu */
      const valuation = recon.map(r => {
        let q = 0, v = 0;
        for (const op of state.operations) if (op.type === "ZAKUP" && op.status !== "CANCELLED" && op.purchase.productId === r.productId && op.date <= to && (!whId || op.whId === whId)) { q += op.purchase.stockQty; v += op.purchase.cost; }
        if (!(q > EPS)) return { productId: r.productId, name: r.name, unit: r.unit, priced: false };
        const avg = v / q;
        return { productId: r.productId, name: r.name, unit: r.unit, priced: true, avg: round(avg, 4), openingValue: round(r.opening * avg, 2), inValue: round((r.ZAKUP + r.PRODUKCJA + Math.max(0, r.MM)) * avg, 2), outValue: round(-(r.ZUZYCIE + r.SPRZEDAZ + Math.min(0, r.MM)) * avg, 2), closingValue: round(r.closing * avg, 2) };
      });
      const ym = f.mode === "month" ? Dates.ym(from) : null;
      const closed = ym ? state.warehouses.filter(w => !whId || w.id === whId).map(w => ({ whId: w.id, name: w.name, closed: !!(Inventory.find(state, w.id, ym) && Inventory.find(state, w.id, ym).status === "ZAMKNIETA") })) : [];
      return {
        filters: f, from, to, recon, consistent: recon.every(r => r.consistent), purchases, production, sales, consumption, mm, transport, corrections, cancellations, valuation, closed,
        turnover: this.turnover(state, from, to, whId, f)
      };
    },

    /** Obroty wg typu operacji (liczba, ilości w rozbiciu na jednostki, wartość). */
    turnover(state, from, to, whId, f = {}) {
      const pr = id => byId(state.products, id);
      const inR = d => d >= from && d <= to;
      const L = state.ledger.filter(l => inR(l.date) && (!whId || l.whId === whId) && (!f.productId || l.productId === f.productId) && (!f.partnerId || (l.opId && opPartners(byId(state.operations, l.opId)).includes(f.partnerId))));
      const cats = ["ZAKUP", "PRODUKCJA", "ZUZYCIE", "SPRZEDAZ", "MM"];
      return cats.map(cat => {
        const byUnit = {}, opIds = new Set(), liveOps = new Set();
        for (const l of L) if (l.cat === cat) {
          const u = pr(l.productId).unit;
          const v = cat === "MM" ? (whId ? Math.abs(l.qty) * Math.sign(l.qty) : Math.max(0, l.qty)) : cat === "ZAKUP" || cat === "PRODUKCJA" ? l.qty : -l.qty;
          byUnit[u] = rq((byUnit[u] || 0) + v);
          if (l.opId) opIds.add(l.opId);
          if (l.opId && l.kind === cat) { const op = byId(state.operations, l.opId); if (op && opLiveAt(op, to)) liveOps.add(l.opId); }
        }
        let value = 0;
        const key = cat === "ZAKUP" ? "purchaseCost" : cat === "SPRZEDAZ" ? "revenue" : cat === "PRODUKCJA" ? "chippingCost" : null;
        if (key) for (const id of opIds) for (const e of byId(state.operations, id).valueEvents) if (inR(e.date)) value += e[key] || 0;
        return { cat, label: t(CATS[cat]), count: liveOps.size, byUnit, value: key ? round(value, 2) : null, valueLabel: key === "purchaseCost" ? t("wartość zakupu") : key === "revenue" ? t("przychód") : key === "chippingCost" ? t("koszt rąbania") : "", opIds: [...opIds] };
      });
    },

    /** Kwit produkcji dnia. */
    productionDay(state, date, whId) {
      const cfg = state.config, rows = [];
      for (const op of state.operations) {
        if (!op.production || op.date !== date || (whId && op.whId !== whId)) continue;
        const x = op.production, out = byId(state.products, x.outProductId), raw = byId(state.products, x.rawProductId);
        const o = Units.orient(x.outQty, out, cfg);
        const pw = op.documents.find(d => d.type === "PW");
        rows.push({
          opId: op.id, docNo: pw ? pw.no : op.no, opNo: op.no, date: op.date, whName: (byId(state.warehouses, op.whId) || {}).name,
          mode: x.mode === "stock" ? t("na magazyn") : x.mode === "direct" ? t("bezpośrednia (las)") : t("z zakupu"),
          operator: x.operatorName || op.userName, chipper: x.chipperName || "",
          raw: raw ? raw.name : "—", consume: x.mode === "direct" ? x.rawQty : x.consumeQty, consumeUnit: raw ? raw.unit : "", consumeFromStock: x.mode !== "direct",
          product: out ? out.name : "—", outQty: x.outQty, outUnit: out ? out.unit : "",
          mp: out && out.unit === "MP" ? x.outQty : null, m3: out && out.unit === "MP" ? rq(x.outQty / cfg.m3_mp) : null, t: o.t, gj: o.gj,
          chipRate: x.chipRate, chipCost: x.chippingCost, notes: op.notes, status: op.status, corrected: op.corrections.length > 0
        });
      }
      const live = rows.filter(r => r.status !== "CANCELLED");
      const sum = k => rq(live.reduce((a, r) => a + (r[k] || 0), 0));
      return { date, whId, rows, totals: { count: live.length, mp: sum("mp"), m3: sum("m3"), t: sum("t"), gj: sum("gj"), chipCost: round(live.reduce((a, r) => a + r.chipCost, 0), 2) } };
    }
  };

  const RIW = {
    VERSION, SCHEMA, EPS, Q, NumParse, round, rq, fmt, fmtQ, money, Dates, Units, PERMS, ROLES, can, OP_TYPES, STATUS, KINDS, CATS, DOC_LABEL, BASIS,
    PROD_TYPES, DIFF_REASONS, SUPPLIER_KINDS, partnerKind, ndlName, blankRun, blankExtRun, CORRECTION_REASONS, TRANSPORT_MODES, VEHICLE_TYPES, ASSET_STATUS, INV_STATUS, HISTORY_TYPES, REPORT_COLS, uid, clone, byId,
    PRODUCT_CATS, PARTNER_ROLES, CAT_UNIT, THEMES, ROLE_INFO, ROLE_DEFAULTS, CREATE_PERMS, USER_STATUS, statusOf, applyRoles, permsOf, whAccess, canAccessWh,
    normalizeEmail, validateCompanyEmail, Roles, Settings, Lx, EMAIL_RE, companyEmail, nipValid, trReason, auditText, loginFrom, migrate, I18N,
    submitOperation, approvePending, rejectPending, canApprove, planSummary,
    emptyState, validateStateShape, Stock, lockedMonth, isLocked, blankDraft, planOperation, commitOperation, saveDraft, deleteDraft,
    planCancel, cancelOperation, planCorrection, correctOperation, reverseCorrection, registerPrint, openingBalance, Inventory, Fleet, Master, Users, Reports, audit
  };
  root.RIW = RIW;
  if (typeof module !== "undefined" && module.exports) module.exports = RIW;
})(typeof globalThis !== "undefined" ? globalThis : this);
