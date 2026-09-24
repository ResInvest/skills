/* =========================================================================
   Warstwa A (cd.): ekrany modułów, szczegóły dokumentu, anulowanie,
   raporty, kwit produkcji dnia, wykresy, druk i PDF.
   Wszystkie liczby pochodzą z silnika (RIW.Reports / RIW.Stock) — pulpit,
   raport, PDF, stany i historia korzystają z tych samych funkcji.
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, esc, $, $$, ic, download, csvNum, toCSV, Toast, Modal, Store, App, Views, statusBadge, transportText, CANCEL_REASONS } = UI;
  const { fmt, fmtQ, money, Units, Dates, Stock } = R;
  const PDF = root.RIW_PDF;

  /* ------------------------------------------------------------------ */
  /* Wspólne opisy operacji i dokumentów                                  */
  /* ------------------------------------------------------------------ */
  const pName = id => (App.product(id) || {}).name || "—";
  const partnerName = id => (App.partner(id) || {}).name || "";
  const opPartnerId = o => o.purchase ? o.purchase.supplierId : o.sale ? o.sale.buyerId : "";
  const opTypeLabel = o => o.type === "ZAKUP" ? "Zakup" + (o.scope.includes("PRODUKCJA") ? " + produkcja" : "") + (o.scope.includes("SPRZEDAZ") ? " + sprzedaż" : "")
    : o.type === "PRODUKCJA" ? "Produkcja na magazyn" : o.type === "MM" ? "Przesunięcie MM" : o.direct ? "Produkcja + sprzedaż bezpośrednia" : "Sprzedaż z magazynu (WZ)";
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

  /** Wszystkie dokumenty: operacji, korekt (KOR), anulowań (AN), bilansu otwarcia i inwentaryzacji. */
  function allDocuments(S, whId) {
    const rows = [];
    for (const op of S.operations) {
      if (whId && op.whId !== whId && op.toWhId !== whId) continue;
      for (const d of op.documents) rows.push(Object.assign({}, d, { date: op.date, opId: op.id, opNo: op.no, opType: op.type, direct: op.direct, status: op.status, whId: op.whId, userName: op.userName }));
      op.corrections.forEach(c => rows.push({ type: "KOR", no: c.no, date: c.date, opId: op.id, opNo: op.no, status: "POSTED", whId: op.whId, productId: null, qty: null, unit: null, value: 0, partner: partnerName(opPartnerId(op)), place: op.place, stock: c.deltas.length ? "±" : "brak", userName: c.userName, note: `KOREKTA dokumentu nr ${op.no}: ${c.reason}`, corr: c }));
      if (op.cancel) rows.push({ type: "AN", no: op.cancel.no, date: op.cancel.date, opId: op.id, opNo: op.no, status: "POSTED", whId: op.whId, productId: null, qty: null, unit: null, value: 0, partner: partnerName(opPartnerId(op)), place: op.place, stock: "±", userName: op.cancel.userName, note: `ANULOWANIE dokumentu nr ${op.no}: ${op.cancel.reason}` });
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
    if (d.type === "TR") return `${R.TRANSPORT_MODES[d.transport.mode]} · ${transportText(d.transport)}`;
    if (d.type === "KOR" || d.type === "AN") return d.note;
    if (d.type === "IN") return `Różnice inwentaryzacyjne (${d.lines} poz.)`;
    if (d.type === "BO") return `Bilans otwarcia (${d.lines} poz.)`;
    if (d.type === "MM") return `${pName(d.productId)} · ${d.fromWh} → ${d.toWh}`;
    return pName(d.productId) + (d.meta && d.meta.direct ? " · bezpośrednio" : "");
  }
  const stockLbl = d => d.stock === "+" ? `<span class="badge ok">+ przychód</span>` : d.stock === "−" ? `<span class="badge warn">− rozchód</span>` : d.stock === "brak" ? `<span class="badge info">brak</span>` : `<span class="badge">± zmiana</span>`;

  /* ------------------------------------------------------------------ */
  /* Druk i PDF — jeden model treści                                      */
  /* ------------------------------------------------------------------ */
  const Printer = {
    async register(model, kind, format) {
      const u = App.user();
      const res = await Store.transact(s => R.registerPrint(s, { user: R.byId(s.users, u.id), today: App.today(), source: model.title }, { kind, title: model.title, range: model.rangeText || "", wh: model.whText || "", format }));
      return res.ok ? res.no : null;
    },
    finish(model, no) {
      return Object.assign({}, model, { number: model.number || no, generatedAt: nowText(), generatedBy: `${App.user().name} (${R.ROLES[App.user().role].label})`, system: `ResInvest ERP · Demo ${R.VERSION}` });
    },
    async print(model, kind) {
      const w = root.open("", "_blank");
      if (!w) { Toast.warn("Okno wydruku zablokowane", "Zezwól na wyskakujące okna dla tego pliku."); return; }
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
        Toast.ok("Wygenerowano PDF", `${name} · ${fmt(bytes.length / 1024, 0)} kB`);
      } catch (e) { console.error(e); Toast.err("Nie udało się wygenerować PDF", e.message); }
    }
  };
  const printButtons = (id) => `<button class="btn" type="button" data-print="${id}">${ic("print", 15)} Drukuj</button><button class="btn" type="button" data-pdf="${id}">${ic("pdf", 15)} Generuj PDF</button>`;

  /** Model dokumentu magazynowego (PZ, RW, PW, WZ, MM, TR, KOR, AN). */
  function docModel(d) {
    const S = Store.state, op = d.opId ? R.byId(S.operations, d.opId) : null;
    const kv = [];
    const add = (k, v) => { if (v !== undefined && v !== null && v !== "") kv.push([k, String(v)]); };
    add("Numer", d.no); add("Rodzaj", R.DOC_LABEL[d.type]); add("Data", Dates.pl(d.date)); add("Magazyn", App.whName(d.whId)); add("Status", R.STATUS[d.status] || d.status);
    if (d.place) add("Miejsce transportu", d.place);
    if (d.productId) {
      const p = App.product(d.productId);
      add("Produkt", p.name);
      add("Ilość", `${fmtQ(d.qty, 6)} ${Units.label(d.unit)}${d.unit !== p.unit ? ` (= ${fmtQ(d.stockQty, 6)} ${Units.label(p.unit)})` : ""}`);
      const o = Units.orient(d.stockQty != null ? d.stockQty : d.qty, p, S.config);
      add("Masa · energia", `${d.weightMode === "manual" ? `${fmtQ(d.weightT)} t (waga rzeczywista)` : `≈ ${fmt(o.t, 2)} t`} · ≈ ${fmt(o.gj, 1)} GJ (orientacyjnie)`);
    }
    if (d.fromWh) { add("Z magazynu", d.fromWh); add("Do magazynu", d.toWh); }
    if (d.partner) add(d.type === "PZ" ? "Dostawca" : "Odbiorca", d.partner);
    if (d.basis) add("Podstawa", R.BASIS[d.basis]);
    if (d.value) add(d.type === "PW" ? "Koszt rąbania" : "Wartość netto", money(d.value));
    const META = { productionType: "Rodzaj produkcji", ndl: "Nadleśnictwo", lesnictwo: "Leśnictwo", kwit: "Nr kwitu wywozowego", sourceType: "Typ źródła", investSite: "Miejsce wycinki", sourceDoc: "Dokument źródłowy", chipRate: "Cena za rąbanie [zł/MP]", chippingCost: "Koszt rąbania [zł]", chipper: "Rębak", operator: "Operator", fromDoc: "Z dokumentu zużycia", direct: "Sprzedaż / produkcja bezpośrednia", rawInfo: "Surowiec z lasu (informacyjnie)" };
    if (d.meta) for (const [k, v] of Object.entries(d.meta)) if (v !== "" && v != null) add(META[k] || k, typeof v === "number" ? fmt(v, 2) : v);
    const blocks = [{ type: "kv", rows: kv, cols: 1 }];
    if (d.transport) {
      const t = d.transport, tk = [["Transport", R.TRANSPORT_MODES[t.mode]]];
      if (t.mode === "own") tk.push(["Liczba kursów", String((t.runs || [t]).length)], ["Pojazdy", t.reg], ["Kierowcy", t.driverName + (t.driverOverridden ? " (zmiana dla kursu)" : "")], ["Kilometry łącznie", `${fmtQ(t.km)} km`]);
      if (t.mode === "external") tk.push(["Przewoźnik", `${t.company} · ${t.reg}`], ["Odległość", `${fmtQ(t.km)} km`], ["Fracht", t.includedInPrice ? "wliczony w cenę" : money(t.freight)]);
      if (t.mode === "train") {
        tk.push(["Skład / przewoźnik", `${t.trainNo || "—"} · ${t.carrier || "—"}`], ["Nr dokumentu przewozowego", t.docNo || "—"], ["Miejsce załadunku", t.loadPlace || "—"], ["Liczba wagonów", String(t.wagonCount)]);
        if (t.capacity !== null) tk.push(["Łączna ładowność", `${fmtQ(t.totalCapacity)} ${t.capUnit}`]);
        tk.push(["Łączny tonaż składu", `${fmtQ(t.totalT)} t`], ["Stawka", `${fmtQ(t.basisQty)} ${Units.label(t.priceUnit)} × ${fmt(t.price)} zł`]);
      }
      tk.push(["Koszt transportu", money(t.cost)], ["Wpływ na stan", "brak — transport nie zmienia stanu magazynowego"]);
      blocks.push({ type: "h", text: "Transport" }, { type: "kv", rows: tk, cols: 1 });
      if (t.mode === "own" && t.runs && t.runs.length) blocks.push({ type: "table", columns: [{ label: "Kurs", w: 0.6 }, { label: "Pojazd", w: 1.4 }, { label: "Kierowca", w: 1.8 }, { label: "km", w: 0.8, align: "right" }, { label: "Stawka", w: 1, align: "right" }, { label: "Ilość", w: 1.2, align: "right" }, { label: "Waga rzecz. [t]", w: 1.2, align: "right" }, { label: "Koszt", w: 1.2, align: "right" }],
        rows: t.runs.map(r => [String(r.no), r.reg, r.driverName + (r.driverOverridden ? " *" : ""), fmtQ(r.km), `${fmt(r.rate)} zł/km`, `${fmtQ(r.qty)} ${Units.label(t.qtyUnit || "")}`, r.weightT !== null && r.weightT !== undefined ? fmtQ(r.weightT) : "—", money(r.cost)]),
        foot: ["Razem", "", "", fmtQ(t.km), "", `${fmtQ(t.totalQty)} ${Units.label(t.qtyUnit || "")}`, t.totalWeightT !== null && t.totalWeightT !== undefined ? fmtQ(t.totalWeightT) : "—", money(t.cost)], note: t.runs.some(r => r.driverOverridden) ? "* kierowca zmieniony tylko dla tego kursu" : "" });
      if (t.mode === "train" && t.wagonT.length) blocks.push({ type: "table", columns: [{ label: "Wagon", w: 1 }, { label: "Tonaż [t]", w: 2, align: "right" }], rows: t.wagonT.map((x, i) => [String(i + 1), fmtQ(x)]), foot: ["Razem", fmtQ(t.totalT)] });
    }
    if (d.type === "KOR" && d.corr) {
      const c = d.corr;
      blocks.push({ type: "h", text: `KOREKTA dokumentu nr ${d.opNo}` }, { type: "p", text: `Powód: ${c.reason} · wprowadził: ${c.userName}${c.reverses ? ` · odwraca korektę ${c.reverses}` : ""}` });
      blocks.push({ type: "table", columns: [{ label: "Pole", w: 2 }, { label: "Oryginał", w: 2, align: "right" }, { label: "Korekta", w: 2, align: "right" }, { label: "Różnica", w: 1.4, align: "right" }], rows: c.changes.map(x => [x.label, x.beforeText, x.afterText, x.diff !== null ? (x.diff > 0 ? "+" : "") + fmtQ(x.diff, 6) : "zmiana"]) });
      if (c.deltas.length) blocks.push({ type: "table", columns: [{ label: "Produkt", w: 3 }, { label: "Magazyn", w: 2 }, { label: "Zmiana stanu", w: 2, align: "right" }], rows: c.deltas.map(x => [pName(x.productId), App.whName(x.whId), (x.qty > 0 ? "+" : "") + App.qtyNative(x.qty, x.productId, 6)]) });
    }
    if (d.type === "AN" && op && op.cancel) {
      blocks.push({ type: "h", text: `ANULOWANIE dokumentu nr ${op.no}` }, { type: "p", text: `Przyczyna: ${op.cancel.reason} · wykonał: ${op.cancel.userName}` });
      blocks.push({ type: "table", columns: [{ label: "Produkt", w: 3 }, { label: "Magazyn", w: 2 }, { label: "Zmiana", w: 2, align: "right" }, { label: "Stan przed", w: 2, align: "right" }, { label: "Stan po", w: 2, align: "right" }], rows: op.cancel.effect.map(x => [pName(x.productId), App.whName(x.whId), (x.qty > 0 ? "+" : "") + App.qtyNative(x.qty, x.productId, 6), App.qtyNative(x.before, x.productId), App.qtyNative(x.after, x.productId)]) });
    }
    if (op) blocks.push({ type: "p", muted: true, text: `Operacja ${op.no} · ${opTypeLabel(op)} · wystawił: ${op.userName}${op.extDoc ? ` · dokument zewnętrzny: ${op.extDoc}` : ""}${op.notes ? ` · uwagi: ${op.notes}` : ""}` });
    blocks.push({ type: "signatures", labels: d.type === "WZ" || d.type === "PZ" ? ["Wydał / przyjął (magazyn)", "Kierowca / odbiorca"] : ["Sporządził", "Zatwierdził"] });
    return { title: `${R.DOC_LABEL[d.type]} ${d.no}`, number: d.no, headerRight: App.whName(d.whId), rangeText: Dates.pl(d.date), whText: App.whName(d.whId), blocks };
  }

  /* ------------------------------------------------------------------ */
  /* Szczegóły dokumentu / operacji                                       */
  /* ------------------------------------------------------------------ */
  const OpDetail = {
    open(opId, opts = {}) {
      const S = Store.state, op = R.byId(S.operations, opId);
      if (!op) { Toast.err("Nie znaleziono operacji"); return; }
      const docs = allDocuments(S).filter(d => d.opId === op.id).reverse();
      const led = Stock.sorted(S.ledger.filter(l => l.opId === op.id));
      const events = S.audit.filter(a => a.entityId === op.id).slice().sort((a, b) => a.ts < b.ts ? -1 : 1);
      const kv = [];
      const add = (k, v) => { if (v !== undefined && v !== null && v !== "") kv.push(`<dt>${esc(k)}</dt><dd>${v}</dd>`); };
      add("Rodzaj", TYPE_BADGE(op)); add("Status", statusBadge(op.status)); add("Data", esc(Dates.pl(op.date))); add("Magazyn", esc(App.whName(op.whId)) + (op.toWhId ? ` → ${esc(App.whName(op.toWhId))}` : ""));
      add("Wystawił", esc(`${op.userName} · ${op.createdAt.slice(0, 16).replace("T", " ")}`));
      if (op.purchase) add("Zakup", `${esc(partnerName(op.purchase.supplierId))} · ${esc(fmtQ(op.purchase.qty))} ${Units.label(op.purchase.unit)} ${esc(pName(op.purchase.productId))} × ${fmt(op.purchase.price)} zł`);
      if (op.production) {
        const X = op.production;
        add(X.mode === "direct" ? "Produkcja w lesie" : "Produkcja", `${X.rawProductId ? `${esc(pName(X.rawProductId))} ${esc(fmtQ(X.consumeQty, 6))} ${Units.label(X.consumeUnit)}${X.mode === "direct" ? " (nie ze stanu)" : ""} → ` : ""}<b>${esc(fmtQ(X.outQty, 6))} ${Units.label(X.outUnit)}</b> ${esc(pName(X.outProductId))}`);
        if (X.outUnit === "MP") add("Rąbanie", `${fmt(X.chipRate)} zł/MP = ${money(X.chippingCost)}${X.chipperName ? ` · ${esc(X.chipperName)} (${esc(X.operatorName)})` : ""}`);
      }
      if (op.sale) add("Sprzedaż", `${esc(partnerName(op.sale.buyerId))} · ${esc(fmtQ(op.sale.qty))} ${Units.label(op.sale.unit)} → ${money(op.sale.revenue)}`);
      if (op.mm) add("Przesunięcie", `${esc(fmtQ(op.mm.qty))} ${Units.label(op.mm.unit)} ${esc(pName(op.mm.productId))}: ${esc(op.mm.fromWhName)} → ${esc(op.mm.toWhName)}`);
      if (op.transport && op.transport.mode !== "none") add("Transport", `${esc(R.TRANSPORT_MODES[op.transport.mode])} · ${esc(transportText(op.transport))} · ${money(op.transport.cost)}`);
      add("Miejsce", esc(op.place)); add("Dokument zewnętrzny", esc(op.extDoc)); add("Uwagi", esc(op.notes));
      add("Wynik operacji", `<b>${money(op.totals.result)}</b>`);

      const canCorr = op.status !== "CANCELLED" && App.can("documents.correct") && App.can(R.OP_TYPES[op.type].correctPerm) && (App.user().whId === op.whId || App.user().role === "admin");
      const canCancel = op.status !== "CANCELLED" && App.can("documents.cancel") && (App.user().whId === op.whId || App.user().role === "admin");
      const lastCorr = op.corrections[op.corrections.length - 1];
      const corrRows = op.corrections.map(c => `<tr><td class="mono nowrap"><a href="#" data-doc="${esc(c.no)}">${esc(c.no)}</a></td><td class="nowrap">${esc(Dates.pl(c.date))}</td><td>${esc(c.userName)}</td><td>${esc(c.reason)}${c.reverses ? `<br><small class="dim">odwraca ${esc(c.reverses)}</small>` : ""}</td>
          <td>${c.changes.map(x => `${esc(x.label)}: ${esc(x.beforeText)} → <b>${esc(x.afterText)}</b>`).join("<br>") || "—"}</td>
          <td class="r">${c.deltas.map(x => `<span class="${x.qty < 0 ? "neg" : "pos"}">${x.qty > 0 ? "+" : ""}${esc(App.qtyNative(x.qty, x.productId, 6))}</span>`).join("<br>") || "—"}</td>
          <td class="r">${canCorr && c === lastCorr && !c.reverses ? `<button class="btn sm" type="button" data-reverse="${esc(c.no)}">${ic("undo", 13)} Odwróć</button>` : ""}</td></tr>`).join("");
      const rel = [];
      docs.forEach(d => { if (d.meta && d.meta.fromDoc) rel.push(`${esc(d.no)} ← ${esc(d.meta.fromDoc)} (produkt z surowca)`); });
      op.corrections.forEach(c => rel.push(`${esc(c.no)} → koryguje ${esc(op.no)}${c.reverses ? ` · odwraca ${esc(c.reverses)}` : ""}`));
      if (op.cancel) rel.push(`${esc(op.cancel.no)} → anuluje ${esc(op.no)}`);
      if (op.cancel && op.cancel.dependents.length) rel.push(`Operacje późniejsze na tym samym towarze (potwierdzone przy anulowaniu): ${op.cancel.dependents.map(d => `<a href="#" data-op="${esc(d.id)}">${esc(d.no)}</a>`).join(", ")}`);
      const body = `
        ${opts.justSaved ? `<div class="info-line ok mb3">${ic("check", 15)}<span>Dokument zatwierdzony: <b>${docs.map(d => esc(d.no)).join(", ")}</b>. Status: ZATWIERDZONY.</span></div>` : ""}
        ${op.status === "CANCELLED" ? `<div class="info-line err mb3">${ic("ban", 15)}<span>Dokument anulowany ${esc(Dates.pl(op.cancel.date))} przez ${esc(op.cancel.userName)} — dokument ${esc(op.cancel.no)}. Przyczyna: ${esc(op.cancel.reason)}. Skutki magazynowe zostały odwrócone; dokument pozostaje w historii.</span></div>` : ""}
        <div class="grid g2 detail-grid"><dl class="money-list" id="op-kv">${kv.join("")}</dl>
          <div><h4 class="mini-h">Dokumenty</h4><div class="tbl-wrap"><table class="tbl" id="op-docs"><thead><tr><th>Nr</th><th>Treść</th><th class="r">Ilość</th><th>Stan</th><th></th></tr></thead><tbody>
            ${docs.map(d => `<tr><td class="mono nowrap">${esc(d.no)}</td><td>${esc(docContent(d))}</td><td class="r">${d.qty != null ? esc(fmtQ(d.qty) + " " + Units.label(d.unit)) : "—"}</td><td>${stockLbl(d)}</td><td class="r nowrap"><button class="btn sm" type="button" data-doc="${esc(d.no)}">Podgląd</button></td></tr>`).join("")}
          </tbody></table></div>
          ${rel.length ? `<h4 class="mini-h">Powiązania dokumentów</h4><ul class="rel-list">${rel.map(x => `<li>${x}</li>`).join("")}</ul>` : ""}</div></div>
        <h4 class="mini-h">Ruchy magazynowe (księga)</h4>
        <div class="tbl-wrap"><table class="tbl" id="op-ledger"><thead><tr><th>Data</th><th>Dokument</th><th>Rodzaj</th><th>Magazyn</th><th>Produkt</th><th class="r">Zmiana</th></tr></thead><tbody>
          ${led.map(l => `<tr class="${l.kind === "ANULOWANIE" || l.kind === "KOREKTA" ? "sub" : ""}"><td class="nowrap">${esc(Dates.pl(l.date))}</td><td class="mono">${esc(l.docNo)}</td><td>${esc(R.KINDS[l.kind].label)}${l.kind === "KOREKTA" || l.kind === "ANULOWANIE" ? ` <small class="dim">(${esc(R.CATS[l.cat])})</small>` : ""}${l.direct ? " · bezp." : ""}</td><td>${esc(App.whName(l.whId))}</td><td>${esc(pName(l.productId))}</td><td class="r"><span class="${l.qty < 0 ? "neg" : "pos"}">${l.qty > 0 ? "+" : ""}${esc(App.qtyNative(l.qty, l.productId, 6))}</span></td></tr>`).join("")}
        </tbody></table></div>
        ${op.corrections.length ? `<h4 class="mini-h">Korekty (${op.corrections.length})</h4><div class="tbl-wrap"><table class="tbl" id="op-corr"><thead><tr><th>Nr</th><th>Data</th><th>Użytkownik</th><th>Powód</th><th>Zmiany</th><th class="r">Wpływ na stan</th><th></th></tr></thead><tbody>${corrRows}</tbody></table></div>` : ""}
        <h4 class="mini-h">Historia zdarzeń</h4>
        <ul class="timeline" id="op-events">${events.map(a => `<li><b>${esc(a.ts.slice(0, 16).replace("T", " "))}</b> · ${esc(a.userName)} · ${esc(a.action)}${a.relatedNo ? ` (${esc(a.relatedNo)})` : ""}${a.reason ? ` — powód: ${esc(a.reason)}` : ""}</li>`).join("")}</ul>`;
      const m = Modal.open({
        title: `${op.no} — ${opTypeLabel(op)}`, sub: `${statusBadge(op.status)} ${esc(App.whName(op.whId))} · ${esc(Dates.pl(op.date))}`, xwide: true, id: "op-detail", body,
        footer: `${canCancel ? `<button class="btn danger" type="button" data-cancel>${ic("ban", 15)} Anuluj dokument…</button>` : ""}
          ${canCorr ? `<a class="btn" href="#/korekta?op=${esc(op.id)}" data-correct>${ic("edit", 15)} Koryguj…</a>` : ""}
          <span class="spacer"></span>
          <button class="btn primary" type="button" data-close>Zamknij</button>`
      });
      $("[data-close]", m.el).onclick = () => m.close();
      const cc = $("[data-correct]", m.el); if (cc) cc.addEventListener("click", () => m.close());
      const cb = $("[data-cancel]", m.el); if (cb) cb.onclick = () => { m.close(); CancelDialog.open(op.id); };
      $$("[data-doc]", m.el).forEach(b => b.onclick = e => { e.preventDefault(); const d = allDocuments(Store.state).find(x => x.no === b.dataset.doc); if (d) DocPreview.open(d); });
      $$("[data-op]", m.el).forEach(b => b.onclick = e => { e.preventDefault(); m.close(); OpDetail.open(b.dataset.op); });
      $$("[data-reverse]", m.el).forEach(b => b.onclick = async () => {
        const r = await Modal.confirm({ title: `Odwrócić korektę ${b.dataset.reverse}?`, text: "Powstanie nowa korekta przywracająca dane sprzed korekty. Korekty nie usuwa się — obie pozostają w historii.", ok: "Odwróć korektę", input: { label: "Powód odwrócenia", placeholder: "np. korekta wprowadzona omyłkowo", required: true } });
        if (!r.ok) return;
        const uid = App.user().id;
        const res = await Store.transact(s => R.reverseCorrection(s, op.id, b.dataset.reverse, r.value, { user: R.byId(s.users, uid), today: App.today(), source: "Odwrócenie korekty" }));
        if (res.ok) { Toast.ok("Korekta odwrócona", res.no); m.close(); App.render(); OpDetail.open(op.id); } else Toast.err("Nie odwrócono", res.error);
      });
      return m;
    }
  };

  const DocPreview = {
    open(d) {
      const model = docModel(d);
      const html = `<div class="doc-print" id="doc-print"><h4>${esc(model.title)}</h4>${model.blocks.filter(b => b.type === "kv" || b.type === "p" || b.type === "h" || b.type === "table").map(b =>
        b.type === "kv" ? `<table>${b.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`
          : b.type === "h" ? `<h5>${esc(b.text)}</h5>` : b.type === "p" ? `<p class="${b.muted ? "muted" : ""}">${esc(b.text)}</p>`
          : `<table class="tbl"><thead><tr>${b.columns.map(c => `<th class="${c.align === "right" ? "r" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map((v, i) => `<td class="${b.columns[i].align === "right" ? "r" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`).join("")}</div>`;
      const m = Modal.open({ title: `${d.type} ${d.no}`, sub: esc(R.DOC_LABEL[d.type]), wide: true, id: "doc-preview", body: html,
        footer: `${d.opId ? `<button class="btn ghost" type="button" data-opd>Operacja ${esc(d.opNo)}</button>` : ""}<span class="spacer"></span>${printButtons("doc")}<button class="btn primary" type="button" data-ok>Zamknij</button>` });
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
      const pc = R.planCancel(S, opId, App.ctx("Anulowanie dokumentu"));
      if (!pc.ok && !pc.blocked) { Toast.err("Nie można anulować", pc.error); return; }
      const deps = (pc.dependents || []).map(d => `<li><a href="#" data-op="${esc(d.id)}">${esc(d.no)}</a> · ${esc(d.type)} · ${esc(Dates.pl(d.date))} (${esc(d.docNo)})</li>`).join("");
      let body;
      if (pc.blocked) {
        body = `<div class="info-line err" id="cancel-blocked">${ic("alert", 15)}<span>${esc(pc.error)}</span></div>
          ${deps ? `<h4 class="mini-h">Operacje zależne</h4><ul class="rel-list">${deps}</ul>` : ""}
          <p class="help mt3">Najpierw skoryguj lub anuluj operacje zależne (od najpóźniejszej), a potem wróć do tego dokumentu.</p>`;
      } else {
        const eff = pc.reversal.map(x => `<tr><td>${esc(pName(x.productId))}<br><small class="dim">${esc(App.whName(x.whId))} · ${esc(R.CATS[x.cat])}${x.direct ? " (bezp.)" : ""}</small></td><td class="r"><span class="${x.qty < 0 ? "neg" : "pos"}">${x.qty > 0 ? "+" : ""}${esc(App.qtyNative(x.qty, x.productId, 6))}</span></td><td class="r">${esc(App.qtyNative(x.before, x.productId))}</td><td class="r"><b>${esc(App.qtyNative(x.after, x.productId))}</b></td></tr>`).join("");
        body = `<p class="muted">Anulowanie <b>nie usuwa</b> dokumentu ${esc(op.no)}. Powstanie dokument anulowania z datą ${esc(Dates.pl(App.today()))}, który odwraca skutki magazynowe i wartościowe. Dokument pierwotny otrzyma status ANULOWANY.</p>
          <h4 class="mini-h">Wpływ na stan</h4>
          ${eff ? `<div class="tbl-wrap"><table class="tbl" id="cancel-effect"><thead><tr><th>Produkt</th><th class="r">Zmiana</th><th class="r">Stan przed</th><th class="r">Stan po</th></tr></thead><tbody>${eff}</tbody></table></div>` : `<p class="muted">Brak ruchów magazynowych (np. sama korekta wartości).</p>`}
          ${deps ? `<div class="info-line warn mt3">${ic("alert", 15)}<span>Po tym dokumencie wykonano operacje na tym samym towarze. Stan nie spadnie poniżej zera, ale sprawdź, czy anulowanie jest zamierzone.</span></div><ul class="rel-list">${deps}</ul>
            <label class="inline-opt mt2"><input type="checkbox" id="cancel-ack"> Potwierdzam anulowanie mimo operacji zależnych</label>` : ""}
          <div class="fgrid mt4"><div class="field"><label for="cancel-reason">Przyczyna anulowania <span class="req">*</span></label>
            <select class="ctrl" id="cancel-reason"><option value="">— wybierz —</option>${CANCEL_REASONS.map(r => `<option>${esc(r)}</option>`).join("")}</select>
            <input class="ctrl mt2" id="cancel-reason-text" placeholder="opis (wymagany przy „inny”)"><div class="msg hidden" id="cancel-msg" role="alert"></div></div></div>`;
      }
      const m = Modal.open({ title: `Anulowanie dokumentu ${op.no}`, sub: esc(opTypeLabel(op)), wide: true, id: "cancel-dialog", body,
        footer: `<button class="btn ghost" type="button" data-no>${pc.blocked ? "Zamknij" : "Nie anuluj"}</button>${pc.blocked ? "" : `<button class="btn danger" type="button" data-yes id="cancel-yes">${ic("ban", 15)} Anuluj dokument</button>`}` });
      $("[data-no]", m.el).onclick = () => m.close();
      $$("[data-op]", m.el).forEach(b => b.onclick = e => { e.preventDefault(); m.close(); OpDetail.open(b.dataset.op); });
      const yes = $("[data-yes]", m.el);
      if (!yes) return;
      yes.onclick = async () => {
        const sel = $("#cancel-reason", m.el).value, txt = $("#cancel-reason-text", m.el).value.trim();
        const msg = $("#cancel-msg", m.el);
        const fail = t => { msg.textContent = t; msg.classList.remove("hidden"); };
        if (!sel) return fail("Wybierz przyczynę anulowania");
        if (sel === "inny" && !txt) return fail("Opisz przyczynę anulowania");
        const ack = $("#cancel-ack", m.el);
        if (ack && !ack.checked) return fail("Zaznacz potwierdzenie — istnieją operacje zależne");
        yes.disabled = true;
        const reason = txt ? `${sel} — ${txt}` : sel, uid = App.user().id;
        const res = await Store.transact(s => R.cancelOperation(s, opId, { user: R.byId(s.users, uid), today: App.today(), source: "Anulowanie dokumentu" }, reason, { ack: !!(ack && ack.checked) }));
        yes.disabled = false;
        if (!res.ok) { fail(res.error); Toast.err("Nie anulowano — nic nie zapisano", res.error); return; }
        m.close(); Toast.ok("Dokument anulowany", `${res.no} → ${op.no}`); App.render(); OpDetail.open(opId);
      };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Wykresy (SVG, jeden kolor marki, podpisy bezpośrednie, podpowiedź)   */
  /* ------------------------------------------------------------------ */
  const Tip = {
    bind(scope) {
      const tip = $("#chart-tip"); if (!tip) return;
      $$("[data-tip]", scope).forEach(el => {
        el.addEventListener("mousemove", e => { tip.innerHTML = el.dataset.tip; tip.classList.remove("hidden"); const x = Math.min(e.clientX + 14, root.innerWidth - tip.offsetWidth - 8); tip.style.left = x + "px"; tip.style.top = (e.clientY + 14) + "px"; });
        el.addEventListener("mouseleave", () => tip.classList.add("hidden"));
      });
      $$("svg[data-series]", scope).forEach(svg => {
        const pts = JSON.parse(svg.dataset.series), unit = svg.dataset.unit || "";
        const dot = svg.querySelector(".spark-hover");
        svg.addEventListener("mousemove", e => {
          const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(pts.length - 1, Math.round((e.clientX - r.left) / r.width * (pts.length - 1))));
          const p = pts[i];
          tip.innerHTML = `<b>${esc(Dates.pl(p[0]))}</b><br>${esc(fmtQ(p[1]))} ${esc(unit)}`; tip.classList.remove("hidden");
          tip.style.left = Math.min(e.clientX + 14, root.innerWidth - tip.offsetWidth - 8) + "px"; tip.style.top = (e.clientY + 14) + "px";
          if (dot) { dot.setAttribute("cx", p[2]); dot.setAttribute("cy", p[3]); dot.style.opacity = 1; }
        });
        svg.addEventListener("mouseleave", () => { tip.classList.add("hidden"); if (dot) dot.style.opacity = 0; });
      });
    }
  };
  function sparkline(series, unit, w = 140, h = 30) {
    const vals = series.map(p => p.qty), min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const pts = series.map((p, i) => [p.date, p.qty, R.round(2 + i * (w - 4) / Math.max(1, series.length - 1), 2), R.round(h - 3 - (p.qty - min) / span * (h - 6), 2)]);
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" data-series='${esc(JSON.stringify(pts))}' data-unit="${esc(unit)}" role="img" aria-label="Stan w ostatnich ${series.length} dniach: od ${esc(fmtQ(series[0].qty))} do ${esc(fmtQ(last[1]))} ${esc(unit)}">
      <polyline points="${pts.map(p => p[2] + "," + p[3]).join(" ")}" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${last[2]}" cy="${last[3]}" r="3" fill="var(--brand)" stroke="var(--surface)" stroke-width="2"/>
      <circle class="spark-hover" r="4" fill="var(--brand)" stroke="var(--surface)" stroke-width="2" style="opacity:0"/></svg>`;
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
    if (!ops.length) return `<div class="empty">Brak operacji dla wybranych filtrów.</div>`;
    if (compact) return `<div class="tbl-wrap"><table class="tbl" id="${id}"><thead><tr><th>Nr</th><th>Data</th><th>Rodzaj / produkt</th><th>Status</th><th class="r">Ilość</th><th class="r">Wartość</th></tr></thead><tbody>
      ${ops.map(o => `<tr class="clickable ${o.status === "CANCELLED" ? "void" : ""}" data-opid="${esc(o.id)}"><td class="mono nowrap">${esc(o.no)}</td><td class="nowrap">${esc(Dates.pl(o.date))}</td><td>${TYPE_BADGE(o)}<br><small class="dim">${esc(opProduct(o))}</small></td><td>${statusBadge(o.status)}</td><td class="r nowrap">${esc(opQty(o))}</td><td class="r nowrap">${esc(money(opValue(o)))}</td></tr>`).join("")}</tbody></table></div>`;
    return `<div class="tbl-wrap"><table class="tbl" id="${id}"><thead><tr><th>Nr</th><th>Data</th><th>Rodzaj</th><th>Status</th>${showWh ? "<th>Magazyn</th>" : ""}<th>Produkt</th><th class="r">Ilość</th><th>Kontrahent</th><th class="r">Wartość</th><th>Użytkownik</th><th></th></tr></thead><tbody>
      ${ops.map(o => `<tr class="clickable ${o.status === "CANCELLED" ? "void" : ""}" data-opid="${esc(o.id)}"><td class="mono nowrap">${esc(o.no)}</td><td class="nowrap">${esc(Dates.pl(o.date))}</td><td>${TYPE_BADGE(o)}</td><td>${statusBadge(o.status)}</td>${showWh ? `<td>${esc(App.whName(o.whId))}${o.toWhId ? ` → ${esc(App.whName(o.toWhId))}` : ""}</td>` : ""}
        <td>${esc(opProduct(o))}</td><td class="r nowrap">${esc(opQty(o))}</td><td>${esc(partnerName(opPartnerId(o)) || (o.mm ? o.mm.toWhName : ""))}</td><td class="r nowrap">${esc(money(opValue(o)))}</td><td>${esc(o.userName)}</td>
        <td class="r"><button class="btn sm" type="button">Szczegóły</button></td></tr>`).join("")}</tbody></table></div>`;
  }
  function bindOps(scope) { $$("[data-opid]", scope).forEach(tr => tr.onclick = () => OpDetail.open(tr.dataset.opid)); }
  function drill(ids, title) {
    const ops = [...new Set(ids)].map(id => R.byId(Store.state.operations, id)).filter(Boolean).sort((a, b) => a.date < b.date ? -1 : 1);
    const m = Modal.open({ title: `Operacje źródłowe — ${title}`, sub: `${ops.length} operacji`, xwide: true, id: "drill", body: opsTable(ops, { id: "drill-table", showWh: true }), footer: `<button class="btn primary" type="button" data-ok>Zamknij</button>` });
    $("[data-ok]", m.el).onclick = () => m.close();
    $$("[data-opid]", m.el).forEach(tr => tr.onclick = () => { m.close(); OpDetail.open(tr.dataset.opid); });
  }
  const drillAttr = (ids, title) => ids && ids.length ? ` class="drill" data-drill="${esc(ids.join(","))}" data-drill-title="${esc(title)}" tabindex="0" role="button"` : "";
  function bindDrill(scope) { $$("[data-drill]", scope).forEach(el => { const go = () => drill(el.dataset.drill.split(",").filter(Boolean), el.dataset.drillTitle || ""); el.onclick = go; el.onkeydown = e => { if (e.key === "Enter") go(); }; }); }

  const periodControls = (f, pre) => `
    <div class="field"><label for="${pre}-mode">Zakres</label><select class="ctrl" id="${pre}-mode">${[["day", "Dzień"], ["week", "Tydzień"], ["month", "Miesiąc"], ["year", "Rok"], ["custom", "Zakres własny"]].filter(([k]) => !f.noYear || k !== "year").map(([k, l]) => `<option value="${k}" ${f.mode === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    ${f.mode === "day" || f.mode === "week" ? `<div class="field"><label for="${pre}-date">${f.mode === "day" ? "Dzień" : "Dowolny dzień tygodnia"}</label><input class="ctrl" type="date" id="${pre}-date" value="${esc(f.date || App.today())}"></div>` : ""}
    ${f.mode === "month" ? `<div class="field"><label for="${pre}-ym">Miesiąc</label><input class="ctrl" type="month" id="${pre}-ym" value="${esc(f.ym || Dates.ym(App.today()))}"></div>` : ""}
    ${f.mode === "year" ? `<div class="field"><label for="${pre}-year">Rok</label><input class="ctrl" type="number" min="2000" max="2100" id="${pre}-year" value="${esc(f.year || App.today().slice(0, 4))}"></div>` : ""}
    ${f.mode === "custom" ? `<div class="field"><label for="${pre}-from">Od</label><input class="ctrl" type="date" id="${pre}-from" value="${esc(f.from || Dates.monthStart(Dates.ym(App.today())))}"></div><div class="field"><label for="${pre}-to">Do</label><input class="ctrl" type="date" id="${pre}-to" value="${esc(f.to || App.today())}"></div>` : ""}`;
  function bindPeriod(scope, f, pre, rerender) {
    const on = (sfx, k) => { const el = $(`#${pre}-${sfx}`, scope); if (el) el.onchange = e => { f[k] = e.target.value; rerender(); }; };
    on("mode", "mode"); on("date", "date"); on("ym", "ym"); on("year", "year"); on("from", "from"); on("to", "to");
  }
  const rangeOf = f => Dates.range({ mode: f.mode, date: f.date, ym: f.ym, year: f.year, from: f.from, to: f.to }, App.today());

  /* ================================================================== */
  /* PULPIT                                                               */
  /* ================================================================== */
  Views.pulpit = {
    html() {
      const S = Store.state, wh = App.wh(), cfg = S.config, today = App.today(), ym = Dates.ym(today);
      const month = R.Reports.business(S, { mode: "month", from: Dates.monthStart(ym), to: Dates.monthEnd(ym), whId: wh.id });
      const f = App.tabs.dash || (App.tabs.dash = { mode: "month", noYear: false });
      const rg = rangeOf(f);
      const turn = R.Reports.turnover(S, rg.from, rg.to, wh.id);
      const stock = Stock.byProduct(S, wh.id);
      const byCat = { m3: 0, MP: 0, t: 0 }, massCat = { m3: 0, MP: 0, t: 0 };
      for (const [pid, q] of stock) { const p = App.product(pid); if (!p) continue; byCat[p.unit] = R.rq(byCat[p.unit] + q); massCat[p.unit] += Units.mass(q, p, cfg); }
      const valuation = R.Reports.business(S, { mode: "custom", from: today, to: today, whId: wh.id }).valuation;
      const valTotal = valuation.filter(v => v.priced).reduce((a, v) => a + v.closingValue, 0), unpriced = valuation.filter(v => !v.priced).length;
      const T = cat => turn.find(t => t.cat === cat);
      const kpi = (t, v, unit, s, drillIds, id) => `<div class="kpi" ${id ? `id="${id}"` : ""}><div class="k-t">${esc(t)}</div><div class="k-v"${drillAttr(drillIds, t)}>${v}<u>${esc(unit)}</u></div>${s ? `<div class="k-s">${s}</div>` : ""}</div>`;
      const mT = cat => (month.turnover.find(t => t.cat === cat) || {});
      const kpis = `
        ${kpi("Drewno na stanie", fmtQ(byCat.m3, 1), "m³", `≈ ${fmt(massCat.m3, 0)} t · ≈ ${fmt(massCat.m3 * cfg.t_gj, 0)} GJ`, null, "kpi-wood")}
        ${kpi("Zrębka na stanie (wszystkie)", fmtQ(byCat.MP, 1), "MP", `≈ ${fmt(massCat.MP, 0)} t · ≈ ${fmt(massCat.MP * cfg.t_gj, 0)} GJ`, null, "kpi-chip")}
        ${kpi("Produkty tonowe", fmtQ(byCat.t, 1), "t", `≈ ${fmt(massCat.t * cfg.t_gj, 0)} GJ · PKS, łupina`, null, "kpi-ton")}
        ${kpi("Wartość stanu (wycena)", fmt(valTotal, 0), "zł", unpriced ? `bez wyceny: ${unpriced} poz.` : "średnia cena zakupu", null, "kpi-value")}
        ${kpi("Zakup (miesiąc)", fmt(month.purchases.value, 0), "zł", `${month.purchases.count} op. · ${esc(qtyByUnit(month.purchases.byUnit))}`, mT("ZAKUP").opIds, "kpi-purchase")}
        ${kpi("Sprzedaż (miesiąc)", fmt(month.sales.value + month.sales.valueDirect, 0), "zł", `${month.sales.count} op. · w tym bezp. ${fmt(month.sales.valueDirect, 0)} zł`, mT("SPRZEDAZ").opIds, "kpi-sales")}
        ${kpi("Produkcja (miesiąc)", fmtQ(month.production.chippingMP, 1), "MP", `rąbanie ${fmt(month.production.chippingCost, 0)} zł`, mT("PRODUKCJA").opIds, "kpi-prod")}
        ${kpi("Zużycie (miesiąc)", esc(qtyByUnit(Object.fromEntries(month.consumption.reduce((m, c) => m.set(c.unit, R.rq((m.get(c.unit) || 0) + c.qty)), new Map())))), "", "surowiec do produkcji", mT("ZUZYCIE").opIds, "kpi-cons")}
        ${kpi("Operacje (miesiąc)", String(S.operations.filter(o => o.whId === wh.id && Dates.ym(o.date) === ym && o.status !== "CANCELLED").length), "", `korekty ${month.corrections.length} · anulowania ${month.cancellations.length}`)}
        ${kpi("Transport (miesiąc)", String(month.transport.count), "kursów", `${fmt(month.transport.cost, 0)} zł · ${fmtQ(month.transport.km, 0)} km`)}`;
      const prods = S.products.filter(p => Math.abs(stock.get(p.id) || 0) > R.EPS);
      const maxBy = {}; prods.forEach(p => { maxBy[p.unit] = Math.max(maxBy[p.unit] || 0, stock.get(p.id)); });
      const stockRows = prods.map(p => {
        const q = stock.get(p.id), o = Units.orient(q, p, cfg);
        return `<div class="stock-row" data-stock-product="${esc(p.id)}">
          <div class="sr-name"><b>${esc(p.name)}</b><small class="dim">${esc(p.code)} · jednostka ${Units.label(p.unit)}</small></div>
          <div class="sr-bar"><span class="hbar-track"><span class="hbar-fill" style="width:${Math.max(2, q / maxBy[p.unit] * 100)}%"></span></span></div>
          <div class="sr-q"><b>${esc(App.qtyNative(q, p.id, 1))}</b><small class="dim">${p.unit === "t" ? "" : `≈ ${fmt(o.t, 0)} t · `}≈ ${fmt(o.gj, 0)} GJ</small></div>
          <div class="sr-spark">${sparkline(Stock.series(S, wh.id, p.id, today, 30), Units.label(p.unit))}</div></div>`;
      }).join("");
      const turnItems = ["ZAKUP", "PRODUKCJA", "ZUZYCIE", "SPRZEDAZ", "MM"].map(c => { const t = T(c); return { label: t.label, value: t.count, t, drill: t.opIds.join(",") }; });
      const last = S.operations.filter(o => o.whId === wh.id || o.toWhId === wh.id).slice().sort((a, b) => a.createdAt < b.createdAt ? 1 : -1).slice(0, 8);
      const drafts = S.drafts.filter(d => d.userId === App.user().id);
      const per = y => { const p = R.Inventory.find(S, wh.id, y); return p ? `<span class="badge ${p.status === "OTWARTA" ? "warn" : "ok"}">${R.INV_STATUS[p.status]}</span>` : `<span class="badge">brak okresu</span>`; };
      return `<div class="page-head"><div class="titles"><h2>Pulpit — ${esc(wh.name)}</h2><p>${esc(Dates.label(ym))} · ${esc(App.user().name)} (${esc(R.ROLES[App.user().role].label)}). Kwoty i ilości pochodzą z tego samego silnika co raporty i PDF.</p></div>
          <div class="actions"><a class="btn" href="#/raporty">${ic("chart", 15)} Raport miesiąca</a></div></div>
        <div class="quick" id="quick">
          <a class="qa" href="#/nowa?preset=zakup"><b>Zakup</b><span>dostawca → magazyn (PZ)</span></a>
          <a class="qa" href="#/nowa?preset=wz"><b>Sprzedaż z magazynu</b><span>magazyn → odbiorca (WZ)</span></a>
          <a class="qa" href="#/nowa?preset=produkcja"><b>Produkcja na magazyn</b><span>podaj MP → zużycie liczy system</span></a>
          <a class="qa" href="#/nowa?preset=bezposrednia"><b>Produkcja + sprzedaż bezp.</b><span>las → produkcja → odbiorca</span></a>
          <a class="qa" href="#/nowa?preset=mm"><b>Przesunięcie MM</b><span>magazyn → magazyn</span></a>
        </div>
        <div class="grid g5 mt4" id="kpis">${kpis}</div>
        <div class="grid mt4 dash-two">
          <div class="card"><div class="card-h"><h3>Stany magazynowe wg produktu</h3><span class="sub">jednostka produktu · masa i energia orientacyjnie · linia = ostatnie 30 dni</span></div>
            <div class="card-b stock-list" id="dash-stock">${stockRows || `<div class="empty">Brak stanów.</div>`}</div></div>
          <div class="card" id="dash-turnover"><div class="card-h"><h3>OBROTY WEDŁUG TYPU OPERACJI</h3><span class="sub">${esc(rg.label)}</span></div>
            <div class="toolbar">${periodControls(f, "dash")}</div>
            <div class="card-b"><p class="help mb3">Liczba operacji w zakresie (bez anulowanych). Ilości pokazane osobno dla każdej jednostki — jednostek się nie sumuje. Kliknij wiersz, aby zobaczyć operacje.</p>
              ${hbar(turnItems, { id: "turn-chart", valueText: i => `${i.value} op.`, tip: i => `<b>${esc(i.label)}</b><br>${i.value} operacji<br>${esc(qtyByUnit(i.t.byUnit))}${i.t.value !== null ? `<br>${esc(i.t.valueLabel)}: ${esc(money(i.t.value))}` : ""}` })}
              <div class="turn-grid mt4" id="turn-cards">${turnItems.map(i => `<div class="turn-card"><small>${esc(i.label)}</small><b>${esc(qtyByUnit(i.t.byUnit))}</b>${i.t.value !== null ? `<small>${esc(i.t.valueLabel)}: ${esc(money(i.t.value))}</small>` : `<small>—</small>`}</div>`).join("")}</div></div></div>
        </div>
        <div class="grid mt4 dash-split">
          <div class="card"><div class="card-h"><h3>Ostatnie operacje</h3><span class="spacer"></span><a class="btn sm" href="#/operacje">Wszystkie operacje</a></div>${opsTable(last, { id: "last-ops", compact: true })}</div>
          <div class="stack">
            ${drafts.length ? `<div class="card"><div class="card-h"><h3>Twoje wersje robocze</h3></div><div class="card-b"><ul class="rel-list">${drafts.map(d => `<li><a href="#/nowa?draft=${esc(d.id)}">${esc(R.OP_TYPES[d.type] ? R.OP_TYPES[d.type].label : d.type)}</a> · zapisano ${esc(d.savedAt.slice(0, 16).replace("T", " "))}</li>`).join("")}</ul></div></div>` : ""}
            <div class="card"><div class="card-h"><h3>Zamknięcie miesiąca</h3><span class="spacer"></span><a class="btn sm" href="#/inwentaryzacja">Inwentaryzacja</a></div>
              <div class="card-b stack" style="gap:10px"><div class="row"><span style="flex:1">${esc(Dates.label(ym))}</span>${per(ym)}</div>
              <p class="help">Po zamknięciu okresu dokumenty z tego miesiąca są tylko do odczytu — zmiany wyłącznie korektą z bieżącą datą.</p></div></div>
            <div class="card"><div class="card-h"><h3>Przeliczniki</h3></div><div class="card-b">
              <dl class="money-list"><dt>1 m³ drewna</dt><dd>${fmtQ(cfg.m3_mp)} MP zrębki</dd><dt>1 MP</dt><dd>${fmtQ(1 / cfg.m3_mp, 3)} m³ · ${fmt(cfg.mp_t, 2)} t</dd><dt>1 m³ drewna (masa)</dt><dd>≈ ${fmt(cfg.woodTPerM3, 3)} t</dd><dt>1 t biomasy</dt><dd>≈ ${fmt(cfg.t_gj, 1)} GJ</dd><dt>PKS, łupina nerkowca</dt><dd>tylko t</dd><dt>Cena za rąbanie</dt><dd>${fmt(cfg.chipRateDefault)} zł/MP</dd></dl></div></div>
          </div>
        </div>`;
    },
    bind(page) {
      const f = App.tabs.dash;
      bindPeriod(page, f, "dash", () => App.render());
      $$("[data-drill]", page).forEach(el => { if (el.classList.contains("hbar-row")) el.classList.add("drill"); });
      bindDrill(page); bindOps(page); Tip.bind(page);
    }
  };

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
      const drafts = S.drafts.filter(d => d.whId === App.user().whId);
      return `<div class="page-head"><div class="titles"><h2>Operacje</h2><p>Rejestr wszystkich operacji magazynu ${esc(App.wh().name)} ze statusem dokumentu. Kliknij wiersz — szczegóły, powiązania, korekta, anulowanie. Dokumentów zatwierdzonych nie usuwa się.</p></div>
          <div class="actions">${App.can("op.create") ? `<a class="btn primary" href="#/nowa">${ic("plus", 15)} Nowa operacja</a>` : ""}<button class="btn" type="button" id="ops-csv">${ic("dl", 15)} CSV</button></div></div>
        ${drafts.length ? `<div class="card mb4" id="drafts"><div class="card-h"><h3>Wersje robocze (ROBOCZY)</h3><span class="sub">bez numeru, bez wpływu na stan</span></div><div class="tbl-wrap"><table class="tbl" id="drafts-table"><thead><tr><th>Rodzaj</th><th>Autor</th><th>Zapisano</th><th>Status</th><th></th></tr></thead><tbody>
          ${drafts.map(d => `<tr><td>${esc(R.OP_TYPES[d.type] ? R.OP_TYPES[d.type].label : d.type)}${d.type === "SPRZEDAZ" && d.draft.sale.direct ? " (bezpośrednia)" : ""}</td><td>${esc(d.userName)}</td><td>${esc(d.savedAt.slice(0, 16).replace("T", " "))}</td><td>${statusBadge("DRAFT")}</td>
            <td class="r nowrap">${d.userId === App.user().id ? `<a class="btn sm" href="#/nowa?draft=${esc(d.id)}">Otwórz</a>` : ""} ${d.userId === App.user().id || App.can("documents.cancel") ? `<button class="btn sm danger" type="button" data-deldraft="${esc(d.id)}">${ic("trash", 13)} Usuń szkic</button>` : ""}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
        <div class="card"><div class="toolbar">
          <div class="field"><label for="o-type">Rodzaj</label><select class="ctrl" id="o-type">${[["", "Wszystkie"], ["ZAKUP", "Zakup"], ["SPRZEDAZ", "Sprzedaż (WZ)"], ["DIRECT", "Sprzedaż bezpośrednia"], ["PRODUKCJA", "Produkcja na magazyn"], ["MM", "MM"]].map(([v, l]) => `<option value="${v}" ${f.type === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="field"><label for="o-status">Status</label><select class="ctrl" id="o-status"><option value="">Wszystkie</option>${["POSTED", "CORRECTED", "CANCELLED"].map(s => `<option value="${s}" ${f.status === s ? "selected" : ""}>${R.STATUS[s]}</option>`).join("")}</select></div>
          <div class="field"><label for="o-ym">Miesiąc</label><input class="ctrl" type="month" id="o-ym" value="${esc(f.ym)}"></div>
          <div class="field"><label for="o-scope">Magazyn</label><select class="ctrl" id="o-scope"><option value="active" ${f.scope === "active" ? "selected" : ""}>Aktywny</option><option value="all" ${f.scope === "all" ? "selected" : ""}>Wszystkie</option></select></div>
          <div class="field grow"><label for="o-q">Szukaj</label><input class="ctrl" type="search" id="o-q" value="${esc(f.q)}" placeholder="numer, kontrahent, produkt, uwagi…"></div></div>
          ${opsTable(rows, { showWh: f.scope === "all" })}
          <div class="toolbar" style="border:0"><span class="dim">${rows.length} operacji · ${rows.filter(o => o.status === "CANCELLED").length} anulowanych · ${rows.filter(o => o.status === "CORRECTED").length} skorygowanych</span></div></div>`;
    },
    bind(page) {
      const f = App.tabs.ops;
      const on = (id, k) => { const el = $(id, page); if (el) el.onchange = e => { f[k] = e.target.value; App.render(); }; };
      on("#o-type", "type"); on("#o-status", "status"); on("#o-ym", "ym"); on("#o-scope", "scope");
      $("#o-q", page).oninput = e => { f.q = e.target.value; clearTimeout(this._t); this._t = setTimeout(() => { App.render(); const q = $("#o-q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250); };
      bindOps(page);
      $$("[data-deldraft]", page).forEach(b => b.onclick = async () => {
        const r = await Modal.confirm({ title: "Usunąć wersję roboczą?", text: "Szkic nie ma numeru ani wpływu na stan. Usunięcie zostanie zapisane w dzienniku audytu.", ok: "Usuń szkic", danger: true });
        if (!r.ok) return;
        const uid = App.user().id;
        const res = await Store.transact(s => R.deleteDraft(s, b.dataset.deldraft, { user: R.byId(s.users, uid), today: App.today(), source: "Rejestr operacji" }));
        if (res.ok) { Toast.ok("Usunięto wersję roboczą"); if (UI.Form.draft && UI.Form.draft.draftId === b.dataset.deldraft) UI.Form.draft.draftId = null; } else Toast.err("Nie usunięto", res.error);
        App.render();
      });
      $("#ops-csv", page).onclick = () => download(`operacje_${App.today()}.csv`, toCSV(["Nr", "Data", "Rodzaj", "Status", "Magazyn", "Produkt", "Ilość", "Kontrahent", "Wartość zł", "Wynik zł", "Użytkownik", "Dokumenty"],
        this.filtered().map(o => [o.no, o.date, opTypeLabel(o), R.STATUS[o.status], App.whName(o.whId), opProduct(o), opQty(o), partnerName(opPartnerId(o)), csvNum(opValue(o)), csvNum(o.totals.result), o.userName, o.documents.map(d => d.no).join(" ")])), "text/csv;charset=utf-8");
    }
  };

  /* ================================================================== */
  /* Rejestry dokumentów: Przyjęcia, Wydania/WZ, Produkcja, MM, Dokumenty */
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
        return `<div class="page-head"><div class="titles"><h2>${esc(cfg.title)}</h2><p>${cfg.desc}</p></div>
            <div class="actions">${(cfg.buttons || []).filter(b => App.can("op.create")).map(b => `<a class="btn ${b.primary ? "primary" : ""}" href="${b.href}">${ic("plus", 15)} ${esc(b.label)}</a>`).join("")}<button class="btn" type="button" id="reg-csv">${ic("dl", 15)} CSV</button></div></div>
          ${cfg.extra ? cfg.extra() : ""}
          <div class="card"><div class="toolbar">
            ${cfg.typeOptions ? `<div class="field"><label for="r-type">Typ</label><select class="ctrl" id="r-type"><option value="">Wszystkie</option>${cfg.typeOptions.map(([v, l]) => `<option value="${v}" ${f.type === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>` : ""}
            <div class="field"><label for="r-status">Status</label><select class="ctrl" id="r-status"><option value="">Wszystkie</option>${["POSTED", "CORRECTED", "CANCELLED"].map(s => `<option value="${s}" ${f.status === s ? "selected" : ""}>${R.STATUS[s]}</option>`).join("")}</select></div>
            <div class="field"><label for="r-ym">Miesiąc</label><input class="ctrl" type="month" id="r-ym" value="${esc(f.ym)}"></div>
            <div class="field grow"><label for="r-q">Szukaj</label><input class="ctrl" type="search" id="r-q" value="${esc(f.q)}" placeholder="numer, kontrahent, miejsce…"></div></div>
            ${rows.length ? `<div class="tbl-wrap"><table class="tbl" id="docs-table"><thead><tr><th>Nr dokumentu</th><th>Typ</th><th>Data</th><th>Treść</th><th class="r">Ilość</th><th class="r">Wartość</th><th>Kontrahent</th><th>Miejsce transportu</th><th>Wpływ na stan</th><th>Status</th><th></th></tr></thead><tbody>
              ${rows.map((d, i) => `<tr class="${d.status === "CANCELLED" ? "void" : ""}"><td class="mono nowrap">${esc(d.no)}</td><td><span class="badge">${d.type}</span></td><td class="nowrap">${esc(Dates.pl(d.date))}</td>
                <td>${esc(docContent(d))}</td><td class="r nowrap">${d.qty != null ? esc(fmtQ(d.qty) + " " + Units.label(d.unit)) : "—"}</td>
                <td class="r nowrap">${d.value ? esc(money(d.value)) : "—"}</td><td>${esc(d.partner || (d.transport && (d.transport.company || d.transport.carrier)) || "")}</td>
                <td>${esc(d.place || "—")}</td><td>${stockLbl(d)}</td><td>${statusBadge(d.status)}</td>
                <td class="r nowrap"><button class="btn sm" type="button" data-view="${i}">Podgląd</button>${d.opId ? ` <button class="btn sm" type="button" data-opd="${esc(d.opId)}">Operacja</button>` : ""}</td></tr>`).join("")}
              </tbody><tfoot><tr><td colspan="4">Razem (bez anulowanych)</td><td class="r">${esc(Object.entries(perUnit).map(([u, q]) => `${fmtQ(q)} ${Units.label(u)}`).join(" · ") || "—")}</td><td class="r">${esc(money(value))}</td><td colspan="5"></td></tr></tfoot></table></div>` : `<div class="empty">Brak dokumentów dla wybranych filtrów.</div>`}
          </div>`;
      },
      bind(page) {
        const f = App.tabs[cfg.id], rows = this.filtered();
        const on = (id, k) => { const el = $(id, page); if (el) el.onchange = e => { f[k] = e.target.value; App.render(); }; };
        on("#r-type", "type"); on("#r-status", "status"); on("#r-ym", "ym");
        $("#r-q", page).oninput = e => { f.q = e.target.value; clearTimeout(this._t); this._t = setTimeout(() => { App.render(); const q = $("#r-q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250); };
        $$("[data-view]", page).forEach(b => b.onclick = () => DocPreview.open(rows[+b.dataset.view]));
        $$("[data-opd]", page).forEach(b => b.onclick = () => OpDetail.open(b.dataset.opd));
        $("#reg-csv", page).onclick = () => download(`${cfg.id}_${App.today()}.csv`, toCSV(["Nr dokumentu", "Typ", "Data", "Treść", "Ilość", "Jednostka", "Wartość zł", "Kontrahent", "Miejsce transportu", "Wpływ na stan", "Status", "Operacja"],
          rows.map(d => [d.no, d.type, d.date, docContent(d), csvNum(d.qty), d.unit ? Units.label(d.unit) : "", csvNum(d.value), d.partner || "", d.place || "", d.stock, R.STATUS[d.status] || d.status, d.opNo || ""])), "text/csv;charset=utf-8");
        if (cfg.bind) cfg.bind(page);
      }
    };
  }
  Views.przyjecia = docRegister({ id: "przyjecia", title: "Przyjęcia", types: ["PZ", "PW", "MM"], filter: (d, wh) => d.type !== "MM" || d.toWhId === wh, typeOptions: [["PZ", "PZ — zakup"], ["PW", "PW — z produkcji"], ["MM", "MM — przychód z innego magazynu"]],
    desc: "Dokumenty zwiększające stan aktywnego magazynu: zakupy (PZ), przyjęcia z produkcji (PW) i przesunięcia przychodzące (MM). PW sprzedaży bezpośredniej jest widoczne, ale nie zwiększa stanu końcowego (towar od razu wydany WZ).",
    buttons: [{ label: "Nowy zakup (PZ)", href: "#/nowa?preset=zakup", primary: true }] });
  Views.wz = docRegister({ id: "wz", title: "Wydania / WZ", types: ["WZ", "RW", "MM"], filter: (d, wh) => d.type !== "MM" || d.whId === wh, typeOptions: [["WZ", "WZ — sprzedaż"], ["RW", "RW — zużycie do produkcji"], ["MM", "MM — rozchód do innego magazynu"]],
    desc: "Dokumenty zmniejszające stan: sprzedaż (WZ), zużycie surowca (RW) i przesunięcia wychodzące (MM). WZ nie może przekroczyć stanu dostępnego.",
    buttons: [{ label: "Nowa sprzedaż (WZ)", href: "#/nowa?preset=wz", primary: true }] });
  Views.mm = docRegister({ id: "mm", title: "Przesunięcia międzymagazynowe (MM)", types: ["MM"], desc: "Rozchód z magazynu źródłowego i przychód w docelowym jednym dokumentem. Stan firmy ogółem się nie zmienia.",
    buttons: [{ label: "Nowe przesunięcie MM", href: "#/nowa?preset=mm", primary: true }] });
  Views.dokumenty = docRegister({ id: "dokumenty", title: "Dokumenty", typeOptions: [["PZ", "PZ — zakup"], ["RW", "RW — zużycie"], ["PW", "PW — produkcja"], ["WZ", "WZ — sprzedaż"], ["MM", "MM — przesunięcie"], ["TR", "TR — transport"], ["KOR", "KOR — korekta"], ["AN", "AN — anulowanie"], ["IN", "IN — inwentaryzacja"], ["BO", "BO — bilans otwarcia"]],
    desc: "Wszystkie dokumenty aktywnego magazynu z kolumną Status. Anulowanie i korekta tworzą nowe dokumenty (AN, KOR) — dokument pierwotny pozostaje nienaruszony.",
    buttons: [] });

  /* ------------------------------ Produkcja ------------------------------ */
  Views.produkcja = {
    html() {
      const S = Store.state, wh = App.user().whId;
      const f = App.tabs.prod || (App.tabs.prod = { ym: Dates.ym(App.today()), mode: "" });
      const ops = S.operations.filter(o => o.production && (o.whId === wh) && (!f.ym || o.date.startsWith(f.ym)) && (!f.mode || o.production.mode === f.mode)).sort((a, b) => a.date < b.date ? 1 : -1);
      const live = ops.filter(o => o.status !== "CANCELLED");
      const sum = k => R.rq(live.reduce((a, o) => a + (o.production[k] || 0), 0));
      return `<div class="page-head"><div class="titles"><h2>Produkcja</h2><p>Produkcja na magazyn (surowiec ze stanu → produkt na stan), produkcja w łańcuchu zakupu oraz produkcja ze sprzedażą bezpośrednią. Zużycie surowca = produkcja ÷ przelicznik (1 m³ = 4 MP).</p></div>
          <div class="actions">${App.can("op.create") ? `<a class="btn primary" href="#/nowa?preset=produkcja">${ic("plus", 15)} Produkcja na magazyn</a><a class="btn" href="#/nowa?preset=bezposrednia">${ic("plus", 15)} Produkcja + sprzedaż bezp.</a>` : ""}<a class="btn" href="#/kwit">${ic("receipt", 15)} Kwit produkcji dnia</a></div></div>
        <div class="card"><div class="toolbar">
          <div class="field"><label for="p-ym">Miesiąc</label><input class="ctrl" type="month" id="p-ym" value="${esc(f.ym)}"></div>
          <div class="field"><label for="p-mode">Rodzaj</label><select class="ctrl" id="p-mode">${[["", "Wszystkie"], ["stock", "Na magazyn"], ["chain", "Z zakupu (łańcuch)"], ["direct", "Bezpośrednia (las)"]].map(([v, l]) => `<option value="${v}" ${f.mode === v ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
          ${ops.length ? `<div class="tbl-wrap"><table class="tbl" id="prod-table"><thead><tr><th>Nr PW</th><th>Data</th><th>Rodzaj</th><th>Status</th><th>Surowiec</th><th class="r">Zużycie</th><th>Produkt</th><th class="r">Produkcja</th><th class="r">≈ t / ≈ GJ</th><th class="r">Rąbanie</th><th>Operator</th></tr></thead><tbody>
            ${ops.map(o => { const X = o.production, out = App.product(X.outProductId), or = Units.orient(X.outQty, out, S.config); return `<tr class="clickable ${o.status === "CANCELLED" ? "void" : ""}" data-opid="${esc(o.id)}"><td class="mono nowrap">${esc((o.documents.find(d => d.type === "PW") || {}).no || o.no)}</td><td class="nowrap">${esc(Dates.pl(o.date))}</td>
              <td>${X.mode === "stock" ? "na magazyn" : X.mode === "direct" ? "bezpośrednia" : "z zakupu"}</td><td>${statusBadge(o.status)}</td><td>${esc(pName(X.rawProductId))}</td>
              <td class="r nowrap">${X.consumeQty !== null ? esc(fmtQ(X.consumeQty) + " " + Units.label(X.consumeUnit)) : "—"}${X.mode === "direct" ? "<br><small class='dim'>nie ze stanu</small>" : ""}</td>
              <td>${esc(pName(X.outProductId))}</td><td class="r nowrap"><b>${esc(fmtQ(X.outQty) + " " + Units.label(X.outUnit))}</b></td><td class="r nowrap">${fmt(or.t, 1)} t · ${fmt(or.gj, 0)} GJ</td>
              <td class="r nowrap">${esc(money(X.chippingCost))}<br><small class="dim">${fmt(X.chipRate)} zł/MP</small></td><td>${esc(X.operatorName || o.userName)}</td></tr>`; }).join("")}
            </tbody><tfoot><tr><td colspan="7">Razem (bez anulowanych)</td><td class="r">${esc(fmtQ(sum("outQty")))} MP</td><td></td><td class="r">${esc(money(live.reduce((a, o) => a + o.production.chippingCost, 0)))}</td><td></td></tr></tfoot></table></div>` : `<div class="empty">Brak produkcji w wybranym okresie.</div>`}</div>`;
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
    const rows = k.rows.map(r => [r.docNo, r.mode, r.status === "CANCELLED" ? "ANULOWANY" : R.STATUS[r.status], r.operator + (r.chipper ? ` (${r.chipper})` : ""), r.raw, r.consume !== null && r.consume !== undefined ? `${fmtQ(r.consume, 6)} ${Units.label(r.consumeUnit)}${r.consumeFromStock ? "" : " (las)"}` : "—", r.product,
      r.mp !== null ? fmtQ(r.mp) : "—", r.m3 !== null ? fmtQ(r.m3) : "—", fmt(r.t, 2), fmt(r.gj, 1), fmt(r.chipRate), money(r.chipCost), r.notes || ""]);
    return {
      title: `Kwit produkcji dnia ${Dates.pl(k.date)}`, subtitle: `Magazyn: ${whText}`, orientation: "landscape", headerRight: whText, rangeText: Dates.pl(k.date), whText,
      meta: [["Data", Dates.pl(k.date)], ["Magazyn", whText], ["Liczba produkcji", String(k.totals.count)], ["Przeliczniki", "1 m³ = 4 MP · 1 MP = 0,33 t · 1 t = 8,5 GJ"]],
      blocks: [
        { type: "kpis", items: [["Produkcja", `${fmtQ(k.totals.mp)} MP`, `= ${fmtQ(k.totals.m3)} m³ surowca`], ["Masa orientacyjna", `${fmt(k.totals.t, 2)} t`, ""], ["Energia orientacyjna", `${fmt(k.totals.gj, 1)} GJ`, ""], ["Koszt rąbania", money(k.totals.chipCost), ""]] },
        { type: "h", text: "Pozycje kwitu" },
        { type: "table", columns: [{ label: "Nr PW", w: 1.3 }, { label: "Rodzaj", w: 1 }, { label: "Status", w: 1.1 }, { label: "Operator", w: 1.6 }, { label: "Surowiec", w: 1.4 }, { label: "Zużycie", w: 1.2, align: "right" }, { label: "Produkt", w: 1.6 }, { label: "MP", w: 0.8, align: "right" }, { label: "m³", w: 0.7, align: "right" }, { label: "t", w: 0.8, align: "right" }, { label: "GJ", w: 0.8, align: "right" }, { label: "zł/MP", w: 0.7, align: "right" }, { label: "Koszt", w: 1.1, align: "right" }, { label: "Uwagi", w: 1.4 }], rows,
          foot: ["Razem", "", "", "", "", "", "", fmtQ(k.totals.mp), fmtQ(k.totals.m3), fmt(k.totals.t, 2), fmt(k.totals.gj, 1), "", money(k.totals.chipCost), ""], empty: "Brak produkcji w tym dniu.", note: "Anulowane produkcje są pokazane dla kontroli, ale nie wchodzą do sumy. Masa i energia są orientacyjne." },
        { type: "signatures", labels: ["Operator rębaka", "Magazynier", "Kierownik"] }
      ]
    };
  }
  Views.kwit = {
    html() {
      const S = Store.state;
      const f = App.tabs.kwit || (App.tabs.kwit = { date: App.today(), wh: App.user().whId });
      const whId = f.wh === "all" ? null : f.wh;
      const k = R.Reports.productionDay(S, f.date, whId);
      const whText = whId ? App.whName(whId) : "wszystkie magazyny";
      const model = kwitModel(k, whText);
      return `<div class="page-head"><div class="titles"><h2>Kwit produkcji dnia</h2><p>Zestawienie produkcji z jednego dnia: surowiec, zużycie, produkt, MP, m³, t, GJ, cena i koszt rąbania. Dane z tych samych dokumentów PW/RW co raporty.</p></div>
          <div class="actions">${printButtons("kwit")}</div></div>
        <div class="card"><div class="toolbar">
          <div class="field"><label for="k-date">Dzień</label><input class="ctrl" type="date" id="k-date" value="${esc(f.date)}" max="${esc(App.today())}"></div>
          <div class="field"><label for="k-wh">Magazyn</label><select class="ctrl" id="k-wh">${S.warehouses.map(w => `<option value="${w.id}" ${f.wh === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}<option value="all" ${f.wh === "all" ? "selected" : ""}>Wszystkie</option></select></div>
          <button class="btn ghost" type="button" id="k-prev">← Poprzedni dzień</button><button class="btn ghost" type="button" id="k-next">Następny dzień →</button></div>
          <div class="card-b"><div class="grid g4" id="kwit-kpis">${model.blocks[0].items.map(([a, b, c]) => `<div class="kpi"><div class="k-t">${esc(a)}</div><div class="k-v">${esc(b)}</div>${c ? `<div class="k-s">${esc(c)}</div>` : ""}</div>`).join("")}</div></div>
          ${renderTable(model.blocks[2], "kwit-table", k.rows.map(r => r.opId))}</div>`;
    },
    bind(page) {
      const f = App.tabs.kwit;
      $("#k-date", page).onchange = e => { f.date = e.target.value || App.today(); App.render(); };
      $("#k-wh", page).onchange = e => { f.wh = e.target.value; App.render(); };
      $("#k-prev", page).onclick = () => { f.date = Dates.addDays(f.date, -1); App.render(); };
      $("#k-next", page).onclick = () => { const n = Dates.addDays(f.date, 1); if (n <= App.today()) { f.date = n; App.render(); } };
      const whId = f.wh === "all" ? null : f.wh, whText = whId ? App.whName(whId) : "wszystkie magazyny";
      const model = () => kwitModel(R.Reports.productionDay(Store.state, f.date, whId), whText);
      $("[data-print]", page).onclick = () => Printer.print(model(), "KWIT");
      $("[data-pdf]", page).onclick = () => Printer.pdf(model(), "KWIT", `kwit_produkcji_${f.date}`);
      bindOps(page);
    }
  };
  /** Tabela z modelu dokumentu (ta sama treść co w PDF). */
  function renderTable(b, id, opIds, drills, drillTitle) {
    const attrs = i => {
      const cls = [opIds && opIds[i] ? "clickable" : "", drills && drills[i] && drills[i].length ? "drill" : "", b.bold && b.bold.includes(i) ? "b" : ""].filter(Boolean).join(" ");
      return `${cls ? ` class="${cls}"` : ""}${opIds && opIds[i] ? ` data-opid="${esc(opIds[i])}"` : ""}${drills && drills[i] && drills[i].length ? ` data-drill="${esc(drills[i].join(","))}" data-drill-title="${esc(drillTitle || "")}" tabindex="0"` : ""}`;
    };
    return `<div class="tbl-wrap"><table class="tbl" id="${id}"><thead><tr>${b.columns.map(c => `<th class="${c.align === "right" ? "r" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>
      ${b.rows.length ? b.rows.map((r, i) => `<tr${attrs(i)}>${r.map((v, j) => `<td class="${b.columns[j].align === "right" ? "r nowrap" : ""}${/^(NIESPÓJNY|ANULOWANY)/.test(String(v)) ? " neg" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${b.columns.length}" class="empty">${esc(b.empty || "Brak danych.")}</td></tr>`}
      </tbody>${b.foot ? `<tfoot><tr>${b.foot.map((v, j) => `<td class="${b.columns[j].align === "right" ? "r nowrap" : ""}">${esc(v)}</td>`).join("")}</tr></tfoot>` : ""}</table></div>${b.note ? `<p class="help" style="padding:8px 16px">${esc(b.note)}</p>` : ""}`;
  }

  /* ------------------------------ Transport ------------------------------ */
  Views.transport = {
    html() {
      const S = Store.state, wh = App.user().whId;
      const f = App.tabs.tr || (App.tabs.tr = { ym: Dates.ym(App.today()), mode: "" });
      const ops = S.operations.filter(o => o.whId === wh && o.transport && o.transport.mode !== "none" && (!f.ym || o.date.startsWith(f.ym)) && (!f.mode || o.transport.mode === f.mode)).sort((a, b) => a.date < b.date ? 1 : -1);
      const live = ops.filter(o => o.status !== "CANCELLED");
      const byMode = Object.keys(R.TRANSPORT_MODES).filter(k => k !== "none").map(k => { const x = live.filter(o => o.transport.mode === k); return { label: R.TRANSPORT_MODES[k], value: x.length, cost: x.reduce((a, o) => a + o.transport.cost, 0), km: x.reduce((a, o) => a + (o.transport.km || 0), 0), drill: x.map(o => o.id).join(",") }; });
      return `<div class="page-head"><div class="titles"><h2>Transport</h2><p>Kursy własne, zewnętrzne i kolejowe. Transport nie zmienia stanu — to koszt operacji i karta TR.</p></div></div>
        <div class="grid g4 mb4">
          <div class="kpi"><div class="k-t">Kursy</div><div class="k-v">${live.reduce((a, o) => a + (o.transport.mode === "own" ? (o.transport.runs || [1]).length : 1), 0)}</div><div class="k-s">${live.length} operacji</div></div>
          <div class="kpi"><div class="k-t">Koszt</div><div class="k-v">${fmt(live.reduce((a, o) => a + o.transport.cost, 0), 0)}<u>zł</u></div></div>
          <div class="kpi"><div class="k-t">Kilometry</div><div class="k-v">${fmtQ(live.reduce((a, o) => a + (o.transport.km || 0), 0), 0)}<u>km</u></div></div>
          <div class="kpi"><div class="k-t">Pociągi</div><div class="k-v">${live.filter(o => o.transport.mode === "train").reduce((a, o) => a + o.transport.wagonCount, 0)}<u>wag.</u></div><div class="k-s">${fmtQ(live.filter(o => o.transport.mode === "train").reduce((a, o) => a + o.transport.totalT, 0))} t</div></div></div>
        <div class="grid dash-split">
          <div class="card"><div class="toolbar">
            <div class="field"><label for="t-ym">Miesiąc</label><input class="ctrl" type="month" id="t-ym" value="${esc(f.ym)}"></div>
            <div class="field"><label for="t-mode">Rodzaj</label><select class="ctrl" id="t-mode"><option value="">Wszystkie</option>${Object.entries(R.TRANSPORT_MODES).filter(([k]) => k !== "none").map(([k, l]) => `<option value="${k}" ${f.mode === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
            ${ops.length ? `<div class="tbl-wrap"><table class="tbl" id="tr-table"><thead><tr><th>Karta TR</th><th>Data</th><th>Status</th><th>Rodzaj</th><th>Przewoźnik / pojazd</th><th>Miejsce</th><th class="r">km</th><th class="r">Tonaż</th><th class="r">Koszt</th></tr></thead><tbody>
              ${ops.map(o => { const t = o.transport; return `<tr class="clickable ${o.status === "CANCELLED" ? "void" : ""}" data-opid="${esc(o.id)}"><td class="mono">${esc((o.documents.find(d => d.type === "TR") || {}).no || "")}</td><td class="nowrap">${esc(Dates.pl(o.date))}</td><td>${statusBadge(o.status)}</td><td>${esc(R.TRANSPORT_MODES[t.mode])}</td><td>${esc(transportText(t))}</td><td>${esc(t.place)}</td><td class="r">${fmtQ(t.km || 0)}</td><td class="r">${t.mode === "train" ? `${fmtQ(t.totalT)} t` : "—"}</td><td class="r">${esc(money(t.cost))}</td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">Brak kursów.</div>`}</div>
          <div class="card"><div class="card-h"><h3>Kursy wg rodzaju</h3></div><div class="card-b">${hbar(byMode, { id: "tr-chart", valueText: i => `${i.value} · ${money(i.cost)}`, tip: i => `<b>${esc(i.label)}</b><br>${i.value} kursów<br>${esc(money(i.cost))} · ${esc(fmtQ(i.km, 0))} km` })}</div></div></div>`;
    },
    bind(page) {
      const f = App.tabs.tr;
      $("#t-ym", page).onchange = e => { f.ym = e.target.value; App.render(); };
      $("#t-mode", page).onchange = e => { f.mode = e.target.value; App.render(); };
      $$(".hbar-row[data-drill]", page).forEach(el => { el.classList.add("drill"); el.onclick = () => drill(el.dataset.drill.split(",").filter(Boolean), "transport"); });
      bindOps(page); Tip.bind(page);
    }
  };

  /* ================================================================== */
  /* STANY                                                               */
  /* ================================================================== */
  const CAT_LABEL = { drewno: "Drewno", zrebka: "Zrębka", agro: "Produkt tonowy" };
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
            <td>${esc(CAT_LABEL[p.cat] || p.cat)}</td>
            <td class="r stock-q" data-native="${esc(p.id)}"><b>${esc(App.qtyNative(q, p.id))}</b></td>
            <td class="r dim" data-mass="${esc(p.id)}">${p.unit === "t" ? "—" : esc(App.mass(q, p.id))}</td>
            <td class="r dim" data-gj="${esc(p.id)}">${esc(App.energy(q, p.id))}</td>
            <td>${esc(whId ? Dates.pl(Stock.lastMove(S, whId, p.id) || "") || "—" : "")}</td>
            <td class="r">${whId ? `<button class="btn sm" type="button">Kartoteka</button>` : ""}</td></tr>`;
        }).join("");
        const foot = Object.entries(perUnit).map(([u, q]) => `${fmtQ(q)} ${Units.label(u)}`).join(" · ");
        return `<div class="card mt4"><div class="card-h"><h3>${esc(title)}</h3><span class="sub">${f.to ? "stan na " + esc(Dates.pl(f.to)) : "stan bieżący"}</span></div>
          ${rows.length ? `<div class="tbl-wrap"><table class="tbl" data-stock="${esc(whId || "all")}"><thead><tr><th>Produkt</th><th>Kategoria</th><th class="r">Stan (jednostka magazynowa)</th><th class="r">Masa ≈ t</th><th class="r">Energia ≈ GJ</th><th>Ostatni ruch</th><th></th></tr></thead>
            <tbody>${body}</tbody><tfoot><tr><td colspan="2">Razem wg jednostek (jednostek się nie sumuje)</td><td class="r">${esc(foot)}</td><td class="r">≈ ${fmt(perT.t, 0)} t</td><td class="r">≈ ${fmt(perT.gj, 0)} GJ</td><td colspan="2"></td></tr></tfoot></table></div>` : `<div class="empty">Brak stanów.</div>`}</div>`;
      };
      const blocks = whs.map(wh => block(wh.name, Stock.byProduct(S, wh.id, f.to || null), wh.id)).join("") + (f.scope === "all" ? block("Razem firma (wszystkie magazyny)", Stock.byProduct(S, null, f.to || null), null) : "");
      return `<div class="page-head"><div class="titles"><h2>Stany magazynowe</h2>
          <p>Stan w jednostce magazynowej produktu: drewno m³, zrębka MP, PKS i łupina nerkowca t. Masa (≈ t) i energia (≈ GJ, 1 t = ${fmt(cfg.t_gj, 1)} GJ) są orientacyjne — nie zastępują wagi rzeczywistej.</p></div>
          <div class="actions"><button class="btn" type="button" id="stock-csv">${ic("dl", 15)} Eksport CSV</button></div></div>
        <div class="card"><div class="toolbar">
          <div class="field"><label for="st-to">Stan na dzień</label><input class="ctrl" type="date" id="st-to" value="${esc(f.to)}" max="${esc(App.today())}"></div>
          <div class="field"><label for="st-scope">Magazyn</label><select class="ctrl" id="st-scope"><option value="active" ${f.scope === "active" ? "selected" : ""}>Aktywny (${esc(App.wh().name)})</option>${S.warehouses.map(w => `<option value="${w.id}" ${f.scope === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}<option value="all" ${f.scope === "all" ? "selected" : ""}>Wszystkie + razem firma</option></select></div>
          <button class="btn ghost" type="button" id="st-clear">Stan bieżący</button></div></div>
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
        download(`stany_${f.to || App.today()}.csv`, toCSV(["Magazyn", "Kod", "Produkt", "Ilość", "Jednostka magazynowa", "Masa orientacyjna t", "Energia orientacyjna GJ"], rows), "text/csv;charset=utf-8");
      };
    },
    card(whId, pid) {
      const S = Store.state, p = App.product(pid), wh = R.byId(S.warehouses, whId);
      const rows = Stock.card(S, whId, pid);
      const m = Modal.open({
        title: `Kartoteka: ${p.name}`, sub: `${esc(wh.name)} · jednostka magazynowa ${Units.label(p.unit)}`, xwide: true, id: "stock-card",
        body: `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Dokument</th><th>Rodzaj</th><th class="r">Przychód</th><th class="r">Rozchód</th><th class="r">Saldo</th><th class="r">≈ t</th><th class="r">≈ GJ</th></tr></thead><tbody>
          ${rows.map(r => { const o = Units.orient(r.balance, p, S.config); return `<tr class="${r.opId ? "clickable" : ""}" ${r.opId ? `data-opid="${esc(r.opId)}"` : ""}><td>${esc(Dates.pl(r.date))}</td><td class="mono">${esc(r.docNo)}</td><td>${esc(R.KINDS[r.kind].label)}${r.direct ? " · bezpośrednio" : ""}</td>
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
      title: "Historia operacji — rejestr ruchów", subtitle: `${whText} · ${rangeText}`, orientation: "landscape", headerRight: whText, rangeText, whText,
      meta: [["Okres", rangeText], ["Magazyn", whText], ["Produkt", f.productId ? pName(f.productId) : "wszystkie"], ["Typ", f.type ? R.HISTORY_TYPES[f.type] : "wszystkie"], ["Kontrahent", f.partnerId ? partnerName(f.partnerId) : "wszyscy"], ["Pozycji", String(rows.length)]],
      blocks: [{ type: "table", size: 7, columns: [{ label: "Data", w: 1.1 }, { label: "Godz.", w: 0.6 }, { label: "Użytkownik", w: 1.4 }, { label: "Typ", w: 1.3 }, { label: "Dokument", w: 1.4 }, { label: "Magazyn", w: 1.2 }, { label: "Produkt", w: 1.8 }, { label: "Stan przed", w: 1.1, align: "right" }, { label: "Zmiana", w: 1.1, align: "right" }, { label: "Stan po", w: 1.1, align: "right" }, { label: "Jedn.", w: 0.5 }, { label: "Kontrahent", w: 1.6 }, { label: "Powiązana", w: 1.3 }, { label: "Status", w: 1.2 }],
        rows: rows.map(r => [Dates.pl(r.date), r.time, r.user, r.typeLabel, r.docNo, r.whName, r.productName, r.before === null ? "" : fmtQ(r.before), r.change === null ? "" : (r.change > 0 ? "+" : "") + fmtQ(r.change, 6), r.after === null ? "" : fmtQ(r.after), Units.label(r.unit), r.partner, r.related, R.STATUS[r.status] || r.status]) }]
    };
  }
  Views.historia = {
    f() { return App.tabs.hist || (App.tabs.hist = { tab: "moves", mode: "month", ym: Dates.ym(App.today()), wh: App.user().whId, productId: "", type: "", userId: "", partnerId: "", status: "", q: "", aUser: "", aEntity: "", aq: "" }); },
    rows() {
      const f = this.f(), rg = rangeOf(f);
      return R.Reports.history(Store.state, { from: rg.from, to: rg.to, whId: f.wh === "all" ? null : f.wh, productId: f.productId, type: f.type, userId: f.userId, partnerId: f.partnerId, status: f.status, q: f.q });
    },
    auditRows() {
      const S = Store.state, f = this.f(), rg = rangeOf(f), q = f.aq.trim().toLowerCase();
      return S.audit.filter(a => a.ts.slice(0, 10) >= rg.from && a.ts.slice(0, 10) <= rg.to && (!f.aUser || a.userId === f.aUser) && (!f.aEntity || a.entity === f.aEntity) &&
        (!q || [a.action, a.source, a.opNo, a.relatedNo, a.userName, a.reason, JSON.stringify(a.after)].join(" ").toLowerCase().includes(q))).slice().sort((a, b) => a.ts < b.ts ? 1 : -1);
    },
    html() {
      const S = Store.state, f = this.f(), rg = rangeOf(f);
      const sel = (id, label, opts, v) => `<div class="field"><label for="${id}">${label}</label><select class="ctrl" id="${id}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(v) === String(k) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
      let body;
      if (f.tab === "moves") {
        const rows = this.rows();
        const shown = rows.slice(-600).reverse();
        body = `<div class="card"><div class="toolbar">
            ${periodControls(f, "h")}
            ${sel("h-wh", "Magazyn", [["all", "Wszystkie"]].concat(S.warehouses.map(w => [w.id, w.name])), f.wh)}
            ${sel("h-product", "Produkt", [["", "Wszystkie"]].concat(S.products.map(p => [p.id, p.name])), f.productId)}
            ${sel("h-type", "Typ operacji", [["", "Wszystkie"]].concat(Object.entries(R.HISTORY_TYPES)), f.type)}
            ${sel("h-user", "Użytkownik", [["", "Wszyscy"]].concat(S.users.map(u => [u.id, u.name])), f.userId)}
            ${sel("h-partner", "Kontrahent", [["", "Wszyscy"]].concat(S.partners.map(p => [p.id, p.name])), f.partnerId)}
            ${sel("h-status", "Status", [["", "Wszystkie"], ["POSTED", R.STATUS.POSTED], ["CORRECTED", R.STATUS.CORRECTED], ["CANCELLED", R.STATUS.CANCELLED]], f.status)}
            <div class="field grow"><label for="h-q">Szukaj</label><input class="ctrl" type="search" id="h-q" value="${esc(f.q)}" placeholder="dokument, produkt, uwagi…"></div>
            <div class="row wrap">${printButtons("hist")}<button class="btn" type="button" id="h-csv">${ic("dl", 15)} CSV</button></div></div>
          ${shown.length ? `<div class="tbl-wrap"><table class="tbl dense" id="hist-table"><thead><tr><th>Data</th><th>Godz.</th><th>Użytkownik</th><th>Typ</th><th>Nr dokumentu</th><th>Magazyn</th><th>Produkt</th><th class="r">Ilość</th><th>Jedn.</th><th class="r">Stan przed</th><th class="r">Zmiana</th><th class="r">Stan po</th><th>Kontrahent</th><th>Powiązana operacja</th><th>Uwagi</th><th>Status</th></tr></thead><tbody>
            ${shown.map(r => `<tr class="${r.opId ? "clickable" : ""} ${r.status === "CANCELLED" ? "void" : ""}" ${r.opId ? `data-opid="${esc(r.opId)}"` : ""}><td class="nowrap">${esc(Dates.pl(r.date))}</td><td>${esc(r.time)}</td><td>${esc(r.user)}</td><td><span class="badge ht-${esc(r.type)}">${esc(r.typeLabel)}</span></td><td class="mono nowrap">${esc(r.docNo)}</td><td>${esc(r.whName)}</td><td>${esc(r.productName)}</td>
              <td class="r nowrap">${r.qty === null ? "—" : esc(fmtQ(r.qty))}</td><td>${esc(Units.label(r.unit))}</td><td class="r nowrap">${r.before === null ? "—" : esc(fmtQ(r.before))}</td><td class="r nowrap">${r.change === null ? "—" : `<span class="${r.change < 0 ? "neg" : "pos"}">${r.change > 0 ? "+" : ""}${esc(fmtQ(r.change, 6))}</span>`}</td><td class="r nowrap"><b>${r.after === null ? "—" : esc(fmtQ(r.after))}</b></td>
              <td>${esc(r.partner)}</td><td class="mono">${esc(r.related)}</td><td>${esc(r.notes || "")}</td><td>${statusBadge(r.status)}</td></tr>`).join("")}</tbody></table></div>
            <div class="toolbar" style="border:0"><span class="dim">${rows.length} ruchów w zakresie ${esc(rg.label)}${rows.length > 600 ? " (pokazano 600 najnowszych — pełna lista w CSV / PDF)" : ""}. Stan przed/po liczony osobno dla każdej pary magazyn × produkt.</span></div>` : `<div class="empty">Brak ruchów dla wybranych filtrów.</div>`}</div>`;
      } else {
        const rows = this.auditRows();
        body = `<div class="card"><div class="toolbar">
            ${periodControls(f, "h")}
            ${sel("a-user", "Użytkownik", [["", "Wszyscy"], ["system", "System"]].concat(S.users.map(u => [u.id, u.name])), f.aUser)}
            ${sel("a-entity", "Obszar", [["", "Wszystkie"], ["operation", "Operacje"], ["draft", "Wersje robocze"], ["inventory", "Inwentaryzacja"], ["fleet", "Flota"], ["ledger", "Księga / bilans"], ["report", "Wydruki i PDF"], ["system", "System"]], f.aEntity)}
            <div class="field grow"><label for="a-q">Szukaj</label><input class="ctrl" type="search" id="a-q" value="${esc(f.aq)}" placeholder="numer, akcja, powód…"></div>
            <button class="btn" type="button" id="a-csv">${ic("dl", 15)} CSV</button></div>
          ${rows.length ? `<div class="tbl-wrap"><table class="tbl" id="audit-table"><thead><tr><th>Czas</th><th>Użytkownik</th><th>Obiekt</th><th>Akcja</th><th>Powód</th><th>Źródło</th><th>Stan przed / po</th></tr></thead><tbody>
            ${rows.slice(0, 400).map(a => `<tr><td class="nowrap">${esc(a.ts.slice(0, 19).replace("T", " "))}</td><td>${esc(a.userName)}</td><td class="mono">${esc(a.opNo || a.entityId || "")}${a.relatedNo ? `<br><small class="dim">${esc(a.relatedNo)}</small>` : ""}</td><td>${esc(a.action)}</td><td>${esc(a.reason || "")}</td><td>${esc(a.source)}</td>
              <td><details class="audit"><summary>pokaż</summary><div class="grid g2 mt2"><div><small class="dim">Przed</small><pre class="json">${esc(JSON.stringify(a.before, null, 1))}</pre></div><div><small class="dim">Po</small><pre class="json">${esc(JSON.stringify(a.after, null, 1))}</pre></div></div></details></td></tr>`).join("")}
            </tbody></table></div><div class="toolbar" style="border:0"><span class="dim">${rows.length} wpisów${rows.length > 400 ? " (pokazano 400 najnowszych)" : ""}</span></div>` : `<div class="empty">Brak wpisów dla filtrów.</div>`}</div>`;
      }
      return `<div class="page-head"><div class="titles"><h2>Historia operacji</h2><p>Rejestr ruchów magazynowych ze stanem przed / zmianą / stanem po oraz dziennik audytu (kto, kiedy, co zmienił, powód). Historii nie edytuje się i nie usuwa — błędy poprawia korekta lub anulowanie.</p></div></div>
        <div class="tabs" role="tablist">${[["moves", "Rejestr ruchów"], ["audit", "Dziennik audytu"]].map(([k, l]) => `<button class="tab" type="button" role="tab" aria-selected="${k === f.tab}" data-htab="${k}">${esc(l)}</button>`).join("")}</div>${body}`;
    },
    bind(page) {
      const f = this.f();
      $$("[data-htab]", page).forEach(b => b.onclick = () => { f.tab = b.dataset.htab; App.render(); });
      bindPeriod(page, f, "h", () => App.render());
      const on = (id, k, ev = "change") => { const el = $(id, page); if (el) el.addEventListener(ev, e => { f[k] = e.target.value; if (ev === "input") { clearTimeout(this._t); this._t = setTimeout(() => { App.render(); const x = $(id); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 250); } else App.render(); }); };
      on("#h-wh", "wh"); on("#h-product", "productId"); on("#h-type", "type"); on("#h-user", "userId"); on("#h-partner", "partnerId"); on("#h-status", "status"); on("#h-q", "q", "input");
      on("#a-user", "aUser"); on("#a-entity", "aEntity"); on("#a-q", "aq", "input");
      bindOps(page);
      const rg = rangeOf(f), whText = f.wh === "all" ? "wszystkie magazyny" : App.whName(f.wh);
      const p = $("[data-print]", page); if (p) p.onclick = () => Printer.print(historyModel(this.rows(), f, rg.label, whText), "RAP");
      const d = $("[data-pdf]", page); if (d) d.onclick = () => Printer.pdf(historyModel(this.rows(), f, rg.label, whText), "RAP", `historia_${rg.from}_${rg.to}`);
      const c = $("#h-csv", page);
      if (c) c.onclick = () => download(`historia_${rg.from}_${rg.to}.csv`, toCSV(["Data", "Godzina", "Użytkownik", "Typ", "Nr dokumentu", "Magazyn", "Produkt", "Ilość", "Jednostka", "Stan przed", "Zmiana", "Stan po", "Kontrahent", "Powiązana operacja", "Uwagi", "Status"],
        this.rows().map(r => [r.date, r.time, r.user, r.typeLabel, r.docNo, r.whName, r.productName, csvNum(r.qty), Units.label(r.unit), csvNum(r.before), csvNum(r.change), csvNum(r.after), r.partner, r.related, r.notes || "", R.STATUS[r.status] || r.status])), "text/csv;charset=utf-8");
      const a = $("#a-csv", page);
      if (a) a.onclick = () => download(`dziennik_audytu_${rg.from}_${rg.to}.csv`, toCSV(["Czas", "Użytkownik", "Obiekt", "Akcja", "Powód", "Źródło", "Stan przed", "Stan po"],
        this.auditRows().map(x => [x.ts, x.userName, x.opNo || x.entityId || "", x.action, x.reason || "", x.source, JSON.stringify(x.before), JSON.stringify(x.after)])), "text/csv;charset=utf-8");
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
      return { f, rg, rep, months, whText: f.wh === "all" ? "wszystkie magazyny" : App.whName(f.wh) };
    },
    /** Model raportu — ten sam dla ekranu (tabele), wydruku i PDF. */
    model(c) {
      const { f, rg, rep, months, whText } = c, S = Store.state, cfg = S.config;
      const q = (v, pid) => App.qtyNative(v, pid);
      const recon = rep.recon.map(r => [r.name, Units.label(r.unit), fmtQ(r.opening), fmtQ(r.ZAKUP), fmtQ(r.PRODUKCJA), fmtQ(r.ZUZYCIE), fmtQ(r.SPRZEDAZ), fmtQ(r.BEZP), fmtQ(r.MM), fmtQ(r.INNE), fmtQ(r.closing), fmt(r.closingT, 1), fmt(r.closingGJ, 0), r.consistent ? "OK" : `NIESPÓJNY (księga: ${fmtQ(r.actual)})`]);
      const blocks = [
        { type: "kpis", items: [
          ["Zakupy", money(rep.purchases.value), `${rep.purchases.count} op. · ${qtyByUnit(rep.purchases.byUnit)}`],
          ["Produkcja", `${fmtQ(rep.production.chippingMP)} MP`, `rąbanie ${money(rep.production.chippingCost)}`],
          ["Sprzedaż z magazynu", money(rep.sales.value), qtyByUnit(rep.sales.byUnit).replace(/-/g, "")],
          ["Sprzedaż bezpośrednia", money(rep.sales.valueDirect), `${rep.sales.countDirect} op.`],
          ["Transport", money(rep.transport.cost), `${rep.transport.count} kursów · ${fmtQ(rep.transport.km, 0)} km`],
          ["Korekty / anulowania", `${rep.corrections.length} / ${rep.cancellations.length}`, "dokumenty KOR / AN w okresie"]] },
        { type: "h", text: "Bilans stanów: stan pocz. + przyjęcia + produkcja − zużycie − sprzedaż ± MM = stan końc." },
        { type: "table", size: 7, columns: [{ label: "Produkt", w: 2.2 }, { label: "Jedn.", w: 0.6 }, { label: "Stan pocz.", w: 1.1, align: "right" }, { label: "Zakup (PZ)", w: 1, align: "right" }, { label: "Produkcja (PW)", w: 1.1, align: "right" }, { label: "Zużycie (RW)", w: 1, align: "right" }, { label: "Sprzedaż (WZ)", w: 1.1, align: "right" }, { label: "Bezp. PW−WZ", w: 1, align: "right" }, { label: "MM ±", w: 0.9, align: "right" }, { label: "Inw./BO", w: 0.9, align: "right" }, { label: "Stan końc.", w: 1.1, align: "right" }, { label: "≈ t", w: 0.8, align: "right" }, { label: "≈ GJ", w: 0.9, align: "right" }, { label: "Kontrola", w: 1.3 }],
          rows: recon, empty: f.partnerId ? "Bilans stanów nie jest liczony dla filtra kontrahenta (stan nie należy do kontrahenta)." : "Brak ruchów i stanów w okresie.", note: `Ilości w jednostce produktu — jednostek się nie sumuje. Wartości netto po korektach i anulowaniach (korekta/anulowanie ujmowane w dacie dokumentu KOR/AN). Kontrola porównuje stan końcowy z bilansu ze stanem z księgi na ${Dates.pl(rg.to)}.` },
        { type: "h", text: "Zakupy" },
        { type: "table", columns: [{ label: "Dostawca", w: 3 }, { label: "Ilość", w: 2, align: "right" }, { label: "Wartość", w: 1.5, align: "right" }, { label: "Operacje", w: 1, align: "right" }], rows: rep.purchases.suppliers.map(s => [s.name, qtyByUnit(s.byUnit), money(s.value), String(s.opIds.length)]), foot: ["Razem", qtyByUnit(rep.purchases.byUnit), money(rep.purchases.value), String(rep.purchases.count)] },
        { type: "h", text: "Produkcja i koszt rąbania" },
        { type: "table", columns: [{ label: "Produkt", w: 3 }, { label: "Rodzaj", w: 2 }, { label: "Ilość", w: 1.5, align: "right" }, { label: "≈ t / ≈ GJ", w: 2, align: "right" }], rows: rep.production.products.map(p => [p.name, "na stan", q(p.qty, p.productId), (() => { const o = Units.orient(p.qty, App.product(p.productId), cfg); return `${fmt(o.t, 1)} t · ${fmt(o.gj, 0)} GJ`; })()]).concat(rep.production.directProducts.map(p => [p.name, "bezpośrednia (las)", q(p.qty, p.productId), ""])), foot: ["Koszt rąbania", "", `${fmtQ(rep.production.chippingMP)} MP`, money(rep.production.chippingCost)] },
        { type: "h", text: "Zużycie surowca" },
        { type: "table", columns: [{ label: "Surowiec", w: 3 }, { label: "Magazyn", w: 2 }, { label: "Zużycie", w: 1.5, align: "right" }, { label: "Operacje", w: 1, align: "right" }], rows: rep.consumption.map(c2 => [c2.name, c2.whName, q(c2.qty, c2.productId), String(c2.opIds.length)]) },
        { type: "h", text: "Sprzedaż" },
        { type: "table", columns: [{ label: "Odbiorca", w: 3 }, { label: "Ilość", w: 2, align: "right" }, { label: "Wartość", w: 1.5, align: "right" }, { label: "Operacje", w: 1, align: "right" }], rows: rep.sales.buyers.map(b => [b.name, qtyByUnit(b.byUnit), money(b.value), String(b.opIds.length)]), foot: ["Razem (WZ + bezpośrednia)", "", money(rep.sales.value + rep.sales.valueDirect), String(rep.sales.count)] },
        { type: "h", text: "Przesunięcia międzymagazynowe (MM)" },
        { type: "table", columns: [{ label: "Dokument", w: 1.5 }, { label: "Data", w: 1 }, { label: "Z magazynu", w: 2 }, { label: "Do magazynu", w: 2 }, { label: "Produkt", w: 2 }, { label: "Ilość", w: 1.3, align: "right" }, { label: "Status", w: 1.2 }], rows: rep.mm.map(m => [m.no, Dates.pl(m.date), m.from, m.to, m.name, `${fmtQ(m.qty)} ${Units.label(m.unit)}`, m.status === "CANCELLED" ? "ANULOWANY" : R.STATUS[m.status]]) },
        { type: "h", text: "Transport" },
        { type: "table", columns: [{ label: "Przewoźnik / tryb", w: 3 }, { label: "Kursy", w: 1, align: "right" }, { label: "km", w: 1, align: "right" }, { label: "Koszt", w: 1.5, align: "right" }], rows: rep.transport.carriers.map(x => [x.name, String(x.count), fmtQ(x.km, 0), money(x.cost)]), foot: ["Razem", String(rep.transport.count), fmtQ(rep.transport.km, 0), money(rep.transport.cost)], note: rep.transport.wagons ? `Pociągi: ${rep.transport.wagons} wagonów · ${fmtQ(rep.transport.trainT)} t.` : "" },
        { type: "h", text: "Wycena stanu (orientacyjna — średnia cena zakupu)" },
        { type: "table", columns: [{ label: "Produkt", w: 3 }, { label: "Cena śr.", w: 1.3, align: "right" }, { label: "Stan pocz.", w: 1.4, align: "right" }, { label: "Przychody", w: 1.4, align: "right" }, { label: "Rozchody", w: 1.4, align: "right" }, { label: "Stan końc.", w: 1.4, align: "right" }], rows: rep.valuation.map(v => v.priced ? [v.name, `${fmt(v.avg, 2)} zł/${Units.label(v.unit)}`, money(v.openingValue), money(v.inValue), money(v.outValue), money(v.closingValue)] : [v.name, "BRAK WYCENY", "—", "—", "—", "—"]), note: "„Brak wyceny” = brak zakupów tego produktu do końca okresu (np. bilans otwarcia bez ceny). Pełna wycena magazynowa (FIFO / średnia ruchoma) — etap produkcyjny." }
      ];
      if (months.length) blocks.push({ type: "h", text: `Rok ${rg.year} — miesiące` }, { type: "table", columns: [{ label: "Miesiąc", w: 2 }, { label: "Zakupy", w: 1.4, align: "right" }, { label: "Produkcja MP", w: 1.2, align: "right" }, { label: "Rąbanie", w: 1.3, align: "right" }, { label: "Sprzedaż", w: 1.4, align: "right" }, { label: "Transport", w: 1.3, align: "right" }, { label: "Korekty", w: 0.8, align: "right" }, { label: "Bilans", w: 1 }],
        rows: months.map(({ ym, r }) => [Dates.label(ym), money(r.purchases.value), fmtQ(r.production.chippingMP), money(r.production.chippingCost), money(r.sales.value + r.sales.valueDirect), money(r.transport.cost), String(r.corrections.length), r.consistent ? "OK" : "NIESPÓJNY"]) });
      if (f.view === "audit" || rep.corrections.length || rep.cancellations.length) {
        blocks.push({ type: "h", text: "Korekty w okresie" }, { type: "table", columns: [{ label: "Korekta", w: 1.4 }, { label: "Dokument", w: 1.4 }, { label: "Data", w: 1 }, { label: "Użytkownik", w: 1.6 }, { label: "Powód", w: 2.4 }, { label: "Zmiany", w: 3.2 }], rows: rep.corrections.map(k => [k.no, k.orig, Dates.pl(k.date), k.user, k.reason, k.changes.map(x => `${x.label}: ${x.beforeText} → ${x.afterText}`).join("; ")]), empty: "Brak korekt w okresie." });
        blocks.push({ type: "h", text: "Anulowania w okresie" }, { type: "table", columns: [{ label: "Anulowanie", w: 1.4 }, { label: "Dokument", w: 1.4 }, { label: "Data", w: 1 }, { label: "Użytkownik", w: 1.6 }, { label: "Przyczyna", w: 4 }], rows: rep.cancellations.map(k => [k.no, k.orig, Dates.pl(k.date), k.user, k.reason]), empty: "Brak anulowań w okresie." });
      }
      if (f.view === "audit") {
        const hist = R.Reports.history(S, { from: rg.from, to: rg.to, whId: f.wh === "all" ? null : f.wh, productId: f.productId || null, partnerId: f.partnerId || null });
        blocks.push({ type: "h", text: "Widok audytowy — wszystkie ruchy w okresie (z dokumentami anulowanymi i korektami)" }, { type: "table", size: 6.8, columns: [{ label: "Data", w: 1 }, { label: "Dokument", w: 1.4 }, { label: "Typ", w: 1.3 }, { label: "Magazyn", w: 1.2 }, { label: "Produkt", w: 1.8 }, { label: "Przed", w: 1, align: "right" }, { label: "Zmiana", w: 1, align: "right" }, { label: "Po", w: 1, align: "right" }, { label: "Użytkownik", w: 1.4 }, { label: "Status", w: 1.1 }],
          rows: hist.filter(h => h.change !== null).map(h => [Dates.pl(h.date), h.docNo, h.typeLabel, h.whName, h.productName, fmtQ(h.before), (h.change > 0 ? "+" : "") + fmtQ(h.change, 6), fmtQ(h.after), h.user, h.status === "CANCELLED" ? "ANULOWANY" : R.STATUS[h.status]]) });
      }
      const closedTxt = rep.closed.length ? rep.closed.map(x => `${x.name}: ${x.closed ? "ZAMKNIĘTY" : "otwarty"}`).join(" · ") : "—";
      blocks.push({ type: "p", muted: true, text: `Status okresu: ${closedTxt}. Bilans ${rep.consistent ? "spójny" : "NIESPÓJNY — sprawdź pozycje oznaczone w kolumnie Kontrola"}.` });
      blocks.push({ type: "signatures", labels: ["Sporządził", "Kierownik magazynu", "Zatwierdził"] });
      return {
        title: `Raport ${rg.mode === "month" ? "miesięczny" : rg.mode === "year" ? "roczny" : rg.mode === "day" ? "dzienny" : rg.mode === "week" ? "tygodniowy" : "okresowy"} — ${rg.label}`,
        subtitle: `${whText} · ${Dates.pl(rg.from)} – ${Dates.pl(rg.to)} · widok ${f.view === "audit" ? "audytowy" : "biznesowy"}`, orientation: "landscape", headerRight: whText, rangeText: `${Dates.pl(rg.from)} – ${Dates.pl(rg.to)}`, whText,
        meta: [["Magazyn", whText], ["Okres", `${Dates.pl(rg.from)} – ${Dates.pl(rg.to)}`], ["Produkt", f.productId ? pName(f.productId) : "wszystkie"], ["Kontrahent", f.partnerId ? partnerName(f.partnerId) : "wszyscy"], ["Status okresu", closedTxt], ["Bilans", rep.consistent ? "spójny" : "NIESPÓJNY"]],
        blocks
      };
    }
  };
  Views.raporty = {
    html() {
      const S = Store.state, c = Reports.compute(), { f, rg, rep } = c;
      const model = Reports.model(c);
      const tables = model.blocks.filter(b => b.type === "table");
      const drillIds = {
        purchases: rep.purchases.suppliers.map(s => s.opIds), sales: rep.sales.buyers.map(b => b.opIds), consumption: rep.consumption.map(x => x.opIds), mm: rep.mm.map(m => [m.opId]),
        transport: [], prod: rep.production.products.map(p => p.opIds).concat(rep.production.directProducts.map(p => p.opIds))
      };
      const tableHtml = (b, id, ids) => renderTable(b, id, null, ids, b.columns[0].label);
      const sec = (title, inner, id) => `<div class="card mt4" ${id ? `id="${id}"` : ""}><div class="card-h"><h3>${esc(title)}</h3></div>${inner}</div>`;
      const hBlocks = model.blocks.filter(b => b.type === "h").map(b => b.text);
      return `<div class="page-head"><div class="titles"><h2>Raporty</h2><p>Raport okresowy: dzień / tydzień / miesiąc / rok / zakres własny, dla jednego lub wszystkich magazynów. Wartości netto po korektach i anulowaniach. Kliknij wiersz, aby zobaczyć operacje źródłowe. Ekran, wydruk i PDF mają tę samą treść.</p></div>
          <div class="actions">${printButtons("rep")}<button class="btn" type="button" id="rep-csv">${ic("dl", 15)} CSV bilansu</button></div></div>
        <div class="card"><div class="toolbar" id="rep-filters">
          ${periodControls(f, "r")}
          <div class="field"><label for="r-wh">Magazyn</label><select class="ctrl" id="r-wh"><option value="all" ${f.wh === "all" ? "selected" : ""}>Wszystkie magazyny</option>${S.warehouses.map(w => `<option value="${w.id}" ${f.wh === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="r-product">Produkt</label><select class="ctrl" id="r-product"><option value="">Wszystkie</option>${S.products.map(p => `<option value="${p.id}" ${f.productId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="r-partner">Kontrahent</label><select class="ctrl" id="r-partner"><option value="">Wszyscy</option>${S.partners.map(p => `<option value="${p.id}" ${f.partnerId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="r-view">Widok</label><select class="ctrl" id="r-view"><option value="business" ${f.view === "business" ? "selected" : ""}>Biznesowy (netto)</option><option value="audit" ${f.view === "audit" ? "selected" : ""}>Audytowy (wszystkie ruchy)</option></select></div></div>
          <div class="card-b"><h3 class="rep-title" id="rep-title">${esc(model.title)}</h3><p class="muted">${esc(model.subtitle)}</p>
            <div class="rep-status mt2">${rep.consistent ? `<span class="badge ok" id="rep-consistent">${ic("check", 12)} Bilans spójny</span>` : `<span class="badge err" id="rep-consistent">${ic("alert", 12)} Bilans NIESPÓJNY</span>`} ${rep.closed.map(x => `<span class="badge ${x.closed ? "ok" : ""}">${esc(x.name)}: ${x.closed ? "okres zamknięty" : "okres otwarty"}</span>`).join(" ")}</div>
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
        ${tables.slice(8).map((t, i) => sec(hBlocks[8 + i], tableHtml(t, "rep-extra-" + i), "sec-extra-" + i)).join("")}`;
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
      $("#rep-csv", page).onclick = () => { const x = c(); download(`bilans_${x.rg.from}_${x.rg.to}.csv`, toCSV(["Produkt", "Jednostka", "Stan pocz.", "Zakup", "Produkcja", "Zużycie", "Sprzedaż WZ", "Bezpośrednia PW-WZ", "MM", "Inw./BO", "Stan końc.", "Masa t", "Energia GJ", "Kontrola"],
        x.rep.recon.map(r => [r.name, Units.label(r.unit), csvNum(r.opening), csvNum(r.ZAKUP), csvNum(r.PRODUKCJA), csvNum(r.ZUZYCIE), csvNum(r.SPRZEDAZ), csvNum(r.BEZP), csvNum(r.MM), csvNum(r.INNE), csvNum(r.closing), csvNum(r.closingT), csvNum(r.closingGJ), r.consistent ? "OK" : "NIESPÓJNY"])), "text/csv;charset=utf-8"); };
    }
  };

  /* ================================================================== */
  /* Kartoteki: Produkty, Kontrahenci, Magazyny                           */
  /* ================================================================== */
  Views.produkty = {
    html() {
      const S = Store.state, cfg = S.config, stock = Stock.byProduct(S, null);
      return `<div class="page-head"><div class="titles"><h2>Produkty</h2><p>Kartoteka produktów z jednostką magazynową i przelicznikami. Jednostka magazynowa decyduje o dozwolonych jednostkach na dokumentach. Edycja kartoteki — etap produkcyjny (zmiana jednostki wymaga migracji księgi).</p></div></div>
        <div class="card"><div class="tbl-wrap"><table class="tbl" id="products-table"><thead><tr><th>Kod</th><th>Nazwa</th><th>Kategoria</th><th>Jedn. magazynowa</th><th>Dozwolone jednostki</th><th class="r">Masa ≈ t / jedn.</th><th class="r">Energia ≈ GJ / jedn.</th><th>Przelicznik produkcji</th><th class="r">Stan firmy</th></tr></thead><tbody>
          ${S.products.map(p => { const m = Units.massPerUnit(p, cfg); return `<tr><td class="mono">${esc(p.code)}</td><td><b>${esc(p.name)}</b></td><td>${esc(CAT_LABEL[p.cat] || p.cat)}</td><td>${Units.label(p.unit)}</td><td>${Units.allowed(p).map(Units.label).join(", ")}</td><td class="r">${fmt(m, 3)}</td><td class="r">${fmt(m * cfg.t_gj, 2)}</td><td>${p.unit === "m3" ? `1 m³ → ${fmtQ(cfg.m3_mp)} MP zrębki` : p.unit === "MP" ? `z drewna: 1 MP = ${fmtQ(1 / cfg.m3_mp, 3)} m³` : "brak (tylko t)"}</td><td class="r">${esc(App.qtyNative(stock.get(p.id) || 0, p.id))}</td></tr>`; }).join("")}</tbody></table></div></div>
        <div class="card mt4"><div class="card-h"><h3>Przeliczniki (config/demo.config.json)</h3></div><div class="card-b"><dl class="money-list" style="max-width:560px"><dt>1 m³ drewna</dt><dd>${fmtQ(cfg.m3_mp)} MP</dd><dt>1 MP</dt><dd>${fmtQ(1 / cfg.m3_mp, 3)} m³ · ${fmt(cfg.mp_t, 2)} t</dd><dt>1 m³ drewna (masa)</dt><dd>${fmt(cfg.woodTPerM3, 3)} t</dd><dt>1 t</dt><dd>${fmt(cfg.t_gj, 1)} GJ</dd></dl></div></div>`;
    }
  };
  Views.kontrahenci = {
    html() {
      const S = Store.state;
      const f = App.tabs.partners || (App.tabs.partners = { role: "" });
      const stats = new Map();
      for (const op of S.operations) { if (op.status === "CANCELLED") continue; const pid = opPartnerId(op); if (!pid) continue; const s = stats.get(pid) || { n: 0, buy: 0, sell: 0, last: "" }; s.n++; s.buy += op.type === "ZAKUP" ? op.totals.purchaseCost : 0; s.sell += op.totals.revenue; if (op.date > s.last) s.last = op.date; stats.set(pid, s); }
      const rows = S.partners.filter(p => !f.role || p.role === f.role || p.role === "both");
      const ROLE = { supplier: "Dostawca", buyer: "Odbiorca", both: "Dostawca i odbiorca" };
      return `<div class="page-head"><div class="titles"><h2>Kontrahenci</h2><p>Dostawcy i odbiorcy z obrotem (bez dokumentów anulowanych). Kliknij kontrahenta — raport okresowy z filtrem kontrahenta.</p></div></div>
        <div class="card"><div class="toolbar"><div class="field"><label for="pa-role">Rola</label><select class="ctrl" id="pa-role"><option value="">Wszyscy</option><option value="supplier" ${f.role === "supplier" ? "selected" : ""}>Dostawcy</option><option value="buyer" ${f.role === "buyer" ? "selected" : ""}>Odbiorcy</option></select></div></div>
          <div class="tbl-wrap"><table class="tbl" id="partners-table"><thead><tr><th>Nazwa</th><th>Rola</th><th>Grupa dostawcy</th><th>Miejscowość</th><th class="r">Operacje</th><th class="r">Zakupy</th><th class="r">Sprzedaż</th><th>Ostatnia operacja</th><th></th></tr></thead><tbody>
            ${rows.map(p => { const s = stats.get(p.id) || { n: 0, buy: 0, sell: 0, last: "" }; return `<tr><td><b>${esc(p.name)}</b></td><td>${ROLE[p.role]}</td><td>${p.role === "buyer" ? "—" : esc(R.SUPPLIER_KINDS[R.partnerKind(p)].label)}${p.lesnictwa && p.lesnictwa.length ? `<br><small class="dim">leśnictwa: ${esc(p.lesnictwa.join(", "))}</small>` : ""}${p.createdBy ? `<br><small class="dim">dodany przy zakupie: ${esc(p.createdBy)}</small>` : ""}</td><td>${esc(p.city || "")}</td><td class="r">${s.n}</td><td class="r">${esc(money(s.buy))}</td><td class="r">${esc(money(s.sell))}</td><td>${esc(Dates.pl(s.last) || "—")}</td><td class="r"><button class="btn sm" type="button" data-prep="${esc(p.id)}">Raport</button></td></tr>`; }).join("")}</tbody></table></div></div>`;
    },
    bind(page) {
      $("#pa-role", page).onchange = e => { App.tabs.partners.role = e.target.value; App.render(); };
      $$("[data-prep]", page).forEach(b => b.onclick = () => { const f = Reports.f(); f.partnerId = b.dataset.prep; f.mode = "year"; f.year = App.today().slice(0, 4); App.go("raporty"); });
    }
  };
  Views.magazyny = {
    html() {
      const S = Store.state;
      return `<div class="page-head"><div class="titles"><h2>Magazyny</h2><p>Magazyny firmy, przypisani użytkownicy, stan i zamknięte okresy. Magazyn aktywny wynika z zalogowanego użytkownika.</p></div></div>
        <div class="grid g2">${S.warehouses.map(w => {
          const m = Stock.byProduct(S, w.id), per = {};
          for (const [pid, q] of m) { const p = App.product(pid); if (Math.abs(q) > R.EPS) per[p.unit] = R.rq((per[p.unit] || 0) + q); }
          return `<div class="card" data-wh="${esc(w.id)}"><div class="card-h"><h3>${esc(w.name)}</h3><span class="sub">${esc(w.code)}</span></div><div class="card-b">
            <dl class="money-list"><dt>Adres</dt><dd>${esc(w.address || "")}</dd><dt>Stan wg jednostek</dt><dd>${esc(Object.entries(per).map(([u, q]) => `${fmtQ(q)} ${Units.label(u)}`).join(" · ") || "—")}</dd>
            <dt>Zamknięte do</dt><dd>${esc(R.lockedMonth(S, w.id) || "—")}</dd><dt>Użytkownicy</dt><dd>${esc(S.users.filter(u => u.whId === w.id).map(u => `${u.name} (${R.ROLES[u.role].label})`).join(", "))}</dd>
            <dt>Operacje</dt><dd>${S.operations.filter(o => o.whId === w.id).length}</dd></dl></div></div>`; }).join("")}</div>`;
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
      let detail = `<div class="card"><div class="empty">Otwórz okres, aby rozpocząć spis.</div></div>`;
      if (p) {
        const closed = p.status !== "OTWARTA";
        const rows = p.lines.map(l => {
          const pr = App.product(l.productId), has = l.countQty !== null;
          const diff = has ? R.round(l.countQty - l.bookQty, 6) : null;
          return `<tr data-line="${esc(l.productId)}"><td><b>${esc(pr.name)}</b></td><td>${Units.label(l.unit)}</td><td class="r">${fmtQ(l.bookQty)}</td>
            <td class="r" style="min-width:150px">${closed ? `<b>${has ? fmtQ(l.countQty) : "—"}</b>${l.assumed ? ' <span class="badge warn">przyjęto stan księgowy</span>' : ""}`
              : `<input class="ctrl num-in" type="text" inputmode="decimal" data-count="${esc(l.productId)}" aria-label="Stan ze spisu: ${esc(pr.name)}" value="${esc(has ? (l.countText || fmtQ(l.countQty)) : "")}" placeholder="wpisz stan">`}</td>
            <td class="r" data-diff="${esc(l.productId)}" style="color:${diff === null ? "inherit" : diff < 0 ? "var(--err)" : diff > 0 ? "var(--info)" : "var(--ok)"}">${diff === null ? "—" : (diff > 0 ? "+" : "") + fmtQ(diff) + " " + Units.label(l.unit)}</td>
            <td class="r dim">${diff === null || l.unit === "t" ? "—" : "≈ " + fmt(Units.mass(diff, pr, S.config), 2) + " t"}</td></tr>`;
        }).join("");
        detail = `<div class="card" id="inv-detail" data-status="${esc(p.status)}">
          <div class="card-h"><h3>Okres ${esc(p.ym)}</h3><span class="badge ${closed ? "ok" : "warn"}" id="inv-status">${R.INV_STATUS[p.status]}</span>
            <span class="sub">${esc(Dates.label(p.ym))} · stan księgowy na ${esc(Dates.pl(p.cutoff || R.Inventory.cutoff(p.ym, App.today())))}</span><span class="spacer"></span>
            ${closed ? "" : `<button class="btn" type="button" id="inv-gen">${ic("layers", 15)} ${p.lines.length ? "Odśwież listę" : "Generuj listę"}</button>
              <button class="btn primary" type="button" id="inv-close" ${App.can("inv.close") ? "" : "disabled title=\"Wymaga roli Kierownik lub Administrator\""}>${ic("check", 15)} Zamknij okres</button>`}</div>
          ${closed ? `<div class="card-b" style="padding-bottom:0"><div class="info-line ok">${ic("check", 15)}<span>Okres zamknięty ${esc((p.closedAt || "").slice(0, 16).replace("T", " "))} przez ${esc(p.closedBy)}. ${p.docNo ? `Różnice zaksięgowano dokumentem <b>${esc(p.docNo)}</b>.` : "Brak różnic."} Operacje z datą do ${esc(p.ym)} włącznie są zablokowane — zmiany tylko korektą z bieżącą datą.</span></div></div>` : ""}
          ${p.lines.length ? `<div class="tbl-wrap mt3"><table class="tbl" id="inv-table"><thead><tr><th>Produkt</th><th>Jedn.</th><th class="r">Stan księgowy</th><th class="r">Stan ze spisu</th><th class="r">Różnica</th><th class="r">Różnica masy</th></tr></thead><tbody>${rows}</tbody></table></div>`
            : `<div class="empty">Lista jest pusta — kliknij „Generuj listę”.</div>`}
          ${!closed ? `<div class="card-b"><p class="help">Wpisz stan z natury w jednostce magazynowej produktu. Enter lub Tab zapisuje pozycję. Zamknięcie księguje różnice dokumentem IN i blokuje okres.</p></div>` : ""}
        </div>`;
      }
      return `<div class="page-head"><div class="titles"><h2>Inwentaryzacja i zamknięcie miesiąca</h2>
          <p>Magazyn <b>${esc(wh.name)}</b>. Każdy miesiąc to osobny okres: OTWARTA → ZAMKNIĘTA. Zamknięcie zachowuje wszystkie dane okresu, a raport miesiąca pokazuje status „okres zamknięty”.${locked ? ` Zamknięte do: <b>${esc(locked)}</b>.` : ""}</p></div></div>
        <div class="grid inv-grid" id="inv-grid">
          <div class="stack">
            <div class="card"><div class="card-h"><h3>Otwórz okres</h3></div><div class="card-b">
              <div class="field"><label for="inv-ym">Miesiąc</label><input class="ctrl" type="month" id="inv-ym" value="${esc(Dates.ym(App.today()))}" max="${esc(Dates.ym(App.today()))}"></div>
              <button class="btn primary mt3" type="button" id="inv-open" style="width:100%" ${App.can("inv.open") ? "" : "disabled"}>Otwórz okres</button></div></div>
            <div class="card"><div class="card-h"><h3>Okresy</h3></div>
              ${list.length ? `<div class="tbl-wrap"><table class="tbl" id="inv-list"><tbody>${list.map(x => `<tr class="clickable ${x.ym === sel ? "sel" : ""}" data-ym="${esc(x.ym)}"><td><b>${esc(x.ym)}</b><br><small class="dim">${esc(Dates.label(x.ym))}</small></td><td class="r"><span class="badge ${x.status === "OTWARTA" ? "warn" : "ok"}">${R.INV_STATUS[x.status]}</span>${x.auto ? '<br><small class="dim">automatycznie</small>' : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Brak okresów.</div>`}
            </div>
          </div>
          <div>${detail}</div>
        </div>`;
    },
    bind(page) {
      const act = (fn, okMsg) => Store.transact(s => fn(s, { user: R.byId(s.users, App.user().id), today: App.today(), source: "Moduł Inwentaryzacja" }))
        .then(res => { if (res.ok) { if (okMsg) Toast.ok(okMsg(res)); } else Toast.err("Odrzucono", res.error); App.render(); return res; });
      $("#inv-open", page).onclick = () => { const ym = $("#inv-ym", page).value; act((s, c) => R.Inventory.open(s, ym, c), () => `Otwarto okres ${ym}`).then(r => { if (r.ok) { App.tabs.inv = ym; App.render(); } }); };
      $$("[data-ym]", page).forEach(tr => tr.onclick = () => { App.tabs.inv = tr.dataset.ym; App.render(); });
      const ym = App.tabs.inv;
      const gen = $("#inv-gen", page);
      if (gen) gen.onclick = () => act((s, c) => R.Inventory.generate(s, ym, c), r => `Lista spisowa: ${r.period.lines.length} pozycji`);
      const cl = $("#inv-close", page);
      if (cl) cl.onclick = async () => {
        const r = await Modal.confirm({ title: `Zamknąć okres ${ym}?`, text: "Różnice zostaną zaksięgowane dokumentem IN, a okres przejdzie w tryb tylko do odczytu. Dane okresu pozostają bez zmian. Tej czynności nie można cofnąć.", ok: "Zamknij okres", danger: true });
        if (r.ok) act((s, c) => R.Inventory.close(s, ym, c), res => `Okres ${ym} zamknięty` + (res.docNo ? ` · ${res.docNo}` : ""));
      };
      $$("[data-count]", page).forEach(inp => {
        const commit = () => {
          const pid = inp.dataset.count;
          const line = R.Inventory.find(Store.state, App.user().whId, ym).lines.find(l => l.productId === pid);
          if ((line.countText || "") === inp.value.trim() && (line.countQty !== null || !inp.value.trim())) return;
          const r = R.NumParse.parse(inp.value);
          if (inp.value.trim() && !r.ok) { inp.classList.add("invalid"); Toast.err("Niepoprawna liczba", r.error); return; }
          inp.classList.remove("invalid");
          const ae = document.activeElement;
          const next = ae && ae.dataset && ae.dataset.count ? ae.dataset.count : null;
          act((s, c) => R.Inventory.setCount(s, ym, pid, inp.value, c)).then(() => { const el = next && document.querySelector(`[data-count="${next}"]`); if (el) { el.focus(); el.select(); } });
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
      const drv = id => (R.byId(S.fleet.drivers, id) || {}).name || "—";
      const opr = id => (R.byId(S.fleet.operators, id) || {}).name || "—";
      const runs = [];      // pojedyncze kursy (operacja może mieć kilka kursów)
      for (const o of S.operations) if (o.transport && o.transport.mode === "own" && o.status !== "CANCELLED") for (const r of (o.transport.runs || [o.transport])) runs.push({ op: o, r });
      const prods = S.operations.filter(o => o.production && o.production.chipperId && o.status !== "CANCELLED");
      const st = s => `<span class="badge ${s === "aktywny" ? "ok" : s === "serwis" ? "warn" : ""}">${esc(R.ASSET_STATUS[s] || s)}</span>`;
      const edit = App.can("fleet.edit");
      const btn = (kind, id) => edit ? `<button class="btn sm" type="button" data-edit="${kind}|${esc(id)}">${ic("edit", 13)} Edytuj</button>${kind === "drivers" || kind === "operators" ? ` <button class="btn sm danger" type="button" data-del="${kind}|${esc(id)}">${ic("trash", 13)}</button>` : ""}` : "";
      let body = "";
      if (tab === "vehicles") body = `<table class="tbl" id="fleet-table"><thead><tr><th>Nazwa</th><th>Rejestracja</th><th>Typ</th><th>Status</th><th>Kierowca domyślny</th><th class="r">Kursy</th><th></th></tr></thead><tbody>
        ${S.fleet.vehicles.map(v => `<tr><td><b>${esc(v.name)}</b></td><td class="mono">${esc(v.reg)}</td><td>${esc(R.VEHICLE_TYPES[v.type])}</td><td>${st(v.status)}</td><td>${esc(drv(v.driverId))}</td><td class="r">${runs.filter(x => x.r.vehicleId === v.id).length}</td><td class="r">${btn("vehicles", v.id)}</td></tr>`).join("")}</tbody></table>`;
      if (tab === "drivers") body = `<table class="tbl" id="fleet-table"><thead><tr><th>Imię i nazwisko</th><th>Telefon</th><th>Domyślny w pojazdach</th><th class="r">Kursy</th><th></th></tr></thead><tbody>
        ${S.fleet.drivers.map(d => `<tr><td><b>${esc(d.name)}</b></td><td>${esc(d.phone || "")}</td><td>${esc(S.fleet.vehicles.filter(v => v.driverId === d.id).map(v => v.reg).join(", ") || "—")}</td><td class="r">${runs.filter(x => x.r.driverId === d.id).length}</td><td class="r">${btn("drivers", d.id)}</td></tr>`).join("")}</tbody></table>`;
      if (tab === "chippers") body = `<table class="tbl" id="fleet-table"><thead><tr><th>Rębak</th><th>Status</th><th>Operator domyślny</th><th class="r">Produkcje</th><th></th></tr></thead><tbody>
        ${S.fleet.chippers.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${st(c.status)}</td><td>${esc(opr(c.operatorId))}</td><td class="r">${prods.filter(o => o.production.chipperId === c.id).length}</td><td class="r">${btn("chippers", c.id)}</td></tr>`).join("")}</tbody></table>`;
      if (tab === "operators") body = `<table class="tbl" id="fleet-table"><thead><tr><th>Operator</th><th>Telefon</th><th>Domyślny przy rębakach</th><th></th></tr></thead><tbody>
        ${S.fleet.operators.map(o => `<tr><td><b>${esc(o.name)}</b></td><td>${esc(o.phone || "")}</td><td>${esc(S.fleet.chippers.filter(c => c.operatorId === o.id).map(c => c.name).join(", ") || "—")}</td><td class="r">${btn("operators", o.id)}</td></tr>`).join("")}</tbody></table>`;
      const lastRuns = runs.slice().sort((a, b) => a.op.date < b.op.date ? 1 : -1).slice(0, 12);
      const labels = { vehicles: "Samochody / ruchome podłogi", drivers: "Kierowcy", chippers: "Rębaki", operators: "Operatorzy rębaków" };
      return `<div class="page-head"><div class="titles"><h2>Flota</h2><p>Transport własny w „Nowej operacji” korzysta z tej listy. Kurs zapisuje kierowcę wybranego dla konkretnego kursu — późniejsza zmiana kierowcy domyślnego nie zmienia historii.</p></div>
          <div class="actions">${edit ? `<button class="btn primary" type="button" id="fleet-add">${ic("plus", 15)} Dodaj: ${esc(R.Fleet.KINDS[tab].label.toLowerCase())}</button>` : `<span class="badge">tylko podgląd — edycja: Kierownik / Administrator</span>`}</div></div>
        <div class="tabs" role="tablist">${Object.entries(labels).map(([k, l]) => `<button class="tab" type="button" role="tab" aria-selected="${k === tab}" data-tab="${k}">${esc(l)}</button>`).join("")}</div>
        <div class="card"><div class="tbl-wrap">${body}</div></div>
        <div class="card mt4"><div class="card-h"><h3>Ostatnie kursy transportu własnego</h3><span class="sub">kierowca zapisany w chwili kursu</span></div>
          ${lastRuns.length ? `<div class="tbl-wrap"><table class="tbl" id="runs-table"><thead><tr><th>Data</th><th>Dokument</th><th>Pojazd</th><th>Kierowca kursu</th><th class="r">km</th><th class="r">Koszt</th><th>Miejsce transportu</th></tr></thead><tbody>
            ${lastRuns.map(({ op: o, r }) => { const tr = o.documents.find(x => x.type === "TR"); return `<tr class="clickable" data-opid="${esc(o.id)}"><td>${esc(Dates.pl(o.date))}</td><td class="mono">${esc(tr ? tr.no : "")}${(o.transport.runs || []).length > 1 ? ` <small class="dim">kurs ${r.no}</small>` : ""}</td><td>${esc(r.vehicleName)} · <span class="mono">${esc(r.reg)}</span></td><td>${esc(r.driverName)}${r.driverOverridden ? ' <span class="badge warn">zmieniony dla kursu</span>' : ""}</td><td class="r">${fmtQ(r.km)}</td><td class="r">${esc(money(r.cost))}</td><td>${esc(o.place)}</td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">Brak kursów.</div>`}</div>`;
    },
    bind(page) {
      $$("[data-tab]", page).forEach(b => b.onclick = () => { App.tabs.fleet = b.dataset.tab; App.render(); });
      const add = $("#fleet-add", page);
      if (add) add.onclick = () => this.edit(App.tabs.fleet || "vehicles", null);
      $$("[data-edit]", page).forEach(b => b.onclick = () => { const [k, id] = b.dataset.edit.split("|"); this.edit(k, id); });
      $$("[data-del]", page).forEach(b => b.onclick = async () => {
        const [k, id] = b.dataset.del.split("|");
        const rec = R.byId(Store.state.fleet[k], id);
        const r = await Modal.confirm({ title: `Usunąć: ${rec.name}?`, text: "Historyczne kursy zachowają zapisane nazwisko.", ok: "Usuń", danger: true });
        if (!r.ok) return;
        const res = await Store.transact(s => R.Fleet.remove(s, k, id, { user: R.byId(s.users, App.user().id), today: App.today(), source: "Moduł Flota" }));
        if (res.ok) Toast.ok("Usunięto", rec.name); else Toast.err("Nie usunięto", res.error);
        App.render();
      });
      bindOps(page);
    },
    edit(kind, id) {
      const S = Store.state;
      const rec = id ? R.clone(R.byId(S.fleet[kind], id)) : { name: "", reg: "", type: "ruchoma_podloga", status: "aktywny", driverId: "", operatorId: "", phone: "" };
      const o = (arr, v) => arr.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? "selected" : ""}>${esc(l)}</option>`).join("");
      const f = (k, label, ctrl, help) => `<div class="field" data-ff="${k}"><label for="fe-${k}">${esc(label)}</label>${ctrl}<div class="msg hidden" data-fmsg="${k}"></div>${help ? `<div class="help">${help}</div>` : ""}</div>`;
      let body = f("name", kind === "vehicles" ? "Nazwa pojazdu" : kind === "chippers" ? "Nazwa rębaka" : "Imię i nazwisko", `<input class="ctrl" id="fe-name" value="${esc(rec.name)}">`, kind === "vehicles" ? "np. Scania R450 — ruchoma podłoga" : "");
      if (kind === "vehicles") {
        body += f("reg", "Numer rejestracyjny", `<input class="ctrl" id="fe-reg" value="${esc(rec.reg)}" placeholder="np. SGL 4T821">`);
        body += f("type", "Typ", `<select class="ctrl" id="fe-type">${o(Object.entries(R.VEHICLE_TYPES), rec.type)}</select>`);
        body += f("status", "Status", `<select class="ctrl" id="fe-status">${o(Object.entries(R.ASSET_STATUS), rec.status)}</select>`, "Pojazdów nie usuwa się — wycofany pojazd zostaje w historii kursów.");
        body += f("driverId", "Kierowca domyślny", `<select class="ctrl" id="fe-driverId"><option value="">— wybierz —</option>${o(S.fleet.drivers.map(d => [d.id, d.name]), rec.driverId)}</select>`, "Zmiana dotyczy przyszłych kursów.");
      }
      if (kind === "chippers") {
        body += f("status", "Status", `<select class="ctrl" id="fe-status">${o(Object.entries(R.ASSET_STATUS), rec.status)}</select>`);
        body += f("operatorId", "Operator domyślny", `<select class="ctrl" id="fe-operatorId"><option value="">— wybierz —</option>${o(S.fleet.operators.map(d => [d.id, d.name]), rec.operatorId)}</select>`);
      }
      if (kind === "drivers" || kind === "operators") body += f("phone", "Telefon", `<input class="ctrl" id="fe-phone" value="${esc(rec.phone || "")}" inputmode="tel">`);
      const m = Modal.open({ title: `${id ? "Edycja" : "Nowy"}: ${R.Fleet.KINDS[kind].label.toLowerCase()}`, body: `<div class="stack">${body}</div>`,
        footer: `<button class="btn ghost" type="button" data-no>Anuluj</button><button class="btn primary" type="button" data-yes>Zapisz</button>` });
      $("[data-no]", m.el).onclick = () => m.close();
      $("[data-yes]", m.el).onclick = async () => {
        const next = Object.assign({}, rec, { id: id || undefined });
        for (const k of R.Fleet.KINDS[kind].fields) { const el = $("#fe-" + k, m.el); if (el) next[k] = el.value; }
        const res = await Store.transact(s => R.Fleet.save(s, kind, next, { user: R.byId(s.users, App.user().id), today: App.today(), source: "Moduł Flota" }));
        $$("[data-fmsg]", m.el).forEach(x => x.classList.add("hidden"));
        if (!res.ok) {
          for (const [k, msg] of Object.entries(res.errors || {})) { const x = $(`[data-fmsg="${k}"]`, m.el); if (x) { x.textContent = msg; x.classList.remove("hidden"); } }
          Toast.err("Nie zapisano", res.error); return;
        }
        m.close(); Toast.ok("Zapisano", res.rec.name); App.render();
      };
    }
  };

  /* ================================================================== */
  /* Administracja                                                        */
  /* ================================================================== */
  Views.administracja = {
    html() {
      const S = Store.state;
      let size = 0; try { size = (localStorage.getItem(UI.KEY) || "").length; } catch (e) {}
      const intro = root.Intro, today = UI.ssGet("riw.demo.today", "");
      const perms = Object.keys(R.PERMS);
      return `<div class="page-head"><div class="titles"><h2>Administracja</h2><p>Użytkownicy i uprawnienia, kopie zapasowe, import, preferencje i narzędzia demonstracyjne.</p></div></div>
        <div class="card"><div class="card-h"><h3>Użytkownicy i role</h3><span class="sub">zmiana użytkownika: prawy górny róg</span></div>
          <div class="tbl-wrap"><table class="tbl" id="users-table"><thead><tr><th>Użytkownik</th><th>Rola</th><th>Magazyn</th><th>Status</th></tr></thead><tbody>
            ${S.users.map(u => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(R.ROLES[u.role].label)}</td><td>${esc(App.whName(u.whId))}</td><td>${u.active === false ? '<span class="badge">nieaktywny</span>' : '<span class="badge ok">aktywny</span>'}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="card mt4"><div class="card-h"><h3>Macierz uprawnień</h3></div><div class="tbl-wrap"><table class="tbl" id="perm-table"><thead><tr><th>Uprawnienie</th>${Object.values(R.ROLES).map(r => `<th class="c">${esc(r.label)}</th>`).join("")}</tr></thead><tbody>
          ${perms.map(p => `<tr><td><span class="mono">${esc(p)}</span><br><small class="dim">${esc(R.PERMS[p])}</small></td>${Object.keys(R.ROLES).map(k => `<td class="c">${R.can({ role: k }, p) ? `<span class="badge ok">${ic("check", 12)}</span>` : "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>
        <div class="grid g2 mt4">
          <div class="card"><div class="card-h"><h3>Kopia zapasowa</h3></div><div class="card-b stack">
            <p class="muted">Pełna kopia (operacje, dokumenty, korekty, anulowania, księga, inwentaryzacja, flota, audyt) w pliku JSON. Wczytanie kopii zastępuje bieżące dane po kontroli struktury.</p>
            <div class="row wrap"><button class="btn primary" type="button" id="bk-export" ${App.can("data.backup") ? "" : "disabled"}>${ic("dl", 15)} Pobierz kopię (JSON)</button>
              <button class="btn" type="button" id="bk-import" ${App.can("data.import") ? "" : "disabled"}>${ic("up", 15)} Wczytaj kopię</button>
              <input type="file" id="bk-file" accept="application/json,.json" class="hidden"></div>
            <p class="help">Wymagana rola: Kierownik lub Administrator. Rozmiar danych: ${fmt(size / 1024, 1)} kB (rewizja ${S.rev}, schemat ${S.schema}).</p></div></div>
          <div class="card"><div class="card-h"><h3>Preferencje</h3></div><div class="card-b stack">
            <label class="inline-opt"><input type="checkbox" id="pf-tut" ${UI.lsGet("riw.demo.tutorial", "1") !== "0" ? "checked" : ""}> Samouczek pod polami formularza</label>
            <label class="inline-opt"><input type="checkbox" id="pf-intro" ${intro && intro.enabled() ? "checked" : ""}> Intro przy uruchomieniu</label>
            <label class="inline-opt"><input type="checkbox" id="pf-music" ${intro && intro.musicOn() ? "checked" : ""}> Muzyka w intro (domyślnie włączona)</label>
            <div><button class="btn" type="button" id="pf-play">${ic("play", 15)} Odtwórz intro</button></div></div></div>
          <div class="card"><div class="card-h"><h3>Narzędzia demonstracyjne</h3></div><div class="card-b stack">
            <div class="field"><label for="dm-today">Data systemowa demo (pusta = dzisiejsza)</label><input class="ctrl" type="date" id="dm-today" value="${esc(today)}"><div class="help">Pozwala sprawdzić przełom miesiąca bez czekania. Obowiązuje w tej karcie.</div></div>
            <div class="row wrap"><button class="btn" type="button" id="dm-apply">Zastosuj datę</button><button class="btn" type="button" id="dm-roll">Kontrola przełomu miesiąca</button></div>
            <p class="help">Ostatnia kontrola przełomu: <b>${esc(S.meta.lastMonthCheck || "—")}</b>.</p></div></div>
          <div class="card"><div class="card-h"><h3>Dane przykładowe</h3></div><div class="card-b stack">
            <p class="muted">Przywraca stan startowy (bilans otwarcia 01.08.2026, operacje wzorcowe każdego rodzaju, MM, korekta WZ i anulowany zakup). Obecne dane zostaną zastąpione.</p>
            <div><button class="btn danger" type="button" id="dm-reset" ${App.can("data.import") ? "" : "disabled"}>Przywróć dane przykładowe</button></div></div></div>
        </div>
        <div class="card mt4"><div class="card-h"><h3>O demonstratorze</h3></div><div class="card-b">
          <dl class="money-list" style="max-width:680px"><dt>Wersja</dt><dd>${esc(R.VERSION)} · schemat ${R.SCHEMA}</dd><dt>Przeliczniki</dt><dd>1 m³ = ${fmtQ(S.config.m3_mp)} MP · 1 MP = ${fmt(S.config.mp_t, 2)} t · 1 t = ${fmt(S.config.t_gj, 1)} GJ</dd><dt>Cena za rąbanie</dt><dd>${fmt(S.config.chipRateDefault)} zł/MP (domyślnie)</dd>
          <dt>Trwałość</dt><dd>${Store.memoryOnly ? "tylko pamięć (localStorage zablokowany)" : "localStorage (demonstracyjnie)"}</dd><dt>Blokada zapisu między kartami</dt><dd>${root.navigator && navigator.locks ? "Web Locks — aktywna" : "niedostępna w tej przeglądarce"}</dd><dt>PDF</dt><dd>generator wbudowany, czcionka ResInvestDocSans (OFL)</dd></dl>
          <p class="help mt3">Demonstrator nie zastępuje produkcyjnego ERP: dane są w tej przeglądarce, a kontrola współbieżności działa tylko między kartami tego samego komputera.</p></div></div>`;
    },
    bind(page) {
      const intro = root.Intro;
      $("#pf-tut", page).onchange = e => { UI.lsSet("riw.demo.tutorial", e.target.checked ? "1" : "0"); document.body.classList.toggle("no-tutorial", !e.target.checked); };
      $("#pf-intro", page).onchange = e => intro && intro.setEnabled(e.target.checked);
      $("#pf-music", page).onchange = e => intro && intro.setMusic(e.target.checked);
      $("#pf-play", page).onclick = () => intro && intro.play({ force: true });
      $("#bk-export", page).onclick = () => {
        download(`resinvest_demo_kopia_${App.today()}.json`, JSON.stringify(Store.state, null, 1), "application/json");
        Store.transact(s => { s.rev += 1; s.audit.push({ id: R.uid("a"), ts: new Date().toISOString(), userId: App.user().id, userName: App.user().name, whId: App.user().whId, entity: "system", entityId: "backup", opNo: "kopia", event: "backup", action: "Pobranie kopii zapasowej", before: null, after: { rewizja: s.rev }, source: "Administracja" }); return { ok: true }; });
      };
      $("#bk-import", page).onclick = () => $("#bk-file", page).click();
      $("#bk-file", page).onchange = async e => {
        const file = e.target.files[0]; e.target.value = "";
        if (!file) return;
        let data;
        try { data = JSON.parse(await file.text()); } catch (x) { Toast.err("Plik nie jest poprawnym JSON"); return; }
        const errs = R.validateStateShape(data);
        if (errs.length) { Toast.err("Kopia odrzucona", errs.slice(0, 3).join("; ")); return; }
        const r = await Modal.confirm({ title: "Wczytać kopię?", text: `Kopia: ${data.operations.length} operacji, ${data.ledger.length} zapisów księgi, rewizja ${data.rev}. Bieżące dane zostaną zastąpione.`, ok: "Wczytaj", danger: true });
        if (!r.ok) return;
        const who = App.user();
        const res = await Store.transact(s => {
          const next = R.clone(data);
          next.rev = Math.max(s.rev, next.rev) + 1;
          next.audit.push({ id: R.uid("a"), ts: new Date().toISOString(), userId: who.id, userName: who.name, whId: who.whId, entity: "system", entityId: "import", opNo: "import", event: "import", action: "Import kopii zapasowej", before: { rewizja: s.rev, operacje: s.operations.length }, after: { rewizja: next.rev, operacje: next.operations.length }, source: "Administracja" });
          Object.keys(s).forEach(k => delete s[k]); Object.assign(s, next);
          return { ok: true };
        });
        if (res.ok) { Toast.ok("Kopia wczytana"); UI.Form.draft = null; UI.ssSet(UI.DRAFT_KEY, null); App.render(); } else Toast.err("Import nieudany", res.error);
      };
      $("#dm-apply", page).onclick = () => { const v = $("#dm-today", page).value; UI.ssSet("riw.demo.today", v || null); Toast.info("Data systemowa demo", v || "dzisiejsza"); App.render(); };
      $("#dm-roll", page).onclick = async () => {
        const res = await Store.transact(s => ({ ok: true, done: R.Inventory.autoClose(s, { user: null, today: App.today(), source: "Automat: początek kolejnego miesiąca" }) }));
        const done = res.done || [];
        Toast.info("Kontrola przełomu miesiąca", done.length ? done.map(d => `${d.ym}: ${d.ok ? "zamknięto" + (d.docNo ? " (" + d.docNo + ")" : "") : d.error}`).join(" · ") : "Brak otwartych okresów z poprzednich miesięcy lub kontrola już wykonana w tym miesiącu.");
        App.render();
      };
      $("#dm-reset", page).onclick = async () => {
        const r = await Modal.confirm({ title: "Przywrócić dane przykładowe?", text: "Wszystkie operacje, dokumenty, okresy i zmiany floty w tej przeglądarce zostaną zastąpione danymi startowymi.", ok: "Przywróć", danger: true });
        if (!r.ok) return;
        const res = await Store.transact(s => { const n = R.Seed.build(App.today()); n.rev = s.rev + 1; Object.keys(s).forEach(k => delete s[k]); Object.assign(s, n); return { ok: true }; });
        if (res.ok) { UI.Form.draft = null; UI.ssSet(UI.DRAFT_KEY, null); Toast.ok("Przywrócono dane przykładowe"); App.render(); }
      };
    }
  };

  root.OpDetail = OpDetail;
  root.RIWViews = { allDocuments, docModel, kwitModel, historyModel, Reports, Printer, CancelDialog, DocPreview, OpDetail };
})(typeof globalThis !== "undefined" ? globalThis : this);
