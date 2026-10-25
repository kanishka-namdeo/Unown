/**
 * engine-cli.ts — `unown engine status|start|stop|restart|repair|serve`
 * (M3 + M6 + M8).
 *
 * The supervision surface for the detached self-learning engine
 * (docs/detached-engine-architecture.md, design rules 1 + 5):
 *
 *   status  ping + report (pid, uptime, build/version-skew verdict, jobs,
 *           governor budget/breaker, retention size, outbox, crash-loop
 *           circuit) — the DEGRADED-MODE diagnosis command
 *   start   ping-or-spawn: detached `engine serve` child + jittered health poll;
 *           FORCE — bypasses and resets the M6 crash-loop circuit (manual wins);
 *           an up-but-stale engine reports the newer build + the restart hint
 *   stop    graceful: HTTP /api/shutdown (drains requests, stops the router,
 *           checkpoints the WAL, releases the lock) with hard-kill fallback
 *   restart pick up the current build (M8): busy-aware stop → fresh spawn →
 *           health wait → the new /api/version as the receipt. --force past a
 *           running job, --wait <ms> to let it finish first; a down engine
 *           just starts (there is nothing to drain).
 *   repair  quarantine a corrupt SQLite DB (backup-aside + fresh boot);
 *           memory files on disk and the note outbox survive by design
 *   serve   run the engine in the FOREGROUND of this process — the entry a
 *           supervisor (systemd user unit, launchd agent, Windows service,
 *           dev shell) should own. The engine import is DYNAMIC: a normal
 *           terminal session never loads the engine half of the package
 *           (the M2 detachment contract)
 *   install keep the engine ALWAYS ON: install the OS login service (systemd
 *           --user unit / launchd LaunchAgent / Windows scheduled task) that
 *           runs `engine serve` at login and restarts it on crash — routines
 *           then fire even when no agent is in use. Idempotent; re-run to repair.
 *           `--auto` (the install/update lane) skips in CI, after an uninstall,
 *           and under the engine-off kill switch
 *   uninstall  stop + remove that OS service and REMEMBER the opt-out (the
 *           engine returns to the agent-touchpoint auto-start)
 */

import { Database } from "bun:sqlite";
import { existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { engineFetch, engineTokenPath } from "./engine-auth.ts";
import {
	describeEngineOwner,
	endpointPort,
	type EngineProbe,
	portOwnerPid,
	probeEngine,
} from "./engine-probe.ts";
import { autoServiceEnv, installEngineService, serviceStatus, uninstallEngineService } from "./engine-service.ts";
import { describeSpawnCircuit } from "./engine-status.ts";
import {
	engineHealth,
	enginePidFile,
	enginePidFromPidfile,
	ensureEngineRunning,
	loadEnvValues,
	readSpawnState,
	requestEngineSpawn,
	resetSpawnCircuit,
	rotateEngineLogIfNeeded,
	type SpawnDecision,
} from "./engine-supervisor.ts";
import {
	agentVersion,
	codeMtimeMs,
	compareEngineBuild,
	type EngineBuildComparison,
	type EngineBuildRef,
	formatDuration,
} from "./engine-version.ts";
import { DB_PATH } from "./store.ts";
import { ENGINE_URL, outboxStats } from "./term.ts";

export const ENGINE_USAGE = `unown engine <sub> — the detached self-learning engine:
  status   is the engine up? pid, uptime, build (version-skew verdict), jobs,
           governor, retention size, outbox, auto-start circuit
  start    start it if down (detached; waits for health, Ctrl-C safe) — resets the
           crash-loop circuit (use after repeated failed auto-starts); an
           up-but-older build prints the restart hint. A foreign engine, a taken
           port or an incompatible build is reported, never spawned over
  stop     graceful stop (drains requests, checkpoints the WAL, releases the lock).
           A foreign engine (different token) is refused unless --force --pid <pid>
  restart  pick up the current build: busy-aware stop + fresh spawn (refuses to
           cut a running job unless --force; --wait <ms> lets it finish first;
           --take-ownership explicitly stops a foreign engine first)
  repair   quarantine a corrupt engine DB (backs it up aside, boots fresh; memory
           files on disk + queued notes survive) — when the engine won't start
  serve    run the engine in THIS process (the supervisor entry — systemd/
           launchd/Windows services should use this)
  install  keep the engine ALWAYS ON: install the per-user login service
           (systemd user unit / launchd agent / Windows logon task) that boots
           it at login and restarts it on crash. Idempotent; re-run to repair.
           --auto is the installer lane: skips in CI, after engine uninstall,
           and under UNOWN_ENGINE_AUTOSTART=0 / UNOWN_NO_ENGINE_SERVICE=1
  uninstall  stop + remove that service (remembers the opt-out: install/update
           will not re-add it; engine install re-enables)`;

/** `unown engine restart` flags (--force, --wait <ms>). */
export interface RestartFlags {
	force: boolean;
	waitMs: number;
	/** Explicitly adopt a foreign engine on the port (stop it, then start ours). */
	takeOwnership?: boolean;
}

/** Parse `unown engine restart` argv — the parseUpdateFlags pattern (pure). */
export function parseRestartFlags(argv: string[]): { flags: RestartFlags; error?: string; help?: boolean } {
	const flags: RestartFlags = { force: false, waitMs: 0 };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--force") flags.force = true;
		else if (a === "--take-ownership") flags.takeOwnership = true;
		else if (a === "--wait" || a.startsWith("--wait=")) {
			const raw = a === "--wait" ? argv[++i] : a.slice("--wait=".length);
			const v = Number(raw);
			if (raw === undefined || !Number.isFinite(v) || v < 0) {
				return { flags, error: `--wait needs a non-negative milliseconds value (e.g. --wait 30000)` };
			}
			flags.waitMs = Math.floor(v);
		} else if (a === "--help" || a === "-h") {
			return { flags, help: true };
		} else {
			return { flags, error: `unknown argument: ${a}` };
		}
	}
	return { flags };
}

