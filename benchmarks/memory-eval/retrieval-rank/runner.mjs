#!/usr/bin/env bun
/**
 * retrieval-rank/runner.mjs — search-ranking quality benchmark for the memory
 * platform itself (the retrieval layer recall-qa deliberately bypasses: recall-qa
 * injects the rendered memory as a system message and never scores the
 * platform's own search).
 *
 * NO LLM ANYWHERE: the 28 corpus facts are seeded VERBATIM into an isolated mem0
 * scope through the production seeding path (importLegacyMarkdown of a rendered
 * bullet list, one "- " bullet per fact, kind "seed", infer:false), the 22
 * queries run against platform.search, and every metric is computed from the
 * returned ranking. The whole suite is deterministic given the embedder — no
 * bridge, no extraction, no reconcile, no judge — so it measures the EMBEDDER +
 * ranking path in isolation (mem0's hybrid scoreAndRank: cosine + BM25 + entity
 * boost, threshold-filtered).
 *
 * Methodology (corpus.json storyline):
 *   - LongMemEval's turn-level recall@k with gold evidence labels (arXiv
 *     2410.10813): per query, recall@3/5/10 (any gold fact in the top-k) + MRR
 *     (1/rank of the first gold hit; 0 when no gold fact makes the top-10).
 *   - Zep's needle-in-timeline conflict probe (arXiv 2501.13956): conflict
 *     queries carry both sides — gold = the CURRENT fact, conflictGold = the
 *     superseded one; conflictPreference = rank(new) < rank(old), with
 *     ties/absent outcomes recorded (see README for the no-distinct-timestamps
 *     caveat: both sides are seeded in ONE import, so this measures the pure
 *     text/ranking preference, not recency-weighted retrieval).
 *   - Cross-scope isolation (Mem0 #5439 / Graphiti #2065/#2066): the foreign
 *     scope (aurora-billing) holds its own facts, including a deliberately
 *     gateway-adjacent one; leak probes assert the foreign ids NEVER surface in
 *     a MAIN-scope top-10, structural checks assert getAll never crosses scopes,
 *     and a searchAcrossScopes port query must return results TAGGED with their
 *     source scope (scopeTags presence).
 *   - H10 (local-embedder recall parity, benchmarks/local-llm + nonllm/N1): two
 *     embedder arms — the default (whatever PI_MEM0_EMBEDDER resolves to; auto
 *     falls back to lexical when the local-ml lane is absent) and --embedder
 *     onnx (bge-small-en-v1.5). An onnx arm whose platform cannot come up
 *     records embedderFallback:true and completes on the lexical lane instead
 *     of failing (the honest receipt, never a hidden gap).
 *
 * The suite's "model" is the EMBEDDER BACKEND LABEL (lexical / onnx /
 * onnx-fallback), not an LLM: results are model-scoped by that label exactly the
 * way quality-axes scopes by PI_MODEL_ID (a different-label run writes
 * results/<label>/ instead of clobbering the committed receipts). PI_MODEL_ID is
 * recorded for provenance only — it never influences a call. The onnx arm keeps
 * its own scratch root so the two vector spaces never churn through the
 * boot-time reindex pass.
 *
 * Hard pass criteria (the platform contracts, asserted in EVERY run incl. --dry):
 *   1. seeding integrity — every fact imports as exactly one memory (28 main +
 *      4 foreign) with a 1:1 fact-id -> memory-id text map (idMap in receipts);
 *   2. scope isolation — leak probes clean, getAll never crosses scopes,
 *      cross-scope search results carry their scope tag;
 *   3. every query executes (a search error is a failure).
 * recall@k / MRR / conflictPreference are MEASUREMENTS, not gates — the receipts
 * are the point (RESULTS.md is hand-written from them, per the repo convention).
 *
 * Resume-safe: a query with an existing ERROR-FREE receipt (same embedder
 * backend, no fallback) is skipped unless --fresh; both scopes are wiped +
 * reseeded at the start of every run (fresh memory ids each seed — ranks, not
 * ids, are the stable artifact). Partial runs (--case / --limit) write per-query
 * receipts but never touch results/summary.json (only a full run completes the
 * suite). --dry is the full run minus the receipt writes — deterministic anyway,
 * so its numbers are real.
 *
 * Usage: bun runner.mjs [--dry] [--fresh] [--limit N] [--case <query-id>]
 *                       [--embedder onnx|lexical]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const CORPUS_PATH = join(HERE, "corpus.json");
const CORPUS_RAW = readFileSync(CORPUS_PATH);
const CORPUS_SHA256 = createHash("sha256").update(CORPUS_RAW).digest("hex");
const corpus = JSON.parse(String(CORPUS_RAW));

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const argAfter = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined);
const DRY = process.argv.includes("--dry");
const FRESH = process.argv.includes("--fresh");
const EMBEDDER_OPT = argAfter("--embedder"); // "onnx" | "lexical" — the embedder arm
const LIMIT_RAW = argAfter("--limit");
const CASE = argAfter("--case");

const KNOWN_KINDS = new Set(["exact", "paraphrase", "time-qualified", "conflict", "distractor"]);

if (EMBEDDER_OPT !== undefined && EMBEDDER_OPT !== "onnx" && EMBEDDER_OPT !== "lexical") {
	console.error(`unknown --embedder '${EMBEDDER_OPT}' (expected: onnx | lexical)`);
	process.exit(2);
}
const ONNX_ARM = EMBEDDER_OPT === "onnx";
const LIMIT = LIMIT_RAW !== undefined ? Number(LIMIT_RAW) : Infinity;
if (LIMIT_RAW !== undefined && (!Number.isFinite(LIMIT) || LIMIT < 1)) {
	console.error(`bad --limit '${LIMIT_RAW}' (expected a positive integer)`);
	process.exit(2);
}

// ---------------------------------------------------------------------------
// Scratch env BEFORE importing the package (the store proxy opens SQLite at
// first use; the platform reads PI_MEM0_DIR at build). The onnx arm gets its own
// root so the two arms' vector spaces stay independent (no boot-time reindex
// churn between arms — each records its own embedder_backend in its own store).
// ---------------------------------------------------------------------------
const SCRATCH_ROOT = ONNX_ARM ? "/home/z/my-project/scratch-mem/retrieval-rank-onnx" : "/home/z/my-project/scratch-mem/retrieval-rank";
process.env.PI_SELFLEARNING_DATA ??= join(SCRATCH_ROOT, "data");
process.env.PI_SELFLEARNING_DB ??= join(SCRATCH_ROOT, "db", "retrieval-rank.db");
process.env.PI_MEM0_DIR ??= join(SCRATCH_ROOT, "mem0");
// --dry forces the deterministic lexical embedder — UNLESS an explicit
// --embedder arm was requested: the onnx arm is itself LLM-free and
// deterministic, so a dry onnx run is still an honest full smoke of that arm.
if (DRY && !EMBEDDER_OPT) process.env.PI_MEM0_EMBEDDER = "lexical";
if (EMBEDDER_OPT) process.env.PI_MEM0_EMBEDDER = EMBEDDER_OPT;
process.env.PI_MODEL_ID ??= "agnes-3.0-flash"; // provenance only — this suite never calls an LLM
process.env.PI_PROVIDER ??= "zai-bridge";
const EMBEDDER_ENV_REQUESTED = process.env.PI_MEM0_EMBEDDER ?? "auto"; // what the first boot attempt sees

const { getMemoryPlatform, searchAcrossScopes } = await import("../../../pi-repo/packages/self-learning/src/memzero.ts");
const { projectScope, seedScope, wipeScope, platformInfo } = await import("../_lib/dream-pipeline.mjs");

// Receipt hygiene: production error strings embed the clone's absolute path
// (e.g. the local-ml lane's loader message). Receipts stay machine-independent —
// the clone root is redacted to <pi-repo>/; the documented scratch roots stay
// verbatim (/home/z/my-project/scratch-mem/... is the cross-suite convention).
const redactCloneRoot = (s) =>
	String(s)
		.split("/home/z/my-project/Unown/pi-repo")
		.join("<pi-repo>")
		.split("/home/z/my-project/Unown")
		.join("<unown>");

// ---------------------------------------------------------------------------
// Platform boot + embedder arm resolution
// ---------------------------------------------------------------------------
let platform = null;
let embedderFallback = false;
let embedderBootError = null;
try {
	platform = await getMemoryPlatform();
} catch (err) {
	if (ONNX_ARM) {
		// The onnx arm must NOT fail the run when the local-ml lane is absent:
		// record the fallback honestly (embedderFallback:true in every receipt)
		// and re-boot on the lexical lane. The failed-init retry contract in
		// getMemoryPlatform resets the singleton, so the re-boot rebuilds with
		// the env we just flipped.
		embedderFallback = true;
		embedderBootError = redactCloneRoot(String(err?.message ?? err));
		process.env.PI_MEM0_EMBEDDER = "lexical";
		platform = await getMemoryPlatform();
	} else {
		throw err;
	}
}
const BACKEND = String(platform.backend ?? "unknown"); // "lexical" | "onnx"
const ARM = ONNX_ARM ? "onnx-arm" : "default";
const AUTO_DEGRADED = EMBEDDER_ENV_REQUESTED === "auto" && BACKEND !== "onnx";

// Model-scoped results, quality-axes pattern — but this suite's "model" is the
// EMBEDDER LABEL (no LLM is ever called): a run whose label differs from the one
// recorded in the legacy results/summary.json writes to results/<label>/ instead
// of clobbering. A fallback onnx run (requested onnx, ran lexical) labels itself
// "onnx-fallback" so it never passes itself off as an honest lexical run.
const MODEL_LABEL = embedderFallback ? "onnx-fallback" : BACKEND;
let legacyModel = MODEL_LABEL;
try {
	legacyModel = JSON.parse(readFileSync(join(HERE, "results", "summary.json"), "utf8")).model ?? MODEL_LABEL;
} catch { /* no legacy summary yet — the first run defines the layout */ }
const RESULTS = MODEL_LABEL !== legacyModel ? join(HERE, "results", MODEL_LABEL) : join(HERE, "results");
const PER_CASE = join(RESULTS, "per-case");
if (!DRY) {
	// --fresh clears THIS arm's per-query receipts only (recall-qa's pattern): a
	// fresh lexical run must not nuke the sibling results/<other-label>/ dirs that
	// share the base layout. The summary is overwritten by a full run anyway.
	if (FRESH) rmSync(PER_CASE, { recursive: true, force: true });
	mkdirSync(PER_CASE, { recursive: true });
}

