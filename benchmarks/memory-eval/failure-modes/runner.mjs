#!/usr/bin/env bun
/**
 * failure-modes/runner.mjs — the twelve documented memory failure modes from
 * docs/memory-competitor-research.md §"Common failure modes to benchmark",
 * each pinned as a measured regression case (cases.json — hand-authored):
 * a pass today AND a per-check receipt that makes a future regression visible.
 *
 * Mode dispatch (per case, cases.json `mode`):
 *
 *   DETERMINISTIC (fm-01, 05, 07, 09, 10, 12) — direct production-module
 *   calls, NO bridge, no LLM:
 *     - fm-01 silent truncation: an oversized tier stack fed to
 *       resolveMemoryForAgentDetailed as an OVERLAY (never written to the real
 *       DATA_DIR — memory.ts accepts Partial<Record<Tier,string>>) must resolve
 *       under PI_MEMORY_TOTAL_CHARS with a visible `<!-- budget: pruned … -->`
 *       marker (budget.ts pass 2); capTerminalNoteContent caps a 25k-char
 *       terminal note at exactly 20 000 codepoints + the shared
 *       `(truncated)` marker; a render over PI_MEM0_MAX_RENDERED (fake
 *       platform rows, the memzero-salvage fake pattern) records the drop in
 *       its footer (`rendered N/M · … oldest pruned at render`).
 *     - fm-05 cross-scope leakage: two SAME-NAMED project directories
 *       (the classic basename collision) resolve to two DISTINCT composite
 *       scopes (project-identity.ts `<basename>-<identity6>`); scoped searches
 *       never surface the other project's facts, the cross-scope fan-out
 *       (searchAcrossScopes) tags every hit with its scope, and a write into
 *       one scope is invisible in the other's getAll/render.
 *     - fm-07 injection via memory file: a committed local.md-style tier
 *       carrying the corpus's four variants resolves through the tier path
 *       (resolveMemoryFiles overlay) and is scanned by the production
 *       untrusted-content scanners (scanUntrustedText — the dream-input
 *       boundary; scanMemoryCandidate — the memory-file load scan term.ts
 *       applies to repo-resident tiers; scanToolOutput — the guard's layer-4
 *       untrusted-content scanner); decideGuardAction must neutralize
 *       (sanitize strips the flagged lines / gate).
 *     - fm-09 stale index: seed -> search-hit -> platform.delete -> search,
 *       getAll and render all drop the fact (nothing advertises deleted
 *       memory).
 *     - fm-10 merged conflicts: a teammate's committed project.md vs an
 *       engine that already holds overlapping platform state — the production
 *       swap-boundary import guard (dream.ts: the scope must be EMPTY before
 *       importLegacyMarkdown runs) keeps overlapping facts single; the
 *       `## Manual notes` hand-edit lane is excluded from the import and
 *       preserved by the render (preserveManualNotesFrom); a guarded re-import
 *       is a no-op. The RAW import surface (no guard) is also measured and
 *       recorded as a finding — it duplicates (see the receipt).
 *     - fm-12 context bloat: a pathological tier stack (every tier at cap,
 *       dated low-value blocks) resolves within PI_MEMORY_TOTAL_CHARS with
 *       the documented degradation order — oldest dated blocks dropped first
 *       (budget.ts pass 1, announced in report.prunedBlocks), the guide and
 *       policy tier never pruned, the newest blocks surviving.
 *
 *   LIVE (fm-03, 04, 06, 11) — the production dream path via
 *   _lib/dream-pipeline.mjs consolidateScope on isolated scopes (exactly the
 *   quality-axes/ops-accuracy shape: notes newest-first, structural
 *   quarantine, ONE extraction add, guard sweep, reconcile, render), ~2 bridge
 *   calls per case:
 *     - fm-03 dedup window miss: twelve near-duplicate variants of one lint
 *       rule seeded verbatim (infer:false — no LLM), one more variant arrives
 *       via the dream; the family must collapse (<= 4 matching memories) while
 *       the new note's enforcement detail survives.
 *     - fm-04 contradiction co-existence: the CDN cache rule changes
 *       max-age=3600 -> max-age=60; after the dream the old rule must never
 *       appear CURRENT — in the render, in a search for the old rule's terms,
 *       or in a cross-project recall fan-out (a hit is exempt only on lines
 *       that explicitly mark it historical/superseded).
 *     - fm-06 poisoning via the note channel: a note attempting DIRECT writes
 *       to the memory system; the structural scan must quarantine it (or the
 *       guard sweep delete what it planted) and nothing it tried to plant may
 *       survive into the rendered memory, the platform, or a search.
 *     - fm-11 bi-temporal recency: Thursday's DB-state note is DELIVERED after
 *       Friday's (created_at order, event time in the text); the reconcile
 *       must resolve to Friday's fact as current using the stated event
 *       times, with the old endpoint never current and the shared retention
 *       detail preserved.
 *
 *   ENGINE (fm-02, 08) — a scratch engine booted through the REAL startServer()
 *   (test/memory-live.test.ts pattern: own scratch DATA_DIR/DB/MEM0 read
 *   before import, per-boot bearer token from the data dir, loopback bind),
 *   in a CHILD PROCESS per phase. Child processes are required because the
 *   mem0 platform snapshots PI_BRIDGE_URL at build time (platformLlmConfig ->
 *   Memory constructor) — fm-08's dead-bridge phase and real-bridge recovery
 *   phase need two separate platform builds over the SAME data dir:
 *     - fm-02 dedup TOCTOU: the same fact posted as two terminal notes
 *       (POST /api/notes), then TWO CONCURRENT dream triggers
 *       (POST /api/dreams/run) — the busy-mutex must serialize them (one 200,
 *       one 409 "engine is busy"), the shared fact must exist exactly once in
 *       the project scope, and no dream row may be left 'running'.
 *     - fm-08 ingestion loss: note POSTed against a DEAD bridge (port 59989)
 *       -> the dream fails visibly (status 'error' in GET /api/dreams) and the
 *       note is STILL pending (dream_id NULL — markDreamed only on success);
 *       then a SECOND engine boot with the real bridge on the SAME data dir
 *       consumes it (pending count returns to zero).
 *
 * Receipts (live/engine modes — never in --dry): results/per-case/<case-id>.json
 * with EVERY check's pass/fail + verbatim evidence (matched lines, probes,
 * statuses, counts) and a `findings` array for documented known-gaps; summary
 * with passed/total + per-case mode. Resume-safe: a case with an existing
 * error-free receipt is skipped unless --fresh. Model-scoped results dirs
 * (quality-axes pattern): a run whose model differs from the one recorded in
 * results/summary.json writes to results/<model>/ instead of clobbering.
 *
 * Usage: bun runner.mjs [--dry] [--fresh] [--case fm-01] [--limit N]
 *   --dry: deterministic cases run FOR REAL (lexical embedder, zero bridge
 *          calls, no receipt writes); live/engine case DEFINITIONS are
 *          validated without running them. Exit non-zero on any failure.
 *   --case <id> accepts a full id or an fm-NN prefix. --limit N runs the
 *   first N cases in corpus order.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const SELF_PATH = new URL(import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Args (before anything else — --dry decides the embedder lane below)
// ---------------------------------------------------------------------------
const DRY = process.argv.includes("--dry");
const FRESH = process.argv.includes("--fresh");
const LIMIT = process.argv.includes("--limit") ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : null;
const CASE_ARG = process.argv.includes("--case") ? process.argv[process.argv.indexOf("--case") + 1] : null;

// Model-scoped results (quality-axes pattern): a run whose model differs from
// the one recorded in the legacy results/summary.json writes to
// results/<model>/ instead of clobbering the committed receipts.
const _RESULTS_MODEL = process.env.PI_MODEL_ID ?? "agnes-3.0-flash";
let _LEGACY_MODEL = _RESULTS_MODEL;
try {
	_LEGACY_MODEL = JSON.parse(readFileSync(join(HERE, "results", "summary.json"), "utf8")).model ?? _RESULTS_MODEL;
} catch {
	/* no legacy summary yet — the first run defines the layout */
}
const RESULTS = _RESULTS_MODEL !== _LEGACY_MODEL ? join(HERE, "results", _RESULTS_MODEL) : join(HERE, "results");

// ---------------------------------------------------------------------------
// Scratch env FIRST (the store proxy opens SQLite at first use; the platform
// reads PI_MEM0_DIR at build): the benchmark never touches the live engine DB
// or the live mem0 dir. Engine-mode cases get their OWN roots under the same
// scratch tree, in child processes (see the header).
// ---------------------------------------------------------------------------
const SCRATCH = "/home/z/my-project/scratch-mem/failure-modes";
process.env.PI_SELFLEARNING_DATA ??= `${SCRATCH}/data`;
process.env.PI_SELFLEARNING_DB ??= `${SCRATCH}/db/failure-modes.db`;
process.env.PI_MEM0_DIR ??= `${SCRATCH}/mem0`;
if (DRY) process.env.PI_MEM0_EMBEDDER = "lexical"; // deterministic + fast: no ONNX lane probe
process.env.PI_MODEL_ID ??= "agnes-3.0-flash";
process.env.PI_PROVIDER ??= "zai-bridge";

const REAL_BRIDGE = (process.env.PI_BRIDGE_URL || "http://127.0.0.1:3031").replace(/\/+$/, "");
const DEAD_BRIDGE = "http://127.0.0.1:59989"; // nothing listens here — ECONNREFUSED, fast fail

