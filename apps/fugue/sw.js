/**
 * Fugue — the offline service worker (F-4, the PWA shell).
 *
 * The bolero sw.js law, ported: classic (non-module) worker, plain
 * ES2020, no imports, never transpiled. CACHE_NAME "fugue-v1";
 * precache the enumerated runtime closure.
 *
 * PRECACHE_LIST is the enumerated runtime closure, paths relative to
 * the app root: the entry is requested AS .ts by index.html
 * (`src/ui/app.ts`); the compiled module graph requests the
 * .js-convention forms, which serve.mjs's js→ts swap serves as
 * transpiled .ts. `cache.add` REJECTS non-2xx, so a wrong path
 * fails install loudly — the honesty the offline lane wants.
 *
 * The fetch handler's data-policy (honest data, honest offline —
 * never stale lies):
 *   - /api/* and /health GETs pass straight through to the network —
 *     they are NEVER served from cache. The data is what the server
 *     says it is, right now; offline means the app's own error
 *     panel renders, the way it should.
 *   - same-origin static GETs: cache-first after the first fetch
 *     (the precache owns the shell; runtime caches fill the belt).
 *   - document navigations: network-first, then cache, then
 *     Response.error() (fugue has no offline.html — the app shell
 *     itself is the offline fallback; a failed navigate falls back
 *     to the cached index.html).
 */

const CACHE_NAME = "fugue-v1";

const PRECACHE_LIST = [
  "index.html",
  "public/manifest.webmanifest",
  "public/icon.svg",
  "src/ui/fugue.css",
  "src/ui/app.ts",
];

function isDynamicRequest(path) {
  // /health and any /api/* path are NEVER cache-served.
  return path === "health" || path.indexOf("api/") === 0;
}

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

  // Honesty rule 1: /api/* and /health NEVER come from cache. If the
  // engine is down the app's own EngineDown panel renders, not a
  // stale response served from cache.
  if (isDynamicRequest(path)) return; // let it hit the network directly

  event.respondWith(
    (async () => {
      const cache = await self.caches.open(CACHE_NAME);

      // Honesty rule 2: document navigations are network-first so the
      // shell stays fresh; only on a network failure do we fall back
      // to the cached index.html (the shell itself is the offline
      // fallback — the app then boots and renders its honest panels).
      if (req.mode === "navigate") {
        try {
          const res = await fetch(req);
          if (res.ok) cache.put("index.html", res.clone());
          return res;
        } catch {
          const cached = await cache.match("index.html");
          return cached || Response.error();
        }
      }

      // Honesty rule 3: same-origin static GETs are cache-first after
      // the first fetch — the precache owns them at install; the
      // runtime belt fills any entry the first load missed.
      const cached = await cache.match(path === "" ? "index.html" : path);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(path === "" ? "index.html" : path, res.clone());
        return res;
      } catch {
        const offline = await cache.match("index.html");
        return offline || Response.error();
      }
    })()
  );
});
