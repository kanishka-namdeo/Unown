/**
 * Chaconne — the offline service worker (C-3 SKELETON; C-6/C-7 complete
 * the precache list).
 *
 * Ostinato sw.js port, skeleton stage: CACHE_NAME "chaconne-v0" + an
 * EMPTY precache list (C-6/C-7 fill it: the full runtime closure —
 * index.html, the manifest, the icon, the css, the app.ts entry, the
 * .js-convention module forms, the offline.html fallback, the domain +
 * storage + ui module graph). The fetch handler's network-first +
 * runtime cache belt + offline fallback lands as-is (the Ostinato
 * fetch lane, verbatim semantics).
 *
 * Ostinato contract preserved: `sw.js` lives at `apps/chaconne/`
 * (never under `public/`), classic (non-module) worker, plain ES2020,
 * no imports, never transpiled. `cache.add` REJECTS non-2xx, so when
 * C-6/C-7 fill the list, a wrong path fails install loudly.
 */

const CACHE_NAME = "chaconne-v0";

/* C-6/C-7: the enumerated runtime closure lands here (the PLAN §1
 * precache row). The skeleton ships EMPTY on purpose — an install with
 * zero entries still claims + networks-first, and the fetch lane's
 * runtime belt caches whatever the first online load fetched. */
const PRECACHE_LIST = [];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await self.caches.open(CACHE_NAME);
      await Promise.all(PRECACHE_LIST.map((p) => cache.add(new URL(p, self.location.origin).href)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await self.caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => self.caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname.replace(/^\/+/, "");
  const normalized = path === "" ? "index.html" : path;

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        const cache = await self.caches.open(CACHE_NAME);
        if (res.ok) cache.put(normalized, res.clone());
        return res;
      } catch {
        const cache = await self.caches.open(CACHE_NAME);
        const cached = await cache.match(normalized);
        if (cached) return cached;
        const offline = await cache.match("public/offline.html");
        return offline || Response.error();
      }
    })()
  );
});
