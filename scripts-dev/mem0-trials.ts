/**
 * Extraction A/B trials — repeated live extraction of the exact note that
 * failed, measuring primary-extraction success rate. Receipts for the
 * MEM0_CUSTOM_INSTRUCTIONS fix (2026-10-23).
 *
 * Usage: bun scripts-dev/mem0-trials.ts [trials=6]
 */
import { rmSync, mkdirSync } from "node:fs";

const TRIALS = Number(process.argv[2] ?? 6);

rmSync("/tmp/mem0-trials", { recursive: true, force: true });
mkdirSync("/tmp/mem0-trials/db", { recursive: true });
mkdirSync("/tmp/mem0-trials/data", { recursive: true });

process.env.PI_SELFLEARNING_DB = "/tmp/mem0-trials/db/selflearning.db";
process.env.PI_SELFLEARNING_DATA = "/tmp/mem0-trials/data";
process.env.PI_BRIDGE_URL = "http://127.0.0.1:3031/v1";
process.env.PI_MODEL_ID = "agnes-3.0-flash";
process.env.PI_PROVIDER = "zai-bridge";

const memzero = await import("../pi-repo/packages/self-learning/src/memzero.ts");

// Track PRIMARY vs RETRY outcomes separately: patch the retry's store write
// marker via the metadata the platform stamps (extractionRetry: true).
const platform = await memzero.getMemoryPlatform();
console.log("[trials] platform ready — model:", process.env.PI_MODEL_ID);

const NOTES = {
  flaky: `watch out: bun test on this repo is flaky under parallel runners - use bun test --runInBand when results look wrong`,
  bench: `Run 62739174 (baseline) on task fix-drop-right: PASSED\nVerification: all tests passed\nTools used: 4 calls (read, edit, bash)\nAgent's final words: Fixed the off-by-one bug in \`dropRight.js\` — the slice end index was \`arr.length - n - 1\` instead of \`arr.length - n\`. All tests pass.`,
};

let primaryHits = 0;
let retryHits = 0;
let misses = 0;

for (let i = 1; i <= TRIALS; i++) {
  const scope = memzero.projectScope(`trials-run-${i}`);
  // Check what lands in the store per trial: primary events vs retry events
  const events = await platform.add([{ role: "user", content: NOTES.flaky }], scope, {
    kind: "terminal-note",
  });
  const all = await platform.getAll(scope);
  const retried = all.some((m: any) => m.metadata?.extractionRetry);
  if (events.length > 0 && !retried) {
    primaryHits++;
    console.log(`[trial ${i}] PRIMARY extracted (${events.length}): ${events[0]?.text.slice(0, 80)}`);
  } else if (events.length > 0) {
    retryHits++;
    console.log(`[trial ${i}] RETRY recovered (${events.length}): ${events[0]?.text.slice(0, 80)}`);
  } else {
    misses++;
    console.log(`[trial ${i}] MISS — 0 events (store holds ${all.length})`);
  }
}

console.log(`\n[trials] RESULT over ${TRIALS} trials: primary=${primaryHits} retry-recovered=${retryHits} miss=${misses}`);
