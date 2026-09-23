/* Testy E2E demonstratora (Playwright + Chromium).
   Uruchomienie z katalogu resinvest-erp:
     NODE_PATH=$(npm root -g) node tests/e2e.cjs
   Zmienne: SHOTS=<katalog> — zapis zrzutów ekranu. */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

const FILE = "file://" + path.resolve(__dirname, "..", "ResInvest_ERP_demo.html");
const SHOTS = process.env.SHOTS || "";
const results = [];
const consoleErrors = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const nb = s => String(s || "").replace(/[\u00A0\u202F]/g, " ").trim();

function watch(page, label) {
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(`${label}: ${m.text()}`); });
  page.on("pageerror", e => consoleErrors.push(`${label}: ${e.message}`));
}
async function boot(page) {
  await page.goto(FILE);
  await page.waitForSelector(".splash", { timeout: 5000 }).catch(() => {});
  await page.keyboard.press("Escape");
  await page.waitForSelector(".splash", { state: "detached", timeout: 5000 });
  await page.waitForSelector("#nav .nav-item");
}
const go = (page, route) => page.evaluate(r => { location.hash = "#/" + r; }, route).then(() => page.waitForTimeout(150));
const bal = (page, pid, wh = "wh_zab") => page.evaluate(([p, w]) => RIW_DEBUG.R.Stock.balance(RIW_DEBUG.store.state, w, p), [pid, wh]);
const out = async (page, key) => nb(await page.textContent(`[data-out="${key}"]`));
const check_ = async (page, id) => page.click(`label.opt:has(#${id})`);

