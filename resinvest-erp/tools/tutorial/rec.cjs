/* Nagrywarka samouczka ResInvest ERP.
   Steruje programem w Chromium (jasny motyw „Perła”, okno 1600×900 CSS px × skala 1,2 = kadr 1920×1080, bez ucinania),
   zapisuje klatki kluczowe (JPEG) i oś zdarzeń w czasie wirtualnym: ruchy kursora, kliknięcia, strzałki, ramki.
   Czas akcji jest dopasowany do zdań lektora z timing.json (beat(i) = początek zdania i).
   Montaż (compose.py) dorysowuje kursor, podświetlenie kliknięć, strzałki, plansze i napisy.
   Uruchomienie: NODE_PATH=$(npm root -g) node rec.cjs [numery rozdziałów, np. 1 4 5] */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const HERE = __dirname, CAP = path.join(HERE, "cap");
const APP = "file://" + path.resolve(__dirname, "../../ResInvest_ERP.html");
const TL = JSON.parse(fs.readFileSync(path.join(HERE, "timing.json"), "utf8"));
const DPR = 1.2, VW = 1600, VH = 900;
const ONLY = process.argv.slice(2).map(Number).filter(Boolean);
const C = { pink: "#FF1F8E", orange: "#FF7A00", lime: "#3BE000", cyan: "#00B8FF", violet: "#8B3DFF", yellow: "#FFC400" };

