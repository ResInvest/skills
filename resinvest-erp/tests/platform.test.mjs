/* Testy platformy 3.0: tłumaczenia, kryptografia haseł, logowanie lokalne, warstwa usług.
   Uruchomienie:  node --test tests/platform.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pbkdf2Sync, createHash } from "node:crypto";
import { extract, dictionaries, problems } from "../tools/i18n-extract.mjs";

const require = createRequire(import.meta.url);
globalThis.RIW_CONFIG = JSON.parse(readFileSync(new URL("../config/app.config.json", import.meta.url), "utf8"));
const I18N = require("../app/src/i18n.js");
dictionaries();
const R = require("../app/src/engine.js");
const Service = require("../app/src/service.js");
require("../app/src/seed.js");
const Auth = require("../app/src/auth.js");

/** Pamięć przeglądarki w Node (localStorage / sessionStorage). */
const memStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; };
globalThis.localStorage = memStorage();
globalThis.sessionStorage = memStorage();

const TODAY = "2026-09-23";
const fresh = () => R.Seed.build(TODAY);
const ctxOf = (s, id) => ({ user: { id }, today: TODAY, source: "test" });

/* ============================ tłumaczenia ============================ */
test("i18n: każdy tekst z kodu ma tłumaczenie CS i EN z tymi samymi parametrami", () => {
  const keys = extract(), pr = problems(keys, I18N.dict);
  assert.ok(keys.size > 1400, `za mało kluczy: ${keys.size}`);
  assert.deepEqual(pr.slice(0, 10), []);
});
test("i18n: słowniki nie zawierają kluczy spoza kodu", () => {
  const keys = extract();
  for (const lang of ["cs", "en"]) assert.deepEqual(Object.keys(I18N.dict[lang]).filter(k => !keys.has(k)), [], lang);
});
test("i18n: liczba mnoga PL / CS / EN", () => {
  const k = "{n} operacja|{n} operacje|{n} operacji";
  assert.deepEqual([1, 3, 5, 22, 25].map(n => I18N.tp(k, n, null, "pl")), ["1 operacja", "3 operacje", "5 operacji", "22 operacje", "25 operacji"]);
  assert.deepEqual([1, 3, 5].map(n => I18N.tp(k, n, null, "cs")), ["1 operace", "3 operace", "5 operací"]);
  assert.deepEqual([1, 3].map(n => I18N.tp(k, n, null, "en")), ["1 operation", "3 operations"]);
});
test("i18n: formaty liczb i dat zależne od języka", () => {
  assert.equal(I18N.num("1234567", "50", "pl").replace(/[\u00A0\u202F]/g, " "), "1 234 567,50");
  assert.equal(I18N.num("1234567", "50", "en"), "1,234,567.50");
  assert.equal(I18N.date("2026-09-23", "cs"), "23.09.2026");
  assert.equal(I18N.date("2026-09-23", "en"), "23/09/2026");
});
test("i18n: tekst zapisany w danych {k, p} tłumaczony przy wyświetlaniu (również parametry {t})", () => {
  const v = { k: "Utworzenie i zatwierdzenie: {type}", p: { type: { t: "Zakup" } } };
  assert.equal(I18N.tr(v, "pl"), "Utworzenie i zatwierdzenie: Zakup");
  assert.equal(I18N.tr(v, "en"), "Created and approved: Purchase");
  assert.equal(I18N.tr(v, "cs"), "Vytvoření a potvrzení: Nákup");
});
test("i18n: wybór języka — zapisany → przeglądarka → polski", () => {
  assert.equal(I18N.detect("en", "cs-CZ"), "en");
  assert.equal(I18N.detect("", "cs-CZ"), "cs");
  assert.equal(I18N.detect("", "de-DE"), "pl");
});

