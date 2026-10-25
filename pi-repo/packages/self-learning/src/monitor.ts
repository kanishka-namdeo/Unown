/**
 * monitor.ts — the `monitor` session tool: watch a command's output live.
 *
 * The 2026-10 convergence round (Claude Code Monitor tool, shipped Oct 2026):
 * the agent can start a long-running command (a dev server, `tail -f` on a
 * log, a test run with watch mode, a CI follow) and get the output lines back
 * as a first-class, bounded tool result — so it can react to what the process
 * prints instead of guessing from a one-shot exit code.
 *
 * Design (honest adaptation of Claude Code's streaming semantics to pi's
 * documented tool seams — no core fork):
 *   - The tool runs the command for a BOUNDED WINDOW (duration_ms, default
 *     30s, cap 120s), captures each stdout/stderr line with a timestamp, and
 *     returns them as one tool result. Claude Code feeds each line back
 *     mid-conversation; pi's tool loop is request/response, so the bounded
 *     window is the seam-honest equivalent — the agent re-calls monitor to
 *     keep following (the doc string says exactly that), and `stop_pattern`
 *     lets a watch end the moment the awaited line lands (e.g. "listening on").
 *   - Every bound exists twice: per-call clamps (max_lines, duration) and a
 *     hard result cap so a noisy `yes`-style pipe can never balloon the tool
 *     result (the F10 lesson: bounded beats best-effort).
 *   - Safety: the command passes the SAME deny-list the bash guardrail layer
 *     uses (bash-policy.ts decideBash) and — in plan mode — the read-only
 *     allowlist (isSafeCommand, injected by the tools.ts wiring to keep this
 *     module import-cycle-free). The child is killed on window end, line cap,
 *     stop-pattern, session abort signal, and session shutdown; a kill that
 *     will not die escalates to SIGKILL.
 *
 * Pure core + registration: runMonitor takes an injectable spawner for
 * tests; registerMonitorTool wires the pi ExtensionAPI seams.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { decideBash } from "./bash-policy.ts";

// ---------------------------------------------------------------------------
// Params + clamps
// ---------------------------------------------------------------------------

export const MONITOR_DEFAULT_DURATION_MS = 30_000;
export const MONITOR_MAX_DURATION_MS = 120_000;
export const MONITOR_DEFAULT_MAX_LINES = 200;
export const MONITOR_MAX_LINES = 2_000;
export const MONITOR_MAX_COMMAND_CHARS = 500;
export const MONITOR_MAX_PATTERN_CHARS = 256;
/** Lines kept after the line cap is hit (the freshest tail wins). */
export const MONITOR_RESULT_LINES = 200;

export interface MonitorParams {
        command: string;
        duration_ms?: number;
        max_lines?: number;
        stop_pattern?: string;
}

export function normalizeMonitorParams(raw: unknown): MonitorParams | { error: string } {
        const p = (raw ?? {}) as MonitorParams;
        if (typeof p.command !== "string" || !p.command.trim()) return { error: "command (string) is required" };
        if (p.command.length > MONITOR_MAX_COMMAND_CHARS) {
                return { error: `command too long (>${MONITOR_MAX_COMMAND_CHARS} chars) — monitor watches a process, not a script` };
        }
        const duration = clampNum(p.duration_ms, MONITOR_DEFAULT_DURATION_MS, 1_000, MONITOR_MAX_DURATION_MS);
        const maxLines = clampNum(p.max_lines, MONITOR_DEFAULT_MAX_LINES, 1, MONITOR_MAX_LINES);
        let stopPattern: string | undefined;
        if (typeof p.stop_pattern === "string" && p.stop_pattern.trim()) {
                if (p.stop_pattern.length > MONITOR_MAX_PATTERN_CHARS) return { error: "stop_pattern too long (max 256 chars)" };
                try {
                        new RegExp(p.stop_pattern);
                } catch {
                        return { error: "stop_pattern is not a valid regular expression" };
                }
                stopPattern = p.stop_pattern;
        }
        return { command: p.command.trim(), duration_ms: duration, max_lines: maxLines, stop_pattern: stopPattern };
}

