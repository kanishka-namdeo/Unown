/**
 * fleet-runtime.ts — the parent-side fleet manager + TUI surface.
 *
 * The runtime half of the interactive-subagents port (fleet.ts holds the pure
 * protocols): spawns async fire-and-forget subagents, tails their stdout event
 * streams live, runs the 1s watcher (stall classification, ask polling, exit
 * detection), delivers results back into the session as steer messages that
 * trigger a new turn, and owns the widget + footer + task_control tool +
 * renderers + /tasks command.
 *
 * Substrate: plain subprocesses + atomic control files (fleet.ts) — no tmux,
 * no PTY tricks, identical on Windows / macOS / Linux. The child half is
 * fleet-child.ts (injected by cli.ts when the fleet env is present).
 *
 * Surface (wired from tools.ts's unown-tools extension):
 *   - spawnFleetChild(agent, task, opts)   → immediate ack; result arrives later
 *   - steerFleetChild(name|id, message)    → steer if running, resume if finished
 *   - stopFleetChild(name|id)              → polite stop + tree kill fallback
 *   - fleetStatus() / fleetList()          → live states / registry view
 *   - registerFleetSurface(pi, manager)    → task_control tool, /tasks,
 *                                            renderers, widget + footer loop
 *
 * Standing invariant: no fork of the pi substrate; everything lands on the
 * documented extension seams (registerTool, registerCommand,
 * registerMessageRenderer, sendMessage, setWidget, setStatus).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { stableLaneIndex, Text } from "@earendil-works/pi-tui";
import { cleanupWorktree, type WorktreeHandle } from "./worktree.ts";
import {
        appendControlCommand,
        buildFleetQuestionContent,
        buildFleetResultContent,
        classifyFleetStatus,
        FLEET_ASK_ENV,
        FLEET_BATCH_DEBOUNCE_MS,
        FLEET_BATCH_MAX_WAIT_MS,
        FLEET_CONTROL_ENV,
        FLEET_ID_ENV,
        FLEET_SESSION_ENV,
        type FleetChildState,
        type FleetLoadout,
        type FleetStatus,
        formatFleetStatusLine,
        formatFleetWidgetLines,
        isFleetBlocked,
        isTerminalFleetStatus,
        mergeFleetResultContents,
        nextFleetStatus,
        readFleetRegistry,
        resolveFleetTimeoutMs,
        writeFleetRegistry,
        writeLoadout,
} from "./fleet.ts";
import { buildSubagentArgs, type SubagentRoutingFields } from "./subagent-routing.ts";
import { CHILD_BOUNDARY_INSTRUCTIONS } from "./subagent-catalog.ts";

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export interface FleetManagerOptions {
        cwd: string;
        /** Where fleet runtime state lives (default <cwd>/.unown/fleet). */
        fleetDir?: string;
        /** Timeout override (tests). */
        timeoutMs?: number;
        /** How the unown binary is invoked (mirrors tools.ts's seam). */
        invocation: (args: string[]) => { command: string; args: string[] };
        /** Minimal logger. */
        log?: (message: string) => void;
        /** Process spawn seam (tests). */
        spawnProc?: typeof spawn;
}

export interface FleetSpawnRequest {
        agent: string;
        task: string;
        name?: string;
        model?: string;
        cwd?: string;
        /** Agent routing fields (tools/model/effort/mcpServers/injectAgentsMd). */
        routing: SubagentRoutingFields;
        /** Tool allowlist for the child (agent.tools). */
        tools?: string[];
        /** The agent's system prompt (boundary instructions appended here). */
        systemPrompt: string;
        /** A worktree path to run in (composed with the task tool's lane). */
        runCwd?: string;
        /** Explicit session file (resume: the ORIGINAL transcript, so the
         *  child continues with full context instead of a fresh file). */
        sessionFile?: string;
}

/** Live process bookkeeping the state record deliberately omits. */
interface FleetProc {
        proc: ReturnType<typeof spawn>;
        stdoutBuffer: string;
        stderrBuffer: string;
        watchdog: ReturnType<typeof setTimeout>;
        askSeen: boolean;
        exited: boolean;
}

export class FleetManager {
        readonly children = new Map<string, FleetChildState>();
        private readonly procs = new Map<string, FleetProc>();
        private readonly fleetDir: string;
        private readonly log: (message: string) => void;
        private watcher: ReturnType<typeof setInterval> | null = null;
        private ui: {
                setWidget: (key: string, lines: string[] | undefined) => void;
                setStatus: (key: string, text: string | undefined) => void;
                theme?: any;
                notify?: (text: string, level?: string) => void;
        } | null = null;
        private deliver: ((content: string, details: unknown, kind: "result" | "question" | "status") => void) | null = null;
        private readonly timeoutMs: number;
        private readonly spawnProc: typeof spawn;
        private readonly invocation: (args: string[]) => { command: string; args: string[] };
        /** Worktrees adopted from the task tool's isolation lane, disposed on finalize. */
        private readonly worktrees = new Map<string, WorktreeHandle>();
        /** Completion batching (cciotti port): buffered successes + flush timers. */
        private pendingResults: Array<{ name: string; content: string }> = [];
        private batchTimer: ReturnType<typeof setTimeout> | null = null;
        private batchDeadline: ReturnType<typeof setTimeout> | null = null;

