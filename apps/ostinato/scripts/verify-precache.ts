#!/usr/bin/env bun
/**
 * verify-precache.ts — Ostinato's precache derivation proof (ticket O-5,
 * chunk 1; the Coda C3 `verify-precache.ts` lane, ported with the
 * mixed-entry-kind twist). Parses PRECACHE_LIST + CACHE_NAME out of
 * apps/ostinato/sw.js and resolves every entry the way the on-disk
 * tree does, over a three-way ladder:
 *
 *   a. the exact file exists            → OK
 *   b. u + ".ts" exists                → OK (extensionless entry)
 *   c. u ends in ".js" AND u with the ".js" replaced by ".ts"
 *      exists                           → OK (the serve.mjs js→ts swap:
 *                                          the compiled module graph
 *                                          requests the .js forms and
 *                                          the dev server serves them
 *                                          from the .ts sources)
 *   d. otherwise                        → MISS (printed + counted)
 *
 * Three honesty pins beyond Coda's (a miss is not the only way to
 * fail):
 *   - CACHE_NAME parses AND matches /^ostinato-v\d+$/ — the
 *     versioned-cache discipline; the activate handler's purge is
 *     keyed on the exact name, so a malformed name is a FAIL.
 *   - the list is non-empty and has no duplicate entries — a
 *     duplicate is a FAIL (double-precaching the same URL is
 *     drift, not coverage).
 *   - the final line prints "<N> precache URLs, <M> missing" so
 *     drift in either direction is visible in every run.
 *
 * Run: bun apps/ostinato/scripts/verify-precache.ts
 * Exit 0 = zero misses AND all three pins hold; 1 = a miss or a
 * failed pin (the reason is printed).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const swSrc = readFileSync(join(appRoot, "sw.js"), "utf8");

// ── Parse PRECACHE_LIST (the Coda regex shape, verbatim) ──────────
const m = swSrc.match(/const PRECACHE_LIST = \[([\s\S]*?)\];/);
if (!m) {
  console.error("FAIL: PRECACHE_LIST not found in sw.js");
  process.exit(1);
}
const urls = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);

// ── Pin: CACHE_NAME parses + versioned-cache discipline ──────────
const cn = swSrc.match(/const CACHE_NAME = "([^"]*)"/);
if (!cn || !/^ostinato-v\d+$/.test(cn[1])) {
  console.error(
    `FAIL: CACHE_NAME pin — ` +
      (cn ? `parsed "${cn[1]}" but it does not match /^ostinato-v\d+$/` : `no CACHE_NAME string found in sw.js`)
  );
  process.exit(1);
}
console.log(`PIN  CACHE_NAME = "${cn[1]}" (matches /^ostinato-v\d+$/)`);

// ── Pin: non-empty, no duplicates ────────────────────────────────
if (urls.length === 0 || new Set(urls).size !== urls.length) {
  const dups = urls.length === 0 ? "list is empty" : [...urls].filter((u, i) => urls.indexOf(u) !== i).join(", ");
  console.error(`FAIL: list pin — ${dups}`);
  process.exit(1);
}

// ── The three-way disk-resolution ladder ─────────────────────────
let misses = 0;
for (const u of urls) {
  const disk = join(appRoot, u);
  let hit: string | null = null;
  if (existsSync(disk)) {
    // a. exact file
    hit = disk;
  } else if (existsSync(disk + ".ts")) {
    // b. extensionless entry → .ts
    hit = disk + ".ts";
  } else if (u.endsWith(".js") && existsSync(disk.slice(0, -".js".length) + ".ts")) {
    // c. the js→ts swap: the .js-convention request served from .ts
    hit = disk.slice(0, -".js".length) + ".ts";
  }
  const ok = hit !== null;
  if (!ok) misses++;
  const shown = ok ? join("apps/ostinato", hit!.slice(appRoot.length + 1)) : "<nothing on disk>";
  console.log(`${ok ? "OK  " : "MISS"}  ${u}  ->  ${shown}`);
}

console.log(`\n${urls.length} precache URLs, ${misses} missing`);
if (misses > 0) {
  console.error("FAIL: at least one precache URL has no on-disk file — offline would break");
  process.exit(1);
}
console.log("PASS: every precache URL maps to a file on disk");