class Rec {
  constructor(page, ch) {
    this.p = page; this.ch = ch; this.T = 0; this.k = 1; this.n = 0; this.ev = []; this.miss = [];
    this.dir = path.join(CAP, String(ch.no).padStart(2, "0"));
    fs.rmSync(this.dir, { recursive: true, force: true }); fs.mkdirSync(this.dir, { recursive: true });
  }
  beatT(i) { const s = this.ch.sentences; return i < s.length ? s[i].t : this.ch.voiceDur; }
  /** Czekanie na zdanie lektora i samoregulacja tempa: spóźnione akcje przyspieszają, zapas je uspokaja. */
  async beat(i, off = 0) {
    const t = this.beatT(i) + off, lag = this.T - t;
    if (lag > 0.4) this.k = Math.max(0.4, this.k * 0.8);
    else if (lag < -2.5) this.k = Math.min(this.k0 ?? 1, this.k * 1.1);
    if (this.T < t) this.T = t;
  }
  wait(s) { this.T += s; }
  async shot() {
    const f = `${String(this.n++).padStart(4, "0")}.jpg`;
    await this.p.screenshot({ path: path.join(this.dir, f), type: "jpeg", quality: 90 });
    this.ev.push({ t: +this.T.toFixed(3), type: "shot", f });
  }
  async settle(ms = 280) { await this.p.waitForTimeout(ms); }
  /** Prostokąt elementu w pikselach kadru (null, gdy brak). */
  async rect(sel) {
    const r = await this.p.evaluate(s => { const e = typeof s === "string" ? document.querySelector(s) : null; if (!e) return null; const b = e.getBoundingClientRect(); return b.width || b.height ? { x: b.left, y: b.top, w: b.width, h: b.height } : null; }, sel).catch(() => null);
    if (!r) { this.miss.push(sel); return null; }
    return { x: r.x * DPR, y: r.y * DPR, w: r.w * DPR, h: r.h * DPR };
  }
  /** Płynne przewinięcie najbliższego przewijalnego kontenera, tak by element był w kadrze (ok. 38% wysokości). */
  async reveal(sel, frac = 0.38, dur = 0.7) {
    const plan = await this.p.evaluate(([s, frac]) => {
      const e = document.querySelector(s); if (!e) return null;
      let sc = e.parentElement;
      while (sc && sc !== document.body) { const cs = getComputedStyle(sc); if (/(auto|scroll)/.test(cs.overflowY) && sc.scrollHeight > sc.clientHeight + 2) break; sc = sc.parentElement; }
      const win = !sc || sc === document.body;
      const b = e.getBoundingClientRect(), vh = win ? innerHeight : sc.clientHeight, top0 = win ? 0 : sc.getBoundingClientRect().top;
      const rel = b.top - top0, cur = win ? scrollY : sc.scrollTop, max = (win ? document.documentElement.scrollHeight - innerHeight : sc.scrollHeight - sc.clientHeight);
      if (rel > 80 && rel + Math.min(b.height, vh * 0.5) < vh - 70) return { skip: true };
      const to = Math.max(0, Math.min(max, cur + rel - vh * frac));
      window.__sc = win ? null : sc;
      return { from: cur, to };
    }, [sel, frac]).catch(() => null);
    if (!plan || plan.skip || Math.abs(plan.to - plan.from) < 4) return;
    await this.scrollAnim(plan.from, plan.to, dur);
  }
  async scrollBy(dy, dur = 0.8) {
    const from = await this.p.evaluate(() => { window.__sc = null; return scrollY; });
    const max = await this.p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    await this.scrollAnim(from, Math.max(0, Math.min(max, from + dy)), dur);
  }
  async scrollTop(dur = 0.6) { const from = await this.p.evaluate(() => { window.__sc = null; return scrollY; }); if (from > 2) await this.scrollAnim(from, 0, dur); }
  async scrollAnim(from, to, dur) {
    this.cutOverlays();
    const steps = Math.max(8, Math.round(dur * 30));
    for (let k = 1; k <= steps; k++) {
      const u = k / steps, e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      await this.p.evaluate(y => { if (window.__sc) window.__sc.scrollTop = y; else window.scrollTo(0, y); }, from + (to - from) * e);
      this.T += dur / steps; await this.shot();
    }
    await this.settle(120); await this.shot();
  }
  cutOverlays() { for (const e of this.ev) if ((e.type === "arrow" || e.type === "box") && e.t1 > this.T) e.t1 = Math.max(e.t0 + 0.3, this.T); }
  /** Ruch kursora do elementu (płynny, krzywa Béziera w montażu). */
  async move(sel, opt = {}) {
    if (opt.reveal !== false) await this.reveal(sel);
    const r = await this.rect(sel); if (!r) return null;
    const x = r.x + r.w * (opt.fx ?? 0.5), y = r.y + r.h * (opt.fy ?? 0.5);
    const dur = (opt.dur ?? 0.75) * this.k;
    this.ev.push({ t: +this.T.toFixed(3), type: "move", x: Math.round(x), y: Math.round(y), d: dur });
    this.T += dur;
    await this.p.hover(sel, { timeout: 1500 }).catch(() => {}); await this.settle(120); await this.shot();
    return r;
  }
  async click(sel, opt = {}) {
    const r = await this.move(sel, opt); if (!r) return false;
    this.ev.push({ t: +this.T.toFixed(3), type: "click" });
    this.T += 0.12;
    try { await this.p.click(sel, { timeout: 2500, position: opt.pos }); } catch (e) { this.miss.push("click " + sel); }
    await this.settle(opt.settle ?? 380); await this.shot(); this.T += 0.25 * this.k;
    return true;
  }
  async tick(id) { return this.click(`label.opt:has(#${id})`, { fx: 0.12 }); }
  /** Wpisywanie znak po znaku (ok. 14 znaków/s), na koniec Tab — tak jak w pracy. */
  async type(sel, text, opt = {}) {
    if (!(await this.click(sel, { settle: 150 }))) return;
    await this.p.fill(sel, "").catch(() => {});
    const cps = (opt.cps ?? 14) / this.k, step = Math.max(1, Math.round(text.length / 18));
    for (let i = 0; i < text.length; i += step) {
      await this.p.keyboard.type(text.slice(i, i + step));
      this.T += step / cps; await this.shot();
    }
    if (opt.tab !== false) { await this.p.keyboard.press("Tab"); await this.settle(200); this.T += 0.15; await this.shot(); }
  }
  /** Uzupełnienie pola bez animacji (pola drugorzędne — żeby nie wydłużać pokazu). */
  async quiet(sel, v) { try { await this.p.fill(sel, v); await this.p.press(sel, "Tab"); } catch (e) { this.miss.push("quiet " + sel); } await this.settle(60); }
  async select(sel, value, opt = {}) {
    // bez prawdziwego kliknięcia: natywna lista <select> w Chromium blokuje zrzut ekranu
    const r = await this.move(sel, opt); if (!r) return;
    this.ev.push({ t: +this.T.toFixed(3), type: "click" }); this.T += 0.12;
    await this.p.focus(sel).catch(() => {});
    try { await this.p.selectOption(sel, value); } catch (e) { this.miss.push("select " + sel); }
    await this.settle(opt.settle ?? 300); this.T += 0.35; await this.shot();
  }
  /** Jaskrawa strzałka z podpisem (rysowana w montażu). side: strona elementu, z której przychodzi strzałka. */
  async arrow(sel, label, opt = {}) {
    const r = await this.rect(sel); if (!r) return;
    this.ev.push({ type: "arrow", t0: +this.T.toFixed(3), t1: +(this.T + (opt.dur ?? 3.2)).toFixed(3), r, label, color: opt.color || C.pink, side: opt.side || "auto" });
    if (opt.hold) this.T += opt.hold;
  }
  async box(sel, opt = {}) {
    const r = await this.rect(sel); if (!r) return;
    this.ev.push({ type: "box", t0: +this.T.toFixed(3), t1: +(this.T + (opt.dur ?? 3)).toFixed(3), r, color: opt.color || C.orange, label: opt.label || "" });
    if (opt.hold) this.T += opt.hold;
  }
  async go(route) { await this.p.evaluate(x => { location.hash = "#/" + x; }, route); await this.settle(650); await this.p.evaluate(() => window.scrollTo(0, 0)); }
  async nav(id) { await this.click(`#nav [data-nav="${id}"]`, { fx: 0.35 }); await this.p.evaluate(() => window.scrollTo(0, 0)); await this.settle(200); await this.shot(); }
  async closeModals() { for (let i = 0; i < 4; i++) { if (!(await this.p.$(".scrim"))) break; await this.p.keyboard.press("Escape"); await this.settle(200); } }
  save() {
    const D = this.ch.contentDur;
    if (this.T > D - 0.3) {   // akcje dłuższe od lektora: lekkie, równomierne skrócenie osi (bez ucinania końcówki)
      const f = (D - 0.3) / this.T;
      for (const e of this.ev) for (const k of ["t", "t0", "t1", "d"]) if (typeof e[k] === "number") e[k] = +(e[k] * f).toFixed(3);
      console.log(`  · rozdział ${this.ch.no}: oś akcji skrócona o ${((1 - f) * 100).toFixed(1)} % (${this.T.toFixed(1)} → ${(D - 0.3).toFixed(1)} s)`);
      this.T = D - 0.3;
    }
    if (this.miss.length) console.log(`  ! brak elementów:`, [...new Set(this.miss)].join(" | "));
    fs.writeFileSync(path.join(this.dir, "events.json"), JSON.stringify({ no: this.ch.no, dur: D, endT: this.T, events: this.ev }, null, 0));
    console.log(`  rozdział ${this.ch.no}: ${this.n} klatek, akcje do ${this.T.toFixed(1)} / ${D.toFixed(1)} s`);
  }
}