// ---------------------------------------------------------------------------
// Corpus validation + case selection
// ---------------------------------------------------------------------------
const ALL_QUERIES = corpus.queries ?? [];
const validation = [];
const factIds = new Set((corpus.facts ?? []).map((f) => f.id));
if (factIds.size !== (corpus.facts ?? []).length) validation.push("duplicate fact ids in corpus.facts");
const foreignFacts = corpus.foreignScope?.facts ?? [];
const foreignIds = new Set(foreignFacts.map((f) => f.id));
for (const f of [...(corpus.facts ?? []), ...foreignFacts]) if (!f.id || !f.text) validation.push(`fact without id/text: ${JSON.stringify(f).slice(0, 80)}`);
const queryIds = new Set();
for (const q of ALL_QUERIES) {
	if (!q.id || !q.q) validation.push(`query without id/q: ${JSON.stringify(q).slice(0, 80)}`);
	if (queryIds.has(q.id)) validation.push(`duplicate query id ${q.id}`);
	queryIds.add(q.id);
	if (!KNOWN_KINDS.has(q.kind)) validation.push(`query ${q.id}: unknown kind '${q.kind}'`);
	for (const g of q.gold ?? []) if (!factIds.has(g)) validation.push(`query ${q.id}: gold '${g}' is not a corpus fact id`);
	for (const g of q.conflictGold ?? []) if (!factIds.has(g)) validation.push(`query ${q.id}: conflictGold '${g}' is not a corpus fact id`);
}
for (const p of corpus.foreignScope?.leakProbes ?? []) {
	if (!p.q || !Array.isArray(p.mustNotReturn)) validation.push(`leak probe without q/mustNotReturn: ${JSON.stringify(p).slice(0, 80)}`);
	for (const m of p.mustNotReturn ?? []) if (!foreignIds.has(m)) validation.push(`leak probe '${String(p.q).slice(0, 30)}': mustNotReturn '${m}' is not a foreign fact id`);
}
if (validation.length) {
	console.error(`corpus validation failed (${validation.length} problem(s)):`);
	for (const v of validation) console.error(`  - ${v}`);
	process.exit(2);
}
if (CASE !== undefined && !queryIds.has(CASE)) {
	console.error(`--case '${CASE}' is not a query id (corpus has ${ALL_QUERIES.length}: ${[...queryIds].slice(0, 5).join(", ")}, ...)`);
	process.exit(2);
}
const SELECTED = CASE !== undefined ? ALL_QUERIES.filter((q) => q.id === CASE) : ALL_QUERIES.slice(0, Math.min(LIMIT, ALL_QUERIES.length));
const FULL_RUN = SELECTED.length === ALL_QUERIES.length; // only a full run writes summary.json

