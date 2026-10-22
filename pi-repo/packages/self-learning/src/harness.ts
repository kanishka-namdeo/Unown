/**
 * harness.ts — Self-Improving Harness (pattern 2/5).
 *
 * The loop Claude Code popularized, applied to pi:
 *
 *   1. Run the agent on a task in a sandbox (with current memory)  → baseline
 *   2. If it FAILED: mine the transcript for a weakness            → diagnosis
 *   3. Propose a concrete memory patch (a rule the agent should
 *      follow next time)                                           → proposal
 *   4. Re-run the same task in a fresh sandbox with the patched
 *      memory                                                      → candidate
 *   5. Pass  → the patch ships (memory updated, version bumped)
 *      Fail  → loop back to (2) with the new failure evidence (max 3 iterations)
 *
 * Every step is recorded: cycles, runs, improvements — visible in the dashboard.
 */
import { randomUUID } from "node:crypto";
import { emit } from "./bus.ts";
import { decideGuardAction, guardSummary } from "./guard.ts";
import { modelFor } from "./llm.ts";
import { logHook } from "./hooks.ts";
import { chatJson } from "./llm.ts";
import { appendRules, currentVersion, readTier, rollback, type Tier } from "./memory.ts";
import { shipEngineRules, unshipEngineRules } from "./memzero.ts";
import { graduateTask } from "./mint.ts";
import { type RunResult, runAgent } from "./runner.ts";
import { store } from "./store.ts";
import { getTask, listTasks } from "./tasks.ts";

export interface MiningResult {
        diagnosis: string;
        proposal: string;
        patchLines: string[];
        targetTier: Tier;
}

const MINER_SYSTEM = `You are the self-improvement miner of a coding agent test harness.
You receive: a task, the agent's current long-term memory, a transcript of a FAILED run, and the verification output.
Your job: find the ROOT CAUSE of the failure and propose ONE concrete, durable memory rule that would prevent this class of failure in future runs.

Constraints:
- The rule must be actionable by the agent purely by reading it (no new tools, no code changes to the harness).
- The rule must be general enough to help related tasks, but specific enough to matter here.
- Max 6 rule lines, each under 200 chars, imperative voice ("Always ...", "Never ...", "When X, do Y").
- targetTier: "project" for durable task knowledge, "local" for narrow overrides.
Return STRICT JSON: {"diagnosis": "...", "proposal": "...", "patchLines": ["- ..."], "targetTier": "project"}`;

function transcriptToText(run: RunResult, maxChars = 14_000): string {
        const parts: string[] = [];
        for (const e of run.transcript) {
                if (e.type === "text") parts.push(`ASSISTANT: ${e.text}`);
                else if (e.type === "tool_start") parts.push(`TOOL ${e.tool} <- ${e.input}`);
                else if (e.type === "tool_end")
                        parts.push(`TOOL ${e.tool} ->${e.isError ? " (ERROR)" : ""} ${e.output?.slice(0, 900)}`);
        }
        let text = parts.join("\n");
        if (text.length > maxChars) text = `${text.slice(0, maxChars / 2)}\n...[truncated]...\n${text.slice(-maxChars / 2)}`;
        return text;
}