/* ============================ kryptografia haseł ============================ */
test("Auth: SHA-256 i PBKDF2 w czystym JS zgodne z Node crypto", () => {
  const enc = s => new TextEncoder().encode(s);
  assert.equal(Auth.hex(Auth.sha256(enc("ResInvest ERP — zażółć"))), createHash("sha256").update("ResInvest ERP — zażółć").digest("hex"));
  const salt = enc("sól-testowa-16b!");
  assert.equal(Auth.hex(Auth.pbkdf2Js(enc("demo1234"), salt, 1000)), pbkdf2Sync("demo1234", Buffer.from(salt), 1000, 32, "sha256").toString("hex"));
});
test("Auth: skrót hasła z solą — weryfikacja poprawnego i odrzucenie błędnego", async () => {
  const a = await Auth.hashPassword("Magazyn2026", 5000), b = await Auth.hashPassword("Magazyn2026", 5000);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.equal(await Auth.verifyPassword("Magazyn2026", a), true);
  assert.equal(await Auth.verifyPassword("magazyn2026", a), false);
});
test("Auth: polityka haseł (długość, litery i cyfry, bez loginu)", () => {
  I18N.setLang("pl");
  assert.match(Auth.passwordError("abc1", "jan"), /co najmniej 8 znaków/);
  assert.match(Auth.passwordError("abcdefgh", "jan"), /litery i cyfry/);
  assert.match(Auth.passwordError("kowalski2026", "kowalski"), /nie może zawierać loginu/);
  assert.equal(Auth.passwordError("Biomasa2026", "kowalski"), null);
});

/* ============================ logowanie lokalne ============================ */
test("LocalAuth: konta demonstracyjne, logowanie, blokada po 5 próbach, odblokowanie", async () => {
  localStorage.clear(); sessionStorage.clear();
  const L = Auth.LocalAuth; L.store = null;
  const s = fresh();
  await L.ensureDemo(s);
  const ok = await L.login(s, "Anna.Gorska@resinvest.group", "demo1234");
  assert.equal(ok.ok, true); assert.equal(ok.userId, "u_kier");
  assert.equal(L.session().userId, "u_kier");
  L.logout("manual");
  assert.equal(L.session(), null);
  for (let i = 0; i < 5; i++) assert.equal((await L.login(s, "adrian.wojciechowski@resinvest.group", "zle-haslo1")).code, "BAD");
  const locked = await L.login(s, "adrian.wojciechowski@resinvest.group", "demo1234");
  assert.equal(locked.code, "LOCKED");
  assert.equal(L.unlock(R.byId(s.users, "u_mag"), "u_mag").ok, false, "magazynier nie odblokowuje kont");
  assert.equal(L.unlock(R.byId(s.users, "u_admin"), "u_mag").ok, true);
  assert.equal((await L.login(s, "adrian.wojciechowski@resinvest.group", "demo1234")).ok, true);
  assert.equal((await L.login(s, "nieznany@resinvest.group", "demo1234")).error, "Nieprawidłowy login lub hasło", "ten sam komunikat dla nieznanego loginu");
  assert.ok(L.loginLog().some(x => x.reason === "błędne hasło"));
});
test("LocalAuth: zmiana hasła i hasło nadane przez administratora (wymuszona zmiana)", async () => {
  localStorage.clear(); sessionStorage.clear();
  const L = Auth.LocalAuth; L.store = null;
  const s = fresh();
  await L.ensureDemo(s);
  assert.equal((await L.changePassword(s, "u_kier", "zle", "Nowe2026haslo")).field, "old");
  assert.equal((await L.changePassword(s, "u_kier", "demo1234", "krotkie")).field, "new");
  assert.equal((await L.changePassword(s, "u_kier", "demo1234", "Nowe2026haslo")).ok, true);
  assert.equal((await L.login(s, "anna.gorska@resinvest.group", "demo1234")).ok, false);
  assert.equal((await L.login(s, "anna.gorska@resinvest.group", "Nowe2026haslo")).ok, true);
  assert.equal((await L.setPassword(s, R.byId(s.users, "u_kier"), "u_mag", "Tymczas2026")).ok, false, "tylko administrator");
  assert.equal((await L.setPassword(s, R.byId(s.users, "u_admin"), "u_mag", "Tymczas2026")).ok, true);
  const r = await L.login(s, "adrian.wojciechowski@resinvest.group", "Tymczas2026");
  assert.equal(r.ok, true); assert.equal(r.mustChange, true);
});