function clampNum(v: unknown, dflt: number, min: number, max: number): number {
        const n = Number(v);
        if (!Number.isFinite(n)) return dflt;
        return Math.max(min, Math.min(max, Math.round(n)));
}

// ---------------------------------------------------------------------------
// The bounded capture window
// ---------------------------------------------------------------------------

export interface MonitorLine {
        ts: number;
        /** Origin stream ("out" | "err" | "exit"). */
        stream: "out" | "err" | "exit";
        text: string;
}

export type MonitorStopReason = "exit" | "duration" | "lines" | "pattern" | "abort";

export interface MonitorResult {
        lines: MonitorLine[];
        stoppedBy: MonitorStopReason;
        exitCode: number | null;
        durationMs: number;
        /** True when the line cap was hit and only the freshest tail is kept. */
        truncated: boolean;
}

export interface MonitorSpawner {
        (command: string, opts: { cwd: string }): {
                child: { pid?: number; kill(sig?: string): void; once(event: "exit", cb: (code: number | null) => void): unknown };
                stdout: { on(event: "data", cb: (chunk: unknown) => void): unknown };
                stderr: { on(event: "data", cb: (chunk: unknown) => void): unknown };
        };
}

/**
 * The win32 monitor spawn, as DATA (pure - pinned by
 * test/windows-spawn-verbatim.test.ts): `cmd /d /s /c` with the command
 * OUTER-quoted and the spawn VERBATIM. Node's default Windows arg escaping
 * re-escapes embedded quotes (`\"...\"`), which cmd.exe does not honor - the
 * engine-supervisor detach spawn of v0.0.16 popped "Windows cannot find
 * '\C:\...\unown.exe\'" from exactly that class. /s plus the outer quote
 * pair is cmd's documented way to keep inner quotes intact (stdioSpawnSpec's
 * shape).
 */
export function windowsMonitorSpawnSpec(command: string): { command: string; args: string[]; verbatim: boolean } {
        return { command: "cmd", args: ["/d", "/s", "/c", `"${command}"`], verbatim: true };
}

/** Default spawner: `bash -lc <command>` (POSIX) / `cmd /d /s /c` (win32, verbatim), cwd-scoped. */
export const defaultMonitorSpawner: MonitorSpawner = (command, opts) => {
        // Late import keeps the module pure for tests that inject a spawner.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { spawn } = require("node:child_process") as typeof import("node:child_process");
        const win = process.platform === "win32" ? windowsMonitorSpawnSpec(command) : null;
        const child = win
                ? spawn(win.command, win.args, {
                          cwd: opts.cwd,
                          windowsHide: true,
                          windowsVerbatimArguments: win.verbatim,
                  })
                : spawn("bash", ["-lc", command], { cwd: opts.cwd });
        return { child, stdout: child.stdout, stderr: child.stderr } as unknown as ReturnType<MonitorSpawner>;
};

/**
 * Run the bounded watch window. Never rejects — every failure path is a
 * typed result line (the agent sees the reason in-band).
 */