/** The staleness marker for the status UP line — non-stale verdicts (and
 *  pre-version engines, which doctor reports instead) render nothing. */
export function engineStaleMarker(cmp: EngineBuildComparison | undefined, agent: string): string {
	if (!cmp) return "";
	if (cmp.verdict === "old-build" || cmp.verdict === "stale" || cmp.verdict === "ancient") {
		return ` — STALE (agent v${agent}; restart: unown engine restart)`;
	}
	return "";
}

/** The busy-gate refusal — the exact copy pinned by the M8 design. */
export function busyRefusalMessage(activeJob: string, busyMs: number): string {
	return `engine is mid-job '${activeJob}' (${Math.round(busyMs / 1000)}s elapsed) — retry when idle, or: unown engine restart --force`;
}

/** Humanize the engine DB size for the status retention line. */
export function humanizeDbBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** `unown engine stop` flags — a foreign engine is only signalled with an
 *  explicit, verified pid; never by accident. */
export interface StopFlags {
	force: boolean;
	pid?: number;
}

export function parseStopFlags(argv: string[]): { flags: StopFlags; error?: string; help?: boolean } {
	const flags: StopFlags = { force: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--force") flags.force = true;
		else if (a === "--pid" || a.startsWith("--pid=")) {
			const raw = a === "--pid" ? argv[++i] : a.slice("--pid=".length);
			const v = Number(raw);
			if (raw === undefined || !Number.isInteger(v) || v <= 0) {
				return { flags, error: "--pid needs a positive integer" };
			}
			flags.pid = v;
		} else if (a === "--help" || a === "-h") {
			return { flags, help: true };
		} else {
			return { flags, error: `unknown argument: ${a}` };
		}
	}
	return { flags };
}

/** The engine's own data-dir lock holder (alive only). Repair uses this
 *  instead of a health probe: a 401 engine can still hold this DB. */
function engineLockHolderPid(): number | null {
	try {
		const pid = Number(readFileSync(join(dirname(DB_PATH), "engine.lock"), "utf8").trim());
		if (!Number.isInteger(pid) || pid <= 0) return null;
		try {
			process.kill(pid, 0);
			return pid;
		} catch (err: any) {
			// EPERM = the process exists but belongs to another user: alive.
			return err?.code === "EPERM" ? pid : null;
		}
	} catch {
		return null;
	}
}

/** The shared blocked-engine diagnostic (status/start/stop/doctor). */
function blockedLines(p: EngineProbe, out: (s: string) => void): void {
	out(`engine: BLOCKED — ${p.kind} (${p.endpoint})`);
	out(`  owner: ${describeEngineOwner(p.owner)}`);
	out(`  cause: ${p.detail}`);
	if (p.version?.version) out(`  build: v${p.version.version} · api ${p.version.api ?? "?"}`);
	if (p.remediation) out(`  fix: ${p.remediation}`);
	out(`  this CLI's token: ${engineTokenPath()}`);
}

/** The agent's own side of the handshake for the CLI surfaces — sha null on
 *  purpose: these run before any spawn, and the needrestart rule
 *  (bootedAt < codeMtimeMs) already catches same-version skew after an
 *  update rewrote the checkout. */
function agentBuild() {
	return { version: agentVersion(), gitSha: null as string | null, codeMtimeMs: codeMtimeMs() };
}