// ---------------------------------------------------------------------------
// Seeding (production path: importLegacyMarkdown over a rendered bullet list)
// ---------------------------------------------------------------------------
const MAIN = projectScope("rr-main");
const FOREIGN = projectScope("rr-foreign");
const FOREIGN_LABEL = String(corpus.foreignScope?.id ?? "foreign"); // "aurora-billing" — the cross-scope search tag
const CROSS_SCOPE_QUERY = "What is the default listen port?"; // the port query both scopes can answer

const normalizeText = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const bulletsOf = (facts) => facts.map((f) => `- ${f.text}`).join("\n");

/**
 * Wipe a scope, seed it with the corpus facts as one rendered bullet list
 * (kind "seed", verbatim infer:false — exactly production seeding), then map
 * every fact id to its memory id by text matching. The map and the counts are
 * the seeding-integrity receipt.
 */
async function seedAndMap(scope, facts) {
	const wiped = await wipeScope(scope);
	const imported = await seedScope(scope, bulletsOf(facts));
	const memories = await platform.getAll(scope);
	const byFact = {};
	for (const f of facts) byFact[f.id] = memories.filter((m) => normalizeText(m.text) === normalizeText(f.text)).map((m) => m.id);
	const memToFact = new Map();
	for (const m of memories) {
		const hit = facts.find((f) => normalizeText(f.text) === normalizeText(m.text));
		memToFact.set(m.id, hit ? hit.id : null);
	}
	return { wiped, imported, memories, byFact, memToFact };
}

