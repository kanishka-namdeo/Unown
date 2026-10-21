/**
 * engine-supervisor.ts — the terminal side of engine supervision (M3).
 *
 * Design (docs/detached-engine-architecture.md, design rule 5 — the Ollama
 * pattern): the agent and the engine are installed together, but nothing
 * keeps a second always-on supervisor process alive. Instead, every
 * agent-side touchpoint PINGS the engine's HTTP health; on
 * connection-refused it spawns the engine detached ONCE (in-process
 * single-flight) and does not block on full health — durable work (notes)
 * is already covered by the filesystem outbox, which the engine drains at
 * boot (`syncNoteOutbox`), so a spawn that merely STARTS is enough.
 *
 * Spawning rules (research doc §2/§5, verified against Bun 1.3):
 *   - `detached: true` + `unref()` + stdio → log file (NEVER an unread
 *     pipe: a daemon writing into a full/parentless pipe dies on SIGPIPE);
 *   - Windows: detached spawn is broken in Bun (oven-sh/bun#31603 — the
 *     child dies with the parent unless escaped via `cmd /c start`); the
 *     escape hatch is used there and flagged cross-platform.
 *   - cross-process races converge: two CLIs spawning simultaneously both
 *     spawn a child, but the engine's boot-time single-instance lock means
 *     exactly one wins the port + lock; the loser exits cleanly.
 */
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { engineFetch } from "./engine-auth.ts";
import type { EngineBuildRef } from "./engine-version.ts";
import { stateRoot } from "./packaging.ts";

/** Engine base URL (same resolution as term.ts ENGINE_URL). */
function engineUrl(): string {
        return process.env.UNOWN_ENGINE_URL || "http://127.0.0.1:3030";
}

/** State root shared with the engine (repo checkout → repo; binary → UNOWN_HOME). */
export function supervisorStateRoot(): string {
        // Same shape as store.ts: this module sits at
        // <repo>/pi-repo/packages/self-learning/src/ (or dist/ in a build).
        const REPO_ROOT = resolve(import.meta.dir, "../../../..");
        return stateRoot(REPO_ROOT);
}

function runDir(): string {
        return join(supervisorStateRoot(), ".run");
}

export function enginePidFile(): string {
        return join(runDir(), "engine.pid");
}

// ---------------------------------------------------------------------------
// Cross-process spawn state (M6) — the crash-loop circuit.
//
// PROBLEM (M6 recon): the in-process single-flight latch only dedupes spawns
// WITHIN one CLI process. A boot-crashing engine (corrupt DB, occupied port)
// gets one fresh doomed child per CLI session / note delivery, forever,
// silently. No process ever learns that the previous 40 children all died.
//
// DESIGN (research: systemd StartLimitBurst/StartLimitIntervalSec, supervisord
// startretries→FATAL, k8s CrashLoopBackOff — docs/resilience.md):
//   - a tiny JSON state file in .run/ persists consecutive spawn attempts
//     across processes;
//   - exponential backoff gate between attempts (full-jitter is unnecessary
//     here: attempts are user-action-spaced, not timer-spaced);
//   - after MAX_ATTEMPTS consecutive attempts WITHOUT an observed healthy
//     engine, auto-spawn gives up (supervisord FATAL) — the footer flips to
//     "memory: paused" and the user gets ONE actionable message instead of an
//     infinite silent loop;
//   - ANY observed-healthy probe resets the circuit (k8s: backoff resets
//     after a healthy run) — `unown engine start` bypasses + resets it
//     (manual action always wins).
// ---------------------------------------------------------------------------

/** Consecutive auto-spawn attempts allowed before giving up (supervisord startretries=5). */
export const SPAWN_MAX_ATTEMPTS = 5;
/** Backoff base between auto-spawn attempts (doubles per attempt, capped). */
const SPAWN_BACKOFF_BASE_MS = 2_000;
const SPAWN_BACKOFF_CAP_MS = 60_000;
/** A window this quiet resets the attempt counter (systemd StartLimitIntervalSec=10m). */
const SPAWN_WINDOW_MS = 10 * 60_000;

