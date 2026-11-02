/**
 * Coda — hand-rolled service worker (zero deps, plain ES2020, never transpiled).
 *
 * Lives at the app ROOT (apps/coda/sw.js), not under public/ — a service
 * worker's max allowable scope is the directory the worker script is served
 * from, so a worker at /public/sw.js can never control scope ./ (the app
 * root): the browser refuses it with "the provided scope is not under the
 * max scope allowed". Registration from main.ts stays
 * `register("./sw.js", { scope: "./" })` — relative, any mount point works.
 *
 * Design decisions (ticket C3):
 * - CLASSIC worker (no `type="module"`): maximum cross-browser support; the
 *   worker has no imports so modules buy nothing.
 * - Pinned relative scope: registration is `navigator.serviceWorker.register(
 *   "./sw.js", { scope: "./" })` from main.ts — the SW's scope resolves
 *   relative to the worker script URL. Because we register with a relative
 *   specifier and an explicit relative scope, the app works from ANY mount
 *   point (/, /coda/, /notes/…) without a config change. This is the plan's
 *   P0 fix: an absolute `/sw.js` + `/` scope silently breaks subpath serving.
 * - Versioned cache `coda-v1` + PRECACHE_LIST enumerates EVERY URL the
 *   browser loads (derived from the import graph; verified by
 *   scripts/verify-precache.ts). install fails-soft per item (one missing
 *   URL logs a warning, does not reject the whole install).
 * - fetch: same-origin GETs only. PRECACHE_LIST → cache-first with
 *   stale-while-revalidate (background refresh). Everything else →
 *   network-first with cache fallback. Navigation requests that fail
 *   (offline) → serve offline.html from cache.
 * - activate: deletes every cache not in the current version's set, then
 *   clients.claim() so the FIRST page load is already controlled (the e2e
 *   lane's `waitForFunction` on `navigator.serviceWorker.controller` lands
 *   fast).
 */

const CACHE_NAME = "coda-v1";

// Every URL the browser requests, exactly as it asks for it.
// (Extensionless for extensionless imports — the transpiling server resolves
// them; the SW intercepts the ASKED URL.)
const PRECACHE_LIST = [
  // shell
  "index.html",
  "src/coda.css",
  "src/main.ts",
  // top-level modules (extensionless)
  "src/app",
  "src/db/idb",
  // ui modules (extensionless)
  "src/ui/shell",
  "src/ui/notes",
  "src/ui/editor",
  "src/ui/tasks",
  "src/ui/search",
  "src/ui/status",
  "src/ui/sanitize",
  // domain modules (extensionless) — markdown.ts is NOT in the runtime
  // import closure (only test files import it), so it is deliberately absent
  "src/domain/types",
  "src/domain/store",
  "src/domain/repository",
  "src/domain/search",
  // vendored ESM libraries (import map targets)
  "public/vendor/fuse.mjs",
  "public/vendor/marked.mjs",
  // PWA surface
  "public/manifest.webmanifest",
  "public/icon.svg",
  "public/icon-192.png",
  "public/icon-512.png",
  "public/offline.html",
];

const OFFLINE_URL = "public/offline.html";
const PRECACHE_SET = new Set(PRECACHE_LIST);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await self.caches.open(CACHE_NAME);
      // Fail-soft: cache.add per item so one missing URL does not kill the
      // whole install; log each failure.
      for (const url of PRECACHE_LIST) {
        try {
          await cache.add(new URL(url, self.location.origin).href);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[sw] precache miss: ${url}`, err);
        }
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Clean old cache versions.
      const keys = await self.caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => self.caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Only intercept same-origin requests.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname.replace(/^\/+/, ""); // strip leading slash for mount-point-agnostic matching
  const normalized = path === "" ? "index.html" : path;

  // Precached asset: cache-first + stale-while-revalidate.
  if (PRECACHE_SET.has(normalized)) {
    event.respondWith(
      (async () => {
        const cache = await self.caches.open(CACHE_NAME);
        const cached = await cache.match(normalized);
        const networkFetch = fetch(normalized).then((res) => {
          if (res.ok) cache.put(normalized, res.clone());
          return res;
        }).catch(() => cached);
        return cached || networkFetch;
      })()
    );
    return;
  }

  // Navigation request that fails (offline) → offline.html.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await self.caches.open(CACHE_NAME);
          if (res.ok) cache.put(normalized, res.clone());
          return res;
        } catch {
          const cache = await self.caches.open(CACHE_NAME);
          const offline = await cache.match(OFFLINE_URL);
          return offline || Response.error();
        }
      })()
    );
    return;
  }

  // Everything else same-origin GET: network-first + cache fallback.
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await self.caches.open(CACHE_NAME);
          cache.put(normalized, res.clone());
        }
        return res;
      } catch {
        const cache = await self.caches.open(CACHE_NAME);
        const cached = await cache.match(normalized);
        if (cached) return cached;
        // Non-precached navigation-like fallback for unknown paths.
        const offline = await cache.match(OFFLINE_URL);
        return offline || Response.error();
      }
    })()
  );
});
