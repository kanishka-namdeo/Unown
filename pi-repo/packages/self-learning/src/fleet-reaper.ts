/**
 * fleet-reaper.ts — durable lifecycle trace + boot sweep for subagent children.
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
 * Round 4 (2026-10-26, measured live the same way — see the round-3 blog's
 * "not covered" ledger): the SYNC lane had the identical shape one lane
 * over. runSubagentOnce children were covered on the signal paths by the
 * child-reaper registration but carried NO journal, NO heartbeat, and NO
 * sweep: a `kill -9` of the parent left the sync child (and its bash
 * grandchild) alive with zero durable trace, and a second real boot in the
 * repo noticed nothing. The fix extends THIS module's journal + heartbeat +
 * sweep to both lanes — one journal file, lane-tagged entries — instead of
 * growing a second, drifting twin.
 *
 * Solution (the tmux/supervisor consensus, minus the daemon):
 *
 *   1. JOURNAL — spawnFleetChild appends `{"op":"spawned", …}` (pid,
 *      parentPid, session/control/ask files), adoptWorktree appends
 *      `{"op":"worktree"}`, finalize appends `{"op":"finished"}`.
 *      runSubagentOnce (R4) appends the same shape lane-tagged
 *      `"sync"` — its identity token is the mkdtemp system-prompt file
 *      path, the one unique string in a sync child's argv (it runs
 *      `--no-session`, so there is no session file to match on).
 *      Append-only JSONL at .unown/fleet/journal.jsonl — the worktree
 *      registry's shape.
 *
 *   2. HEARTBEAT — fleet children self-write <id>.hb.json ~1x/s from the
 *      control-poll interval (fleet-child.ts); sync children (R4) self-write
 *      the same file shape from bootRuntime via startSyncSubagentHeartbeat(),
 *      gated on UNOWN_SYNC_HEARTBEAT (the file path the parent passes).
 *      Fresh + self-reported is the strongest identity we can get without a
 *      daemon: a bare recorded pid can be REUSED by an unrelated process
 *      after a crash, but only our child ever writes that file.
 *
 *   3. SWEEP — every session boot (cli.ts) scans the journal for open
 *      entries (spawned without a terminal op) whose PARENT is dead:
 *      live orphans are tree-killed ("reaped"), dead ones traced
 *      ("abandoned"), channel files cleaned, adopted worktrees marked
 *      "orphaned" in the worktree journal — kept ON DISK for manual
 *      recovery, the same rule as kept trees.
 *
 * Where the journal lives (R4): at the git repo TOPLEVEL's .unown/fleet, not
 * the literal cwd's — a session booted from a subdirectory and a boot from
 * the repo root must meet at the same file, or the sweep never sees the
 * spawns. The sweep still checks the legacy literal cwd path first (R3
 * journals written before the toplevel resolution exist on real disks).
 *
 * Safety rules, in priority order:
 *   - A LIVE parent always wins (its children are not ours to touch — a
 *     reused parentPid can only ever make this check skip, never kill).
 *   - Never kill a pid we cannot identify: macOS+Linux require the process's
 *     own `ps` cmdline to name our identity token (session file, or the sync
 *     lane's prompt file); Windows (no cheap cmdline probe) only kills
 *     heartbeat-fresh children and traces the rest.
 *   - Never sweep from inside a subagent (UNOWN_SUBAGENT/UNOWN_FLEET_CONTROL)
 *     — a child must not reap its siblings; kill-switch UNOWN_FLEET_REAPER=0.
 *
 * Cross-platform by construction: fs + process.kill on POSIX, tasklist/
 * taskkill on win32, no signals-as-protocol — and the `ps -o command=`
 * identity probe is the one cmdline read that works on macOS AND Linux
 * (learned live on the v0.0.26 release run: macOS has no /proc). The git
 * toplevel probe rides gittools' hardened read-only arg set (GitSpawn
 * neutralizers — a hostile repo config must not execute anything when we
 * ask where the repo is).
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FLEET_CONTROL_ENV } from "./fleet.ts";
import { readOnlyGitArgs } from "./gittools.ts";
import { appendWorktreeOrphanRecord } from "./worktree.ts";

/** A heartbeat older than this reads as "child gone" (the child beats ~1x/s;
 * 5 s tolerates a GC pause or a slow disk without forgiving a dead process). */
