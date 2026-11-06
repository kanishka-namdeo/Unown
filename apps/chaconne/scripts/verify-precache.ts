#!/usr/bin/env bun
/**
 * verify-precache.ts — Chaconne's precache derivation proof (ticket C-7;
 * the Ostinato O-5 `verify-precache.ts` lane, ported with Chaconne's
 * C-5 derivation comment's twist: the list carries SERVED paths, and
 * serve.mjs's on-the-fly transpile makes the .ts source files the
 * disk truth behind the .ts module URLs).
 *
 * Parses PRECACHE_LIST + CACHE_NAME out of apps/chaconne/sw.js and
 * resolves every entry the way the on-disk tree does, over a
 * three-way ladder:
 *
 *   a. the exact file exists            → OK
 *   b. u + ".ts" exists                → OK (extensionless entry)
 *   c. u ends in ".js" AND u with the ".js" replaced by ".ts"
 *      exists                           → OK (the serve.mjs js→ts swap:
 *                                          a static build's .js forms
 *                                          resolve to the .ts sources)
 *   d. otherwise                        → MISS (printed + counted)
 *
 * Honesty pins:
 *   - CACHE_NAME parses AND matches /^chaconne-v\d+$/ — the
 *     versioned-cache discipline; the activate handler's purge is
 *     keyed on the exact name, so a malformed name is a FAIL.
 *   - the list is non-empty and has no duplicate entries — a
 *     duplicate is a FAIL (double-precaching the same URL is
 *     drift, not coverage).
 *   - every entry resolves to a real file on disk — the derivation
 *     the sw.js C-5 comment promised: the app.ts import closure may
 *     grow, and this proof fails loudly on drift (exit 1).
 *
 * Run: bun apps/chaconne/scripts/verify-precache.ts
 * Exit 0 = zero misses AND all pins hold; 1 = a miss or a failed
 * pin (the reason is printed).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const swSrc = readFileSync(join(appRoot, "sw.js"), "utf8");

// ── Parse PRECACHE_LIST (the Ostinato regex shape, verbatim) ─────
const m = swSrc.match(/const PRECACHE_LIST = \[([\s\S]*?)\];/);
if (!m) {
  console.error("FAIL: PRECACHE_LIST not found in sw.js");
  process.exit(1);
}
// The list's comment lines carry double-quoted path mentions
// ("public/offline.html" appears in a comment, not the list) — the
// Ostinato lane's regex picks up only the actual entries because the
// comments there carry no bare "..." tokens. Chaconne's comment is
// heavier: strip comment lines before extracting the entry strings.
const entrySource = m[1]
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");
const urls = [...entrySource.matchAll(/"([^"]+)"/g)].map((x) => x[1]);

// ── Pin: CACHE_NAME parses + versioned-cache discipline ─────────
const cn = swSrc.match(/const CACHE_NAME = "([^"]*)"/);
if (!cn || !/^chaconne-v\d+$/.test(cn[1])) {
  console.error(
    `FAIL: CACHE_NAME pin — ` +
      (cn ? `parsed "${cn[1]}" but it does not match /^chaconne-v\d+$/` : `no CACHE_NAME string found in sw.js`),
  );
  process.exit(1);
}
console.log(`PIN  CACHE_NAME = "${cn[1]}" (matches /^chaconne-v\d+$/)`);

// ── Pin: non-empty, no duplicates ───────────────────────────────
if (urls.length === 0 || new Set(urls).size !== urls.length) {
  const dups = urls.length === 0 ? "list is empty" : [...urls].filter((u, i) => urls.indexOf(u) !== i).join(", ");
  console.error(`FAIL: list pin — ${dups}`);
  process.exit(1);
}

// ── The three-way disk-resolution ladder ────────────────────────
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
    // c. the js→ts swap: a .js-convention request served from .ts
    hit = disk.slice(0, -".js".length) + ".ts";
  }
  const ok = hit !== null;
  if (!ok) misses++;
  const shown = ok ? join("apps/chaconne", hit!.slice(appRoot.length + 1)) : "<nothing on disk>";
  console.log(`${ok ? "OK  " : "MISS"}  ${u}  ->  ${shown}`);
}

console.log(`\n${urls.length} precache URLs, ${misses} missing`);
if (misses > 0) {
  console.error("FAIL: at least one precache URL has no on-disk file — offline would break");
  process.exit(1);
}
console.log("PASS: every precache URL maps to a file on disk");