/* ============================ warstwa usług ============================ */
test("Service: uprawnienia sprawdzane przed wykonaniem komendy", () => {
  const s = fresh();
  const r = Service.exec(s, "master.save", { kind: "products", rec: { name: "Zrębka X", code: "ZR-X", cat: "zrebka", unit: "MP" } }, ctxOf(s, "u_view"));
  assert.equal(r.code, "FORBIDDEN");
  assert.equal(Service.exec(s, "brak.komendy", {}, ctxOf(s, "u_admin")).code, "UNKNOWN");
  assert.equal(Service.exec(s, "me.prefs", {}, null).code, "AUTH");
});
test("Service: „wszystko albo nic” — odrzucona komenda nie zmienia stanu", () => {
  const s = fresh(), before = JSON.stringify(s);
  const d = R.Seed.draftOf(TODAY, { type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "999999", unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "none", place: "RiC Zabrze" } });
  const { res, state } = Service.run(s, "op.commit", { draft: d }, ctxOf(s, "u_kier"));
  assert.equal(res.ok, false);
  assert.equal(state, null);
  assert.equal(JSON.stringify(s), before);
});
test("Service: zatwierdzenie operacji zwraca nowy stan z wyższą rewizją i wpisem audytu", () => {
  const s = fresh();
  const d = R.Seed.draftOf(TODAY, { type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "100", unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "none", place: "RiC Zabrze" } });
  const { res, state } = Service.run(s, "op.commit", { draft: d }, ctxOf(s, "u_kier"));
  assert.equal(res.ok, true, res.error);
  assert.ok(state.rev > s.rev);
  assert.equal(state.operations.length, s.operations.length + 1);
  const a = state.audit.at(-1);
  assert.equal(a.userId, "u_kier");
  assert.equal(R.auditText(a), "Utworzenie i zatwierdzenie: Sprzedaż");
});
test("Kartoteki: NIP z sumą kontrolną, unikalny kod, jednostka zgodna z kategorią", () => {
  const s = fresh(), c = ctxOf(s, "u_kier");
  assert.equal(R.nipValid("5260250274"), true);
  assert.equal(R.nipValid("5260250275"), false);
  const bad = Service.exec(s, "master.save", { kind: "partners", rec: { name: "Firma Test", role: "buyer", nip: "1234567890" } }, c);
  assert.equal(bad.ok, false);
  const ok = Service.exec(s, "master.save", { kind: "partners", rec: { name: "Firma Test", role: "buyer", nip: "526-025-02-74" } }, c);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const dup = Service.exec(s, "master.save", { kind: "products", rec: { name: "Inna nazwa", code: "ZR-PL", cat: "zrebka", unit: "MP" } }, c);
  assert.equal(dup.ok, false);
});
test("Użytkownicy: nie można dezaktywować ostatniego administratora ani zmienić własnej roli", () => {
  const s = fresh(), c = ctxOf(s, "u_admin");
  const me = R.byId(s.users, "u_admin");
  assert.equal(Service.exec(s, "user.save", { rec: Object.assign({}, me, { role: "kierownik" }) }, c).ok, false);
  assert.equal(Service.exec(s, "user.save", { rec: Object.assign({}, me, { active: false }) }, c).ok, false);
  const n = Service.exec(s, "user.save", { rec: { name: "Jan Nowy", email: "jan.nowy@resinvest.group", role: "magazynier", whId: "wh_zab", active: true } }, c);
  assert.equal(n.ok, true, JSON.stringify(n));
  assert.equal(Service.exec(s, "user.save", { rec: { name: "Jan Drugi", email: "Jan.Nowy@resinvest.group", role: "magazynier", whId: "wh_zab", active: true } }, c).ok, false, "login unikalny");
});
test("Preferencje użytkownika (język, motyw) zapisywane w profilu", () => {
  const s = fresh();
  const { res, state } = Service.run(s, "me.prefs", { lang: "cs", theme: "azure" }, ctxOf(s, "u_mag"));
  assert.equal(res.ok, true);
  const u = R.byId(state.users, "u_mag");
  assert.equal(u.lang, "cs"); assert.equal(u.theme, "azure");
  assert.equal(Service.exec(s, "me.prefs", { lang: "de" }, ctxOf(s, "u_mag")).ok, false);
});
test("Migracja schematu 3 → 5: loginy z nazwisk → e-mail firmowy, flagi aktywności, historia nienaruszona", () => {
  const s = fresh();
  const old = JSON.parse(JSON.stringify(s));
  old.schema = 3;
  old.users.forEach(u => { if (u.role === "obserwator") u.role = "podglad"; u.email = ""; });
  old.users.forEach(u => { delete u.login; delete u.lang; delete u.theme; });
  old.warehouses.forEach(w => delete w.active);
  const m = R.migrate(old);
  assert.equal(m.error, undefined);
  assert.equal(m.state.schema, R.SCHEMA);
  const logins = m.state.users.map(u => u.login);
  assert.equal(new Set(logins).size, logins.length);
  assert.ok(logins.every(l => /^[a-z0-9][a-z0-9._-]{2,31}@resinvest\.group$/.test(l)), logins.join(","));
  assert.ok(m.state.users.every(u => R.ROLES[u.role]), "rola Podgląd → Obserwator");
  assert.ok(m.state.warehouses.every(w => w.active === true));
  assert.equal(m.state.operations.length, s.operations.length);
  assert.deepEqual(R.validateStateShape(m.state), []);
});
test("Import kopii: zalogowany administrator zostaje zachowany, rewizja rośnie", () => {
  const s = fresh();
  const backup = fresh();
  backup.users = backup.users.filter(u => u.id !== "u_admin");
  const { res, state } = Service.run(s, "data.import", { state: backup }, ctxOf(s, "u_admin"));
  assert.equal(res.ok, true, res.error);
  assert.ok(R.byId(state.users, "u_admin"));
  assert.ok(state.rev > s.rev);
  assert.equal(Service.exec(fresh(), "data.import", { state: { schema: 4 } }, ctxOf(s, "u_admin")).ok, false);
});

