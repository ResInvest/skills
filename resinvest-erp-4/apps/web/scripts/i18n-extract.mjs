/**
 * Wyciąga teksty do tłumaczenia z kodu frontendu: wywołania t("…") / m("…") z dosłownym tekstem.
 * `node scripts/i18n-extract.mjs` — lista tekstów bez tłumaczenia w cs / en (pomoc przy dopisywaniu słowników).
 * Ta sama funkcja jest używana przez test src/i18n/i18n.spec.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const RE = /\b[tm]\(\s*"((?:[^"\\]|\\.)*)"/g;

function* files(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== "i18n") yield* files(p); }
    else if (/\.(tsx?|mts)$/.test(f) && !/\.spec\./.test(f)) yield p;
  }
}

/** Mapa: tekst polski → pliki, w których występuje. */
export function extract() {
  const out = new Map();
  for (const p of files(SRC)) {
    const s = readFileSync(p, "utf8");
    for (const mm of s.matchAll(RE)) {
      const key = JSON.parse(`"${mm[1]}"`);
      if (!out.has(key)) out.set(key, new Set());
      out.get(key).add(p.slice(SRC.length));
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const keys = extract();
  const dict = lang => {
    const s = readFileSync(join(SRC, "i18n", `${lang}.ts`), "utf8");
    return new Set([...s.matchAll(/^\s*"((?:[^"\\]|\\.)*)":/gm)].map(x => JSON.parse(`"${x[1]}"`)));
  };
  for (const lang of ["cs", "en"]) {
    const d = dict(lang);
    const missing = [...keys.keys()].filter(k => !d.has(k));
    console.warn(`${lang}: ${keys.size - missing.length}/${keys.size} przetłumaczonych`);
    if (process.argv.includes("--missing")) for (const k of missing) console.warn(JSON.stringify(k));
  }
}