/* ======================= scenariusze rozdziałów (beat = zdanie lektora) ======================= */
const SCENES = {
  async 1(R, p) {   // Wstęp i logowanie
    await R.shot();
    await R.beat(3); await R.arrow("#lg-login", "E-mail służbowy", { color: C.pink, side: "left" });
    await R.type("#lg-login", "magazyn@resinvest.group", { tab: false });
    await R.type("#lg-pass", "demo1234", { tab: false, cps: 10 });
    await R.box("#lg-submit", { color: C.lime, dur: 2 });
    await R.click("#lg-submit", { settle: 1400 });
    await p.waitForSelector("#nav .nav-item", { timeout: 8000 }).catch(() => {});
    await R.settle(400); await R.shot();
    await R.beat(4); await R.arrow("#nav", "Menu programu", { color: C.cyan, side: "right", dur: 2.6 });
    await R.beat(5); await R.arrow("#theme-btn", "Jasny motyw „Perła”", { color: C.orange, dur: 3 });
    await R.beat(6); await R.arrow("#sb-foot", "OFFLINE — tryb lokalny", { color: C.violet, side: "right", dur: 3.5 });
    await R.beat(8); await R.move("#user-btn", { fx: 0.5 });
    await R.arrow("#user-btn", "Mój profil: zmiana hasła", { color: C.pink, dur: 4 });
  },
  async 2(R, p) {   // Pulpit i nawigacja
    R.k = R.k0 = 0.85;
    await R.go("pulpit"); await R.shot();
    await R.beat(1); await R.box("#kpi-wood", { color: C.orange, dur: 3.5, label: "Drewno [m³]" });
    await R.move("#kpi-wood"); await R.wait(0.6);
    await R.arrow("#kpi-wood + *, #kpis > *:nth-child(2)", "Zrębka [MP] · t · GJ", { color: C.pink, dur: 3.2 });
    await R.beat(2); await R.reveal("#dash-trend", 0.3); await R.arrow("#dash-trend", "Sprzedaż i zakupy", { color: C.cyan, dur: 3.5 });
    await R.beat(4); await R.scrollTop(); await R.move('#nav [data-nav="pulpit"]', { fx: 0.4 });
    await R.box("#nav", { color: C.lime, dur: 2.2, label: "Praca · Ewidencja · Kartoteki · System" });
    await R.beat(9); await R.arrow("#wh-chip", "Zmiana magazynu", { color: C.orange, dur: 2.4 });
    await R.beat(11); await R.reveal("#kpi-wood"); await R.arrow("#kpi-wood svg, #kpi-wood", "Linia z ostatnich 30 dni", { color: C.pink, dur: 3 });
    await R.beat(12); await R.reveal("#dash-turnover", 0.4); await R.arrow("#dash-turnover", "Obroty w okresie", { color: C.cyan, dur: 3 });
    await R.beat(14); await R.scrollTop(); await R.arrow("#top-new", "Nowa operacja — zawsze pod ręką", { color: C.lime, dur: 3 });
    await R.beat(15); await R.click("#bell-btn");
    await R.wait(0.8); await R.closeModals(); await p.keyboard.press("Escape"); await R.settle(200); await R.shot();
  },
  async 3(R, p) {   // Kartoteki
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("produkty");
    await R.beat(1); await R.box("table", { color: C.orange, dur: 3.5, label: "Jednostki i przeliczniki" });
    await R.beat(2); await R.arrow("table tbody tr:first-child", "1 m³ drewna = 4 MP zrębki", { color: C.pink, dur: 4 });
    await R.beat(3); await R.nav("kontrahenci");
    await R.box("table", { color: C.cyan, dur: 3, label: "Dostawcy · odbiorcy · nadleśnictwa" });
    await R.beat(5); await R.nav("magazyny"); await R.box("table, .card", { color: C.lime, dur: 3.5, label: "Place firmy" });
    await R.beat(9); await R.nav("kontrahenci"); await R.wait(0.5);
    await R.beat(10); await R.nav("dodatkowe"); await R.box("#extra-types-table", { color: C.orange, dur: 4, label: "Cennik operacji dodatkowych" });
  },
  async 4(R, p) {   // Flota: pojazd, zabudowa, pojemność
    R.k = R.k0 = 0.8;
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("flota");
    await R.box(".fl-scopes, #fl-scope-own", { color: C.cyan, dur: 2.6, label: "Flota własna / zewnętrzna" });
    await R.beat(1); await R.click("#fleet-add", { settle: 600 });
    await R.beat(2, -0.3); await R.type("#fe-name", "MAN TGS — hakowiec");
    await R.type("#fe-reg", "SK 4411H");
    await R.select("#fe-driverId", "dr_nowak");
    await R.beat(3); await R.arrow("#fe-body", "Zabudowa", { color: C.pink, side: "left", dur: 3 });
    await R.select("#fe-body", "hakowiec", { settle: 500 });
    await R.beat(5); await R.arrow("#fe-comp-0-l", "Długość × szerokość × wysokość", { color: C.orange, dur: 3.5 });
    for (const [i, l] of [[0, "6,5"], [1, "7"]]) { await R.type(`#fe-comp-${i}-l`, l, { cps: 8 }); await R.type(`#fe-comp-${i}-w`, "2,4", { cps: 8 }); await R.type(`#fe-comp-${i}-h`, "2,5", { cps: 8 }); }
    await R.box("#fe-cap", { color: C.lime, dur: 4, label: "Pojemność liczona na żywo: 81 MP" });
    await R.beat(9); await R.click(".modal [data-yes]", { settle: 600 });
    await R.box("#fleet-table", { color: C.orange, dur: 3, label: "Kolumna „Pojemność”" });
    await R.beat(12); await R.click('[data-tab="chippers"]'); await R.box("#fleet-table", { color: C.cyan, dur: 3.5, label: "Rębaki: własne / wynajęte, operator" });
    await R.beat(14); await R.click('[data-tab="vehicles"]');
  },
  async 5(R, p) {   // Zakup z produkcją w lesie
    R.k = R.k0 = 0.6;
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.click("#top-new", { settle: 700 });
    await R.beat(1); await R.click('label.opt:has(input[value="ZAKUP"]), [data-type="ZAKUP"]', { fx: 0.2 });
    await R.beat(2); await R.tick("f-production-enabled");
    await R.beat(3); await R.tick("f-skind-nadlesnictwo");
    await R.arrow("#f-purchase-basis", "Podstawa: deklaracja", { color: C.orange, dur: 3 });
    await R.type("#f-purchase-supplierName", "Nadleśnictwo Rudy Raciborskie");
    await R.type("#f-purchase-lesnictwo", "Stanica");
    await R.beat(5); await R.arrow('[data-field="date"]', "Data przyjęcia", { color: C.pink, dur: 2.6 });
    await R.type("#f-purchase-qty", "30", { cps: 6 }); await R.type("#f-purchase-price", "230", { cps: 6 });
    await R.beat(6); await R.arrow("#summary .card:last-child, #check-card, [id*=kontrol]", "Kontrola — czerwona, dopóki czegoś brakuje", { color: C.pink, side: "left", dur: 3.5 });
    await R.beat(7); await R.reveal("#f-production-chipperId");
    await R.select("#f-production-chipperId", "ch_jenz");
    await R.type("#f-production-kwit", "KW 0612/10/2026");
    await R.beat(8); await R.arrow("#f-production-outQty", "Wyliczona zrębka [MP] i koszt rąbania", { color: C.lime, dur: 3.5 });
    await R.beat(9); await R.tick("f-mode-own");
    await R.type("#f-transport-own-runCount", "3", { cps: 5 });
    await R.beat(10);
    for (let i = 0; i < 3; i++) {
      await R.select(`#f-transport-own-runs-${i}-vehicleId`, ["ve_scania", "ve_volvo", "ve_scania"][i]);
      if (i === 0) await R.type(`#f-transport-own-runs-${i}-kwit`, `KW 0612/${i + 1}`, { cps: 16 }); else await R.quiet(`#f-transport-own-runs-${i}-kwit`, `KW 0612/${i + 1}`);
      await R.quiet(`#f-transport-own-runs-${i}-km`, "45");
      await R.type(`#f-transport-own-runs-${i}-kwitM3`, "10", { cps: 8 });
    }
    await R.beat(11); await R.reveal("#runs-summary", 0.3); await R.box("#runs-summary", { color: C.orange, dur: 4, label: "MP na aucie i zapełnienie naczepy [%]" });
    await R.beat(12); await R.arrow("#summary [data-save]", "Zatwierdź", { color: C.lime, side: "left", dur: 2.5 });
    await R.click("#summary [data-save]", { settle: 700 });
    await R.beat(13); await R.box("#confirm-op", { color: C.cyan, dur: 3.5, label: "Podsumowanie: stany i koszt" });
    await R.beat(14); await R.click("#confirm-yes", { settle: 1200 });
    await R.box("#op-detail .modal-h", { color: C.pink, dur: 4, label: "Numer z serii WZ" });
    await R.beat(17); await R.closeModals(); await R.shot();
  },
  async 6(R, p) {   // Sprzedaż i transport kilku firm
    R.k = R.k0 = 0.55;
    await R.go("pulpit"); await R.go("nowa?preset=wz"); await R.shot();
    await R.beat(0); await R.arrow("#f-sale-productId", "Tylko towary na stanie — z ilością", { color: C.orange, dur: 3.5 });
    await R.select("#f-sale-productId", "pr_zr_lesna");
    await R.beat(2); await R.select("#f-sale-buyerId", "pa_ec_zab");
    await R.type("#f-sale-qty", "120", { cps: 6 }); await R.type("#f-sale-price", "92", { cps: 6 });
    await R.beat(3); await R.arrow("#f-sale-weightMode", "Tonaż: AUTO albo z wagi", { color: C.pink, dur: 3 });
    await R.beat(5); await R.tick("f-mode-external");
    await R.beat(6); await R.arrow("#f-transport-external-companyCount", "Liczba firm przewidzianych do transportu", { color: C.pink, side: "left", dur: 3.5 });
    await R.select("#f-transport-external-companyCount", "2", { settle: 400 });
    await R.type("#f-transport-external-runCount", "3", { cps: 5 });
    await R.beat(7);
    const co = ["ESI Logistics", "ESI Logistics", "DAP Trans"], reg = ["ESI 18734", "ESI 20511", "SZA 7K901"];
    for (let i = 0; i < 3; i++) {
      await R.type(`#f-transport-external-runs-${i}-company`, co[i], { cps: 18 });
      await R.type(`#f-transport-external-runs-${i}-reg`, reg[i], { cps: 14 });
      await R.type(`#f-transport-external-runs-${i}-qty`, "40", { cps: 8 });
      await R.quiet(`#f-transport-external-runs-${i}-km`, String(26 + i * 4));
    }
    await R.beat(9); await R.reveal("#runs-summary", 0.3); await R.box("#runs-summary", { color: C.orange, dur: 4, label: "Przewoźnik · ilość · km · koszt · zapełnienie" });
    await R.beat(12); await R.click("#summary [data-save]", { settle: 700 }); await R.wait(1.2);
    await R.click("#confirm-yes", { settle: 1200 }); await R.wait(1.5);
    await R.beat(14); await R.closeModals(); await R.go("nowa?preset=bezposrednia"); await R.shot();
    await R.box('label.opt:has(#f-sale-direct)', { color: C.lime, dur: 4, label: "Sprzedaż bezpośrednia z lasu" });
  },
  async 7(R, p) {   // Produkcja na magazynie i operacje dodatkowe
    R.k = R.k0 = 0.7;
    await R.go("pulpit"); await R.go("nowa?preset=produkcja"); await R.shot();
    await R.beat(1); await R.arrow("#f-production-rawProductId, [id*=rawProduct]", "Surowiec ze stanu", { color: C.orange, dur: 3 });
    await R.select("#f-production-outProductId", "pr_zr_lesna");
    await R.type("#f-production-outQty", "200", { cps: 6 });
    await R.beat(2); await R.arrow("#f-production-outQty", "Zużycie drewna liczy się samo", { color: C.lime, dur: 3.5 });
    await R.select("#f-production-chipperId", "ch_jenz");
    await R.beat(3); await R.tick("f-extras-enabled");
    await R.select("#f-extras-items-0-typeId", "xt_holowanie");
    await R.type("#f-extras-items-0-cost", "500", { cps: 6 });
    await R.beat(4); await R.arrow("#summary", "Koszt w wyniku operacji", { color: C.pink, side: "left", dur: 3.5 });
    await R.beat(6); await R.click("#summary [data-save]", { settle: 700 }); await R.wait(1);
    await R.click("#confirm-yes", { settle: 1200 }); await R.wait(1.5); await R.closeModals(); await R.shot();
  },
  async 8(R, p) {   // MM
    await R.go("pulpit"); await R.go("nowa?preset=mm"); await R.shot();
    await R.beat(0); await R.arrow("#f-mm-fromWhId", "Magazyn źródłowy", { color: C.orange, dur: 3 });
    await R.beat(2); await R.select("#f-mm-toWhId", "wh_bra");
    await R.select("#f-mm-productId", "pr_zr_lesna");
    await R.type("#f-mm-qty", "60", { cps: 6 });
    await R.click("#summary [data-save]", { settle: 700 }); await R.wait(0.8);
    await R.click("#confirm-yes", { settle: 1200 }); await R.wait(1); await R.closeModals();
    await R.beat(3); await R.nav("mm"); await R.box("table", { color: C.pink, dur: 4, label: "Status: W DRODZE" });
    await R.beat(4); await R.arrow("table tbody tr:first-child", "Magazyn docelowy: „Przyjmij MM”", { color: C.lime, dur: 4 });
    await R.beat(6); await R.go("nowa?preset=mm"); await R.shot(); await R.arrow("#f-mm-weightMode", "Tonaż z wagi albo AUTO", { color: C.cyan, dur: 3 });
  },
  async 9(R, p) {   // Korekta, anulowanie, historia
    await R.go("operacje"); await R.shot();
    await R.beat(1); await R.click("#ops-table tbody tr:first-child", { settle: 700 });
    await R.arrow("#op-detail [data-correct]", "Koryguj", { color: C.orange, dur: 2.5 });
    await R.click("#op-detail [data-correct]", { settle: 900 });
    await R.beat(2); await R.reveal("#corr-reason"); await R.select("#corr-reason", { index: 1 });
    await R.beat(3); await R.reveal("#corr-preview", 0.25); await R.box("#corr-preview", { color: C.pink, dur: 4, label: "BYŁO / JEST — księgowana tylko różnica" });
    await R.beat(5); await R.go("operacje"); await R.shot();
    await R.click("#ops-table tbody tr:nth-child(2)", { settle: 700 });
    await R.arrow("#op-detail [data-cancel]", "Anuluj — odwraca ruchy nowym wpisem", { color: C.pink, dur: 3.5 });
    await R.beat(7); await R.closeModals(); await R.nav("historia");
    await R.box("table", { color: C.cyan, dur: 4, label: "Stan przed · zmiana · stan po" });
    await R.beat(8); await R.arrow("select, input[type=search]", "Filtry: użytkownik, kontrahent, rodzaj", { color: C.orange, dur: 3.5 });
  },
  async 10(R, p) {  // Dokumenty
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("dokumenty");
    await R.box("table", { color: C.orange, dur: 3.5, label: "Jedna seria WZ" });
    await R.beat(1); await R.arrow("select", "Filtry: miesiąc, status, kontrahent", { color: C.cyan, dur: 3 });
    await R.beat(3); await R.click("table tbody tr:first-child [data-preview], table tbody tr:first-child button", { settle: 900 });
    await R.wait(1.5); await R.box(".modal", { color: C.pink, dur: 3, label: "Podgląd · PDF · e-mail" }); await R.wait(2.5); await R.closeModals();
    await R.beat(5); await R.arrow("label.opt", "Pokaż dokumenty pomocnicze", { color: C.lime, dur: 3 });
    await R.beat(6); await R.arrow("#reg-csv, [id$=csv]", "CSV ewidencji · Excel", { color: C.orange, dur: 3.5 });
  },
  async 11(R, p) {  // Stany i inwentaryzacja
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("stany"); await R.box("table", { color: C.orange, dur: 3.5, label: "Stan na dowolny dzień" });
    await R.arrow("input[type=date]", "Data stanu", { color: C.pink, dur: 3 });
    await R.beat(1); await R.nav("inwentaryzacja"); await R.box("table, .card", { color: C.cyan, dur: 4, label: "Spis z natury → różnice → zamknięcie miesiąca" });
    await R.beat(4); await R.nav("stany"); await R.arrow("table thead", "Tony i GJ", { color: C.lime, dur: 3 });
  },
  async 12(R, p) {  // Raporty i ewidencja CSV
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("raporty"); await R.box("#rep-title", { color: C.orange, dur: 3, label: "Miesiąc albo rok" });
    await R.beat(1); await R.reveal("#rep-consistent", 0.3); await R.arrow("#rep-consistent", "Kontrola: spójny z księgą ruchów", { color: C.lime, dur: 3.5 });
    await R.beat(3); await R.scrollTop(); await R.arrow("#rep-trade", "CSV ewidencji", { color: C.pink, dur: 3.5 });
    await R.beat(5); await R.reveal("#rep-purchases", 0.3); await R.box("#rep-purchases", { color: C.cyan, dur: 4, label: "Zakupy · sprzedaż · transport" });
  },
  async 13(R, p) {  // Planer
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("planer");
    await R.beat(1); await R.reveal("#pl-week-table", 0.3); await R.type("#pl-week-table .plan-in", "80", { cps: 5 });
    await R.beat(2); await R.box("#pl-week-table", { color: C.orange, dur: 3.5, label: "Wykonanie — z dokumentów" });
    await R.beat(3); await R.click('[data-plview="year"]', { settle: 700 }); await R.box("#pl-year-table, #pl-chart", { color: C.cyan, dur: 3.5, label: "Realizacja miesiąc po miesiącu" });
    await R.beat(7); await R.click('[data-plview="drivers"]', { settle: 700 }); await R.box("#pl-drivers", { color: C.lime, dur: 3, label: "Kierowcy i kursy" });
  },
  async 14(R, p) {  // Raporty floty i rębaków
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("flota"); await R.click('[data-tab="reports"]', { settle: 700 });
    await R.beat(1); await R.select("#fr-period", "month", { settle: 500 });
    await R.beat(2); await R.reveal("#fleet-rep", 0.3); await R.box("#fleet-rep", { color: C.orange, dur: 4, label: "Które auto ile przewiozło" });
    await R.beat(3); await R.select("#fr-view", "runs", { settle: 500 }); await R.arrow("#fleet-rep thead", "Zapełnienie każdego kursu [%]", { color: C.pink, dur: 3.5 });
    await R.beat(4); await R.select("#fr-view", "drivers", { settle: 500 }); await R.box("#fleet-rep", { color: C.cyan, dur: 3, label: "Kierowcy: kursy, MP, tony" });
    await R.beat(5); await R.select("#fr-view", "chippers", { settle: 500 }); await R.box("#fleet-rep", { color: C.lime, dur: 3, label: "Rębaki: ile zrąbał [MP]" });
    await R.select("#fr-view", "operators", { settle: 500 });
    await R.beat(6); await R.arrow("#fr-csv", "CSV · Excel · PDF", { color: C.orange, dur: 3 });
    await R.beat(8); await R.select("#fr-view", "runs", { settle: 500 }); await R.arrow("#fleet-rep tbody", "Zielony > 85% · czerwony = przeładowanie", { color: C.pink, dur: 4 });
  },
  async 15(R, p) {  // Użytkownicy i administracja
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("uzytkownicy"); await R.box("#users-table, table", { color: C.orange, dur: 3.5, label: "Konta i role" });
    await R.beat(2); await R.go("admin/permissions"); await R.shot(); await R.box("#perm-table, table", { color: C.cyan, dur: 3.5, label: "Kto wprowadza, zatwierdza, koryguje" });
    await R.beat(3); await R.go("administracja"); await R.shot(); await R.box("#access-card, .card", { color: C.lime, dur: 3.5, label: "Numeracja · kopie · audyt" });
    await R.beat(4); await R.go("admin/audit"); await R.shot(); await R.box("#audit-admin-table, table", { color: C.pink, dur: 3.5, label: "Dziennik audytu" });
    await R.beat(7); await R.go("administracja"); await R.shot(); await R.arrow("#cfg-approval", "Obieg zatwierdzania", { color: C.orange, dur: 3.5 });
  },
  async 16(R, p) {  // Dobre praktyki i zakończenie
    await R.go("pulpit"); await R.p.evaluate(() => window.scrollTo(0, 0)); await R.shot();
    await R.beat(1); await R.move("#top-new"); await R.beat(4); await R.move("#kpi-wood");
  }
};

