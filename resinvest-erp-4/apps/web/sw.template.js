/*
 * ResInvest ERP — service worker (PWA). Generowany przy budowaniu (vite.config.ts → pwa()): wersja i lista plików.
 * Zasady bezpieczeństwa danych:
 *  - w pamięci urządzenia są TYLKO pliki aplikacji (HTML, JS, CSS, ikony) — nigdy odpowiedzi API (/api/…),
 *    więc dane firmy, sesja i dokumenty nie zostają na telefonie ani komputerze;
 *  - nowa wersja czeka, aż użytkownik kliknie „Odśwież” (nie przeładowuje strony w trakcie wypełniania formularza).
 */
const VERSION = "__BUILD__";
const CACHE = `riw-shell-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("riw-shell-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
  if (e.data === "VERSION") e.source?.postMessage({ type: "VERSION", version: VERSION });
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;   // API zawsze z sieci, bez zapisu
  if (req.mode === "navigate") {
    // strona: najpierw sieć (świeża wersja), bez sieci — powłoka aplikacji z pamięci (aplikacja pokaże „brak połączenia”)
    e.respondWith(fetch(req).catch(async () => (await caches.match("/index.html", { cacheName: CACHE })) ?? Response.error()));
    return;
  }
  // pliki z hashem w nazwie, ikony, manifest: z pamięci, a gdy brak — z sieci i do pamięci
  e.respondWith(caches.match(req, { cacheName: CACHE }).then(hit => hit ?? fetch(req).then(res => {
    if (res.ok && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/"))) {
      const copy = res.clone();
      void caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  })));
});
