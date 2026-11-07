#!/usr/bin/env bun
/**
 * verify-precache.ts — Legato's precache derivation proof (ticket
 * L-10; the Coda C-7 lane, ported with the Ostinato mixed-entry-kind
 * twist). Parses PRECACHE_LIST + CACHE_NAME out of apps/legato/sw.js
 * and resolves every entry the way the on-disk tree does, over a
 * three-way ladder:
 *
 *   a. the exact file exists            → OK
 *   b. u + ".ts" exists                 → OK (extensionless entry)
 *   c. u ends in ".js" AND u with the ".js" replaced by ".ts"
 *      exists                             → OK (the serve.mjs js→ts swap:
 *                                           the compiled module graph
 *                                           requests the .js forms and
 *                                           the dev server serves them
 *                                           from the .ts sources)
 *   d. otherwise                        → MISS (printed + counted)
 *
 * Three honesty pins beyond Coda's (a miss is not the only way to
 * fail):
 *   - CACHE_NAME parses AND matches /^legato-v\d+$/ — the
 *     versioned-cache discipline; the activate handler's purge is
 *     keyed on the exact name, so a malformed name is a FAIL.
 *   - the list is non-empty and has no duplicate entries — a
 *     duplicate is a FAIL (double-precaching the same URL is
 *     drift, not coverage).
 *   - the final line prints "<N> precache URLs, <M> missing" so
 *     drift in either direction is visible in every run.
 *
 * The ladder + pins are EXPORTED (`runLadder`) so the app-side unit
 * pin can import the same logic — the unit lane and the CLI lane
 * share ONE implementation (the ostinato shape carries no export;
 * Legato's brief asks for the unit-side reuse, so the ladder is a
 * pure function of (swSrc, urls, appRoot)).
 *
 * Run: bun apps/legato/scripts/verify-precache.ts
 * Exit 0 = zero misses AND all three pins hold; 1 = a miss or a
 * failed pin (the reason is printed).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LEGATO_CACHE_RE = /^legato-v\d+$/;

export interface LadderResult {
  cacheName: string;
  urls: string[];
  /** per-URL resolution: the on-disk path that satisfies the ladder */
  resolutions: { url: string; hit: string | null }[];
  misses: number;
}

/**
 * The pure three-way ladder: parse PRECACHE_LIST + CACHE_NAME out of
 * swSrc and resolve every entry against the on-disk tree under
 * appRoot. No I/O beyond readFileSync by the caller — this function
 * itself does only existsSync lookups, so it is importable from the
 * unit lane and runnable under happy-dom.
 */
export function runLadder(swSrc: string, appRoot: string): LadderResult {
  // ── Parse PRECACHE_LIST (the Coda regex shape, verbatim) ────────
  const m = swSrc.match(/const PRECACHE_LIST = \[([\s\S]*?)\];/);
  if (!m) {
    throw new Error("PRECACHE_LIST not found in sw.js");
  }
  const urls = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);

  // ── Pin: CACHE_NAME parses + versioned-cache discipline ────────
  const cn = swSrc.match(/const CACHE_NAME = "([^"]*)"/);
  if (!cn || !LEGATO_CACHE_RE.test(cn[1])) {
    throw new Error(
      `CACHE_NAME pin — ` +
        (cn
          ? `parsed "${cn[1]}" but it does not match ${LEGATO_CACHE_RE}`
          : `no CACHE_NAME string found in sw.js`),
    );
  }

  // ── Pin: non-empty, no duplicates ───────────────────────────────
  if (urls.length === 0 || new Set(urls).size !== urls.length) {
    const dups =
      urls.length === 0
        ? "list is empty"
        : [...urls].filter((u, i) => urls.indexOf(u) !== i).join(", ");
    throw new Error(`list pin — ${dups}`);
  }

  // ── The three-way disk-resolution ladder ────────────────────────
  let misses = 0;
  const resolutions: LadderResult["resolutions"] = [];
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
    if (hit === null) misses++;
    resolutions.push({ url: u, hit });
  }

  return { cacheName: cn[1], urls, resolutions, misses };
}

// ── CLI lane ───────────────────────────────────────────────────────
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const swSrc = readFileSync(join(appRoot, "sw.js"), "utf8");

let result: LadderResult;
try {
  result = runLadder(swSrc, appRoot);
} catch (e) {
  console.error("FAIL: " + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
}

console.log(`PIN  CACHE_NAME = "${result.cacheName}" (matches ${LEGATO_CACHE_RE})`);
for (const { url, hit } of result.resolutions) {
  const ok = hit !== null;
  if (!ok) result.misses++;
  const shown = ok
    ? join("apps/legato", hit!.slice(appRoot.length + 1))
    : "<nothing on disk>";
  console.log(`${ok ? "OK  " : "MISS"}  ${url}  ->  ${shown}`);
}

console.log(`\n${result.urls.length} precache URLs, ${result.misses} missing`);
if (result.misses > 0) {
  console.error("FAIL: at least one precache URL has no on-disk file — offline would break");
  process.exit(1);
}
console.log("PASS: every precache URL maps to a file on disk");
