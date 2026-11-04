/**
 * Ostinato — the offline service worker (ticket O-4: registration +
 * the enumerated precache; O-5 keeps the versioned-cache tooling +
 * verify-precache + the PWA capture lane).
 *
 * O-4 landed the SW registration in src/ui/app.ts (the fail-soft
 * Coda main.ts pattern: relative scope "./", on the window load
 * event, a warn — never a boot dependency) and this install-time
 * precache of the CURRENT runtime closure. The O-1 stub precached
 * only the shell (index.html + offline.html); after clients.claim()
 * the first load's subresources were fetched pre-control, so the
 * fetch handler's runtime cache belt never saw them — the offline
 * lane needs the FULL closure at install (the Coda C3 design).
 *
 * Coda contract preserved: `sw.js` lives at `apps/ostinato/` (never
 * under `public/`), classic (non-module) worker, plain ES2020, no
 * imports, never transpiled. The fetch handler's network-first +
 * runtime cache belt + offline.html fallback STAYS as-is (O-5 may
 * upgrade it to cache-first/SWR without touching this lane).
 *
 * PRECACHE_LIST is the enumerated runtime closure, paths relative to
 * the app root, verified against the import graph: the entry is
 * requested AS .ts by index.html (`src/ui/app.ts`); the compiled
 * module graph requests the .js-convention forms, which serve.mjs's
 * js→ts swap serves as transpiled .ts. `cache.add` REJECTS non-2xx,
 * so a wrong path fails install loudly — the honesty the offline
 * lane wants. Chunk 3's create surface wired src/ui/app.ts's
 * import of src/domain/model.js (+ ids.js, model's dependency)
 * into the closure — both land in PRECACHE_LIST below.
 */

const CACHE_NAME = "ostinato-v2";

const PRECACHE_LIST = [
  "index.html",
  "public/manifest.webmanifest",
  "public/icon.svg",
  "public/offline.html",
  "src/ui/ostinato.css",
  "src/ui/app.ts",
  "src/ui/runner-core.js",
  "src/ui/palette.js",
  "src/ui/queue-nav.js",
  "src/domain/ports.js",
  "src/domain/io.js",
  "src/domain/invariants.js",
  "src/domain/types.js",
  "src/domain/storage.js",
  "src/domain/scheduler.js",
  "src/storage/local-storage.js",
  "src/domain/model.js",
  "src/domain/ids.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await self.caches.open(CACHE_NAME);
      // O-4: precache the enumerated runtime closure. cache.add
      // rejects non-2xx — a wrong path fails install loudly.
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
