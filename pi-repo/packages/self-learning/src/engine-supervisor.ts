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
import {
        closeSync,
        copyFileSync,
        existsSync,
        mkdirSync,
        openSync,
        readFileSync,
        rmSync,
        statSync,
        truncateSync,
        writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { probeEngine, type EngineBlockedKind, type EngineProbe, type EngineProbeKind } from "./engine-probe.ts";
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
        // Runtime files (log/pid/circuit/descriptor) live beside the state by
        // default, but UNOWN_RUNTIME_DIR is the canonical override — it also
        // lets a test or a second profile keep its run state away from a live
        // engine's exclusively-held Windows log.
        const override = (process.env.UNOWN_RUNTIME_DIR ?? "").trim();
        return override !== "" ? override : join(supervisorStateRoot(), ".run");
}

/** The engine's single unified log — supervisor-spawned engines write it via
 *  inherited stdio; service-booted engines (launchd) write it via the plist's
 *  StandardOut/ErrorPath. One file, one rotation policy (M6). */
export function engineLogPath(): string {
        return join(runDir(), "engine.log");
}

/** Log rotation cap (M6): past this size the log archives to engine.log.1
 *  (one generation — a bounded ~2× footprint) and truncates. Env-tunable via
 *  UNOWN_ENGINE_LOG_MAX_BYTES (floor 64 KiB). */
export const ENGINE_LOG_MAX_BYTES = 5 * 1024 * 1024;

function engineLogMaxBytes(): number {
        const raw = process.env.UNOWN_ENGINE_LOG_MAX_BYTES || "";
        if (raw === "") return ENGINE_LOG_MAX_BYTES;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 64 * 1024 ? n : ENGINE_LOG_MAX_BYTES;
}

/** Rotate .run/engine.log when it outgrows the cap (M6 — the disk-full
 *  backlog item). COPY-TRUNCATE, not rename: under `engine install` the OS
 *  service (launchd Standard*Path) and under supervisor spawns the inherited
 *  stdio fd BOTH point at this file with O_APPEND — a rename would strand
 *  every writer on the archived inode forever. Copy the full file to
 *  engine.log.1, then truncate in place: append-mode writers continue at
 *  offset 0 of the fresh file mid-flight. Never throws — rotation is
 *  housekeeping, never a dependency (the webcache events-feed rotate is the
 *  in-repo precedent for a bounded log lane). */
export function rotateEngineLogIfNeeded(
        logPath?: string,
        maxBytes: number = engineLogMaxBytes(),
): { rotated: boolean } {
        const path = logPath ?? engineLogPath();
        try {
                const st = statSync(path);
                if (st.size < maxBytes) return { rotated: false };
                copyFileSync(path, `${path}.1`);
                truncateSync(path, 0);
                return { rotated: true };
        } catch {
                return { rotated: false }; // missing/racing — the next boot retries
        }
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
        /** Why the last spawn was refused without being attempted (a foreign
         *  engine, a taken port, an incompatible build, or a hung port). */
        lastCause?: EngineBlockedKind;
        /** Epoch ms of the probe that produced lastCause. */
        lastProbeAt?: number;
}

function freshSpawnState(now = Date.now()): SpawnState {
        return { attempts: 0, windowStart: now, lastAttemptAt: 0, lastHealthyAt: 0, gaveUp: false };
}

const BLOCKED_CAUSES: EngineBlockedKind[] = ["unauthorized", "occupied", "incompatible", "unreachable"];

function isBlockedCause(value: unknown): value is EngineBlockedKind {
        return typeof value === "string" && (BLOCKED_CAUSES as string[]).includes(value);
}

export function spawnStateFile(): string {
        return join(runDir(), "engine-spawn-state.json");
}

/** A deliberate restart (install/update/service reconcile) writes this marker
 *  before draining. While it is fresh, a CLI must not interpret the missing
 *  engine as a crash and spawn a competitor into the same port. */
export function engineTransitionFile(): string {
        return join(runDir(), "engine-transition.json");
}

export function writeEngineTransition(ttlMs = 120_000): void {
        try {
                mkdirSync(runDir(), { recursive: true });
                const now = Date.now();
                writeFileSync(engineTransitionFile(), JSON.stringify({ startedAt: now, until: now + ttlMs }), "utf8");
        } catch {
                /* best effort — the drain itself is still safe */
        }
}

