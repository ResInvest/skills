/* Testy E2E Demo v2 (Playwright + Chromium).
   Uruchomienie z katalogu resinvest-erp:
     NODE_PATH=$(npm root -g) node tests/e2e.cjs
   Zmienne: SHOTS=<katalog> — zapis zrzutów ekranu. */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

const FILE = "file://" + path.resolve(__dirname, "..", "ResInvest_ERP_demo.html");
const SHOTS = process.env.SHOTS || "";
const results = [], consoleErrors = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond }); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
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
const preset = async (page, p) => { await go(page, "pulpit"); await go(page, "nowa?preset=" + p); await page.waitForSelector("#opf"); };
const bal = (page, pid, wh = "wh_zab") => page.evaluate(([p, w]) => RIW_DEBUG.R.Stock.balance(RIW_DEBUG.store.state, w, p), [pid, wh]);
const out = async (page, key) => nb(await page.textContent(`[data-out="${key}"]`));
const tick = (page, id) => page.click(`label.opt:has(#${id})`);
const fillTab = async (page, sel, v) => { await page.fill(sel, v); await page.press(sel, "Tab"); };
const flow = page => page.$$eval("#flow li .d", l => l.map(x => x.textContent).join(","));
async function save(page) {
  const n0 = await page.evaluate(() => RIW_DEBUG.store.state.operations.length);
  await page.click("#summary [data-save]");
  await page.waitForFunction(n => RIW_DEBUG.store.state.operations.length > n, n0, { timeout: 4000 }).catch(() => {});
  const saved = await page.$("#saved-docs");
  const docs = saved ? await page.$$eval("#saved-docs tbody tr td:first-child", t => t.map(x => x.textContent.slice(0, 2))) : [];
  if (saved) await page.click(".scrim [data-close]:last-child");
  return docs.join(",");
}
async function forestProduction(page, outMP = "600") {
  await page.selectOption("#f-production-type", "lesna");
  await page.fill("#f-production-ndl", "Rudy Raciborskie");
  await page.fill("#f-production-lesnictwo", "Kuźnia");
  await page.fill("#f-production-kwit", "KW 0400/09/2026");
  if (outMP !== null) await page.fill("#f-production-outMP", outMP);
}

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); watch(page, "desktop");
    await boot(page);

    /* ------------- 11. jasny motyw ------------- */
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const card = await page.evaluate(() => getComputedStyle(document.querySelector(".card, .kpi")).backgroundColor);
    const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
    check("16. Jasny motyw: jasne tło i białe karty", lum(bg) > 0.85 && card === "rgb(255, 255, 255)", { bg, card });
    const txt = await page.evaluate(() => getComputedStyle(document.querySelector(".page-head h2")).color);
    check("16. Jasny motyw: ciemny (grafitowy) tekst nagłówków", lum(txt) < 0.2, txt);

    /* ------------- stany wg jednostek ------------- */
    await go(page, "stany");
    const cell = async id => nb(await page.textContent(`[data-stock="wh_zab"] [data-native="${id}"]`));
    const mass = async id => nb(await page.textContent(`[data-stock="wh_zab"] [data-mass="${id}"]`));
    check("8. Zrębka w MP: 8 293 MP ≈ 2 737 t", (await cell("pr_zr_lesna")) === "8 293 MP" && (await mass("pr_zr_lesna")) === "≈ 2 737 t", [await cell("pr_zr_lesna"), await mass("pr_zr_lesna")]);
    check("7. Drewno w m³: 817 m³ ≈ 778 t", (await cell("pr_drewno")) === "817 m³" && (await mass("pr_drewno")) === "≈ 778 t", [await cell("pr_drewno"), await mass("pr_drewno")]);
    check("9. PKS i łupina wyłącznie w t, bez masy orientacyjnej", (await cell("pr_pks")) === "728 t" && (await cell("pr_lupina")) === "728 t" && (await mass("pr_pks")) === "—");

    /* ------------- 1–2. sprzedaż z magazynu (WZ) ------------- */
    await preset(page, "wz");
    check("1. WZ: brak sekcji zakupu i produkcji w formularzu", !(await page.$("#f-purchase-productId")) && !(await page.$("#f-production-outMP")));
    await page.selectOption("#f-sale-productId", "pr_zr_lesna");
    check("1. WZ: jednostka zgodna z towarem (MP / t)", JSON.stringify(await page.$$eval("#f-sale-unit option", o => o.map(x => x.value))) === '["MP","t"]');
    await page.fill("#f-sale-qty", "8293,01"); await page.press("#f-sale-qty", "Tab");
    check("2. WZ ponad stan zablokowane", nb(await page.textContent('[data-msg="sale.qty"]')).includes("Na magazynie jest 8 293 MP"));
    await fillTab(page, "#f-sale-qty", "500");
    await page.fill("#f-sale-price", "90");
    await page.selectOption("#f-sale-buyerId", "pa_ec_zab");
    check("1. WZ: stan na magazynie 8 293 MP → stan po WZ 7 793 MP", (await out(page, "sale.onStock")) === "8 293 MP" && (await out(page, "sale.after")) === "7 793 MP");
    check("1. WZ: wartość 45 000,00 zł, miejsce dostawy = odbiorca", (await out(page, "sale.revenue")) === "45 000,00 zł" && (await page.inputValue("#f-transport-place")) === "Elektrociepłownia Zabrze S.A.");
    check("1. WZ: przebieg tylko WZ", (await flow(page)) === "WZ");
    check("1. WZ: zapis → dokument WZ", (await save(page)) === "WZ");
    check("2. WZ odjęte ze stanu: 7 793 MP", (await bal(page, "pr_zr_lesna")) === 7793);
    check("1. WZ w historii (audyt)", await page.evaluate(() => { const a = RIW_DEBUG.store.state.audit.at(-1); return a.action.includes("Sprzedaż") && a.before.stan.pr_zr_lesna === 8293 && a.after.stan.pr_zr_lesna === 7793; }));
    // PKS — tylko tony
    await preset(page, "wz");
    await page.selectOption("#f-sale-productId", "pr_pks");
    check("9. WZ PKS: jedyna jednostka t", JSON.stringify(await page.$$eval("#f-sale-unit option", o => o.map(x => x.value))) === '["t"]');
    await fillTab(page, "#f-sale-qty", "28");
    await page.fill("#f-sale-price", "600");
    await page.selectOption("#f-sale-buyerId", "pa_elektrownia");
    await save(page);
    check("9. PKS: 728 t − 28 t = 700 t", (await bal(page, "pr_pks")) === 700);

    /* ------------- 3–4. produkcja na magazynie ------------- */
    await preset(page, "produkcja");
    check("3. Produkcja: brak pól zakupu, surowiec ze stanu", !(await page.$("#f-purchase-supplierId")) && (await page.inputValue("#f-production-rawProductId")) === "pr_drewno");
    check("3. Produkcja: stan surowca 817 m³", (await out(page, "production.stock")) === "817 m³");
    await fillTab(page, "#f-production-consumeQty", "818");
    check("3. Produkcja: zużycie ponad stan zablokowane", nb(await page.textContent('[data-msg="production.consumeQty"]')).includes("Na magazynie jest 817 m³"));
    await fillTab(page, "#f-production-consumeQty", "817");
    check("3. Produkcja: 817 m³ → 3 268 MP (auto)", (await out(page, "production.outMass")).startsWith("3 268 MP"));
    check("13. Rąbanie domyślnie 10,00 zł/MP → 32 680,00 zł", (await page.inputValue("#f-production-chipRate")) === "10,00" && (await out(page, "production.chipCost")) === "32 680,00 zł", [await page.inputValue("#f-production-chipRate"), await out(page, "production.chipCost")]);
    check("3. Produkcja: przebieg RW → PW", (await flow(page)) === "RW,PW");
    const zr0 = await bal(page, "pr_zr_lesna");
    check("3. Produkcja: zapis RW + PW", (await save(page)) === "RW,PW");
    check("4. Drewno −817 m³ (0), zrębka +3 268 MP", (await bal(page, "pr_drewno")) === 0 && (await bal(page, "pr_zr_lesna")) === zr0 + 3268);
    check("3. Powiązanie PW ← RW zapisane", await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return o.documents[1].meta.fromDoc === o.documents[0].no; }));

    /* ------------- 5–6. produkcja + sprzedaż bezpośrednia ------------- */
    await preset(page, "bezposrednia");
    check("5. Bezpośrednia: checkbox „Sprzedaż bezpośrednia po produkcji / prosto z lasu” zaznaczony", await page.isChecked("#f-sale-direct"));
    check("5. Bezpośrednia: brak wymogu zakupu / pobrania z magazynu", !(await page.$("#f-purchase-productId")) && !(await page.$("#f-sale-productId")));
    await forestProduction(page, "600");
    await page.selectOption("#f-sale-buyerId", "pa_elektrownia");
    await page.fill("#f-sale-price", "88");
    await fillTab(page, "#f-sale-qtyMP", "600,5");
    check("5. Bezpośrednia: sprzedaż > produkcja zablokowana", nb(await page.textContent('[data-msg="sale.qtyMP"]')).includes("przekracza wynik produkcji"));
    await fillTab(page, "#f-sale-qtyMP", "");
    await fillTab(page, "#f-production-chipRate", "12,50");
    check("14. Zmiana ceny rąbania: 600 MP × 12,50 = 7 500,00 zł", (await out(page, "production.chipCost")) === "7 500,00 zł", await out(page, "production.chipCost"));
    check("5. Bezpośrednia: przychód 52 800,00 zł, koszt rąbania w podsumowaniu", (await out(page, "sale.revenue")) === "52 800,00 zł" && nb(await page.textContent('[data-sum="chipping"]')) === "7 500,00 zł");
    check("5. Bezpośrednia: przebieg PW → WZ", (await flow(page)) === "PW,WZ");
    check("6. Bezpośrednia: stan zrębki przed = po (podsumowanie)", await page.$$eval("#bal tbody tr td", t => t[1].textContent === t[2].textContent));
    const zr1 = await bal(page, "pr_zr_lesna"), dr1 = await bal(page, "pr_drewno");
    check("5. Bezpośrednia: zapis PW + WZ", (await save(page)) === "PW,WZ");
    check("6. Brak wzrostu stanu przy sprzedaży bezpośredniej", (await bal(page, "pr_zr_lesna")) === zr1 && (await bal(page, "pr_drewno")) === dr1);
    check("5. Zapisano ilość, odbiorcę, cenę, miejsce, historię", await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return o.direct && o.production.outMP === 600 && o.sale.qty === 600 && o.sale.price === 88 && o.place === "Elektrownia Łaziska" && RIW_DEBUG.store.state.audit.at(-1).opNo === o.no; }));

    /* ------------- 10–12. pociąg ------------- */
    await preset(page, "wz");
    await page.selectOption("#f-sale-productId", "pr_zr_lesna");
    await fillTab(page, "#f-sale-qty", "3636");
    await page.fill("#f-sale-price", "80");
    await page.selectOption("#f-sale-buyerId", "pa_ec_kat");
    await tick(page, "f-mode-train");
    await page.fill("#f-transport-train-trainNo", "RC 70001");
    await page.fill("#f-transport-train-carrier", "PKP Cargo");
    await page.fill("#f-transport-train-docNo", "CIM 7000/09");
    await page.fill("#f-transport-train-loadPlace", "Bocznica Zabrze");
    await fillTab(page, "#f-transport-train-wagonCount", "20");
    await page.fill("#f-transport-train-capacity", "60");
    check("10. Pociąg: domyślnie „Tonaż taki sam dla wszystkich”", await page.isChecked("#f-ton-same"));
    await fillTab(page, "#f-transport-train-sameT", "60");
    await fillTab(page, "#f-transport-train-price", "25");
    const sum = nb(await page.textContent("#train-summary"));
    check("10. Wspólny tonaż: 20 × 60 t = 1 200 t", nb(await page.textContent("[data-train-total]")).startsWith("1 200 t"), sum);
    check("12. Podsumowanie składu: wagony, pojemność, tonaż, załadunek, dostawa, przewoźnik, dokument, koszt",
      ["Liczba wagonów20", "Łączna pojemność (t)20 × 60 = 1 200 t", "Miejsce załadunkuBocznica Zabrze", "Miejsce dostawyEC Katowice — biomasa", "PrzewoźnikPKP Cargo", "Nr dokumentuCIM 7000/09", "30 000,00 zł"].every(x => sum.includes(x)), sum);
    await tick(page, "f-ton-each");
    const rows = await page.$$("#wagon-table tbody tr");
    check("11. Indywidualny tonaż: lista 20 wagonów", rows.length === 20, rows.length);
    const tons = ["58,4", "60,1", "59,7", "61,2", "59,8"];
    for (let i = 0; i < 20; i++) await page.fill(`#f-transport-train-wagonT-${i}`, tons[i % 5]);
    await page.press("#f-transport-train-wagonT-19", "Tab");
    check("11. Suma wagonów automatycznie: 1 196,8 t", nb(await page.textContent('[data-out="train.sumT"]')) === "1 196,8 t" && nb(await page.textContent("[data-train-total]")).startsWith("1 196,8 t"), nb(await page.textContent('[data-out="train.sumT"]')));
    check("12. Podsumowanie pokazuje tonaż każdego wagonu", nb(await page.textContent("#train-summary")).includes("1: 58,4 · 2: 60,1"));
    await page.fill("#f-transport-train-wagonT-3", ""); await page.press("#f-transport-train-wagonT-3", "Tab");
    check("11. Brak tonażu wagonu = błąd przy wagonie", nb(await page.textContent('[data-msg="transport.train.wagonT.3"]')).length > 0);
    await fillTab(page, "#f-transport-train-wagonT-3", "61,2");
    await page.selectOption("#f-transport-train-capUnit", "MP");
    check("12. Pojemność w MP: łączna pojemność MP", nb(await page.textContent("#train-summary")).includes("Łączna pojemność (MP)20 × 60 = 1 200 MP"));
    const zr2 = await bal(page, "pr_zr_lesna");
    check("Pociąg: zapis WZ + TR", (await save(page)) === "WZ,TR");
    check("Transport nie zmienia stanu: tylko −3 636 MP z WZ", (await bal(page, "pr_zr_lesna")) === zr2 - 3636);

    /* ------------- A/E: zakup + magazynowanie + późniejsza WZ ------------- */
    await preset(page, "zakup");
    await page.selectOption("#f-purchase-supplierId", "pa_drwal");
    await page.selectOption("#f-purchase-productId", "pr_zr_tow");
    await page.fill("#f-purchase-qty", "250");
    await fillTab(page, "#f-purchase-price", "55");
    check("A: zakup samodzielny — tylko PZ", (await flow(page)) === "PZ");
    await save(page);
    check("E: zrębka towar po zakupie 550 MP", (await bal(page, "pr_zr_tow")) === 550);
    await preset(page, "wz");
    await page.selectOption("#f-sale-productId", "pr_zr_tow");
    await fillTab(page, "#f-sale-qty", "550");
    await page.fill("#f-sale-price", "70");
    await page.selectOption("#f-sale-buyerId", "pa_ciep_ryb");
    await save(page);
    check("E: późniejsza WZ zeruje stan zrębki towar", (await bal(page, "pr_zr_tow")) === 0);
    // PKS zakup tylko w tonach
    await preset(page, "zakup");
    await page.selectOption("#f-purchase-productId", "pr_pks");
    check("9. Zakup PKS: jednostka wyłącznie t", JSON.stringify(await page.$$eval("#f-purchase-unit option", o => o.map(x => x.value))) === '["t"]' && !(await page.isEnabled("#f-production-enabled")));

    /* ------------- 15. przecinek dziesiętny ------------- */
    await preset(page, "wz");
    await page.selectOption("#f-sale-productId", "pr_zr_lesna");
    await page.fill("#f-sale-price", "2");
    for (const [v, exp] of [["12,50", "25,00 zł"], ["12.50", "25,00 zł"], ["1 250,50", "2 501,00 zł"], ["1\u00A0250,50", "2 501,00 zł"], ["1.250,50", "2 501,00 zł"]]) {
      await page.fill("#f-sale-qty", ""); await page.focus("#f-sale-qty"); await page.keyboard.insertText(v);
      check(`15. „${v.replace("\u00A0", "\\u00A0")}” → ${exp}`, (await out(page, "sale.revenue")) === exp, await out(page, "sale.revenue"));
    }
    await fillTab(page, "#f-sale-qty", "12,5x");
    check("15. Błędny format — komunikat, nie 0", nb(await page.textContent('[data-msg="sale.qty"]')).length > 0);

    /* ------------- podwójny zapis, plan dokumentów, stare pola ------------- */
    await fillTab(page, "#f-sale-qty", "10");
    await page.selectOption("#f-sale-buyerId", "pa_ec_zab");
    const n0 = await page.evaluate(() => RIW_DEBUG.store.state.operations.length);
    await page.dblclick("#summary [data-save]"); await page.waitForTimeout(600);
    check("Podwójne kliknięcie „Zapisz” = jedna operacja", (await page.evaluate(() => RIW_DEBUG.store.state.operations.length)) === n0 + 1);
    await page.keyboard.press("Escape");
    for (const p of ["zakup", "wz", "produkcja", "bezposrednia"]) {
      await preset(page, p);
      const t = await page.textContent("#opf");
      check(`Formularz „${p}”: brak pól magazyn/pryzma źródłowa/docelowa`, !["Magazyn źródłowy", "Magazyn docelowy", "Pryzma"].some(x => t.includes(x)));
    }
    await go(page, "dokumenty");
    const head = await page.$$eval("#docs-table thead th", t => t.map(x => x.textContent));
    check("Plan dokumentów: kolumna „Miejsce transportu”", head.includes("Miejsce transportu"));
    // korekta WZ przywraca stan
    const zr3 = await bal(page, "pr_zr_lesna");
    await page.fill("#d-q", "WZ/"); await page.waitForTimeout(400);
    await page.click("[data-storno] >> nth=0");
    await page.fill("#cf-in", "Test korekty"); await page.click(".scrim [data-yes]"); await page.waitForTimeout(300);
    check("Korekta ostatniej WZ przywraca 10 MP", (await bal(page, "pr_zr_lesna")) === zr3 + 10);

    /* ------------- historia / raporty z rąbaniem ------------- */
    await go(page, "historia");
    await page.click('[data-htab="ops"]');
    check("Rejestr operacji: kolumna „Rąbanie” i rodzaje operacji", (await page.$$eval("#ops-table th", t => t.map(x => x.textContent))).includes("Rąbanie") && (await page.textContent("#ops-table")).includes("produkcja na magazynie") && (await page.textContent("#ops-table")).includes("sprzedaż bezpośrednia"));
    await page.click('[data-htab="report"]');
    check("13. Raport kosztowy: koszt rąbania widoczny", nb(await page.textContent("#rep-chip")).length > 0 && !nb(await page.textContent("#rep-chip")).startsWith("0"));

    /* ------------- inwentaryzacja w jednostkach produktów ------------- */
    await go(page, "inwentaryzacja");
    await page.fill("#inv-ym", "2026-08"); await page.click("#inv-open");
    await page.waitForSelector("#inv-gen"); await page.click("#inv-gen"); await page.waitForSelector("[data-count]");
    const units = await page.$$eval("#inv-table tbody tr", r => r.map(x => x.children[0].textContent + "|" + x.children[1].textContent));
    check("Inwentaryzacja: jednostki produktów (m³ / MP / t)", units.includes("Drewno opałowe|m³") && units.includes("PKS (łupina palmowa)|t") && units.includes("Zrębka produkcyjna leśna|MP"), units);
    for (const pid of await page.$$eval("[data-count]", l => l.map(x => x.dataset.count))) {
      const book = await page.$eval(`tr[data-line="${pid}"] td:nth-child(3)`, x => x.textContent);
      await page.fill(`[data-count="${pid}"]`, pid === "pr_pks" ? "727,5" : book.replace(/\u00A0/g, " "));
      await page.press(`[data-count="${pid}"]`, "Enter"); await page.waitForTimeout(80);
    }
    check("Inwentaryzacja: różnica PKS −0,5 t", nb(await page.textContent('[data-diff="pr_pks"]')) === "-0,5 t");
    await page.click("#inv-close"); await page.click(".scrim [data-yes]"); await page.waitForTimeout(300);
    check("Inwentaryzacja: zamknięta, tylko odczyt", nb(await page.textContent("#inv-status")) === "ZAMKNIĘTA" && (await page.$$("[data-count]")).length === 0);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "v2e_inv.png") });
    await ctx.close();
  }

  /* ------------- wyścig dwóch kart ------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p1 = await ctx.newPage(); watch(p1, "karta1"); await boot(p1);
    const p2 = await ctx.newPage(); watch(p2, "karta2"); await boot(p2);
    for (const p of [p1, p2]) {
      await preset(p, "wz");
      await p.selectOption("#f-sale-productId", "pr_zr_lesna");
      await fillTab(p, "#f-sale-qty", "5000");
      await p.fill("#f-sale-price", "90");
      await p.selectOption("#f-sale-buyerId", "pa_ec_zab");
    }
    await p1.click("#summary [data-save]"); await p1.waitForSelector("#saved-docs");
    await p2.click("#summary [data-save]"); await p2.waitForTimeout(500);
    check("Wyścig: druga WZ na ten sam stan odrzucona", (await p2.textContent("#toasts")).includes("Nie zapisano"));
    check("Wyścig: stan 3 293 MP, nie ujemny", (await bal(p2, "pr_zr_lesna")) === 3293);
    await ctx.close();
  }

  /* ------------- telefon ------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); watch(page, "mobile"); await boot(page);
    for (const r of ["pulpit", "nowa?preset=wz", "nowa?preset=bezposrednia", "stany", "dokumenty", "inwentaryzacja", "historia"]) {
      await go(page, r);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`Telefon 390 px: ${r} bez przewijania w poziomie`, over <= 1, over);
    }
    await preset(page, "wz"); await tick(page, "f-mode-train"); await fillTab(page, "#f-transport-train-wagonCount", "5"); await tick(page, "f-ton-each");
    check("Telefon: lista wagonów mieści się", (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "v2e_mobile.png"), fullPage: false });
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
