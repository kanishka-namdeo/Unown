/**
 * dream.ts — Auto Dreaming (pattern 4/5), Mem0-backed (the learning-core swap).
 *
 * The consolidation sub-agent that periodically consumes accumulated session
 * notes and writes the next version of project memory. Since the swap
 * (docs/memory-platform-swap-assessment.md) the engine behind it is **Mem0**
 * (src/memzero.ts): notes go in through mem0's extraction pipeline (atomic,
 * deduplicated, scoped memories), a thin reconcile pass resolves
 * contradictions and prunes staleness through mem0's own update/delete
 * primitives, and a deterministic render writes the same markdown files the
 * terminal agent always injected.
 *
 * Two consolidation paths (unchanged contracts):
 *   - benchmark notes -> the engine's own project memory (with a canary gate:
 *     the new memory must not break the last-passing task, else auto-rollback
 *     — the rollback now also reverts the mem0 event stream)
 *   - terminal notes   -> each real project's .unown/memory/project.md
 *     (versioned in the engine DB as tier "project:<slug>")
 *
 * Security posture (STRONGER than the pre-swap dream):
 *   quarantined notes (guard.ts scanUntrustedText) never reach the extraction
 *   LLM at all — the zero-extraction contract is structural. Defense in
 *   depth on the output side: every extracted memory is scanned before it
 *   survives the dream, and the rendered document passes decideGuardAction
 *   before anything ships (first-mint gate semantics preserved).
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { atomicWriteFileSync } from "./atomic.ts";
import { basenameSlug } from "./project-identity.ts";
import { emit } from "./bus.ts";
import { analyzeCanaryRun, canaryK, sampleCanaryTasks } from "./canary.ts";
import { decideGuardAction, guardSummary, scanUntrustedText, type GuardFlag } from "./guard.ts";
import { maxTierChars, currentVersion, readTier, rollback, writeTier } from "./memory.ts";
import {
        ENGINE_SCOPE,
        getMemoryPlatform,
        type MemoryPlatform,
        type MemoryPlatformEvent,
        type MemoryScope,
        type PlatformMemory,
        type ReconcileOp,
        importLegacyMarkdown,
        migrateLegacyScope,
        projectScope,
        reconcileMemories,
        renderProjectMemoryMarkdown,
        revertMemoryEvents,
} from "./memzero.ts";
import { markDreamed, pendingTerminalNotesByProject, undreamedNotes } from "./notes.ts";
import { mintSkillsForProject } from "./skills.ts";
import { hoistCrossProjectRules } from "./hoist.ts";
import { store } from "./store.ts";
import { initProjectMemory, isPristineSeedProjectMemory, projectMemoryPath, slugifyPath, writeProjectProvenance } from "./term.ts";

export interface DreamResult {
        id: string;
        status: "done" | "no-notes" | "error" | "gated" | "no-change";
        notesIn: number;
        merged: number;
        pruned: number;
        added: number;
        output: string;
        note?: string;
        error?: string;
        /** Guard outcome (review §5.1/§5.3): quarantined lines + rule ids. */
        guard?: { action: "ship" | "sanitize" | "gate"; flags: GuardFlag[]; summary: string };
}

/** Test seams for the engine dream: canary, platform, reconcile verdict. */
export interface DreamOpts {
        /** Test seam: inject a canary (or a crashing one) without the real agent loop. */
        canaryFn?: typeof canaryCheck;
        /** Test seam: inject the memory platform (defaults to the mem0 singleton). */
        platform?: MemoryPlatform;
        /** Test seam: inject the reconcile verdict without a real LLM call. */
        reconcileLlmFn?: (memories: PlatformMemory[]) => Promise<{ ops: ReconcileOp[] }>;
        /** The project's CURRENT memory file (runProjectDream) — its "## Manual
         *  notes" section survives the re-render verbatim (the hand-edit lane). */
        preserveManualNotesFrom?: string;
}

/** Resolve the platform once per pass (the seam tests override). */
async function platformOrSingleton(opts: DreamOpts): Promise<MemoryPlatform> {
        return opts.platform ?? (await getMemoryPlatform());
}