/* ============================ 3.1: role, zatwierdzanie, rejestracja, magazyny ============================ */
const WZ_DRAFT = (qty = "100") => R.Seed.draftOf(TODAY, { type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty, unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "none", place: "RiC Zabrze" } });

test("Role 3.1: Administrator wszystko, Kierownik zatwierdza, Magazynier przekazuje, Obserwator tylko podgląd", () => {
  assert.deepEqual(Object.keys(R.ROLES), ["admin", "kierownik", "magazynier", "obserwator"]);
  const s = fresh(), u = id => R.byId(s.users, id);
  assert.equal(R.can(u("u_admin"), "users.manage"), true);
  assert.equal(R.can(u("u_kier"), "op.approve"), true);
  assert.equal(R.can(u("u_mag"), "op.approve"), false);
  assert.equal(R.can(u("u_mag"), "op.create"), true);
  assert.equal(R.can(u("u_view"), "op.create"), false);
  assert.equal(R.can(u("u_view"), "report.view"), true);
  assert.equal(R.canApprove(u("u_kier"), "wh_bra"), false, "kierownik zatwierdza tylko swój magazyn");
  assert.equal(R.canApprove(u("u_admin"), "wh_rok"), true, "administrator — każdy magazyn");
  assert.equal(Service.exec(s, "op.commit", { draft: WZ_DRAFT() }, ctxOf(s, "u_mag")).code, "FORBIDDEN", "magazynier nie zatwierdza bezpośrednio");
  assert.equal(Service.exec(s, "op.submit", { draft: WZ_DRAFT() }, ctxOf(s, "u_view")).code, "FORBIDDEN", "obserwator nie wprowadza operacji");
});

