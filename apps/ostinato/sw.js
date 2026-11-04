/**
 * Ostinato — offline stub service worker (ticket O-1).
 *
 * Coda-prefaced placeholder: the full precache design (PRECACHE_LIST
 * derived from the runtime import graph, verify-precache.ts, versioned
 * cache, cache-first/stale-while-revalidate fetch strategy) lands at
 * O-5 with the PWA capture lane, once the UI shell (O-3) creates the
 * runtime closure to enumerate. This stub exists so the manifest +
 * offline.html surface is complete and a worker script is reachable at
 * the app root — the Coda contract: `sw.js` lives at `apps/ostinato/`
 * (never under `public/`), registration will be
 * `register("./sw.js", { scope: "./" })`, classic (non-module) worker,
 * plain ES2020, no imports, never transpiled.
 */

const CACHE_NAME = "ostinato-v0";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await self.caches.open(CACHE_NAME);
      // O-5 stub: precache the shell only.
      await cache.add(new URL("index.html", self.location.origin).href);
      await cache.add(new URL("public/offline.html", self.location.origin).href);
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