export async function runMonitor(
        params: MonitorParams,
        opts: { cwd: string; spawner?: MonitorSpawner; signal?: AbortSignal },
): Promise<MonitorResult> {
        const startedAt = Date.now();
        const duration = params.duration_ms ?? MONITOR_DEFAULT_DURATION_MS;
        const maxLines = params.max_lines ?? MONITOR_DEFAULT_MAX_LINES;
        const spawner = opts.spawner ?? defaultMonitorSpawner;
        const all: MonitorLine[] = [];
        let stoppedBy: MonitorStopReason = "duration";
        let exitCode: number | null = null;
        let truncated = false;
        let child: ReturnType<MonitorSpawner>["child"] | null = null;
        let timers: ReturnType<typeof setTimeout>[] = [];
        let done = false;

        const stop = (reason: MonitorStopReason) => {
                if (done) return;
                done = true;
                stoppedBy = reason;
                for (const t of timers) clearTimeout(t);
                try {
                        child?.kill("SIGTERM");
                        // Escalation: SIGKILL after a 2s grace so a stubborn `tail -f` cannot
                        // outlive its window (the F10 bounded-posture rule).
                        timers.push(setTimeout(() => child?.kill("SIGKILL"), 2_000));
                } catch {
                        /* already dead */
                }
        };

        const collect = (stream: "out" | "err", chunk: Buffer | string) => {
                const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
                for (const raw of text.split(/\r?\n/)) {
                        if (done) return;
                        if (raw === "") continue;
                        all.push({ ts: Date.now(), stream, text: raw.slice(0, 2_000) });
                        if (params.stop_pattern && safeTest(params.stop_pattern, raw)) {
                                stop("pattern");
                                return;
                        }
                        if (all.length >= maxLines) {
                                stop("lines");
                                return;
                        }
                }
        };

        try {
                const spawned = spawner(params.command, { cwd: opts.cwd });
                child = spawned.child;
                spawned.stdout.on("data", (c: unknown) => collect("out", c as Buffer | string));
                spawned.stderr.on("data", (c: unknown) => collect("err", c as Buffer | string));
                spawned.child.once("exit", (code) => {
                        exitCode = code;
                        if (!done) stop("exit");
                });
                if (opts.signal) {
                        const onAbort = () => stop("abort");
                        opts.signal.addEventListener("abort", onAbort, { once: true });
                }
                timers.push(setTimeout(() => stop("duration"), duration));
                await new Promise<void>((resolve) => {
                        // The resolution poll is NOT in `timers` — stop() clears those, and
                        // clearing the resolver would deadlock the window (found by the
                        // injected-spawner tests). It clears itself the moment done flips.
                        const tick = setInterval(() => {
                                if (done) {
                                        clearInterval(tick);
                                        resolve();
                                }
                        }, 50);
                });
        } catch (err: any) {
                all.push({ ts: Date.now(), stream: "exit", text: `monitor failed to start: ${err instanceof Error ? err.message : String(err)}` });
                stoppedBy = "exit";
        }

        // Tail cap: a noisy process must not balloon the tool result.
        const lines = all.length > MONITOR_RESULT_LINES ? all.slice(-MONITOR_RESULT_LINES) : all;
        if (lines !== all) truncated = true;

        return { lines, stoppedBy, exitCode, durationMs: Date.now() - startedAt, truncated };
}

function safeTest(pattern: string, text: string): boolean {
        try {
                return new RegExp(pattern).test(text);
        } catch {
                return false;
        }
}

// ---------------------------------------------------------------------------
// Rendering the tool result
// ---------------------------------------------------------------------------