console.log(`[retrieval-rank] arm=${ARM} embedder=${BACKEND} (requested ${EMBEDDER_ENV_REQUESTED}${embedderFallback ? ", FALLBACK after boot error" : ""}${AUTO_DEGRADED ? ", auto degraded to lexical (local-ml absent)" : ""}) — NO LLM anywhere: verbatim infer:false seeding + platform.search only`);
console.log(`[scratch] ${SCRATCH_ROOT} (PI_MEM0_DIR=${process.env.PI_MEM0_DIR})`);

const failures = [];
const t0 = Date.now();
let skipCount = 0;

const mainSeed = await seedAndMap(MAIN, corpus.facts);
const foreignSeed = await seedAndMap(FOREIGN, foreignFacts);
const seedIntegrity = {
	main: {
		scope: MAIN.agentId,
		wiped: mainSeed.wiped,
		importedBullets: mainSeed.imported,
		memoryCount: mainSeed.memories.length,
		factCount: corpus.facts.length,
	},
	foreign: {
		scope: FOREIGN.agentId,
		label: FOREIGN_LABEL,
		wiped: foreignSeed.wiped,
		importedBullets: foreignSeed.imported,
		memoryCount: foreignSeed.memories.length,
		factCount: foreignFacts.length,
	},
};
for (const [tag, seed, facts] of [
	["rr-main", mainSeed, corpus.facts],
	["rr-foreign", foreignSeed, foreignFacts],
]) {
	if (seed.imported !== facts.length) failures.push(`seed ${tag}: importLegacyMarkdown imported ${seed.imported}/${facts.length} bullets`);
	if (seed.memories.length !== facts.length) failures.push(`seed ${tag}: getAll returned ${seed.memories.length}/${facts.length} memories`);
	const unmapped = facts.filter((f) => (seed.byFact[f.id] ?? []).length !== 1);
	if (unmapped.length) failures.push(`seed ${tag}: ${unmapped.length} fact(s) without a 1:1 memory map (${unmapped.map((f) => f.id).slice(0, 5).join(", ")})`);
	const stray = seed.memories.filter((m) => !seed.memToFact.get(m.id));
	if (stray.length) failures.push(`seed ${tag}: ${stray.length} memory(ies) matched no corpus fact`);
}
console.log(
	`[seed] rr-main: wiped=${mainSeed.wiped} imported=${mainSeed.imported} getAll=${mainSeed.memories.length} idMap=${Object.values(mainSeed.byFact).filter((v) => v.length === 1).length}/${corpus.facts.length}  |  rr-foreign: wiped=${foreignSeed.wiped} imported=${foreignSeed.imported} getAll=${foreignSeed.memories.length}`,
);
seedIntegrity.idMap = Object.fromEntries(Object.entries(mainSeed.byFact).map(([fid, ids]) => [fid, ids[0] ?? null]));
seedIntegrity.foreignIdMap = Object.fromEntries(Object.entries(foreignSeed.byFact).map(([fid, ids]) => [fid, ids[0] ?? null]));
seedIntegrity.pass = !failures.some((f) => f.startsWith("seed "));
if (!seedIntegrity.pass) {
	// without a complete idMap the ranking metrics have no gold to rank — abort
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}