        constructor(private readonly opts: FleetManagerOptions) {
                this.fleetDir = opts.fleetDir ?? join(opts.cwd, ".unown", "fleet");
                this.log = opts.log ?? (() => {});
                this.timeoutMs = opts.timeoutMs ?? resolveFleetTimeoutMs();
                this.spawnProc = opts.spawnProc ?? spawn;
                this.invocation = opts.invocation;
                fleetManagers().add(this);
        }

        /** Bind the session surface: UI hooks + message delivery (sendMessage). */
        bind(
                ui: FleetManager["ui"],
                deliver: (content: string, details: unknown, kind: "result" | "question" | "status") => void,
        ): void {
                this.ui = ui;
                this.deliver = deliver;
        }

        fleetDirPath(): string {
                return this.fleetDir;
        }

        /** Adopt a worktree created by the task tool's isolation lane — the
         *  manager disposes it (cleanup per remove_if_clean) when the child
         *  finalizes, and the disposition lands in the result message. */
        adoptWorktree(id: string, tree: WorktreeHandle): void {
                this.worktrees.set(id, tree);
        }

        /** Names currently taken (running + reserved). */
        takenNames(): Set<string> {
                const taken = new Set<string>();
                for (const child of this.children.values()) taken.add(child.name);
                const registry = readFleetRegistry(this.fleetDir);
                for (const name of Object.keys(registry.names)) taken.add(name);
                return taken;
        }

