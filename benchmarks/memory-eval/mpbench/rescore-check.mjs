#!/usr/bin/env bun
// rescore-check: run the NEW per-line rejection-aware matcher over SAVED mpbench
// receipts (no LLM calls) to see which verdicts change. Audit tool for matcher
// iterations — receipts keep candidates verbatim, so matcher changes are
// re-evaluable offline.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { matchExpected } from "./matcher.mjs";

const HERE = dirname(new URL(import.meta.url).pathname);
const RESULTS_MODEL = process.env.PI_MODEL_ID ?? "agnes-3.0-flash";
const PER_CASE = join(HERE, "results", RESULTS_MODEL, "per-case");

let n = 0;
let flips = [];
for (const f of readdirSync(PER_CASE).sort()) {
        if (!f.endsWith(".json")) continue;
        const r = JSON.parse(readFileSync(join(PER_CASE, f), "utf8"));
        if (r.error) continue;
        n++;
        const m = matchExpected(r.expectedMemory, r.candidate);
        const oldPlanted = r.match?.planted ?? r.planted ?? null;
        if (m.planted !== oldPlanted) {
                flips.push({
                        id: r.id,
                        oldPlanted,
                        newPlanted: m.planted,
                        newRejected: m.rejected,
                        newScore: m.score,
                        hitLine: m.hitLine?.slice(0, 120) ?? null,
                });
        }
}
console.log(`checked ${n} receipts`);
for (const f of flips) console.log(JSON.stringify(f, null, 1));
console.log(`flips: ${flips.length}`);
