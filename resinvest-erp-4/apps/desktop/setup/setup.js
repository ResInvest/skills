// Ekran konfiguracji aplikacji Windows: adres serwera → sprawdzenie, czy serwer odpowiada → zapis i przejście na serwer.
// Walidację adresu (https, bez loginu w adresie) wykonuje też Rust (save_server) — tu tylko podpowiedź i test połączenia.
(() => {
  const invoke = window.__TAURI__?.core?.invoke;
  const $ = id => document.getElementById(id);
  const form = $("form"), input = $("url"), msg = $("msg"), connect = $("connect"), force = $("force");
  const show = (text, kind) => { msg.textContent = text; msg.className = `msg ${kind}`; msg.hidden = false; };
  const origin = raw => { const s = raw.trim(); return new URL(s.includes("://") ? s : `https://${s}`).origin; };

  if (invoke) invoke("current_server").then(s => { if (s) input.value = s; }).catch(() => undefined);

  /** Czy serwer odpowiada (TLS, sieć, VPN) — zapytanie bez odczytu treści (brak CORS w tym kroku). */
  async function reachable(base) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try { await fetch(`${base}/api/v1/health`, { mode: "no-cors", cache: "no-store", signal: ctrl.signal }); return true; }
    catch { return false; }
    finally { clearTimeout(t); }
  }

  async function save(base) {
    if (!invoke) { show("Ten ekran działa tylko w aplikacji ResInvest ERP.", "err"); return; }
    try { show("Łączenie…", "ok"); await invoke("save_server", { url: base }); }
    catch (e) { show(String(e), "err"); connect.disabled = false; }
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    force.hidden = true;
    let base;
    try { base = origin(input.value); } catch { show("Nieprawidłowy adres — wpisz np. https://erp.resinvest.group", "err"); input.focus(); return; }
    if (!input.value.trim()) { show("Podaj adres serwera.", "err"); input.focus(); return; }
    connect.disabled = true;
    show("Sprawdzanie połączenia…", "ok");
    if (await reachable(base)) { await save(base); return; }
    connect.disabled = false;
    show(`Serwer ${base} nie odpowiada. Sprawdź adres, połączenie VPN (FortiClient) i czy certyfikat serwera jest zaufany na tym komputerze.`, "err");
    force.hidden = false;
    force.onclick = () => void save(base);
  });
  input.focus();
})();