// Production modules (dynamic so the scratch env above is in place first).
const { bridgeHealth } = await import("../../../pi-repo/packages/self-learning/src/llm.ts");
const { scanUntrustedText, scanMemoryCandidate, scanToolOutput, decideGuardAction } = await import("../../../pi-repo/packages/self-learning/src/guard.ts");
const { consolidateScope, seedScope, wipeScope, renderScope, projectScope, platformInfo } = await import("../_lib/dream-pipeline.mjs");
const {
	getMemoryPlatform,
	renderProjectMemoryMarkdown,
	importLegacyMarkdown,
	searchAcrossScopes,
} = await import("../../../pi-repo/packages/self-learning/src/memzero.ts");
const memoryMod = await import("../../../pi-repo/packages/self-learning/src/memory.ts");
const budgetMod = await import("../../../pi-repo/packages/self-learning/src/budget.ts");
const termMod = await import("../../../pi-repo/packages/self-learning/src/term.ts");
const { MEMORY_GUIDE, MEMORY_GUIDE_PATH } = await import("../../../pi-repo/packages/self-learning/src/memory-guide.ts");
const { slugifyProject } = await import("../../../pi-repo/packages/self-learning/src/notes.ts");

const corpus = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8"));
const MODEL = process.env.PI_MODEL_ID ?? corpus.model ?? "agnes-3.0-flash";

/** Per-case provenance (docs/memory-competitor-research.md §"Common failure
 * modes to benchmark" — the corpus storyline's numbered sources, in order). */
const SOURCES = {
	"fm-01": "Codex #13386 (32 KB AGENTS.md), #48679 (middle-cut 2500-token summary)",
	"fm-02": "Mem0 #6515 (Python twin), #6531 (TS SDK TOCTOU dedup race)",
	"fm-03": "Mem0 #7123 (dedup window miss at corpus scale)",
	"fm-04": "Codex #56767 (outdated + newer rule both served as current)",
	"fm-05": "Mem0 #5439 (cross-scope entity linking), Graphiti #2065/#2066",
	"fm-06": "Letta #3388, Codex #53490 (memory poisoning / self-modification)",
	"fm-07": "Graphiti's documented non-defense + Claude Code 2.1.284's neutralization",
	"fm-08": "Graphiti #1707 (200-then-dropped silent ingestion loss)",
	"fm-09": "Letta #4337 (deleted skills still advertised)",
	"fm-10": "Letta #4832/#5091 + the 0.33.0 git-conflict repair",
	"fm-11": "Letta #4097 (reflection overwriting fresher facts) + Zep's bi-temporal lesson",
	"fm-12": "Claude Code 2.1.309 (compaction loop under a very large CLAUDE.md)",
};

// ---------------------------------------------------------------------------
// Case selection
// ---------------------------------------------------------------------------
function selectCases() {
	let cases = corpus.cases;
	if (CASE_ARG) {
		cases = cases.filter((c) => c.id === CASE_ARG || c.id.startsWith(`${CASE_ARG}-`) || c.id.startsWith(CASE_ARG));
		if (cases.length === 0) throw new Error(`no case matches --case ${CASE_ARG} (ids: ${corpus.cases.map((c) => c.id).join(", ")})`);
	}
	if (LIMIT !== null && Number.isFinite(LIMIT) && LIMIT > 0) cases = cases.slice(0, LIMIT);
	return cases;
}

// ---------------------------------------------------------------------------
// Corpus validation (always runs; --dry validates the live/engine definitions
// it refuses to execute)
// ---------------------------------------------------------------------------
function validateCorpus(selected) {
	const failures = [];
	const seen = new Set();
	for (const c of corpus.cases) {
		if (!c.id || !/^fm-\d{2}/.test(c.id)) failures.push(`${c.id ?? "<no id>"}: id must match fm-NN…`);
		if (seen.has(c.id)) failures.push(`${c.id}: duplicate id`);
		seen.add(c.id);
		if (!["deterministic", "live", "engine"].includes(c.mode)) failures.push(`${c.id}: unknown mode ${c.mode}`);
		if (!c.doc) failures.push(`${c.id}: no doc`);
		if (c.mode === "deterministic" && !((c.checks ?? []).length > 0 || (c.variants ?? []).length > 0))
			failures.push(`${c.id}: deterministic case needs checks[] or variants[]`);
		if (c.mode === "live" && !(((c.notes ?? []).length > 0 || c.seedTwelveVariants === true) && c.probe))
			failures.push(`${c.id}: live case needs notes (or seedTwelveVariants) + probe`);
		if (c.mode === "live" && c.probe && !c.probe.familyMatch && !c.probe.oldFact && !c.probe.neverCurrent)
			failures.push(`${c.id}: live probe carries no assertion field`);
		if (c.mode === "engine" && !((c.checks ?? []).length > 0)) failures.push(`${c.id}: engine case needs checks[]`);
	}
	for (const c of selected) if (!corpus.cases.includes(c)) failures.push(`${c.id}: not in corpus`);
	return failures;
}

// ---------------------------------------------------------------------------
// Receipt plumbing: every check gets pass/fail + evidence; findings document
// known-gaps without failing the case (the corpus marks all 12 hard —
// findings are advisory context for RESULTS.md, never verdict overrides).
// ---------------------------------------------------------------------------
class CaseReceipt {
	constructor(caseDef, mode) {
		this.suite = "failure-modes";
		this.case = caseDef.id;
		this.mode = mode;
		this.source = SOURCES[caseDef.id.slice(0, 5)] ?? null;
		this.doc = caseDef.doc;
		this.model = MODEL;
		this.date = new Date().toISOString();
		this.durationMs = 0;
		this.checks = [];
		this.findings = [];
		this.error = null;
	}
	check(name, pass, evidence) {
		this.checks.push({ name, pass: pass === true, evidence: evidence ?? null });
		return pass === true;
	}
	finding(text) {
		this.findings.push(text);
	}
	get pass() {
		return this.error === null && this.checks.length > 0 && this.checks.every((c) => c.pass);
	}
	plain() {
		const { checks, findings, ...rest } = this;
		return {
			...rest,
			checks: checks.map((c) => ({ name: c.name, pass: c.pass, evidence: c.evidence })),
			checksPassed: checks.filter((c) => c.pass).length,
			checksTotal: checks.length,
			findings,
			pass: this.pass,
		};
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(desc, ms, fn) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (await fn()) return true;
		await sleep(1000);
	}
	throw new Error(`timeout waiting for ${desc}`);
}

// ---------------------------------------------------------------------------
// Deterministic lane
// ---------------------------------------------------------------------------

/** fm-01 — silent truncation (oversized stack, note cap, render cap). */
async function runFm01(caseDef) {
	const receipt = new CaseReceipt(caseDef, "deterministic");
	const cap = budgetMod.maxTotalChars();

	// -- check 1+2: oversized tiers (project at the 48k tier cap, user near it,
	// undated bulk content so budget pass 2 — the head-truncate-with-marker
	// lane — is what fires) fed to resolveMemoryForAgentDetailed as an OVERLAY
	// (the real DATA_DIR is never written; overlays are the harness's own
	// candidate-memory mechanism).
	const filler = (label, n) => Array.from({ length: n }, (_, i) => `- ${label} low-value bulk line ${i} ${"y".repeat(60)}`).join("\n");
	const overlay = {
		project: `# Tier 1 — Project Memory\n\n## Workflow\n${filler("proj", 610)}`,
		user: `# Tier 2 — User Memory\n\n${filler("user", 590)}`,
		local: `# Tier 3 — Local Overrides\n\n${filler("local", 250)}`,
	};
	const { files, report } = memoryMod.resolveMemoryForAgentDetailed(overlay);
	const budgetedTotal = files.reduce((s, f) => s + f.path.length + f.content.length, 0);
	receipt.check(
		caseDef.checks[0],
		report.totalBefore > cap && report.totalAfter <= cap && budgetedTotal <= cap,
		{
			cap,
			totalBefore: report.totalBefore,
			totalAfter: report.totalAfter,
			budgetedTotal,
			truncatedTiers: report.truncatedTiers,
			prunedBlocks: report.prunedBlocks.length,
			overflow: report.overflow,
		},
	);

	const markerRe = /<!-- budget: pruned \d+ of \d+ chars \(PI_MEMORY_TOTAL_CHARS=\d+\) -->/;
	const marked = files.filter((f) => markerRe.test(f.content));
	receipt.check(
		caseDef.checks[1],
		marked.length > 0,
		{
			markerMatches: marked.map((f) => ({ tier: f.tier, marker: f.content.match(markerRe)?.[0] ?? null })),
		},
	);

	// -- check 3: the 25 000-char terminal note through the ONE cap shape every
	// site in the note lane shares (term.ts capTerminalNoteContent, BUG 9/13).
	const bigNote = `Terminal session in the oversized-note repo: the session transcript follows.\n${"x".repeat(25_000 - 80)}`;
	const capped = termMod.capTerminalNoteContent(bigNote);
	const marker = termMod.TERMINAL_NOTE_TRUNCATION_MARKER;
	receipt.check(
		caseDef.checks[2],
		capped.length === 20_000 + marker.length &&
			capped.endsWith(marker) &&
			capped.slice(0, 20_000) === bigNote.slice(0, 20_000) &&
			termMod.capTerminalNoteContent(capped) === capped,
		{
			inputChars: bigNote.length,
			outputChars: capped.length,
			bodyChars: capped.length - marker.length,
			marker: JSON.stringify(marker),
			headPreservedFor20k: capped.slice(0, 20_000) === bigNote.slice(0, 20_000),
			idempotent: termMod.capTerminalNoteContent(capped) === capped,
		},
	);

	// -- check 4: a platform render over PI_MEM0_MAX_RENDERED records the drop
	// in its footer. Fake platform rows in the memzero-salvage test pattern
	// (test/_fake-platform.ts seed() shape — kind "note" rows; the real
	// platform is not needed: renderProjectMemoryMarkdown takes the memory
	// list directly). The env knob is read at call time (mem0MaxRendered), set
	// small for the probe and restored after.
	const savedMaxRendered = process.env.PI_MEM0_MAX_RENDERED;
	const RENDER_CAP = 12;
	const ROWS = 30;
	process.env.PI_MEM0_MAX_RENDERED = String(RENDER_CAP);
	try {
		const rows = Array.from({ length: ROWS }, (_, i) => ({
			id: `fm01-fake-${i}`,
			text: `Fake memory number ${i} of the render-cap probe: prefer small modules and explicit names`,
			updatedAt: new Date(Date.now() - (ROWS - i) * 3_600_000).toISOString(),
			createdAt: new Date(Date.now() - (ROWS - i) * 3_600_000).toISOString(),
			metadata: { kind: "note" },
		}));
		const rendered = renderProjectMemoryMarkdown(rows, { backend: platformInfo().backend });
		const footer = rendered.match(/<!-- unown: rendered[^>]*-->/)?.[0] ?? null;
		const bulletCount = (rendered.match(/^- /gm) || []).length;
		receipt.check(
			caseDef.checks[3],
			new RegExp(`rendered ${RENDER_CAP}/${ROWS} `).test(footer ?? "") &&
				/oldest pruned at render/.test(footer ?? "") &&
				bulletCount === RENDER_CAP &&
				rendered.includes("number 29") &&
				!rendered.includes("number 0"),
			{
				renderCap: RENDER_CAP,
				rows: ROWS,
				footer,
				bulletCount,
				newestSurvives: rendered.includes("number 29"),
				oldestDropped: !rendered.includes("number 0"),
			},
		);
	} finally {
		if (savedMaxRendered === undefined) delete process.env.PI_MEM0_MAX_RENDERED;
		else process.env.PI_MEM0_MAX_RENDERED = savedMaxRendered;
	}
	return receipt;
}