export async function mineFailure(task: any, run: RunResult): Promise<MiningResult> {
        // M6-4 (audit M4-c D3): mine FAILURES only. The harness's internal call
        // site only reaches here after a failed baseline, but the exported
        // surface (e6 script, future callers) could hand a passed or errored
        // run — mining a success produces "lessons" from nothing, and mining
        // an infra-dead run mines junk; either way the shipped rules ride every
        // future system prompt. Fail fast, before any LLM spend.
        if (run.status !== "failed" || run.verify?.passed === true) {
                throw new Error(
                        `mineFailure: run ${run.id} is not a mineable failure (status=${run.status}` +
                                `${run.verify ? `, verify.passed=${run.verify.passed}` : ", no verify"}) — nothing to mine`,
                );
        }
        const memory = ["policy", "project", "user", "local"].map((t) => `### ${t}\n${readTier(t as Tier)}`).join("\n\n");
        const result = await chatJson<MiningResult>(
                [
                        { role: "system", content: MINER_SYSTEM },
                        {
                                role: "user",
                                content: `TASK ${task.id} — ${task.name} (difficulty ${task.difficulty}):
${task.prompt}

CURRENT AGENT MEMORY:
${memory}

FAILED RUN TRANSCRIPT (baseline, status=${run.status}):
${transcriptToText(run)}

VERIFICATION OUTPUT:
${run.verify?.log?.slice(0, 4000) ?? "(none)"}

Propose the memory patch.`,
                        },
                ],
                { maxTokens: 1500, model: modelFor("miner") },
        );
        const patchLines = (result.patchLines ?? [])
                .filter((l) => typeof l === "string" && l.trim().length > 0)
                .slice(0, 6)
                .map((l) => l.trim());
        const tier: Tier = result.targetTier === "local" ? "local" : "project";
        return {
                diagnosis: String(result.diagnosis ?? "").slice(0, 2000),
                proposal: String(result.proposal ?? "").slice(0, 2000),
                patchLines,
                targetTier: tier,
        };
}

export interface CycleResult {
        id: string;
        taskId: string;
        status: "improved" | "no-fix" | "already-passing" | "error";
        iterations: number;
        baselineRunId: string;
        improvementIds: string[];
        summary: string;
}

// ---------------------------------------------------------------------------
// Ship gate (F4): the deterministic guard the dream pipeline applies, wired
// onto the SECOND memory writer. Exported for unit tests — runCycle calls
// these two helpers at its SHIP step (test/harness-guard.test.ts).
// ---------------------------------------------------------------------------

/**
 * Decide the fate of a mined patch: the miner consumes untrusted run
 * transcripts, and its patch is appended to a tier that rides every future
 * session's system prompt. firstMint mirrors the dream gate (F4B: the first
 * write to a tier has no canary and the highest attacker leverage).
 */
export function shipGateForPatch(patchText: string, tier: Tier) {
                return decideGuardAction(patchText, readTier(tier), { firstMint: currentVersion(tier) <= 1 });
}

/** Map a guard decision onto the rule lines appendRules ships: sanitize drops the quarantined lines. */
export function shipLinesFrom(guard: ReturnType<typeof decideGuardAction>, patchLines: string[]): string[] {
                if (guard.action !== "sanitize") return patchLines;
                return guard.sanitized.split("\n").filter((l) => l.trim().length > 0);
}

/**
 * Re-trigger guard for manual task runs (audit M4-c D5 / M6-1): a POST
 * /api/tasks/:id/run for a task whose cycle is ALREADY running, or whose
 * latest cycle just SUCCEEDED ('already-passing' | 'improved') within the
 * cooldown window, is almost always an accident — a double-click or a
 * re-submitted form that burns a full LLM cycle to re-prove a known result.
 * The M4-c audit measured exactly this: one accidental re-trigger of
 * fix-fizzbuzz cost ~4 LLM calls for a deterministic re-PASS.
 *
 * Rules (pure store reads — no LLM, no side effects):
 *   1. a cycle for this task is status='running'  -> block (return its id)
 *      Boot-time recoverOrphans heals restart zombies, so a 'running' row
 *      means a live cycle is genuinely in flight right now.
 *   2. the latest finished cycle succeeded < COOLDOWN ago -> block unless
 *      force. Failed / no-fix / error outcomes never cool down — retrying
 *      those immediately is a legitimate user intent.
 *   3. everything else (never run, last failed, stale pass) -> allow.
 */
export const CYCLE_RETRIGGER_COOLDOWN_MS = 5 * 60 * 1000;

export type CycleTriggerGuard =
        | { ok: true }
        | {
                        ok: false;
                        reason: "cycle-active" | "cooldown";
                        activeCycleId?: string;
                        lastStatus?: string;
                        endedAt?: number;
                        retryInMs?: number;
                        cooldownMs?: number;
                };