export const HEARTBEAT_STALE_MS = 5_000;

/** R4: the sync-lane heartbeat contract. The parent (runSubagentOnce) passes
 *  the ABSOLUTE <id>.hb.json path in this env var; the child's bootRuntime
 *  calls startSyncSubagentHeartbeat() which self-gates on it. Internal
 *  plumbing like the fleet's UNOWN_FLEET_* channel vars — never user config.
 *  The vendored bash tool strips it from shell children (a grandchild must
 *  not keep the file fresh under its own pid). */
export const SYNC_HEARTBEAT_ENV = "UNOWN_SYNC_HEARTBEAT";

/** R4: sync children beat at the same ~1x/s cadence as fleet children —
 *  HEARTBEAT_STALE_MS (5 s) stays the single freshness contract for both. */
export const SYNC_HEARTBEAT_INTERVAL_MS = 1_000;

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
	/** The delegation round (2026-10-30): the audit fields. The reason
	 *  the parent stated at spawn time and a task preview — the journal
	 *  previously recorded identity + lifecycle but never WHAT or WHY,
	 *  so a post-hoc audit could not answer “was this delegation
	 *  justified”. Optional: pre-0.0.46 entries and calls that omitted
	 *  `why` read as absent, never invented. */
	why?: string;
	taskPreview?: string;
}

/** R4: the sync lane's spawn record — same journal, same sweep, one lane
 *  over. A sync child runs `--no-session` with no control/ask channels, so
 *  its identity token is the mkdtemp system-prompt file path: the one
 *  unique string in its argv, and what the sweep's `ps -o command=` probe
 *  matches on (POSIX). */
export interface SyncSpawnJournalEntry {
	id: string;
	name: string;
	agent: string;
	pid: number | null;
	parentPid: number;
	/** The child's --append-system-prompt temp file — unique per attempt
	 *  (mkdtemp), present in the child's own argv for its whole life. */
	promptFile: string;
	/** The isolated worktree the child runs in, when any (informational —
	 *  the worktree correlation rides the op:"worktree" amendment). */
	worktreePath?: string;
	ts: number;
	/** The delegation round's audit fields (see FleetSpawnJournalEntry). */
	why?: string;
	taskPreview?: string;
}

/** The finish entry's usage/outcome payload — the delegation round's audit
 *  enrichment. The spawn entry carries identity + intent; this carries cost
 *  + result, so a journal reader can answer “what did it cost and how did it
 *  end” without the session transcript. */
export interface FleetFinishExtras {
	turns?: number;
	tokensIn?: number;
	tokensOut?: number;
	toolCalls?: number;
	elapsedMs?: number;
	blocked?: boolean;
	why?: string;
	taskPreview?: string;
}

export type FleetJournalEntry =
	| ({ op: "spawned"; lane?: "fleet" } & FleetSpawnJournalEntry)
	| ({ op: "spawned"; lane: "sync" } & SyncSpawnJournalEntry)
	| { op: "worktree"; id: string; path: string; ts: number }
	| ({ op: "finished"; id: string; status: string; ts: number } & FleetFinishExtras)
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

/** R4: the sync lane's spawn record — written by runSubagentOnce right after
 *  the child process exists (pid known, or null when the spawn itself
 *  failed). One entry PER ATTEMPT: structured-output retries and
 *  fallback-model rotation spawn fresh children, and each child deserves
 *  its own terminal record. */
