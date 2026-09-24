/* =========================================================================
   Warstwa A: interfejs demonstratora — rdzeń, nawigacja, formularz operacji.
   Ekrany tylko prezentują i zbierają dane — każda decyzja biznesowa
   (walidacja, salda, dokumenty, uprawnienia, anulowanie, korekta)
   zapada w silniku `RIW`. Ekrany modułów: views.js.
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW;
  const { NumParse, fmt, fmtQ, money, Units, Dates, Stock } = R;
  const DBG = root.RIW_DEBUG = root.RIW_DEBUG || {};

  /* ------------------------------------------------------------------ */
  /* Narzędzia DOM                                                       */
  /* ------------------------------------------------------------------ */
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const fid = key => "f-" + key.replace(/\./g, "-");
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const ssGet = (k, d) => { try { const v = sessionStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const ssSet = (k, v) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} };

  const IC = {
    home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z", plus: "M12 5v14M5 12h14",
    layers: "M12 3 2 8l10 5 10-5-10-5zM2 16l10 5 10-5M2 12l10 5 10-5",
    file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6",
    clipboard: "M9 3h6v4H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4",
    truck: "M3 6h11v10H3zM14 10h4l3 3v3h-7M7 17.5a1.5 1.5 0 1 0 0 .01M17 17.5a1.5 1.5 0 1 0 0 .01",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
    db: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
    menu: "M4 6h16M4 12h16M4 18h16", play: "M7 4v16l13-8z", check: "M5 12l5 5L20 7", x: "M6 6l12 12M18 6 6 18",
    alert: "M12 3 2 21h20zM12 10v5M12 18h.01", dl: "M12 4v12M7 11l5 5 5-5M5 20h14",
    print: "M7 8V3h10v5M7 17H4v-7h16v7h-3M7 14h10v7H7z", edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
    trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13", up: "M12 19V5M5 12l7-7 7 7",
    list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01", inbox: "M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z",
    out: "M16 17l5-5-5-5M21 12H9M12 3H5v18h7", factory: "M3 21V11l6 4V11l6 4V7l6 4v10z", receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
    swap: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7", chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
    box: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10", users: "M16 11a4 4 0 1 0-8 0M3 21a9 6 0 0 1 18 0",
    building: "M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01",
    shield: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z", pdf: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 15h2a1.5 1.5 0 0 0 0-3H8v6",
    undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3", ban: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8"
  };
  const ic = (n, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${IC[n] || ""}"/></svg>`;

  function download(name, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  const csvCell = v => { const s = String(v == null ? "" : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvNum = n => (n === null || n === undefined || n === "") ? "" : String(R.round(n, 6)).replace(".", ",");
  function toCSV(head, rows) { return "\uFEFF" + [head, ...rows].map(r => r.map(csvCell).join(";")).join("\r\n"); }

  /* ------------------------------------------------------------------ */
  /* Toasty i okna                                                       */
  /* ------------------------------------------------------------------ */
  const Toast = {
    show(kind, title, text) {
      const host = $("#toasts");
      if (!host) return;
      const el = document.createElement("div");
      el.className = "toast " + kind;
      el.setAttribute("role", kind === "err" ? "alert" : "status");
      el.innerHTML = `<b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ""}`;
      host.appendChild(el);
      setTimeout(() => el.remove(), kind === "err" ? 8000 : 4200);
    },
    ok(t, x) { this.show("ok", t, x); }, err(t, x) { this.show("err", t, x); },
    warn(t, x) { this.show("warn", t, x); }, info(t, x) { this.show("info", t, x); }
  };

  const Modal = {
    open({ title, sub, body, footer, wide, xwide, onClose, id }) {
      const scrim = document.createElement("div");
      scrim.className = "scrim";
      scrim.innerHTML = `<div class="modal ${wide ? "wide" : ""} ${xwide ? "xwide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}" ${id ? `id="${esc(id)}"` : ""}>
        <div class="modal-h"><div style="flex:1;min-width:0"><h3>${esc(title)}</h3>${sub ? `<p>${sub}</p>` : ""}</div>
          <button class="icon-btn" data-x type="button" aria-label="Zamknij">${ic("x")}</button></div>
        <div class="modal-b">${body || ""}</div>
        ${footer ? `<div class="modal-f">${footer}</div>` : ""}</div>`;
      document.body.appendChild(scrim);
      const prev = document.activeElement;
      let closed = false;
      const close = () => { if (closed) return; closed = true; scrim.remove(); document.removeEventListener("keydown", onKey); if (onClose) onClose(); if (prev && prev.focus && document.contains(prev)) prev.focus(); };
      const onKey = e => { if (e.key === "Escape" && scrim === $$(".scrim").pop()) close(); };
      document.addEventListener("keydown", onKey);
      scrim.addEventListener("mousedown", e => { if (e.target === scrim) close(); });
      $("[data-x]", scrim).onclick = close;
      const first = $("input,select,textarea,button.primary", scrim);
      if (first) first.focus();
      return { el: scrim, body: $(".modal-b", scrim), footer: $(".modal-f", scrim), close };
    },
    confirm({ title, text, ok = "Potwierdź", danger = false, input = null }) {
      return new Promise(resolve => {
        let done = false;
        const m = this.open({
          title,
          body: `<p class="muted">${esc(text)}</p>${input ? `<div class="field mt4"><label for="cf-in">${esc(input.label)}</label>
            <input class="ctrl" id="cf-in" placeholder="${esc(input.placeholder || "")}"><div class="msg hidden" id="cf-msg"></div></div>` : ""}`,
          footer: `<button class="btn ghost" type="button" data-no>Anuluj</button><button class="btn ${danger ? "danger" : "primary"}" type="button" data-yes>${esc(ok)}</button>`,
          onClose: () => { if (!done) resolve({ ok: false }); }
        });
        $("[data-no]", m.el).onclick = () => m.close();
        $("[data-yes]", m.el).onclick = () => {
          const v = input ? $("#cf-in", m.el).value.trim() : null;
          if (input && input.required && !v) { const msg = $("#cf-msg", m.el); msg.textContent = "Pole wymagane"; msg.classList.remove("hidden"); return; }
          done = true; m.close(); resolve({ ok: true, value: v });
        };
      });
    }
  };

  /* ------------------------------------------------------------------ */
  /* Trwałość (localStorage — wyłącznie mechanizm demonstracyjny)        */
  /* ------------------------------------------------------------------ */
  const KEY = "riw.demo.state.v3";
  const OLD_KEYS = ["riw.demo.state.v2", "riw.demo.state.v1"];
  const DRAFT_KEY = "riw.demo.v3.form";
  const Store = {
    state: null, memoryOnly: false,
    read() {
      if (this.memoryOnly) return this.state;
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      const e = R.validateStateShape(s);
      if (e.length) throw new Error(e.join("; "));
      return s;
    },
    write(s) { if (!this.memoryOnly) localStorage.setItem(KEY, JSON.stringify(s)); },
    load() {
      try { localStorage.setItem("riw.demo.probe", "1"); localStorage.removeItem("riw.demo.probe"); }
      catch (e) { this.memoryOnly = true; }
      let s = null, problem = null;
      if (!this.memoryOnly) {
        try { s = this.read(); } catch (e) {
          problem = e.message;
          try { localStorage.setItem(KEY + ".uszkodzone." + Date.now(), localStorage.getItem(KEY)); } catch (x) {}
        }
      }
      if (!s) {
        s = R.Seed.build(App.today());
        try { this.write(s); } catch (e) { this.memoryOnly = true; }
      }
      this.state = s;
      return { problem };
    },
    /** Zapis „wszystko albo nic”: świeży odczyt → zmiana na kopii → jeden zapis.
        Web Locks serializuje zapisy z wielu kart tej samej przeglądarki. */
    transact(fn) {
      const run = () => {
        let fresh;
        try { fresh = this.read() || this.state; } catch (e) { return { ok: false, error: "Nie można odczytać danych: " + e.message }; }
        const work = R.clone(fresh);
        const rev0 = work.rev;
        let res;
        try { res = fn(work); } catch (e) { console.error(e); return { ok: false, error: "Błąd wewnętrzny — nic nie zapisano: " + e.message }; }
        if (!res || !res.ok) { this.state = fresh; return res || { ok: false, error: "Operacja odrzucona" }; }
        if (work.rev !== rev0) {
          try { this.write(work); } catch (e) { return { ok: false, error: "Zapis nieudany (pamięć przeglądarki pełna lub zablokowana) — nic nie zapisano." }; }
        }
        this.state = work;
        return res;
      };
      if (root.navigator && navigator.locks && navigator.locks.request) {
        return navigator.locks.request("riw-demo-state", () => run());
      }
      return Promise.resolve(run());
    }
  };

  /* ------------------------------------------------------------------ */
  /* Aplikacja                                                           */
  /* ------------------------------------------------------------------ */
  const NAV = [
    { group: "Praca" },
    { id: "pulpit", label: "Pulpit", icon: "home" },
    { id: "operacje", label: "Operacje", icon: "list" },
    { id: "przyjecia", label: "Przyjęcia", icon: "inbox" },
    { id: "wz", label: "Wydania / WZ", icon: "out" },
    { id: "produkcja", label: "Produkcja", icon: "factory" },
    { id: "kwit", label: "Kwit produkcji dnia", icon: "receipt" },
    { id: "mm", label: "MM", icon: "swap" },
    { id: "transport", label: "Transport", icon: "truck" },
    { group: "Ewidencja" },
    { id: "stany", label: "Stany magazynowe", icon: "layers" },
    { id: "dokumenty", label: "Dokumenty", icon: "file" },
    { id: "historia", label: "Historia", icon: "clock" },
    { id: "raporty", label: "Raporty", icon: "chart" },
    { id: "inwentaryzacja", label: "Inwentaryzacja", icon: "clipboard" },
    { group: "Kartoteki" },
    { id: "flota", label: "Flota", icon: "truck" },
    { id: "produkty", label: "Produkty", icon: "box" },
    { id: "kontrahenci", label: "Kontrahenci", icon: "users" },
    { id: "magazyny", label: "Magazyny", icon: "building" },
    { id: "administracja", label: "Administracja", icon: "shield" }
  ];
  const HIDDEN_ROUTES = { nowa: { label: "Nowa operacja", parent: "operacje" }, korekta: { label: "Korekta dokumentu", parent: "operacje" } };

  const App = {
    route: "pulpit", params: {}, tabs: {},
    today() { const o = ssGet("riw.demo.today", ""); return Dates.isISO(o) ? o : Dates.localToday(); },
    get state() { return Store.state; },
    user() { return R.byId(Store.state.users, lsGet("riw.demo.user", "u_kier")) || Store.state.users[0]; },
    wh() { return R.byId(Store.state.warehouses, this.user().whId); },
    ctx(source) { return { user: this.user(), today: this.today(), source }; },
    can(p) { return R.can(this.user(), p); },
    product(id) { return R.byId(Store.state.products, id); },
    partner(id) { return R.byId(Store.state.partners, id); },
    whName(id) { return (R.byId(Store.state.warehouses, id) || {}).name || "—"; },
    /** Ilość w jednostce magazynowej produktu, np. „8 293 MP”, „817 m³”, „728 t”. */
    qtyNative(q, productId, dec = 3) {
      const p = this.product(productId);
      return fmtQ(q, dec) + "\u00A0" + Units.label(p ? p.unit : "");
    },
    /** Masa orientacyjna „≈ 2 737 t” — dla produktów tonowych pusta (ilość = masa). */
    mass(q, productId) {
      const p = this.product(productId);
      if (!p || p.unit === "t") return "";
      return "≈\u00A0" + fmt(Units.mass(q, p, Store.state.config), 0) + "\u00A0t";
    },
    /** Energia orientacyjna „≈ 23 262 GJ” (1 t = 8,5 GJ). */
    energy(q, productId) {
      const p = this.product(productId);
      if (!p) return "";
      return "≈\u00A0" + fmt(Units.orient(q, p, Store.state.config).gj, 0) + "\u00A0GJ";
    },
    orientText(q, productId) { return [this.mass(q, productId), this.energy(q, productId)].filter(Boolean).join(" · "); },

    init() {
      const r = Store.load();
      if (r.problem) setTimeout(() => Toast.err("Dane były uszkodzone lub w starszym formacie", "Zachowano kopię i wczytano dane przykładowe. " + r.problem), 400);
      if (!r.problem && OLD_KEYS.some(k => lsGet(k, null)) && !lsGet("riw.demo.v3.migrated", null)) {
        lsSet("riw.demo.v3.migrated", "1");
        setTimeout(() => Toast.info("Demo v2.1 — rozszerzony model danych", "Statusy dokumentów, korekty, anulowania i MM. Dane z poprzednich wersji zostały nienaruszone pod starymi kluczami; wersja 2.1 startuje na danych przykładowych."), 600);
      }
      if (Store.memoryOnly) setTimeout(() => Toast.warn("Tryb bez zapisu", "Przeglądarka blokuje localStorage — zmiany znikną po zamknięciu karty."), 400);
      document.body.classList.toggle("no-tutorial", lsGet("riw.demo.tutorial", "1") === "0");
      this.shell();
      Store.transact(s => {
        const done = R.Inventory.autoClose(s, { user: null, today: this.today(), source: "Automat: początek kolejnego miesiąca" });
        return { ok: true, done };
      }).then(res => {
        if (res && res.done && res.done.length) {
          const okN = res.done.filter(d => d.ok).length;
          Toast.info("Przełom miesiąca", `Automatycznie zamknięto okresy inwentaryzacji: ${okN}` + (okN < res.done.length ? ` · nieudane: ${res.done.length - okN}` : ""));
        }
        this.render();
      });
      root.addEventListener("hashchange", () => this.render());
      root.addEventListener("storage", e => {
        if (e.key !== KEY || !e.newValue) return;
        try {
          const s = Store.read();
          if (!s) return;
          Store.state = s;
          Toast.info("Dane zmienione w innej karcie", "Stany i dokumenty odświeżono.");
          if ((this.route === "nowa" || this.route === "korekta") && $("#opf")) Form.refresh(); else this.render({ keepForm: true });
        } catch (x) {}
      });
      DBG.app = App; DBG.store = Store; DBG.R = R;
    },

    shell() {
      document.getElementById("app").innerHTML = `
        <div class="shell">
          <aside class="sidebar" aria-label="Nawigacja">
            <div class="sb-head"><div class="mark">RI</div><div class="sb-brand"><b>ResInvest ERP</b><span>Demonstrator ${esc(R.VERSION)}</span></div></div>
            <nav class="sb-nav" id="nav"></nav>
            <div class="sb-foot">Tryb demonstracyjny · dane w przeglądarce (localStorage)</div>
          </aside>
          <div class="scrim-nav" id="scrim-nav"></div>
          <div class="main">
            <header class="topbar">
              <button class="icon-btn menu-btn" id="menu-btn" type="button" aria-label="Menu">${ic("menu", 20)}</button>
              <h1 id="title">Pulpit</h1>
              <div class="spacer"></div>
              <a class="btn primary sm new-op-btn" href="#/nowa" id="top-new">${ic("plus", 15)}<span>Nowa operacja</span></a>
              <div class="wh-chip" id="wh-chip" title="Magazyn aktywny wynika z zalogowanego użytkownika"></div>
              <label class="sr-only" for="user-sel">Użytkownik (demo)</label>
              <select class="ctrl user-sel" id="user-sel"></select>
              <button class="icon-btn" id="intro-btn" type="button" title="Odtwórz intro" aria-label="Odtwórz intro">${ic("play", 18)}</button>
            </header>
            <main class="page" id="page" tabindex="-1"></main>
          </div>
        </div>
        <div class="toasts" id="toasts" aria-live="polite"></div>
        <div class="chart-tip hidden" id="chart-tip" role="tooltip"></div>`;
      $("#menu-btn").onclick = () => document.body.classList.toggle("nav-open");
      $("#scrim-nav").onclick = () => document.body.classList.remove("nav-open");
      $("#intro-btn").onclick = () => root.Intro && root.Intro.play({ force: true });
      $("#user-sel").onchange = e => {
        lsSet("riw.demo.user", e.target.value);
        const u = this.user();
        Toast.info("Zmiana użytkownika", `${u.name} · ${R.ROLES[u.role].label} · ${this.wh().name}`);
        if (Form.draft && Form.mode === "new" && !Form.draft.transport.placeTouched) Form.draft.transport.place = Form.defaultPlace();
        this.render({ keepForm: true });
      };
    },

    parseHash() {
      const h = (location.hash || "#/pulpit").replace(/^#\/?/, "");
      const [path, q] = h.split("?");
      const params = {};
      (q || "").split("&").filter(Boolean).forEach(kv => { const [k, v] = kv.split("="); params[decodeURIComponent(k)] = decodeURIComponent(v || ""); });
      const route = NAV.some(n => n.id === path) || HIDDEN_ROUTES[path] ? path : "pulpit";
      return { route, params };
    },

    render(opts = {}) {
      const { route, params } = this.parseHash();
      const changed = route !== this.route;
      this.route = route; this.params = params;
      document.body.classList.remove("nav-open");
      const u = this.user(), wh = this.wh();
      const active = HIDDEN_ROUTES[route] ? HIDDEN_ROUTES[route].parent : route;
      $("#nav").innerHTML = NAV.map(n => n.group ? `<div class="sb-group">${esc(n.group)}</div>` :
        `<a class="nav-item" href="#/${n.id}" data-nav="${n.id}" ${n.id === active ? 'aria-current="page"' : ""}><span class="ic">${ic(n.icon, 17)}</span><span>${esc(n.label)}</span>${this.navBadge(n.id)}</a>`).join("");
      $("#user-sel").innerHTML = Store.state.users.map(x => `<option value="${esc(x.id)}" ${x.id === u.id ? "selected" : ""}>${esc(x.name)} — ${esc(R.ROLES[x.role].label)}</option>`).join("");
      $("#wh-chip").innerHTML = `<span class="dot"></span><small>Magazyn aktywny:</small><b>${esc(wh ? wh.name : "—")}</b>`;
      $("#top-new").classList.toggle("hidden", !this.can("op.create") || route === "nowa");
      const item = NAV.find(n => n.id === route) || HIDDEN_ROUTES[route];
      $("#title").textContent = item.label;
      document.title = `${item.label} · ResInvest ERP (demo)`;
      const page = $("#page");
      const view = Views[route];
      page.innerHTML = view.html(params, opts);
      if (view.bind) view.bind(page, params, opts);
      if (changed) root.scrollTo(0, 0);
    },
    navBadge(id) {
      const S = Store.state, w = this.user().whId;
      if (id === "inwentaryzacja") { const n = S.inventory.filter(p => p.whId === w && p.status === "OTWARTA").length; return n ? `<span class="cnt">${n}</span>` : ""; }
      if (id === "operacje") { const n = S.drafts.filter(d => d.userId === this.user().id).length; return n ? `<span class="cnt" title="Wersje robocze">${n}</span>` : ""; }
      return "";
    },
    go(route) { if (location.hash !== "#/" + route) location.hash = "#/" + route; else this.render(); }
  };

  /* ------------------------------------------------------------------ */
  /* Samouczek przy polach                                               */
  /* ------------------------------------------------------------------ */
  const HELP = {
    "date": "<b>Co:</b> dzień operacji. <b>Po co:</b> decyduje o miesiącu księgowania i numeracji dokumentów. Nie może być z przyszłości ani z okresu zamkniętego. <b>Przykład:</b> 2026-09-23.",
    "purchase.supplierName": "<b>Co:</b> nazwa dostawcy — <b>wpisz ręcznie</b> albo wybierz z podpowiedzi. Nowa nazwa zostanie dopisana do kartoteki Kontrahenci przy zatwierdzeniu operacji. <b>Po co:</b> trafia na dokument PZ; ustawia podstawę (KZR / Deklaracja).",
    "purchase.supplierKind": "<b>Co:</b> grupa dostawcy. <b>Firma branży drzewnej / przedsiębiorstwo drzewne</b> → podstawa domyślnie <b>KZR</b>. <b>Nadleśnictwo</b> → podstawa domyślnie <b>Deklaracja</b> i dodatkowe pole <b>Leśnictwo</b>.",
    "purchase.lesnictwo": "<b>Co:</b> leśnictwo w wybranym nadleśnictwie. Wybierz zapisane z listy albo wpisz nowe — po zatwierdzeniu pojawi się na liście. <b>Przykład:</b> Wielopole.",
    "transport.own.runCount": "<b>Co:</b> ile kursów wykonała flota własna. Po wpisaniu np. <b>4</b> pojawią się 4 osobne rubryki: pojazd, kierowca, km, stawka, ilość i waga rzeczywista. <b>Przykład:</b> 4 kursy × 100 MP = 400 MP.",
    "purchase.basis": "<b>Co:</b> podstawa pochodzenia biomasy. Ustawia się automatycznie według grupy dostawcy (firma → KZR, nadleśnictwo → Deklaracja) — możesz ją zmienić. <b>Deklaracja</b> — oświadczenie dostawcy, <b>KZR</b> — dostawa rozliczana w systemie certyfikacji KZR.",
    "purchase.productId": "<b>Co:</b> kupowany towar. <b>Po co:</b> ustala jednostkę magazynową (drewno m³, zrębka MP, PKS i łupina t).",
    "purchase.qty": "<b>Co:</b> ilość z dokumentu dostawcy, w jednostce wybranej obok. Możesz wpisać <b>12,50</b> albo <b>12.50</b> lub wkleić <b>1 250,50</b>.",
    "purchase.unit": "<b>Co:</b> jednostka ilości i ceny — tylko te, które mają sens dla towaru. <b>1 m³ drewna = 4 MP</b>. PKS i łupina — wyłącznie t.",
    "purchase.price": "<b>Co:</b> cena netto za 1 jednostkę zakupu. <b>Po co:</b> koszt zakupu = ilość × cena.",
    "purchase.weightMode": "<b>Orientacyjna</b> = przelicznik produktu (zrębka 0,33 t/MP). <b>Ręczna</b> = waga rzeczywista z kwitu wagowego. Masa nie zmienia ilości na stanie.",
    "purchase.weightManual": "<b>Co:</b> waga z wagi samochodowej (kwit wagowy), w tonach. <b>Przykład:</b> 19,20.",
    "production.type": "<b>Co:</b> rodzaj wyprodukowanej zrębki — wskazuje produkt wynikowy i wymagane dane pochodzenia.",
    "production.rawProductId": "<b>Co:</b> surowiec, z którego powstaje produkt. Musi być innym produktem niż produkt wyjściowy.",
    "production.outProductId": "<b>Co:</b> produkt, który powstaje. <b>Przelicznik:</b> 1 m³ drewna = 4 MP zrębki.",
    "production.outQty": "<b>Co:</b> ile produktu powstało (np. MP zrębki). <b>Zużycie surowca liczy system:</b> MP ÷ 4 = m³. Nie można wyprodukować więcej, niż pozwala stan surowca.",
    "production.consumeQty": "<b>Co:</b> ile zakupionego surowca idzie do rębaka (puste = cały zakup). Tyle system odejmie ze stanu (RW).",
    "production.rawCost": "<b>Co:</b> koszt drewna z lasu, jeśli rozliczasz go w tej operacji (opcjonalnie).",
    "production.diffReason": "<b>Co:</b> przyczyna, gdy wynik jest mniejszy niż zużycie × 4. Wymagana tylko przy różnicy.",
    "production.chipRate": "<b>Co:</b> cena za rąbanie w zł za 1 MP zrębki. Domyślnie <b>10,00 zł/MP</b> — możesz zmienić. <b>Koszt rąbania = MP × cena.</b>",
    "production.ndl": "<b>Co:</b> nadleśnictwo z kwitu wywozowego. <b>Przykład:</b> Rudy Raciborskie.",
    "production.lesnictwo": "<b>Co:</b> leśnictwo z kwitu wywozowego. <b>Przykład:</b> Stanica.",
    "production.kwit": "<b>Co:</b> numer kwitu wywozowego Lasów Państwowych. <b>Przykład:</b> KW 0217/09/2026.",
    "production.investSite": "<b>Co:</b> gdzie prowadzono wycinkę i dla jakiej inwestycji.",
    "production.sourceDoc": "<b>Co:</b> numer decyzji lub protokołu wycinki (opcjonalnie).",
    "production.chipperId": "<b>Co:</b> rębak z modułu Flota (opcjonalnie). Operator uzupełni się sam.",
    "production.operatorId": "<b>Co:</b> operator rębaka. Zmiana dotyczy tylko tej produkcji.",
    "sale.productId": "<b>Co:</b> towar, który jest już na magazynie. Lista pokazuje tylko towary ze stanem.",
    "sale.qty": "<b>Co:</b> ilość do sprzedaży. Nie może przekroczyć stanu dostępnego.",
    "sale.unit": "<b>Co:</b> jednostka ilości i ceny, zgodna z towarem.",
    "sale.price": "<b>Co:</b> cena netto sprzedaży za 1 jednostkę. <b>Przychód = ilość × cena.</b>",
    "sale.buyerId": "<b>Co:</b> kupujący / odbiorca. Wymagany.",
    "sale.qtyMP": "<b>Co:</b> ile sprzedajesz z tej produkcji. Puste = cała produkcja. Nie więcej niż wyprodukowano.",
    "sale.priceUnit": "<b>Co:</b> jednostka ceny. Przy cenie za tonę przychód liczony jest z masy (MP × 0,33 t).",
    "mm.productId": "<b>Co:</b> towar przesuwany między magazynami. Stan ogółem firmy się nie zmienia.",
    "mm.qty": "<b>Co:</b> ilość do przesunięcia. Nie więcej niż stan w magazynie źródłowym.",
    "mm.toWhId": "<b>Co:</b> magazyn docelowy. Musi być inny niż magazyn aktywny (źródłowy).",
    "transport.place": "<b>Co:</b> dokąd jedzie ładunek (miejsce dostawy). Trafia na dokumenty jako „Miejsce transportu”.",
    "transport.mode": "<b>Co:</b> kto wiezie ładunek. <b>Transport nie zmienia stanu</b> — to wyłącznie koszt i karta transportu (TR).",
    "transport.own.vehicleId": "<b>Co:</b> pojazd z modułu Flota. Rejestracja i kierowca domyślny uzupełnią się same.",
    "transport.own.driverId": "<b>Co:</b> kierowca tego kursu. Zmiana dotyczy <b>tylko tego kursu</b>.",
    "transport.own.km": "<b>Co:</b> długość trasy w km. <b>Koszt = km × stawka.</b>",
    "transport.own.rate": "<b>Co:</b> stawka za kilometr. Puste = stawka domyślna.",
    "transport.external.company": "<b>Co:</b> firma przewozowa. <b>Przykład:</b> ESI Logistics.",
    "transport.external.reg": "<b>Co:</b> numer rejestracyjny auta przewoźnika.",
    "transport.external.km": "<b>Co:</b> odległość w km (informacyjnie).",
    "transport.external.freight": "<b>Co:</b> kwota frachtu z faktury przewoźnika.",
    "transport.external.includedInPrice": "Zaznacz, gdy transport jest wliczony w cenę towaru. Koszt transportu tej operacji = 0 zł.",
    "transport.train.trainNo": "<b>Co:</b> numer składu. <b>Przykład:</b> RC 50931.",
    "transport.train.carrier": "<b>Co:</b> przewoźnik kolejowy. <b>Przykład:</b> PKP Cargo.",
    "transport.train.docNo": "<b>Co:</b> numer listu przewozowego (CIM / SMGS).",
    "transport.train.loadPlace": "<b>Co:</b> bocznica / stacja załadunku.",
    "transport.train.wagonCount": "<b>Co:</b> liczba wagonów w składzie. <b>Przykład:</b> 20.",
    "transport.train.capacity": "<b>Co:</b> ładowność jednego wagonu (opcjonalnie) — w MP albo w tonach. Kontrola przeładowania.",
    "transport.train.sameT": "<b>Co:</b> tonaż jednego wagonu — trafi do każdego wagonu. <b>Przykład:</b> 20 × 60 t = 1 200 t.",
    "transport.train.price": "<b>Co:</b> stawka frachtu kolejowego. Ilość do rozliczenia wynika z tonażu składu.",
    "transport.train.priceUnit": "<b>Co:</b> za co płacimy przewoźnikowi: t, MP czy m³.",
    "notes": "<b>Co:</b> dodatkowe informacje (opcjonalnie).",
    "extDoc": "<b>Co:</b> numer dokumentu zewnętrznego (faktura, kwit wagowy, zlecenie) — opcjonalnie."
  };

  /* ------------------------------------------------------------------ */
  /* Kontrolki formularza                                                */
  /* ------------------------------------------------------------------ */
  function setPath(o, path, v) {
    const ks = path.split("."); let cur = o;
    for (let i = 0; i < ks.length - 1; i++) { if (cur[ks[i]] == null) cur[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; cur = cur[ks[i]]; }
    cur[ks[ks.length - 1]] = v;
  }
  function field({ key, label, req, control, span, help = true, calc = "" }) {
    return `<div class="field ${span || ""}" data-field="${esc(key)}">
      <label for="${fid(key)}">${esc(label)}${req ? ' <span class="req" aria-hidden="true">*</span>' : ""}</label>
      ${control}
      <div class="calc" data-calc="${esc(key)}">${calc}</div>
      <div class="msg hidden" data-msg="${esc(key)}" role="alert"></div>
      ${help && HELP[key] ? `<div class="help tut">${HELP[key]}</div>` : ""}
    </div>`;
  }
  const textIn = (key, v, { placeholder = "", list = "", disabled = false } = {}) =>
    `<input class="ctrl" type="text" id="${fid(key)}" data-bind="${esc(key)}" value="${esc(v)}" placeholder="${esc(placeholder)}" autocomplete="off" ${list ? `list="${list}"` : ""} ${disabled ? "disabled" : ""}>`;
  const numIn = (key, v, { suffix = "", placeholder = "" } = {}) =>
    `<div class="input-wrap"><input class="ctrl num-in" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
      id="${fid(key)}" data-bind="${esc(key)}" data-num value="${esc(v)}" placeholder="${esc(placeholder)}">${suffix ? `<span class="suffix">${esc(suffix)}</span>` : ""}</div>`;
  const selIn = (key, options, v, { struct = false, disabled = false } = {}) =>
    `<select class="ctrl" id="${fid(key)}" data-bind="${esc(key)}" ${struct ? "data-struct" : ""} ${disabled ? "disabled" : ""}>${options.map(o =>
      `<option value="${esc(o.v)}" ${String(o.v) === String(v == null ? "" : v) ? "selected" : ""} ${o.disabled ? "disabled" : ""}>${esc(o.l)}</option>`).join("")}</select>`;
  const outBox = (key, html) => `<output class="ctrl num-in out" id="${fid(key)}" data-out="${esc(key)}">${html}</output>`;
  const optCard = (key, { checked, disabled, title, text, struct = true, radio = false, attrs = "", id = "" }) =>
    `<label class="opt ${radio ? "radio" : ""} ${disabled && checked ? "locked" : ""} ${disabled && !checked ? "dis" : ""}">
      <input type="checkbox" ${key || id ? `id="${id || fid(key)}"` : ""} ${key ? `data-bind="${esc(key)}"` : ""} ${struct ? "data-struct" : ""} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} ${attrs}>
      <span class="box">${ic("check", 13)}</span><span class="ct"><b>${esc(title)}</b><span>${esc(text)}</span></span></label>`;
  const section = (n, id, title, sub, body, off) => `<section class="sec ${off ? "off" : ""}" aria-labelledby="h-${id}">
      <div class="sec-h"><span class="n">${n}</span><div><h3 id="h-${id}">${esc(title)}</h3><p>${esc(sub)}</p></div></div>
      <div class="sec-b">${body || ""}</div></section>`;
  const statusBadge = st => `<span class="badge st-${esc(st)}" data-status="${esc(st)}">${esc(R.STATUS[st] || st)}</span>`;

  /* ------------------------------------------------------------------ */
  /* Nowa operacja / korekta                                             */
  /* ------------------------------------------------------------------ */
  const PRESETS = {
    zakup: d => { d.type = "ZAKUP"; d.purchase.productId = "pr_drewno"; d.purchase.unit = "m3"; },
    lancuch: d => { d.type = "ZAKUP"; d.purchase.productId = "pr_drewno"; d.purchase.unit = "m3"; d.production.enabled = true; d.sale.enabled = true; },
    wz: d => { d.type = "SPRZEDAZ"; d.sale.direct = false; },
    produkcja: d => { d.type = "PRODUKCJA"; d.production.rawProductId = "pr_drewno"; d.production.outProductId = "pr_zr_lesna"; },
    bezposrednia: d => { d.type = "SPRZEDAZ"; d.sale.direct = true; d.production.rawProductId = "pr_drewno"; d.production.outProductId = "pr_zr_lesna"; },
    mm: d => { d.type = "MM"; }
  };
  const CANCEL_REASONS = ["pomyłka operatora", "dokument wprowadzony podwójnie", "dostawa nie dotarła", "błędny kontrahent", "błędny magazyn", "inny"];

  const Form = {
    mode: "new", op: null, draft: null, touched: new Set(), showAll: false, saving: false, plan: null, corr: null,

    /* ---------- cykl życia szkicu ---------- */
    ensureDraft(preset, draftId) {
      this.mode = "new"; this.op = null; this.corr = null;
      if (draftId) {
        const rec = R.byId(Store.state.drafts, draftId);
        if (rec) { this.draft = Object.assign(R.clone(rec.draft), { idemKey: R.uid("idem"), draftId: rec.id }); this.touched = new Set(); this.showAll = false; this.persist(); return; }
      }
      const stored = ssGet(DRAFT_KEY, null);
      if (!this.draft && stored) {
        try { const d = JSON.parse(stored); if (d && d.idemKey && d.type && !Store.state.operations.some(o => o.idemKey === d.idemKey)) this.draft = d; } catch (e) {}
      }
      if (this.draft && Store.state.operations.some(o => o.idemKey === this.draft.idemKey)) this.draft = null;
      if (!this.draft || preset) this.reset(preset);
    },
    startCorrection(opId) {
      const op = R.byId(Store.state.operations, opId);
      this.mode = "correct"; this.op = op;
      if (!op) { this.draft = null; return; }
      if (!this.draft || this.draft._corrOf !== op.id || this.draft._corrRev !== op.corrections.length) {
        this.draft = Object.assign(R.blankDraft({ today: op.date }), R.clone(op.input), { idemKey: "corr", _corrOf: op.id, _corrRev: op.corrections.length, date: op.date, type: op.type });
        this.corr = { reason: "", reasonText: "", key: R.uid("corr") };
        this.touched = new Set(); this.showAll = false;
      }
    },
    reset(preset) {
      const d = R.blankDraft({ today: App.today() });
      d.production.chipRate = fmt(Store.state.config.chipRateDefault, 2);
      if (PRESETS[preset]) PRESETS[preset](d);
      this.draft = d; this.touched = new Set(); this.showAll = false;
      d.transport.place = this.defaultPlace();
      this.persist();
    },
    persist() { if (this.mode === "new") ssSet(DRAFT_KEY, JSON.stringify(this.draft)); },
    defaultPlace() {
      const d = this.draft;
      if (!d) return App.wh() ? App.wh().name : "";
      if (d.type === "MM") { const w = R.byId(Store.state.warehouses, d.mm.toWhId); if (w) return w.name; }
      if (d.type === "SPRZEDAZ" || (d.type === "ZAKUP" && d.sale.enabled)) { const b = App.partner(d.sale.buyerId); if (b) return b.name; }
      return App.wh() ? App.wh().name : "";
    },
    whId() { return this.mode === "correct" && this.op ? this.op.whId : App.user().whId; },
    /** Grupa dostawcy: wybór użytkownika, a przy starszych szkicach — z kartoteki wybranego dostawcy. */
    /** Tekst w polu dostawcy: wpisana nazwa albo nazwa wybranego kontrahenta (starsze szkice / korekta). */
    supplierText() {
      const P = this.draft.purchase;
      if (!P.supplierName && P.supplierId) P.supplierName = (App.partner(P.supplierId) || {}).name || "";
      return P.supplierName || "";
    },
    supplierKind() {
      const P = this.draft.purchase;
      if (R.SUPPLIER_KINDS[P.supplierKind]) return P.supplierKind;
      const s = App.partner(P.supplierId);
      return s ? R.partnerKind(s) : "firma";
    },
    /** Zapisane leśnictwa nadleśnictwa: z kartoteki + z wcześniejszych operacji (nowe dopisują się same). */
    lesnictwa(supplierId) {
      const S = Store.state, set = new Set(((App.partner(supplierId) || {}).lesnictwa) || []);
      for (const o of S.operations) {
        if (o.purchase && o.purchase.supplierId === supplierId && o.purchase.lesnictwo) set.add(o.purchase.lesnictwo);
        if (o.purchase && o.purchase.supplierId === supplierId && o.production && o.production.lesnictwo) set.add(o.production.lesnictwo);
      }
      return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, "pl"));
    },
    /** Jednostka towaru przewożonego (ilość w kursie). */
    shippedUnit() {
      const d = this.draft, p = id => App.product(id);
      if (d.type === "SPRZEDAZ" && !d.sale.direct && p(d.sale.productId)) return p(d.sale.productId).unit;
      if (d.type === "SPRZEDAZ" && d.sale.direct) return "MP";
      if (d.type === "MM" && p(d.mm.productId)) return p(d.mm.productId).unit;
      if (d.type === "ZAKUP" && d.production.enabled) return "MP";
      return p(d.purchase.productId) ? p(d.purchase.productId).unit : "MP";
    },
    ownRuns() {
      const O = this.draft.transport.own;
      if (!Array.isArray(O.runs)) { this.draft.transport.own = O.vehicleId !== undefined ? { runCount: "1", runs: [Object.assign(R.blankRun(), { vehicleId: O.vehicleId || "", driverId: O.driverId || "", km: O.km || "", rate: O.rate || "" })] } : { runCount: "1", runs: [R.blankRun()] }; }
      return this.draft.transport.own;
    },

    /* ---------- pola produkcji (trzy ścieżki) ---------- */
    productionFields(mode) {
      const S = Store.state, d = this.draft, P_ = d.production;
      const chipper = R.byId(S.fleet.chippers, P_.chipperId);
      const woods = S.products.filter(p => p.cat === "drewno" && p.active !== false);
      const outs = S.products.filter(p => p.unit === "MP" && p.active !== false);
      const stock = Stock.byProduct(S, this.whId());
      let head = "";
      if (mode === "stock") {
        const raw = App.product(P_.rawProductId), out = App.product(P_.outProductId);
        const ru = raw ? Units.label(raw.unit) : "", ou = out ? Units.label(out.unit) : "MP";
        head = `
          ${field({ key: "production.wh", label: "Magazyn", control: outBox("production.wh", esc(App.whName(this.whId()))), help: false })}
          ${field({ key: "production.rawProductId", label: "Surowiec (ze stanu)", req: true, span: "span2", control: selIn("production.rawProductId", [{ v: "", l: "— wybierz surowiec —" }].concat(S.products.filter(p => p.active !== false && (stock.get(p.id) || 0) > R.EPS || p.id === P_.rawProductId).map(p => ({ v: p.id, l: `${p.name} — na stanie ${fmtQ(stock.get(p.id) || 0)} ${Units.label(p.unit)}` }))), P_.rawProductId, { struct: true }) })}
          ${field({ key: "production.stock", label: "Stan surowca", control: outBox("production.stock", "—"), help: false })}
          ${field({ key: "production.outProductId", label: "Produkt wyjściowy", req: true, span: "span2", control: selIn("production.outProductId", [{ v: "", l: "— wybierz produkt —" }].concat(S.products.filter(p => p.active !== false).map(p => ({ v: p.id, l: `${p.name} (${Units.label(p.unit)})` }))), P_.outProductId, { struct: true }) })}
          ${field({ key: "production.outQty", label: `Ilość produkcji${ou ? ` (${ou})` : ""}`, req: true, control: numIn("production.outQty", P_.outQty, { suffix: ou, placeholder: "np. 500" }) })}
          ${field({ key: "production.consume", label: `Zużycie surowca${ru ? ` (${ru})` : ""} — auto`, control: outBox("production.consume", "—"), help: false })}
          ${field({ key: "production.after", label: "Stan surowca po produkcji", control: outBox("production.after", "—"), help: false })}
          ${field({ key: "production.orient", label: "Masa ≈ t · energia ≈ GJ", span: "span2", control: outBox("production.orient", "—"), help: false })}
          <div class="field" data-field="production.factor"><span class="lbl">Przelicznik</span><output class="ctrl num-in out" data-out="production.factorTxt">—</output><div class="msg hidden" data-msg="production.factor" role="alert"></div></div>`;
      } else if (mode === "direct") {
        head = `
          ${field({ key: "production.rawProductId", label: "Surowiec z lasu (nie ze stanu)", req: true, span: "span2", control: selIn("production.rawProductId", [{ v: "", l: "— wybierz surowiec —" }].concat(woods.map(p => ({ v: p.id, l: `${p.name} (${Units.label(p.unit)})` }))), P_.rawProductId, { struct: true }) })}
          ${field({ key: "production.outProductId", label: "Produkt wyjściowy", req: true, span: "span2", control: selIn("production.outProductId", [{ v: "", l: "— wybierz produkt —" }].concat(outs.map(p => ({ v: p.id, l: p.name }))), P_.outProductId, { struct: true }) })}
          ${field({ key: "production.outQty", label: "Wyprodukowano (MP)", req: true, control: numIn("production.outQty", P_.outQty, { suffix: "MP", placeholder: "np. 600" }) })}
          ${field({ key: "production.rawQty", label: "Surowiec zużyty (m³) — auto", control: outBox("production.rawQty", "—"), help: false })}
          ${field({ key: "production.rawCost", label: "Koszt surowca (zł)", span: "span2", control: numIn("production.rawCost", P_.rawCost, { suffix: "zł", placeholder: "opcjonalnie" }) })}
          <div class="field span-all" data-field="production.factor"><div class="msg hidden" data-msg="production.factor" role="alert"></div></div>`;
      } else {
        const u = Units.label(d.purchase.unit);
        head = `${field({ key: "production.consumeQty", label: `Zużycie surowca (${u})`, span: "span2", control: numIn("production.consumeQty", P_.consumeQty, { suffix: u, placeholder: "cały zakup" }) })}
          ${field({ key: "production.outQty", label: "Wyprodukowano (MP)", control: numIn("production.outQty", P_.outQty, { suffix: "MP", placeholder: "auto: zużycie × 4" }) })}
          ${field({ key: "production.diffReason", label: "Przyczyna różnicy", control: selIn("production.diffReason", [{ v: "", l: "— brak różnicy —" }].concat(Object.entries(R.DIFF_REASONS).map(([k, v]) => ({ v: k, l: v }))), P_.diffReason) })}`;
      }
      const origin = mode === "stock" ? "" : (P_.type === "lesna" ? `
          ${field({ key: "production.ndl", label: "Nadleśnictwo", req: true, control: textIn("production.ndl", P_.ndl, { placeholder: "np. Rudy Raciborskie", list: "dl-ndl" }) })}
          ${field({ key: "production.lesnictwo", label: "Leśnictwo", req: true, control: textIn("production.lesnictwo", P_.lesnictwo, { placeholder: "np. Stanica" }) })}
          ${field({ key: "production.kwit", label: "Nr kwitu wywozowego", req: true, span: "span2", control: textIn("production.kwit", P_.kwit, { placeholder: "np. KW 0217/09/2026" }) })}` : `
          ${field({ key: "production.investSite", label: "Miejsce wycinki / inwestycja", req: true, span: "span2", control: textIn("production.investSite", P_.investSite, { placeholder: "np. Obwodnica Gliwic" }) })}
          ${field({ key: "production.sourceDoc", label: "Nr dokumentu źródłowego", span: "span2", control: textIn("production.sourceDoc", P_.sourceDoc, { placeholder: "np. Protokół wycinki 17/2026" }) })}`);
      return `<div class="fgrid four">
          ${mode !== "stock" ? field({ key: "production.type", label: "Rodzaj produkcji", req: true, span: "span2", control: selIn("production.type", Object.entries(R.PROD_TYPES).map(([k, v]) => ({ v: k, l: v.label })), P_.type, { struct: true }) }) + "<div class=\"span2\"></div>" : ""}
          ${head}
          ${field({ key: "production.chipRate", label: "Cena za rąbanie [zł/MP]", control: numIn("production.chipRate", P_.chipRate, { suffix: "zł/MP", placeholder: "10,00" }) })}
          ${field({ key: "production.chipCost", label: "Koszt rąbania", control: outBox("production.chipCost", "—"), help: false })}
          ${origin}
          ${field({ key: "production.chipperId", label: "Rębak (Flota)", span: "span2", control: selIn("production.chipperId", [{ v: "", l: "— bez wskazania rębaka —" }].concat(S.fleet.chippers.map(c => ({ v: c.id, l: `${c.name}${c.status !== "aktywny" ? " — " + R.ASSET_STATUS[c.status] : ""}`, disabled: c.status !== "aktywny" }))), P_.chipperId, { struct: true }) })}
          ${P_.chipperId ? field({ key: "production.operatorId", label: "Operator rębaka", span: "span2", control: selIn("production.operatorId", S.fleet.operators.map(o => ({ v: o.id, l: o.name + (chipper && chipper.operatorId === o.id ? " (domyślny)" : "") })), P_.operatorId || (chipper ? chipper.operatorId : "")) }) : ""}
        </div>
        <datalist id="dl-ndl">${["Rudy Raciborskie", "Rybnik", "Katowice", "Brynek", "Gliwice"].map(x => `<option value="${esc(x)}">`).join("")}</datalist>`;
    },
    saleOfOutputFields() {
      const d = this.draft;
      const buyers = Store.state.partners.filter(p => (p.active !== false || p.id === d.sale.buyerId) && ["buyer", "both"].includes(p.role));
      return `<div class="fgrid four">
        ${field({ key: "sale.buyerId", label: "Odbiorca", req: true, span: "span2", control: selIn("sale.buyerId", [{ v: "", l: "— wybierz odbiorcę —" }].concat(buyers.map(p => ({ v: p.id, l: p.name }))), d.sale.buyerId, { struct: true }) })}
        ${field({ key: "sale.qtyMP", label: "Ilość sprzedaży (MP)", control: numIn("sale.qtyMP", d.sale.qtyMP, { suffix: "MP", placeholder: "cała produkcja" }) })}
        ${field({ key: "sale.weight", label: "Masa · energia", control: outBox("sale.weight", "—"), help: false })}
        ${field({ key: "sale.price", label: `Cena sprzedaży (zł/${d.sale.priceUnit})`, req: true, control: numIn("sale.price", d.sale.price, { suffix: `zł/${d.sale.priceUnit}`, placeholder: "np. 90" }) })}
        ${field({ key: "sale.priceUnit", label: "Cena za", control: selIn("sale.priceUnit", [{ v: "MP", l: "MP" }, { v: "t", l: "t (tonę)" }], d.sale.priceUnit, { struct: true }) })}
        ${field({ key: "sale.revenue", label: "Przychód ze sprzedaży", span: "span2", control: outBox("sale.revenue", "—"), help: false })}
      </div>`;
    },

    sectionsHtml() {
      const S = Store.state, d = this.draft, wh = R.byId(S.warehouses, this.whId());
      const type = d.type, corr = this.mode === "correct";
      const typeCard = (t, title, text) => optCard("", { checked: type === t, disabled: corr, struct: false, radio: true, id: `f-type-${t}`, title, text, attrs: `data-type="${t}"` });
      let n = 1;
      let html = section(n++, "type", corr ? "Korygowany dokument" : "Rodzaj operacji", corr ? "Rodzaju operacji, magazynu i daty dokumentu nie zmienia się korektą — w razie potrzeby anuluj dokument i wprowadź nowy." : "Każdy rodzaj działa samodzielnie — wypełniasz tylko to, co jest potrzebne.", `
        <div class="scope four" role="group" aria-label="Rodzaj operacji">
          ${typeCard("ZAKUP", "Zakup", "Dostawca → magazyn (PZ). Opcjonalnie produkcja i sprzedaż wyniku.")}
          ${typeCard("SPRZEDAZ", "Sprzedaż", "Magazyn → odbiorca (WZ) albo sprzedaż bezpośrednia po produkcji w lesie.")}
          ${typeCard("PRODUKCJA", "Produkcja na magazyn", "Surowiec ze stanu → produkt na stanie (RW + PW). Bez transportu.")}
          ${typeCard("MM", "Przesunięcie MM", "Magazyn → inny magazyn firmy. Stan firmy bez zmian.")}
        </div>
        <div class="info-line mt3">${ic("layers", 15)}<span>Magazyn: <b>${esc(wh ? wh.name : "—")}</b>${corr ? " — magazyn dokumentu" : ` — wynika z zalogowanego użytkownika (${esc(App.user().name)})`}.</span></div>
        <div class="fgrid four mt4">${field({ key: "date", label: "Data operacji", req: true, control: `<input class="ctrl" type="date" id="${fid("date")}" data-bind="date" value="${esc(d.date)}" max="${esc(App.today())}" ${corr ? "disabled" : ""}>` })}</div>`);

      if (type === "ZAKUP") {
        const prod = App.product(d.purchase.productId);
        const isWood = prod && prod.cat === "drewno";
        const sKind = this.supplierKind();
        const suppliers = S.partners.filter(p => (p.active !== false || p.id === d.purchase.supplierId) && ["supplier", "both"].includes(p.role) && R.partnerKind(p) === sKind);
        const kindCard = (k, text) => optCard("", { checked: sKind === k, struct: false, radio: true, id: `f-skind-${k}`, title: R.SUPPLIER_KINDS[k].label, text, attrs: `data-skind="${k}"` });
        const units = prod ? Units.allowed(prod) : Units.LIST;
        const u = Units.label(d.purchase.unit);
        html += section(n++, "purchase", "Zakup", "Co kupujemy, od kogo, w jakiej jednostce i za ile.", `
          <div class="scope mb3">
            ${optCard("production.enabled", { checked: d.production.enabled, disabled: !isWood || corr, title: "+ Produkcja z automatycznym zużyciem", text: isWood ? "Zużycie zakupionego drewna (RW) i przyjęcie zrębki (PW) w tej samej operacji." : "Dostępna dla drewna." })}
            ${optCard("sale.enabled", { checked: d.sale.enabled, disabled: !d.production.enabled || corr, title: "+ Sprzedaż wyniku produkcji", text: d.production.enabled ? "Wydanie zrębki z tej produkcji do odbiorcy (WZ)." : "Wymaga produkcji. Sprzedaż ze stanu → rodzaj „Sprzedaż”." })}
          </div>
          <div class="fgrid four">
            <div class="field span-all" data-field="purchase.supplierKind"><span class="lbl">Dostawca — wybierz grupę <span class="req" aria-hidden="true">*</span></span>
              <div class="scope two" role="group" aria-label="Grupa dostawcy">${kindCard("firma", "Tartaki, zakłady i firmy leśne. Podstawa domyślnie: KZR.")}${kindCard("nadlesnictwo", "Lasy Państwowe. Podstawa domyślnie: Deklaracja. Dodatkowo: leśnictwo.")}</div>
              <div class="help tut">${HELP["purchase.supplierKind"]}</div></div>
            ${field({ key: "purchase.supplierName", label: sKind === "nadlesnictwo" ? "Nadleśnictwo" : "Dostawca (firma)", req: true, span: "span2", control: textIn("purchase.supplierName", this.supplierText(), { placeholder: sKind === "nadlesnictwo" ? "wpisz lub wybierz, np. Nadleśnictwo Rybnik" : "wpisz lub wybierz, np. Lander Agro", list: "dl-suppliers" }) + `<datalist id="dl-suppliers">${suppliers.map(p => `<option value="${esc(p.name)}">`).join("")}</datalist>` })}
            ${sKind === "nadlesnictwo" ? field({ key: "purchase.lesnictwo", label: "Leśnictwo", req: true, control: textIn("purchase.lesnictwo", d.purchase.lesnictwo, { placeholder: "wybierz lub wpisz nowe", list: "dl-lesn" }) + `<datalist id="dl-lesn">${this.lesnictwa(d.purchase.supplierId).map(x => `<option value="${esc(x)}">`).join("")}</datalist>` }) : ""}
            ${field({ key: "purchase.basis", label: "Podstawa", req: true, span: sKind === "nadlesnictwo" ? "" : "span2", control: selIn("purchase.basis", [{ v: "DEKL", l: "Deklaracja" }, { v: "KZR", l: "KZR" }], d.purchase.basis) })}
            ${field({ key: "purchase.productId", label: "Produkt / surowiec", req: true, span: "span2", control: selIn("purchase.productId", [{ v: "", l: "— wybierz produkt —" }].concat(S.products.filter(p => p.active !== false).map(p => ({ v: p.id, l: `${p.name} (${Units.label(p.unit)})` }))), d.purchase.productId, { struct: true, disabled: corr }) })}
            ${field({ key: "purchase.qty", label: "Ilość", req: true, control: numIn("purchase.qty", d.purchase.qty, { suffix: u, placeholder: "np. 20" }) })}
            ${field({ key: "purchase.unit", label: "Jednostka zakupu", req: true, control: selIn("purchase.unit", units.map(x => ({ v: x, l: Units.label(x) })), d.purchase.unit, { struct: true }) })}
            ${field({ key: "purchase.price", label: `Cena jednostkowa (zł/${u})`, req: true, control: numIn("purchase.price", d.purchase.price, { suffix: `zł/${u}`, placeholder: "np. 230" }) })}
            ${field({ key: "purchase.cost", label: "Koszt całkowity zakupu", control: outBox("purchase.cost", "—"), help: false })}
            ${field({ key: "purchase.weightMode", label: "Masa", req: true, control: selIn("purchase.weightMode", [{ v: "auto", l: "Orientacyjna (przelicznik)" }, { v: "manual", l: "Ręczna — waga rzeczywista" }], d.purchase.weightMode, { struct: true }) })}
            ${d.purchase.weightMode === "manual"
              ? field({ key: "purchase.weightManual", label: "Waga rzeczywista (t)", req: true, control: numIn("purchase.weightManual", d.purchase.weightManual, { suffix: "t", placeholder: "np. 19,20" }) })
              : field({ key: "purchase.weightAuto", label: "Masa · energia (orientacyjnie)", control: outBox("purchase.weightAuto", "—"), help: false })}
          </div>`);
        html += d.production.enabled ? section(n++, "prod", "Produkcja z automatycznym zużyciem", "Zakupione drewno jest od razu dostępne do pobrania. Kolejność: zakup → zużycie → produkcja.", this.productionFields("chain")) : "";
        html += d.sale.enabled ? section(n++, "sale", "Sprzedaż wyniku produkcji", "Sprzedajemy zrębkę z tej produkcji. Zmniejsza stan zrębki.", this.saleOfOutputFields()) : "";
      } else if (type === "SPRZEDAZ") {
        const direct = !!d.sale.direct;
        const toggle = `<div class="scope one mb3">${optCard("sale.direct", { checked: direct, disabled: corr, title: "Sprzedaż bezpośrednia po produkcji / prosto z lasu", text: "las → produkcja → sprzedaż → odbiorca. Towar NIE jest pobierany z magazynu i nie zwiększa stanu." })}</div>`;
        if (!direct) {
          const stock = Stock.byProduct(corr ? Object.assign({}, S, { ledger: S.ledger.filter(l => l.opId !== this.op.id) }) : S, this.whId());
          const prods = S.products.filter(p => (stock.get(p.id) || 0) > R.EPS || p.id === d.sale.productId);
          const prod = App.product(d.sale.productId);
          const units = prod ? Units.allowed(prod) : [];
          const u = Units.label(d.sale.unit);
          const buyers = S.partners.filter(p => (p.active !== false || p.id === d.sale.buyerId) && ["buyer", "both"].includes(p.role));
          html += section(n++, "sale", "Sprzedaż z magazynu (WZ)", "Towar, który już jest na stanie → odbiorca. WZ odejmuje sprzedaną ilość ze stanu.", toggle + `
            <div class="fgrid four">
              ${field({ key: "sale.productId", label: "Towar z magazynu", req: true, span: "span2", control: selIn("sale.productId", [{ v: "", l: "— wybierz towar —" }].concat(prods.map(p => ({ v: p.id, l: `${p.name} — ${fmtQ(stock.get(p.id) || 0)} ${Units.label(p.unit)}` }))), d.sale.productId, { struct: true, disabled: corr }) })}
              ${field({ key: "sale.onStock", label: "Stan dostępny", control: outBox("sale.onStock", "—"), help: false })}
              ${field({ key: "sale.after", label: "Stan po WZ", control: outBox("sale.after", "—"), help: false })}
              ${field({ key: "sale.qty", label: "Ilość", req: true, control: numIn("sale.qty", d.sale.qty, { suffix: u, placeholder: "np. 500" }) })}
              ${field({ key: "sale.unit", label: "Jednostka", req: true, control: prod ? selIn("sale.unit", units.map(x => ({ v: x, l: Units.label(x) })), d.sale.unit, { struct: true }) : outBox("sale.unit", "wybierz towar") })}
              ${field({ key: "sale.price", label: `Cena sprzedaży (zł/${u})`, req: true, control: numIn("sale.price", d.sale.price, { suffix: `zł/${u}`, placeholder: "np. 90" }) })}
              ${field({ key: "sale.revenue", label: "Wartość sprzedaży", control: outBox("sale.revenue", "—"), help: false })}
              ${field({ key: "sale.buyerId", label: "Kupujący / odbiorca", req: true, span: "span2", control: selIn("sale.buyerId", [{ v: "", l: "— wybierz odbiorcę —" }].concat(buyers.map(p => ({ v: p.id, l: p.name }))), d.sale.buyerId, { struct: true }) })}
              ${field({ key: "sale.weight", label: "Masa · energia (orientacyjnie)", span: "span2", control: outBox("sale.weight", "—"), help: false })}
            </div>`);
        } else {
          html += section(n++, "sale", "Sprzedaż bezpośrednia", "las → produkcja → sprzedaż. Bez zakupu i bez pobierania z magazynu.", toggle);
          html += section(n++, "prod", "Produkcja (w lesie)", "Surowiec, produkt i ilość. Zużycie surowca liczy system (MP ÷ 4 = m³).", this.productionFields("direct"));
          html += section(n++, "sale2", "Odbiorca i cena", "Sprzedaż nie może przekroczyć ilości wyprodukowanej.", this.saleOfOutputFields());
        }
      } else if (type === "PRODUKCJA") {
        html += section(n++, "prod", "Produkcja na magazyn", "Podajesz ilość wyprodukowaną — zużycie surowca liczy system (MP ÷ 4 = m³). Bez zakupu, bez transportu, bez odbiorcy.", this.productionFields("stock"));
      } else if (type === "MM") {
        const M = d.mm;
        const stock = Stock.byProduct(corr ? Object.assign({}, S, { ledger: S.ledger.filter(l => l.opId !== this.op.id) }) : S, this.whId());
        const prods = S.products.filter(p => (stock.get(p.id) || 0) > R.EPS || p.id === M.productId);
        const prod = App.product(M.productId);
        const u = Units.label(M.unit);
        html += section(n++, "mm", "Przesunięcie międzymagazynowe (MM)", "Rozchód z magazynu źródłowego i przychód w docelowym — jednym dokumentem MM.", `
          <div class="fgrid four">
            ${field({ key: "mm.from", label: "Magazyn źródłowy", control: outBox("mm.from", esc(wh ? wh.name : "—")), help: false })}
            ${field({ key: "mm.toWhId", label: "Magazyn docelowy", req: true, control: selIn("mm.toWhId", [{ v: "", l: "— wybierz magazyn —" }].concat(S.warehouses.filter(w => w.id !== this.whId()).map(w => ({ v: w.id, l: w.name }))), M.toWhId, { struct: true, disabled: corr }) })}
            ${field({ key: "mm.productId", label: "Towar", req: true, span: "span2", control: selIn("mm.productId", [{ v: "", l: "— wybierz towar —" }].concat(prods.map(p => ({ v: p.id, l: `${p.name} — ${fmtQ(stock.get(p.id) || 0)} ${Units.label(p.unit)}` }))), M.productId, { struct: true, disabled: corr }) })}
            ${field({ key: "mm.qty", label: "Ilość", req: true, control: numIn("mm.qty", M.qty, { suffix: u, placeholder: "np. 300" }) })}
            ${field({ key: "mm.unit", label: "Jednostka", req: true, control: prod ? selIn("mm.unit", Units.allowed(prod).map(x => ({ v: x, l: Units.label(x) })), M.unit, { struct: true }) : outBox("mm.unit", "wybierz towar") })}
            ${field({ key: "mm.srcBal", label: "Źródło: stan przed → po", control: outBox("mm.srcBal", "—"), help: false })}
            ${field({ key: "mm.dstBal", label: "Cel: stan przed → po", control: outBox("mm.dstBal", "—"), help: false })}
          </div>`);
      }

      if (type !== "PRODUKCJA") html += this.transportHtml(n++);
      html += section(n++, "notes", "Uwagi i dokument zewnętrzny", "", `<div class="fgrid four">
        ${field({ key: "extDoc", label: "Nr dokumentu zewnętrznego", span: "span2", control: textIn("extDoc", d.extDoc, { placeholder: "np. FV 123/09/2026, kwit wagowy" }) })}
        ${field({ key: "notes", label: "Uwagi do operacji", span: "span2", control: `<textarea class="ctrl" id="${fid("notes")}" data-bind="notes" rows="2">${esc(d.notes)}</textarea>` })}</div>`);
      return html;
    },

    transportHtml(n) {
      const S = Store.state, T = this.draft.transport, mode = T.mode;
      const veh = R.byId(S.fleet.vehicles, T.own.vehicleId);
      const tr = T.train;
      let modeHtml = "";
      if (mode === "own") {
        const O = this.ownRuns();
        const count = Math.max(0, Math.min(50, Math.floor(NumParse.value(O.runCount, 0)) || 0));
        const u = Units.label(this.shippedUnit());
        const vehOpts = S.fleet.vehicles.map(v => ({ v: v.id, l: `${v.name} · ${v.reg}${v.status !== "aktywny" ? " — " + R.ASSET_STATUS[v.status] : ""}`, disabled: v.status !== "aktywny" }));
        const runs = [];
        for (let i = 0; i < count; i++) {
          const r = O.runs[i] || R.blankRun(), veh = R.byId(S.fleet.vehicles, r.vehicleId), k = f => `transport.own.runs.${i}.${f}`;
          runs.push(`<div class="run-card" data-run="${i}">
            <div class="run-h"><b>Kurs ${i + 1}</b><span class="spacer"></span><span class="run-cost" data-out="run.${i}.cost">—</span></div>
            <div class="fgrid four">
              ${field({ key: k("vehicleId"), label: "Pojazd z floty własnej", req: true, span: "span2", help: false, control: selIn(k("vehicleId"), [{ v: "", l: "— wybierz pojazd —" }].concat(vehOpts), r.vehicleId, { struct: true }) })}
              ${field({ key: k("driverId"), label: "Kierowca", req: true, span: "span2", help: false, control: selIn(k("driverId"), [{ v: "", l: "— wybierz kierowcę —" }].concat(S.fleet.drivers.map(x => ({ v: x.id, l: x.name + (veh && veh.driverId === x.id ? " (domyślny)" : "") }))), r.driverId || (veh ? veh.driverId : "")) })}
              ${field({ key: k("km"), label: "Kilometry", req: true, help: false, control: numIn(k("km"), r.km, { suffix: "km", placeholder: "np. 45" }) })}
              ${field({ key: k("rate"), label: "Stawka (zł/km)", help: false, control: numIn(k("rate"), r.rate, { suffix: "zł/km", placeholder: fmtQ(S.config.kmRateDefault) }) })}
              ${field({ key: k("qty"), label: `Ilość w kursie (${u})`, req: count > 1, help: false, control: numIn(k("qty"), r.qty, { suffix: u, placeholder: count > 1 ? "np. 100" : "cała ilość" }) })}
              ${field({ key: k("weightT"), label: "Waga rzeczywista (t)", help: false, control: numIn(k("weightT"), r.weightT, { suffix: "t", placeholder: "z kwitu wagowego" }) })}
            </div></div>`);
        }
        modeHtml = `<div class="fgrid four mt4">
          ${field({ key: "transport.own.runCount", label: "Liczba kursów", req: true, control: numIn("transport.own.runCount", O.runCount, { suffix: "szt.", placeholder: "np. 4" }) })}
          <div class="field span3"><span class="lbl">&nbsp;</span><div class="help">Każdy kurs: pojazd z floty własnej, kierowca (domyślny z pojazdu, można zmienić dla kursu), km, stawka, ilość i waga z wagi rzeczywistej. Koszt = km × stawka, sumowany dla wszystkich kursów.</div></div>
        </div>
        <div class="runs" id="own-runs">${runs.join("") || `<div class="help">Podaj liczbę kursów — rubryki pojawią się automatycznie.</div>`}</div>
        <div class="field mt3"><span class="lbl">Podsumowanie kursów</span><div data-out="runs.summary"></div></div>`;
      } else if (mode === "external") {
        modeHtml = `<div class="fgrid four mt4">
          ${field({ key: "transport.external.company", label: "Firma transportowa", req: true, span: "span2", control: textIn("transport.external.company", T.external.company, { placeholder: "np. ESI Logistics", list: "dl-carriers" }) + `<datalist id="dl-carriers">${(S.carriers || []).map(c => `<option value="${esc(c)}">`).join("")}</datalist>` })}
          ${field({ key: "transport.external.reg", label: "Numer rejestracyjny", req: true, control: textIn("transport.external.reg", T.external.reg, { placeholder: "np. ESI 18734" }) })}
          ${field({ key: "transport.external.km", label: "Odległość", control: numIn("transport.external.km", T.external.km, { suffix: "km", placeholder: "np. 262" }) })}
          ${field({ key: "transport.external.freight", label: "Fracht (zł)", req: !T.external.includedInPrice, control: T.external.includedInPrice ? outBox("transport.external.freight", "wliczony w cenę") : numIn("transport.external.freight", T.external.freight, { suffix: "zł", placeholder: "np. 1 250" }) })}
          <div class="field span2" data-field="transport.external.includedInPrice"><span class="lbl">&nbsp;</span>
            ${optCard("transport.external.includedInPrice", { checked: T.external.includedInPrice, title: "Transport wliczony w cenę", text: "Koszt transportu tej operacji = 0 zł." })}
            <div class="help tut">${HELP["transport.external.includedInPrice"]}</div></div>
          ${field({ key: "transport.cost", label: "Koszt transportu", control: outBox("transport.cost", "—"), help: false })}
        </div>`;
      } else if (mode === "train") {
        const count = Math.max(0, Math.min(S.config.maxWagons, Math.floor(NumParse.value(tr.wagonCount, 0)) || 0));
        const each = tr.tonMode === "each";
        const rows = [];
        if (each) for (let i = 0; i < count; i++) {
          const k = `transport.train.wagonT.${i}`;
          rows.push(`<tr data-field="${k}"><td class="c"><b>${i + 1}</b></td><td>${numIn(k, (tr.wagonT || [])[i] || "", { suffix: "t", placeholder: "np. 58,4" })}<div class="msg hidden" data-msg="${k}" role="alert"></div></td></tr>`);
        }
        modeHtml = `<div class="fgrid four mt4">
          ${field({ key: "transport.train.trainNo", label: "Nr składu", control: textIn("transport.train.trainNo", tr.trainNo, { placeholder: "np. RC 50931" }) })}
          ${field({ key: "transport.train.carrier", label: "Przewoźnik kolejowy", control: textIn("transport.train.carrier", tr.carrier, { placeholder: "np. PKP Cargo" }) })}
          ${field({ key: "transport.train.docNo", label: "Nr dokumentu przewozowego", control: textIn("transport.train.docNo", tr.docNo, { placeholder: "np. CIM 5093/09" }) })}
          ${field({ key: "transport.train.loadPlace", label: "Miejsce załadunku", control: textIn("transport.train.loadPlace", tr.loadPlace, { placeholder: "np. Bocznica Gliwice" }) })}
          ${field({ key: "transport.train.wagonCount", label: "Liczba wagonów", req: true, control: numIn("transport.train.wagonCount", tr.wagonCount, { suffix: "szt.", placeholder: "np. 20" }) })}
          ${field({ key: "transport.train.capacity", label: "Ładowność wagonu", control: numIn("transport.train.capacity", tr.capacity, { suffix: tr.capUnit, placeholder: "opcjonalnie" }) })}
          ${field({ key: "transport.train.capUnit", label: "Jednostka ładowności", control: selIn("transport.train.capUnit", [{ v: "t", l: "tony (t)" }, { v: "MP", l: "MP" }], tr.capUnit, { struct: true }) })}
          <div></div>
          <div class="field span-all" data-field="transport.train.tonMode"><span class="lbl">Tonaż wagonów — wybierz sposób</span>
            <div class="scope two">
              ${optCard("", { checked: !each, struct: false, radio: true, id: "f-ton-same", title: "Tonaż taki sam dla wszystkich wagonów", text: "Podajesz jedną wartość — system mnoży przez liczbę wagonów.", attrs: 'data-ton="same"' })}
              ${optCard("", { checked: each, struct: false, radio: true, id: "f-ton-each", title: "Wpisz tonaż każdego wagonu osobno", text: "System generuje listę wagonów i sumuje tonaż składu.", attrs: 'data-ton="each"' })}
            </div></div>
          ${!each ? field({ key: "transport.train.sameT", label: "Tonaż jednego wagonu", req: true, control: numIn("transport.train.sameT", tr.sameT, { suffix: "t", placeholder: "np. 60" }) }) : ""}
          ${each ? `<div class="field span-all"><span class="lbl">Tonaż każdego wagonu</span>${count ? `<div class="tbl-wrap wagons-tbl"><table class="tbl" id="wagon-table"><thead><tr><th class="c" style="width:80px">Wagon</th><th>Tonaż</th></tr></thead><tbody>${rows.join("")}</tbody><tfoot><tr><td>Razem</td><td class="r" data-out="train.sumT">—</td></tr></tfoot></table></div>` : `<div class="help">Podaj liczbę wagonów — lista wygeneruje się automatycznie.</div>`}</div>` : ""}
          ${field({ key: "transport.train.price", label: "Cena frachtu", req: true, control: numIn("transport.train.price", tr.price, { suffix: `zł/${Units.label(tr.priceUnit)}`, placeholder: "np. 25" }) })}
          ${field({ key: "transport.train.priceUnit", label: "Cena za", control: selIn("transport.train.priceUnit", [{ v: "t", l: "t (tonę)" }, { v: "MP", l: "MP" }, { v: "m3", l: "m³" }], tr.priceUnit, { struct: true }) })}
          <div class="field span-all"><span class="lbl">Podsumowanie składu</span><div class="train-sum" data-out="train.summary"></div></div>
        </div>`;
      }
      const buyers = S.partners.filter(p => ["buyer", "both"].includes(p.role));
      return section(n, "tr", "Miejsce i transport", "Transport nie zmienia stanu magazynowego — to osobny koszt operacji.", `
        <div class="fgrid">${field({ key: "transport.place", label: "Miejsce transportu / dostawy", req: true, span: "span-all", control: textIn("transport.place", T.place, { placeholder: "np. RiC Zabrze", list: "dl-places" }) + `<datalist id="dl-places">${S.warehouses.map(w => `<option value="${esc(w.name)}">`).concat(buyers.map(b => `<option value="${esc(b.name)}">`)).join("")}</datalist>` })}</div>
        <div class="field mt4" data-field="transport.mode"><span class="lbl">Rodzaj transportu (zaznacz jeden albo żaden)</span>
          <div class="scope" role="group" aria-label="Rodzaj transportu">
            ${optCard("", { checked: mode === "own", struct: false, radio: true, id: "f-mode-own", title: "Transport własny", text: "Pojazd i kierowca z Floty, koszt = km × stawka.", attrs: 'data-mode="own"' })}
            ${optCard("", { checked: mode === "external", struct: false, radio: true, id: "f-mode-external", title: "Transport zewnętrzny", text: "Firma przewozowa, fracht z faktury.", attrs: 'data-mode="external"' })}
            ${optCard("", { checked: mode === "train", struct: false, radio: true, id: "f-mode-train", title: "Pociąg", text: "Wagony, tonaż, podsumowanie składu.", attrs: 'data-mode="train"' })}
          </div>
          <div class="help tut">${HELP["transport.mode"]}</div></div>
        ${modeHtml}`);
    },

    html(params) {
      if (this.mode === "correct") {
        const op = this.op;
        if (!op) return `<div class="empty">Nie znaleziono dokumentu do korekty.</div>`;
        const deny = op.status === "CANCELLED" ? "Dokument jest anulowany — nie można go korygować. Wprowadź nową operację."
          : !App.can("documents.correct") ? "Twoja rola nie ma uprawnienia „documents.correct”."
          : !App.can(R.OP_TYPES[op.type].correctPerm) ? `Twoja rola nie ma uprawnienia „${R.OP_TYPES[op.type].correctPerm}”.`
          : (App.user().whId !== op.whId && App.user().role !== "admin") ? `Korektę wykonuje użytkownik magazynu ${App.whName(op.whId)} albo Administrator.` : "";
        const head = `<div class="page-head"><div class="titles"><h2>KOREKTA dokumentu nr ${esc(op.no)}</h2>
          <p>${esc(R.OP_TYPES[op.type].label)}${op.direct ? " — bezpośrednia" : ""} · ${esc(Dates.pl(op.date))} · ${esc(App.whName(op.whId))} · ${statusBadge(op.status)} Popraw pola — system pokaże oryginał, korektę, różnicę i wpływ na stan. Dokument pierwotny pozostaje w historii.</p></div>
          <div class="actions"><button class="btn ghost" type="button" id="corr-cancel">${ic("x", 15)} Porzuć korektę</button></div></div>`;
        if (deny) return head + `<div class="info-line err" id="corr-deny">${ic("alert", 15)}<span>${esc(deny)}</span></div>`;
        return head + this.layout(true);
      }
      if (!App.can("op.create")) {
        return `<div class="page-head"><div class="titles"><h2>Nowa operacja</h2></div></div>
          <div class="info-line err">${ic("alert", 15)}<span>Rola <b>${esc(R.ROLES[App.user().role].label)}</b> nie pozwala tworzyć operacji. Zmień użytkownika w prawym górnym rogu.</span></div>`;
      }
      return `<div class="page-head"><div class="titles"><h2>Nowa operacja${this.draft.draftId ? ' <span class="badge st-DRAFT">wersja robocza</span>' : ""}</h2>
          <p>Zakup, sprzedaż z magazynu, produkcja na magazyn, produkcja ze sprzedażą bezpośrednią albo przesunięcie MM. Pola z <span class="req">*</span> są wymagane. Przed zatwierdzeniem zobaczysz podsumowanie.</p></div>
          <div class="actions">
            <label class="inline-opt"><input type="checkbox" id="tut-toggle" ${lsGet("riw.demo.tutorial", "1") !== "0" ? "checked" : ""}> Samouczek pod polami</label>
            <button class="btn ghost" type="button" id="form-reset">${ic("x", 15)} Wyczyść</button>
          </div></div>` + this.layout(false);
    },
    layout(corr) {
      return `<div class="op-layout">
          <form id="opf" novalidate autocomplete="off">${this.sectionsHtml()}</form>
          <aside class="summary" id="summary" aria-label="Podsumowanie operacji">
            ${corr ? `<div class="card corr-card"><div class="card-h"><h3>Korekta — podgląd</h3><span id="corr-badge"></span></div><div class="card-b" id="corr-preview"></div></div>` : ""}
            <div class="card"><div class="card-h"><h3>Przebieg operacji</h3><span class="sub">kolejność księgowania</span></div><div class="card-b" id="sum-flow"></div></div>
            <div class="card"><div class="card-h"><h3 id="sum-bal-h">Stan w magazynie</h3></div><div id="sum-bal"></div></div>
            <div class="card"><div class="card-h"><h3>Koszty i przychód</h3></div><div class="card-b" id="sum-money"></div></div>
            <div class="card"><div class="card-h"><h3>Plan dokumentów</h3><span class="sub">${corr ? "dokumenty pierwotne" : "powstaną przy zatwierdzeniu"}</span></div><div id="sum-docs"></div></div>
            <div class="card"><div class="card-h"><h3>Kontrola</h3><span id="sum-badge"></span></div>
              <div class="card-b"><div id="sum-errs"></div>
                ${corr ? `<div class="field mt4"><label for="corr-reason">Powód korekty <span class="req">*</span></label>
                    <select class="ctrl" id="corr-reason"><option value="">— wybierz powód —</option>${R.CORRECTION_REASONS.map(r => `<option value="${esc(r)}" ${this.corr.reason === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>
                    <input class="ctrl mt2" id="corr-reason-text" placeholder="opis / własny powód${this.corr.reason === "inny" ? " (wymagany)" : " (opcjonalnie)"}" value="${esc(this.corr.reasonText)}"><div class="msg hidden" id="corr-reason-msg" role="alert"></div></div>
                  <button class="btn primary lg mt4" type="button" data-save style="width:100%">${ic("check", 16)} Zatwierdź korektę…</button>`
                : `<button class="btn primary lg mt4" type="button" data-save style="width:100%">${ic("check", 16)} Zatwierdź…</button>
                   <button class="btn mt2" type="button" data-draft style="width:100%">${ic("file", 15)} Zapisz jako roboczy</button>`}</div></div>
          </aside>
        </div>
        <div class="save-bar no-print"><div class="sb-info" id="sb-info"></div><button class="btn primary lg" type="button" data-save>${ic("check", 16)} ${corr ? "Zatwierdź korektę…" : "Zatwierdź…"}</button></div>`;
    },

    bind(page) {
      const cc = $("#corr-cancel", page);
      if (cc) cc.onclick = () => { const id = this.op && this.op.id; this.draft = null; this.mode = "new"; location.hash = "#/operacje"; if (id) setTimeout(() => root.OpDetail && root.OpDetail.open(id), 50); };
      const form = $("#opf", page);
      if (!form) return;
      const tt = $("#tut-toggle", page);
      if (tt) tt.onchange = e => { lsSet("riw.demo.tutorial", e.target.checked ? "1" : "0"); document.body.classList.toggle("no-tutorial", !e.target.checked); };
      const fr = $("#form-reset", page);
      if (fr) fr.onclick = async () => {
        const r = await Modal.confirm({ title: "Wyczyścić formularz?", text: "Wszystkie wpisane dane tej operacji zostaną usunięte. Zapisana wersja robocza pozostaje na liście operacji.", ok: "Wyczyść", danger: true });
        if (r.ok) { this.reset(); this.rerender(); App.render(); }
      };
      form.addEventListener("input", e => this.onEdit(e, false));
      form.addEventListener("change", e => this.onEdit(e, true));
      form.addEventListener("focusout", e => {
        const el = e.target;
        if (!el.dataset || !el.dataset.bind) return;
        this.touched.add(el.dataset.bind);
        if (el.hasAttribute("data-num")) {
          const r = NumParse.parse(el.value);
          if (r.ok) {
            const nice = el.dataset.bind === "production.chipRate" ? fmt(r.value, 2) : fmtQ(r.value, 6);
            if (nice !== el.value) { el.value = nice; setPath(this.draft, el.dataset.bind, nice); this.persist(); }
          }
        }
        this.refresh();
      });
      form.addEventListener("submit", e => { e.preventDefault(); this.save(); });
      form.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); this.save(); } });
      $$("[data-save]", page).forEach(b => b.onclick = () => this.save());
      $$("[data-draft]", page).forEach(b => b.onclick = () => this.saveDraft());
      const rs = $("#corr-reason", page), rt = $("#corr-reason-text", page);
      if (rs) rs.onchange = () => { this.corr.reason = rs.value; rt.placeholder = rs.value === "inny" ? "opis powodu (wymagany)" : "opis / własny powód (opcjonalnie)"; this.reasonMsg(false); };
      if (rt) rt.oninput = () => { this.corr.reasonText = rt.value; this.reasonMsg(false); };
      this.refresh();
    },

    onEdit(e, isChange) {
      const el = e.target, d = this.draft;
      if (isChange && el.dataset) {
        if (el.dataset.type !== undefined) {
          if (!el.checked) { el.checked = true; return; }
          d.type = el.dataset.type;
          d.sale.enabled = false; d.production.enabled = false;
          if (d.type === "PRODUKCJA" || (d.type === "SPRZEDAZ" && d.sale.direct)) { if (!d.production.rawProductId) d.production.rawProductId = "pr_drewno"; if (!d.production.outProductId) d.production.outProductId = "pr_zr_lesna"; }
          if (!d.transport.placeTouched) d.transport.place = this.defaultPlace();
          this.touched = new Set(); this.showAll = false;
          this.persist(); this.rerender(); return;
        }
        if (el.dataset.skind !== undefined) {
          if (!el.checked) { el.checked = true; return; }
          const k = el.dataset.skind, P = d.purchase;
          P.supplierKind = k; P.basis = R.SUPPLIER_KINDS[k].basis;
          const s = App.partner(P.supplierId);
          if (s && R.partnerKind(s) !== k) { P.supplierId = ""; P.supplierName = ""; P.lesnictwo = ""; }
          this.persist(); this.rerender(); return;
        }
        if (el.dataset.mode !== undefined) {
          d.transport.mode = el.checked ? el.dataset.mode : "none";
          this.touched.add("transport.mode"); this.persist(); this.rerender(); return;
        }
        if (el.dataset.ton !== undefined) {
          d.transport.train.tonMode = el.dataset.ton;
          this.persist(); this.rerender(); return;
        }
      }
      const key = el.dataset && el.dataset.bind;
      if (!key) return;
      if (!isChange && (el.type === "checkbox" || el.tagName === "SELECT" || el.type === "date")) return;
      if (isChange && el.tagName === "INPUT" && el.type === "text") return;
      const v = el.type === "checkbox" ? el.checked : el.value;
      setPath(d, key, v);
      this.touched.add(key);
      this.sideEffects(key, v);
      this.persist();
      const supChanged = this._supplierChanged; this._supplierChanged = false;
      if (el.hasAttribute("data-struct") || supChanged || key === "transport.train.wagonCount" || key === "transport.own.runCount") this.rerender();
      else this.refresh();
    },

    sideEffects(key, v) {
      const d = this.draft, S = Store.state;
      if (key === "purchase.productId") {
        const p = App.product(v);
        if (p) d.purchase.unit = p.unit;
        if (!p || p.cat !== "drewno") { d.production.enabled = false; d.sale.enabled = false; }
      }
      if (key === "sale.productId") { const p = App.product(v); if (p) d.sale.unit = p.unit; }
      if (key === "mm.productId") { const p = App.product(v); if (p) d.mm.unit = p.unit; }
      if (key === "production.type" && R.PROD_TYPES[v] && d.type !== "PRODUKCJA") d.production.outProductId = R.PROD_TYPES[v].productId;
      if (key === "production.enabled" && !v) d.sale.enabled = false;
      if (key === "production.chipperId") { const c = R.byId(S.fleet.chippers, v); d.production.operatorId = c ? c.operatorId : ""; }
      const runKey = key.match(/^transport\.own\.runs\.(\d+)\.vehicleId$/);
      if (runKey) { const veh = R.byId(S.fleet.vehicles, v); d.transport.own.runs[+runKey[1]].driverId = veh ? veh.driverId : ""; }
      if (key === "transport.own.runCount") {
        const O = this.ownRuns(), n = Math.max(0, Math.min(50, Math.floor(NumParse.value(v, 0)) || 0));
        const arr = O.runs.slice(0, n);
        // nowy kurs przejmuje pojazd, kierowcę, km i stawkę z poprzedniego — zwykle kursy są powtarzalne
        while (arr.length < n) { const prev = arr[arr.length - 1]; arr.push(prev ? Object.assign(R.blankRun(), { vehicleId: prev.vehicleId, driverId: prev.driverId, km: prev.km, rate: prev.rate }) : R.blankRun()); }
        O.runs = arr;
      }
      if (key === "purchase.supplierName") {
        // nazwa zgodna z kartoteką → istniejący dostawca; inna → nowy (dopisany przy zatwierdzeniu)
        const name = String(v).trim().replace(/\s+/g, " ").toLowerCase();
        const s = name ? S.partners.find(p => ["supplier", "both"].includes(p.role) && p.name.trim().toLowerCase() === name) : null;
        const prevId = d.purchase.supplierId;
        d.purchase.supplierId = s ? s.id : "";
        if (s) { const k = R.partnerKind(s); if (k !== d.purchase.supplierKind || s.id !== prevId) { d.purchase.supplierKind = k; d.purchase.basis = R.SUPPLIER_KINDS[k].basis; } }
        if (this.supplierKind() === "nadlesnictwo") { d.production.type = "lesna"; d.production.ndl = R.ndlName({ name: String(v).trim() }); }
        if (s ? s.id !== prevId : !!prevId) { d.purchase.lesnictwo = ""; this._supplierChanged = true; }
      }
      if (key === "purchase.lesnictwo" && this.supplierKind() === "nadlesnictwo") d.production.lesnictwo = v;
      if (key === "transport.place") d.transport.placeTouched = true;
      if ((key === "sale.buyerId" || key === "sale.enabled" || key === "sale.direct" || key === "mm.toWhId") && !d.transport.placeTouched) d.transport.place = this.defaultPlace();
      if (key === "sale.direct" && v) { if (!d.production.rawProductId) d.production.rawProductId = "pr_drewno"; if (!d.production.outProductId) d.production.outProductId = "pr_zr_lesna"; }
      if (key === "transport.train.wagonCount") {
        const n = Math.max(0, Math.min(S.config.maxWagons, Math.floor(NumParse.value(v, 0)) || 0));
        const arr = (d.transport.train.wagonT || []).slice(0, n);
        while (arr.length < n) arr.push("");
        d.transport.train.wagonT = arr;
      }
    },

    rerender() {
      const form = $("#opf"); if (!form) return;
      const act = document.activeElement;
      const id = act && act.id && form.contains(act) ? act.id : null;
      let caret = null; try { caret = act && act.selectionStart; } catch (e) {}
      const y = root.scrollY;
      form.innerHTML = this.sectionsHtml();
      if (id) {
        const el = document.getElementById(id);
        if (el) { el.focus({ preventScroll: true }); try { if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret); } catch (e) {} }
      }
      root.scrollTo(0, y);
      this.refresh();
    },

    ctx(source) {
      const c = App.ctx(source || (this.mode === "correct" ? "Korekta dokumentu" : "Formularz „Nowa operacja”"));
      return c;
    },
    /** Plan bieżącego formularza: dla korekty — plan na stanie bez skutków korygowanej operacji (jak w silniku). */
    computePlan() {
      const S = Store.state;
      if (this.mode === "correct") {
        const view = Object.assign({}, S, { ledger: S.ledger.filter(l => l.opId !== this.op.id) });
        const plan = R.planOperation(view, Object.assign(R.clone(this.draft), { date: this.op.date }), Object.assign(this.ctx(), { user: Object.assign({}, App.user(), { whId: this.op.whId }), correction: true }));
        this.corrPlan = plan.ok ? R.planCorrection(S, this.op.id, this.draft, this.ctx()) : null;
        return plan;
      }
      return R.planOperation(S, this.draft, this.ctx());
    },

    /** Przeliczenie na żywo — podmienia wyłącznie teksty wynikowe, pola wejściowe zostają nietknięte. */
    refresh() {
      const form = $("#opf"); if (!form) return null;
      const S = Store.state, cfg = S.config;
      const plan = this.plan = this.computePlan();
      DBG.plan = plan; DBG.corrPlan = this.corrPlan;
      const n = plan.norm;
      const out = (key, html) => { const el = form.querySelector(`[data-out="${key}"]`); if (el) el.innerHTML = html; };
      $$("[data-calc]", form).forEach(c => { c.innerHTML = ""; });      // bez tego opisy wyliczeń dopisywały się przy każdym przeliczeniu
      $$("[data-num]", form).forEach(el => {
        const c = form.querySelector(`[data-calc="${el.dataset.bind}"]`);
        const r = NumParse.parse(el.value);
        if (c) c.innerHTML = r.ok && el.value.trim() !== fmtQ(r.value, 6) && el.value.trim() !== fmt(r.value, 2) ? `odczytano: <b>${fmtQ(r.value, 6)}</b>` : "";
      });
      const add = (key, html) => { const el = form.querySelector(`[data-calc="${key}"]`); if (el && html) el.innerHTML = (el.innerHTML ? el.innerHTML + " · " : "") + html; };
      const qn = (q, pid) => App.qtyNative(q, pid);
      const orient = (q, pid) => { const p = App.product(pid); if (!p) return "—"; const o = Units.orient(q, p, cfg); return `${p.unit === "t" ? "" : "≈ "}${fmt(o.t, 2)} t · ≈ ${fmt(o.gj, 1)} GJ`; };

      if (n.purchase) {
        const P = n.purchase, p = App.product(P.productId);
        if (P.qty !== null && p && P.unit !== p.unit) add("purchase.qty", `= <b>${esc(qn(P.stockQty, p.id))}</b> na stanie`);
        if (P.newSupplier) add("purchase.supplierName", `<span class="badge info">nowy dostawca</span> zostanie dopisany do kartoteki (${esc(R.SUPPLIER_KINDS[P.newSupplier.kind].label)}) przy zatwierdzeniu`);
        else if (P.supplierId) add("purchase.supplierName", `z kartoteki ✓`);
        if (P.qty !== null && P.price !== null) add("purchase.price", `${fmtQ(P.qty)} ${Units.label(P.unit)} × ${fmt(P.price)} zł`);
        out("purchase.cost", P.qty !== null && P.price !== null ? money(P.cost) : "—");
        out("purchase.weightAuto", P.qty !== null && p ? orient(P.stockQty, p.id) : "—");
        if (P.qty !== null) add("purchase.weightManual", `orientacyjnie: ${fmtQ(P.autoWeight)} t — ilość na stanie się nie zmienia`);
      }
      if (n.production) {
        const X = n.production, outP = App.product(X.outProductId), raw = App.product(X.rawProductId);
        if (X.mode !== "stock") add("production.type", `produkt wynikowy: <b>${esc(outP ? outP.name : "—")}</b>`);
        if (X.mode === "stock") {
          const onStock = n.available ? n.available.stock : 0;
          out("production.stock", raw ? esc(qn(onStock, raw.id)) : "—");
          out("production.consume", raw && X.consumeQty !== null ? `<b>${esc(qn(X.consumeQty, raw.id, 6))}</b>` : "—");
          out("production.after", raw && X.consumeQty !== null ? `<span class="${onStock - X.consumeQty < -R.EPS ? "neg" : ""}">${esc(qn(R.rq(onStock - X.consumeQty), raw.id))}</span>` : "—");
          out("production.factorTxt", X.factor ? `1 ${Units.label(raw.unit)} = ${fmtQ(X.factor)} ${Units.label(outP.unit)}` : "—");
          if (X.factor && X.outQty) add("production.outQty", `${fmtQ(X.outQty, 6)} ${Units.label(outP.unit)} ÷ ${fmtQ(X.factor)} = ${fmtQ(X.consumeQty, 6)} ${Units.label(raw.unit)} surowca`);
          out("production.orient", outP && X.outQty ? orient(X.outQty, outP.id) : "—");
        }
        if (X.mode === "direct") out("production.rawQty", raw && X.consumeQty !== null ? `${esc(qn(X.consumeQty, raw.id, 6))} <small class="dim">nie ze stanu</small>` : "—");
        if (X.mode === "chain" && n.available) add("production.consumeQty", `dostępne: <b>${fmtQ(n.available.total)} ${Units.label(n.available.unit)}</b>${n.available.purchase ? ` (stan ${fmtQ(n.available.stock)} + zakup ${fmtQ(n.available.purchase)})` : ""}${X.maxOut !== null ? ` · = maks. ${fmtQ(X.maxOut)} MP` : ""}`);
        out("production.chipCost", money(X.chippingCost));
        if (X.outUnit === "MP") add("production.chipCost", `${fmtQ(X.outQty)} MP × ${fmt(X.chipRate)} zł/MP`);
      }
      if (n.sale) {
        const Sa = n.sale, p = App.product(Sa.productId);
        out("sale.revenue", money(Sa.revenue));
        out("sale.weight", p ? orient(Sa.stockQty, p.id) : "—");
        if (Sa.fromStock && p) {
          out("sale.onStock", esc(qn(Sa.onStock, p.id)));
          out("sale.after", `<span class="${Sa.after < -R.EPS ? "neg" : ""}">${esc(qn(Sa.after, p.id))}</span>`);
          if (Sa.qty !== null && Sa.unit !== p.unit) add("sale.qty", `= ${esc(qn(Sa.stockQty, p.id))} ze stanu`);
          if (Sa.qty !== null && Sa.price !== null) add("sale.revenue", `${fmtQ(Sa.qty)} ${Units.label(Sa.unit)} × ${fmt(Sa.price)} zł`);
        } else {
          add("sale.qtyMP", `maks. <b>${fmtQ(n.production ? n.production.outQty : 0)} MP</b> (produkcja)`);
          if (Sa.price !== null) add("sale.revenue", Sa.priceUnit === "t" ? `${fmtQ(Sa.weightT)} t × ${fmt(Sa.price)} zł/t` : `${fmtQ(Sa.qty)} MP × ${fmt(Sa.price)} zł/MP`);
        }
      }
      if (n.mm) {
        const M = n.mm, p = App.product(M.productId);
        const b = w => plan.balances.find(x => x.whId === w && x.productId === M.productId);
        const src = b(this.whId()), dst = b(M.toWhId);
        out("mm.srcBal", p && src ? `${esc(qn(src.before, p.id))} → <b>${esc(qn(src.after, p.id))}</b>` : p ? esc(qn(M.onStock, p.id)) : "—");
        out("mm.dstBal", p && dst ? `${esc(qn(dst.before, p.id))} → <b>${esc(qn(dst.after, p.id))}</b>` : "—");
        if (p && M.qty !== null && M.unit !== p.unit) add("mm.qty", `= ${esc(qn(M.stockQty, p.id))}`);
      }
      const T = n.transport;
      if (T.mode === "own") {
        const U = Units.label(T.qtyUnit || "");
        (T.runs || []).forEach((r, i) => {
          out(`run.${i}.cost`, `${fmtQ(r.km)} km × ${fmt(r.rate)} zł/km = <b>${money(r.cost)}</b>`);
          if (r.driverOverridden) add(`transport.own.runs.${i}.driverId`, `<span style="color:var(--warn)">kierowca zmieniony tylko dla tego kursu</span>`);
          if (r.reg) add(`transport.own.runs.${i}.vehicleId`, `rej. <b>${esc(r.reg)}</b>`);
        });
        out("runs.summary", T.runs && T.runs.length ? `<div class="tbl-wrap"><table class="tbl" id="runs-summary"><thead><tr><th>Kurs</th><th>Pojazd</th><th>Kierowca</th><th class="r">km</th><th class="r">Stawka</th><th class="r">Ilość</th><th class="r">Waga rzecz.</th><th class="r">Koszt</th></tr></thead><tbody>
          ${T.runs.map(r => `<tr><td>${r.no}</td><td>${esc(r.reg || "—")}</td><td>${esc(r.driverName || "—")}</td><td class="r">${fmtQ(r.km)}</td><td class="r">${fmt(r.rate)} zł</td><td class="r">${fmtQ(r.qty)} ${U}</td><td class="r">${r.weightT !== null ? fmtQ(r.weightT) + " t" : "—"}</td><td class="r">${money(r.cost)}</td></tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="3">Razem: ${T.runs.length} ${T.runs.length === 1 ? "kurs" : T.runs.length < 5 ? "kursy" : "kursów"}</td><td class="r">${fmtQ(T.km)}</td><td></td><td class="r" data-runs-qty>${fmtQ(T.totalQty)} ${U}</td><td class="r" data-runs-t>${T.totalWeightT !== null ? fmtQ(T.totalWeightT) + " t" : "—"}${T.weightMissing && T.totalWeightT !== null ? ` <small class="dim">(bez ${T.weightMissing})</small>` : ""}</td><td class="r" data-runs-cost>${money(T.cost)}</td></tr></tfoot></table></div>` : "—");
      } else if (T.mode === "external") {
        out("transport.cost", money(T.cost));
        add("transport.cost", T.includedInPrice ? "transport wliczony w cenę towaru" : "kwota frachtu");
      } else if (T.mode === "train") {
        out("train.sumT", `<b>${fmtQ(T.totalT)} t</b>`);
        const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
        out("train.summary", `<dl class="money-list" id="train-summary">
          ${row("Liczba wagonów", `${T.wagonCount}`)}
          ${T.capacity !== null ? row(`Łączna ładowność (${T.capUnit})`, `${T.wagonCount} × ${fmtQ(T.capacity)} = <b>${fmtQ(T.totalCapacity)} ${T.capUnit}</b>`) : ""}
          ${T.tonMode === "each" ? row("Tonaż wagonów", T.wagonT.length ? T.wagonT.map((t, i) => `${i + 1}: ${fmtQ(t)}`).join(" · ") + " t" : "—") : row("Tonaż wagonu", `${T.wagonCount} × ${fmtQ(T.wagonT[0] || 0)} t`)}
          ${row("Łączny tonaż składu", `<b data-train-total>${fmtQ(T.totalT)} t</b> <small class="dim">≈ ${fmtQ(T.totalMP)} MP · ≈ ${fmt(R.Units.energy(T.totalT, cfg), 0)} GJ</small>`)}
          ${row("Miejsce załadunku", esc(T.loadPlace || "—"))}
          ${row("Miejsce dostawy", esc(T.place || "—"))}
          ${row("Przewoźnik", esc(T.carrier || "—"))}
          ${row("Nr dokumentu", esc(T.docNo || "—"))}
          ${row("Koszt transportu", `<b data-train-cost>${money(T.cost)}</b> <small class="dim">(${fmtQ(T.basisQty)} ${Units.label(T.priceUnit)} × ${fmt(T.price)} zł)</small>`)}
        </dl>`);
      }

      $$("[data-msg]", form).forEach(m => {
        const key = m.dataset.msg, msg = plan.errors[key];
        const show = msg && (this.showAll || this.touched.has(key) || key === "production.factor" || (key === "production.outQty" && /^Brak wystarczającej/.test(msg)));
        m.classList.toggle("hidden", !show);
        m.innerHTML = show ? ic("alert", 13) + `<span>${esc(msg)}</span>` : "";
        const input = document.getElementById(fid(key));
        if (input) { input.classList.toggle("invalid", !!show); input.setAttribute("aria-invalid", show ? "true" : "false"); }
      });
      this.summary(plan);
      if (this.mode === "correct") this.correctionPreview(plan);
      return plan;
    },

    summary(plan) {
      if (!$("#summary")) return;
      const name = id => (App.product(id) || {}).name || "—";
      const unitOf = id => Units.label((App.product(id) || {}).unit || "");
      const flow = plan.postings.map(p => `<li><span class="d">${p.doc}</span>
          <span>${p.step}. ${esc(R.KINDS[p.kind].label)}${p.direct ? " (bezpośrednio)" : ""} — ${esc(name(p.productId))}${p.whId !== plan.whId ? ` <small class="dim">[${esc(App.whName(p.whId))}]</small>` : ""}<br><small class="dim">stan ${esc(App.qtyNative(p.before, p.productId))} → ${esc(App.qtyNative(p.after, p.productId))}</small></span>
          <span class="q ${p.qty > 0 ? "plus" : "minus"}">${p.qty > 0 ? "+" : ""}${fmtQ(p.qty)} ${unitOf(p.productId)}</span></li>`).join("")
        + (plan.norm.transport.mode !== "none" ? `<li><span class="d">TR</span><span>${esc(R.TRANSPORT_MODES[plan.norm.transport.mode])} — ${esc(transportText(plan.norm.transport))}<br><small class="dim">koszt ${money(plan.norm.transport.cost)} · wpływ na stan: brak</small></span><span class="q zero">0</span></li>` : "");
      const bal = plan.balances.map(b => `<tr><td>${esc(name(b.productId))}${b.whId !== plan.whId ? `<br><small class="dim">${esc(App.whName(b.whId))}</small>` : ""}</td><td class="r">${esc(App.qtyNative(b.before, b.productId))}</td><td class="r"><b>${esc(App.qtyNative(b.after, b.productId))}</b></td></tr>`).join("");
      const tt = plan.totals;
      const docs = plan.documents.map(dc => `<tr><td><span class="badge ${dc.type === "TR" ? "info" : dc.stock === "+" ? "ok" : dc.stock === "±" ? "" : "warn"}">${dc.type}</span></td>
          <td>${esc(dc.type === "TR" ? R.TRANSPORT_MODES[dc.transport.mode] : name(dc.productId))}${dc.partner ? `<br><small class="dim">${esc(dc.partner)}</small>` : dc.toWh ? `<br><small class="dim">→ ${esc(dc.toWh)}</small>` : ""}</td>
          <td class="r">${dc.qty !== null ? esc(fmtQ(dc.qty) + " " + Units.label(dc.unit)) : "—"}</td>
          <td class="r">${dc.value ? esc(money(dc.value)) : "—"}</td>
          <td>${esc(dc.place || "—")}</td><td class="c">${esc(dc.stock)}</td></tr>`).join("");
      const errs = plan.errorList, nErr = errs.length;
      const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
      set("sum-flow", flow ? `<ol class="flow" id="flow">${flow}</ol>` : `<p class="dim">Uzupełnij formularz, aby zobaczyć przebieg.</p>`);
      set("sum-bal-h", `Stan w magazynie ${esc(App.whName(this.whId()))}${this.mode === "correct" ? " (bez korygowanego dokumentu)" : ""}`);
      set("sum-bal", bal ? `<div class="tbl-wrap"><table class="tbl" id="bal"><thead><tr><th>Produkt</th><th class="r">Przed</th><th class="r">Po operacji</th></tr></thead><tbody>${bal}</tbody></table></div>` : `<div class="card-b dim">—</div>`);
      set("sum-money", `<dl class="money-list" id="money">
          ${tt.purchaseCost ? `<dt>Koszt zakupu</dt><dd data-sum="purchase">${money(tt.purchaseCost)}</dd>` : ""}
          ${tt.rawCost ? `<dt>Koszt surowca z lasu</dt><dd data-sum="raw">${money(tt.rawCost)}</dd>` : ""}
          ${plan.norm.production ? `<dt>Koszt rąbania</dt><dd data-sum="chipping">${money(tt.chippingCost)}</dd>` : ""}
          <dt>Koszt transportu</dt><dd data-sum="transport">${money(tt.transportCost)}</dd>
          <dt>Przychód ze sprzedaży</dt><dd data-sum="revenue">${money(tt.revenue)}</dd>
          <dt class="total">Wynik operacji</dt><dd class="total" data-sum="result" style="color:${tt.result < 0 ? "var(--warn)" : "var(--ok)"}">${money(tt.result)}</dd></dl>`);
      set("sum-docs", docs ? `<div class="tbl-wrap"><table class="tbl" id="plan-docs"><thead><tr><th>Dok.</th><th>Treść</th><th class="r">Ilość</th><th class="r">Wartość</th><th>Miejsce</th><th class="c">Stan</th></tr></thead><tbody>${docs}</tbody></table></div>` : `<div class="card-b dim">—</div>`);
      set("sum-badge", nErr ? `<span class="badge err">${nErr} ${nErr === 1 ? "błąd" : nErr < 5 ? "błędy" : "błędów"}</span>` : `<span class="badge ok">gotowe do zatwierdzenia</span>`);
      set("sum-errs", (nErr ? `<ul class="err-list" id="err-list">${errs.map(e => `<li><button type="button" data-goto="${esc(e.field)}">${esc(this.fieldLabel(e.field))}${esc(e.msg)}</button></li>`).join("")}</ul>` : `<p class="muted">Wszystkie wymagane pola są poprawne.</p>`)
        + (plan.warnings.length ? `<ul class="warn-list mt3">${plan.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""));
      $$("[data-goto]", $("#summary")).forEach(b => b.onclick = () => {
        const el = document.getElementById(fid(b.dataset.goto)) || document.querySelector(`[data-field="${b.dataset.goto}"]`);
        this.showAll = true; this.refresh();
        if (el) { el.scrollIntoView({ block: "center" }); if (el.focus) el.focus({ preventScroll: true }); }
      });
      const info = $("#sb-info");
      if (info) info.innerHTML = nErr ? `<span style="color:var(--err)">${nErr} do poprawy</span> · ${money(tt.result)}` : `Gotowe · wynik ${money(tt.result)}`;
      if (this.saving) $$("[data-save]").forEach(b => { b.disabled = true; });
    },

    /** Oryginał / korekta / różnica / wpływ na stan / stan przed i po. */
    correctionPreview(plan) {
      const box = $("#corr-preview"); if (!box) return;
      const pc = this.corrPlan;
      if (!plan.ok) { box.innerHTML = `<p class="muted">Popraw błędy formularza — podgląd korekty pojawi się automatycznie.</p>`; $("#corr-badge").innerHTML = `<span class="badge err">błędy</span>`; return; }
      if (!pc || !pc.ok) { box.innerHTML = `<div class="info-line ${pc && /żadnej zmiany/.test(pc.error) ? "" : "err"}">${ic("alert", 15)}<span>${esc(pc ? pc.error : "Brak podglądu")}</span></div>`; $("#corr-badge").innerHTML = pc && /żadnej zmiany/.test(pc.error) ? `<span class="badge">bez zmian</span>` : `<span class="badge err">odrzucona</span>`; return; }
      const name = id => (App.product(id) || {}).name || "—";
      $("#corr-badge").innerHTML = `<span class="badge ${pc.descriptiveOnly ? "info" : "warn"}">${pc.descriptiveOnly ? "korekta opisowa" : pc.deltas.length ? "korekta ilościowa" : "korekta wartościowa"}</span>`;
      const ch = pc.changes.map(c => `<tr><td>${esc(c.label)}</td><td class="r">${esc(c.beforeText)}</td><td class="r"><b>${esc(c.afterText)}</b></td><td class="r">${c.diff !== null ? `<span class="${c.diff < 0 ? "neg" : "pos"}">${c.diff > 0 ? "+" : ""}${esc(fmtQ(c.diff, 6))}${c.unit ? " " + esc(c.unit) : ""}</span>` : "zmiana"}</td></tr>`).join("");
      const eff = pc.deltas.map(x => `<tr><td>${esc(name(x.productId))}<br><small class="dim">${esc(App.whName(x.whId))} · ${esc(R.CATS[x.cat] || x.cat)}${x.direct ? " (bezp.)" : ""}</small></td><td class="r"><span class="${x.qty < 0 ? "neg" : "pos"}">${x.qty > 0 ? "+" : ""}${esc(App.qtyNative(x.qty, x.productId, 6))}</span></td><td class="r">${esc(App.qtyNative(x.before, x.productId))}</td><td class="r"><b>${esc(App.qtyNative(x.after, x.productId))}</b></td></tr>`).join("");
      const vd = Object.entries(pc.valueDelta).filter(([k, v]) => Math.abs(v) > 0.004 && k !== "result").map(([k, v]) => `<dt>${esc({ purchaseCost: "Koszt zakupu", rawCost: "Koszt surowca", chippingCost: "Koszt rąbania", revenue: "Przychód", transportCost: "Transport" }[k] || k)}</dt><dd><span class="${v < 0 ? "neg" : "pos"}">${v > 0 ? "+" : ""}${money(v)}</span></dd>`).join("");
      box.innerHTML = `<div class="tbl-wrap"><table class="tbl" id="corr-changes"><thead><tr><th>Pole</th><th class="r">Oryginał</th><th class="r">Korekta</th><th class="r">Różnica</th></tr></thead><tbody>${ch || `<tr><td colspan="4" class="dim">Zmiana wyłącznie wyliczeń (koszt / wartość).</td></tr>`}</tbody></table></div>
        <h4 class="mini-h">Wpływ na stan (dokument KOR z datą ${esc(Dates.pl(App.today()))})</h4>
        ${eff ? `<div class="tbl-wrap"><table class="tbl" id="corr-effect"><thead><tr><th>Produkt</th><th class="r">Zmiana</th><th class="r">Stan przed</th><th class="r">Stan po</th></tr></thead><tbody>${eff}</tbody></table></div>` : `<p class="muted">Brak wpływu na stan magazynowy.</p>`}
        ${vd ? `<h4 class="mini-h">Różnica wartości</h4><dl class="money-list">${vd}<dt class="total">Wynik operacji</dt><dd class="total">${money(pc.totalsBefore.result)} → ${money(pc.totalsAfter.result)}</dd></dl>` : ""}`;
    },

    fieldLabel(key) {
      if (key.startsWith("transport.train.wagonT.")) return `Wagon ${+key.split(".").pop() + 1}: `;
      const box = document.querySelector(`[data-field="${key}"]`);
      const lab = box && box.querySelector(":scope > label, :scope > .lbl");
      const txt = lab ? lab.textContent.replace("*", "").replace(/\u00A0/g, " ").trim() : "";
      return txt ? txt + ": " : "";
    },
    reasonMsg(show, text) {
      const m = $("#corr-reason-msg"); if (!m) return;
      m.classList.toggle("hidden", !show); m.innerHTML = show ? ic("alert", 13) + `<span>${esc(text)}</span>` : "";
    },
    reasonValue() {
      const r = this.corr.reason, t = this.corr.reasonText.trim();
      if (!r) return { error: "Wybierz powód korekty" };
      if (r === "inny" && !t) return { error: "Opisz powód korekty" };
      return { value: t ? `${r} — ${t}` : r };
    },

    async saveDraft() {
      if (this.saving || this.mode !== "new") return;
      const d = R.clone(this.draft), uid = App.user().id;
      const res = await Store.transact(s => R.saveDraft(s, d, { user: R.byId(s.users, uid), today: App.today(), source: "Formularz „Nowa operacja”" }));
      if (!res.ok) { Toast.err("Nie zapisano wersji roboczej", res.error); return; }
      this.draft.draftId = res.id; this.persist();
      Toast.ok("Zapisano wersję roboczą", "Bez numeru dokumentu i bez wpływu na stan. Znajdziesz ją w „Operacjach”.");
      App.render();
    },

    /** Zatwierdzenie: walidacja → podsumowanie → potwierdzenie → zapis atomowy (jeden raz). */
    async save() {
      if (this.saving) return;
      this.showAll = true;
      const plan = this.refresh();
      if (!plan) return;
      if (!plan.ok) {
        Toast.err("Nie można zatwierdzić — popraw formularz", this.fieldLabel(plan.errorList[0].field) + plan.errorList[0].msg);
        const el = document.getElementById(fid(plan.errorList[0].field)) || document.querySelector(`[data-field="${plan.errorList[0].field}"]`);
        if (el) { el.scrollIntoView({ block: "center" }); if (el.focus) el.focus({ preventScroll: true }); }
        return;
      }
      if (this.mode === "correct") return this.confirmCorrection();
      const ok = await this.confirmDialog(plan);
      if (!ok) return;
      this.saving = true;
      $$("[data-save]").forEach(b => { b.disabled = true; b.dataset.label = b.innerHTML; b.innerHTML = "Zapisywanie…"; });
      const draft = R.clone(this.draft), uid = App.user().id;
      const res = await Store.transact(s => R.commitOperation(s, draft, { user: R.byId(s.users, uid), today: App.today(), source: "Formularz „Nowa operacja”" }));
      this.saving = false;
      $$("[data-save]").forEach(b => { b.disabled = false; if (b.dataset.label) b.innerHTML = b.dataset.label; });
      if (!res || !res.ok) { Toast.err("Nie zapisano — nic nie zostało zaksięgowane", res ? res.error : "Nieznany błąd"); this.refresh(); return; }
      if (res.duplicate) Toast.info("Operacja była już zapisana", "Ochrona przed podwójnym zapisem — nie powstały nowe dokumenty.");
      else Toast.ok("Dokument zatwierdzony", res.op.documents.map(x => x.no).join(" · "));
      const op = res.op, keep = { type: this.draft.type, direct: this.draft.sale.direct };
      this.reset();
      this.draft.type = keep.type; this.draft.sale.direct = keep.direct;
      if (keep.type === "PRODUKCJA" || keep.direct) PRESETS[keep.type === "PRODUKCJA" ? "produkcja" : "bezposrednia"](this.draft);
      this.draft.transport.place = this.defaultPlace();
      this.persist();
      App.render();
      root.OpDetail.open(op.id, { justSaved: true });
    },

    /** Okno podsumowania przed zatwierdzeniem (§31.15). */
    confirmDialog(plan) {
      return new Promise(resolve => {
        const S = Store.state, cfg = S.config, n = plan.norm, X = n.production;
        const name = id => (App.product(id) || {}).name || "—";
        const kv = [];
        const add = (k, v) => { if (v !== undefined && v !== null && v !== "") kv.push(`<dt>${esc(k)}</dt><dd>${v}</dd>`); };
        add("Rodzaj", esc(R.OP_TYPES[plan.type].label + (n.sale && n.sale.direct ? " — sprzedaż bezpośrednia" : "")));
        add("Magazyn", esc(App.whName(plan.whId)));
        add("Data", esc(Dates.pl(plan.date)));
        add("Użytkownik", esc(plan.user.name));
        if (n.purchase) { add("Dostawca", esc(n.purchase.supplierName) + (n.purchase.newSupplier ? ` <span class="badge info">nowy — zostanie dodany do kartoteki</span>` : "")); add("Zakup", `${esc(fmtQ(n.purchase.qty))} ${Units.label(n.purchase.unit)} ${esc(name(n.purchase.productId))} × ${fmt(n.purchase.price)} zł = <b>${money(n.purchase.cost)}</b>`); }
        if (X) {
          const raw = App.product(X.rawProductId), outP = App.product(X.outProductId);
          if (raw) add(X.mode === "direct" ? "Surowiec (z lasu, nie ze stanu)" : "Surowiec", esc(raw.name));
          if (raw && X.consumeQty !== null) add("Zużycie surowca", `<b>${esc(App.qtyNative(X.consumeQty, raw.id, 6))}</b>${X.factor && X.mode !== "chain" ? ` <small class="dim">(${fmtQ(X.outQty, 6)} ÷ ${fmtQ(X.factor)})</small>` : ""}`);
          if (outP) add("Produkt wyjściowy", `${esc(outP.name)} — <b>${esc(App.qtyNative(X.outQty, outP.id, 6))}</b>`);
          if (outP) { const o = Units.orient(X.outQty, outP, cfg); add("Masa · energia (orientacyjnie)", `≈ ${fmt(o.t, 2)} t · ≈ ${fmt(o.gj, 1)} GJ`); }
          if (X.outUnit === "MP") add("Cena za rąbanie / koszt", `${fmt(X.chipRate)} zł/MP → <b>${money(X.chippingCost)}</b>`);
        }
        if (n.sale) { add("Odbiorca", esc((App.partner(n.sale.buyerId) || {}).name)); add("Sprzedaż", `${esc(fmtQ(n.sale.qty))} ${Units.label(n.sale.unit)} → <b>${money(n.sale.revenue)}</b>`); }
        if (n.mm) add("Przesunięcie", `${esc(App.whName(plan.whId))} → <b>${esc(n.mm.toWhName)}</b>: ${esc(fmtQ(n.mm.qty))} ${Units.label(n.mm.unit)} ${esc(name(n.mm.productId))}`);
        if (n.transport.mode !== "none") add("Transport", `${esc(R.TRANSPORT_MODES[n.transport.mode])} — ${esc(transportText(n.transport))} · ${money(n.transport.cost)}`);
        if (plan.type !== "PRODUKCJA") add("Miejsce transportu", esc(n.transport.place));
        add("Wynik operacji", `<b>${money(plan.totals.result)}</b>`);
        const bal = plan.balances.map(b => `<tr><td>${esc(name(b.productId))}<br><small class="dim">${esc(App.whName(b.whId))}</small></td><td class="r">${esc(App.qtyNative(b.before, b.productId))}</td><td class="r"><span class="${b.after < b.before ? "neg" : "pos"}">${b.after - b.before > 0 ? "+" : ""}${esc(fmtQ(b.after - b.before, 6))}</span></td><td class="r"><b>${esc(App.qtyNative(b.after, b.productId))}</b></td></tr>`).join("");
        let done = false;
        const m = Modal.open({
          title: "Podsumowanie przed zatwierdzeniem", sub: "Sprawdź dane — po zatwierdzeniu dokument otrzyma numer i status ZATWIERDZONY. Zmiany później wyłącznie przez korektę lub anulowanie.", wide: true, id: "confirm-op",
          body: `<div class="grid g2 confirm-grid"><dl class="money-list">${kv.join("")}</dl>
            <div><h4 class="mini-h">Stan magazynowy</h4><div class="tbl-wrap"><table class="tbl" id="confirm-bal"><thead><tr><th>Produkt</th><th class="r">Przed</th><th class="r">Zmiana</th><th class="r">Po</th></tr></thead><tbody>${bal}</tbody></table></div>
            <h4 class="mini-h">Dokumenty</h4><p>${plan.documents.map(d => `<span class="badge">${d.type}</span>`).join(" ")}</p>
            ${plan.warnings.length ? `<ul class="warn-list mt3">${plan.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}</div></div>`,
          footer: `<button class="btn ghost" type="button" data-no>Wróć do edycji</button><button class="btn primary" type="button" data-yes id="confirm-yes">${ic("check", 15)} Zatwierdź dokument</button>`,
          onClose: () => { if (!done) resolve(false); }
        });
        $("[data-no]", m.el).onclick = () => m.close();
        $("[data-yes]", m.el).onclick = e => { e.currentTarget.disabled = true; done = true; m.close(); resolve(true); };
      });
    },

    async confirmCorrection() {
      const rv = this.reasonValue();
      if (rv.error) { this.reasonMsg(true, rv.error); Toast.err("Podaj powód korekty — pole nie może być puste", rv.error); const el = $("#corr-reason"); if (el) el.focus(); return; }
      const pc = this.corrPlan;
      if (!pc || !pc.ok) { Toast.err("Korekta odrzucona", pc ? pc.error : "Brak podglądu"); return; }
      const op = this.op;
      const ok = await Modal.confirm({ title: `Zatwierdzić korektę dokumentu ${op.no}?`, text: `Powstanie dokument KOREKTA z datą ${Dates.pl(App.today())}. Powód: ${rv.value}. Dokument pierwotny pozostaje w historii ze statusem SKORYGOWANY.`, ok: "Zatwierdź korektę" });
      if (!ok.ok) return;
      this.saving = true;
      const draft = R.clone(this.draft); delete draft._corrOf; delete draft._corrRev;
      const uid = App.user().id, key = this.corr.key;
      const res = await Store.transact(s => R.correctOperation(s, op.id, draft, rv.value, { user: R.byId(s.users, uid), today: App.today(), source: "Korekta dokumentu" }, { corrKey: key }));
      this.saving = false;
      if (!res.ok) { Toast.err("Korekta odrzucona — nic nie zapisano", res.error); this.refresh(); return; }
      Toast.ok("Korekta zatwierdzona", `${res.no || ""} → ${op.no}`);
      this.draft = null; this.mode = "new";
      location.hash = "#/operacje";
      setTimeout(() => root.OpDetail.open(op.id), 30);
    }
  };

  function transportText(t) {
    if (t.mode === "own") { const n = (t.runs || [t]).length; return (n > 1 ? `${n} kursy · ` : "") + ([t.reg, t.driverName].filter(Boolean).join(" · ") || "uzupełnij pojazd"); }
    if (t.mode === "external") return [t.company, t.reg].filter(Boolean).join(" · ") || "uzupełnij przewoźnika";
    if (t.mode === "train") return [t.trainNo, `${t.wagonCount} wag.`, `${fmtQ(t.totalT)} t`].filter(Boolean).join(" · ");
    return "";
  }

  const Views = {};
  Views.nowa = {
    html(params) {
      if (Form.mode !== "new") Form.draft = null;
      Form.ensureDraft(params.preset, params.draft);
      if (params.preset || params.draft) history.replaceState(null, "", "#/nowa");
      return Form.html(params);
    },
    bind(page) { Form.bind(page); }
  };
  Views.korekta = {
    html(params) { Form.startCorrection(params.op); return Form.html(params); },
    bind(page) { Form.bind(page); }
  };

  root.RIWUI = { R, esc, $, $$, ic, fid, lsGet, lsSet, ssGet, ssSet, download, csvNum, toCSV, Toast, Modal, Store, App, Views, Form, statusBadge, transportText, KEY, DRAFT_KEY, CANCEL_REASONS, NAV };
  root.App = App;
  root.RIWForm = Form;
})(typeof globalThis !== "undefined" ? globalThis : this);