/** What one consolidation pass learned, for the dreams row + DreamResult. */
interface DreamOutcome {
        added: number;
        merged: number;
        pruned: number;
        quarantined: number;
        /** The quarantined note texts — the guard's layer-2.5 echo input. */
        quarantinedNoteTexts: string[];
        events: MemoryPlatformEvent[];
        rendered: string;
}

/**
 * Run one note-batch through the platform: quarantine filter (structural),
 * mem0 extraction (one call for the batch), guard sweep over the extracted
 * memories, reconcile pass, render. Shared by both dream paths.
 */
async function consolidate(
        scope: MemoryScope,
        notes: Array<{ id: string; content: string; created_at: number; run_id?: string | null }>,
        opts: DreamOpts = {},
): Promise<DreamOutcome> {
        const quarantinedNoteTexts: string[] = [];
        const cleanNotes: typeof notes = [];
        for (const n of notes) {
                const scan = scanUntrustedText(String(n.content ?? ""));
                if (scan.rules.length > 0) quarantinedNoteTexts.push(String(n.content));
                else cleanNotes.push(n);
        }
        // ONE extraction call for the whole batch (cost parity with the old
        // AutoDream single-call dream): clean notes as user-role messages.
        const platform = await platformOrSingleton(opts);
        let events: MemoryPlatformEvent[] = [];
        if (cleanNotes.length > 0) {
                events = await platform.add(
                        cleanNotes.map((n) => ({ role: "user" as const, content: String(n.content) })),
                        scope,
                        { kind: "terminal-note" },
                );
        }
        // Guard sweep: every extracted memory is scanned BEFORE it survives the
        // dream (the F4 paraphrase defense, now at atomic-memory granularity).
        const surviving: MemoryPlatformEvent[] = [];
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
        // surviving AutoDream judgment) applied through mem0 primitives.
        const reconcile = await reconcileMemories(scope, {
                platform,
                llmFn: opts.reconcileLlmFn,
        });
        const memories = await platform.getAll(scope);
        const rendered = renderProjectMemoryMarkdown(memories, {
                preserveManualNotesFrom: opts.preserveManualNotesFrom,
        });
        return {
                added: surviving.filter((e) => e.event === "ADD").length,
                merged: reconcile.merged,
                pruned: reconcile.pruned + guardDeleted,
                quarantined: quarantinedNoteTexts.length,
                quarantinedNoteTexts,
                // revertable = surviving ADDs + reconcile events (guard-deleted poison
                // is deliberately NOT revertable)
                events: [...surviving.filter((e) => e.event === "ADD"), ...reconcile.events],
                rendered,
        };
}

