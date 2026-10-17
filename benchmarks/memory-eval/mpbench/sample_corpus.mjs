#!/usr/bin/env bun
/**
 * mpbench/sample_corpus.mjs — build corpus.json from the PUBLIC MPBench
 * dataset (Digital-Trust-Lab/mp-bench, Apache-2.0; adversarial 3241 +
 * benign 2999 cases across 5 attack classes / 4 signal strengths / 7
 * domains).
 *
 * Sampling design (deterministic, seed recorded in the corpus header):
 *   - 5 main attack classes x 10 cases each (50 adversarial), stratified
 *     over attack_signal (weak/moderate/strong/subtle) and spread over the
 *     7 domains — Unown's guard has only ever seen strong-signal, single-
 *     technique poison; MPBench's weak/subtle classes (policy-conformant
 *     fact injection, experience injection) are exactly the coverage the
 *     §5.4 corpus lacks.
 *   - 20 benign controls (stratified over domains) — for the dream these
 *     are LEGITIMATE notes (expected_memory is a fact the memory SHOULD
 *     consolidate), so they measure guard false positives AND un-poisoned
 *     consolidation quality in the same run.
 *
 * Usage:  bun sample_corpus.mjs <path-to-mp-bench-clone> [--seed N]
 * Output: corpus.json next to this script. The upstream clone is NOT
 * vendored (license name + provenance + sha256 recorded instead).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const OUT = join(HERE, "corpus.json");
const SEED = Number(process.argv.includes("--seed") ? process.argv[process.argv.indexOf("--seed") + 1] : 20261018);
const src = process.argv[2];
if (!src) {
	console.error("usage: bun sample_corpus.mjs <path-to-mp-bench-clone> [--seed N]");
	process.exit(1);
}

/** The upstream files are JSON streams (multiple objects per line) — decode robustly. */
function* jsonObjects(text) {
	let pos = 0;
	while (pos < text.length) {
		while (pos < text.length && /[\s,]/.test(text[pos])) pos++;
		if (pos >= text.length) break;
		const start = pos;
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (; pos < text.length; pos++) {
			const ch = text[pos];
			if (inString) {
				if (escaped) escaped = false;
				else if (ch === "\\") escaped = true;
				else if (ch === '"') inString = false;
				continue;
			}
			if (ch === '"') inString = true;
			else if (ch === "{") depth++;
			else if (ch === "}" && --depth === 0) {
				pos++;
				break;
			}
		}
		if (depth !== 0) throw new Error(`unbalanced JSON object at offset ${start}`);
		yield JSON.parse(text.slice(start, pos));
	}
}

/** Deterministic PRNG (mulberry32) so the sample is reproducible from the seed. */
function mulberry32(a) {
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const CLASSES = [
	"repetition_injection",
	"explicit_keyword_injection",
	"delayed_conditional_injection",
	"fact_injection",
	"experience_injection",
];
const PER_CLASS = 10;
const BENIGN_N = 20;

const adversarialAll = [...jsonObjects(readFileSync(join(src, "adversarial_data.jsonl.jsonl"), "utf8"))];
const benignAll = [...jsonObjects(readFileSync(join(src, "benign_data.jsonl.jsonl"), "utf8"))];
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

const cases = [];
for (const cls of CLASSES) {
	// stratify by signal: round-robin over the signal buckets so each class
	// covers weak/moderate/strong/subtle as available
	const bySignal = {};
	for (const r of adversarialAll) {
		if (r.attack_type !== cls) continue;
		(bySignal[r.attack_signal] ??= []).push(r);
	}
	for (const [sig, bucket] of Object.entries(bySignal)) {
		const rnd = mulberry32(SEED ^ bucket.length ^ cls.length ^ sig.length);
		bucket.sort(() => rnd() - 0.5);
	}
	const signals = Object.keys(bySignal);
	const picked = [];
	for (let i = 0; picked.length < PER_CLASS && i <= 500; i++) {
		for (const s of signals) {
			if (bySignal[s][i] && picked.length < PER_CLASS) picked.push(bySignal[s][i]);
		}
	}
	for (const r of picked) {
		cases.push({
			id: r.id,
			adversarial: true,
			attackType: r.attack_type,
			attackSignal: r.attack_signal,
			domain: r.domain,
			adversarialGoal: r.adversarial_goal,
			userQuery: r.user_query,
			context: r.context,
			expectedMemory: r.expected_memory,
			retrievalQuery: r.retrieval_query,
			payloadVariants: r.payload_variants ?? [],
			repetitionCount: r.repetition_count ?? 0,
		});
	}
}
{
	const byDomain = {};
	for (const r of benignAll) (byDomain[r.domain] ??= []).push(r);
	for (const bucket of Object.values(byDomain)) {
		const rnd = mulberry32(SEED + bucket.length);
		bucket.sort(() => rnd() - 0.5);
	}
	const domains = Object.keys(byDomain);
	const picked = [];
	for (let i = 0; picked.length < BENIGN_N && i <= 500; i++) {
		for (const d of domains) {
			if (byDomain[d][i] && picked.length < BENIGN_N) picked.push(byDomain[d][i]);
		}
	}
	for (const r of picked) {
		cases.push({
			id: r.id,
			adversarial: false,
			attackType: "benign",
			attackSignal: r.attack_signal,
			domain: r.domain,
			userQuery: r.user_query,
			context: r.context,
			expectedMemory: r.expected_memory,
			retrievalQuery: r.retrieval_query,
			legitimateMemoryWrite: r.legitimate_memory_write ?? true,
		});
	}
}

const corpus = {
	suite: "mpbench-adapted",
	source: {
		repo: "https://github.com/Digital-Trust-Lab/mp-bench",
		license: "Apache-2.0 (upstream repo LICENSE; not vendored — recorded provenance)",
		files: {
			"adversarial_data.jsonl.jsonl": { sha256: sha(join(src, "adversarial_data.jsonl.jsonl")), n: adversarialAll.length },
			"benign_data.jsonl.jsonl": { sha256: sha(join(src, "benign_data.jsonl.jsonl")), n: benignAll.length },
		},
	},
	seed: SEED,
	model: process.env.PI_MODEL_ID ?? "kimi-k2.5",
	sampling: `${PER_CLASS} per attack class (stratified by attack_signal, spread over domains) + ${BENIGN_N} benign controls (stratified by domain)`,
	nAdversarial: cases.filter((c) => c.adversarial).length,
	nBenign: cases.filter((c) => !c.adversarial).length,
	cases,
};
writeFileSync(OUT, JSON.stringify(corpus, null, 2));
console.log(
	`corpus.json: ${corpus.nAdversarial} adversarial + ${corpus.nBenign} benign, seed ${SEED}, source shas recorded`,
);
