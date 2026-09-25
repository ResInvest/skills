/* =========================================================================
   ResInvest ERP 3.0 — warstwa A: rdzeń interfejsu
   * narzędzia DOM, ikony, powiadomienia, okna,
   * Store — jeden interfejs danych dla dwóch trybów pracy:
       lokalny  (plik HTML, dane w przeglądarce, jedno stanowisko),
       serwerowy (program ResInvest ERP Serwer: SQLite, wielu użytkowników),
     każda zmiana danych = Store.exec(komenda) → Service (silnik) → zapis atomowy,
   * logowanie, sesja, wylogowanie po bezczynności, zmiana hasła, kreator startu,
   * motywy (Perła / Grafit / Graphite Azure) i języki (PL / CS / EN),
   * powłoka aplikacji: menu, pasek górny, menu użytkownika, routing.
   Ekrany modułów: form.js, views.js, dashboard.js, admin.js.
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW, I18N = root.RIW_I18N, Service = root.RIW_Service, AuthLib = root.RIW_Auth;
  const { NumParse, fmt, fmtQ, money, Units, Dates } = R;
  const t = (s, p) => I18N.t(s, p), tp = (s, n, p) => I18N.tp(s, n, p), N_ = s => s;
  const DBG = root.RIW_DEBUG = root.RIW_DEBUG || {};

  /* ------------------------------------------------------------------ */
  /* Narzędzia DOM                                                       */
  /* ------------------------------------------------------------------ */
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const fid = key => "f-" + key.replace(/\./g, "-");
  const str = v => String(v == null ? "" : v).trim();
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
  const ssGet = (k, d) => { try { const v = sessionStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const ssSet = (k, v) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} };
  const initials = name => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();

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
    undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3", ban: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8",
    sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
    moon: "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z", drop: "M12 2.7s-7 7.6-7 12.3a7 7 0 0 0 14 0c0-4.7-7-12.3-7-12.3z",
    globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0", key: "M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7zM16 10h.01",
    lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4", logout: "M9 21H5V3h4M16 17l5-5-5-5M21 12H9",
    settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    eye: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", eyeOff: "M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A10.4 10.4 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 4.2M6.6 6.6A17.6 17.6 0 0 0 1 12s4 7 11 7a10 10 0 0 0 5.4-1.6",
    server: "M3 4h18v6H3zM3 14h18v6H3zM7 7h.01M7 17h.01", refresh: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
    bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0", trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
    coins: "M8 8a6 3 0 1 0 12 0A6 3 0 1 0 8 8zM8 8v4c0 1.7 2.7 3 6 3s6-1.3 6-3V8M4 12a6 3 0 0 0 6 3M4 12v4c0 1.7 2.7 3 6 3"
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
  function toCSV(head, rows) { return "﻿" + [head, ...rows].map(r => r.map(csvCell).join(";")).join("\r\n"); }

  /* ------------------------------------------------------------------ */
  /* Powiadomienia i okna                                                */
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
    ok(a, b) { this.show("ok", a, b); }, err(a, b) { this.show("err", a, b); },
    warn(a, b) { this.show("warn", a, b); }, info(a, b) { this.show("info", a, b); }
  };

  const Modal = {
    open({ title, sub, body, footer, wide, xwide, onClose, id }) {
      const scrim = document.createElement("div");
      scrim.className = "scrim";
      scrim.innerHTML = `<div class="modal ${wide ? "wide" : ""} ${xwide ? "xwide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}" ${id ? `id="${esc(id)}"` : ""}>
        <div class="modal-h"><div style="flex:1;min-width:0"><h3>${esc(title)}</h3>${sub ? `<p>${sub}</p>` : ""}</div>
          <button class="icon-btn" data-x type="button" aria-label="${esc(t("Zamknij"))}">${ic("x")}</button></div>
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
    confirm({ title, text, ok, danger = false, input = null }) {
      return new Promise(resolve => {
        let done = false;
        const m = this.open({
          title,
          body: `<p class="muted">${esc(text)}</p>${input ? `<div class="field mt4"><label for="cf-in">${esc(input.label)}</label>
            <input class="ctrl" id="cf-in" placeholder="${esc(input.placeholder || "")}"><div class="msg hidden" id="cf-msg"></div></div>` : ""}`,
          footer: `<button class="btn ghost" type="button" data-no>${esc(t("Anuluj"))}</button><button class="btn ${danger ? "danger" : "primary"}" type="button" data-yes>${esc(ok || t("Potwierdź"))}</button>`,
          onClose: () => { if (!done) resolve({ ok: false }); }
        });
        $("[data-no]", m.el).onclick = () => m.close();
        $("[data-yes]", m.el).onclick = () => {
          const v = input ? $("#cf-in", m.el).value.trim() : null;
          if (input && input.required && !v) { const msg = $("#cf-msg", m.el); msg.textContent = t("Pole wymagane"); msg.classList.remove("hidden"); return; }
          done = true; m.close(); resolve({ ok: true, value: v });
        };
      });
    }
  };

  /** Lista rozwijana przy przycisku (menu użytkownika, język, motyw). */
  const Dropdown = {
    el: null,
    close() { if (this.el) { this.el.remove(); this.el = null; document.removeEventListener("mousedown", this._out, true); document.removeEventListener("keydown", this._key); } },
    open(anchor, html, bind) {
      this.close();
      const el = document.createElement("div");
      el.className = "dropdown"; el.setAttribute("role", "menu"); el.innerHTML = html;
      document.body.appendChild(el);
      const r = anchor.getBoundingClientRect(), w = el.offsetWidth;
      el.style.top = Math.min(r.bottom + 6, root.innerHeight - el.offsetHeight - 8) + "px";
      el.style.left = Math.max(8, Math.min(r.right - w, root.innerWidth - w - 8)) + "px";
      this.el = el;
      this._out = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) this.close(); };
      this._key = e => { if (e.key === "Escape") { this.close(); anchor.focus(); } };
      document.addEventListener("mousedown", this._out, true);
      document.addEventListener("keydown", this._key);
      if (bind) bind(el);
      const first = $(".dd-item", el); if (first) first.focus();
      return el;
    }
  };

  /* ------------------------------------------------------------------ */
  /* Motywy i języki                                                     */
  /* ------------------------------------------------------------------ */
  const THEME_LIST = [
    { id: "pearl", label: N_("Perła (jasny)"), icon: "sun", sw: ["#FFFFFF", "#EEF2EF", "#1E6B45"] },
    { id: "graphite", label: N_("Grafit (ciemny)"), icon: "moon", sw: ["#141B17", "#0D120F", "#3AA76E"] },
    { id: "azure", label: N_("Graphite Azure"), icon: "drop", sw: ["#111823", "#090C11", "#3E8EF7"] }
  ];
  const Prefs = {
    theme: "pearl",
    applyTheme(id) {
      this.theme = THEME_LIST.some(x => x.id === id) ? id : "pearl";
      document.documentElement.setAttribute("data-theme", this.theme);
      const meta = $('meta[name="color-scheme"]'); if (meta) meta.setAttribute("content", this.theme === "pearl" ? "light" : "dark");
    },
    applyLang(code) {
      I18N.setLang(code);
      document.documentElement.lang = I18N.lang;
    },
    /** Preferencje zalogowanego użytkownika mają pierwszeństwo przed zapisanymi w przeglądarce. */
    fromUser(u) {
      this.applyTheme((u && u.theme) || lsGet("riw.theme", "pearl"));
      this.applyLang((u && u.lang) || I18N.detect(lsGet("riw.lang", ""), root.navigator && navigator.language));
    },
    async setTheme(id) {
      this.applyTheme(id); lsSet("riw.theme", this.theme);
      if (Store.userId) await Store.exec("me.prefs", { theme: this.theme }, N_("Preferencje"), { quiet: true });
      App.refreshChrome();
    },
    async setLang(code) {
      this.applyLang(code); lsSet("riw.lang", I18N.lang);
      if (Store.userId) await Store.exec("me.prefs", { lang: I18N.lang }, N_("Preferencje"), { quiet: true });
      App.rerenderAll();
    }
  };

  /* ------------------------------------------------------------------ */
  /* Dane: tryb lokalny i serwerowy                                      */
  /* ------------------------------------------------------------------ */
  const KEY = "riw.v3.state";
  const OLD_KEYS = ["riw.demo.state.v3", "riw.demo.state.v2", "riw.demo.state.v1"];
  const DRAFT_KEY = "riw.v3.form";

  /** Tryb lokalny: dane i konta w przeglądarce (jedno stanowisko / pokaz). */
  const LocalBackend = {
    mode: "local", memoryOnly: false, auth: AuthLib.LocalAuth,
    read() {
      if (this.memoryOnly) return Store.state;
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const m = R.migrate(JSON.parse(raw));
      if (m.error) throw new Error(m.error);
      const e = R.validateStateShape(m.state);
      if (e.length) throw new Error(e.join("; "));
      return m.state;
    },
    write(s) { if (!this.memoryOnly) localStorage.setItem(KEY, JSON.stringify(s)); },
    async boot() {
      try { localStorage.setItem("riw.probe", "1"); localStorage.removeItem("riw.probe"); } catch (e) { this.memoryOnly = true; }
      let s = null, problem = null, migrated = false;
      if (!this.memoryOnly) {
        try { s = this.read(); } catch (e) {
          problem = e.message;
          try { localStorage.setItem(KEY + ".uszkodzone." + Date.now(), localStorage.getItem(KEY)); } catch (x) {}
        }
        // dane z Demo 2.x (schemat 3) — przeniesienie z migracją; stare klucze zostają nietknięte
        if (!s && !problem) {
          const old = OLD_KEYS.map(k => [k, lsGet(k, null)]).find(([, v]) => v);
          if (old && old[0] === "riw.demo.state.v3") {
            try { const m = R.migrate(JSON.parse(old[1])); if (!m.error && !R.validateStateShape(m.state).length) { s = m.state; migrated = true; } } catch (e) {}
          }
        }
      }
      if (!s) s = R.Seed.build(App.today());
      try { if (!this.memoryOnly) this.write(s); } catch (e) { this.memoryOnly = true; }
      Store.state = s;
      await this.auth.ensureDemo(s);
      return { problem, migrated };
    },
    /** Zapis „wszystko albo nic”: świeży odczyt → komenda na kopii → jeden zapis (Web Locks między kartami). */
    exec(cmd, args, source) {
      const run = () => {
        let fresh;
        try { fresh = this.read() || Store.state; } catch (e) { return { ok: false, error: t("Nie można odczytać danych: {m}", { m: e.message }) }; }
        const ctx = { user: { id: Store.userId }, today: App.today(), source };
        const { res, state } = Service.run(fresh, cmd, Object.assign({}, args, { source }), ctx);
        if (state) {
          try { this.write(state); } catch (e) { return { ok: false, error: t("Zapis nieudany (pamięć przeglądarki pełna lub zablokowana) — nic nie zapisano.") }; }
          Store.state = state;
        } else Store.state = fresh;
        return res;
      };
      if (root.navigator && navigator.locks && navigator.locks.request) return navigator.locks.request("riw-state", () => run());
      return Promise.resolve(run());
    },
    async login(login, pw) { const r = await this.auth.login(Store.state, login, pw); if (r.ok) Store.userId = r.userId; return r; },
    async resume() { const s = this.auth.session(); if (s && R.byId(Store.state.users, s.userId) && R.byId(Store.state.users, s.userId).active !== false) { Store.userId = s.userId; return { ok: true, mustChange: this.auth.info(s.userId).mustChange }; } return { ok: false }; },
    async logout(reason) { this.auth.logout(reason || "user"); Store.userId = null; },
    async afterPasswordChange() {},
    touch() { this.auth.touch(); },
    alive() { return !!this.auth.session(); },
    changePassword(oldPw, newPw) { return this.auth.changePassword(Store.state, Store.userId, oldPw, newPw); },
    setPassword(userId, pw, mustChange) { return this.auth.setPassword(Store.state, App.user(), userId, pw, mustChange); },
    unlock(userId) { return Promise.resolve(this.auth.unlock(App.user(), userId)); },
    accountInfo(userId) { return Promise.resolve(this.auth.info(userId)); },
    loginLog() { return Promise.resolve(this.auth.loginLog()); },
    /** Nowy użytkownik z hasłem — hasło sprawdzane PRZED zapisem profilu. */
    async createUser(rec, pw) {
      const e = AuthLib.passwordError(pw, rec.login);
      if (e) return { ok: false, errors: { password: e }, error: e };
      const res = await this.exec("user.save", { rec }, N_("Administracja — użytkownicy"));
      if (!res.ok) return res;
      const p = await this.setPassword(res.rec.id, pw, true);
      return p.ok ? res : p;
    },
    sizeBytes() { try { return (localStorage.getItem(KEY) || "").length; } catch (e) { return 0; } }
  };

  /** Tryb serwerowy: API programu ResInvest ERP Serwer (sesja w ciasteczku HttpOnly). */
  const ServerBackend = {
    mode: "server", online: true, info: null, es: null,
    async api(method, path, body) {
      const opt = { method, headers: { "X-RIW": "1", "Accept-Language": I18N.lang }, credentials: "same-origin" };
      if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
      let r;
      try { r = await fetch(path, opt); } catch (e) { this.setOnline(false); return { ok: false, code: "NET", error: t("Brak połączenia z serwerem — nic nie zapisano.") }; }
      this.setOnline(true);
      let data = null;
      try { data = await r.json(); } catch (e) { data = { ok: false, error: t("Nieprawidłowa odpowiedź serwera") }; }
      if (r.status === 401 && Store.userId && path !== "/api/auth/login") { App.sessionLost(); }
      return data;
    },
    setOnline(v) { if (this.online !== v) { this.online = v; App.refreshChrome(); } },
    async detect() {
      if (!/^https?:$/.test(location.protocol)) return null;
      try { const r = await fetch("/api/health", { headers: { "X-RIW": "1" } }); const j = await r.json(); return j && j.app === "resinvest-erp" ? j : null; } catch (e) { return null; }
    },
    async boot(info) { this.info = info; return { problem: null, setup: !!info.setup }; },
    async loadState() {
      const r = await this.api("GET", "/api/state");
      if (!r || !r.ok) return r;
      Store.state = r.state; Store.serverToday = r.today; return r;
    },
    async exec(cmd, args, source) {
      const r = await this.api("POST", "/api/cmd", { cmd, args: Object.assign({}, args, { source }) });
      if (r && r.state) Store.state = r.state;
      if (r && r.today) Store.serverToday = r.today;
      return r && r.res ? r.res : (r || { ok: false, error: t("Nieprawidłowa odpowiedź serwera") });
    },
    /** Po zalogowaniu: stan danych dopiero gdy hasło nie wymaga zmiany (serwer blokuje dane do czasu zmiany). */
    async enter(r) { Store.userId = r.userId; Store.pendingUser = r.user || null; if (!r.mustChange) { await this.loadState(); this.listen(); } },
    async login(login, pw) { const r = await this.api("POST", "/api/auth/login", { login, password: pw }); if (r.ok) await this.enter(r); return r; },
    async resume() { const r = await this.api("GET", "/api/auth/me"); if (r && r.ok) { await this.enter(r); return { ok: true, mustChange: r.mustChange }; } return { ok: false }; },
    async afterPasswordChange() { await this.loadState(); this.listen(); },
    async logout() { await this.api("POST", "/api/auth/logout", {}); if (this.es) { this.es.close(); this.es = null; } Store.userId = null; Store.state = null; },
    touch() {},
    alive() { return !!Store.userId; },
    changePassword(oldPw, newPw) { return this.api("POST", "/api/auth/password", { old: oldPw, new: newPw }); },
    setPassword(userId, pw, mustChange) { return this.api("POST", "/api/users/password", { userId, password: pw, mustChange }); },
    unlock(userId) { return this.api("POST", "/api/users/unlock", { userId }); },
    async accountInfo(userId) { const r = await this.api("GET", "/api/users/accounts"); return r && r.ok ? (r.accounts[userId] || { hasPassword: false }) : { hasPassword: false }; },
    async accounts() { const r = await this.api("GET", "/api/users/accounts"); return r && r.ok ? r.accounts : {}; },
    async loginLog() { const r = await this.api("GET", "/api/auth/log"); return r && r.ok ? r.log : []; },
    async createUser(rec, pw) { const r = await this.api("POST", "/api/users", { rec, password: pw }); if (r && r.state) Store.state = r.state; return r && r.res ? r.res : r; },
    backups() { return this.api("GET", "/api/backups"); },
    backupNow() { return this.api("POST", "/api/backups", {}); },
    /** Zmiany innych użytkowników: serwer wysyła numer rewizji (SSE) — pobieramy świeży stan. */
    listen() {
      if (this.es || !root.EventSource) return;
      const es = this.es = new EventSource("/api/events");
      es.addEventListener("rev", async e => {
        let d = {}; try { d = JSON.parse(e.data); } catch (x) {}
        if (!Store.state || d.rev <= Store.state.rev) return;
        await this.loadState();
        if (d.by && d.by !== Store.userId) Toast.info(t("Dane zmienione przez innego użytkownika"), t("Stany i dokumenty odświeżono."));
        App.onExternalChange();
      });
      es.onerror = () => { this.setOnline(false); };
      es.onopen = () => { this.setOnline(true); };
    },
    sizeBytes() { return Store.state ? JSON.stringify(Store.state).length : 0; }
  };

  const Store = {
    state: null, userId: null, backend: null, serverToday: null,
    get mode() { return this.backend ? this.backend.mode : "local"; },
    get memoryOnly() { return this.backend === LocalBackend && LocalBackend.memoryOnly; },
    /** Jedyna ścieżka zmian danych. `source` — kanoniczny opis miejsca w programie (audyt). */
    async exec(cmd, args, source, opts = {}) {
      if (!this.userId) return { ok: false, error: t("Brak zalogowanego użytkownika"), code: "AUTH" };
      const res = await this.backend.exec(cmd, args || {}, source || N_("Aplikacja"));
      if (res && res.code === "AUTH" && !opts.quiet) App.sessionLost();
      return res || { ok: false, error: t("Operacja odrzucona") };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Nawigacja                                                           */
  /* ------------------------------------------------------------------ */
  const NAV = [
    { group: N_("Praca") },
    { id: "pulpit", label: N_("Pulpit"), icon: "home" },
    { id: "operacje", label: N_("Operacje"), icon: "list" },
    { id: "przyjecia", label: N_("Przyjęcia"), icon: "inbox" },
    { id: "wz", label: N_("Wydania / WZ"), icon: "out" },
    { id: "produkcja", label: N_("Produkcja"), icon: "factory" },
    { id: "kwit", label: N_("Kwit produkcji dnia"), icon: "receipt" },
    { id: "mm", label: N_("MM"), icon: "swap" },
    { id: "transport", label: N_("Transport"), icon: "truck" },
    { group: N_("Ewidencja") },
    { id: "stany", label: N_("Stany magazynowe"), icon: "layers" },
    { id: "dokumenty", label: N_("Dokumenty"), icon: "file" },
    { id: "historia", label: N_("Historia"), icon: "clock" },
    { id: "raporty", label: N_("Raporty"), icon: "chart" },
    { id: "inwentaryzacja", label: N_("Inwentaryzacja"), icon: "clipboard" },
    { group: N_("Kartoteki") },
    { id: "flota", label: N_("Flota"), icon: "truck" },
    { id: "produkty", label: N_("Produkty"), icon: "box" },
    { id: "kontrahenci", label: N_("Kontrahenci"), icon: "users" },
    { id: "magazyny", label: N_("Magazyny"), icon: "building" },
    { group: N_("System") },
    { id: "uzytkownicy", label: N_("Użytkownicy"), icon: "key", perm: "users.manage" },
    { id: "administracja", label: N_("Administracja"), icon: "shield" },
    { id: "profil", label: N_("Mój profil"), icon: "user" }
  ];
  const HIDDEN_ROUTES = { nowa: { label: N_("Nowa operacja"), parent: "operacje" }, korekta: { label: N_("Korekta dokumentu"), parent: "operacje" } };

  /* ------------------------------------------------------------------ */
  /* Aplikacja                                                           */
  /* ------------------------------------------------------------------ */
  const App = {
    route: "pulpit", params: {}, tabs: {}, started: false, idleTimer: null,
    today() {
      if (Store.mode === "server" && Store.serverToday) return Store.serverToday;
      const o = ssGet("riw.today", ""); return Dates.isISO(o) ? o : Dates.localToday();
    },
    get state() { return Store.state; },
    user() { return Store.state && Store.userId ? R.byId(Store.state.users, Store.userId) : (Store.userId && Store.pendingUser && Store.pendingUser.id === Store.userId ? Store.pendingUser : null); },
    wh() { const u = this.user(); return u ? R.byId(Store.state.warehouses, u.whId) : null; },
    ctx(source) { return { user: this.user(), today: this.today(), source }; },
    can(p) { return R.can(this.user(), p); },
    product(id) { return R.byId(Store.state.products, id); },
    partner(id) { return R.byId(Store.state.partners, id); },
    whName(id) { return (R.byId(Store.state.warehouses, id) || {}).name || "—"; },
    roleLabel(role) { return t((R.ROLES[role] || R.ROLES.podglad).label); },
    qtyNative(q, productId, dec = 3) {
      const p = this.product(productId);
      return fmtQ(q, dec) + " " + Units.label(p ? p.unit : "");
    },
    mass(q, productId) {
      const p = this.product(productId);
      if (!p || p.unit === "t") return "";
      return "≈ " + fmt(Units.mass(q, p, Store.state.config), 0) + " t";
    },
    energy(q, productId) {
      const p = this.product(productId);
      if (!p) return "";
      return "≈ " + fmt(Units.orient(q, p, Store.state.config).gj, 0) + " GJ";
    },
    orientText(q, productId) { return [this.mass(q, productId), this.energy(q, productId)].filter(Boolean).join(" · "); },

    /* ---------- start ---------- */
    async init() {
      Prefs.fromUser(null);
      const info = await ServerBackend.detect();
      Store.backend = info ? ServerBackend : LocalBackend;
      const r = await Store.backend.boot(info);
      if (r.problem) setTimeout(() => Toast.err(t("Dane były uszkodzone lub w starszym formacie"), t("Zachowano kopię i wczytano dane przykładowe. {p}", { p: r.problem })), 400);
      if (r.migrated) setTimeout(() => Toast.info(t("Przeniesiono dane z Demo 2.x"), t("Dane zostały zmigrowane do wersji 3.0. Zaloguj się kontem z danych przykładowych.")), 600);
      if (Store.memoryOnly) setTimeout(() => Toast.warn(t("Tryb bez zapisu"), t("Przeglądarka blokuje localStorage — zmiany znikną po zamknięciu karty.")), 400);
      document.body.classList.toggle("no-tutorial", lsGet("riw.tutorial", "1") === "0");
      root.addEventListener("hashchange", () => { if (Store.userId) this.render(); });
      root.addEventListener("storage", e => this.onStorage(e));
      ["mousedown", "keydown", "touchstart", "wheel"].forEach(ev => root.addEventListener(ev, () => { if (Store.userId) Store.backend.touch(); }, { passive: true }));
      DBG.app = App; DBG.store = Store; DBG.R = R; DBG.I18N = I18N;
      DBG.loginAs = async (login, pw) => { if (Store.userId) await this.logout(true); const res = await Store.backend.login(login, pw || AuthLib.DEMO_PASSWORD); if (res.ok) await this.afterLogin(res); return res; };
      if (r.setup) return Auth.setupScreen();
      const again = await Store.backend.resume();
      if (again.ok) return this.afterLogin(again);
      Auth.loginScreen();
    },
    async afterLogin(res) {
      const u = this.user();
      Prefs.fromUser(u);
      if (res && res.mustChange) return Auth.forceChange();
      this.shell();
      const done = await Store.exec("inv.autoClose", {}, N_("Automat: początek kolejnego miesiąca"), { quiet: true });
      if (done && done.done && done.done.length) {
        const okN = done.done.filter(d => d.ok).length;
        Toast.info(t("Przełom miesiąca"), t("Automatycznie zamknięto okresy inwentaryzacji: {n}", { n: okN }) + (okN < done.done.length ? " · " + t("nieudane: {n}", { n: done.done.length - okN }) : ""));
      }
      this.render();
      clearInterval(this.idleTimer);
      this.idleTimer = setInterval(() => { if (Store.userId && !Store.backend.alive()) this.sessionLost(true); }, 20000);
    },
    async logout(silent) {
      root.Dropdown && Dropdown.close();
      clearInterval(this.idleTimer);
      if (root.RIWForm) { root.RIWForm.draft = null; root.RIWForm.mode = "new"; }
      await Store.backend.logout("user");
      if (!silent) { Prefs.fromUser(null); Auth.loginScreen({ info: t("Wylogowano.") }); }
    },
    sessionLost(idle) {
      if (!Store.userId) return;
      clearInterval(this.idleTimer);
      Store.backend.logout(idle ? "timeout" : "user");
      Store.userId = null;
      $$(".scrim").forEach(x => x.remove());
      Auth.loginScreen({ info: idle ? t("Wylogowano po {n} min bezczynności.", { n: AuthLib.POLICY.idleMinutes }) : t("Sesja wygasła — zaloguj się ponownie.") });
    },
    onStorage(e) {
      if (Store.mode !== "local" || !Store.userId) return;
      if (e.key === KEY && e.newValue) {
        try {
          const s = LocalBackend.read(); if (!s) return;
          Store.state = s;
          const u = this.user();
          if (!u || u.active === false) return this.sessionLost();
          Toast.info(t("Dane zmienione w innej karcie"), t("Stany i dokumenty odświeżono."));
          this.onExternalChange();
        } catch (x) {}
      }
    },
    onExternalChange() {
      if (!Store.userId) return;
      if ((this.route === "nowa" || this.route === "korekta") && $("#opf") && root.RIWForm) root.RIWForm.refresh(); else this.render({ keepForm: true });
    },

    /* ---------- powłoka ---------- */
    shell() {
      document.getElementById("app").innerHTML = `
        <div class="shell">
          <aside class="sidebar" aria-label="${esc(t("Nawigacja"))}">
            <div class="sb-head"><div class="mark">RI</div><div class="sb-brand"><b>ResInvest ERP</b><span>${esc(t("Wersja {v}", { v: R.VERSION }))}</span></div></div>
            <nav class="sb-nav" id="nav"></nav>
            <div class="sb-foot" id="sb-foot"></div>
          </aside>
          <div class="scrim-nav" id="scrim-nav"></div>
          <div class="main">
            <header class="topbar">
              <button class="icon-btn menu-btn" id="menu-btn" type="button" aria-label="${esc(t("Menu"))}">${ic("menu", 20)}</button>
              <h1 id="title"></h1>
              <div class="spacer"></div>
              <a class="btn primary sm new-op-btn" href="#/nowa" id="top-new">${ic("plus", 15)}<span>${esc(t("Nowa operacja"))}</span></a>
              <div class="wh-chip" id="wh-chip" title="${esc(t("Magazyn aktywny wynika z zalogowanego użytkownika"))}"></div>
              <button class="icon-btn" id="lang-btn" type="button" aria-label="${esc(t("Język"))}"></button>
              <button class="icon-btn" id="theme-btn" type="button" aria-label="${esc(t("Motyw"))}"></button>
              <button class="icon-btn" id="intro-btn" type="button" title="${esc(t("Odtwórz intro"))}" aria-label="${esc(t("Odtwórz intro"))}">${ic("play", 17)}</button>
              <button class="user-btn" id="user-btn" type="button" aria-haspopup="menu"></button>
            </header>
            <main class="page" id="page" tabindex="-1"></main>
          </div>
        </div>
        <div class="toasts" id="toasts" aria-live="polite"></div>
        <div class="chart-tip hidden" id="chart-tip" role="tooltip"></div>`;
      $("#menu-btn").onclick = () => document.body.classList.toggle("nav-open");
      $("#scrim-nav").onclick = () => document.body.classList.remove("nav-open");
      $("#intro-btn").onclick = () => root.Intro && root.Intro.play({ force: true });
      $("#user-btn").onclick = e => this.userMenu(e.currentTarget);
      $("#lang-btn").onclick = e => this.langMenu(e.currentTarget);
      $("#theme-btn").onclick = e => this.themeMenu(e.currentTarget);
      document.addEventListener("keydown", this._keys || (this._keys = e => {
        if (!Store.userId) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && !e.shiftKey) { e.preventDefault(); const i = THEME_LIST.findIndex(x => x.id === Prefs.theme); Prefs.setTheme(THEME_LIST[(i + 1) % THEME_LIST.length].id); }
      }));
      this.started = true;
      this.refreshChrome();
    },
    /** Elementy powłoki zależne od użytkownika, języka, motywu i połączenia. */
    refreshChrome() {
      if (!$("#user-btn") || !Store.userId) return;
      const u = this.user(), wh = this.wh();
      if (!u) return;
      $("#user-btn").innerHTML = `<span class="avatar">${esc(initials(u.name))}</span><span class="who"><b>${esc(u.name)}</b><small>${esc(this.roleLabel(u.role))}</small></span>`;
      $("#user-btn").setAttribute("aria-label", t("Konto: {n}", { n: u.name }));
      $("#wh-chip").innerHTML = `<span class="dot"></span><small>${esc(t("Magazyn:"))}</small><b>${esc(wh ? wh.name : "—")}</b>`;
      $("#lang-btn").innerHTML = `<span class="lbl">${esc(I18N.info().short)}</span>`;
      $("#lang-btn").title = t("Język") + ": " + I18N.info().label;
      const th = THEME_LIST.find(x => x.id === Prefs.theme);
      $("#theme-btn").innerHTML = ic(th.icon, 17); $("#theme-btn").title = t("Motyw") + ": " + t(th.label) + " (Ctrl+D)";
      const srv = Store.mode === "server", on = srv ? ServerBackend.online : true;
      $("#sb-foot").innerHTML = `<span class="conn-dot ${srv ? (on ? "" : "off") : "local"}"></span><span>${esc(srv ? (on ? t("Serwer · połączono") : t("Serwer · brak połączenia")) : Store.memoryOnly ? t("Tryb lokalny · bez zapisu") : t("Tryb lokalny · dane w tej przeglądarce"))}</span>`;
    },
    rerenderAll() {
      if (!Store.userId) { Auth.rerender(); return; }
      const h = location.hash; this.shell(); if (location.hash !== h) location.hash = h; this.render({ keepForm: true });
    },
    userMenu(btn) {
      const u = this.user();
      Dropdown.open(btn, `<div class="dd-head"><span class="avatar lg">${esc(initials(u.name))}</span><div><b>${esc(u.name)}</b><small>${esc(u.login)} · ${esc(this.roleLabel(u.role))}</small><small>${esc(this.whName(u.whId))}</small></div></div>
        <a class="dd-item" href="#/profil" data-go><span class="ic">${ic("user", 16)}</span>${esc(t("Mój profil i ustawienia"))}</a>
        <button class="dd-item" type="button" data-pw><span class="ic">${ic("key", 16)}</span>${esc(t("Zmień hasło"))}</button>
        ${this.can("users.manage") ? `<a class="dd-item" href="#/uzytkownicy" data-go><span class="ic">${ic("users", 16)}</span>${esc(t("Użytkownicy i uprawnienia"))}</a>` : ""}
        <div class="dd-sep"></div>
        <button class="dd-item danger" type="button" data-logout id="logout-btn"><span class="ic">${ic("logout", 16)}</span>${esc(t("Wyloguj"))}</button>`, el => {
        $$("[data-go]", el).forEach(a => a.onclick = () => Dropdown.close());
        $("[data-pw]", el).onclick = () => { Dropdown.close(); Auth.changePasswordDialog(); };
        $("[data-logout]", el).onclick = () => this.logout();
      });
    },
    langMenu(btn) {
      Dropdown.open(btn, `<div class="dd-label">${esc(t("Język"))}</div>` + Object.values(I18N.LANGS).map(L => `<button class="dd-item" type="button" data-lang="${L.code}" lang="${L.code}"><span class="ic">${ic("globe", 16)}</span>${esc(L.label)}${L.code === I18N.lang ? `<span class="chk">${ic("check", 15)}</span>` : ""}</button>`).join(""),
        el => $$("[data-lang]", el).forEach(b => b.onclick = () => { Dropdown.close(); Prefs.setLang(b.dataset.lang); }));
    },
    themeMenu(btn) {
      Dropdown.open(btn, `<div class="dd-label">${esc(t("Motyw"))}</div>` + THEME_LIST.map(th => `<button class="dd-item" type="button" data-theme-id="${th.id}"><span class="ic">${ic(th.icon, 16)}</span>${esc(t(th.label))}${th.id === Prefs.theme ? `<span class="chk">${ic("check", 15)}</span>` : ""}</button>`).join(""),
        el => $$("[data-theme-id]", el).forEach(b => b.onclick = () => { Dropdown.close(); Prefs.setTheme(b.dataset.themeId); }));
    },

    parseHash() {
      const h = (location.hash || "#/pulpit").replace(/^#\/?/, "");
      const [path, q] = h.split("?");
      const params = {};
      (q || "").split("&").filter(Boolean).forEach(kv => { const [k, v] = kv.split("="); params[decodeURIComponent(k)] = decodeURIComponent(v || ""); });
      const item = NAV.find(n => n.id === path);
      const route = (item && (!item.perm || this.can(item.perm))) || HIDDEN_ROUTES[path] ? path : "pulpit";
      return { route, params };
    },
    render(opts = {}) {
      if (!Store.userId || !$("#page")) return;
      const { route, params } = this.parseHash();
      const changed = route !== this.route;
      this.route = route; this.params = params;
      document.body.classList.remove("nav-open");
      const active = HIDDEN_ROUTES[route] ? HIDDEN_ROUTES[route].parent : route;
      $("#nav").innerHTML = NAV.filter(n => !n.perm || this.can(n.perm)).map(n => n.group ? `<div class="sb-group">${esc(t(n.group))}</div>` :
        `<a class="nav-item" href="#/${n.id}" data-nav="${n.id}" ${n.id === active ? 'aria-current="page"' : ""}><span class="ic">${ic(n.icon, 17)}</span><span>${esc(t(n.label))}</span>${this.navBadge(n.id)}</a>`).join("");
      this.refreshChrome();
      $("#top-new").classList.toggle("hidden", !this.can("op.create") || route === "nowa");
      const item = NAV.find(n => n.id === route) || HIDDEN_ROUTES[route];
      $("#title").textContent = t(item.label);
      document.title = `${t(item.label)} · ResInvest ERP`;
      const page = $("#page");
      const view = Views[route];
      try {
        page.innerHTML = view.html(params, opts);
        if (view.bind) view.bind(page, params, opts);
      } catch (e) {
        console.error(e);
        page.innerHTML = `<div class="info-line err">${ic("alert", 15)}<span>${esc(t("Nie udało się wyświetlić ekranu: {m}", { m: e.message }))}</span></div>`;
      }
      if (changed) root.scrollTo(0, 0);
    },
    navBadge(id) {
      const S = Store.state, u = this.user();
      if (id === "inwentaryzacja") { const n = S.inventory.filter(p => p.whId === u.whId && p.status === "OTWARTA").length; return n ? `<span class="cnt">${n}</span>` : ""; }
      if (id === "operacje") { const n = S.drafts.filter(d => d.userId === u.id).length; return n ? `<span class="cnt" title="${esc(t("Wersje robocze"))}">${n}</span>` : ""; }
      return "";
    },
    go(route) { if (location.hash !== "#/" + route) location.hash = "#/" + route; else this.render(); }
  };

  /* ------------------------------------------------------------------ */
  /* Logowanie, kreator pierwszego uruchomienia, zmiana hasła            */
  /* ------------------------------------------------------------------ */
  const pwField = (id, label, auto) => `<div class="field"><label for="${id}">${esc(label)}</label><div class="input-wrap"><input class="ctrl" type="password" id="${id}" autocomplete="${auto}" spellcheck="false" style="padding-right:44px"><button class="eye" type="button" data-eye="${id}" aria-label="${esc(t("Pokaż hasło"))}">${ic("eye", 16)}</button></div></div>`;
  function bindEyes(scope) {
    $$("[data-eye]", scope).forEach(b => b.onclick = () => { const i = $("#" + b.dataset.eye, scope); const show = i.type === "password"; i.type = show ? "text" : "password"; b.innerHTML = ic(show ? "eyeOff" : "eye", 16); b.setAttribute("aria-label", show ? t("Ukryj hasło") : t("Pokaż hasło")); });
  }
  /** Siła hasła: 0–4 (długość, litery, cyfry, znaki specjalne). */
  const pwScore = p => [p.length >= 8, /[a-zA-Z]/.test(p) && /\d/.test(p), p.length >= 12, /[^a-zA-Z0-9]/.test(p)].filter(Boolean).length;
  const pwMeter = id => `<div class="pw-meter" id="${id}" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`;
  function bindMeter(input, meter) {
    const upd = () => { const s = pwScore(input.value); $$("i", meter).forEach((x, i) => x.classList.toggle("on", i < s)); meter.classList.toggle("good", s >= 3); };
    input.addEventListener("input", upd); upd();
  }

  const Auth = {
    screen: null, opts: {},
    rerender() { if (this.screen === "login") this.loginScreen(this.opts); else if (this.screen === "setup") this.setupScreen(); else if (this.screen === "force") this.forceChange(); },
    tools() {
      return `<div class="auth-tools">
        <div class="seg" role="group" aria-label="${esc(t("Język"))}">${Object.values(I18N.LANGS).map(L => `<button type="button" data-auth-lang="${L.code}" aria-pressed="${L.code === I18N.lang}" title="${esc(L.label)}">${L.short}</button>`).join("")}</div>
        <div class="seg" role="group" aria-label="${esc(t("Motyw"))}">${THEME_LIST.map(th => `<button type="button" data-auth-theme="${th.id}" aria-pressed="${th.id === Prefs.theme}" title="${esc(t(th.label))}">${ic(th.icon, 14)}</button>`).join("")}</div></div>`;
    },
    bindTools(scope) {
      $$("[data-auth-lang]", scope).forEach(b => b.onclick = () => { Prefs.applyLang(b.dataset.authLang); lsSet("riw.lang", I18N.lang); this.rerender(); });
      $$("[data-auth-theme]", scope).forEach(b => b.onclick = () => { Prefs.applyTheme(b.dataset.authTheme); lsSet("riw.theme", Prefs.theme); this.rerender(); });
    },
    side() {
      return `<section class="auth-side" aria-hidden="true"><div class="rings"></div>
        <div class="auth-brand"><div class="mark">RI</div><div><b>ResInvest ERP</b><span>${esc(t("Obrót i magazynowanie biomasy drzewnej"))}</span></div></div>
        <div><h2>${esc(t("Biomasa pod pełną kontrolą"))}</h2><p>${esc(t("Zakupy, produkcja zrębki, sprzedaż, transport i inwentaryzacja w jednym systemie — z historią każdej zmiany, raportami miesięcznymi i rocznymi oraz kopiami zapasowymi."))}</p></div>
        <div class="auth-facts"><div><b>3</b><span>${esc(t("języki: PL · CS · EN"))}</span></div><div><b>3</b><span>${esc(t("motywy kolorystyczne"))}</span></div><div><b>100%</b><span>${esc(t("operacji w dzienniku audytu"))}</span></div></div></section>`;
    },
    loginScreen(opts = {}) {
      this.screen = "login"; this.opts = opts;
      document.title = t("Logowanie") + " · ResInvest ERP";
      const local = Store.mode === "local";
      const demo = local && Store.state ? Store.state.users.filter(u => AuthLib.DEMO_LOGINS.includes(u.login) && u.active !== false && AuthLib.LocalAuth.info(u.id).demo) : [];
      document.getElementById("app").innerHTML = `<div class="auth" id="auth-screen">${this.side()}
        <section class="auth-form">${this.tools()}
          <div class="auth-box">
            <h3>${esc(t("Zaloguj się"))}</h3>
            <p class="lead">${esc(local ? t("Tryb lokalny — dane zapisywane w tej przeglądarce.") : t("Serwer ResInvest ERP — praca wielostanowiskowa."))}</p>
            ${opts.info ? `<div class="info-line mt4">${ic("alert", 15)}<span id="auth-info">${esc(opts.info)}</span></div>` : ""}
            <form id="login-form" novalidate autocomplete="on">
              <div class="field"><label for="lg-login">${esc(t("Login"))}</label><input class="ctrl" id="lg-login" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(opts.login || lsGet("riw.lastLogin", ""))}"></div>
              ${pwField("lg-pass", t("Hasło"), "current-password")}
              <div class="caps hidden" id="lg-caps">${esc(t("Włączony Caps Lock"))}</div>
              <div class="auth-err hidden" id="lg-err" role="alert"></div>
              <button class="btn primary lg block" type="submit" id="lg-submit">${ic("lock", 16)} ${esc(t("Zaloguj"))}</button>
            </form>
            ${demo.length ? `<div class="auth-divider">${esc(t("Konta demonstracyjne"))}</div>
              <div class="auth-users" id="demo-users">${demo.map(u => `<button class="auth-user" type="button" data-demo="${esc(u.login)}"><span class="avatar">${esc(initials(u.name))}</span><div><b>${esc(u.name)}</b><small>${esc(u.login)} · ${esc(App.roleLabel(u.role))} · ${esc(App.whName(u.whId))}</small></div></button>`).join("")}</div>
              <p class="help mt2">${esc(t("Hasło kont demonstracyjnych: {p} — zmień je w „Mój profil” przed pracą na prawdziwych danych.", { p: AuthLib.DEMO_PASSWORD }))}</p>` : ""}
            <p class="auth-foot">ResInvest ERP ${esc(R.VERSION)} · ${esc(t("Konto blokuje się na {m} min po {n} nieudanych próbach.", { m: AuthLib.POLICY.lockMinutes, n: AuthLib.POLICY.maxFailed }))}</p>
          </div></section></div>`;
      const scope = $("#auth-screen");
      this.bindTools(scope); bindEyes(scope);
      const login = $("#lg-login"), pass = $("#lg-pass"), err = $("#lg-err");
      pass.addEventListener("keyup", e => $("#lg-caps").classList.toggle("hidden", !(e.getModifierState && e.getModifierState("CapsLock"))));
      $$("[data-demo]", scope).forEach(b => b.onclick = () => { login.value = b.dataset.demo; pass.value = AuthLib.DEMO_PASSWORD; pass.focus(); });
      $("#login-form").onsubmit = async e => {
        e.preventDefault();
        const btn = $("#lg-submit");
        btn.disabled = true; err.classList.add("hidden");
        const res = await Store.backend.login(login.value.trim(), pass.value);
        btn.disabled = false;
        if (!res.ok) { err.innerHTML = ic("alert", 15) + `<span>${esc(res.error)}</span>`; err.classList.remove("hidden"); pass.select(); return; }
        lsSet("riw.lastLogin", login.value.trim().toLowerCase());
        pass.value = "";
        this.screen = null;
        App.afterLogin(res);
      };
      (login.value ? pass : login).focus();
    },
    /** Pierwsze uruchomienie serwera: konto administratora, magazyn, dane przykładowe. */
    setupScreen() {
      this.screen = "setup";
      document.title = t("Pierwsze uruchomienie") + " · ResInvest ERP";
      document.getElementById("app").innerHTML = `<div class="auth" id="setup-screen">${this.side()}
        <section class="auth-form">${this.tools()}
          <div class="auth-box" style="max-width:440px">
            <h3>${esc(t("Pierwsze uruchomienie serwera"))}</h3>
            <p class="lead">${esc(t("Utwórz konto administratora. Pozostałych użytkowników dodasz w module Użytkownicy."))}</p>
            <form id="setup-form" novalidate>
              <div class="field"><label for="su-name">${esc(t("Imię i nazwisko administratora"))}</label><input class="ctrl" id="su-name" autocomplete="name"></div>
              <div class="field"><label for="su-login">${esc(t("Login"))}</label><input class="ctrl" id="su-login" value="admin" autocapitalize="off" spellcheck="false" autocomplete="username"></div>
              ${pwField("su-pass", t("Hasło"), "new-password")}${pwMeter("su-meter")}
              ${pwField("su-pass2", t("Powtórz hasło"), "new-password")}
              <div class="field"><label for="su-wh">${esc(t("Nazwa magazynu głównego"))}</label><input class="ctrl" id="su-wh" value="${esc(t("Magazyn główny"))}"></div>
              <label class="inline-opt"><input type="checkbox" id="su-sample"> ${esc(t("Załaduj dane przykładowe (do nauki i testów)"))}</label>
              <div class="auth-err hidden" id="su-err" role="alert"></div>
              <button class="btn primary lg block" type="submit" id="su-submit">${ic("check", 16)} ${esc(t("Utwórz i zaloguj"))}</button>
            </form></div></section></div>`;
      const scope = $("#setup-screen");
      this.bindTools(scope); bindEyes(scope); bindMeter($("#su-pass"), $("#su-meter"));
      $("#setup-form").onsubmit = async e => {
        e.preventDefault();
        const err = $("#su-err"), fail = m => { err.innerHTML = ic("alert", 15) + `<span>${esc(m)}</span>`; err.classList.remove("hidden"); };
        const name = $("#su-name").value.trim(), login = $("#su-login").value.trim().toLowerCase(), pw = $("#su-pass").value;
        if (name.length < 3) return fail(t("Podaj imię i nazwisko (co najmniej 3 znaki)"));
        if (pw !== $("#su-pass2").value) return fail(t("Hasła nie są takie same"));
        const pe = AuthLib.passwordError(pw, login); if (pe) return fail(pe);
        $("#su-submit").disabled = true;
        const r = await ServerBackend.api("POST", "/api/setup", { name, login, password: pw, whName: $("#su-wh").value.trim(), sample: $("#su-sample").checked, lang: I18N.lang });
        $("#su-submit").disabled = false;
        if (!r || !r.ok) return fail((r && r.error) || t("Nie udało się utworzyć konta"));
        const res = await Store.backend.login(login, pw);
        if (!res.ok) return fail(res.error);
        this.screen = null; App.afterLogin(res);
      };
      $("#su-name").focus();
    },
    /** Hasło startowe lub zresetowane przez administratora — zmiana przed pracą. */
    forceChange() {
      this.screen = "force";
      const u = App.user();
      document.getElementById("app").innerHTML = `<div class="auth" id="force-screen">${this.side()}
        <section class="auth-form">${this.tools()}
          <div class="auth-box">
            <h3>${esc(t("Ustaw nowe hasło"))}</h3>
            <p class="lead">${esc(t("{n}, administrator ustawił hasło tymczasowe. Przed rozpoczęciem pracy ustaw własne hasło.", { n: u.name }))}</p>
            <form id="force-form" novalidate>
              ${pwField("fc-old", t("Hasło tymczasowe"), "current-password")}
              ${pwField("fc-new", t("Nowe hasło"), "new-password")}${pwMeter("fc-meter")}
              ${pwField("fc-new2", t("Powtórz nowe hasło"), "new-password")}
              <p class="help">${esc(t("Hasło musi mieć: {x}", { x: [t("co najmniej {n} znaków", { n: AuthLib.POLICY.minLength }), t("litery i cyfry")].join(", ") }))}</p>
              <div class="auth-err hidden" id="fc-err" role="alert"></div>
              <button class="btn primary lg block" type="submit">${ic("check", 16)} ${esc(t("Zapisz hasło i przejdź dalej"))}</button>
              <button class="btn ghost block" type="button" id="fc-logout">${esc(t("Wyloguj"))}</button>
            </form></div></section></div>`;
      const scope = $("#force-screen");
      this.bindTools(scope); bindEyes(scope); bindMeter($("#fc-new"), $("#fc-meter"));
      $("#fc-logout").onclick = () => App.logout();
      $("#force-form").onsubmit = async e => {
        e.preventDefault();
        const err = $("#fc-err"), fail = m => { err.innerHTML = ic("alert", 15) + `<span>${esc(m)}</span>`; err.classList.remove("hidden"); };
        if ($("#fc-new").value !== $("#fc-new2").value) return fail(t("Hasła nie są takie same"));
        const r = await Store.backend.changePassword($("#fc-old").value, $("#fc-new").value);
        if (!r || !r.ok) return fail((r && r.error) || t("Nie udało się zmienić hasła"));
        await Store.backend.afterPasswordChange();
        App.afterLogin({ ok: true, mustChange: false });
        Toast.info(t("Hasło zmienione"));
      };
      $("#fc-old").focus();
    },
    changePasswordDialog() {
      const m = Modal.open({ title: t("Zmiana hasła"), id: "pw-dialog",
        body: `<div class="stack">${pwField("cp-old", t("Obecne hasło"), "current-password")}${pwField("cp-new", t("Nowe hasło"), "new-password")}${pwMeter("cp-meter")}${pwField("cp-new2", t("Powtórz nowe hasło"), "new-password")}
          <p class="help">${esc(t("Hasło musi mieć: {x}", { x: [t("co najmniej {n} znaków", { n: AuthLib.POLICY.minLength }), t("litery i cyfry")].join(", ") }))}</p><div class="msg hidden" id="cp-msg" role="alert"></div></div>`,
        footer: `<button class="btn ghost" type="button" data-no>${esc(t("Anuluj"))}</button><button class="btn primary" type="button" data-yes>${esc(t("Zmień hasło"))}</button>` });
      bindEyes(m.el); bindMeter($("#cp-new", m.el), $("#cp-meter", m.el));
      $("[data-no]", m.el).onclick = () => m.close();
      $("[data-yes]", m.el).onclick = async () => {
        const msg = $("#cp-msg", m.el), fail = x => { msg.textContent = x; msg.classList.remove("hidden"); };
        if ($("#cp-new", m.el).value !== $("#cp-new2", m.el).value) return fail(t("Hasła nie są takie same"));
        const r = await Store.backend.changePassword($("#cp-old", m.el).value, $("#cp-new", m.el).value);
        if (!r || !r.ok) return fail((r && r.error) || t("Nie udało się zmienić hasła"));
        m.close(); Toast.ok(t("Hasło zmienione"), t("Użyj nowego hasła przy następnym logowaniu."));
      };
    }
  };

  const Views = {};
  const statusBadge = st => `<span class="badge st-${esc(st)}" data-status="${esc(st)}">${esc(t(R.STATUS[st] || st))}</span>`;

  root.RIWUI = { R, I18N, t, tp, N_, esc, $, $$, ic, fid, str, lsGet, lsSet, ssGet, ssSet, initials, download, csvNum, toCSV, Toast, Modal, Dropdown, Store, LocalBackend, ServerBackend, App, Auth, Prefs, THEME_LIST, Views, statusBadge, KEY, DRAFT_KEY, NAV, pwField, bindEyes, pwMeter, bindMeter };
  root.App = App;
  root.Dropdown = Dropdown;
})(typeof globalThis !== "undefined" ? globalThis : this);
