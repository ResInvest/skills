/* =========================================================================
   ResInvest ERP 3.0 — kartoteki (produkty, kontrahenci, magazyny),
   użytkownicy i hasła, mój profil, administracja (kopie, dziennik logowań,
   uprawnienia, preferencje, narzędzia trybu lokalnego).
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, I18N, t, tp, N_, esc, $, $$, ic, download, Toast, Modal, Store, LocalBackend, ServerBackend, App, Auth, Prefs, THEME_LIST, Views, initials, lsGet, lsSet, ssGet, ssSet, DRAFT_KEY, pwField, bindEyes, pwMeter, bindMeter, opPartnerId, searchInput, bindSearch } = UI;
  const { fmt, fmtQ, money, Units, Dates, Stock } = R;
  const AuthLib = root.RIW_Auth;
  const th = s => esc(t(s));
  const SRC_MASTER = N_("Kartoteki"), SRC_USERS = N_("Administracja — użytkownicy");

  /** Pole formularza okna edycji z miejscem na komunikat walidacji. */
  const ff = (k, label, ctrl, help, span) => `<div class="field ${span || ""}" data-ff="${k}"><label for="me-${k}">${esc(label)}</label>${ctrl}<div class="msg hidden" data-fmsg="${k}"></div>${help ? `<div class="help">${esc(help)}</div>` : ""}</div>`;
  const opts = (arr, v) => arr.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("");
  const showErrors = (m, res) => {
    $$("[data-fmsg]", m.el).forEach(x => x.classList.add("hidden"));
    for (const [k, msg] of Object.entries(res.errors || {})) { const x = $(`[data-fmsg="${k}"]`, m.el); if (x) { x.textContent = msg; x.classList.remove("hidden"); } }
  };
  const activeBadge = a => a === false ? `<span class="badge">${th("nieaktywny")}</span>` : `<span class="badge ok">${th("aktywny")}</span>`;

  /* ================================================================== */
  /* Kartoteki                                                            */
  /* ================================================================== */
  const Master = {
    edit(kind, id) {
      const S = Store.state, rec = id ? R.clone(R.byId(S[kind], id)) : ({ products: { code: "", name: "", cat: "zrebka", unit: "MP", active: true }, partners: { name: "", role: "supplier", kind: "firma", city: "", address: "", nip: "", phone: "", email: "", lesnictwa: [], active: true }, warehouses: { code: "", name: "", address: "", active: true } })[kind];
      let body = "";
      if (kind === "products") {
        const used = id && R.Master.usedProduct(S, id);
        body = `<div class="fgrid">${ff("code", t("Kod"), `<input class="ctrl" id="me-code" value="${esc(rec.code)}" maxlength="12" autocapitalize="characters">`)}
          ${ff("name", t("Nazwa"), `<input class="ctrl" id="me-name" value="${esc(rec.name)}">`)}
          ${ff("cat", t("Kategoria"), `<select class="ctrl" id="me-cat" ${used ? "disabled" : ""}>${opts(Object.entries(R.PRODUCT_CATS).map(([k, v]) => [k, `${t(v)} (${Units.label(R.CAT_UNIT[k])})`]), rec.cat)}</select>`, used ? t("Produkt ma ruchy w księdze — jednostki magazynowej nie można zmienić") : t("Kategoria wyznacza jednostkę magazynową: drewno m³, zrębka MP, produkty tonowe t."))}
          ${ff("tPerUnit", t("Masa 1 jednostki [t] (opcjonalnie)"), `<input class="ctrl num-in" id="me-tPerUnit" inputmode="decimal" value="${esc(rec.tPerUnit != null ? fmtQ(rec.tPerUnit, 4) : "")}" placeholder="${esc(t("domyślnie z konfiguracji"))}">`, t("Dotyczy drewna (m³). Zrębka: {a} t/MP, produkty tonowe: 1 t.", { a: fmt(S.config.mp_t, 2) }))}
          ${ff("active", t("Status"), `<select class="ctrl" id="me-active">${opts([["true", t("aktywny")], ["false", t("nieaktywny")]], String(rec.active !== false))}</select>`)}</div>`;
      } else if (kind === "partners") {
        body = `<div class="fgrid">${ff("name", t("Nazwa"), `<input class="ctrl" id="me-name" value="${esc(rec.name)}">`, "", "span-all")}
          ${ff("role", t("Rola"), `<select class="ctrl" id="me-role">${opts(Object.entries(R.PARTNER_ROLES).map(([k, v]) => [k, t(v)]), rec.role)}</select>`)}
          ${ff("kind", t("Grupa dostawcy"), `<select class="ctrl" id="me-kind">${opts(Object.entries(R.SUPPLIER_KINDS).map(([k, v]) => [k, t(v.label)]), rec.kind || "firma")}</select>`, t("Firma → podstawa domyślnie KZR, nadleśnictwo → Deklaracja."))}
          ${ff("nip", "NIP", `<input class="ctrl" id="me-nip" value="${esc(rec.nip || "")}" inputmode="numeric" placeholder="${esc(t("np. {x}", { x: "6310000000" }))}">`)}
          ${ff("city", t("Miejscowość"), `<input class="ctrl" id="me-city" value="${esc(rec.city || "")}">`)}
          ${ff("address", t("Adres"), `<input class="ctrl" id="me-address" value="${esc(rec.address || "")}">`, "", "span-all")}
          ${ff("phone", t("Telefon"), `<input class="ctrl" id="me-phone" value="${esc(rec.phone || "")}" inputmode="tel">`)}
          ${ff("email", t("E-mail"), `<input class="ctrl" id="me-email" type="email" value="${esc(rec.email || "")}">`)}
          ${ff("lesnictwa", t("Leśnictwa (dla nadleśnictwa, oddzielone przecinkami)"), `<input class="ctrl" id="me-lesnictwa" value="${esc((rec.lesnictwa || []).join(", "))}">`, "", "span-all")}
          ${ff("active", t("Status"), `<select class="ctrl" id="me-active">${opts([["true", t("aktywny")], ["false", t("nieaktywny")]], String(rec.active !== false))}</select>`, t("Nieaktywny kontrahent nie pojawia się w nowych operacjach; historia zostaje."))}</div>`;
      } else {
        body = `<div class="fgrid">${ff("code", t("Kod"), `<input class="ctrl" id="me-code" value="${esc(rec.code)}" maxlength="12" autocapitalize="characters">`)}
          ${ff("name", t("Nazwa"), `<input class="ctrl" id="me-name" value="${esc(rec.name)}">`)}
          ${ff("address", t("Adres"), `<input class="ctrl" id="me-address" value="${esc(rec.address || "")}">`, "", "span-all")}
          ${ff("active", t("Status"), `<select class="ctrl" id="me-active">${opts([["true", t("aktywny")], ["false", t("nieaktywny")]], String(rec.active !== false))}</select>`, t("Magazyn można dezaktywować, gdy ma zerowe stany i nie ma przypisanych aktywnych użytkowników."))}</div>`;
      }
      const label = t(R.Master.KINDS[kind].label).toLowerCase();
      const m = Modal.open({ title: `${id ? t("Edycja") : t("Nowy")}: ${label}`, id: "master-edit", wide: kind === "partners", body,
        footer: `<button class="btn ghost" type="button" data-no>${th("Anuluj")}</button><button class="btn primary" type="button" data-yes>${ic("check", 15)} ${th("Zapisz")}</button>` });
      const syncKind = () => { const r = $("#me-role", m.el), k = $("[data-ff=kind]", m.el); if (r && k) k.classList.toggle("hidden", r.value === "buyer"); };
      const rs = $("#me-role", m.el); if (rs) { rs.onchange = syncKind; syncKind(); }
      $("[data-no]", m.el).onclick = () => m.close();
      $("[data-yes]", m.el).onclick = async () => {
        const next = Object.assign({}, rec, id ? { id } : {});
        for (const f of R.Master.KINDS[kind].fields) { const el = $("#me-" + f, m.el); if (el && !el.disabled) next[f] = el.value; }
        next.active = next.active === true || next.active === "true";
        if (kind === "products") next.unit = R.CAT_UNIT[next.cat];
        const res = await Store.exec("master.save", { kind, rec: next }, SRC_MASTER);
        if (!res.ok) { showErrors(m, res); Toast.err(t("Nie zapisano"), res.error); return; }
        m.close(); Toast.ok(t("Zapisano"), res.rec.name); App.render();
      };
    }
  };
  const addBtn = (kind, label) => App.can("master.edit") ? `<button class="btn primary" type="button" data-madd="${kind}">${ic("plus", 15)} ${th(label)}</button>` : `<span class="badge">${th("tylko podgląd — edycja: Kierownik / Administrator")}</span>`;
  const editBtn = (kind, id) => App.can("master.edit") ? `<button class="btn sm" type="button" data-medit="${kind}|${esc(id)}">${ic("edit", 13)} ${th("Edytuj")}</button> <button class="btn sm danger" type="button" data-mdel="${kind}|${esc(id)}" title="${esc(t("Usuń"))}" aria-label="${esc(t("Usuń"))}">${ic("trash", 13)}</button>` : "";
  function bindMaster(page) {
    $$("[data-madd]", page).forEach(b => b.onclick = () => Master.edit(b.dataset.madd, null));
    $$("[data-mdel]", page).forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const [k, id] = b.dataset.mdel.split("|"), rec = R.byId(Store.state[k], id);
      const r = await Modal.confirm({ title: t("Usunąć: {n}?", { n: rec ? rec.name : "" }), text: t("Usunąć można tylko rekord, który nie występuje w żadnym dokumencie. Rekord z historią dezaktywuj — historia zostaje."), ok: t("Usuń"), danger: true });
      if (!r.ok) return;
      const res = await Store.exec("master.remove", { kind: k, id }, SRC_MASTER);
      if (res.ok) Toast.ok(t("Usunięto"), rec ? rec.name : ""); else Toast.err(t("Nie usunięto"), res.error);
      App.render();
    });
    $$("[data-medit]", page).forEach(b => b.onclick = e => { e.stopPropagation(); const [k, id] = b.dataset.medit.split("|"); Master.edit(k, id); });
  }

  Views.produkty = {
    html() {
      const S = Store.state, cfg = S.config, stock = Stock.byProduct(S, null);
      return `<div class="page-head"><div class="titles"><h2>${th("Produkty")}</h2><p>${th("Kartoteka produktów z jednostką magazynową i przelicznikami. Jednostka magazynowa decyduje o dozwolonych jednostkach na dokumentach i nie zmienia się po pierwszym ruchu w księdze.")}</p></div>
          <div class="actions">${addBtn("products", N_("Nowy produkt"))}</div></div>
        <div class="card"><div class="tbl-wrap"><table class="tbl" id="products-table"><thead><tr><th>${th("Kod")}</th><th>${th("Nazwa")}</th><th>${th("Kategoria")}</th><th>${th("Jedn. magazynowa")}</th><th>${th("Dozwolone jednostki")}</th><th class="r">${th("Masa ≈ t / jedn.")}</th><th class="r">${th("Energia ≈ GJ / jedn.")}</th><th>${th("Przelicznik produkcji")}</th><th class="r">${th("Stan firmy")}</th><th>${th("Status")}</th><th></th></tr></thead><tbody>
          ${S.products.map(p => { const m = Units.massPerUnit(p, cfg); return `<tr class="${p.active === false ? "void" : ""}"><td class="mono">${esc(p.code)}</td><td><b>${esc(p.name)}</b></td><td>${esc(t(R.PRODUCT_CATS[p.cat] || p.cat))}</td><td>${Units.label(p.unit)}</td><td>${Units.allowed(p).map(Units.label).join(", ")}</td><td class="r">${fmt(m, 3)}</td><td class="r">${fmt(m * cfg.t_gj, 2)}</td><td>${esc(p.unit === "m3" ? t("1 m³ → {q} MP zrębki", { q: fmtQ(cfg.m3_mp) }) : p.unit === "MP" ? t("z drewna: 1 MP = {q} m³", { q: fmtQ(1 / cfg.m3_mp, 3) }) : t("brak (tylko t)"))}</td><td class="r">${esc(App.qtyNative(stock.get(p.id) || 0, p.id))}</td><td>${activeBadge(p.active)}</td><td class="r">${editBtn("products", p.id)}</td></tr>`; }).join("")}</tbody></table></div></div>
        <div class="card mt4"><div class="card-h"><h3>${th("Przeliczniki (config/app.config.json)")}</h3></div><div class="card-b"><dl class="money-list" style="max-width:560px"><dt>${th("1 m³ drewna")}</dt><dd>${fmtQ(cfg.m3_mp)} MP</dd><dt>1 MP</dt><dd>${fmtQ(1 / cfg.m3_mp, 3)} m³ · ${fmt(cfg.mp_t, 2)} t</dd><dt>${th("1 m³ drewna (masa)")}</dt><dd>${fmt(cfg.woodTPerM3, 3)} t</dd><dt>1 t</dt><dd>${fmt(cfg.t_gj, 1)} GJ</dd></dl></div></div>`;
    },
    bind(page) { bindMaster(page); }
  };

  Views.kontrahenci = {
    html() {
      const S = Store.state;
      const f = App.tabs.partners || (App.tabs.partners = { role: "", q: "", show: "active" });
      const stats = new Map();
      for (const op of S.operations) { if (op.status === "CANCELLED") continue; const pid = opPartnerId(op); if (!pid) continue; const s = stats.get(pid) || { n: 0, buy: 0, sell: 0, last: "" }; s.n++; s.buy += op.type === "ZAKUP" ? op.totals.purchaseCost : 0; s.sell += op.totals.revenue; if (op.date > s.last) s.last = op.date; stats.set(pid, s); }
      const q = f.q.trim().toLowerCase();
      const rows = S.partners.filter(p => (!f.role || p.role === f.role || p.role === "both") && (f.show === "all" || p.active !== false) && (!q || [p.name, p.city, p.nip].join(" ").toLowerCase().includes(q)));
      return `<div class="page-head"><div class="titles"><h2>${th("Kontrahenci")}</h2><p>${th("Dostawcy i odbiorcy z obrotem (bez dokumentów anulowanych). Kliknij „Raport”, aby zobaczyć raport roczny z filtrem kontrahenta.")}</p></div>
          <div class="actions">${addBtn("partners", N_("Nowy kontrahent"))}</div></div>
        <div class="card"><div class="toolbar"><div class="field"><label for="pa-role">${th("Rola")}</label><select class="ctrl" id="pa-role"><option value="">${th("Wszyscy")}</option><option value="supplier" ${f.role === "supplier" ? "selected" : ""}>${th("Dostawcy")}</option><option value="buyer" ${f.role === "buyer" ? "selected" : ""}>${th("Odbiorcy")}</option></select></div>
          <div class="field"><label for="pa-show">${th("Status")}</label><select class="ctrl" id="pa-show"><option value="active" ${f.show === "active" ? "selected" : ""}>${th("aktywni")}</option><option value="all" ${f.show === "all" ? "selected" : ""}>${th("wszyscy")}</option></select></div>
          <div class="field grow"><label for="pa-q">${th("Szukaj")}</label><input class="ctrl" type="search" id="pa-q" value="${esc(f.q)}" placeholder="${th("nazwa, miejscowość, NIP…")}"></div></div>
          <div class="tbl-wrap"><table class="tbl" id="partners-table"><thead><tr><th>${th("Nazwa")}</th><th>${th("Rola")}</th><th>${th("Grupa dostawcy")}</th><th>${th("Miejscowość")}</th><th>NIP</th><th class="r">${th("Operacje")}</th><th class="r">${th("Zakupy")}</th><th class="r">${th("Sprzedaż")}</th><th>${th("Ostatnia operacja")}</th><th></th></tr></thead><tbody>
            ${rows.map(p => { const s = stats.get(p.id) || { n: 0, buy: 0, sell: 0, last: "" }; return `<tr class="${p.active === false ? "void" : ""}"><td><b>${esc(p.name)}</b></td><td>${esc(t(R.PARTNER_ROLES[p.role]))}</td><td>${p.role === "buyer" ? "—" : esc(t(R.SUPPLIER_KINDS[R.partnerKind(p)].label))}${p.lesnictwa && p.lesnictwa.length ? `<br><small class="dim">${esc(t("leśnictwa: {x}", { x: p.lesnictwa.join(", ") }))}</small>` : ""}${p.createdBy ? `<br><small class="dim">${esc(t("dodał: {u}", { u: p.createdBy }))}</small>` : ""}</td><td>${esc(p.city || "")}</td><td class="mono">${esc(p.nip || "")}</td><td class="r">${s.n}</td><td class="r">${esc(money(s.buy))}</td><td class="r">${esc(money(s.sell))}</td><td>${esc(Dates.pl(s.last) || "—")}</td><td class="r nowrap"><button class="btn sm" type="button" data-prep="${esc(p.id)}">${th("Raport")}</button> ${editBtn("partners", p.id)}</td></tr>`; }).join("")}</tbody></table></div></div>`;
    },
    bind(page) {
      const f = App.tabs.partners;
      $("#pa-role", page).onchange = e => { f.role = e.target.value; App.render(); };
      $("#pa-show", page).onchange = e => { f.show = e.target.value; App.render(); };
      $("#pa-q", page).oninput = e => { f.q = e.target.value; clearTimeout(this._t); this._t = setTimeout(() => { App.render(); const x = $("#pa-q"); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 250); };
      $$("[data-prep]", page).forEach(b => b.onclick = () => { const rf = root.RIWViews.Reports.f(); rf.partnerId = b.dataset.prep; rf.mode = "year"; rf.year = App.today().slice(0, 4); App.go("raporty"); });
      bindMaster(page);
    }
  };

  Views.magazyny = {
    html() {
      const S = Store.state;
      return `<div class="page-head"><div class="titles"><h2>${th("Magazyny")}</h2><p>${th("Magazyny firmy z przypisanymi kierownikami, magazynierami i flotą, stanem i zamkniętymi okresami. Ludzi przydziela się w module Użytkownicy, pojazdy i rębaki — w module Flota.")}</p></div>
          <div class="actions">${addBtn("warehouses", N_("Nowy magazyn"))}</div></div>
        <div class="grid g2">${S.warehouses.map(w => {
          const m = Stock.byProduct(S, w.id), per = {};
          for (const [pid, q] of m) { const p = App.product(pid); if (Math.abs(q) > R.EPS) per[p.unit] = R.rq((per[p.unit] || 0) + q); }
          return `<div class="card" data-wh="${esc(w.id)}"><div class="card-h"><h3>${esc(w.name)}</h3><span class="sub">${esc(w.code)}</span>${activeBadge(w.active)}<span class="spacer"></span>${editBtn("warehouses", w.id)}</div><div class="card-b">
            <dl class="money-list"><dt>${th("Adres")}</dt><dd>${esc(w.address || "")}</dd><dt>${th("Stan wg jednostek")}</dt><dd>${esc(Object.entries(per).map(([u, q]) => `${fmtQ(q)} ${Units.label(u)}`).join(" · ") || "—")}</dd>
            <dt>${th("Zamknięte do")}</dt><dd>${esc(R.lockedMonth(S, w.id) || "—")}</dd>${["kierownik", "magazynier", "obserwator", "admin"].map(r => { const us = S.users.filter(u => u.whId === w.id && u.role === r && u.active !== false && !u.pending); return us.length ? `<dt>${esc(t(R.ROLES[r].label))}</dt><dd>${esc(us.map(u => u.name).join(", "))}</dd>` : ""; }).join("")}
            <dt>${th("Pojazdy")}</dt><dd>${esc(S.fleet.vehicles.filter(v => v.whId === w.id).map(v => `${v.reg}`).join(", ") || "—")}</dd>
            <dt>${th("Kierowcy")}</dt><dd>${esc(S.fleet.drivers.filter(v => v.whId === w.id).map(v => v.name).join(", ") || "—")}</dd>
            <dt>${th("Rębaki i operatorzy")}</dt><dd>${esc(S.fleet.chippers.filter(v => v.whId === w.id).map(v => v.name).concat(S.fleet.operators.filter(v => v.whId === w.id).map(v => v.name)).join(", ") || "—")}</dd>
            <dt>${th("Operacje")}</dt><dd>${S.operations.filter(o => o.whId === w.id).length}</dd></dl></div></div>`; }).join("")}</div>`;
    },
    bind(page) { bindMaster(page); }
  };

  /* ================================================================== */
  /* Użytkownicy                                                          */
  /* ================================================================== */
  const Users = {
    async accounts() {
      if (Store.mode === "server") return ServerBackend.accounts();
      const out = {}; for (const u of Store.state.users) out[u.id] = AuthLib.LocalAuth.info(u.id); return out;
    },
    edit(id, how = {}) {
      const S = Store.state, isNew = !id;
      const rec = id ? R.clone(R.byId(S.users, id)) : { name: "", login: "", role: "magazynier", whId: App.user().whId, active: true, lang: "", theme: "", email: "", phone: "" };
      const self = id === Store.userId, approving = !!(rec.pending && how.approve);
      const domains = (S.config.companyDomains || []).map(d => "@" + d).join(", ");
      const roleHelp = r => `<span data-role-help>${esc(t(R.ROLE_INFO[r] || ""))}</span>`;
      const body = `<div class="fgrid">
        ${approving ? `<div class="span-all info-line">${ic("user", 15)}<span>${esc(t("Zgłoszenie z rejestracji ({d}). Nadaj rolę i magazyn — zapis aktywuje konto.", { d: Dates.ts(rec.registeredAt) }))}</span></div>` : ""}
        ${ff("name", t("Imię i nazwisko"), `<input class="ctrl" id="me-name" value="${esc(rec.name)}" autocomplete="off">`)}
        ${ff("login", t("E-mail firmowy (login)"), `<input class="ctrl" id="me-login" type="email" value="${esc(rec.login)}" autocapitalize="off" spellcheck="false" autocomplete="off" placeholder="${esc(t("imie.nazwisko@resinvest.group"))}">`, domains ? t("Dozwolone domeny: {d}", { d: domains }) : "")}
        ${ff("role", t("Rola"), `<select class="ctrl" id="me-role" ${self ? "disabled" : ""}>${opts(Object.entries(R.ROLES).map(([k, v]) => [k, t(v.label)]), approving && rec.role === "obserwator" ? "magazynier" : rec.role)}</select>`, self ? t("Nie możesz zmienić własnej roli") : roleHelp(approving && rec.role === "obserwator" ? "magazynier" : rec.role))}
        ${ff("whId", t("Magazyn"), `<select class="ctrl" id="me-whId">${opts(S.warehouses.filter(w => w.active !== false || w.id === rec.whId).map(w => [w.id, w.name]), rec.whId)}</select>`, t("Kierownik zatwierdza operacje tego magazynu; Administrator ma dostęp do wszystkich."))}
        ${ff("phone", t("Telefon"), `<input class="ctrl" id="me-phone" type="tel" value="${esc(rec.phone || "")}">`)}
        ${ff("lang", t("Język interfejsu"), `<select class="ctrl" id="me-lang">${opts([["", t("wybór użytkownika / przeglądarki")]].concat(Object.values(I18N.LANGS).map(L => [L.code, L.label])), rec.lang)}</select>`)}
        ${isNew ? "" : ff("active", t("Status konta"), `<select class="ctrl" id="me-active" ${self ? "disabled" : ""}>${opts([["true", t("aktywne")], ["false", rec.pending ? t("oczekuje na zatwierdzenie") : t("nieaktywne (logowanie zablokowane)")]], String(approving || rec.active !== false))}</select>`)}
        ${isNew ? `<div class="span-all"><h4 class="mini-h">${th("Hasło startowe")}</h4><p class="help">${th("Użytkownik zmieni je przy pierwszym logowaniu.")}</p></div>
          <div data-ff="password">${pwField("me-pw", t("Hasło"), "new-password")}${pwMeter("me-pw-meter")}<div class="msg hidden" data-fmsg="password"></div></div>
          <div>${pwField("me-pw2", t("Powtórz hasło"), "new-password")}</div>` : ""}
      </div>`;
      const m = Modal.open({ title: isNew ? t("Nowy użytkownik") : approving ? t("Zatwierdzenie rejestracji: {l}", { l: rec.login }) : t("Edycja użytkownika {l}", { l: rec.login }), id: "user-edit", wide: true, body,
        footer: `<button class="btn ghost" type="button" data-no>${th("Anuluj")}</button><button class="btn primary" type="button" data-yes>${ic("check", 15)} ${approving ? th("Zatwierdź i aktywuj") : th("Zapisz")}</button>` });
      bindEyes(m.el); if (isNew) bindMeter($("#me-pw", m.el), $("#me-pw-meter", m.el));
      const nm = $("#me-name", m.el), lg = $("#me-login", m.el), rl = $("#me-role", m.el);
      rl.onchange = () => { const h = $("[data-role-help]", m.el); if (h) h.textContent = t(R.ROLE_INFO[rl.value] || ""); };
      $("[data-no]", m.el).onclick = () => m.close();
      $("[data-yes]", m.el).onclick = async () => {
        const email = lg.value.trim().toLowerCase();
        const next = Object.assign({}, rec, { name: nm.value, login: email, email, role: rl.value, whId: $("#me-whId", m.el).value, lang: $("#me-lang", m.el).value, phone: $("#me-phone", m.el).value });
        if (!isNew) next.active = $("#me-active", m.el).value === "true";
        let res;
        if (isNew) {
          const pw = $("#me-pw", m.el).value;
          if (pw !== $("#me-pw2", m.el).value) { showErrors(m, { errors: { password: t("Hasła nie są takie same") } }); return; }
          delete next.id;
          res = await Store.backend.createUser(next, pw);
        } else res = await Store.exec("user.save", { rec: next }, SRC_USERS);
        if (!res || !res.ok) { showErrors(m, res || {}); Toast.err(t("Nie zapisano"), (res && res.error) || ""); return; }
        m.close(); Toast.ok(isNew ? t("Utworzono konto") : approving ? t("Konto aktywowane") : t("Zapisano"), res.rec ? `${res.rec.name} (${res.rec.login})` : ""); App.render();
      };
      nm.focus();
    },
    async remove(id) {
      const u = R.byId(Store.state.users, id);
      const r = await Modal.confirm({ title: u.pending ? t("Odrzucić zgłoszenie {l}?", { l: u.login }) : t("Usunąć konto {l}?", { l: u.login }), text: u.pending ? t("Zgłoszenie i hasło zostaną usunięte. Osoba może zarejestrować się ponownie.") : t("Usunąć można tylko konto bez historii operacji. Konto z historią dezaktywuj — historia zostaje."), ok: u.pending ? t("Odrzuć zgłoszenie") : t("Usuń konto"), danger: true });
      if (!r.ok) return;
      const res = await Store.backend.removeUser(id);
      if (!res || !res.ok) return Toast.err(t("Nie usunięto"), res && res.error);
      Toast.ok(u.pending ? t("Zgłoszenie odrzucone") : t("Konto usunięte"), u.login); App.render();
    },
    resetPassword(id) {
      const u = R.byId(Store.state.users, id);
      const m = Modal.open({ title: t("Nowe hasło: {n}", { n: u.name }), id: "pw-reset",
        body: `<div class="stack">${pwField("rp-pw", t("Nowe hasło"), "new-password")}${pwMeter("rp-meter")}${pwField("rp-pw2", t("Powtórz hasło"), "new-password")}
          <label class="inline-opt"><input type="checkbox" id="rp-must" checked> ${th("Wymuś zmianę hasła przy następnym logowaniu")}</label><div class="msg hidden" id="rp-msg"></div></div>`,
        footer: `<button class="btn ghost" type="button" data-no>${th("Anuluj")}</button><button class="btn primary" type="button" data-yes>${th("Ustaw hasło")}</button>` });
      bindEyes(m.el); bindMeter($("#rp-pw", m.el), $("#rp-meter", m.el));
      $("[data-no]", m.el).onclick = () => m.close();
      $("[data-yes]", m.el).onclick = async () => {
        const msg = $("#rp-msg", m.el), fail = x => { msg.textContent = x; msg.classList.remove("hidden"); };
        if ($("#rp-pw", m.el).value !== $("#rp-pw2", m.el).value) return fail(t("Hasła nie są takie same"));
        const r = await Store.backend.setPassword(id, $("#rp-pw", m.el).value, $("#rp-must", m.el).checked);
        if (!r || !r.ok) return fail((r && r.error) || t("Nie udało się ustawić hasła"));
        m.close(); Toast.ok(t("Hasło ustawione"), u.login); App.render();
      };
    }
  };
  Views.uzytkownicy = {
    html() {
      const S = Store.state, f = App.tabs.users || (App.tabs.users = { wh: "", role: "", q: "" });
      const pend = S.users.filter(u => u.pending);
      const list = S.users.filter(u => !u.pending && (!f.wh || u.whId === f.wh) && (!f.role || u.role === f.role)
        && (!f.q || `${u.name} ${u.login} ${u.phone || ""}`.toLowerCase().includes(f.q.toLowerCase())))
        .sort((a, b) => (a.whId + a.role + a.name).localeCompare(b.whId + b.role + b.name));
      const row = u => `<tr data-user="${esc(u.id)}" class="${u.active === false ? "void" : ""}"><td><div class="row"><span class="avatar">${esc(initials(u.name))}</span><div><b>${esc(u.name)}</b>${u.phone ? `<br><small class="dim">${esc(u.phone)}</small>` : ""}</div></div></td><td class="mono small">${esc(u.login)}</td><td><span class="badge role-${esc(u.role)}">${esc(App.roleLabel(u.role))}</span></td><td>${esc(App.whName(u.whId))}</td><td>${activeBadge(u.active)}</td><td data-acc="${esc(u.id)}"><span class="dim">…</span></td><td data-last="${esc(u.id)}">—</td>
            <td class="r nowrap"><button class="btn sm" type="button" data-uedit="${esc(u.id)}">${ic("edit", 13)} ${th("Edytuj")}</button> <button class="btn sm icon" type="button" data-upw="${esc(u.id)}" title="${esc(t("Ustaw hasło"))}" aria-label="${esc(t("Ustaw hasło"))}">${ic("key", 14)}</button> <button class="btn sm icon hidden" type="button" data-unlock="${esc(u.id)}" title="${esc(t("Odblokuj"))}" aria-label="${esc(t("Odblokuj"))}">${ic("lock", 14)}</button>${u.id !== Store.userId ? ` <button class="btn sm icon danger" type="button" data-udel="${esc(u.id)}" title="${esc(t("Usuń konto"))}" aria-label="${esc(t("Usuń konto"))}">${ic("trash", 14)}</button>` : ""}</td></tr>`;
      return `<div class="page-head"><div class="titles"><h2>${th("Użytkownicy i uprawnienia")}</h2><p>${th("Konta (logowanie e-mailem firmowym), role, przypisanie do magazynu, hasła i blokady. Konto z historią operacji dezaktywuje się — usunąć można tylko konto bez historii.")}</p></div>
          <div class="actions"><button class="btn primary" type="button" id="user-add">${ic("plus", 15)} ${th("Nowy użytkownik")}</button></div></div>
        ${pend.length ? `<div class="card mb4 queue-card" id="reg-requests"><div class="card-h"><h3>${ic("user", 16)} ${th("Zgłoszenia rejestracji")}</h3><span class="sub">${esc(t("konta oczekujące na nadanie roli i magazynu"))}</span></div><div class="tbl-wrap"><table class="tbl" id="reg-table"><thead><tr><th>${th("Imię i nazwisko")}</th><th>${th("E-mail")}</th><th>${th("Telefon")}</th><th>${th("Zgłoszono")}</th><th></th></tr></thead><tbody>
          ${pend.map(u => `<tr data-reg="${esc(u.id)}"><td><b>${esc(u.name)}</b></td><td class="mono">${esc(u.login)}</td><td>${esc(u.phone || "—")}</td><td>${esc(Dates.ts(u.registeredAt))}</td><td class="r nowrap"><button class="btn sm primary" type="button" data-uapprove="${esc(u.id)}">${ic("check", 13)} ${th("Nadaj rolę i aktywuj")}</button> <button class="btn sm danger" type="button" data-udel="${esc(u.id)}">${ic("x", 13)} ${th("Odrzuć")}</button></td></tr>`).join("")}</tbody></table></div></div>` : ""}
        <div class="card"><div class="toolbar">
          <div class="field"><label for="uf-wh">${th("Magazyn")}</label><select class="ctrl" id="uf-wh"><option value="">${th("Wszystkie")}</option>${S.warehouses.map(w => `<option value="${esc(w.id)}" ${f.wh === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="uf-role">${th("Rola")}</label><select class="ctrl" id="uf-role"><option value="">${th("Wszystkie")}</option>${Object.entries(R.ROLES).map(([k, v]) => `<option value="${k}" ${f.role === k ? "selected" : ""}>${esc(t(v.label))}</option>`).join("")}</select></div>
          ${searchInput("uf-q", f.q, t("nazwisko, e-mail, telefon…"))}</div>
          <div class="tbl-wrap"><table class="tbl" id="users-table"><thead><tr><th>${th("Użytkownik")}</th><th>${th("E-mail")}</th><th>${th("Rola")}</th><th>${th("Magazyn")}</th><th>${th("Status")}</th><th>${th("Hasło")}</th><th>${th("Ostatnie logowanie")}</th><th></th></tr></thead>
          <tbody id="users-body">${list.map(row).join("") || `<tr><td colspan="8" class="empty">${th("Brak wpisów.")}</td></tr>`}</tbody></table></div></div>
        <div class="card mt4"><div class="card-h"><h3>${th("Role")}</h3></div><div class="card-b"><div class="role-grid">${Object.entries(R.ROLES).map(([k, v]) => `<div class="role-card"><span class="badge role-${k}">${esc(t(v.label))}</span><p>${esc(t(R.ROLE_INFO[k]))}</p><small class="dim">${esc(tp("{n} osoba|{n} osoby|{n} osób", S.users.filter(u => u.role === k && !u.pending && u.active !== false).length))}</small></div>`).join("")}</div></div></div>
        <div class="card mt4"><div class="card-h"><h3>${th("Macierz uprawnień")}</h3><span class="sub">${th("uprawnienia sprawdzane w silniku przy każdej operacji")}</span></div><div class="tbl-wrap"><table class="tbl" id="perm-table"><thead><tr><th>${th("Uprawnienie")}</th>${Object.values(R.ROLES).map(r => `<th class="c">${esc(t(r.label))}</th>`).join("")}</tr></thead><tbody>
          ${Object.keys(R.PERMS).map(p => `<tr><td><span class="mono">${esc(p)}</span><br><small class="dim">${esc(t(R.PERMS[p]))}</small></td>${Object.keys(R.ROLES).map(k => `<td class="c">${R.can({ role: k }, p) ? `<span class="badge ok">${ic("check", 12)}</span>` : "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>
        <div class="card mt4"><div class="card-h"><h3>${th("Dziennik logowań")}</h3><span class="sub">${th("ostatnie 100 zdarzeń")}</span></div><div id="login-log"><div class="empty">…</div></div></div>`;
    },
    async bind(page) {
      $("#user-add", page).onclick = () => Users.edit(null);
      const f = App.tabs.users;
      const on = (sel, k) => { const el = $(sel, page); if (el) el.onchange = e => { f[k] = e.target.value; App.render(); }; };
      on("#uf-wh", "wh"); on("#uf-role", "role");
      bindSearch(page, "#uf-q", f, "q", this);
      $$("[data-uapprove]", page).forEach(b => b.onclick = () => Users.edit(b.dataset.uapprove, { approve: true }));
      $$("[data-udel]", page).forEach(b => b.onclick = () => Users.remove(b.dataset.udel));
      $$("[data-uedit]", page).forEach(b => b.onclick = () => Users.edit(b.dataset.uedit));
      $$("[data-upw]", page).forEach(b => b.onclick = () => Users.resetPassword(b.dataset.upw));
      $$("[data-unlock]", page).forEach(b => b.onclick = async () => { const r = await Store.backend.unlock(b.dataset.unlock); if (r && r.ok) { Toast.ok(t("Konto odblokowane")); App.render(); } else Toast.err(t("Nie odblokowano"), r && r.error); });
      const acc = await Users.accounts();
      for (const u of Store.state.users) {
        const a = acc[u.id] || { hasPassword: false }, cell = $(`[data-acc="${u.id}"]`, page), last = $(`[data-last="${u.id}"]`, page);
        if (!cell) continue;
        const locked = a.lockedUntil && Date.parse(a.lockedUntil) > Date.now();
        cell.innerHTML = !a.hasPassword ? `<span class="badge warn">${th("brak hasła")}</span>` : locked ? `<span class="badge err">${th("zablokowane")}</span>` : a.mustChange ? `<span class="badge info">${th("do zmiany")}</span>` : a.demo ? `<span class="badge">${th("demonstracyjne")}</span>` : `<span class="badge ok">${th("ustawione")}</span>`;
        if (last) last.textContent = a.lastLogin ? Dates.ts(a.lastLogin) : "—";
        const ub = $(`[data-unlock="${u.id}"]`, page); if (ub) ub.classList.toggle("hidden", !locked);
      }
      const log = (await Store.backend.loginLog()).slice(0, 100);
      const box = $("#login-log", page);
      if (box) box.innerHTML = log.length ? `<div class="tbl-wrap"><table class="tbl dense" id="login-log-table"><thead><tr><th>${th("Czas")}</th><th>${th("E-mail")}</th><th>${th("Wynik")}</th><th>${th("Szczegóły")}</th>${Store.mode === "server" ? `<th>${th("Adres")}</th>` : ""}</tr></thead><tbody>
        ${log.map(x => `<tr><td class="nowrap">${esc(Dates.ts(String(x.ts), true))}</td><td class="mono">${esc(x.login || (R.byId(Store.state.users, x.userId) || {}).login || "")}</td><td>${x.ok ? `<span class="badge ok">${th("OK")}</span>` : `<span class="badge err">${th("odrzucone")}</span>`}</td><td>${esc(t(x.reason || ""))}</td>${Store.mode === "server" ? `<td class="mono">${esc(x.ip || "")}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : `<div class="empty">${th("Brak wpisów.")}</div>`;
    }
  };

  /* ================================================================== */
  /* Mój profil                                                           */
  /* ================================================================== */
  Views.profil = {
    html() {
      const u = App.user(), S = Store.state;
      const mine = S.audit.filter(a => a.userId === u.id).slice(-10).reverse();
      return `<div class="page-head"><div class="titles"><h2>${th("Mój profil i ustawienia")}</h2><p>${th("Język i motyw zapisują się w Twoim profilu — działają na każdym komputerze po zalogowaniu.")}</p></div></div>
        <div class="grid g2">
          <div class="card"><div class="card-h"><h3>${th("Konto")}</h3></div><div class="card-b">
            <div class="row mb4"><span class="avatar lg">${esc(initials(u.name))}</span><div><b style="font-size:var(--t-lg)">${esc(u.name)}</b><div class="dim">${esc(u.login)} · ${esc(App.roleLabel(u.role))}</div></div></div>
            <dl class="money-list"><dt>${th("Magazyn")}</dt><dd>${esc(App.whName(u.whId))}</dd><dt>${th("E-mail")}</dt><dd>${esc(u.email || "—")}</dd><dt>${th("Tryb pracy")}</dt><dd>${esc(Store.mode === "server" ? t("serwer (wielostanowiskowy)") : t("lokalny (ta przeglądarka)"))}</dd><dt>${th("Wylogowanie po bezczynności")}</dt><dd>${esc(t("{n} min", { n: AuthLib.POLICY.idleMinutes }))}</dd></dl>
            <div class="row wrap mt4"><button class="btn" type="button" id="pf-pw">${ic("key", 15)} ${th("Zmień hasło")}</button><button class="btn danger" type="button" id="pf-logout">${ic("logout", 15)} ${th("Wyloguj")}</button></div></div></div>
          <div class="card"><div class="card-h"><h3>${th("Wygląd i język")}</h3></div><div class="card-b">
            <div class="set-list">
              <div class="set-row"><div class="sl"><b>${th("Język")}</b><small>${th("Interfejs, raporty, wydruki i PDF")}</small></div>
                <div class="seg" role="group" aria-label="${th("Język")}">${Object.values(I18N.LANGS).map(L => `<button type="button" data-plang="${L.code}" aria-pressed="${L.code === I18N.lang}">${esc(L.label)}</button>`).join("")}</div></div>
              <div class="set-row" style="display:block"><div class="sl mb3"><b>${th("Motyw")}</b><small>${th("Skrót klawiszowy: Ctrl+D")}</small></div>
                <div class="theme-cards">${THEME_LIST.map(x => `<button class="theme-card" type="button" data-ptheme="${x.id}" aria-pressed="${x.id === Prefs.theme}"><div class="sw" style="background:${x.sw[1]}"><i style="background:${x.sw[0]}"></i><i style="background:linear-gradient(90deg,${x.sw[2]} 0 30%,${x.sw[1]} 30%)"></i></div><b>${esc(t(x.label))}</b></button>`).join("")}</div></div>
              <div class="set-row"><div class="sl"><b>${th("Samouczek pod polami formularza")}</b><small>${th("Podpowiedzi „Co / Po co” w Nowej operacji")}</small></div><label class="inline-opt"><input type="checkbox" id="pf-tut" ${lsGet("riw.tutorial", "1") !== "0" ? "checked" : ""}> ${th("włączony")}</label></div>
            </div></div></div>
        </div>
        <div class="card mt4"><div class="card-h"><h3>${th("Moja ostatnia aktywność")}</h3></div><div class="card-b"><ul class="timeline">${mine.map(a => `<li>${UI.auditLine(a)}</li>`).join("") || `<li class="dim">${th("Brak wpisów.")}</li>`}</ul></div></div>`;
    },
    bind(page) {
      $("#pf-pw", page).onclick = () => Auth.changePasswordDialog();
      $("#pf-logout", page).onclick = () => App.logout();
      $$("[data-plang]", page).forEach(b => b.onclick = () => Prefs.setLang(b.dataset.plang));
      $$("[data-ptheme]", page).forEach(b => b.onclick = async () => { await Prefs.setTheme(b.dataset.ptheme); App.render(); });
      $("#pf-tut", page).onchange = e => { lsSet("riw.tutorial", e.target.checked ? "1" : "0"); document.body.classList.toggle("no-tutorial", !e.target.checked); };
    }
  };

  /* ================================================================== */
  /* Administracja                                                        */
  /* ================================================================== */
  Views.administracja = {
    html() {
      const S = Store.state, srv = Store.mode === "server";
      const intro = root.Intro, today = ssGet("riw.today", "");
      const size = Store.backend.sizeBytes();
      return `<div class="page-head"><div class="titles"><h2>${th("Administracja")}</h2><p>${th("Kopie zapasowe, import danych, preferencje programu i informacje o systemie. Konta i hasła — moduł Użytkownicy.")}</p></div>
          ${App.can("users.manage") ? `<div class="actions"><a class="btn" href="#/uzytkownicy">${ic("users", 15)} ${th("Użytkownicy i uprawnienia")}</a></div>` : ""}</div>
        <div class="grid g2">
          <div class="card"><div class="card-h"><h3>${th("Kopia zapasowa i import")}</h3></div><div class="card-b stack">
            <p class="muted">${th("Pełna kopia danych (operacje, dokumenty, korekty, anulowania, księga, inwentaryzacja, flota, kartoteki, audyt) w pliku JSON. Hasła nie trafiają do kopii. Wczytanie kopii zastępuje bieżące dane po kontroli struktury i migracji do bieżącej wersji.")}</p>
            <div class="row wrap"><button class="btn primary" type="button" id="bk-export" ${App.can("data.backup") ? "" : "disabled"}>${ic("dl", 15)} ${th("Pobierz kopię (JSON)")}</button>
              <button class="btn" type="button" id="bk-import" ${App.can("data.import") ? "" : "disabled"}>${ic("up", 15)} ${th("Wczytaj kopię")}</button>
              <input type="file" id="bk-file" accept="application/json,.json" class="hidden"></div>
            <p class="help">${esc(t("Wymagana rola: Kierownik lub Administrator. Rozmiar danych: {kb} kB (rewizja {rev}, schemat {s}).", { kb: fmt(size / 1024, 1), rev: S.rev, s: S.schema }))}</p></div></div>
          ${srv ? `<div class="card"><div class="card-h"><h3>${th("Kopie serwera (SQLite)")}</h3><span class="spacer"></span><button class="btn sm" type="button" id="srv-bk" ${App.can("data.backup") ? "" : "disabled"}>${ic("db", 13)} ${th("Utwórz kopię teraz")}</button></div><div id="srv-bk-list"><div class="empty">…</div></div></div>` : ""}
          ${App.can("users.manage") ? `<div class="card" id="clean-card"><div class="card-h"><h3>${th("Start pracy na czysto")}</h3></div><div class="card-b stack">
            <p class="muted">${th("Usuwa operacje, dokumenty, księgę, wersje robocze i okresy inwentaryzacji — zostają magazyny, produkty, kontrahenci, flota i konta użytkowników. Użyj przed rozpoczęciem pracy na prawdziwych danych (po szkoleniu na danych przykładowych). Przed wyczyszczeniem pobierz kopię.")}</p>
            <div><button class="btn danger" type="button" id="dm-clean">${ic("trash", 15)} ${th("Wyczyść operacje i rozpocznij pracę")}</button></div></div></div>` : ""}
          <div class="card"><div class="card-h"><h3>${th("Preferencje programu")}</h3></div><div class="card-b stack">
            <label class="inline-opt"><input type="checkbox" id="pf-intro" ${intro && intro.enabled() ? "checked" : ""}> ${th("Intro przy uruchomieniu")}</label>
            <label class="inline-opt"><input type="checkbox" id="pf-music" ${intro && intro.musicOn() ? "checked" : ""}> ${th("Muzyka w intro (domyślnie włączona)")}</label>
            <div><button class="btn" type="button" id="pf-play">${ic("play", 15)} ${th("Odtwórz intro")}</button></div></div></div>
          ${srv ? "" : `<div class="card"><div class="card-h"><h3>${th("Narzędzia trybu lokalnego")}</h3></div><div class="card-b stack">
            <div class="field"><label for="dm-today">${th("Data systemowa (pusta = dzisiejsza)")}</label><input class="ctrl" type="date" id="dm-today" value="${esc(today)}"><div class="help">${th("Pozwala sprawdzić przełom miesiąca bez czekania. Obowiązuje w tej karcie.")}</div></div>
            <div class="row wrap"><button class="btn" type="button" id="dm-apply">${th("Zastosuj datę")}</button><button class="btn" type="button" id="dm-roll">${th("Kontrola przełomu miesiąca")}</button></div>
            <p class="help">${esc(t("Ostatnia kontrola przełomu: {d}.", { d: S.meta.lastMonthCheck || "—" }))}</p>
            <div class="dd-sep"></div>
            <p class="muted">${th("Przywraca dane przykładowe (bilans otwarcia 01.08.2026, operacje wzorcowe, MM, korekta i anulowanie). Obecne dane zostaną zastąpione — konta i hasła pozostają.")}</p>
            <div><button class="btn danger" type="button" id="dm-reset" ${App.can("data.import") ? "" : "disabled"}>${th("Przywróć dane przykładowe")}</button></div></div></div>`}
        </div>
        <div class="card mt4"><div class="card-h"><h3>${th("O programie")}</h3></div><div class="card-b">
          <dl class="money-list" style="max-width:720px"><dt>${th("Wersja")}</dt><dd>${esc(R.VERSION)} · ${esc(t("schemat {s}", { s: R.SCHEMA }))}</dd>
          <dt>${th("Tryb pracy")}</dt><dd>${esc(srv ? t("serwer — dane w bazie SQLite, wielu użytkowników") : Store.memoryOnly ? t("lokalny — tylko pamięć (zapis zablokowany)") : t("lokalny — dane w tej przeglądarce"))}</dd>
          ${srv && ServerBackend.info ? `<dt>${th("Serwer")}</dt><dd>${esc(ServerBackend.info.version || "")} · ${esc(ServerBackend.info.host || location.host)}</dd>` : ""}
          <dt>${th("Przeliczniki")}</dt><dd>1 m³ = ${fmtQ(S.config.m3_mp)} MP · 1 MP = ${fmt(S.config.mp_t, 2)} t · 1 t = ${fmt(S.config.t_gj, 1)} GJ</dd><dt>${th("Cena za rąbanie")}</dt><dd>${esc(t("{m} zł/MP (domyślnie)", { m: fmt(S.config.chipRateDefault) }))}</dd>
          <dt>${th("Blokada zapisu między kartami")}</dt><dd>${esc(srv ? t("transakcje bazy danych na serwerze") : root.navigator && navigator.locks ? t("Web Locks — aktywna") : t("niedostępna w tej przeglądarce"))}</dd><dt>PDF</dt><dd>${th("generator wbudowany, czcionka ResInvestDocSans (OFL)")}</dd></dl>
          ${srv ? "" : `<p class="help mt3">${th("Tryb lokalny służy do pracy na jednym stanowisku i do pokazu. Do pracy wielu osób zainstaluj ResInvest ERP Serwer (instalator Windows) — dane w bazie SQLite, kopie automatyczne, logowanie z sesją serwerową.")}</p>`}</div></div>`;
    },
    async bind(page) {
      const intro = root.Intro;
      $("#pf-intro", page).onchange = e => intro && intro.setEnabled(e.target.checked);
      $("#pf-music", page).onchange = e => intro && intro.setMusic(e.target.checked);
      $("#pf-play", page).onclick = () => intro && intro.play({ force: true });
      $("#bk-export", page).onclick = async () => {
        download(`resinvest_kopia_${App.today()}.json`, JSON.stringify(Store.state, null, 1), "application/json");
        await Store.exec("data.backupLogged", { format: "json" }, N_("Administracja"));
      };
      $("#bk-import", page).onclick = () => $("#bk-file", page).click();
      $("#bk-file", page).onchange = async e => {
        const file = e.target.files[0]; e.target.value = "";
        if (!file) return;
        let data;
        try { data = JSON.parse(await file.text()); } catch (x) { Toast.err(t("Plik nie jest poprawnym JSON")); return; }
        const mg = R.migrate(data);
        const errs = mg.error ? [mg.error] : R.validateStateShape(mg.state);
        if (errs.length) { Toast.err(t("Kopia odrzucona"), errs.slice(0, 3).join("; ")); return; }
        const r = await Modal.confirm({ title: t("Wczytać kopię?"), text: t("Kopia: {n} operacji, {l} zapisów księgi, rewizja {r}. Bieżące dane zostaną zastąpione.", { n: mg.state.operations.length, l: mg.state.ledger.length, r: mg.state.rev }), ok: t("Wczytaj"), danger: true });
        if (!r.ok) return;
        const res = await Store.exec("data.import", { state: data }, N_("Administracja"));
        if (res.ok) { Toast.ok(t("Kopia wczytana"), res.migrated ? t("Dane zmigrowane do bieżącej wersji.") : ""); UI.Form.draft = null; ssSet(DRAFT_KEY, null); if (Store.mode === "local") await AuthLib.LocalAuth.ensureDemo(Store.state); App.render(); } else Toast.err(t("Import nieudany"), res.error);
      };
      const ap = $("#dm-apply", page); if (ap) ap.onclick = () => { const v = $("#dm-today", page).value; ssSet("riw.today", v || null); Toast.info(t("Data systemowa"), v || t("dzisiejsza")); App.render(); };
      const roll = $("#dm-roll", page);
      if (roll) roll.onclick = async () => {
        const res = await Store.exec("inv.autoClose", {}, N_("Automat: początek kolejnego miesiąca"));
        const done = res.done || [];
        Toast.info(t("Kontrola przełomu miesiąca"), done.length ? done.map(d => `${d.ym}: ${d.ok ? t("zamknięto") + (d.docNo ? " (" + d.docNo + ")" : "") : d.error}`).join(" · ") : t("Brak otwartych okresów z poprzednich miesięcy lub kontrola już wykonana w tym miesiącu."));
        App.render();
      };
      const cl = $("#dm-clean", page);
      if (cl) cl.onclick = async () => {
        const r = await Modal.confirm({ title: t("Wyczyścić wszystkie operacje?"), text: t("Tej czynności nie można cofnąć (poza wczytaniem kopii). Wpisz WYCZYŚĆ, aby potwierdzić."), ok: t("Wyczyść"), danger: true, input: { label: t("Potwierdzenie"), placeholder: "WYCZYŚĆ", required: true } });
        if (!r.ok) return;
        const res = await Store.exec("data.clean", { confirm: String(r.value).toUpperCase() }, N_("Administracja"));
        if (res.ok) { UI.Form.draft = null; ssSet(DRAFT_KEY, null); Toast.ok(t("Dane wyczyszczone — można rozpocząć pracę")); App.render(); } else Toast.err(t("Nie wyczyszczono"), res.error);
      };
      const rs = $("#dm-reset", page);
      if (rs) rs.onclick = async () => {
        const r = await Modal.confirm({ title: t("Przywrócić dane przykładowe?"), text: t("Wszystkie operacje, dokumenty, okresy i zmiany kartotek w tej przeglądarce zostaną zastąpione danymi startowymi."), ok: t("Przywróć"), danger: true });
        if (!r.ok) return;
        const res = await Store.exec("data.reset", {}, N_("Administracja"));
        if (res.ok) { UI.Form.draft = null; ssSet(DRAFT_KEY, null); await AuthLib.LocalAuth.ensureDemo(Store.state); Toast.ok(t("Przywrócono dane przykładowe")); App.render(); } else Toast.err(t("Nie przywrócono"), res.error);
      };
      if (Store.mode === "server") {
        const list = async () => {
          const r = await ServerBackend.backups(), box = $("#srv-bk-list", page);
          if (!box) return;
          box.innerHTML = r && r.ok && r.backups.length ? `<div class="tbl-wrap"><table class="tbl" id="srv-bk-table"><thead><tr><th>${th("Plik")}</th><th>${th("Utworzono")}</th><th class="r">${th("Rozmiar")}</th><th></th></tr></thead><tbody>${r.backups.map(b => `<tr><td class="mono">${esc(b.name)}</td><td>${esc(Dates.ts(b.created))}</td><td class="r">${fmt(b.size / 1024, 0)} kB</td><td class="r">${App.can("data.backup") ? `<a class="btn sm" href="/api/backups/${encodeURIComponent(b.name)}" download>${ic("dl", 13)} ${th("Pobierz")}</a>` : ""}</td></tr>`).join("")}</tbody></table></div>
            <div class="card-b"><p class="help">${esc(t("Kopie automatyczne: codziennie, przechowywane {d} dni. Folder: {f}", { d: r.keepDays, f: r.dir }))}</p></div>` : `<div class="empty">${esc((r && r.error) || t("Brak kopii."))}</div>`;
        };
        const b = $("#srv-bk", page); if (b) b.onclick = async () => { const r = await ServerBackend.backupNow(); if (r && r.ok) Toast.ok(t("Utworzono kopię"), r.name); else Toast.err(t("Nie utworzono kopii"), r && r.error); list(); };
        list();
      }
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