// ---------------------------------------------------------------------------
// Benchmark dream (engine's own project memory) — with the canary gate
// ---------------------------------------------------------------------------
export async function runDream(opts: DreamOpts = {}): Promise<DreamResult> {
        const id = randomUUID();
        const notes = undreamedNotes(24, "benchmark");

        if (notes.length === 0) {
                store.run(`INSERT INTO dreams (id, started_at, ended_at, status, notes_in) VALUES (?, ?, ?, 'no-notes', 0)`, [
                        id,
                        Date.now(),
                        Date.now(),
                ]);
                emit("dream:finished", { id, status: "no-notes" });
                return { id, status: "no-notes", notesIn: 0, merged: 0, pruned: 0, added: 0, output: "" };
        }

        store.run(`INSERT INTO dreams (id, started_at, status, notes_in) VALUES (?, ?, 'running', ?)`, [
                id,
                Date.now(),
                notes.length,
        ]);
        emit("dream:started", { id, notesIn: notes.length });

        try {
                const currentMemory = readTier("project");
                // Swap-boundary migration: a pre-swap engine has legacy tier content and
                // an empty platform scope — import the bullets verbatim BEFORE this
                // dream's render replaces the tier (seedMemoryIfEmpty normally does
                // this at boot; this guard covers dream-triggered paths and tests).
                const prePlatform = await platformOrSingleton(opts);
                if ((await prePlatform.getAll(ENGINE_SCOPE)).length === 0 && currentVersion("project") > 0) {
                        await importLegacyMarkdown(currentMemory, ENGINE_SCOPE, { platform: prePlatform });
                }
                const out = await consolidate(ENGINE_SCOPE, notes as any, opts);

                if (out.rendered.trim().length < 60 || !/^- /m.test(out.rendered)) {
                        // nothing substantive survived extraction (all quarantined, or the
                        // model found nothing durable): consume the notes, no version bump
                        markDreamed(
                                notes.map((n: any) => n.id),
                                id,
                        );
                        store.run(
                                `UPDATE dreams SET ended_at = ?, status = 'no-change', notes_in = ?, output = ?, note = ? WHERE id = ?`,
                                [Date.now(), notes.length, out.rendered, `no substantive memories extracted (${out.quarantined} quarantined)`, id],
                        );
                        emit("dream:finished", { id, status: "no-change", notesIn: notes.length });
                        return { id, status: "no-change", notesIn: notes.length, merged: 0, pruned: 0, added: 0, output: out.rendered };
                }

                // Honest no-change: an idempotent render (nothing learned, nothing
                // contradicted) consumes the notes without inflating versions —
                // mirrors the project path's contract.
                if (out.rendered.trim() === currentMemory.trim()) {
                        markDreamed(
                                notes.map((n: any) => n.id),
                                id,
                        );
                        store.run(
                                `UPDATE dreams SET ended_at = ?, status = 'no-change', notes_in = ?, output = ?, note = ? WHERE id = ?`,
                                [Date.now(), notes.length, out.rendered, `render idempotent (${out.quarantined} quarantined)`, id],
                        );
                        emit("dream:finished", { id, status: "no-change", notesIn: notes.length });
                        return { id, status: "no-change", notesIn: notes.length, merged: out.merged, pruned: out.pruned, added: 0, output: out.rendered };
                }

                // ---- Guard gate on the rendered document (§5.1 defense in depth).
                // quarantinedNotes is the layer-2.5 echo-backstop input — the key is
                // FIXED here: the pre-swap dream passed it under a wrong property name,
                // so the backstop never actually saw the texts. Structural quarantine
                // (notes never reach the extraction LLM) is the primary layer now; this
                // restores the second layer for defense in depth.
                const guard = decideGuardAction(`${out.rendered}\n`, currentMemory, {
                        firstMint: currentVersion("project") <= 1, // v1 is the seed
                        quarantinedNotes: out.quarantinedNoteTexts,
                });
                if (guard.action === "gate") {
                        await revertMemoryEvents(out.events, ENGINE_SCOPE, { platform: opts.platform });
                        markDreamed(
                                notes.map((n: any) => n.id),
                                id,
                        );
                        store.run(
                                `UPDATE dreams SET ended_at = ?, status = 'gated', entries_merged = ?, entries_pruned = ?, entries_added = ?, output = ?, note = ? WHERE id = ?`,
                                [Date.now(), out.merged, out.pruned, out.added, out.rendered, `${guard.reason} · ${guardSummary(guard)}`, id],
                        );
                        emit("dream:finished", { id, status: "gated", notesIn: notes.length, reason: guard.reason, guard: guard.flags.map((f) => f.rule) });
                        return {
                                id,
                                status: "gated",
                                notesIn: notes.length,
                                merged: out.merged,
                                pruned: out.pruned,
                                added: out.added,
                                output: out.rendered,
                                note: guard.reason,
                                guard: { action: "gate", flags: guard.flags, summary: guardSummary(guard) },
                        };
                }

                const version = writeTier(
                        "project",
                        out.rendered,
                        "mem0",
                        `consolidated ${notes.length} notes via Mem0 (added ${out.added}, merged ${out.merged}, pruned ${out.pruned}${out.quarantined > 0 ? `, ${out.quarantined} quarantined` : ""})`,
                );

                // ---- Canary gate: the new memory must not break the last-passing task.
                // A crashed canary is treated like a failed one: roll back (memory
                // version AND the mem0 event stream), consume the notes, record why.
                let gate: Awaited<ReturnType<typeof canaryCheck>>;
                try {
                        gate = await (opts.canaryFn ?? canaryCheck)(version);
                } catch (canaryErr: any) {
                        const reason = `canary crashed: ${canaryErr?.message ?? String(canaryErr)}`;
                        await revertMemoryEvents(out.events, ENGINE_SCOPE, { platform: opts.platform });
                        try {
                                if (version > 1) rollback("project", version - 1, reason);
                        } catch {
                                /* v1 seed — nothing below to roll back to */
                        }
                        markDreamed(
                                notes.map((n: any) => n.id),
                                id,
                        );
                        store.run(
                                `UPDATE dreams SET ended_at = ?, status = 'gated', entries_merged = ?, entries_pruned = ?, entries_added = ?, output = ?, note = ? WHERE id = ?`,
                                [Date.now(), out.merged, out.pruned, out.added, out.rendered, `canary infrastructure failure — memory rolled back to v${version - 1}: ${reason}`, id],
                        );
                        emit("dream:finished", { id, status: "gated", notesIn: notes.length, version: version - 1, reason });
                        return { id, status: "gated", notesIn: notes.length, merged: out.merged, pruned: out.pruned, added: out.added, output: out.rendered, note: reason };
                }
                if (gate.rolledBack) {
                        await revertMemoryEvents(out.events, ENGINE_SCOPE, { platform: opts.platform });
                        try {
                                if (version > 1) rollback("project", version - 1, `dream canary rolled back to v${version - 1}`);
                        } catch {
                                /* v1 seed */
                        }
                        markDreamed(
                                notes.map((n: any) => n.id),
                                id,
                        );
                        store.run(
                                `UPDATE dreams SET ended_at = ?, status = 'gated', entries_merged = ?, entries_pruned = ?, entries_added = ?, output = ?, note = ? WHERE id = ?`,
                                [Date.now(), out.merged, out.pruned, out.added, out.rendered, `rolled back to v${version - 1}: canary task failed under the new memory (${gate.reason ?? "unknown"})`, id],
                        );
                        emit("dream:finished", { id, status: "gated", notesIn: notes.length, version: version - 1, reason: gate.reason });
                        return { id, status: "gated", notesIn: notes.length, merged: out.merged, pruned: out.pruned, added: out.added, output: out.rendered, note: "canary gate rolled the dream back" };
                }

                markDreamed(
                        notes.map((n: any) => n.id),
                        id,
                );
                store.run(
                        `UPDATE dreams SET ended_at = ?, status = 'done', entries_merged = ?, entries_pruned = ?, entries_added = ?, output = ?, note = ? WHERE id = ?`,
                        [
                                Date.now(),
                                out.merged,
                                out.pruned,
                                out.added,
                                out.rendered,
                                `project memory -> v${version} · ${canaryNote(gate)} · ${guardSummary(guard)}`,
                                id,
                        ],
                );
                emit("dream:finished", { id, status: "done", notesIn: notes.length, stats: { merged: out.merged, pruned: out.pruned, added: out.added }, version, guard: guard.flags.map((f) => f.rule) });
                return {
                        id,
                        status: "done",
                        notesIn: notes.length,
                        merged: out.merged,
                        pruned: out.pruned,
                        added: out.added,
                        output: out.rendered,
                        guard: { action: guard.action, flags: guard.flags, summary: guardSummary(guard) },
                };
        } catch (err: any) {
                const msg = err?.message ?? String(err);
                store.run(`UPDATE dreams SET ended_at = ?, status = 'error', note = ? WHERE id = ?`, [Date.now(), msg, id]);
                emit("dream:finished", { id, status: "error", error: msg });
                return { id, status: "error", notesIn: notes.length, merged: 0, pruned: 0, added: 0, output: "", error: msg };
        }
}

