#!/usr/bin/env node
/* =========================================================================
   ResInvest ERP Serwer — praca wielostanowiskowa w sieci lokalnej.

   Uruchomienie:  node --disable-warning=ExperimentalWarning server/riw-server.mjs
   Opcje:         --port 8080  --data <katalog>  --open (otwórz przeglądarkę)
                  --backup-now                      (kopia i zakończenie)
                  --restore <plik.sqlite>           (przywrócenie kopii; serwer zatrzymany)
                  --reset-password <login>          (nowe hasło tymczasowe; serwer zatrzymany)
                  --check                           (kontrola spójności bazy i dziennika)
   Interfejs: ten sam plik ResInvest_ERP.html co w trybie lokalnym — wykrywa
   serwer (/api/health) i przełącza się na logowanie z sesją serwerową.
   ========================================================================= */
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { readFileSync, existsSync, copyFileSync, createReadStream, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { ROOT, Store, loadConfig, makeLogger, verifyPassword, I18N, R, AuthLib } from "./core.mjs";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) { console.error(`ResInvest ERP Serwer wymaga Node.js 22.13 lub nowszego (jest ${process.versions.node}).`); process.exit(1); }

const t = (s, p) => I18N.t(s, p);
const N_ = s => s;
const arg = (name, def) => { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true) : def; };
const cfg = loadConfig(Object.assign({}, arg("--port") ? { port: Number(arg("--port")) } : {}, arg("--data") ? { dataDir: arg("--data") } : {}));
const log = makeLogger(join(cfg.dataDir, "logs"));
const HTML_FILE = join(ROOT, "ResInvest_ERP.html");
const VERSION = R.VERSION;

/* ---------------- polecenia administracyjne (bez uruchamiania serwera) ---------------- */
if (arg("--restore")) {
  const src = String(arg("--restore"));
  if (!existsSync(src)) { console.error("Brak pliku: " + src); process.exit(1); }
  const probe = new Store(Object.assign({}, cfg, { dataDir: join(cfg.dataDir, ".restore-check"), backupDir: join(cfg.dataDir, ".restore-check") }), () => {});
  probe.close();
  const target = join(cfg.dataDir, "resinvest.sqlite");
  if (existsSync(target)) { const keep = join(cfg.backupDir, `resinvest-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-pre-restore.sqlite`); copyFileSync(target, keep); console.log("Poprzednia baza zachowana: " + keep); }
  for (const x of ["-wal", "-shm"]) if (existsSync(target + x)) renameSync(target + x, target + x + ".old");
  copyFileSync(src, target);
  const s = new Store(cfg, console.log.bind(console, "[restore]"));
  console.log(s.integrity.ok ? `Przywrócono: rewizja ${s.state ? s.state.rev : "—"}.` : "UWAGA: " + s.integrity.notes.join("; "));
  s.close(); process.exit(0);
}
const store = new Store(cfg, log);
if (arg("--check")) { console.log(JSON.stringify({ ok: store.integrity.ok, notes: store.integrity.notes, rev: store.state && store.state.rev, journal: store.journalCount }, null, 1)); store.close(); process.exit(store.integrity.ok ? 0 : 2); }
if (arg("--backup-now")) { const r = store.backup("manual"); console.log(r.file); store.close(); process.exit(0); }
if (arg("--reset-password")) {
  const login = String(arg("--reset-password")).toLowerCase(), u = store.state && store.state.users.find(x => x.login === login);
  if (!u) { console.error("Nie znaleziono loginu: " + login); process.exit(1); }
  const pw = "Riw-" + randomBytes(6).toString("base64url") + "7";
  store.setPassword(u.id, pw, true); store.dropUserSessions(u.id);
  store.logLogin(login, u.id, true, N_("reset hasła z konsoli serwera"), "console");
  console.log(`Hasło tymczasowe dla ${login}: ${pw}\nUżytkownik ustawi własne hasło przy logowaniu.`);
  store.close(); process.exit(0);
}

/* ---------------- HTTP ---------------- */
const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
const tls = cfg.tls && cfg.tls.cert && cfg.tls.key && existsSync(cfg.tls.cert) && existsSync(cfg.tls.key);
const COOKIE = "riw_sid";
const clients = new Set();   // SSE
const ipHits = new Map();

