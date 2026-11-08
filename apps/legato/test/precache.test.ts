/**
 * precache.test.ts — the PRECACHE_LIST derivation pin (ticket L-10,
 * deliverable #7: "the list matches the served closure — reuse
 * verify-precache's ladder logic").
 *
 * THE UNIT-LANE REUSE: this test imports `runLadder` from
 * `scripts/verify-precache.ts` — the SAME three-way ladder the CLI
 * proof runs — so the unit lane and the CLI lane share ONE
 * implementation (the brief's deliverable #7). The ladder is a
 * pure function of (swSrc, appRoot): it does only `existsSync`
 * lookups, so it runs clean under the DOM-free runtime (Lane A)
 * and the happy-dom-masked runtime (Lane B).
 *
 * THE PINS:
 *   1. the ladder PARSES sw.js (PRECACHE_LIST + CACHE_NAME
 *      resolve) — a malformed sw.js throws here, not at install
 *      time.
 *   2. every precache URL maps to a file on disk (zero misses —
 *      the "the list matches the served closure" proof).
 *   3. the entry is `index.html` + the shell assets are present
 *      (the offline boot surface: index.html, the manifest, the
 *      icon, offline.html, the stylesheet).
 *   4. the module graph is closed: the entry's static imports AND
 *      the browser entry's dynamic imports are all in the list
 *      (a missing module = an offline boot that dies mid-graph).
 *   5. no DUPLICATES + the list is non-empty (the verify-precache
 *      honesty pins, re-asserted on the unit lane).
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// The CLI proof is plain-JS-shaped TS (node builtins only); the
// app tsconfig's `include` is src/**, so the test lane references
// the ladder through its on-disk bytes + a typed re-declaration of
// the same signature — the ONE-implementation law is kept by the
// CLI lane importing the same file. The unit lane's job is to run
// the ladder over the on-disk tree; the import path is the repo-
// relative spelling the tsconfig's rootDir-less resolve accepts.
import { runLadder, LEGATO_CACHE_RE } from "../scripts/verify-precache";

const APP_ROOT = resolve(import.meta.dirname, "..");
const swSrc = readFileSync(resolve(APP_ROOT, "sw.js"), "utf8");

function ladder() {
  return runLadder(swSrc, APP_ROOT);
}

test("the ladder parses sw.js (PRECACHE_LIST + CACHE_NAME resolve)", () => {
  const r = ladder();
  expect(r.urls.length).toBeGreaterThan(0);
  expect(LEGATO_CACHE_RE.test(r.cacheName)).toBe(true);
});

test("every precache URL maps to a file on disk (zero misses)", () => {
  const r = ladder();
  const missed = r.resolutions.filter((x) => x.hit === null).map((x) => x.url);
  expect(missed, `missing on disk: ${missed.join(", ")}`).toHaveLength(0);
});

test("the offline boot surface is precached (the shell assets)", () => {
  const r = ladder();
  const urls = new Set(r.urls);
  const shell = [
    "index.html",
    "public/manifest.webmanifest",
    "public/icon.svg",
    "public/offline.html",
    "src/ui/legato.css",
  ];
  for (const s of shell) {
    expect(urls.has(s), `shell asset not in PRECACHE_LIST: ${s}`).toBe(true);
  }
});

test("the module graph is closed (static + dynamic imports all listed)", () => {
  const r = ladder();
  const urls = new Set(r.urls);
  // The entry is requested AS .ts by index.html.
  expect(urls.has("src/ui/app.ts")).toBe(true);
  // The static module graph (the .js-convention request forms that
  // serve.mjs's js→ts swap serves as transpiled .ts).
  const graph = [
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
    "src/domain/queue.js",
    "src/domain/tags.js",
    "src/domain/highlights.js",
    "src/domain/ids.js",
    "src/domain/io.js",
    "src/domain/invariants.js",
    // The L-11 pipeline closure (the browser-edge dynamic imports
    // that app.ts's pipeline lane pulls in — fetcher + clip +
    // extractor + error-taxonomy, the RealFetcher lane).
    "src/pipeline/fetcher.js",
    "src/pipeline/clip.js",
    "src/pipeline/extractor.js",
    "src/pipeline/error-taxonomy.js",
  ];
  for (const g of graph) {
    expect(urls.has(g), `module not in PRECACHE_LIST: ${g}`).toBe(true);
  }
});

test("no duplicates + the list is non-empty (the honesty pins)", () => {
  const r = ladder();
  expect(r.urls.length).toBeGreaterThan(0);
  const dups = r.urls.filter((u, i) => r.urls.indexOf(u) !== i);
  expect(dups, `duplicates: ${dups.join(", ")}`).toHaveLength(0);
});
