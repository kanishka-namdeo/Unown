/**
 * runner.ts — headless pi runner inside a sandbox.
 *
 * Deploys the (modified) pi coding agent into an isolated sandbox directory,
 * injects the resolved tiered memory into its system prompt, attaches the
 * hooks extension, drives it to completion, verifies the result, and records
 * a session note. This is the single execution primitive everything else
 * (harness, router, console) builds on.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
        createAgentSessionFromServices,
        createAgentSessionServices,
        SessionManager,
        SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
        formatCompactionWarning,
        formatContextExhaustedError,
        shouldAutoCompact,
        type AutoCompactConfig,
        type AutoCompactDecision,
} from "./auto-compact.ts";
import { emit } from "./bus.ts";
import { decideSandboxFallback, resolveAgentIsolation, SandboxRequiredError, writeSandboxShell } from "./bwrap.ts";
import { createHooksExtension, logHook } from "./hooks.ts";
import { currentVersion, type MemoryOverlay, resolveMemoryForAgentDetailed } from "./memory.ts";
import { createNote, noteFromRun } from "./notes.ts";
import { beginLiveRun, finishLiveRun, touchLiveRun } from "./run-progress.ts";
import { createSandbox, seedFiles, snapshotFiles, verifyInSandbox } from "./sandbox.ts";
import { BRIDGE_URL, DATA_DIR, store } from "./store.ts";
import { modelSpec } from "./model-specs.ts";
import { createWebToolsExtension } from "./websearch.ts";

export const AGENT_DIR = join(DATA_DIR, "pi-agent-dir");
export const SESSIONS_DIR = join(DATA_DIR, "sessions");
export const PROVIDER = process.env.PI_PROVIDER || "zai-bridge"; // `||`: empty .env value means unset
export const MODEL_ID = process.env.PI_MODEL_ID || "kimi-k2.5";

/**
 * Max context window (tokens) the runner assumes for auto-compact (Milestone
 * 3.7). Matches the `contextWindow` field in `ensureAgentDir()`'s models.json
 * (131 072 — the kimi-k2.5 / Qwen-class default we provision via the bridge).
 *
 * Used as the FALLBACK when the pi session does not expose `getContextUsage()`
 * (the documented ExtensionContext seam — `context-tools.ts:344`). When pi
 * does report a context window, that value wins (so a model swap to a 200k
 * context variant is honored automatically).
 */
export const RUNNER_MAX_CONTEXT_WINDOW = 131_072;

/**
 * Auto-compact guard (Milestone 3.7 — goose's auto-compact-on-token-limit port).
 *
 * Consulted by `runAgent` after each `turn_end` event. The decision is made by
 * {@link shouldAutoCompact} against the LIVE context usage (the pi session's
 * documented `getContextUsage()` seam when available, else the latest reported
 * `usage.input` from `message_end` as a fallback) and dispatched:
 *
 *   - "none"    → no-op
 *   - "warn"    → log a `AutoCompact` warn receipt (the model sees the warning
 *                 text injected by `formatCompactionWarning` via the
 *                 /compact slash command path on the next turn — TODO: a pi
 *                 PreModelRequest hook (Milestone 1.3) is the cleaner seam)
 *   - "compact" → trigger pi's compaction API directly when the session exposes
 *                 `session.compact()` (defensive `typeof` guard — the method
 *                 is not on every pi version; if missing, the warn receipt
 *                 still records the trigger so the operator can `/compact`
 *                 manually)
 *   - "block"   → log an error receipt AND abort the session (so the next
 *                 `session.prompt()` does not ship a request the upstream
 *                 bridge will reject with a context-overflow error)
 *
 * The guard is fully defensive: any throw is swallowed (telemetry must NEVER
 * break the run — same invariant as the existing `session.subscribe` handler).
 * A null decision is returned when neither pi's seam nor the fallback has
 * produced a usable token count yet (e.g. before the first LLM response) —
 * the caller treats null as a no-op.
 *
 * @returns the decision (for telemetry), or null when no usage signal is
 *          available yet.
 */
