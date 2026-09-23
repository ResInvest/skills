#!/usr/bin/env node
/* Składa demonstrator w jeden plik: ResInvest_ERP_demo.html
   Użycie:  node tools/build-demo.mjs            (z katalogu resinvest-erp)
            node tools/build-demo.mjs --no-video (plik bez filmu intro — tylko muzyka syntezowana) */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "demo", "src");
const OUT = join(ROOT, "ResInvest_ERP_demo.html");
const noVideo = process.argv.includes("--no-video");

const read = f => readFileSync(join(SRC, f), "utf8");
const parts = {
  STYLES: read("styles.css"),
  ENGINE: read("engine.js"),
  SEED: read("seed.js"),
  INTRO: read("intro.js"),
  APP: read("app.js")
};

// Kod wstawiany do <script>/<style> nie może zawierać znacznika zamykającego.
for (const [k, v] of Object.entries(parts)) {
  if (/<\/(script|style)/i.test(v)) throw new Error(`Sekcja ${k} zawiera </script> lub </style>`);
  if (/https?:\/\//i.test(v) && k !== "STYLES") {
    const hits = v.match(/https?:\/\/[^\s"'`)]+/g) || [];
    const external = hits.filter(u => !u.startsWith("http://www.w3.org/"));
    if (external.length) throw new Error(`Sekcja ${k} odwołuje się do zasobów zewnętrznych: ${external.join(", ")}`);
  }
}

const require = createRequire(import.meta.url);
const { VERSION } = require(join(SRC, "engine.js"));

let media = "";
if (!noVideo) {
  const mp4 = join(ROOT, "demo", "assets", "intro.mp4");
  media = "data:video/mp4;base64," + readFileSync(mp4).toString("base64");
  console.log(`intro.mp4: ${(statSync(mp4).size / 1024).toFixed(0)} kB`);
}

// Konfiguracja środowiska — walidacja przed wstrzyknięciem
const cfgRaw = JSON.parse(readFileSync(join(ROOT, "config", "demo.config.json"), "utf8"));
const cfg = {};
for (const k of ["m3_mp", "mp_t", "kmRateDefault", "wagonMPDefault", "maxWagons"]) {
  if (!(typeof cfgRaw[k] === "number" && cfgRaw[k] > 0)) throw new Error(`config/demo.config.json: „${k}” musi być liczbą > 0`);
  cfg[k] = cfgRaw[k];
}
cfg.currency = String(cfgRaw.currency || "zł");

let html = read("index.template.html");
const put = (marker, value) => {
  if (!html.includes(marker)) throw new Error("Brak znacznika " + marker);
  html = html.split(marker).join(value);
};
put("/*@@STYLES@@*/", parts.STYLES);
put("/*@@ENGINE@@*/", parts.ENGINE);
put("/*@@SEED@@*/", parts.SEED);
put("/*@@INTRO@@*/", parts.INTRO);
put("/*@@APP@@*/", parts.APP);
put("@@INTRO_MEDIA@@", media);
put("@@CONFIG@@", JSON.stringify(cfg));
put("@@VERSION@@", VERSION);
put("@@BUILT@@", new Date().toISOString().slice(0, 10));

writeFileSync(OUT, html, "utf8");
console.log(`Zapisano ${OUT} (${(Buffer.byteLength(html) / 1024).toFixed(0)} kB)`);