        /**
         * Spawn one async fleet child. Returns the immediate ack the task tool
         * hands back; the child's result arrives later as a steer message.
         */
        spawnFleetChild(request: FleetSpawnRequest): { ok: true; id: string; name: string } | { ok: false; error: string } {
                const runCwd = request.runCwd ?? request.cwd ?? this.opts.cwd;
                try {
                        mkdirSync(join(this.fleetDir, "sessions"), { recursive: true });
                } catch {
                        return { ok: false, error: "fleet state directory could not be created" };
                }
                const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                // Unique-ify against running + registry names.
                const taken = this.takenNames();
                const base = request.name ?? request.agent;
                let name = base;
                let suffix = 2;
                while (taken.has(name)) {
                        name = `${base}-${suffix++}`;
                }
                const sessionFile = request.sessionFile ?? join(this.fleetDir, "sessions", `${name}-${id}.jsonl`);
                const controlFile = join(this.fleetDir, `${id}.control.json`);
                const askFile = join(this.fleetDir, `${id}.ask.json`);

                // The session file flag replaces --no-session for fleet children
                // (resume needs the transcript on disk).
                const args = buildSubagentArgs({
                        name: request.agent,
                        model: request.model ?? request.routing.model,
                        effort: request.routing.effort,
                        mcpServers: request.routing.mcpServers,
                        injectAgentsMd: request.routing.injectAgentsMd,
                        tools: request.tools,
                }).filter((flag) => flag !== "--no-session");
                // The ask channel is fleet infrastructure, not agent surface: pi's
                // --tools allowlist filters extension tools too, so a restricted
                // agent (explore: read,grep,find,ls) would lose ask_question and
                // could only reply BLOCKED (measured live in the s9-fleet capture).
                // Ride the allowlist explicitly — the tool still no-ops gracefully
                // when no ask channel exists.
                const toolsFlag = args.indexOf("--tools");
                if (
                        toolsFlag !== -1 &&
                        typeof args[toolsFlag + 1] === "string" &&
                        !args[toolsFlag + 1].split(",").map((s) => s.trim()).includes("ask_question")
                ) {
                        args[toolsFlag + 1] = `${args[toolsFlag + 1]},ask_question`;
                }
                args.push("--session", sessionFile);

                const systemPrompt = request.systemPrompt.trim()
                        ? `${request.systemPrompt.trim()}\n\n${CHILD_BOUNDARY_INSTRUCTIONS}\n\nYou may use the ask_question tool to ask the orchestrator one clarifying question if the task cannot proceed safely.`
                        : `${CHILD_BOUNDARY_INSTRUCTIONS}\n\nYou may use the ask_question tool to ask the orchestrator one clarifying question if the task cannot proceed safely.`;

                const loadout: FleetLoadout = {
                        version: 1,
                        name,
                        agentName: request.agent,
                        task: request.task,
                        cwd: runCwd,
                        model: request.model ?? request.routing.model,
                        effort: request.routing.effort,
                        tools: (request.routing as { tools?: string[] }).tools,
                        mcpServers: request.routing.mcpServers,
                        injectAgentsMd: request.routing.injectAgentsMd,
                        systemPrompt,
                        sessionFile,
                        createdAt: Date.now(),
                };
                writeLoadout(loadout);

                // System prompt via temp file (same shape as the sync lane would
                // use; the file lives on for the resume replay).
                const promptFile = `${sessionFile}.system-prompt.md`;
                try {
                        const { writeFileSync } = require("node:fs") as typeof import("node:fs");
                        writeFileSync(promptFile, systemPrompt, { encoding: "utf8", mode: 0o600 });
                } catch {
                        return { ok: false, error: "failed to write the fleet system-prompt file" };
                }
                args.push("--append-system-prompt", promptFile);
                args.push(`Task: ${request.task}`);

                const state: FleetChildState = {
                        id,
                        name,
                        agent: request.agent,
                        task: request.task,
                        model: request.model ?? request.routing.model,
                        cwd: runCwd,
                        startedAt: Date.now(),
                        status: "starting",
                        toolCount: 0,
                        turns: 0,
                        usage: { input: 0, output: 0 },
                        sessionFile,
                        lastActivityAt: Date.now(),
                        steerCount: 0,
                };
                this.children.set(id, state);

                const invocation = this.invocation(args);
                const proc = this.spawnProc(invocation.command, invocation.args, {
                        cwd: runCwd,
                        shell: false,
                        stdio: ["ignore", "pipe", "pipe"],
                        env: {
                                ...process.env,
                                UNOWN_SUBAGENT: "1",
                                [FLEET_CONTROL_ENV]: controlFile,
                                [FLEET_ASK_ENV]: askFile,
                                [FLEET_ID_ENV]: id,
                                [FLEET_SESSION_ENV]: sessionFile,
                        },
                }) as ReturnType<typeof spawn>;
                const entry: FleetProc = {
                        proc,
                        stdoutBuffer: "",
                        stderrBuffer: "",
                        watchdog: setTimeout(() => this.stop(id, `timed out after ${this.timeoutMs / 1000}s`),
                                this.timeoutMs),
                        askSeen: false,
                        exited: false,
                };
                if (typeof entry.watchdog.unref === "function") entry.watchdog.unref();
                this.procs.set(id, entry);

                const touch = (kind: Parameters<typeof nextFleetStatus>[1], extra?: Partial<FleetChildState>) => {
                        const next = nextFleetStatus(state, kind);
                        state.status = next.status;
                        state.lastActivityAt = Date.now();
                        if (extra) Object.assign(state, extra);
                        this.refreshUi();
                };

                const processLine = (line: string) => {
                        if (!line.trim()) return;
                        let event: any;
                        try {
                                event = JSON.parse(line);
                        } catch {
                                return;
                        }
                        if (event?.type === "message_end" && event.message) {
                                const msg = event.message;
                                if (msg.role === "assistant") {
                                        state.turns++;
                                        if (msg.usage) {
                                                state.usage.input += msg.usage.input || 0;
                                                state.usage.output += msg.usage.output || 0;
                                        }
                                        const content = msg.content;
                                        const text = Array.isArray(content)
                                                ? content.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("\n")
                                                : "";
                                        if (text.trim()) state.lastText = text;
                                        if (msg.stopReason === "error") {
                                                touch("error", { stderr: String(msg.errorMessage ?? "provider error").slice(0, 2000) });
                                        } else {
                                                touch("assistant-message");
                                        }
                                }
                        } else if (event?.type === "tool_execution_start") {
                                touch("tool-start", { currentTool: String(event.toolName ?? "tool") });
                        } else if (event?.type === "tool_execution_end") {
                                state.toolCount++;
                                touch("tool-end", { currentTool: undefined });
                        }
                };

                proc.stdout!.on("data", (data) => {
                        entry.stdoutBuffer += data.toString();
                        const lines = entry.stdoutBuffer.split("\n");
                        entry.stdoutBuffer = lines.pop() || "";
                        for (const line of lines) processLine(line);
                });
                proc.stderr!.on("data", (data) => {
                        entry.stderrBuffer = (entry.stderrBuffer + data.toString()).slice(0, 2000);
                });
                proc.on("error", () => {
                        if (entry.exited) return;
                        entry.exited = true;
                        state.status = "failed";
                        state.stderr = (entry.stderrBuffer + "\nfailed to spawn fleet child").slice(0, 2000);
                        state.endedAt = Date.now();
                        this.finalize(id);
                });
                proc.on("close", (code) => {
                        if (entry.exited) return;
                        entry.exited = true;
                        if (entry.stdoutBuffer.trim()) processLine(entry.stdoutBuffer);
                        state.exitCode = code ?? 0;
                        state.endedAt = Date.now();
                        const blocked = isFleetBlocked(state.lastText ?? "");
                        if (state.status !== "failed" && state.status !== "stopped") {
                                if (blocked.blocked) {
                                        state.status = "blocked";
                                        state.blockReason = blocked.reason;
                                } else {
                                        state.status = code === 0 ? "done" : "failed";
                                }
                        }
                        if (!state.lastText && entry.stderrBuffer.trim()) {
                                state.stderr = entry.stderrBuffer.slice(0, 2000);
                        }
                        this.finalize(id);
                });

                this.startWatcher();
                this.refreshUi();
                this.log(`fleet child ${name} (${request.agent}) spawned: ${request.task.slice(0, 80)}`);
                return { ok: true, id, name };
        }