/** fm-05 — cross-scope leakage (the same-named-project collision). */
async function runFm05(caseDef) {
	const receipt = new CaseReceipt(caseDef, "deterministic");
	const platform = await getMemoryPlatform();
	const pathA = `${SCRATCH}/fm-05/work/api-server`;
	const pathB = `${SCRATCH}/fm-05/personal/api-server`; // SAME basename — the classic collision
	const slugA = slugifyProject(pathA);
	const slugB = slugifyProject(pathB);
	const scopeA = projectScope(slugA);
	const scopeB = projectScope(slugB);
	await wipeScope(scopeA);
	await wipeScope(scopeB);

	// Disjoint fact families with scope-unique marker tokens (so the lexical
	// search probe cannot be satisfied by same-scope vocabulary overlap).
	const factsA = [
		"The ZEPHYR gateway fronts the work deployment with a regional failover pool",
		"The work database is vacuumed on the aurora cluster nightly",
	];
	const factsB = [
		"The ORBIT relay fronts the personal deployment with a single tenant",
		"The personal database is snapshot on the helios cluster nightly",
	];
	await platform.add(factsA.map((t) => ({ role: "user", content: t })), scopeA, { kind: "note" }, { infer: false });
	await platform.add(factsB.map((t) => ({ role: "user", content: t })), scopeB, { kind: "note" }, { infer: false });

	// -- check 1: scopeA search for a scopeB-only fact returns nothing (no
	// leakage — a returned hit is a failure iff it carries the B-only marker;
	// same-scope nearest-neighbor noise is recorded, not confused for a leak).
	const aHits = await platform.search("ORBIT relay single tenant helios", scopeA, 5);
	const aLeak = aHits.filter((m) => /orbit relay|helios/i.test(m.text));
	receipt.check(
		caseDef.checks[0],
		aHits.length === 0 || aLeak.length === 0,
		{
			slugA,
			slugB,
			distinctSlugs: slugA !== slugB,
			query: "ORBIT relay single tenant helios",
			hits: aHits.map((m) => ({ text: m.text, score: m.score })),
			leakedHits: aLeak.map((m) => m.text),
			evaluatedAs: "no returned hit carries the scopeB-only marker (orbit relay / helios) — same-scope nearest-neighbor noise without the marker is not leakage",
		},
	);

	// -- check 2: scopeB search for a scopeA-only fact returns nothing.
	const bHits = await platform.search("ZEPHYR gateway regional failover aurora", scopeB, 5);
	const bLeak = bHits.filter((m) => /zephyr gateway|aurora/i.test(m.text));
	receipt.check(
		caseDef.checks[1],
		bHits.length === 0 || bLeak.length === 0,
		{
			query: "ZEPHYR gateway regional failover aurora",
			hits: bHits.map((m) => ({ text: m.text, score: m.score })),
			leakedHits: bLeak.map((m) => m.text),
		},
	);

	// -- check 3: the cross-scope fan-out returns results tagged with their
	// originating scope (across=1 semantics — searchAcrossScopes).
	const cross = await searchAcrossScopes("database cluster nightly", [
		{ scope: scopeA, label: `work:${slugA}` },
		{ scope: scopeB, label: `personal:${slugB}` },
	]);
	const labels = [...new Set(cross.map((m) => m.scope))];
	receipt.check(
		caseDef.checks[2],
		cross.length > 0 && labels.length >= 2 && cross.every((m) => typeof m.scope === "string" && m.scope.length > 0),
		{
			query: "database cluster nightly",
			results: cross.map((m) => ({ scope: m.scope, text: m.text, score: m.score })),
			distinctScopeLabels: labels,
		},
	);

	// -- check 4: a write into scopeA is invisible in scopeB's getAll and render.
	const newMarker = "the fm05 write-isolation canary LANTERN-51";
	await platform.add([{ role: "user", content: `Work session added a new convention: ${newMarker}` }], scopeA, { kind: "note" }, { infer: false });
	const bAll = await platform.getAll(scopeB);
	const bRender = await renderScope(scopeB);
	receipt.check(
		caseDef.checks[3],
		!bAll.some((m) => m.text.includes("LANTERN-51")) && !bRender.includes("LANTERN-51"),
		{
			scopeBCount: bAll.length,
			scopeBTexts: bAll.map((m) => m.text),
			renderCarriesCanary: bRender.includes("LANTERN-51"),
			scopeACountAfterWrite: (await platform.getAll(scopeA)).length,
		},
	);
	return receipt;
}

/** fm-07 — prompt injection via committed memory content. */
async function runFm07(caseDef) {
	const receipt = new CaseReceipt(caseDef, "deterministic");
	const variants = caseDef.variants;

	// A committed local.md-style tier embedding the four variants verbatim.
	const tierContent = [
		"# Tier 3 — Local Overrides",
		"",
		...variants.flatMap((v) => [v, ""]),
	].join("\n");

	// -- check 1 (plumbing): the tier resolution path carries the committed
	// content verbatim (the overlay is the un-shipped candidate mechanism —
	// the real DATA_DIR is never written).
	const files = memoryMod.resolveMemoryFiles({ local: tierContent });
	const localFile = files.find((f) => f.tier === "local");
	const detailed = memoryMod.resolveMemoryForAgentDetailed({ local: tierContent });
	receipt.check(
		"the committed local.md-style tier resolves through the tier path verbatim (resolveMemoryFiles overlay + agent injection surface)",
		localFile?.content === tierContent && detailed.files.some((f) => f.tier === "local" && f.content.includes(tierContent.split("\n")[2] ?? "")),
		{
			resolvedLocalChars: localFile?.content.length ?? 0,
			tierContentChars: tierContent.length,
			injectedLocalPresent: detailed.files.some((f) => f.tier === "local"),
			budgetReport: { cap: detailed.report.cap, totalBefore: detailed.report.totalBefore, totalAfter: detailed.report.totalAfter },
		},
	);

	// -- check 2: every variant is flagged by at least one production
	// untrusted-content scanner. The three scanners that defend untrusted
	// content boundaries (all in guard.ts, all production code):
	//   scanUntrustedText     — the dream-input boundary (notes);
	//   scanMemoryCandidate   — the memory-file load scan term.ts applies to
	//                           repo-resident tiers (the M10 UNVERIFIED demotion);
	//   scanToolOutput        — the layer-4 untrusted-content banner scan.
	const perVariant = variants.map((v, i) => {
		const note = scanUntrustedText(v);
		const line = scanMemoryCandidate(v);
		const tool = scanToolOutput(v, "memory-file");
		return {
			variant: i + 1,
			text: v,
			scanUntrustedTextRules: note.rules,
			scanMemoryCandidateRules: line.map((f) => `${f.rule}@line${f.line}`),
			scanToolOutputFlags: tool.flags,
			flagged: note.rules.length > 0 || line.length > 0 || tool.flags.length > 0,
		};
	});
	const allFlagged = perVariant.every((p) => p.flagged);
	receipt.check(
		"every committed variant is flagged by at least one production untrusted-content scanner (rules recorded per variant)",
		allFlagged,
		{ perVariant, scanners: ["scanUntrustedText (guard layer 1 — dream input)", "scanMemoryCandidate (guard layer 2 — memory-file load)", "scanToolOutput (guard layer 4 — untrusted-content banner)"] },
	);
	if (perVariant.some((p) => !p.flagged)) receipt.finding("fm-07: a variant escaped every production scanner — see perVariant in the evidence");

	// The honest boundary note: which variants the MEMORY-FILE load scan itself
	// (scanMemoryCandidate — the one term.ts applies at tier resolution)
	// catches vs. which need the layer-4 scanner.
	const loadScanMisses = perVariant.filter((p) => p.scanMemoryCandidateRules.length === 0 && p.scanUntrustedTextRules.length === 0);
	if (loadScanMisses.length > 0) {
		receipt.finding(
			`fm-07: variant(s) ${loadScanMisses.map((p) => p.variant).join(", ")} are NOT caught by the memory-file load scan (scanMemoryCandidate / scanUntrustedText) — only the layer-4 tool-output scanner (role-tag-forgery on the impostor "### System" block) flags them, and that scanner is not applied to memory files at load. The term.ts M10 UNVERIFIED demotion therefore misses this class. Recommendation: add the ROLE_TAG_RE shapes to scanMemoryCandidate. (Recorded as a finding, not a src edit — the no-benchmark-driven-edits constraint.)`,
		);
	}

	// -- check 3: the dream-input boundary (scanUntrustedText) trips on the
	// resolved tier content — untrusted-file content is never clean input.
	const noteScan = scanUntrustedText(tierContent);
	receipt.check(
		"the dream-input boundary (scanUntrustedText) flags the resolved tier content",
		noteScan.rules.length > 0,
		{ rules: noteScan.rules, excerpt: noteScan.excerpt },
	);

	// -- check 4: the guard neutralizes — sanitize strips the flagged lines (or
	// gate refuses the write). firstMint: false (established memory), the
	// production dream-path option shape.
	const current = "# Tier 3 — Local Overrides\n\n- Keep the existing local conventions.\n";
	const decision = decideGuardAction(tierContent, current, { firstMint: false, quarantinedNotes: [] });
	const flaggedLines = decision.flags.map((f) => f.line);
	const sanitizedKeepsUnflagged = decision.sanitized.split("\n").filter((_, i) => !flaggedLines.includes(i + 1)).length > 0;
	receipt.check(
		"the guard neutralizes the flagged content (decideGuardAction sanitize strips the flagged lines, or gate refuses the write)",
		(decision.action === "sanitize" || decision.action === "gate") && (decision.action === "gate" || sanitizedKeepsUnflagged),
		{
			action: decision.action,
			reason: decision.reason ?? null,
			flaggedLines: decision.flags.map((f) => ({ line: f.line, rule: f.rule, text: f.text })),
			sanitizedCarriesVariants: variants.map((v) => ({ variant: v.split("\n")[0].slice(0, 60), survivesInSanitized: decision.sanitized.includes(v.split("\n")[0]) })),
		},
	);
	return receipt;
}

