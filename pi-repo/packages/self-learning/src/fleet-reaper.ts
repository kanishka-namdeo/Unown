/**
 * fleet-reaper.ts — durable lifecycle trace + boot sweep for fleet children.
 *
 * Problem (R3-F4, measured live 2026-10-26): the fleet registry records
 * TERMINAL children only (fleet-runtime.ts finalize), so a parent that dies
 * without finalizing — SIGKILL, OOM, `kill -9` — leaves its children with
 * ZERO trace: no registry entry, no journal, control/ask files rotting in
 * .unown/fleet/, and the worktree journal holding the tree "spawned"
 * forever. The orphans themselves linger through their quiet phases (a
 * mid-bash child until the bash ends; a parked child the full 600 s ask
 * deadline — upstream tokens burning the whole time) and only die at their
 * next stdout write, when the dead parent's pipe finally EPIPEs them.
 *
 * Solution (the tmux/supervisor consensus, minus the daemon):
 *
 *   1. JOURNAL — spawnFleetChild appends `{"op":"spawned", …}` (pid,
 *      parentPid, session/control/ask files), adoptWorktree appends
 *      `{"op":"worktree"}`, finalize appends `{"op":"finished"}`. Append-only
 *      JSONL at .unown/fleet/journal.jsonl — the worktree registry's shape.
 *
 *   2. HEARTBEAT — the child (fleet-child.ts) self-writes <id>.hb.json
 *      ~1x/s: {pid, ts}. Fresh + self-reported is the strongest identity we
 *      can get without a daemon: a bare recorded pid can be REUSED by an
 *      unrelated process after a crash, but only our child ever writes that
 *      file.
 *
 *   3. SWEEP — every session boot (cli.ts) scans the journal for open
 *      entries (spawned without a terminal op) whose PARENT is dead:
 *      live orphans are tree-killed ("reaped"), dead ones traced
 *      ("abandoned"), channel files cleaned, adopted worktrees marked
 *      "orphaned" in the worktree journal — kept ON DISK for manual
 *      recovery, the same rule as kept trees.
 *
 * Safety rules, in priority order:
 *   - A LIVE parent always wins (its children are not ours to touch — a
 *     reused parentPid can only ever make this check skip, never kill).
 *   - Never kill a pid we cannot identify: macOS+Linux require the process's
 *     own `ps` cmdline to name our session file; Windows (no cheap cmdline
 *     probe) only kills heartbeat-fresh children and traces the rest.
 *   - Never sweep from inside a subagent (UNOWN_SUBAGENT/UNOWN_FLEET_CONTROL)
 *     — a child must not reap its siblings; kill-switch UNOWN_FLEET_REAPER=0.
 *
 * Cross-platform by construction: fs + process.kill on POSIX, tasklist/
 * taskkill on win32, no signals-as-protocol — and the `ps -o command=`
 * identity probe is the one cmdline read that works on macOS AND Linux
 * (learned live on the v0.0.26 release run: macOS has no /proc).
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FLEET_CONTROL_ENV } from "./fleet.ts";
import { appendWorktreeOrphanRecord } from "./worktree.ts";

/** A heartbeat older than this reads as "child gone" (the child beats ~1x/s;
 * 5 s tolerates a GC pause or a slow disk without forgiving a dead process). */
export const HEARTBEAT_STALE_MS = 5_000;

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

export interface FleetSpawnJournalEntry {
        id: string;
        name: string;
        agent: string;
        /** The child's pid (null when the spawn harness cannot report one). */
        pid: number | null;
        /** The parent that owns this child — the sweep's ownership check. */
        parentPid: number;
        sessionFile: string;
        controlFile: string;
        askFile: string;
        ts: number;
}

export type FleetJournalEntry =
        | ({ op: "spawned" } & FleetSpawnJournalEntry)
        | { op: "worktree"; id: string; path: string; ts: number }
        | { op: "finished"; id: string; status: string; ts: number }
        | { op: "reaped" | "abandoned"; id: string; ts: number; reason: string };

export function fleetJournalPath(fleetDir: string): string {
        return join(fleetDir, "journal.jsonl");
}

function appendFleetJournal(fleetDir: string, entry: FleetJournalEntry): void {
        try {
                mkdirSync(fleetDir, { recursive: true });
                writeFileSync(fleetJournalPath(fleetDir), `${JSON.stringify(entry)}\n`, { flag: "a" });
        } catch {
                /* best effort — a trace must never break the spawn/finalize path */
        }
}

export function readFleetJournal(fleetDir: string): FleetJournalEntry[] {
        try {
                return readFileSync(fleetJournalPath(fleetDir), "utf8")
                        .split("\n")
                        .filter((l) => l.trim().length > 0)
                        .map((l) => JSON.parse(l) as FleetJournalEntry)
                        .filter((e) => e && typeof e.op === "string" && typeof e.id === "string");
        } catch {
                return [];
        }
}

