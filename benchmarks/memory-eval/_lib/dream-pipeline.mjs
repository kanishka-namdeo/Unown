/**
 * _lib/dream-pipeline.mjs — the shared post-swap dream driver for the four
 * memory-eval suites (quality-axes, poison-corpus, mpbench, recall-qa).
 *
 * Commit 25c6601 swapped the learning core to Mem0 (src/memzero.ts) and REMOVED
 * the old AutoDream SYSTEM prompt the runners used to import from src/dream.ts —
 * since then they measured a dead path. This module re-bases them on the REAL
 * production path: notes -> quarantine scan (structural zero-extraction: flagged
 * notes never reach the extraction LLM) -> ONE platform.add() (mem0's additive
 * extraction, or verbatim infer:false for the --dry no-LLM lane) -> guard sweep
 * over the extracted memories -> reconcileMemories (the surviving AutoDream
 * judgment, one LLM call) -> deterministic render.
 *
 * It is a LINE-FOR-LINE MIRROR of `consolidate()` in src/dream.ts — which is
 * module-private post-swap (only runDream/runProjectDream are exported, and
 * both are DB/canary-coupled, wrong for a scratch benchmark). Everything it
 * calls IS production code, imported: getMemoryPlatform / reconcileMemories /
 * renderProjectMemoryMarkdown / importLegacyMarkdown / scanUntrustedText. The
 * mirror exists so the src/ constraint (no benchmark-driven edits) holds; the
 * moment `consolidate` is exported from dream.ts, this file should collapse to
 * a re-export (noted for the main agent in the M1-RUNNERS report).
 *
 * Scope isolation: one process = one platform singleton = one scratch mem0 dir
 * (PI_MEM0_DIR, set by each runner BEFORE importing this module — the store
 * proxy opens SQLite on first use and memzero reads the env lazily at platform
 * build). Scenarios/cases get disjoint mem0 scopes via projectScope("<suite>-<id>")
 * (mem0 filters by agent_id; the engine multiplexes its projects over one
 * platform the same way), and wipeScope() clears a scope before it is seeded so
 * re-runs never see stale state. Scratch roots stay under
 * /home/z/my-project/scratch-mem/<suite>/ — never the live engine DB.
 *
 * Seeding: the corpus seed markdown enters the platform EXACTLY the way
 * production seeds a fresh install (memory.ts seedMemoryIfEmpty):
 * importLegacyMarkdown(seed, scope, { kind: "seed" }) — bullet-split, verbatim,
 * infer:false (no LLM), kind "seed" so renders mark provenance. That call is
 * rememberNote-on-bullets under the hood (platform.add(bullets, scope,
 * {kind:"seed"}, {infer:false})).
 *
 * Known engine quirk carried verbatim (do NOT paper over here — the benchmark
 * measures the real path): memzero's normalizeMemories() sets metadata to the
 * WHOLE getAll row, so `memory.metadata.kind` is undefined on the real platform
 * (mem0 nests it one level deeper); renderProjectMemoryMarkdown's hard-won
 * immunity and the reconcile listing's kind tags therefore read "note"/regex
 * classification for real-platform memories today. Reported as a src finding.
 */

// Scratch-env contract: the CALLER sets PI_SELFLEARNING_DATA / PI_SELFLEARNING_DB /
// PI_MEM0_DIR (and, for --dry, PI_MEM0_EMBEDDER=lexical) BEFORE dynamically
// importing this module. Importing memzero.ts itself is side-effect-safe (the
// store is a lazy proxy), but the convention keeps the runners' existing
// before-import pattern honest.
const {
	getMemoryPlatform,
	projectScope,
	revertMemoryEvents,
	importLegacyMarkdown,
	reconcileMemories,
	renderProjectMemoryMarkdown,
	memoryPlatformStatus,
} = await import("../../../pi-repo/packages/self-learning/src/memzero.ts");
const { scanUntrustedText } = await import("../../../pi-repo/packages/self-learning/src/guard.ts");

export { projectScope, revertMemoryEvents, memoryPlatformStatus };

/** Dry/no-LLM reconcile verdict: exercises the full reconcile plumbing (getAll,
 * listing build, op application over zero ops, event assembly) without a call. */
export const noOpReconcileLlm = async () => ({ ops: [] });

/** Platform facts for receipt provenance (backend, model, dirs — additive fields). */
export function platformInfo() {
	const s = memoryPlatformStatus();
	return { backend: s.backend, embedderRequested: s.embedderRequested, model: s.model, dir: s.dir, reconcile: s.reconcile, maxRendered: s.maxRendered };
}