export interface SpawnState {
        /** Consecutive spawned-but-never-observed-healthy attempts in this window. */
        attempts: number;
        /** Epoch ms when the current attempt window opened. */
        windowStart: number;
        /** Epoch ms of the last spawn launch (backoff anchor). */
        lastAttemptAt: number;
        /** Epoch ms when an engine was last observed healthy (0 = never). */
        lastHealthyAt: number;
        /** True once attempts hit SPAWN_MAX_ATTEMPTS without a healthy reset. */
        gaveUp: boolean;
}

function freshSpawnState(now = Date.now()): SpawnState {
        return { attempts: 0, windowStart: now, lastAttemptAt: 0, lastHealthyAt: 0, gaveUp: false };
}

export function spawnStateFile(): string {
        return join(runDir(), "engine-spawn-state.json");
}

/** Best-effort read; a missing/corrupt file means "fresh circuit" (fail-open). */
export function readSpawnState(): SpawnState {
        try {
                const raw = JSON.parse(readFileSync(spawnStateFile(), "utf8"));
                if (typeof raw !== "object" || raw === null) return freshSpawnState();
                return {
                        attempts: Number(raw.attempts) || 0,
                        windowStart: Number(raw.windowStart) || Date.now(),
                        lastAttemptAt: Number(raw.lastAttemptAt) || 0,
                        lastHealthyAt: Number(raw.lastHealthyAt) || 0,
                        gaveUp: raw.gaveUp === true,
                };
        } catch {
                return freshSpawnState();
        }
}

/** Best-effort write (read-only .run → keep going without persistence). */
function writeSpawnState(state: SpawnState) {
        try {
                mkdirSync(runDir(), { recursive: true });
                writeFileSync(spawnStateFile(), JSON.stringify(state), "utf8");
        } catch {
                /* the in-process gates still apply without the file */
        }
}

/** Backoff before the NEXT auto-spawn after `attempts` failed ones (pure). */
export function spawnBackoffMs(attempts: number): number {
        if (attempts <= 0) return 0;
        return Math.min(SPAWN_BACKOFF_CAP_MS, SPAWN_BACKOFF_BASE_MS * 2 ** (attempts - 1));
}

export interface SpawnGate {
        allowed: boolean;
        reason: "ok" | "backoff" | "gave-up" | "stale-window";
        /** For "backoff": ms until the next auto-spawn is allowed. */
        retryInMs?: number;
        /** For "gave-up": how many attempts burned. */
        attempts?: number;
}

/**
 * Should an AUTO-spawn fire right now? (pure — unit-tested with injected now)
 * - gaveUp            → never (until a healthy probe or `engine start` resets)
 * - within backoff    → not yet (retryInMs says when)
 * - window went quiet → fresh window (a user returning hours later gets a
 *   clean circuit; systemd's StartLimitIntervalSec semantics)
 */
export function evaluateSpawnGate(state: SpawnState, now = Date.now()): SpawnGate {
        if (state.gaveUp) return { allowed: false, reason: "gave-up", attempts: state.attempts };
        if (state.attempts > 0 && state.lastAttemptAt > 0) {
                if (now - state.lastAttemptAt > SPAWN_WINDOW_MS) {
                        return { allowed: true, reason: "stale-window" };
                }
                const wait = spawnBackoffMs(state.attempts) - (now - state.lastAttemptAt);
                if (wait > 0) return { allowed: false, reason: "backoff", retryInMs: wait, attempts: state.attempts };
        }
        return { allowed: true, reason: "ok" };
}

/** Record a spawn LAUNCH (not health — the child may still die) (pure). */
export function recordSpawnAttempt(state: SpawnState, now = Date.now()): SpawnState {
        // A quiet window (or a healthy engine since) restarts the count.
        const windowExpired = state.lastAttemptAt > 0 && now - state.lastAttemptAt > SPAWN_WINDOW_MS;
        const attempts = windowExpired || state.lastHealthyAt > state.lastAttemptAt ? 1 : state.attempts + 1;
        const next: SpawnState = {
                attempts,
                windowStart: windowExpired ? now : state.windowStart,
                lastAttemptAt: now,
                lastHealthyAt: state.lastHealthyAt,
                gaveUp: attempts >= SPAWN_MAX_ATTEMPTS,
        };
        return next;
}

