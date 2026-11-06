/**
 * Chaconne — the offline service worker (C-3 SKELETON; C-6/C-7 complete
 * the precache list).
 *
 * Ostinato sw.js port: CACHE_NAME "chaconne-v0" + the C-5-completed
 * precache list — the full runtime closure the shell needs at offline
 * boot, enumerated below with its derivation. The fetch handler's
 * network-first + runtime cache belt + offline fallback lands as-is
 * (the Ostinato fetch lane, verbatim semantics).
 *
 * Ostinato contract preserved: `sw.js` lives at `apps/chaconne/`
 * (never under `public/`), classic (non-module) worker, plain ES2020,
 * no imports, never transpiled. `cache.add` REJECTS non-2xx, so a
 * wrong path fails install loudly.
 */

const CACHE_NAME = "chaconne-v0";

/*
 * C-5: the enumerated runtime closure — every static asset the shell
 * needs at boot, as SERVED paths. Derivation (the comment the ticket
 * demands):
 *
 * 1. The shell's static roots: index.html is the document root
 *    (serve.mjs maps "" → "index.html"); manifest.webmanifest and
 *    icon.svg live under public/ (index.html's <link> tags point at
 *    ./public/manifest.webmanifest + ./public/icon.svg); the CSS is
 *    src/ui/chaconne.css (index.html's <link rel=stylesheet>).
 *    public/offline.html is the fetch lane's fallback page (the C-7
 *    asset: the file + this PRECACHE_LIST entry landed in the same
 *    change — `cache.add` REJECTS a non-2xx response, so a missing
 *    file would fail the install; the entry is present because the
 *    file now exists). The fetch handler's `cache.match("public/offline.html")`
 *    falls back to it on any uncached miss.
 *
 * 2. The module graph: index.html loads /src/ui/app.ts (the entry is
 *    requested AS .ts — the script's src); serve.mjs transpiles it on
 *    the fly (Bun.Transpiler, loader "tsx") and the emitted import
 *    statements keep the `./x.js`-convention specifiers, so the browser
 *    requests the SUB-MODULES as the .js-convention URLs (artifact-viewer.js,
 *    el.js, …, types.js, ids.js, …). The Ostinato C-4/C-5 pattern is the
 *    proven one: the install precache's keys MUST match the browser's
 *    module-graph requests, else an offline reload falls through to
 *    offline.html for a JS module (the parse fails and the shell stalls
 *    on "Booting…"). So the entry stays the .ts URL index.html requests,
 *    and every sub-module is the .js-convention URL the transpiled
 *    entry's import statements request (the Ostinato O-4 lane, ported
 *    verbatim). A static offline build (C-7/C-11) would transpile to .js
 *    and the entry would become app.js — the served-form note lives here
 *    so the transpile ticket updates it deliberately, not silently.
 *
 * 3. What is NOT precached: sw.js itself (workers are never cached in
 *    their own cache), test/fixtures/** (the runner's local fixture
 *    lane, never part of the PWA shell), and the runner/ tree (Node
 *    only — the §4 ruling's PWA-closure exclusion).
 *
 * The list is exact at C-5 time; the app.ts import closure may grow —
 * C-6/C-7's verify-precache.ts proof re-derives it and fails loudly on
 * drift.
 */
const PRECACHE_LIST = [
  "index.html",
  "public/manifest.webmanifest",
  "public/icon.svg",
  "public/offline.html",
  "src/ui/chaconne.css",
  // The entry: index.html's script src requests it AS .ts.
  "src/ui/app.ts",
  // The sub-modules: the transpiled entry's import statements keep the
  // .js-convention specifiers, so the browser requests the .js forms —
  // the cache keys must match (the Ostinato O-4 offline-boot law).
  "src/ui/artifact-viewer.js",
  "src/ui/el.js",
  "src/ui/empty.js",
  "src/ui/focus-trap.js",
  "src/ui/palette.js",
  "src/ui/recipe-editor.js",
  "src/ui/run-history.js",
  "src/ui/status.js",
  "src/domain/types.js",
  "src/domain/ids.js",
  "src/domain/invariants.js",
  "src/domain/model.js",
  "src/domain/io.js",
  "src/domain/storage.js",
  "src/storage/local-storage.js",
];

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