        /** Steer a running child (or queue a resume when it finished). */
        steer(idOrName: string, message: string): { ok: true; delivered: "steer" | "resume" } | { ok: false; error: string } {
                const child = this.find(idOrName);
                if (!child) return { ok: false, error: `no fleet child named "${idOrName}" (running or in the registry)` };
                const proc = this.procs.get(child.id);
                if (proc && !isTerminalFleetStatus(child.status)) {
                        const controlFile = this.controlFileOf(child.id);
                        appendControlCommand(controlFile, { kind: "steer", text: message });
                        child.steerCount++;
                        // A just-steered child must not read as stalled (the
                        // upstream forceStatusAfterInterrupt rule).
                        child.status = nextFleetStatus(child, "steered").status;
                        child.lastActivityAt = Date.now();
                        this.refreshUi();
                        return { ok: true, delivered: "steer" };
                }
                // Finished: resume through the registry (relaunch with the loadout).
                const resumed = this.resume(child);
                if (!resumed.ok) return resumed;
                return { ok: true, delivered: "resume" };
        }

        /** Resume a finished child by relaunching its session with the original loadout. */
        resume(child: FleetChildState): { ok: true; id: string } | { ok: false; error: string } {
                if (!existsSync(child.sessionFile)) {
                        return { ok: false, error: `session file for "${child.name}" no longer exists — cannot resume` };
                }
                const loadout = this.readLoadoutFor(child);
                if (!loadout) {
                        return { ok: false, error: `no loadout sidecar for "${child.name}" — refusing to relaunch unrestricted` };
                }
                // Fresh state entry, same name, same session file (resume semantics).
                this.children.delete(child.id);
                this.procs.delete(child.id);
                const request: FleetSpawnRequest = {
                        agent: loadout.agentName,
                        task: `Continue the previous task: ${loadout.task}`,
                        name: child.name,
                        model: loadout.model,
                        cwd: loadout.cwd,
                        routing: {
                                model: loadout.model,
                                effort: loadout.effort as SubagentRoutingFields["effort"],
                                mcpServers: loadout.mcpServers,
                                injectAgentsMd: loadout.injectAgentsMd,
                        },
                        tools: loadout.tools,
                        systemPrompt: loadout.systemPrompt,
                };
                const spawned = this.spawnFleetChild({ ...request, sessionFile: child.sessionFile });
                if (!spawned.ok) return spawned;
                return { ok: true, id: spawned.id };
        }

        /** Stop a child: polite control command, then a hard tree kill shortly after. */
        stop(idOrName: string, reason = "stopped by the orchestrator"): { ok: true } | { ok: false; error: string } {
                const child = this.find(idOrName);
                if (!child) return { ok: false, error: `no fleet child named "${idOrName}"` };
                const proc = this.procs.get(child.id);
                if (!proc || isTerminalFleetStatus(child.status)) {
                        return { ok: false, error: `"${child.name}" is not running (status: ${child.status})` };
                }
                appendControlCommand(this.controlFileOf(child.id), { kind: "stop" });
                child.status = "stopped";
                child.endedAt = Date.now();
                // Grace window, then tree kill (taskkill /F /T on win32 — same
                // approach as the sync lane's killSubagentTree).
                setTimeout(() => this.killTree(proc.proc), 3000);
                this.finalize(child.id);
                this.log(`fleet child ${child.name} stopped: ${reason}`);
                return { ok: true };
        }

        statusSnapshot(): FleetChildState[] {
                return [...this.children.values()];
        }

        /** Find by id, by name, or by registry name (finished children). */
        find(idOrName: string): FleetChildState | null {
                const direct = this.children.get(idOrName);
                if (direct) return direct;
                for (const child of this.children.values()) {
                        if (child.name === idOrName) return child;
                }
                const registry = readFleetRegistry(this.fleetDir);
                const entry = registry.names[idOrName];
                if (entry) {
                        return {
                                id: entry.id,
                                name: idOrName,
                                agent: "(registry)",
                                task: "",
                                cwd: this.opts.cwd,
                                startedAt: entry.finishedAt,
                                status: entry.status,
                                toolCount: 0,
                                turns: 0,
                                usage: { input: 0, output: 0 },
                                sessionFile: entry.sessionFile,
                                lastActivityAt: entry.finishedAt,
                                lastText: entry.summary,
                                steerCount: 0,
                                endedAt: entry.finishedAt,
                        };
                }
                return null;
        }

        // -------------------------------------------------------------------
        // internals
        // -------------------------------------------------------------------

        private controlFileOf(id: string): string {
                return join(this.fleetDir, `${id}.control.json`);
        }

        private readLoadoutFor(child: FleetChildState): FleetLoadout | null {
                try {
                        const sidecar = `${child.sessionFile}.loadout.json`;
                        if (!existsSync(sidecar)) return null;
                        return JSON.parse(readFileSync(sidecar, "utf8")) as FleetLoadout;
                } catch {
                        return null;
                }
        }