function checkAutoCompact(
        session: any,
        runId: string,
        fallbackTokensUsed: number,
        fallbackMaxTokens: number,
        cfg?: AutoCompactConfig,
): AutoCompactDecision | null {
        try {
                // Prefer pi's documented ContextUsage seam when available — it
                // reflects the active model's true window + the live token count
                // (including any pending system messages the next request will
                // send). The same seam powers the `get_context_remaining` tool
                // (context-tools.ts:344).
                const usage = typeof session?.getContextUsage === "function" ? session.getContextUsage() : undefined;
                const tokensUsed =
                        typeof usage?.tokens === "number" && Number.isFinite(usage.tokens) && usage.tokens >= 0
                                ? usage.tokens
                                : fallbackTokensUsed;
                const maxTokens =
                        typeof usage?.contextWindow === "number" && Number.isFinite(usage.contextWindow) && usage.contextWindow > 0
                                ? usage.contextWindow
                                : fallbackMaxTokens;

                // No signal yet (no model response AND no fallback) — skip silently.
                if (tokensUsed <= 0 && !usage) return null;

                const decision = shouldAutoCompact(tokensUsed, maxTokens, cfg);
                if (decision.action === "warn") {
                        logHook(runId, "AutoCompact", null, "warn", formatCompactionWarning(tokensUsed, maxTokens));
                } else if (decision.action === "compact") {
                        logHook(runId, "AutoCompact", null, "log", `auto-compact triggered: ${decision.reason}`);
                        // Trigger pi's compaction API directly. The /compact slash
                        // command's underlying entry point is `session.compact()` —
                        // defensive in case this pi version exposes it under a
                        // different name (the warn receipt above records the
                        // trigger regardless, so the operator can `/compact`
                        // manually if the auto-trigger is a no-op).
                        // TODO(M3.7-followup): wire the actual pi compaction entry
                        // point once its API surface stabilizes — the
                        // PreModelRequest hook (Milestone 1.3) is the cleaner
                        // seam for "compaction on the next turn" semantics.
                        if (typeof session?.compact === "function") {
                                try {
                                        session.compact();
                                } catch {
                                        /* best-effort: the next turn will re-evaluate */
                                }
                        }
                } else if (decision.action === "block") {
                        const err = formatContextExhaustedError(tokensUsed, maxTokens);
                        logHook(runId, "AutoCompact", null, "error", err);
                        // Abort the session so the next `session.prompt()` cannot
                        // ship a request the bridge will reject. The outer try /
                        // catch in `runAgent` finalizes the run as 'error' with
                        // this message.
                        try {
                                session?.abort?.();
                        } catch {
                                /* best-effort */
                        }
                }
                return decision;
        } catch {
                // Telemetry must NEVER break the run — matches the existing
                // session.subscribe handler invariant.
                return null;
        }
}

export interface TranscriptEntry {
        type: "text" | "tool_start" | "tool_end";
        ts: number;
        text?: string;
        tool?: string;
        input?: string;
        output?: string;
        isError?: boolean;
}

export interface RunOptions {
        taskId?: string;
        kind: "baseline" | "candidate" | "regression" | "interactive";
        prompt: string;
        files?: Record<string, string>;
        verify?: string;
        memoryOverlay?: MemoryOverlay;
        improvementId?: string;
        cycleId?: string;
        timeoutMs?: number;
        label?: string;
}

export interface RunResult {
        id: string;
        status: "passed" | "failed" | "error";
        verify?: { passed: boolean; summary: string; log: string; isolation?: "bwrap" | "seatbelt" | "process" };
        transcript: TranscriptEntry[];
        sandboxId: string;
        tokensIn: number;
        tokensOut: number;
        toolCalls: number;
        turns: number;
        lastAssistantText: string;
        toolsUsed: string[];
        durationMs: number;
        error?: string;
}

