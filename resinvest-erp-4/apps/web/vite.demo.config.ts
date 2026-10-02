import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Build wersji demonstracyjnej (demo/): jeden plik HTML — skrypt i style wstawione do strony, słowniki
 * wbudowane, bez service workera i bez ikon zewnętrznych. Uruchamiany przez demo/build.mjs.
 */
function singleFile(): Plugin {
  return {
    name: "resinvest-demo-single-file", apply: "build", enforce: "post",
    generateBundle(_o, bundle) {
      const html = bundle["index.html"];
      if (!html || html.type !== "asset") return;
      let src = String(html.source).replace("/*THEME_BOOT*/", readFileSync(new URL("./public/theme-boot.js", import.meta.url), "utf8"));
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type === "chunk" && name.endsWith(".js")) {
          const re = new RegExp(`<script type="module" crossorigin src="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"></script>`);
          src = src.replace(re, () => `<script type="module">${chunk.code.replace(/<\/script/gi, "<\\/script")}</script>`);
          delete bundle[name];
        } else if (chunk.type === "asset" && name.endsWith(".css")) {
          const re = new RegExp(`<link rel="stylesheet" crossorigin href="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`);
          src = src.replace(re, () => `<style>${String(chunk.source)}</style>`);
          delete bundle[name];
        }
      }
      html.source = src;
    },
  };
}

export default defineConfig({
  root: "demo",
  base: "./",
  publicDir: false,
  plugins: [react(), singleFile()],
  build: { target: "es2022", outDir: "../dist-demo", emptyOutDir: true, sourcemap: false, assetsInlineLimit: 100_000_000, cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } } },
});
