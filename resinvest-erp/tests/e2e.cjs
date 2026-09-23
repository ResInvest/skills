/* Testy E2E Demo v2.1 (Playwright + Chromium).
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

const FILE = "file://" + path.resolve(__dirname, "..", "ResInvest_ERP_demo.html");
const SHOTS = process.env.SHOTS || "";
const TODAY = "2026-09-23";
const results = [], consoleErrors = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond }); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const nb = s => String(s || "").replace(/[\u00A0\u202F]/g, " ").replace(/\s+/g, " ").trim();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "riw-e2e-"));

function watch(page, label) {
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(`${label}: ${m.text()}`); });
  page.on("pageerror", e => consoleErrors.push(`${label}: ${e.message}`));
}
async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }, opts));
  await ctx.addInitScript(d => { try { if (!sessionStorage.getItem("riw.demo.today")) sessionStorage.setItem("riw.demo.today", d); } catch (e) {} }, TODAY);
  return ctx;
}
async function boot(page) {
  await page.goto(FILE);
  await page.waitForSelector(".splash", { timeout: 5000 }).catch(() => {});
  await page.keyboard.press("Escape");
  await page.waitForSelector(".splash", { state: "detached", timeout: 5000 });
  await page.waitForSelector("#nav .nav-item");
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
const setUser = async (page, uid) => { await page.selectOption("#user-sel", uid); await page.waitForTimeout(150); };
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
    check("§14 Pulpit: stany graficznie wg produktu (paski + linia 30 dni)", (await page.$$("#dash-stock .stock-row .hbar-fill")).length >= 5 && (await page.$$("#dash-stock svg.spark")).length >= 5);
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

    /* ------------- §31.16 B: brak surowca (Pyskowice 30 m³) ------------- */
    await setUser(page, "u_pys");
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
    await page.selectOption("#f-mm-toWhId", "wh_pys"); await page.waitForTimeout(100);
    await page.selectOption("#f-mm-productId", "pr_zr_lesna"); await page.waitForTimeout(100);
    await fillTab(page, "#f-mm-qty", "300");
    check("MM: źródło 8 293 → 7 993 MP, cel 220 → 520 MP", (await out(page, "mm.srcBal")) === "8 293 MP → 7 993 MP" && (await out(page, "mm.dstBal")) === "220 MP → 520 MP", [await out(page, "mm.srcBal"), await out(page, "mm.dstBal")]);
    check("MM: zatwierdzenie", (await approve(page)) === 1);
    const mmOp = await lastOp(page);
    check("MM: stany po przesunięciu, stan firmy bez zmian", (await bal(page, "pr_zr_lesna")) === 7993 && (await bal(page, "pr_zr_lesna", "wh_pys")) === 520 && mmOp.no.startsWith("MM/"));

    /* ------------- wersja robocza ------------- */
    await preset(page, "zakup");
    await page.selectOption("#f-purchase-supplierId", "pa_lander"); await fillTab(page, "#f-purchase-qty", "12");
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
    const dep = await page.evaluate(() => {
      const R = RIW_DEBUG.R, S = RIW_DEBUG.store;
      return S.transact(s => {
        const c = { user: R.byId(s.users, "u_pys"), today: "2026-09-23", source: "test" };
        const d1 = R.Seed.draftOf("2026-09-23", { purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "100", unit: "m3", price: "230" }, transport: { mode: "none", place: "RiC Pyskowice" } });
        const a = R.commitOperation(s, d1, c);
        const b = R.commitOperation(s, R.Seed.draftOf("2026-09-23", { type: "PRODUKCJA", production: { rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "480" } }), c);
        return { ok: a.ok && b.ok, buy: a.op.id, use: b.op.id };
      });
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
    await page.selectOption("#k-wh", "wh_pys"); await page.waitForTimeout(150);
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
    for (const [r, sel] of [["przyjecia", "#docs-table"], ["wz", "#docs-table"], ["mm", "#docs-table"], ["produkcja", "#prod-table"], ["transport", "#tr-table"], ["produkty", "#products-table"], ["kontrahenci", "#partners-table"], ["magazyny", "[data-wh]"], ["administracja", "#perm-table"]]) {
      await go(page, r);
      check(`Moduł „${r}” działa`, !!(await page.$(sel)));
    }
    check("Administracja: uprawnienia documents.cancel / documents.correct w macierzy", nb(await page.textContent("#perm-table")).includes("documents.cancel") && nb(await page.textContent("#perm-table")).includes("production.correct"));
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
    for (const r of ["pulpit", "operacje", "nowa?preset=produkcja", "nowa?preset=bezposrednia", "nowa?preset=mm", "stany", "historia", "raporty", "kwit", "dokumenty", "administracja"]) {
      await go(page, r);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`Telefon 390 px: ${r} bez przewijania w poziomie`, over <= 1, over);
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "e2e_mobile.png"), fullPage: false });
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
    check("Intro: „Wycisz” działa", await p.evaluate(() => !RIW_DEBUG.intro.audible && localStorage.getItem("riw.demo.music") === "0"));
    await p.click(".splash [data-skip]"); await p.waitForSelector(".splash", { state: "detached" });
    check("Intro: „Pomiń intro”", (await p.evaluate(() => RIW_DEBUG.intro.result)) === "skip");
    await b1.close();
    const b2 = await chromium.launch({ args: ["--autoplay-policy=document-user-activation-required"] });
    const q = await b2.newPage(); watch(q, "intro-blocked");
    await q.goto(FILE); await q.waitForTimeout(800);
    check("Intro (blokada autoplay): komunikat, aplikacja działa pod spodem", await q.evaluate(() => RIW_DEBUG.intro.blocked) && !!(await q.$("#nav .nav-item")));
    await q.mouse.click(400, 400); await q.waitForTimeout(500);
    check("Intro (blokada autoplay): pierwsze kliknięcie włącza muzykę", await q.evaluate(() => RIW_DEBUG.intro.audible));
    await b2.close();
  }

  check("Konsola przeglądarki bez wyjątków", consoleErrors.length === 0, consoleErrors);
  const bad = results.filter(r => !r.ok).length;
  console.log(`\nWYNIK: ${results.length - bad}/${results.length} OK`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