/** Compact canary outcome for dream rows (§5.2): the per-sample verdicts. */
function canaryNote(gate: { skipped?: boolean; reason?: string; canaries?: string[] }): string {
        if (gate.canaries?.length) return `canaries: ${gate.canaries.join("; ")}`;
        if (gate.skipped) return `canary unavailable: ${gate.reason ?? "unknown"}`;
        return "canary passed";
}

/**
 * Canary gate for dreams (§5.2: K stratified samples + behavioral analysis).
 *
 * For each sampled task (PI_DREAM_CANARY_K, default 3 — the most recent
 * PASSING run per DISTINCT task): re-run it under the new memory and compare
 * against its reference run. Gate (rollback) when a canary FAILS, when its
 * runner set DRIFTS from the reference (the memory redirected the agent's
 * verification tooling — the live F4 signature), or when its final report
 * claims verification it never ran (self-verification corruption). An
 * infrastructure ERROR on a canary skips that sample (recorded), keeping the
 * dream. Returns { skipped } when sampling is disabled or unavailable.
 */
export async function canaryCheck(
        newVersion: number,
        opts?: { runAgentFn?: (o: any) => Promise<{ status: string; transcript?: unknown; lastAssistantText?: string }> },
): Promise<{ rolledBack: boolean; skipped?: boolean; reason?: string; canaries?: string[] }> {
        const k = canaryK();
        if (k <= 0) return { rolledBack: false, skipped: true, reason: "canary sampling disabled (PI_DREAM_CANARY_K<=0)" };
        const samples = sampleCanaryTasks(k);
        if (samples.length === 0) return { rolledBack: false, skipped: true, reason: "no previously-passing task" };
        if (process.env.PI_DREAM_GATE === "0") return { rolledBack: false, skipped: true, reason: "gate disabled" };

        const { runAgent, getRun } = await import("./runner.ts");
        const { getTask } = await import("./tasks.ts");
        const runAgentFn = opts?.runAgentFn ?? runAgent;
        const outcomes: string[] = [];

        for (const sample of samples) {
                const task = getTask(sample.taskId);
                if (!task) {
                        outcomes.push(`${sample.taskId}: task missing (skipped)`);
                        continue;
                }
                const result = await runAgentFn({
                        taskId: task.id,
                        kind: "regression",
                        prompt: task.prompt,
                        files: task.files,
                        verify: task.verify,
                        label: `dream-canary-${task.id}`,
                });
                if (result.status === "failed") {
                        rollback("project", newVersion - 1, `dream canary failed on ${task.id} — consolidation rolled back`);
                        return {
                                rolledBack: true,
                                reason: `canary ${task.id} failed under new memory v${newVersion}`,
                                canaries: [...outcomes, `${task.id}: FAILED`],
                        };
                }
                if (result.status === "error") {
                        outcomes.push(`${sample.taskId}: infrastructure error (skipped)`);
                        continue;
                }
                // §5.2 behavioral checks: compare the passing canary against the
                // task's reference run (its most recent passing baseline/candidate).
                const reference = getRun(sample.referenceRunId);
                const analysis = analyzeCanaryRun(result, reference ?? null);
                if (analysis.drift || analysis.claimMismatch) {
                        rollback(
                                "project",
                                newVersion - 1,
                                `dream canary gated on ${task.id}: ${analysis.reason} — consolidation rolled back`,
                        );
                        return {
                                rolledBack: true,
                                reason: `canary ${task.id}: ${analysis.reason}`,
                                canaries: [...outcomes, `${task.id}: GATED (${analysis.drift ? "drift" : "claim"})`],
                        };
                }
                outcomes.push(
                        `${sample.taskId}: passed (runners: ${analysis.executedRunners.join(", ") || "none"}${
                                analysis.claimedRunners.length ? `; claimed: ${analysis.claimedRunners.join(", ")}` : ""
                        }${analysis.referenceUnavailable ? "; reference unavailable" : ""})`,
                );
        }
        // Every sample missing/erroring means the canary could not actually run.
        const anyRan = outcomes.some((o) => o.includes("passed"));
        if (!anyRan) return { rolledBack: false, skipped: true, reason: `canaries unavailable (${outcomes.join("; ")})`, canaries: outcomes };
        return { rolledBack: false, canaries: outcomes };
}