export async function runEngineCommand(argv: string[], ctx: { out?: (s: string) => void } = {}): Promise<number> {
	const out = ctx.out ?? ((s: string) => console.log(s));
	const sub = argv[0] ?? "status";
	if (sub === "help" || sub === "--help" || sub === "-h") {
		out(ENGINE_USAGE);
		return 0;
	}
	if (sub === "status") return cmdStatus(out);
	if (sub === "start") return cmdStart(out);
	if (sub === "stop") {
		const { flags, error, help } = parseStopFlags(argv.slice(1));
		if (help) {
			out(ENGINE_USAGE);
			return 0;
		}
		if (error) {
			out(`unown: ${error}`);
			return 2;
		}
		return cmdStop(out, flags);
	}
	if (sub === "restart") {
		const { flags, error, help } = parseRestartFlags(argv.slice(1));
		if (help) {
			out(ENGINE_USAGE);
			return 0;
		}
		if (error) {
			out(`unown: ${error}`);
			return 2;
		}
		return cmdRestart(out, flags);
	}
	if (sub === "repair") return cmdRepair(out);
	if (sub === "serve") return cmdServe();
	if (sub === "install" || sub === "install-service") {
		const rest = argv.slice(1);
		if (rest.includes("--help") || rest.includes("-h")) {
			out(ENGINE_USAGE);
			return 0;
		}
		const unknown = rest.filter((a) => a !== "--auto");
		if (unknown.length > 0) {
			out(`unown: unknown install flag '${unknown[0]}'`);
			out(ENGINE_USAGE);
			return 2;
		}
		const repoRoot = resolve(import.meta.dir, "../../../..");
		// The two auto-lane knobs may live in the checkout .env (empty = unset);
		// file wins, matching cmdServe's precedence.
		const env = autoServiceEnv(process.env, join(repoRoot, ".env"));
		return installEngineService(repoRoot, out, { auto: rest.includes("--auto"), env });
	}
	if (sub === "uninstall" || sub === "uninstall-service") return uninstallEngineService(out);
	out(`unown: unknown engine subcommand '${sub}'`);
	out(ENGINE_USAGE);
	return 2;
}