export function cycleTriggerGuard(taskId: string, opts: { force?: boolean; now?: number } = {}): CycleTriggerGuard {
        const force = opts.force ?? false;
        const now = opts.now ?? Date.now();

        // Rule 1: a cycle is in flight for this exact task. (Checked even when
        // force=true — a second concurrent cycle on the same task is never
        // meaningful: both would write pass/fail counters and memory versions.)
        const active = store.get<{ id: string }>(
                `SELECT id FROM cycles WHERE task_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1`,
                [taskId],
        );
        if (active) return { ok: false, reason: "cycle-active", activeCycleId: active.id };

        if (force) return { ok: true };

        // Rule 2: just-succeeded cooldown.
        const last = store.get<{ status: string; ended_at: number }>(
                `SELECT status, ended_at FROM cycles WHERE task_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1`,
                [taskId],
        );
        if (last && (last.status === "already-passing" || last.status === "improved")) {
                const age = now - last.ended_at;
                if (age >= 0 && age < CYCLE_RETRIGGER_COOLDOWN_MS) {
                        return {
                                ok: false,
                                reason: "cooldown",
                                lastStatus: last.status,
                                endedAt: last.ended_at,
                                retryInMs: CYCLE_RETRIGGER_COOLDOWN_MS - age,
                                cooldownMs: CYCLE_RETRIGGER_COOLDOWN_MS,
                        };
                }
        }
        return { ok: true };
}

/** Run with one retry when the run died on infrastructure (status 'error'). */
async function runAgentWithRetry(opts: Parameters<typeof runAgent>[0], retries = 1): Promise<RunResult> {
        let run = await runAgent(opts);
        for (let i = 0; i < retries && run.status === "error"; i++) {
                logHook(
                        null,
                        "SubagentStop",
                        null,
                        "log",
                        `run ${run.id.slice(0, 8)} died on infrastructure (retry ${i + 1}/${retries}) — cooling down 20s`,
                );
                await Bun.sleep(20_000);
                run = await runAgent(opts);
        }
        return run;
}

/** Pick the next task: prefer tasks with recent failures, else round-robin. */
export function pickNextTask(): string | null {
        const tasks = listTasks();
        if (tasks.length === 0) return null;
        // tasks that currently fail (last run failed) first, hardest first
        for (const t of tasks) {
                const last = store.get<any>(
                        `SELECT status FROM runs WHERE task_id = ? AND kind IN ('baseline','candidate') ORDER BY started_at DESC LIMIT 1`,
                        [t.id],
                );
                if (last && last.status === "failed") return t.id;
        }
        // then tasks never run
        for (const t of tasks) {
                const any = store.get<any>(`SELECT id FROM runs WHERE task_id = ? LIMIT 1`, [t.id]);
                if (!any) return t.id;
        }
        // round robin by fewest total cycles
        let best = tasks[0];
        let bestC = Infinity;
        for (const t of tasks) {
                const c = store.get<{ c: number }>(`SELECT COUNT(*) AS c FROM cycles WHERE task_id = ?`, [t.id])?.c ?? 0;
                if (c < bestC) {
                        bestC = c;
                        best = t;
                }
        }
        return best.id;
}