test("Obieg zatwierdzania: magazynier przekazuje (bez numeru i bez zmiany stanu) → kierownik zatwierdza", () => {
  const s0 = fresh(), bal0 = R.Stock.balance(s0, "wh_zab", "pr_zr_lesna");
  const sub = Service.run(s0, "op.submit", { draft: WZ_DRAFT() }, ctxOf(s0, "u_mag"));
  assert.equal(sub.res.ok, true, sub.res.error);
  const s1 = sub.state, rec = s1.drafts.find(d => d.status === "PENDING");
  assert.ok(rec && rec.summary.includes("100 MP"), JSON.stringify(rec && rec.summary));
  assert.equal(s1.operations.length, s0.operations.length, "brak dokumentu przed zatwierdzeniem");
  assert.equal(R.Stock.balance(s1, "wh_zab", "pr_zr_lesna"), bal0, "brak zmiany stanu przed zatwierdzeniem");
  assert.equal(Service.exec(R.clone(s1), "op.approve", { id: rec.id }, ctxOf(s1, "u_kbra")).code, "FORBIDDEN", "kierownik innego magazynu");
  const ap = Service.run(s1, "op.approve", { id: rec.id }, ctxOf(s1, "u_kier"));
  assert.equal(ap.res.ok, true, ap.res.error);
  const op = ap.state.operations.at(-1);
  assert.equal(op.userId, "u_mag"); assert.equal(op.approvedById, "u_kier");
  assert.ok(op.no.startsWith("WZ/"));
  assert.equal(R.Stock.balance(ap.state, "wh_zab", "pr_zr_lesna"), bal0 - 100);
  assert.equal(ap.state.drafts.some(d => d.id === rec.id), false);
  assert.match(R.auditText(ap.state.audit.at(-1)), /Zatwierdzenie operacji: Sprzedaż \(wprowadził: Adrian Wojciechowski\)/);
  const again = Service.run(ap.state, "op.approve", { id: rec.id }, ctxOf(s1, "u_kier"));
  assert.equal(again.res.ok, false, "drugie zatwierdzenie tej samej operacji");
});

test("Obieg zatwierdzania: odrzucenie z powodem wraca do autora jako wersja robocza", () => {
  const s0 = fresh();
  const s1 = Service.run(s0, "op.submit", { draft: WZ_DRAFT("50") }, ctxOf(s0, "u_mag")).state;
  const id = s1.drafts[0].id;
  assert.equal(Service.exec(R.clone(s1), "op.reject", { id, reason: "" }, ctxOf(s1, "u_kier")).ok, false, "powód wymagany");
  const r = Service.run(s1, "op.reject", { id, reason: "zła cena" }, ctxOf(s1, "u_kier"));
  assert.equal(r.res.ok, true);
  const d = r.state.drafts.find(x => x.id === id);
  assert.equal(d.status, "DRAFT"); assert.equal(d.rejectReason, "zła cena"); assert.equal(d.rejectedBy, "Anna Górska");
  const again = Service.run(r.state, "op.submit", { draft: Object.assign(R.clone(d.draft), { draftId: id }) }, ctxOf(s1, "u_mag"));
  assert.equal(again.res.ok, true, "autor przekazuje ponownie");
  assert.equal(again.state.drafts.find(x => x.id === id).status, "PENDING");
});