export function recordSyncSubagentSpawn(fleetDir: string, entry: SyncSpawnJournalEntry): void {
	appendFleetJournal(fleetDir, { op: "spawned", lane: "sync", ...entry });
}

export function recordFleetChildWorktree(fleetDir: string, id: string, path: string): void {
	appendFleetJournal(fleetDir, { op: "worktree", id, path, ts: Date.now() });
}

export function recordFleetChildFinish(fleetDir: string, id: string, status: string, extras?: FleetFinishExtras): void {
	appendFleetJournal(fleetDir, { op: "finished", id, status, ts: Date.now(), ...(extras ?? {}) });
}

// ---------------------------------------------------------------------------
// The sync-lane heartbeat (R4)
// ---------------------------------------------------------------------------

/** R4: start the sync subagent's heartbeat writer — the crash sweeper's
 *  identity + liveness signal for a child with no control channel to poll.
 *  Self-gating: returns null for every boot that is not a sync subagent
 *  (ordinary sessions, fleet children — their heartbeat rides the control
 *  poller in fleet-child.ts), so bootRuntime can call it unconditionally.
 *
 *  The beat is a best-effort writeFileSync ~1x/s (unref'd — it must never
 *  hold the child open) of {pid, ts}; the file is removed on process exit
 *  so a cleanly-finished child leaves nothing fresh-looking behind (a
 *  SIGKILLed child rots into staleness — that is what the 5 s window is
 *  for). Returns a stop() for tests and early shutdown paths. */
export function startSyncSubagentHeartbeat(
	env: NodeJS.ProcessEnv = process.env,
	intervalMs: number = SYNC_HEARTBEAT_INTERVAL_MS,
): (() => void) | null {
	const hbFile = env[SYNC_HEARTBEAT_ENV];
	if (!hbFile) return null;
	const beat = () => {
		try {
			writeFileSync(hbFile, JSON.stringify({ pid: process.pid, ts: Date.now() }), {
				encoding: "utf8",
				mode: 0o600,
			});
		} catch {
			/* best effort — the trace must never break the child */
		}
	};
	beat();
	const timer = setInterval(beat, intervalMs);
	if (typeof timer.unref === "function") timer.unref();
	let stopped = false;
	const stop = () => {
		if (stopped) return;
		stopped = true;
		clearInterval(timer);
		try {
			rmSync(hbFile, { force: true });
		} catch {
			/* best effort */
		}
	};
	process.once("exit", stop);
	return stop;
}

// ---------------------------------------------------------------------------
// Where the journal lives (R4)
// ---------------------------------------------------------------------------

/** R4: the journal directory for a spawn/boot in `cwd` — the git repo
 *  TOPLEVEL's .unown/fleet, falling back to the literal cwd's .unown/fleet
 *  when cwd is not inside a git repo (or git cannot answer).
 *
 *  Why toplevel and not literal cwd: a session booted from a subdirectory
 *  journals spawns that a boot from the repo root must be able to sweep —
 *  R3 keyed both sides on the literal cwd, so subdir-spawned fleet entries
 *  were invisible to a root boot (found while designing the sync-lane fix;
 *  the fleet manager and the sweep now share THIS resolution). The probe
 *  rides gittools' hardened read-only arg set (GitSpawn exec-sink
 *  neutralizers + stripped GIT_* redirections) — a hostile repo config must
 *  not execute anything because we asked where the repo is.
 *
 *  Not cached on purpose: cwd's git-ness can change under a long-lived
 *  session (the agent itself runs `git init`), and callers are heavyweight
 *  (one boot, one spawn) — a ~15 ms spawnSync is not worth a stale answer. */