/** Ensure the pi agent dir exists with a models.json the engine's sandboxed
 * runs can use. M3 multi-provider: the bridge entry (as always) PLUS the
 * user's registry from ~/.unown/agent/models.json — so `PI_MODEL_ID=provider/model`
 * routes a sandboxed run DIRECTLY to any provider the user configured, without
 * the engine learning anything about keys on disk:
 *   - `$ENV` refs pass through verbatim (resolved from the engine's env);
 *   - auth.json secrets are exported as UNOWN_KEY_<ID> env vars and referenced
 *     as `$UNOWN_KEY_<ID>` — the secret stays in env, never in the data dir;
 *   - the bridge entry always wins for its own provider id.
 * Reading the user's agent dir is a pure FILE read — allowed by the detachment
 * contract (files + HTTP); importing the terminal half's term.ts is not. */
export function ensureAgentDir() {
        mkdirSync(AGENT_DIR, { recursive: true });
        mkdirSync(SESSIONS_DIR, { recursive: true });
        const providers: Record<string, unknown> = {
                [PROVIDER]: {
                        baseUrl: `${BRIDGE_URL}/v1`,
                        api: "openai-completions",
                        // M2 admission lane: the engine's OWN agent sessions (canary
                        // gates, harness runs, automations) are unattended background
                        // work — the bearer "bridge-background" makes the bridge admit
                        // interactive terminal sessions ahead of them under the
                        // concurrency cap (see mini-services/llm-bridge pure.ts
                        // laneForRequest). BRIDGE_API_KEY quirk applies as documented.
                        apiKey: process.env.BRIDGE_API_KEY || "bridge-background",
                        models: [
                                {
                                        id: MODEL_ID,
                                        name: `${MODEL_ID} (via llm-bridge)`,
                                        ...modelSpec(MODEL_ID),
                                        input: ["text", "image"],
                                },
                        ],
                },
        };
        // Best-effort user-registry merge — a missing/garbled ~/.unown must
        // never break engine runs (the bridge entry above already works).
        try {
                const userHome = process.env.UNOWN_HOME || join(homedir(), ".unown");
                const userModelsPath = join(userHome, "agent", "models.json");
                if (existsSync(userModelsPath)) {
                        const raw = JSON.parse(readFileSync(userModelsPath, "utf8")) as {
                                providers?: Record<string, Record<string, unknown>>;
                        };
                        let auth: Record<string, { key?: string }> = {};
                        const authPath = join(userHome, "agent", "auth.json");
                        if (existsSync(authPath)) {
                                try {
                                        auth = JSON.parse(readFileSync(authPath, "utf8"));
                                } catch {
                                        /* keys optional — env-ref/keyless providers still merge */
                                }
                        }
                        for (const [id, entry] of Object.entries(raw.providers ?? {})) {
                                if (!entry || typeof entry !== "object" || id === PROVIDER) continue;
                                const copy: Record<string, unknown> = { ...entry };
                                const key = copy.apiKey;
                                if (typeof key === "string" && !key.startsWith("$") && auth[id]?.key) {
                                        // auth.json secret → env var + $REF (never written to disk here)
                                        const envName = `UNOWN_KEY_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
                                        process.env[envName] = auth[id].key as string;
                                        copy.apiKey = `$${envName}`;
                                } else if (key === undefined && auth[id]?.key) {
                                        const envName = `UNOWN_KEY_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
                                        process.env[envName] = auth[id].key as string;
                                        copy.apiKey = `$${envName}`;
                                }
                                providers[id] = copy;
                        }
                }
        } catch {
                /* best effort — the bridge entry stands alone */
        }
        const modelsPath = join(AGENT_DIR, "models.json");
        writeFileSync(modelsPath, JSON.stringify({ providers }, null, 2), "utf8");
}

/** PI_MODEL_ID may carry the canonical "provider/model" form (M3): split it
 * when the prefix names a provider (else treat the whole string as a model id
 * on the bridge provider, as before — OpenRouter-style ids contain slashes
 * that are NOT provider separators). */
export function resolveRunModel(): { provider: string; model: string } {
        if (MODEL_ID.includes("/")) {
                const first = MODEL_ID.split("/")[0];
                // Known direct provider (the merged registry is written by
                // ensureAgentDir right before the run — read it back cheaply).
                try {
                        const written = JSON.parse(readFileSync(join(AGENT_DIR, "models.json"), "utf8")) as {
                                providers?: Record<string, unknown>;
                        };
                        if (written.providers?.[first]) {
                                return { provider: first, model: MODEL_ID.slice(first.length + 1) };
                        }
                } catch {
                        /* fall through to bridge semantics */
                }
        }
        return { provider: PROVIDER, model: MODEL_ID };
}