        private killTree(proc: { pid?: number; kill(signal?: NodeJS.Signals | number): boolean }): void {
                if (process.platform === "win32") {
                        if (proc.pid === undefined) return;
                        try {
                                const killer = this.spawnProc(
                                        join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
                                        ["/F", "/T", "/PID", String(proc.pid)],
                                        { stdio: "ignore", detached: true, windowsHide: true },
                                ) as ReturnType<typeof spawn>;
                                killer.once("error", () => {});
                        } catch {
                                try {
                                        proc.kill("SIGKILL");
                                } catch {
                                        /* already gone */
                                }
                        }
                        return;
                }
                try {
                        proc.kill("SIGTERM");
                } catch {
                        /* already gone */
                }
                setTimeout(() => {
                        try {
                                proc.kill("SIGKILL");
                        } catch {
                                /* already gone */
                        }
                }, 5000);
        }

        private startWatcher(): void {
                if (this.watcher) return;
                this.watcher = setInterval(() => this.tick(), 1000);
                if (typeof this.watcher.unref === "function") this.watcher.unref();
        }

        /** One watcher pass — public for tests (the runtime runs it on a 1s interval). */
        tick(): void {
                const now = Date.now();
                let anyRunning = false;
                for (const child of this.children.values()) {
                        if (isTerminalFleetStatus(child.status)) continue;
                        anyRunning = true;
                        // Stall classification (never overrides waiting-for-answer).
                        child.status = classifyFleetStatus(child, now);
                        // Ask polling: the child wrote its ask file. Deliver the
                        // question ONCE per distinct ask (pendingQuestion tracks the
                        // delivered one; it clears when the child removes the file).
                        // Re-delivering on every status flip looped the parent
                        // (measured live: steer → active → tick re-asks → ad
                        // infinitum) — the file PERSISTING while the child is
                        // parked is the steady state, not a new question.
                        const askFile = join(this.fleetDir, `${child.id}.ask.json`);
                        if (existsSync(askFile)) {
                                try {
                                        const payload = JSON.parse(readFileSync(askFile, "utf8")) as { question?: string };
                                        if (payload?.question) {
                                                if (child.pendingQuestion !== payload.question) {
                                                        child.pendingQuestion = payload.question;
                                                        this.deliverQuestion(child, payload.question);
                                                }
                                                if (child.status !== "waiting-for-answer") {
                                                        child.status = "waiting-for-answer";
                                                }
                                        }
                                } catch {
                                        /* partial write — retry next tick */
                                }
                        } else if (child.pendingQuestion) {
                                child.pendingQuestion = undefined;
                        }
                }
                this.refreshUi();
                if (!anyRunning && this.watcher) {
                        clearInterval(this.watcher);
                        this.watcher = null;
                        // Leave the widget up briefly to show final states, then clear.
                        setTimeout(() => this.refreshUi(), 1500);
                }
        }

        private finalize(id: string): void {
                const child = this.children.get(id);
                const proc = this.procs.get(id);
                if (proc) {
                        clearTimeout(proc.watchdog);
                        this.procs.delete(id);
                }
                if (!child) return;
                child.endedAt = child.endedAt ?? Date.now();
                // Worktree disposition (remove_if_clean — kept trees carry the
                // path for merge; nothing merges automatically).
                const tree = this.worktrees.get(id);
                let treeNote = "";
                if (tree) {
                        this.worktrees.delete(id);
                        try {
                                void cleanupWorktree(tree).then((cleanup) => {
                                        this.log(`fleet child ${child.name} worktree ${cleanup.action}: ${cleanup.detail}`);
                                });
                                treeNote = `\n[worktree ${tree.path}]`;
                        } catch {
                                /* best effort */
                        }
                }
                // Record into the registry (name → session, for resume).
                try {
                        const registry = readFleetRegistry(this.fleetDir);
                        registry.names[child.name] = {
                                sessionFile: child.sessionFile,
                                id: child.id,
                                status: child.status,
                                finishedAt: child.endedAt,
                                summary: (child.lastText ?? "").slice(0, 400),
                        };
                        writeFleetRegistry(this.fleetDir, registry);
                } catch {
                        /* best effort */
                }
                // Deliver the result — with completion batching (cciotti port):
                // successes coalesce (150ms debounce, 1s max wait) so a fan-out of
                // N children wakes the parent ONCE, not N times; failures and
                // blocked replies bypass the batch (bad news races).
                if (this.deliver) {
                        const content = buildFleetResultContent(child);
                        const urgent = child.status !== "done";
                        if (urgent) {
                                this.flushPendingResults();
                                try {
                                        this.deliver(content, { fleet: { ...child, pendingQuestion: undefined } }, "result");
                                } catch (err) {
                                        this.log(`fleet deliver failed for ${child.name}: ${err}`);
                                }
                        } else {
                                this.pendingResults.push({ name: child.name, content });
                                if (!this.batchDeadline) {
                                        this.batchDeadline = setTimeout(() => this.flushPendingResults(), FLEET_BATCH_MAX_WAIT_MS);
                                }
                                if (this.batchTimer) clearTimeout(this.batchTimer);
                                this.batchTimer = setTimeout(() => this.flushPendingResults(), FLEET_BATCH_DEBOUNCE_MS);
                        }
                }
                this.refreshUi();
        }

