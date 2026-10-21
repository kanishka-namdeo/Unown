/**
 * engine-status.ts — agent-side engine health awareness (M6).
 *
 * THE PROBLEM (docs/resilience.md, M6 recon): after the M2 detachment the
 * terminal agent works perfectly with the engine down — memory reads are
 * pure disk, notes fall back to the outbox — which is exactly why engine
 * death was INVISIBLE: liveness was only ever learned at note-delivery
 * moments, and nothing in the TUI ever showed engine state.
 *
 * THE DESIGN (research: vim-airline/k9s persistent status rows, Claude Code
 * statusline, k8s liveness-vs-readiness, circuit-breaker half-open):
 *
 *   footer (always, one line, changes only on STATE change — never churns):
 *     memory: up
 *     memory: up · old build       (M8 version-skew suffixes: same version
 *     memory: up · stale (v2.1.0)   but different sha / older version /
 *                                   booted before the current build)
 *     memory: starting…            (a spawn was kicked, not healthy yet)
 *     memory: down · N queued      (N = outbox backlog, hidden when 0)
 *     memory: paused · /engine     (crash-loop circuit gave up)
 *     memory: --                   (first probe still in flight)
 *
 *   toasts (ONE per state TRANSITION, never at session start — deliberate
 *   engine-off users are not nagged on every boot):
 *     up→down   "memory engine unreachable — chat unaffected, notes queue locally"
 *     →up       "memory engine online — learning resumed" (+ draining N)
 *     →paused   "memory engine won't start (N attempts) — run `unown engine status`"
 *     fresh→    (M8: ONE toast when a mid-session probe first sees the engine
 *     stale      as an older build — e.g. the agent updated underneath it)
 *               "memory engine is an older build (vX, booted Yd Zh ago) —
 *                run `unown engine restart`; chat unaffected"
 *
 *   lifecycle: started at session_start, stopped at session_shutdown
 *   (extensions.md rule: no timers in the factory). The probe is a plain
 *   unref'd interval; probes are async and NEVER block input rendering.
 *
 * SPAWNING: the loop also keeps the engine alive (design rule 5, the Ollama
 * pattern) — on a down probe it kicks spawnEngineDetached(), whose M6 gates
 * (backoff / gave-up / UNOWN_ENGINE_AUTOSTART=0 / test guard) decide whether
 * a child actually launches. After a spawn kick, short fast re-probes
 * (2s→5s→9s→16s) flip the footer as soon as the engine boots (~7s observed)
 * instead of waiting a full interval.
 *
 * PURE module: no pi imports, no store import (detachment contract — pinned
 * by test/detachment.test.ts), no engine imports. UI effects are injected
 * hooks, which makes the whole state machine unit-testable headlessly.
 */
import {
        engineHealth,
        evaluateSpawnGate,
        markEngineHealthy,
        readSpawnState,
        spawnEngineDetached,
        SPAWN_DISABLED,
        autoStartDisabled,
        type SpawnState,
} from "./engine-supervisor.ts";
import {
        agentGitSha,
        agentVersion,
        codeMtimeMs,
        compareEngineBuild,
        formatDuration,
        type EngineBuildComparison,
        type EngineBuildRef,
} from "./engine-version.ts";
import { outboxStats } from "./term.ts";

export type EngineState = "unknown" | "up" | "starting" | "down" | "paused";

export interface EngineStatusInfo {
        state: EngineState;
        /** Epoch ms of the last state transition. */
        since: number;
        /** Epoch ms of the last completed probe (any outcome). */
        lastProbeAt: number;
        pid?: number;
        busyMs?: number;
        activeJob?: string;
        queuedNotes: number;
        droppedNotes: number;
        /** The supervisor's crash-loop circuit, for /engine + doctor diagnosis. */
        spawn: SpawnState;
        /** M8: the engine's reported build (the /api/overview version block) —
         *  present only when an up probe observed one (pre-M8 engines answer
         *  up without it, and a down probe has nothing to report). */
        engineVersion?: EngineBuildRef;
        /** M8: the version-skew verdict of the last up probe (fresh /
         *  old-build / stale / ancient / ahead / unknown) — drives the footer
         *  suffix, the fresh→stale toast and /engine's build line. */
        buildVerdict?: EngineBuildComparison;
}