export async function runCycle(taskId: string, opts: { maxIterations?: number } = {}): Promise<CycleResult> {
        const maxIterations = opts.maxIterations ?? 3;
        const cycleId = randomUUID();
        const task = getTask(taskId);
        if (!task) throw new Error(`unknown task: ${taskId}`);

        store.run(`INSERT INTO cycles (id, task_id, status, iteration, created_at) VALUES (?, ?, 'running', 0, ?)`, [
                cycleId,
                taskId,
                Date.now(),
        ]);
        emit("cycle:started", { id: cycleId, taskId });

        const improvementIds: string[] = [];
        let iterations = 0;
        let summary = "";

        try {
                // ---- 1. Baseline run ------------------------------------------------
                const baseline = await runAgentWithRetry({
                        taskId,
                        kind: "baseline",
                        prompt: task.prompt,
                        files: task.files,
                        verify: task.verify,
                        cycleId,
                        label: `${taskId}-baseline`,
                });
                iterations++;

                if (baseline.status === "passed") {
                        store.run(`UPDATE tasks SET pass_count = pass_count + 1 WHERE id = ?`, [taskId]);
                        // A minted capability eval that starts passing graduates into the
                        // regression suite (Anthropic's capability -> regression pattern).
                        let graduationNote = "";
                        if (graduateTask(taskId)) {
                                graduationNote = " — capability eval graduated into the regression suite";
                        }
                        store.run(
                                `UPDATE cycles SET status = 'already-passing', ended_at = ?, iteration = 1, summary = ? WHERE id = ?`,
                                [Date.now(), `baseline passed${graduationNote} — no improvement needed`, cycleId],
                        );
                        emit("cycle:finished", { id: cycleId, taskId, status: "already-passing" });
                        return {
                                id: cycleId,
                                taskId,
                                status: "already-passing",
                                iterations: 1,
                                baselineRunId: baseline.id,
                                improvementIds,
                                summary: `baseline passed${graduationNote}`,
                        };
                }
                if (baseline.status === "error") {
                        // Infrastructure failure even after retry — abort the cycle, do not mine junk.
                        store.run(`UPDATE cycles SET status = 'no-fix', ended_at = ?, iteration = 0, summary = ? WHERE id = ?`, [
                                Date.now(),
                                `baseline died on infrastructure (LLM gateway unavailable): ${baseline.error ?? "unknown"}`,
                                cycleId,
                        ]);
                        emit("cycle:finished", { id: cycleId, taskId, status: "error", error: "baseline infra failure" });
                        return {
                                id: cycleId,
                                taskId,
                                status: "error",
                                iterations: 0,
                                baselineRunId: baseline.id,
                                improvementIds,
                                summary: "baseline infra failure",
                        };
                }
                store.run(`UPDATE tasks SET fail_count = fail_count + 1 WHERE id = ?`, [taskId]);

                // ---- Retention check ------------------------------------------------
                // If a task regresses after a shipped improvement, the lesson did not
                // hold: mark the improvement 'regressed' and roll the memory back to
                // the pre-ship version (auto-unship). Older rows without a recorded
                // memory_version are only marked, not rolled back.
                await retentionCheck(taskId, cycleId);

                // ---- 2..N. Mine → patch → candidate loop ----------------------------
                const overlays: Record<string, string> = {}; // accumulated overlay per tier
                const overlayOf = () => {
                        const o: Partial<Record<Tier, string>> = {};
                        for (const [tier, content] of Object.entries(overlays)) o[tier as Tier] = content;
                        return o;
                };

                let lastRun: RunResult = baseline;
                let shipped = false;

                for (let i = 1; i <= maxIterations; i++) {
                        const improvementId = randomUUID();
                        improvementIds.push(improvementId);

                        // Mine the latest failure
                        const mining = await mineFailure(task, lastRun);
                        const patchText = mining.patchLines.map((l) => (l.startsWith("-") ? l : `- ${l}`)).join("\n");

                        store.run(
                                `INSERT INTO improvements (id, cycle_id, task_id, iteration, diagnosis, proposal, patch, target_tier, status, baseline_run_id, score_before, created_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)`,
                                [
                                        improvementId,
                                        cycleId,
                                        taskId,
                                        i,
                                        mining.diagnosis,
                                        mining.proposal,
                                        patchText,
                                        mining.targetTier,
                                        baseline.id,
                                        "failed",
                                        Date.now(),
                                ],
                        );
                        emit("improvement:proposed", { id: improvementId, cycleId, taskId, iteration: i, proposal: mining.proposal });

                        // Build candidate overlay: current real memory + accumulated patches
                        const tier = mining.targetTier;
                        const base = overlays[tier] ?? readTier(tier);
                        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
                        overlays[tier] = `${base.trimEnd()}\n\n<!-- harness:iteration-${i} @ ${stamp} -->\n${patchText}\n`;

                        // Candidate run with patched memory (retry on infra failures)
                        const candidate = await runAgentWithRetry({
                                taskId,
                                kind: "candidate",
                                prompt: task.prompt,
                                files: task.files,
                                verify: task.verify,
                                cycleId,
                                improvementId,
                                memoryOverlay: overlayOf(),
                                label: `${taskId}-cand${i}`,
                        });
                        iterations++;

                        store.run(`UPDATE improvements SET candidate_run_id = ?, score_after = ? WHERE id = ?`, [
                                candidate.id,
                                candidate.status,
                                improvementId,
                        ]);

                        if (candidate.status === "passed") {
                                // ---- CONFIRMATION (statistical ship gate) ----------------------
                                // A single passing run can be luck (PyMC measured eval noise floors
                                // around +/-0.06): a patch only ships after a SECOND consecutive pass
                                // in another fresh sandbox with the same overlay.
                                const confirmation = await runAgentWithRetry({
                                        taskId,
                                        kind: "candidate",
                                        prompt: task.prompt,
                                        files: task.files,
                                        verify: task.verify,
                                        cycleId,
                                        improvementId,
                                        memoryOverlay: overlayOf(),
                                        label: `${taskId}-cand${i}-confirm`,
                                });
                                iterations++;

                                store.run(`UPDATE improvements SET candidate_run_id = ?, score_after = ? WHERE id = ?`, [
                                        confirmation.id,
                                        confirmation.status,
                                        improvementId,
                                ]);

                                if (confirmation.status !== "passed") {
                                        if (confirmation.status === "error") {
                                                // The confirmation died on infrastructure — the patch's
                                                // fate is genuinely unknown. The old fall-through set
                                                // lastRun = candidate, a PASSED run, and the next
                                                // iteration mined it (M4-c D3: lessons from a success).
                                                // Stop the cycle with the proposal kept open, mirroring
                                                // the candidate-infra path below.
                                                store.run(`UPDATE improvements SET status = 'proposed' WHERE id = ?`, [improvementId]);
                                                logHook(
                                                        null,
                                                        "SubagentStop",
                                                        null,
                                                        "log",
                                                        `confirmation run ${confirmation.id.slice(0, 8)} died on infrastructure — patch unproven, proposal kept`,
                                                );
                                                summary = `iteration ${i} confirmation died on infrastructure — proposal kept`;
                                                break;
                                        }
                                        // The pass did not replicate — reject and mine the new evidence
                                        // (a genuine FAILED run — the only kind mineFailure accepts).
                                        store.run(`UPDATE improvements SET status = 'rejected', decided_at = ? WHERE id = ?`, [
                                                Date.now(),
                                                improvementId,
                                        ]);
                                        logHook(
                                                null,
                                                "SubagentStop",
                                                null,
                                                "log",
                                                `candidate run ${candidate.id.slice(0, 8)} passed but confirmation ${confirmation.id.slice(0, 8)} did not — patch NOT shipped (noise gate)`,
                                        );
                                        lastRun = confirmation;
                                        summary = `iteration ${i} patch passed once but failed the confirmation run — not shipped`;
                                        continue;
                                }

                                // ---- SHIP -------------------------------------------------
                                // Guard first (F4): the miner consumes the failed run's
                                // transcript — untrusted content (task prompts + model
                                // output quoting it) — and its patch is appended to a
                                // tier that rides every future session's system prompt.
                                // This is the same deterministic gate the dream pipeline
                                // applies: ship / sanitize (flagged lines quarantined,
                                // remainder ships) / gate (rejected outright; a first
                                // write to the tier hard-gates on ANY flag — F4B).
                                const guardShip = shipGateForPatch(patchText, tier);
                                if (guardShip.action === "gate") {
                                        store.run(
                                                `UPDATE improvements SET status = 'rejected', decided_at = ? WHERE id = ?`,
                                                [Date.now(), improvementId],
                                        );
                                        logHook(
                                                null,
                                                "SubagentStop",
                                                null,
                                                "log",
                                                `candidate ${candidate.id.slice(0, 8)} + confirmation passed but the GUARD gated the patch (${guardShip.reason}) — nothing shipped, mining continues`,
                                        );
                                        summary = `iteration ${i} patch passed twice but was gated by the adversarial-content guard — not shipped`;
                                        continue;
                                }
                                const shipLines = shipLinesFrom(guardShip, mining.patchLines);

                                // The project tier is mem0-backed (the learning-core swap):
                                // rules ship as verbatim atomic memories and the ids are
                                // recorded on the improvement row so retention's auto-unship
                                // deletes exactly this ship. Other tiers stay file appends.
                                let shippedVersion: number;
                                let shippedMemoryIds: string[] = [];
                                if (tier === "project") {
                                        const ship = await shipEngineRules(
                                                shipLines,
                                                "harness",
                                                `fixed ${taskId} (cycle ${cycleId.slice(0, 8)}, iteration ${i})${
                                                                guardShip.action === "sanitize" ? ` · ${guardSummary(guardShip)}` : ""
                                                        }`,
                                        );
                                        shippedVersion = ship.version;
                                        shippedMemoryIds = ship.memoryIds;
                                } else {
                                        shippedVersion = await appendRules(
                                                tier,
                                                shipLines,
                                                "harness",
                                                `fixed ${taskId} (cycle ${cycleId.slice(0, 8)}, iteration ${i})${
                                                                guardShip.action === "sanitize" ? ` · ${guardSummary(guardShip)}` : ""
                                                        }`,
                                        );
                                }
                                store.run(`UPDATE improvements SET status = 'shipped', decided_at = ?, memory_version = ?, memory_ids = ? WHERE id = ?`, [
                                        Date.now(),
                                        shippedVersion,
                                        shippedMemoryIds.length > 0 ? JSON.stringify(shippedMemoryIds) : null,
                                        improvementId,
                                ]);
                                logHook(
                                        null,
                                        "SubagentStop",
                                        null,
                                        "log",
                                        `candidate ${candidate.id.slice(0, 8)} + confirmation both passed — patch shipped to ${tier} memory (v${shippedVersion})`,
                                );
                                emit("improvement:shipped", { id: improvementId, cycleId, taskId, tier, memoryVersion: shippedVersion });
                                shipped = true;
                                summary = `baseline failed; iteration ${i} patch passed twice — shipped (${mining.patchLines.length} rules -> ${tier} v${shippedVersion})`;
                                break;
                        }

                        if (candidate.status === "error") {
                                // Infra failure even after retry — keep the proposal open, stop the cycle.
                                store.run(`UPDATE improvements SET status = 'proposed' WHERE id = ?`, [improvementId]);
                                logHook(
                                        null,
                                        "SubagentStop",
                                        null,
                                        "log",
                                        `candidate run ${candidate.id.slice(0, 8)} died on infrastructure — cycle aborted, proposal kept`,
                                );
                                summary = `iteration ${i} candidate died on infrastructure (gateway unavailable)`;
                                break;
                        }

                        // Failed again — loop back with new evidence
                        store.run(`UPDATE improvements SET status = 'rejected', decided_at = ? WHERE id = ?`, [
                                Date.now(),
                                improvementId,
                        ]);
                        logHook(null, "SubagentStop", null, "log", `candidate run ${candidate.id.slice(0, 8)} failed — looping back`);
                        lastRun = candidate;
                        summary = `iteration ${i} patch did not fix the task`;
                }

                store.run(`UPDATE cycles SET status = ?, ended_at = ?, iteration = ?, summary = ? WHERE id = ?`, [
                        shipped ? "improved" : "no-fix",
                        Date.now(),
                        iterations,
                        summary,
                        cycleId,
                ]);
                emit("cycle:finished", { id: cycleId, taskId, status: shipped ? "improved" : "no-fix" });
                return {
                        id: cycleId,
                        taskId,
                        status: shipped ? "improved" : "no-fix",
                        iterations,
                        baselineRunId: baseline.id,
                        improvementIds,
                        summary,
                };
        } catch (err: any) {
                const msg = err?.message ?? String(err);
                store.run(`UPDATE cycles SET status = 'no-fix', ended_at = ?, summary = ? WHERE id = ?`, [
                        Date.now(),
                        `error: ${msg}`,
                        cycleId,
                ]);
                emit("cycle:finished", { id: cycleId, taskId, status: "error", error: msg });
                return { id: cycleId, taskId, status: "error", iterations, baselineRunId: "", improvementIds, summary: msg };
        }
}