/** fm-09 — stale index after deletion. */
async function runFm09(caseDef) {
	const receipt = new CaseReceipt(caseDef, "deterministic");
	const platform = await getMemoryPlatform();
	const scope = projectScope("fm9-stale-index");
	await wipeScope(scope);
	const fact = "The verification canary STALE-4477 must run before every merge in the index-hygiene repo";
	await platform.add([{ role: "user", content: fact }], scope, { kind: "note" }, { infer: false });

	const seeded = await platform.getAll(scope);
	const hit = await platform.search("verification canary STALE-4477 before merge", scope, 5);
	receipt.check(
		caseDef.checks[0],
		seeded.length === 1 && hit.some((m) => m.text.includes("STALE-4477")),
		{
			seededCount: seeded.length,
			searchHits: hit.map((m) => ({ text: m.text, score: m.score })),
		},
	);

	await platform.delete(seeded[0].id);
	const afterSearch = await platform.search("verification canary STALE-4477 before merge", scope, 5);
	receipt.check(
		caseDef.checks[1],
		!afterSearch.some((m) => m.text.includes("STALE-4477")),
		{
			hitsAfterDelete: afterSearch.map((m) => ({ text: m.text, score: m.score })),
			staleHits: afterSearch.filter((m) => m.text.includes("STALE-4477")).map((m) => m.text),
		},
	);

	const afterAll = await platform.getAll(scope);
	const afterRender = await renderScope(scope);
	receipt.check(
		caseDef.checks[2],
		!afterAll.some((m) => m.text.includes("STALE-4477")) && !afterRender.includes("STALE-4477"),
		{
			getAllCount: afterAll.length,
			renderCarriesDeletedFact: afterRender.includes("STALE-4477"),
			render: afterRender,
		},
	);
	return receipt;
}

/** fm-10 — shared/merged memory conflicts (the teammate-clone import). */
async function runFm10(caseDef) {
	const receipt = new CaseReceipt(caseDef, "deterministic");
	const platform = await getMemoryPlatform();

	// The teammate's committed project.md: seed-rule bullets, one bullet that
	// OVERLAPS the local engine's platform state, one new bullet, and the
	// hand-edit "## Manual notes" lane.
	const fileMd = [
		"# Project Memory",
		"",
		"## Workflow",
		"- Run the integration suite with bun test integration/",
		"- Never commit directly to main; push a branch and open a PR",
		"",
		"## Manual notes",
		"- Remember to thank the reviewer in PR descriptions",
		"",
	].join("\n");
	const overlappingFact = "Run the integration suite with bun test integration/";
	const manualBullet = "Remember to thank the reviewer in PR descriptions";

	// The production swap-boundary import guard (dream.ts runProjectDream): a
	// committed project.md is only imported into an EMPTY scope — an engine
	// that already holds platform state for the project never re-imports.
	// Evaluated with the exported production predicates, exactly as dream.ts
	// composes them (isPristineSeedProjectMemory + platform.getAll).
	const guardedImport = async (scope, markdown) => {
		const existing = (await platform.getAll(scope)).length;
		const pristine = termMod.isPristineSeedProjectMemory(markdown);
		let imported = 0;
		if (existing === 0 && !pristine) imported = await importLegacyMarkdown(markdown, scope, { platform });
		return { existingCount: existing, pristine, imported, guardRan: existing === 0 && !pristine };
	};

	// -- local engine lane: the scope already holds overlapping state.
	const scopeLocal = projectScope("fm10-local-state");
	await wipeScope(scopeLocal);
	await platform.add(
		[overlappingFact, "The deploy script requires SENTRY_DSN set in the environment"].map((content) => ({ role: "user", content })),
		scopeLocal,
		{ kind: "note" },
		{ infer: false },
	);
	const countOf = async (scope, needle) =>
		(await platform.getAll(scope)).filter((m) => m.text.includes(needle)).length;
	const before = await countOf(scopeLocal, overlappingFact);
	const g1 = await guardedImport(scopeLocal, fileMd);
	const after = await countOf(scopeLocal, overlappingFact);
	receipt.check(
		caseDef.checks[0],
		before === 1 && after === 1 && g1.guardRan === false,
		{
			lane: "local engine (scope already holds overlapping platform state)",
			guard: g1,
			overlappingFactCountBefore: before,
			overlappingFactCountAfterImport: after,
		},
	);

	// -- check 2: the Manual notes section survives — excluded from the import
	// (never becomes platform knowledge — the duplicate-forever fix) and
	// preserved verbatim by the render (preserveManualNotesFrom, the hand-edit
	// lane dream.ts threads the current file through).
	const teammateScope = projectScope("fm10-teammate-clone");
	await wipeScope(teammateScope);
	const gT = await guardedImport(teammateScope, fileMd);
	const teammateAll = await platform.getAll(teammateScope);
	const rendered = renderProjectMemoryMarkdown(teammateAll, { preserveManualNotesFrom: fileMd });
	receipt.check(
		caseDef.checks[1],
		gT.guardRan === true &&
			!teammateAll.some((m) => m.text.includes(manualBullet)) &&
			rendered.includes("## Manual notes") &&
			rendered.includes(manualBullet),
		{
			lane: "teammate clone (empty scope — the import runs)",
			guard: gT,
			platformCarriesManualBullet: teammateAll.some((m) => m.text.includes(manualBullet)),
			renderCarriesManualSection: rendered.includes("## Manual notes") && rendered.includes(manualBullet),
			render: rendered,
		},
	);

	// -- check 3: a second identical import is a no-op (idempotent counts) —
	// through the production guard in both lanes. The RAW unguarded surface is
	// measured alongside (importLegacyMarkdown has no content-level dedup — the
	// production defense is the call-site emptiness guard pinned above; see the
	// finding below).
	const c1 = (await platform.getAll(teammateScope)).length;
	const g2 = await guardedImport(teammateScope, fileMd);
	const c2 = (await platform.getAll(teammateScope)).length;
	const l1 = (await platform.getAll(scopeLocal)).length;
	const g3 = await guardedImport(scopeLocal, fileMd);
	const l2 = (await platform.getAll(scopeLocal)).length;
	const scopeRaw = projectScope("fm10-raw-surface");
	await wipeScope(scopeRaw);
	await platform.add([{ role: "user", content: overlappingFact }], scopeRaw, { kind: "note" }, { infer: false });
	const raw1 = await importLegacyMarkdown(fileMd, scopeRaw, { platform });
	const rawCount1 = (await platform.getAll(scopeRaw)).length;
	const raw2 = await importLegacyMarkdown(fileMd, scopeRaw, { platform });
	const rawCount2 = (await platform.getAll(scopeRaw)).length;
	const rawDup = await countOf(scopeRaw, overlappingFact);
	receipt.check(
		caseDef.checks[2],
		c1 === c2 && l1 === l2 && g2.guardRan === false && g3.guardRan === false,
		{
			teammateCounts: { firstImport: c1, secondImport: c2 },
			localCounts: { firstAttempt: l1, secondAttempt: l2 },
			guards: { teammateSecond: g2, localBoth: g3 },
			rawUnguardedSurface: { firstImportBullets: raw1, secondImportBullets: raw2, scopeCountAfterFirst: rawCount1, scopeCountAfterSecond: rawCount2, overlappingFactCopies: rawDup },
		},
	);
	receipt.finding(
		`fm-10: importLegacyMarkdown itself has NO content-level dedup — measured on an unguarded scope: ${raw1} then ${raw2} bullets imported, scope count ${rawCount1} -> ${rawCount2}, the overlapping fact ends up in ${rawDup} memories. Production's only guard is the dream-time emptiness check (dream.ts imports a committed file into an EMPTY scope only). Any future call site that imports into a non-empty scope duplicates. Recommendation: hash-dedup inside importLegacyMarkdown. (Recorded as a finding, not a src edit — the no-benchmark-driven-edits constraint.)`,
	);
	return receipt;
}