        /** Flush the buffered success batch as ONE delivered message. */
        private flushPendingResults(): void {
                if (this.batchTimer) {
                        clearTimeout(this.batchTimer);
                        this.batchTimer = null;
                }
                if (this.batchDeadline) {
                        clearTimeout(this.batchDeadline);
                        this.batchDeadline = null;
                }
                if (this.pendingResults.length === 0 || !this.deliver) return;
                const batch = this.pendingResults;
                this.pendingResults = [];
                const content = mergeFleetResultContents(batch);
                try {
                        this.deliver(content, { fleetBatch: batch.map((b) => b.name) }, "result");
                } catch (err) {
                        this.log(`fleet batch deliver failed: ${err}`);
                }
        }

        private deliverQuestion(child: FleetChildState, question: string): void {
                if (!this.deliver) return;
                const content = buildFleetQuestionContent(child, question);
                try {
                        this.deliver(content, { fleetQuestion: { id: child.id, name: child.name, question } }, "question");
                } catch (err) {
                        this.log(`fleet question deliver failed for ${child.name}: ${err}`);
                }
        }

        private refreshUi(): void {
                if (!this.ui) return;
                const children = this.statusSnapshot();
                const running = children.filter((c) => !isTerminalFleetStatus(c.status));
                if (running.length === 0) {
                        this.ui.setWidget("unown-fleet", undefined);
                        this.ui.setStatus("fleet", undefined);
                        return;
                }
                const theme = this.ui.theme;
                // Beauty-4 (subagent lanes): one stable lane color per child name.
                // The tokens mirror coding-agent's theme schema (subagentLane0..7);
                // a theme without the optional palette (getFgRgb undefined) keeps
                // the pre-lane widget rows byte-identical.
                const lanePalette = theme && typeof theme.getFgRgb === "function" ? theme.getFgRgb("subagentLane0") : undefined;
                const lane =
                        lanePalette !== undefined
                                ? (childName: string, s: string) => theme?.fg?.(`subagentLane${stableLaneIndex(childName)}`, s) ?? s
                                : undefined;
                const widgetTheme = {
                        glyph: (status: FleetStatus) =>
                                status === "stalled"
                                        ? theme?.fg?.("error", "!") ?? "!"
                                        : status === "waiting-for-answer"
                                                ? theme?.fg?.("warning", "?") ?? "?"
                                                : status === "starting"
                                                        ? theme?.fg?.("dim", "○") ?? "○"
                                                        : theme?.fg?.("accent", "⟳") ?? "⟳",
                        dim: (s: string) => theme?.fg?.("muted", s) ?? s,
                        accent: (s: string) => theme?.fg?.("accent", s) ?? s,
                        warn: (s: string) => theme?.fg?.("warning", s) ?? s,
                        title: (s: string) => theme?.fg?.("toolTitle", s) ?? s,
                        lane,
                };
                try {
                        this.ui.setWidget("unown-fleet", formatFleetWidgetLines(children, widgetTheme));
                        const status = formatFleetStatusLine(children, widgetTheme);
                        this.ui.setStatus("fleet", status);
                } catch {
                        /* UI seam hiccup — never fatal */
                }
        }

        dispose(): void {
                if (this.watcher) {
                        clearInterval(this.watcher);
                        this.watcher = null;
                }
                // Deliver anything still buffered (successes wait in the batch
                // window; a shutdown must not swallow them).
                this.flushPendingResults();
                for (const proc of this.procs.values()) {
                        clearTimeout(proc.watchdog);
                        this.killTree(proc.proc);
                }
                this.procs.clear();
                this.children.clear();
                if (this.ui) {
                        this.ui.setWidget("unown-fleet", undefined);
                        this.ui.setStatus("fleet", undefined);
                }
                fleetManagers().delete(this);
        }
}

// ---------------------------------------------------------------------------
// Cross-module manager registry (Symbol.for, the /reload-survival pattern):
// cli.ts's print mode waits on the fleet drain so a headless `-p` run still
// delivers async results — the steer-back messages trigger new turns, which
// only land while the process is alive.
// ---------------------------------------------------------------------------

const FLEET_MANAGERS_SYMBOL = Symbol.for("unown-fleet-managers");

function fleetManagers(): Set<FleetManager> {
        const holders = globalThis as unknown as Record<symbol, Set<FleetManager> | undefined>;
        let set = holders[FLEET_MANAGERS_SYMBOL];
        if (!set) {
                set = new Set<FleetManager>();
                holders[FLEET_MANAGERS_SYMBOL] = set;
        }
        return set;
}

/**
 * Wait (bounded) until every live fleet manager has no running children.
 * Returns true when drained, false on timeout. Results that arrive during
 * the wait trigger their own turns through the session's steer path.
 */
export async function waitForFleetDrain(timeoutMs = resolveFleetTimeoutMs()): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
                const busy = [...fleetManagers()].some((m) =>
                        m.statusSnapshot().some((c) => !isTerminalFleetStatus(c.status)),
                );
                if (!busy) return true;
                if (Date.now() >= deadline) return false;
                await new Promise((r) => setTimeout(r, 500));
        }
}

/**
 * The print-mode drain sentinel: cmdPrint appends this as a final message;
 * the fleet's input handler intercepts it (before the model ever sees it),
 * waits for running children to finish — their results arrive as steer
 * messages that trigger real turns while the process is still alive — and
 * then drops the message entirely ({action: "handled"}). The NUL prefix
 * makes it untypeable in a terminal, so a user can never trigger it by hand.
 */