/**
 * Retention check: a baseline failure on a task with a SHIPPED improvement
 * means the shipped lesson did not hold. Mark the improvement 'regressed';
 * when we know the memory version it produced, roll back to the pre-ship
 * version (auto-unship) so bad lessons cannot linger in memory.
 */
async function retentionCheck(taskId: string, cycleId: string) {
        const shipped = store.get<{ id: string; memory_version: number | null; target_tier: string; memory_ids: string | null }>(
                `SELECT id, memory_version, target_tier, memory_ids FROM improvements WHERE task_id = ? AND status = 'shipped' ORDER BY created_at DESC LIMIT 1`,
                [taskId],
        );
        if (!shipped) return;

        store.run(`UPDATE improvements SET status = 'regressed', decided_at = ? WHERE id = ?`, [Date.now(), shipped.id]);
        let note = `task ${taskId} failed again after the patch shipped — improvement marked regressed`;

        // mem0-backed ships (the learning-core swap): delete the exact memory
        // ids this ship added and re-render the tier — the lesson leaves the
        // platform AND the injected file in one move.
        const memoryIds = shipped.memory_ids ? safeParseIds(shipped.memory_ids) : [];
        if (shipped.target_tier === "project" && memoryIds.length > 0) {
                try {
                        const un = await unshipEngineRules(
                                memoryIds,
                                `retention: ${taskId} regressed — unshipped ${memoryIds.length} memory rule(s) (cycle ${cycleId.slice(0, 8)})`,
                        );
                        note += `; ${un.unshipped} memory rule(s) unshipped, tier re-rendered${un.version ? ` -> v${un.version}` : ""}`;
                } catch (err: any) {
                        note += `; platform unship failed (${err?.message ?? err})`;
                }
        } else {
                const version = shipped.memory_version;
                if (version && version > 1) {
                        try {
                                rollback(
                                        shipped.target_tier as Tier,
                                        version - 1,
                                        `retention: ${taskId} regressed — unshipped improvement (cycle ${cycleId.slice(0, 8)})`,
                                );
                                note += `; memory rolled back to v${version - 1}`;
                        } catch {
                                note += `; rollback to v${version - 1} unavailable`;
                        }
                } else {
                        note += "; legacy ship without recorded version — memory left as-is";
                }
        }
        logHook(null, "SubagentStop", null, "log", note);
        emit("improvement:regressed", {
                id: shipped.id,
                taskId,
                cycleId,
                rolledBackTo: shipped.memory_version && shipped.memory_version > 1 ? shipped.memory_version - 1 : null,
        });
}