/** Probe cadence: 30s default, floor 5s (env-tunable for tests + demos). */
function probeIntervalMs(): number {
        const n = Number(process.env.PI_ENGINE_PROBE_INTERVAL_MS ?? "");
        return Number.isFinite(n) && n >= 5_000 ? Math.floor(n) : 30_000;
}

/** Probe timeout: well under the 1s interactive-perception budget; loopback
 * refusal is instant, so this only bites a hanging port — in the background. */
function probeTimeoutMs(): number {
        const n = Number(process.env.PI_ENGINE_PROBE_TIMEOUT_MS ?? "");
        return Number.isFinite(n) && n >= 100 ? Math.floor(n) : 700;
}

/** The footer line for a state (undefined = nothing worth a line — never
 * happens today, kept for parity with the mcp footer's "all fine, nothing
 * to say" escape).
 *
 * M8: the up state carries a build suffix when the engine is an older build
 * than the agent — the version-skew handshake made visible on the one line
 * that is always on screen. `ahead` (engine newer) gets NO suffix: the fix
 * is on the agent side (`unown update`) and the footer is the engine's lane. */
export function engineFooterText(info: EngineStatusInfo): string {
        switch (info.state) {
                case "up": {
                        const v = info.buildVerdict?.verdict;
                        if (v === "old-build") return "memory: up · old build";
                        if (v === "stale") return `memory: up · stale (v${info.engineVersion?.version ?? "?"})`;
                        if (v === "ancient") return `memory: up · very stale (v${info.engineVersion?.version ?? "?"})`;
                        return "memory: up";
                }
                case "starting":
                        return "memory: starting…";
                case "down":
                        return info.queuedNotes > 0 ? `memory: down · ${info.queuedNotes} queued` : "memory: down";
                case "paused":
                        return "memory: paused · /engine";
                default:
                        return "memory: --";
        }
}

/** Toast text for a transition (undefined = no toast). */
export function engineToastText(prev: EngineState, next: EngineState, queued: number): { message: string; level: "info" | "warning" } | undefined {
        if (prev === next || next === "unknown" || prev === "unknown") return undefined;
        if (next === "paused")
                return {
                        message: "memory engine won't start (repeated failures) — run `unown engine status`; chat unaffected, notes keep queuing locally",
                        level: "warning",
                };
        if (next === "down")
                return {
                        message: "memory engine unreachable — chat unaffected, notes queue locally",
                        level: "warning",
                };
        if (next === "up") {
                const draining = prev !== "starting" && queued > 0 ? ` — draining ${queued} queued note(s)` : "";
                return { message: `memory engine online — learning resumed${draining}`, level: "info" };
        }
        return undefined;
}

/**
 * M8: the version-skew toast — ONE per fresh→stale transition, never at
 * session start (the same fact-not-event rule as the state toasts: a
 * session that begins against a stale engine shows it quietly on the
 * footer). Info level, not a warning: the engine being an older build is
 * not a degradation of anything the user is doing right now — memory reads
 * and notes still work — it just means new learning runs on the old build
 * until `unown engine restart`. Pure so the copy is pinnable.
 */
export function engineBuildToastText(
        engine: EngineBuildRef | undefined,
        now: number = Date.now(),
): { message: string; level: "info" | "warning" } {
        const v = engine?.version ?? "unknown";
        const age = engine?.bootedAt ? formatDuration(Math.max(0, now - engine.bootedAt)) : "unknown";
        return {
                message: `memory engine is an older build (v${v}, booted ${age} ago) — run \`unown engine restart\`; chat unaffected`,
                level: "info",
        };
}

export interface EngineStatusHooks {
        /** Footer line setter (ctx.ui.setStatus("engine", text) — guarded by caller). */
        onFooter?: (text: string | undefined) => void;
        /** Toast (ctx.ui.notify — guarded by caller). */
        onToast?: (message: string, level: "info" | "warning") => void;
        /** Injectable probe (tests); defaults to engineHealth with the short timeout. */
        probe?: () => Promise<{ up: boolean; pid?: number; busyMs?: number; activeJob?: string; version?: EngineBuildRef }>;
        /** Injectable spawn kick (tests); defaults to the real gated supervisor call. */
        kickSpawn?: () => Promise<boolean>;
}

