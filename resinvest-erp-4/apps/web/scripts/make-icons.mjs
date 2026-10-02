// Ikony aplikacji (PWA, iOS, Windows / Tauri) z jednego wzorca SVG — renderowane przez Chromium z Playwright.
// Uruchomienie z katalogu głównego monorepo:  node apps/web/scripts/make-icons.mjs
// Wynik: apps/web/public/icons/*.png (+ apps/desktop/src-tauri/app-icon.png — wejście dla „tauri icon”).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const { chromium } = createRequire(resolve(root, "e2e/package.json"))("@playwright/test");

/** Znak firmowy: zielony kwadrat, „RI”, listek; `bleed` = pełne tło bez zaokrągleń (ikona maskowalna Androida). */
const svg = (bleed) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a8a5c"/><stop offset="1" stop-color="#17543a"/></linearGradient></defs>
  <rect width="1024" height="1024" rx="${bleed ? 0 : 224}" fill="url(#g)"/>
  <g transform="${bleed ? "translate(512 512) scale(.72) translate(-512 -512)" : ""}">
    <path d="M704 236c-128 8-214 92-226 214 112-6 206-84 226-214z" fill="#a8e6c3"/>
    <text x="512" y="700" font-family="DejaVu Sans, Arial, sans-serif" font-size="420" font-weight="700" fill="#fff" text-anchor="middle" letter-spacing="-12">RI</text>
  </g></svg>`;

const out = [
  ["apps/web/public/icons/icon-192.png", 192, false], ["apps/web/public/icons/icon-512.png", 512, false],
  ["apps/web/public/icons/maskable-512.png", 512, true], ["apps/web/public/icons/apple-touch-icon.png", 180, true],
  ["apps/web/public/icons/favicon-32.png", 32, false], ["apps/desktop/src-tauri/app-icon.png", 1024, false],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, bleed] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(bleed).replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  mkdirSync(dirname(resolve(root, file)), { recursive: true });
  await page.locator("svg").screenshot({ path: resolve(root, file), omitBackground: true });
  console.log(`${file} (${size}px)`);
}
await browser.close();
// wzorzec SVG także jako ikona strony
const { writeFileSync } = await import("node:fs");
writeFileSync(resolve(root, "apps/web/public/icon.svg"), svg(false).replace(/\n\s*/g, ""));
