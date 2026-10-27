/* Motyw przed pierwszym malowaniem: zmienne CSS zapamiętane na tym urządzeniu przez aplikację (src/theme).
   Tylko kolory (#rrggbb i gradient z kolorów) — każda inna wartość jest pomijana. */
(function () {
  try {
    var v = JSON.parse(localStorage.getItem("riw.theme.vars") || "null"), r = document.documentElement, ok = /^(#[0-9a-f]{6}|radial-gradient\([#0-9a-z%,.() -]*\))$/;
    if (!v) return;
    for (var k in v) if (k.indexOf("--") === 0 && ok.test(v[k])) r.style.setProperty(k, v[k]);
    if (v.scheme === "dark" || v.scheme === "light") r.style.colorScheme = v.scheme;
    r.setAttribute("data-theme", "boot");
  } catch { /* brak pamięci urządzenia — motyw domyślny */ }
})();