function safeParseIds(raw: string): string[] {
        try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string" && x) : [];
        } catch {
                return [];
        }
}

/** Regression sweep triggered after an improvement ships. */
export async function runRegression(sampleSize = 2): Promise<{ taskId: string; status: string }[]> {
        const tasks = listTasks().filter((t: any) => t.passes + t.fails > 0);
        const sample = tasks.sort(() => Math.random() - 0.5).slice(0, sampleSize);
        const results: { taskId: string; status: string }[] = [];
        for (const t of sample) {
                const task = getTask(t.id);
                if (!task) continue;
                const run = await runAgentWithRetry({
                        taskId: t.id,
                        kind: "regression",
                        prompt: task.prompt,
                        files: task.files,
                        verify: task.verify,
                        label: `${t.id}-regression`,
                });
                store.run(
                        `UPDATE tasks SET ${run.status === "passed" ? "pass_count" : "fail_count"} = ${run.status === "passed" ? "pass_count" : "fail_count"} + 1 WHERE id = ?`,
                        [t.id],
                );
                results.push({ taskId: t.id, status: run.status });
        }
        return results;
}

export function listCycles(limit = 40) {
        return store.query<any>(
                `SELECT c.*, (SELECT name FROM tasks WHERE id = c.task_id) AS task_name,
                        (SELECT COUNT(*) FROM improvements i WHERE i.cycle_id = c.id AND i.status = 'shipped') AS shipped
                 FROM cycles c ORDER BY c.created_at DESC LIMIT ?`,
                [limit],
        );
}

export function listImprovements(limit = 60) {
        return store.query<any>(`SELECT * FROM improvements ORDER BY created_at DESC LIMIT ?`, [limit]);
}

export function getImprovement(id: string) {
        return store.get<any>(`SELECT * FROM improvements WHERE id = ?`, [id]);
}
