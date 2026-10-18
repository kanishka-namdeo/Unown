#!/usr/bin/env bun
/**
 * recall-qa/sample_corpus.mjs — build corpus.json from the PUBLIC
 * LongMemEval dataset (xiaowu0162/longmemeval, arXiv 2410.10813, MIT).
 *
 * Split used: `longmemeval_oracle` (500 questions, each with the
 * oracle-selected haystack sessions that contain the answer evidence —
 * exactly what a recall benchmark needs: no retrieval layer of our own in
 * front of the memory). Download WITHOUT a HF token:
 *
 *   curl -sL -o /tmp/longmemeval_oracle \
 *     "https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main/longmemeval_oracle"
 *
 * Sampling design (deterministic, seed recorded in the corpus header):
 *   - exclude `*_abs` questions (LongMemEval's "answer: information not
 *     enough" negative cases — a different benchmark) and questions with
 *     more than 3 haystack sessions (the pipeline maps 1 session -> 1
 *     session note, budget 1-3 notes per case).
 *   - stratified over the real question_type field, oversampling the two
 *     memory-hard types as instructed: temporal-reasoning 10,
 *     knowledge-update 10, multi-session 10, single-session-user 4,
 *     single-session-assistant 3, single-session-preference 3 (n=40).
 *   - turn content capped at sampling time: 3200 chars for evidence turns
 *     (has_answer=true), 600 for filler (the runner fits each note into the
 *     ~4000-char note budget; evidence is never cut before filler).
 *
 * Usage:  bun sample_corpus.mjs <path-to-longmemeval_oracle> [--seed N]
 * Output: corpus.json next to this script. Upstream file NOT vendored
 * (sha256 + counts recorded as provenance).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const OUT = join(HERE, "corpus.json");
const SEED = Number(
	process.argv.includes("--seed") ? process.argv[process.argv.indexOf("--seed") + 1] : 20261019,
);
const src = process.argv[2];
if (!src) {
	console.error("usage: bun sample_corpus.mjs <path-to-longmemeval_oracle> [--seed N]");
	process.exit(1);
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

/** "2023/04/10 (Mon) 17:50" -> epoch ms (UTC components, TZ-independent). */
function parseLmDate(s) {
	const m = String(s).match(/^(\d{4})\/(\d{2})\/(\d{2})\s+\([^)]+\)\s+(\d{2}):(\d{2})$/);
	if (!m) throw new Error(`unparseable LongMemEval date: ${JSON.stringify(s)}`);
	return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

/** Stratified allocation over the real question_type field (n=40). */
const PER_TYPE = {
	"temporal-reasoning": 10, // oversampled (memory-hard: ordering across sessions)
	"knowledge-update": 10, // oversampled (memory-hard: superseded facts)
	"multi-session": 10, // evidence spans sessions — the consolidation core case
	"single-session-user": 4,
	"single-session-assistant": 3,
	"single-session-preference": 3,
};
const EVIDENCE_CAP = 3200; // has_answer turns: full evidence, hard cap only
const FILLER_CAP = 600; // other turns: context filler
const MAX_SESSIONS = 3; // 1 session -> 1 session note (pipeline budget: 1-3 notes)

const all = JSON.parse(readFileSync(src, "utf8"));
if (!Array.isArray(all)) throw new Error("expected a JSON array of questions");

/** Sampling pool: positive-answer cases with 1-3 oracle sessions. */
const pool = all.filter(
	(q) => !String(q.question_id).endsWith("_abs") && q.haystack_sessions.length >= 1 && q.haystack_sessions.length <= MAX_SESSIONS,
);
const sha = createHash("sha256").update(readFileSync(src)).digest("hex");

const cases = [];
const typeCoverage = {};
for (const [type, want] of Object.entries(PER_TYPE)) {
	const bucket = pool.filter((q) => q.question_type === type);
	typeCoverage[type] = { pool: bucket.length, sampled: Math.min(want, bucket.length) };
	const rnd = mulberry32(SEED ^ type.length ^ want);
	bucket.sort(() => rnd() - 0.5);
	for (const q of bucket.slice(0, want)) {
		// sessions in chronological order (the runner feeds notes newest-first,
		// mirroring undreamedNotes(); chronology rides on the note timestamps)
		const sessions = q.haystack_sessions
			.map((turns, i) => ({ turns, date: q.haystack_dates[i], sessionId: q.haystack_session_ids[i] }))
			.sort((a, b) => parseLmDate(a.date) - parseLmDate(b.date))
			.map((s) => ({
				date: s.date,
				dateMs: parseLmDate(s.date),
				sessionId: s.sessionId,
				turns: s.turns.map((t) => ({
					role: t.role === "assistant" ? "assistant" : "user",
					content: String(t.content ?? "").slice(0, t.has_answer ? EVIDENCE_CAP : FILLER_CAP),
					hasAnswer: t.has_answer === true,
				})),
			}));
		cases.push({
			id: String(q.question_id),
			questionType: q.question_type,
			question: String(q.question ?? ""),
			answer: String(q.answer ?? ""),
			questionDate: q.question_date,
			sessions,
		});
	}
}

const corpus = {
	suite: "recall-qa-longmemeval",
	source: {
		repo: "https://huggingface.co/datasets/xiaowu0162/longmemeval",
		paper: "arXiv 2410.10813 (LongMemEval)",
		split: "longmemeval_oracle (500 questions with oracle-selected haystack sessions)",
		url: "https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main/longmemeval_oracle",
		license: "MIT (dataset card)",
		sha256: sha,
		nTotal: all.length,
		negativeExcluded: "*_abs questions (answer: 'information not enough') — a different task",
		deprecatedNote:
			"upstream marks this dataset deprecated in favor of longmemeval-cleaned; the original (as named in the task) still downloads fine and is used here",
		turnCaps: {
			evidenceTurnChars: EVIDENCE_CAP,
			fillerTurnChars: FILLER_CAP,
		},
	},
	seed: SEED,
	model: process.env.PI_MODEL_ID ?? "kimi-k2.5",
	sampling:
		"stratified over question_type (oversampled temporal-reasoning + knowledge-update), seeded shuffle per type, sessions<=3, *_abs excluded",
	typeCoverage,
	n: cases.length,
	cases,
};
writeFileSync(OUT, JSON.stringify(corpus, null, 2));
const byType = {};
for (const c of cases) byType[c.questionType] = (byType[c.questionType] ?? 0) + 1;
console.log(
	`corpus.json: ${cases.length} questions (${JSON.stringify(byType)}), seed ${SEED}, source sha256 ${sha.slice(0, 16)}…`,
);