export function subagentJournalDir(cwd: string): string {
	try {
		const env: Record<string, string> = {};
		for (const [k, v] of Object.entries(process.env)) {
			if (v === undefined) continue;
			if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG|NAMESPACE)$/.test(k))
				continue;
			env[k] = v;
		}
		const res = spawnSync("git", [...readOnlyGitArgs(), "rev-parse", "--show-toplevel"], {
			cwd,
			env,
			encoding: "utf8",
			timeout: 10_000,
		});
		const top = res.status === 0 ? String(res.stdout ?? "").trim() : "";
		if (top.length > 0) return join(top, ".unown", "fleet");
	} catch {
		/* git missing or unusable — fall through to the literal cwd */
	}
	return join(cwd, ".unown", "fleet");
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

/** Identity: the process's own command line must name our identity token —
 *  the strongest pre-heartbeat check available (the token is unique per
 *  child and present in the child's argv: the session file for fleet
 *  children, the mkdtemp system-prompt file for sync children). Portability
 *  (learned the hard way on the v0.0.26 release run): macOS has NO /proc, so
 *  the probe is `ps -p <pid> -o command=` — the one cheap cmdline read that
 *  works on both macOS and Linux. Windows has neither and stays
 *  heartbeat-only. An EMPTY token matches everything and must never reach
 *  this probe — callers treat a missing token as "not identifiable". */
function childIdentityMatches(pid: number, identityToken: string): boolean {
	if (!identityToken) return false;
	try {
		const res = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
			encoding: "utf8",
			timeout: 5_000,
		});
		return res.status === 0 && String(res.stdout).includes(identityToken);
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

export interface SubagentSweepOptions {
	log?: (message: string) => void;
	now?: () => number;
	/** Injectable kill (tests). */
	killPid?: (pid: number) => void;
	/** Injectable env (tests default to process.env). */
	env?: NodeJS.ProcessEnv;
	/** R4: skip the git-toplevel resolution (tests that hand-place the
	 *  journal at the literal cwd without a real repo). Defaults to a
	 *  real probe — production callers never set this. */
	noGitResolution?: boolean;
}

export interface SubagentSweepReport {
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
	/** R4: lane breakdown of the terminal dispositions (fleet vs sync
	 *  journal entries) — the boot line reports both honestly. */
	reapedByLane: { fleet: number; sync: number };
	abandonedByLane: { fleet: number; sync: number };
}

/** The per-journal sweep pass (both lanes — see the module header). */
function sweepOneJournal(
	fleetDir: string,
	opts: SubagentSweepOptions,
	report: SubagentSweepReport,
	markedTrees: Set<string>,
): void {
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

		const lane = spawn.lane === "sync" ? "sync" : "fleet";
		// The identity token: the fleet child's session file path, the
		// sync child's --append-system-prompt temp file path — either
		// way a unique-per-child string that lives in the child's own
		// argv for its whole life. An empty token is "not identifiable"
		// (never a wildcard match).
		const token = spawn.lane === "sync" ? spawn.promptFile : spawn.sessionFile;

		// ---- orphaned: decide reaped vs abandoned, never guessing.
		const hb = readHeartbeat(fleetDir, id);
		const fresh = hb !== null && now - hb.ts <= HEARTBEAT_STALE_MS;
		let disposition: "reaped" | "abandoned";
		let reason: string;
		if (fresh && hb!.pid > 0 && (process.platform === "win32" || childIdentityMatches(hb!.pid, token))) {
			// Fresh heartbeat = our child, alive, self-identified. The
			// strongest identity signal there is without a daemon.
			killPid(hb!.pid);
			disposition = "reaped";
			reason = `parent dead; live ${lane}-lane orphan killed (heartbeat-verified)`;
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
			token &&
			childIdentityMatches(spawn.pid, token)
		) {
			// Pre-heartbeat child (a 0.0.25 fleet child, or a sync child
			// orphaned before its first beat): alive and cmdline-verified
			// on POSIX.
			killPid(spawn.pid);
			disposition = "reaped";
			reason = `parent dead; live ${lane}-lane orphan killed (cmdline-verified pre-heartbeat child)`;
		} else if (spawn.pid && isPidAlive(spawn.pid)) {
			// Alive but NOT verifiable — Windows without a heartbeat (no
			// cheap cmdline probe), or a sync entry whose prompt-file
			// token is gone from the argv: trace honestly, kill nothing.
			disposition = "abandoned";
			reason = `parent dead; ${lane}-lane child alive but not heartbeat-identifiable — traced, not killed`;
		} else {
			disposition = "abandoned";
			reason = `parent dead; ${lane}-lane child already gone`;
		}
		appendFleetJournal(fleetDir, { op: disposition, id, ts: now, reason });
		report[disposition].push(id);
		report[`${disposition}ByLane`][lane] += 1;

		// ---- channel cleanup: the crash's rotting ask/control files
		//    (fleet) and the orphan's heartbeat file (both lanes).
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
		// remove` is the ending, after review). R4: sync-lane amendments
		// ride the same correlation, and one tree can carry amendments
		// from several attempts (retries) — dedupe the marking.
		for (const path of worktrees.get(id) ?? []) {
			if (existsSync(path) && !markedTrees.has(path)) {
				markedTrees.add(path);
				appendWorktreeOrphanRecord(path);
				report.orphanedWorktrees.push(path);
			}
		}
	}
}