/** Any observed-healthy engine resets the circuit (call from probes + `engine start`). */
export function markEngineHealthy() {
        const now = Date.now();
        writeSpawnState({ ...freshSpawnState(now), lastHealthyAt: now });
}

/** Zero the circuit without asserting health (repair: the DB was quarantined,
 * the next start attempt deserves a clean slate). */
export function resetSpawnCircuit() {
        writeSpawnState(freshSpawnState());
}

/** User-facing auto-start kill switch (docs/configuration.md): UNOWN_ENGINE_AUTOSTART=0. */
export function autoStartDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
        return /^(0|false|off|no)$/i.test(env.UNOWN_ENGINE_AUTOSTART ?? "");
}

/** Cheap liveness probe: is the engine answering HTTP right now? The
 *  `version` field (M8) is the /api/overview version block — the
 *  version-skew handshake payload; absent on pre-M8 engines, which
 *  compareEngineBuild classifies as "unknown". */
export async function engineHealth(
        timeoutMs = 1500,
): Promise<{ up: boolean; pid?: number; busyMs?: number; activeJob?: string; version?: EngineBuildRef }> {
        try {
                const res = await engineFetch(`${engineUrl()}/api/overview`, { signal: AbortSignal.timeout(timeoutMs) });
                if (!res.ok) return { up: false };
                const body: any = await res.json();
                return { up: true, pid: body?.pid, busyMs: body?.router?.busyMs, activeJob: body?.router?.activeJob, version: body?.version };
        } catch {
                return { up: false };
        }
}

/** Minimal .env loader (KEY=VALUE lines; comments/blanks ignored) — mirrors scripts/lib.ts. */
function loadEnvValues(path: string): Record<string, string> {
        const out: Record<string, string> = {};
        try {
                const raw = readFileSync(path, "utf8");
                for (const line of raw.split(/\r?\n/)) {
                        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
                        if (m && !line.trimStart().startsWith("#")) out[m[1]] = m[2];
                }
        } catch {
                /* no .env — inherit the environment as-is */
        }
        return out;
}

/** In-process single-flight: concurrent callers share one spawn attempt. */
let spawnInFlight: Promise<boolean> | null = null;

/** Test/CI guard: never spawn engine children from test processes (set by test/_env.ts). */
export const SPAWN_DISABLED = process.env.PI_DISABLE_ENGINE_SPAWN === "1";

/**
 * Spawn the engine detached. Resolves true when the child was launched
 * (NOT when it is healthy — the caller decides whether to wait). The child
 * runs `unown engine serve` (this same binary/package), which boots the
 * engine in-process; the repo .env (source shape) is merged into its env.
 *
 * M6 gates (before the latch, cheapest first):
 *   1. test guard / user auto-start kill switch — never spawn;
 *   2. cross-process crash-loop circuit — backoff after failed attempts,
 *      hard stop after SPAWN_MAX_ATTEMPTS (force=true, used by
 *      `unown engine start`, bypasses + resets it: a manual action wins).
 */
