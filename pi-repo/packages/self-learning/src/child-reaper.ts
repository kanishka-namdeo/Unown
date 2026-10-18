/**
 * child-reaper.ts — last-resort child-process hygiene for the unown agent.
 *
 * Problem (research R-a, M-13/W-01): LSP and MCP servers are spawned as
 * stdio children. The graceful paths (`session_shutdown` → dispose, and
 * tools.ts's `process.once("exit")` for LSP) only cover NORMAL exits — a
 * SIGINT/SIGTERM death of the agent, or any MCP child at process exit,
 * orphans `npx` wrappers and server processes on the host.
 *
 * Solution: one process-wide registry of live children. `installChildReaper()`
 * (called once from cli.ts boot — idempotent, double-install safe) hooks
 * `process.once("exit")` plus SIGINT/SIGTERM. Handlers kill every registered
 * child synchronously — no awaits, no async disposal chains — because signal
 * handlers must be synchronous-safe and the "exit" event cannot run timers.
 *
 * Kill policy: SIGTERM first (spec-polite servers flush on it), with a
 * SIGKILL fallback after a short grace on the signal paths (where the event
 * loop is still alive); on "exit" both are sent immediately since no grace
 * period is possible there. LSP dispose() still sends the protocol
 * `shutdown`/`exit` handshake before this path can ever matter — the reaper
 * is the safety net, not the primary disposal.
 *
 * H2 note: keep all spawn-spec construction in the clients (stdioSpawnSpec in
 * mcp.ts) so a future trust gate can wrap/approve spawns in one place; this
 * module deliberately knows nothing about HOW children were created.
 */
import type { ChildProcess } from "node:child_process";

/** Grace period between SIGTERM and the SIGKILL fallback (signal paths). */
const KILL_GRACE_MS = 400;

const children = new Set<ChildProcess>();
let installed = false;

/** Track a live child; auto-removed when the child exits on its own. */
export function registerChild(child: ChildProcess): void {
    if (!child) return;
    if (child.exitCode !== null || child.killed) return;
    children.add(child);
    child.once("exit", () => children.delete(child));
    child.once("error", () => children.delete(child));
}

/** Stop tracking a child (clean exit / explicit disposal). */
export function unregisterChild(child: ChildProcess): void {
    children.delete(child);
}

function killAll(signal: "SIGTERM" | "SIGKILL"): void {
    for (const child of children) {
        try {
            child.kill(signal);
        } catch {
            /* already dead or never spawned — nothing to do */
        }
    }
}

function reapNow(): void {
    killAll("SIGTERM");
    // Synchronous safety net: also SIGKILL immediately. On the "exit" event
    // no timer can run, so a SIGTERM-only pass would leave a child that
    // ignores SIGTERM alive; SIGKILL is unconditional.
    killAll("SIGKILL");
}

function handleSignal(signal: "SIGINT" | "SIGTERM"): void {
    killAll("SIGTERM");
    // Grace fallback while the loop is still alive: escalate anything that
    // survived SIGTERM. unref'd so it can never hold the process open.
    const escalation = setTimeout(() => killAll("SIGKILL"), KILL_GRACE_MS);
    escalation.unref?.();
    // Preserve default signal semantics when we are the only listener: the
    // reaper must not swallow Ctrl-C on non-TTY runs. When the host (pi's
    // TUI, cli.ts) registered its own handler, we leave termination to it —
    // its own exit path triggers the "exit" hook below and reaps anyway.
    if (process.listenerCount(signal) <= 1) {
        process.exit(signal === "SIGINT" ? 130 : 143);
    }
}

/**
 * Install the process-wide reaper hooks. Idempotent: subsequent calls are
 * no-ops, so boot code can call it unconditionally.
 */
export function installChildReaper(): void {
    if (installed) return;
    installed = true;
    process.once("exit", reapNow);
    process.on("SIGINT", () => handleSignal("SIGINT"));
    process.on("SIGTERM", () => handleSignal("SIGTERM"));
}

/** Test hook: true when installChildReaper() has run in this process. */
export function childReaperInstalled(): boolean {
    return installed;
}

/** Test hook: number of children currently tracked (observability only). */
export function trackedChildrenCount(): number {
    return children.size;
}
