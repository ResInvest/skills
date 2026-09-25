/* =========================================================================
   ResInvest ERP 3.0 — warstwa S: usługa aplikacyjna (komendy)

   Jedyne wejście do zmian danych — identyczne w trybie lokalnym (przeglądarka)
   i serwerowym (Node + SQLite):
     Service.exec(state, "op.commit", { draft }, ctx) → wynik silnika
   * `ctx.user` pochodzi WYŁĄCZNIE z sesji (serwer / moduł logowania), nigdy z argumentów,
   * uprawnienie komendy jest sprawdzane tutaj i ponownie w silniku,
   * komenda pracuje na KOPII stanu — host zapisuje ją tylko przy { ok: true }
     (zapis „wszystko albo nic”),
   * `args.source` to kanoniczny (polski) opis miejsca w programie do audytu.
   Konta i hasła NIE są częścią stanu — obsługuje je moduł Auth hosta.
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);
  const t = (s, p) => R.I18N.t(s, p);
  const N_ = s => s;
  const str = v => String(v == null ? "" : v).trim();

  /** Stan zastępowany w całości (import kopii, dane przykładowe): kontrola kształtu + migracja + zachowanie kont. */
  function replaceState(s, next, ctx, action, detail) {
    const m = R.migrate(next);
    if (m.error) return { ok: false, error: m.error };
    const n = m.state;
    const errs = R.validateStateShape(n);
    if (errs.length) return { ok: false, error: t("Kopia odrzucona: {e}", { e: errs.slice(0, 3).join("; ") }) };
    // zalogowany administrator musi istnieć w nowych danych (inaczej system byłby bez dostępu)
    if (!n.users.some(u => u.id === ctx.user.id && u.role === "admin" && u.active !== false) && !n.users.some(u => u.login === ctx.user.login && u.role === "admin" && u.active !== false)) {
      const me = R.clone(R.byId(s.users, ctx.user.id));
      if (me) { if (!R.byId(n.warehouses, me.whId)) me.whId = (n.warehouses[0] || {}).id; n.users.push(me); }
    }
    const before = { rewizja: s.rev, operacje: s.operations.length };
    n.rev = Math.max(s.rev, n.rev || 0) + 1;
    Object.keys(s).forEach(k => delete s[k]);
    Object.assign(s, n);
    R.audit(s, ctx, { entity: "system", entityId: action, opNo: action, event: action, action: detail, before, after: { rewizja: s.rev, operacje: s.operations.length, migracja: m.from !== m.to ? `${m.from} → ${m.to}` : "" } });
    return { ok: true, migrated: m.from !== m.to, notes: m.notes };
  }

  const COMMANDS = {
    /* ---- operacje ---- */
    "draft.save": { perm: "op.create", run: (s, a, c) => R.saveDraft(s, a.draft, c) },
    "draft.delete": { run: (s, a, c) => R.deleteDraft(s, a.id, c) },
    "op.commit": { perm: "op.create", run: (s, a, c) => R.commitOperation(s, a.draft, c) },
    "op.correct": { perm: "documents.correct", run: (s, a, c) => R.correctOperation(s, a.opId, a.draft, a.reason, c, { corrKey: a.corrKey || null }) },
    "op.reverseCorrection": { perm: "documents.correct", run: (s, a, c) => R.reverseCorrection(s, a.opId, a.corrNo, a.reason, c) },
    "op.cancel": { perm: "documents.cancel", run: (s, a, c) => R.cancelOperation(s, a.opId, c, a.reason, { ack: !!a.ack }) },
    "print.register": { perm: "report.view", run: (s, a, c) => R.registerPrint(s, c, { kind: a.kind, title: a.title, range: a.range, wh: a.wh, format: a.format }) },
    /* ---- inwentaryzacja ---- */
    "inv.open": { perm: "inv.open", run: (s, a, c) => R.Inventory.open(s, a.ym, c) },
    "inv.generate": { perm: "inv.count", run: (s, a, c) => R.Inventory.generate(s, a.ym, c) },
    "inv.setCount": { perm: "inv.count", run: (s, a, c) => R.Inventory.setCount(s, a.ym, a.productId, a.text, c) },
    "inv.close": { perm: "inv.close", run: (s, a, c) => R.Inventory.close(s, a.ym, c) },
    /** Kontrola przełomu miesiąca — idempotentna, uruchamiana przy starcie (każdy zalogowany). */
    "inv.autoClose": { run: (s, a, c) => ({ ok: true, done: R.Inventory.autoClose(s, Object.assign({}, c, { source: N_("Automat: początek kolejnego miesiąca") })) }) },
    /* ---- kartoteki ---- */
    "fleet.save": { perm: "fleet.edit", run: (s, a, c) => R.Fleet.save(s, a.kind, a.rec, c) },
    "fleet.remove": { perm: "fleet.edit", run: (s, a, c) => R.Fleet.remove(s, a.kind, a.id, c) },
    "master.save": { perm: "master.edit", run: (s, a, c) => R.Master.save(s, a.kind, a.rec, c) },
    /* ---- użytkownicy (profil; hasło — Auth hosta) ---- */
    "user.save": { perm: "users.manage", run: (s, a, c) => R.Users.save(s, a.rec, c) },
    "me.prefs": { run: (s, a, c) => R.Users.setPrefs(s, { lang: a.lang, theme: a.theme }, c) },
    /* ---- dane ---- */
    "data.backupLogged": { perm: "data.backup", run: (s, a, c) => { s.rev += 1; R.audit(s, c, { entity: "system", entityId: "backup", opNo: N_("kopia"), event: "backup", action: N_("Pobranie kopii zapasowej"), before: null, after: { rewizja: s.rev, format: str(a.format) || "json" } }); return { ok: true }; } },
    "data.import": { perm: "data.import", run: (s, a, c) => replaceState(s, a.state, c, "import", N_("Import kopii zapasowej")) },
    "data.reset": { perm: "data.import", run: (s, a, c) => replaceState(s, R.Seed.build(c.today), c, "reset", N_("Przywrócenie danych przykładowych")) }
  };

  const Service = {
    COMMANDS,
    has(cmd) { return Object.prototype.hasOwnProperty.call(COMMANDS, cmd); },
    /** Czy komenda zmienia stan tylko przy sukcesie — zawsze tak; host zapisuje przy ok. */
    exec(state, cmd, args, ctx) {
      const c = COMMANDS[cmd];
      if (!c) return { ok: false, error: t("Nieznana komenda: {c}", { c: cmd }), code: "UNKNOWN" };
      if (!ctx || !ctx.user) return { ok: false, error: t("Brak zalogowanego użytkownika"), code: "AUTH" };
      const user = R.byId(state.users, ctx.user.id);
      if (!user || user.active === false) return { ok: false, error: t("Konto jest nieaktywne"), code: "AUTH" };
      if (c.perm && !R.can(user, c.perm)) return { ok: false, error: t("Brak uprawnienia „{p}”", { p: c.perm }), code: "FORBIDDEN" };
      const a = Object.assign({}, args || {});
      const full = Object.assign({}, ctx, { user, source: str(a.source).slice(0, 120) || ctx.source || N_("Aplikacja") });
      try {
        return c.run(state, a, full) || { ok: false, error: t("Operacja odrzucona") };
      } catch (e) {
        return { ok: false, error: t("Błąd wewnętrzny — nic nie zapisano: {m}", { m: e.message }), code: "INTERNAL" };
      }
    },
    /**
     * Wykonanie „wszystko albo nic”: komenda pracuje na kopii; przy sukcesie zwraca nowy stan.
     * { res, state: nowy|null } — host utrwala `state` jedną transakcją.
     */
    run(state, cmd, args, ctx) {
      const work = R.clone(state), rev0 = work.rev;
      const res = this.exec(work, cmd, args, ctx);
      if (!res || !res.ok || work.rev === rev0) return { res, state: null };
      return { res, state: work };
    },
    replaceState
  };

  R.Service = Service;
  root.RIW_Service = Service;
  if (typeof module !== "undefined" && module.exports) module.exports = Service;
})(typeof globalThis !== "undefined" ? globalThis : this);