test("Zatwierdzenie sprawdza stan w chwili zatwierdzenia (bez stanów ujemnych)", () => {
  const s0 = fresh(), have = R.Stock.balance(s0, "wh_zab", "pr_zr_tow");
  const d = R.Seed.draftOf(TODAY, { type: "SPRZEDAZ", sale: { productId: "pr_zr_tow", qty: String(have), unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "none", place: "RiC Zabrze" } });
  let s = Service.run(s0, "op.submit", { draft: d }, ctxOf(s0, "u_mag")).state;
  const id = s.drafts[0].id;
  s = Service.run(s, "op.commit", { draft: R.Seed.draftOf(TODAY, { type: "SPRZEDAZ", sale: { productId: "pr_zr_tow", qty: "10", unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "none", place: "RiC Zabrze" } }) }, ctxOf(s, "u_kier")).state;
  const ap = Service.run(s, "op.approve", { id }, ctxOf(s, "u_kier"));
  assert.equal(ap.res.ok, false);
  assert.match(ap.res.error, /Nie można sprzedać/);
});

test("Logowanie e-mailem firmowym: domena z konfiguracji, unikalny adres, rejestracja oczekuje na administratora", async () => {
  const s = fresh(), c = ctxOf(s, "u_admin");
  assert.equal(Service.exec(s, "user.save", { rec: { name: "Jan Obcy", email: "jan@gmail.com", role: "magazynier", whId: "wh_zab" } }, c).ok, false);
  const reg = Service.register(s, { name: "Ewa Nowicka", email: "Ewa.Nowicka@resinvest.group" }, TODAY);
  assert.equal(reg.res.ok, true, reg.res.error);
  const u = reg.state.users.find(x => x.login === "ewa.nowicka@resinvest.group");
  assert.equal(u.pending, true); assert.equal(u.active, false); assert.equal(u.role, "obserwator");
  assert.equal(Service.register(reg.state, { name: "Ewa Druga", email: "ewa.nowicka@resinvest.group" }, TODAY).res.ok, false, "adres już zarejestrowany");
  assert.equal(Service.register(s, { name: "Obcy Ktoś", email: "ktos@example.com" }, TODAY).res.ok, false, "tylko domena firmowa");
  localStorage.clear(); sessionStorage.clear();
  const L = Auth.LocalAuth; L.store = null;
  await L.setInitial(reg.state, u.id, "Rejestracja2026");
  assert.equal((await L.login(reg.state, "ewa.nowicka@resinvest.group", "Rejestracja2026")).code, "PENDING");
  const ok = Service.run(reg.state, "user.save", { rec: Object.assign({}, u, { role: "magazynier", whId: "wh_rok", active: true }) }, ctxOf(reg.state, "u_admin"));
  assert.equal(ok.res.ok, true, ok.res.error);
  const after = R.byId(ok.state.users, u.id);
  assert.equal(after.pending, undefined); assert.equal(after.approvedBy, "Mateusz Roesner");
  assert.equal((await L.login(ok.state, "ewa.nowicka@resinvest.group", "Rejestracja2026")).ok, true);
});

test("Administrator dodaje innych administratorów; usunięcie konta tylko bez historii", () => {
  const s = fresh(), c = ctxOf(s, "u_admin");
  const n = Service.run(s, "user.save", { rec: { name: "Druga Admin", email: "druga.admin@resinvest.group", role: "admin", whId: "wh_bra", active: true } }, c);
  assert.equal(n.res.ok, true, n.res.error);
  const id = n.res.rec.id;
  assert.equal(Service.exec(R.clone(n.state), "user.remove", { id: "u_mag" }, c).ok, false, "konto z historią");
  assert.equal(Service.exec(R.clone(n.state), "user.remove", { id: "u_admin" }, c).ok, false, "własne konto");
  const del = Service.run(n.state, "user.remove", { id }, c);
  assert.equal(del.res.ok, true, del.res.error);
  assert.equal(R.byId(del.state.users, id), null);
});