/** Fetch /api/overview (null on any failure — callers degrade honestly). */
async function fetchOverview(timeoutMs = 3000): Promise<any | null> {
	try {
		const res = await engineFetch(`${ENGINE_URL}/api/overview`, { signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

/** M11 per-job health row (the shape /api/jobs returns; kept structural so the
 *  formatter is testable without an engine). */
export interface JobHealthRow {
	id: string;
	last_ok: number | null;
	enabled: number;
}

/**
 * M11: the job-health line that makes the HELP's long-standing "status reports
 * jobs" claim true. Before the outcome columns the jobs table held a schedule and
 * no verdict, so the only honest job line was "N jobs scheduled" — which is why
 * the claim went unmet for a job failing every cycle.
 *
 * Returns null when every enabled job has a passing last run: a green loop is not
 * news, and printing a happy tally would bury the two states that ARE news —
 * FAILED and NEVER RAN (which must never be laundered into "fine"). An EMPTY list
 * is its own finding: a router that never seeded has no learning loop at all, and
 * silence about that would be the same defect as calling it green.
 */
export function describeJobHealth(jobs: JobHealthRow[]): string | null {
	if (jobs.length === 0) return "  jobs: none scheduled (the router has not seeded)";
	const failed = jobs.filter((j) => j.last_ok === 0);
	const never = jobs.filter((j) => j.last_ok === null && j.enabled > 0);
	if (failed.length === 0 && never.length === 0) return null;
	const parts: string[] = [];
	if (failed.length > 0) parts.push(`${failed.length} FAILED (${failed.map((j) => j.id).join(", ")})`);
	if (never.length > 0) parts.push(`${never.length} never ran (${never.map((j) => j.id).join(", ")})`);
	return `  jobs: ${jobs.length} scheduled · ${parts.join(" · ")}`;
}

async function fetchJobs(timeoutMs = 2000): Promise<JobHealthRow[] | null> {
	try {
		const res = await engineFetch(`${ENGINE_URL}/api/jobs`, { signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) return null;
		const body = (await res.json()) as { jobs?: JobHealthRow[] };
		return Array.isArray(body?.jobs) ? body.jobs : null;
	} catch {
		return null;
	}
}

async function cmdStatus(out: (s: string) => void): Promise<number> {
	const probe = await probeEngine({ endpoint: ENGINE_URL, timeoutMs: 2500 });
	const stats = outboxStats();
	if (probe.kind !== "ok") {
		const pf = enginePidFromPidfile();
		const circuit = readSpawnState();
		const svc = await serviceStatus();
		if (probe.kind === "refused") {
			out(`engine: DOWN (${ENGINE_URL})`);
			out(
				`  pidfile ${enginePidFile()}: ${pf.pid ? `pid ${pf.pid} (${pf.alive ? "alive — wedged beyond HTTP?" : "dead"})` : "absent"}`,
			);
			out(
				`  outbox: ${stats.queued} note(s) queued locally${stats.dropped > 0 ? ` · ${stats.dropped} dropped while offline` : ""}`,
			);
			out(`  auto-start: ${describeSpawnCircuit(circuit)}`);
			if (circuit.gaveUp)
				out(`  if it keeps failing: inspect .run/engine.log, then try unown engine repair (corrupt DB?)`);
			out(
				svc.installed
					? `  service: ${svc.kind} — ${svc.detail}`
					: "  service: not installed — unown engine install keeps it always on (routines fire without an agent)",
			);
			out("  start it with: unown engine start");
		} else {
			blockedLines(probe, out);
			out(
				`  pidfile ${enginePidFile()}: ${pf.pid ? `pid ${pf.pid} (${pf.alive ? "alive" : "dead"})` : "absent"}`,
			);
			out(
				`  outbox: ${stats.queued} note(s) queued locally${stats.dropped > 0 ? ` · ${stats.dropped} dropped while offline` : ""}`,
			);
			out(`  auto-start: ${describeSpawnCircuit(circuit)}`);
			out(
				svc.installed
					? `  service: ${svc.kind} — ${svc.detail}`
					: "  service: not installed — unown engine install keeps it always on",
			);
			out("  no engine was started — resolve the owner/port above, then re-run.");
		}
		return 1;
	}
	// Full report (the probe passed; reuse its body, still bounded).
	try {
		const body = probe.body ?? (await fetchOverview(3000));
		if (!body) throw new Error("overview failed");
		const r = body?.router ?? {};
		const g = body?.governor ?? {};
		const b = g.budget ?? {};
		const br = g.breaker ?? {};
		// M8: the version-skew verdict — the engine's build vs this CLI's.
		const v: EngineBuildRef | undefined = body?.version;
		const cmp = compareEngineBuild(agentBuild(), v, Date.now());
		const versionSeg = v?.version ? ` · v${v.version}${v.gitSha ? ` ·${v.gitSha}` : ""}` : "";
		out(
			`engine: UP (pid ${body?.pid ?? "?"}, up ${formatDuration(body?.uptimeMs ?? 0)})${versionSeg}${engineStaleMarker(v ? cmp : undefined, agentVersion())}`,
		);
		out(
			`  router: ${r.busy ? `busy on '${r.activeJob}' for ${Math.round((r.busyMs ?? 0) / 1000)}s` : "idle"} (watchdog ${Math.round((r.jobTimeoutMs ?? 0) / 1000)}s)`,
		);
		// M11: the per-job verdict, printed only when something needs reading
		// (describeJobHealth returns null for an all-green loop).
		{
			const jobs = await fetchJobs();
			if (jobs === null) out(`  jobs: /api/jobs unreadable — run 'unown dashboard' → router`);
			else {
				const line = describeJobHealth(jobs);
				if (line) out(line);
			}
		}
		out(
			`  budget: ${b.callsHour ?? "?"} calls/h, ${b.tokensHour ?? "?"} tok/h (limits ${b.limits?.callsHour ?? "?"}/${b.limits?.tokensHour ?? "?"})${b.overBudget ? " — THROTTLED" : ""}`,
		);
		out(`  breaker: ${br.open ? `OPEN (retry in ${Math.ceil((br.retryInMs ?? 0) / 1000)}s)` : "closed"}`);
		// M9 observability: the retention job's high-water mark.
		out(`  retention: ${humanizeDbBytes(body?.retention?.dbBytes)} db`);
		out(
			`  kpis: ${body?.kpis?.totalRuns ?? "?"} runs, ${body?.kpis?.dreams ?? "?"} dreams, ${body?.kpis?.improvementsShipped ?? "?"} improvements shipped`,
		);
		out(
			`  outbox: ${stats.queued} note(s) pending sync${stats.dropped > 0 ? ` · ${stats.dropped} dropped while offline` : ""}`,
		);
		// Audit 2-b D2: the auto-start circuit line used to print only in
		// the DOWN branch — docs (usage.md) describe it as always present.
		{
			const circuit = readSpawnState();
			out(`  auto-start: ${describeSpawnCircuit(circuit)}`);
			if (circuit.gaveUp)
				out(`  if it keeps failing: inspect .run/engine.log, then try unown engine repair (corrupt DB?)`);
		}
		// The always-on layer: is an OS service keeping the engine up?
		{
			const svc = await serviceStatus();
			out(
				svc.installed
					? `  service: ${svc.kind} — ${svc.detail}`
					: "  service: not installed — unown engine install keeps it always on",
			);
		}
		return 0;
	} catch {
		out(`engine: UP (health probe passed, detailed report timed out — ${ENGINE_URL})`);
		return 0;
	}
}

async function cmdStart(out: (s: string) => void): Promise<number> {
	const pre = await probeEngine({ endpoint: ENGINE_URL, timeoutMs: 1500 });
	if (pre.kind === "ok") {
		// M8: an engine that is UP but an older build is a half-fixed
		// state — start did its job (liveness), the version handshake
		// says the build is behind. rc stays 0: nothing is broken,
		// the user asked for "up" and has it.
		const v: EngineBuildRef | undefined = pre.body?.version;
		const cmp = compareEngineBuild(agentBuild(), v, Date.now());
		if (cmp.verdict === "old-build" || cmp.verdict === "stale" || cmp.verdict === "ancient") {
			const bootedAge = v?.bootedAt ? formatDuration(Date.now() - v.bootedAt) : "unknown";
			out(
				`engine: already up (pid ${pre.body?.pid ?? "?"}) — older build (v${v?.version ?? "?"}, booted ${bootedAge} ago; agent v${agentVersion()})`,
			);
			out(`  pick up the new build: unown engine restart`);
			return 0;
		}
		out(`engine: already up (pid ${pre.body?.pid ?? "?"})`);
		return 0;
	}
	if (pre.kind !== "refused") {
		blockedLines(pre, out);
		out("  no engine was started.");
		return 1;
	}
	out(`engine: down — spawning a detached engine…`);
	// FORCE: an explicit user action bypasses the M6 crash-loop circuit
	// (backoff / gave-up) and resets it — the manual equivalent of
	// systemd's `systemctl reset-failed` before `start`.
	const decision: SpawnDecision = await requestEngineSpawn({ force: true });
	if (decision.reason === "blocked" && decision.probe) {
		blockedLines(decision.probe, out);
		out("  no engine was started.");
		return 1;
	}
	if (!decision.spawned) {
		if (decision.reason === "already-up") {
			out("engine: already up");
			return 0;
		}
		out(`engine: start not attempted (${decision.reason}) — see .run/engine.log`);
		return 1;
	}
	// skipSpawn: the force-spawn above already launched the child (and its
	// recorded attempt would gate this function's own un-forced spawn call
	// into a 2s backoff — the M6 gate composing wrong with the wait).
	const result = await ensureEngineRunning(20_000, { skipSpawn: true });
	if (result.up) {
		out(`engine: UP (pid ${result.pid ?? "?"})`);
		return 0;
	}
	if (result.kind && result.kind !== "refused" && result.kind !== "unreachable") {
		out(`engine: BLOCKED — ${result.kind}; another process took the port while this engine was booting.`);
		out("  run `unown engine status` for the owner; no second engine was started.");
		return 1;
	}
	out(`engine: spawned but not healthy yet after 20s — it may still be booting; check:`);
	out(
		`  unown engine status   ·   ${process.platform === "win32" ? "Get-Content -Wait .run\\engine.log" : "tail -f .run/engine.log"}`,
	);
	return 1;
}

async function cmdStop(out: (s: string) => void, flags: StopFlags = { force: false }): Promise<number> {
	const pre = await probeEngine({ endpoint: ENGINE_URL, timeoutMs: 1500 });
	if (pre.kind === "unauthorized" || pre.kind === "occupied" || pre.kind === "incompatible") {
		if (!flags.force || !flags.pid) {
			blockedLines(pre, out);
			out("  refusing to stop an engine this CLI does not own.");
			out("  stop it with the owning install's CLI, or re-run: unown engine stop --force --pid <pid>");
			return 1;
		}
		const port = endpointPort(ENGINE_URL);
		const ownerPid = pre.owner?.pid ?? (port ? portOwnerPid(port) : null);
		if (flags.pid !== ownerPid) {
			out(`engine: refusing — pid ${flags.pid} does not own ${ENGINE_URL} (owner ${ownerPid ?? "unknown"})`);
			return 1;
		}
		out(`engine: SIGTERM to foreign engine pid ${flags.pid} (explicit --force --pid)…`);
		try {
			process.kill(flags.pid, "SIGTERM");
			return 0;
		} catch (err: any) {
			out(`engine: cannot signal pid ${flags.pid}: ${err instanceof Error ? err.message : String(err)}`);
			return 1;
		}
	}
	// HTTP-first (M3, cross-platform): POST /api/shutdown runs the SAME drain
	// path as the signal handlers and works on Windows, where SIGTERM cannot
	// reach JS handlers (TerminateProcess skips them). Signals remain the
	// fallback for an engine that answers neither way.
	try {
		const res = await engineFetch(`${ENGINE_URL}/api/shutdown`, {
			method: "POST",
			signal: AbortSignal.timeout(3000),
		});
		if (res.ok) {
			out("engine: drain requested (in-flight requests finish, WAL checkpointed, lock released)…");
			for (let i = 0; i < 20; i++) {
				await new Promise((r) => setTimeout(r, 500));
				if (!(await engineHealth(600)).up) {
					out("engine: stopped cleanly");
					return 0;
				}
			}
			out("engine: still draining after 10s — falling back to signals");
		}
	} catch {
		/* engine not serving HTTP — fall through to the signal path */
	}
	const health = await engineHealth(1500);
	let pid = health.pid ?? undefined;
	if (!pid) {
		const pf = enginePidFromPidfile();
		if (pf.pid && pf.alive) pid = pf.pid;
	}
	if (!pid) {
		if (health.up) {
			// The engine answers HTTP but reports no pid and the pidfile is
			// stale/dead — it predates supervised starts. Never blind-signal a
			// pid we cannot verify; point at the legacy stop path instead.
			out("engine: UP but its pid is unknown (engine predates supervision, pidfile is stale)");
			out("  stop it with: bun run agent:stop   (then start it with: unown engine start)");
			return 1;
		}
		out("engine: not running");
		return 0;
	}
	out(`engine: SIGTERM to pid ${pid} (draining in-flight requests)…`);
	try {
		process.kill(pid, "SIGTERM");
	} catch (err: any) {
		out(`engine: cannot signal pid ${pid}: ${err instanceof Error ? err.message : String(err)}`);
		return 1;
	}
	// The graceful drain (server.stop + router stop + WAL checkpoint) is fast;
	// allow 10s before reporting the hard-kill fallback.
	for (let i = 0; i < 20; i++) {
		await new Promise((r) => setTimeout(r, 500));
		const probe = await engineHealth(600);
		if (!probe.up) {
			out("engine: stopped cleanly (drained, checkpointed, lock released)");
			return 0;
		}
	}
	try {
		process.kill(pid, "SIGKILL");
		out("engine: did not drain in 10s — SIGKILLed (WAL recovery covers it at next boot)");
		return 0;
	} catch {
		out("engine: stopped");
		return 0;
	}
}

/**
 * `unown engine restart` (M8) — pick up the current build.
 *
 * WHY: the engine is a long-lived detached process; `unown update` (or a
 * `git pull`) moves the checkout out from under it and NOTHING restarted
 * it — the agent ran the new code while the engine kept dreaming on the
 * old one, invisibly (that is the whole M8 version-skew problem). restart
 * is the one-command fix every stale surface points at.
 *
 * Shape (each step reuses the path that already exists):
 *   1. down engine → there is nothing to drain: behave as `start`;
 *   2. busy gate → a router job mid-flight is real work (a dream, a cycle);
 *      refuse unless --force, or poll until idle when --wait <ms> was given
 *      (systemd reload-or-restart semantics: never kill work for a build);
 *   3. stop → cmdStop's HTTP-first drain (requests finish, WAL checkpointed,
 *      lock released — the M3/M5 restart-safety primitives);
 *   4. spawn → cmdStart's tail: force-spawn (crash-loop circuit reset) +
 *      the health wait with skipSpawn (we launched the child ourselves);
 *   5. receipt → the fresh /api/version, so the user SEES the handshake
 *      close: new boot timestamp, same build as the agent.
 */
async function cmdRestart(out: (s: string) => void, flags: RestartFlags): Promise<number> {
	const pre = await probeEngine({ endpoint: ENGINE_URL, timeoutMs: 1500 });
	let tookOver = false;
	// A foreign engine is not ours to cut. --take-ownership is the explicit
	// escape hatch: stop the identified owner, wait for the port to free, then
	// start ours.
	if (pre.kind === "unauthorized" || pre.kind === "occupied" || pre.kind === "incompatible") {
		if (!flags.takeOwnership) {
			blockedLines(pre, out);
			out("  refusing to restart an engine this CLI does not own; re-run with --take-ownership to stop it and start ours.");
			return 1;
		}
		const port = endpointPort(ENGINE_URL);
		const ownerPid = pre.owner?.pid ?? (port ? portOwnerPid(port) : null);
		if (!ownerPid) {
			out("engine: cannot identify the port owner; refusing --take-ownership");
			return 1;
		}
		const stopRc = await cmdStop(out, { force: true, pid: ownerPid });
		if (stopRc !== 0) return stopRc;
		for (let i = 0; i < 15; i++) {
			const p = await probeEngine({ endpoint: ENGINE_URL, timeoutMs: 500 });
			if (p.kind === "refused") break;
			await new Promise((r) => setTimeout(r, 200));
		}
		tookOver = true;
	}
	if (!tookOver) {
		// 1. A down engine has nothing to drain — restart IS start.
		if (pre.kind !== "ok") {
			out("engine: down — nothing to drain, starting it");
			return cmdStart(out);
		}
		// 2. Busy gate: never cut a running job in half unless forced.
		if (!flags.force) {
			const deadline = Date.now() + flags.waitMs;
			for (;;) {
				const body = await fetchOverview(2000);
				const router = body?.router;
				if (!body || !router?.busy) break; // idle (or overview failed — cmdStop re-probes)
				if (Date.now() >= deadline) {
					out(busyRefusalMessage(router.activeJob ?? "job", router.busyMs ?? 0));
					return 1;
				}
				await new Promise((r) => setTimeout(r, Math.min(500, Math.max(50, deadline - Date.now()))));
			}
		}
		// 3. The graceful drain (cmdStop's HTTP-first path, signals as fallback).
		const stopRc = await cmdStop(out);
		if (stopRc !== 0) return stopRc; // stop failed — do NOT spawn a second engine over it
	}
	// 4. Fresh spawn — force = circuit reset; the transition marker was never
	//    set (that is the install/update lane's marker, not an interactive one).
	const decision: SpawnDecision = await requestEngineSpawn({ force: true });
	if (decision.reason === "blocked" && decision.probe) {
		blockedLines(decision.probe, out);
		out("  no engine was started.");
		return 1;
	}
	if (!decision.spawned) {
		out(`engine: spawn not attempted (${decision.reason}) — start the stack manually: bun run agent:start`);
		return 1;
	}
	const result = await ensureEngineRunning(20_000, { skipSpawn: true });
	if (!result.up) {
		out("engine: spawned but not healthy yet after 20s — it may still be booting; check:");
		out(
			`  unown engine status   ·   ${process.platform === "win32" ? "Get-Content -Wait .run\\engine.log" : "tail -f .run/engine.log"}`,
		);
		return 1;
	}
	// 5. Receipt: the fresh build, from the fresh /api/version.
	out(`engine: UP (pid ${result.pid ?? "?"}) — restarted onto the current build`);
	try {
		const res = await engineFetch(`${ENGINE_URL}/api/version`, { signal: AbortSignal.timeout(3000) });
		const v: any = await res.json();
		if (v?.version) {
			out(
				`  build: v${v.version}${v.gitSha ? ` ·${v.gitSha}` : ""} (agent v${agentVersion()}, booted ${formatDuration(v.uptimeMs ?? 0)} ago)`,
			);
		}
	} catch {
		/* the receipt is best-effort — the restart itself succeeded */
	}
	return 0;
}

/**
 * `unown engine repair` (M6) — the corrupt-DB recovery path.
 *
 * WHEN: the engine crash-loops on boot (auto-start circuit gave up, the log
 * shows SQLITE_CORRUPT / "database disk image is malformed"). Research
 * (sqlite.org howtocorrupt + cli docs, docs/resilience.md): corruption is
 * almost always environmental (lying drives, power loss mid-sync), the
 * honest recovery is backup → quarantine → fresh DB, and the OUTBOX + the
 * on-disk memory files make the loss BOUNDED by design:
 *   - queued notes replay from $UNOWN_HOME/notes/outbox at next boot;
 *   - project memory lives in <project>/.unown/memory/*.md, untouched;
 *   - only engine-internal history (runs/dreams/skills tables) is left
 *     behind in the quarantined file — recoverable via `sqlite3 .recover`.
 */
async function cmdRepair(out: (s: string) => void): Promise<number> {
	// Never pull the DB out from under a live engine. The engine's own data
	// dir is authoritative: its lock/pid survive a token mismatch (the 401
	// case), and a foreign engine on another data dir cannot own this DB.
	const lockPid = engineLockHolderPid();
	const pf = enginePidFromPidfile();
	if (lockPid || pf.alive) {
		const pid = lockPid ?? pf.pid;
		out(`engine: a live engine (pid ${pid}) holds this data dir — stop it first (unown engine stop), then re-run repair`);
		return 1;
	}
	const db = DB_PATH;
	if (!existsSync(db)) {
		out(`engine: no database at ${db} — nothing to repair (a fresh one is created by: unown engine start)`);
		return 0;
	}
	// 1. Quick integrity triage — a HEALTHY db needs no repair (the crash
	//    loop had another cause; point at the log instead of nuking data).
	let verdict = "unknown";
	try {
		const probe = new Database(db, { create: false });
		const rows = probe.prepare("PRAGMA quick_check").all() as Array<{ quick_check?: string }>;
		verdict = String(rows[0]?.quick_check ?? "unknown");
		probe.close();
	} catch (err: any) {
		verdict = `unreadable: ${err instanceof Error ? err.message : String(err)}`;
	}
	const sizeKb = (() => {
		try {
			return Math.max(1, Math.round(statSync(db).size / 1024));
		} catch {
			return -1;
		}
	})();
	if (verdict === "ok") {
		out(`engine: database at ${db} passes PRAGMA quick_check (${sizeKb} KB) — no repair needed.`);
		out("  the failed starts had another cause — inspect .run/engine.log (port conflict? missing bun? env?)");
		return 0;
	}
	// 2. Quarantine: rename db + WAL sidecars aside (keeps every byte for
	//    forensic `sqlite3 <file> .recover`; a copy would double disk use).
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const moved: string[] = [];
	for (const suffix of ["", "-wal", "-shm"]) {
		const from = `${db}${suffix}`;
		if (!existsSync(from)) continue;
		const to = `${db}.corrupt-${stamp}${suffix}`;
		try {
			renameSync(from, to);
			moved.push(to);
		} catch (err: any) {
			out(`engine: repair failed — cannot move ${from}: ${err instanceof Error ? err.message : String(err)}`);
			out("  (close any process holding the file and re-run: unown engine repair)");
			return 1;
		}
	}
	out(`engine: database quarantined — quick_check said: ${verdict} (${sizeKb} KB)`);
	for (const to of moved) out(`  → ${to}`);
	out("  kept for forensics: sqlite3 <file> '.recover' can salvage rows; delete when confident");
	// 3. Fresh slate: the circuit that gave up on the old DB must not
	//    block the fresh boot; notes replay from the outbox, memory files
	//    on disk are untouched.
	resetSpawnCircuit();
	out("  auto-start circuit reset; queued notes replay from the outbox at next boot");
	out("  start it fresh with: unown engine start");
	return 0;
}

async function cmdServe(): Promise<number> {
	// Services own this entry (unown engine install → systemd/launchd/
	// schtasks), and they start it with a MINIMAL environment — load the
	// state-root .env first, the same merge the detached spawn path does
	// (engine-supervisor.ts spawnEngineDetached), or a service-booted
	// engine would run with no PI_MODEL_ID / bridge config. Interactive
	// `engine serve` runs also benefit: the config travels with the
	// checkout, not the caller's cwd. Same precedence as the spawn path:
	// .env wins over the inherited environment (agent:start semantics).
	const stateRoot = resolve(import.meta.dir, "../../../..");
	const envValues = loadEnvValues(join(stateRoot, ".env"));
	for (const [k, v] of Object.entries(envValues)) process.env[k] = v;
	// M6: rotate the log at serve-boot too — under `engine install` (launchd
	// Standard*Path) nobody runs the supervisor spawn path, so serve-boot is
	// that lane's rotation point. Copy-truncate keeps any service-held
	// O_APPEND fd valid mid-rotation.
	rotateEngineLogIfNeeded();
	// DYNAMIC import — the M2 detachment contract: a terminal session must
	// never load the engine half of the package (or its SQLite handle).
	try {
		const { startServer } = await import("./index.ts");
		const server = await startServer(Number(process.env.PI_AGENT_PORT ?? 3030));
		if (!server) {
			// startServer already logged why (another engine holds the lock).
			return 0;
		}
		// Bun.serve keeps the event loop alive; serve until SIGTERM/SIGINT or
		// POST /api/shutdown, both handled by server.ts's graceful drain.
		return new Promise<number>(() => {});
	} catch (err: any) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`unown engine: failed to start — ${msg}`);
		if (/corrupt|malformed|not a database/i.test(msg)) {
			console.error("  the database is damaged — quarantine it and boot fresh with: unown engine repair");
		} else if (/port.*in use|EADDRINUSE|address already in use/i.test(msg)) {
			// A second engine is a CLEAN loser, not a crash: exit 0 so an OS
			// supervisor (Restart=on-failure / KeepAlive) does not restart-storm.
			const port = Number(process.env.PI_AGENT_PORT ?? 3030);
			const probe = await probeEngine({ endpoint: `http://127.0.0.1:${port}`, timeoutMs: 1000 });
			if (probe.banner) {
				console.error(
					`  another Unown engine already owns :${port}${probe.owner?.pid ? ` (pid ${probe.owner.pid})` : ""} — this instance exits cleanly.`,
				);
				return 0;
			}
			console.error("  the port is held by a non-Unown process; identify it before restarting.");
		} else {
			console.error("  (is the port already in use? see .run/engine.log)");
		}
		return 1;
	}
}