export function spawnEngineDetached(opts: { force?: boolean } = {}): Promise<boolean> {
        if (SPAWN_DISABLED) return Promise.resolve(false);
        if (autoStartDisabled() && !opts.force) return Promise.resolve(false);
        if (!opts.force) {
                const state = readSpawnState();
                const gate = evaluateSpawnGate(state);
                if (!gate.allowed) return Promise.resolve(false);
                writeSpawnState(recordSpawnAttempt(state));
        } else {
                // Manual start: clean slate, then record the attempt like any other.
                markEngineHealthy();
                writeSpawnState(recordSpawnAttempt(readSpawnState()));
        }
        if (spawnInFlight) return spawnInFlight;
        spawnInFlight = (async () => {
                try {
                        const state = supervisorStateRoot();
                        const envFile = join(state, ".env");
                        const env = { ...process.env, ...loadEnvValues(envFile) };
                        // Entry: this CLI's own executable (works for `bin/unown`, the
                        // compiled binary, and `bun scripts` shapes alike).
                        const isCompiled = !process.argv[1] || process.argv[1] === process.argv[0];
                        const command = process.execPath;
                        const args = isCompiled ? ["engine", "serve"] : [process.argv[1] ?? "bin/unown", "engine", "serve"];
                        mkdirSync(runDir(), { recursive: true });
                        const logFd = openSync(join(runDir(), "engine.log"), "a");
                        // The Windows detach escape hatch: Bun's detached:true child dies
                        // with the parent on win32 (oven-sh/bun#31603). `cmd /c start /b`
                        // launches into its own session that survives. The EMPTY STRING
                        // before the command is the window-title slot — without it, `start`
                        // consumes a quoted executable path (spaces: "C:\Program Files\…")
                        // as the title and runs the wrong command (SS64-documented trap).
                        if (process.platform === "win32") {
                                const child = spawn("cmd", ["/c", "start", "/b", "", command, ...args], {
                                        cwd: state,
                                        env,
                                        windowsHide: true,
                                        stdio: ["ignore", logFd, logFd],
                                });
                                child.unref();
                                // cmd.exe's own pid is NOT the engine's pid (it exits right after
                                // `start` returns) — no pidfile write on this branch; health
                                // probing and /api/overview's pid are the source of truth.
                                closeSync(logFd);
                        } else {
                                const child = spawn(command, args, {
                                        cwd: state,
                                        env,
                                        detached: true,
                                        stdio: ["ignore", logFd, logFd],
                                });
                                child.unref();
                                if (child.pid) {
                                        try {
                                                writeFileSync(enginePidFile(), String(child.pid));
                                        } catch {
                                                /* best effort — health probing is the source of truth */
                                        }
                                }
                                closeSync(logFd);
                        }
                        return true;
                } catch {
                        return false;
                } finally {
                        // release the single-flight latch after a beat so a LATER call
                        // (e.g. next CLI invocation in the same process) can retry
                        setTimeout(() => {
                                spawnInFlight = null;
                        }, 5_000).unref?.();
                }
        })();
        return spawnInFlight;
}

/**
 * The touchpoint hook: ping once; if the engine is down, spawn it detached
 * and (optionally) poll health with jittered backoff. Non-blocking callers
 * pass waitMs=0 — the outbox covers durability, the spawn covers liveness.
 */
export async function ensureEngineRunning(
        waitMs = 0,
        opts: { skipSpawn?: boolean } = {},
): Promise<{ spawned: boolean; up: boolean; pid?: number }> {
        const first = await engineHealth();
        if (first.up) {
                markEngineHealthy(); // observed healthy → reset the crash-loop circuit (M6)
                return { spawned: false, up: true, pid: first.pid };
        }
        const spawned = opts.skipSpawn ? false : await spawnEngineDetached();
        // A gated spawn (M6 backoff / gave-up / kill switch) must NOT skip the
        // WAIT: the caller may have JUST kicked a spawn itself (`engine start`'s
        // force path records an attempt, and this function's own un-forced call
        // would hit the fresh 2s backoff gate and used to early-return without
        // ever polling — caught live by the E2E lane: engine healthy at t+2s,
        // cmdStart reporting "not healthy after 20s").
        if (waitMs <= 0) return { spawned, up: false };
        // jittered backoff poll (250ms · 2^n ± 20%) bounded by waitMs
        let delay = 250;
        const deadline = Date.now() + waitMs;
        for (;;) {
                const jitter = delay * (0.8 + Math.random() * 0.4);
                await new Promise((r) => setTimeout(r, jitter));
                const probe = await engineHealth();
                if (probe.up) {
                        markEngineHealthy();
                        return { spawned: true, up: true, pid: probe.pid };
                }
                if (Date.now() >= deadline) return { spawned, up: false };
                delay = Math.min(delay * 2, 2000);
        }
}

/** Read the pidfile and report whether that pid is alive (diagnostics; never authoritative). */
export function enginePidFromPidfile(): { pid: number | null; alive: boolean } {
        try {
                if (!existsSync(enginePidFile())) return { pid: null, alive: false };
                const pid = Number(readFileSync(enginePidFile(), "utf8").trim());
                if (!Number.isFinite(pid) || pid <= 0) return { pid: null, alive: false };
                try {
                        process.kill(pid, 0);
                        return { pid, alive: true };
                } catch {
                        return { pid, alive: false };
                }
        } catch {
                return { pid: null, alive: false };
        }
}