async function purchase(page, { qty = "20", unit = "m3", price = "230", product = "pr_drewno" } = {}) {
  await go(page, "nowa");
  await page.selectOption("#f-purchase-supplierId", "pa_lander");
  await page.selectOption("#f-purchase-basis", "KZR");
  await page.selectOption("#f-purchase-productId", product);
  await page.selectOption("#f-purchase-unit", unit);
  await page.fill("#f-purchase-qty", qty);
  await page.fill("#f-purchase-price", price);
}
async function production(page) {
  await check_(page, "f-production-enabled");
  await page.selectOption("#f-production-type", "lesna");
  await page.fill("#f-production-ndl", "Rudy Raciborskie");
  await page.fill("#f-production-lesnictwo", "Stanica");
  await page.fill("#f-production-kwit", "KW 0300/09/2026");
}
async function save(page) {
  const n0 = await page.evaluate(() => RIW_DEBUG.store.state.operations.length);
  await page.click("#summary [data-save]");
  await page.waitForFunction(n => RIW_DEBUG.store.state.operations.length > n, n0, { timeout: 4000 }).catch(() => {});
  const saved = await page.$("#saved-docs");
  const docs = saved ? await page.$$eval("#saved-docs tbody tr td:first-child", t => t.map(x => x.textContent)) : [];
  if (saved) await page.click(".scrim [data-close]:last-child");
  return docs;
}

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

  /* ------------------------- Scenariusz A ------------------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); watch(page, "A");
    await boot(page);
    const w0 = await bal(page, "pr_drewno");
    await purchase(page);
    check("A: koszt całkowity 4 600,00 zł", (await out(page, "purchase.cost")) === "4 600,00 zł", await out(page, "purchase.cost"));
    check("A: waga automatyczna 26,4 t", (await out(page, "purchase.weightAuto")) === "26,4 t", await out(page, "purchase.weightAuto"));
    check("A: 20 m³ = 80 MP", nb(await page.textContent('[data-calc="purchase.qty"]')).includes("80 MP"));
    const formText = await page.textContent("#opf");
    const old = ["Magazyn źródłowy", "Magazyn docelowy", "Pryzma źródłowa", "Pryzma docelowa", "Pryzma"].filter(x => formText.includes(x));
    check("Stare pola magazyn/pryzma źródłowa/docelowa nie występują w formularzu", old.length === 0, old);
    check("Brak kontrolek whId / whToId / pileId w formularzu", (await page.$$('[data-bind*="whId"],[data-bind*="whToId"],[data-bind*="pile"]')).length === 0);
    check("Formularz ma pole „Miejsce transportu / dostawy” z aktywnym magazynem", (await page.inputValue("#f-transport-place")) === "RiC Zabrze");
    check("Samouczek pod polami (Co / Przykład)", (await page.$$(".help.tut")).length >= 12 && nb(await page.textContent('[data-field="purchase.qty"] .help')).includes("Przykład"));
    const docs = await save(page);
    check("A: zapis tworzy dokument PZ", docs.length === 1 && docs[0].startsWith("PZ/"), docs);
    check("A: stan drewna +80 MP (+20 m³)", Math.abs((await bal(page, "pr_drewno")) - w0 - 80) < 1e-6);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "e2e_A_saved.png") });

    /* ------------------------- Scenariusz B ------------------------- */
    const wB = await bal(page, "pr_drewno"), cB = await bal(page, "pr_zr_lesna");
    await purchase(page);
    await production(page);
    const flow = await page.$$eval("#flow li .d", l => l.map(x => x.textContent));
    check("B: przebieg PZ → RW → PW", JSON.stringify(flow) === JSON.stringify(["PZ", "RW", "PW"]), flow);
    await page.fill("#f-production-consumeQty", "500"); await page.press("#f-production-consumeQty", "Tab");
    check("B: zużycie ponad stan + zakup zablokowane", nb(await page.textContent('[data-msg="production.consumeQty"]')).includes("przekracza"));
    await page.fill("#f-production-consumeQty", ""); await page.press("#f-production-consumeQty", "Tab");
    const docsB = await save(page);
    check("B: dokumenty PZ, RW, PW", docsB.map(d => d.slice(0, 2)).join(",") === "PZ,RW,PW", docsB);
    check("B: drewno nie jest liczone podwójnie (stan bez zmian)", Math.abs((await bal(page, "pr_drewno")) - wB) < 1e-6);
    check("B: zrębka +80 MP", Math.abs((await bal(page, "pr_zr_lesna")) - cB - 80) < 1e-6);

    /* ---------------------- Scenariusz C + D ---------------------- */
    const wC = await bal(page, "pr_drewno"), cC = await bal(page, "pr_zr_lesna");
    await purchase(page);
    await production(page);
    await check_(page, "f-sale-enabled");
    await page.selectOption("#f-sale-buyerId", "pa_ec_zab");
    await page.fill("#f-sale-price", "90");
    check("C: miejsce transportu podpowiada odbiorcę", (await page.inputValue("#f-transport-place")) === "Elektrociepłownia Zabrze S.A.");
    await page.fill("#f-sale-qtyMP", "80,01"); await page.press("#f-sale-qtyMP", "Tab");
    check("C: sprzedaż większa niż produkcja zablokowana", nb(await page.textContent('[data-msg="sale.qtyMP"]')).includes("przekracza wynik produkcji"));
    await page.fill("#f-sale-qtyMP", "80"); await page.press("#f-sale-qtyMP", "Tab");
    check("C: przychód 7 200,00 zł", (await out(page, "sale.revenue")) === "7 200,00 zł", await out(page, "sale.revenue"));
    // D: transport własny
    await check_(page, "f-mode-own");
    await page.selectOption("#f-transport-own-vehicleId", "ve_scania");
    check("D: rejestracja z floty", (await out(page, "transport.own.reg")) === "SGL 4T821");
    check("D: kierowca domyślny z pojazdu", (await out(page, "transport.own.defaultDriver")) === "Jan Kowalski" && (await page.inputValue("#f-transport-own-driverId")) === "dr_kowalski");
    await page.fill("#f-transport-own-km", "262");
    await page.fill("#f-transport-own-rate", "5");
    check("D: 262 km × 5 zł = 1 310,00 zł", (await out(page, "transport.cost")) === "1 310,00 zł", await out(page, "transport.cost"));
    await page.selectOption("#f-transport-own-driverId", "dr_wojcik");
    check("D: zmiana kierowcy tylko dla kursu (komunikat)", nb(await page.textContent('[data-calc="transport.cost"]')).includes("tylko dla tego kursu"));
    const flowC = await page.$$eval("#flow li .d", l => l.map(x => x.textContent));
    check("C: przebieg PZ → RW → PW → WZ + TR", flowC.join(",") === "PZ,RW,PW,WZ,TR", flowC);
    check("C: transport w przebiegu = 0 MP", nb(await page.textContent("#flow li:last-child .q")) === "0 MP");
    const planHead = await page.$$eval("#plan-docs th", t => t.map(x => x.textContent));
    check("Plan dokumentów w formularzu ma kolumnę „Miejsce transportu”", planHead.includes("Miejsce transportu") && !planHead.join().includes("docelowy"), planHead);
    const docsC = await save(page);
    check("C: dokumenty PZ, RW, PW, WZ, TR", docsC.map(d => d.slice(0, 2)).join(",") === "PZ,RW,PW,WZ,TR", docsC);
    check("C: stan drewna i zrębki bez zmian po zakupie→produkcji→sprzedaży", Math.abs((await bal(page, "pr_drewno")) - wC) < 1e-6 && Math.abs((await bal(page, "pr_zr_lesna")) - cC) < 1e-6);
    const lastOp = await page.evaluate(() => RIW_DEBUG.store.state.operations.at(-1));
    check("C: przychód zapisany w operacji", lastOp.totals.revenue === 7200);
    check("D: kurs zachował kierowcę kursu", lastOp.transport.driverName === "Tomasz Wójcik" && lastOp.transport.driverOverridden === true);
    check("D: kartoteka pojazdu bez zmian", await page.evaluate(() => RIW_DEBUG.store.state.fleet.vehicles.find(v => v.id === "ve_scania").driverId === "dr_kowalski"));

    /* ------------------------- Scenariusz E ------------------------- */
    const wE = await bal(page, "pr_drewno");
    await purchase(page);
    await check_(page, "f-mode-external");
    await page.fill("#f-transport-external-company", "ESI Logistics");
    await page.fill("#f-transport-external-reg", "ESI 18734");
    await page.fill("#f-transport-external-km", "262");
    await page.fill("#f-transport-external-freight", "1 250");
    check("E: fracht 1 250,00 zł", (await out(page, "transport.cost")) === "1 250,00 zł", await out(page, "transport.cost"));
    await check_(page, "f-transport-external-includedInPrice");
    check("E: wliczony w cenę → 0,00 zł", (await out(page, "transport.cost")) === "0,00 zł", await out(page, "transport.cost"));
    check("E: koszt transportu w podsumowaniu 0,00 zł", nb(await page.textContent('[data-sum="transport"]')) === "0,00 zł");
    await save(page);
    check("Transport nie zmienia stanu: przyrost = tylko zakup (80 MP)", Math.abs((await bal(page, "pr_drewno")) - wE - 80) < 1e-6);

    /* ------------------------- Pociąg ------------------------- */
    await purchase(page);
    await check_(page, "f-mode-train");
    await page.fill("#f-transport-train-wagonCount", "2");
    await page.fill("#f-transport-train-sameT", "16,5");
    await page.fill("#f-transport-train-price", "28");
    check("Pociąg: 2 × 16,5 t × 28 zł/t = 924,00 zł", (await out(page, "transport.cost")) === "924,00 zł", await out(page, "transport.cost"));
    await check_(page, "f-transport-train-sameForAll");
    await page.fill("#f-transport-train-wagonT-0", "16");
    await page.fill("#f-transport-train-wagonT-1", "17,5");
    await page.selectOption("#f-transport-train-priceUnit", "MP");
    await page.fill("#f-transport-train-price", "2");
    check("Pociąg: tonaż ręczny 33,5 t → 101,515 MP × 2 zł", (await out(page, "transport.cost")) === "203,03 zł", await out(page, "transport.cost"));

    /* ------------------------- Scenariusz F ------------------------- */
    const variants = { "12,50": "25,00 zł", "12.50": "25,00 zł", "1 250,50": "2 501,00 zł", "1\u00A0250,50": "2 501,00 zł", "1.250,50": "2 501,00 zł" };
    await purchase(page, { qty: "1", unit: "MP", price: "2", product: "pr_zr_tow" });
    for (const [v, exp] of Object.entries(variants)) {
      await page.fill("#f-purchase-qty", "");
      await page.focus("#f-purchase-qty");
      await page.keyboard.insertText(v);           // jak wklejenie ze schowka
      const got = await out(page, "purchase.cost");
      check(`F: „${v.replace("\u00A0", "\\u00A0")}” → ${exp}`, got === exp, got);
    }
    await page.fill("#f-purchase-qty", "12,5x"); await page.press("#f-purchase-qty", "Tab");
    check("F: błędny format pokazuje komunikat zamiast liczyć 0", nb(await page.textContent('[data-msg="purchase.qty"]')).length > 0);
    await page.fill("#f-purchase-qty", "1.250,50"); await page.press("#f-purchase-qty", "Tab");
    check("F: po opuszczeniu pola wartość znormalizowana do 1 250,5", nb(await page.inputValue("#f-purchase-qty")) === "1 250,5");

    /* --------------------- Podwójne kliknięcie --------------------- */
    await purchase(page, { qty: "5", unit: "m3", price: "200" });
    const n0 = await page.evaluate(() => RIW_DEBUG.store.state.operations.length);
    await page.dblclick("#summary [data-save]");
    await page.waitForTimeout(600);
    const n1 = await page.evaluate(() => RIW_DEBUG.store.state.operations.length);
    check("Podwójne kliknięcie „Zapisz” tworzy jedną operację", n1 === n0 + 1, { n0, n1 });
    await page.keyboard.press("Escape");

    /* ------------------------- Plan dokumentów ------------------------- */
    await go(page, "dokumenty");
    const head = await page.$$eval("#docs-table thead th", t => t.map(x => x.textContent));
    check("Plan dokumentów: kolumna „Miejsce transportu”, brak „Magazyn docelowy”", head.includes("Miejsce transportu") && !(await page.textContent("#page")).includes("Magazyn docelowy"), head);
    const trStock = await page.$$eval("#docs-table tbody tr", rows => rows.filter(r => r.children[1].textContent === "TR").map(r => r.children[8].textContent.trim()));
    check("Plan dokumentów: TR ma wpływ na stan „brak”", trStock.length > 0 && trStock.every(x => x === "brak"), trStock);

    /* --------------------------- Korekta --------------------------- */
    const opCount = await page.$$eval("[data-storno]", b => b.length);
    const wS = await bal(page, "pr_drewno");
    await page.click("[data-storno] >> nth=0");
    await page.fill("#cf-in", "Błędna ilość");
    await page.click(".scrim [data-yes]");
    await page.waitForTimeout(300);
    check("Korekta (storno) tworzy dokument KO i odwraca stan", (await page.$$eval("[data-storno]", b => b.length)) === opCount - 1 && (await page.textContent("#docs-table")).includes("KO/"));
    check("Korekta: stan drewna po storno ≥ 0", (await bal(page, "pr_drewno")) >= 0 && (await bal(page, "pr_drewno")) !== wS);

    /* ---------------------- Moduły: Stany / Flota / Historia ---------------------- */
    await go(page, "stany");
    check("Stany: tabela aktywnego magazynu", !!(await page.$('[data-stock="wh_zab"]')));
    await go(page, "flota");
    check("Flota: pojazdy z rejestracją i kierowcą", (await page.textContent("#fleet-table")).includes("SGL 4T821") && (await page.textContent("#fleet-table")).includes("Jan Kowalski"));
    check("Flota: kurs z kierowcą zmienionym dla kursu", (await page.textContent("#runs-table")).includes("zmieniony dla kursu"));
    await page.click('[data-tab="chippers"]');
    check("Flota: rębaki z operatorem", (await page.textContent("#fleet-table")).includes("Krzysztof Lis"));
    await go(page, "historia");
    const auditHead = await page.$$eval("#audit-table th", t => t.map(x => x.textContent));
    check("Historia: kolumny użytkownik/czas/obiekt/akcja/źródło/stan przed-po", ["Czas", "Użytkownik", "Obiekt", "Akcja", "Źródło", "Stan przed / po"].every(h => auditHead.includes(h)), auditHead);
    await page.selectOption("#h-period", "2026-08");
    const inAug = await page.$$eval("#audit-table tbody tr td:first-child", t => t.every(x => x.textContent.startsWith("2026-08")));
    check("Historia: filtr miesiąca", inAug);
    await page.click('[data-htab="report"]');
    await page.selectOption("#h-period", "2026");
    check("Historia: raport roczny z podziałem na miesiące", (await page.textContent("#page")).includes("Rok 2026 — miesiące"));

    /* ------------------------- Scenariusz G ------------------------- */
    await go(page, "inwentaryzacja");
    await page.fill("#inv-ym", "2026-08");
    await page.click("#inv-open");
    await page.waitForSelector("#inv-gen");
    await page.click("#inv-gen");
    await page.waitForSelector("[data-count]");
    const lines = await page.$$eval("[data-count]", l => l.map(x => x.dataset.count));
    for (const pid of lines) {
      const book = await page.$eval(`tr[data-line="${pid}"] td:nth-child(3)`, x => x.textContent);
      await page.fill(`[data-count="${pid}"]`, pid === "pr_drewno" ? "58,5" : book.replace(/\u00A0/g, " "));
      await page.press(`[data-count="${pid}"]`, "Enter");
      await page.waitForTimeout(80);
    }
    check("G: różnica pokazana (drewno −1,5 m³)", nb(await page.textContent('[data-diff="pr_drewno"]')) === "-1,5", nb(await page.textContent('[data-diff="pr_drewno"]')));
    await page.click("#inv-close");
    await page.click(".scrim [data-yes]");
    await page.waitForTimeout(300);
    check("G: status ZAMKNIĘTA", nb(await page.textContent("#inv-status")) === "ZAMKNIĘTA");
    check("G: po zamknięciu tylko odczyt (brak pól i przycisków)", (await page.$$("[data-count]")).length === 0 && !(await page.$("#inv-gen")) && !(await page.$("#inv-close")));
    check("G: różnice zaksięgowane dokumentem IN", (await page.textContent("#inv-detail")).includes("IN/001/08/2026"));
    await go(page, "nowa");
    await page.fill("#f-date", "2026-08-30").catch(() => {});
    await page.evaluate(() => { const el = document.getElementById("f-date"); el.value = "2026-08-30"; el.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.press("#f-purchase-qty", "Tab");
    check("G: operacja z datą w zamkniętym okresie zablokowana", nb(await page.textContent('[data-msg="date"]')).includes("zamknięty"));
    if (SHOTS) { await go(page, "inwentaryzacja"); await page.screenshot({ path: path.join(SHOTS, "e2e_G_closed.png") }); }

    /* ------------------------- Uprawnienia ------------------------- */
    await page.selectOption("#user-sel", "u_view");
    await go(page, "nowa");
    check("Rola Podgląd: brak formularza nowej operacji", !(await page.$("#opf")) && (await page.textContent("#page")).includes("nie pozwala"));
    await page.selectOption("#user-sel", "u_pys");
    check("Zmiana użytkownika zmienia magazyn aktywny", nb(await page.textContent("#wh-chip")).includes("RiC Pyskowice"));
    await ctx.close();
  }

  /* ------------------- Wyścig dwóch kart ------------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p1 = await ctx.newPage(); watch(p1, "karta1");
    await boot(p1);
    const p2 = await ctx.newPage(); watch(p2, "karta2");
    await boot(p2);
    for (const p of [p1, p2]) {
      await purchase(p, { qty: "1", unit: "m3", price: "200" });
      await production(p);
      await p.fill("#f-production-consumeQty", "61");
      await p.press("#f-production-consumeQty", "Tab");
    }
    check("Wyścig: oba formularze poprawne na starym stanie", (await p1.$$("#err-list li")).length === 0 && (await p2.$$("#err-list li")).length === 0);
    await p1.click("#summary [data-save]");
    await p1.waitForSelector("#saved-docs");
    await p2.click("#summary [data-save]");
    await p2.waitForTimeout(500);
    const ops = await p2.evaluate(() => JSON.parse(localStorage.getItem("riw.demo.state.v1")).operations.length);
    const toast = await p2.textContent("#toasts");
    // Druga karta dostaje zdarzenie „storage”, przelicza formularz na nowym stanie i odrzuca zapis
    // (gdyby zdarzenie nie dotarło, zapis i tak jest ponownie walidowany w transakcji — test jednostkowy „Wyścig”).
    check("Wyścig: druga karta odrzucona na aktualnym stanie", toast.includes("Nie zapisano") && toast.includes("przekracza dostępny materiał"), toast);
    check("Wyścig: zapisano dokładnie jedną operację", ops === 6, ops);
    check("Wyścig: stan drewna nie jest ujemny", (await bal(p2, "pr_drewno")) >= 0);
    await ctx.close();
  }

  /* ------------------- Widok mobilny ------------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); watch(page, "mobile");
    await boot(page);
    for (const r of ["pulpit", "nowa", "dokumenty", "inwentaryzacja", "flota", "historia"]) {
      await go(page, r);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`Mobile 390px: ${r} bez przewijania w poziomie`, over <= 1, over);
    }
    await go(page, "nowa");
    check("Mobile: pasek zapisu widoczny", await page.isVisible(".save-bar [data-save]"));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "e2e_mobile_nowa.png") });
    await page.click("#menu-btn");
    check("Mobile: menu boczne otwiera się", await page.evaluate(() => document.body.classList.contains("nav-open")));
    await ctx.close();
  }
  await browser.close();

  /* ------------------- Intro i muzyka ------------------- */
  {
    // 1. autoplay dozwolony
    const b1 = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
    const p = await b1.newPage(); watch(p, "intro-ok");
    await p.goto(FILE);
    await p.waitForTimeout(700);
    const st = await p.evaluate(() => RIW_DEBUG.intro);
    check("Intro: muzyka domyślnie WŁĄCZONA i gra od startu", st.music === true && st.audible === true && st.blocked === false, st);
    check("Intro: przyciski „Wycisz” i „Pomiń intro”", nb(await p.textContent(".splash [data-music]")) === "Wycisz" && nb(await p.textContent(".splash [data-skip]")).startsWith("Pomiń intro"));
    await p.click(".splash [data-music]");
    check("Intro: „Wycisz” wycisza i zapamiętuje wybór", (await p.evaluate(() => RIW_DEBUG.intro.audible === false && localStorage.getItem("riw.demo.music") === "0")) && nb(await p.textContent(".splash [data-music]")) === "Włącz muzykę");
    await p.click(".splash [data-skip]");
    await p.waitForSelector(".splash", { state: "detached" });
    check("Intro: „Pomiń intro” zamyka ekran", (await p.evaluate(() => RIW_DEBUG.intro.result)) === "skip");
    await p.reload();
    await p.waitForTimeout(500);
    check("Intro: po wyciszeniu kolejny start bez dźwięku", await p.evaluate(() => RIW_DEBUG.intro.music === false && RIW_DEBUG.intro.audible === false));
    await b1.close();

    // 2. autoplay zablokowany (polityka jak w domyślnej przeglądarce bez interakcji)
    const b2 = await chromium.launch({ args: ["--autoplay-policy=document-user-activation-required"] });
    const q = await b2.newPage(); watch(q, "intro-blocked");
    await q.goto(FILE);
    await q.waitForTimeout(800);
    const s2 = await q.evaluate(() => RIW_DEBUG.intro);
    check("Intro (blokada autoplay): brak błędu, stan „zablokowane”, komunikat", s2.blocked === true && s2.audible === false && await q.isVisible(".splash [data-note]"), s2);
    check("Intro (blokada autoplay): aplikacja zbudowana pod spodem", !!(await q.$("#nav .nav-item")));
    await q.mouse.click(400, 400);
    await q.waitForTimeout(500);
    check("Intro (blokada autoplay): pierwsze kliknięcie włącza muzykę", await q.evaluate(() => RIW_DEBUG.intro.audible === true && RIW_DEBUG.intro.blocked === false));
    check("Intro: kliknięcie w tło nie pomija intro", !!(await q.$(".splash")));
    await b2.close();

    // 3. ścieżka filmu (H.264/AAC jak w Chrome/Edge) — przeglądarka testowa nie ma kodeka,
    //    więc symulujemy politykę autoplay na poziomie HTMLMediaElement.
    const b3 = await chromium.launch();
    const c3 = await b3.newContext();
    await c3.addInitScript(() => {
      HTMLMediaElement.prototype.canPlayType = () => "probably";
      Object.defineProperty(HTMLMediaElement.prototype, "src", { configurable: true, get() { return this._s || ""; }, set(v) { this._s = v; } });
      HTMLMediaElement.prototype.load = function () {};
      HTMLMediaElement.prototype.play = function () {
        if (!this.muted && !window.__gesture) return Promise.reject(new DOMException("blocked", "NotAllowedError"));
        return Promise.resolve();
      };
      document.addEventListener("pointerdown", () => { window.__gesture = true; }, true);
    });
    const v = await c3.newPage(); watch(v, "intro-video");
    await v.goto(FILE);
    await v.waitForTimeout(400);
    const s3 = await v.evaluate(() => ({ st: RIW_DEBUG.intro, muted: document.querySelector(".splash video").muted }));
    check("Intro (film): blokada → film gra wyciszony, bez wyjątku", s3.st.source === "video" && s3.st.blocked === true && s3.muted === true, s3);
    await v.mouse.click(300, 300);
    await v.waitForTimeout(300);
    const s4 = await v.evaluate(() => ({ st: RIW_DEBUG.intro, muted: document.querySelector(".splash video").muted }));
    check("Intro (film): pierwszy gest włącza dźwięk filmu", s4.st.audible === true && s4.muted === false, s4);
    await b3.close();
  }

  const failed = results.filter(r => !r.ok);
  check("Konsola przeglądarki bez wyjątków", consoleErrors.length === 0, consoleErrors);
  const total = results.length, bad = results.filter(r => !r.ok).length;
  console.log(`\nWYNIK: ${total - bad}/${total} OK`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
