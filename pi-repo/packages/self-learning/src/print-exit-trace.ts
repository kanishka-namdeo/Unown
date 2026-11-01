/**
 * Print-mode exit-path trace (issue #30 request b, M2-A): an opt-in,
 * env-gated lifecycle trace for `unown -p` runs. UNOWN_PRINT_EXIT_TRACE=1
 * emits one timestamped line per exit-path event — to stderr AND appended
 * to a gitignored runtime log — so an intermittent post-answer hang shows
 * which exit path (agent_end / stall watchdog / hard-exit / drain) was
 * pending at any moment.
 *
 * Conventions followed (capability-first, no new framework):
 * - the runtime-log location mirrors the bridge's `.run/usage-log.jsonl`
 *   convention (usage-cli.ts resolveUsageStateDir: walk upward to a dir
 *   that looks like the Unown repo, use its .run/); .run/ is gitignored.
 * - every write is fail-open: the trace must never alter a run's exit
 *   path (the module is only OBSERVATION, like the stall-progress lane).
 * - Windows-safe by construction: plain Date.now()/ISO timestamps, no
 *   /proc, no process introspection.
 * - Off by default: a zero-value env check, so flag-off runs do zero I/O.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** The trace's event vocabulary — the issue's four exit paths plus the
 *  answer-flush and final-exit bookends. Kept as a const array so tests
 *  can pin the surface and consumers can render stable labels. */
export const PRINT_EXIT_TRACE_EVENTS = [
        "answer_flushed",
        "agent_end",
        "stall_armed",
        "stall_fired",
        "hard_exit_armed",
        "hard_exit_fired",
        "hard_exit_cancelled",
        "hard_exit_rearmed",
        "drain_start",
        "drain_done",
        "exit",
] as const;

export type PrintExitTraceEvent = (typeof PRINT_EXIT_TRACE_EVENTS)[number];

/** The env var that arms the lane (UNOWN_*: unown-owned behavior; the
 *  stall/grace tuners themselves stay PI_*). "1" or "true" arms it. */
export function printExitTraceEnabled(env: Record<string, string | undefined> = process.env): boolean {
        const raw = (env.UNOWN_PRINT_EXIT_TRACE ?? "").trim().toLowerCase();
        return raw === "1" || raw === "true";
}

function looksLikeUnownRepo(dir: string): boolean {
        try {
                return existsSync(join(dir, "mini-services", "llm-bridge")) && existsSync(join(dir, "package.json"));
        } catch {
                return false;
        }
}

/** Mirror of the bridge state-dir resolution (usage-cli.ts): an explicit
 *  UNOWN_PRINT_TRACE_DIR wins; else walk up from the start dirs to a
 *  directory that looks like the Unown repo and use its .run/; else
 *  $UNOWN_HOME or ~/.unown. */
export function resolvePrintTraceDir(
        env: Record<string, string | undefined> = process.env,
        startDirs: string | string[] = process.cwd(),
): string {
        const explicit = (env.UNOWN_PRINT_TRACE_DIR ?? "").trim();
        if (explicit) return explicit;
        const dirs = Array.isArray(startDirs) ? startDirs : [startDirs];
        for (const start of dirs) {
                let dir = resolve(start);
                for (;;) {
                        if (looksLikeUnownRepo(dir)) return join(dir, ".run");
                        const parent = dirname(dir);
                        if (parent === dir) break;
                        dir = parent;
                }
        }
        return env.UNOWN_HOME || join(homedir(), ".unown");
}

/**
 * A recorder scoped to ONE print run. Every event is one plain object:
 * {ts, event, ...extras} — ts is ISO 8601 (no /proc, no process
 * introspection; cross-platform by construction).
 *
 * - enabled=false: emit() is a no-op (zero stderr, zero file I/O) —
 *   the default, pinning the zero-behavior-change contract.
 * - enabled=true: each emit writes a `[print-exit-trace] <json>` line to
 *   stderr and appends the bare JSON line to .run/print-exit-trace.jsonl
 *   (created on first write; every write fail-open).
 */
export interface PrintExitTrace {
        enabled: boolean;
        /** Record one lifecycle event. Fail-open: never throws. */
        emit: (event: PrintExitTraceEvent, extras?: Record<string, unknown>) => void;
        /** The log path a live trace appends to (for receipts/ops), or null when disabled. */
        logPath: string | null;
}

export function createPrintExitTrace(options?: {
        enabled?: boolean;
        env?: Record<string, string | undefined>;
        // Test seams — production passes nothing:
        now?: () => Date;
        stderrLine?: (line: string) => void;
        append?: (path: string, line: string) => void;
        startDirs?: string | string[];
}): PrintExitTrace {
        const env = options?.env ?? process.env;
        const enabled = options?.enabled ?? printExitTraceEnabled(env);
        const now = options?.now ?? (() => new Date());
        const stderrLine = options?.stderrLine ?? ((line: string) => process.stderr.write(line + "\n"));
        const append =
                options?.append ??
                ((path, line) => {
                        try {
                                appendFileSync(path, line + "\n");
                        } catch {
                                /* observation lane — never alter the run */
                        }
                });
        const logPath = enabled ? join(resolvePrintTraceDir(env, options?.startDirs ?? process.cwd()), "print-exit-trace.jsonl") : null;
        if (!enabled || !logPath) {
                return { enabled, emit: () => {}, logPath };
        }
        let pathEnsured = false;
        const ensurePath = () => {
                if (pathEnsured) return;
                try {
                        mkdirSync(dirname(logPath), { recursive: true });
                } catch {
                        /* file append may still work; the stderr mirror always does */
                }
                pathEnsured = true;
        };
        return {
                enabled,
                emit: (event, extras) => {
                        const record = { ts: now().toISOString(), event, ...(extras ?? {}) };
                        const json = JSON.stringify(record);
                        try {
                                stderrLine(`[print-exit-trace] ${json}`);
                        } catch {
                                /* best effort */
                        }
                        try {
                                ensurePath();
                                append(logPath, json);
                        } catch {
                                /* fail-open: a broken log must never hang or fail the run */
                        }
                },
                logPath,
        };
}