export async function runAgent(opts: RunOptions): Promise<RunResult> {
        const runId = randomUUID();
        const sandbox = createSandbox(opts.label ?? opts.kind);
        const startedAt = Date.now();
        // §5.5: the injected block is hard-capped (PI_MEMORY_TOTAL_CHARS) with
        // oldest-rules-first degradation at injection time — the stored memory is
        // untouched, and every degraded run carries an audit receipt.
        const memory = resolveMemoryForAgentDetailed(opts.memoryOverlay);
        const memoryFiles = memory.files;
        if (memory.report.prunedBlocks.length > 0 || memory.report.truncatedTiers.length > 0 || memory.report.overflow) {
                const line = `memory budget: injected ${memory.report.totalAfter}/${memory.report.cap} chars — pruned ${memory.report.prunedBlocks.length} old block(s) [${memory.report.prunedBlocks
                        .map((b) => `${b.tier}@${b.date}`)
                        .join(", ")}], truncated [${memory.report.truncatedTiers.join(", ")}]${
                        memory.report.overflow ? ", OVERFLOW (protected content alone exceeds the cap)" : ""
                }`;
                console.warn(`[memory] ${line}`);
                emit("memory:budget", { ...memory.report, runId });
                logHook(runId, "MemoryBudget", null, "warn", line);
        }
        const memoryVersion = currentVersion("project");

        // M6-3 (audit M4-c D2): record the isolation the agent bash tool will
        // actually run under — the same decision writeSandboxShell makes below.
        // Persisted on the run row + carried by run:started so a silently
        // degraded host (missing bwrap binary, kill-switch) is auditable.
        const agentIsolation = resolveAgentIsolation();

        store.run(
                `INSERT INTO runs (id, task_id, kind, status, started_at, sandbox_id, cycle_id, improvement_id, prompt, sandbox_isolation)
                 VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
                [
                        runId,
                        opts.taskId ?? null,
                        opts.kind,
                        startedAt,
                        sandbox.id,
                        opts.cycleId ?? null,
                        opts.improvementId ?? null,
                        opts.prompt,
                        agentIsolation,
                ],
        );
        emit("run:started", { id: runId, kind: opts.kind, taskId: opts.taskId, sandbox: sandbox.id, isolation: agentIsolation });
        // M6-2: register for REST live progress (same counters finalize persists,
        // observed mid-flight — GET /api/runs/live, GET /api/runs/:id .live).
        beginLiveRun({
                id: runId,
                taskId: opts.taskId ?? null,
                kind: opts.kind,
                cycleId: opts.cycleId ?? null,
                improvementId: opts.improvementId ?? null,
                label: opts.label ?? null,
                startedAt,
        });

        if (opts.files) seedFiles(sandbox, opts.files);

        const transcript: TranscriptEntry[] = [];
        const toolsUsed: string[] = [];
        let tokensIn = 0;
        let tokensOut = 0;
        let turns = 0;
        let lastAssistantText = "";
        // §3.7 — latest `usage.input` value (the context window size for the
        // most recent model request — pi resends the whole conversation history
        // each turn, so the LATEST input-tokens value IS the live context size).
        // Used as the auto-compact fallback when pi's `getContextUsage()` seam
        // is unavailable on this session object.
        let currentContextTokens = 0;

        const finalize = async (
                status: RunResult["status"],
                verify: RunResult["verify"],
                error?: string,
        ): Promise<RunResult> => {
                // M6-2: the run is no longer live — drop the REST progress entry so
                // the finalized DB row (written below) is the single source of truth.
                finishLiveRun(runId);
                const endedAt = Date.now();
                // STICKY FINALIZE (docs/detached-engine-architecture.md F2): only a
                // row still in 'running' may be finalized. When the router watchdog
                // or boot-time recoverOrphans already errored this row, the UPDATE
                // matches zero rows and the late (zombie) finalize becomes a no-op —
                // no note, no run:finished event, no overwriting the recovery state.
                const info = store.run(
                        `UPDATE runs SET status = ?, ended_at = ?, transcript = ?, verify_output = ?, tokens_in = ?, tokens_out = ?, tool_calls = ?, turns = ?, error = ? WHERE id = ? AND status = 'running'`,
                        [
                                status,
                                endedAt,
                                JSON.stringify(transcript),
                                verify ? JSON.stringify(verify) : null,
                                tokensIn,
                                tokensOut,
                                toolsUsed.length,
                                turns,
                                error ?? null,
                                runId,
                        ],
                );
                const externallyFinalized = info.changes === 0;
                const result: RunResult = {
                        id: runId,
                        status,
                        verify,
                        transcript,
                        sandboxId: sandbox.id,
                        tokensIn,
                        tokensOut,
                        toolCalls: toolsUsed.length,
                        turns,
                        lastAssistantText,
                        toolsUsed,
                        durationMs: endedAt - startedAt,
                        error,
                };
                if (externallyFinalized) {
                        console.log(`[runner] run ${runId} was finalized externally (watchdog/orphan recovery) — late finalize skipped`);
                        return result;
                }
                // Session note (fuel for AutoDream)
                const note = noteFromRun({
                        id: runId,
                        taskId: opts.taskId,
                        kind: opts.kind,
                        status,
                        prompt: opts.prompt,
                        toolCalls: result.toolCalls,
                        turns,
                        tokensIn,
                        tokensOut,
                        verifySummary: verify?.summary ?? null,
                        verifyLog: verify?.log,
                        lastAssistantText,
                        toolsUsed,
                });
                createNote(runId, note);
                // Sandbox artifact: changed file snapshot
                try {
                        writeFileSync(join(sandbox.root, "files.json"), JSON.stringify(snapshotFiles(sandbox), null, 2));
                } catch {
                        /* ignore */
                }
                emit("run:finished", { id: runId, kind: opts.kind, taskId: opts.taskId, status, durationMs: result.durationMs });
                return result;
        };

        let session: any = null;
        try {
                ensureAgentDir();

                // OS sandbox: route every agent bash-tool command through the
                // generated per-OS wrapper — bubblewrap on Linux, seatbelt on
                // macOS (transparent when unavailable).
                const sandboxShell = writeSandboxShell(AGENT_DIR);

                // SA-B1 — fail-closed sandbox knob (UNOWN_SANDBOX_REQUIRED, see
                // bwrap.ts): when the wrapper could not be generated (no backend
                // on this host — including every native-Windows host — binary
                // missing, or the UNOWN_OS_SANDBOX=0 kill-switch) the agent bash
                // tool would silently degrade to the in-process TS path jail.
                // With the knob armed the run must REFUSE instead: the throw
                // lands in the catch below, which finalizes a typed status:'error'
                // run row carrying the actionable message. Default (knob
                // unset/0): the transparent degrade above is unchanged.
                if (!sandboxShell && decideSandboxFallback(false) === "fail") {
                        throw new SandboxRequiredError();
                }

                const hooksExt = createHooksExtension({
                        runId,
                        sandboxRoot: sandbox.workspace,
                        memoryVersion,
                });

                // Web tools in sandbox runs: the OS sandbox kills the network
                // namespace by default (UNOWN_SANDBOX_NET=0), so web_search /
                // webfetch only make sense when the namespace is shared.
                // Registered ahead of the hooks extension; UNOWN_WEB_SEARCH=0
                // / UNOWN_WEBFETCH=0 still kill them individually.
                const sandboxNet = (process.env.UNOWN_SANDBOX_NET || "0") === "1";
                const webExt = sandboxNet ? createWebToolsExtension({ verbose: false }) : undefined;

                const services = await createAgentSessionServices({
                        cwd: sandbox.workspace,
                        agentDir: AGENT_DIR,
                        settingsManager: SettingsManager.inMemory(sandboxShell ? { shellPath: sandboxShell } : {}),
                        resourceLoaderOptions: {
                                extensionFactories: webExt ? [webExt as any, hooksExt as any] : [hooksExt as any],
                                noSkills: true,
                                noPromptTemplates: true,
                                noThemes: true,
                                noContextFiles: true,
                                agentsFilesOverride: () => ({
                                        agentsFiles: memoryFiles.map((f) => ({ path: f.path, content: f.content })),
                                }),
                        },
                });

                const runModel = resolveRunModel();
                const model = services.modelRuntime.getModel(runModel.provider, runModel.model);
                if (!model) throw new Error(`model ${runModel.provider}/${runModel.model} unavailable`);

                const sessionManager = SessionManager.create(sandbox.workspace, SESSIONS_DIR);
                const created = await createAgentSessionFromServices({
                        services,
                        sessionManager,
                        model,
                        thinkingLevel: "off",
                });
                session = created.session;

                // SessionStart receipt: pi only emits `session_start` to extensions
                // from the UI modes (bindExtensions in interactive/rpc/print mode);
                // the SDK path used here never calls it — 57/57 production runs had
                // zero SessionStart rows. Log the memory-version binding explicitly
                // so every engine run carries the audit receipt.
                logHook(runId, "SessionStart", null, "log", `session started (memory v${memoryVersion})`);

                session.subscribe((e: any) => {
                        try {
                                if (e.type === "tool_execution_start") {
                                        toolsUsed.push(e.toolName);
                                        transcript.push({
                                                type: "tool_start",
                                                ts: Date.now(),
                                                tool: e.toolName,
                                                input: JSON.stringify(e.args ?? {}).slice(0, 1200),
                                        });
                                        emit("run:tool", { runId, tool: e.toolName, phase: "start" });
                                        touchLiveRun(runId, (p) => {
                                                p.toolCalls = toolsUsed.length;
                                                p.toolsUsed = [...toolsUsed];
                                                p.lastTool = { tool: e.toolName, phase: "start", at: Date.now() };
                                        });
                                } else if (e.type === "tool_execution_end") {
                                        const content = Array.isArray(e.result?.content)
                                                ? e.result.content
                                                                .map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`))
                                                                .join("\n")
                                                                .slice(0, 2500)
                                                : "";
                                        transcript.push({
                                                type: "tool_end",
                                                ts: Date.now(),
                                                tool: e.toolName,
                                                output: content,
                                                isError: Boolean(e.isError),
                                        });
                                        emit("run:tool", { runId, tool: e.toolName, phase: "end", isError: Boolean(e.isError) });
                                        touchLiveRun(runId, (p) => {
                                                p.lastTool = { tool: e.toolName, phase: "end", isError: Boolean(e.isError), at: Date.now() };
                                        });
                                } else if (e.type === "message_end" && e.message?.role === "assistant") {
                                        const usage = e.message.usage;
                                        if (usage) {
                                                tokensIn += usage.input ?? 0;
                                                tokensOut += usage.output ?? 0;
                                                // §3.7 — track the live context window size
                                                // (the LATEST input-tokens value, not the
                                                // cumulative sum — see currentContextTokens
                                                // declaration above for why this is the live
                                                // context size).
                                                if (typeof usage.input === "number" && usage.input >= 0) {
                                                        currentContextTokens = usage.input;
                                                }
                                        }
                                        touchLiveRun(runId, (p) => {
                                                p.tokensIn = tokensIn;
                                                p.tokensOut = tokensOut;
                                                p.contextTokens = currentContextTokens;
                                        });
                                        const text = (e.message.content ?? [])
                                                .filter((b: any) => b.type === "text")
                                                .map((b: any) => b.text)
                                                .join("");
                                        if (text.trim()) {
                                                lastAssistantText = text;
                                                transcript.push({ type: "text", ts: Date.now(), text: text.slice(0, 4000) });
                                                emit("run:text", { runId, preview: text.slice(0, 240) });
                                                touchLiveRun(runId, (p) => {
                                                        p.lastTextPreview = text.slice(0, 240);
                                                });
                                        }
                                } else if (e.type === "turn_end") {
                                        turns++;
                                        touchLiveRun(runId, (p) => {
                                                p.turns = turns;
                                        });
                                        // §3.7 — auto-compact guard. After each turn ends
                                        // (and BEFORE the next one starts), check whether
                                        // the session is approaching the context window
                                        // limit and dispatch warn / compact / block per the
                                        // proportional threshold curve. Defensive: the
                                        // helper never throws (telemetry invariant).
                                        checkAutoCompact(session, runId, currentContextTokens, RUNNER_MAX_CONTEXT_WINDOW);
                                }
                        } catch {
                                /* never let telemetry break the run */
                        }
                });

                // Watchdog — generous: rate-limit backoffs can add ~60s+ per LLM call.
                const timeoutMs = opts.timeoutMs ?? 600_000;
                const watchdog = setTimeout(() => {
                        try {
                                session?.abort();
                        } catch {
                                /* ignore */
                        }
                }, timeoutMs);

                try {
                        await session.prompt(opts.prompt);
                } finally {
                        clearTimeout(watchdog);
                }

                // Verify
                let verify: RunResult["verify"];
                if (opts.verify) {
                        const v = await verifyInSandbox(sandbox, opts.verify);
                        verify = {
                                passed: v.passed,
                                summary: v.summary || (v.passed ? "all tests passed" : "tests failed"),
                                log: v.log,
                                // M6-3: which OS jail the verify exec ran under — persisted
                                // inside verify_output, next to the agent-shell level on the row.
                                isolation: v.isolation,
                        };
                }

                // A run where the model never produced output AND never called a tool is an
                // infrastructure failure (e.g. upstream rate limit), not a task failure —
                // mark it 'error' so the harness retries instead of mining junk.
                const llmDead = tokensOut === 0 && toolsUsed.length === 0 && !lastAssistantText;
                const status: RunResult["status"] = verify
                        ? verify.passed
                                ? "passed"
                                : llmDead
                                        ? "error"
                                        : "failed"
                        : llmDead
                                ? "error"
                                : "passed";
                return await finalize(status, verify);
        } catch (err: any) {
                const runError = err?.message ?? String(err);
                try {
                        return await finalize("error", undefined, runError);
                } catch (finErr: any) {
                        // LOW-3: if the DB itself is the failing component, finalize throws
                        // and would REPLACE the original run error (and strand the row at
                        // 'running'). Record both; recoverOrphans heals the row at next boot.
                        console.error(`[runner] finalize failed after run error (${runError}): ${finErr?.message ?? finErr}`);
                        return {
                                id: runId,
                                status: "error",
                                verify: undefined,
                                transcript,
                                sandboxId: sandbox.id,
                                tokensIn,
                                tokensOut,
                                toolCalls: toolsUsed.length,
                                turns,
                                lastAssistantText,
                                toolsUsed,
                                durationMs: Date.now() - startedAt,
                                error: `${runError} (finalize also failed: ${finErr instanceof Error ? finErr.message : String(finErr)})`,
                        };
                }
        } finally {
                // Belt-and-braces for the live-progress registry: finalize already
                // drops the entry on every path, but a future early-return must not
                // leak a phantom "running" entry into /api/runs/live.
                finishLiveRun(runId);
                try {
                        session?.dispose();
                } catch {
                        /* ignore */
                }
        }
}

export function getRun(id: string) {
        const row = store.get<any>(`SELECT * FROM runs WHERE id = ?`, [id]);
        if (!row) return undefined;
        return {
                ...row,
                transcript: row.transcript ? JSON.parse(row.transcript) : [],
                verify_output: row.verify_output ? JSON.parse(row.verify_output) : null,
        };
}

export function listRuns(limit = 50, taskId?: string, kind?: string) {
        const conds: string[] = ["1=1"];
        const params: any[] = [];
        if (taskId) {
                conds.push("task_id = ?");
                params.push(taskId);
        }
        if (kind) {
                conds.push("kind = ?");
                params.push(kind);
        }
        params.push(limit);
        return store.query<any>(
                `SELECT id, task_id, kind, status, started_at, ended_at, sandbox_id, cycle_id, improvement_id, tokens_in, tokens_out, tool_calls, turns, error, sandbox_isolation
                 FROM runs WHERE ${conds.join(" AND ")} ORDER BY started_at DESC LIMIT ?`,
                params,
        );
}
