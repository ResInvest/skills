#!/usr/bin/env node
/* Składa aplikację w jeden plik: ResInvest_ERP.html
   (ten sam plik działa samodzielnie — tryb lokalny — i jest serwowany przez ResInvest ERP Serwer).
   Użycie:  node tools/build.mjs            (z katalogu resinvest-erp)
            node tools/build.mjs --no-video (bez filmu intro — tylko muzyka syntezowana) */
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadPdfFonts } from "./pdf-fonts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "app", "src");
const OUT = join(ROOT, "ResInvest_ERP.html");
const noVideo = process.argv.includes("--no-video");

/** Kolejność ładowania warstw (zależności: i18n + słowniki → silnik → usługa → interfejs). */
export const DICTS = readdirSync(SRC).filter(f => /^i18n\.d\d+\.js$/.test(f)).sort();
export const SCRIPTS = ["i18n.js", ...DICTS, "engine.js", "service.js", "seed.js", "pdf.js", "auth.js", "intro.js", "core.js", "form.js", "views.js", "dashboard.js", "admin.js"];

const read = f => readFileSync(join(SRC, f), "utf8");
for (const f of SCRIPTS.concat(["styles.css"])) {
  const v = read(f);
  if (/<\/(script|style)/i.test(v)) throw new Error(`${f} zawiera </script> lub </style>`);
  if (f.endsWith(".js")) {
    const external = (v.match(/https?:\/\/[^\s"'`)]+/g) || []).filter(u => !u.startsWith("http://www.w3.org/"));
    if (external.length) throw new Error(`${f} odwołuje się do zasobów zewnętrznych: ${external.join(", ")}`);
  }
}

const require = createRequire(import.meta.url);
require(join(SRC, "i18n.js"));
const { VERSION } = require(join(SRC, "engine.js"));

let media = "";
if (!noVideo) {
  const mp4 = join(ROOT, "app", "assets", "intro.mp4");
  media = "data:video/mp4;base64," + readFileSync(mp4).toString("base64");
  console.log(`intro.mp4: ${(statSync(mp4).size / 1024).toFixed(0)} kB`);
}

export function loadConfig() {
  const raw = JSON.parse(readFileSync(join(ROOT, "config", "app.config.json"), "utf8"));
  const cfg = {};
  for (const k of ["m3_mp", "mp_t", "woodTPerM3", "t_gj", "kmRateDefault", "chipRateDefault", "wagonMPDefault", "maxWagons"]) {
    if (!(typeof raw[k] === "number" && raw[k] > 0)) throw new Error(`config/app.config.json: „${k}” musi być liczbą > 0`);
    cfg[k] = raw[k];
  }
  cfg.currency = String(raw.currency || "zł");
  return cfg;
}
const cfg = loadConfig();

let html = read("index.template.html");
const put = (marker, value) => {
  if (!html.includes(marker)) throw new Error("Brak znacznika " + marker);
  html = html.split(marker).join(value);
};
put("/*@@STYLES@@*/", read("styles.css"));
put("<!--@@SCRIPTS@@-->", SCRIPTS.map(f => `<script>\n/* ${f} */\n${read(f)}\n</script>`).join("\n"));
put("@@FONTS@@", JSON.stringify(loadPdfFonts()));
put("@@INTRO_MEDIA@@", media);
put("@@CONFIG@@", JSON.stringify(cfg));
put("@@VERSION@@", VERSION);
put("@@BUILT@@", new Date().toISOString().slice(0, 10));

writeFileSync(OUT, html, "utf8");
console.log(`Zapisano ${OUT} (${(Buffer.byteLength(html) / 1024).toFixed(0)} kB)`);