export interface EngineStatusLoop {
        stop(): void;
        info(): EngineStatusInfo;
        /** Force an immediate probe (used by /engine for a fresh answer). */
        probeNow(): Promise<EngineStatusInfo>;
}

// ---------------------------------------------------------------------------
// Process-wide singleton (the terminal extension owns start/stop; tools.ts
// and cli surfaces read getEngineStatusInfo() for their reports).
// ---------------------------------------------------------------------------

let loop: EngineStatusLoop | null = null;

/** Latest known engine status for /engine, /learning and doctor (never probes). */
export function getEngineStatusInfo(): EngineStatusInfo {
        if (loop) return loop.info();
        // No loop (print mode, CLI subcommands, tests): report from a cheap
        // file-only snapshot — outbox counts + the spawn circuit, state unknown.
        return snapshotOf("unknown");
}

function snapshotOf(state: EngineState, extra?: Partial<EngineStatusInfo>): EngineStatusInfo {
        const stats = outboxStats();
        return {
                state,
                since: extra?.since ?? Date.now(),
                lastProbeAt: extra?.lastProbeAt ?? 0,
                pid: extra?.pid,
                busyMs: extra?.busyMs,
                activeJob: extra?.activeJob,
                queuedNotes: stats.queued,
                droppedNotes: stats.dropped,
                spawn: readSpawnState(),
                engineVersion: extra?.engineVersion,
                buildVerdict: extra?.buildVerdict,
        };
}

/**
 * Start (or reuse) the status loop. Called at session_start; must be paired
 * with stopEngineStatusLoop() at session_shutdown(reason=quit). Restarting on
 * /new is a no-op (the loop survives session reloads on purpose — the engine
 * cares about the PROCESS, not the session branch).
 */
