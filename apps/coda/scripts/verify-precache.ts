#!/usr/bin/env bun
/**
 * verify-precache.ts — the receipt's derivation proof (ticket C3, plan P1
 * offline-coverage fix). Parses PRECACHE_LIST out of sw.js, resolves each
 * entry the way the SW does (root-relative, against the app root), and
 * asserts every URL maps to a real on-disk file (extensionless -> .ts).
 *
 * Run: bun apps/coda/scripts/verify-precache.ts
 * Exit 0 = every precache URL lands on disk; 1 = a miss (broken offline).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const swSrc = readFileSync(join(appRoot, "sw.js"), "utf8");

const m = swSrc.match(/const PRECACHE_LIST = \[([\s\S]*?)\];/);
if (!m) {
  console.error("FAIL: PRECACHE_LIST not found in sw.js");
  process.exit(1);
}
const urls = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);

let fails = 0;
for (const u of urls) {
  // The SW treats every entry as app-root-relative; extensionless entries
  // are the transpiling server's .ts modules.
  const disk = join(appRoot, u);
  const candidates = existsSync(disk) ? [disk] : existsSync(disk + ".ts") ? [disk + ".ts"] : [];
  const ok = candidates.length > 0;
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "MISS"}  ${u}  ->  ${candidates[0] ? join("apps/coda", candidates[0].slice(appRoot.length + 1)) : "<nothing on disk>"}`);
}

console.log(`\n${urls.length} precache URLs, ${fails} missing`);
if (fails > 0) {
  console.error("FAIL: at least one precache URL has no on-disk file — offline would break");
  process.exit(1);
}
console.log("PASS: every precache URL maps to a file on disk");
