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
import { emit } from "./bus.ts";
import { analyzeCanaryRun, canaryK, sampleCanaryTasks } from "./canary.ts";
import { decideGuardAction, type GuardFlag, guardSummary, scanUntrustedText } from "./guard.ts";
import { hoistCrossProjectRules } from "./hoist.ts";
import { currentVersion, maxTierChars, readTier, rollback, writeTier } from "./memory.ts";
import {
        ENGINE_SCOPE,
        extractManualNotesSection,
        getMemoryPlatform,
        importLegacyMarkdown,
        type MemoryPlatform,
        type MemoryPlatformEvent,
        type MemoryScope,
        migrateLegacyScope,
        type PlatformMemory,
        projectScope,
        type ReconcileOp,
        reconcileMemories,
        renderProjectMemoryMarkdown,
        revertMemoryEvents,
        stripSessionMetadataLine,
} from "./memzero.ts";
import { markDreamed, pendingTerminalNotesByProject, undreamedNotes } from "./notes.ts";
import { basenameSlug } from "./project-identity.ts";
import { getPendingDream, hasPendingDream, parkPendingDream, removePendingDream, type PendingEvent } from "./dream-review.ts";
import { loadHubPrefs } from "./settings/prefs.ts";
import { mintSkillsForProject } from "./skills.ts";
import { store } from "./store.ts";
import {
        initProjectMemory,
        isPristineSeedProjectMemory,
        PROJECT_SEED,
        projectMemoryPath,
        readProjectProvenance,
        slugifyPath,
        writeProjectProvenance,
} from "./term.ts";

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
                // Harness telemetry is not note content (2026-10-22): strip the
                // session-metadata line BEFORE the quarantine scan — it names the
                // session's tools ("bash, write, edit") and the guard's
                // runner+directive conjunction read "never extractable … bash" as a
                // directive, quarantining every bash-using session's note wholesale
                // since the metadata line became universal. Also the extraction
                // input: "never extractable" is now enforced deterministically on
                // the PRIMARY path, not only the reframe retry.
                const content = stripSessionMetadataLine(String(n.content ?? ""));
                const scan = scanUntrustedText(content);
                if (scan.rules.length > 0) quarantinedNoteTexts.push(content);
                else cleanNotes.push({ ...n, content });
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
                                [
                                        Date.now(),
                                        notes.length,
                                        out.rendered,
                                        `no substantive memories extracted (${out.quarantined} quarantined)`,
                                        id,
                                ],
                        );
                        emit("dream:finished", { id, status: "no-change", notesIn: notes.length });
                        return {
                                id,
                                status: "no-change",
                                notesIn: notes.length,
                                merged: 0,
                                pruned: 0,
                                added: 0,
                                output: out.rendered,
                        };
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
                        return {
                                id,
                                status: "no-change",
                                notesIn: notes.length,
                                merged: out.merged,
                                pruned: out.pruned,
                                added: 0,
                                output: out.rendered,
                        };
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
                                [
                                        Date.now(),
                                        out.merged,
                                        out.pruned,
                                        out.added,
                                        out.rendered,
                                        `${guard.reason} · ${guardSummary(guard)}`,
                                        id,
                                ],
                        );
                        emit("dream:finished", {
                                id,
                                status: "gated",
                                notesIn: notes.length,
                                reason: guard.reason,
                                guard: guard.flags.map((f) => f.rule),
                        });
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
                                [
                                        Date.now(),
                                        out.merged,
                                        out.pruned,
                                        out.added,
                                        out.rendered,
                                        `canary infrastructure failure — memory rolled back to v${version - 1}: ${reason}`,
                                        id,
                                ],
                        );
                        emit("dream:finished", { id, status: "gated", notesIn: notes.length, version: version - 1, reason });
                        return {
                                id,
                                status: "gated",
                                notesIn: notes.length,
                                merged: out.merged,
                                pruned: out.pruned,
                                added: out.added,
                                output: out.rendered,
                                note: reason,
                        };
                }
                if (gate.rolledBack) {
                        // The canary's mem0 events are ALWAYS reverted here — canaryCheck
                        // never touches the platform (its rollback is version-tier only).
                        await revertMemoryEvents(out.events, ENGINE_SCOPE, { platform: opts.platform });
                        // Double-rollback fix: canaryCheck rolls the VERSION back itself and
                        // reports it via rolledBackVersion — rolling back again here minted a
                        // second, redundant version row (identical N-1 content) plus a
                        // duplicate memory:changed event on every gated dream. Only a legacy
                        // canaryFn that returns rolledBack:true without acting (no
                        // rolledBackVersion) still gets runDream's own rollback.
                        if (gate.rolledBackVersion === undefined) {
                                try {
                                        if (version > 1) rollback("project", version - 1, `dream canary rolled back to v${version - 1}`);
                                } catch {
                                        /* v1 seed */
                                }
                        }
                        markDreamed(
                                notes.map((n: any) => n.id),
                                id,
                        );
                        store.run(
                                `UPDATE dreams SET ended_at = ?, status = 'gated', entries_merged = ?, entries_pruned = ?, entries_added = ?, output = ?, note = ? WHERE id = ?`,
                                [
                                        Date.now(),
                                        out.merged,
                                        out.pruned,
                                        out.added,
                                        out.rendered,
                                        `rolled back to v${version - 1}: canary task failed under the new memory (${gate.reason ?? "unknown"})`,
                                        id,
                                ],
                        );
                        emit("dream:finished", {
                                id,
                                status: "gated",
                                notesIn: notes.length,
                                version: version - 1,
                                reason: gate.reason,
                        });
                        return {
                                id,
                                status: "gated",
                                notesIn: notes.length,
                                merged: out.merged,
                                pruned: out.pruned,
                                added: out.added,
                                output: out.rendered,
                                note: "canary gate rolled the dream back",
                        };
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
                emit("dream:finished", {
                        id,
                        status: "done",
                        notesIn: notes.length,
                        stats: { merged: out.merged, pruned: out.pruned, added: out.added },
                        version,
                        guard: guard.flags.map((f) => f.rule),
                });
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
                const msg = err instanceof Error ? err.message : String(err);
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
 *
 * ROLLBACK OWNERSHIP (the double-rollback fix, 2026-10-22): this function
 * performs the memory-version rollback ITSELF and reports it via
 * `rolledBackVersion` — the version it rolled the tier back TO. runDream
 * reads that field and does NOT roll back again: the pre-fix caller rolled
 * back a second time on `rolledBack: true`, minting a redundant version row
 * (identical N-1 content) and a duplicate memory:changed event for every
 * gated dream. A `rolledBack: true` WITHOUT `rolledBackVersion` (a legacy
 * injected canaryFn that gated without acting) still gets runDream's own
 * rollback — backwards compatible with the test seam's older fakes.
 */
export async function canaryCheck(
        newVersion: number,
        opts?: { runAgentFn?: (o: any) => Promise<{ status: string; transcript?: unknown; lastAssistantText?: string }> },
): Promise<{ rolledBack: boolean; rolledBackVersion?: number; skipped?: boolean; reason?: string; canaries?: string[] }> {
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
                        // Verify-twice for the canary's OWN verdict (2026-10-23, the
                        // flaky-reference find): sampleCanaryTasks picks the most recent
                        // passing baseline/candidate per task — but a hard minted task
                        // that passes only SOMETIMES (measured live: a minted
                        // multiplier-label-buzz variant, one passing candidate at 08:56,
                        // failures around it) turns the canary into a coin flip and
                        // gates ~every other dream on upstream variance, not on the
                        // memory. The harness itself never ships a patch on a single
                        // pass (verify-twice); the canary gate now holds itself to the
                        // same standard — a FAILED canary is re-run ONCE before the
                        // dream is rolled back. Two failures = deterministic evidence
                        // against the new memory; one failure + one pass = a flaky
                        // reference, recorded, dream proceeds. Drift/claim analysis is
                        // exempt (it reads the run's transcript, not its luck).
                        const confirm = await runAgentFn({
                                taskId: task.id,
                                kind: "regression",
                                prompt: task.prompt,
                                files: task.files,
                                verify: task.verify,
                                label: `dream-canary-confirm-${task.id}`,
                        });
                        if (confirm.status === "failed") {
                                rollback("project", newVersion - 1, `dream canary failed on ${task.id} — consolidation rolled back`);
                                return {
                                        rolledBack: true,
                                        // Observable rollback ownership: runDream must not roll back again
                                        // (one rollback, one version row, one memory:changed event).
                                        rolledBackVersion: newVersion - 1,
                                        reason: `canary ${task.id} failed twice under new memory v${newVersion} (verify-twice)`,
                                        canaries: [...outcomes, `${task.id}: FAILED x2 (verify-twice)`],
                                };
                        }
                        if (confirm.status === "error") {
                                // The confirmation died on infrastructure: the single
                                // failure stands unconfirmed — conservative gate (the
                                // pre-fix behavior for this sample).
                                rollback("project", newVersion - 1, `dream canary failed on ${task.id} (confirmation errored) — consolidation rolled back`);
                                return {
                                        rolledBack: true,
                                        rolledBackVersion: newVersion - 1,
                                        reason: `canary ${task.id} failed under new memory v${newVersion}; confirmation errored`,
                                        canaries: [...outcomes, `${task.id}: FAILED (confirm: infra error)`],
                                };
                        }
                        outcomes.push(`${sample.taskId}: flaky reference (failed once, passed on confirmation — not gated)`);
                        continue;
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
                                // Observable rollback ownership — see the failed-branch comment above.
                                rolledBackVersion: newVersion - 1,
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
        if (!anyRan)
                return {
                        rolledBack: false,
                        skipped: true,
                        reason: `canaries unavailable (${outcomes.join("; ")})`,
                        canaries: outcomes,
                };
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
                                error: `cannot read project memory: ${err instanceof Error ? err.message : String(err)}`,
                        });
                        continue;
                }

                // Review-mode gate (dream-review.ts): while a pending dream exists
                // for a project, its dreams are skipped — a later render (from the
                // platform, which already carries the parked events) must never ship
                // the parked memories around the user's review. The gate is
                // UNCONDITIONAL on pending existence: turning review mode back off
                // does not auto-ship what was parked.
                if (hasPendingDream(group.projectPath)) {
                        results.push({
                                slug: group.slug,
                                projectPath: group.projectPath,
                                notesIn: notes.length,
                                status: "pending-review",
                                note: "a dream is parked for review — approve or discard it in /settings → Learning before this project dreams again",
                        });
                        continue;
                }

                // Hoisted so the catch below can unwind a PARTIALLY-APPLIED dream:
                // `out` is set once consolidate() has written platform events, and
                // `shippedThisDream` flips when the version row COMMITS (the memory
                // is live from that point — later failures must not unwind it).
                let scope: MemoryScope | null = null;
                let out: Awaited<ReturnType<typeof consolidate>> | null = null;
                let shippedThisDream = false;
                try {
                        scope = projectScope(group.slug);
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
                                        emit("dream:note", {
                                                project: group.slug,
                                                detail: `migrated ${migrated} legacy-scope memories onto the composite key`,
                                        });
                                }
                        }
                        // Swap-boundary migration: the terminal project's memory file IS the
                        // source of truth pre-swap — import its bullets into the platform
                        // (verbatim, kind legacy) before the first render rewrites the file,
                        // so an established project's accumulated learning survives the swap.
                        if ((await prePlatform.getAll(scope)).length === 0 && !isPristineSeedProjectMemory(current)) {
                                await importLegacyMarkdown(current, scope, { platform: prePlatform });
                        }
                        out = await consolidate(scope, notes as any, {
                                ...opts,
                                preserveManualNotesFrom: current,
                        });
                        const next = out.rendered;
                        const cap = maxTierChars();
                        if (next.length > cap) {
                                // Bounded-refusal gate (the 2026-10-22 partial-ship fix): the
                                // render refuses to ship — the platform events this dream
                                // just wrote are NOT reflected by any version row, so they are
                                // reverted (platform and file stay consistent) and the notes
                                // are CONSUMED: the pre-fix code threw into the generic catch,
                                // which neither reverted nor consumed — the same notes were
                                // re-dreamed into the same oversized render forever (the
                                // infinite dream loop). Status 'gated' mirrors the guard gate:
                                // a deterministic policy refusal, honestly recorded.
                                await revertMemoryEvents(out.events, scope, { platform: opts.platform });
                                const dreamId = `project-${randomUUID()}`;
                                store.run(
                                        `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, entries_added, output, note) VALUES (?, ?, ?, 'gated', ?, ?, ?, ?)`,
                                        [
                                                dreamId,
                                                projectDreamStartMs,
                                                Date.now(),
                                                notes.length,
                                                0,
                                                next,
                                                `project dream: ${group.slug} render (${next.length} chars) exceeds cap ${cap} — platform events reverted, file preserved`,
                                        ],
                                );
                                markDreamed(
                                        notes.map((n: any) => n.id),
                                        dreamId,
                                );
                                emit("dream:finished", {
                                        id: dreamId,
                                        status: "gated",
                                        notesIn: notes.length,
                                        project: group.slug,
                                        reason: `render exceeds cap (${next.length} > ${cap})`,
                                });
                                results.push({
                                        slug: group.slug,
                                        projectPath: group.projectPath,
                                        notesIn: notes.length,
                                        status: "gated",
                                        note: `render exceeds cap (${next.length} chars > ${cap}) — platform reverted, file preserved, notes consumed`,
                                });
                                continue;
                        }

                        // Nothing substantive survived (all notes quarantined, nothing
                        // extracted): consume the notes, keep the current file untouched —
                        // never write an empty skeleton over a project's memory.
                        if (!/^- /m.test(next)) {
                                const dreamId = `project-${randomUUID()}`;
                                store.run(
                                        `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, entries_added, output, note) VALUES (?, ?, ?, 'done', ?, ?, ?, ?)`,
                                        [
                                                dreamId,
                                                projectDreamStartMs,
                                                Date.now(),
                                                notes.length,
                                                0,
                                                next,
                                                `project dream: ${group.slug} — no substantive memories extracted (${out.quarantined} quarantined), file untouched`,
                                        ],
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
                                store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM memory_versions WHERE tier = ?`, [tierKey])!.n > 0;
                        const guard = decideGuardAction(`${next}\n`, current, {
                                firstMint: !hadVersions && isPristineSeedProjectMemory(current),
                                quarantinedNotes: out.quarantinedNoteTexts, // the layer-2.5 echo backstop (see the engine-path note)
                        });
                        if (guard.action === "gate") {
                                await revertMemoryEvents(out.events, scope, { platform: opts.platform });
                                const dreamId = `project-${randomUUID()}`;
                                store.run(
                                        `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, entries_added, output, note) VALUES (?, ?, ?, 'gated', ?, ?, ?, ?)`,
                                        [
                                                dreamId,
                                                projectDreamStartMs,
                                                Date.now(),
                                                notes.length,
                                                0,
                                                next,
                                                `${guard.reason} · ${guardSummary(guard)}`,
                                        ],
                                );
                                markDreamed(
                                        notes.map((n: any) => n.id),
                                        dreamId,
                                );
                                emit("dream:finished", {
                                        id: dreamId,
                                        status: "gated",
                                        notesIn: notes.length,
                                        project: group.slug,
                                        reason: guard.reason,
                                });
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
                                        `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, entries_added, output, note) VALUES (?, ?, ?, 'done', ?, ?, ?, ?)`,
                                        [
                                                dreamId,
                                                projectDreamStartMs,
                                                Date.now(),
                                                notes.length,
                                                0,
                                                next,
                                                `project dream: ${group.slug} memory unchanged (render idempotent)`,
                                        ],
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

                        // The write target honors the guard's sanitize verdict
                        // (2026-10-22): the sanitize action used to be decorative here — the
                        // version row, the file write and the sidecar all recorded `next`,
                        // never `guard.sanitized`, so flagged lines (including any preserved
                        // Manual-notes lines the sweep caught) actually shipped. Everything
                        // downstream now uses toWrite.
                        const toWrite =
                                guard.action === "sanitize" && guard.sanitized.trim().length > 0 ? guard.sanitized : next;

                        // The version-row note (shared by the ship path and the review lane).
                        const dreamNote = `consolidated ${notes.length} terminal notes for ${group.slug} via Mem0 (added ${out.added}, merged ${out.merged}, pruned ${out.pruned}${out.quarantined > 0 ? `, ${out.quarantined} quarantined` : ""}${guard.action === "sanitize" ? `, guard sanitized ${guard.flags.length} line(s)` : ""})`;

                        // ---- Review mode (the settings hub's trust lane, dream-review.ts):
                        // a fully-passed dream PARKS instead of shipping. The rendered
                        // diff (post-guard, post-sanitize) lands in the project's
                        // pending-dreams lane with the platform events carried along;
                        // the notes are consumed so they cannot re-dream around the
                        // review. Approve commits exactly what was previewed; discard
                        // reverts the events (the cap-gate pattern). While a pending
                        // exists the project's dreams are skipped (the gate at the top
                        // of this loop) so a later render can never ship the parked
                        // memories first.
                        if (loadHubPrefs().learningReviewMode) {
                                const dreamId = `project-${randomUUID()}`;
                                parkPendingDream({
                                        id: dreamId,
                                        slug: group.slug,
                                        projectPath: group.projectPath,
                                        createdAt: Date.now(),
                                        notesIn: notes.length,
                                        toWrite,
                                        current,
                                        events: (out.events ?? []) as PendingEvent[],
                                        summary: `added ${out.added}, merged ${out.merged}, pruned ${out.pruned}${out.quarantined > 0 ? `, ${out.quarantined} quarantined` : ""}${guard.action === "sanitize" ? `, guard sanitized ${guard.flags.length} line(s)` : ""}`,
                                        note: dreamNote,
                                });
                                store.run(
                                        `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, entries_added, output, note) VALUES (?, ?, ?, 'pending', ?, 0, ?, ?)`,
                                        [
                                                dreamId,
                                                projectDreamStartMs,
                                                Date.now(),
                                                notes.length,
                                                toWrite,
                                                `project dream: ${group.slug} parked for review — approve or discard in /settings → Learning`,
                                        ],
                                );
                                markDreamed(
                                        notes.map((n: any) => n.id),
                                        dreamId,
                                );
                                emit("dream:finished", {
                                        id: dreamId,
                                        status: "pending",
                                        notesIn: notes.length,
                                        project: group.slug,
                                        reason: "review mode: parked for user approval",
                                });
                                results.push({
                                        slug: group.slug,
                                        projectPath: group.projectPath,
                                        notesIn: notes.length,
                                        status: "pending-review",
                                        note: "parked for review — approve or discard in /settings → Learning → Dream review inbox",
                                });
                                continue;
                        }

                        // Version it in the engine DB under a synthetic tier so history/rollback
                        // works. DB-FIRST inside BEGIN IMMEDIATE, mirroring writeTier's
                        // durability model — the version row commits durably BEFORE the file is
                        // touched, and the transaction serializes allocation across concurrent
                        // project dreams. The block is shared with the review lane
                        // (approvePendingDream commits a parked dream through the exact same
                        // path — what was previewed is what ships).
                        const version = commitProjectMemoryVersion({
                                projectPath: group.projectPath,
                                tierKey,
                                toWrite,
                                current,
                                note: dreamNote,
                        });
                        // The version row is durable — the dream's memory is LIVE from
                        // here on. Failures after this point (file write, sidecar,
                        // skills minting, hoist) must NOT unwind the platform events:
                        // the catch below uses this flag as the unwind boundary.
                        shippedThisDream = true;

                        // All terminal notes for this project are consumed by this dream.
                        const dreamId = `project-${randomUUID()}`;
                        store.run(
                                `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, entries_added, output, note) VALUES (?, ?, ?, 'done', ?, ?, ?, ?)`,
                                [
                                        dreamId,
                                        projectDreamStartMs,
                                        Date.now(),
                                        notes.length,
                                        // entries_added (M3) feeds /api/overview's dreamNews — the "learned N
                                        // new rules" toast. ADDs that survived the guard + reconcile pass
                                        // (consolidate's `added`, the same count every receipt reports).
                                        out.added,
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
                        const msg = err instanceof Error ? err.message : String(err);
                        const dreamId = `project-${randomUUID()}`;
                        let note = `project dream error (${group.slug}): ${msg}`;
                        // Partial-apply unwind (the 2026-10-22 partial-ship fix), scoped to
                        // WHERE the dream died:
                        //  - events applied but the memory NOT yet live (pre-COMMIT failure):
                        //    revert the platform events (platform and file must not diverge)
                        //    and consume the notes — a deterministic failure here re-dreamed
                        //    the same notes forever pre-fix; a transient one loses one batch,
                        //    the honest price of never looping;
                        //  - nothing applied yet (pre-consolidate failure): keep the notes
                        //    undreamed — nothing diverged, retry is correct and lossless;
                        //  - memory already live (post-COMMIT failure: file write, sidecar,
                        //    skills minting, hoist): the ship stands; record the error only —
                        //    unwinding now would diverge file and platform the OTHER way.
                        if (out && scope && !shippedThisDream) {
                                const unwind = await revertMemoryEvents(out.events, scope, { platform: opts.platform });
                                markDreamed(
                                        notes.map((n: any) => n.id),
                                        dreamId,
                                );
                                note += ` · platform events reverted (${unwind.reverted} ok${unwind.errors.length ? `, ${unwind.errors.length} failed` : ""}), notes consumed`;
                        }
                        store.run(
                                `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, note) VALUES (?, ?, ?, 'error', ?, ?)`,
                                [dreamId, projectDreamStartMs, Date.now(), notes.length, note],
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

/**
 * M3: the newest project dream that ADDED memories — /api/overview's
 * dreamNews block, surfaced by the terminal status probe as a one-time
 * "AutoDream learned N new rules" toast in the session that works on that
 * project (engine-status.ts shouldToastDreamNews).
 *
 * WHERE: done + entries_added > 0 + ended within maxAgeMs. The slug and
 * version are parsed from the row's `note` ("project dream: <slug> memory ->
 * v<n> (<path>)") rather than carried in new columns: the format is written
 * one screen up in this same file, and `entries_added` has been a column
 * since the first schema (populated at every store site as of M3).
 * Engine-scope dreams share the table and DO populate entries_added, but
 * their note ("project memory -> v…") never matches the project-dream shape,
 * so they are skipped naturally — the scan walks the newest 8 candidates
 * and returns the first that parses, so an engine dream sitting on top of a
 * project dream does not shadow it. null = no news (the common case).
 */
export function latestDreamNews(
        maxAgeMs = 3_600_000,
): { id: string; project: string; added: number; version: number; at: number } | null {
        try {
                const rows = store.query<any>(
                        `SELECT id, ended_at, entries_added, note FROM dreams
                         WHERE status = 'done' AND entries_added > 0 AND ended_at IS NOT NULL AND ended_at > ?
                         ORDER BY ended_at DESC LIMIT 8`,
                        [Date.now() - maxAgeMs],
                );
                for (const r of rows) {
                        const m = /^project dream: (\S+) memory -> v(\d+)/.exec(String(r.note ?? ""));
                        if (!m) continue;
                        return {
                                id: String(r.id),
                                project: m[1],
                                added: Number(r.entries_added),
                                version: Number(m[2]),
                                at: Number(r.ended_at),
                        };
                }
                return null;
        } catch {
                return null; // a dreams-table hiccup must never 500 the overview probe
        }
}

export { slugifyPath };

// ---------------------------------------------------------------------------
// The review lane's commit + approve/discard (dream-review.ts parks;
// these ship or revert). The commit function is the EXACT block the auto
// ship path runs — extracted so an approved pending dream commits through
// the identical durability path (version row → atomic file → sidecar).
// ---------------------------------------------------------------------------

export function commitProjectMemoryVersion(args: {
        projectPath: string;
        tierKey: string;
        toWrite: string;
        current: string;
        note: string;
}): number {
        store.run(`BEGIN IMMEDIATE`);
        let version: number;
        try {
                const versionRow = store.get<{ version: number }>(
                        `SELECT MAX(version) AS version FROM memory_versions WHERE tier = ?`,
                        [args.tierKey],
                );
                version = (versionRow?.version ?? 0) + 1;
                store.run(
                        `INSERT INTO memory_versions (tier, version, content, changed_by, note, created_at) VALUES (?, ?, ?, 'mem0', ?, ?)`,
                        [args.tierKey, version, args.toWrite, args.note, Date.now()],
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
        // mid-commit never leaves a truncated .unown/memory/project.md in the
        // user's repo (the terminal agent reads this next session).
        atomicWriteFileSync(projectMemoryPath(args.projectPath), args.toWrite);

        // M10 provenance sidecar (v2, the SA2-B laundering fix): the sha256 of
        // what was written + the preserved Manual-notes section + the sticky
        // manualEdited flag — fail-closed in the honesty direction. See the
        // original block's history (2026-10-22) for the laundering attack this
        // closes: a sidecar that says "written by AutoDream" for text AutoDream
        // never authored.
        const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
        const prevMeta = readProjectProvenance(args.projectPath);
        const manualNow = extractManualNotesSection(args.current);
        const manualNext = extractManualNotesSection(args.toWrite);
        const seedManualSha = sha256Hex(extractManualNotesSection(PROJECT_SEED));
        const manualEdited =
                (prevMeta?.manualEdited ?? false) ||
                (prevMeta?.manualSha256 !== undefined
                        ? sha256Hex(manualNow) !== prevMeta.manualSha256
                        : manualNow.trim().length > 0 && sha256Hex(manualNow) !== seedManualSha) ||
                (sha256Hex(manualNext) !== sha256Hex(manualNow) && sha256Hex(manualNext) !== seedManualSha);
        writeProjectProvenance(args.projectPath, {
                version,
                changedBy: "mem0",
                at: Date.now(),
                sha256: sha256Hex(args.toWrite),
                manualSha256: sha256Hex(manualNext),
                manualEdited,
        });
        return version;
}

/** Approve a parked dream: commit exactly what was previewed. */
export async function approvePendingDream(args: {
        projectPath: string;
        id: string;
}): Promise<{ ok: boolean; detail: string }> {
        const pending = getPendingDream(args.projectPath, args.id);
        if (!pending) return { ok: false, detail: "pending dream not found" };
        const version = commitProjectMemoryVersion({
                projectPath: pending.projectPath,
                tierKey: `project:${pending.slug}`,
                toWrite: pending.toWrite,
                current: pending.current,
                note: pending.note,
        });
        store.run(`UPDATE dreams SET status = 'done', ended_at = ? WHERE id = ?`, [Date.now(), pending.id]);
        removePendingDream(args.projectPath, args.id);
        emit("dream:finished", {
                id: pending.id,
                status: "done",
                notesIn: pending.notesIn,
                project: pending.slug,
                reason: "approved from the review inbox",
        });
        return { ok: true, detail: `approved — ${pending.slug} memory v${version} written (${pending.summary})` };
}

/** Discard a parked dream: revert the platform events, ship nothing. */
export async function discardPendingDream(args: {
        projectPath: string;
        id: string;
}): Promise<{ ok: boolean; detail: string }> {
        const pending = getPendingDream(args.projectPath, args.id);
        if (!pending) return { ok: false, detail: "pending dream not found" };
        const scope = projectScope(pending.slug);
        const platform = await platformOrSingleton({});
        await revertMemoryEvents(pending.events as any, scope, { platform });
        store.run(`UPDATE dreams SET status = 'discarded', ended_at = ? WHERE id = ?`, [Date.now(), pending.id]);
        removePendingDream(args.projectPath, args.id);
        emit("dream:finished", {
                id: pending.id,
                status: "discarded",
                notesIn: pending.notesIn,
                project: pending.slug,
                reason: "discarded from the review inbox — platform events reverted",
        });
        return { ok: true, detail: `discarded — nothing shipped for ${pending.slug}; platform events reverted` };
}