export function startEngineStatusLoop(hooks: EngineStatusHooks = {}): EngineStatusLoop {
        if (loop) return loop;

        let state: EngineState = "unknown";
        let since = Date.now();
        let lastProbeAt = 0;
        let detail: { pid?: number; busyMs?: number; activeJob?: string } = {};
        // M8: the last up-probe's version handshake — engine block + verdict.
        // Cleared on a down probe (a stale verdict about an engine we cannot
        // reach would be a lie on the footer).
        let build: { engineVersion?: EngineBuildRef; buildVerdict?: EngineBuildComparison } = {};
        // M8: the verdict the PREVIOUS up probe observed — the fresh→stale
        // toast fires only on the transition, exactly once (undefined at
        // session start ⇒ a session that begins stale stays quiet).
        let lastBuildVerdict: ReturnType<typeof compareEngineBuild>["verdict"] | undefined;
        let timer: ReturnType<typeof setInterval> | null = null;
        // Fast re-probes after a spawn kick: 2s, 5s, 9s, 16s (bounded 4 tries).
        let fastProbeTimers: Array<ReturnType<typeof setTimeout>> = [];
        const probe =
                hooks.probe ??
                (() =>
                        engineHealth(probeTimeoutMs()).then((h) => ({
                                up: h.up,
                                pid: h.pid,
                                busyMs: h.busyMs,
                                activeJob: h.activeJob,
                                version: h.version,
                        })));
        const kickSpawn = hooks.kickSpawn ?? (() => spawnEngineDetached());

        const publish = (next: EngineState, forceToast = false) => {
                const prev = state;
                if (prev !== next) since = Date.now();
                state = next;
                lastProbeAt = Date.now();
                if (hooks.onFooter) hooks.onFooter(engineFooterText(info()));
                if (prev !== next || forceToast) {
                        const toast = engineToastText(prev, next, outboxStats().queued);
                        if (toast && prev !== "unknown") hooks.onToast?.(toast.message, toast.level);
                        // prev === "unknown" (session start): footer appears silently — the
                        // initial state is a fact, not an event (deliberate engine-off users
                        // must not be greeted by a warning on every boot).
                }
        };

        const info = (): EngineStatusInfo => snapshotOf(state, { since, lastProbeAt, ...detail, ...build });

        /** M8: the version handshake of an up probe — classify the engine's
         *  build against ours, publish it, and fire the one-per-transition
         *  stale toast. The agent's sha is resolved lazily ONCE (a git spawn)
         *  and cached by engine-version.ts; codeMtimeMs is a statSync. */
        const publishBuild = (engineVersion: EngineBuildRef | undefined) => {
                const cmp = compareEngineBuild(
                        { version: agentVersion(), gitSha: agentGitSha(), codeMtimeMs: codeMtimeMs() },
                        engineVersion,
                        Date.now(),
                );
                build = { engineVersion, buildVerdict: cmp }; // engineVersion absent on pre-M8 engines — the verdict says "unknown"
                const staleish = cmp.verdict === "old-build" || cmp.verdict === "stale" || cmp.verdict === "ancient";
                if (staleish && lastBuildVerdict === "fresh") {
                        const toast = engineBuildToastText(engineVersion);
                        hooks.onToast?.(toast.message, toast.level);
                }
                lastBuildVerdict = cmp.verdict;
        };

        const runProbe = async (): Promise<EngineStatusInfo> => {
                try {
                        const h = await probe();
                        if (h.up) {
                                detail = { pid: h.pid, busyMs: h.busyMs, activeJob: h.activeJob };
                                publishBuild(h.version); // before publish(): the footer render reads it
                                markEngineHealthy(); // observed healthy → reset the crash-loop circuit
                                publish("up");
                                return info();
                        }
                } catch {
                        /* probe errors are simply "down" — engineHealth never throws, but a
                         * custom probe might; never let the loop die. */
                }
                detail = {};
                build = {};
                // Down. Paused wins when the crash-loop circuit gave up; otherwise kick
                // a (gated) auto-start and expect it up shortly.
                const circuit = readSpawnState();
                if (circuit.gaveUp) {
                        publish("paused");
                        return info();
                }
                let kicked = false;
                if (!SPAWN_DISABLED && !autoStartDisabled()) kicked = await kickSpawn().catch(() => false);
                publish(kicked ? "starting" : "down");
                if (kicked) scheduleFastReprobes();
                return info();
        };

        const scheduleFastReprobes = () => {
                for (const delay of [2_000, 5_000, 9_000, 16_000]) {
                        fastProbeTimers.push(
                                setTimeout(() => {
                                        void runProbe();
                                }, delay).unref?.(),
                        );
                }
        };

        const stop = () => {
                if (timer) clearInterval(timer);
                timer = null;
                for (const t of fastProbeTimers) clearTimeout(t);
                fastProbeTimers = [];
                loop = null;
        };

        timer = setInterval(() => {
                void runProbe();
        }, probeIntervalMs());
        timer.unref?.();
        void runProbe(); // first answer within ~1s of session start

        loop = {
                stop,
                info,
                probeNow: () => runProbe(),
        };
        return loop;
}

/** Stop the loop if running (session_shutdown reason=quit). */
export function stopEngineStatusLoop() {
        loop?.stop();
        loop = null;
}

/** Is a recent probe confidently down? (fast-path hint for note delivery —
 * the shutdown handler passes it as assumeDown so an engine-down quit never
 * pays the probe+POST round trips, even against a hanging port.) */
export function engineAssumedDown(): boolean {
        if (!loop) return false;
        const info = loop.info();
        if (info.state !== "down" && info.state !== "paused") return false;
        // Trust the snapshot only while fresh: 2x interval (or 60s floor) since
        // the last probe; after that a delivery should re-probe for itself.
        const maxAge = Math.max(60_000, 2 * probeIntervalMs());
        return Date.now() - info.lastProbeAt < maxAge;
}

/** Human summary of the supervisor's crash-loop circuit, for /engine + CLI. */
export function describeSpawnCircuit(state: SpawnState): string {
        if (state.gaveUp)
                return `gave up after ${state.attempts} failed start(s) — run \`unown engine start\` (resets the circuit), and check .run/engine.log; if the DB is corrupt: \`unown engine repair\``;
        const gate = evaluateSpawnGate(state);
        if (gate.reason === "backoff")
                return `backing off — attempt ${state.attempts}, next auto-start in ${Math.ceil((gate.retryInMs ?? 0) / 1000)}s (auto-start works, just spaced out)`;
        if (state.attempts === 0) return "idle — no failed starts recorded";
        return `${state.attempts} recent attempt(s) recorded, auto-start allowed`;
}