(async () => {
  fs.mkdirSync(CAP, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, locale: "pl-PL", acceptDownloads: true });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("tut")) { localStorage.clear(); sessionStorage.setItem("tut", "1"); } localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.intro", "0"); localStorage.setItem("riw.sample", "1"); localStorage.setItem("riw.theme", "pearl"); } catch (e) {} });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message)); p.on("dialog", d => { errs.push("dialog: " + d.message()); d.accept().catch(() => {}); });
  await p.clock.setFixedTime(new Date("2026-09-25T09:30:00"));
  await p.goto(APP); await p.waitForSelector("#login-form");
  // kursor przeglądarki ukryty — kursor rysuje montaż
  await p.addStyleTag({ content: "*{cursor:none!important} ::-webkit-scrollbar{width:10px;height:10px} ::-webkit-scrollbar-thumb{background:#c9d3cc;border-radius:6px}" });
  const login = async () => { if (await p.$("#login-form")) { await p.fill("#lg-login", "magazyn@resinvest.group"); await p.fill("#lg-pass", "demo1234"); await p.click("#lg-submit"); await p.waitForSelector("#nav .nav-item"); await p.waitForTimeout(500); } };
  for (const ch of TL.chapters) {
    if (ONLY.length && !ONLY.includes(ch.no)) { if (ch.no === 1) await login(); continue; }
    if (ch.no > 1) await login();
    const R = new Rec(p, ch);
    console.log(`Rozdział ${ch.no}: ${ch.title}`);
    try { await SCENES[ch.no](R, p); } catch (e) { console.log("  ! błąd:", e.message.split("\n")[0]); await R.shot(); }
    R.save();
  }
  console.log("błędy strony:", errs.length ? errs : "brak");
  await b.close();
})();