/**
 * One consolidation pass over a scope — the consolidate() mirror.
 *
 * opts:
 *   platform        inject a platform (defaults to the mem0 singleton)
 *   infer           false -> verbatim adds, no extraction LLM (the --dry lane;
 *                   production's infer-free paths — seed/import/ship — use the
 *                   same platform.add infer:false contract)
 *   reconcileLlmFn  inject the reconcile verdict (tests/dry: noOpReconcileLlm)
 *   kind            metadata kind for added memories (default "terminal-note",
 *                   exactly what the production dream passes)
 *
 * Returns the DreamOutcome shape from src/dream.ts: added/merged/pruned/
 * quarantined/quarantinedNoteTexts/events (revertable) + rendered markdown,
 * plus guardDeleted/reconcileOps for the receipts.
 */
export async function consolidateScope(scope, notes, opts = {}) {
	const platform = opts.platform ?? (await getMemoryPlatform());
	// Layer 1 (structural): flagged notes never reach the extraction LLM at all.
	const quarantinedNoteTexts = [];
	const cleanNotes = [];
	for (const n of notes) {
		const scan = scanUntrustedText(String(n.content ?? ""));
		if (scan.rules.length > 0) quarantinedNoteTexts.push(String(n.content));
		else cleanNotes.push(n);
	}
	// ONE extraction call for the whole batch (cost parity with the old
	// AutoDream single-call dream): clean notes as user-role messages, in the
	// caller's order (the runners feed newest-first, mirroring undreamedNotes()).
	let events = [];
	if (cleanNotes.length > 0) {
		events = await platform.add(
			cleanNotes.map((n) => ({ role: "user", content: String(n.content) })),
			scope,
			{ kind: opts.kind ?? "terminal-note" },
			opts.infer === false ? { infer: false } : {},
		);
	}
	// Guard sweep: every extracted memory is scanned BEFORE it survives the
	// dream (the F4 paraphrase defense, at atomic-memory granularity).
	const surviving = [];
	let guardDeleted = 0;
	for (const ev of events) {
		if (ev.event !== "ADD" || !ev.id) {
			surviving.push(ev);
			continue;
		}
		if (scanUntrustedText(ev.text).rules.length > 0) {
			await platform.delete(ev.id).catch(() => {});
			guardDeleted++;
			continue;
		}
		surviving.push(ev);
	}
	// Reconcile: contradiction resolution + semantic dedup + pruning (the
	// surviving AutoDream judgment) through mem0's own update/delete primitives.
	const reconcile = await reconcileMemories(scope, {
		platform,
		llmFn: opts.reconcileLlmFn,
	});
	const memories = await platform.getAll(scope);
	const rendered = renderProjectMemoryMarkdown(memories);
	return {
		added: surviving.filter((e) => e.event === "ADD").length,
		merged: reconcile.merged,
		pruned: reconcile.pruned + guardDeleted,
		quarantined: quarantinedNoteTexts.length,
		quarantinedNoteTexts,
		// revertable = surviving ADDs + reconcile events (guard-deleted poison is
		// deliberately NOT revertable)
		events: [...surviving.filter((e) => e.event === "ADD"), ...reconcile.events],
		rendered,
		guardDeleted,
		reconcileOps: reconcile.ops,
	};
}

/**
 * Seed a scope the way production seeds a fresh install: bullets verbatim,
 * kind "seed", no LLM (memory.ts seedMemoryIfEmpty -> importLegacyMarkdown).
 * Returns the number of seed bullets stored.
 */
export async function seedScope(scope, seedMarkdown, opts = {}) {
	const platform = opts.platform ?? (await getMemoryPlatform());
	return importLegacyMarkdown(seedMarkdown, scope, { kind: "seed", platform });
}

/** Render a scope's current memories (the file-on-disk view). */
export async function renderScope(scope, opts = {}) {
	const platform = opts.platform ?? (await getMemoryPlatform());
	return renderProjectMemoryMarkdown(await platform.getAll(scope));
}

/**
 * Clear a scope (getAll + delete each). Scenarios wipe before seeding so a
 * re-run never inherits the previous attempt's platform state — the scope-level
 * equivalent of the old stateless chatJson dream, keeping resume semantics
 * honest now that the platform persists across steps.
 */
export async function wipeScope(scope, opts = {}) {
	const platform = opts.platform ?? (await getMemoryPlatform());
	const memories = await platform.getAll(scope);
	for (const m of memories) await platform.delete(m.id).catch(() => {});
	return memories.length;
}