export function clearEngineTransition(): void {
        try {
                rmSync(engineTransitionFile(), { force: true });
        } catch {
                /* best effort */
        }
}

export function transitionInProgress(now = Date.now()): boolean {
        try {
                const raw = JSON.parse(readFileSync(engineTransitionFile(), "utf8"));
                const until = Number(raw?.until);
                return Number.isFinite(until) && until > now;
        } catch {
                return false;
        }
}

/** Best-effort read; a missing/corrupt file means "fresh circuit" (fail-open). */
export function readSpawnState(): SpawnState {
        try {
                const raw = JSON.parse(readFileSync(spawnStateFile(), "utf8"));
                if (typeof raw !== "object" || raw === null) return freshSpawnState();
                const state: SpawnState = {
                        attempts: Number(raw.attempts) || 0,
                        windowStart: Number(raw.windowStart) || Date.now(),
                        lastAttemptAt: Number(raw.lastAttemptAt) || 0,
                        lastHealthyAt: Number(raw.lastHealthyAt) || 0,
                        gaveUp: raw.gaveUp === true,
                };
                // Optional fields stay ABSENT when the file predates them — the
                // pre-taxonomy fixtures (and the live 0.0.21 state file) must
                // read back byte-shape-compatible.
                if (isBlockedCause(raw.lastCause)) state.lastCause = raw.lastCause;
                const lastProbeAt = Number(raw.lastProbeAt) || 0;
                if (lastProbeAt > 0) state.lastProbeAt = lastProbeAt;
                return state;
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

/** Record a REFUSED spawn (a foreign engine, a taken port, an incompatible
 *  build or a hung port) — the cause is stored so every surface can explain
 *  why auto-start is not running, without counting a failed attempt (no child
 *  was launched, so the crash-loop backoff must not advance). */
export function recordSpawnBlocked(
        state: SpawnState,
        cause: EngineBlockedKind,
        now = Date.now(),
): SpawnState {
        return { ...state, lastCause: cause, lastProbeAt: now };
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

/** M3: the /api/overview dreamNews block — the engine's "learning happened"
 *  headline (the newest project dream that ADDED memories, for the terminal
 *  toast lane; see engine-status.ts shouldToastDreamNews for the decision and
 *  dream.ts latestDreamNews for the query). Parsed here, next to the rest of
 *  the /api/overview decoding, so a malformed block degrades to "no news"
 *  instead of reaching the state machine as a half-shape. */
export interface DreamNews {
        /** Dream row id — the once-per-dream latch key. */
        id: string;
        /** Project slug (the engine's note-grouping slug). */
        project: string;
        /** Memories the dream ADDED (>0 — the honest no-change dreams never ship). */
        added: number;
        /** The project-memory version the dream wrote. */
        version: number;
        /** Dream end time, epoch ms. */
        at: number;
}

/** Validate + narrow an unknown /api/overview body fragment to DreamNews
 *  (undefined = absent/malformed — treated as no news). */
export function parseDreamNews(raw: unknown): DreamNews | undefined {
        if (!raw || typeof raw !== "object") return undefined;
        const r = raw as Record<string, unknown>;
        if (typeof r.id !== "string" || !r.id) return undefined;
        if (typeof r.project !== "string" || !r.project) return undefined;
        if (typeof r.added !== "number" || !(r.added > 0)) return undefined;
        if (typeof r.version !== "number" || !Number.isFinite(r.version)) return undefined;
        if (typeof r.at !== "number" || !Number.isFinite(r.at)) return undefined;
        return { id: r.id, project: r.project, added: r.added, version: r.version, at: r.at };
}

/** Cheap liveness probe: is the engine answering HTTP right now? The
 *  `version` field (M8) is the /api/overview version block — the
 *  version-skew handshake payload; absent on pre-M8 engines, which
 *  compareEngineBuild classifies as "unknown". The `dreamNews` field (M3)
 *  is the learning headline for the terminal toast lane — absent on
 *  pre-M3 engines and whenever no fresh additive dream exists. */
export async function engineHealth(timeoutMs = 1500): Promise<{
        up: boolean;
        pid?: number;
        busyMs?: number;
        activeJob?: string;
        version?: EngineBuildRef;
        dreamNews?: DreamNews;
}> {
        const probe = await probeEngine({ endpoint: engineUrl(), timeoutMs });
        if (probe.kind !== "ok") return { up: false };
        const body = probe.body;
        return {
                up: true,
                pid: body?.pid,
                busyMs: body?.router?.busyMs,
                activeJob: body?.router?.activeJob,
                version: body?.version,
                dreamNews: parseDreamNews(body?.dreamNews),
        };
}

/** Minimal .env loader (KEY=VALUE lines; comments/blanks ignored) — mirrors scripts/lib.ts.
 *  Exported for engine-cli.ts's serve path (service-booted engines start with
 *  a minimal environment and must load the state-root .env themselves). */
export function loadEnvValues(path: string): Record<string, string> {
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

// ---------------------------------------------------------------------------
// Env hot-reload (M6 — the config-hot-reload backlog item)
// ---------------------------------------------------------------------------

/** Stat-mtime gate for reloadEnvIfChanged (module state; one file watched). */
let envWatch: { path: string; mtimeMs: number | null } | null = null;

/** Hot-reload the state-root .env: PI_ and UNOWN_-prefixed keys only,
 *  applied to
 *  process.env when the file's mtime moved. Called by the automations
 *  scheduler every tick (20s), so tuning the misfire grace, catch-up
 *  policy, idle window, log cap or budget knobs lands WITHOUT an engine
 *  restart — routine EDITS were always hot (they live in the DB and every
 *  tick re-queries it); this covers the env lane, which `engine serve`
 *  otherwise loads exactly once at boot.
 *
 *  Semantics (documented in docs/routines.md §configuration):
 *   - only keys the FILE still defines are applied — a key REMOVED from .env
 *     keeps its last loaded value (its reset path is the code default after a
 *     restart); reloading is additive-diff, not a full env rebuild;
 *   - non-PI_/UNOWN_ keys are ignored (the engine never re-evaluates PATH or
 *     friends mid-flight);
 *   - the first call primes the mtime gate without side effects (cmdServe
 *     already applied the same file at boot). */
export function reloadEnvIfChanged(envPath?: string): { reloaded: boolean; applied: string[] } {
        // Test seam (the SPAWN_DISABLED pattern): the shared suite boots real
        // in-process engines whose scheduler ticks this reload on the DEFAULT
        // state-root path — in a checkout that is the REPO's own .env, and its
        // live values (PI_BRIDGE_URL, BRIDGE-model pins, …) hot-apply straight
        // over the test redirects in test/_env.ts (the dead-port bridge URL, the
        // temp UNOWN_HOME). Explicit-envPath callers (the hot-reload unit tests)
        // bypass the guard: they own their file. Production never sets the var.
        if (!envPath && process.env.PI_DISABLE_ENV_HOT_RELOAD === "1") {
                return { reloaded: false, applied: [] };
        }
        const path = envPath ?? join(supervisorStateRoot(), ".env");
        let mtimeMs: number | null;
        try {
                mtimeMs = statSync(path).mtimeMs;
        } catch {
                mtimeMs = null; // no .env — nothing to apply, remember we looked
        }
        if (envWatch && envWatch.path === path && envWatch.mtimeMs === mtimeMs) return { reloaded: false, applied: [] };
        const applied: string[] = [];
        if (mtimeMs !== null) {
                for (const [k, v] of Object.entries(loadEnvValues(path))) {
                        if (!k.startsWith("PI_") && !k.startsWith("UNOWN_")) continue;
                        // EMPTY VALUE = UNSPECIFIED (the repo `||` convention): the shipped
                        // .env carries optional knobs as bare `KEY=` lines, and an empty
                        // value must never clobber a live variable — the pre-fix reload
                        // wiped a shell-exported UNOWN_HOME (and, in tests, the _env.ts
                        // redirect) to "" whenever the scheduler ticked. Clearing a knob
                        // through this lane means deleting its line — and since the reload
                        // is additive-diff (documented above), absent keys never touch the
                        // process env either way; an empty line is exactly that: absent.
                        if (v === "") continue;
                        if (process.env[k] !== v) {
                                process.env[k] = v;
                                applied.push(k);
                        }
                }
        }
        envWatch = { path, mtimeMs };
        return { reloaded: true, applied };
}

/** In-process single-flight: concurrent callers share one spawn attempt. */
let spawnInFlight: Promise<SpawnDecision> | null = null;

/** The outcome of a spawn request — enough detail for the CLI to explain a
 *  refusal instead of printing "spawn failed" and looping. */
export interface SpawnDecision {
        spawned: boolean;
        reason: "spawned" | "already-up" | "blocked" | "gated" | "disabled" | "transition" | "spawn-failed";
        probe?: EngineProbe;
}

/** Test/CI guard: never spawn engine children from test processes (set by test/_env.ts). */
export const SPAWN_DISABLED = process.env.PI_DISABLE_ENGINE_SPAWN === "1";

/**
 * The win32 detach spawn, as DATA (pure - pinned by
 * test/windows-spawn-verbatim.test.ts). `cmd /c start /b` with the
 * SS64-correct shape: the empty string is the window-title slot, the
 * executable is QUOTE-WRAPPED, and the spawn MUST set
 * windowsVerbatimArguments - the argv is already quoted for `start`, and
 * Node/Bun's default Windows arg escaping would re-escape the embedded quotes
 * (`\"C:\...\unown.exe\"`). cmd.exe does not treat backslash as an escape, so
 * `start` reads the token `\C:\...\unown.exe\` and ShellExecute pops the
 * "Windows cannot find" dialog - the v0.0.16 binary-install bug (every engine
 * auto-start attempt on Windows popped it; stdioSpawnSpec in mcp.ts met the
 * same class first and its fix is the verbatim flag this builder carries).
 */
export interface WindowsEngineSpawnSpec {
        command: string;
        args: string[];
        verbatim: boolean;
}

export function buildWindowsEngineSpawnSpec(execPath: string, serveArgs: string[]): WindowsEngineSpawnSpec {
        return {
                command: "cmd",
                args: ["/c", "start", "/b", "", `"${execPath}"`, ...serveArgs],
                verbatim: true,
        };
}

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
export async function requestEngineSpawn(opts: { force?: boolean } = {}): Promise<SpawnDecision> {
        if (SPAWN_DISABLED) return { spawned: false, reason: "disabled" };
        if (autoStartDisabled() && !opts.force) return { spawned: false, reason: "disabled" };
        if (transitionInProgress()) return { spawned: false, reason: "transition" };
        if (spawnInFlight) return spawnInFlight;
        const probe = await probeEngine({ endpoint: engineUrl(), timeoutMs: 1500 });
        if (probe.kind === "ok") return { spawned: false, reason: "already-up", probe };
        if (probe.kind !== "refused") {
                writeSpawnState(recordSpawnBlocked(readSpawnState(), probe.kind));
                return { spawned: false, reason: "blocked", probe };
        }
        if (!opts.force) {
                const state = readSpawnState();
                const gate = evaluateSpawnGate(state);
                if (!gate.allowed) return { spawned: false, reason: "gated", probe };
                writeSpawnState(recordSpawnAttempt(state));
        } else {
                // Manual start: clean slate, then record the attempt like any other.
                markEngineHealthy();
                writeSpawnState(recordSpawnAttempt(readSpawnState()));
        }
        spawnInFlight = (async () => {
                try {
                        const spawned = await spawnEngineProcess();
                        return { spawned, reason: spawned ? "spawned" : "spawn-failed", probe } as SpawnDecision;
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

/** Boolean-compatible wrapper for the existing touchpoint call sites. */
export async function spawnEngineDetached(opts: { force?: boolean } = {}): Promise<boolean> {
        return (await requestEngineSpawn(opts)).spawned;
}

/** Launch the detached child (no gates — requestEngineSpawn owns those). */
async function spawnEngineProcess(): Promise<boolean> {
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
                        // M6: rotate the previous generation's log BEFORE opening the append
                        // fd — no writer holds the file yet, this is the clean rotation point.
                        rotateEngineLogIfNeeded();
                        const logFd = openSync(join(runDir(), "engine.log"), "a");
                        // The Windows detach escape hatch: Bun's detached:true child dies
                        // with the parent on win32 (oven-sh/bun#31603). `cmd /c start /b`
                        // launches into its own session that survives. The EMPTY STRING
                        // before the command is the window-title slot — without it, `start`
                        // consumes a quoted executable path (spaces: "C:\Program Files\…")
                        // as the title and runs the wrong command (SS64-documented trap).
                        // The executable itself is QUOTE-WRAPPED too — the SS64-correct
                        // `start "" "C:\path with spaces\exe"` form: an unquoted path
                        // splits at its first space and `start` would run the wrong
                        // command. (js/shell-command-injection-from-environment: the
                        // quote-wrap is also what keeps the uncontrolled execPath inert.)
                        // Defense in depth before that branch: execPath is a plain
                        // filesystem path, so a `"` (or any cmd metacharacter) would
                        // break out of the quoting — it never legitimately contains one,
                        // so refuse loudly instead of spawning. POSIX spawns an argv
                        // array and is unaffected.
                        if (process.platform === "win32" && /[&|<>^"%]/.test(command)) {
                                throw new Error(
                                        `refusing to spawn engine: executable path contains cmd.exe metacharacters: ${command}`,
                                );
                        }
                        if (process.platform === "win32") {
                                const spec = buildWindowsEngineSpawnSpec(command, args);
                                const child = spawn(spec.command, spec.args, {
                                        cwd: state,
                                        env,
                                        windowsHide: true,
                                        windowsVerbatimArguments: spec.verbatim,
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
        } catch (err) {
                // The old silent catch made an occupied port, a bad execPath and
                // a missing log dir indistinguishable. Keep the boolean contract
                // but allow an opt-in diagnostic line (the CLI still owns the
                // user-facing cause via the probe taxonomy).
                if (process.env.UNOWN_DEBUG_SPAWN === "1") {
                        console.error("[engine-supervisor] spawn failed:", err);
                }
                return false;
        }
}

/**
 * The touchpoint hook: ping once; if the engine is down, spawn it detached
 * and (optionally) poll health with jittered backoff. Non-blocking callers
 * pass waitMs=0 — the outbox covers durability, the spawn covers liveness.
 */
export async function ensureEngineRunning(
        waitMs = 0,
        opts: { skipSpawn?: boolean } = {},
): Promise<{ spawned: boolean; up: boolean; pid?: number; kind?: EngineProbeKind }> {
        const first = await probeEngine({ endpoint: engineUrl(), timeoutMs: 1500 });
        if (first.kind === "ok") {
                markEngineHealthy(); // observed healthy → reset the crash-loop circuit (M6)
                return { spawned: false, up: true, pid: first.body?.pid, kind: "ok" };
        }
        // A foreign engine, an occupied port, an incompatible build or a hung
        // port is not a reason to spawn — and polling will not heal it.
        if (first.kind !== "refused" && first.kind !== "unreachable") {
                return { spawned: false, up: false, kind: first.kind };
        }
        const spawned = opts.skipSpawn || first.kind !== "refused" ? false : await spawnEngineDetached();
        // A gated spawn (M6 backoff / gave-up / kill switch) must NOT skip the
        // WAIT: the caller may have JUST kicked a spawn itself (`engine start`'s
        // force path records an attempt, and this function's own un-forced call
        // would hit the fresh 2s backoff gate and used to early-return without
        // ever polling — caught live by the E2E lane: engine healthy at t+2s,
        // cmdStart reporting "not healthy after 20s").
        if (waitMs <= 0) return { spawned, up: false, kind: first.kind };
        // jittered backoff poll (250ms · 2^n ± 20%) bounded by waitMs
        let delay = 250;
        const deadline = Date.now() + waitMs;
        for (;;) {
                const jitter = delay * (0.8 + Math.random() * 0.4);
                await new Promise((r) => setTimeout(r, jitter));
                const probe = await probeEngine({ endpoint: engineUrl(), timeoutMs: 1500 });
                if (probe.kind === "ok") {
                        markEngineHealthy();
                        return { spawned, up: true, pid: probe.body?.pid, kind: "ok" };
                }
                if (probe.kind !== "refused" && probe.kind !== "unreachable") {
                        return { spawned, up: false, kind: probe.kind };
                }
                if (Date.now() >= deadline) return { spawned, up: false, kind: probe.kind };
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