export function recordFleetChildSpawn(fleetDir: string, entry: FleetSpawnJournalEntry): void {
        appendFleetJournal(fleetDir, { op: "spawned", ...entry });
}

export function recordFleetChildWorktree(fleetDir: string, id: string, path: string): void {
        appendFleetJournal(fleetDir, { op: "worktree", id, path, ts: Date.now() });
}

export function recordFleetChildFinish(fleetDir: string, id: string, status: string): void {
        appendFleetJournal(fleetDir, { op: "finished", id, status, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// Liveness + identity primitives
// ---------------------------------------------------------------------------

/** Is a pid alive? EPERM (POSIX) counts as alive — owned by another user. */
export function isPidAlive(pid: number | null | undefined): boolean {
        if (!pid || pid <= 0) return false;
        if (process.platform === "win32") {
                try {
                        const res = spawnSync(
                                join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tasklist.exe"),
                                ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
                                { encoding: "utf8", timeout: 5_000 },
                        );
                        return res.status === 0 && String(res.stdout).includes(`"${pid}"`);
                } catch {
                        return false;
                }
        }
        try {
                process.kill(pid, 0);
                return true;
        } catch (err: any) {
                return err?.code === "EPERM";
        }
}

/** Identity: the process's own command line must name our session file —
 *  the strongest pre-heartbeat check available (the session path is unique
 *  per child and present in the child's argv). Portability (learned the hard
 *  way on the v0.0.26 release run): macOS has NO /proc, so the probe is
 *  `ps -p <pid> -o command=` — the one cheap cmdline read that works on both
 *  macOS and Linux. Windows has neither and stays heartbeat-only. */
function childIdentityMatches(pid: number, sessionFile: string): boolean {
        try {
                const res = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
                        encoding: "utf8",
                        timeout: 5_000,
                });
                return res.status === 0 && String(res.stdout).includes(sessionFile);
        } catch {
                return false;
        }
}

function readHeartbeat(fleetDir: string, id: string): { pid: number; ts: number } | null {
        try {
                const parsed = JSON.parse(readFileSync(join(fleetDir, `${id}.hb.json`), "utf8")) as {
                        pid?: number;
                        ts?: number;
                };
                if (typeof parsed.pid === "number" && typeof parsed.ts === "number") return parsed;
        } catch {
                /* absent or corrupt */
        }
        return null;
}

/** Tree-kill one pid: taskkill /F /T on win32; SIGTERM then SIGKILL on POSIX
 *  (fire-and-forget — the sweep must never block a boot). */
function defaultKillChildPid(pid: number): void {
        if (process.platform === "win32") {
                try {
                        const killer = spawn(
                                join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
                                ["/F", "/T", "/PID", String(pid)],
                                { stdio: "ignore", detached: true, windowsHide: true },
                        );
                        killer.once("error", () => {});
                } catch {
                        /* already gone */
                }
                return;
        }
        try {
                process.kill(pid, "SIGTERM");
        } catch {
                /* already gone */
        }
        const escalation = setTimeout(() => {
                try {
                        process.kill(pid, "SIGKILL");
                } catch {
                        /* already gone */
                }
        }, 5_000);
        escalation.unref?.();
}

// ---------------------------------------------------------------------------
// The boot sweep
// ---------------------------------------------------------------------------

export interface FleetSweepOptions {
        log?: (message: string) => void;
        now?: () => number;
        /** Injectable kill (tests). */
        killPid?: (pid: number) => void;
        /** Injectable env (tests default to process.env). */
        env?: NodeJS.ProcessEnv;
}

export interface FleetSweepReport {
        /** True when a journal existed and the sweep actually scanned it. */
        ran: boolean;
        /** Open entries seen (spawned without a terminal op). */
        open: number;
        reaped: string[];
        abandoned: string[];
        /** Open entries left alone because their parent is alive. */
        skippedLiveParent: string[];
        cleanedFiles: number;
        orphanedWorktrees: string[];
}

/**
 * Sweep stale fleet children for a repo cwd. Cheap when there is nothing to
 * do (one existsSync on the journal); silent unless it reaped/traced
 * something. Never throws — a boot must not die on a corrupt journal.
 */
export function sweepStaleFleetChildren(cwd: string, opts: FleetSweepOptions = {}): FleetSweepReport {
        const env = opts.env ?? process.env;
        const report: FleetSweepReport = {
                ran: false,
                open: 0,
                reaped: [],
                abandoned: [],
                skippedLiveParent: [],
                cleanedFiles: 0,
                orphanedWorktrees: [],
        };
        // Never sweep from inside a subagent — a child reaping siblings (or
        // worse, racing its own parent's manager) is exactly the inverted
        // ownership the round-2 control-inbox theft taught us to refuse.
        if (env.UNOWN_SUBAGENT === "1" || env[FLEET_CONTROL_ENV]) return report;
        if (/^(0|false|no)$/i.test(env.UNOWN_FLEET_REAPER ?? "")) return report;

        const fleetDir = join(cwd, ".unown", "fleet");
        if (!existsSync(fleetJournalPath(fleetDir))) return report;
        report.ran = true;

        const entries = readFleetJournal(fleetDir);
        const now = (opts.now ?? Date.now)();
        const killPid = opts.killPid ?? defaultKillChildPid;

        const spawned = new Map<string, Extract<FleetJournalEntry, { op: "spawned" }>>();
        const worktrees = new Map<string, string[]>();
        const terminal = new Set<string>();
        for (const e of entries) {
                if (e.op === "spawned") spawned.set(e.id, e);
                else if (e.op === "worktree") {
                        const list = worktrees.get(e.id) ?? [];
                        list.push(e.path);
                        worktrees.set(e.id, list);
                } else {
                        terminal.add(e.id); // finished | reaped | abandoned
                }
        }

        for (const [id, spawn] of spawned) {
                if (terminal.has(id)) continue;
                report.open += 1;
                // A live parent always wins. Pid reuse can only ever make this
                // check read "alive" for a dead parent (safe: skip); the reverse
                // (a reused pid making a live parent look dead) is impossible —
                // the pid IS alive either way.
                if (isPidAlive(spawn.parentPid)) {
                        report.skippedLiveParent.push(id);
                        continue;
                }

                // ---- orphaned: decide reaped vs abandoned, never guessing.
                const hb = readHeartbeat(fleetDir, id);
                const fresh = hb !== null && now - hb.ts <= HEARTBEAT_STALE_MS;
                let disposition: "reaped" | "abandoned";
                let reason: string;
                if (fresh && hb!.pid > 0 && (process.platform === "win32" || childIdentityMatches(hb!.pid, spawn.sessionFile))) {
                        // Fresh heartbeat = our child, alive, self-identified. The
                        // strongest identity signal there is without a daemon.
                        killPid(hb!.pid);
                        disposition = "reaped";
                        reason = "parent dead; live orphan killed (heartbeat-verified)";
                } else if (fresh && hb!.pid > 0) {
                        // Heartbeat was fresh but the pid already mismatches — the
                        // child died inside the freshness window; never kill the
                        // (possibly reused) pid.
                        disposition = "abandoned";
                        reason = "parent dead; heartbeat pid no longer matches — treated as gone";
                } else if (
                        spawn.pid &&
                        isPidAlive(spawn.pid) &&
                        process.platform !== "win32" &&
                        childIdentityMatches(spawn.pid, spawn.sessionFile)
                ) {
                        // Pre-heartbeat child (a 0.0.25 fleet child orphaned mid-upgrade):
                        // alive and cmdline-verified on POSIX.
                        killPid(spawn.pid);
                        disposition = "reaped";
                        reason = "parent dead; live orphan killed (cmdline-verified pre-heartbeat child)";
                } else if (spawn.pid && isPidAlive(spawn.pid)) {
                        // Alive but NOT verifiable — Windows without a heartbeat (no
                        // cheap cmdline probe): trace honestly, kill nothing.
                        disposition = "abandoned";
                        reason = "parent dead; child alive but not heartbeat-identifiable (pre-heartbeat fleet child on Windows) — traced, not killed";
                } else {
                        disposition = "abandoned";
                        reason = "parent dead; child already gone";
                }
                appendFleetJournal(fleetDir, { op: disposition, id, ts: now, reason });
                report[disposition].push(id);

                // ---- channel cleanup: the crash's rotting ask/control files.
                for (const suffix of [".ask.json", ".control.json", ".hb.json"]) {
                        const file = join(fleetDir, `${id}${suffix}`);
                        try {
                                if (existsSync(file)) {
                                        rmSync(file, { force: true });
                                        report.cleanedFiles += 1;
                                }
                        } catch {
                                /* best effort */
                        }
                }

                // ---- worktrees: mark orphaned, NEVER auto-remove (the kept-tree
                // rule: possible child work is human territory — `unown worktrees
                // remove` is the ending, after review).
                for (const path of worktrees.get(id) ?? []) {
                        if (existsSync(path)) {
                                appendWorktreeOrphanRecord(path);
                                report.orphanedWorktrees.push(path);
                        }
                }
        }

        if (report.reaped.length + report.abandoned.length + report.orphanedWorktrees.length > 0) {
                const summary =
                        `fleet crash sweep: ${report.reaped.length} live orphan(s) reaped, ${report.abandoned.length} already dead ` +
                        `(traced), ${report.orphanedWorktrees.length} worktree(s) marked orphaned (kept on disk — unown worktrees list)`;
                (opts.log ?? (() => {}))(summary);
        }
        return report;
}