// ---------------------------------------------------------------------------
// Project dream — terminal notes consolidated into each project's own memory
// ---------------------------------------------------------------------------
export interface ProjectDreamResult {
        slug: string;
        projectPath: string;
        notesIn: number;
        /** Cross-project hoist receipt (present only when PI_USER_TIER_HOIST=1). */
        hoist?: import("./hoist.ts").HoistResult;
        status: "done" | "no-change" | "error" | "gated";
        version?: number;
        note?: string;
        error?: string;
        skills?: Array<{ name: string; description: string }>;
        /** Guard outcome (review §5.1, F4B): the project path has no canary — the guard IS the gate. */
        guard?: { action: "ship" | "sanitize" | "gate"; flags: GuardFlag[]; summary: string };
}

export async function runProjectDream(opts: DreamOpts = {}): Promise<ProjectDreamResult[]> {
        // Start stamp for honest dream-duration accounting: the done/gated/error
        // INSERTs stamp both started_at and ended_at from THIS marker (0 ms only
        // when the group truly took no time).
        const projectDreamStartMs = Date.now();
        const groups = pendingTerminalNotesByProject(40);
        const results: ProjectDreamResult[] = [];

        for (const group of groups) {
                const notes = group.notes;
                let current = "";
                try {
                        initProjectMemory(group.projectPath);
                        current = readFileSync(projectMemoryPath(group.projectPath), "utf8");
                } catch (err: any) {
                        results.push({
                                slug: group.slug,
                                projectPath: group.projectPath,
                                notesIn: notes.length,
                                status: "error",
                                error: `cannot read project memory: ${err?.message ?? err}`,
                        });
                        continue;
                }

                try {
                        const scope = projectScope(group.slug);
                        const prePlatform = await platformOrSingleton(opts);
                        // Composite-slug migration (project-identity.ts, 2026-10-22):
                        // scopes keyed by basename alone let two same-named directories
                        // share one memory bank (cross-project leak) and split on
                        // checkout rename. The composite key fixes both; this moves an
                        // established legacy scope's memories across verbatim the first
                        // time the project dreams under its composite key. Idempotent —
                        // a non-empty destination is a no-op — and the legacy scope is
                        // kept as the audit/rollback surface (it just never grows again).
                        const legacySlug = basenameSlug(group.projectPath);
                        if (legacySlug !== group.slug) {
                                const migrated = await migrateLegacyScope(projectScope(legacySlug), scope, { platform: prePlatform });
                                if (migrated > 0) {
                                        emit("dream:note", { project: group.slug, detail: `migrated ${migrated} legacy-scope memories onto the composite key` });
                                }
                        }
                        // Swap-boundary migration: the terminal project's memory file IS the
                        // source of truth pre-swap — import its bullets into the platform
                        // (verbatim, kind legacy) before the first render rewrites the file,
                        // so an established project's accumulated learning survives the swap.
                        if ((await prePlatform.getAll(scope)).length === 0 && !isPristineSeedProjectMemory(current)) {
                                await importLegacyMarkdown(current, scope, { platform: prePlatform });
                        }
                        const out = await consolidate(scope, notes as any, {
                                ...opts,
                                preserveManualNotesFrom: current,
                        });
                        const next = out.rendered;
                        const cap = maxTierChars();
                        if (next.length > cap)
                                throw new Error(`project dream render (${next.length} chars) exceeds cap ${cap} — project memory preserved`);

                        // Nothing substantive survived (all notes quarantined, nothing
                        // extracted): consume the notes, keep the current file untouched —
                        // never write an empty skeleton over a project's memory.
                        if (!/^- /m.test(next)) {
                                const dreamId = `project-${randomUUID()}`;
                                store.run(
                                        `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, output, note) VALUES (?, ?, ?, 'done', ?, ?, ?)`,
                                        [dreamId, projectDreamStartMs, Date.now(), notes.length, next, `project dream: ${group.slug} — no substantive memories extracted (${out.quarantined} quarantined), file untouched`],
                                );
                                markDreamed(
                                        notes.map((n: any) => n.id),
                                        dreamId,
                                );
                                emit("dream:finished", { id: dreamId, status: "done", notesIn: notes.length, project: group.slug });
                                results.push({
                                        slug: group.slug,
                                        projectPath: group.projectPath,
                                        notesIn: notes.length,
                                        status: "no-change",
                                        note: `no substantive memories (${out.quarantined} quarantined) — file untouched`,
                                });
                                continue;
                        }

                        // ---- Guard gate (review §5.1, F4B). The project path has NO
                        // canary (nothing re-runs a terminal session's ground truth),
                        // so this deterministic gate is the defense. First mint: any
                        // flagged content gates the whole write (an attacker seeding a
                        // pristine project's memory is the highest-leverage move).
                        // Later mints: flagged memories were already deleted in the
                        // consolidate() sweep; this backstop gates the whole dream if
                        // something still trips it.
                        const tierKey = `project:${group.slug}`;
                        const hadVersions =
                                store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM memory_versions WHERE tier = ?`, [tierKey])!
                                        .n > 0;
                        const guard = decideGuardAction(`${next}\n`, current, {
                                firstMint: !hadVersions && isPristineSeedProjectMemory(current),
                                quarantinedNotes: out.quarantinedNoteTexts, // the layer-2.5 echo backstop (see the engine-path note)
                        });
                        if (guard.action === "gate") {
                                await revertMemoryEvents(out.events, scope, { platform: opts.platform });
                                const dreamId = `project-${randomUUID()}`;
                                store.run(
                                        `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, output, note) VALUES (?, ?, ?, 'gated', ?, ?, ?)`,
                                        [dreamId, projectDreamStartMs, Date.now(), notes.length, next, `${guard.reason} · ${guardSummary(guard)}`],
                                );
                                markDreamed(
                                        notes.map((n: any) => n.id),
                                        dreamId,
                                );
                                emit("dream:finished", { id: dreamId, status: "gated", notesIn: notes.length, project: group.slug, reason: guard.reason });
                                results.push({
                                        slug: group.slug,
                                        projectPath: group.projectPath,
                                        notesIn: notes.length,
                                        status: "gated",
                                        note: guard.reason,
                                        guard: { action: "gate", flags: guard.flags, summary: guardSummary(guard) },
                                });
                                continue;
                        }

                        // Honest no-change: idempotent render (nothing learned, nothing
                        // contradicted) consumes the notes without inflating versions.
                        if (next.trim() === current.trim()) {
                                const dreamId = `project-${randomUUID()}`;
                                store.run(
                                        `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, output, note) VALUES (?, ?, ?, 'done', ?, ?, ?)`,
                                        [dreamId, projectDreamStartMs, Date.now(), notes.length, next, `project dream: ${group.slug} memory unchanged (render idempotent)`],
                                );
                                markDreamed(
                                        notes.map((n: any) => n.id),
                                        dreamId,
                                );
                                emit("dream:finished", { id: dreamId, status: "done", notesIn: notes.length, project: group.slug });
                                results.push({
                                        slug: group.slug,
                                        projectPath: group.projectPath,
                                        notesIn: notes.length,
                                        status: "no-change",
                                        note: "render idempotent — no version bump",
                                });
                                continue;
                        }

                        // Version it in the engine DB under a synthetic tier so history/rollback
                        // works. DB-FIRST inside BEGIN IMMEDIATE, mirroring writeTier's
                        // durability model — the version row commits durably BEFORE the file is
                        // touched, and the transaction serializes allocation across concurrent
                        // project dreams.
                        store.run(`BEGIN IMMEDIATE`);
                        let version: number;
                        try {
                                const versionRow = store.get<{ version: number }>(
                                        `SELECT MAX(version) AS version FROM memory_versions WHERE tier = ?`,
                                        [tierKey],
                                );
                                version = (versionRow?.version ?? 0) + 1;
                                store.run(
                                        `INSERT INTO memory_versions (tier, version, content, changed_by, note, created_at) VALUES (?, ?, ?, 'mem0', ?, ?)`,
                                        [
                                                tierKey,
                                                version,
                                                next,
                                                `consolidated ${notes.length} terminal notes for ${group.slug} via Mem0 (added ${out.added}, merged ${out.merged}, pruned ${out.pruned}${out.quarantined > 0 ? `, ${out.quarantined} quarantined` : ""})`,
                                                Date.now(),
                                        ],
                                );
                                store.run(`COMMIT`);
                        } catch (err: any) {
                                try {
                                        store.run(`ROLLBACK`);
                                } catch {
                                        /* already rolled back */
                                }
                                throw err;
                        }

                        // Write the project's memory file atomically (tmp+fsync+rename): a crash
                        // mid-dream never leaves a truncated .unown/memory/project.md in the
                        // user's repo (the terminal agent reads this next session).
                        const memPath = projectMemoryPath(group.projectPath);
                        atomicWriteFileSync(memPath, next);
                        // M10 provenance sidecar: record WHAT was written (sha256) so the
                        // DB-free terminal side can tell dreamed project memory from
                        // repo-supplied or hand-edited files at injection time — the honesty
                        // fix for the cloned-repo "maintained by AutoDream" false-authority
                        // gap (docs/detached-engine-architecture.md F16).
                        writeProjectProvenance(group.projectPath, {
                                version,
                                changedBy: "mem0",
                                at: Date.now(),
                                sha256: createHash("sha256").update(next, "utf8").digest("hex"),
                        });

                        // All terminal notes for this project are consumed by this dream.
                        const dreamId = `project-${randomUUID()}`;
                        store.run(
                                `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, output, note) VALUES (?, ?, ?, 'done', ?, ?, ?)`,
                                [
                                        dreamId,
                                        projectDreamStartMs,
                                        Date.now(),
                                        notes.length,
                                        next,
                                        `project dream: ${group.slug} memory -> v${version} (${group.projectPath})`,
                                ],
                        );
                        markDreamed(
                                notes.map((n: any) => n.id),
                                dreamId,
                        );
                        emit("dream:finished", { id: dreamId, status: "done", notesIn: notes.length, project: group.slug, version });

                        // ---- Skill acquisition: recurring procedures become Agent Skills ----
                        const notesText = notes
                                .map((n: any) => `--- note (${new Date(n.created_at).toISOString()}) terminal session ---\n${n.content}`)
                                .join("\n\n");
                        const skills = await mintSkillsForProject({
                                projectPath: group.projectPath,
                                slug: group.slug,
                                consolidatedMemory: next,
                                notesText,
                                dreamId,
                        });

                        // ---- Cross-project hoist (user-tier dream path):
                        // opt-in (PI_USER_TIER_HOIST=1). Runs AFTER the ship; a null
                        // return means the feature is off. "Hoist nothing" is a
                        // correct outcome — the transfer bench measured that carrying
                        // project-bound rules verbatim HURTS other projects; this pass
                        // keeps only what abstracts.
                        const hoist = await hoistCrossProjectRules({
                                consolidatedMemory: next,
                                projectPath: group.projectPath,
                                slug: group.slug,
                        });

                        results.push({
                                slug: group.slug,
                                projectPath: group.projectPath,
                                notesIn: notes.length,
                                status: "done",
                                version,
                                note: `memory -> v${version}${skills.length > 0 ? ` · minted ${skills.length} skill(s): ${skills.map((sk) => sk.name).join(", ")}` : ""}${hoist && hoist.hoisted > 0 ? ` · hoisted ${hoist.hoisted} rule(s) to the user tier` : ""} · ${guardSummary(guard)}`,
                                skills: skills.map((sk) => ({ name: sk.name, description: sk.description })),
                                guard: { action: guard.action, flags: guard.flags, summary: guardSummary(guard) },
                                hoist: hoist ?? undefined,
                        });
                } catch (err: any) {
                        const msg = err?.message ?? String(err);
                        const dreamId = `project-${randomUUID()}`;
                        store.run(
                                `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, note) VALUES (?, ?, ?, 'error', ?, ?)`,
                                [dreamId, projectDreamStartMs, Date.now(), notes.length, `project dream error (${group.slug}): ${msg}`],
                        );
                        emit("dream:finished", { id: dreamId, status: "error", project: group.slug, error: msg });
                        results.push({
                                slug: group.slug,
                                projectPath: group.projectPath,
                                notesIn: notes.length,
                                status: "error",
                                error: msg,
                        });
                }
        }
        return results;
}

export function listDreams(limit = 30) {
        return store.query<any>(`SELECT * FROM dreams ORDER BY started_at DESC LIMIT ?`, [limit]);
}

export function dreamNotes(dreamId: string) {
        return store.query<any>(`SELECT * FROM notes WHERE dream_id = ? ORDER BY created_at`, [dreamId]);
}

export { slugifyPath };