// ---------------------------------------------------------------------------
// Ranking metrics (pure — exported for potential selftests)
// ---------------------------------------------------------------------------
/** 1-based rank of a fact id in a ranked result row list, null when absent. */
function rankOfFact(rows, factId) {
	const hit = rows.find((r) => r.factId === factId);
	return hit ? hit.rank : null;
}

/** recall@k: any gold fact within the top-k of the ranked rows. */
function recallAtK(rows, gold, k) {
	return rows.some((r) => r.factId !== null && gold.includes(r.factId) && r.rank <= k);
}

/**
 * Conflict preference (Zep needle-in-timeline probe): gold = the NEW side,
 * conflictGold = the OLD side. Outcome vocabulary: new-first | old-first | tie
 * (kept for safety — ranks are unique per row) | new-only (old side absent from
 * the top-10: the strongest preference) | old-only | neither. preference === true
 * only for new-first / new-only.
 */
function conflictOutcome(rankNew, rankOld) {
	if (rankNew !== null && rankOld !== null) {
		if (rankNew < rankOld) return { outcome: "new-first", preference: true };
		if (rankNew > rankOld) return { outcome: "old-first", preference: false };
		return { outcome: "tie", preference: false };
	}
	if (rankNew !== null) return { outcome: "new-only", preference: true };
	if (rankOld !== null) return { outcome: "old-only", preference: false };
	return { outcome: "neither", preference: false };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round4 = (x) => (x === null || x === undefined ? null : Number(x.toFixed(4)));

// ---------------------------------------------------------------------------
// Per-query run (resume-safe)
// ---------------------------------------------------------------------------
const EMBEDDER_RECEIPT = {
	arm: ARM,
	requested: EMBEDDER_ENV_REQUESTED,
	backend: BACKEND,
	embedderFallback,
	autoDegraded: AUTO_DEGRADED,
	...(embedderBootError ? { embedderBootError } : {}),
};

async function runQuery(q, idx) {
	const receiptPath = join(PER_CASE, `${q.id}.json`);
	if (!DRY && !FRESH && existsSync(receiptPath)) {
		const prev = JSON.parse(readFileSync(receiptPath, "utf8"));
		if (prev && prev.error == null && Array.isArray(prev.results) && prev.embedder?.backend === BACKEND && !prev.embedder?.embedderFallback) {
			console.log(`[skip] ${q.id} (receipt exists, no error)`);
			skipCount++;
			return prev;
		}
		console.log(`[rerun] ${q.id} (previous receipt errored or was written by another embedder arm)`);
	}
	const started = Date.now();
	let error = null;
	let results = [];
	try {
		results = await platform.search(q.q, MAIN, 10);
	} catch (err) {
		error = String(err?.message ?? err);
	}
	const rows = results.map((m, i) => ({
		rank: i + 1,
		memoryId: m.id,
		factId: mainSeed.memToFact.get(m.id) ?? null,
		score: typeof m.score === "number" ? round4(m.score) : null,
		text: m.text,
	}));
	const goldRanks = {};
	for (const g of q.gold) goldRanks[g] = rankOfFact(rows, g);
	const firstGoldRank = q.gold.map((g) => goldRanks[g]).filter((r) => r !== null).sort((a, b) => a - b)[0] ?? null;
	const receipt = {
		suite: "retrieval-rank",
		id: q.id,
		kind: q.kind,
		q: q.q,
		gold: q.gold,
		...(q.conflictGold ? { conflictGold: q.conflictGold } : {}),
		embedder: EMBEDDER_RECEIPT,
		date: new Date().toISOString(),
		durationMs: Date.now() - started,
		results: rows,
		goldRanks,
		firstGoldRank,
		recall: {
			at3: recallAtK(rows, q.gold, 3),
			at5: recallAtK(rows, q.gold, 5),
			at10: recallAtK(rows, q.gold, 10),
		},
		mrr: firstGoldRank !== null ? round4(1 / firstGoldRank) : 0,
		...(q.conflictGold
			? (() => {
					const rankOld = q.conflictGold.map((g) => rankOfFact(rows, g)).filter((r) => r !== null).sort((a, b) => a - b)[0] ?? null;
					const c = conflictOutcome(firstGoldRank, rankOld);
					return { conflict: { newSide: q.gold, oldSide: q.conflictGold, rankNew: firstGoldRank, rankOld, outcome: c.outcome, preference: c.preference } };
				})()
			: {}),
		error,
	};
	if (error) failures.push(`${q.id}: search error: ${redactCloneRoot(error)}`);
	else if (results.length === 0) console.log(`  (note) ${q.id}: platform.search returned 0 results (below mem0's 0.1 semantic threshold) — recorded as measured, not a failure`);
	if (!DRY) writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
	const top1 = rows[0];
	console.log(
		`[q ${idx + 1}/${SELECTED.length}] ${q.id.padEnd(20)} ${q.kind.padEnd(14)} r@3=${receipt.recall.at3 ? "Y" : "n"} r@5=${receipt.recall.at5 ? "Y" : "n"} r@10=${receipt.recall.at10 ? "Y" : "n"} rank=${firstGoldRank ?? "-"} mrr=${receipt.mrr ?? 0}${receipt.conflict ? ` pref=${receipt.conflict.outcome}` : ""} top1=${top1 ? `${top1.factId ?? "?"}(${top1.score ?? "?"})` : "none"}`,
	);
	return receipt;
}

// ---------------------------------------------------------------------------
// Foreign-scope isolation checks
// ---------------------------------------------------------------------------
async function runIsolation() {
	// 1. leak probes: a MAIN-scope search must never surface the foreign facts
	const leakProbes = [];
	for (const probe of corpus.foreignScope.leakProbes) {
		const res = await platform.search(probe.q, MAIN, 10);
		const rows = res.map((m, i) => ({
			rank: i + 1,
			memoryId: m.id,
			factId: mainSeed.memToFact.get(m.id) ?? null,
			score: typeof m.score === "number" ? round4(m.score) : null,
			text: m.text,
		}));
		const present = probe.mustNotReturn.filter((fid) => {
			const memIds = foreignSeed.byFact[fid] ?? [];
			const text = normalizeText(foreignFacts.find((f) => f.id === fid)?.text);
			return rows.some((r) => memIds.includes(r.memoryId) || normalizeText(r.text) === text);
		});
		if (present.length) failures.push(`leak probe '${probe.q}': foreign fact(s) ${present.join(", ")} surfaced in the MAIN-scope top-10`);
		leakProbes.push({
			q: probe.q,
			desc: probe.desc,
			mustNotReturn: probe.mustNotReturn,
			present,
			pass: present.length === 0,
			top10FactIds: rows.map((r) => r.factId),
		});
	}

	// 2. structural: getAll never crosses scopes (verbatim-text equality — every
	// memory IS a corpus fact, so equality is the exact containment test)
	const mainTexts = new Set(mainSeed.memories.map((m) => normalizeText(m.text)));
	const foreignTexts = new Set(foreignSeed.memories.map((m) => normalizeText(m.text)));
	const mainContainsForeign = foreignFacts.filter((f) => mainTexts.has(normalizeText(f.text))).map((f) => f.id);
	const foreignContainsMain = corpus.facts.filter((f) => foreignTexts.has(normalizeText(f.text))).map((f) => f.id);
	if (mainContainsForeign.length) failures.push(`structural isolation: main getAll contains foreign fact(s) ${mainContainsForeign.join(", ")}`);
	if (foreignContainsMain.length) failures.push(`structural isolation: foreign getAll contains main fact(s) ${foreignContainsMain.join(", ")}`);

	// 3. cross-scope search: one port query over both scopes, results tagged with
	// their source scope (searchAcrossScopes — the shared-memory recall surface)
	const cross = await searchAcrossScopes(
		CROSS_SCOPE_QUERY,
		[
			{ scope: MAIN, label: "rr-main" },
			{ scope: FOREIGN, label: FOREIGN_LABEL },
		],
		12,
	);
	const tagged = cross.filter((m) => typeof m.scope === "string" && m.scope.length > 0).length;
	const crossRows = cross.map((m, i) => ({
		rank: i + 1,
		memoryId: m.id,
		scope: typeof m.scope === "string" && m.scope.length > 0 ? m.scope : null,
		factId: mainSeed.memToFact.get(m.id) ?? foreignSeed.memToFact.get(m.id) ?? null,
		score: typeof m.score === "number" ? round4(m.score) : null,
		text: m.text,
	}));
	const crossPass = cross.length >= 1 && tagged === cross.length;
	if (!crossPass) failures.push(`cross-scope search: ${cross.length} results, ${tagged} tagged (need >=1 result, 100% tagged)`);

	const checks = [
		...leakProbes.map((p) => p.pass),
		mainContainsForeign.length === 0 && foreignContainsMain.length === 0,
		crossPass,
	];
	console.log(
		`[isolation] leakProbes ${leakProbes.filter((p) => p.pass).length}/${leakProbes.length} clean  |  structural: main-has-foreign=${mainContainsForeign.length}, foreign-has-main=${foreignContainsMain.length}  |  cross-scope: ${cross.length} results, ${tagged} tagged, scopes=[${[...new Set(cross.map((m) => m.scope))].join(", ")}]`,
	);
	return {
		leakProbes,
		structural: {
			mainContainsForeign,
			foreignContainsMain,
			pass: mainContainsForeign.length === 0 && foreignContainsMain.length === 0,
		},
		crossScope: {
			query: CROSS_SCOPE_QUERY,
			scopesSearched: ["rr-main", FOREIGN_LABEL],
			results: crossRows,
			tagged,
			scopeTagsPresence: cross.length ? round4(tagged / cross.length) : null,
			scopesSeen: [...new Set(cross.map((m) => m.scope))],
			pass: crossPass,
		},
		passRate: round4(checks.filter(Boolean).length / checks.length),
		pass: checks.every(Boolean),
	};
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
	const receipts = [];
	for (let i = 0; i < SELECTED.length; i++) receipts.push(await runQuery(SELECTED[i], i));
	const skipped = skipCount; // resumed receipts (their durations live in their own files)
	const isolation = await runIsolation();

	// ---- metrics (over the selected queries' receipts — real in --dry too)
	const conflictQueries = receipts.filter((r) => r.conflict);
	const byKind = {};
	for (const kind of KNOWN_KINDS) {
		const rows = receipts.filter((r) => r.kind === kind);
		if (!rows.length) continue;
		byKind[kind] = {
			n: rows.length,
			recallAt5: round4(mean(rows.map((r) => (r.recall.at5 ? 1 : 0)))),
			mrr: round4(mean(rows.map((r) => r.mrr ?? 0))),
		};
	}
	const metrics = {
		queries: receipts.length,
		overall: {
			recallAt3: round4(mean(receipts.map((r) => (r.recall.at3 ? 1 : 0)))),
			recallAt5: round4(mean(receipts.map((r) => (r.recall.at5 ? 1 : 0)))),
			recallAt10: round4(mean(receipts.map((r) => (r.recall.at10 ? 1 : 0)))),
			mrr: round4(mean(receipts.map((r) => r.mrr ?? 0))),
			meanFirstGoldRank: round4(mean(receipts.map((r) => r.firstGoldRank).filter((x) => x !== null))),
			queriesWithNoResults: receipts.filter((r) => r.results.length === 0).map((r) => r.id),
		},
		byKind,
		conflictPreference: {
			queries: conflictQueries.length,
			rate: round4(mean(conflictQueries.map((r) => (r.conflict.preference ? 1 : 0)))),
			outcomes: Object.fromEntries(
				["new-first", "new-only", "tie", "old-first", "old-only", "neither"].map((o) => [o, conflictQueries.filter((r) => r.conflict.outcome === o).length]),
			),
		},
	};

	const pass = failures.length === 0;

	// ---- receipts (per-query receipts were written inside runQuery; the summary
	// only on a FULL run — a --case/--limit debug run must never clobber the
	// committed suite receipt)
	if (!DRY) {
		if (FULL_RUN) {
			const summary = {
				suite: "retrieval-rank",
				date: new Date().toISOString(),
				model: MODEL_LABEL, // this suite's "model" IS the embedder backend label — no LLM is ever called
				embedder: { ...EMBEDDER_RECEIPT, platform: platformInfo() },
				piModelId: process.env.PI_MODEL_ID ?? null, // provenance only — never influences a call
				bridge: { required: false, bridgeUpstreamStatus: null, reason: "NO LLM anywhere: verbatim infer:false seeding + platform.search — deterministic given the embedder" },
				corpus: {
					file: "corpus.json",
					sha256: CORPUS_SHA256,
					facts: corpus.facts.length,
					queries: ALL_QUERIES.length,
					foreignFacts: foreignFacts.length,
					leakProbes: (corpus.foreignScope.leakProbes ?? []).length,
					source: "hand-authored (project-memory-shaped gateway/aurora facts); see README",
				},
				scopes: { main: MAIN.agentId, foreign: FOREIGN.agentId, foreignLabel: FOREIGN_LABEL },
				seed: seedIntegrity,
				isolation,
				metrics,
				resumed: skipped,
				durationMs: Date.now() - t0,
				pass,
				perCase: "(see results/per-case/<query-id>.json — top-10 ids, fact ids, ranks, scores, gold ranks, conflict detail)",
				notes: "memory ids are per-seed UUIDs (each run reseeds); ranks/metrics are the stable artifact. Metrics are measurements, not gates — pass = seeding integrity + scope isolation contracts. conflictPreference compares the corpus gold (new side) vs conflictGold (old side) ranking; both sides seed in ONE import (no distinct timestamps), so it measures the pure text/ranking preference (Zep-style probe minus the temporal signal).",
			};
			writeFileSync(join(RESULTS, "summary.json"), JSON.stringify(summary, null, 2));
		} else {
			console.log(`[partial] ${SELECTED.length}/${ALL_QUERIES.length} queries ran — summary.json NOT written (only a full run completes the suite)`);
		}
	}

	// ---- console report
	console.log(`\n=== retrieval-rank summary (embedder=${BACKEND}, arm=${ARM}${embedderFallback ? " (onnx requested, fell back)" : ""}) ===`);
	console.log(`${"kind".padEnd(16)} n   recall@5  MRR`);
	for (const [kind, k] of Object.entries(byKind)) console.log(`${kind.padEnd(16)} ${String(k.n).padEnd(3)} ${String(k.recallAt5).padEnd(9)} ${k.mrr}`);
	console.log(
		`${"overall".padEnd(16)} ${String(metrics.queries).padEnd(3)} ${String(metrics.overall.recallAt5).padEnd(9)} ${metrics.overall.mrr}   (recall@3=${metrics.overall.recallAt3}, recall@10=${metrics.overall.recallAt10}, meanFirstGoldRank=${metrics.overall.meanFirstGoldRank})`,
	);
	console.log(
		`conflictPreference: ${conflictQueries.filter((r) => r.conflict.preference).length}/${conflictQueries.length} prefer the new side (rate ${metrics.conflictPreference.rate}) — outcomes ${JSON.stringify(metrics.conflictPreference.outcomes)}`,
	);
	console.log(`isolation: ${isolation.pass ? "PASS" : "FAIL"} (leakProbes, structural, crossScope tags; passRate ${isolation.passRate})`);
	console.log(`contracts: ${pass ? "PASS" : "FAIL"}${DRY ? " (dry — no receipts written)" : FULL_RUN ? ` — receipts in ${RESULTS}` : " — per-case receipts written, summary skipped (partial run)"}`);
	if (failures.length) {
		console.error(`\n${failures.length} failure(s):`);
		for (const f of failures) console.error(`  - ${f}`);
		process.exit(1);
	}
	console.log(`done in ${Date.now() - t0}ms`);
}

if (import.meta.main) {
	await main();
}

export { rankOfFact, recallAtK, conflictOutcome };