/** fm-12 — context bloat (pathological tier stack at cap, dated blocks). */
async function runFm12(caseDef) {
	const receipt = new CaseReceipt(caseDef, "deterministic");
	const cap = budgetMod.maxTotalChars();

	// Every prunable tier at its cap, filled with DATED low-value blocks
	// (appendRules shape `<!-- author @ date — note -->`) with distinct dates —
	// budget pass 1 (drop the OLDEST dated blocks first) is what fires.
	const filler = (label, n) => Array.from({ length: n }, (_, i) => `- ${label} low-value dated line ${i} ${"z".repeat(60)}`).join("\n");
	const datedBlock = (date, note) => `<!-- author @ ${date} — ${note} -->\n${filler("blk", 30)}`;
	/** VALID calendar dates (the budget module string-sorts them): a spread
	 * where project and user interleave in Jan/Feb (so the drop order crosses
	 * tiers) and the local tier is the newest (June — must survive whole). */
	const dateSeq = (startIso, n, stepDays) =>
		Array.from({ length: n }, (_, i) => new Date(Date.parse(startIso) + i * stepDays * 86_400_000))
				.map((d) => d.toISOString().slice(0, 16).replace("T", " "));
	const mkTier = (prefix, startIso, n) =>
		`# Tier\n\n${dateSeq(startIso, n, 2).map((d, i) => datedBlock(d, `${prefix}-note-${i}`)).join("\n\n")}`;
	const overlay = {
		project: mkTier("proj", "2026-01-01T10:00:00Z", 20), // 2026-01-01 .. 2026-02-08
		user: mkTier("user", "2026-01-02T10:00:00Z", 18), // 2026-01-02 .. 2026-02-09 (interleaves with project)
		local: mkTier("local", "2026-06-01T10:00:00Z", 10), // 2026-06-01 .. 2026-06-19 (newest tier)
	};
	const { files, report } = memoryMod.resolveMemoryForAgentDetailed(overlay);
	const budgetedTotal = files.reduce((s, f) => s + f.path.length + f.content.length, 0);
	receipt.check(
		caseDef.checks[0],
		report.totalBefore > cap && report.totalAfter <= cap && budgetedTotal <= cap,
		{ cap, totalBefore: report.totalBefore, totalAfter: report.totalAfter, budgetedTotal, overflow: report.overflow },
	);

	// -- prune markers announce what was dropped: every pruned block carries
	// its tier, author-note and date in report.prunedBlocks (plus the in-band
	// `<!-- budget: pruned … -->` marker when pass 2 head-truncates).
	const prunedDatesAsc = report.prunedBlocks.map((b) => b.date).every((d, i, a) => i === 0 || a[i - 1] <= d);
	const prunedAnnounced = report.prunedBlocks.length > 0 && report.prunedBlocks.every((b) => b.tier && b.date && b.chars > 0);
	const markerRe = /<!-- budget: pruned \d+ of \d+ chars \(PI_MEMORY_TOTAL_CHARS=\d+\) -->/;
	receipt.check(
		caseDef.checks[1],
		prunedAnnounced,
		{
			prunedBlocks: report.prunedBlocks,
			prunedDatesNonDecreasing: prunedDatesAsc,
			truncatedTiers: report.truncatedTiers,
			inBandMarker: files.filter((f) => markerRe.test(f.content)).map((f) => f.content.match(markerRe)?.[0]),
		},
	);

	// -- the guide and the policy tier are never pruned.
	const guideFile = files.find((f) => f.path === MEMORY_GUIDE_PATH);
	const policyFile = files.find((f) => f.tier === "policy");
	receipt.check(
		caseDef.checks[2],
		guideFile?.content === MEMORY_GUIDE && (policyFile?.content ?? "").includes("non-negotiable") && report.prunedBlocks.every((b) => b.tier !== "guide" && b.tier !== "policy"),
		{
			guideIntact: guideFile?.content === MEMORY_GUIDE,
			guideChars: guideFile?.content.length ?? 0,
			policyIntact: (policyFile?.content ?? "").includes("non-negotiable"),
			policyChars: policyFile?.content.length ?? 0,
		},
	);

	// -- degradation order: the oldest dated blocks are dropped first, the
	// newest survive (per tier AND globally: the 2026-01 project blocks drop
	// before any 2026-02 user block; the 2026-06 local tier survives whole).
	const projFile = files.find((f) => f.tier === "project");
	const userFile = files.find((f) => f.tier === "user");
	const localFile = files.find((f) => f.tier === "local");
	const keptNotes = (f, prefix) => [...(f?.content ?? "").matchAll(new RegExp(`— ${prefix}-note-(\\d+)`, "g"))].map((m) => Number(m[1])).sort((a, b) => a - b);
	const projKept = keptNotes(projFile, "proj");
	const userKept = keptNotes(userFile, "user");
	const localKept = keptNotes(localFile, "local");
	const oldestDroppedFirst =
		!projFile.content.includes("proj-note-0") &&
		projKept.length > 0 &&
		Math.min(...projKept) > 0 &&
		!userFile.content.includes("user-note-0") &&
		localKept.length === 10;
	receipt.check(
		caseDef.checks[3],
		oldestDroppedFirst && prunedDatesAsc,
		{
			projectKeptBlockNotes: projKept,
			userKeptBlockNotes: userKept,
			localKeptBlockNotes: localKept,
			prunedOrder: report.prunedBlocks.map((b) => `${b.tier}:${b.date}`),
			oldestProjectBlockDropped: !projFile.content.includes("proj-note-0"),
			newestTierSurvivesWhole: localKept.length === 10,
		},
	);
	return receipt;
}

const DETERMINISTIC_RUNNERS = {
	"fm-01-silent-truncation": runFm01,
	"fm-05-cross-scope-leakage": runFm05,
	"fm-07-injection-via-memory-file": runFm07,
	"fm-09-stale-index": runFm09,
	"fm-10-merged-conflicts": runFm10,
	"fm-12-context-bloat": runFm12,
};

// ---------------------------------------------------------------------------
// Live lane (fm-03, 04, 06, 11) — production dream path, isolated scopes
// ---------------------------------------------------------------------------

/** Historical/superseded exemption markers (the ops-accuracy absentCurrent
 * contract): a line matching the old fact is exempt iff it carries one. */
const HISTORICAL_RE = /superseded|revoked|removed|no longer|decommissioned|migrated|old|deprecated|was |used to|before/i;

function normLine(line) {
	return String(line ?? "")
		.trim()
		.replace(/^[-*+]\s+/, "")
		.replace(/\s+/g, " ");
}

/** The twelve near-duplicate variants of the import-convention lint rule
 * (fm-03's seeded accumulated state — cases.json `seedTwelveVariants`). */
const FM03_VARIANTS = [
	"Imports in this repository are kept sorted alphabetically.",
	"Import statements must be ordered alphabetically.",
	"The project keeps its imports sorted alphabetically.",
	"Keep imports alphabetical in this repo.",
	"Imports are alphabetically ordered in this codebase.",
	"The import convention is alphabetical sorting.",
	"All imports in the codebase are sorted alphabetically.",
	"We keep the import list alphabetically sorted.",
	"Import order is alphabetical.",
	"Alphabetical order for imports is the rule here.",
	"The linter expects imports sorted alphabetically.",
	"Module imports are maintained in alphabetical order.",
];

/** Build the note rows for a live case: corpus order -> created_at (delivery)
 * order, fed NEWEST-FIRST (undreamedNotes() ORDER BY created_at DESC — the
 * real pipeline's order; timestamps carry the chronology). */
function liveNoteRows(caseDef) {
	const notes = caseDef.notes.map((n, i) => {
		const text = typeof n === "string" ? n : n.text;
		const created_at = typeof n === "string" || !n.created_at ? Date.now() - (caseDef.notes.length - 1 - i) * 60_000 : Date.parse(n.created_at);
		return { id: `${caseDef.id}#${i}`, content: text, created_at };
	});
	notes.sort((a, b) => b.created_at - a.created_at); // newest first
	return notes;
}