test("Magazyny i flota: 3 magazyny RiC, przydział floty, pojazd z innego magazynu odrzucony", () => {
  const s = fresh();
  assert.deepEqual(s.warehouses.map(w => w.name), ["RiC Zabrze", "RiC Brąszewice", "RiC Rokitki"]);
  assert.deepEqual(R.Seed.minimal({}).warehouses.map(w => w.name), ["RiC Zabrze", "RiC Brąszewice", "RiC Rokitki"]);
  assert.equal(R.byId(s.fleet.vehicles, "ve_daf").whId, "wh_rok");
  const d = R.Seed.draftOf(TODAY, { type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "20", unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "own", place: "EC", own: { vehicleId: "ve_daf", km: "10", rate: "5", qty: "20" } } });
  const r = Service.exec(R.clone(s), "op.commit", { draft: d }, ctxOf(s, "u_kier"));
  assert.equal(r.ok, false);
  assert.match(r.error, /przypisany do magazynu RiC Rokitki/);
  const mv = Service.run(s, "fleet.save", { kind: "vehicles", rec: Object.assign({}, R.byId(s.fleet.vehicles, "ve_daf"), { whId: "wh_zab" }) }, ctxOf(s, "u_kier"));
  assert.equal(mv.res.ok, true, mv.res.error);
  assert.equal(Service.exec(mv.state, "op.commit", { draft: d }, ctxOf(s, "u_kier")).ok, true, "po przeniesieniu pojazdu do Zabrza");
});

test("Usuwanie: nieużywany rekord tak, użyty w dokumentach — nie (dezaktywacja)", () => {
  const s = fresh(), c = ctxOf(s, "u_kier");
  assert.equal(Service.exec(R.clone(s), "fleet.remove", { kind: "vehicles", id: "ve_scania" }, c).ok, false, "pojazd z kursami");
  assert.equal(Service.exec(R.clone(s), "fleet.remove", { kind: "vehicles", id: "ve_daf" }, c).ok, true, "pojazd bez kursów");
  assert.equal(Service.exec(R.clone(s), "master.remove", { kind: "products", id: "pr_drewno" }, c).ok, false);
  assert.equal(Service.exec(R.clone(s), "master.remove", { kind: "warehouses", id: "wh_rok" }, c).ok, false, "przypisani ludzie i flota");
  const w = Service.run(s, "master.save", { kind: "warehouses", rec: { code: "TST", name: "RiC Test", address: "", active: true } }, c);
  assert.equal(Service.exec(w.state, "master.remove", { kind: "warehouses", id: w.res.rec.id }, c).ok, true);
});

test("Administrator przełącza magazyn roboczy; start pracy na czysto zachowuje kartoteki i konta", () => {
  const s = fresh();
  assert.equal(Service.exec(R.clone(s), "me.warehouse", { whId: "wh_rok" }, ctxOf(s, "u_kier")).ok, false);
  const sw = Service.run(s, "me.warehouse", { whId: "wh_rok" }, ctxOf(s, "u_admin"));
  assert.equal(R.byId(sw.state.users, "u_admin").whId, "wh_rok");
  assert.equal(Service.exec(R.clone(s), "data.clean", { confirm: "WYCZYŚĆ" }, ctxOf(s, "u_kier")).code, "FORBIDDEN");
  assert.equal(Service.exec(R.clone(s), "data.clean", { confirm: "nie" }, ctxOf(s, "u_admin")).ok, false);
  const cl = Service.run(s, "data.clean", { confirm: "WYCZYŚĆ" }, ctxOf(s, "u_admin"));
  assert.equal(cl.res.ok, true, cl.res.error);
  assert.equal(cl.state.operations.length, 0); assert.equal(cl.state.ledger.length, 0);
  assert.equal(cl.state.users.length, s.users.length); assert.equal(cl.state.warehouses.length, 3); assert.equal(cl.state.fleet.vehicles.length, s.fleet.vehicles.length);
});