export const FLEET_DRAIN_SENTINEL = "\u0000__unown-fleet-drain__";

// ---------------------------------------------------------------------------
// TUI surface: task_control tool, /tasks command, renderers
// ---------------------------------------------------------------------------

const TaskControlParams = Type.Object({
        action: Type.Union([Type.Literal("status"), Type.Literal("steer"), Type.Literal("stop"), Type.Literal("list")], {
                description: "status: one child's live state · steer: send a message to a running child (or resume a finished one) · stop: stop a running child · list: running children + the resume registry",
        }),
        id: Type.Optional(Type.String({ description: "Fleet child name or id (required for steer/stop)" })),
        message: Type.Optional(Type.String({ description: "The steer/answer message text (required for steer)" })),
});

/**
 * Register the fleet's model-facing + human-facing surface on the unown-tools
 * extension's pi instance: the task_control tool, the /tasks command, and the
 * renderers for the custom messages the manager delivers.
 */
export function registerFleetSurface(pi: any, manager: FleetManager, opts: { cwd: string }): void {
        // Every seam call is typeof-guarded (the auto-compact port's rule):
        // older harnesses and host surfaces may not implement the renderer or
        // command registries, and the fleet surface must never break the
        // unown-tools extension that hosts it.
        const safeRegisterTool = (def: any) => {
                if (typeof pi?.registerTool === "function") pi.registerTool(def);
        };
        const safeRegisterCommand = (name: string, def: any) => {
                if (typeof pi?.registerCommand === "function") pi.registerCommand(name, def);
        };
        const safeRegisterRenderer = (type: string, fn: any) => {
                if (typeof pi?.registerMessageRenderer === "function") pi.registerMessageRenderer(type, fn);
        };
        const safeOn = (event: string, fn: any) => {
                if (typeof pi?.on === "function") pi.on(event, fn);
        };

        // ---- task_control tool (the cciotti-style control-verb facade).
        safeRegisterTool({
                name: "task_control",
                label: "Fleet control",
                description:
                        "Control the async subagent fleet spawned with the task tool's async mode. steer delivers a message to a RUNNING child mid-task (it is absorbed into the child's current turn) or RESUMES a finished child by name with its original context and sandbox. stop kills a running child. status shows one child's live state; list shows everything. Children that asked a question are parked until you steer the answer back.",
                parameters: TaskControlParams,
                async execute(_toolCallId: string, params: { action: string; id?: string; message?: string }) {
                        switch (params.action) {
                                case "list": {
                                        const running = manager
                                                .statusSnapshot()
                                                .filter((c) => !isTerminalFleetStatus(c.status))
                                                .map((c) => `- ${c.name} (${c.agent}) — ${c.status}${c.currentTool ? ` · ${c.currentTool}` : ""}`);
                                        const registry = readFleetRegistry(manager.fleetDirPath());
                                        const finished = Object.entries(registry.names)
                                                .slice(0, 16)
                                                .map(([name, entry]) => `- ${name} — ${entry.status} (resumable via steer)`);
                                        const parts = [
                                                running.length > 0 ? `Running:\n${running.join("\n")}` : "No subagents running.",
                                                finished.length > 0 ? `\nFinished (resume with steer):\n${finished.join("\n")}` : "",
                                        ];
                                        return { content: [{ type: "text", text: parts.filter(Boolean).join("\n") }] };
                                }
                                case "status": {
                                        if (!params.id) {
                                                return { content: [{ type: "text", text: "Error: provide id (name or id) for status" }] };
                                        }
                                        const child = manager.find(params.id);
                                        if (!child) {
                                                return { content: [{ type: "text", text: `Error: no fleet child named "${params.id}"` }] };
                                        }
                                        const lines = [
                                                `${child.name} (${child.agent}) — ${child.status}`,
                                                `task: ${child.task.slice(0, 200)}`,
                                                `turns: ${child.turns} · tools: ${child.toolCount} · steered: ${child.steerCount}x`,
                                                `usage: ${child.usage.input} in / ${child.usage.output} out`,
                                        ];
                                        if (child.currentTool) lines.push(`currently running: ${child.currentTool}`);
                                        if (child.pendingQuestion) lines.push(`PENDING QUESTION: ${child.pendingQuestion.slice(0, 500)}`);
                                        return { content: [{ type: "text", text: lines.join("\n") }] };
                                }
                                case "steer": {
                                        if (!params.id || !params.message?.trim()) {
                                                return { content: [{ type: "text", text: 'Error: steer needs id and message (task_control {action:"steer", id:"name", message:"…"})' }] };
                                        }
                                        const result = manager.steer(params.id, params.message);
                                        if (!result.ok) {
                                                return { content: [{ type: "text", text: `Error: ${result.error}` }] };
                                        }
                                        return {
                                                content: [
                                                        {
                                                                type: "text",
                                                                text:
                                                                        result.delivered === "steer"
                                                                                ? `Message delivered to ${params.id} — it will be absorbed into the child's current turn.`
                                                                                : `${params.id} had finished — it is being resumed with its original context; the message is its follow-up task.`,
                                                                        },
                                                                ],
                                                        };
                                                }
                                case "stop": {
                                        if (!params.id) {
                                                return { content: [{ type: "text", text: "Error: provide id for stop" }] };
                                        }
                                        const result = manager.stop(params.id);
                                        if (!result.ok) {
                                                return { content: [{ type: "text", text: `Error: ${result.error}` }] };
                                        }
                                        return { content: [{ type: "text", text: `Stop signal sent to ${params.id}.` }] };
                                }
                                default:
                                        return { content: [{ type: "text", text: `Error: unknown action "${params.action}"` }] };
                        }
                },
                renderCall(args: any, theme: any) {
                        // Beauty-4: the steered child's id rides in its lane color when the
                        // theme carries one (falls back to muted, legacy byte-identical).
                        const idColor = (s: string) =>
                                theme && typeof theme.getFgRgb === "function" && theme.getFgRgb("subagentLane0") !== undefined
                                        ? theme.fg(`subagentLane${stableLaneIndex(String(args.id))}`, s)
                                        : theme.fg("muted", s);
                        return new Text(
                                theme.fg("toolTitle", theme.bold("task_control ")) +
                                        theme.fg("accent", String(args.action ?? "")) +
                                        (args.id ? ` ${idColor(String(args.id))}` : "") +
                                        (args.message ? theme.fg("dim", ` "${String(args.message).slice(0, 40)}"`) : ""),
                                0,
                                0,
                        );
                },
                renderResult(result: any, _o: any, theme: any) {
                        const block = result.content?.[0];
                        return new Text(
                                theme.fg("muted", block?.type === "text" ? block.text.slice(0, 400) : "done"),
                                0,
                                0,
                        );
                },
        });

        // ---- /tasks command (human surface).
        safeRegisterCommand("tasks", {
                description: "Show the async subagent fleet (running children + resumable registry)",
                handler: async (_args: string, ctx: any) => {
                        const running = manager
                                .statusSnapshot()
                                .filter((c) => !isTerminalFleetStatus(c.status));
                        const registry = readFleetRegistry(manager.fleetDirPath());
                        const lines: string[] = [];
                        if (running.length > 0) {
                                lines.push(`Running (${running.length}):`);
                                for (const c of running) {
                                        lines.push(`  ${c.name} (${c.agent}) — ${c.status}${c.currentTool ? ` · ${c.currentTool}` : ""}`);
                                }
                        } else {
                                lines.push("No subagents running.");
                        }
                        const finished = Object.entries(registry.names).slice(0, 10);
                        if (finished.length > 0) {
                                lines.push("");
                                lines.push("Resumable (task_control steer <name> <message>):");
                                for (const [name, entry] of finished) {
                                        lines.push(`  ${name} — ${entry.status}`);
                                }
                        }
                        ctx.ui.notify(lines.join("\n"), "info");
                },
        });

        // ---- renderers for the delivered custom messages.
        safeRegisterRenderer("unown-subagent-result", (message: any, _opts: any, theme: any) => {
                const text = typeof message.content === "string" ? message.content : "";
                const header = text.split("\n", 1)[0] ?? "subagent result";
                const isFail = /FAILED|stopped|BLOCKED/.test(header);
                return new Text(
                        (isFail ? theme.fg("error", "✗ ") : theme.fg("success", "✓ ")) + theme.fg("muted", header),
                        0,
                        0,
                );
        });
        safeRegisterRenderer("unown-subagent-question", (message: any, _opts: any, theme: any) => {
                const text = typeof message.content === "string" ? message.content : "";
                const header = text.split("\n", 1)[0] ?? "subagent question";
                return new Text(theme.fg("warning", "? ") + theme.fg("muted", header), 0, 0);
        });

        // ---- lifecycle: bind the manager to the session's UI + sendMessage.
        safeOn("session_start", async (_event: any, ctx: any) => {
                manager.bind(
                        {
                                setWidget: (key, lines) => ctx?.ui?.setWidget?.(key, lines),
                                setStatus: (key, text) => ctx?.ui?.setStatus?.(key, text),
                                theme: ctx?.ui?.theme,
                                notify: (text, level) => ctx?.ui?.notify?.(text, level),
                        },
                        (content, _details, kind) => {
                                pi.sendMessage(
                                        {
                                                customType: kind === "question" ? "unown-subagent-question" : "unown-subagent-result",
                                                content,
                                                display: true,
                                                details: _details,
                                        },
                                        { triggerTurn: true, deliverAs: "steer" },
                                );
                        },
                );
        });
        // ---- print-mode drain: cmdPrint appends FLEET_DRAIN_SENTINEL as a final
        // message; intercept it here (the model never sees it), wait for the
        // fleet, and drop the message. Results that land during the wait run
        // as real turns while the process is still alive.
        safeOn("input", async (event: any) => {
                if (event?.text === FLEET_DRAIN_SENTINEL) {
                        await waitForFleetDrain();
                        return { action: "handled" } as const;
                }
                return undefined;
        });
        safeOn("session_shutdown", () => {
                manager.dispose();
        });
}