/**
 * Sweep stale subagent children (BOTH lanes) for a repo cwd. Cheap when
 * there is nothing to do (one existsSync on the journal — the git probe
 * only runs when the literal-cwd journal is absent); silent unless it
 * reaped/traced something. Never throws — a boot must not die on a corrupt
 * journal.
 *
 * R3 named this sweepStaleFleetChildren and swept only fleet entries at the
 * literal cwd; R4 extends the same journal to sync-lane entries and checks
 * the git-toplevel journal too (the literal path stays first — R3-era
 * journals on real disks must keep being found).
 */
export function sweepStaleSubagentChildren(cwd: string, opts: SubagentSweepOptions = {}): SubagentSweepReport {
	const env = opts.env ?? process.env;
	const report: SubagentSweepReport = {
		ran: false,
		open: 0,
		reaped: [],
		abandoned: [],
		skippedLiveParent: [],
		cleanedFiles: 0,
		orphanedWorktrees: [],
		reapedByLane: { fleet: 0, sync: 0 },
		abandonedByLane: { fleet: 0, sync: 0 },
	};
	// Never sweep from inside a subagent — a child reaping siblings (or
	// worse, racing its own parent's manager) is exactly the inverted
	// ownership the round-2 control-inbox theft taught us to refuse.
	if (env.UNOWN_SUBAGENT === "1" || env[FLEET_CONTROL_ENV]) return report;
	if (/^(0|false|no)$/i.test(env.UNOWN_FLEET_REAPER ?? "")) return report;

	const markedTrees = new Set<string>();
	const literal = join(cwd, ".unown", "fleet");
	const candidates = [literal];
	if (!opts.noGitResolution) {
		const resolved = subagentJournalDir(cwd);
		if (resolved !== literal) candidates.push(resolved);
	}
	for (const fleetDir of candidates) {
		if (!existsSync(fleetJournalPath(fleetDir))) continue;
		report.ran = true;
		try {
			sweepOneJournal(fleetDir, opts, report, markedTrees);
		} catch {
			/* a corrupt journal must not cost the boot the rest of the sweep */
		}
	}

	if (report.reaped.length + report.abandoned.length + report.orphanedWorktrees.length > 0) {
		const summary =
			`subagent crash sweep: ${report.reaped.length} live orphan(s) reaped (${report.reapedByLane.fleet} fleet, ${report.reapedByLane.sync} sync), ` +
			`${report.abandoned.length} already dead (traced) (${report.abandonedByLane.fleet} fleet, ${report.abandonedByLane.sync} sync), ` +
			`${report.orphanedWorktrees.length} worktree(s) marked orphaned (kept on disk — unown worktrees list)`;
		(opts.log ?? (() => {}))(summary);
	}
	return report;
}
