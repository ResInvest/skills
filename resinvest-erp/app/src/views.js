/* =========================================================================
   ResInvest ERP 3.0 — warstwa A (cd.): ekrany modułów, szczegóły dokumentu,
   anulowanie, raporty, kwit produkcji dnia, wykresy, druk i PDF.
   Wszystkie liczby pochodzą z silnika (RIW.Reports / RIW.Stock) — pulpit,
   raport, PDF, stany i historia korzystają z tych samych funkcji.
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, t, tp, N_, esc, $, $$, ic, download, csvNum, toCSV, Toast, Modal, Store, App, Views, statusBadge, transportText, CANCEL_REASONS } = UI;
  const { fmt, fmtQ, money, Units, Dates, Stock } = R;
  const PDF = root.RIW_PDF;
  const th = s => esc(t(s));

  /* ------------------------------------------------------------------ */
  /* Wspólne opisy operacji i dokumentów                                  */
  /* ------------------------------------------------------------------ */
  const pName = id => (App.product(id) || {}).name || "—";
  const partnerName = id => (App.partner(id) || {}).name || "";
  const opPartnerId = o => o.purchase ? o.purchase.supplierId : o.sale ? o.sale.buyerId : "";
  const opTypeLabel = o => o.type === "ZAKUP" ? t("Zakup") + (o.scope.includes("PRODUKCJA") ? " + " + t("produkcja") : "") + (o.scope.includes("SPRZEDAZ") ? " + " + t("sprzedaż") : "")
    : o.type === "PRODUKCJA" ? t("Produkcja na magazyn") : o.type === "MM" ? t("Przesunięcie MM") : o.direct ? t("Produkcja + sprzedaż bezpośrednia") : t("Sprzedaż z magazynu (WZ)");
  const TYPE_BADGE = o => `<span class="badge ${o.type === "ZAKUP" ? "ok" : o.type === "PRODUKCJA" ? "brand" : o.type === "MM" ? "info" : "gold"}">${esc(opTypeLabel(o))}</span>`;
  const opProduct = o => o.type === "ZAKUP" ? pName(o.purchase.productId) : o.type === "MM" ? pName(o.mm.productId)
    : o.production ? pName(o.production.outProductId) : o.sale ? pName(o.sale.productId) : "—";
  const opQty = o => o.type === "ZAKUP" ? `${fmtQ(o.purchase.qty)} ${Units.label(o.purchase.unit)}`
    : o.type === "PRODUKCJA" ? `${fmtQ(o.production.consumeQty)} ${Units.label(o.production.consumeUnit)} → ${fmtQ(o.production.outQty)} ${Units.label(o.production.outUnit)}`
    : o.type === "MM" ? `${fmtQ(o.mm.qty)} ${Units.label(o.mm.unit)}`
    : o.direct ? `${fmtQ(o.production.outQty)} MP → ${fmtQ(o.sale.qty)} MP` : `${fmtQ(o.sale.qty)} ${Units.label(o.sale.unit)}`;
  const opValue = o => o.type === "ZAKUP" ? o.totals.purchaseCost : o.sale ? o.totals.revenue : o.type === "PRODUKCJA" ? o.totals.chippingCost : 0;
  const nowText = () => { const d = new Date(); return `${Dates.pl(App.today())} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const qtyByUnit = m => Object.entries(m || {}).filter(([, v]) => Math.abs(v) > R.EPS).map(([u, v]) => `${fmtQ(v)} ${Units.label(u)}`).join(" · ") || "—";
  const statusText = st => st === "CANCELLED" ? t("ANULOWANY") : t(R.STATUS[st] || st);
  const allWh = () => t("wszystkie magazyny");

  /** Wszystkie dokumenty: operacji, korekt (KOR), anulowań (AN), bilansu otwarcia i inwentaryzacji. */
  function allDocuments(S, whId) {
    const rows = [];
    for (const op of S.operations) {
      if (whId && op.whId !== whId && op.toWhId !== whId) continue;
      for (const d of op.documents) rows.push(Object.assign({}, d, { date: op.date, opId: op.id, opNo: op.no, opType: op.type, direct: op.direct, status: op.status, whId: op.whId, userName: op.userName }));
      op.corrections.forEach(c => rows.push({ type: "KOR", no: c.no, date: c.date, opId: op.id, opNo: op.no, status: "POSTED", whId: op.whId, productId: null, qty: null, unit: null, value: 0, partner: partnerName(opPartnerId(op)), place: op.place, stock: c.deltas.length ? "±" : "brak", userName: c.userName, note: t("KOREKTA dokumentu nr {no}: {r}", { no: op.no, r: R.trReason(c.reason) }), corr: c }));
      if (op.cancel) rows.push({ type: "AN", no: op.cancel.no, date: op.cancel.date, opId: op.id, opNo: op.no, status: "POSTED", whId: op.whId, productId: null, qty: null, unit: null, value: 0, partner: partnerName(opPartnerId(op)), place: op.place, stock: "±", userName: op.cancel.userName, note: t("ANULOWANIE dokumentu nr {no}: {r}", { no: op.no, r: R.trReason(op.cancel.reason) }) });
    }
    const extra = new Map();
    for (const l of S.ledger) {
      if (whId && l.whId !== whId) continue;
      if (l.kind !== "BO" && l.kind !== "INW") continue;
      const r = extra.get(l.docNo) || { type: l.kind === "BO" ? "BO" : "IN", no: l.docNo, date: l.date, whId: l.whId, productId: null, qty: null, unit: null, value: 0, partner: "", place: App.whName(l.whId), stock: l.kind === "BO" ? "+" : "±", status: "POSTED", lines: 0, userName: l.userName };
      r.lines++; extra.set(l.docNo, r);
    }
    rows.push(...extra.values());
    return rows.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.no).localeCompare(String(a.no)));
  }
  function docContent(d) {
    if (d.type === "TR") return `${t(R.TRANSPORT_MODES[d.transport.mode])} · ${transportText(d.transport)}`;
    if (d.type === "KOR" || d.type === "AN") return d.note;
    if (d.type === "IN") return t("Różnice inwentaryzacyjne ({n} poz.)", { n: d.lines });
    if (d.type === "BO") return t("Bilans otwarcia ({n} poz.)", { n: d.lines });
    if (d.type === "MM") return `${pName(d.productId)} · ${d.fromWh} → ${d.toWh}`;
    return pName(d.productId) + (d.meta && d.meta.direct ? " · " + t("bezpośrednio") : "");
  }
  const stockLbl = d => d.stock === "+" ? `<span class="badge ok">${th("+ przychód")}</span>` : d.stock === "−" ? `<span class="badge warn">${th("− rozchód")}</span>` : d.stock === "brak" ? `<span class="badge info">${th("brak")}</span>` : `<span class="badge">${th("± zmiana")}</span>`;

  /* ------------------------------------------------------------------ */
  /* Druk i PDF — jeden model treści                                      */
  /* ------------------------------------------------------------------ */
  const Printer = {
    async register(model, kind, format) {
      const res = await Store.exec("print.register", { kind, title: model.title, range: model.rangeText || "", wh: model.whText || "", format }, N_("Raporty"));
      return res.ok ? res.no : null;
    },
    finish(model, no) {
      const u = App.user();
      return Object.assign({}, model, { number: model.number || no, generatedAt: nowText(), generatedBy: `${u.name} (${App.roleLabel(u.role)})`, system: `ResInvest ERP ${R.VERSION}`, labels: PDF.labels() });
    },
    async print(model, kind) {
      const w = root.open("", "_blank");
      if (!w) { Toast.warn(t("Okno wydruku zablokowane"), t("Zezwól na wyskakujące okna dla tego pliku.")); return; }
      const no = await this.register(model, kind, "print");
      w.document.write(PDF.toHTML(this.finish(model, no)));
      w.document.close(); w.focus();
      setTimeout(() => { try { w.print(); } catch (e) {} }, 150);
    },
    async pdf(model, kind, fileBase) {
      try {
        const no = await this.register(model, kind, "pdf");
        const m = this.finish(model, no);
        const bytes = PDF.render(m);
        const name = `${fileBase || "dokument"}_${(no || "").replace(/\//g, "-")}.pdf`.replace(/[^\w.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+/g, "_");
        download(name, new Blob([bytes], { type: "application/pdf" }));
        root.RIW_DEBUG.lastPdf = { name, size: bytes.length, model: m };
        Toast.ok(t("Wygenerowano PDF"), `${name} · ${fmt(bytes.length / 1024, 0)} kB`);
      } catch (e) { console.error(e); Toast.err(t("Nie udało się wygenerować PDF"), e.message); }
    }
  };
  const printButtons = id => `<button class="btn" type="button" data-print="${id}">${ic("print", 15)} ${th("Drukuj")}</button><button class="btn" type="button" data-pdf="${id}">${ic("pdf", 15)} ${th("Generuj PDF")}</button>`;

  /** Model dokumentu magazynowego (PZ, RW, PW, WZ, MM, TR, KOR, AN). */
  function docModel(d) {
    const S = Store.state, op = d.opId ? R.byId(S.operations, d.opId) : null;
    const kv = [];
    const add = (k, v) => { if (v !== undefined && v !== null && v !== "") kv.push([k, String(v)]); };
    add(t("Numer"), d.no); add(t("Rodzaj"), t(R.DOC_LABEL[d.type])); add(t("Data"), Dates.pl(d.date)); add(t("Magazyn"), App.whName(d.whId)); add(t("Status"), statusText(d.status));
    if (d.place) add(t("Miejsce transportu"), d.place);
    if (d.productId) {
      const p = App.product(d.productId);
      add(t("Produkt"), p.name);
      add(t("Ilość"), `${fmtQ(d.qty, 6)} ${Units.label(d.unit)}${d.unit !== p.unit ? ` (= ${fmtQ(d.stockQty, 6)} ${Units.label(p.unit)})` : ""}`);
      const o = Units.orient(d.stockQty != null ? d.stockQty : d.qty, p, S.config);
      add(t("Masa · energia"), `${d.weightMode === "manual" ? t("{q} t (waga rzeczywista)", { q: fmtQ(d.weightT) }) : `≈ ${fmt(o.t, 2)} t`} · ≈ ${fmt(o.gj, 1)} GJ ${t("(orientacyjnie)")}`);
    }
    if (d.fromWh) { add(t("Z magazynu"), d.fromWh); add(t("Do magazynu"), d.toWh); }
    if (d.partner) add(d.type === "PZ" ? t("Dostawca") : t("Odbiorca"), d.partner);
    if (d.basis) add(t("Podstawa"), t(R.BASIS[d.basis]));
    if (d.value) add(d.type === "PW" ? t("Koszt rąbania") : t("Wartość netto"), money(d.value));
    const META = { productionType: N_("Rodzaj produkcji"), ndl: N_("Nadleśnictwo"), lesnictwo: N_("Leśnictwo"), kwit: N_("Nr kwitu wywozowego"), sourceType: N_("Typ źródła"), investSite: N_("Miejsce wycinki"), sourceDoc: N_("Dokument źródłowy"), chipRate: N_("Cena za rąbanie [zł/MP]"), chippingCost: N_("Koszt rąbania [zł]"), chipper: N_("Rębak"), operator: N_("Operator"), fromDoc: N_("Z dokumentu zużycia"), direct: N_("Sprzedaż / produkcja bezpośrednia"), rawInfo: N_("Surowiec z lasu (informacyjnie)") };
    const TRANSLATED = new Set(["productionType", "sourceType", "direct"]);
    if (d.meta) for (const [k, v] of Object.entries(d.meta)) {
      if (v === "" || v == null) continue;
      const val = typeof v === "number" ? fmt(v, 2) : typeof v === "object" ? root.RIW_I18N.tr(v.p && typeof v.p.q === "number" ? { k: v.k, p: Object.assign({}, v.p, { q: fmtQ(v.p.q) }) } : v) : TRANSLATED.has(k) ? t(v) : v;
      add(t(META[k] || k), val);
    }
    const blocks = [{ type: "kv", rows: kv, cols: 1 }];
    if (d.transport) transportBlocks(d.transport, blocks);
    if (d.type === "KOR" && d.corr) {
      const c = d.corr;
      blocks.push({ type: "h", text: t("KOREKTA dokumentu nr {no}", { no: d.opNo }) }, { type: "p", text: t("Powód: {r} · wprowadził: {u}", { r: R.trReason(c.reason), u: c.userName }) + (c.reverses ? " · " + t("odwraca korektę {no}", { no: c.reverses }) : "") });
      blocks.push({ type: "table", columns: [{ label: t("Pole"), w: 2 }, { label: t("Oryginał"), w: 2, align: "right" }, { label: t("Korekta"), w: 2, align: "right" }, { label: t("Różnica"), w: 1.4, align: "right" }], rows: c.changes.map(x => [t(x.label), x.beforeText, x.afterText, x.diff !== null ? (x.diff > 0 ? "+" : "") + fmtQ(x.diff, 6) : t("zmiana")]) });
      if (c.deltas.length) blocks.push({ type: "table", columns: [{ label: t("Produkt"), w: 3 }, { label: t("Magazyn"), w: 2 }, { label: t("Zmiana stanu"), w: 2, align: "right" }], rows: c.deltas.map(x => [pName(x.productId), App.whName(x.whId), (x.qty > 0 ? "+" : "") + App.qtyNative(x.qty, x.productId, 6)]) });
    }
    if (d.type === "AN" && op && op.cancel) {
      blocks.push({ type: "h", text: t("ANULOWANIE dokumentu nr {no}", { no: op.no }) }, { type: "p", text: t("Przyczyna: {r} · wykonał: {u}", { r: R.trReason(op.cancel.reason), u: op.cancel.userName }) });
      blocks.push({ type: "table", columns: [{ label: t("Produkt"), w: 3 }, { label: t("Magazyn"), w: 2 }, { label: t("Zmiana"), w: 2, align: "right" }, { label: t("Stan przed"), w: 2, align: "right" }, { label: t("Stan po"), w: 2, align: "right" }], rows: op.cancel.effect.map(x => [pName(x.productId), App.whName(x.whId), (x.qty > 0 ? "+" : "") + App.qtyNative(x.qty, x.productId, 6), App.qtyNative(x.before, x.productId), App.qtyNative(x.after, x.productId)]) });
    }
    if (op) blocks.push({ type: "p", muted: true, text: t("Operacja {no} · {type} · wystawił: {u}", { no: op.no, type: opTypeLabel(op), u: op.userName }) + (op.extDoc ? " · " + t("dokument zewnętrzny: {x}", { x: op.extDoc }) : "") + (op.notes ? " · " + t("uwagi: {x}", { x: op.notes }) : "") });
    blocks.push({ type: "signatures", labels: d.type === "WZ" || d.type === "PZ" ? [t("Wydał / przyjął (magazyn)"), t("Kierowca / odbiorca")] : [t("Sporządził"), t("Zatwierdził")] });
    return { title: `${t(R.DOC_LABEL[d.type])} ${d.no}`, number: d.no, headerRight: App.whName(d.whId), rangeText: Dates.pl(d.date), whText: App.whName(d.whId), blocks };
  }

  /** Transport na dokumencie TR: dane ogólne + tabela kursów (własny, zewnętrzny albo oba). */
  function transportBlocks(x, blocks) {
    const U = Units.label(x.qtyUnit || "");
    const tk = [[t("Transport"), t(R.TRANSPORT_MODES[x.mode])]];
    const hasKw = P => P.runs.some(r => r.kwit);
    const runTable = (P, own) => { const kw = hasKw(P); return { type: "table", columns: [{ label: t("Kurs"), w: 0.6 }, { label: t("Pojazd"), w: 1.4 }, { label: t("Kierowca"), w: 1.8 }].concat(kw ? [{ label: t("Kwit wywozowy"), w: 1.8 }, { label: "m³", w: 0.7, align: "right" }] : []).concat([{ label: "km", w: 0.8, align: "right" }, { label: t("Rozliczenie"), w: 1.3, align: "right" }, { label: t("Ilość"), w: 1.2, align: "right" }, { label: kw ? t("Tony") : t("Waga rzecz. [t]"), w: 1.2, align: "right" }, { label: t("Koszt"), w: 1.2, align: "right" }]),
      rows: P.runs.map(r => [String(r.no), r.reg, (own ? r.driverName + (r.driverOverridden ? " *" : "") : r.driver) || "—"].concat(kw ? [r.kwit || "—", r.kwitM3 !== null && r.kwitM3 !== undefined ? fmtQ(r.kwitM3) : "—"] : []).concat([fmtQ(r.km), own || r.costBasis === "km × stawka" ? `${fmt(r.rate)} zł/km` : t(r.costBasis), `${fmtQ(r.qty)} ${U}`, r.weightT !== null && r.weightT !== undefined ? fmtQ(r.weightT) : "—", money(r.cost)])),
      foot: [t("Razem"), "", ""].concat(kw ? ["", fmtQ(P.runs.reduce((a, r) => a + (r.kwitM3 || 0), 0))] : []).concat([fmtQ(P.km), "", `${fmtQ(P.totalQty)} ${U}`, P.totalWeightT !== null && P.totalWeightT !== undefined ? fmtQ(P.totalWeightT) : "—", money(P.cost)]), note: own && P.runs.some(r => r.driverOverridden) ? t("* kierowca zmieniony tylko dla tego kursu") : "" }; };
    const ownP = x.mode === "own" ? x : x.mode === "mixed" ? x.own : null, extP = x.mode === "external" ? x : x.mode === "mixed" ? x.external : null;
    if (ownP || extP) tk.push([t("Liczba kursów"), String((x.runs || [x]).length)], [t("Kilometry łącznie"), `${fmtQ(x.km)} km`], [t("Ilość przewieziona"), `${fmtQ(x.totalQty || 0)} ${U}`], [t("Waga rzeczywista łącznie"), x.totalWeightT !== null && x.totalWeightT !== undefined ? `${fmtQ(x.totalWeightT)} t` : "—"]);
    if (x.kwity && x.kwity.length) tk.push([t("Kwity wywozowe"), x.kwity.join(", ")]);
    if (x.totalM3 !== null && x.totalM3 !== undefined) tk.push([t("m³ z kwitów łącznie"), `${fmtQ(x.totalM3)} m³`]);
    if (extP) tk.push([t("Przewoźnik zewnętrzny"), extP.company + (extP.includedInPrice ? " " + t("(wliczony w cenę)") : "")]);
    if (x.mode === "train") {
      tk.push([t("Skład / przewoźnik"), `${x.trainNo || "—"} · ${x.carrier || "—"}`], [t("Nr dokumentu przewozowego"), x.docNo || "—"], [t("Miejsce załadunku"), x.loadPlace || "—"], [t("Liczba wagonów"), String(x.wagonCount)]);
      if (x.capacity !== null) tk.push([t("Łączna ładowność"), `${fmtQ(x.totalCapacity)} ${x.capUnit}`]);
      tk.push([t("Łączny tonaż składu"), `${fmtQ(x.totalT)} t`], [t("Stawka"), `${fmtQ(x.basisQty)} ${Units.label(x.priceUnit)} × ${fmt(x.price)} zł`]);
    }
    tk.push([t("Koszt transportu"), money(x.cost)], [t("Wpływ na stan"), t("brak — transport nie zmienia stanu magazynowego")]);
    blocks.push({ type: "h", text: t("Transport") }, { type: "kv", rows: tk, cols: 1 });
    if (ownP && ownP.runs && ownP.runs.length) { if (x.mode === "mixed") blocks.push({ type: "p", bold: true, text: t("Kursy floty własnej") }); blocks.push(runTable(ownP, true)); }
    if (extP && extP.runs && extP.runs.length) { if (x.mode === "mixed") blocks.push({ type: "p", bold: true, text: t("Kursy firmy zewnętrznej — {c}", { c: extP.company }) }); blocks.push(runTable(extP, false)); }
    if (x.mode === "train" && x.wagonT.length) blocks.push({ type: "table", columns: [{ label: t("Wagon"), w: 1 }, { label: t("Tonaż [t]"), w: 2, align: "right" }], rows: x.wagonT.map((w, i) => [String(i + 1), fmtQ(w)]), foot: [t("Razem"), fmtQ(x.totalT)] });
  }

  /* ------------------------------------------------------------------ */
  /* Szczegóły dokumentu / operacji                                       */
  /* ------------------------------------------------------------------ */
  const auditLine = a => `<b>${esc(Dates.ts(a.ts))}</b> · ${esc(a.userName === "System" ? t("System") : a.userName)} · ${esc(R.auditText(a))}${a.relatedNo ? ` (${esc(a.relatedNo)})` : ""}${a.reason ? " — " + esc(t("powód: {r}", { r: R.trReason(a.reason) })) : ""}`;
  const OpDetail = {
    open(opId, opts = {}) {
      const S = Store.state, op = R.byId(S.operations, opId);
      if (!op) { Toast.err(t("Nie znaleziono operacji")); return; }
      const docs = allDocuments(S).filter(d => d.opId === op.id).reverse();
      const led = Stock.sorted(S.ledger.filter(l => l.opId === op.id));
      const events = S.audit.filter(a => a.entityId === op.id).slice().sort((a, b) => a.ts < b.ts ? -1 : 1);
      const kv = [];
      const add = (k, v) => { if (v !== undefined && v !== null && v !== "") kv.push(`<dt>${esc(k)}</dt><dd>${v}</dd>`); };
      add(t("Rodzaj"), TYPE_BADGE(op)); add(t("Status"), statusBadge(op.status)); add(t("Data"), esc(Dates.pl(op.date))); add(t("Magazyn"), esc(App.whName(op.whId)) + (op.toWhId ? ` → ${esc(App.whName(op.toWhId))}` : ""));
      add(t("Wystawił"), esc(`${op.userName} · ${Dates.ts(op.createdAt)}`));
      if (op.purchase) add(t("Zakup"), `${esc(partnerName(op.purchase.supplierId))} · ${esc(fmtQ(op.purchase.qty))} ${Units.label(op.purchase.unit)} ${esc(pName(op.purchase.productId))} × ${fmt(op.purchase.price)} zł`);
      if (op.production) {
        const X = op.production;
        add(X.mode === "direct" ? t("Produkcja w lesie") : t("Produkcja"), `${X.rawProductId ? `${esc(pName(X.rawProductId))} ${esc(fmtQ(X.consumeQty, 6))} ${Units.label(X.consumeUnit)}${X.mode === "direct" ? " " + esc(t("(nie ze stanu)")) : ""} → ` : ""}<b>${esc(fmtQ(X.outQty, 6))} ${Units.label(X.outUnit)}</b> ${esc(pName(X.outProductId))}`);
        if (X.outUnit === "MP") add(t("Rąbanie"), `${fmt(X.chipRate)} zł/MP = ${money(X.chippingCost)}${X.chipperName ? ` · ${esc(X.chipperName)} (${esc(X.operatorName)})` : ""}`);
      }
      if (op.sale) add(t("Sprzedaż"), `${esc(partnerName(op.sale.buyerId))} · ${esc(fmtQ(op.sale.qty))} ${Units.label(op.sale.unit)} → ${money(op.sale.revenue)}`);
      if (op.mm) add(t("Przesunięcie"), `${esc(fmtQ(op.mm.qty))} ${Units.label(op.mm.unit)} ${esc(pName(op.mm.productId))}: ${esc(op.mm.fromWhName)} → ${esc(op.mm.toWhName)}`);
      if (op.transport && op.transport.mode !== "none") add(t("Transport"), `${esc(t(R.TRANSPORT_MODES[op.transport.mode]))} · ${esc(transportText(op.transport))} · ${money(op.transport.cost)}`);
      add(t("Miejsce"), esc(op.place)); add(t("Dokument zewnętrzny"), esc(op.extDoc)); add(t("Uwagi"), esc(op.notes));
      add(t("Wynik operacji"), `<b>${money(op.totals.result)}</b>`);

      const canCorr = op.status !== "CANCELLED" && App.can("documents.correct") && App.can(R.OP_TYPES[op.type].correctPerm) && R.canAccessWh(App.user(), op.whId);
      const canCancel = op.status !== "CANCELLED" && App.can("documents.cancel") && R.canAccessWh(App.user(), op.whId);
      const lastCorr = op.corrections[op.corrections.length - 1];
      const corrRows = op.corrections.map(c => `<tr><td class="mono nowrap"><a href="#" data-doc="${esc(c.no)}">${esc(c.no)}</a></td><td class="nowrap">${esc(Dates.pl(c.date))}</td><td>${esc(c.userName)}</td><td>${esc(R.trReason(c.reason))}${c.reverses ? `<br><small class="dim">${esc(t("odwraca {no}", { no: c.reverses }))}</small>` : ""}</td>
          <td>${c.changes.map(x => `${esc(t(x.label))}: ${esc(x.beforeText)} → <b>${esc(x.afterText)}</b>`).join("<br>") || "—"}</td>
          <td class="r">${c.deltas.map(x => `<span class="${x.qty < 0 ? "neg" : "pos"}">${x.qty > 0 ? "+" : ""}${esc(App.qtyNative(x.qty, x.productId, 6))}</span>`).join("<br>") || "—"}</td>
          <td class="r">${canCorr && c === lastCorr && !c.reverses ? `<button class="btn sm" type="button" data-reverse="${esc(c.no)}">${ic("undo", 13)} ${th("Odwróć")}</button>` : ""}</td></tr>`).join("");
      const rel = [];
      docs.forEach(d => { if (d.meta && d.meta.fromDoc) rel.push(`${esc(d.no)} ← ${esc(d.meta.fromDoc)} ${th("(produkt z surowca)")}`); });
      op.corrections.forEach(c => rel.push(`${esc(c.no)} → ${esc(t("koryguje {no}", { no: op.no }))}${c.reverses ? ` · ${esc(t("odwraca {no}", { no: c.reverses }))}` : ""}`));
      if (op.cancel) rel.push(`${esc(op.cancel.no)} → ${esc(t("anuluje {no}", { no: op.no }))}`);
      if (op.cancel && op.cancel.dependents.length) rel.push(`${th("Operacje późniejsze na tym samym towarze (potwierdzone przy anulowaniu):")} ${op.cancel.dependents.map(d => `<a href="#" data-op="${esc(d.id)}">${esc(d.no)}</a>`).join(", ")}`);
      const body = `
        ${opts.justSaved ? `<div class="info-line ok mb3">${ic("check", 15)}<span>${t("Dokument zatwierdzony: <b>{list}</b>. Status: ZATWIERDZONY.", { list: docs.map(d => esc(d.no)).join(", ") })}</span></div>` : ""}
        ${op.status === "CANCELLED" ? `<div class="info-line err mb3">${ic("ban", 15)}<span>${esc(t("Dokument anulowany {d} przez {u} — dokument {no}. Przyczyna: {r}. Skutki magazynowe zostały odwrócone; dokument pozostaje w historii.", { d: Dates.pl(op.cancel.date), u: op.cancel.userName, no: op.cancel.no, r: R.trReason(op.cancel.reason) }))}</span></div>` : ""}
        <div class="grid g2 detail-grid"><dl class="money-list" id="op-kv">${kv.join("")}</dl>
          <div><h4 class="mini-h">${th("Dokumenty")}</h4><div class="tbl-wrap"><table class="tbl" id="op-docs"><thead><tr><th>${th("Nr")}</th><th>${th("Treść")}</th><th class="r">${th("Ilość")}</th><th>${th("Stan")}</th><th></th></tr></thead><tbody>
            ${docs.map(d => `<tr><td class="mono nowrap">${esc(d.no)}</td><td>${esc(docContent(d))}</td><td class="r">${d.qty != null ? esc(fmtQ(d.qty) + " " + Units.label(d.unit)) : "—"}</td><td>${stockLbl(d)}</td><td class="r nowrap"><button class="btn sm" type="button" data-doc="${esc(d.no)}">${th("Podgląd")}</button></td></tr>`).join("")}
          </tbody></table></div>
          ${rel.length ? `<h4 class="mini-h">${th("Powiązania dokumentów")}</h4><ul class="rel-list">${rel.map(x => `<li>${x}</li>`).join("")}</ul>` : ""}</div></div>
        <h4 class="mini-h">${th("Ruchy magazynowe (księga)")}</h4>
        <div class="tbl-wrap"><table class="tbl" id="op-ledger"><thead><tr><th>${th("Data")}</th><th>${th("Dokument")}</th><th>${th("Rodzaj")}</th><th>${th("Magazyn")}</th><th>${th("Produkt")}</th><th class="r">${th("Zmiana")}</th></tr></thead><tbody>
          ${led.map(l => `<tr class="${l.kind === "ANULOWANIE" || l.kind === "KOREKTA" ? "sub" : ""}"><td class="nowrap">${esc(Dates.pl(l.date))}</td><td class="mono">${esc(l.docNo)}</td><td>${esc(t(R.KINDS[l.kind].label))}${l.kind === "KOREKTA" || l.kind === "ANULOWANIE" ? ` <small class="dim">(${esc(t(R.CATS[l.cat]))})</small>` : ""}${l.direct ? " · " + th("bezp.") : ""}</td><td>${esc(App.whName(l.whId))}</td><td>${esc(pName(l.productId))}</td><td class="r"><span class="${l.qty < 0 ? "neg" : "pos"}">${l.qty > 0 ? "+" : ""}${esc(App.qtyNative(l.qty, l.productId, 6))}</span></td></tr>`).join("")}
        </tbody></table></div>
        ${op.corrections.length ? `<h4 class="mini-h">${esc(t("Korekty ({n})", { n: op.corrections.length }))}</h4><div class="tbl-wrap"><table class="tbl" id="op-corr"><thead><tr><th>${th("Nr")}</th><th>${th("Data")}</th><th>${th("Użytkownik")}</th><th>${th("Powód")}</th><th>${th("Zmiany")}</th><th class="r">${th("Wpływ na stan")}</th><th></th></tr></thead><tbody>${corrRows}</tbody></table></div>` : ""}
        <h4 class="mini-h">${th("Historia zdarzeń")}</h4>
        <ul class="timeline" id="op-events">${events.map(a => `<li>${auditLine(a)}</li>`).join("")}</ul>`;
      const m = Modal.open({
        title: `${op.no} — ${opTypeLabel(op)}`, sub: `${statusBadge(op.status)} ${esc(App.whName(op.whId))} · ${esc(Dates.pl(op.date))}`, xwide: true, id: "op-detail", body,
        footer: `${canCancel ? `<button class="btn danger" type="button" data-cancel>${ic("ban", 15)} ${th("Anuluj dokument…")}</button>` : ""}
          ${canCorr ? `<a class="btn" href="#/korekta?op=${esc(op.id)}" data-correct>${ic("edit", 15)} ${th("Koryguj…")}</a>` : ""}
          <span class="spacer"></span>
          <button class="btn primary" type="button" data-close>${th("Zamknij")}</button>`
      });
      $("[data-close]", m.el).onclick = () => m.close();
      const cc = $("[data-correct]", m.el); if (cc) cc.addEventListener("click", () => m.close());
      const cb = $("[data-cancel]", m.el); if (cb) cb.onclick = () => { m.close(); CancelDialog.open(op.id); };
      $$("[data-doc]", m.el).forEach(b => b.onclick = e => { e.preventDefault(); const d = allDocuments(Store.state).find(x => x.no === b.dataset.doc); if (d) DocPreview.open(d); });
      $$("[data-op]", m.el).forEach(b => b.onclick = e => { e.preventDefault(); m.close(); OpDetail.open(b.dataset.op); });
      $$("[data-reverse]", m.el).forEach(b => b.onclick = async () => {
        const r = await Modal.confirm({ title: t("Odwrócić korektę {no}?", { no: b.dataset.reverse }), text: t("Powstanie nowa korekta przywracająca dane sprzed korekty. Korekty nie usuwa się — obie pozostają w historii."), ok: t("Odwróć korektę"), input: { label: t("Powód odwrócenia"), placeholder: t("np. korekta wprowadzona omyłkowo"), required: true } });
        if (!r.ok) return;
        const res = await Store.exec("op.reverseCorrection", { opId: op.id, corrNo: b.dataset.reverse, reason: r.value }, N_("Odwrócenie korekty"));
        if (res.ok) { Toast.ok(t("Korekta odwrócona"), res.no); m.close(); App.render(); OpDetail.open(op.id); } else Toast.err(t("Nie odwrócono"), res.error);
      });
      return m;
    }
  };

  const DocPreview = {
    open(d) {
      const model = docModel(d);
      const html = `<div class="doc-print" id="doc-print"><h4>${esc(model.title)}</h4>${model.blocks.filter(b => b.type === "kv" || b.type === "p" || b.type === "h" || b.type === "table").map(b =>
        b.type === "kv" ? `<table>${b.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`
          : b.type === "h" ? `<h5>${esc(b.text)}</h5>` : b.type === "p" ? (b.bold ? `<h5>${esc(b.text)}</h5>` : `<p class="${b.muted ? "muted" : ""}">${esc(b.text)}</p>`)
          : `<table class="tbl"><thead><tr>${b.columns.map(c => `<th class="${c.align === "right" ? "r" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map((v, i) => `<td class="${b.columns[i].align === "right" ? "r" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`).join("")}</div>`;
      const m = Modal.open({ title: `${d.type} ${d.no}`, sub: esc(t(R.DOC_LABEL[d.type])), wide: true, id: "doc-preview", body: html,
        footer: `${d.opId ? `<button class="btn ghost" type="button" data-opd>${esc(t("Operacja {no}", { no: d.opNo }))}</button>` : ""}<span class="spacer"></span>${printButtons("doc")}<button class="btn primary" type="button" data-ok>${th("Zamknij")}</button>` });
      $("[data-ok]", m.el).onclick = () => m.close();
      const o = $("[data-opd]", m.el); if (o) o.onclick = () => { m.close(); OpDetail.open(d.opId); };
      $("[data-print]", m.el).onclick = () => Printer.print(model, "DOC");
      $("[data-pdf]", m.el).onclick = () => Printer.pdf(model, "DOC", d.no.replace(/\//g, "-"));
    }
  };

  /* ------------------------------------------------------------------ */
  /* Anulowanie dokumentu                                                 */
  /* ------------------------------------------------------------------ */
  const CancelDialog = {
    open(opId) {
      const S = Store.state, op = R.byId(S.operations, opId);
      const pc = R.planCancel(S, opId, App.ctx(N_("Anulowanie dokumentu")));
      if (!pc.ok && !pc.blocked) { Toast.err(t("Nie można anulować"), pc.error); return; }
      const deps = (pc.dependents || []).map(d => `<li><a href="#" data-op="${esc(d.id)}">${esc(d.no)}</a> · ${esc(t(R.OP_TYPES[d.opType] ? R.OP_TYPES[d.opType].label : d.type))} · ${esc(Dates.pl(d.date))} (${esc(d.docNo)})</li>`).join("");
      let body;
      if (pc.blocked) {
        body = `<div class="info-line err" id="cancel-blocked">${ic("alert", 15)}<span>${esc(pc.error)}</span></div>
          ${deps ? `<h4 class="mini-h">${th("Operacje zależne")}</h4><ul class="rel-list">${deps}</ul>` : ""}
          <p class="help mt3">${th("Najpierw skoryguj lub anuluj operacje zależne (od najpóźniejszej), a potem wróć do tego dokumentu.")}</p>`;
      } else {
        const eff = pc.reversal.map(x => `<tr><td>${esc(pName(x.productId))}<br><small class="dim">${esc(App.whName(x.whId))} · ${esc(t(R.CATS[x.cat]))}${x.direct ? " " + th("(bezp.)") : ""}</small></td><td class="r"><span class="${x.qty < 0 ? "neg" : "pos"}">${x.qty > 0 ? "+" : ""}${esc(App.qtyNative(x.qty, x.productId, 6))}</span></td><td class="r">${esc(App.qtyNative(x.before, x.productId))}</td><td class="r"><b>${esc(App.qtyNative(x.after, x.productId))}</b></td></tr>`).join("");
        body = `<p class="muted">${t("Anulowanie <b>nie usuwa</b> dokumentu {no}. Powstanie dokument anulowania z datą {d}, który odwraca skutki magazynowe i wartościowe. Dokument pierwotny otrzyma status ANULOWANY.", { no: esc(op.no), d: esc(Dates.pl(App.today())) })}</p>
          <h4 class="mini-h">${th("Wpływ na stan")}</h4>
          ${eff ? `<div class="tbl-wrap"><table class="tbl" id="cancel-effect"><thead><tr><th>${th("Produkt")}</th><th class="r">${th("Zmiana")}</th><th class="r">${th("Stan przed")}</th><th class="r">${th("Stan po")}</th></tr></thead><tbody>${eff}</tbody></table></div>` : `<p class="muted">${th("Brak ruchów magazynowych (np. sama korekta wartości).")}</p>`}
          ${deps ? `<div class="info-line warn mt3">${ic("alert", 15)}<span>${th("Po tym dokumencie wykonano operacje na tym samym towarze. Stan nie spadnie poniżej zera, ale sprawdź, czy anulowanie jest zamierzone.")}</span></div><ul class="rel-list">${deps}</ul>
            <label class="inline-opt mt2"><input type="checkbox" id="cancel-ack"> ${th("Potwierdzam anulowanie mimo operacji zależnych")}</label>` : ""}
          <div class="fgrid mt4"><div class="field"><label for="cancel-reason">${th("Przyczyna anulowania")} <span class="req">*</span></label>
            <select class="ctrl" id="cancel-reason"><option value="">— ${th("wybierz")} —</option>${CANCEL_REASONS.map(r => `<option value="${esc(r)}">${esc(t(r))}</option>`).join("")}</select>
            <input class="ctrl mt2" id="cancel-reason-text" placeholder="${th("opis (wymagany przy „inny”)")}"><div class="msg hidden" id="cancel-msg" role="alert"></div></div></div>`;
      }
      const m = Modal.open({ title: t("Anulowanie dokumentu {no}", { no: op.no }), sub: esc(opTypeLabel(op)), wide: true, id: "cancel-dialog", body,
        footer: `<button class="btn ghost" type="button" data-no>${pc.blocked ? th("Zamknij") : th("Nie anuluj")}</button>${pc.blocked ? "" : `<button class="btn danger" type="button" data-yes id="cancel-yes">${ic("ban", 15)} ${th("Anuluj dokument")}</button>`}` });
      $("[data-no]", m.el).onclick = () => m.close();
      $$("[data-op]", m.el).forEach(b => b.onclick = e => { e.preventDefault(); m.close(); OpDetail.open(b.dataset.op); });
      const yes = $("[data-yes]", m.el);
      if (!yes) return;
      yes.onclick = async () => {
        const sel = $("#cancel-reason", m.el).value, txt = $("#cancel-reason-text", m.el).value.trim();
        const msg = $("#cancel-msg", m.el);
        const fail = x => { msg.textContent = x; msg.classList.remove("hidden"); };
        if (!sel) return fail(t("Wybierz przyczynę anulowania"));
        if (sel === "inny" && !txt) return fail(t("Opisz przyczynę anulowania"));
        const ack = $("#cancel-ack", m.el);
        if (ack && !ack.checked) return fail(t("Zaznacz potwierdzenie — istnieją operacje zależne"));
        yes.disabled = true;
        const reason = txt ? `${sel} — ${txt}` : sel;
        const res = await Store.exec("op.cancel", { opId, reason, ack: !!(ack && ack.checked) }, N_("Anulowanie dokumentu"));
        yes.disabled = false;
        if (!res.ok) { fail(res.error); Toast.err(t("Nie anulowano — nic nie zapisano"), res.error); return; }
        m.close(); Toast.ok(t("Dokument anulowany"), `${res.no} → ${op.no}`); App.render(); OpDetail.open(opId);
      };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Wykresy (SVG) i podpowiedź                                           */
  /* ------------------------------------------------------------------ */
  const Tip = {
    bind(scope) {
      const tip = $("#chart-tip"); if (!tip) return;
      const place = e => { tip.style.left = Math.min(e.clientX + 14, root.innerWidth - tip.offsetWidth - 8) + "px"; tip.style.top = Math.min(e.clientY + 14, root.innerHeight - tip.offsetHeight - 8) + "px"; };
      $$("[data-tip]", scope).forEach(el => {
        el.addEventListener("mousemove", e => { tip.innerHTML = el.dataset.tip; tip.classList.remove("hidden"); place(e); });
        el.addEventListener("mouseleave", () => tip.classList.add("hidden"));
      });
      $$("svg[data-series]", scope).forEach(svg => {
        const pts = JSON.parse(svg.dataset.series), unit = svg.dataset.unit || "";
        const dot = svg.querySelector(".spark-hover");
        svg.addEventListener("mousemove", e => {
          const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(pts.length - 1, Math.round((e.clientX - r.left) / r.width * (pts.length - 1))));
          const p = pts[i];
          tip.innerHTML = `<b>${esc(Dates.pl(p[0]))}</b><br>${esc(fmtQ(p[1]))} ${esc(unit)}`; tip.classList.remove("hidden"); place(e);
          if (dot) { dot.setAttribute("cx", p[2]); dot.setAttribute("cy", p[3]); dot.style.opacity = 1; }
        });
        svg.addEventListener("mouseleave", () => { tip.classList.add("hidden"); if (dot) dot.style.opacity = 0; });
      });
    }
  };
  function sparkline(series, unit, w = 140, h = 30, color = "var(--brand)") {
    const vals = series.map(p => p.qty), min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const pts = series.map((p, i) => [p.date, p.qty, R.round(2 + i * (w - 4) / Math.max(1, series.length - 1), 2), R.round(h - 3 - (p.qty - min) / span * (h - 6), 2)]);
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" data-series='${esc(JSON.stringify(pts))}' data-unit="${esc(unit)}" role="img" aria-label="${esc(t("Stan w ostatnich {n} dniach: od {a} do {b} {u}", { n: series.length, a: fmtQ(series[0].qty), b: fmtQ(last[1]), u: unit }))}">
      <polyline points="${pts.map(p => p[2] + "," + p[3]).join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${last[2]}" cy="${last[3]}" r="3" fill="${color}" stroke="var(--surface)" stroke-width="2"/>
      <circle class="spark-hover" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2" style="opacity:0"/></svg>`;
  }
  /** Poziomy wykres słupkowy: jedna miara, jeden kolor, podpis wartości przy słupku. */
  function hbar(items, { valueText, tip, id } = {}) {
    const max = Math.max(1, ...items.map(i => i.value));
    return `<div class="hbar" ${id ? `id="${id}"` : ""} role="list">${items.map(i => `<div class="hbar-row" role="listitem" data-tip="${esc(tip ? tip(i) : "")}" ${i.drill ? `data-drill="${esc(i.drill)}"` : ""}>
      <span class="hbar-l">${esc(i.label)}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${i.value > 0 ? Math.max(2, i.value / max * 100) : 0}%"></span></span>
      <span class="hbar-v">${esc(valueText ? valueText(i) : fmtQ(i.value))}</span></div>`).join("")}</div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Wspólne: rejestr operacji i okno drill-down                          */
  /* ------------------------------------------------------------------ */
  function opsTable(ops, { id = "ops-table", showWh = false, compact = false } = {}) {
    if (!ops.length) return `<div class="empty">${th("Brak operacji dla wybranych filtrów.")}</div>`;
    if (compact) return `<div class="tbl-wrap"><table class="tbl" id="${id}"><thead><tr><th>${th("Nr")}</th><th>${th("Data")}</th><th>${th("Rodzaj / produkt")}</th><th>${th("Status")}</th><th class="r">${th("Ilość")}</th><th class="r">${th("Wartość")}</th></tr></thead><tbody>
      ${ops.map(o => `<tr class="clickable ${o.status === "CANCELLED" ? "void" : ""}" data-opid="${esc(o.id)}"><td class="mono nowrap">${esc(o.no)}</td><td class="nowrap">${esc(Dates.pl(o.date))}</td><td>${TYPE_BADGE(o)}<br><small class="dim">${esc(opProduct(o))}</small></td><td>${statusBadge(o.status)}</td><td class="r nowrap">${esc(opQty(o))}</td><td class="r nowrap">${esc(money(opValue(o)))}</td></tr>`).join("")}</tbody></table></div>`;
    return `<div class="tbl-wrap"><table class="tbl" id="${id}"><thead><tr><th>${th("Nr")}</th><th>${th("Data")}</th><th>${th("Rodzaj")}</th><th>${th("Status")}</th>${showWh ? `<th>${th("Magazyn")}</th>` : ""}<th>${th("Produkt")}</th><th class="r">${th("Ilość")}</th><th>${th("Kontrahent")}</th><th class="r">${th("Wartość")}</th><th>${th("Użytkownik")}</th><th></th></tr></thead><tbody>
      ${ops.map(o => `<tr class="clickable ${o.status === "CANCELLED" ? "void" : ""}" data-opid="${esc(o.id)}"><td class="mono nowrap">${esc(o.no)}</td><td class="nowrap">${esc(Dates.pl(o.date))}</td><td>${TYPE_BADGE(o)}</td><td>${statusBadge(o.status)}</td>${showWh ? `<td>${esc(App.whName(o.whId))}${o.toWhId ? ` → ${esc(App.whName(o.toWhId))}` : ""}</td>` : ""}
        <td>${esc(opProduct(o))}</td><td class="r nowrap">${esc(opQty(o))}</td><td>${esc(partnerName(opPartnerId(o)) || (o.mm ? o.mm.toWhName : ""))}</td><td class="r nowrap">${esc(money(opValue(o)))}</td><td>${esc(o.userName)}</td>
        <td class="r"><button class="btn sm" type="button">${th("Szczegóły")}</button></td></tr>`).join("")}</tbody></table></div>`;
  }
  function bindOps(scope) { $$("[data-opid]", scope).forEach(tr => tr.onclick = () => OpDetail.open(tr.dataset.opid)); }
  function drill(ids, title) {
    const ops = [...new Set(ids)].map(id => R.byId(Store.state.operations, id)).filter(Boolean).sort((a, b) => a.date < b.date ? -1 : 1);
    const m = Modal.open({ title: t("Operacje źródłowe — {x}", { x: title }), sub: esc(tp("{n} operacja|{n} operacje|{n} operacji", ops.length)), xwide: true, id: "drill", body: opsTable(ops, { id: "drill-table", showWh: true }), footer: `<button class="btn primary" type="button" data-ok>${th("Zamknij")}</button>` });
    $("[data-ok]", m.el).onclick = () => m.close();
    $$("[data-opid]", m.el).forEach(tr => tr.onclick = () => { m.close(); OpDetail.open(tr.dataset.opid); });
  }
  const drillAttr = (ids, title) => ids && ids.length ? ` class="drill" data-drill="${esc(ids.join(","))}" data-drill-title="${esc(title)}" tabindex="0" role="button"` : "";
  function bindDrill(scope) { $$("[data-drill]", scope).forEach(el => { const go = () => drill(el.dataset.drill.split(",").filter(Boolean), el.dataset.drillTitle || ""); el.onclick = go; el.onkeydown = e => { if (e.key === "Enter") go(); }; }); }

  const periodControls = (f, pre) => `
    <div class="field"><label for="${pre}-mode">${th("Zakres")}</label><select class="ctrl" id="${pre}-mode">${[["day", N_("Dzień")], ["week", N_("Tydzień")], ["month", N_("Miesiąc")], ["year", N_("Rok")], ["custom", N_("Zakres własny")]].filter(([k]) => !f.noYear || k !== "year").map(([k, l]) => `<option value="${k}" ${f.mode === k ? "selected" : ""}>${th(l)}</option>`).join("")}</select></div>
    ${f.mode === "day" || f.mode === "week" ? `<div class="field"><label for="${pre}-date">${f.mode === "day" ? th("Dzień") : th("Dowolny dzień tygodnia")}</label><input class="ctrl" type="date" id="${pre}-date" value="${esc(f.date || App.today())}"></div>` : ""}
    ${f.mode === "month" ? `<div class="field"><label for="${pre}-ym">${th("Miesiąc")}</label><input class="ctrl" type="month" id="${pre}-ym" value="${esc(f.ym || Dates.ym(App.today()))}"></div>` : ""}
    ${f.mode === "year" ? `<div class="field"><label for="${pre}-year">${th("Rok")}</label><input class="ctrl" type="number" min="2000" max="2100" id="${pre}-year" value="${esc(f.year || App.today().slice(0, 4))}"></div>` : ""}
    ${f.mode === "custom" ? `<div class="field"><label for="${pre}-from">${th("Od")}</label><input class="ctrl" type="date" id="${pre}-from" value="${esc(f.from || Dates.monthStart(Dates.ym(App.today())))}"></div><div class="field"><label for="${pre}-to">${th("Do")}</label><input class="ctrl" type="date" id="${pre}-to" value="${esc(f.to || App.today())}"></div>` : ""}`;
  function bindPeriod(scope, f, pre, rerender) {
    const on = (sfx, k) => { const el = $(`#${pre}-${sfx}`, scope); if (el) el.onchange = e => { f[k] = e.target.value; rerender(); }; };
    on("mode", "mode"); on("date", "date"); on("ym", "ym"); on("year", "year"); on("from", "from"); on("to", "to");
  }
  const rangeOf = f => Dates.range({ mode: f.mode, date: f.date, ym: f.ym, year: f.year, from: f.from, to: f.to }, App.today());
  const searchInput = (id, v, ph) => `<div class="field grow"><label for="${id}">${th("Szukaj")}</label><input class="ctrl" type="search" id="${id}" value="${esc(v)}" placeholder="${esc(ph)}"></div>`;
  function bindSearch(page, id, f, key, self) {
    const el = $(id, page); if (!el) return;
    el.oninput = e => { f[key] = e.target.value; clearTimeout(self._t); self._t = setTimeout(() => { App.render(); const q = $(id); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250); };
  }

  /* ================================================================== */
  /* OPERACJE — rejestr, wersje robocze                                   */
  /* ================================================================== */
  Views.operacje = {
    filtered() {
      const f = App.tabs.ops || (App.tabs.ops = { type: "", status: "", ym: "", q: "", scope: "active" });
      const q = f.q.trim().toLowerCase(), wh = App.user().whId;
      return Store.state.operations.filter(o => (f.scope === "all" || o.whId === wh || o.toWhId === wh) &&
        (!f.type || (f.type === "DIRECT" ? o.direct : f.type === "SPRZEDAZ" ? o.type === "SPRZEDAZ" && !o.direct : o.type === f.type)) &&
        (!f.status || o.status === f.status) && (!f.ym || o.date.startsWith(f.ym)) &&
        (!q || [o.no, o.place, o.userName, opProduct(o), partnerName(opPartnerId(o)), o.extDoc, o.notes, ...o.documents.map(d => d.no)].join(" ").toLowerCase().includes(q)))
        .slice().sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1);
    },
    html() {
      const S = Store.state, f = App.tabs.ops || (App.tabs.ops = { type: "", status: "", ym: "", q: "", scope: "active" });
      const rows = this.filtered();
      const me = App.user();
      const queue = S.drafts.filter(d => d.status === "PENDING" && (R.canApprove(me, d.whId) || d.userId === me.id))
        .sort((a, b) => (a.submittedAt || "") < (b.submittedAt || "") ? -1 : 1);
      const drafts = S.drafts.filter(d => d.status !== "PENDING" && d.whId === me.whId);
      return `<div class="page-head"><div class="titles"><h2>${th("Operacje")}</h2><p>${esc(t("Rejestr wszystkich operacji magazynu {w} ze statusem dokumentu. Kliknij wiersz — szczegóły, powiązania, korekta, anulowanie. Dokumentów zatwierdzonych nie usuwa się.", { w: App.wh().name }))}</p></div>
          <div class="actions">${App.can("op.create") ? `<a class="btn primary" href="#/nowa">${ic("plus", 15)} ${th("Nowa operacja")}</a>` : ""}<button class="btn" type="button" id="ops-csv">${ic("dl", 15)} CSV</button></div></div>
        ${queue.length ? `<div class="card mb4 queue-card" id="approvals"><div class="card-h"><h3>${ic("clock", 16)} ${th("Do zatwierdzenia")}</h3><span class="sub">${esc(t("operacje przekazane przez magazynierów — bez numeru i bez wpływu na stan do czasu zatwierdzenia"))}</span></div>
          <div class="tbl-wrap"><table class="tbl" id="approvals-table"><thead><tr><th>${th("Rodzaj")}</th><th>${th("Operacja")}</th><th>${th("Magazyn")}</th><th>${th("Wprowadził")}</th><th>${th("Przekazano")}</th><th class="r">${th("Wynik")}</th><th></th></tr></thead><tbody>
          ${queue.map(d => { const mine = R.canApprove(me, d.whId); return `<tr data-pending="${esc(d.id)}"><td>${esc(R.OP_TYPES[d.type] ? t(R.OP_TYPES[d.type].label) : d.type)}${d.type === "SPRZEDAZ" && d.draft.sale.direct ? " " + th("(bezpośrednia)") : ""}</td><td>${esc(d.summary || "—")}</td><td>${esc(App.whName(d.whId))}</td><td>${esc(d.userName)}</td><td class="nowrap">${esc(Dates.ts(d.submittedAt))}</td><td class="r nowrap">${d.totals ? esc(money(d.totals.result)) : "—"}</td>
            <td class="r nowrap">${mine ? `<a class="btn sm primary" href="#/nowa?draft=${esc(d.id)}" data-review>${ic("check", 13)} ${th("Sprawdź i zatwierdź")}</a> <button class="btn sm danger" type="button" data-reject="${esc(d.id)}">${ic("x", 13)} ${th("Odrzuć")}</button>`
              : `${statusBadge("PENDING")} <a class="btn sm" href="#/nowa?draft=${esc(d.id)}">${th("Wycofaj i edytuj")}</a>`}</td></tr>`; }).join("")}</tbody></table></div></div>` : ""}
        ${drafts.length ? `<div class="card mb4" id="drafts"><div class="card-h"><h3>${th("Wersje robocze (ROBOCZY)")}</h3><span class="sub">${th("bez numeru, bez wpływu na stan")}</span></div><div class="tbl-wrap"><table class="tbl" id="drafts-table"><thead><tr><th>${th("Rodzaj")}</th><th>${th("Autor")}</th><th>${th("Zapisano")}</th><th>${th("Status")}</th><th></th></tr></thead><tbody>
          ${drafts.map(d => `<tr><td>${esc(R.OP_TYPES[d.type] ? t(R.OP_TYPES[d.type].label) : d.type)}${d.type === "SPRZEDAZ" && d.draft.sale.direct ? " " + th("(bezpośrednia)") : ""}</td><td>${esc(d.userName)}</td><td>${esc(Dates.ts(d.savedAt))}</td><td>${statusBadge("DRAFT")}${d.rejectReason ? `<br><small class="neg">${esc(t("odrzucona: {r}", { r: d.rejectReason }))}</small>` : ""}</td>
            <td class="r nowrap">${d.userId === App.user().id ? `<a class="btn sm" href="#/nowa?draft=${esc(d.id)}">${th("Otwórz")}</a>` : ""} ${d.userId === App.user().id || App.can("documents.cancel") ? `<button class="btn sm danger" type="button" data-deldraft="${esc(d.id)}">${ic("trash", 13)} ${th("Usuń szkic")}</button>` : ""}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
        <div class="card"><div class="toolbar">
          <div class="field"><label for="o-type">${th("Rodzaj")}</label><select class="ctrl" id="o-type">${[["", N_("Wszystkie")], ["ZAKUP", N_("Zakup")], ["SPRZEDAZ", N_("Sprzedaż (WZ)")], ["DIRECT", N_("Sprzedaż bezpośrednia")], ["PRODUKCJA", N_("Produkcja na magazyn")], ["MM", "MM"]].map(([v, l]) => `<option value="${v}" ${f.type === v ? "selected" : ""}>${th(l)}</option>`).join("")}</select></div>
          <div class="field"><label for="o-status">${th("Status")}</label><select class="ctrl" id="o-status"><option value="">${th("Wszystkie")}</option>${["POSTED", "CORRECTED", "CANCELLED"].map(s => `<option value="${s}" ${f.status === s ? "selected" : ""}>${esc(t(R.STATUS[s]))}</option>`).join("")}</select></div>
          <div class="field"><label for="o-ym">${th("Miesiąc")}</label><input class="ctrl" type="month" id="o-ym" value="${esc(f.ym)}"></div>
          <div class="field"><label for="o-scope">${th("Magazyn")}</label><select class="ctrl" id="o-scope"><option value="active" ${f.scope === "active" ? "selected" : ""}>${th("Aktywny")}</option><option value="all" ${f.scope === "all" ? "selected" : ""}>${th("Wszystkie")}</option></select></div>
          ${searchInput("o-q", f.q, t("numer, kontrahent, produkt, uwagi…"))}</div>
          ${opsTable(rows, { showWh: f.scope === "all" })}
          <div class="toolbar" style="border:0"><span class="dim">${esc(tp("{n} operacja|{n} operacje|{n} operacji", rows.length))} · ${esc(t("{n} anulowanych", { n: rows.filter(o => o.status === "CANCELLED").length }))} · ${esc(t("{n} skorygowanych", { n: rows.filter(o => o.status === "CORRECTED").length }))}</span></div></div>`;
    },
    bind(page) {
      const f = App.tabs.ops;
      const on = (id, k) => { const el = $(id, page); if (el) el.onchange = e => { f[k] = e.target.value; App.render(); }; };
      on("#o-type", "type"); on("#o-status", "status"); on("#o-ym", "ym"); on("#o-scope", "scope");
      bindSearch(page, "#o-q", f, "q", this);
      bindOps(page);
      $$("[data-reject]", page).forEach(b => b.onclick = async () => {
        const rec = R.byId(Store.state.drafts, b.dataset.reject);
        const r = await Modal.confirm({ title: t("Odrzucić operację?"), text: t("Operacja wróci do autora ({u}) jako wersja robocza z Twoim komentarzem.", { u: rec ? rec.userName : "" }), ok: t("Odrzuć"), danger: true, input: { label: t("Powód odrzucenia"), required: true } });
        if (!r.ok) return;
        const res = await Store.exec("op.reject", { id: b.dataset.reject, reason: r.value }, N_("Operacje do zatwierdzenia"));
        if (res.ok) Toast.ok(t("Operacja odrzucona"), t("Autor zobaczy powód przy wersji roboczej.")); else Toast.err(t("Nie odrzucono"), res.error);
        App.render();
      });
      $$("[data-deldraft]", page).forEach(b => b.onclick = async () => {
        const r = await Modal.confirm({ title: t("Usunąć wersję roboczą?"), text: t("Szkic nie ma numeru ani wpływu na stan. Usunięcie zostanie zapisane w dzienniku audytu."), ok: t("Usuń szkic"), danger: true });
        if (!r.ok) return;
        const res = await Store.exec("draft.delete", { id: b.dataset.deldraft }, N_("Rejestr operacji"));
        if (res.ok) { Toast.ok(t("Usunięto wersję roboczą")); if (UI.Form.draft && UI.Form.draft.draftId === b.dataset.deldraft) UI.Form.draft.draftId = null; } else Toast.err(t("Nie usunięto"), res.error);
        App.render();
      });
      $("#ops-csv", page).onclick = () => download(`operacje_${App.today()}.csv`, toCSV([t("Nr"), t("Data"), t("Rodzaj"), t("Status"), t("Magazyn"), t("Produkt"), t("Ilość"), t("Kontrahent"), t("Wartość zł"), t("Wynik zł"), t("Użytkownik"), t("Dokumenty")],
        this.filtered().map(o => [o.no, o.date, opTypeLabel(o), t(R.STATUS[o.status]), App.whName(o.whId), opProduct(o), opQty(o), partnerName(opPartnerId(o)), csvNum(opValue(o)), csvNum(o.totals.result), o.userName, o.documents.map(d => d.no).join(" ")])), "text/csv;charset=utf-8");
    }
  };

  /* ================================================================== */
  /* Rejestry dokumentów: Przyjęcia, Wydania/WZ, MM, Dokumenty           */
  /* ================================================================== */
  function docRegister(cfg) {
    return {
      filtered() {
        const f = App.tabs[cfg.id] || (App.tabs[cfg.id] = { type: "", status: "", ym: "", q: "" });
        const q = f.q.trim().toLowerCase(), wh = App.user().whId;
        return allDocuments(Store.state).filter(d => {
          if (cfg.types && !cfg.types.includes(d.type)) return false;
          const inWh = d.whId === wh || (d.type === "MM" && d.toWhId === wh);
          if (!inWh) return false;
          if (cfg.filter && !cfg.filter(d, wh)) return false;
          return (!f.type || d.type === f.type) && (!f.status || d.status === f.status) && (!f.ym || d.date.startsWith(f.ym)) &&
            (!q || [d.no, d.opNo, d.partner, d.place, docContent(d)].join(" ").toLowerCase().includes(q));
        });
      },
      html() {
        const f = App.tabs[cfg.id] || (App.tabs[cfg.id] = { type: "", status: "", ym: "", q: "" });
        const rows = this.filtered();
        const perUnit = {};
        rows.filter(d => d.status !== "CANCELLED" && d.stockQty != null).forEach(d => { const u = App.product(d.productId).unit; perUnit[u] = R.rq((perUnit[u] || 0) + d.stockQty); });
        const value = rows.filter(d => d.status !== "CANCELLED").reduce((a, d) => a + (d.value || 0), 0);
        return `<div class="page-head"><div class="titles"><h2>${th(cfg.title)}</h2><p>${th(cfg.desc)}</p></div>
            <div class="actions">${(cfg.buttons || []).filter(() => App.can("op.create")).map(b => `<a class="btn ${b.primary ? "primary" : ""}" href="${b.href}">${ic("plus", 15)} ${th(b.label)}</a>`).join("")}<button class="btn" type="button" id="reg-csv">${ic("dl", 15)} CSV</button></div></div>
          <div class="card"><div class="toolbar">
            ${cfg.typeOptions ? `<div class="field"><label for="r-type">${th("Typ")}</label><select class="ctrl" id="r-type"><option value="">${th("Wszystkie")}</option>${cfg.typeOptions.map(([v, l]) => `<option value="${v}" ${f.type === v ? "selected" : ""}>${esc(v)} — ${th(l)}</option>`).join("")}</select></div>` : ""}
            <div class="field"><label for="r-status">${th("Status")}</label><select class="ctrl" id="r-status"><option value="">${th("Wszystkie")}</option>${["POSTED", "CORRECTED", "CANCELLED"].map(s => `<option value="${s}" ${f.status === s ? "selected" : ""}>${esc(t(R.STATUS[s]))}</option>`).join("")}</select></div>
            <div class="field"><label for="r-ym">${th("Miesiąc")}</label><input class="ctrl" type="month" id="r-ym" value="${esc(f.ym)}"></div>
            ${searchInput("r-q", f.q, t("numer, kontrahent, miejsce…"))}</div>
            ${rows.length ? `<div class="tbl-wrap"><table class="tbl" id="docs-table"><thead><tr><th>${th("Nr dokumentu")}</th><th>${th("Typ")}</th><th>${th("Data")}</th><th>${th("Treść")}</th><th class="r">${th("Ilość")}</th><th class="r">${th("Wartość")}</th><th>${th("Kontrahent")}</th><th>${th("Miejsce transportu")}</th><th>${th("Wpływ na stan")}</th><th>${th("Status")}</th><th></th></tr></thead><tbody>
              ${rows.map((d, i) => `<tr class="${d.status === "CANCELLED" ? "void" : ""}"><td class="mono nowrap">${esc(d.no)}</td><td><span class="badge">${d.type}</span></td><td class="nowrap">${esc(Dates.pl(d.date))}</td>
                <td>${esc(docContent(d))}</td><td class="r nowrap">${d.qty != null ? esc(fmtQ(d.qty) + " " + Units.label(d.unit)) : "—"}</td>
                <td class="r nowrap">${d.value ? esc(money(d.value)) : "—"}</td><td>${esc(d.partner || (d.transport && (d.transport.company || d.transport.carrier)) || "")}</td>
                <td>${esc(d.place || "—")}</td><td>${stockLbl(d)}</td><td>${statusBadge(d.status)}</td>
                <td class="r nowrap"><button class="btn sm" type="button" data-view="${i}">${th("Podgląd")}</button>${d.opId ? ` <button class="btn sm" type="button" data-opd="${esc(d.opId)}">${th("Operacja")}</button>` : ""}</td></tr>`).join("")}
              </tbody><tfoot><tr><td colspan="4">${th("Razem (bez anulowanych)")}</td><td class="r">${esc(Object.entries(perUnit).map(([u, q]) => `${fmtQ(q)} ${Units.label(u)}`).join(" · ") || "—")}</td><td class="r">${esc(money(value))}</td><td colspan="5"></td></tr></tfoot></table></div>` : `<div class="empty">${th("Brak dokumentów dla wybranych filtrów.")}</div>`}
          </div>`;
      },
      bind(page) {
        const f = App.tabs[cfg.id], rows = this.filtered();
        const on = (id, k) => { const el = $(id, page); if (el) el.onchange = e => { f[k] = e.target.value; App.render(); }; };
        on("#r-type", "type"); on("#r-status", "status"); on("#r-ym", "ym");
        bindSearch(page, "#r-q", f, "q", this);
        $$("[data-view]", page).forEach(b => b.onclick = () => DocPreview.open(rows[+b.dataset.view]));
        $$("[data-opd]", page).forEach(b => b.onclick = () => OpDetail.open(b.dataset.opd));
        $("#reg-csv", page).onclick = () => download(`${cfg.id}_${App.today()}.csv`, toCSV([t("Nr dokumentu"), t("Typ"), t("Data"), t("Treść"), t("Ilość"), t("Jednostka"), t("Wartość zł"), t("Kontrahent"), t("Miejsce transportu"), t("Wpływ na stan"), t("Status"), t("Operacja")],
          rows.map(d => [d.no, d.type, d.date, docContent(d), csvNum(d.qty), d.unit ? Units.label(d.unit) : "", csvNum(d.value), d.partner || "", d.place || "", d.stock, statusText(d.status), d.opNo || ""])), "text/csv;charset=utf-8");
      }
    };
  }
  Views.przyjecia = docRegister({ id: "przyjecia", title: N_("Przyjęcia"), types: ["PZ", "PW", "MM"], filter: (d, wh) => d.type !== "MM" || d.toWhId === wh, typeOptions: [["PZ", N_("zakup")], ["PW", N_("z produkcji")], ["MM", N_("przychód z innego magazynu")]],
    desc: N_("Dokumenty zwiększające stan aktywnego magazynu: zakupy (PZ), przyjęcia z produkcji (PW) i przesunięcia przychodzące (MM). PW sprzedaży bezpośredniej jest widoczne, ale nie zwiększa stanu końcowego (towar od razu wydany WZ)."),
    buttons: [{ label: N_("Nowy zakup (PZ)"), href: "#/nowa?preset=zakup", primary: true }] });
  Views.wz = docRegister({ id: "wz", title: N_("Wydania / WZ"), types: ["WZ", "RW", "MM"], filter: (d, wh) => d.type !== "MM" || d.whId === wh, typeOptions: [["WZ", N_("sprzedaż")], ["RW", N_("zużycie do produkcji")], ["MM", N_("rozchód do innego magazynu")]],
    desc: N_("Dokumenty zmniejszające stan: sprzedaż (WZ), zużycie surowca (RW) i przesunięcia wychodzące (MM). WZ nie może przekroczyć stanu dostępnego."),
    buttons: [{ label: N_("Nowa sprzedaż (WZ)"), href: "#/nowa?preset=wz", primary: true }] });
  Views.mm = docRegister({ id: "mm", title: N_("Przesunięcia międzymagazynowe (MM)"), types: ["MM"], desc: N_("Rozchód z magazynu źródłowego i przychód w docelowym jednym dokumentem. Stan firmy ogółem się nie zmienia."),
    buttons: [{ label: N_("Nowe przesunięcie MM"), href: "#/nowa?preset=mm", primary: true }] });
  Views.dokumenty = docRegister({ id: "dokumenty", title: N_("Dokumenty"), typeOptions: [["PZ", N_("zakup")], ["RW", N_("zużycie")], ["PW", N_("produkcja")], ["WZ", N_("sprzedaż")], ["MM", N_("przesunięcie")], ["TR", N_("transport")], ["KOR", N_("korekta")], ["AN", N_("anulowanie")], ["IN", N_("inwentaryzacja")], ["BO", N_("bilans otwarcia")]],
    desc: N_("Wszystkie dokumenty aktywnego magazynu z kolumną Status. Anulowanie i korekta tworzą nowe dokumenty (AN, KOR) — dokument pierwotny pozostaje nienaruszony."),
    buttons: [] });

  /* ------------------------------ Produkcja ------------------------------ */
  Views.produkcja = {
    html() {
      const S = Store.state, wh = App.user().whId;
      const f = App.tabs.prod || (App.tabs.prod = { ym: Dates.ym(App.today()), mode: "" });
      const ops = S.operations.filter(o => o.production && (o.whId === wh) && (!f.ym || o.date.startsWith(f.ym)) && (!f.mode || o.production.mode === f.mode)).sort((a, b) => a.date < b.date ? 1 : -1);
      const live = ops.filter(o => o.status !== "CANCELLED");
      const sum = k => R.rq(live.reduce((a, o) => a + (o.production[k] || 0), 0));
      const modeTxt = m => m === "stock" ? t("na magazyn") : m === "direct" ? t("bezpośrednia") : t("z zakupu");
      return `<div class="page-head"><div class="titles"><h2>${th("Produkcja")}</h2><p>${th("Produkcja na magazyn (surowiec ze stanu → produkt na stan), produkcja w łańcuchu zakupu oraz produkcja ze sprzedażą bezpośrednią. Zużycie surowca = produkcja ÷ przelicznik (1 m³ = 4 MP).")}</p></div>
          <div class="actions">${App.can("op.create") ? `<a class="btn primary" href="#/nowa?preset=produkcja">${ic("plus", 15)} ${th("Produkcja na magazyn")}</a><a class="btn" href="#/nowa?preset=bezposrednia">${ic("plus", 15)} ${th("Produkcja + sprzedaż bezp.")}</a>` : ""}<a class="btn" href="#/kwit">${ic("receipt", 15)} ${th("Kwit produkcji dnia")}</a></div></div>
        <div class="card"><div class="toolbar">
          <div class="field"><label for="p-ym">${th("Miesiąc")}</label><input class="ctrl" type="month" id="p-ym" value="${esc(f.ym)}"></div>
          <div class="field"><label for="p-mode">${th("Rodzaj")}</label><select class="ctrl" id="p-mode">${[["", N_("Wszystkie")], ["stock", N_("Na magazyn")], ["chain", N_("Z zakupu (łańcuch)")], ["direct", N_("Bezpośrednia (las)")]].map(([v, l]) => `<option value="${v}" ${f.mode === v ? "selected" : ""}>${th(l)}</option>`).join("")}</select></div></div>
          ${ops.length ? `<div class="tbl-wrap"><table class="tbl" id="prod-table"><thead><tr><th>${th("Nr PW")}</th><th>${th("Data")}</th><th>${th("Rodzaj")}</th><th>${th("Status")}</th><th>${th("Surowiec")}</th><th class="r">${th("Zużycie")}</th><th>${th("Produkt")}</th><th class="r">${th("Produkcja")}</th><th class="r">≈ t / ≈ GJ</th><th class="r">${th("Rąbanie")}</th><th>${th("Operator")}</th></tr></thead><tbody>
            ${ops.map(o => { const X = o.production, out = App.product(X.outProductId), or = Units.orient(X.outQty, out, S.config); return `<tr class="clickable ${o.status === "CANCELLED" ? "void" : ""}" data-opid="${esc(o.id)}"><td class="mono nowrap">${esc((o.documents.find(d => d.type === "PW") || {}).no || o.no)}</td><td class="nowrap">${esc(Dates.pl(o.date))}</td>
              <td>${esc(modeTxt(X.mode))}</td><td>${statusBadge(o.status)}</td><td>${esc(pName(X.rawProductId))}</td>
              <td class="r nowrap">${X.consumeQty !== null ? esc(fmtQ(X.consumeQty) + " " + Units.label(X.consumeUnit)) : "—"}${X.mode === "direct" ? `<br><small class='dim'>${th("nie ze stanu")}</small>` : ""}</td>
              <td>${esc(pName(X.outProductId))}</td><td class="r nowrap"><b>${esc(fmtQ(X.outQty) + " " + Units.label(X.outUnit))}</b></td><td class="r nowrap">${fmt(or.t, 1)} t · ${fmt(or.gj, 0)} GJ</td>
              <td class="r nowrap">${esc(money(X.chippingCost))}<br><small class="dim">${fmt(X.chipRate)} zł/MP</small></td><td>${esc(X.operatorName || o.userName)}</td></tr>`; }).join("")}
            </tbody><tfoot><tr><td colspan="7">${th("Razem (bez anulowanych)")}</td><td class="r">${esc(fmtQ(sum("outQty")))} MP</td><td></td><td class="r">${esc(money(live.reduce((a, o) => a + o.production.chippingCost, 0)))}</td><td></td></tr></tfoot></table></div>` : `<div class="empty">${th("Brak produkcji w wybranym okresie.")}</div>`}</div>`;
    },
    bind(page) {
      const f = App.tabs.prod;
      $("#p-ym", page).onchange = e => { f.ym = e.target.value; App.render(); };
      $("#p-mode", page).onchange = e => { f.mode = e.target.value; App.render(); };
      bindOps(page);
    }
  };

  /* ------------------------- Kwit produkcji dnia ------------------------- */
  function kwitModel(k, whText) {
    const rows = k.rows.map(r => [r.docNo, r.mode, statusText(r.status), r.operator + (r.chipper ? ` (${r.chipper})` : ""), r.raw, r.consume !== null && r.consume !== undefined ? `${fmtQ(r.consume, 6)} ${Units.label(r.consumeUnit)}${r.consumeFromStock ? "" : " " + t("(las)")}` : "—", r.product,
      r.mp !== null ? fmtQ(r.mp) : "—", r.m3 !== null ? fmtQ(r.m3) : "—", fmt(r.t, 2), fmt(r.gj, 1), fmt(r.chipRate), money(r.chipCost), r.notes || ""]);
    const cfg = Store.state.config;
    return {
      title: t("Kwit produkcji dnia {d}", { d: Dates.pl(k.date) }), subtitle: t("Magazyn: {w}", { w: whText }), orientation: "landscape", headerRight: whText, rangeText: Dates.pl(k.date), whText,
      meta: [[t("Data"), Dates.pl(k.date)], [t("Magazyn"), whText], [t("Liczba produkcji"), String(k.totals.count)], [t("Przeliczniki"), `1 m³ = ${fmtQ(cfg.m3_mp)} MP · 1 MP = ${fmt(cfg.mp_t, 2)} t · 1 t = ${fmt(cfg.t_gj, 1)} GJ`]],
      blocks: [
        { type: "kpis", items: [[t("Produkcja"), `${fmtQ(k.totals.mp)} MP`, t("= {q} m³ surowca", { q: fmtQ(k.totals.m3) })], [t("Masa orientacyjna"), `${fmt(k.totals.t, 2)} t`, ""], [t("Energia orientacyjna"), `${fmt(k.totals.gj, 1)} GJ`, ""], [t("Koszt rąbania"), money(k.totals.chipCost), ""]] },
        { type: "h", text: t("Pozycje kwitu") },
        { type: "table", columns: [{ label: t("Nr PW"), w: 1.3 }, { label: t("Rodzaj"), w: 1 }, { label: t("Status"), w: 1.1 }, { label: t("Operator"), w: 1.6 }, { label: t("Surowiec"), w: 1.4 }, { label: t("Zużycie"), w: 1.2, align: "right" }, { label: t("Produkt"), w: 1.6 }, { label: "MP", w: 0.8, align: "right" }, { label: "m³", w: 0.7, align: "right" }, { label: "t", w: 0.8, align: "right" }, { label: "GJ", w: 0.8, align: "right" }, { label: "zł/MP", w: 0.7, align: "right" }, { label: t("Koszt"), w: 1.1, align: "right" }, { label: t("Uwagi"), w: 1.4 }], rows,
          foot: [t("Razem"), "", "", "", "", "", "", fmtQ(k.totals.mp), fmtQ(k.totals.m3), fmt(k.totals.t, 2), fmt(k.totals.gj, 1), "", money(k.totals.chipCost), ""], empty: t("Brak produkcji w tym dniu."), note: t("Anulowane produkcje są pokazane dla kontroli, ale nie wchodzą do sumy. Masa i energia są orientacyjne.") },
        { type: "signatures", labels: [t("Operator rębaka"), t("Magazynier"), t("Kierownik")] }
      ]
    };
  }
  Views.kwit = {
    html() {
      const S = Store.state;
      const f = App.tabs.kwit || (App.tabs.kwit = { date: App.today(), wh: App.user().whId });
      const whId = f.wh === "all" ? null : f.wh;
      const k = R.Reports.productionDay(S, f.date, whId);
      const whText = whId ? App.whName(whId) : allWh();
      const model = kwitModel(k, whText);
      return `<div class="page-head"><div class="titles"><h2>${th("Kwit produkcji dnia")}</h2><p>${th("Zestawienie produkcji z jednego dnia: surowiec, zużycie, produkt, MP, m³, t, GJ, cena i koszt rąbania. Dane z tych samych dokumentów PW/RW co raporty.")}</p></div>
          <div class="actions">${printButtons("kwit")}</div></div>
        <div class="card"><div class="toolbar">
          <div class="field"><label for="k-date">${th("Dzień")}</label><input class="ctrl" type="date" id="k-date" value="${esc(f.date)}" max="${esc(App.today())}"></div>
          <div class="field"><label for="k-wh">${th("Magazyn")}</label><select class="ctrl" id="k-wh">${S.warehouses.map(w => `<option value="${w.id}" ${f.wh === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}<option value="all" ${f.wh === "all" ? "selected" : ""}>${th("Wszystkie")}</option></select></div>
          <button class="btn ghost" type="button" id="k-prev">← ${th("Poprzedni dzień")}</button><button class="btn ghost" type="button" id="k-next">${th("Następny dzień")} →</button></div>
          <div class="card-b"><div class="grid g4" id="kwit-kpis">${model.blocks[0].items.map(([a, b, c]) => `<div class="kpi"><div class="k-t">${esc(a)}</div><div class="k-v">${esc(b)}</div>${c ? `<div class="k-s">${esc(c)}</div>` : ""}</div>`).join("")}</div></div>
          ${renderTable(model.blocks[2], "kwit-table", k.rows.map(r => r.opId))}</div>`;
    },
    bind(page) {
      const f = App.tabs.kwit;
      $("#k-date", page).onchange = e => { f.date = e.target.value || App.today(); App.render(); };
      $("#k-wh", page).onchange = e => { f.wh = e.target.value; App.render(); };
      $("#k-prev", page).onclick = () => { f.date = Dates.addDays(f.date, -1); App.render(); };
      $("#k-next", page).onclick = () => { const n = Dates.addDays(f.date, 1); if (n <= App.today()) { f.date = n; App.render(); } };
      const whId = f.wh === "all" ? null : f.wh, whText = whId ? App.whName(whId) : allWh();
      const model = () => kwitModel(R.Reports.productionDay(Store.state, f.date, whId), whText);
      $("[data-print]", page).onclick = () => Printer.print(model(), "KWIT");
      $("[data-pdf]", page).onclick = () => Printer.pdf(model(), "KWIT", `kwit_produkcji_${f.date}`);
      bindOps(page);
    }
  };
  /** Wartości oznaczane na czerwono (niespójność, brak wyceny, anulowanie) — w każdym języku. */
  const isAlarm = v => { const s = String(v); return [t("NIESPÓJNY"), t("ANULOWANY"), t("BRAK WYCENY")].some(x => s.startsWith(x)); };
  /** Tabela z modelu dokumentu (ta sama treść co w PDF). */
  function renderTable(b, id, opIds, drills, drillTitle) {
    const attrs = i => {
      const cls = [opIds && opIds[i] ? "clickable" : "", drills && drills[i] && drills[i].length ? "drill" : "", b.bold && b.bold.includes(i) ? "b" : ""].filter(Boolean).join(" ");
      return `${cls ? ` class="${cls}"` : ""}${opIds && opIds[i] ? ` data-opid="${esc(opIds[i])}"` : ""}${drills && drills[i] && drills[i].length ? ` data-drill="${esc(drills[i].join(","))}" data-drill-title="${esc(drillTitle || "")}" tabindex="0"` : ""}`;
    };
    return `<div class="tbl-wrap"><table class="tbl" id="${id}"><thead><tr>${b.columns.map(c => `<th class="${c.align === "right" ? "r" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>
      ${b.rows.length ? b.rows.map((r, i) => `<tr${attrs(i)}>${r.map((v, j) => `<td class="${b.columns[j].align === "right" ? "r nowrap" : ""}${isAlarm(v) ? " neg" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${b.columns.length}" class="empty">${esc(b.empty || t("Brak danych."))}</td></tr>`}
      </tbody>${b.foot ? `<tfoot><tr>${b.foot.map((v, j) => `<td class="${b.columns[j].align === "right" ? "r nowrap" : ""}">${esc(v)}</td>`).join("")}</tr></tfoot>` : ""}</table></div>${b.note ? `<p class="help" style="padding:8px 16px">${esc(b.note)}</p>` : ""}`;
  }

  /* ------------------------------ Transport ------------------------------ */
  Views.transport = {
    html() {
      const S = Store.state, wh = App.user().whId;
      const f = App.tabs.tr || (App.tabs.tr = { ym: Dates.ym(App.today()), mode: "" });
      const ops = S.operations.filter(o => o.whId === wh && o.transport && o.transport.mode !== "none" && (!f.ym || o.date.startsWith(f.ym)) && (!f.mode || o.transport.mode === f.mode)).sort((a, b) => a.date < b.date ? 1 : -1);
      const live = ops.filter(o => o.status !== "CANCELLED");
      const byMode = Object.keys(R.TRANSPORT_MODES).filter(k => k !== "none").map(k => { const x = live.filter(o => o.transport.mode === k); return { label: t(R.TRANSPORT_MODES[k]), value: x.length, cost: x.reduce((a, o) => a + o.transport.cost, 0), km: x.reduce((a, o) => a + (o.transport.km || 0), 0), drill: x.map(o => o.id).join(",") }; });
      const trips = live.reduce((a, o) => a + (o.transport.mode !== "train" ? (o.transport.runs || [1]).length : 1), 0);
      return `<div class="page-head"><div class="titles"><h2>${th("Transport")}</h2><p>${th("Kursy własne, zewnętrzne i kolejowe. Transport nie zmienia stanu — to koszt operacji i karta TR.")}</p></div></div>
        <div class="grid g4 mb4">
          <div class="kpi"><div class="k-t">${th("Kursy")}</div><div class="k-v">${trips}</div><div class="k-s">${esc(tp("{n} operacja|{n} operacje|{n} operacji", live.length))}</div></div>
          <div class="kpi"><div class="k-t">${th("Koszt")}</div><div class="k-v">${fmt(live.reduce((a, o) => a + o.transport.cost, 0), 0)}<u>zł</u></div></div>
          <div class="kpi"><div class="k-t">${th("Kilometry")}</div><div class="k-v">${fmtQ(live.reduce((a, o) => a + (o.transport.km || 0), 0), 0)}<u>km</u></div></div>
          <div class="kpi"><div class="k-t">${th("Pociągi")}</div><div class="k-v">${live.filter(o => o.transport.mode === "train").reduce((a, o) => a + o.transport.wagonCount, 0)}<u>${th("wag.")}</u></div><div class="k-s">${fmtQ(live.filter(o => o.transport.mode === "train").reduce((a, o) => a + o.transport.totalT, 0))} t</div></div></div>
        <div class="grid dash-split">
          <div class="card"><div class="toolbar">
            <div class="field"><label for="t-ym">${th("Miesiąc")}</label><input class="ctrl" type="month" id="t-ym" value="${esc(f.ym)}"></div>
            <div class="field"><label for="t-mode">${th("Rodzaj")}</label><select class="ctrl" id="t-mode"><option value="">${th("Wszystkie")}</option>${Object.entries(R.TRANSPORT_MODES).filter(([k]) => k !== "none").map(([k, l]) => `<option value="${k}" ${f.mode === k ? "selected" : ""}>${th(l)}</option>`).join("")}</select></div></div>
            ${ops.length ? `<div class="tbl-wrap"><table class="tbl" id="tr-table"><thead><tr><th>${th("Karta TR")}</th><th>${th("Data")}</th><th>${th("Status")}</th><th>${th("Rodzaj")}</th><th>${th("Przewoźnik / pojazd")}</th><th>${th("Miejsce")}</th><th class="r">km</th><th class="r">${th("Tonaż")}</th><th class="r">${th("Koszt")}</th></tr></thead><tbody>
              ${ops.map(o => { const x = o.transport; return `<tr class="clickable ${o.status === "CANCELLED" ? "void" : ""}" data-opid="${esc(o.id)}"><td class="mono">${esc((o.documents.find(d => d.type === "TR") || {}).no || "")}</td><td class="nowrap">${esc(Dates.pl(o.date))}</td><td>${statusBadge(o.status)}</td><td>${esc(t(R.TRANSPORT_MODES[x.mode]))}</td><td>${esc(transportText(x))}</td><td>${esc(x.place)}</td><td class="r">${fmtQ(x.km || 0)}</td><td class="r">${x.mode === "train" ? `${fmtQ(x.totalT)} t` : "—"}</td><td class="r">${esc(money(x.cost))}</td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">${th("Brak kursów.")}</div>`}</div>
          <div class="card"><div class="card-h"><h3>${th("Kursy wg rodzaju")}</h3></div><div class="card-b">${hbar(byMode, { id: "tr-chart", valueText: i => `${i.value} · ${money(i.cost)}`, tip: i => `<b>${esc(i.label)}</b><br>${esc(tp("{n} operacja|{n} operacje|{n} operacji", i.value))}<br>${esc(money(i.cost))} · ${esc(fmtQ(i.km, 0))} km` })}</div></div></div>`;
    },
    bind(page) {
      const f = App.tabs.tr;
      $("#t-ym", page).onchange = e => { f.ym = e.target.value; App.render(); };
      $("#t-mode", page).onchange = e => { f.mode = e.target.value; App.render(); };
      $$(".hbar-row[data-drill]", page).forEach(el => { el.classList.add("drill"); el.onclick = () => drill(el.dataset.drill.split(",").filter(Boolean), t("transport")); });
      bindOps(page); Tip.bind(page);
    }
  };

  /* ================================================================== */
  /* STANY                                                               */
  /* ================================================================== */
  Views.stany = {
    html() {
      const S = Store.state, cfg = S.config;
      const f = App.tabs.stany || (App.tabs.stany = { to: "", scope: "active" });
      const whs = f.scope === "all" ? S.warehouses : f.scope === "active" ? [App.wh()] : [R.byId(S.warehouses, f.scope)];
      const block = (title, m, whId) => {
        const rows = S.products.filter(p => m.has(p.id) && Math.abs(m.get(p.id)) > R.EPS);
        const perUnit = {}, perT = { t: 0, gj: 0 };
        const body = rows.map(p => {
          const q = m.get(p.id) || 0, o = Units.orient(q, p, cfg);
          perUnit[p.unit] = R.rq((perUnit[p.unit] || 0) + q); perT.t += o.t; perT.gj += o.gj;
          return `<tr class="${whId ? "clickable" : ""}" ${whId ? `data-card="${esc(whId)}|${esc(p.id)}"` : ""}><td><b>${esc(p.name)}</b><br><small class="dim">${esc(p.code)}</small></td>
            <td>${esc(t(R.PRODUCT_CATS[p.cat] || p.cat))}</td>
            <td class="r stock-q" data-native="${esc(p.id)}"><b>${esc(App.qtyNative(q, p.id))}</b></td>
            <td class="r dim" data-mass="${esc(p.id)}">${p.unit === "t" ? "—" : esc(App.mass(q, p.id))}</td>
            <td class="r dim" data-gj="${esc(p.id)}">${esc(App.energy(q, p.id))}</td>
            <td>${esc(whId ? Dates.pl(Stock.lastMove(S, whId, p.id) || "") || "—" : "")}</td>
            <td class="r">${whId ? `<button class="btn sm" type="button">${th("Kartoteka")}</button>` : ""}</td></tr>`;
        }).join("");
        const foot = Object.entries(perUnit).map(([u, q]) => `${fmtQ(q)} ${Units.label(u)}`).join(" · ");
        return `<div class="card mt4"><div class="card-h"><h3>${esc(title)}</h3><span class="sub">${esc(f.to ? t("stan na {d}", { d: Dates.pl(f.to) }) : t("stan bieżący"))}</span></div>
          ${rows.length ? `<div class="tbl-wrap"><table class="tbl" data-stock="${esc(whId || "all")}"><thead><tr><th>${th("Produkt")}</th><th>${th("Kategoria")}</th><th class="r">${th("Stan (jednostka magazynowa)")}</th><th class="r">${th("Masa ≈ t")}</th><th class="r">${th("Energia ≈ GJ")}</th><th>${th("Ostatni ruch")}</th><th></th></tr></thead>
            <tbody>${body}</tbody><tfoot><tr><td colspan="2">${th("Razem wg jednostek (jednostek się nie sumuje)")}</td><td class="r">${esc(foot)}</td><td class="r">≈ ${fmt(perT.t, 0)} t</td><td class="r">≈ ${fmt(perT.gj, 0)} GJ</td><td colspan="2"></td></tr></tfoot></table></div>` : `<div class="empty">${th("Brak stanów.")}</div>`}</div>`;
      };
      const blocks = whs.filter(Boolean).map(wh => block(wh.name, Stock.byProduct(S, wh.id, f.to || null), wh.id)).join("") + (f.scope === "all" ? block(t("Razem firma (wszystkie magazyny)"), Stock.byProduct(S, null, f.to || null), null) : "");
      return `<div class="page-head"><div class="titles"><h2>${th("Stany magazynowe")}</h2>
          <p>${esc(t("Stan w jednostce magazynowej produktu: drewno m³, zrębka MP, PKS i łupina nerkowca t. Masa (≈ t) i energia (≈ GJ, 1 t = {gj} GJ) są orientacyjne — nie zastępują wagi rzeczywistej.", { gj: fmt(cfg.t_gj, 1) }))}</p></div>
          <div class="actions"><button class="btn" type="button" id="stock-csv">${ic("dl", 15)} ${th("Eksport CSV")}</button></div></div>
        <div class="card"><div class="toolbar">
          <div class="field"><label for="st-to">${th("Stan na dzień")}</label><input class="ctrl" type="date" id="st-to" value="${esc(f.to)}" max="${esc(App.today())}"></div>
          <div class="field"><label for="st-scope">${th("Magazyn")}</label><select class="ctrl" id="st-scope"><option value="active" ${f.scope === "active" ? "selected" : ""}>${esc(t("Aktywny ({w})", { w: App.wh().name }))}</option>${S.warehouses.map(w => `<option value="${w.id}" ${f.scope === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}<option value="all" ${f.scope === "all" ? "selected" : ""}>${th("Wszystkie + razem firma")}</option></select></div>
          <button class="btn ghost" type="button" id="st-clear">${th("Stan bieżący")}</button></div></div>
        ${blocks}`;
    },
    bind(page) {
      const f = App.tabs.stany;
      $("#st-to", page).onchange = e => { f.to = e.target.value; App.render(); };
      $("#st-scope", page).onchange = e => { f.scope = e.target.value; App.render(); };
      $("#st-clear", page).onclick = () => { f.to = ""; App.render(); };
      $$("[data-card]", page).forEach(tr => tr.onclick = () => { const [w, p] = tr.dataset.card.split("|"); this.card(w, p); });
      $("#stock-csv", page).onclick = () => {
        const S = Store.state, rows = [];
        for (const wh of S.warehouses) for (const [pid, q] of Stock.byProduct(S, wh.id, f.to || null)) {
          const p = App.product(pid); if (!p || Math.abs(q) < R.EPS) continue;
          const o = Units.orient(q, p, S.config);
          rows.push([wh.name, p.code, p.name, csvNum(q), Units.label(p.unit), csvNum(o.t), csvNum(o.gj)]);
        }
        download(`stany_${f.to || App.today()}.csv`, toCSV([t("Magazyn"), t("Kod"), t("Produkt"), t("Ilość"), t("Jednostka magazynowa"), t("Masa orientacyjna t"), t("Energia orientacyjna GJ")], rows), "text/csv;charset=utf-8");
      };
    },
    card(whId, pid) {
      const S = Store.state, p = App.product(pid), wh = R.byId(S.warehouses, whId);
      const rows = Stock.card(S, whId, pid);
      const m = Modal.open({
        title: t("Kartoteka: {p}", { p: p.name }), sub: esc(t("{w} · jednostka magazynowa {u}", { w: wh.name, u: Units.label(p.unit) })), xwide: true, id: "stock-card",
        body: `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${th("Data")}</th><th>${th("Dokument")}</th><th>${th("Rodzaj")}</th><th class="r">${th("Przychód")}</th><th class="r">${th("Rozchód")}</th><th class="r">${th("Saldo")}</th><th class="r">≈ t</th><th class="r">≈ GJ</th></tr></thead><tbody>
          ${rows.map(r => { const o = Units.orient(r.balance, p, S.config); return `<tr class="${r.opId ? "clickable" : ""}" ${r.opId ? `data-opid="${esc(r.opId)}"` : ""}><td>${esc(Dates.pl(r.date))}</td><td class="mono">${esc(r.docNo)}</td><td>${esc(t(R.KINDS[r.kind].label))}${r.direct ? " · " + th("bezpośrednio") : ""}</td>
            <td class="r">${r.qty > 0 ? esc(App.qtyNative(r.qty, pid)) : ""}</td><td class="r">${r.qty < 0 ? esc(App.qtyNative(-r.qty, pid)) : ""}</td>
            <td class="r"><b>${esc(App.qtyNative(r.balance, pid))}</b></td><td class="r dim">${fmt(o.t, 1)}</td><td class="r dim">${fmt(o.gj, 0)}</td></tr>`; }).join("")}</tbody></table></div>`
      });
      $$("[data-opid]", m.el).forEach(tr => tr.onclick = () => { m.close(); OpDetail.open(tr.dataset.opid); });
    }
  };

  /* ================================================================== */
  /* HISTORIA — rejestr ruchów i dziennik audytu                          */
  /* ================================================================== */
  function historyModel(rows, f, rangeText, whText) {
    return {
      title: t("Historia operacji — rejestr ruchów"), subtitle: `${whText} · ${rangeText}`, orientation: "landscape", headerRight: whText, rangeText, whText,
      meta: [[t("Okres"), rangeText], [t("Magazyn"), whText], [t("Produkt"), f.productId ? pName(f.productId) : t("wszystkie")], [t("Typ"), f.type ? t(R.HISTORY_TYPES[f.type]) : t("wszystkie")], [t("Kontrahent"), f.partnerId ? partnerName(f.partnerId) : t("wszyscy")], [t("Pozycji"), String(rows.length)]],
      blocks: [{ type: "table", size: 7, columns: [{ label: t("Data"), w: 1.1 }, { label: t("Godz."), w: 0.6 }, { label: t("Użytkownik"), w: 1.4 }, { label: t("Typ"), w: 1.3 }, { label: t("Dokument"), w: 1.4 }, { label: t("Magazyn"), w: 1.2 }, { label: t("Produkt"), w: 1.8 }, { label: t("Stan przed"), w: 1.1, align: "right" }, { label: t("Zmiana"), w: 1.1, align: "right" }, { label: t("Stan po"), w: 1.1, align: "right" }, { label: t("Jedn."), w: 0.5 }, { label: t("Kontrahent"), w: 1.6 }, { label: t("Powiązana"), w: 1.3 }, { label: t("Status"), w: 1.2 }],
        rows: rows.map(r => [Dates.pl(r.date), r.time, r.user, r.typeLabel, r.docNo, r.whName, r.productName, r.before === null ? "" : fmtQ(r.before), r.change === null ? "" : (r.change > 0 ? "+" : "") + fmtQ(r.change, 6), r.after === null ? "" : fmtQ(r.after), Units.label(r.unit), r.partner, r.related, t(R.STATUS[r.status] || r.status)]) }]
    };
  }
  const AUDIT_AREAS = [["", N_("Wszystkie")], ["operation", N_("Operacje")], ["draft", N_("Wersje robocze")], ["inventory", N_("Inwentaryzacja")], ["fleet", N_("Flota")], ["master", N_("Kartoteki")], ["partner", N_("Kontrahenci")], ["user", N_("Użytkownicy")], ["ledger", N_("Księga / bilans")], ["report", N_("Wydruki i PDF")], ["system", N_("System")]];
  Views.historia = {
    f() { return App.tabs.hist || (App.tabs.hist = { tab: "moves", mode: "month", ym: Dates.ym(App.today()), wh: App.user().whId, productId: "", type: "", userId: "", partnerId: "", status: "", q: "", aUser: "", aEntity: "", aq: "" }); },
    rows() {
      const f = this.f(), rg = rangeOf(f);
      return R.Reports.history(Store.state, { from: rg.from, to: rg.to, whId: f.wh === "all" ? null : f.wh, productId: f.productId, type: f.type, userId: f.userId, partnerId: f.partnerId, status: f.status, q: f.q });
    },
    auditRows() {
      const S = Store.state, f = this.f(), rg = rangeOf(f), q = f.aq.trim().toLowerCase();
      return S.audit.filter(a => a.ts.slice(0, 10) >= rg.from && a.ts.slice(0, 10) <= rg.to && (!f.aUser || a.userId === f.aUser) && (!f.aEntity || a.entity === f.aEntity) &&
        (!q || [a.action, R.auditText(a), a.source, a.opNo, a.relatedNo, a.userName, a.reason, JSON.stringify(a.after)].join(" ").toLowerCase().includes(q))).slice().sort((a, b) => a.ts < b.ts ? 1 : -1);
    },
    html() {
      const S = Store.state, f = this.f(), rg = rangeOf(f);
      const sel = (id, label, opts, v) => `<div class="field"><label for="${id}">${esc(label)}</label><select class="ctrl" id="${id}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(v) === String(k) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
      let body;
      if (f.tab === "moves") {
        const rows = this.rows();
        const shown = rows.slice(-600).reverse();
        body = `<div class="card"><div class="toolbar">
            ${periodControls(f, "h")}
            ${sel("h-wh", t("Magazyn"), [["all", t("Wszystkie")]].concat(S.warehouses.map(w => [w.id, w.name])), f.wh)}
            ${sel("h-product", t("Produkt"), [["", t("Wszystkie")]].concat(S.products.map(p => [p.id, p.name])), f.productId)}
            ${sel("h-type", t("Typ operacji"), [["", t("Wszystkie")]].concat(Object.entries(R.HISTORY_TYPES).map(([k, v]) => [k, t(v)])), f.type)}
            ${sel("h-user", t("Użytkownik"), [["", t("Wszyscy")]].concat(S.users.map(u => [u.id, u.name])), f.userId)}
            ${sel("h-partner", t("Kontrahent"), [["", t("Wszyscy")]].concat(S.partners.map(p => [p.id, p.name])), f.partnerId)}
            ${sel("h-status", t("Status"), [["", t("Wszystkie")], ["POSTED", t(R.STATUS.POSTED)], ["CORRECTED", t(R.STATUS.CORRECTED)], ["CANCELLED", t(R.STATUS.CANCELLED)]], f.status)}
            ${searchInput("h-q", f.q, t("dokument, produkt, uwagi…"))}
            <div class="row wrap">${printButtons("hist")}<button class="btn" type="button" id="h-csv">${ic("dl", 15)} CSV</button></div></div>
          ${shown.length ? `<div class="tbl-wrap"><table class="tbl dense" id="hist-table"><thead><tr><th>${th("Data")}</th><th>${th("Godz.")}</th><th>${th("Użytkownik")}</th><th>${th("Typ")}</th><th>${th("Nr dokumentu")}</th><th>${th("Magazyn")}</th><th>${th("Produkt")}</th><th class="r">${th("Ilość")}</th><th>${th("Jedn.")}</th><th class="r">${th("Stan przed")}</th><th class="r">${th("Zmiana")}</th><th class="r">${th("Stan po")}</th><th>${th("Kontrahent")}</th><th>${th("Powiązana operacja")}</th><th>${th("Uwagi")}</th><th>${th("Status")}</th></tr></thead><tbody>
            ${shown.map(r => `<tr class="${r.opId ? "clickable" : ""} ${r.status === "CANCELLED" ? "void" : ""}" ${r.opId ? `data-opid="${esc(r.opId)}"` : ""}><td class="nowrap">${esc(Dates.pl(r.date))}</td><td>${esc(r.time)}</td><td>${esc(r.user)}</td><td><span class="badge ht-${esc(r.type)}">${esc(r.typeLabel)}</span></td><td class="mono nowrap">${esc(r.docNo)}</td><td>${esc(r.whName)}</td><td>${esc(r.productName)}</td>
              <td class="r nowrap">${r.qty === null ? "—" : esc(fmtQ(r.qty))}</td><td>${esc(Units.label(r.unit))}</td><td class="r nowrap">${r.before === null ? "—" : esc(fmtQ(r.before))}</td><td class="r nowrap">${r.change === null ? "—" : `<span class="${r.change < 0 ? "neg" : "pos"}">${r.change > 0 ? "+" : ""}${esc(fmtQ(r.change, 6))}</span>`}</td><td class="r nowrap"><b>${r.after === null ? "—" : esc(fmtQ(r.after))}</b></td>
              <td>${esc(r.partner)}</td><td class="mono">${esc(r.related)}</td><td>${esc(r.notes || "")}</td><td>${statusBadge(r.status)}</td></tr>`).join("")}</tbody></table></div>
            <div class="toolbar" style="border:0"><span class="dim">${esc(t("{n} ruchów w zakresie {r}", { n: rows.length, r: rg.label }))}${rows.length > 600 ? " " + esc(t("(pokazano 600 najnowszych — pełna lista w CSV / PDF)")) : ""}. ${th("Stan przed/po liczony osobno dla każdej pary magazyn × produkt.")}</span></div>` : `<div class="empty">${th("Brak ruchów dla wybranych filtrów.")}</div>`}</div>`;
      } else {
        const rows = this.auditRows();
        body = `<div class="card"><div class="toolbar">
            ${periodControls(f, "h")}
            ${sel("a-user", t("Użytkownik"), [["", t("Wszyscy")], ["system", t("System")]].concat(S.users.map(u => [u.id, u.name])), f.aUser)}
            ${sel("a-entity", t("Obszar"), AUDIT_AREAS.map(([k, l]) => [k, t(l)]), f.aEntity)}
            ${searchInput("a-q", f.aq, t("numer, akcja, powód…"))}
            <button class="btn" type="button" id="a-csv">${ic("dl", 15)} CSV</button></div>
          ${rows.length ? `<div class="tbl-wrap"><table class="tbl" id="audit-table"><thead><tr><th>${th("Czas")}</th><th>${th("Użytkownik")}</th><th>${th("Obiekt")}</th><th>${th("Akcja")}</th><th>${th("Powód")}</th><th>${th("Źródło")}</th><th>${th("Stan przed / po")}</th></tr></thead><tbody>
            ${rows.slice(0, 400).map(a => `<tr><td class="nowrap">${esc(Dates.ts(a.ts, true))}</td><td>${esc(a.userName === "System" ? t("System") : a.userName)}</td><td class="mono">${esc(a.opNo || a.entityId || "")}${a.relatedNo ? `<br><small class="dim">${esc(a.relatedNo)}</small>` : ""}</td><td>${esc(R.auditText(a))}</td><td>${esc(R.trReason(a.reason || ""))}</td><td>${esc(t(a.source))}</td>
              <td><details class="audit"><summary>${th("pokaż")}</summary><div class="grid g2 mt2"><div><small class="dim">${th("Przed")}</small><pre class="json">${esc(JSON.stringify(a.before, null, 1))}</pre></div><div><small class="dim">${th("Po")}</small><pre class="json">${esc(JSON.stringify(a.after, null, 1))}</pre></div></div></details></td></tr>`).join("")}
            </tbody></table></div><div class="toolbar" style="border:0"><span class="dim">${esc(tp("{n} wpis|{n} wpisy|{n} wpisów", rows.length))}${rows.length > 400 ? " " + esc(t("(pokazano 400 najnowszych)")) : ""}</span></div>` : `<div class="empty">${th("Brak wpisów dla filtrów.")}</div>`}</div>`;
      }
      return `<div class="page-head"><div class="titles"><h2>${th("Historia operacji")}</h2><p>${th("Rejestr ruchów magazynowych ze stanem przed / zmianą / stanem po oraz dziennik audytu (kto, kiedy, co zmienił, powód). Historii nie edytuje się i nie usuwa — błędy poprawia korekta lub anulowanie.")}</p></div></div>
        <div class="tabs" role="tablist">${[["moves", N_("Rejestr ruchów")], ["audit", N_("Dziennik audytu")]].map(([k, l]) => `<button class="tab" type="button" role="tab" aria-selected="${k === f.tab}" data-htab="${k}">${th(l)}</button>`).join("")}</div>${body}`;
    },
    bind(page) {
      const f = this.f();
      $$("[data-htab]", page).forEach(b => b.onclick = () => { f.tab = b.dataset.htab; App.render(); });
      bindPeriod(page, f, "h", () => App.render());
      const on = (id, k) => { const el = $(id, page); if (el) el.addEventListener("change", e => { f[k] = e.target.value; App.render(); }); };
      on("#h-wh", "wh"); on("#h-product", "productId"); on("#h-type", "type"); on("#h-user", "userId"); on("#h-partner", "partnerId"); on("#h-status", "status");
      on("#a-user", "aUser"); on("#a-entity", "aEntity");
      bindSearch(page, "#h-q", f, "q", this); bindSearch(page, "#a-q", f, "aq", this);
      bindOps(page);
      const rg = rangeOf(f), whText = f.wh === "all" ? allWh() : App.whName(f.wh);
      const p = $("[data-print]", page); if (p) p.onclick = () => Printer.print(historyModel(this.rows(), f, rg.label, whText), "RAP");
      const d = $("[data-pdf]", page); if (d) d.onclick = () => Printer.pdf(historyModel(this.rows(), f, rg.label, whText), "RAP", `historia_${rg.from}_${rg.to}`);
      const c = $("#h-csv", page);
      if (c) c.onclick = () => download(`historia_${rg.from}_${rg.to}.csv`, toCSV([t("Data"), t("Godzina"), t("Użytkownik"), t("Typ"), t("Nr dokumentu"), t("Magazyn"), t("Produkt"), t("Ilość"), t("Jednostka"), t("Stan przed"), t("Zmiana"), t("Stan po"), t("Kontrahent"), t("Powiązana operacja"), t("Uwagi"), t("Status")],
        this.rows().map(r => [r.date, r.time, r.user, r.typeLabel, r.docNo, r.whName, r.productName, csvNum(r.qty), Units.label(r.unit), csvNum(r.before), csvNum(r.change), csvNum(r.after), r.partner, r.related, r.notes || "", t(R.STATUS[r.status] || r.status)])), "text/csv;charset=utf-8");
      const a = $("#a-csv", page);
      if (a) a.onclick = () => download(`dziennik_audytu_${rg.from}_${rg.to}.csv`, toCSV([t("Czas"), t("Użytkownik"), t("Obiekt"), t("Akcja"), t("Powód"), t("Źródło"), t("Stan przed"), t("Stan po")],
        this.auditRows().map(x => [x.ts, x.userName, x.opNo || x.entityId || "", R.auditText(x), x.reason || "", t(x.source), JSON.stringify(x.before), JSON.stringify(x.after)])), "text/csv;charset=utf-8");
    }
  };

  /* ================================================================== */
  /* RAPORTY                                                              */
  /* ================================================================== */
  const Reports = {
    f() { return App.tabs.rep || (App.tabs.rep = { mode: "month", ym: Dates.ym(App.today()), wh: "all", productId: "", partnerId: "", view: "business" }); },
    compute() {
      const f = this.f(), rg = rangeOf(f), S = Store.state;
      const rep = R.Reports.business(S, { mode: rg.mode, from: rg.from, to: rg.to, whId: f.wh === "all" ? null : f.wh, productId: f.productId || null, partnerId: f.partnerId || null });
      const months = rg.mode === "year" ? Array.from({ length: 12 }, (_, i) => `${rg.year}-${String(i + 1).padStart(2, "0")}`).filter(m => Dates.monthStart(m) <= App.today()).map(m => ({ ym: m, r: R.Reports.business(S, { mode: "month", from: Dates.monthStart(m), to: Dates.monthEnd(m), whId: f.wh === "all" ? null : f.wh, productId: f.productId || null, partnerId: f.partnerId || null }) })) : [];
      return { f, rg, rep, months, whText: f.wh === "all" ? allWh() : App.whName(f.wh) };
    },
    /** Model raportu — ten sam dla ekranu (tabele), wydruku i PDF. */
    model(c) {
      const { f, rg, rep, months, whText } = c, S = Store.state, cfg = S.config;
      const q = (v, pid) => App.qtyNative(v, pid);
      const recon = rep.recon.map(r => [r.name, Units.label(r.unit), fmtQ(r.opening), fmtQ(r.ZAKUP), fmtQ(r.PRODUKCJA), fmtQ(r.ZUZYCIE), fmtQ(r.SPRZEDAZ), fmtQ(r.BEZP), fmtQ(r.MM), fmtQ(r.INNE), fmtQ(r.closing), fmt(r.closingT, 1), fmt(r.closingGJ, 0), r.consistent ? "OK" : t("NIESPÓJNY (księga: {q})", { q: fmtQ(r.actual) })]);
      const blocks = [
        { type: "kpis", items: [
          [t("Zakupy"), money(rep.purchases.value), `${tp("{n} operacja|{n} operacje|{n} operacji", rep.purchases.count)} · ${qtyByUnit(rep.purchases.byUnit)}`],
          [t("Produkcja"), `${fmtQ(rep.production.chippingMP)} MP`, t("rąbanie {m}", { m: money(rep.production.chippingCost) })],
          [t("Sprzedaż z magazynu"), money(rep.sales.value), qtyByUnit(rep.sales.byUnit).replace(/-/g, "")],
          [t("Sprzedaż bezpośrednia"), money(rep.sales.valueDirect), tp("{n} operacja|{n} operacje|{n} operacji", rep.sales.countDirect)],
          [t("Transport"), money(rep.transport.cost), `${tp("{n} kurs|{n} kursy|{n} kursów", rep.transport.count)} · ${fmtQ(rep.transport.km, 0)} km`],
          [t("Korekty / anulowania"), `${rep.corrections.length} / ${rep.cancellations.length}`, t("dokumenty KOR / AN w okresie")]] },
        { type: "h", text: t("Bilans stanów: stan pocz. + przyjęcia + produkcja − zużycie − sprzedaż ± MM = stan końc.") },
        { type: "table", size: 7, columns: [{ label: t("Produkt"), w: 2.2 }, { label: t("Jedn."), w: 0.6 }, { label: t("Stan pocz."), w: 1.1, align: "right" }, { label: t("Zakup (PZ)"), w: 1, align: "right" }, { label: t("Produkcja (PW)"), w: 1.1, align: "right" }, { label: t("Zużycie (RW)"), w: 1, align: "right" }, { label: t("Sprzedaż (WZ)"), w: 1.1, align: "right" }, { label: t("Bezp. PW−WZ"), w: 1, align: "right" }, { label: "MM ±", w: 0.9, align: "right" }, { label: t("Inw./BO"), w: 0.9, align: "right" }, { label: t("Stan końc."), w: 1.1, align: "right" }, { label: "≈ t", w: 0.8, align: "right" }, { label: "≈ GJ", w: 0.9, align: "right" }, { label: t("Kontrola"), w: 1.3 }],
          rows: recon, empty: f.partnerId ? t("Bilans stanów nie jest liczony dla filtra kontrahenta (stan nie należy do kontrahenta).") : t("Brak ruchów i stanów w okresie."), note: t("Ilości w jednostce produktu — jednostek się nie sumuje. Wartości netto po korektach i anulowaniach (korekta/anulowanie ujmowane w dacie dokumentu KOR/AN). Kontrola porównuje stan końcowy z bilansu ze stanem z księgi na {d}.", { d: Dates.pl(rg.to) }) },
        { type: "h", text: t("Zakupy") },
        { type: "table", columns: [{ label: t("Dostawca"), w: 3 }, { label: t("Ilość"), w: 2, align: "right" }, { label: t("Wartość"), w: 1.5, align: "right" }, { label: t("Operacje"), w: 1, align: "right" }], rows: rep.purchases.suppliers.map(s => [s.name, qtyByUnit(s.byUnit), money(s.value), String(s.opIds.length)]), foot: [t("Razem"), qtyByUnit(rep.purchases.byUnit), money(rep.purchases.value), String(rep.purchases.count)] },
        { type: "h", text: t("Produkcja i koszt rąbania") },
        { type: "table", columns: [{ label: t("Produkt"), w: 3 }, { label: t("Rodzaj"), w: 2 }, { label: t("Ilość"), w: 1.5, align: "right" }, { label: "≈ t / ≈ GJ", w: 2, align: "right" }], rows: rep.production.products.map(p => [p.name, t("na stan"), q(p.qty, p.productId), (() => { const o = Units.orient(p.qty, App.product(p.productId), cfg); return `${fmt(o.t, 1)} t · ${fmt(o.gj, 0)} GJ`; })()]).concat(rep.production.directProducts.map(p => [p.name, t("bezpośrednia (las)"), q(p.qty, p.productId), ""])), foot: [t("Koszt rąbania"), "", `${fmtQ(rep.production.chippingMP)} MP`, money(rep.production.chippingCost)] },
        { type: "h", text: t("Zużycie surowca") },
        { type: "table", columns: [{ label: t("Surowiec"), w: 3 }, { label: t("Magazyn"), w: 2 }, { label: t("Zużycie"), w: 1.5, align: "right" }, { label: t("Operacje"), w: 1, align: "right" }], rows: rep.consumption.map(c2 => [c2.name, c2.whName, q(c2.qty, c2.productId), String(c2.opIds.length)]) },
        { type: "h", text: t("Sprzedaż") },
        { type: "table", columns: [{ label: t("Odbiorca"), w: 3 }, { label: t("Ilość"), w: 2, align: "right" }, { label: t("Wartość"), w: 1.5, align: "right" }, { label: t("Operacje"), w: 1, align: "right" }], rows: rep.sales.buyers.map(b => [b.name, qtyByUnit(b.byUnit), money(b.value), String(b.opIds.length)]), foot: [t("Razem (WZ + bezpośrednia)"), "", money(rep.sales.value + rep.sales.valueDirect), String(rep.sales.count)] },
        { type: "h", text: t("Przesunięcia międzymagazynowe (MM)") },
        { type: "table", columns: [{ label: t("Dokument"), w: 1.5 }, { label: t("Data"), w: 1 }, { label: t("Z magazynu"), w: 2 }, { label: t("Do magazynu"), w: 2 }, { label: t("Produkt"), w: 2 }, { label: t("Ilość"), w: 1.3, align: "right" }, { label: t("Status"), w: 1.2 }], rows: rep.mm.map(m => [m.no, Dates.pl(m.date), m.from, m.to, m.name, `${fmtQ(m.qty)} ${Units.label(m.unit)}`, statusText(m.status)]) },
        { type: "h", text: t("Transport") },
        { type: "table", columns: [{ label: t("Przewoźnik / tryb"), w: 3 }, { label: t("Kursy"), w: 1, align: "right" }, { label: "km", w: 1, align: "right" }, { label: t("Koszt"), w: 1.5, align: "right" }], rows: rep.transport.carriers.map(x => [x.name, String(x.count), fmtQ(x.km, 0), money(x.cost)]), foot: [t("Razem"), String(rep.transport.count), fmtQ(rep.transport.km, 0), money(rep.transport.cost)], note: rep.transport.wagons ? t("Pociągi: {w} wagonów · {q} t.", { w: rep.transport.wagons, q: fmtQ(rep.transport.trainT) }) : "" },
        { type: "h", text: t("Wycena stanu (orientacyjna — średnia cena zakupu)") },
        { type: "table", columns: [{ label: t("Produkt"), w: 3 }, { label: t("Cena śr."), w: 1.3, align: "right" }, { label: t("Stan pocz."), w: 1.4, align: "right" }, { label: t("Przychody"), w: 1.4, align: "right" }, { label: t("Rozchody"), w: 1.4, align: "right" }, { label: t("Stan końc."), w: 1.4, align: "right" }], rows: rep.valuation.map(v => v.priced ? [v.name, `${fmt(v.avg, 2)} zł/${Units.label(v.unit)}`, money(v.openingValue), money(v.inValue), money(v.outValue), money(v.closingValue)] : [v.name, t("BRAK WYCENY"), "—", "—", "—", "—"]), note: t("„Brak wyceny” = brak zakupów tego produktu do końca okresu (np. bilans otwarcia bez ceny). Pełna wycena magazynowa (FIFO / średnia ruchoma) — etap produkcyjny.") }
      ];
      if (months.length) blocks.push({ type: "h", text: t("Rok {y} — miesiące", { y: rg.year }) }, { type: "table", columns: [{ label: t("Miesiąc"), w: 2 }, { label: t("Zakupy"), w: 1.4, align: "right" }, { label: t("Produkcja MP"), w: 1.2, align: "right" }, { label: t("Rąbanie"), w: 1.3, align: "right" }, { label: t("Sprzedaż"), w: 1.4, align: "right" }, { label: t("Transport"), w: 1.3, align: "right" }, { label: t("Korekty"), w: 0.8, align: "right" }, { label: t("Bilans"), w: 1 }],
        rows: months.map(({ ym, r }) => [Dates.label(ym), money(r.purchases.value), fmtQ(r.production.chippingMP), money(r.production.chippingCost), money(r.sales.value + r.sales.valueDirect), money(r.transport.cost), String(r.corrections.length), r.consistent ? "OK" : t("NIESPÓJNY")]) });
      if (f.view === "audit" || rep.corrections.length || rep.cancellations.length) {
        blocks.push({ type: "h", text: t("Korekty w okresie") }, { type: "table", columns: [{ label: t("Korekta"), w: 1.4 }, { label: t("Dokument"), w: 1.4 }, { label: t("Data"), w: 1 }, { label: t("Użytkownik"), w: 1.6 }, { label: t("Powód"), w: 2.4 }, { label: t("Zmiany"), w: 3.2 }], rows: rep.corrections.map(k => [k.no, k.orig, Dates.pl(k.date), k.user, k.reason, k.changes.map(x => `${t(x.label)}: ${x.beforeText} → ${x.afterText}`).join("; ")]), empty: t("Brak korekt w okresie.") });
        blocks.push({ type: "h", text: t("Anulowania w okresie") }, { type: "table", columns: [{ label: t("Anulowanie"), w: 1.4 }, { label: t("Dokument"), w: 1.4 }, { label: t("Data"), w: 1 }, { label: t("Użytkownik"), w: 1.6 }, { label: t("Przyczyna"), w: 4 }], rows: rep.cancellations.map(k => [k.no, k.orig, Dates.pl(k.date), k.user, k.reason]), empty: t("Brak anulowań w okresie.") });
      }
      if (f.view === "audit") {
        const hist = R.Reports.history(S, { from: rg.from, to: rg.to, whId: f.wh === "all" ? null : f.wh, productId: f.productId || null, partnerId: f.partnerId || null });
        blocks.push({ type: "h", text: t("Widok audytowy — wszystkie ruchy w okresie (z dokumentami anulowanymi i korektami)") }, { type: "table", size: 6.8, columns: [{ label: t("Data"), w: 1 }, { label: t("Dokument"), w: 1.4 }, { label: t("Typ"), w: 1.3 }, { label: t("Magazyn"), w: 1.2 }, { label: t("Produkt"), w: 1.8 }, { label: t("Przed"), w: 1, align: "right" }, { label: t("Zmiana"), w: 1, align: "right" }, { label: t("Po"), w: 1, align: "right" }, { label: t("Użytkownik"), w: 1.4 }, { label: t("Status"), w: 1.1 }],
          rows: hist.filter(h => h.change !== null).map(h => [Dates.pl(h.date), h.docNo, h.typeLabel, h.whName, h.productName, fmtQ(h.before), (h.change > 0 ? "+" : "") + fmtQ(h.change, 6), fmtQ(h.after), h.user, statusText(h.status)]) });
      }
      const closedTxt = rep.closed.length ? rep.closed.map(x => `${x.name}: ${x.closed ? t("ZAMKNIĘTY") : t("otwarty")}`).join(" · ") : "—";
      blocks.push({ type: "p", muted: true, text: t("Status okresu: {s}. Bilans {b}.", { s: closedTxt, b: rep.consistent ? t("spójny") : t("NIESPÓJNY — sprawdź pozycje oznaczone w kolumnie Kontrola") }) });
      blocks.push({ type: "signatures", labels: [t("Sporządził"), t("Kierownik magazynu"), t("Zatwierdził")] });
      const kindTxt = { month: N_("miesięczny"), year: N_("roczny"), day: N_("dzienny"), week: N_("tygodniowy"), custom: N_("okresowy") }[rg.mode] || N_("okresowy");
      return {
        title: t("Raport {k} — {r}", { k: t(kindTxt), r: rg.label }),
        subtitle: `${whText} · ${Dates.pl(rg.from)} – ${Dates.pl(rg.to)} · ${f.view === "audit" ? t("widok audytowy") : t("widok biznesowy")}`, orientation: "landscape", headerRight: whText, rangeText: `${Dates.pl(rg.from)} – ${Dates.pl(rg.to)}`, whText,
        meta: [[t("Magazyn"), whText], [t("Okres"), `${Dates.pl(rg.from)} – ${Dates.pl(rg.to)}`], [t("Produkt"), f.productId ? pName(f.productId) : t("wszystkie")], [t("Kontrahent"), f.partnerId ? partnerName(f.partnerId) : t("wszyscy")], [t("Status okresu"), closedTxt], [t("Bilans"), rep.consistent ? t("spójny") : t("NIESPÓJNY")]],
        blocks
      };
    }
  };
  Views.raporty = {
    html() {
      const S = Store.state, c = Reports.compute(), { f, rep } = c;
      const model = Reports.model(c);
      const tables = model.blocks.filter(b => b.type === "table");
      const drillIds = {
        purchases: rep.purchases.suppliers.map(s => s.opIds), sales: rep.sales.buyers.map(b => b.opIds), consumption: rep.consumption.map(x => x.opIds), mm: rep.mm.map(m => [m.opId]),
        prod: rep.production.products.map(p => p.opIds).concat(rep.production.directProducts.map(p => p.opIds))
      };
      const tableHtml = (b, id, ids) => renderTable(b, id, null, ids, b.columns[0].label);
      const sec = (title, inner, id) => `<div class="card mt4" ${id ? `id="${id}"` : ""}><div class="card-h"><h3>${esc(title)}</h3></div>${inner}</div>`;
      const hBlocks = model.blocks.filter(b => b.type === "h").map(b => b.text);
      return `<div class="page-head"><div class="titles"><h2>${th("Raporty")}</h2><p>${th("Raport okresowy: dzień / tydzień / miesiąc / rok / zakres własny, dla jednego lub wszystkich magazynów. Wartości netto po korektach i anulowaniach. Kliknij wiersz, aby zobaczyć operacje źródłowe. Ekran, wydruk i PDF mają tę samą treść.")}</p></div>
          <div class="actions">${printButtons("rep")}<button class="btn" type="button" id="rep-csv">${ic("dl", 15)} ${th("CSV bilansu")}</button></div></div>
        <div class="card"><div class="toolbar" id="rep-filters">
          ${periodControls(f, "r")}
          <div class="field"><label for="r-wh">${th("Magazyn")}</label><select class="ctrl" id="r-wh"><option value="all" ${f.wh === "all" ? "selected" : ""}>${th("Wszystkie magazyny")}</option>${S.warehouses.map(w => `<option value="${w.id}" ${f.wh === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="r-product">${th("Produkt")}</label><select class="ctrl" id="r-product"><option value="">${th("Wszystkie")}</option>${S.products.map(p => `<option value="${p.id}" ${f.productId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="r-partner">${th("Kontrahent")}</label><select class="ctrl" id="r-partner"><option value="">${th("Wszyscy")}</option>${S.partners.map(p => `<option value="${p.id}" ${f.partnerId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="r-view">${th("Widok")}</label><select class="ctrl" id="r-view"><option value="business" ${f.view === "business" ? "selected" : ""}>${th("Biznesowy (netto)")}</option><option value="audit" ${f.view === "audit" ? "selected" : ""}>${th("Audytowy (wszystkie ruchy)")}</option></select></div></div>
          <div class="card-b"><h3 class="rep-title" id="rep-title">${esc(model.title)}</h3><p class="muted">${esc(model.subtitle)}</p>
            <div class="rep-status mt2">${rep.consistent ? `<span class="badge ok" id="rep-consistent">${ic("check", 12)} ${th("Bilans spójny")}</span>` : `<span class="badge err" id="rep-consistent">${ic("alert", 12)} ${th("Bilans NIESPÓJNY")}</span>`} ${rep.closed.map(x => `<span class="badge ${x.closed ? "ok" : ""}">${esc(x.name)}: ${x.closed ? th("okres zamknięty") : th("okres otwarty")}</span>`).join(" ")}</div>
            <div class="grid g6 mt4" id="rep-kpis">${model.blocks[0].items.map(([a, b, s]) => `<div class="kpi"><div class="k-t">${esc(a)}</div><div class="k-v">${esc(b)}</div>${s ? `<div class="k-s">${esc(s)}</div>` : ""}</div>`).join("")}</div></div></div>
        ${sec(hBlocks[0], tableHtml(tables[0], "rep-recon"), "sec-recon")}
        <div class="grid g2">
          ${sec(hBlocks[1], tableHtml(tables[1], "rep-purchases", drillIds.purchases), "sec-purchases")}
          ${sec(hBlocks[4], tableHtml(tables[4], "rep-sales", drillIds.sales), "sec-sales")}
          ${sec(hBlocks[2], tableHtml(tables[2], "rep-production", drillIds.prod), "sec-production")}
          ${sec(hBlocks[3], tableHtml(tables[3], "rep-consumption", drillIds.consumption), "sec-consumption")}
          ${sec(hBlocks[5], tableHtml(tables[5], "rep-mm", drillIds.mm), "sec-mm")}
          ${sec(hBlocks[6], tableHtml(tables[6], "rep-transport"), "sec-transport")}
        </div>
        ${sec(hBlocks[7], tableHtml(tables[7], "rep-valuation"), "sec-valuation")}
        ${tables.slice(8).map((tb, i) => sec(hBlocks[8 + i], tableHtml(tb, "rep-extra-" + i), "sec-extra-" + i)).join("")}`;
    },
    bind(page) {
      const f = Reports.f();
      bindPeriod(page, f, "r", () => App.render());
      const on = (id, k) => { const el = $(id, page); if (el) el.onchange = e => { f[k] = e.target.value; App.render(); }; };
      on("#r-wh", "wh"); on("#r-product", "productId"); on("#r-partner", "partnerId"); on("#r-view", "view");
      bindDrill(page);
      const c = () => Reports.compute();
      $("[data-print]", page).onclick = () => Printer.print(Reports.model(c()), "RAP");
      $("[data-pdf]", page).onclick = () => { const x = c(); Printer.pdf(Reports.model(x), "RAP", `raport_${x.rg.from}_${x.rg.to}`); };
      $("#rep-csv", page).onclick = () => { const x = c(); download(`bilans_${x.rg.from}_${x.rg.to}.csv`, toCSV([t("Produkt"), t("Jednostka"), t("Stan pocz."), t("Zakup"), t("Produkcja"), t("Zużycie"), t("Sprzedaż WZ"), t("Bezpośrednia PW-WZ"), "MM", t("Inw./BO"), t("Stan końc."), t("Masa t"), t("Energia GJ"), t("Kontrola")],
        x.rep.recon.map(r => [r.name, Units.label(r.unit), csvNum(r.opening), csvNum(r.ZAKUP), csvNum(r.PRODUKCJA), csvNum(r.ZUZYCIE), csvNum(r.SPRZEDAZ), csvNum(r.BEZP), csvNum(r.MM), csvNum(r.INNE), csvNum(r.closing), csvNum(r.closingT), csvNum(r.closingGJ), r.consistent ? "OK" : t("NIESPÓJNY")])), "text/csv;charset=utf-8"); };
    }
  };

  /* ================================================================== */
  /* Inwentaryzacja                                                       */
  /* ================================================================== */
  Views.inwentaryzacja = {
    html() {
      const S = Store.state, wh = App.wh();
      const list = S.inventory.filter(p => p.whId === wh.id).sort((a, b) => a.ym < b.ym ? 1 : -1);
      const sel = App.tabs.inv && list.find(p => p.ym === App.tabs.inv) ? App.tabs.inv : (list[0] ? list[0].ym : null);
      App.tabs.inv = sel;
      const p = sel ? R.Inventory.find(S, wh.id, sel) : null;
      const locked = R.lockedMonth(S, wh.id);
      let detail = `<div class="card"><div class="empty">${th("Otwórz okres, aby rozpocząć spis.")}</div></div>`;
      if (p) {
        const closed = p.status !== "OTWARTA";
        const rows = p.lines.map(l => {
          const pr = App.product(l.productId), has = l.countQty !== null;
          const diff = has ? R.round(l.countQty - l.bookQty, 6) : null;
          return `<tr data-line="${esc(l.productId)}"><td><b>${esc(pr.name)}</b></td><td>${Units.label(l.unit)}</td><td class="r">${fmtQ(l.bookQty)}</td>
            <td class="r" style="min-width:150px">${closed ? `<b>${has ? fmtQ(l.countQty) : "—"}</b>${l.assumed ? ` <span class="badge warn">${th("przyjęto stan księgowy")}</span>` : ""}`
              : `<input class="ctrl num-in" type="text" inputmode="decimal" data-count="${esc(l.productId)}" aria-label="${esc(t("Stan ze spisu: {p}", { p: pr.name }))}" value="${esc(has ? (l.countText || fmtQ(l.countQty)) : "")}" placeholder="${th("wpisz stan")}">`}</td>
            <td class="r" data-diff="${esc(l.productId)}" style="color:${diff === null ? "inherit" : diff < 0 ? "var(--err)" : diff > 0 ? "var(--info)" : "var(--ok)"}">${diff === null ? "—" : (diff > 0 ? "+" : "") + fmtQ(diff) + " " + Units.label(l.unit)}</td>
            <td class="r dim">${diff === null || l.unit === "t" ? "—" : "≈ " + fmt(Units.mass(diff, pr, S.config), 2) + " t"}</td></tr>`;
        }).join("");
        detail = `<div class="card" id="inv-detail" data-status="${esc(p.status)}">
          <div class="card-h"><h3>${esc(t("Okres {ym}", { ym: p.ym }))}</h3><span class="badge ${closed ? "ok" : "warn"}" id="inv-status">${esc(t(R.INV_STATUS[p.status]))}</span>
            <span class="sub">${esc(Dates.label(p.ym))} · ${esc(t("stan księgowy na {d}", { d: Dates.pl(p.cutoff || R.Inventory.cutoff(p.ym, App.today())) }))}</span><span class="spacer"></span>
            ${closed ? "" : `<button class="btn" type="button" id="inv-gen">${ic("layers", 15)} ${p.lines.length ? th("Odśwież listę") : th("Generuj listę")}</button>
              <button class="btn primary" type="button" id="inv-close" ${App.can("inv.close") ? "" : `disabled title="${th("Wymaga roli Kierownik lub Administrator")}"`}>${ic("check", 15)} ${th("Zamknij okres")}</button>`}</div>
          ${closed ? `<div class="card-b" style="padding-bottom:0"><div class="info-line ok">${ic("check", 15)}<span>${esc(t("Okres zamknięty {d} przez {u}.", { d: Dates.ts((p.closedAt || "")), u: t(p.closedBy) }))} ${p.docNo ? t("Różnice zaksięgowano dokumentem <b>{no}</b>.", { no: esc(p.docNo) }) : th("Brak różnic.")} ${esc(t("Operacje z datą do {ym} włącznie są zablokowane — zmiany tylko korektą z bieżącą datą.", { ym: p.ym }))}</span></div></div>` : ""}
          ${p.lines.length ? `<div class="tbl-wrap mt3"><table class="tbl" id="inv-table"><thead><tr><th>${th("Produkt")}</th><th>${th("Jedn.")}</th><th class="r">${th("Stan księgowy")}</th><th class="r">${th("Stan ze spisu")}</th><th class="r">${th("Różnica")}</th><th class="r">${th("Różnica masy")}</th></tr></thead><tbody>${rows}</tbody></table></div>`
            : `<div class="empty">${th("Lista jest pusta — kliknij „Generuj listę”.")}</div>`}
          ${!closed ? `<div class="card-b"><p class="help">${th("Wpisz stan z natury w jednostce magazynowej produktu. Enter lub Tab zapisuje pozycję. Zamknięcie księguje różnice dokumentem IN i blokuje okres.")}</p></div>` : ""}
        </div>`;
      }
      return `<div class="page-head"><div class="titles"><h2>${th("Inwentaryzacja i zamknięcie miesiąca")}</h2>
          <p>${t("Magazyn <b>{w}</b>. Każdy miesiąc to osobny okres: OTWARTA → ZAMKNIĘTA. Zamknięcie zachowuje wszystkie dane okresu, a raport miesiąca pokazuje status „okres zamknięty”.", { w: esc(wh.name) })}${locked ? " " + t("Zamknięte do: <b>{ym}</b>.", { ym: esc(locked) }) : ""}</p></div></div>
        <div class="grid inv-grid" id="inv-grid">
          <div class="stack">
            <div class="card"><div class="card-h"><h3>${th("Otwórz okres")}</h3></div><div class="card-b">
              <div class="field"><label for="inv-ym">${th("Miesiąc")}</label><input class="ctrl" type="month" id="inv-ym" value="${esc(Dates.ym(App.today()))}" max="${esc(Dates.ym(App.today()))}"></div>
              <button class="btn primary mt3" type="button" id="inv-open" style="width:100%" ${App.can("inv.open") ? "" : "disabled"}>${th("Otwórz okres")}</button></div></div>
            <div class="card"><div class="card-h"><h3>${th("Okresy")}</h3></div>
              ${list.length ? `<div class="tbl-wrap"><table class="tbl" id="inv-list"><tbody>${list.map(x => `<tr class="clickable ${x.ym === sel ? "sel" : ""}" data-ym="${esc(x.ym)}"><td><b>${esc(x.ym)}</b><br><small class="dim">${esc(Dates.label(x.ym))}</small></td><td class="r"><span class="badge ${x.status === "OTWARTA" ? "warn" : "ok"}">${esc(t(R.INV_STATUS[x.status]))}</span>${x.auto ? `<br><small class="dim">${th("automatycznie")}</small>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">${th("Brak okresów.")}</div>`}
            </div>
          </div>
          <div>${detail}</div>
        </div>`;
    },
    bind(page) {
      const SRC = N_("Moduł Inwentaryzacja");
      const act = (cmd, args, okMsg) => Store.exec(cmd, args, SRC)
        .then(res => { if (res.ok) { if (okMsg) Toast.ok(okMsg(res)); } else Toast.err(t("Odrzucono"), res.error); App.render(); return res; });
      $("#inv-open", page).onclick = () => { const ym = $("#inv-ym", page).value; act("inv.open", { ym }, () => t("Otwarto okres {ym}", { ym })).then(r => { if (r.ok) { App.tabs.inv = ym; App.render(); } }); };
      $$("[data-ym]", page).forEach(tr => tr.onclick = () => { App.tabs.inv = tr.dataset.ym; App.render(); });
      const ym = App.tabs.inv;
      const gen = $("#inv-gen", page);
      if (gen) gen.onclick = () => act("inv.generate", { ym }, r => t("Lista spisowa: {n} pozycji", { n: r.period.lines.length }));
      const cl = $("#inv-close", page);
      if (cl) cl.onclick = async () => {
        const r = await Modal.confirm({ title: t("Zamknąć okres {ym}?", { ym }), text: t("Różnice zostaną zaksięgowane dokumentem IN, a okres przejdzie w tryb tylko do odczytu. Dane okresu pozostają bez zmian. Tej czynności nie można cofnąć."), ok: t("Zamknij okres"), danger: true });
        if (r.ok) act("inv.close", { ym }, res => t("Okres {ym} zamknięty", { ym }) + (res.docNo ? ` · ${res.docNo}` : ""));
      };
      $$("[data-count]", page).forEach(inp => {
        const commit = () => {
          const pid = inp.dataset.count;
          const line = R.Inventory.find(Store.state, App.user().whId, ym).lines.find(l => l.productId === pid);
          if ((line.countText || "") === inp.value.trim() && (line.countQty !== null || !inp.value.trim())) return;
          const r = R.NumParse.parse(inp.value);
          if (inp.value.trim() && !r.ok) { inp.classList.add("invalid"); Toast.err(t("Niepoprawna liczba"), r.error); return; }
          inp.classList.remove("invalid");
          const ae = document.activeElement;
          const next = ae && ae.dataset && ae.dataset.count ? ae.dataset.count : null;
          act("inv.setCount", { ym, productId: pid, text: inp.value }).then(() => { const el = next && document.querySelector(`[data-count="${next}"]`); if (el) { el.focus(); el.select(); } });
        };
        inp.addEventListener("change", commit);
        inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
      });
    }
  };

  /* ================================================================== */
  /* Flota                                                                */
  /* ================================================================== */
  Views.flota = {
    html() {
      const S = Store.state;
      const tab = App.tabs.fleet || "vehicles";
      const fwh = App.tabs.fleetWh === undefined ? (R.whAccess(App.user()) === null ? "" : App.user().whId) : App.tabs.fleetWh;
      const inWh = x => !fwh || x.whId === fwh || !x.whId;
      const whCell = x => `<td>${x.whId ? esc(App.whName(x.whId)) : `<span class="dim">${th("wspólny")}</span>`}</td>`;
      const drv = id => (R.byId(S.fleet.drivers, id) || {}).name || "—";
      const opr = id => (R.byId(S.fleet.operators, id) || {}).name || "—";
      const runs = [];      // pojedyncze kursy (operacja może mieć kilka kursów)
      for (const o of S.operations) if (o.transport && (o.transport.mode === "own" || o.transport.mode === "mixed") && o.status !== "CANCELLED") for (const r of (o.transport.mode === "mixed" ? o.transport.own.runs : (o.transport.runs || [o.transport]))) runs.push({ op: o, r });
      const prods = S.operations.filter(o => o.production && o.production.chipperId && o.status !== "CANCELLED");
      const st = s => `<span class="badge ${s === "aktywny" ? "ok" : s === "serwis" ? "warn" : ""}">${esc(t(R.ASSET_STATUS[s] || s))}</span>`;
      const edit = App.can("fleet.edit");
      const btn = (kind, id) => edit ? `<button class="btn sm" type="button" data-edit="${kind}|${esc(id)}">${ic("edit", 13)} ${th("Edytuj")}</button> <button class="btn sm danger" type="button" data-del="${kind}|${esc(id)}" aria-label="${th("Usuń")}" title="${th("Usuń")}">${ic("trash", 13)}</button>` : "";
      let body = "";
      if (tab === "vehicles") body = `<table class="tbl" id="fleet-table"><thead><tr><th>${th("Nazwa")}</th><th>${th("Rejestracja")}</th><th>${th("Typ")}</th><th>${th("Status")}</th><th>${th("Kierowca domyślny")}</th><th>${th("Magazyn")}</th><th class="r">${th("Kursy")}</th><th></th></tr></thead><tbody>
        ${S.fleet.vehicles.filter(inWh).map(v => `<tr><td><b>${esc(v.name)}</b></td><td class="mono">${esc(v.reg)}</td><td>${esc(t(R.VEHICLE_TYPES[v.type]))}</td><td>${st(v.status)}</td><td>${esc(drv(v.driverId))}</td>${whCell(v)}<td class="r">${runs.filter(x => x.r.vehicleId === v.id).length}</td><td class="r">${btn("vehicles", v.id)}</td></tr>`).join("")}</tbody></table>`;
      if (tab === "drivers") body = `<table class="tbl" id="fleet-table"><thead><tr><th>${th("Imię i nazwisko")}</th><th>${th("Telefon")}</th><th>${th("Domyślny w pojazdach")}</th><th>${th("Magazyn")}</th><th class="r">${th("Kursy")}</th><th></th></tr></thead><tbody>
        ${S.fleet.drivers.filter(inWh).map(d => `<tr><td><b>${esc(d.name)}</b></td><td>${esc(d.phone || "")}</td><td>${esc(S.fleet.vehicles.filter(v => v.driverId === d.id).map(v => v.reg).join(", ") || "—")}</td>${whCell(d)}<td class="r">${runs.filter(x => x.r.driverId === d.id).length}</td><td class="r">${btn("drivers", d.id)}</td></tr>`).join("")}</tbody></table>`;
      if (tab === "chippers") body = `<table class="tbl" id="fleet-table"><thead><tr><th>${th("Rębak")}</th><th>${th("Status")}</th><th>${th("Operator domyślny")}</th><th>${th("Magazyn")}</th><th class="r">${th("Produkcje")}</th><th></th></tr></thead><tbody>
        ${S.fleet.chippers.filter(inWh).map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${st(c.status)}</td><td>${esc(opr(c.operatorId))}</td>${whCell(c)}<td class="r">${prods.filter(o => o.production.chipperId === c.id).length}</td><td class="r">${btn("chippers", c.id)}</td></tr>`).join("")}</tbody></table>`;
      if (tab === "operators") body = `<table class="tbl" id="fleet-table"><thead><tr><th>${th("Operator")}</th><th>${th("Telefon")}</th><th>${th("Domyślny przy rębakach")}</th><th>${th("Magazyn")}</th><th></th></tr></thead><tbody>
        ${S.fleet.operators.filter(inWh).map(o => `<tr><td><b>${esc(o.name)}</b></td><td>${esc(o.phone || "")}</td><td>${esc(S.fleet.chippers.filter(c => c.operatorId === o.id).map(c => c.name).join(", ") || "—")}</td>${whCell(o)}<td class="r">${btn("operators", o.id)}</td></tr>`).join("")}</tbody></table>`;
      const lastRuns = runs.slice().sort((a, b) => a.op.date < b.op.date ? 1 : -1).slice(0, 12);
      const labels = { vehicles: N_("Samochody / ruchome podłogi"), drivers: N_("Kierowcy"), chippers: N_("Rębaki"), operators: N_("Operatorzy rębaków") };
      return `<div class="page-head"><div class="titles"><h2>${th("Flota")}</h2><p>${th("Transport własny w „Nowej operacji” korzysta z tej listy. Kurs zapisuje kierowcę wybranego dla konkretnego kursu — późniejsza zmiana kierowcy domyślnego nie zmienia historii.")}</p></div>
          <div class="actions">${edit ? `<button class="btn primary" type="button" id="fleet-add">${ic("plus", 15)} ${esc(t("Dodaj: {k}", { k: t(R.Fleet.KINDS[tab].label).toLowerCase() }))}</button>` : `<span class="badge">${th("tylko podgląd — edycja: Kierownik / Administrator")}</span>`}</div></div>
        <div class="tabs" role="tablist">${Object.entries(labels).map(([k, l]) => `<button class="tab" type="button" role="tab" aria-selected="${k === tab}" data-tab="${k}">${th(l)}</button>`).join("")}</div>
        <div class="card"><div class="toolbar"><div class="field"><label for="fl-wh">${th("Magazyn")}</label><select class="ctrl" id="fl-wh"><option value="">${th("Wszystkie")}</option>${S.warehouses.map(w => `<option value="${esc(w.id)}" ${fwh === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</select></div>
          <p class="help" style="align-self:end">${th("Zasoby przypisane do magazynu są dostępne w jego operacjach; „wspólny” — we wszystkich magazynach.")}</p></div><div class="tbl-wrap">${body}</div></div>
        <div class="card mt4"><div class="card-h"><h3>${th("Ostatnie kursy transportu własnego")}</h3><span class="sub">${th("kierowca zapisany w chwili kursu")}</span></div>
          ${lastRuns.length ? `<div class="tbl-wrap"><table class="tbl" id="runs-table"><thead><tr><th>${th("Data")}</th><th>${th("Dokument")}</th><th>${th("Pojazd")}</th><th>${th("Kierowca kursu")}</th><th class="r">km</th><th class="r">${th("Koszt")}</th><th>${th("Miejsce transportu")}</th></tr></thead><tbody>
            ${lastRuns.map(({ op: o, r }) => { const trd = o.documents.find(x => x.type === "TR"); return `<tr class="clickable" data-opid="${esc(o.id)}"><td>${esc(Dates.pl(o.date))}</td><td class="mono">${esc(trd ? trd.no : "")}${(o.transport.runs || []).length > 1 ? ` <small class="dim">${esc(t("kurs {n}", { n: r.no }))}</small>` : ""}</td><td>${esc(r.vehicleName)} · <span class="mono">${esc(r.reg)}</span></td><td>${esc(r.driverName)}${r.driverOverridden ? ` <span class="badge warn">${th("zmieniony dla kursu")}</span>` : ""}</td><td class="r">${fmtQ(r.km)}</td><td class="r">${esc(money(r.cost))}</td><td>${esc(o.place)}</td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">${th("Brak kursów.")}</div>`}</div>`;
    },
    bind(page) {
      $$("[data-tab]", page).forEach(b => b.onclick = () => { App.tabs.fleet = b.dataset.tab; App.render(); });
      const fw = $("#fl-wh", page); if (fw) fw.onchange = e => { App.tabs.fleetWh = e.target.value; App.render(); };
      const add = $("#fleet-add", page);
      if (add) add.onclick = () => this.edit(App.tabs.fleet || "vehicles", null);
      $$("[data-edit]", page).forEach(b => b.onclick = () => { const [k, id] = b.dataset.edit.split("|"); this.edit(k, id); });
      $$("[data-del]", page).forEach(b => b.onclick = async () => {
        const [k, id] = b.dataset.del.split("|");
        const rec = R.byId(Store.state.fleet[k], id);
        const r = await Modal.confirm({ title: t("Usunąć: {n}?", { n: rec.name }), text: k === "vehicles" || k === "chippers" ? t("Usunąć można tylko pojazd lub rębak bez kursów i produkcji — używany ustaw jako „Wycofany”.") : t("Historyczne kursy zachowają zapisane nazwisko."), ok: t("Usuń"), danger: true });
        if (!r.ok) return;
        const res = await Store.exec("fleet.remove", { kind: k, id }, N_("Moduł Flota"));
        if (res.ok) Toast.ok(t("Usunięto"), rec.name); else Toast.err(t("Nie usunięto"), res.error);
        App.render();
      });
      bindOps(page);
    },
    edit(kind, id) {
      const S = Store.state;
      const rec = id ? R.clone(R.byId(S.fleet[kind], id)) : { name: "", reg: "", type: "ruchoma_podloga", status: "aktywny", driverId: "", operatorId: "", phone: "", whId: App.tabs.fleetWh || App.user().whId };
      const o = (arr, v) => arr.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? "selected" : ""}>${esc(l)}</option>`).join("");
      const f = (k, label, ctrl, help) => `<div class="field" data-ff="${k}"><label for="fe-${k}">${esc(label)}</label>${ctrl}<div class="msg hidden" data-fmsg="${k}"></div>${help ? `<div class="help">${esc(help)}</div>` : ""}</div>`;
      let body = f("name", kind === "vehicles" ? t("Nazwa pojazdu") : kind === "chippers" ? t("Nazwa rębaka") : t("Imię i nazwisko"), `<input class="ctrl" id="fe-name" value="${esc(rec.name)}">`, kind === "vehicles" ? t("np. Scania R450 — ruchoma podłoga") : "");
      if (kind === "vehicles") {
        body += f("reg", t("Numer rejestracyjny"), `<input class="ctrl" id="fe-reg" value="${esc(rec.reg)}" placeholder="${esc(t("np. {x}", { x: "SGL 4T821" }))}">`);
        body += f("type", t("Typ"), `<select class="ctrl" id="fe-type">${o(Object.entries(R.VEHICLE_TYPES).map(([k, v]) => [k, t(v)]), rec.type)}</select>`);
        body += f("status", t("Status"), `<select class="ctrl" id="fe-status">${o(Object.entries(R.ASSET_STATUS).map(([k, v]) => [k, t(v)]), rec.status)}</select>`, t("Pojazd używany w kursach nie jest usuwany — ustaw „Wycofany” (historia zostaje)."));
        body += f("driverId", t("Kierowca domyślny"), `<select class="ctrl" id="fe-driverId"><option value="">— ${th("wybierz")} —</option>${o(S.fleet.drivers.map(d => [d.id, d.name]), rec.driverId)}</select>`, t("Zmiana dotyczy przyszłych kursów."));
      }
      if (kind === "chippers") {
        body += f("status", t("Status"), `<select class="ctrl" id="fe-status">${o(Object.entries(R.ASSET_STATUS).map(([k, v]) => [k, t(v)]), rec.status)}</select>`);
        body += f("operatorId", t("Operator domyślny"), `<select class="ctrl" id="fe-operatorId"><option value="">— ${th("wybierz")} —</option>${o(S.fleet.operators.map(d => [d.id, d.name]), rec.operatorId)}</select>`);
      }
      if (kind === "drivers" || kind === "operators") body += f("phone", t("Telefon"), `<input class="ctrl" id="fe-phone" value="${esc(rec.phone || "")}" inputmode="tel">`);
      body += f("whId", t("Magazyn"), `<select class="ctrl" id="fe-whId"><option value="">${th("wspólny (wszystkie magazyny)")}</option>${o(S.warehouses.filter(w => w.active !== false || w.id === rec.whId).map(w => [w.id, w.name]), rec.whId || "")}</select>`, t("Przydział do magazynu: zasób jest wybierany w operacjach tego magazynu."));
      const m = Modal.open({ title: `${id ? t("Edycja") : t("Nowy")}: ${t(R.Fleet.KINDS[kind].label).toLowerCase()}`, body: `<div class="stack">${body}</div>`,
        footer: `<button class="btn ghost" type="button" data-no>${th("Anuluj")}</button><button class="btn primary" type="button" data-yes>${th("Zapisz")}</button>` });
      $("[data-no]", m.el).onclick = () => m.close();
      $("[data-yes]", m.el).onclick = async () => {
        const next = Object.assign({}, rec, { id: id || undefined });
        for (const k of R.Fleet.KINDS[kind].fields) { const el = $("#fe-" + k, m.el); if (el) next[k] = el.value; }
        const res = await Store.exec("fleet.save", { kind, rec: next }, N_("Moduł Flota"));
        $$("[data-fmsg]", m.el).forEach(x => x.classList.add("hidden"));
        if (!res.ok) {
          for (const [k, msg] of Object.entries(res.errors || {})) { const x = $(`[data-fmsg="${k}"]`, m.el); if (x) { x.textContent = msg; x.classList.remove("hidden"); } }
          Toast.err(t("Nie zapisano"), res.error); return;
        }
        m.close(); Toast.ok(t("Zapisano"), res.rec.name); App.render();
      };
    }
  };

  root.OpDetail = OpDetail;
  Object.assign(UI, { pName, partnerName, opPartnerId, opTypeLabel, TYPE_BADGE, opProduct, opQty, opValue, qtyByUnit, allDocuments, docContent, Printer, printButtons, docModel, OpDetail, DocPreview, CancelDialog, Tip, sparkline, hbar, opsTable, bindOps, drill, drillAttr, bindDrill, periodControls, bindPeriod, rangeOf, renderTable, auditLine, searchInput, bindSearch });
  root.RIWViews = { allDocuments, docModel, kwitModel, historyModel, Reports, Printer, CancelDialog, DocPreview, OpDetail };
})(typeof globalThis !== "undefined" ? globalThis : this);
