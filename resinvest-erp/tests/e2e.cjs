/* Testy E2E ResInvest ERP 3.2 (Playwright + Chromium) — tryb lokalny z logowaniem, interfejs PL.
   Uruchomienie z katalogu resinvest-erp:
     NODE_PATH=$(npm root -g) node tests/e2e.cjs
   Zmienne: SHOTS=<katalog> — zrzuty ekranu; PDF_PYTHON=<python z pypdf> — pełna kontrola tekstu PDF
   (bez niej sprawdzana jest struktura pliku: nagłówek, osadzona czcionka, mapa ToUnicode). */
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const FILE = "file://" + path.resolve(__dirname, "..", "ResInvest_ERP.html");
const SHOTS = process.env.SHOTS || "";
const TODAY = "2026-09-23";
const results = [], consoleErrors = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond }); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const nb = s => String(s || "").replace(/[\u00A0\u202F]/g, " ").replace(/\s+/g, " ").trim();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "riw-e2e-"));

function watch(page, label) {
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(`${label}: ${m.text()}`); });
  page.on("pageerror", e => { consoleErrors.push(`${label}: ${e.message}`); if (process.env.E2E_STACK) console.log("STACK", e.stack); });
}
async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: "pl-PL" }, opts));
  await ctx.addInitScript(d => { try { if (!sessionStorage.getItem("riw.today")) sessionStorage.setItem("riw.today", d); if (!localStorage.getItem("riw.lang")) localStorage.setItem("riw.lang", "pl"); } catch (e) {} }, TODAY);
  return ctx;
}
async function boot(page) {
  await page.goto(FILE);
  await page.waitForSelector(".splash", { timeout: 5000 }).catch(() => {});
  await page.keyboard.press("Escape");
  await page.waitForSelector(".splash", { state: "detached", timeout: 5000 });
  await page.waitForSelector("#login-form", { timeout: 5000 });
  await login(page, LOGINS.u_kier);
}
/** Logowanie przez formularz (e-mail firmowy + hasło demo1234) — tak jak użytkownik. */
async function login(page, email, pw = "demo1234") {
  await closeModals(page);
  if (await page.$("#nav")) await page.evaluate(() => RIW_DEBUG.app.logout());
  await page.waitForSelector("#login-form");
  await page.fill("#lg-login", email); await page.fill("#lg-pass", pw);
  await page.click("#lg-submit");
  await page.waitForSelector("#nav .nav-item", { timeout: 8000 });
  await page.waitForTimeout(150);
}
const go = (page, route) => page.evaluate(r => { location.hash = "#/" + r; }, route).then(() => page.waitForTimeout(150));
const preset = async (page, p) => { await go(page, "pulpit"); await go(page, "nowa?preset=" + p); await page.waitForSelector("#opf"); };
const bal = (page, pid, wh = "wh_zab") => page.evaluate(([p, w]) => RIW_DEBUG.R.Stock.balance(RIW_DEBUG.store.state, w, p), [pid, wh]);
const opsN = page => page.evaluate(() => RIW_DEBUG.store.state.operations.length);
const lastOp = page => page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return { id: o.id, no: o.no, status: o.status, type: o.type }; });
const out = async (page, key) => nb(await page.textContent(`[data-out="${key}"]`));
const msg = async (page, key) => nb(await page.textContent(`[data-msg="${key}"]`));
const tick = (page, id) => page.click(`label.opt:has(#${id})`);
const fillTab = async (page, sel, v) => { await page.fill(sel, v); await page.press(sel, "Tab"); await page.waitForTimeout(60); };
const LOGINS = { u_admin: "magazyn@resinvest.group", u_kier: "anna.gorska@resinvest.group", u_mag: "adrian.wojciechowski@resinvest.group", u_bra: "pawel.kaczmarek@resinvest.group", u_kbra: "tomasz.zajac@resinvest.group", u_view: "beata.nowak@resinvest.group" };
const setUser = (page, uid) => login(page, LOGINS[uid]);
const allExist = async (page, sels) => { for (const s of sels) if (!(await page.$(s))) return false; return true; };
const closeModals = async page => { for (let i = 0; i < 4 && await page.$(".scrim"); i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(80); } };
/** Zatwierdzenie z oknem podsumowania; zwraca liczbę nowych operacji. */
async function approve(page, { dbl = false } = {}) {
  const n0 = await opsN(page);
  await page.click("#summary [data-save]");
  await page.waitForSelector("#confirm-op", { timeout: 3000 });
  if (dbl) await page.dblclick("#confirm-yes"); else await page.click("#confirm-yes");
  await page.waitForFunction(n => RIW_DEBUG.store.state.operations.length > n, n0, { timeout: 4000 }).catch(() => {});
  await page.waitForSelector("#op-detail", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(250);
  const added = (await opsN(page)) - n0;
  await closeModals(page);
  return added;
}
async function openOp(page, id) { await closeModals(page); await page.evaluate(i => OpDetail.open(i), id); await page.waitForSelector("#op-detail"); }
function pdfText(file) {
  const buf = fs.readFileSync(file);
  const structural = buf.slice(0, 5).toString() === "%PDF-" && buf.includes("/FontFile2") && buf.includes("/ToUnicode") && buf.includes("%%EOF");
  if (!process.env.PDF_PYTHON) return { structural, text: null };
  const text = execFileSync(process.env.PDF_PYTHON, ["-c", "import sys\nfrom pypdf import PdfReader\nr=PdfReader(sys.argv[1])\nprint(len(r.pages))\nprint('\\n'.join(p.extract_text() for p in r.pages))", file], { encoding: "utf8" });
  return { structural, text };
}
async function downloadPdf(page, selector, name) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), page.click(selector)]);
  const file = path.join(TMP, name);
  await dl.saveAs(file);
  return { file, suggested: dl.suggestedFilename(), ...pdfText(file) };
}
async function fillForestDirect(page) {
  await page.fill("#f-production-ndl", "Rudy Raciborskie");
  await page.fill("#f-production-lesnictwo", "Kuźnia");
  await page.fill("#f-production-kwit", "KW 0400/09/2026");
}

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  {
    const ctx = await newCtx(browser);
    const page = await ctx.newPage(); watch(page, "desktop");
    await boot(page);

    /* ------------- menu i motyw ------------- */
    const menu = await page.$$eval("#nav .nav-item", l => l.map(x => x.textContent.trim()));
    const need = ["Pulpit", "Operacje", "Przyjęcia", "Wydania / WZ", "Produkcja", "Kwit produkcji dnia", "MM", "Stany magazynowe", "Dokumenty", "Historia", "Raporty", "Transport", "Flota", "Produkty", "Kontrahenci", "Magazyny", "Administracja"];
    check("§20 Menu: wszystkie wymagane pozycje", need.every(n => menu.some(m => m.startsWith(n))), need.filter(n => !menu.some(m => m.startsWith(n))));
    const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const card = await page.evaluate(() => getComputedStyle(document.querySelector(".card, .kpi")).backgroundColor);
    check("§19 Jasny motyw: jasne tło, białe karty", lum(bg) > 0.85 && card === "rgb(255, 255, 255)", { bg, card });

    /* ------------- pulpit ------------- */
    check("§13 Pulpit: KPI stanów z ≈ t i ≈ GJ", nb(await page.textContent("#kpi-wood .k-v")).replace(/ /g, "") === "817m³" && nb(await page.textContent("#kpi-wood")).includes("≈ 778 t · ≈ 6 611 GJ"), nb(await page.textContent("#kpi-wood")));
    check("§14 Pulpit: kafle stanów wg produktu (wskaźnik + linia 30 dni)", (await page.$$("#dash-stock .stile .meter i")).length >= 5 && (await page.$$("#dash-stock .stile svg")).length >= 5);
    check("§15 Pulpit: OBROTY WEDŁUG TYPU OPERACJI — 5 typów", nb(await page.textContent("#dash-turnover h3")) === "OBROTY WEDŁUG TYPU OPERACJI" && (await page.$$("#turn-chart .hbar-row")).length === 5);
    await page.selectOption("#dash-mode", "custom"); await page.waitForTimeout(150);
    await page.fill("#dash-from", "2026-09-15"); await page.press("#dash-from", "Tab"); await page.waitForTimeout(150);
    check("§15 Pulpit: zakres własny obrotów (15.09 – 23.09)", nb(await page.textContent("#dash-turnover .sub")).startsWith("15.09.2026"), nb(await page.textContent("#dash-turnover .sub")));
    await page.hover("#turn-chart .hbar-row >> nth=1"); await page.waitForTimeout(100);
    check("§15 Pulpit: podpowiedź po najechaniu na słupek", !(await page.$eval("#chart-tip", e => e.classList.contains("hidden"))));
    await page.click("#turn-chart .hbar-row >> nth=1"); await page.waitForSelector("#drill");
    check("Pulpit: kliknięcie obrotu → operacje źródłowe", (await page.$$("#drill-table tbody tr")).length >= 1);
    await closeModals(page);

    /* ------------- stany ------------- */
    await go(page, "stany");
    const cell = async (id, a = "data-native") => nb(await page.textContent(`[data-stock="wh_zab"] [${a}="${id}"]`));
    check("§4 Stany: 8 293 MP ≈ 2 737 t ≈ 23 262 GJ", (await cell("pr_zr_lesna")) === "8 293 MP" && (await cell("pr_zr_lesna", "data-mass")) === "≈ 2 737 t" && (await cell("pr_zr_lesna", "data-gj")) === "≈ 23 262 GJ");
    check("§4 Stany: drewno 817 m³ ≈ 778 t", (await cell("pr_drewno")) === "817 m³" && (await cell("pr_drewno", "data-mass")) === "≈ 778 t");
    check("§4 Stany: PKS tylko t (728 t ≈ 6 188 GJ)", (await cell("pr_pks")) === "728 t" && (await cell("pr_pks", "data-mass")) === "—" && (await cell("pr_pks", "data-gj")) === "≈ 6 188 GJ");

    /* ------------- §22 TEST 1 / §31.16 A: produkcja na magazyn ------------- */
    await preset(page, "produkcja");
    check("§5 Produkcja na magazyn: brak transportu, przewoźnika, odbiorcy, sprzedaży", !(await page.$("#f-transport-place")) && !(await page.$("#f-sale-buyerId")) && !(await page.$("#f-mode-own")) && !(await page.$("#f-purchase-supplierId")));
    check("§6 Produkcja: magazyn, surowiec, stan, produkt, ilość, zużycie, masa/GJ, cena i koszt rąbania, uwagi, nr dokumentu",
      await allExist(page, ["production.wh", "production.rawProductId", "production.stock", "production.outProductId", "production.outQty", "production.consume", "production.orient", "production.chipRate", "production.chipCost", "notes", "extDoc"].map(k => `[data-field="${k}"]`)));
    check("§18 Cena za rąbanie domyślnie 10,00 zł/MP", (await page.inputValue("#f-production-chipRate")) === "10,00");
    await fillTab(page, "#f-production-outQty", "500");
    check("§22 T1: 500 MP → zużycie 125 m³ liczone automatycznie", (await out(page, "production.consume")) === "125 m³", await out(page, "production.consume"));
    check("§22 T1: stan surowca 817 → po 692 m³", (await out(page, "production.stock")) === "817 m³" && (await out(page, "production.after")) === "692 m³");
    check("§22 T7: koszt rąbania 500 × 10 = 5 000,00 zł", (await out(page, "production.chipCost")) === "5 000,00 zł");
    check("§4 Produkcja: masa i energia orientacyjna 165 t · 1 402,5 GJ", (await out(page, "production.orient")) === "≈ 165,00 t · ≈ 1 402,5 GJ", await out(page, "production.orient"));
    await page.fill("#f-extDoc", "KP 1/09/2026");
    await page.click("#summary [data-save]"); await page.waitForSelector("#confirm-op");
    const conf = nb(await page.textContent("#confirm-op"));
    check("§31.15 Podsumowanie przed zatwierdzeniem: zużycie, produkt, stan przed/po, masa, GJ, rąbanie", ["125 m³", "500 MP", "817 m³", "692 m³", "8 293 MP", "8 793 MP", "GJ", "5 000,00 zł", "RW", "PW"].every(x => conf.includes(x)), conf.slice(0, 300));
    await page.click("#confirm-op [data-no]"); await page.waitForTimeout(100);
    check("§31.15 „Wróć do edycji” nie zapisuje", (await opsN(page)) === 11);
    const nProd = await approve(page, { dbl: true });
    check("§31.16 F: podwójne kliknięcie „Zatwierdź dokument” = jedna operacja", nProd === 1, nProd);
    const prodOp = await lastOp(page);
    check("§22 T1: po zapisie drewno 692 m³, zrębka 8 793 MP, status ZATWIERDZONY", (await bal(page, "pr_drewno")) === 692 && (await bal(page, "pr_zr_lesna")) === 8793 && prodOp.status === "POSTED" && prodOp.no.startsWith("PW/"));

    /* ------------- §31.16 B: brak surowca (Brąszewice 30 m³) ------------- */
    await setUser(page, "u_bra");
    await preset(page, "produkcja");
    await fillTab(page, "#f-production-outQty", "500");
    check("§31.16 B: komunikat „Brak wystarczającej ilości surowca. Dostępne: 30 m³. Wymagane: 125 m³. Brakuje: 95 m³.”", (await msg(page, "production.outQty")) === "Brak wystarczającej ilości surowca. Dostępne: 30 m³. Wymagane: 125 m³. Brakuje: 95 m³.", await msg(page, "production.outQty"));
    const nB = await opsN(page);
    await page.click("#summary [data-save]"); await page.waitForTimeout(300);
    check("§31.16 B: zatwierdzenie zablokowane — brak okna i brak zapisu", !(await page.$("#confirm-op")) && (await opsN(page)) === nB && nb(await page.textContent("#toasts")).includes("Nie można zatwierdzić"));
    await page.selectOption("#f-production-outProductId", "pr_drewno"); await page.waitForTimeout(150);
    check("§31.16 C: surowiec = produkt wyjściowy zablokowany", (await msg(page, "production.outProductId")).includes("różnymi produktami"));
    await setUser(page, "u_kier");

    /* ------------- §22 TEST 2: WZ ------------- */
    await preset(page, "wz");
    await page.selectOption("#f-sale-productId", "pr_zr_lesna"); await page.waitForTimeout(100);
    check("§9 WZ: stan dostępny 8 793 MP", (await out(page, "sale.onStock")) === "8 793 MP");
    await fillTab(page, "#f-sale-qty", "8793,01");
    check("§9 WZ ponad stan: „Nie można sprzedać … Dostępny stan: 8 793 MP.”", (await msg(page, "sale.qty")) === "Nie można sprzedać 8 793,01 MP. Dostępny stan: 8 793 MP.", await msg(page, "sale.qty"));
    await fillTab(page, "#f-sale-qty", "500");
    check("§9 WZ: stan po WZ 8 293 MP", (await out(page, "sale.after")) === "8 293 MP");
    await page.fill("#f-sale-price", "90"); await page.selectOption("#f-sale-buyerId", "pa_ec_zab"); await page.waitForTimeout(100);
    check("WZ: miejsce dostawy = odbiorca", (await page.inputValue("#f-transport-place")) === "Elektrociepłownia Zabrze S.A.");
    check("WZ: 1 dokument po zatwierdzeniu", (await approve(page)) === 1);
    const wzOp = await lastOp(page);
    check("§22 T2: po WZ stan 8 293 MP", (await bal(page, "pr_zr_lesna")) === 8293);

    /* ------------- §22 TEST 3 / §31.16 I: sprzedaż bezpośrednia ------------- */
    await preset(page, "bezposrednia");
    await fillForestDirect(page);
    await fillTab(page, "#f-production-outQty", "600");
    check("§8 Bezpośrednia: surowiec liczony (150 m³, nie ze stanu)", (await out(page, "production.rawQty")).startsWith("150 m³"), await out(page, "production.rawQty"));
    await page.selectOption("#f-sale-buyerId", "pa_elektrownia"); await page.fill("#f-sale-price", "88");
    await fillTab(page, "#f-sale-qtyMP", "650");
    check("§31.16 I: sprzedaż 650 MP z produkcji 600 MP zablokowana", (await msg(page, "sale.qtyMP")).includes("Nie można sprzedać 650 MP z produkcji 600 MP"));
    await fillTab(page, "#f-sale-qtyMP", "");
    check("§22 T3: zatwierdzenie bezpośredniej", (await approve(page)) === 1);
    check("§22 T3: stan zrębki i drewna bez zmian (8 293 MP, 692 m³)", (await bal(page, "pr_zr_lesna")) === 8293 && (await bal(page, "pr_drewno")) === 692);

    /* ------------- §22 TEST 5–6: pociąg ------------- */
    await preset(page, "wz");
    await tick(page, "f-mode-train"); await page.waitForSelector("#f-transport-train-wagonCount");
    await fillTab(page, "#f-transport-train-wagonCount", "20"); await fillTab(page, "#f-transport-train-sameT", "60");
    check("§22 T5: tonaż wspólny 20 × 60 = 1 200 t", nb(await page.textContent("[data-train-total]")) === "1 200 t");
    await tick(page, "f-ton-each"); await fillTab(page, "#f-transport-train-wagonCount", "5");
    const tons = ["58,4", "60,1", "59,7", "61,2", "59,8"];
    for (let i = 0; i < 5; i++) await fillTab(page, `#f-transport-train-wagonT-${i}`, tons[i]);
    check("§22 T6: tonaż każdego wagonu → 299,2 t", (await out(page, "train.sumT")) === "299,2 t" && nb(await page.textContent("[data-train-total]")) === "299,2 t");
    const trs = nb(await page.textContent("#train-summary"));
    check("Pociąg: podsumowanie składu z przewoźnikiem, dokumentem, kosztem", ["Liczba wagonów", "Łączny tonaż składu", "Przewoźnik", "Nr dokumentu", "Koszt transportu"].every(x => trs.includes(x)));

    /* ------------- MM ------------- */
    await preset(page, "mm");
    await page.selectOption("#f-mm-toWhId", "wh_bra"); await page.waitForTimeout(100);
    await page.selectOption("#f-mm-productId", "pr_zr_lesna"); await page.waitForTimeout(100);
    await fillTab(page, "#f-mm-qty", "300");
    check("MM: źródło 8 293 → 7 993 MP, cel 220 → 520 MP", (await out(page, "mm.srcBal")) === "8 293 MP → 7 993 MP" && (await out(page, "mm.dstBal")) === "220 MP → 520 MP", [await out(page, "mm.srcBal"), await out(page, "mm.dstBal")]);
    check("MM: zatwierdzenie", (await approve(page)) === 1);
    const mmOp = await lastOp(page);
    check("MM: stany po przesunięciu, stan firmy bez zmian", (await bal(page, "pr_zr_lesna")) === 7993 && (await bal(page, "pr_zr_lesna", "wh_bra")) === 520 && mmOp.no.startsWith("MM/"));

    /* ------------- wersja robocza ------------- */
    await preset(page, "zakup");
    await fillTab(page, "#f-purchase-supplierName", "Lander Agro"); await fillTab(page, "#f-purchase-qty", "12");
    const nD = await opsN(page);
    await page.click("#summary [data-draft]"); await page.waitForTimeout(300);
    await go(page, "operacje");
    check("§32.1 Wersja robocza: status ROBOCZY, bez numeru i bez wpływu na stan", nb(await page.textContent("#drafts-table")).includes("ROBOCZY") && (await opsN(page)) === nD && (await bal(page, "pr_drewno")) === 692);
    await page.selectOption("#o-scope", "all"); await page.waitForTimeout(150);
    const opsTxt = nb(await page.textContent("#ops-table"));
    check("§32.1 Rejestr: kolumna Status z ZATWIERDZONY / SKORYGOWANY / ANULOWANY", ["ZATWIERDZONY", "SKORYGOWANY", "ANULOWANY"].every(x => opsTxt.includes(x)));

    /* ------------- §32.23: anulowanie WZ ------------- */
    await page.click(`#ops-table tr[data-opid="${wzOp.id}"]`); await page.waitForSelector("#op-detail");
    await page.click("#op-detail [data-cancel]"); await page.waitForSelector("#cancel-dialog");
    check("§32.2 Anulowanie: podgląd wpływu na stan (+500 MP)", nb(await page.textContent("#cancel-effect")).includes("+500 MP"));
    await page.click("#cancel-yes"); await page.waitForTimeout(150);
    check("§32.2 Anulowanie wymaga przyczyny", nb(await page.textContent("#cancel-msg")).length > 0 && (await page.$("#cancel-dialog")) !== null);
    await page.selectOption("#cancel-reason", "błędny kontrahent"); await page.click("#cancel-yes");
    await page.waitForSelector("#op-detail"); await page.waitForTimeout(200);
    check("§32.23 T1: dokument ANULOWANY, stan przywrócony (+500 MP), dokument AN", nb(await page.textContent("#op-detail .modal-h")).includes("ANULOWANY") && (await bal(page, "pr_zr_lesna")) === 8493 && nb(await page.textContent("#op-docs")).includes("AN/"));
    check("§32.3 Anulowany dokument: brak przycisków Koryguj / Anuluj", !(await page.$("#op-detail [data-correct]")) && !(await page.$("#op-detail [data-cancel]")));
    await closeModals(page);

    /* ------------- §32.4: blokada anulowania przy zależnościach ------------- */
    await setUser(page, "u_kbra");
    const dep = await page.evaluate(async () => {
      const R = RIW_DEBUG.R, S = RIW_DEBUG.store;
      const d1 = R.Seed.draftOf("2026-09-23", { purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "100", unit: "m3", price: "230" }, transport: { mode: "none", place: "RiC Brąszewice" } });
      const a = await S.exec("op.commit", { draft: d1 }, "test");
      const b = await S.exec("op.commit", { draft: R.Seed.draftOf("2026-09-23", { type: "PRODUKCJA", production: { rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "480" } }) }, "test");
      return { ok: a.ok && b.ok, buy: a.op && a.op.id, use: b.op && b.op.id };
    });
    await setUser(page, "u_admin");
    await openOp(page, dep.buy);
    await page.click("#op-detail [data-cancel]"); await page.waitForSelector("#cancel-dialog");
    const blocked = nb(await page.textContent("#cancel-dialog"));
    check("§32.4 Blokada: „Nie można bezpośrednio anulować dokumentu … wykorzystany w późniejszych operacjach”", blocked.includes("Nie można bezpośrednio anulować dokumentu") && blocked.includes("wykorzystany w późniejszych operacjach") && !(await page.$("#cancel-yes")));
    await closeModals(page);
    await setUser(page, "u_kier");

    /* ------------- §32.5–32.17: korekta produkcji ------------- */
    await openOp(page, prodOp.id);
    await page.click("#op-detail [data-correct]"); await page.waitForSelector("#corr-preview");
    check("§32.5 Korekta: nagłówek „KOREKTA dokumentu nr …”", nb(await page.textContent(".page-head h2")).startsWith(`KOREKTA dokumentu nr ${prodOp.no}`));
    await fillTab(page, "#f-production-outQty", "400");
    await page.waitForSelector("#corr-changes");
    const cp = nb(await page.textContent("#corr-preview"));
    check("§32.9 Podgląd: oryginał / korekta / różnica / wpływ / stan przed-po", cp.includes("500 MP") && cp.includes("400 MP") && cp.includes("-100") && cp.includes("+25 m³") && (await page.$("#corr-effect")) !== null, cp.slice(0, 300));
    await page.click("#summary [data-save]"); await page.waitForTimeout(150);
    check("§32.8 Korekta bez powodu odrzucona", nb(await page.textContent("#corr-reason-msg")).length > 0);
    await page.selectOption("#corr-reason", "błędne zużycie surowca");
    await page.click("#summary [data-save]"); await page.click(".scrim [data-yes]");
    await page.waitForSelector("#op-detail"); await page.waitForTimeout(200);
    check("§32.23 Korekta produkcji: status SKORYGOWANY, drewno +25 m³, zrębka −100 MP, dokument KOR", nb(await page.textContent("#op-detail .modal-h")).includes("SKORYGOWANY") && (await bal(page, "pr_drewno")) === 717 && (await bal(page, "pr_zr_lesna")) === 8393 && nb(await page.textContent("#op-corr")).includes("KOR/"));
    await page.click("#op-corr [data-reverse]"); await page.fill("#cf-in", "test odwrócenia"); await page.click(".scrim:last-child [data-yes]");
    await page.waitForTimeout(400);
    check("§32.16 Odwrócenie korekty nową korektą (stan jak przed korektą)", (await bal(page, "pr_drewno")) === 692 && (await page.evaluate(id => RIW_DEBUG.store.state.operations.find(o => o.id === id).corrections.length, prodOp.id)) === 2);
    await closeModals(page);

    /* ------------- uprawnienia ------------- */
    await setUser(page, "u_mag"); await openOp(page, mmOp.id);
    check("§32.22 Magazynier: brak „Anuluj” i „Koryguj”", !(await page.$("#op-detail [data-cancel]")) && !(await page.$("#op-detail [data-correct]")));
    await closeModals(page);
    await setUser(page, "u_view"); await go(page, "nowa");
    check("Rola Podgląd nie tworzy operacji", nb(await page.textContent("#page")).includes("nie pozwala tworzyć operacji"));
    await setUser(page, "u_kier");

    /* ------------- historia ------------- */
    await go(page, "historia");
    const hHead = await page.$$eval("#hist-table thead th", t => t.map(x => x.textContent));
    check("§10 Historia: kolumny data, godzina, użytkownik, typ, dokument, magazyn, produkt, ilość, jednostka, stan przed/zmiana/po, kontrahent, powiązana, uwagi", ["Data", "Godz.", "Użytkownik", "Typ", "Nr dokumentu", "Magazyn", "Produkt", "Ilość", "Jedn.", "Stan przed", "Zmiana", "Stan po", "Kontrahent", "Powiązana operacja", "Uwagi"].every(h => hHead.includes(h)), hHead);
    await page.selectOption("#h-type", "KOREKTA"); await page.waitForTimeout(150);
    check("§32.18 Historia: filtr typu Korekta", (await page.$$eval("#hist-table tbody tr", r => r.length)) >= 2 && nb(await page.textContent("#hist-table")).includes("KOR/"));
    await page.selectOption("#h-type", ""); await page.selectOption("#h-mode", "custom"); await page.waitForTimeout(100);
    await page.fill("#h-from", "2026-09-15"); await page.press("#h-from", "Tab"); await page.fill("#h-to", "2026-09-16"); await page.press("#h-to", "Tab"); await page.waitForTimeout(150);
    const dates = await page.$$eval("#hist-table tbody tr td:first-child", t => [...new Set(t.map(x => x.textContent))]);
    check("§23 Historia: zakres dat 15.09–16.09", dates.every(d => d === "15.09.2026" || d === "16.09.2026") && dates.length === 2, dates);
    await page.selectOption("#h-mode", "month"); await page.waitForTimeout(150);
    await page.click('[data-htab="audit"]');
    check("Dziennik audytu: anulowanie z powodem", nb(await page.textContent("#audit-table")).includes("Anulowanie dokumentu") && nb(await page.textContent("#audit-table")).includes("błędny kontrahent"));

    /* ------------- raporty + PDF + spójność ------------- */
    await go(page, "raporty");
    check("§11 Raport miesięczny: tytuł i bilans spójny", nb(await page.textContent("#rep-title")) === "Raport miesięczny — WRZESIEŃ 2026" && nb(await page.textContent("#rep-consistent")).includes("spójny"));
    check("§11 Raport: sekcje zakupy, produkcja, sprzedaż, zużycie, MM, transport, wycena, korekty, anulowania", await allExist(page, ["#sec-recon", "#sec-purchases", "#sec-production", "#sec-sales", "#sec-consumption", "#sec-mm", "#sec-transport", "#sec-valuation"]) && nb(await page.textContent("#page")).includes("Korekty w okresie") && nb(await page.textContent("#page")).includes("Anulowania w okresie"));
    check("Test 31: wycena — produkt bez zakupu „BRAK WYCENY”", nb(await page.textContent("#rep-valuation")).includes("BRAK WYCENY"));
    await page.click("#rep-purchases tbody tr.drill >> nth=0"); await page.waitForSelector("#drill");
    check("§11 Drill-down: wiersz raportu → operacje źródłowe", (await page.$$("#drill-table tbody tr")).length >= 1);
    await closeModals(page);
    await page.selectOption("#r-wh", "wh_zab"); await page.waitForTimeout(200);
    const recRow = await page.$$eval("#rep-recon tbody tr", r => r.map(x => [...x.children].map(c => c.textContent)));
    const lesna = recRow.find(r => r[0].startsWith("Zrębka produkcyjna leśna"));
    const zabStock = await bal(page, "pr_zr_lesna");
    check("Test 33: spójność Raport = Stany (stan końcowy zrębki = księga)", lesna && nb(lesna[10]) === nb(await page.evaluate(q => RIW_DEBUG.R.fmtQ(q), zabStock)), [lesna && lesna[10], zabStock]);
    const repPurch = nb(await page.textContent("#rep-kpis .kpi:first-child .k-v"));
    const pdfR = await downloadPdf(page, "[data-pdf]", "raport.pdf");
    check("§12 GENERUJ PDF: prawdziwy plik PDF z osadzoną czcionką", pdfR.structural && pdfR.suggested.endsWith(".pdf"), pdfR.suggested);
    if (pdfR.text !== null) {
      check("§12 PDF: polskie znaki i treść raportu (tytuł, bilans, numer raportu, podpis)", ["Raport miesięczny — WRZESIEŃ 2026", "Bilans stanów", "Zrębka produkcyjna leśna", "Nr RAP/", "Sporządził", "Wygenerowano", "Strona 1 z"].every(x => pdfR.text.includes(x)), pdfR.text.slice(0, 400));
      check("Test 34: spójność Raport ekran = PDF (zakupy)", pdfR.text.includes(repPurch.replace(/ /g, "\u00A0")) || nb(pdfR.text).includes(repPurch), repPurch);
    }
    const [pop] = await Promise.all([page.waitForEvent("popup"), page.click("[data-print]")]);
    await pop.waitForLoadState(); await page.waitForTimeout(300);
    check("§12 DRUKUJ: wydruk w nowym oknie z tą samą treścią", (await pop.textContent("h1")).includes("Raport miesięczny") && (await pop.textContent("body")).includes("Bilans stanów"));
    await pop.close();
    check("Wydruk i PDF zapisane w audycie", await page.evaluate(() => RIW_DEBUG.store.state.audit.filter(a => a.event === "print").length >= 2));
    await go(page, "pulpit");
    const dashPurch = nb(await page.textContent("#kpi-purchase .k-v"));
    check("Test 35: spójność Pulpit = Raport (zakup miesiąca Zabrze)", repPurch.replace(/,\d\d zł$/, "") === dashPurch.replace(/ ?zł$/, ""), [repPurch, dashPurch]);

    /* ------------- kwit produkcji dnia ------------- */
    await go(page, "kwit");
    await page.fill("#k-date", "2026-09-22"); await page.press("#k-date", "Tab"); await page.waitForTimeout(150);
    await page.selectOption("#k-wh", "wh_bra"); await page.waitForTimeout(150);
    const kw = nb(await page.textContent("#kwit-kpis"));
    check("§16 Kwit: 20 MP = 5 m³, 6,60 t, 56,1 GJ, 200,00 zł", ["20 MP", "= 5 m³ surowca", "6,60 t", "56,1 GJ", "200,00 zł"].every(x => kw.includes(x)), kw);
    const kh = await page.$$eval("#kwit-table thead th", t => t.map(x => x.textContent));
    check("§16 Kwit: kolumny operator, surowiec, zużycie, produkt, MP, m³, t, GJ, cena, koszt, uwagi, nr", ["Nr PW", "Operator", "Surowiec", "Zużycie", "Produkt", "MP", "m³", "t", "GJ", "zł/MP", "Koszt", "Uwagi"].every(h => kh.includes(h)), kh);
    const pdfK = await downloadPdf(page, "[data-pdf]", "kwit.pdf");
    check("§16 Kwit: PDF", pdfK.structural && (pdfK.text === null || (pdfK.text.includes("Kwit produkcji dnia 22.09.2026") && pdfK.text.includes("Adam Mazur") && pdfK.text.includes("Operator rębaka"))), pdfK.text && pdfK.text.slice(0, 300));

    /* ------------- dokumenty, rejestry ------------- */
    await go(page, "dokumenty");
    check("Dokumenty: kolumna Status i dokumenty KOR / AN", (await page.$$eval("#docs-table thead th", t => t.map(x => x.textContent))).includes("Status") && nb(await page.textContent("#docs-table")).includes("KOR/") && nb(await page.textContent("#docs-table")).includes("AN/"));
    await page.click("#docs-table [data-view] >> nth=0"); await page.waitForSelector("#doc-preview");
    const pdfD = await downloadPdf(page, "#doc-preview [data-pdf]", "dok.pdf");
    check("Dokument: PDF pojedynczego dokumentu", pdfD.structural);
    await closeModals(page);
    for (const [r, sel] of [["przyjecia", "#docs-table"], ["wz", "#docs-table"], ["mm", "#docs-table"], ["produkcja", "#prod-table"], ["transport", "#tr-table"], ["produkty", "#products-table"], ["kontrahenci", "#partners-table"], ["magazyny", "[data-wh]"], ["administracja", "#bk-export"], ["profil", "#pf-pw"]]) {
      await go(page, r);
      check(`Moduł „${r}” działa`, !!(await page.$(sel)));
    }
    await go(page, "uzytkownicy"); await page.waitForSelector("#users-table");
    check("Użytkownicy: Kierownik — tylko podgląd (bez dodawania i zmian statusu)", !(await page.$("#user-add")) && !(await page.$("[data-ustat]")));
    await setUser(page, "u_admin"); await go(page, "admin/permissions"); await page.waitForSelector("#perm-table");
    check("Administracja: uprawnienia documents.cancel / documents.correct w macierzy", nb(await page.textContent("#perm-table")).includes("documents.cancel") && nb(await page.textContent("#perm-table")).includes("production.correct"));
    await setUser(page, "u_kier");
    /* ------------- 2.2: grupa dostawcy, leśnictwo, kursy transportu własnego ------------- */
    await preset(page, "zakup");
    check("2.2 Dostawca: dwie grupy (firma / nadleśnictwo), domyślnie firma → KZR", !!(await page.$("#f-skind-firma")) && !!(await page.$("#f-skind-nadlesnictwo")) && (await page.inputValue("#f-purchase-basis")) === "KZR" && !(await page.$("#f-purchase-lesnictwo")));
    await tick(page, "f-skind-nadlesnictwo"); await page.waitForTimeout(100);
    const ndlOpts = await page.$$eval("#dl-suppliers option", o => o.map(x => x.value));
    check("2.2 Nadleśnictwo: lista tylko nadleśnictw, podstawa Deklaracja, pole Leśnictwo", ndlOpts.length === 2 && ndlOpts.every(x => x.startsWith("Nadleśnictwo")) && (await page.inputValue("#f-purchase-basis")) === "DEKL" && !!(await page.$("#f-purchase-lesnictwo")), ndlOpts);
    await fillTab(page, "#f-purchase-supplierName", "Nadleśnictwo Rudy Raciborskie"); await page.waitForTimeout(100);
    const lesn = await page.$$eval("#dl-lesn option", o => o.map(x => x.value));
    check("2.2 Leśnictwo: lista zapisanych leśnictw nadleśnictwa", ["Stanica", "Kuźnia"].every(x => lesn.includes(x)), lesn);
    await page.selectOption("#f-purchase-basis", "KZR");
    check("2.2 Podstawa: ręczna zmiana możliwa", (await page.inputValue("#f-purchase-basis")) === "KZR");
    await page.selectOption("#f-purchase-basis", "DEKL");
    await fillTab(page, "#f-purchase-lesnictwo", "Leśnictwo Testowe");
    await fillTab(page, "#f-purchase-qty", "100"); await page.fill("#f-purchase-price", "210");
    await tick(page, "f-production-enabled"); await page.waitForSelector("#f-production-kwit");
    check("2.2 Produkcja z nadleśnictwa: nadleśnictwo i leśnictwo uzupełnione z zakupu", (await page.inputValue("#f-production-ndl")) === "Rudy Raciborskie" && (await page.inputValue("#f-production-lesnictwo")) === "Leśnictwo Testowe");
    await page.fill("#f-production-kwit", "KW 0600/09/2026");
    await tick(page, "f-mode-own"); await page.waitForSelector("#f-transport-own-runCount");
    await page.selectOption("#f-transport-own-runs-0-vehicleId", "ve_scania"); await page.waitForTimeout(100);
    await fillTab(page, "#f-transport-own-runs-0-km", "45");
    await fillTab(page, "#f-transport-own-runCount", "4");
    check("2.2 Liczba kursów 4 → 4 osobne rubryki (pojazd i km przejęte z poprzedniego)", (await page.$$(".run-card")).length === 4 && (await page.inputValue("#f-transport-own-runs-3-vehicleId")) === "ve_scania" && (await page.inputValue("#f-transport-own-runs-3-km")) === "45");
    check("2.2 Kurs: kierowca domyślny z pojazdu", (await page.inputValue("#f-transport-own-runs-2-driverId")) === "dr_kowalski");
    await page.selectOption("#f-transport-own-runs-1-vehicleId", "ve_volvo"); await page.waitForTimeout(100);
    check("2.2 Zmiana pojazdu w kursie → jego kierowca domyślny", (await page.inputValue("#f-transport-own-runs-1-driverId")) === "dr_nowak");
    for (let i = 0; i < 4; i++) { await fillTab(page, `#f-transport-own-runs-${i}-kwit`, `KW O359${i}/09/2026`); await fillTab(page, `#f-transport-own-runs-${i}-qty`, "100"); await fillTab(page, `#f-transport-own-runs-${i}-weightT`, "33"); }
    check("2.2 Podsumowanie kursów: 400 MP, 132 t, 4 × 45 km × 5 zł = 900,00 zł", nb(await page.textContent("[data-runs-qty]")) === "400 MP" && nb(await page.textContent("[data-runs-t]")).startsWith("132 t") && nb(await page.textContent("[data-runs-cost]")) === "900,00 zł",
      [nb(await page.textContent("[data-runs-qty]")), nb(await page.textContent("[data-runs-t]")), nb(await page.textContent("[data-runs-cost]"))]);
    const calcTxt = nb(await page.textContent('[data-calc="production.chipCost"]'));
    check("Poprawka: opis wyliczenia nie powiela się przy kolejnych przeliczeniach", (calcTxt.match(/zł\/MP/g) || []).length === 1, calcTxt);
    check("2.2 Zatwierdzenie zakupu z 4 kursami", (await approve(page)) === 1);
    const kop = await page.evaluate(() => RIW_DEBUG.store.state.operations.at(-1).transport);
    check("2.2 Zapisane: 4 kursy, 2 pojazdy, 400 MP, koszt 900 zł", kop.runs.length === 4 && kop.reg === "SGL 4T821, SZA 12345" && kop.totalQty === 400 && kop.cost === 900, kop.reg);
    await preset(page, "zakup"); await tick(page, "f-skind-nadlesnictwo"); await fillTab(page, "#f-purchase-supplierName", "Nadleśnictwo Rudy Raciborskie"); await page.waitForTimeout(100);
    check("2.2 Nowe leśnictwo zapisane na liście", (await page.$$eval("#dl-lesn option", o => o.map(x => x.value))).includes("Leśnictwo Testowe"));
    /* ------------- 2.3: dostawca i nadleśnictwo wpisywane ręcznie ------------- */
    await preset(page, "zakup");
    check("2.3 Pole dostawcy: tekst do wpisania + podpowiedzi z kartoteki", (await page.getAttribute("#f-purchase-supplierName", "list")) === "dl-suppliers" && (await page.$$("#dl-suppliers option")).length >= 3);
    await fillTab(page, "#f-purchase-supplierName", "Tartak Nowy Las");
    check("2.3 Nowa firma: komunikat „nowy dostawca”, podstawa KZR", nb(await page.textContent('[data-calc="purchase.supplierName"]')).includes("nowy dostawca") && (await page.inputValue("#f-purchase-basis")) === "KZR");
    await fillTab(page, "#f-purchase-qty", "10"); await page.fill("#f-purchase-price", "200");
    const np0 = await page.evaluate(() => RIW_DEBUG.store.state.partners.length);
    await page.click("#summary [data-save]"); await page.waitForSelector("#confirm-op");
    check("2.3 Podsumowanie: dostawca oznaczony jako nowy", nb(await page.textContent("#confirm-op")).includes("Tartak Nowy Las") && nb(await page.textContent("#confirm-op")).includes("nowy — zostanie dodany do kartoteki"));
    await page.click("#confirm-yes"); await page.waitForSelector("#op-detail"); await closeModals(page);
    check("2.3 Nowa firma dopisana do kartoteki (grupa firma)", await page.evaluate(n => { const s = RIW_DEBUG.store.state; const p = s.partners.find(x => x.name === "Tartak Nowy Las"); return s.partners.length === n + 1 && p && p.kind === "firma" && s.operations.at(-1).purchase.supplierId === p.id; }, np0));
    await preset(page, "zakup"); await tick(page, "f-skind-nadlesnictwo"); await page.waitForTimeout(100);
    await fillTab(page, "#f-purchase-supplierName", "Nadleśnictwo Kędzierzyn");
    await fillTab(page, "#f-purchase-lesnictwo", "Sławięcice");
    check("2.3 Nowe nadleśnictwo wpisane ręcznie: Deklaracja, leśnictwo wpisane", (await page.inputValue("#f-purchase-basis")) === "DEKL" && nb(await page.textContent('[data-calc="purchase.supplierName"]')).includes("nowy dostawca"));
    await fillTab(page, "#f-purchase-qty", "20"); await page.fill("#f-purchase-price", "205");
    check("2.3 Zatwierdzenie zakupu z nowego nadleśnictwa", (await approve(page)) === 1);
    check("2.3 Nowe nadleśnictwo w kartotece z leśnictwem na liście", await page.evaluate(() => { const s = RIW_DEBUG.store.state; const p = s.partners.find(x => x.name === "Nadleśnictwo Kędzierzyn"); return !!p && p.kind === "nadlesnictwo" && s.operations.at(-1).purchase.lesnictwo === "Sławięcice"; }));
    await preset(page, "zakup"); await fillTab(page, "#f-purchase-supplierName", "nadleśnictwo kędzierzyn"); await page.waitForTimeout(100);
    check("2.3 Ponowne wpisanie (inna wielkość liter) → istniejący, grupa i leśnictwa z kartoteki", (await page.isChecked("#f-skind-nadlesnictwo")) && nb(await page.textContent('[data-calc="purchase.supplierName"]')).includes("z kartoteki") && (await page.$$eval("#dl-lesn option", o => o.map(x => x.value))).includes("Sławięcice"));
    await go(page, "kontrahenci");
    check("2.3 Kontrahenci: nowi dostawcy widoczni", nb(await page.textContent("#partners-table")).includes("Tartak Nowy Las") && nb(await page.textContent("#partners-table")).includes("Nadleśnictwo Kędzierzyn"));

    /* ------------- 2.4: kursy transportu zewnętrznego ------------- */
    await preset(page, "zakup");
    await fillTab(page, "#f-purchase-supplierName", "Lander Agro"); await fillTab(page, "#f-purchase-qty", "100"); await page.fill("#f-purchase-price", "230");
    await tick(page, "f-production-enabled"); await page.waitForSelector("#f-production-kwit");
    await page.fill("#f-production-ndl", "Rudy Raciborskie"); await page.fill("#f-production-lesnictwo", "Stanica"); await page.fill("#f-production-kwit", "KW 0800/09/2026");
    await tick(page, "f-mode-external"); await page.waitForSelector("#f-transport-external-runCount");
    await fillTab(page, "#f-transport-external-company", "ESI Logistics");
    await fillTab(page, "#f-transport-external-runs-0-km", "45");
    await fillTab(page, "#f-transport-external-runCount", "4");
    check("2.4 Zewnętrzny: liczba kursów 4 → 4 rubryki (km przejęte z poprzedniego)", (await page.$$("[data-xrun]")).length === 4 && (await page.inputValue("#f-transport-external-runs-3-km")) === "45");
    for (let i = 0; i < 4; i++) { await fillTab(page, `#f-transport-external-runs-${i}-kwit`, `KW E402${i}/09/2026`); await fillTab(page, `#f-transport-external-runs-${i}-reg`, `ESI 1000${i}`); await fillTab(page, `#f-transport-external-runs-${i}-driver`, "Jan Nowak"); await fillTab(page, `#f-transport-external-runs-${i}-qty`, "100"); await fillTab(page, `#f-transport-external-runs-${i}-weightT`, "33"); }
    check("2.4 Zewnętrzny: podsumowanie 400 MP, 132 t, 4 × 45 km × 5 zł = 900,00 zł", nb(await page.textContent("[data-runs-qty]")) === "400 MP" && nb(await page.textContent("[data-runs-t]")).startsWith("132 t") && nb(await page.textContent("[data-runs-cost]")) === "900,00 zł",
      [nb(await page.textContent("[data-runs-qty]")), nb(await page.textContent("[data-runs-cost]"))]);
    await fillTab(page, "#f-transport-external-runs-0-freight", "300");
    check("2.4 Zewnętrzny: fracht kursu z faktury zastępuje km × stawka (300 + 3 × 225 = 975 zł)", nb(await page.textContent("[data-runs-cost]")) === "975,00 zł", nb(await page.textContent("[data-runs-cost]")));
    check("2.4 Zatwierdzenie zakupu z 4 kursami zewnętrznymi", (await approve(page)) === 1);
    const xop = await page.evaluate(() => RIW_DEBUG.store.state.operations.at(-1).transport);
    check("2.4 Zapisane: przewoźnik, 4 kursy, 400 MP, 132 t, 975 zł", xop.company === "ESI Logistics" && xop.runs.length === 4 && xop.totalQty === 400 && xop.totalWeightT === 132 && xop.cost === 975);

    /* ------------- 2.6: kwity wywozowe w każdym kursie ------------- */
    await preset(page, "zakup");
    await tick(page, "f-skind-nadlesnictwo"); await fillTab(page, "#f-purchase-supplierName", "Nadleśnictwo Rybnik"); await fillTab(page, "#f-purchase-lesnictwo", "Wielopole");
    await fillTab(page, "#f-purchase-qty", "100"); await page.fill("#f-purchase-price", "210");
    await tick(page, "f-production-enabled"); await page.waitForSelector("#f-production-outQty");
    check("2.6 Bez transportu: kwit wywozowy przy produkcji", !!(await page.$("#f-production-kwit")));
    await tick(page, "f-mode-own"); await page.waitForSelector("#own-runs");
    check("2.6 Z kursami: brak pola kwitu w produkcji, kwit i m³ w kursie", !(await page.$("#f-production-kwit")) && !!(await page.$("#f-transport-own-runs-0-kwit")) && !!(await page.$("#f-transport-own-runs-0-kwitM3")));
    await page.selectOption("#f-transport-own-runs-0-vehicleId", "ve_scania"); await page.waitForTimeout(100);
    await fillTab(page, "#f-transport-own-runs-0-km", "30"); await fillTab(page, "#f-transport-own-runCount", "4");
    for (let i = 0; i < 4; i++) { await fillTab(page, `#f-transport-own-runs-${i}-kwit`, `KW 0300/${i + 1}/09/2026`); await fillTab(page, `#f-transport-own-runs-${i}-kwitM3`, "25"); await fillTab(page, `#f-transport-own-runs-${i}-weightT`, "33"); }
    check("2.6 m³ z kwitu × 4 → MP na aucie (25 m³ → 100 MP)", (await page.inputValue("#f-transport-own-runs-2-qty")) === "100");
    check("2.6 Podsumowanie: kwity, 100 m³, 400 MP, wszystko rozwiezione", nb(await page.textContent("#runs-summary")).includes("KW 0300/4/09/2026") && nb(await page.textContent("[data-runs-m3]")) === "100 m³" && nb(await page.textContent("[data-runs-qty]")) === "400 MP" && nb(await page.textContent("[data-runs-limit]")).includes("wszystko rozwiezione"));
    await fillTab(page, "#f-transport-own-runs-3-kwitM3", "26");
    check("2.6 Suma kursów ponad produkcję → blokada z komunikatem", nb(await page.textContent('[data-msg="transport.runs"]')).includes("Suma kursów 404 MP przekracza ilość z produkcji 400 MP"), nb(await page.textContent('[data-msg="transport.runs"]')));
    const nK = await opsN(page);
    await page.click("#summary [data-save]"); await page.waitForTimeout(200);
    check("2.6 Zatwierdzenie zablokowane przy przekroczeniu", !(await page.$("#confirm-op")) && (await opsN(page)) === nK);
    await fillTab(page, "#f-transport-own-runs-3-kwitM3", "25");
    check("2.6 Zatwierdzenie z 4 kwitami", (await approve(page)) === 1);
    const kwS = await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return { kwit: o.production.kwit, m3: o.transport.totalM3, pw: o.documents.find(d => d.type === "PW").meta.kwit }; });
    check("2.6 Zapisane kwity w produkcji i na PW", kwS.kwit.split(", ").length === 4 && kwS.m3 === 100 && kwS.pw === kwS.kwit, kwS);

    /* ------------- 2.5: transport własny + zewnętrzny w jednej produkcji ------------- */
    await preset(page, "zakup");
    await fillTab(page, "#f-purchase-supplierName", "Lander Agro"); await fillTab(page, "#f-purchase-qty", "100"); await page.fill("#f-purchase-price", "230");
    await tick(page, "f-production-enabled"); await page.waitForSelector("#f-production-kwit");
    await page.fill("#f-production-ndl", "Rudy Raciborskie"); await page.fill("#f-production-lesnictwo", "Stanica"); await page.fill("#f-production-kwit", "KW 0950/09/2026");
    await tick(page, "f-mode-own"); await page.waitForSelector("#own-runs");
    await tick(page, "f-mode-external"); await page.waitForSelector("#ext-runs");
    check("2.5 Własny i zewnętrzny zaznaczone razem — obie sekcje kursów widoczne", (await page.isChecked("#f-mode-own")) && (await page.isChecked("#f-mode-external")) && !!(await page.$("#own-runs")) && (await page.evaluate(() => RIW_DEBUG.plan.norm.transport.mode)) === "mixed");
    await page.selectOption("#f-transport-own-runs-0-vehicleId", "ve_scania"); await page.waitForTimeout(100);
    await fillTab(page, "#f-transport-own-runs-0-km", "45"); await fillTab(page, "#f-transport-own-runCount", "3");
    for (let i = 0; i < 3; i++) { await fillTab(page, `#f-transport-own-runs-${i}-kwit`, `KW O421${i}/09/2026`); await fillTab(page, `#f-transport-own-runs-${i}-qty`, "80"); await fillTab(page, `#f-transport-own-runs-${i}-weightT`, "33"); }
    await fillTab(page, "#f-transport-external-company", "ESI Logistics"); await fillTab(page, "#f-transport-external-runs-0-km", "45"); await fillTab(page, "#f-transport-external-runCount", "2");
    for (let i = 0; i < 2; i++) { await fillTab(page, `#f-transport-external-runs-${i}-kwit`, `KW E423${i}/09/2026`); await fillTab(page, `#f-transport-external-runs-${i}-reg`, `ESI 2000${i}`); await fillTab(page, `#f-transport-external-runs-${i}-qty`, "80"); await fillTab(page, `#f-transport-external-runs-${i}-weightT`, "33"); }
    const kinds = await page.$$eval("#runs-summary tbody tr", r => r.map(x => x.dataset.runKind).join(","));
    check("2.5 Wspólne podsumowanie: 3 kursy własne + 2 zewnętrzne, 400 MP, 165 t, 1 125,00 zł", kinds === "own,own,own,external,external" && nb(await page.textContent("[data-runs-qty]")) === "400 MP" && nb(await page.textContent("[data-runs-t]")).startsWith("165 t") && nb(await page.textContent("[data-runs-cost]")) === "1 125,00 zł",
      [kinds, nb(await page.textContent("[data-runs-qty]")), nb(await page.textContent("[data-runs-cost]"))]);
    check("2.5 Podział kosztu: flota własna / firma zewnętrzna", nb(await page.textContent("[data-runs-split]")).includes("3 × flota własna: 240 MP, 675,00 zł") && nb(await page.textContent("[data-runs-split]")).includes("2 × ESI Logistics: 160 MP, 450,00 zł"), nb(await page.textContent("[data-runs-split]")));
    check("2.5 Zatwierdzenie produkcji z transportem mieszanym", (await approve(page)) === 1);
    const mop = await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return { id: o.id, mode: o.transport.mode, n: o.transport.runs.length, cost: o.transport.cost }; });
    check("2.5 Zapisane: tryb mieszany, 5 kursów, 1 125 zł", mop.mode === "mixed" && mop.n === 5 && mop.cost === 1125, mop);
    await openOp(page, mop.id);
    await page.click("#op-docs tr:has-text('TR/') [data-doc]"); await page.waitForSelector("#doc-preview");
    const trTxt = nb(await page.textContent("#doc-preview"));
    check("2.5 Karta TR: kursy floty własnej i firmy zewnętrznej osobno", trTxt.includes("Kursy floty własnej") && trTxt.includes("Kursy firmy zewnętrznej — ESI Logistics"));
    await closeModals(page);

    await go(page, "flota");
    check("2.2 Flota: kursy liczone pojedynczo", nb(await page.textContent("#runs-table")).includes("kurs 4"));

    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "e2e_desktop.png"), fullPage: true });
    await ctx.close();
  }

  /* ------------- wyścig dwóch kart ------------- */
  {
    const ctx = await newCtx(browser, { viewport: { width: 1280, height: 900 } });
    const p1 = await ctx.newPage(); watch(p1, "karta1"); await boot(p1);
    const p2 = await ctx.newPage(); watch(p2, "karta2"); await boot(p2);
    for (const p of [p1, p2]) {
      await preset(p, "wz");
      await p.selectOption("#f-sale-productId", "pr_zr_lesna");
      await fillTab(p, "#f-sale-qty", "5000");
      await p.fill("#f-sale-price", "90");
      await p.selectOption("#f-sale-buyerId", "pa_ec_zab");
    }
    await p1.click("#summary [data-save]"); await p1.waitForSelector("#confirm-op");
    await p2.click("#summary [data-save]"); await p2.waitForSelector("#confirm-op");
    await p1.click("#confirm-yes"); await p1.waitForSelector("#op-detail");
    await p2.click("#confirm-yes"); await p2.waitForTimeout(600);
    check("Wyścig: druga WZ na ten sam stan odrzucona", nb(await p2.textContent("#toasts")).includes("Nie zapisano"));
    check("Wyścig: stan 3 293 MP, nie ujemny", (await bal(p2, "pr_zr_lesna")) === 3293);
    await ctx.close();
  }

  /* ------------- telefon ------------- */
  {
    const ctx = await newCtx(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); watch(page, "mobile"); await boot(page);
    for (const r of ["pulpit", "operacje", "nowa?preset=zakup", "nowa?preset=produkcja", "nowa?preset=bezposrednia", "nowa?preset=mm", "stany", "historia", "raporty", "kwit", "dokumenty", "administracja"]) {
      await go(page, r);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`Telefon 390 px: ${r} bez przewijania w poziomie`, over <= 1, over);
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "e2e_mobile.png"), fullPage: false });
    await ctx.close();
  }

  /* ------------- 3.1: rejestracja, role, obieg zatwierdzania, magazyny ------------- */
  {
    const ctx = await newCtx(browser);
    const page = await ctx.newPage(); watch(page, "3.1"); await boot(page);
    check("3.1 Stopka autorska w programie", nb(await page.textContent(".app-foot")).includes("Program stworzony przez Roesner Mateusz dla ResInvest Commodities"));
    check("3.1 Trzy magazyny RiC", (await page.evaluate(() => RIW_DEBUG.store.state.warehouses.map(w => w.name).join("|"))) === "RiC Zabrze|RiC Brąszewice|RiC Rokitki");
    // 3.2: rejestracja domyślnie wyłączona — konta zakłada administrator
    await page.evaluate(() => RIW_DEBUG.app.logout()); await page.waitForSelector("#login-form");
    check("3.2 Logowanie: pole „E-mail służbowy”, tryb OFFLINE, bez zakładki rejestracji", nb(await page.textContent('label[for="lg-login"]')) === "E-mail służbowy" && nb(await page.textContent(".auth-box .lead")).startsWith("OFFLINE") && !(await page.$('[data-auth-tab="register"]')));
    check("3.2 Wylogowanie: adres #/login", await page.evaluate(() => location.hash === "#/login"));
    await page.fill("#lg-login", "jan@gmail.com"); await page.fill("#lg-pass", "Cokolwiek2026"); await page.click("#lg-submit"); await page.waitForTimeout(200);
    check("3.2 Logowanie: domena spoza firmy odrzucona", nb(await page.textContent("#lg-err")).includes("Wymagany e-mail firmowy"));
    await login(page, LOGINS.u_admin); await go(page, "administracja"); await page.waitForSelector("#access-card");
    await page.check("#cfg-selfreg"); await page.waitForTimeout(250); await page.check("#cfg-approval"); await page.waitForTimeout(250);
    check("3.2 Konfiguracja dostępu: rejestracja i obieg zatwierdzania włączone (audyt SETTINGS_CHANGED)", await page.evaluate(() => { const S = RIW_DEBUG.store.state; return S.config.allowSelfRegistration && S.config.requireApproval && S.audit.filter(a => a.code === "SETTINGS_CHANGED").length === 2; }));
    await page.evaluate(() => RIW_DEBUG.app.logout()); await page.waitForSelector("#login-form");
    await page.click('[data-auth-tab="register"]');
    const reg = async (name, email) => { await page.fill("#rg-name", name); await page.fill("#rg-email", email); await page.fill("#rg-pass", "Rejestracja2026"); await page.fill("#rg-pass2", "Rejestracja2026"); await page.click("#rg-submit"); await page.waitForTimeout(400); };
    await reg("Jan Obcy", "jan@gmail.com");
    check("3.1 Rejestracja: tylko domena firmowa", nb(await page.textContent("#rg-err")).includes("Wymagany e-mail firmowy"));
    await reg("Ewa Nowicka", "ewa.nowicka@resinvest.group");
    check("3.1 Rejestracja: konto utworzone, oczekuje", nb(await page.textContent("#auth-info")).includes("zarejestrowane"));
    await page.fill("#lg-pass", "Rejestracja2026"); await page.click("#lg-submit"); await page.waitForTimeout(400);
    check("3.1 Rejestracja: logowanie zablokowane do zatwierdzenia", nb(await page.textContent("#lg-err")).includes("oczekuje na zatwierdzenie"));
    await login(page, LOGINS.u_admin);
    check("3.1 Zgłoszenie widoczne dla administratora (pulpit)", nb(await page.textContent("#dash-todo")).includes("zgłoszenie rejestracji"));
    await go(page, "uzytkownicy"); await page.waitForSelector("#reg-table");
    await page.click("[data-uapprove]"); await page.waitForSelector("#user-edit");
    await page.selectOption("#me-role", "magazynier"); await page.selectOption("#me-whId", "wh_zab"); await page.click("#user-edit [data-yes]"); await page.waitForTimeout(400);
    check("3.1 Administrator aktywuje konto (rola, magazyn, status)", (await page.evaluate(() => { const u = RIW_DEBUG.store.state.users.find(x => x.login === "ewa.nowicka@resinvest.group"); return `${u.role}/${u.whId}/${u.status}`; })) === "magazynier/wh_zab/ACTIVE");
    // magazynier przekazuje operację do zatwierdzenia
    await login(page, "ewa.nowicka@resinvest.group", "Rejestracja2026");
    await preset(page, "wz");
    check("3.1 Magazynier: przycisk „Przekaż do zatwierdzenia…”", nb(await page.textContent("#summary [data-save]")) === "Przekaż do zatwierdzenia…");
    await page.selectOption("#f-sale-productId", "pr_zr_lesna"); await fillTab(page, "#f-sale-qty", "120"); await page.fill("#f-sale-price", "90"); await page.selectOption("#f-sale-buyerId", "pa_ec_zab"); await page.waitForTimeout(100);
    const n0 = await opsN(page), st0 = await bal(page, "pr_zr_lesna");
    await page.click("#summary [data-save]"); await page.waitForSelector("#confirm-op"); await page.click("#confirm-yes"); await page.waitForTimeout(500);
    check("3.1 Przekazana operacja: bez numeru i bez zmiany stanu", (await opsN(page)) === n0 && (await bal(page, "pr_zr_lesna")) === st0 && (await page.evaluate(() => RIW_DEBUG.store.state.drafts.filter(d => d.status === "PENDING").length)) === 1);
    // kierownik innego magazynu nie widzi kolejki, kierownik Zabrza zatwierdza
    await login(page, LOGINS.u_kbra); await go(page, "operacje");
    check("3.1 Kierownik Brąszewic nie zatwierdza operacji Zabrza", !(await page.$("#approvals-table [data-review]")));
    await login(page, LOGINS.u_kier); await go(page, "operacje"); await page.waitForSelector("#approvals-table");
    check("3.1 Kolejka „Do zatwierdzenia” u kierownika (znacznik w menu)", nb(await page.textContent('[data-nav="operacje"] .cnt')) === "1");
    await page.click("#approvals-table [data-review]"); await page.waitForSelector("#opf");
    await page.click("#summary [data-save]"); await page.waitForSelector("#confirm-op"); await page.click("#confirm-yes");
    await page.waitForSelector("#op-detail", { timeout: 4000 }).catch(() => {});
    const apr = await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return { no: o.no, by: o.userName, ap: o.approvedByName }; });
    check("3.1 Zatwierdzenie: dokument WZ, autor magazynier, zatwierdził kierownik", apr.no.startsWith("WZ/") && apr.by === "Ewa Nowicka" && apr.ap === "Anna Górska" && (await bal(page, "pr_zr_lesna")) === st0 - 120, apr);
    await closeModals(page);
    // obieg wyłączony — magazynier zatwierdza sam
    await login(page, LOGINS.u_admin); await go(page, "administracja"); await page.waitForSelector("#access-card"); await page.uncheck("#cfg-approval"); await page.waitForTimeout(250);
    await login(page, "ewa.nowicka@resinvest.group", "Rejestracja2026"); await preset(page, "wz");
    check("3.2 Obieg wyłączony: magazynier ma przycisk „Zatwierdź…”", nb(await page.textContent("#summary [data-save]")) === "Zatwierdź…");
    // obserwator
    await login(page, LOGINS.u_view);
    check("3.1 Obserwator: brak „Nowej operacji” i edycji kartotek", await page.evaluate(() => document.querySelector("#top-new").classList.contains("hidden")) && (await go(page, "produkty"), !(await page.$("[data-madd]"))));
    // administrator: magazyn roboczy, flota wg magazynu
    await login(page, LOGINS.u_admin);
    await page.click("#wh-chip"); await page.click('[data-wh="wh_rok"]'); await page.waitForTimeout(300);
    check("3.1 Administrator przełącza magazyn roboczy", nb(await page.textContent("#wh-chip")).includes("RiC Rokitki"));
    await preset(page, "produkcja");
    const chOpts = await page.$$eval("#f-production-chipperId option", o => o.map(x => x.value).filter(Boolean));
    check("3.1 Formularz: tylko rębaki magazynu operacji", chOpts.length === 1 && chOpts[0] === "ch_albach", chOpts);
    // 3.2: zakup — ilość w m³, cena za MP; zmiana jednostki ilości przelicza ilość; transport zapewnia dostawca
    await preset(page, "zakup");
    await fillTab(page, "#f-purchase-supplierName", "Lander Agro"); await fillTab(page, "#f-purchase-qty", "10");
    await page.selectOption("#f-purchase-priceUnit", "MP"); await page.waitForTimeout(150);
    await fillTab(page, "#f-purchase-price", "57,5");
    check("3.2 Zakup: 10 m³ × 57,50 zł/MP = 2 300 zł (ilość w m³, cena za MP)", nb(await out(page, "purchase.cost")).startsWith("2 300,00"), await out(page, "purchase.cost"));
    await page.selectOption("#f-purchase-unit", "MP"); await page.waitForTimeout(150);
    check("3.2 Zmiana jednostki ilości m³ → MP przelicza ilość (10 m³ = 40 MP), koszt bez zmian", (await page.inputValue("#f-purchase-qty")) === "40" && nb(await out(page, "purchase.cost")).startsWith("2 300,00"), await page.inputValue("#f-purchase-qty"));
    await tick(page, "f-mode-supplier"); await page.waitForTimeout(150);
    check("3.2 Transport w cenie zakupu — zapewnia dostawca (bez TR)", nb(await page.textContent("#opf")).includes("Transport zapewnia dostawca Lander Agro") && !nb(await page.textContent("#summary")).includes("TR "));
    const nBuy = await opsN(page);
    check("3.2 Zatwierdzenie zakupu z transportem dostawcy", (await approve(page)) === 1 && (await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return o.transport.mode === "supplier" && o.totals.purchaseCost === 2300 && !o.documents.some(d => d.type === "TR"); })), nBuy);
    await closeModals(page);
    // 3.2: korekta zakupu drewna — zmiana jednostki ilości MP → m³ i ceny na zł/m³ (zgłoszenie: „brak korekty z m³ na MP”)
    const buyOp = await lastOp(page), wood0 = await bal(page, "pr_drewno", "wh_rok");
    await openOp(page, buyOp.id); await page.click("#op-detail [data-correct]"); await page.waitForSelector("#corr-preview");
    await page.selectOption("#f-purchase-unit", "m3"); await page.waitForTimeout(150);
    check("3.2 Korekta: zmiana jednostki MP → m³ przelicza ilość (40 MP = 10 m³)", (await page.inputValue("#f-purchase-qty")) === "10", await page.inputValue("#f-purchase-qty"));
    await page.selectOption("#f-purchase-priceUnit", "m3"); await page.waitForTimeout(150); await fillTab(page, "#f-purchase-price", "240");
    await page.selectOption("#corr-reason", { index: 1 });
    await page.click("#summary [data-save]"); await page.click(".scrim [data-yes]");
    await page.waitForSelector("#op-detail"); await page.waitForTimeout(200);
    const corrOp = await page.evaluate(id => { const o = RIW_DEBUG.store.state.operations.find(x => x.id === id); return { st: o.status, unit: o.purchase.unit, pu: o.purchase.priceUnit, cost: o.totals.purchaseCost, stock: o.purchase.stockQty }; }, buyOp.id);
    check("3.2 Korekta zapisana: 10 m³ × 240 zł/m³ = 2 400 zł, stan drewna bez zmian", corrOp.st === "CORRECTED" && corrOp.unit === "m3" && corrOp.pu === "m3" && corrOp.cost === 2400 && corrOp.stock === 10 && (await bal(page, "pr_drewno", "wh_rok")) === wood0, corrOp);
    await closeModals(page);
    // 3.2: Produkty — nowa łupina liczona w MP, PKS z gęstością (m³)
    await go(page, "produkty"); await page.click('[data-madd="products"]'); await page.waitForSelector("#master-edit");
    await page.fill("#me-code", "LUP-MP"); await page.fill("#me-name", "Łupina nerkowca MP"); await page.selectOption("#me-cat", "agro");
    await page.selectOption("#me-unit", "MP"); await page.check('[data-unit-ok="m3"]'); await page.fill("#me-tPerUnit", "0,25");
    await page.click("#master-edit [data-yes]"); await page.waitForTimeout(300);
    const lupMP = await page.evaluate(() => { const p = RIW_DEBUG.store.state.products.find(x => x.code === "LUP-MP"); return p ? `${p.unit}/${RIW_DEBUG.R.Units.allowed(p).join(",")}` : null; });
    check("3.2 Produkty: nowa łupina w MP (dozwolone m³, MP, t)", lupMP === "MP/m3,MP,t", lupMP);
    await page.click('[data-medit="products|pr_pks"]'); await page.waitForSelector("#master-edit");
    check("3.2 Produkty: PKS — jednostka magazynowa zablokowana (ruchy w księdze)", await page.$eval("#me-unit", x => x.disabled));
    await page.check('[data-unit-ok="m3"]'); await page.fill("#me-tPerM3", "0,6"); await page.click("#master-edit [data-yes]"); await page.waitForTimeout(300);
    check("3.2 Produkty: PKS kupowany także w m³ (gęstość 0,6 t/m³)", await page.evaluate(() => { const p = RIW_DEBUG.store.state.products.find(x => x.id === "pr_pks"); return RIW_DEBUG.R.Units.allowed(p).join(",") === "m3,t" && RIW_DEBUG.R.Units.convert(10, "m3", "t", p, RIW_DEBUG.store.state.config) === 6; }));
    // 3.2: dodanie użytkownika (OFFLINE — hasło tymczasowe), wiele magazynów, status
    await go(page, "admin/users"); await page.waitForSelector("#users-table");
    check("3.2 Tabela użytkowników: kolumny wg specyfikacji", (await page.$$eval("#users-table thead th", l => l.map(x => x.textContent.trim()).join("|"))) === "Użytkownik|E-mail|Rola|Magazyn|Status|Ostatnie logowanie|Akcje");
    await page.click("#user-add"); await page.waitForSelector("#user-edit");
    await page.fill("#me-firstName", "Olga"); await page.fill("#me-lastName", "Testowa"); await page.fill("#me-email", "Olga.Testowa@resinvest.group");
    await page.selectOption("#me-role", "kierownik"); await page.selectOption("#me-whId", "wh_bra"); await page.check('[data-whacc="wh_rok"]');
    await page.fill("#me-pw", "Tymczas2026"); await page.fill("#me-pw2", "Tymczas2026"); await page.click("#user-edit [data-yes]"); await page.waitForTimeout(400);
    const olga = await page.evaluate(() => { const u = RIW_DEBUG.store.state.users.find(x => x.login === "olga.testowa@resinvest.group"); return u ? `${u.name}/${u.role}/${u.whId}/${u.warehouseIds.sort().join(",")}/${u.status}` : null; });
    check("3.2 Dodanie użytkownika: imię, nazwisko, e-mail (małe litery), rola, magazyn domyślny + dostępne", olga === "Olga Testowa/kierownik/wh_bra/wh_bra,wh_rok/ACTIVE", olga);
    const oid = await page.evaluate(() => RIW_DEBUG.store.state.users.find(x => x.login === "olga.testowa@resinvest.group").id);
    await page.click(`[data-ustat="${oid}|SUSPENDED"]`); await page.waitForTimeout(200); await page.click(".scrim [data-yes] >> nth=-1"); await page.waitForTimeout(300);
    check("3.2 Zawieszenie konta (status SUSPENDED, audyt USER_SUSPENDED)", await page.evaluate(id => { const S = RIW_DEBUG.store.state; return S.users.find(u => u.id === id).status === "SUSPENDED" && S.audit.some(a => a.code === "USER_SUSPENDED" && a.entityId === id); }, oid));
    // role i audyt
    await go(page, "admin/roles"); await page.waitForSelector("#roles-grid");
    const rolesTxt = nb(await page.textContent("#roles-grid"));
    check("3.2 Role: ADMINISTRATOR, MANAGER, MAGAZYNIER, OBSERWATOR, AUDYTOR", ["ADMINISTRATOR", "MANAGER", "MAGAZYNIER", "OBSERWATOR", "AUDYTOR"].every(c => rolesTxt.includes(c)));
    await page.check('[data-perm="obserwator|reports.export"]'); await page.click('[data-rsave="obserwator"]'); await page.waitForTimeout(300);
    check("3.2 Edycja uprawnień roli (audyt ROLE_PERMISSIONS_CHANGED)", await page.evaluate(() => RIW_DEBUG.R.can({ role: "obserwator" }, "reports.export") && RIW_DEBUG.store.state.audit.at(-1).code === "ROLE_PERMISSIONS_CHANGED"));
    await page.click('[data-rreset="obserwator"]'); await page.waitForTimeout(300);
    check("3.2 Przywrócenie domyślnych uprawnień", await page.evaluate(() => !RIW_DEBUG.R.can({ role: "obserwator" }, "reports.export")));
    await go(page, "admin/audit"); await page.waitForSelector("#audit-admin-table");
    const auTxt = nb(await page.textContent("#audit-admin-table"));
    check("3.2 Dziennik audytu: kody zdarzeń (USER_CREATED, USER_SUSPENDED, ROLE_PERMISSIONS_CHANGED)", ["USER_CREATED", "USER_SUSPENDED", "ROLE_PERMISSIONS_CHANGED"].every(c => auTxt.includes(c)));
    // kierownik z dwoma magazynami przełącza magazyn roboczy tylko na przydzielone
    await login(page, LOGINS.u_kier);
    await page.click("#wh-chip"); await page.waitForSelector(".dd [data-wh], [data-wh]");
    const whOpts = await page.$$eval("[data-wh]", l => l.map(x => x.dataset.wh).join(","));
    check("3.2 Magazyn roboczy: tylko przydzielone magazyny (Zabrze, Brąszewice)", whOpts === "wh_zab,wh_bra", whOpts);
    await page.click('[data-wh="wh_bra"]'); await page.waitForTimeout(300);
    check("3.2 Przełączenie na RiC Brąszewice", nb(await page.textContent("#wh-chip")).includes("RiC Brąszewice"));
    await page.click("#wh-chip"); await page.click('[data-wh="wh_zab"]'); await page.waitForTimeout(200);
    await login(page, LOGINS.u_bra);
    check("3.2 Magazynier jednego magazynu: bez przełącznika", !(await page.evaluate(() => document.querySelector("#wh-chip").classList.contains("switchable"))));
    await ctx.close();
  }

  /* ------------- 3.1: ramka z zablokowanym magazynem przeglądarki (podgląd pliku) ------------- */
  {
    const wrap = path.join(TMP, "podglad.html");
    fs.writeFileSync(wrap, `<!doctype html><body style="margin:0"><iframe sandbox="allow-scripts allow-forms allow-popups allow-modals" src="${FILE}" style="width:1400px;height:880px;border:0"></iframe></body>`);
    const ctx = await newCtx(browser); const page = await ctx.newPage(); watch(page, "sandbox");
    await page.goto("file://" + wrap); await page.waitForTimeout(1500);
    const f = page.frames().find(x => x.url().endsWith("ResInvest_ERP.html"));
    await f.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))).catch(() => {});
    await f.waitForSelector("#login-form", { timeout: 8000 });
    await f.fill("#lg-login", LOGINS.u_admin); await f.fill("#lg-pass", "demo1234"); await f.click("#lg-submit");
    await f.waitForSelector("#nav .nav-item", { timeout: 8000 }).catch(() => {});
    check("3.1 Logowanie działa także w ramce bez dostępu do pamięci przeglądarki", (await f.$$("#nav .nav-item")).length > 10 && !!(await f.$("#kpis")));
    await ctx.close();
  }
  await browser.close();

  /* ------------- intro i muzyka ------------- */
  {
    const b1 = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
    const p = await b1.newPage(); watch(p, "intro");
    await p.goto(FILE); await p.waitForTimeout(700);
    check("Intro: muzyka domyślnie włączona i gra", await p.evaluate(() => RIW_DEBUG.intro.music && RIW_DEBUG.intro.audible));
    await p.click(".splash [data-music]");
    check("Intro: „Wycisz” działa", await p.evaluate(() => !RIW_DEBUG.intro.audible && localStorage.getItem("riw.music") === "0"));
    await p.click(".splash [data-skip]"); await p.waitForSelector(".splash", { state: "detached" });
    check("Intro: „Pomiń intro”", (await p.evaluate(() => RIW_DEBUG.intro.result)) === "skip");
    await b1.close();
    const b2 = await chromium.launch({ args: ["--autoplay-policy=document-user-activation-required"] });
    const q = await b2.newPage(); watch(q, "intro-blocked");
    await q.goto(FILE); await q.waitForTimeout(800);
    check("Intro (blokada autoplay): komunikat, aplikacja działa pod spodem", await q.evaluate(() => RIW_DEBUG.intro.blocked) && !!(await q.$("#login-form, #nav .nav-item")));
    await q.mouse.click(400, 400); await q.waitForTimeout(500);
    check("Intro (blokada autoplay): pierwsze kliknięcie włącza muzykę", await q.evaluate(() => RIW_DEBUG.intro.audible));
    await b2.close();
  }

  check("Konsola przeglądarki bez wyjątków", consoleErrors.length === 0, consoleErrors);
  const bad = results.filter(r => !r.ok).length;
  console.log(`\nWYNIK: ${results.length - bad}/${results.length} OK`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
