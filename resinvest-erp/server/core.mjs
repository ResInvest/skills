/* =========================================================================
   ResInvest ERP Serwer — rdzeń: baza SQLite, silnik, komendy, konta, kopie.
   Bez zależności zewnętrznych (Node ≥ 22.13: node:sqlite, node:crypto).

   Trwałość:
   * tabela `state`   — bieżący stan danych (JSON) + suma SHA-256,
   * tabela `journal` — dziennik zmian append-only (wyzwalacze blokują UPDATE/DELETE),
                        łańcuch skrótów SHA-256 (wykrycie ręcznej ingerencji),
   * każda komenda: silnik na kopii stanu → jedna transakcja (BEGIN IMMEDIATE)
     zapisuje stan i wpis dziennika → dopiero potem stan w pamięci (wszystko albo nic),
   * WAL + synchronous=FULL, kopie `VACUUM INTO` (spójne, bez zatrzymywania pracy).
   Konta: hasła scrypt (N=2^15), sesje losowe 256 bit (w bazie tylko skrót),
   blokada konta po nieudanych próbach, dziennik logowań.
   Tokeny e-mail (zaproszenie, reset hasła, potwierdzenie adresu): losowe 256 bit,
   w bazie tylko skrót SHA-256, jednorazowe, z terminem ważności; kolejka `outbox`
   zapisuje każdą wysyłkę (bez treści linków).
   ========================================================================= */
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, existsSync, appendFileSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/* ---------------- silnik aplikacji (ten sam kod co w przeglądarce) ---------------- */
export function loadEngine() {
  const appCfg = JSON.parse(readFileSync(join(ROOT, "config", "app.config.json"), "utf8"));
  globalThis.RIW_CONFIG = Object.fromEntries(Object.entries(appCfg).filter(([k]) => !k.startsWith("_")));
  const src = f => join(ROOT, "app", "src", f);
  const I18N = require(src("i18n.js"));
  for (const f of readdirSync(join(ROOT, "app", "src")).filter(f => /^i18n\.d\d+\.js$/.test(f)).sort()) require(src(f));
  const R = require(src("engine.js"));
  const Service = require(src("service.js"));
  require(src("seed.js"));
  const AuthLib = require(src("auth.js"));
  return { I18N, R, Service, AuthLib };
}
const { I18N, R, Service, AuthLib } = loadEngine();
export { I18N, R, Service, AuthLib };
const t = (s, p) => I18N.t(s, p);
const N_ = s => s;

export const sha256 = s => createHash("sha256").update(s).digest("hex");
const nowIso = () => new Date().toISOString();

/* ---------------- zmienne środowiskowe (sekrety — tylko serwer) ---------------- */
/** Plik KLUCZ=wartość (# komentarz). Zmienne procesu mają pierwszeństwo przed plikiem. */
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}
/** Kolejność: .env (katalog programu) → config/server.env → <dataDir>/server.env → zmienne procesu. */
export function loadEnv(dataDir) {
  const files = [join(ROOT, ".env"), join(ROOT, "config", "server.env"), dataDir ? join(dataDir, "server.env") : null].filter(Boolean);
  const env = {}, used = [];
  for (const f of files) if (existsSync(f)) { Object.assign(env, parseEnv(readFileSync(f, "utf8"))); used.push(f); }
  for (const [k, v] of Object.entries(process.env)) if (/^(RESEND_|EMAIL_|SMTP_|APP_URL|SUPABASE_)/.test(k)) env[k] = v;
  return { env, files: used };
}