export function renderMonitorResult(result: MonitorResult): string {
        const parts: string[] = [];
        const reasonText: Record<MonitorStopReason, string> = {
                exit: `the process exited (code ${result.exitCode ?? "unknown"})`,
                duration: "the watch window elapsed — call monitor again to keep following",
                lines: `the line cap was hit — call monitor again to keep following`,
                pattern: "the stop_pattern matched",
                abort: "the session aborted the watch",
        };
        parts.push(`monitor: ${result.lines.length} line${result.lines.length === 1 ? "" : "s"} in ${(result.durationMs / 1000).toFixed(1)}s — ${reasonText[result.stoppedBy]}.`);
        if (result.truncated) parts.push(`(output was truncated to the freshest ${MONITOR_RESULT_LINES} lines)`);
        if (result.lines.length === 0) {
                parts.push("(no output captured)");
                return parts.join("\n");
        }
        for (const line of result.lines) {
                const off = Math.round((line.ts - (Date.now() - result.durationMs)) / 1000);
                parts.push(`[${off >= 0 ? "+" : ""}${off}s ${line.stream}] ${line.text}`);
        }
        return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Registration (pi extension seams)
// ---------------------------------------------------------------------------

export interface MonitorToolOptions {
        cwd: string;
        verbose?: boolean;
        /** Plan-mode read-only allowlist (injected from tools.ts — import-cycle-free). */
        isSafeCommand?: (command: string) => boolean;
        /** Plan-mode state reader (injected; the tool refuses while plan mode is on
         *  unless the command is on the read-only allowlist). */
        isPlanMode?: () => boolean;
        spawner?: MonitorSpawner;
}

const MonitorParamsSchema = Type.Object(
        {
                command: Type.String({ description: "The command to watch (e.g. `tail -f app.log`, `npm run dev`, `pytest --watch`)." }),
                duration_ms: Type.Optional(
                        Type.Number({
                                description: `Watch window in milliseconds (default 30000, max ${MONITOR_MAX_DURATION_MS}). The window always ends on its own.`,
                        }),
                ),
                max_lines: Type.Optional(
                        Type.Number({ description: `Stop after this many captured lines (default 200, max ${MONITOR_MAX_LINES}).` }),
                ),
                stop_pattern: Type.Optional(
                        Type.String({
                                description: 'A regular expression that ends the watch the moment it matches a line (e.g. "listening on|ready in").',
                        }),
                ),
        },
        { additionalProperties: false },
);

export function registerMonitorTool(pi: ExtensionAPI, opts: MonitorToolOptions): void {
        const verbose = opts.verbose ?? false;
        const log = (msg: string) => {
                if (verbose) console.error(`[unown-monitor] ${msg}`);
        };

        pi.registerTool({
                name: "monitor",
                label: "Monitor",
                description:
                        "Watch a long-running command's output live for a bounded window (default 30s): start a dev server, tail a log, follow a test watcher, and get each output line back with timestamps. " +
                        `Ends on window duration, the line cap, the process exiting, or a stop_pattern match — call it again to keep following a process that is still running. ` +
                        "Use it instead of one-shot bash when what you need is what the process PRINTS (a ready line, an error, a port).",
                parameters: MonitorParamsSchema,
                async execute(_toolCallId, params, signal, _onUpdate, ctx) {
                        const normalized = normalizeMonitorParams(params);
                        if ("error" in normalized) {
                                return { content: [{ type: "text", text: `Error: ${normalized.error}` }], details: {} };
                        }
                        // Guardrail 1 — the bash deny-list (exfiltration/destructive patterns)
                        // applies to watched commands exactly as it does to one-shot bash.
                        const deny = decideBash(normalized.command);
                        if (deny.block) {
                                return { content: [{ type: "text", text: `Error: command denied by the bash guardrail — ${deny.reason}` }], details: {} };
                        }
                        // Guardrail 2 — plan mode: watching is only allowed for commands the
                        // read-only allowlist already trusts (tail/cat/git log …).
                        if (opts.isPlanMode?.() && !(opts.isSafeCommand?.(normalized.command) ?? false)) {
                                return {
                                        content: [
                                                {
                                                        type: "text",
                                                        text: "Error: plan mode only allows monitoring read-only commands (the plan-mode bash allowlist). Leave plan mode first.",
                                                },
                                        ],
                                        details: {},
                                };
                        }
                        log(`watching (${normalized.duration_ms}ms): ${normalized.command.slice(0, 80)}`);
                        const result = await runMonitor(normalized, {
                                cwd: opts.cwd,
                                spawner: opts.spawner,
                                signal: signal ?? undefined,
                        });
                        // Surface the block state in-band so the model can react without
                        // re-reading the whole window.
                        const text = renderMonitorResult(result);
                        const isError = result.lines.length === 0 && result.stoppedBy === "abort";
                        return {
                                content: [{ type: "text", text }],
                                isError,
                                details: { stoppedBy: result.stoppedBy, lines: result.lines.length, exitCode: result.exitCode },
                        };
                },
        });
}
