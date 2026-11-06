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
 *    public/offline.html is the fetch lane's fallback page — it does
 *    NOT ship until C-7 (the asset + the PWA lane). It is deliberately
 *    ABSENT from this list because `cache.add` REJECTS a non-2xx
 *    response and would fail the install; C-7 restores the entry in
 *    the same change that commits the file. The fetch handler's
 *    `cache.match("public/offline.html")` falls through honestly on
 *    the missing entry (match resolves to undefined → Response.error,
 *    never a throw), so the fallback reference stays as-is at C-5.
 *
 * 2. The module graph: index.html loads /src/ui/app.ts; serve.mjs
 *    transpiles TS on the fly (Bun.Transpiler, loader "tsx") and maps
 *    the `./x.js` import-specifier convention back to x.ts source —
 *    so the SERVED paths hold the .ts module URLs as the browser
 *    requests them (app.ts, artifact-viewer.ts, el.ts, empty.ts,
 *    palette.ts, recipe-editor.ts, run-history.ts, status.ts, plus the
 *    domain + storage modules app.ts imports: types.ts, ids.ts,
 *    invariants.ts, model.ts, io.ts, storage.ts, local-storage.ts). A
 *    static offline build (C-7/C-11) would transpile these to .js and
 *    this list would carry the .js paths — the served-form note lives
 *    here so the transpile ticket updates it deliberately, not silently.
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
  // "public/offline.html" — the C-7 asset; the entry is restored with
  // the file (a 404 here would reject cache.add and fail the install).
  "src/ui/chaconne.css",
  "src/ui/app.ts",
  "src/ui/artifact-viewer.ts",
  "src/ui/el.ts",
  "src/ui/empty.ts",
  "src/ui/palette.ts",
  "src/ui/recipe-editor.ts",
  "src/ui/run-history.ts",
  "src/ui/status.ts",
  "src/domain/types.ts",
  "src/domain/ids.ts",
  "src/domain/invariants.ts",
  "src/domain/model.ts",
  "src/domain/io.ts",
  "src/domain/storage.ts",
  "src/storage/local-storage.ts",
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