function send(req, res, status, body, type = "application/json; charset=utf-8", extra = {}) {
  let data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const headers = Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, SEC_HEADERS, extra);
  if (data.length > 2048 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) { data = gzipSync(data); headers["Content-Encoding"] = "gzip"; }
  headers["Content-Length"] = Buffer.byteLength(data);
  res.writeHead(status, headers); res.end(data);
}
const json = (req, res, status, obj, extra) => send(req, res, status, obj, "application/json; charset=utf-8", extra);
function readBody(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
const cookies = req => Object.fromEntries(String(req.headers.cookie || "").split(";").map(x => x.trim().split("=")).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
const ipOf = req => (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
const langOf = (req, user) => (user && user.lang && I18N.has(user.lang)) ? user.lang : (String(req.headers["accept-language"] || "").slice(0, 2).toLowerCase().replace(/[^a-z]/g, "") || "pl");
const sessionCookie = token => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/${tls ? "; Secure" : ""}`;
const clearCookie = `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${tls ? "; Secure" : ""}`;
function rateLimited(ip) {
  const now = Date.now(), win = 15 * 60000, arr = (ipHits.get(ip) || []).filter(x => now - x < win);
  arr.push(now); ipHits.set(ip, arr);
  return arr.length > cfg.security.ipAttemptsPer15Min;
}
function broadcast(rev, by) {
  const msg = `event: rev\ndata: ${JSON.stringify({ rev, by })}\n\n`;
  for (const c of clients) { try { c.write(msg); } catch (e) { clients.delete(c); } }
}
/** Stan wysyłany do przeglądarki (konta i hasła nie są częścią stanu). */
const statePayload = () => ({ state: store.state, today: store.today(), rev: store.state.rev });

async function handleApi(req, res, url) {
  const method = req.method, path = url.pathname;
  const sid = cookies(req)[COOKIE];
  const sess = store.state ? store.session(sid) : null;
  const L = langOf(req, sess && sess.user);
  I18N.setLang(L);
  if (method !== "GET") {
    // ochrona przed CSRF: własny nagłówek (wymusza preflight dla obcych stron) + zgodność Origin
    if (req.headers["x-riw"] !== "1") return json(req, res, 403, { ok: false, error: t("Żądanie odrzucone (brak nagłówka aplikacji)") });
    const origin = req.headers.origin;
    if (origin && origin !== `${tls ? "https" : "http"}://${req.headers.host}`) return json(req, res, 403, { ok: false, error: t("Żądanie odrzucone (inne pochodzenie)") });
  }
  if (path === "/api/health") return json(req, res, 200, { ok: true, app: "resinvest-erp", mode: "server", version: VERSION, setup: !store.hasAccounts(), integrity: store.integrity.ok, host: req.headers.host });
  if (path === "/api/setup" && method === "POST") {
    if (store.hasAccounts()) return json(req, res, 409, { ok: false, error: t("Serwer jest już skonfigurowany") });
    const b = await readBody(req);
    const r = store.setup(b);
    return json(req, res, r.ok ? 200 : 400, r);
  }
  if (path === "/api/auth/login" && method === "POST") {
    const ip = ipOf(req);
    if (rateLimited(ip)) return json(req, res, 429, { ok: false, code: "RATE", error: t("Zbyt wiele prób logowania z tego adresu. Spróbuj za kilka minut.") });
    const b = await readBody(req);
    if (!store.state) return json(req, res, 503, { ok: false, error: t("Serwer nie jest skonfigurowany") });
    const r = store.login(b.login, b.password, ip);
    if (!r.ok) return json(req, res, 401, r);
    const token = store.createSession(r.user.id, ip, req.headers["user-agent"]);
    log("INFO", `Logowanie: ${r.user.login} (${ip})`);
    return json(req, res, 200, { ok: true, userId: r.user.id, mustChange: r.mustChange, user: { id: r.user.id, name: r.user.name, login: r.user.login, lang: r.user.lang, theme: r.user.theme } }, { "Set-Cookie": sessionCookie(token) });
  }
  if (path === "/api/auth/logout" && method === "POST") { if (sid) store.dropSession(sid); if (sess) store.logLogin(sess.user.login, sess.userId, true, N_("wylogowanie"), ipOf(req)); return json(req, res, 200, { ok: true }, { "Set-Cookie": clearCookie }); }

  /* ---- od tego miejsca wymagana sesja ---- */
  if (!sess && path === "/api/auth/me") return json(req, res, 200, { ok: false, code: "AUTH" });
  if (!sess) return json(req, res, 401, { ok: false, code: "AUTH", error: t("Sesja wygasła — zaloguj się ponownie.") }, { "Set-Cookie": clearCookie });
  const user = sess.user, acc = store.account(user.id);
  const must = acc && acc.must_change;
  if (path === "/api/auth/me") return json(req, res, 200, { ok: true, userId: user.id, mustChange: !!must, idleMinutes: cfg.session.idleMinutes, user: { id: user.id, name: user.name, login: user.login, lang: user.lang, theme: user.theme } });
  if (path === "/api/auth/password" && method === "POST") {
    const b = await readBody(req);
    if (!AuthLib || !store.account(user.id)) return json(req, res, 400, { ok: false, error: t("Nie znaleziono konta") });
    if (!verifyPassword(b.old, store.account(user.id))) { store.logLogin(user.login, user.id, false, N_("zmiana hasła — błędne obecne hasło"), ipOf(req)); return json(req, res, 400, { ok: false, field: "old", error: t("Obecne hasło jest nieprawidłowe") }); }
    const pe = AuthLib.passwordError(b.new, user.login); if (pe) return json(req, res, 400, { ok: false, field: "new", error: pe });
    if (verifyPassword(b.new, store.account(user.id))) return json(req, res, 400, { ok: false, field: "new", error: t("Nowe hasło musi być inne niż obecne") });
    store.setPassword(user.id, b.new, false); store.dropUserSessions(user.id, sid);
    store.logLogin(user.login, user.id, true, N_("zmiana hasła"), ipOf(req));
    return json(req, res, 200, { ok: true });
  }
  if (must) return json(req, res, 403, { ok: false, code: "MUST_CHANGE", error: t("Ustaw nowe hasło przed rozpoczęciem pracy") });

  if (path === "/api/state" && method === "GET") return json(req, res, 200, Object.assign({ ok: true }, statePayload()));
  if (path === "/api/events" && method === "GET") {
    res.writeHead(200, Object.assign({ "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" }, SEC_HEADERS));
    res.write(`event: rev\ndata: ${JSON.stringify({ rev: store.state.rev })}\n\n`);
    clients.add(res); req.on("close", () => clients.delete(res));
    return;
  }
  if (path === "/api/cmd" && method === "POST") {
    const b = await readBody(req);
    const r = store.execute(user.id, String(b.cmd || ""), b.args || {}, L);
    const changed = !!r.__changed; delete r.__changed;
    if (changed) {
      broadcast(store.state.rev, user.id);
      // dezaktywacja / zmiana konta — wylogowanie tego użytkownika na innych stanowiskach
      if (b.cmd === "user.save" && r.ok && r.rec && r.rec.active === false) store.dropUserSessions(r.rec.id);
    }
    return json(req, res, 200, Object.assign({ ok: true, res: r }, changed ? statePayload() : { today: store.today() }));
  }
  /* ---- użytkownicy i hasła (administrator) ---- */
  if (path.startsWith("/api/users")) {
    if (!R.can(user, "users.manage")) return json(req, res, 403, { ok: false, code: "FORBIDDEN", error: t("Zarządzanie użytkownikami wymaga roli Administrator") });
    if (path === "/api/users/accounts" && method === "GET") {
      const out = {};
      for (const u of store.state.users) { const a = store.account(u.id); out[u.id] = a ? { hasPassword: true, mustChange: !!a.must_change, failed: a.failed, lockedUntil: a.locked_until, lastLogin: a.last_login, changedAt: a.changed_at } : { hasPassword: false }; }
      return json(req, res, 200, { ok: true, accounts: out });
    }
    const b = await readBody(req);
    if (path === "/api/users" && method === "POST") {
      const pe = AuthLib.passwordError(b.password, b.rec && b.rec.login);
      if (pe) return json(req, res, 200, { ok: true, res: { ok: false, errors: { password: pe }, error: pe } });
      const r = store.execute(user.id, "user.save", { rec: b.rec, source: "Administracja — użytkownicy" }, L);
      const changed = !!r.__changed; delete r.__changed;
      if (r.ok) { store.setPassword(r.rec.id, b.password, true); store.logLogin(r.rec.login, r.rec.id, true, N_("hasło ustawione przez administratora"), ipOf(req)); }
      if (changed) broadcast(store.state.rev, user.id);
      return json(req, res, 200, Object.assign({ ok: true, res: r }, changed ? statePayload() : {}));
    }
    if (path === "/api/users/password" && method === "POST") {
      const u = R.byId(store.state.users, b.userId);
      if (!u) return json(req, res, 404, { ok: false, error: t("Nie znaleziono użytkownika") });
      const pe = AuthLib.passwordError(b.password, u.login); if (pe) return json(req, res, 400, { ok: false, error: pe });
      store.setPassword(u.id, b.password, b.mustChange !== false); store.dropUserSessions(u.id);
      store.logLogin(u.login, u.id, true, N_("hasło ustawione przez administratora"), ipOf(req));
      return json(req, res, 200, { ok: true });
    }
    if (path === "/api/users/unlock" && method === "POST") {
      if (!store.account(b.userId)) return json(req, res, 404, { ok: false, error: t("Nie znaleziono konta") });
      store.db.prepare("UPDATE accounts SET failed = 0, locked_until = NULL WHERE user_id = ?").run(b.userId);
      return json(req, res, 200, { ok: true });
    }
  }
  if (path === "/api/auth/log" && method === "GET") {
    if (!R.can(user, "users.manage")) return json(req, res, 403, { ok: false, error: t("Zarządzanie użytkownikami wymaga roli Administrator") });
    const rows = store.db.prepare("SELECT ts, login, user_id AS userId, ok, reason, ip FROM login_log ORDER BY id DESC LIMIT 300").all().map(r => Object.assign({}, r, { ok: !!r.ok }));
    return json(req, res, 200, { ok: true, log: rows });
  }
  /* ---- kopie zapasowe ---- */
  if (path === "/api/backups") {
    if (!R.can(user, "data.backup")) return json(req, res, 403, { ok: false, error: t("Brak uprawnienia „{p}”", { p: "data.backup" }) });
    if (method === "POST") { const r = store.backup("manual"); return json(req, res, 200, { ok: true, name: r.name }); }
    return json(req, res, 200, { ok: true, backups: store.listBackups(), keepDays: cfg.backup.keepDays, dir: cfg.backupDir, last: store.lastBackup() });
  }
  if (path.startsWith("/api/backups/") && method === "GET") {
    if (!R.can(user, "data.backup")) return json(req, res, 403, { ok: false, error: t("Brak uprawnienia „{p}”", { p: "data.backup" }) });
    const f = store.backupPath(decodeURIComponent(path.slice("/api/backups/".length)));
    if (!f) return json(req, res, 404, { ok: false, error: t("Nie znaleziono") });
    res.writeHead(200, Object.assign({ "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${f.split(/[\\/]/).pop()}"`, "Content-Length": statSync(f).size }, SEC_HEADERS));
    return void createReadStream(f).pipe(res);
  }
  return json(req, res, 404, { ok: false, error: t("Nie znaleziono") });
}

async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/ResInvest_ERP.html")) {
      if (!existsSync(HTML_FILE)) return send(req, res, 500, "Brak pliku ResInvest_ERP.html — uruchom: npm run build", "text/plain; charset=utf-8");
      return send(req, res, 200, readFileSync(HTML_FILE), "text/html; charset=utf-8");
    }
    if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
    send(req, res, 404, "Not found", "text/plain; charset=utf-8");
  } catch (e) {
    log("ERROR", `${req.method} ${url.pathname}: ${e.stack || e.message}`);
    if (!res.headersSent) json(req, res, e.message === "too large" ? 413 : 500, { ok: false, error: t("Błąd serwera: {m}", { m: e.message }) });
  }
}

const server = tls ? createHttps({ cert: readFileSync(cfg.tls.cert), key: readFileSync(cfg.tls.key) }, handler) : createHttp(handler);
server.requestTimeout = 120000;
server.listen(cfg.port, cfg.host, () => {
  const proto = tls ? "https" : "http";
  const ips = Object.values(networkInterfaces()).flat().filter(n => n && n.family === "IPv4" && !n.internal).map(n => n.address);
  log("INFO", `ResInvest ERP Serwer ${VERSION} — ${proto}://localhost:${cfg.port}` + (cfg.host === "0.0.0.0" && ips.length ? ` · w sieci: ${ips.map(ip => `${proto}://${ip}:${cfg.port}`).join(", ")}` : ""));
  log("INFO", `Dane: ${cfg.dataDir} · kopie: ${cfg.backupDir} · spójność: ${store.integrity.ok ? "OK" : store.integrity.notes.join("; ")}`);
  if (!store.hasAccounts()) log("INFO", "Pierwsze uruchomienie — otwórz adres serwera w przeglądarce i utwórz konto administratora.");
  if (arg("--open")) { const u = `${proto}://localhost:${cfg.port}/`; const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", u]] : process.platform === "darwin" ? ["open", [u]] : ["xdg-open", [u]]; try { spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref(); } catch (e) {} }
  try { store.autoBackup(true); } catch (e) { log("ERROR", "Kopia przy starcie: " + e.message); }
});
const timers = [
  setInterval(() => { try { store.autoBackup(false); store.purgeSessions(); } catch (e) { log("ERROR", "Kopia automatyczna: " + e.message); } }, 10 * 60000),
  setInterval(() => { for (const c of clients) { try { c.write(": ping\n\n"); } catch (e) { clients.delete(c); } } }, 25000)
];
function shutdown(sig) {
  log("INFO", `Zatrzymywanie (${sig})…`);
  timers.forEach(clearInterval);
  for (const c of clients) { try { c.end(); } catch (e) {} }
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => { store.close(); process.exit(0); }, 3000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