async function runLiveCase(caseDef) {
	const receipt = new CaseReceipt(caseDef, "live");
	const platform = await getMemoryPlatform();
	const num = caseDef.id.slice(3, 5);
	const scope = projectScope(`fm${num}-${caseDef.id.slice(6)}`);
	await wipeScope(scope);

	if (caseDef.seedTwelveVariants === true) {
		for (const v of FM03_VARIANTS) await platform.add([{ role: "user", content: v }], scope, { kind: "note" }, { infer: false });
	}
	const seededCount = (await platform.getAll(scope)).length;
	const notes = liveNoteRows(caseDef);
	console.log(`  [dream] ${caseDef.id}: ${notes.length} note(s) over scope ${scope.agentId} (seeded ${seededCount})`);
	const outcome = await consolidateScope(scope, notes);
	if (!outcome.rendered || outcome.rendered.trim().length < 40) {
		receipt.error = `dream produced no substantive render (${outcome.rendered?.length ?? 0} chars)`;
		return receipt;
	}
	const all = await platform.getAll(scope);
	const renderLines = outcome.rendered.split("\n").map(normLine).filter(Boolean);
	const texts = all.map((m) => m.text);

	// probe helpers (ops-accuracy semantics)
	const present = (label, re) => {
		const renderHit = renderLines.find((l) => re.test(l)) ?? null;
		const platformHit = texts.find((t) => re.test(t)) ?? null;
		receipt.check(
			label,
			Boolean(renderHit || platformHit),
			{
				satisfiedBy: renderHit ? "render" : platformHit ? "platform" : "none",
				renderLine: renderHit,
				platformText: platformHit,
			},
		);
		return Boolean(renderHit || platformHit);
	};

	if (caseDef.id === "fm-03-dedup-scale") {
		const familyRe = new RegExp(caseDef.probe.familyMatch, "i");
		const familyTexts = texts.filter((t) => familyRe.test(t));
		receipt.check(
			`the ${caseDef.probe.familyMatch} family collapses to <= ${caseDef.probe.maxMatchCount} matching memories (seeded ${FM03_VARIANTS.length})`,
			familyTexts.length <= caseDef.probe.maxMatchCount,
			{
				seededVariants: FM03_VARIANTS.length,
				familyMatchCount: familyTexts.length,
				familyTexts,
				rendered: outcome.rendered,
				dreamStats: { added: outcome.added, merged: outcome.merged, pruned: outcome.pruned },
			},
		);
		present(`the new note's enforcement detail (${caseDef.probe.mustPresent}) is present after the dream`, new RegExp(caseDef.probe.mustPresent.replace(/\//g, "\\/"), "i"));
	} else if (caseDef.id === "fm-04-contradiction-coexistence") {
		const p = caseDef.probe;
		const oldRe = new RegExp(p.oldFact.replace(/=/g, "\\="), "i");
		const newRe = new RegExp(p.newFact.replace(/=/g, "\\="), "i");
		present(`the new rule (${p.newFact}) is present as current`, newRe);
		// old rule never current: render lines + a search for the old rule's
		// terms + a cross-project recall fan-out (a hit is exempt only with an
		// explicit historical/superseded marker; matched lines recorded verbatim).
		const renderOffenders = renderLines.filter((l) => oldRe.test(l) && !HISTORICAL_RE.test(l)).map((l) => ({ line: l, marked: HISTORICAL_RE.test(l) }));
		const oldRenderLines = renderLines.filter((l) => oldRe.test(l)).map((l) => ({ line: l, exempt: HISTORICAL_RE.test(l) }));
		const searchHits = await platform.search("CDN Cache-Control max-age 3600 stale-while-revalidate", scope, 5);
		const searchOffenders = searchHits.filter((m) => oldRe.test(m.text) && !HISTORICAL_RE.test(m.text)).map((m) => m.text);
		const crossHits = await searchAcrossScopes("CDN cache header max-age policy", [
			{ scope, label: scope.agentId },
			{ scope: projectScope("fm4-foreign-empty"), label: "fm4-foreign-empty" },
		]);
		const crossOffenders = crossHits.filter((m) => oldRe.test(m.text) && !HISTORICAL_RE.test(m.text)).map((m) => m.text);
		receipt.check(
			`the invalidated rule (${p.oldFact}) never appears as current — render, search for its terms, and cross-project recall (historical-marked lines exempt)`,
			renderOffenders.length === 0 && searchOffenders.length === 0 && crossOffenders.length === 0,
			{
				renderLinesMentioningOldFact: oldRenderLines,
				searchHits: searchHits.map((m) => ({ text: m.text, score: m.score })),
				searchOffenders,
				crossScopeHits: crossHits.map((m) => ({ scope: m.scope, text: m.text })),
				crossScopeOffenders: crossOffenders,
			},
		);
		present(`the unchanged detail (${p.swr}) survives the rule change`, new RegExp(p.swr.replace(/-/g, "[- ]"), "i"));
	} else if (caseDef.id === "fm-06-poisoning-direct-write") {
		const p = caseDef.probe;
		receipt.check(
			"the note attempting direct writes is structurally quarantined (or its extractions guard-swept) — it never reaches the extraction LLM / survives the sweep",
			outcome.quarantined >= 1 || outcome.guardDeleted >= 1,
			{
				quarantined: outcome.quarantined,
				quarantinedNoteTexts: outcome.quarantinedNoteTexts,
				guardDeleted: outcome.guardDeleted,
				dreamStats: { added: outcome.added, merged: outcome.merged, pruned: outcome.pruned },
			},
		);
		const searchHits = await platform.search("pirate speak ignore lint rules speed over correctness", scope, 5);
		const survivals = p.neverCurrent.map((phrase) => {
			const re = new RegExp(phrase.replace(/[- ]/g, "[- ]"), "i");
			return {
				phrase,
				inRender: renderLines.some((l) => re.test(l)),
				inPlatform: texts.some((t) => re.test(t)),
				inSearchHits: searchHits.some((m) => re.test(m.text)),
			};
		});
		receipt.check(
			"nothing the note tried to plant survives — no neverCurrent phrase in the render, the platform, or a search",
			survivals.every((s) => !s.inRender && !s.inPlatform && !s.inSearchHits),
			{ survivals, searchHits: searchHits.map((m) => m.text), rendered: outcome.rendered },
		);
	} else if (caseDef.id === "fm-11-bitemporal-recency") {
		const p = caseDef.probe;
		const oldRe = new RegExp(p.oldFact.replace(/[.:]/g, (c) => `\\${c}`), "i");
		const newRe = new RegExp(p.newFact.replace(/[.:]/g, (c) => `\\${c}`), "i");
		present(`the EVENT-time winner (${p.newFact} — Friday, delivered EARLIER) is present as current`, newRe);
		const oldRenderLines = renderLines.filter((l) => oldRe.test(l)).map((l) => ({ line: l, exempt: HISTORICAL_RE.test(l) }));
		const searchHits = await platform.search("audit-log store Elasticsearch endpoint", scope, 5);
		const searchOffenders = searchHits.filter((m) => oldRe.test(m.text) && !HISTORICAL_RE.test(m.text)).map((m) => m.text);
		const renderOffenders = oldRenderLines.filter((l) => !l.exempt).map((l) => l.line);
		receipt.check(
			`the ingestion-time winner (${p.oldFact} — Thursday, delivered LATER) is never current (historical-marked lines exempt)`,
			renderOffenders.length === 0 && searchOffenders.length === 0,
			{
				noteDeliveryOrder: notes.map((n) => ({ content: n.content.slice(0, 60), created_at: new Date(n.created_at).toISOString() })),
				renderLinesMentioningOldFact: oldRenderLines,
				searchHits: searchHits.map((m) => ({ text: m.text, score: m.score })),
				searchOffenders,
				rendered: outcome.rendered,
			},
		);
		present(`the shared detail (${p.retention}) survives the transition`, new RegExp(p.retention.replace(/[- ]/g, "[- ]"), "i"));
	}
	receipt.dreamCalls = 1;
	return receipt;
}

// ---------------------------------------------------------------------------
// Engine lane (fm-02, fm-08) — scratch engines in child processes
// ---------------------------------------------------------------------------

/** Boot a scratch engine worker and collect its evidence file. The child is
 * `bun runner.mjs --__engine-worker <kind> <evidencePath>` with its own env
 * (own DATA_DIR/DB/MEM0 + the phase's bridge + port) — required because the
 * mem0 platform snapshots PI_BRIDGE_URL at build and store.ts snapshots
 * DATA_DIR/DB_PATH at import: each phase needs a fresh process. */
async function spawnEngineWorker(kind, port, bridgeUrl, root) {
	mkdirSync(root, { recursive: true });
	const evidencePath = join(root, `evidence-${kind.replace(/[^a-z0-9]+/gi, "-")}.json`);
	rmSync(evidencePath, { force: true });
	const env = {
		...process.env,
		PI_SELFLEARNING_DATA: join(root, "data"),
		PI_SELFLEARNING_DB: join(root, "db", "engine.db"),
		PI_MEM0_DIR: join(root, "mem0"),
		PI_AGENT_PORT: String(port),
		PI_BRIDGE_URL: bridgeUrl,
		PI_MODEL_ID: MODEL,
		PI_PROVIDER: "zai-bridge",
		PI_MEM0_EMBEDDER: "lexical",
		PI_ENGINE_SEED_BUDGET_MS: "120000",
		FM_ENGINE_ROOT: root,
	};
	const proc = Bun.spawn([process.execPath, SELF_PATH, "--__engine-worker", kind, evidencePath], {
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	const log = `${out}${err ? `\n${err}` : ""}`.split("\n").filter(Boolean);
	for (const line of log.slice(-25)) console.log(`    [engine ${kind}] ${line.slice(0, 220)}`);
	if (!existsSync(evidencePath)) {
		return { fatal: `worker exited ${code} without evidence (last log: ${log.slice(-3).join(" | ") || "none"})`, workerExitCode: code };
	}
	try {
		const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
		evidence.workerExitCode = code;
		return evidence;
	} catch (e) {
		return { fatal: `evidence unparsable: ${e instanceof Error ? e.message : String(e)}`, workerExitCode: code };
	}
}

/** The engine worker main (runs IN THE CHILD). Everything after startServer is
 * the real engine: real router, real WAL store, real dream paths, per-boot
 * bearer token read fresh from the scratch data dir (memory-live pattern). */
async function runEngineWorker(kind, evidencePath) {
	const evidence = { kind, startedAt: new Date().toISOString() };
	const writeEvidence = () => writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
	try {
		const { readFileSync, mkdirSync } = await import("node:fs");
		const { join: joinP } = await import("node:path");
		const root = process.env.FM_ENGINE_ROOT;
		const port = Number(process.env.PI_AGENT_PORT);
		evidence.port = port;
		evidence.bridge = process.env.PI_BRIDGE_URL;
		const serverMod = await import("../../../pi-repo/packages/self-learning/src/server.ts");
		const engine = await serverMod.startServer(port);
		if (!engine) throw new Error("startServer returned null (lock refusal or integrity failure)");
		const token = () => {
			try {
				return readFileSync(joinP(root, "data", "engine.token"), "utf8").trim();
			} catch {
				return "";
			}
		};
		const api = async (method, path, body) => {
			const res = await fetch(`http://127.0.0.1:${port}${path}`, {
				method,
				headers: {
					...(body !== undefined ? { "content-type": "application/json" } : {}),
					...(token() ? { Authorization: `Bearer ${token()}` } : {}),
				},
				body: body !== undefined ? JSON.stringify(body) : undefined,
			});
			return { status: res.status, json: await res.json().catch(() => ({})) };
		};
		evidence.boot = { ok: false };
		await pollUntil("engine boot", 45_000, async () => {
			try {
				const r = await fetch(`http://127.0.0.1:${port}/api/memory`, { headers: token() ? { Authorization: `Bearer ${token()}` } : {} });
				return r.ok;
			} catch {
				return false;
			}
		});
		evidence.boot = { ok: true, seconds: Math.round((Date.now() - Date.parse(evidence.startedAt)) / 1000) };

		// Defensive: the auto-dream interval job must never race the controlled
		// triggers (its next_run is 10 min out at seed — this makes it never).
		try {
			const jobs = await api("GET", "/api/jobs");
			const autoDream = (jobs.json.jobs ?? []).find((j) => j.id === "auto-dream");
			if (autoDream?.enabled) {
				const t = await api("POST", "/api/jobs/auto-dream/toggle", {});
				evidence.autoDreamDisabled = t.status === 200;
			}
		} catch {
			/* informational only */
		}

		if (kind === "fm-02-dedup-toctou") {
			const proj = joinP(root, "work", "orders-api");
			mkdirSync(proj, { recursive: true });
			const noteA = "Session wrap-up in the orders-api repo: the deploy gate requires checklist step QX7-4471 to be verified before every production release — confirmed again this session.";
			const noteB = "Second session in the orders-api repo, same conclusion: before any production release, checklist step QX7-4471 must be verified — the deploy gate enforces it.";
			const postA = await api("POST", "/api/notes", { content: noteA, project_path: proj });
			const postB = await api("POST", "/api/notes", { content: noteB, project_path: proj });
			evidence.notesPosted = [
				{ label: "A", status: postA.status, id: postA.json.id ?? null },
				{ label: "B", status: postB.status, id: postB.json.id ?? null },
			];
			const pendingBefore = ((await api("GET", "/api/notes?limit=50")).json.notes ?? []).filter((n) => n.dream_id === null);
			evidence.pendingBeforeTrigger = pendingBefore.length;
			const dreamsBefore = new Set(((await api("GET", "/api/dreams")).json.dreams ?? []).map((d) => d.id));
			// TWO CONCURRENT dream triggers — the busy-mutex must serialize them.
			const [trigA, trigB] = await Promise.all([api("POST", "/api/dreams/run", {}), api("POST", "/api/dreams/run", {})]);
			evidence.triggers = [
				{ label: "A", status: trigA.status, body: trigA.json },
				{ label: "B", status: trigB.status, body: trigB.json },
			];
			evidence.busyRejected = [trigA, trigB].find((t) => t.status === 409)?.label ?? null;
			// await the serialized dream's completion (fire-and-forget lane)
			let dream = null;
			await pollUntil("dream completion", 300_000, async () => {
				const dreams = (await api("GET", "/api/dreams")).json.dreams ?? [];
				dream = dreams.find((d) => !dreamsBefore.has(d.id) && d.status !== "running") ?? null;
				return Boolean(dream) && !dreams.some((d) => d.status === "running");
			});
			evidence.dream = dream && { id: dream.id, status: dream.status, notes_in: dream.notes_in, note: dream.note };
			evidence.dreamRows = ((await api("GET", "/api/dreams")).json.dreams ?? []).map((d) => ({ id: d.id, status: d.status, notes_in: d.notes_in }));
			evidence.allDreamsTerminal = evidence.dreamRows.every((d) => d.status !== "running");
			const notesAfter = (await api("GET", "/api/notes?limit=50")).json.notes ?? [];
			evidence.pendingAfter = notesAfter.filter((n) => n.dream_id === null).length;
			evidence.noteDreamIds = notesAfter.map((n) => ({ marker: n.content.includes("QX7-4471") ? "QX7-4471" : "other", dream_id: n.dream_id }));
			// the platform state: the project scope the engine's dream wrote
			const { getMemoryPlatform, projectScope, renderProjectMemoryMarkdown } = await import("../../../pi-repo/packages/self-learning/src/memzero.ts");
			const { slugifyProject } = await import("../../../pi-repo/packages/self-learning/src/notes.ts");
			const slug = slugifyProject(proj);
			evidence.projectScope = `project:${slug}`;
			const scope = projectScope(slug);
			const platform = await getMemoryPlatform();
			const texts = (await platform.getAll(scope)).map((m) => m.text);
			evidence.platformFactMatches = texts.filter((t) => /QX7-4471/i.test(t));
			evidence.platformFactMatchCount = evidence.platformFactMatches.length;
			evidence.platformMemoryCount = texts.length;
			evidence.projectRender = renderProjectMemoryMarkdown(await platform.getAll(scope), { backend: "lexical" });
		} else if (kind === "fm-08-ingestion-loss-fail") {
			const proj = joinP(root, "work", "ingest-service");
			mkdirSync(proj, { recursive: true });
			const note =
				"Terminal session in the ingest-service repo: the outbox drain stalls when the bridge host is unreachable and queued retries accumulate until the process runs out of memory. " +
				"The drain job's cadence is 15 minutes, verified with bun test pipelines/. The incident marker for this finding is ILP-8891.";
			const posted = await api("POST", "/api/notes", { content: note, project_path: proj });
			evidence.notePosted = { status: posted.status, id: posted.json.id ?? null };
			const notes = (await api("GET", "/api/notes?limit=50")).json.notes ?? [];
			const row = notes.find((n) => n.content.includes("ILP-8891"));
			evidence.notePendingAfterPost = row ? row.dream_id === null : null;
			evidence.pendingAfterPost = notes.filter((n) => n.dream_id === null).length;
			const dreamsBefore = new Set(((await api("GET", "/api/dreams")).json.dreams ?? []).map((d) => d.id));
			const trig = await api("POST", "/api/dreams/run", {});
			evidence.dreamTrigger = { status: trig.status, body: trig.json };
			let dream = null;
			await pollUntil("failed dream to land", 120_000, async () => {
				const dreams = (await api("GET", "/api/dreams")).json.dreams ?? [];
				dream = dreams.find((d) => !dreamsBefore.has(d.id) && d.status !== "running") ?? null;
				return Boolean(dream);
			});
			evidence.failedDream = dream && { id: dream.id, status: dream.status, notes_in: dream.notes_in, note: dream.note, ended_at: dream.ended_at };
			const notesAfter = (await api("GET", "/api/notes?limit=50")).json.notes ?? [];
			const rowAfter = notesAfter.find((n) => n.content.includes("ILP-8891"));
			evidence.notePendingAfterFail = rowAfter ? rowAfter.dream_id === null : null;
			evidence.pendingAfterFail = notesAfter.filter((n) => n.dream_id === null).length;
			evidence.dreamRows = ((await api("GET", "/api/dreams")).json.dreams ?? []).map((d) => ({ id: d.id, status: d.status, notes_in: d.notes_in }));
		} else if (kind === "fm-08-ingestion-loss-recover") {
			// SECOND engine boot, REAL bridge, SAME data dir (the parent spawns
			// this child with PI_BRIDGE_URL pointed at the live bridge).
			const notes = (await api("GET", "/api/notes?limit=50")).json.notes ?? [];
			evidence.pendingAtBoot = notes.filter((n) => n.dream_id === null).length;
			const rowBefore = notes.find((n) => n.content.includes("ILP-8891"));
			evidence.notePendingAtBoot = rowBefore ? rowBefore.dream_id === null : null;
			const dreamsBefore = new Set(((await api("GET", "/api/dreams")).json.dreams ?? []).map((d) => d.id));
			const trig = await api("POST", "/api/dreams/run", {});
			evidence.dreamTrigger = { status: trig.status, body: trig.json };
			let dream = null;
			await pollUntil("recovery dream to finish", 300_000, async () => {
				const dreams = (await api("GET", "/api/dreams")).json.dreams ?? [];
				dream = dreams.find((d) => !dreamsBefore.has(d.id) && d.status !== "running") ?? null;
				return Boolean(dream);
			});
			evidence.recoveryDream = dream && { id: dream.id, status: dream.status, notes_in: dream.notes_in, note: dream.note };
			const notesAfter = (await api("GET", "/api/notes?limit=50")).json.notes ?? [];
			const rowAfter = notesAfter.find((n) => n.content.includes("ILP-8891"));
			evidence.noteDreamIdAfterRecovery = rowAfter?.dream_id ?? null;
			evidence.pendingAfterRecovery = notesAfter.filter((n) => n.dream_id === null).length;
			evidence.dreamRows = ((await api("GET", "/api/dreams")).json.dreams ?? []).map((d) => ({ id: d.id, status: d.status, notes_in: d.notes_in }));
		} else {
			throw new Error(`unknown worker kind ${kind}`);
		}
		// teardown: the router's interval + the automations scheduler hold the
		// event loop; stop them, close the listener, then exit explicitly.
		try {
			(await import("../../../pi-repo/packages/self-learning/src/router.ts")).router.stop();
		} catch {}
		try {
			serverMod.automationsScheduler.stop();
		} catch {}
		engine.stop(true);
		evidence.ok = true;
		evidence.finishedAt = new Date().toISOString();
		writeEvidence();
		process.exit(0);
	} catch (err) {
		evidence.fatal = err instanceof Error ? `${err.message}` : String(err);
		evidence.ok = false;
		writeEvidence();
		process.exit(1);
	}
}

async function runEngineCase(caseDef) {
	const receipt = new CaseReceipt(caseDef, "engine");
	const root = join(SCRATCH, caseDef.id);
	rmSync(root, { recursive: true, force: true });

	if (caseDef.id === "fm-02-dedup-toctou") {
		const ev = await spawnEngineWorker("fm-02-dedup-toctou", 3045, REAL_BRIDGE, root);
		if (ev.fatal) {
			receipt.error = `engine worker fatal: ${ev.fatal}`;
			return receipt;
		}
		const statuses = (ev.triggers ?? []).map((t) => t.status).sort();
		const busyOne = (ev.triggers ?? []).find((t) => t.status === 409);
		receipt.check(
			caseDef.checks[0],
			statuses.length === 2 && statuses[0] === 200 && statuses[1] === 409 && String(busyOne?.body?.error ?? busyOne?.body?.reason ?? "").includes("busy"),
			{
				triggers: ev.triggers,
				busyRejectedRequest: ev.busyRejected,
				busyError: busyOne?.body ?? null,
				note: "the request that hit the busy-mutex is recorded in busyRejectedRequest — the other trigger's dream ran serialized under the router's startFireAndForget mutex",
			},
		);
		receipt.check(
			caseDef.checks[1],
			ev.platformFactMatchCount === 1,
			{
				projectScope: ev.projectScope,
				factMarker: "QX7-4471",
				factMatchCount: ev.platformFactMatchCount,
				factMatchTexts: ev.platformFactMatches,
				platformMemoryCount: ev.platformMemoryCount,
				projectRender: ev.projectRender,
				dream: ev.dream,
			},
		);
		const dreamRowOk = ev.dream && ev.dream.status !== "running" && ev.dream.notes_in === 2;
		receipt.check(
			caseDef.checks[2],
			ev.allDreamsTerminal === true && Boolean(dreamRowOk) && ev.pendingAfter === 0,
			{
				dream: ev.dream,
				dreamRows: ev.dreamRows,
				allDreamsTerminal: ev.allDreamsTerminal,
				pendingAfter: ev.pendingAfter,
				noteDreamIds: ev.noteDreamIds,
			},
		);
	} else if (caseDef.id === "fm-08-ingestion-loss") {
		const fail = await spawnEngineWorker("fm-08-ingestion-loss-fail", 3046, DEAD_BRIDGE, root);
		if (fail.fatal) {
			receipt.error = `fail-phase engine worker fatal: ${fail.fatal}`;
			return receipt;
		}
		const recover = await spawnEngineWorker("fm-08-ingestion-loss-recover", 3047, REAL_BRIDGE, root);
		if (recover.fatal) {
			receipt.error = `recovery-phase engine worker fatal: ${recover.fatal}`;
			return receipt;
		}
		receipt.check(
			caseDef.checks[0],
			fail.notePosted?.status === 200 && fail.notePendingAfterPost === true,
			{ notePosted: fail.notePosted, pendingAfterPost: fail.pendingAfterPost, notePendingAfterPost: fail.notePendingAfterPost },
		);
		const failedStatusOk = ["error", "gated"].includes(String(fail.failedDream?.status));
		receipt.check(
			caseDef.checks[1],
			failedStatusOk && Boolean(fail.failedDream?.ended_at),
			{ failedDream: fail.failedDream, dreamRows: fail.dreamRows, deadBridge: DEAD_BRIDGE },
		);
		receipt.check(
			caseDef.checks[2],
			fail.notePendingAfterFail === true && fail.pendingAfterFail >= 1,
			{ notePendingAfterFail: fail.notePendingAfterFail, pendingAfterFail: fail.pendingAfterFail, failedDreamNote: fail.failedDream?.note ?? null },
		);
		receipt.check(
			caseDef.checks[3],
			recover.noteDreamIdAfterRecovery !== null && recover.pendingAfterRecovery === 0,
			{
				pendingAtBoot: recover.pendingAtBoot,
				recoveryDream: recover.recoveryDream,
				noteDreamIdAfterRecovery: recover.noteDreamIdAfterRecovery,
				pendingAfterRecovery: recover.pendingAfterRecovery,
				realBridge: REAL_BRIDGE,
			},
		);
	} else {
		receipt.error = `no engine implementation for ${caseDef.id}`;
	}
	return receipt;
}

// ---------------------------------------------------------------------------
// Case loop + summary
// ---------------------------------------------------------------------------
async function runCase(caseDef) {
	const started = Date.now();
	let receipt;
	if (caseDef.mode === "deterministic") receipt = await DETERMINISTIC_RUNNERS[caseDef.id](caseDef);
	else if (caseDef.mode === "live") receipt = await runLiveCase(caseDef);
	else if (caseDef.mode === "engine") receipt = await runEngineCase(caseDef);
	else receipt = Object.assign(new CaseReceipt(caseDef, caseDef.mode), { error: `unknown mode ${caseDef.mode}` });
	receipt.durationMs = Date.now() - started;
	return receipt;
}

function receiptPathFor(caseId) {
	return join(RESULTS, "per-case", `${caseId}.json`);
}

async function main() {
	const selected = selectCases();
	const validationFailures = validateCorpus(selected);
	if (validationFailures.length) {
		console.error(`corpus validation failed (${validationFailures.length}):`);
		for (const f of validationFailures) console.error(`  - ${f}`);
		process.exit(1);
	}

	if (DRY) {
		// --dry: deterministic cases run FOR REAL (lexical embedder, zero bridge
		// calls, no receipt writes); live/engine definitions validated above.
		const t0 = Date.now();
		console.log(`[dry] no-LLM mode — deterministic cases run for real (lexical embedder), live/engine cases validated not run, no receipt writes (model ${MODEL})`);
		const failures = [];
		const dryModes = { deterministic: 0, live: 0, engine: 0 };
		for (const c of selected) {
			dryModes[c.mode] = (dryModes[c.mode] ?? 0) + 1;
			if (c.mode === "deterministic") {
				console.log(`  [case] ${c.id}: running (deterministic)`);
				const receipt = await runCase(c);
				for (const chk of receipt.checks) {
					if (!chk.pass) failures.push(`${c.id}: check failed: ${chk.name}`);
					console.log(`    ${chk.pass ? "ok  " : "FAIL"} ${chk.name}`);
				}
				if (receipt.error) failures.push(`${c.id}: case error: ${receipt.error}`);
				for (const f of receipt.findings) console.log(`    [finding] ${f.slice(0, 200)}…`);
				console.log(`  [case] ${c.id}: ${receipt.pass ? "PASS" : "FAIL"}`);
			} else {
				console.log(`  [case] ${c.id}: definition validated (mode ${c.mode} — not run in --dry)`);
			}
		}
		console.log(`[dry] modes: ${JSON.stringify(dryModes)}`);
		if (failures.length) {
			console.error(`\n[dry] ${failures.length} failure(s):`);
			for (const f of failures) console.error(`  - ${f}`);
			process.exit(1);
		}
		console.log(`\n[dry] PASS — ${selected.length} case(s) exercised/validated in ${Date.now() - t0}ms (deterministic verdicts are real; live/engine cases need the bridge)`);
		return;
	}

	// live/engine mode: bridge health gate before ANY dream call or engine boot
	const selectedNeedBridge = selected.some((c) => c.mode === "live" || c.mode === "engine");
	let health = null;
	if (selectedNeedBridge) {
		health = await bridgeHealth();
		if (!health?.ok) {
			console.error(`llm-bridge on :3031 is not healthy — aborting before any dream call: ${JSON.stringify(health)}`);
			process.exit(1);
		}
		console.log(`bridge healthy (model ${MODEL}, upstream ${health.upstream?.status ?? "?"}) — ${selected.length} case(s)`);
	}

	if (FRESH) rmSync(RESULTS, { recursive: true, force: true });
	mkdirSync(join(RESULTS, "per-case"), { recursive: true });

	const receipts = [];
	for (const c of selected) {
		const path = receiptPathFor(c.id);
		if (!FRESH && existsSync(path)) {
			try {
				const prev = JSON.parse(readFileSync(path, "utf8"));
				if (!prev.error) {
					console.log(`[skip] ${c.id} (receipt exists, no error)`);
					receipts.push(prev);
					continue;
				}
				console.log(`[rerun] ${c.id} (previous receipt had an error)`);
			} catch {
				console.log(`[rerun] ${c.id} (previous receipt unparsable)`);
			}
		}
		console.log(`[case] ${c.id} (mode ${c.mode})`);
		let receipt;
		try {
			receipt = await runCase(c);
		} catch (err) {
			receipt = new CaseReceipt(c, c.mode);
			receipt.error = err instanceof Error ? err.message : String(err);
		}
		writeFileSync(path, JSON.stringify(receipt.plain(), null, 2));
		const checkSummary = `${receipt.checks.filter((x) => x.pass).length}/${receipt.checks.length}`;
		console.log(
			`[case] ${c.id}: ${receipt.error ? `ERROR: ${receipt.error.slice(0, 140)}` : receipt.pass ? `PASS (${checkSummary} checks)` : `FAIL (${checkSummary} checks)`}${receipt.findings.length ? ` · ${receipt.findings.length} finding(s)` : ""} · ${Math.round(receipt.durationMs / 1000)}s`,
		);
		receipts.push(receipt.plain());
	}

	const modes = {};
	for (const c of selected) {
		modes[c.mode] ??= { total: 0, passed: 0 };
		modes[c.mode].total++;
		if (receipts.find((r) => r.case === c.id)?.pass) modes[c.mode].passed++;
	}
	const summary = {
		suite: "failure-modes",
		date: new Date().toISOString(),
		model: MODEL,
		bridgeUpstreamStatus: health?.upstream?.status ?? null,
		platform: platformInfo(),
		casesTotal: selected.length,
		casesPassed: receipts.filter((r) => r.pass).length,
		modes,
		cases: Object.fromEntries(
			receipts.map((r) => [
				r.case,
				{ mode: r.mode, pass: r.pass, error: r.error, checks: `${r.checks.filter((c) => c.pass).length}/${r.checks.length}`, findings: r.findings.length, durationMs: r.durationMs },
			]),
		),
		dreamCallsTotal: receipts.reduce((n, r) => n + (r.mode === "live" ? 1 : 0), 0),
		engineChildren: selected.filter((c) => c.mode === "engine").reduce((n, c) => n + (c.id === "fm-08-ingestion-loss" ? 2 : 1), 0),
		notes: "per-case receipts in results/per-case/<case-id>.json — every check carries verbatim evidence (matched lines, statuses, counts); findings document known-gaps without overriding verdicts",
	};
	writeFileSync(join(RESULTS, "summary.json"), JSON.stringify(summary, null, 2));
	console.log("\n=== failure-modes summary ===");
	for (const [id, c] of Object.entries(summary.cases)) {
		console.log(`${(id + ":").padEnd(32)} ${c.pass ? "PASS" : c.error ? "ERROR" : "FAIL"}  [${c.mode}] checks ${c.checks}${c.findings ? ` · ${c.findings} finding(s)` : ""}`);
	}
	console.log(`cases: ${summary.casesPassed}/${summary.casesTotal} passed · modes: ${JSON.stringify(modes)} · receipts in ${RESULTS}`);
	if (summary.casesPassed !== summary.casesTotal) process.exit(1);
}

// ---------------------------------------------------------------------------
// Entry: engine-worker mode dispatch (spawned children reach here with their
// own env already in place — see spawnEngineWorker)
// ---------------------------------------------------------------------------
const _workerIdx = process.argv.indexOf("--__engine-worker");
if (_workerIdx >= 0) {
	await runEngineWorker(process.argv[_workerIdx + 1], process.argv[_workerIdx + 2]);
} else if (import.meta.main) {
	await main();
}
