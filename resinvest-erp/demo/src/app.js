/* =========================================================================
   Warstwa A: interfejs demonstratora.
   Ekrany tylko prezentują i zbierają dane — każda decyzja biznesowa
   (walidacja, salda, dokumenty, uprawnienia) zapada w silniku `RIW`.
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
    trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13", up: "M12 19V5M5 12l7-7 7 7"
  };
  const ic = (n, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${IC[n] || ""}"/></svg>`;

  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const csvCell = v => { const s = String(v == null ? "" : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvNum = n => (n === null || n === undefined || n === "") ? "" : String(R.round(n, 3)).replace(".", ",");
  function toCSV(head, rows) { return "\uFEFF" + [head, ...rows].map(r => r.map(csvCell).join(";")).join("\r\n"); }

  /* ------------------------------------------------------------------ */
  /* Toasty i okna                                                       */
  /* ------------------------------------------------------------------ */
  const Toast = {
    show(kind, title, text) {
      let host = $("#toasts");
      const el = document.createElement("div");
      el.className = "toast " + kind;
      el.setAttribute("role", kind === "err" ? "alert" : "status");
      el.innerHTML = `<b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ""}`;
      host.appendChild(el);
      setTimeout(() => el.remove(), kind === "err" ? 7000 : 4200);
    },
    ok(t, x) { this.show("ok", t, x); }, err(t, x) { this.show("err", t, x); },
    warn(t, x) { this.show("warn", t, x); }, info(t, x) { this.show("info", t, x); }
  };

  const Modal = {
    open({ title, sub, body, footer, wide, onClose }) {
      const scrim = document.createElement("div");
      scrim.className = "scrim";
      scrim.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-h"><div style="flex:1;min-width:0"><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ""}</div>
          <button class="icon-btn" data-x type="button" aria-label="Zamknij">${ic("x")}</button></div>
        <div class="modal-b">${body || ""}</div>
        ${footer ? `<div class="modal-f">${footer}</div>` : ""}</div>`;
      document.body.appendChild(scrim);
      const prev = document.activeElement;
      const close = () => { scrim.remove(); document.removeEventListener("keydown", onKey); if (onClose) onClose(); if (prev && prev.focus) prev.focus(); };
      const onKey = e => { if (e.key === "Escape") close(); };
      document.addEventListener("keydown", onKey);
      scrim.addEventListener("mousedown", e => { if (e.target === scrim) close(); });
      $("[data-x]", scrim).onclick = close;
      const first = $("input,select,textarea,button.primary", scrim);
      if (first) first.focus();
      return { el: scrim, body: $(".modal-b", scrim), footer: $(".modal-f", scrim), close };
    },
    confirm({ title, text, ok = "Potwierdź", danger = false, input = null }) {
      return new Promise(resolve => {
        const m = this.open({
          title,
          body: `<p class="muted">${esc(text)}</p>${input ? `<div class="field mt4"><label for="cf-in">${esc(input.label)}</label>
            <input class="ctrl" id="cf-in" placeholder="${esc(input.placeholder || "")}"><div class="msg hidden" id="cf-msg"></div></div>` : ""}`,
          footer: `<button class="btn ghost" type="button" data-no>Anuluj</button><button class="btn ${danger ? "danger" : "primary"}" type="button" data-yes>${esc(ok)}</button>`,
          onClose: () => resolve({ ok: false })
        });
        $("[data-no]", m.el).onclick = () => m.close();
        $("[data-yes]", m.el).onclick = () => {
          const v = input ? $("#cf-in", m.el).value.trim() : null;
          if (input && input.required && !v) { const msg = $("#cf-msg", m.el); msg.textContent = "Pole wymagane"; msg.classList.remove("hidden"); return; }
          m.el.remove(); resolve({ ok: true, value: v });
        };
      });
    }
  };

  /* ------------------------------------------------------------------ */
  /* Trwałość (localStorage — wyłącznie mechanizm demonstracyjny)        */
  /* ------------------------------------------------------------------ */
  const KEY = "riw.demo.state.v2";
  const KEY_V1 = "riw.demo.state.v1";
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
    { id: "nowa", label: "Nowa operacja", icon: "plus" },
    { id: "stany", label: "Stany", icon: "layers" },
    { id: "dokumenty", label: "Plan dokumentów", icon: "file" },
    { group: "Kontrola" },
    { id: "inwentaryzacja", label: "Inwentaryzacja", icon: "clipboard" },
    { id: "flota", label: "Flota", icon: "truck" },
    { id: "historia", label: "Historia zmian", icon: "clock" },
    { group: "System" },
    { id: "dane", label: "Dane i ustawienia", icon: "db" }
  ];

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
    /** Ilość w jednostce magazynowej produktu, np. „8 293 MP”, „817 m³”, „728 t”. */
    qtyNative(q, productId) {
      const p = this.product(productId);
      return fmtQ(q) + "\u00A0" + Units.label(p ? p.unit : "");
    },
    /** Masa orientacyjna, np. „≈ 2 737 t” — nie dotyczy produktów tonowych. */
    mass(q, productId) {
      const p = this.product(productId);
      if (!p || p.unit === "t") return "";
      return "≈\u00A0" + fmt(Units.mass(q, p, Store.state.config), 0) + "\u00A0t";
    },

    init() {
      const r = Store.load();
      if (r.problem) setTimeout(() => Toast.err("Dane były uszkodzone", "Zachowano kopię i wczytano dane przykładowe. " + r.problem), 400);
      if (!r.problem && lsGet(KEY_V1, null) && !lsGet("riw.demo.v2.migrated", null)) {
        lsSet("riw.demo.v2.migrated", "1");
        setTimeout(() => Toast.info("Demo v2 — nowy model danych", "Stany liczone w jednostce produktu (m³ / MP / t). Dane z Demo v1 zostały nienaruszone pod starym kluczem; v2 startuje na danych przykładowych."), 600);
      }
      if (Store.memoryOnly) setTimeout(() => Toast.warn("Tryb bez zapisu", "Przeglądarka blokuje localStorage — zmiany znikną po zamknięciu karty."), 400);
      document.body.classList.toggle("no-tutorial", lsGet("riw.demo.tutorial", "1") === "0");
      this.shell();
      // przełom miesiąca: poprzednie okresy zamykają się same przy pierwszym starcie w nowym miesiącu
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
          if (this.route === "nowa" && $("#opf")) Form.refresh(); else this.render({ keepForm: true });
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
              <div class="wh-chip" id="wh-chip" title="Magazyn aktywny wynika z zalogowanego użytkownika"></div>
              <label class="sr-only" for="user-sel">Użytkownik (demo)</label>
              <select class="ctrl user-sel" id="user-sel"></select>
              <button class="icon-btn" id="intro-btn" type="button" title="Odtwórz intro" aria-label="Odtwórz intro">${ic("play", 18)}</button>
            </header>
            <main class="page" id="page" tabindex="-1"></main>
          </div>
        </div>
        <div class="toasts" id="toasts" aria-live="polite"></div>`;
      $("#menu-btn").onclick = () => document.body.classList.toggle("nav-open");
      $("#scrim-nav").onclick = () => document.body.classList.remove("nav-open");
      $("#intro-btn").onclick = () => root.Intro && root.Intro.play({ force: true });
      $("#user-sel").onchange = e => {
        lsSet("riw.demo.user", e.target.value);
        const u = this.user();
        Toast.info("Zmiana użytkownika", `${u.name} · ${R.ROLES[u.role].label} · ${this.wh().name}`);
        if (Form.draft && !Form.draft.transport.placeTouched) Form.draft.transport.place = this.wh().name;
        this.render({ keepForm: true });
      };
    },

    parseHash() {
      const h = (location.hash || "#/pulpit").replace(/^#\/?/, "");
      const [path, q] = h.split("?");
      const params = {};
      (q || "").split("&").filter(Boolean).forEach(kv => { const [k, v] = kv.split("="); params[decodeURIComponent(k)] = decodeURIComponent(v || ""); });
      const route = NAV.some(n => n.id === path) ? path : "pulpit";
      return { route, params };
    },

    render(opts = {}) {
      const { route, params } = this.parseHash();
      const changed = route !== this.route;
      this.route = route; this.params = params;
      document.body.classList.remove("nav-open");
      const u = this.user(), wh = this.wh();
      $("#nav").innerHTML = NAV.map(n => n.group ? `<div class="sb-group">${esc(n.group)}</div>` :
        `<a class="nav-item" href="#/${n.id}" ${n.id === route ? 'aria-current="page"' : ""}><span class="ic">${ic(n.icon, 17)}</span><span>${esc(n.label)}</span>${n.id === "inwentaryzacja" ? this.invBadge() : ""}</a>`).join("");
      $("#user-sel").innerHTML = Store.state.users.map(x => `<option value="${esc(x.id)}" ${x.id === u.id ? "selected" : ""}>${esc(x.name)} — ${esc(R.ROLES[x.role].label)}</option>`).join("");
      $("#wh-chip").innerHTML = `<span class="dot"></span><small>Magazyn aktywny:</small><b>${esc(wh ? wh.name : "—")}</b>`;
      const item = NAV.find(n => n.id === route);
      $("#title").textContent = item.label;
      document.title = `${item.label} · ResInvest ERP (demo)`;
      const page = $("#page");
      const view = Views[route];
      page.innerHTML = view.html(params, opts);
      if (view.bind) view.bind(page, params, opts);
      if (changed) { root.scrollTo(0, 0); }
    },
    invBadge() {
      const open = Store.state.inventory.filter(p => p.whId === this.user().whId && p.status === "OTWARTA").length;
      return open ? `<span class="cnt">${open}</span>` : "";
    },
    go(route) { if (location.hash !== "#/" + route) location.hash = "#/" + route; else this.render(); }
  };

  /* ------------------------------------------------------------------ */
  /* Samouczek przy polach                                               */
  /* ------------------------------------------------------------------ */
  const HELP = {
    "date": "<b>Co:</b> dzień operacji. <b>Po co:</b> decyduje o miesiącu księgowania i numeracji dokumentów. Nie może być z przyszłości ani z okresu zamkniętego inwentaryzacją. <b>Przykład:</b> 2026-09-23.",
    "purchase.supplierId": "<b>Co:</b> firma, od której kupujesz. <b>Po co:</b> trafia na dokument PZ i do rozliczeń z dostawcą. <b>Przykład:</b> Lander Agro.",
    "purchase.basis": "<b>Co:</b> podstawa pochodzenia biomasy. <b>Deklaracja</b> — oświadczenie dostawcy, <b>KZR</b> — dostawa rozliczana w systemie certyfikacji KZR. <b>Przykład:</b> KZR.",
    "purchase.productId": "<b>Co:</b> kupowany towar. <b>Po co:</b> ustala jednostkę magazynową (drewno m³, zrębka MP, PKS i łupina t) i czy można uruchomić produkcję. <b>Przykład:</b> Drewno opałowe.",
    "purchase.qty": "<b>Co:</b> ilość z dokumentu dostawcy, w jednostce wybranej obok. Możesz wpisać <b>12,50</b> albo <b>12.50</b> lub wkleić <b>1 250,50</b>. <b>Przykład:</b> 20.",
    "purchase.unit": "<b>Co:</b> jednostka ilości i ceny — tylko te, które mają sens dla towaru. <b>1 m³ drewna = 4 MP</b>. Produkty tonowe (PKS, łupina) — wyłącznie t. <b>Przykład:</b> m³.",
    "purchase.price": "<b>Co:</b> cena netto za 1 jednostkę zakupu. <b>Po co:</b> koszt zakupu = ilość × cena. <b>Przykład:</b> 230.",
    "purchase.cost": "<b>Co:</b> koszt całkowity zakupu, liczony automatycznie. Nie zawiera transportu ani rąbania.",
    "purchase.weightMode": "<b>Co:</b> skąd bierzemy masę. <b>Orientacyjna</b> = przelicznik produktu (zrębka 0,33 t/MP, drewno 0,952 t/m³). <b>Ręczna</b> = waga rzeczywista z kwitu wagowego. Masa nie zmienia ilości na stanie.",
    "purchase.weightManual": "<b>Co:</b> waga z wagi samochodowej (kwit wagowy), w tonach. <b>Przykład:</b> 19,20.",
    "production.type": "<b>Co:</b> rodzaj wyprodukowanej zrębki. <b>Po co:</b> wskazuje produkt wynikowy. <b>Przykład:</b> Zrębka produkcyjna leśna.",
    "production.rawProductId": "<b>Co:</b> surowiec, z którego powstaje zrębka. <b>Przykład:</b> Drewno opałowe.",
    "production.consumeQty": "<b>Co:</b> ile surowca idzie do rębaka. <b>Po co:</b> tyle system odejmie ze stanu (RW). Nie może przekroczyć stanu. <b>Przykład:</b> 817.",
    "production.rawQty": "<b>Co:</b> ilość drewna z lasu (opcjonalnie). <b>Nie jest</b> pobierana z magazynu — służy do wyliczenia wydajności i kontroli wyniku. <b>Przykład:</b> 150.",
    "production.rawCost": "<b>Co:</b> koszt drewna z lasu, jeśli rozliczasz go w tej operacji (opcjonalnie). <b>Przykład:</b> 34 500.",
    "production.outMP": "<b>Co:</b> ilość zrębki z rębaka w MP. Puste = zużycie przeliczone (1 m³ = 4 MP). Nie może przekroczyć zużycia. <b>Przykład:</b> 600.",
    "production.diffReason": "<b>Co:</b> przyczyna, gdy wynik jest mniejszy niż zużycie. Wymagana tylko przy różnicy.",
    "production.chipRate": "<b>Co:</b> cena za rąbanie w zł za 1 MP zrębki. Domyślnie <b>10,00 zł/MP</b> — możesz zmienić. <b>Po co:</b> koszt rąbania = MP × cena. <b>Przykład:</b> 10,00.",
    "production.ndl": "<b>Co:</b> nadleśnictwo z kwitu wywozowego. <b>Po co:</b> pochodzenie drewna. <b>Przykład:</b> Rudy Raciborskie.",
    "production.lesnictwo": "<b>Co:</b> leśnictwo z kwitu wywozowego. <b>Przykład:</b> Stanica.",
    "production.kwit": "<b>Co:</b> numer kwitu wywozowego Lasów Państwowych. <b>Przykład:</b> KW 0217/09/2026.",
    "production.investSite": "<b>Co:</b> gdzie prowadzono wycinkę i dla jakiej inwestycji. <b>Przykład:</b> Obwodnica Gliwic — odcinek II.",
    "production.sourceDoc": "<b>Co:</b> numer decyzji lub protokołu wycinki (opcjonalnie). <b>Przykład:</b> Protokół wycinki 17/2026.",
    "production.chipperId": "<b>Co:</b> rębak z modułu Flota (opcjonalnie). <b>Przykład:</b> Jenz HEM 583.",
    "production.operatorId": "<b>Co:</b> operator rębaka. Domyślnie przypisany do rębaka — zmiana dotyczy tylko tej produkcji.",
    "sale.productId": "<b>Co:</b> towar, który jest już na magazynie. Lista pokazuje tylko towary ze stanem. <b>Przykład:</b> Zrębka produkcyjna leśna.",
    "sale.qty": "<b>Co:</b> ilość do sprzedaży. Nie może przekroczyć stanu magazynowego. <b>Przykład:</b> 500.",
    "sale.unit": "<b>Co:</b> jednostka ilości i ceny, zgodna z towarem. <b>Przykład:</b> MP.",
    "sale.price": "<b>Co:</b> cena netto sprzedaży za 1 jednostkę. <b>Po co:</b> przychód = ilość × cena. <b>Przykład:</b> 90.",
    "sale.buyerId": "<b>Co:</b> kupujący / odbiorca. Wymagany. <b>Przykład:</b> Elektrociepłownia Zabrze S.A.",
    "sale.qtyMP": "<b>Co:</b> ile MP zrębki sprzedajesz. Puste = cały wynik produkcji. Maksimum = wynik produkcji. <b>Przykład:</b> 600.",
    "sale.priceUnit": "<b>Co:</b> jednostka ceny. Przy cenie za tonę przychód liczony jest z masy (MP × 0,33 t). <b>Przykład:</b> MP.",
    "transport.place": "<b>Co:</b> dokąd jedzie ładunek (destynacja / miejsce dostawy). <b>Po co:</b> trafia na dokumenty jako „Miejsce transportu”. Stan zawsze księguje się w aktywnym magazynie. <b>Przykład:</b> Elektrownia Łaziska.",
    "transport.mode": "<b>Co:</b> kto wiezie ładunek. Wybierz jeden tryb albo żaden. <b>Transport nie zmienia stanu</b> — to wyłącznie koszt i karta transportu (TR).",
    "transport.own.vehicleId": "<b>Co:</b> pojazd z modułu Flota. Rejestracja i kierowca domyślny uzupełnią się same.",
    "transport.own.driverId": "<b>Co:</b> kierowca tego kursu. Zmiana dotyczy <b>tylko tego kursu</b> — kartoteka pojazdu się nie zmienia.",
    "transport.own.km": "<b>Co:</b> długość trasy w km. <b>Po co:</b> koszt = km × stawka. <b>Przykład:</b> 262.",
    "transport.own.rate": "<b>Co:</b> stawka za kilometr. Puste = 5 zł/km. <b>Przykład:</b> 5.",
    "transport.external.company": "<b>Co:</b> firma przewozowa. <b>Przykład:</b> ESI Logistics.",
    "transport.external.reg": "<b>Co:</b> numer rejestracyjny auta przewoźnika. <b>Przykład:</b> ESI 18734.",
    "transport.external.km": "<b>Co:</b> odległość w km (informacyjnie). <b>Przykład:</b> 262.",
    "transport.external.freight": "<b>Co:</b> kwota frachtu z faktury przewoźnika. <b>Przykład:</b> 1 250.",
    "transport.external.includedInPrice": "Zaznacz, gdy transport jest wliczony w cenę towaru. Koszt transportu tej operacji = 0 zł.",
    "transport.train.trainNo": "<b>Co:</b> numer składu. <b>Przykład:</b> RC 50931.",
    "transport.train.carrier": "<b>Co:</b> przewoźnik kolejowy. <b>Przykład:</b> PKP Cargo.",
    "transport.train.docNo": "<b>Co:</b> numer listu przewozowego (CIM / SMGS). <b>Przykład:</b> CIM 5093/09.",
    "transport.train.loadPlace": "<b>Co:</b> bocznica / stacja załadunku. <b>Przykład:</b> Bocznica Kuźnia Raciborska.",
    "transport.train.wagonCount": "<b>Co:</b> liczba wagonów w składzie. <b>Przykład:</b> 20.",
    "transport.train.capacity": "<b>Co:</b> pojemność lub ładowność jednego wagonu (opcjonalnie) — w MP albo w tonach. Służy do kontroli przeładowania i sumy pojemności. <b>Przykład:</b> 60 t.",
    "transport.train.sameT": "<b>Co:</b> tonaż jednego wagonu — trafi do każdego wagonu. <b>Przykład:</b> 60.",
    "transport.train.price": "<b>Co:</b> stawka frachtu kolejowego. Ilość do rozliczenia wynika z tonażu składu. <b>Przykład:</b> 25.",
    "transport.train.priceUnit": "<b>Co:</b> za co płacimy przewoźnikowi: t, MP czy m³ (t → MP: ÷ 0,33; MP → m³: ÷ 4).",
    "notes": "<b>Co:</b> dodatkowe informacje (opcjonalnie). <b>Przykład:</b> Dostawa po godz. 15."
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
  const textIn = (key, v, { placeholder = "", list = "" } = {}) =>
    `<input class="ctrl" type="text" id="${fid(key)}" data-bind="${esc(key)}" value="${esc(v)}" placeholder="${esc(placeholder)}" autocomplete="off" ${list ? `list="${list}"` : ""}>`;
  const numIn = (key, v, { suffix = "", placeholder = "" } = {}) =>
    `<div class="input-wrap"><input class="ctrl num-in" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
      id="${fid(key)}" data-bind="${esc(key)}" data-num value="${esc(v)}" placeholder="${esc(placeholder)}">${suffix ? `<span class="suffix">${esc(suffix)}</span>` : ""}</div>`;
  const selIn = (key, options, v, { struct = false } = {}) =>
    `<select class="ctrl" id="${fid(key)}" data-bind="${esc(key)}" ${struct ? "data-struct" : ""}>${options.map(o =>
      `<option value="${esc(o.v)}" ${String(o.v) === String(v == null ? "" : v) ? "selected" : ""} ${o.disabled ? "disabled" : ""}>${esc(o.l)}</option>`).join("")}</select>`;
  const outBox = (key, html) => `<output class="ctrl num-in out" id="${fid(key)}" data-out="${esc(key)}">${html}</output>`;
  const optCard = (key, { checked, disabled, title, text, struct = true, radio = false, attrs = "", id = "" }) =>
    `<label class="opt ${radio ? "radio" : ""} ${disabled && checked ? "locked" : ""}">
      <input type="checkbox" ${key || id ? `id="${id || fid(key)}"` : ""} ${key ? `data-bind="${esc(key)}"` : ""} ${struct ? "data-struct" : ""} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} ${attrs}>
      <span class="box">${ic("check", 13)}</span><span class="ct"><b>${esc(title)}</b><span>${esc(text)}</span></span></label>`;
  const section = (n, id, title, sub, body, off) => `<section class="sec ${off ? "off" : ""}" aria-labelledby="h-${id}">
      <div class="sec-h"><span class="n">${n}</span><div><h3 id="h-${id}">${esc(title)}</h3><p>${esc(sub)}</p></div></div>
      <div class="sec-b">${body || ""}</div></section>`;

  /* ------------------------------------------------------------------ */
  /* Nowa operacja                                                       */
  /* ------------------------------------------------------------------ */
  const PRESETS = {
    zakup: d => { d.type = "ZAKUP"; d.purchase.productId = "pr_drewno"; d.purchase.unit = "m3"; },
    lancuch: d => { d.type = "ZAKUP"; d.purchase.productId = "pr_drewno"; d.purchase.unit = "m3"; d.production.enabled = true; d.sale.enabled = true; },
    wz: d => { d.type = "SPRZEDAZ"; d.sale.direct = false; },
    produkcja: d => { d.type = "PRODUKCJA"; d.production.rawProductId = "pr_drewno"; },
    bezposrednia: d => { d.type = "SPRZEDAZ"; d.sale.direct = true; }
  };
  const Form = {
    draft: null, touched: new Set(), showAll: false, saving: false, plan: null,

    ensureDraft(preset) {
      const stored = ssGet("riw.demo.v2.draft", null);
      if (!this.draft && stored) {
        try { const d = JSON.parse(stored); if (d && d.idemKey && d.type && !Store.state.operations.some(o => o.idemKey === d.idemKey)) this.draft = d; } catch (e) {}
      }
      if (this.draft && Store.state.operations.some(o => o.idemKey === this.draft.idemKey)) this.draft = null;
      if (!this.draft || preset) this.reset(preset);
    },
    reset(preset) {
      const d = R.blankDraft({ today: App.today() });
      d.production.chipRate = fmt(Store.state.config.chipRateDefault, 2);
      if (PRESETS[preset]) PRESETS[preset](d);
      d.transport.place = App.wh() ? App.wh().name : "";
      this.draft = d; this.touched = new Set(); this.showAll = false;
      this.persist();
    },
    persist() { ssSet("riw.demo.v2.draft", JSON.stringify(this.draft)); },
    defaultPlace() {
      const d = this.draft;
      if (d.type === "SPRZEDAZ" || (d.type === "ZAKUP" && d.sale.enabled)) { const b = App.partner(d.sale.buyerId); if (b) return b.name; }
      return App.wh() ? App.wh().name : "";
    },

    /* ---------- wspólne pola produkcji ---------- */
    productionFields(mode) {
      const S = Store.state, d = this.draft, P_ = d.production;
      const chipper = R.byId(S.fleet.chippers, P_.chipperId);
      const woods = S.products.filter(p => p.cat === "drewno" && p.active !== false);
      const stock = Stock.byProduct(S, App.user().whId);
      let head = "";
      if (mode === "stock") {
        const raw = App.product(P_.rawProductId);
        const u = raw ? Units.label(raw.unit) : "";
        head = `
          ${field({ key: "production.rawProductId", label: "Surowiec ze stanu", req: true, span: "span2", control: selIn("production.rawProductId", [{ v: "", l: "— wybierz surowiec —" }].concat(woods.map(p => ({ v: p.id, l: `${p.name} — na stanie ${fmtQ(stock.get(p.id) || 0)} ${Units.label(p.unit)}`, disabled: !((stock.get(p.id) || 0) > 0) }))), P_.rawProductId, { struct: true }) })}
          ${field({ key: "production.stock", label: "Stan surowca", control: outBox("production.stock", "—"), help: false })}
          ${field({ key: "production.consumeQty", label: `Zużycie surowca${u ? ` (${u})` : ""}`, req: true, control: numIn("production.consumeQty", P_.consumeQty, { suffix: u, placeholder: "np. 817" }) })}`;
      } else if (mode === "direct") {
        head = `
          ${field({ key: "production.rawProductId", label: "Surowiec z lasu (opcjonalnie)", control: selIn("production.rawProductId", [{ v: "", l: "— nie podaję —" }].concat(woods.map(p => ({ v: p.id, l: p.name }))), P_.rawProductId, { struct: true }) })}
          ${field({ key: "production.rawQty", label: "Ilość surowca (m³)", control: numIn("production.rawQty", P_.rawQty, { suffix: "m³", placeholder: "opcjonalnie" }) })}
          ${field({ key: "production.rawCost", label: "Koszt surowca (zł)", span: "span2", control: numIn("production.rawCost", P_.rawCost, { suffix: "zł", placeholder: "opcjonalnie" }) })}`;
      } else {
        const u = Units.label(d.purchase.unit);
        head = field({ key: "production.consumeQty", label: `Zużycie surowca (${u})`, span: "span2", control: numIn("production.consumeQty", P_.consumeQty, { suffix: u, placeholder: "cały zakup" }) });
      }
      const origin = mode === "stock" ? "" : (P_.type === "lesna" ? `
          ${field({ key: "production.ndl", label: "Nadleśnictwo", req: true, control: textIn("production.ndl", P_.ndl, { placeholder: "np. Rudy Raciborskie", list: "dl-ndl" }) })}
          ${field({ key: "production.lesnictwo", label: "Leśnictwo", req: true, control: textIn("production.lesnictwo", P_.lesnictwo, { placeholder: "np. Stanica" }) })}
          ${field({ key: "production.kwit", label: "Nr kwitu wywozowego", req: true, span: "span2", control: textIn("production.kwit", P_.kwit, { placeholder: "np. KW 0217/09/2026" }) })}` : `
          ${field({ key: "production.sourceType", label: "Typ źródła", control: outBox("production.sourceType", "Wycinka inwestycyjna"), help: false })}
          ${field({ key: "production.investSite", label: "Miejsce wycinki / inwestycja", req: true, control: textIn("production.investSite", P_.investSite, { placeholder: "np. Obwodnica Gliwic" }) })}
          ${field({ key: "production.sourceDoc", label: "Nr dokumentu źródłowego", span: "span2", control: textIn("production.sourceDoc", P_.sourceDoc, { placeholder: "np. Protokół wycinki 17/2026" }) })}`);
      return `<div class="fgrid four">
          ${head}
          ${field({ key: "production.type", label: "Rodzaj produkcji", req: true, span: "span2", control: selIn("production.type", Object.entries(R.PROD_TYPES).map(([k, v]) => ({ v: k, l: v.label })), P_.type, { struct: true }) })}
          ${field({ key: "production.outMP", label: "Wyprodukowano (MP)", req: mode === "direct", control: numIn("production.outMP", P_.outMP, { suffix: "MP", placeholder: mode === "direct" ? "np. 600" : "auto" }) })}
          ${field({ key: "production.outMass", label: "Masa orientacyjna", control: outBox("production.outMass", "—"), help: false })}
          ${field({ key: "production.diffReason", label: "Przyczyna różnicy", span: "span2", control: selIn("production.diffReason", [{ v: "", l: "— brak różnicy —" }].concat(Object.entries(R.DIFF_REASONS).map(([k, v]) => ({ v: k, l: v }))), P_.diffReason) })}
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
      const buyers = Store.state.partners.filter(p => p.active !== false && ["buyer", "both"].includes(p.role));
      return `<div class="fgrid four">
        ${field({ key: "sale.buyerId", label: "Odbiorca", req: true, span: "span2", control: selIn("sale.buyerId", [{ v: "", l: "— wybierz odbiorcę —" }].concat(buyers.map(p => ({ v: p.id, l: p.name }))), d.sale.buyerId, { struct: true }) })}
        ${field({ key: "sale.qtyMP", label: "Ilość sprzedaży (MP)", control: numIn("sale.qtyMP", d.sale.qtyMP, { suffix: "MP", placeholder: "cały wynik" }) })}
        ${field({ key: "sale.weight", label: "Masa orientacyjna", control: outBox("sale.weight", "—"), help: false })}
        ${field({ key: "sale.price", label: `Cena sprzedaży (zł/${d.sale.priceUnit})`, req: true, control: numIn("sale.price", d.sale.price, { suffix: `zł/${d.sale.priceUnit}`, placeholder: "np. 90" }) })}
        ${field({ key: "sale.priceUnit", label: "Cena za", control: selIn("sale.priceUnit", [{ v: "MP", l: "MP" }, { v: "t", l: "t (tonę)" }], d.sale.priceUnit, { struct: true }) })}
        ${field({ key: "sale.revenue", label: "Przychód ze sprzedaży", span: "span2", control: outBox("sale.revenue", "—"), help: false })}
      </div>`;
    },

    sectionsHtml() {
      const S = Store.state, d = this.draft, wh = App.wh();
      const T = d.transport;
      const type = d.type;
      const typeCard = (t, title, text) => optCard("", { checked: type === t, struct: false, radio: true, id: `f-type-${t}`, title, text, attrs: `data-type="${t}"` });
      let n = 0;
      let html = section(n++, "type", "Rodzaj operacji", "Każdy rodzaj działa samodzielnie — wypełniasz tylko to, co jest potrzebne.", `
        <div class="scope" role="group" aria-label="Rodzaj operacji">
          ${typeCard("ZAKUP", "Zakup", "Dostawca → magazyn (PZ). Opcjonalnie produkcja i sprzedaż wyniku.")}
          ${typeCard("SPRZEDAZ", "Sprzedaż", "Magazyn → odbiorca (WZ) albo sprzedaż bezpośrednio po produkcji w lesie.")}
          ${typeCard("PRODUKCJA", "Produkcja na magazynie", "Surowiec ze stanu → produkcja → produkt na stanie (RW + PW).")}
        </div>
        <div class="info-line mt3">${ic("layers", 15)}<span>Magazyn: <b>${esc(wh ? wh.name : "—")}</b> — wynika z zalogowanego użytkownika (${esc(App.user().name)}). Nie wybierasz magazynu w formularzu.</span></div>
        <div class="fgrid four mt4">${field({ key: "date", label: "Data operacji", req: true, control: `<input class="ctrl" type="date" id="${fid("date")}" data-bind="date" value="${esc(d.date)}" max="${esc(App.today())}">` })}</div>`);

      if (type === "ZAKUP") {
        const prod = App.product(d.purchase.productId);
        const isWood = prod && prod.cat === "drewno";
        const suppliers = S.partners.filter(p => p.active !== false && ["supplier", "both"].includes(p.role));
        const units = prod ? Units.allowed(prod) : Units.LIST;
        const u = Units.label(d.purchase.unit);
        html += section(n++, "purchase", "Zakup", "Co kupujemy, od kogo, w jakiej jednostce i za ile.", `
          <div class="scope mb3">
            ${optCard("production.enabled", { checked: d.production.enabled, disabled: !isWood, title: "+ Produkcja z automatycznym zużyciem", text: isWood ? "Zużycie zakupionego drewna (RW) i przyjęcie zrębki (PW) w tej samej operacji." : "Dostępna dla drewna." })}
            ${optCard("sale.enabled", { checked: d.sale.enabled, disabled: !d.production.enabled, title: "+ Sprzedaż wyniku produkcji", text: d.production.enabled ? "Wydanie zrębki z tej produkcji do odbiorcy (WZ)." : "Wymaga produkcji. Sprzedaż ze stanu → rodzaj „Sprzedaż”." })}
          </div>
          <div class="fgrid four">
            ${field({ key: "purchase.supplierId", label: "Dostawca", req: true, span: "span2", control: selIn("purchase.supplierId", [{ v: "", l: "— wybierz dostawcę —" }].concat(suppliers.map(p => ({ v: p.id, l: p.name }))), d.purchase.supplierId) })}
            ${field({ key: "purchase.basis", label: "Podstawa", req: true, span: "span2", control: selIn("purchase.basis", [{ v: "DEKL", l: "Deklaracja" }, { v: "KZR", l: "KZR" }], d.purchase.basis) })}
            ${field({ key: "purchase.productId", label: "Produkt / surowiec", req: true, span: "span2", control: selIn("purchase.productId", [{ v: "", l: "— wybierz produkt —" }].concat(S.products.filter(p => p.active !== false).map(p => ({ v: p.id, l: `${p.name} (${Units.label(p.unit)})` }))), d.purchase.productId, { struct: true }) })}
            ${field({ key: "purchase.qty", label: "Ilość", req: true, control: numIn("purchase.qty", d.purchase.qty, { suffix: u, placeholder: "np. 20" }) })}
            ${field({ key: "purchase.unit", label: "Jednostka zakupu", req: true, control: selIn("purchase.unit", units.map(x => ({ v: x, l: Units.label(x) })), d.purchase.unit, { struct: true }) })}
            ${field({ key: "purchase.price", label: `Cena jednostkowa (zł/${u})`, req: true, control: numIn("purchase.price", d.purchase.price, { suffix: `zł/${u}`, placeholder: "np. 230" }) })}
            ${field({ key: "purchase.cost", label: "Koszt całkowity zakupu", control: outBox("purchase.cost", "—") })}
            ${field({ key: "purchase.weightMode", label: "Masa", req: true, control: selIn("purchase.weightMode", [{ v: "auto", l: "Orientacyjna (przelicznik)" }, { v: "manual", l: "Ręczna — waga rzeczywista" }], d.purchase.weightMode, { struct: true }) })}
            ${d.purchase.weightMode === "manual"
              ? field({ key: "purchase.weightManual", label: "Waga rzeczywista (t)", req: true, control: numIn("purchase.weightManual", d.purchase.weightManual, { suffix: "t", placeholder: "np. 19,20" }) })
              : field({ key: "purchase.weightAuto", label: "Masa orientacyjna (t)", control: outBox("purchase.weightAuto", "—"), help: false })}
          </div>`);
        html += d.production.enabled
          ? section(n++, "prod", "Produkcja z automatycznym zużyciem", "Zakupione drewno jest od razu dostępne do pobrania. Kolejność: zakup → zużycie → produkcja.", this.productionFields("chain"))
          : "";
        html += d.sale.enabled ? section(n++, "sale", "Sprzedaż wyniku produkcji", "Sprzedajemy zrębkę z tej produkcji. Zmniejsza stan zrębki.", this.saleOfOutputFields()) : "";
      } else if (type === "SPRZEDAZ") {
        const direct = !!d.sale.direct;
        const toggle = `<div class="scope one mb3">${optCard("sale.direct", { checked: direct, title: "Sprzedaż bezpośrednia po produkcji / prosto z lasu", text: "las → produkcja → sprzedaż → odbiorca. Towar NIE jest pobierany z magazynu i nie zwiększa końcowego stanu." })}</div>`;
        if (!direct) {
          const stock = Stock.byProduct(S, App.user().whId);
          const prods = S.products.filter(p => (stock.get(p.id) || 0) > R.EPS || p.id === d.sale.productId);
          const prod = App.product(d.sale.productId);
          const units = prod ? Units.allowed(prod) : [];
          const u = Units.label(d.sale.unit);
          const buyers = S.partners.filter(p => p.active !== false && ["buyer", "both"].includes(p.role));
          html += section(n++, "sale", "Sprzedaż z magazynu (WZ)", "Towar, który już jest na stanie → odbiorca. WZ odejmuje sprzedaną ilość ze stanu.", toggle + `
            <div class="fgrid four">
              ${field({ key: "sale.productId", label: "Towar z magazynu", req: true, span: "span2", control: selIn("sale.productId", [{ v: "", l: "— wybierz towar —" }].concat(prods.map(p => ({ v: p.id, l: `${p.name} — ${fmtQ(stock.get(p.id) || 0)} ${Units.label(p.unit)}` }))), d.sale.productId, { struct: true }) })}
              ${field({ key: "sale.onStock", label: "Stan na magazynie", control: outBox("sale.onStock", "—"), help: false })}
              ${field({ key: "sale.after", label: "Stan po WZ", control: outBox("sale.after", "—"), help: false })}
              ${field({ key: "sale.qty", label: "Ilość", req: true, control: numIn("sale.qty", d.sale.qty, { suffix: u, placeholder: "np. 500" }) })}
              ${field({ key: "sale.unit", label: "Jednostka", req: true, control: prod ? selIn("sale.unit", units.map(x => ({ v: x, l: Units.label(x) })), d.sale.unit, { struct: true }) : outBox("sale.unit", "wybierz towar") })}
              ${field({ key: "sale.price", label: `Cena sprzedaży (zł/${u})`, req: true, control: numIn("sale.price", d.sale.price, { suffix: `zł/${u}`, placeholder: "np. 90" }) })}
              ${field({ key: "sale.revenue", label: "Wartość sprzedaży", control: outBox("sale.revenue", "—"), help: false })}
              ${field({ key: "sale.buyerId", label: "Kupujący / odbiorca", req: true, span: "span2", control: selIn("sale.buyerId", [{ v: "", l: "— wybierz odbiorcę —" }].concat(buyers.map(p => ({ v: p.id, l: p.name }))), d.sale.buyerId, { struct: true }) })}
              ${field({ key: "sale.weight", label: "Masa orientacyjna", span: "span2", control: outBox("sale.weight", "—"), help: false })}
            </div>`);
        } else {
          html += section(n++, "sale", "Sprzedaż bezpośrednia", "las → produkcja → sprzedaż. Bez zakupu i bez pobierania z magazynu.", toggle);
          html += section(n++, "prod", "Produkcja (w lesie)", "Ile zrębki wyprodukowano i skąd pochodzi drewno.", this.productionFields("direct"));
          html += section(n++, "sale2", "Odbiorca i cena", "Sprzedaż nie może przekroczyć ilości wyprodukowanej.", this.saleOfOutputFields());
        }
      } else if (type === "PRODUKCJA") {
        html += section(n++, "prod", "Produkcja na magazynie", "Surowiec ze stanu → produkcja → produkt na stanie. Bez nowego zakupu.", this.productionFields("stock"));
      }

      html += this.transportHtml(n++);
      html += section(n++, "notes", "Uwagi", "", field({ key: "notes", label: "Uwagi do operacji", control: `<textarea class="ctrl" id="${fid("notes")}" data-bind="notes" rows="2">${esc(d.notes)}</textarea>` }));
      return html;
    },

    transportHtml(n) {
      const S = Store.state, T = this.draft.transport, mode = T.mode;
      const veh = R.byId(S.fleet.vehicles, T.own.vehicleId);
      const tr = T.train;
      let modeHtml = "";
      if (mode === "own") {
        modeHtml = `<div class="fgrid four mt4">
          ${field({ key: "transport.own.vehicleId", label: "Pojazd z floty", req: true, span: "span2", control: selIn("transport.own.vehicleId", [{ v: "", l: "— wybierz pojazd —" }].concat(S.fleet.vehicles.map(v => ({ v: v.id, l: `${v.name} · ${v.reg}${v.status !== "aktywny" ? " — " + R.ASSET_STATUS[v.status] : ""}`, disabled: v.status !== "aktywny" }))), T.own.vehicleId, { struct: true }) })}
          ${field({ key: "transport.own.reg", label: "Numer rejestracyjny", control: outBox("transport.own.reg", esc(veh ? veh.reg : "—")), help: false })}
          ${field({ key: "transport.own.defaultDriver", label: "Kierowca domyślny", control: outBox("transport.own.defaultDriver", esc(veh ? ((R.byId(S.fleet.drivers, veh.driverId) || {}).name || "—") : "—")), help: false })}
          ${field({ key: "transport.own.driverId", label: "Kierowca tego kursu", req: true, span: "span2", control: selIn("transport.own.driverId", [{ v: "", l: "— wybierz kierowcę —" }].concat(S.fleet.drivers.map(x => ({ v: x.id, l: x.name + (veh && veh.driverId === x.id ? " (domyślny)" : "") }))), T.own.driverId || (veh ? veh.driverId : "")) })}
          ${field({ key: "transport.own.km", label: "Kilometry", req: true, control: numIn("transport.own.km", T.own.km, { suffix: "km", placeholder: "np. 262" }) })}
          ${field({ key: "transport.own.rate", label: "Stawka (zł/km)", control: numIn("transport.own.rate", T.own.rate, { suffix: "zł/km", placeholder: fmtQ(S.config.kmRateDefault) }) })}
          ${field({ key: "transport.cost", label: "Koszt transportu (auto)", span: "span-all", control: outBox("transport.cost", "—"), help: false })}
        </div>`;
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
          ${field({ key: "transport.train.capacity", label: "Pojemność / tonaż wagonu", control: numIn("transport.train.capacity", tr.capacity, { suffix: tr.capUnit, placeholder: "opcjonalnie" }) })}
          ${field({ key: "transport.train.capUnit", label: "Jednostka pojemności", control: selIn("transport.train.capUnit", [{ v: "t", l: "tony (t)" }, { v: "MP", l: "MP" }], tr.capUnit, { struct: true }) })}
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
        <div class="fgrid">${field({ key: "transport.place", label: "Miejsce transportu / dostawy (destynacja)", req: true, span: "span-all", control: textIn("transport.place", T.place, { placeholder: "np. RiC Zabrze", list: "dl-places" }) + `<datalist id="dl-places">${S.warehouses.map(w => `<option value="${esc(w.name)}">`).concat(buyers.map(b => `<option value="${esc(b.name)}">`)).join("")}</datalist>` })}</div>
        <div class="field mt4" data-field="transport.mode"><span class="lbl">Rodzaj transportu (zaznacz jeden)</span>
          <div class="scope" role="group" aria-label="Rodzaj transportu">
            ${optCard("", { checked: mode === "own", struct: false, radio: true, id: "f-mode-own", title: "Transport własny", text: "Pojazd i kierowca z Floty, koszt = km × stawka.", attrs: 'data-mode="own"' })}
            ${optCard("", { checked: mode === "external", struct: false, radio: true, id: "f-mode-external", title: "Transport zewnętrzny", text: "Firma przewozowa, fracht z faktury.", attrs: 'data-mode="external"' })}
            ${optCard("", { checked: mode === "train", struct: false, radio: true, id: "f-mode-train", title: "Pociąg", text: "Wagony, tonaż, podsumowanie składu.", attrs: 'data-mode="train"' })}
          </div>
          <div class="help tut">${HELP["transport.mode"]}</div></div>
        ${modeHtml}`);
    },

    html() {
      if (!App.can("op.create")) {
        return `<div class="page-head"><div class="titles"><h2>Nowa operacja</h2></div></div>
          <div class="info-line err">${ic("alert", 15)}<span>Rola <b>${esc(R.ROLES[App.user().role].label)}</b> nie pozwala tworzyć operacji. Zmień użytkownika w prawym górnym rogu.</span></div>`;
      }
      return `<div class="page-head"><div class="titles"><h2>Nowa operacja</h2>
          <p>Zakup, sprzedaż z magazynu, produkcja na magazynie albo produkcja z bezpośrednią sprzedażą. Pola z <span class="req">*</span> są wymagane.</p></div>
          <div class="actions">
            <label class="inline-opt"><input type="checkbox" id="tut-toggle" ${lsGet("riw.demo.tutorial", "1") !== "0" ? "checked" : ""}> Samouczek pod polami</label>
            <button class="btn ghost" type="button" id="form-reset">${ic("x", 15)} Wyczyść formularz</button>
          </div></div>
        <div class="op-layout">
          <form id="opf" novalidate autocomplete="off">${this.sectionsHtml()}</form>
          <aside class="summary" id="summary" aria-label="Podsumowanie operacji">
            <div class="card"><div class="card-h"><h3>Przebieg operacji</h3><span class="sub">kolejność księgowania</span></div><div class="card-b" id="sum-flow"></div></div>
            <div class="card"><div class="card-h"><h3 id="sum-bal-h">Stan w magazynie</h3></div><div id="sum-bal"></div></div>
            <div class="card"><div class="card-h"><h3>Koszty i przychód</h3></div><div class="card-b" id="sum-money"></div></div>
            <div class="card"><div class="card-h"><h3>Plan dokumentów</h3><span class="sub">powstaną przy zapisie</span></div><div id="sum-docs"></div></div>
            <div class="card"><div class="card-h"><h3>Kontrola</h3><span id="sum-badge"></span></div>
              <div class="card-b"><div id="sum-errs"></div>
                <button class="btn primary lg mt4" type="button" data-save style="width:100%">${ic("check", 16)} Zapisz operację</button></div></div>
          </aside>
        </div>
        <div class="save-bar no-print"><div class="sb-info" id="sb-info"></div><button class="btn primary lg" type="button" data-save>${ic("check", 16)} Zapisz operację</button></div>`;
    },

    bind(page) {
      if (!App.can("op.create")) return;
      const form = $("#opf", page);
      $("#tut-toggle", page).onchange = e => { lsSet("riw.demo.tutorial", e.target.checked ? "1" : "0"); document.body.classList.toggle("no-tutorial", !e.target.checked); };
      $("#form-reset", page).onclick = async () => {
        const r = await Modal.confirm({ title: "Wyczyścić formularz?", text: "Wszystkie wpisane dane tej operacji zostaną usunięte.", ok: "Wyczyść", danger: true });
        if (r.ok) { this.reset(); this.rerender(); }
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
            const nice = el.dataset.bind === "production.chipRate" ? fmt(r.value, 2) : fmtQ(r.value, 3);
            if (nice !== el.value) { el.value = nice; setPath(this.draft, el.dataset.bind, nice); this.persist(); }
          }
        }
        this.refresh();
      });
      form.addEventListener("submit", e => { e.preventDefault(); this.save(); });
      form.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); this.save(); } });
      $$("[data-save]", page).forEach(b => b.onclick = () => this.save());
      this.refresh();
    },

    onEdit(e, isChange) {
      const el = e.target, d = this.draft;
      if (isChange && el.dataset) {
        if (el.dataset.type !== undefined) {
          if (!el.checked) { el.checked = true; return; }             // rodzaj operacji jest zawsze wybrany
          d.type = el.dataset.type;
          d.sale.enabled = false; d.production.enabled = false;
          if (d.type === "PRODUKCJA" && !d.production.rawProductId) d.production.rawProductId = "pr_drewno";
          if (!d.transport.placeTouched) d.transport.place = this.defaultPlace();
          this.touched = new Set(); this.showAll = false;
          this.persist(); this.rerender(); return;
        }
        if (el.dataset.mode !== undefined) {
          d.transport.mode = el.checked ? el.dataset.mode : "none";
          this.touched.add("transport.mode"); this.persist(); this.rerender(); return;
        }
        if (el.dataset.ton !== undefined) {
          d.transport.train.tonMode = el.dataset.ton;               // dwa tryby wykluczające się
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
      if (el.hasAttribute("data-struct") || key === "transport.train.wagonCount") this.rerender();
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
      if (key === "production.enabled" && !v) d.sale.enabled = false;
      if (key === "production.chipperId") { const c = R.byId(S.fleet.chippers, v); d.production.operatorId = c ? c.operatorId : ""; }
      if (key === "transport.own.vehicleId") { const veh = R.byId(S.fleet.vehicles, v); d.transport.own.driverId = veh ? veh.driverId : ""; }
      if (key === "transport.place") d.transport.placeTouched = true;
      if ((key === "sale.buyerId" || key === "sale.enabled" || key === "sale.direct") && !d.transport.placeTouched) d.transport.place = this.defaultPlace();
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

    /** Przeliczenie na żywo — podmienia wyłącznie teksty wynikowe, pola wejściowe zostają nietknięte. */
    refresh() {
      const form = $("#opf"); if (!form) return null;
      const S = Store.state, d = this.draft, cfg = S.config;
      const plan = this.plan = R.planOperation(S, d, App.ctx("Formularz „Nowa operacja”"));
      DBG.plan = plan;
      const n = plan.norm;
      const put = (key, html) => { const el = form.querySelector(`[data-calc="${key}"]`); if (el) el.innerHTML = html; };
      const out = (key, html) => { const el = form.querySelector(`[data-out="${key}"]`); if (el) el.innerHTML = html; };
      $$("[data-num]", form).forEach(el => {
        const c = form.querySelector(`[data-calc="${el.dataset.bind}"]`);
        const r = NumParse.parse(el.value);
        if (c) c.innerHTML = r.ok && el.value.trim() !== fmtQ(r.value, 3) && el.value.trim() !== fmt(r.value, 2) ? `odczytano: <b>${fmtQ(r.value, 3)}</b>` : "";
      });
      const add = (key, html) => { const el = form.querySelector(`[data-calc="${key}"]`); if (el && html) el.innerHTML = (el.innerHTML ? el.innerHTML + " · " : "") + html; };
      const qn = (q, pid) => App.qtyNative(q, pid);

      if (n.purchase) {
        const P = n.purchase, p = App.product(P.productId);
        if (P.qty !== null && p) add("purchase.qty", P.unit !== p.unit ? `= <b>${esc(qn(P.stockQty, p.id))}</b> na stanie${p.unit !== "t" ? ` · ${esc(App.mass(P.stockQty, p.id))}` : ""}` : (p.unit !== "t" ? esc(App.mass(P.stockQty, p.id)) : ""));
        if (P.qty !== null && P.price !== null) add("purchase.price", `${fmtQ(P.qty)} ${Units.label(P.unit)} × ${fmt(P.price)} zł`);
        out("purchase.cost", P.qty !== null && P.price !== null ? money(P.cost) : "—");
        out("purchase.weightAuto", P.qty !== null ? `${fmtQ(P.autoWeight)} t` : "—");
        if (P.qty !== null) add("purchase.weightManual", `orientacyjnie: ${fmtQ(P.autoWeight)} t — ilość na stanie się nie zmienia`);
      }
      if (n.production) {
        const X = n.production, outP = App.product(X.outProductId);
        add("production.type", `produkt wynikowy: <b>${esc(outP ? outP.name : "—")}</b>`);
        if (n.available) add("production.consumeQty", `dostępne: <b>${fmtQ(n.available.total)} ${Units.label(n.available.unit)}</b>${n.available.purchase ? ` (stan ${fmtQ(n.available.stock)} + zakup ${fmtQ(n.available.purchase)})` : ""}${X.maxMP !== null ? ` · = ${fmtQ(X.maxMP)} MP` : ""}`);
        if (X.mode === "direct" && X.maxMP !== null) add("production.rawQty", `= maks. ${fmtQ(X.maxMP)} MP zrębki · <b>nie pobiera ze stanu</b>`);
        out("production.stock", X.rawProductId ? esc(qn(n.available ? n.available.stock : Stock.balance(S, App.user().whId, X.rawProductId), X.rawProductId)) : "—");
        out("production.outMass", outP && X.outMP ? `${fmtQ(X.outMP)} MP ≈ ${fmt(Units.mass(X.outMP, outP, cfg), 1)} t` : "—");
        if (X.maxMP !== null) add("production.outMP", `maks. ${fmtQ(X.maxMP)} MP`);
        out("production.chipCost", money(X.chippingCost));
        add("production.chipCost", `${fmtQ(X.outMP)} MP × ${fmt(X.chipRate)} zł/MP`);
      }
      if (n.sale) {
        const Sa = n.sale, p = App.product(Sa.productId);
        out("sale.revenue", money(Sa.revenue));
        out("sale.weight", p ? (p.unit === "t" ? `${fmtQ(Sa.stockQty)} t` : `≈ ${fmt(Sa.weightT, 1)} t`) : "—");
        if (Sa.fromStock && p) {
          out("sale.onStock", esc(qn(Sa.onStock, p.id)));
          out("sale.after", `<span style="color:${Sa.after < 0 ? "var(--err)" : "inherit"}">${esc(qn(Sa.after, p.id))}</span>`);
          if (Sa.qty !== null && Sa.unit !== p.unit) add("sale.qty", `= ${esc(qn(Sa.stockQty, p.id))} ze stanu`);
          if (Sa.qty !== null && Sa.price !== null) add("sale.revenue", `${fmtQ(Sa.qty)} ${Units.label(Sa.unit)} × ${fmt(Sa.price)} zł`);
        } else {
          add("sale.qtyMP", `maks. <b>${fmtQ(n.production ? n.production.outMP : 0)} MP</b> (wynik produkcji)`);
          if (Sa.price !== null) add("sale.revenue", Sa.priceUnit === "t" ? `${fmtQ(Sa.weightT)} t × ${fmt(Sa.price)} zł/t` : `${fmtQ(Sa.qty)} MP × ${fmt(Sa.price)} zł/MP`);
        }
      }
      const T = n.transport;
      if (T.mode === "own") {
        out("transport.cost", money(T.cost));
        add("transport.cost", `${fmtQ(T.km)} km × ${fmt(T.rate)} zł/km${T.driverOverridden ? ` · <span style="color:var(--warn)">kierowca zmieniony tylko dla tego kursu</span>` : ""}`);
      } else if (T.mode === "external") {
        out("transport.cost", money(T.cost));
        add("transport.cost", T.includedInPrice ? "transport wliczony w cenę towaru" : "kwota frachtu");
      } else if (T.mode === "train") {
        out("train.sumT", `<b>${fmtQ(T.totalT)} t</b>`);
        const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
        out("train.summary", `<dl class="money-list" id="train-summary">
          ${row("Liczba wagonów", `${T.wagonCount}`)}
          ${T.capacity !== null ? row(`Łączna pojemność (${T.capUnit})`, `${T.wagonCount} × ${fmtQ(T.capacity)} = <b>${fmtQ(T.totalCapacity)} ${T.capUnit}</b>`) : ""}
          ${T.tonMode === "each" ? row("Tonaż wagonów", T.wagonT.length ? T.wagonT.map((t, i) => `${i + 1}: ${fmtQ(t)}`).join(" · ") + " t" : "—") : row("Tonaż wagonu", `${T.wagonCount} × ${fmtQ(T.wagonT[0] || 0)} t`)}
          ${row("Łączny tonaż składu", `<b data-train-total>${fmtQ(T.totalT)} t</b> <small class="dim">≈ ${fmtQ(T.totalMP)} MP</small>`)}
          ${row("Miejsce załadunku", esc(T.loadPlace || "—"))}
          ${row("Miejsce dostawy", esc(T.place || "—"))}
          ${row("Przewoźnik", esc(T.carrier || "—"))}
          ${row("Nr dokumentu", esc(T.docNo || "—"))}
          ${row("Koszt transportu", `<b data-train-cost>${money(T.cost)}</b> <small class="dim">(${fmtQ(T.basisQty)} ${Units.label(T.priceUnit)} × ${fmt(T.price)} zł)</small>`)}
        </dl>`);
      }

      $$("[data-msg]", form).forEach(m => {
        const key = m.dataset.msg, msg = plan.errors[key];
        const show = msg && (this.showAll || this.touched.has(key));
        m.classList.toggle("hidden", !show);
        m.innerHTML = show ? ic("alert", 13) + `<span>${esc(msg)}</span>` : "";
        const input = document.getElementById(fid(key));
        if (input) { input.classList.toggle("invalid", !!show); input.setAttribute("aria-invalid", show ? "true" : "false"); }
      });
      this.summary(plan);
      return plan;
    },

    summary(plan) {
      if (!$("#summary")) return;
      const name = id => (App.product(id) || {}).name || "—";
      const unitOf = id => Units.label((App.product(id) || {}).unit || "");
      const flow = plan.postings.map(p => `<li><span class="d">${p.doc}</span>
          <span>${p.step}. ${esc(R.KINDS[p.kind].label)}${p.direct ? " (bezpośrednio)" : ""} — ${esc(name(p.productId))}<br><small class="dim">stan ${esc(App.qtyNative(p.before, p.productId))} → ${esc(App.qtyNative(p.after, p.productId))}</small></span>
          <span class="q ${p.qty > 0 ? "plus" : "minus"}">${p.qty > 0 ? "+" : ""}${fmtQ(p.qty)} ${unitOf(p.productId)}</span></li>`).join("")
        + (plan.norm.transport.mode !== "none" ? `<li><span class="d">TR</span><span>${esc(R.TRANSPORT_MODES[plan.norm.transport.mode])} — ${esc(this.transportText(plan.norm.transport))}<br><small class="dim">koszt ${money(plan.norm.transport.cost)} · wpływ na stan: brak</small></span><span class="q zero">0</span></li>` : "");
      const bal = plan.balances.map(b => `<tr><td>${esc(name(b.productId))}</td><td class="r">${esc(App.qtyNative(b.before, b.productId))}</td><td class="r"><b>${esc(App.qtyNative(b.after, b.productId))}</b></td></tr>`).join("");
      const tt = plan.totals;
      const docs = plan.documents.map(dc => `<tr><td><span class="badge ${dc.type === "TR" ? "info" : dc.stock === "+" ? "ok" : "warn"}">${dc.type}</span></td>
          <td>${esc(dc.type === "TR" ? R.TRANSPORT_MODES[dc.transport.mode] : name(dc.productId))}${dc.partner ? `<br><small class="dim">${esc(dc.partner)}</small>` : ""}</td>
          <td class="r">${dc.qty !== null ? esc(fmtQ(dc.qty) + " " + Units.label(dc.unit)) : "—"}</td>
          <td class="r">${dc.value ? esc(money(dc.value)) : "—"}</td>
          <td>${esc(dc.place || "—")}</td><td class="c">${esc(dc.stock)}</td></tr>`).join("");
      const errs = plan.errorList, nErr = errs.length;
      const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
      set("sum-flow", flow ? `<ol class="flow" id="flow">${flow}</ol>` : `<p class="dim">Uzupełnij formularz, aby zobaczyć przebieg.</p>`);
      set("sum-bal-h", `Stan w magazynie ${esc(App.wh() ? App.wh().name : "")}`);
      set("sum-bal", bal ? `<div class="tbl-wrap"><table class="tbl" id="bal"><thead><tr><th>Produkt</th><th class="r">Przed</th><th class="r">Po operacji</th></tr></thead><tbody>${bal}</tbody></table></div>` : `<div class="card-b dim">—</div>`);
      set("sum-money", `<dl class="money-list" id="money">
          ${tt.purchaseCost ? `<dt>Koszt zakupu</dt><dd data-sum="purchase">${money(tt.purchaseCost)}</dd>` : ""}
          ${tt.rawCost ? `<dt>Koszt surowca z lasu</dt><dd data-sum="raw">${money(tt.rawCost)}</dd>` : ""}
          ${plan.norm.production ? `<dt>Koszt rąbania</dt><dd data-sum="chipping">${money(tt.chippingCost)}</dd>` : ""}
          <dt>Koszt transportu</dt><dd data-sum="transport">${money(tt.transportCost)}</dd>
          <dt>Przychód ze sprzedaży</dt><dd data-sum="revenue">${money(tt.revenue)}</dd>
          <dt class="total">Wynik operacji</dt><dd class="total" data-sum="result" style="color:${tt.result < 0 ? "var(--warn)" : "var(--ok)"}">${money(tt.result)}</dd></dl>`);
      set("sum-docs", docs ? `<div class="tbl-wrap"><table class="tbl" id="plan-docs"><thead><tr><th>Dok.</th><th>Treść</th><th class="r">Ilość</th><th class="r">Wartość</th><th>Miejsce transportu</th><th class="c">Stan</th></tr></thead><tbody>${docs}</tbody></table></div>` : `<div class="card-b dim">—</div>`);
      set("sum-badge", nErr ? `<span class="badge err">${nErr} ${nErr === 1 ? "błąd" : nErr < 5 ? "błędy" : "błędów"}</span>` : `<span class="badge ok">gotowe do zapisu</span>`);
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

    fieldLabel(key) {
      if (key.startsWith("transport.train.wagonT.")) return `Wagon ${+key.split(".").pop() + 1}: `;
      const box = document.querySelector(`[data-field="${key}"]`);
      const lab = box && box.querySelector(":scope > label, :scope > .lbl");
      const txt = lab ? lab.textContent.replace("*", "").replace(/\u00A0/g, " ").trim() : "";
      return txt ? txt + ": " : "";
    },

    transportText(t) {
      if (t.mode === "own") return [t.reg, t.driverName].filter(Boolean).join(" · ") || "uzupełnij pojazd";
      if (t.mode === "external") return [t.company, t.reg].filter(Boolean).join(" · ") || "uzupełnij przewoźnika";
      if (t.mode === "train") return [t.trainNo, `${t.wagonCount} wag.`, `${fmtQ(t.totalT)} t`].filter(Boolean).join(" · ");
      return "";
    },

    async save() {
      if (this.saving) return;
      this.showAll = true;
      const plan = this.refresh();
      if (!plan) return;
      if (!plan.ok) {
        Toast.err("Nie zapisano — popraw formularz", this.fieldLabel(plan.errorList[0].field) + plan.errorList[0].msg);
        const el = document.getElementById(fid(plan.errorList[0].field));
        if (el) { el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true }); }
        return;
      }
      this.saving = true;
      $$("[data-save]").forEach(b => { b.disabled = true; b.dataset.label = b.innerHTML; b.innerHTML = "Zapisywanie…"; });
      const draft = R.clone(this.draft), uid = App.user().id;
      const res = await Store.transact(s => R.commitOperation(s, draft, { user: R.byId(s.users, uid), today: App.today(), source: "Formularz „Nowa operacja”" }));
      this.saving = false;
      $$("[data-save]").forEach(b => { b.disabled = false; if (b.dataset.label) b.innerHTML = b.dataset.label; });
      if (!res || !res.ok) { Toast.err("Nie zapisano — nic nie zostało zaksięgowane", res ? res.error : "Nieznany błąd"); this.refresh(); return; }
      if (res.duplicate) Toast.info("Operacja była już zapisana", "Ochrona przed podwójnym zapisem — nie powstały nowe dokumenty.");
      else Toast.ok("Operacja zapisana", res.op.documents.map(x => x.no).join(" · "));
      const op = res.op, keepType = this.draft.type, keepDirect = this.draft.sale.direct;
      this.reset();
      this.draft.type = keepType; this.draft.sale.direct = keepDirect;
      if (keepType === "PRODUKCJA") this.draft.production.rawProductId = "pr_drewno";
      this.persist();
      App.render();
      const m = Modal.open({
        title: "Operacja zapisana", sub: `${R.OP_TYPES[op.type].label}${op.direct ? " — bezpośrednia" : ""} · ${op.documents.length} dok. · ${op.date}`,
        body: `<div class="tbl-wrap"><table class="tbl" id="saved-docs"><thead><tr><th>Dokument</th><th>Typ</th><th class="r">Ilość</th><th class="r">Wartość</th><th>Miejsce transportu</th></tr></thead><tbody>
          ${op.documents.map(x => `<tr><td class="mono">${esc(x.no)}</td><td>${esc(R.DOC_LABEL[x.type])}</td><td class="r">${x.qty !== null ? esc(fmtQ(x.qty) + " " + Units.label(x.unit)) : "—"}</td><td class="r">${x.value ? esc(money(x.value)) : "—"}</td><td>${esc(x.place)}</td></tr>`).join("")}
          </tbody></table></div>`,
        footer: `<a class="btn" href="#/dokumenty" data-close>Plan dokumentów</a><a class="btn" href="#/stany" data-close>Stany</a><button class="btn primary" type="button" data-close>Nowa operacja</button>`
      });
      $$("[data-close]", m.el).forEach(b => b.addEventListener("click", () => m.close()));
    }
  };

  /* ------------------------------------------------------------------ */
  /* Dokumenty — wspólne źródło dla planu i historii                     */
  /* ------------------------------------------------------------------ */
  function allDocuments(S, whId) {
    const rows = [];
    for (const op of S.operations) {
      if (whId && op.whId !== whId) continue;
      for (const d of op.documents) rows.push(Object.assign({}, d, { date: op.date, opId: op.id, opNo: op.no, opType: op.type, direct: op.direct, status: op.status, whId: op.whId, userName: op.userName }));
      if (op.storno) rows.push({ type: "KO", no: op.storno.no, date: op.storno.date, opId: op.id, opNo: op.no, status: "posted", whId: op.whId, productId: null, qty: null, unit: null, value: 0, partner: "", place: op.place, stock: "±", userName: op.storno.userName, note: `Storno ${op.no}: ${op.storno.reason}` });
    }
    const extra = new Map();
    for (const l of S.ledger) {
      if (whId && l.whId !== whId) continue;
      if (l.kind !== "BO" && l.kind !== "INW") continue;
      const r = extra.get(l.docNo) || { type: l.kind === "BO" ? "BO" : "IN", no: l.docNo, date: l.date, whId: l.whId, productId: null, qty: null, unit: null, value: 0, partner: "", place: (R.byId(S.warehouses, l.whId) || {}).name, stock: l.kind === "BO" ? "+" : "±", status: "posted", lines: 0 };
      r.lines++; extra.set(l.docNo, r);
    }
    rows.push(...extra.values());
    return rows.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.no).localeCompare(String(a.no)));
  }
  function docContent(d) {
    if (d.type === "TR") return `${R.TRANSPORT_MODES[d.transport.mode]} · ${Form.transportText(d.transport)}`;
    if (d.type === "KO") return d.note || "Korekta";
    if (d.type === "IN") return `Różnice inwentaryzacyjne (${d.lines} poz.)`;
    if (d.type === "BO") return `Bilans otwarcia (${d.lines} poz.)`;
    return ((App.product(d.productId) || {}).name || "—") + (d.meta && d.meta.direct ? " · bezpośrednio" : "");
  }
  const META_LABEL = { productionType: "Rodzaj produkcji", ndl: "Nadleśnictwo", lesnictwo: "Leśnictwo", kwit: "Nr kwitu wywozowego", sourceType: "Typ źródła", investSite: "Miejsce wycinki", sourceDoc: "Dokument źródłowy", chipRate: "Cena za rąbanie [zł/MP]", chippingCost: "Koszt rąbania [zł]", chipper: "Rębak", fromDoc: "Z dokumentu zużycia", direct: "Sprzedaż / produkcja bezpośrednia", rawInfo: "Surowiec z lasu (informacyjnie)" };
  function printDoc(d) {
    const S = Store.state, op = R.byId(S.operations, d.opId), wh = R.byId(S.warehouses, d.whId) || {};
    const rows = [];
    const add = (k, v) => { if (v !== undefined && v !== null && v !== "") rows.push(`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`); };
    add("Numer", d.no); add("Rodzaj", R.DOC_LABEL[d.type]); add("Data", d.date); add("Magazyn", wh.name); add("Miejsce transportu", d.place);
    if (d.productId) {
      const p = App.product(d.productId);
      add("Produkt", p.name);
      add("Ilość", `${fmtQ(d.qty)} ${Units.label(d.unit)}${d.unit !== p.unit ? ` (= ${fmtQ(d.stockQty)} ${Units.label(p.unit)})` : ""}`);
      if (p.unit !== "t" && d.weightT !== undefined) add("Masa", `${d.weightMode === "manual" ? "" : "≈ "}${fmtQ(d.weightT)} t${d.weightMode === "manual" ? " (waga rzeczywista)" : " (orientacyjnie)"}`);
    }
    if (d.partner) add(d.type === "PZ" ? "Dostawca" : "Odbiorca", d.partner);
    if (d.basis) add("Podstawa", R.BASIS[d.basis]);
    if (d.value) add(d.type === "PW" ? "Koszt rąbania" : "Wartość netto", money(d.value));
    if (d.meta) for (const [k, v] of Object.entries(d.meta)) add(META_LABEL[k] || k, typeof v === "number" ? fmt(v, 2) : v);
    if (d.transport) {
      const t = d.transport;
      add("Transport", R.TRANSPORT_MODES[t.mode]);
      if (t.mode === "own") { add("Pojazd", `${t.vehicleName} · ${t.reg}`); add("Kierowca kursu", t.driverName + (t.driverOverridden ? " (zmieniony dla kursu)" : "")); add("Trasa", `${fmtQ(t.km)} km × ${fmt(t.rate)} zł/km`); }
      if (t.mode === "external") { add("Przewoźnik", `${t.company} · ${t.reg}`); add("Odległość", `${fmtQ(t.km)} km`); add("Fracht", t.includedInPrice ? "wliczony w cenę" : money(t.freight)); }
      if (t.mode === "train") {
        add("Skład / przewoźnik", `${t.trainNo || "—"} · ${t.carrier || "—"}`); add("Nr dokumentu przewozowego", t.docNo); add("Miejsce załadunku", t.loadPlace);
        add("Liczba wagonów", t.wagonCount);
        if (t.capacity !== null) add("Łączna pojemność", `${fmtQ(t.totalCapacity)} ${t.capUnit}`);
        add("Tonaż wagonów", t.wagonT.map((x, i) => `${i + 1}: ${fmtQ(x)} t`).join(", "));
        add("Łączny tonaż składu", `${fmtQ(t.totalT)} t`);
        add("Stawka", `${fmtQ(t.basisQty)} ${Units.label(t.priceUnit)} × ${fmt(t.price)} zł`);
      }
      add("Koszt transportu", money(t.cost)); add("Wpływ na stan", "brak — transport nie zmienia stanu magazynowego");
    }
    if (op) { add("Operacja", `${op.no} · ${R.OP_TYPES[op.type].label}${op.direct ? " (bezpośrednia)" : ""}`); add("Wystawił", op.userName); if (op.status === "storno") add("Status", `Skorygowana dokumentem ${op.storno.no}`); }
    return `<div class="doc-print" id="doc-print"><h4>${esc(R.DOC_LABEL[d.type])} ${esc(d.no)}</h4><p style="color:#555;margin-bottom:12px">ResInvest Commodities · dokument demonstracyjny</p><table>${rows.join("")}</table></div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Ekrany                                                              */
  /* ------------------------------------------------------------------ */
  const Views = {};
  const TYPE_BADGE = o => o.type === "ZAKUP" ? `<span class="badge ok">zakup</span>${o.scope.includes("PRODUKCJA") ? ' <span class="badge brand">+ produkcja</span>' : ""}${o.scope.includes("SPRZEDAZ") ? ' <span class="badge gold">+ sprzedaż</span>' : ""}`
    : o.type === "PRODUKCJA" ? `<span class="badge brand">produkcja na magazynie</span>`
    : o.direct ? `<span class="badge gold">sprzedaż bezpośrednia</span>` : `<span class="badge gold">sprzedaż WZ</span>`;
  const opProduct = o => (App.product(o.type === "ZAKUP" ? o.purchase.productId : o.sale && o.sale.fromStock ? o.sale.productId : o.production ? (o.production.rawProductId && o.type === "PRODUKCJA" ? o.production.rawProductId : o.production.outProductId) : null) || {}).name || "—";
  const opQty = o => o.type === "ZAKUP" ? `${fmtQ(o.purchase.qty)} ${Units.label(o.purchase.unit)}`
    : o.type === "PRODUKCJA" ? `${fmtQ(o.production.consumeQty)} ${Units.label(o.production.consumeUnit)} → ${fmtQ(o.production.outMP)} MP`
    : o.direct ? `${fmtQ(o.production.outMP)} MP → ${fmtQ(o.sale.qty)} MP` : `${fmtQ(o.sale.qty)} ${Units.label(o.sale.unit)}`;

  /* ---------------------------- Pulpit ---------------------------- */
  Views.pulpit = {
    html() {
      const S = Store.state, wh = App.wh(), cfg = S.config;
      const ym = Dates.ym(App.today());
      const stock = Stock.byProduct(S, wh.id);
      const tot = { drewno: 0, zrebka: 0, agro: 0 }, mass = { drewno: 0, zrebka: 0 };
      for (const [pid, q] of stock) { const p = App.product(pid); if (!p) continue; tot[p.cat] += q; if (mass[p.cat] !== undefined) mass[p.cat] += Units.mass(q, p, cfg); }
      const sum = R.Reports.summary(S, wh.id, ym);
      const last = S.operations.filter(o => o.whId === wh.id).slice().sort((a, b) => a.createdAt < b.createdAt ? 1 : -1).slice(0, 8);
      const prevYm = Dates.ym(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 1)).toISOString());
      const per = y => { const p = R.Inventory.find(S, wh.id, y); return p ? `<span class="badge ${p.status === "OTWARTA" ? "warn" : "ok"}">${R.INV_STATUS[p.status]}</span>` : `<span class="badge">brak okresu</span>`; };
      const kpi = (t, v, unit, s) => `<div class="kpi"><div class="k-t">${esc(t)}</div><div class="k-v">${v}<u>${esc(unit)}</u></div>${s ? `<div class="k-s">${s}</div>` : ""}</div>`;
      const costs = sum.purchaseCost + sum.rawCost + sum.chippingCost + sum.transportCost;
      return `<div class="page-head"><div class="titles"><h2>Pulpit — ${esc(wh.name)}</h2><p>${esc(Dates.label(ym))} · ${esc(App.user().name)} (${esc(R.ROLES[App.user().role].label)})</p></div></div>
        <div class="quick" id="quick">
          <a class="qa" href="#/nowa?preset=zakup"><b>Zakup</b><span>dostawca → magazyn</span></a>
          <a class="qa" href="#/nowa?preset=wz"><b>Sprzedaż z magazynu</b><span>magazyn → odbiorca (WZ)</span></a>
          <a class="qa" href="#/nowa?preset=produkcja"><b>Produkcja na magazynie</b><span>surowiec ze stanu → zrębka</span></a>
          <a class="qa" href="#/nowa?preset=bezposrednia"><b>Produkcja + sprzedaż bezpośrednia</b><span>las → produkcja → odbiorca</span></a>
        </div>
        <div class="grid g6 mt4" id="kpis">
          ${kpi("Drewno na stanie", fmtQ(tot.drewno, 1), "m³", `≈ ${fmt(mass.drewno, 0)} t`)}
          ${kpi("Zrębka na stanie", fmtQ(tot.zrebka, 1), "MP", `≈ ${fmt(mass.zrebka, 0)} t`)}
          ${kpi("Produkty tonowe", fmtQ(tot.agro, 1), "t", "PKS, łupina nerkowca")}
          ${kpi("Operacje w miesiącu", String(sum.count), "", sum.storno ? `w tym korekty: ${sum.storno}` : "")}
          ${kpi("Przychód (miesiąc)", fmt(sum.revenue, 0), "zł", "")}
          ${kpi("Koszty (miesiąc)", fmt(costs, 0), "zł", `w tym rąbanie ${fmt(sum.chippingCost, 0)} zł`)}
        </div>
        <div class="grid mt4 dash-split">
          <div class="card"><div class="card-h"><h3>Ostatnie operacje</h3><span class="sub">${esc(wh.name)}</span><span class="spacer"></span><a class="btn sm" href="#/dokumenty">Plan dokumentów</a></div>
            ${last.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nr</th><th>Data</th><th>Rodzaj</th><th>Produkt</th><th class="r">Ilość</th><th class="r">Wynik</th><th>Miejsce transportu</th></tr></thead><tbody>
              ${last.map(o => `<tr class="${o.status !== "posted" ? "void" : ""}"><td class="mono nowrap">${esc(o.no)}</td><td class="nowrap">${esc(o.date)}</td><td>${TYPE_BADGE(o)}${o.status !== "posted" ? ' <span class="badge err">storno</span>' : ""}</td>
                <td>${esc(opProduct(o))}</td><td class="r">${esc(opQty(o))}</td><td class="r">${esc(money(o.totals.result))}</td><td>${esc(o.place)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Brak operacji.</div>`}</div>
          <div class="stack">
            <div class="card"><div class="card-h"><h3>Inwentaryzacja</h3><span class="spacer"></span><a class="btn sm" href="#/inwentaryzacja">Otwórz moduł</a></div>
              <div class="card-b stack" style="gap:10px">
                <div class="row"><span style="flex:1">${esc(Dates.label(ym))}</span>${per(ym)}</div>
                <div class="row"><span style="flex:1">${esc(Dates.label(prevYm))}</span>${per(prevYm)}</div>
                <p class="help">Poprzedni miesiąc zamyka się automatycznie na początku kolejnego miesiąca.</p></div></div>
            <div class="card"><div class="card-h"><h3>Jednostki i przeliczniki</h3></div><div class="card-b">
              <dl class="money-list"><dt>Drewno — jednostka</dt><dd>m³ (≈ ${fmt(cfg.woodTPerM3, 3)} t/m³)</dd><dt>Zrębka — jednostka</dt><dd>MP (≈ ${fmt(cfg.mp_t, 2)} t/MP)</dd><dt>PKS, łupina nerkowca</dt><dd>tylko t</dd><dt>1 m³ drewna → zrębka</dt><dd>${fmtQ(cfg.m3_mp)} MP</dd><dt>Cena za rąbanie (domyślna)</dt><dd>${fmt(cfg.chipRateDefault)} zł/MP</dd><dt>Transport własny</dt><dd>${fmt(cfg.kmRateDefault)} zł/km</dd></dl></div></div>
          </div>
        </div>`;
    }
  };

  /* ------------------------------ Nowa ------------------------------ */
  Views.nowa = {
    html(params) {
      Form.ensureDraft(params.preset);
      if (params.preset) history.replaceState(null, "", "#/nowa");
      return Form.html();
    },
    bind(page) { Form.bind(page); }
  };

  /* ------------------------------ Stany ----------------------------- */
  const CAT_LABEL = { drewno: "Drewno", zrebka: "Zrębka", agro: "Produkt tonowy" };
  Views.stany = {
    html() {
      const S = Store.state, cfg = S.config;
      const f = App.tabs.stany || (App.tabs.stany = { to: "", scope: "active" });
      const whs = f.scope === "all" ? S.warehouses : [App.wh()];
      const blocks = whs.map(wh => {
        const m = Stock.byProduct(S, wh.id, f.to || null);
        const rows = S.products.filter(p => m.has(p.id) && Math.abs(m.get(p.id)) > R.EPS);
        const perUnit = {};
        const body = rows.map(p => {
          const q = m.get(p.id) || 0;
          perUnit[p.unit] = R.round((perUnit[p.unit] || 0) + q, 3);
          return `<tr class="clickable" data-card="${esc(wh.id)}|${esc(p.id)}"><td><b>${esc(p.name)}</b><br><small class="dim">${esc(p.code)}</small></td>
            <td>${esc(CAT_LABEL[p.cat] || p.cat)}</td>
            <td class="r stock-q" data-native="${esc(p.id)}"><b>${esc(App.qtyNative(q, p.id))}</b></td>
            <td class="r dim" data-mass="${esc(p.id)}">${p.unit === "t" ? "—" : esc(App.mass(q, p.id))}</td>
            <td>${esc(Stock.lastMove(S, wh.id, p.id) || "—")}</td>
            <td class="r"><button class="btn sm" type="button">Kartoteka</button></td></tr>`;
        }).join("");
        const foot = Object.entries(perUnit).map(([u, q]) => `${fmtQ(q)} ${Units.label(u)}`).join(" · ");
        return `<div class="card mt4"><div class="card-h"><h3>${esc(wh.name)}</h3><span class="sub">${f.to ? "stan na " + esc(f.to) : "stan bieżący"}</span></div>
          ${rows.length ? `<div class="tbl-wrap"><table class="tbl" data-stock="${esc(wh.id)}"><thead><tr><th>Produkt</th><th>Kategoria</th><th class="r">Stan (jednostka magazynowa)</th><th class="r">Masa orientacyjna</th><th>Ostatni ruch</th><th></th></tr></thead>
            <tbody>${body}</tbody><tfoot><tr><td colspan="2">Razem wg jednostek</td><td class="r">${esc(foot)}</td><td colspan="3"></td></tr></tfoot></table></div>` : `<div class="empty">Brak stanów.</div>`}</div>`;
      }).join("");
      return `<div class="page-head"><div class="titles"><h2>Stany magazynowe</h2>
          <p>Stan w rzeczywistej jednostce magazynowej produktu: drewno m³, zrębka MP, PKS i łupina nerkowca t. Masa (≈ t) jest orientacyjna — ${fmt(cfg.mp_t, 2)} t/MP dla zrębki, ${fmt(cfg.woodTPerM3, 3)} t/m³ dla drewna — i nie zastępuje wagi rzeczywistej. Transport nie zmienia stanu.</p></div>
          <div class="actions"><button class="btn" type="button" id="stock-csv">${ic("dl", 15)} Eksport CSV</button></div></div>
        <div class="card"><div class="toolbar">
          <div class="field"><label for="st-to">Stan na dzień</label><input class="ctrl" type="date" id="st-to" value="${esc(f.to)}" max="${esc(App.today())}"></div>
          <div class="field"><label for="st-scope">Zakres</label><select class="ctrl" id="st-scope"><option value="active" ${f.scope === "active" ? "selected" : ""}>Aktywny magazyn</option><option value="all" ${f.scope === "all" ? "selected" : ""}>Wszystkie magazyny (podgląd)</option></select></div>
          <button class="btn ghost" type="button" id="st-clear">Stan bieżący</button></div></div>
        ${blocks}`;
    },
    bind(page) {
      const f = App.tabs.stany;
      $("#st-to", page).onchange = e => { f.to = e.target.value; App.render(); };
      $("#st-scope", page).onchange = e => { f.scope = e.target.value; App.render(); };
      $("#st-clear", page).onclick = () => { f.to = ""; App.render(); };
      $$("[data-card]", page).forEach(tr => tr.onclick = () => { const [w, p] = tr.dataset.card.split("|"); this.card(w, p); });
      $("#stock-csv", page).onclick = () => {
        const S = Store.state, rows = [];
        for (const wh of S.warehouses) for (const [pid, q] of Stock.byProduct(S, wh.id, f.to || null)) {
          const p = App.product(pid); if (!p || Math.abs(q) < R.EPS) continue;
          rows.push([wh.name, p.code, p.name, csvNum(q), Units.label(p.unit), p.unit === "t" ? "" : csvNum(Units.mass(q, p, S.config))]);
        }
        download(`stany_${f.to || App.today()}.csv`, toCSV(["Magazyn", "Kod", "Produkt", "Ilość", "Jednostka magazynowa", "Masa orientacyjna t"], rows), "text/csv;charset=utf-8");
      };
    },
    card(whId, pid) {
      const S = Store.state, p = App.product(pid), wh = R.byId(S.warehouses, whId);
      const rows = Stock.card(S, whId, pid);
      Modal.open({
        title: `Kartoteka: ${p.name}`, sub: `${wh.name} · jednostka magazynowa ${Units.label(p.unit)}`, wide: true,
        body: `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Dokument</th><th>Rodzaj</th><th class="r">Przychód</th><th class="r">Rozchód</th><th class="r">Saldo</th>${p.unit !== "t" ? '<th class="r">≈ t</th>' : ""}</tr></thead><tbody>
          ${rows.map(r => `<tr><td>${esc(r.date)}</td><td class="mono">${esc(r.docNo)}</td><td>${esc(R.KINDS[r.kind].label)}${r.direct ? " · bezpośrednio" : ""}</td>
            <td class="r">${r.qty > 0 ? esc(App.qtyNative(r.qty, pid)) : ""}</td><td class="r">${r.qty < 0 ? esc(App.qtyNative(-r.qty, pid)) : ""}</td>
            <td class="r"><b>${esc(App.qtyNative(r.balance, pid))}</b></td>${p.unit !== "t" ? `<td class="r dim">${fmt(Units.mass(r.balance, p, S.config), 1)}</td>` : ""}</tr>`).join("")}</tbody></table></div>`
      });
    }
  };

  /* ------------------------- Plan dokumentów ------------------------ */
  Views.dokumenty = {
    filtered() {
      const f = App.tabs.docs || (App.tabs.docs = { type: "", ym: "", q: "" });
      const q = f.q.trim().toLowerCase();
      return allDocuments(Store.state, App.user().whId).filter(d =>
        (!f.type || d.type === f.type) && (!f.ym || d.date.startsWith(f.ym)) &&
        (!q || [d.no, d.opNo, d.partner, d.place, docContent(d)].join(" ").toLowerCase().includes(q)));
    },
    html() {
      const f = App.tabs.docs || (App.tabs.docs = { type: "", ym: "", q: "" });
      const rows = this.filtered();
      const stockLbl = d => d.stock === "+" ? `<span class="badge ok">+ przychód</span>` : d.stock === "−" ? `<span class="badge warn">− rozchód</span>` : d.stock === "brak" ? `<span class="badge info">brak</span>` : `<span class="badge">± korekta</span>`;
      const firstOfOp = new Set();
      return `<div class="page-head"><div class="titles"><h2>Plan dokumentów</h2>
          <p>Dokumenty magazynu <b>${esc(App.wh().name)}</b>. Kolumna „Miejsce transportu” zastępuje dawne pole magazynu docelowego — stan zawsze księguje się w aktywnym magazynie.</p></div>
          <div class="actions"><button class="btn" type="button" id="docs-csv">${ic("dl", 15)} Eksport CSV</button></div></div>
        <div class="card">
          <div class="toolbar">
            <div class="field"><label for="d-type">Typ</label><select class="ctrl" id="d-type">${[["", "Wszystkie"], ["PZ", "PZ — zakup"], ["RW", "RW — zużycie"], ["PW", "PW — produkcja"], ["WZ", "WZ — sprzedaż"], ["TR", "TR — transport"], ["KO", "KO — korekta"], ["IN", "IN — inwentaryzacja"], ["BO", "BO — bilans otwarcia"]].map(([v, l]) => `<option value="${v}" ${f.type === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
            <div class="field"><label for="d-ym">Miesiąc</label><input class="ctrl" type="month" id="d-ym" value="${esc(f.ym)}"></div>
            <div class="field grow"><label for="d-q">Szukaj</label><input class="ctrl" type="search" id="d-q" value="${esc(f.q)}" placeholder="numer, kontrahent, miejsce…"></div>
          </div>
          ${rows.length ? `<div class="tbl-wrap"><table class="tbl" id="docs-table"><thead><tr><th>Nr dokumentu</th><th>Typ</th><th>Data</th><th>Treść</th><th class="r">Ilość</th><th class="r">Wartość</th><th>Kontrahent</th><th>Miejsce transportu</th><th>Wpływ na stan</th><th>Status</th><th></th></tr></thead><tbody>
            ${rows.map((d, i) => {
              const canStorno = d.opId && d.status === "posted" && d.type !== "KO" && d.type !== "TR" && !firstOfOp.has(d.opId) && App.can("op.storno");
              if (d.opId && d.type !== "TR" && d.type !== "KO") firstOfOp.add(d.opId);
              return `<tr class="${d.status !== "posted" ? "void" : ""}"><td class="mono nowrap">${esc(d.no)}</td><td><span class="badge">${d.type}</span></td><td class="nowrap">${esc(d.date)}</td>
              <td>${esc(docContent(d))}</td><td class="r">${d.qty !== null && d.qty !== undefined ? esc(fmtQ(d.qty) + " " + Units.label(d.unit)) : "—"}</td>
              <td class="r">${d.value ? esc(money(d.value)) : "—"}</td><td>${esc(d.partner || (d.transport && (d.transport.company || d.transport.carrier)) || "")}</td>
              <td>${esc(d.place || "—")}</td><td>${stockLbl(d)}</td>
              <td>${d.status === "posted" ? `<span class="badge ok">zaksięgowany</span>` : `<span class="badge err">skorygowany</span>`}</td>
              <td class="r nowrap"><button class="btn sm" type="button" data-view="${i}">Podgląd</button>${canStorno ? ` <button class="btn sm danger" type="button" data-storno="${esc(d.opId)}">Korekta</button>` : ""}</td></tr>`; }).join("")}
            </tbody></table></div>` : `<div class="empty">Brak dokumentów dla wybranych filtrów.</div>`}
        </div>
        <p class="help mt3">Korekta (storno) całej operacji tworzy dokument KO z bieżącą datą i odwraca zapisy w odwrotnej kolejności — historia dokumentów pozostaje nienaruszona.</p>`;
    },
    bind(page) {
      const f = App.tabs.docs, rows = this.filtered();
      $("#d-type", page).onchange = e => { f.type = e.target.value; App.render(); };
      $("#d-ym", page).onchange = e => { f.ym = e.target.value; App.render(); };
      $("#d-q", page).oninput = e => { f.q = e.target.value; clearTimeout(this._t); this._t = setTimeout(() => { App.render(); const q = $("#d-q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250); };
      $$("[data-view]", page).forEach(b => b.onclick = () => {
        const d = rows[+b.dataset.view];
        const m = Modal.open({ title: `${d.type} ${d.no}`, sub: R.DOC_LABEL[d.type], wide: true, body: printDoc(d),
          footer: `<button class="btn" type="button" data-print>${ic("print", 15)} Drukuj</button><button class="btn primary" type="button" data-ok>Zamknij</button>` });
        $("[data-ok]", m.el).onclick = () => m.close();
        $("[data-print]", m.el).onclick = () => {
          const w = root.open("", "_blank");
          if (!w) { Toast.warn("Okno wydruku zablokowane", "Zezwól na wyskakujące okna dla tego pliku."); return; }
          w.document.write(`<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><title>${esc(d.no)}</title><style>body{font:13px Arial,sans-serif;margin:32px;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:6px 8px;text-align:left}th{width:220px;background:#f3f3f3}<\/style></head><body>${printDoc(d)}<\/body><\/html>`);
          w.document.close(); w.focus(); w.print();
        };
      });
      $$("[data-storno]", page).forEach(b => b.onclick = async () => {
        const op = R.byId(Store.state.operations, b.dataset.storno);
        const r = await Modal.confirm({ title: `Korekta operacji ${op.no}`, text: `Zostaną odwrócone wszystkie zapisy magazynowe operacji (${op.documents.map(x => x.no).join(", ")}). Korekta ma bieżącą datę.`, ok: "Wykonaj korektę", danger: true, input: { label: "Przyczyna korekty", placeholder: "np. błędna ilość", required: true } });
        if (!r.ok) return;
        const uid = App.user().id;
        const res = await Store.transact(s => R.stornoOperation(s, op.id, { user: R.byId(s.users, uid), today: App.today(), source: "Plan dokumentów — korekta" }, r.value));
        if (res.ok) Toast.ok("Korekta zapisana", res.no); else Toast.err("Korekta odrzucona", res.error);
        App.render();
      });
      $("#docs-csv", page).onclick = () => download(`plan_dokumentow_${App.today()}.csv`, toCSV(
        ["Nr dokumentu", "Typ", "Data", "Treść", "Ilość", "Jednostka", "Wartość zł", "Kontrahent", "Miejsce transportu", "Wpływ na stan", "Status"],
        rows.map(d => [d.no, d.type, d.date, docContent(d), csvNum(d.qty), d.unit ? Units.label(d.unit) : "", csvNum(d.value), d.partner || "", d.place || "", d.stock, d.status])), "text/csv;charset=utf-8");
    }
  };

  /* -------------------------- Inwentaryzacja ------------------------ */
  Views.inwentaryzacja = {
    html() {
      const S = Store.state, wh = App.wh();
      const list = S.inventory.filter(p => p.whId === wh.id).sort((a, b) => a.ym < b.ym ? 1 : -1);
      const sel = App.tabs.inv && list.find(p => p.ym === App.tabs.inv) ? App.tabs.inv : (list[0] ? list[0].ym : null);
      App.tabs.inv = sel;
      const p = sel ? R.Inventory.find(S, wh.id, sel) : null;
      const locked = R.lockedMonth(S, wh.id);
      let detail = `<div class="card"><div class="empty">Otwórz okres, aby rozpocząć spis.</div></div>`;
      if (p) {
        const closed = p.status !== "OTWARTA";
        const rows = p.lines.map(l => {
          const pr = App.product(l.productId), has = l.countQty !== null;
          const diff = has ? R.round(l.countQty - l.bookQty, 3) : null;
          return `<tr data-line="${esc(l.productId)}"><td><b>${esc(pr.name)}</b></td><td>${Units.label(l.unit)}</td><td class="r">${fmtQ(l.bookQty)}</td>
            <td class="r" style="min-width:150px">${closed ? `<b>${has ? fmtQ(l.countQty) : "—"}</b>${l.assumed ? ' <span class="badge warn">przyjęto stan księgowy</span>' : ""}`
              : `<input class="ctrl num-in" type="text" inputmode="decimal" data-count="${esc(l.productId)}" aria-label="Stan ze spisu: ${esc(pr.name)}" value="${esc(has ? (l.countText || fmtQ(l.countQty)) : "")}" placeholder="wpisz stan">`}</td>
            <td class="r" data-diff="${esc(l.productId)}" style="color:${diff === null ? "inherit" : diff < 0 ? "var(--err)" : diff > 0 ? "var(--info)" : "var(--ok)"}">${diff === null ? "—" : (diff > 0 ? "+" : "") + fmtQ(diff) + " " + Units.label(l.unit)}</td>
            <td class="r dim">${diff === null || l.unit === "t" ? "—" : "≈ " + fmt(Units.mass(diff, pr, S.config), 2) + " t"}</td></tr>`;
        }).join("");
        detail = `<div class="card" id="inv-detail" data-status="${esc(p.status)}">
          <div class="card-h"><h3>Okres ${esc(p.ym)}</h3><span class="badge ${closed ? "ok" : "warn"}" id="inv-status">${R.INV_STATUS[p.status]}</span>
            <span class="sub">${esc(Dates.label(p.ym))} · stan księgowy na ${esc(p.cutoff || R.Inventory.cutoff(p.ym, App.today()))}</span><span class="spacer"></span>
            ${closed ? "" : `<button class="btn" type="button" id="inv-gen">${ic("layers", 15)} ${p.lines.length ? "Odśwież listę" : "Generuj listę"}</button>
              <button class="btn primary" type="button" id="inv-close" ${App.can("inv.close") ? "" : "disabled title=\"Wymaga roli Kierownik lub Administrator\""}>${ic("check", 15)} Zamknij okres</button>`}</div>
          ${closed ? `<div class="card-b" style="padding-bottom:0"><div class="info-line ok">${ic("check", 15)}<span>Okres zamknięty ${esc((p.closedAt || "").slice(0, 16).replace("T", " "))} przez ${esc(p.closedBy)}. ${p.docNo ? `Różnice zaksięgowano dokumentem <b>${esc(p.docNo)}</b>.` : "Brak różnic."} Formularz tylko do odczytu; operacje z datą do ${esc(p.ym)} włącznie są zablokowane.</span></div></div>` : ""}
          ${p.lines.length ? `<div class="tbl-wrap mt3"><table class="tbl" id="inv-table"><thead><tr><th>Produkt</th><th>Jedn.</th><th class="r">Stan księgowy</th><th class="r">Stan ze spisu</th><th class="r">Różnica</th><th class="r">Różnica masy</th></tr></thead><tbody>${rows}</tbody></table></div>`
            : `<div class="empty">Lista jest pusta — kliknij „Generuj listę”, aby pobrać pozycje ze stanu księgowego.</div>`}
          ${!closed ? `<div class="card-b"><p class="help">Wpisz stan z natury w jednostce magazynowej produktu (drewno m³, zrębka MP, produkty tonowe t). Enter lub Tab zapisuje pozycję. Zamknięcie księguje różnice dokumentem IN i blokuje okres.</p></div>` : ""}
        </div>`;
      }
      return `<div class="page-head"><div class="titles"><h2>Inwentaryzacja miesięczna</h2>
          <p>Magazyn <b>${esc(wh.name)}</b>. Każdy miesiąc to osobny okres: OTWARTA → ZAMKNIĘTA. Po zamknięciu okres jest tylko do odczytu, a poprzedni miesiąc zamyka się automatycznie na początku kolejnego.${locked ? ` Zamknięte do: <b>${esc(locked)}</b>.` : ""}</p></div></div>
        <div class="grid inv-grid" id="inv-grid">
          <div class="stack">
            <div class="card"><div class="card-h"><h3>Otwórz okres</h3></div><div class="card-b">
              <div class="field"><label for="inv-ym">Miesiąc</label><input class="ctrl" type="month" id="inv-ym" value="${esc(Dates.ym(App.today()))}" max="${esc(Dates.ym(App.today()))}"></div>
              <button class="btn primary mt3" type="button" id="inv-open" style="width:100%" ${App.can("inv.open") ? "" : "disabled"}>Otwórz okres</button></div></div>
            <div class="card"><div class="card-h"><h3>Okresy</h3></div>
              ${list.length ? `<div class="tbl-wrap"><table class="tbl" id="inv-list"><tbody>${list.map(x => `<tr class="clickable ${x.ym === sel ? "sel" : ""}" data-ym="${esc(x.ym)}"><td><b>${esc(x.ym)}</b><br><small class="dim">${esc(Dates.label(x.ym))}</small></td><td class="r"><span class="badge ${x.status === "OTWARTA" ? "warn" : "ok"}">${R.INV_STATUS[x.status]}</span>${x.auto ? '<br><small class="dim">automatycznie</small>' : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Brak okresów.</div>`}
            </div>
          </div>
          <div>${detail}</div>
        </div>`;
    },
    bind(page) {
      const act = (fn, okMsg) => Store.transact(s => fn(s, { user: R.byId(s.users, App.user().id), today: App.today(), source: "Moduł Inwentaryzacja" }))
        .then(res => { if (res.ok) { if (okMsg) Toast.ok(okMsg(res)); } else Toast.err("Odrzucono", res.error); App.render(); return res; });
      $("#inv-open", page).onclick = () => { const ym = $("#inv-ym", page).value; act((s, c) => R.Inventory.open(s, ym, c), () => `Otwarto okres ${ym}`).then(r => { if (r.ok) { App.tabs.inv = ym; App.render(); } }); };
      $$("[data-ym]", page).forEach(tr => tr.onclick = () => { App.tabs.inv = tr.dataset.ym; App.render(); });
      const ym = App.tabs.inv;
      const gen = $("#inv-gen", page);
      if (gen) gen.onclick = () => act((s, c) => R.Inventory.generate(s, ym, c), r => `Lista spisowa: ${r.period.lines.length} pozycji`);
      const cl = $("#inv-close", page);
      if (cl) cl.onclick = async () => {
        const r = await Modal.confirm({ title: `Zamknąć okres ${ym}?`, text: "Różnice zostaną zaksięgowane dokumentem IN, a okres przejdzie w tryb tylko do odczytu. Operacje z datą w tym okresie zostaną zablokowane. Tej czynności nie można cofnąć.", ok: "Zamknij okres", danger: true });
        if (r.ok) act((s, c) => R.Inventory.close(s, ym, c), res => `Okres ${ym} zamknięty` + (res.docNo ? ` · ${res.docNo}` : ""));
      };
      $$("[data-count]", page).forEach(inp => {
        const commit = () => {
          const pid = inp.dataset.count;
          const line = R.Inventory.find(Store.state, App.user().whId, ym).lines.find(l => l.productId === pid);
          if ((line.countText || "") === inp.value.trim() && (line.countQty !== null || !inp.value.trim())) return;
          const r = NumParse.parse(inp.value);
          if (inp.value.trim() && !r.ok) { inp.classList.add("invalid"); Toast.err("Niepoprawna liczba", r.error); return; }
          inp.classList.remove("invalid");
          const ae = document.activeElement;
          const next = ae && ae.dataset && ae.dataset.count ? ae.dataset.count : null;
          act((s, c) => R.Inventory.setCount(s, ym, pid, inp.value, c)).then(() => {
            const el = next && document.querySelector(`[data-count="${next}"]`);
            if (el) { el.focus(); el.select(); }
          });
        };
        inp.addEventListener("change", commit);
        inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
      });
    }
  };

  /* ------------------------------ Flota ----------------------------- */
  Views.flota = {
    html() {
      const S = Store.state;
      const tab = App.tabs.fleet || "vehicles";
      const drv = id => (R.byId(S.fleet.drivers, id) || {}).name || "—";
      const opr = id => (R.byId(S.fleet.operators, id) || {}).name || "—";
      const runs = S.operations.filter(o => o.transport && o.transport.mode === "own");
      const prods = S.operations.filter(o => o.production && o.production.chipperId);
      const st = s => `<span class="badge ${s === "aktywny" ? "ok" : s === "serwis" ? "warn" : ""}">${esc(R.ASSET_STATUS[s] || s)}</span>`;
      const edit = App.can("fleet.edit");
      const btn = (kind, id) => edit ? `<button class="btn sm" type="button" data-edit="${kind}|${esc(id)}">${ic("edit", 13)} Edytuj</button>${kind === "drivers" || kind === "operators" ? ` <button class="btn sm danger" type="button" data-del="${kind}|${esc(id)}">${ic("trash", 13)}</button>` : ""}` : "";
      let body = "";
      if (tab === "vehicles") body = `<table class="tbl" id="fleet-table"><thead><tr><th>Nazwa</th><th>Rejestracja</th><th>Typ</th><th>Status</th><th>Kierowca domyślny</th><th class="r">Kursy</th><th></th></tr></thead><tbody>
        ${S.fleet.vehicles.map(v => `<tr><td><b>${esc(v.name)}</b></td><td class="mono">${esc(v.reg)}</td><td>${esc(R.VEHICLE_TYPES[v.type])}</td><td>${st(v.status)}</td><td>${esc(drv(v.driverId))}</td><td class="r">${runs.filter(o => o.transport.vehicleId === v.id).length}</td><td class="r">${btn("vehicles", v.id)}</td></tr>`).join("")}</tbody></table>`;
      if (tab === "drivers") body = `<table class="tbl" id="fleet-table"><thead><tr><th>Imię i nazwisko</th><th>Telefon</th><th>Domyślny w pojazdach</th><th class="r">Kursy</th><th></th></tr></thead><tbody>
        ${S.fleet.drivers.map(d => `<tr><td><b>${esc(d.name)}</b></td><td>${esc(d.phone || "")}</td><td>${esc(S.fleet.vehicles.filter(v => v.driverId === d.id).map(v => v.reg).join(", ") || "—")}</td><td class="r">${runs.filter(o => o.transport.driverId === d.id).length}</td><td class="r">${btn("drivers", d.id)}</td></tr>`).join("")}</tbody></table>`;
      if (tab === "chippers") body = `<table class="tbl" id="fleet-table"><thead><tr><th>Rębak</th><th>Status</th><th>Operator domyślny</th><th class="r">Produkcje</th><th></th></tr></thead><tbody>
        ${S.fleet.chippers.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${st(c.status)}</td><td>${esc(opr(c.operatorId))}</td><td class="r">${prods.filter(o => o.production.chipperId === c.id).length}</td><td class="r">${btn("chippers", c.id)}</td></tr>`).join("")}</tbody></table>`;
      if (tab === "operators") body = `<table class="tbl" id="fleet-table"><thead><tr><th>Operator</th><th>Telefon</th><th>Domyślny przy rębakach</th><th></th></tr></thead><tbody>
        ${S.fleet.operators.map(o => `<tr><td><b>${esc(o.name)}</b></td><td>${esc(o.phone || "")}</td><td>${esc(S.fleet.chippers.filter(c => c.operatorId === o.id).map(c => c.name).join(", ") || "—")}</td><td class="r">${btn("operators", o.id)}</td></tr>`).join("")}</tbody></table>`;
      const lastRuns = runs.slice().sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 10);
      const labels = { vehicles: "Samochody / ruchome podłogi", drivers: "Kierowcy", chippers: "Rębaki", operators: "Operatorzy rębaków" };
      return `<div class="page-head"><div class="titles"><h2>Flota</h2><p>Transport własny w „Nowej operacji” korzysta z tej listy. Każdy pojazd ma kierowcę domyślnego; kurs zapisuje kierowcę wybranego dla konkretnego kursu — późniejsza zmiana kierowcy domyślnego nie zmienia historii.</p></div>
          <div class="actions">${edit ? `<button class="btn primary" type="button" id="fleet-add">${ic("plus", 15)} Dodaj: ${esc(R.Fleet.KINDS[tab].label.toLowerCase())}</button>` : `<span class="badge">tylko podgląd — edycja: Kierownik / Administrator</span>`}</div></div>
        <div class="tabs" role="tablist">${Object.entries(labels).map(([k, l]) => `<button class="tab" type="button" role="tab" aria-selected="${k === tab}" data-tab="${k}">${esc(l)}</button>`).join("")}</div>
        <div class="card"><div class="tbl-wrap">${body}</div></div>
        <div class="card mt4"><div class="card-h"><h3>Ostatnie kursy transportu własnego</h3><span class="sub">kierowca zapisany w chwili kursu</span></div>
          ${lastRuns.length ? `<div class="tbl-wrap"><table class="tbl" id="runs-table"><thead><tr><th>Data</th><th>Dokument</th><th>Pojazd</th><th>Kierowca kursu</th><th class="r">km</th><th class="r">Koszt</th><th>Miejsce transportu</th></tr></thead><tbody>
            ${lastRuns.map(o => { const t = o.transport; const tr = o.documents.find(x => x.type === "TR"); return `<tr><td>${esc(o.date)}</td><td class="mono">${esc(tr ? tr.no : "")}</td><td>${esc(t.vehicleName)} · <span class="mono">${esc(t.reg)}</span></td><td>${esc(t.driverName)}${t.driverOverridden ? ' <span class="badge warn">zmieniony dla kursu</span>' : ""}</td><td class="r">${fmtQ(t.km)}</td><td class="r">${esc(money(t.cost))}</td><td>${esc(o.place)}</td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">Brak kursów.</div>`}</div>`;
    },
    bind(page) {
      $$("[data-tab]", page).forEach(b => b.onclick = () => { App.tabs.fleet = b.dataset.tab; App.render(); });
      const add = $("#fleet-add", page);
      if (add) add.onclick = () => this.edit(App.tabs.fleet || "vehicles", null);
      $$("[data-edit]", page).forEach(b => b.onclick = () => { const [k, id] = b.dataset.edit.split("|"); this.edit(k, id); });
      $$("[data-del]", page).forEach(b => b.onclick = async () => {
        const [k, id] = b.dataset.del.split("|");
        const rec = R.byId(Store.state.fleet[k], id);
        const r = await Modal.confirm({ title: `Usunąć: ${rec.name}?`, text: "Historyczne kursy zachowają zapisane nazwisko.", ok: "Usuń", danger: true });
        if (!r.ok) return;
        const res = await Store.transact(s => R.Fleet.remove(s, k, id, { user: R.byId(s.users, App.user().id), today: App.today(), source: "Moduł Flota" }));
        if (res.ok) Toast.ok("Usunięto", rec.name); else Toast.err("Nie usunięto", res.error);
        App.render();
      });
    },
    edit(kind, id) {
      const S = Store.state;
      const rec = id ? R.clone(R.byId(S.fleet[kind], id)) : { name: "", reg: "", type: "ruchoma_podloga", status: "aktywny", driverId: "", operatorId: "", phone: "" };
      const o = (arr, v) => arr.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? "selected" : ""}>${esc(l)}</option>`).join("");
      const f = (k, label, ctrl, help) => `<div class="field" data-ff="${k}"><label for="fe-${k}">${esc(label)}</label>${ctrl}<div class="msg hidden" data-fmsg="${k}"></div>${help ? `<div class="help">${help}</div>` : ""}</div>`;
      let body = f("name", kind === "vehicles" ? "Nazwa pojazdu" : kind === "chippers" ? "Nazwa rębaka" : "Imię i nazwisko", `<input class="ctrl" id="fe-name" value="${esc(rec.name)}">`, kind === "vehicles" ? "np. Scania R450 — ruchoma podłoga" : "");
      if (kind === "vehicles") {
        body += f("reg", "Numer rejestracyjny", `<input class="ctrl" id="fe-reg" value="${esc(rec.reg)}" placeholder="np. SGL 4T821">`);
        body += f("type", "Typ", `<select class="ctrl" id="fe-type">${o(Object.entries(R.VEHICLE_TYPES), rec.type)}</select>`);
        body += f("status", "Status", `<select class="ctrl" id="fe-status">${o(Object.entries(R.ASSET_STATUS), rec.status)}</select>`, "Pojazdów nie usuwa się — wycofany pojazd zostaje w historii kursów.");
        body += f("driverId", "Kierowca domyślny", `<select class="ctrl" id="fe-driverId"><option value="">— wybierz —</option>${o(S.fleet.drivers.map(d => [d.id, d.name]), rec.driverId)}</select>`, "Zmiana dotyczy przyszłych kursów. Zapisane kursy zachowują swojego kierowcę.");
      }
      if (kind === "chippers") {
        body += f("status", "Status", `<select class="ctrl" id="fe-status">${o(Object.entries(R.ASSET_STATUS), rec.status)}</select>`);
        body += f("operatorId", "Operator domyślny", `<select class="ctrl" id="fe-operatorId"><option value="">— wybierz —</option>${o(S.fleet.operators.map(d => [d.id, d.name]), rec.operatorId)}</select>`);
      }
      if (kind === "drivers" || kind === "operators") body += f("phone", "Telefon", `<input class="ctrl" id="fe-phone" value="${esc(rec.phone || "")}" inputmode="tel">`);
      const m = Modal.open({ title: `${id ? "Edycja" : "Nowy"}: ${R.Fleet.KINDS[kind].label.toLowerCase()}`, body: `<div class="stack">${body}</div>`,
        footer: `<button class="btn ghost" type="button" data-no>Anuluj</button><button class="btn primary" type="button" data-yes>Zapisz</button>` });
      $("[data-no]", m.el).onclick = () => m.close();
      $("[data-yes]", m.el).onclick = async () => {
        const next = Object.assign({}, rec, { id: id || undefined });
        for (const k of R.Fleet.KINDS[kind].fields) { const el = $("#fe-" + k, m.el); if (el) next[k] = el.value; }
        const res = await Store.transact(s => R.Fleet.save(s, kind, next, { user: R.byId(s.users, App.user().id), today: App.today(), source: "Moduł Flota" }));
        $$("[data-fmsg]", m.el).forEach(x => x.classList.add("hidden"));
        if (!res.ok) {
          for (const [k, msg] of Object.entries(res.errors || {})) { const x = $(`[data-fmsg="${k}"]`, m.el); if (x) { x.textContent = msg; x.classList.remove("hidden"); } }
          Toast.err("Nie zapisano", res.error); return;
        }
        m.close(); Toast.ok("Zapisano", res.rec.name); App.render();
      };
    }
  };

  /* ----------------------------- Historia --------------------------- */
  const periodOptions = (S, cur, withAll = true) => {
    const set = new Set([Dates.ym(App.today()), App.today().slice(0, 4)]);
    for (const o of S.operations) { set.add(o.date.slice(0, 4)); set.add(o.date.slice(0, 7)); }
    for (const a of S.audit) { set.add(a.ts.slice(0, 4)); set.add(a.ts.slice(0, 7)); }
    const years = [...set].filter(x => x.length === 4).sort().reverse();
    const months = [...set].filter(x => x.length === 7).sort().reverse();
    return `${withAll ? '<option value="">Cały okres</option>' : ""}<optgroup label="Lata">${years.map(y => `<option value="${y}" ${y === cur ? "selected" : ""}>Rok ${y}</option>`).join("")}</optgroup>
      <optgroup label="Miesiące">${months.map(m => `<option value="${m}" ${m === cur ? "selected" : ""}>${esc(Dates.label(m))}</option>`).join("")}</optgroup>`;
  };
  Views.historia = {
    html() {
      const S = Store.state;
      const f = App.tabs.hist || (App.tabs.hist = { tab: "audit", period: "", from: "", to: "", user: "", entity: "", q: "", opType: "" });
      const tabs = [["audit", "Dziennik zmian"], ["ops", "Rejestr operacji"], ["report", "Raport miesięczny / roczny"]];
      let body = "";
      if (f.tab === "audit") {
        const rows = this.auditRows();
        body = `<div class="card"><div class="toolbar">
            <div class="field"><label for="h-period">Okres</label><select class="ctrl" id="h-period">${periodOptions(S, f.period)}</select></div>
            <div class="field"><label for="h-from">Od</label><input class="ctrl" type="date" id="h-from" value="${esc(f.from)}"></div>
            <div class="field"><label for="h-to">Do</label><input class="ctrl" type="date" id="h-to" value="${esc(f.to)}"></div>
            <div class="field"><label for="h-user">Użytkownik</label><select class="ctrl" id="h-user"><option value="">Wszyscy</option><option value="system" ${f.user === "system" ? "selected" : ""}>System</option>${S.users.map(u => `<option value="${esc(u.id)}" ${f.user === u.id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
            <div class="field"><label for="h-entity">Obszar</label><select class="ctrl" id="h-entity">${[["", "Wszystkie"], ["operation", "Operacje"], ["inventory", "Inwentaryzacja"], ["fleet", "Flota"], ["ledger", "Księga / bilans"], ["system", "System"]].map(([v, l]) => `<option value="${v}" ${f.entity === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
            <div class="field grow"><label for="h-q">Szukaj</label><input class="ctrl" type="search" id="h-q" value="${esc(f.q)}" placeholder="numer, akcja, źródło…"></div>
            <button class="btn" type="button" id="h-csv">${ic("dl", 15)} CSV</button></div>
          ${rows.length ? `<div class="tbl-wrap"><table class="tbl" id="audit-table"><thead><tr><th>Czas</th><th>Użytkownik</th><th>Obiekt</th><th>Akcja</th><th>Źródło</th><th>Stan przed / po</th></tr></thead><tbody>
            ${rows.slice(0, 400).map(a => `<tr><td class="nowrap">${esc(a.ts.slice(0, 19).replace("T", " "))}</td><td>${esc(a.userName)}</td><td class="mono">${esc(a.opNo || a.entityId || "")}</td><td>${esc(a.action)}</td><td>${esc(a.source)}</td>
              <td><details class="audit"><summary>pokaż</summary><div class="grid g2 mt2"><div><small class="dim">Przed</small><pre class="json">${esc(JSON.stringify(a.before, null, 1))}</pre></div><div><small class="dim">Po</small><pre class="json">${esc(JSON.stringify(a.after, null, 1))}</pre></div></div></details></td></tr>`).join("")}
            </tbody></table></div><div class="toolbar" style="border:0"><span class="dim">${rows.length} wpisów${rows.length > 400 ? " (pokazano 400 najnowszych — zawęź filtr lub pobierz CSV)" : ""}</span></div>` : `<div class="empty">Brak wpisów dla filtrów.</div>`}</div>`;
      } else if (f.tab === "ops") {
        const rows = this.opRows();
        const posted = rows.filter(o => o.status === "posted");
        const t = k => posted.reduce((a, o) => a + (o.totals[k] || 0), 0);
        body = `<div class="card"><div class="toolbar">
            <div class="field"><label for="h-period">Okres</label><select class="ctrl" id="h-period">${periodOptions(S, f.period)}</select></div>
            <div class="field"><label for="h-optype">Rodzaj</label><select class="ctrl" id="h-optype">${[["", "Wszystkie"], ["ZAKUP", "Zakup"], ["SPRZEDAZ", "Sprzedaż (WZ i bezpośrednia)"], ["PRODUKCJA", "Produkcja na magazynie"]].map(([v, l]) => `<option value="${v}" ${f.opType === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
            <div class="field grow"><label for="h-q">Szukaj</label><input class="ctrl" type="search" id="h-q" value="${esc(f.q)}" placeholder="numer, kontrahent, miejsce…"></div>
            <button class="btn" type="button" id="h-csv">${ic("dl", 15)} CSV</button></div>
          ${rows.length ? `<div class="tbl-wrap"><table class="tbl" id="ops-table"><thead><tr><th>Nr</th><th>Data</th><th>Rodzaj</th><th>Użytkownik</th><th>Produkt</th><th class="r">Ilość</th><th class="r">Zakup</th><th class="r">Rąbanie</th><th class="r">Transport</th><th class="r">Przychód</th><th>Miejsce transportu</th><th>Status</th></tr></thead><tbody>
            ${rows.map(o => `<tr class="${o.status !== "posted" ? "void" : ""}"><td class="mono nowrap">${esc(o.no)}</td><td class="nowrap">${esc(o.date)}</td><td>${TYPE_BADGE(o)}</td><td>${esc(o.userName)}</td><td>${esc(opProduct(o))}</td>
              <td class="r">${esc(opQty(o))}</td><td class="r">${esc(money(o.totals.purchaseCost + (o.totals.rawCost || 0)))}</td><td class="r">${esc(money(o.totals.chippingCost || 0))}</td><td class="r">${esc(money(o.totals.transportCost))}</td><td class="r">${esc(money(o.totals.revenue))}</td><td>${esc(o.place)}</td>
              <td>${o.status === "posted" ? '<span class="badge ok">zaksięgowana</span>' : `<span class="badge err">storno ${esc(o.storno.no)}</span>`}</td></tr>`).join("")}</tbody>
            <tfoot><tr><td colspan="6">Razem (bez korekt)</td><td class="r">${esc(money(t("purchaseCost") + t("rawCost")))}</td><td class="r">${esc(money(t("chippingCost")))}</td><td class="r">${esc(money(t("transportCost")))}</td><td class="r">${esc(money(t("revenue")))}</td><td colspan="2"></td></tr></tfoot></table></div>` : `<div class="empty">Brak operacji w okresie.</div>`}</div>`;
      } else {
        const period = f.period || Dates.ym(App.today());
        const whId = App.user().whId;
        const rep = R.Reports.summary(S, whId, period);
        const end = period.length === 4 ? `${period}-12-31` : Dates.monthEnd(period);
        const months = period.length === 4 ? Array.from({ length: 12 }, (_, i) => `${period}-${String(i + 1).padStart(2, "0")}`).map(m => R.Reports.summary(S, whId, m)).filter(x => x.count || x.byProduct.length) : [];
        body = `<div class="card"><div class="toolbar">
            <div class="field"><label for="h-period">Okres raportu</label><select class="ctrl" id="h-period">${periodOptions(S, period, false)}</select></div>
            <button class="btn" type="button" id="h-print">${ic("print", 15)} Drukuj</button></div>
          <div class="card-b"><div class="grid g6" id="report-kpis">
            <div class="kpi"><div class="k-t">Operacje</div><div class="k-v">${rep.count}</div><div class="k-s">${rep.byType.map(x => `${R.OP_TYPES[x.type].label.split(" ")[0].toLowerCase()}: ${x.count}`).join(" · ")}</div></div>
            <div class="kpi"><div class="k-t">Zakupy</div><div class="k-v">${fmt(rep.purchaseCost + rep.rawCost, 0)}<u>zł</u></div></div>
            <div class="kpi"><div class="k-t">Rąbanie</div><div class="k-v" id="rep-chip">${fmt(rep.chippingCost, 0)}<u>zł</u></div></div>
            <div class="kpi"><div class="k-t">Transport</div><div class="k-v">${fmt(rep.transportCost, 0)}<u>zł</u></div></div>
            <div class="kpi"><div class="k-t">Przychód</div><div class="k-v">${fmt(rep.revenue, 0)}<u>zł</u></div></div>
            <div class="kpi"><div class="k-t">Wynik</div><div class="k-v">${fmt(rep.result, 0)}<u>zł</u></div><div class="k-s">przychód − zakup − rąbanie − transport</div></div></div></div>
          <div class="tbl-wrap"><table class="tbl" id="report-table"><thead><tr><th>Produkt</th><th>Jedn.</th><th class="r">Przychód na stan</th><th class="r">Rozchód</th><th class="r">Zmiana stanu</th><th class="r">Stan na koniec okresu</th></tr></thead><tbody>
            ${rep.byProduct.map(r => `<tr><td>${esc((App.product(r.productId) || {}).name)}</td><td>${Units.label((App.product(r.productId) || {}).unit)}</td><td class="r">${fmtQ(r.inQty)}</td><td class="r">${fmtQ(r.outQty)}</td><td class="r">${fmtQ(r.net)}</td><td class="r"><b>${esc(App.qtyNative(Stock.balance(S, whId, r.productId, end), r.productId))}</b></td></tr>`).join("") || `<tr><td colspan="6" class="empty">Brak ruchów.</td></tr>`}
          </tbody></table></div>
          ${months.length ? `<div class="card-h"><h3>Rok ${esc(period)} — miesiące</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Miesiąc</th><th class="r">Operacje</th><th class="r">Zakupy</th><th class="r">Rąbanie</th><th class="r">Transport</th><th class="r">Przychód</th><th class="r">Wynik</th></tr></thead><tbody>
            ${months.map(x => `<tr><td>${esc(Dates.label(x.period))}</td><td class="r">${x.count}</td><td class="r">${esc(money(x.purchaseCost + x.rawCost))}</td><td class="r">${esc(money(x.chippingCost))}</td><td class="r">${esc(money(x.transportCost))}</td><td class="r">${esc(money(x.revenue))}</td><td class="r">${esc(money(x.result))}</td></tr>`).join("")}</tbody></table></div>` : ""}
        </div>`;
      }
      return `<div class="page-head"><div class="titles"><h2>Historia zmian</h2><p>Każda zmiana zapisuje: użytkownika, czas, operację, akcję, stan przed, stan po i źródło zmiany. Historii nie edytuje się — błędy poprawia korekta.</p></div></div>
        <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" type="button" role="tab" aria-selected="${k === f.tab}" data-htab="${k}">${esc(l)}</button>`).join("")}</div>${body}`;
    },
    auditRows() {
      const S = Store.state, f = App.tabs.hist, q = f.q.trim().toLowerCase();
      return S.audit.filter(a =>
        (!f.period || a.ts.startsWith(f.period)) && (!f.from || a.ts.slice(0, 10) >= f.from) && (!f.to || a.ts.slice(0, 10) <= f.to) &&
        (!f.user || a.userId === f.user) && (!f.entity || a.entity === f.entity) &&
        (!q || [a.action, a.source, a.opNo, a.userName, JSON.stringify(a.after)].join(" ").toLowerCase().includes(q))
      ).slice().sort((a, b) => a.ts < b.ts ? 1 : -1);
    },
    opRows() {
      const S = Store.state, f = App.tabs.hist, q = f.q.trim().toLowerCase();
      return S.operations.filter(o => o.whId === App.user().whId && (!f.period || o.date.startsWith(f.period)) && (!f.opType || o.type === f.opType) &&
        (!q || [o.no, o.place, (App.partner(o.purchase && o.purchase.supplierId) || {}).name, (App.partner(o.sale && o.sale.buyerId) || {}).name, o.userName].join(" ").toLowerCase().includes(q)))
        .slice().sort((a, b) => a.date < b.date ? 1 : -1);
    },
    bind(page) {
      const f = App.tabs.hist;
      $$("[data-htab]", page).forEach(b => b.onclick = () => { f.tab = b.dataset.htab; App.render(); });
      const on = (id, k, ev = "change") => { const el = $(id, page); if (el) el.addEventListener(ev, e => { f[k] = e.target.value; if (ev === "input") { clearTimeout(this._t); this._t = setTimeout(() => { App.render(); const x = $(id); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 250); } else App.render(); }); };
      on("#h-period", "period"); on("#h-from", "from"); on("#h-to", "to"); on("#h-user", "user"); on("#h-entity", "entity"); on("#h-optype", "opType"); on("#h-q", "q", "input");
      const pr = $("#h-print", page); if (pr) pr.onclick = () => root.print();
      const csv = $("#h-csv", page);
      if (csv) csv.onclick = () => {
        if (f.tab === "audit") download(`historia_zmian_${App.today()}.csv`, toCSV(["Czas", "Użytkownik", "Obiekt", "Akcja", "Źródło", "Stan przed", "Stan po"],
          this.auditRows().map(a => [a.ts, a.userName, a.opNo || a.entityId || "", a.action, a.source, JSON.stringify(a.before), JSON.stringify(a.after)])), "text/csv;charset=utf-8");
        else download(`rejestr_operacji_${App.today()}.csv`, toCSV(["Nr", "Data", "Rodzaj", "Użytkownik", "Produkt", "Ilość", "Zakup zł", "Rąbanie zł", "Transport zł", "Przychód zł", "Miejsce transportu", "Status"],
          this.opRows().map(o => [o.no, o.date, R.OP_TYPES[o.type].label + (o.direct ? " (bezpośrednia)" : ""), o.userName, opProduct(o), opQty(o), csvNum(o.totals.purchaseCost + (o.totals.rawCost || 0)), csvNum(o.totals.chippingCost || 0), csvNum(o.totals.transportCost), csvNum(o.totals.revenue), o.place, o.status])), "text/csv;charset=utf-8");
      };
    }
  };

  /* ------------------------------ Dane ------------------------------ */
  Views.dane = {
    html() {
      const S = Store.state;
      let size = 0; try { size = (localStorage.getItem(KEY) || "").length; } catch (e) {}
      const intro = root.Intro;
      const today = ssGet("riw.demo.today", "");
      return `<div class="page-head"><div class="titles"><h2>Dane i ustawienia</h2><p>Kopie zapasowe, import, preferencje i narzędzia demonstracyjne.</p></div></div>
        <div class="grid g2">
          <div class="card"><div class="card-h"><h3>Kopia zapasowa</h3></div><div class="card-b stack">
            <p class="muted">Pełna kopia (operacje, księga, dokumenty, inwentaryzacja, flota, audyt) w pliku JSON. Wczytanie kopii zastępuje bieżące dane po kontroli struktury.</p>
            <div class="row wrap"><button class="btn primary" type="button" id="bk-export" ${App.can("data.backup") ? "" : "disabled"}>${ic("dl", 15)} Pobierz kopię (JSON)</button>
              <button class="btn" type="button" id="bk-import" ${App.can("data.import") ? "" : "disabled"}>${ic("up", 15)} Wczytaj kopię</button>
              <input type="file" id="bk-file" accept="application/json,.json" class="hidden"></div>
            <p class="help">Wymagana rola: Kierownik lub Administrator. Rozmiar danych: ${fmt(size / 1024, 1)} kB (rewizja ${S.rev}).</p></div></div>
          <div class="card"><div class="card-h"><h3>Preferencje</h3></div><div class="card-b stack">
            <label class="inline-opt"><input type="checkbox" id="pf-tut" ${lsGet("riw.demo.tutorial", "1") !== "0" ? "checked" : ""}> Samouczek pod polami formularza</label>
            <label class="inline-opt"><input type="checkbox" id="pf-intro" ${intro && intro.enabled() ? "checked" : ""}> Intro przy uruchomieniu</label>
            <label class="inline-opt"><input type="checkbox" id="pf-music" ${intro && intro.musicOn() ? "checked" : ""}> Muzyka w intro (domyślnie włączona)</label>
            <div><button class="btn" type="button" id="pf-play">${ic("play", 15)} Odtwórz intro</button></div></div></div>
          <div class="card"><div class="card-h"><h3>Narzędzia demonstracyjne</h3></div><div class="card-b stack">
            <div class="field"><label for="dm-today">Data systemowa demo (pusta = dzisiejsza)</label><input class="ctrl" type="date" id="dm-today" value="${esc(today)}"><div class="help">Pozwala sprawdzić przełom miesiąca bez czekania. Obowiązuje w tej karcie.</div></div>
            <div class="row wrap"><button class="btn" type="button" id="dm-apply">Zastosuj datę</button><button class="btn" type="button" id="dm-roll">Kontrola przełomu miesiąca</button></div>
            <p class="help">Ostatnia kontrola przełomu: <b>${esc(S.meta.lastMonthCheck || "—")}</b>.</p></div></div>
          <div class="card"><div class="card-h"><h3>Dane przykładowe</h3></div><div class="card-b stack">
            <p class="muted">Przywraca stan startowy Demo v2 (bilans otwarcia 01.08.2026: drewno 817 m³, zrębka, PKS i łupina po 728 t, oraz operacje wzorcowe każdego rodzaju). Obecne dane zostaną usunięte.</p>
            <div><button class="btn danger" type="button" id="dm-reset">Przywróć dane przykładowe</button></div></div></div>
        </div>
        <div class="card mt4"><div class="card-h"><h3>O demonstratorze</h3></div><div class="card-b">
          <dl class="money-list" style="max-width:640px"><dt>Wersja</dt><dd>${esc(R.VERSION)}</dd><dt>Przeliczniki</dt><dd>1 m³ drewna = ${fmtQ(S.config.m3_mp)} MP zrębki · 1 MP ≈ ${fmt(S.config.mp_t, 2)} t · 1 m³ drewna ≈ ${fmt(S.config.woodTPerM3, 3)} t</dd><dt>Cena za rąbanie</dt><dd>${fmt(S.config.chipRateDefault)} zł/MP (domyślnie)</dd>
          <dt>Trwałość</dt><dd>${Store.memoryOnly ? "tylko pamięć (localStorage zablokowany)" : "localStorage (demonstracyjnie)"}</dd><dt>Blokada zapisu między kartami</dt><dd>${root.navigator && navigator.locks ? "Web Locks — aktywna" : "niedostępna w tej przeglądarce"}</dd></dl>
          <p class="help mt3">Demonstrator nie zastępuje produkcyjnego ERP: dane są w tej przeglądarce, a kontrola współbieżności działa tylko między kartami tego samego komputera.</p></div></div>`;
    },
    bind(page) {
      const intro = root.Intro;
      $("#pf-tut", page).onchange = e => { lsSet("riw.demo.tutorial", e.target.checked ? "1" : "0"); document.body.classList.toggle("no-tutorial", !e.target.checked); };
      $("#pf-intro", page).onchange = e => intro && intro.setEnabled(e.target.checked);
      $("#pf-music", page).onchange = e => intro && intro.setMusic(e.target.checked);
      $("#pf-play", page).onclick = () => intro && intro.play({ force: true });
      $("#bk-export", page).onclick = () => {
        download(`resinvest_demo_kopia_${App.today()}.json`, JSON.stringify(Store.state, null, 1), "application/json");
        Store.transact(s => { s.rev += 1; s.audit.push({ id: R.uid("a"), ts: new Date().toISOString(), userId: App.user().id, userName: App.user().name, whId: App.user().whId, entity: "system", entityId: "backup", opNo: "kopia", action: "Pobranie kopii zapasowej", before: null, after: { rewizja: s.rev }, source: "Dane i ustawienia" }); return { ok: true }; });
      };
      $("#bk-import", page).onclick = () => $("#bk-file", page).click();
      $("#bk-file", page).onchange = async e => {
        const file = e.target.files[0]; e.target.value = "";
        if (!file) return;
        let data;
        try { data = JSON.parse(await file.text()); } catch (x) { Toast.err("Plik nie jest poprawnym JSON"); return; }
        const errs = R.validateStateShape(data);
        if (errs.length) { Toast.err("Kopia odrzucona", errs.slice(0, 3).join("; ")); return; }
        const r = await Modal.confirm({ title: "Wczytać kopię?", text: `Kopia: ${data.operations.length} operacji, ${data.ledger.length} zapisów księgi, rewizja ${data.rev}. Bieżące dane zostaną zastąpione.`, ok: "Wczytaj", danger: true });
        if (!r.ok) return;
        const who = App.user();
        const res = await Store.transact(s => {
          const next = R.clone(data);
          next.rev = Math.max(s.rev, next.rev) + 1;
          next.audit.push({ id: R.uid("a"), ts: new Date().toISOString(), userId: who.id, userName: who.name, whId: who.whId, entity: "system", entityId: "import", opNo: "import", action: "Import kopii zapasowej", before: { rewizja: s.rev, operacje: s.operations.length }, after: { rewizja: next.rev, operacje: next.operations.length }, source: "Dane i ustawienia" });
          Object.keys(s).forEach(k => delete s[k]); Object.assign(s, next);
          return { ok: true };
        });
        if (res.ok) { Toast.ok("Kopia wczytana"); Form.draft = null; ssSet("riw.demo.v2.draft", null); App.render(); } else Toast.err("Import nieudany", res.error);
      };
      $("#dm-apply", page).onclick = () => { const v = $("#dm-today", page).value; ssSet("riw.demo.today", v || null); Toast.info("Data systemowa demo", v || "dzisiejsza"); App.render(); };
      $("#dm-roll", page).onclick = async () => {
        const res = await Store.transact(s => ({ ok: true, done: R.Inventory.autoClose(s, { user: null, today: App.today(), source: "Automat: początek kolejnego miesiąca" }) }));
        const done = res.done || [];
        Toast.info("Kontrola przełomu miesiąca", done.length ? done.map(d => `${d.ym}: ${d.ok ? "zamknięto" + (d.docNo ? " (" + d.docNo + ")" : "") : d.error}`).join(" · ") : "Brak otwartych okresów z poprzednich miesięcy lub kontrola już wykonana w tym miesiącu.");
        App.render();
      };
      $("#dm-reset", page).onclick = async () => {
        const r = await Modal.confirm({ title: "Przywrócić dane przykładowe?", text: "Wszystkie operacje, dokumenty, okresy i zmiany floty w tej przeglądarce zostaną zastąpione danymi startowymi.", ok: "Przywróć", danger: true });
        if (!r.ok) return;
        const res = await Store.transact(s => { const n = R.Seed.build(App.today()); n.rev = s.rev + 1; Object.keys(s).forEach(k => delete s[k]); Object.assign(s, n); return { ok: true }; });
        if (res.ok) { Form.draft = null; ssSet("riw.demo.v2.draft", null); Toast.ok("Przywrócono dane przykładowe"); App.render(); }
      };
    }
  };

  root.App = App;
  root.RIWForm = Form;
})(typeof globalThis !== "undefined" ? globalThis : this);
