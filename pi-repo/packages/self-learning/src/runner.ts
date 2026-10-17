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
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
        createAgentSessionFromServices,
        createAgentSessionServices,
        SessionManager,
        SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { emit } from "./bus.ts";
import { writeSandboxShell } from "./bwrap.ts";
import { createHooksExtension, logHook } from "./hooks.ts";
import { currentVersion, type MemoryOverlay, resolveMemoryForAgent } from "./memory.ts";
import { createNote, noteFromRun } from "./notes.ts";
import { createSandbox, seedFiles, snapshotFiles, verifyInSandbox } from "./sandbox.ts";
import { BRIDGE_URL, DATA_DIR, store } from "./store.ts";

export const AGENT_DIR = join(DATA_DIR, "pi-agent-dir");
export const SESSIONS_DIR = join(DATA_DIR, "sessions");
export const PROVIDER = process.env.PI_PROVIDER ?? "zai-bridge";
export const MODEL_ID = process.env.PI_MODEL_ID ?? "kimi-k2.5";

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
        verify?: { passed: boolean; summary: string; log: string };
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

/** Ensure the pi agent dir exists with a models.json pointing at the llm-bridge. */
export function ensureAgentDir() {
        mkdirSync(AGENT_DIR, { recursive: true });
        mkdirSync(SESSIONS_DIR, { recursive: true });
        const modelsPath = join(AGENT_DIR, "models.json");
        writeFileSync(
                modelsPath,
                JSON.stringify(
                        {
                                providers: {
                                        [PROVIDER]: {
                                                baseUrl: `${BRIDGE_URL}/v1`,
                                                api: "openai-completions",
                                                apiKey: "bridge-local",
                                                models: [
                                                        {
                                                                id: MODEL_ID,
                                                                name: `${MODEL_ID} (via llm-bridge)`,
                                                                contextWindow: 131072,
                                                                maxTokens: 8192,
                                                                input: ["text", "image"],
                                                        },
                                                ],
                                        },
                                },
                        },
                        null,
                        2,
                ),
                "utf8",
        );
}

export async function runAgent(opts: RunOptions): Promise<RunResult> {
        const runId = randomUUID();
        const sandbox = createSandbox(opts.label ?? opts.kind);
        const startedAt = Date.now();
        const memoryFiles = resolveMemoryForAgent(opts.memoryOverlay);
        const memoryVersion = currentVersion("project");

        store.run(
                `INSERT INTO runs (id, task_id, kind, status, started_at, sandbox_id, cycle_id, improvement_id, prompt)
                 VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
                [
                        runId,
                        opts.taskId ?? null,
                        opts.kind,
                        startedAt,
                        sandbox.id,
                        opts.cycleId ?? null,
                        opts.improvementId ?? null,
                        opts.prompt,
                ],
        );
        emit("run:started", { id: runId, kind: opts.kind, taskId: opts.taskId, sandbox: sandbox.id });

        if (opts.files) seedFiles(sandbox, opts.files);

        const transcript: TranscriptEntry[] = [];
        const toolsUsed: string[] = [];
        let tokensIn = 0;
        let tokensOut = 0;
        let turns = 0;
        let lastAssistantText = "";

        const finalize = async (
                status: RunResult["status"],
                verify: RunResult["verify"],
                error?: string,
        ): Promise<RunResult> => {
                const endedAt = Date.now();
                store.run(
                        `UPDATE runs SET status = ?, ended_at = ?, transcript = ?, verify_output = ?, tokens_in = ?, tokens_out = ?, tool_calls = ?, turns = ?, error = ? WHERE id = ?`,
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
                // generated bubblewrap wrapper (transparent when unavailable).
                const sandboxShell = writeSandboxShell(AGENT_DIR);

                const hooksExt = createHooksExtension({
                        runId,
                        sandboxRoot: sandbox.workspace,
                        memoryVersion,
                });

                const services = await createAgentSessionServices({
                        cwd: sandbox.workspace,
                        agentDir: AGENT_DIR,
                        settingsManager: SettingsManager.inMemory(sandboxShell ? { shellPath: sandboxShell } : {}),
                        resourceLoaderOptions: {
                                extensionFactories: [hooksExt as any],
                                noSkills: true,
                                noPromptTemplates: true,
                                noThemes: true,
                                noContextFiles: true,
                                agentsFilesOverride: () => ({
                                        agentsFiles: memoryFiles.map((f) => ({ path: f.path, content: f.content })),
                                }),
                        },
                });

                const model = services.modelRuntime.getModel(PROVIDER, MODEL_ID);
                if (!model) throw new Error(`model ${PROVIDER}/${MODEL_ID} unavailable`);

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
                                } else if (e.type === "message_end" && e.message?.role === "assistant") {
                                        const usage = e.message.usage;
                                        if (usage) {
                                                tokensIn += usage.input ?? 0;
                                                tokensOut += usage.output ?? 0;
                                        }
                                        const text = (e.message.content ?? [])
                                                .filter((b: any) => b.type === "text")
                                                .map((b: any) => b.text)
                                                .join("");
                                        if (text.trim()) {
                                                lastAssistantText = text;
                                                transcript.push({ type: "text", ts: Date.now(), text: text.slice(0, 4000) });
                                                emit("run:text", { runId, preview: text.slice(0, 240) });
                                        }
                                } else if (e.type === "turn_end") {
                                        turns++;
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
                return await finalize("error", undefined, err?.message ?? String(err));
        } finally {
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
                `SELECT id, task_id, kind, status, started_at, ended_at, sandbox_id, cycle_id, improvement_id, tokens_in, tokens_out, tool_calls, turns, error
                 FROM runs WHERE ${conds.join(" AND ")} ORDER BY started_at DESC LIMIT ?`,
                params,
        );
}
