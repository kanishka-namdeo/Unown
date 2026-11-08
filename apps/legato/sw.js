/**
 * Legato — the offline service worker (ticket L-10: registration +
 * the enumerated precache + the verify-precache derivation proof).
 *
 * L-10 lands the SW registration in src/ui/app.ts (the fail-soft
 * Ostinato Coda main.ts pattern: relative scope "./", on the window
 * load event, a warn — never a boot dependency) and this install-time
 * precache of the CURRENT runtime closure. The first load's
 * subresources are fetched PRE-CONTROL, so the fetch handler's
 * runtime cache belt never sees them — the offline lane needs the
 * FULL closure at install (the Coda C-7 design, ostinato O-4 shape).
 *
 * Coda contract preserved: `sw.js` lives at `apps/legato/` (never
 * under `public/`), classic (non-module) worker, plain ES2020, no
 * imports, never transpiled. The fetch handler's network-first +
 * runtime cache belt + offline.html fallback carries the Ostinato
 * shape: online requests hit the network first and refresh the
 * runtime cache; on a network failure the response comes from cache
 * (first the exact entry, then public/offline.html).
 *
 * PRECACHE_LIST is the enumerated runtime closure, paths relative to
 * the app root, verified against the import graph: the entry is
 * requested AS .ts by index.html (`src/ui/app.ts`); the compiled
 * module graph requests the .js-convention forms, which serve.mjs's
 * js→ts swap serves as transpiled .ts. `cache.add` REJECTS
 * non-2xx, so a wrong path fails install loudly — the honesty the
 * offline lane wants. The browser entry's dynamic imports (the IDB
 * adapter + the fake fallback) land in the list too — they are the
 * only runtime closure. `scripts/verify-precache.ts` proves the
 * list against the on-disk tree on every run (three-way ladder:
 * PRECACHE_LIST vs the served closure vs the tree).
 */

const CACHE_NAME = "legato-v1";

const PRECACHE_LIST = [
  "index.html",
  "public/manifest.webmanifest",
  "public/icon.svg",
  "public/offline.html",
  "src/ui/legato.css",
  "src/ui/app.ts",
  // ── the static module graph (the .js-convention request forms;
  //    serve.mjs serves them transpiled from the .ts sources) ─────
  "src/ui/el.js",
  "src/ui/list.js",
  "src/ui/detail.js",
  "src/ui/palette.js",
  "src/ui/theme.js",
  "src/ui/queue.js",
  "src/ui/filterbar.js",
  "src/ui/tag-editor.js",
  "src/storage/storage-port.js",
  "src/storage/idb-storage.js",
  "src/storage/fake-storage.js",
  "src/domain/types.js",
  "src/domain/search.js",
  // ── the L-11 clip pipeline closure (REALFETCHER lane) ─────
  // The L-11 pipeline closure: the browser-edge dynamic imports
  // (fetcher + clip + extractor + error-taxonomy) are in the
  // runtime closure that the offline lane's install precache
  // must cover (the L-10 law).
  "src/pipeline/fetcher.js",
  "src/pipeline/clip.js",
  "src/pipeline/extractor.js",
  "src/pipeline/error-taxonomy.js",
  "src/domain/queue.js",
  "src/domain/tags.js",
  "src/domain/highlights.js",
  "src/domain/ids.js",
  "src/domain/io.js",
  "src/domain/invariants.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await self.caches.open(CACHE_NAME);
      // L-10: precache the enumerated runtime closure. cache.add
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