/* ---------------- konfiguracja ---------------- */
export function loadConfig(overrides = {}) {
  const file = process.env.RIW_CONFIG || join(ROOT, "config", "server.config.json");
  const base = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const c = Object.assign({ port: 8080, host: "0.0.0.0", dataDir: "data-server", session: {}, security: {}, backup: {}, tls: {}, todayOverride: "" }, base, overrides);
  c.session = Object.assign({ idleMinutes: 30, absoluteHours: 12 }, base.session, overrides.session);
  c.security = Object.assign({ maxFailed: 5, lockMinutes: 15, ipAttemptsPer15Min: 40 }, base.security, overrides.security);
  c.backup = Object.assign({ hour: 2, keepDays: 30, dir: "" }, base.backup, overrides.backup);
  if (process.env.RIW_PORT) c.port = Number(process.env.RIW_PORT);
  if (process.env.RIW_DATA) c.dataDir = process.env.RIW_DATA;
  if (process.env.RIW_HOST) c.host = process.env.RIW_HOST;
  if (process.env.RIW_TODAY) c.todayOverride = process.env.RIW_TODAY;
  c.dataDir = resolve(ROOT, c.dataDir);
  c.backupDir = c.backup.dir ? resolve(ROOT, c.backup.dir) : join(c.dataDir, "backups");
  return c;
}

/* ---------------- hasła ---------------- */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };
export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return { algo: "scrypt", salt: salt.toString("hex"), hash: hash.toString("hex"), params: JSON.stringify({ N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }) };
}
export function verifyPassword(pw, acc) {
  if (!acc || acc.algo !== "scrypt") return false;
  const p = JSON.parse(acc.params || "{}");
  const got = scryptSync(String(pw), Buffer.from(acc.salt, "hex"), SCRYPT.keylen, { N: p.N, r: p.r, p: p.p, maxmem: SCRYPT.maxmem });
  const exp = Buffer.from(acc.hash, "hex");
  return exp.length === got.length && timingSafeEqual(exp, got);
}

/* ---------------- dziennik tekstowy ---------------- */
export function makeLogger(dir) {
  mkdirSync(dir, { recursive: true });
  return (level, msg) => {
    const line = `${nowIso()} [${level}] ${msg}`;
    if (level === "ERROR") console.error(line); else console.log(line);
    try { appendFileSync(join(dir, `server-${nowIso().slice(0, 10)}.log`), line + "\n"); } catch (e) {}
  };
}

