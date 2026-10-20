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

/** Cheap liveness probe: is the engine answering HTTP right now? */
export async function engineHealth(timeoutMs = 1500): Promise<{ up: boolean; pid?: number; busyMs?: number; activeJob?: string }> {
        try {
                const res = await fetch(`${engineUrl()}/api/overview`, { signal: AbortSignal.timeout(timeoutMs) });
                if (!res.ok) return { up: false };
                const body: any = await res.json();
                return { up: true, pid: body?.pid, busyMs: body?.router?.busyMs, activeJob: body?.router?.activeJob };
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
 */
export function spawnEngineDetached(): Promise<boolean> {
        if (SPAWN_DISABLED) return Promise.resolve(false);
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
export async function ensureEngineRunning(waitMs = 0): Promise<{ spawned: boolean; up: boolean; pid?: number }> {
        const first = await engineHealth();
        if (first.up) return { spawned: false, up: true, pid: first.pid };
        const spawned = await spawnEngineDetached();
        if (!spawned || waitMs <= 0) return { spawned, up: false };
        // jittered backoff poll (250ms · 2^n ± 20%) bounded by waitMs
        let delay = 250;
        const deadline = Date.now() + waitMs;
        for (;;) {
                const jitter = delay * (0.8 + Math.random() * 0.4);
                await new Promise((r) => setTimeout(r, jitter));
                const probe = await engineHealth();
                if (probe.up) return { spawned: true, up: true, pid: probe.pid };
                if (Date.now() >= deadline) return { spawned: true, up: false };
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