/* ======================================================================= */
/* Magazyn danych                                                          */
/* ======================================================================= */
export class Store {
  constructor(cfg, log) {
    this.cfg = cfg; this.log = log || (() => {});
    mkdirSync(cfg.dataDir, { recursive: true });
    mkdirSync(cfg.backupDir, { recursive: true });
    this.file = join(cfg.dataDir, "resinvest.sqlite");
    this.db = new DatabaseSync(this.file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), rev INTEGER NOT NULL, schema INTEGER NOT NULL, json TEXT NOT NULL, sha256 TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS journal(seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user_id TEXT, user_login TEXT, cmd TEXT NOT NULL, args TEXT NOT NULL, rev_before INTEGER, rev_after INTEGER, state_sha TEXT, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS journal_no_update BEFORE UPDATE ON journal BEGIN SELECT RAISE(ABORT, 'journal is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS journal_no_delete BEFORE DELETE ON journal BEGIN SELECT RAISE(ABORT, 'journal is append-only'); END;
      CREATE TABLE IF NOT EXISTS accounts(user_id TEXT PRIMARY KEY, algo TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, params TEXT, must_change INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, locked_until TEXT, changed_at TEXT, last_login TEXT);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT, ua TEXT);
      CREATE TABLE IF NOT EXISTS login_log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, login TEXT, user_id TEXT, ok INTEGER NOT NULL, reason TEXT, ip TEXT);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS tokens(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, email TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_by TEXT);
      CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id, kind);
      CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, template TEXT NOT NULL, to_addr TEXT NOT NULL, user_id TEXT, status TEXT NOT NULL, error TEXT, provider_id TEXT, transport TEXT);`);
    this.db.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES ('created_at', ?)").run(nowIso());
    this.state = null; this.integrity = { ok: true, notes: [] };
    this.load();
  }
  today() { return R.Dates.isISO(this.cfg.todayOverride) ? this.cfg.todayOverride : R.Dates.localToday(); }
  tx(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const r = fn(); this.db.exec("COMMIT"); return r; } catch (e) { try { this.db.exec("ROLLBACK"); } catch (x) {} throw e; }
  }
  load() {
    const row = this.db.prepare("SELECT rev, json, sha256 FROM state WHERE id = 1").get();
    if (!row) { this.state = null; return; }
    if (sha256(row.json) !== row.sha256) { this.integrity.ok = false; this.integrity.notes.push("state checksum mismatch"); this.log("ERROR", "Suma kontrolna stanu nie zgadza się — sprawdź bazę / przywróć kopię."); }
    const m = R.migrate(JSON.parse(row.json));
    if (m.error) throw new Error("Nie można wczytać danych: " + m.error);
    this.state = m.state;
    if (m.from !== m.to) { this.saveState(this.state, { id: null, login: "system" }, "system.migrate", { from: m.from, to: m.to }); this.log("INFO", `Migracja danych ${m.from} → ${m.to}`); }
    this.verifyJournal();
  }
  /** Łańcuch skrótów dziennika — każdy wpis zawiera skrót poprzedniego. */
  verifyJournal() {
    let prev = "0".repeat(64), n = 0;
    for (const j of this.db.prepare("SELECT * FROM journal ORDER BY seq").iterate()) {
      const h = sha256([prev, j.ts, j.user_id || "", j.cmd, j.args, j.rev_before, j.rev_after, j.state_sha || ""].join("|"));
      if (j.prev_hash !== prev || j.hash !== h) { this.integrity.ok = false; this.integrity.notes.push(`journal broken at ${j.seq}`); this.log("ERROR", `Dziennik zmian naruszony przy wpisie ${j.seq}`); return false; }
      prev = j.hash; n++;
    }
    this.journalHead = prev; this.journalCount = n;
    return true;
  }
  /** Zapis stanu + wpis dziennika w JEDNEJ transakcji. */
  saveState(next, user, cmd, argsForJournal, revBefore) {
    const json = JSON.stringify(next), sh = sha256(json), ts = nowIso();
    const argsTxt = JSON.stringify(argsForJournal == null ? {} : argsForJournal).slice(0, 200000);
    this.tx(() => {
      this.db.prepare("INSERT INTO state(id, rev, schema, json, sha256, updated_at) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET rev = excluded.rev, schema = excluded.schema, json = excluded.json, sha256 = excluded.sha256, updated_at = excluded.updated_at")
        .run(next.rev, next.schema, json, sh, ts);
      const prev = this.journalHead || "0".repeat(64);
      const rb = revBefore == null ? null : revBefore;
      const hash = sha256([prev, ts, (user && user.id) || "", cmd, argsTxt, rb, next.rev, sh].join("|"));
      this.db.prepare("INSERT INTO journal(ts, user_id, user_login, cmd, args, rev_before, rev_after, state_sha, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(ts, (user && user.id) || null, (user && user.login) || null, cmd, argsTxt, rb, next.rev, sh, prev, hash);
      this.pendingHead = hash;
    });
    this.journalHead = this.pendingHead; this.journalCount = (this.journalCount || 0) + 1;
    this.state = next;
  }

  /** Komenda usługi: silnik na kopii → zapis atomowy → stan w pamięci. */
  execute(userId, cmd, args, lang, meta) {
    if (!Service.has(cmd)) return { ok: false, error: t("Nieznana komenda: {c}", { c: cmd }), code: "UNKNOWN" };
    I18N.setLang(lang || "pl");
    const ctx = Object.assign({ user: { id: userId }, today: this.today() }, meta && { ip: meta.ip || "", ua: String(meta.ua || "").slice(0, 200) });
    const rev0 = this.state.rev;
    const { res, state } = Service.run(this.state, cmd, args, ctx);
    if (state) {
      const u = R.byId(state.users, userId) || R.byId(this.state.users, userId);
      const journalArgs = cmd === "data.import" ? { operacje: (args.state && args.state.operations || []).length, rewizja: args.state && args.state.rev } : args;
      try { this.saveState(state, u, cmd, journalArgs, rev0); }
      catch (e) { this.log("ERROR", `Zapis nieudany (${cmd}): ${e.message}`); return { ok: false, error: t("Zapis w bazie nieudany — nic nie zapisano: {m}", { m: e.message }), code: "DB" }; }
      res.__changed = true;
    }
    return res;
  }
  /** Zmiana stanu przez hosta (bez komendy użytkownika): aktywacja, wpis audytu. Zapis atomowy jak execute. */
  applyChange(label, fn, journalArgs, actor) {
    const rev0 = this.state.rev;
    const { res, state } = Service.apply(this.state, fn);
    if (state) {
      try { this.saveState(state, actor || null, label, journalArgs || {}, rev0); }
      catch (e) { this.log("ERROR", `Zapis nieudany (${label}): ${e.message}`); return { ok: false, error: t("Zapis w bazie nieudany — nic nie zapisano: {m}", { m: e.message }), code: "DB" }; }
      res.__changed = true;
    }
    return res;
  }
  /** Wpis dziennika audytu wykonany przez serwer (np. wysyłka e-mail, prośba o reset hasła). */
  auditEvent(rec, meta, actor) {
    return this.applyChange("audit." + String(rec.code || "event").toLowerCase(), s => {
      s.rev += 1;
      R.audit(s, Object.assign({ user: actor ? R.byId(s.users, actor.id) || null : null, source: rec.source || N_("Serwer") }, meta || {}), Object.assign({ entity: "user", event: "user" }, rec));
      return { ok: true };
    }, { code: rec.code, entityId: rec.entityId || "" }, actor);
  }

  /* ---------------- konta ---------------- */
  account(userId) { return this.db.prepare("SELECT * FROM accounts WHERE user_id = ?").get(userId) || null; }
  hasAccounts() { return !!this.db.prepare("SELECT 1 FROM accounts LIMIT 1").get(); }
  setPassword(userId, pw, mustChange) {
    const h = hashPassword(pw), prev = this.account(userId);
    this.db.prepare(`INSERT INTO accounts(user_id, algo, salt, hash, params, must_change, failed, locked_until, changed_at, last_login) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET algo = excluded.algo, salt = excluded.salt, hash = excluded.hash, params = excluded.params, must_change = excluded.must_change, failed = 0, locked_until = NULL, changed_at = excluded.changed_at`)
      .run(userId, h.algo, h.salt, h.hash, h.params, mustChange ? 1 : 0, nowIso(), prev ? prev.last_login : null);
  }
  logLogin(login, userId, ok, reason, ip) {
    this.db.prepare("INSERT INTO login_log(ts, login, user_id, ok, reason, ip) VALUES (?, ?, ?, ?, ?, ?)").run(nowIso(), login || null, userId || null, ok ? 1 : 0, reason || "", ip || "");
  }
  login(login, pw, ip) {
    const L = String(login || "").trim().toLowerCase();
    if (!L || !pw) return { ok: false, code: "EMPTY", error: t("Podaj e-mail służbowy i hasło") };
    const em = R.validateCompanyEmail(L, this.state && this.state.config.companyDomains);
    if (!em.ok) { this.logLogin(L, null, false, N_("adres spoza domeny firmowej"), ip); return { ok: false, code: "DOMAIN", field: "login", error: em.error }; }
    const u = this.state && this.state.users.find(x => String(x.login).toLowerCase() === L || String(x.email || "").toLowerCase() === L);
    const acc = u ? this.account(u.id) : null;
    const bad = reason => { this.logLogin(L, u ? u.id : null, false, reason, ip); return { ok: false, code: "BAD", error: t("Nieprawidłowy e-mail lub hasło.") }; };
    if (u && !acc && R.statusOf(u) === "INVITED") { verifyPassword(pw, { algo: "scrypt", salt: "00", hash: "00".repeat(32), params: JSON.stringify(SCRYPT) }); this.logLogin(L, u.id, false, N_("konto nieaktywowane (zaproszenie)"), ip); return { ok: false, code: "INVITED", error: t("Twoje konto nie zostało jeszcze aktywowane.") }; }
    if (!u || !acc) { verifyPassword(pw, { algo: "scrypt", salt: "00", hash: "00".repeat(32), params: JSON.stringify(SCRYPT) }); return bad(N_("nieznany login")); }
    if (acc.locked_until && Date.parse(acc.locked_until) > Date.now()) {
      this.logLogin(L, u.id, false, N_("konto zablokowane"), ip);
      return { ok: false, code: "LOCKED", error: t("Konto zablokowane po nieudanych próbach logowania. Spróbuj za {n} min albo poproś administratora o odblokowanie.", { n: Math.ceil((Date.parse(acc.locked_until) - Date.now()) / 60000) }) };
    }
    if (!verifyPassword(pw, acc)) {
      const failed = acc.failed + 1, lock = failed >= this.cfg.security.maxFailed;
      this.db.prepare("UPDATE accounts SET failed = ?, locked_until = ? WHERE user_id = ?").run(lock ? 0 : failed, lock ? new Date(Date.now() + this.cfg.security.lockMinutes * 60000).toISOString() : acc.locked_until, u.id);
      return bad(N_("błędne hasło"));
    }
    const st = R.statusOf(u);
    if (st === "INVITED") { this.logLogin(L, u.id, false, N_("konto nieaktywowane"), ip); return { ok: false, code: "INVITED", error: u.selfRegistered ? t("Konto oczekuje na zatwierdzenie przez administratora. Otrzymasz dostęp po nadaniu roli i magazynu.") : t("Twoje konto nie zostało jeszcze aktywowane.") }; }
    if (st !== "ACTIVE") { this.logLogin(L, u.id, false, st === "SUSPENDED" ? N_("konto zawieszone") : N_("konto dezaktywowane"), ip); return { ok: false, code: "INACTIVE", error: t("Twoje konto jest nieaktywne.") }; }
    if (u.emailUnverified) { this.logLogin(L, u.id, false, N_("adres e-mail niepotwierdzony"), ip); return { ok: false, code: "UNVERIFIED", error: t("Adres e-mail nie został potwierdzony. Kliknij link z wiadomości albo poproś administratora o ponowne wysłanie.") }; }
    this.db.prepare("UPDATE accounts SET failed = 0, locked_until = NULL, last_login = ? WHERE user_id = ?").run(nowIso(), u.id);
    this.logLogin(L, u.id, true, "", ip);
    return { ok: true, user: u, mustChange: !!acc.must_change };
  }
  /* ---------------- sesje ---------------- */
  createSession(userId, ip, ua) {
    const token = randomBytes(32).toString("base64url"), now = Date.now();
    this.db.prepare("INSERT INTO sessions(token_hash, user_id, created_at, last_seen, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(sha256(token), userId, new Date(now).toISOString(), new Date(now).toISOString(), new Date(now + this.cfg.session.absoluteHours * 3600000).toISOString(), ip || "", String(ua || "").slice(0, 200));
    return token;
  }
  session(token) {
    if (!token) return null;
    const s = this.db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(sha256(token));
    if (!s) return null;
    const now = Date.now();
    if (Date.parse(s.expires_at) < now || now - Date.parse(s.last_seen) > this.cfg.session.idleMinutes * 60000) { this.dropSession(token); return null; }
    const u = this.state && R.byId(this.state.users, s.user_id);
    if (!u || R.statusOf(u) !== "ACTIVE" || u.emailUnverified) { this.dropSession(token); return null; }
    if (now - Date.parse(s.last_seen) > 15000) this.db.prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ?").run(new Date(now).toISOString(), s.token_hash);
    return { userId: s.user_id, user: u };
  }
  dropSession(token) { if (token) this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token)); }
  dropUserSessions(userId, exceptToken) {
    if (exceptToken) this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(userId, sha256(exceptToken));
    else this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
  purgeSessions() { this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowIso()); }

  /* ---------------- pierwsze uruchomienie ---------------- */
  setup({ name, email, login, password, sample, lang }) {
    if (this.hasAccounts()) return { ok: false, error: t("Serwer jest już skonfigurowany") };
    const L = String(email || login || "").trim().toLowerCase();
    if (!R.EMAIL_RE.test(L)) return { ok: false, error: t("Podaj adres e-mail") };
    if (String(name || "").trim().length < 3) return { ok: false, error: t("Podaj imię i nazwisko (co najmniej 3 znaki)") };
    const pe = AuthLib.passwordError(password, L); if (pe) return { ok: false, error: pe };
    let s;
    if (sample) {
      s = R.Seed.build(this.today());
      const admin = R.byId(s.users, "u_admin");
      const clash = s.users.find(u => u.login === L && u.id !== "u_admin");
      if (clash) clash.login = clash.email = "demo." + clash.login;
      Object.assign(admin, { login: L, email: L, name: String(name).trim(), lang: lang || "" });
    } else s = R.Seed.minimal({ email: L, name: String(name).trim(), lang, today: this.today() });
    if (!R.companyEmail(s, L)) return { ok: false, error: t("Wymagany e-mail firmowy ({d})", { d: s.config.companyDomains.map(d => "@" + d).join(", ") }) };
    s.rev = (s.rev || 0) + 1;
    this.saveState(s, { id: "u_admin", login: L }, "system.setup", { sample: !!sample }, 0);
    this.setPassword("u_admin", password, false);
    if (sample) for (const u of s.users) if (u.id !== "u_admin" && R.statusOf(u) === "ACTIVE") this.setPassword(u.id, AuthLib.DEMO_PASSWORD, true);
    this.log("INFO", `Pierwsze uruchomienie: administrator ${L}, dane przykładowe: ${sample ? "tak" : "nie"}`);
    return { ok: true };
  }

  /** Rejestracja z ekranu logowania: profil „oczekuje na zatwierdzenie” + hasło (bez sesji). */
  register(rec, password, lang, meta) {
    I18N.setLang(lang || "pl");
    const pe = AuthLib.passwordError(password, rec && rec.email); if (pe) return { ok: false, errors: { password: pe }, error: pe };
    const rev0 = this.state.rev;
    const { res, state } = Service.register(this.state, rec, this.today(), meta);
    if (!state) return res;
    try { this.saveState(state, null, "auth.register", { email: res.rec.login }, rev0); }
    catch (e) { return { ok: false, error: t("Zapis w bazie nieudany — nic nie zapisano: {m}", { m: e.message }) }; }
    this.setPassword(res.rec.id, password, false);
    this.log("INFO", `Rejestracja: ${res.rec.login} — oczekuje na zatwierdzenie`);
    return { ok: true };
  }
  /* ---------------- tokeny e-mail (jednorazowe, w bazie tylko skrót) ---------------- */
  /** Nowy token; poprzednie niewykorzystane tokeny tego rodzaju dla użytkownika tracą ważność. */
  createToken(userId, kind, hours, email, createdBy) {
    const token = randomBytes(32).toString("base64url"), now = Date.now();
    this.tx(() => {
      this.db.prepare("UPDATE tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL").run(nowIso(), userId, kind);
      this.db.prepare("INSERT INTO tokens(token_hash, user_id, kind, email, created_at, expires_at, used_at, created_by) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)")
        .run(sha256(token), userId, kind, email || null, new Date(now).toISOString(), new Date(now + hours * 3600000).toISOString(), createdBy || null);
    });
    return token;
  }
  /** Sprawdzenie tokenu bez zużycia. Zwraca { ok, row } albo { ok:false, code: BAD|USED|EXPIRED }. */
  peekToken(token, kind) {
    if (!token || typeof token !== "string" || token.length < 20 || token.length > 100) return { ok: false, code: "BAD" };
    const row = this.db.prepare("SELECT * FROM tokens WHERE token_hash = ? AND kind = ?").get(sha256(token), kind);
    if (!row) return { ok: false, code: "BAD" };
    if (row.used_at) return { ok: false, code: "USED" };
    if (Date.parse(row.expires_at) < Date.now()) return { ok: false, code: "EXPIRED" };
    return { ok: true, row };
  }
  /** Zużycie tokenu (atomowo — drugi raz ten sam token nie przejdzie). */
  useToken(token, kind) {
    const p = this.peekToken(token, kind);
    if (!p.ok) return p;
    const r = this.db.prepare("UPDATE tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL").run(nowIso(), p.row.token_hash);
    return r.changes === 1 ? p : { ok: false, code: "USED" };
  }
  dropTokens(userId, kind) { this.db.prepare(`UPDATE tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL${kind ? " AND kind = ?" : ""}`).run(...[nowIso(), userId].concat(kind ? [kind] : [])); }
  tokenInfo(userId) {
    return this.db.prepare("SELECT kind, created_at AS createdAt, expires_at AS expiresAt, used_at AS usedAt FROM tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 5").all(userId);
  }
  logMail(template, to, userId, r, transport) {
    this.db.prepare("INSERT INTO outbox(ts, template, to_addr, user_id, status, error, provider_id, transport) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(nowIso(), template, to, userId || null, r.ok ? "SENT" : "FAILED", r.ok ? null : String(r.error || "").slice(0, 500), r.providerId || r.file || null, transport || "");
  }
  mailLog(limit = 200) { return this.db.prepare("SELECT id, ts, template, to_addr AS \"to\", user_id AS userId, status, error, transport FROM outbox ORDER BY id DESC LIMIT ?").all(limit); }
  dropAccount(userId) { this.tx(() => { this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId); this.db.prepare("DELETE FROM accounts WHERE user_id = ?").run(userId); }); }

  /* ---------------- kopie zapasowe ---------------- */
  backup(reason = "manual") {
    const stamp = nowIso().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const name = `resinvest-${stamp}-${reason}.sqlite`, file = join(this.cfg.backupDir, name);
    if (existsSync(file)) return { ok: true, name, file };
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    this.db.prepare("INSERT INTO meta(key, value) VALUES ('last_backup', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(nowIso());
    this.pruneBackups();
    this.log("INFO", `Kopia zapasowa: ${name}`);
    return { ok: true, name, file };
  }
  listBackups() {
    return readdirSync(this.cfg.backupDir).filter(f => /^resinvest-.*\.sqlite$/.test(f))
      .map(f => { const st = statSync(join(this.cfg.backupDir, f)); return { name: f, size: st.size, created: st.mtime.toISOString() }; })
      .sort((a, b) => a.created < b.created ? 1 : -1);
  }
  pruneBackups() {
    const limit = Date.now() - this.cfg.backup.keepDays * 86400000;
    for (const b of this.listBackups()) if (Date.parse(b.created) < limit && /-(auto|daily)\.sqlite$/.test(b.name)) { try { unlinkSync(join(this.cfg.backupDir, b.name)); } catch (e) {} }
  }
  lastBackup() { const r = this.db.prepare("SELECT value FROM meta WHERE key = 'last_backup'").get(); return r ? r.value : null; }
  /** Kopia automatyczna: raz dziennie po wskazanej godzinie, oraz przy starcie, jeśli ostatnia jest starsza niż 24 h. */
  autoBackup(force) {
    if (!this.state) return null;
    const last = this.lastBackup(), now = new Date();
    const due = force ? (!last || Date.now() - Date.parse(last) > 86400000) : (now.getHours() >= this.cfg.backup.hour && (!last || last.slice(0, 10) !== nowIso().slice(0, 10)));
    return due ? this.backup(force ? "auto" : "daily") : null;
  }
  backupPath(name) {
    const f = basename(String(name || ""));
    if (!/^resinvest-[\w-]+\.sqlite$/.test(f)) return null;
    const p = join(this.cfg.backupDir, f);
    return existsSync(p) ? p : null;
  }
  close() { try { this.db.close(); } catch (e) {} }
}
