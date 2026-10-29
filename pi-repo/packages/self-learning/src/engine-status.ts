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
 *     memory: up · auto-dream 4m   (M11 activity suffix: the job holding the
 *                                   router mutex + whole-minute elapsed — see
 *                                   engineBusySuffix for the churn rule)
 *     memory: up · old build       (M8 version-skew suffixes: same version
 *     memory: up · stale (v2.1.0)   but different sha / older version /
 *                                   booted before the current build — these
 *                                   WIN over the activity suffix)
 *     memory: starting…            (a spawn was kicked, not healthy yet)
 *     memory: down · N queued      (N = outbox backlog, hidden when 0)
 *     memory: paused · /engine     (crash-loop circuit gave up)
 *     memory: --                   (first probe still in flight)
 *
 *   M3 memory bar (the delight segment): a clean `memory: up` line in a
 *   project that HAS a memory file gains a one-segment summary of what the
 *   engine learned here —
 *     memory: up · mem ▕█░░▏ v17 · 4 rules · dreamed 12m ago
 *   computed from the project's own files (.unown/memory/project.md + the
 *   M10 provenance sidecar), refreshed at probe cadence (30s), never per
 *   keystroke. Precedence is deliberately the BOTTOM of the ladder: warning
 *   lines (down/paused/starting) and standing-condition suffixes (old build /
 *   stale) stay undiluted — the bar only rides the line that says "everything
 *   is healthy", the only state in which the full story it tells (engine
 *   learning, memory fresh) is true end-to-end.
 *
 *   M3 dream-news toast: when a probe sees the engine's dreamNews block (a
 *   project dream that ADDED memories within the last hour, for THIS
 *   project), the session toasts ONCE per new dream — "✦ AutoDream learned 3 new
 *   rules for this project (v17 → v18)". Unlike the state toasts this fires
 *   at session start too, on purpose: learning that happened while the user
 *   was away is an EVENT, not a standing condition — the confirmation moment
 *   lands in the next session (see shouldToastDreamNews for the zero-spam
 *   rules; the last-seen dream id is an in-memory Map inside the loop, so
 *   the latch is once per new dream per session, never persisted).
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

import { readFileSync } from "node:fs";
import { type EngineProbe, type EngineProbeKind, probeEngine } from "./engine-probe.ts";
import {
        autoStartDisabled,
        type DreamNews,
        evaluateSpawnGate,
        markEngineHealthy,
        parseDreamNews,
        readSpawnState,
        SPAWN_DISABLED,
        type SpawnState,
        spawnEngineDetached,
} from "./engine-supervisor.ts";
import {
        agentGitSha,
        agentVersion,
        codeMtimeMs,
        compareEngineBuild,
        type EngineBuildComparison,
        type EngineBuildRef,
        formatDuration,
} from "./engine-version.ts";
import { ENGINE_URL, outboxStats, projectMemoryPath, readProjectProvenance, slugifyPath } from "./term.ts";

export type EngineState = "unknown" | "up" | "starting" | "down" | "paused" | "blocked";

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
        /** H1 (2026-10-26): notes dead-lettered to notes/dead/ after exhausting ingest attempts. */
        deadNotes: number;
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
        /** The last probe's taxonomy when it was not "ok" — why the engine is
         *  blocked (token/port/version/no answer) and who owns it. */
        probe?: EngineProbe;
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

/**
 * M11: the activity suffix — which job holds the router mutex and for how long.
 *
 * The engine has answered `router.activeJob` + `router.busyMs` since M6 and
 * `/engine` has printed them (termhooks.ts), but the ONE line that is always on
 * screen threw both away: a session running next to an hour-long harness cycle
 * read exactly like an idle engine, which is how "is it learning, or is it
 * stuck" became a question with no visible answer.
 *
 * The elapsed is bucketed to WHOLE MINUTES on purpose. This module's footer
 * contract is "changes only on a state change — never churns", and the probe
 * cadence is 30s, so a seconds-granularity value would rewrite the line twice a
 * minute for no information anyone acts on. A job under a minute old shows no
 * elapsed at all: the fact that a job started is already the news.
 *
 * `activeJob` is the idle test ('' = idle, the router's own contract), NOT
 * busyMs: a job that started 200 ms ago rounds its elapsed to 0, and hiding the
 * first minute of every job would hide exactly the moment a user decides
 * whether to wait. A missing/negative/NaN busyMs degrades to job-name-only.
 */
function engineBusySuffix(info: EngineStatusInfo): string {
        if (!info.activeJob) return "";
        const ms = info.busyMs ?? 0;
        const mins = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 60_000) : 0;
        if (mins <= 0) return ` · ${info.activeJob}`;
        if (mins < 60) return ` · ${info.activeJob} ${mins}m`;
        return ` · ${info.activeJob} ${Math.floor(mins / 60)}h${mins % 60}m`;
}

/** The footer line for a state (undefined = nothing worth a line — never
 * happens today, kept for parity with the mcp footer's "all fine, nothing
 * to say" escape).
 *
 * M8: the up state carries a build suffix when the engine is an older build
 * than the agent — the version-skew handshake made visible on the one line
 * that is always on screen. `ahead` (engine newer) gets NO suffix: the fix
 * is on the agent side (`unown update`) and the footer is the engine's lane.
 *
 * M11 precedence: the build suffix WINS over the activity suffix. A stale
 * build is a standing condition the user must act on and the footer is its only
 * notice; job activity is transient and is printed in full by `/engine`, the
 * dashboard router screen and `unown engine status`.
 *
 * M3 precedence, continued: the memory bar is the BOTTOM of the same ladder
 * (see the module header). It rides only the undecorated `memory: up…` line
 * and nothing else — a warning line with a delight meter bolted on would
 * undercut both halves. */
export function engineFooterText(info: EngineStatusInfo, memoryBar?: string): string {
        switch (info.state) {
                case "up": {
                        const v = info.buildVerdict?.verdict;
                        if (v === "old-build") return "memory: up · old build";
                        if (v === "stale") return `memory: up · stale (v${info.engineVersion?.version ?? "?"})`;
                        if (v === "ancient") return `memory: up · very stale (v${info.engineVersion?.version ?? "?"})`;
                        return `memory: up${engineBusySuffix(info)}${memoryBar ? ` · ${memoryBar}` : ""}`;
                }
                case "starting":
                        return "memory: starting…";
                case "down":
                        return info.queuedNotes > 0 ? `memory: down · ${info.queuedNotes} queued` : "memory: down";
                case "paused":
                        return "memory: paused · /engine";
                case "blocked": {
                        const kind = info.probe?.kind;
                        const label =
                                kind === "unauthorized"
                                        ? "token"
                                        : kind === "occupied"
                                                ? "port"
                                                : kind === "incompatible"
                                                        ? "version"
                                                        : "no answer";
                        return `memory: blocked · ${label}`;
                }
                default:
                        return "memory: --";
        }
}

/** Toast text for a transition (undefined = no toast). */
export function engineToastText(
        prev: EngineState,
        next: EngineState,
        queued: number,
        probe?: EngineProbe,
): { message: string; level: "info" | "warning" } | undefined {
        if (prev === next || next === "unknown" || prev === "unknown") return undefined;
        if (next === "blocked") {
                const owner = probe?.owner?.pid ? ` (pid ${probe.owner.pid})` : "";
                const why =
                        probe?.kind === "unauthorized"
                                ? "another install's engine owns the port"
                                : probe?.kind === "occupied"
                                        ? "the port is held by another process"
                                        : probe?.kind === "incompatible"
                                                ? "the engine build is incompatible"
                                                : "the engine is not answering";
                return {
                        message: `memory engine blocked — ${why}${owner}; run \`unown engine status\`; chat unaffected`,
                        level: "warning",
                };
        }
        if (next === "paused")
                return {
                        message:
                                "memory engine won't start (repeated failures) — run `unown engine status`; chat unaffected, notes keep queuing locally",
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

// ---------------------------------------------------------------------------
// M3: the memory bar — what the engine learned in THIS project, from disk
// ---------------------------------------------------------------------------

/** The disk-derived facts behind the footer's delight segment. */
export interface MemoryBarInfo {
        /** Provenance sidecar version; 0 when the sidecar is absent (never dreamed). */
        version: number;
        /** "- " bullets under "## " sections in project.md. */
        rules: number;
        /** Provenance `at` (epoch ms); undefined when the sidecar is absent. */
        dreamedAt?: number;
}

/** Count the bullet rules under "## " sections — the project-memory render's
 *  own grammar (every rendered rule is a `- ` line inside a section; the
 *  document title is an `# ` and prose lives outside sections). Bullets
 *  before the first section don't count: no render shape produces them, and
 *  a hand-written preamble is not the engine's learning. */
export function countProjectRules(content: string): number {
        let inSection = false;
        let n = 0;
        for (const line of content.split(/\r?\n/)) {
                if (/^##\s/.test(line)) {
                        inSection = true;
                        continue;
                }
                if (inSection && /^- /.test(line)) n++;
        }
        return n;
}

/** Humanize a dreamed age the way engineBusySuffix humanizes job elapsed —
 *  whole-minute buckets ("just now" / "12m ago" / "3h ago" / "2d ago"), so
 *  the footer line's content changes at most once per minute during the
 *  first hour, then once per hour, then once per day: the churn rate this
 *  contract already accepts for the activity suffix, never the twice-a-
 *  minute seconds granularity it forbids. */
export function humanizeDreamAge(ageMs: number): string {
        const s = Math.max(0, Math.floor(ageMs / 1000));
        if (s < 60) return "just now";
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
}

/** The one-line bar: `mem ▕█░░▏ v17 · 4 rules · dreamed 12m ago`.
 *
 *  The 4-cell meter is pi's own context-meter visual language (█ fill, ░
 *  empty, ▕▏ thin end-caps — see coding-agent footer.ts renderContextMeter):
 *  two meters on the same screen must read as one chrome family, not as two
 *  inventions. Fill = min(rules, 16)/16 — bounded and deterministic (a
 *  400-rule project pins the meter full rather than overflowing it; the
 *  honest count rides next to it in plain digits). */
export function formatMemoryBar(info: MemoryBarInfo, now: number = Date.now()): string {
        const cells = 4;
        const clampedRules = Math.min(Math.max(info.rules, 0), 16);
        const filled = Math.max(0, Math.min(cells, Math.round((clampedRules / 16) * cells)));
        const bar = "█".repeat(filled) + "░".repeat(cells - filled);
        const dreamed = info.dreamedAt !== undefined ? ` · dreamed ${humanizeDreamAge(now - info.dreamedAt)}` : "";
        return `mem ▕${bar}▏ v${info.version} · ${info.rules} rule${info.rules === 1 ? "" : "s"}${dreamed}`;
}

/** Read the bar's facts from the project's own files. null = no project
 *  memory file (or unreadable) — the caller keeps the plain engine text,
 *  which is exactly the pre-M3 footer. A missing sidecar is NOT null: the
 *  memory file exists, it just was never dreamed (v0, no dreamed segment). */
export function readMemoryBarInfo(projectDir: string): MemoryBarInfo | null {
        try {
                const content = readFileSync(projectMemoryPath(projectDir), "utf8");
                const provenance = readProjectProvenance(projectDir);
                return {
                        version: provenance?.version ?? 0,
                        rules: countProjectRules(content),
                        dreamedAt: provenance?.at,
                };
        } catch {
                return null;
        }
}

// ---------------------------------------------------------------------------
// M3: dream news — the "AutoDream learned N new rules" confirmation toast
// ---------------------------------------------------------------------------

/** The shape the engine's /api/overview dreamNews block parses into —
 *  re-exported here so the loop's consumers (tests, /engine) import it from
 *  the module that decides on it. */
export type { DreamNews };

/** A dream older than this is no longer news — this lane is for "learning
 *  just happened while you were away", not history. One hour: long enough to
 *  cover the next-morning session after an evening run, short enough that a
 *  week-old dream never interrupts anyone. */
export const DREAM_NEWS_MAX_AGE_MS = 3_600_000;

/** The zero-spam decision (pure, pinned by tests):
 *   - only THIS project's dreams (another project's learning is not ours to
 *     interrupt with — the footer bar already narrates this project);
 *   - only dreams that ADDED memories (added=0 is an honest no-change; the
 *     engine-side query filters this too, but the terminal re-checks — the
 *     probe response is advisory input, never trusted authority);
 *   - only UNSEEN dreams (id differs from the last-seen one for this
 *     project — the once-per-new-dream latch, held in the loop's in-memory
 *     Map for exactly this session's lifetime);
 *   - only fresh ones (≤ DREAM_NEWS_MAX_AGE_MS old) — stale news is no news. */
export function shouldToastDreamNews(
        seen: Map<string, string> | null | undefined,
        news: DreamNews | null | undefined,
        projectSlug: string | undefined,
        now: number = Date.now(),
): boolean {
        if (!news || !projectSlug) return false;
        if (news.project !== projectSlug) return false;
        if (!(news.added > 0)) return false;
        if (news.id === seen?.get(projectSlug)) return false;
        if (!(now - news.at <= DREAM_NEWS_MAX_AGE_MS)) return false;
        return true;
}

/** The toast copy — the confirmation moment. The version pair is honest:
 *  project dreams allocate MAX(version)+1, so `from` is always `to - 1`
 *  (v0 → v1 on the first mint says "there was no prior version"). */
export function dreamNewsToastText(news: DreamNews): string {
        const rules = `${news.added} new rule${news.added === 1 ? "" : "s"}`;
        return `✦ AutoDream learned ${rules} for this project (v${Math.max(0, news.version - 1)} → v${news.version})`;
}

export interface EngineStatusHooks {
        /** Footer line setter (ctx.ui.setStatus("engine", text) — guarded by caller). */
        onFooter?: (text: string | undefined) => void;
        /** Toast (ctx.ui.notify — guarded by caller). */
        onToast?: (message: string, level: "info" | "warning") => void;
        /** The observability round's learning feed: fired at the same
         * once-per-new-dream gate as the toast, with the toast's text — the
         * feed records what the toast celebrated. */
        onDreamNews?: (text: string) => void;
        /** The observability round's learning feed: fired when the project's
         * memory version advances between probe-cadence reads (a dream or a
         * reconcile re-rendered the tier file). (from, to) — from is the
         * previous read's version, not necessarily to-1. */
        onMemoryVersion?: (from: number, to: number) => void;
        /** M3: the terminal session's project dir — drives the memory-bar
         *  segment (files read at probe cadence) and the dream-news project
         *  filter (slugified the same way the engine groups notes). */
        projectDir?: string;
        /** Injectable probe (tests); defaults to the taxonomy probe with the short timeout. */
        probe?: () => Promise<{
                up: boolean;
                pid?: number;
                busyMs?: number;
                activeJob?: string;
                version?: EngineBuildRef;
                dreamNews?: DreamNews;
                kind?: EngineProbeKind;
                probe?: EngineProbe;
        }>;
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
        const snap: EngineStatusInfo = {
                state,
                since: extra?.since ?? Date.now(),
                lastProbeAt: extra?.lastProbeAt ?? 0,
                pid: extra?.pid,
                busyMs: extra?.busyMs,
                activeJob: extra?.activeJob,
                queuedNotes: stats.queued,
                droppedNotes: stats.dropped,
                deadNotes: stats.dead,
                spawn: readSpawnState(),
                engineVersion: extra?.engineVersion,
                buildVerdict: extra?.buildVerdict,
        };
        if (extra?.probe) snap.probe = extra.probe;
        return snap;
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
        let detail: { pid?: number; busyMs?: number; activeJob?: string; probe?: EngineProbe } = {};
        // M8: the last up-probe's version handshake — engine block + verdict.
        // Cleared on a down probe (a stale verdict about an engine we cannot
        // reach would be a lie on the footer).
        let build: { engineVersion?: EngineBuildRef; buildVerdict?: EngineBuildComparison } = {};
        // M8: the verdict the PREVIOUS up probe observed — the fresh→stale
        // toast fires only on the transition, exactly once (undefined at
        // session start ⇒ a session that begins stale stays quiet).
        let lastBuildVerdict: ReturnType<typeof compareEngineBuild>["verdict"] | undefined;
        // M3: the memory-bar segment — recomputed at PROBE cadence from the
        // project's own files (two small reads), never per keystroke. undefined
        // whenever there is nothing to show (no memory file / read error / no
        // project dir — print mode and CLI subcommands never pass one), which
        // leaves the pre-M3 footer byte-identical.
        let memoryBar: string | undefined;
        // The observability round: the previous probe's memory version, for the
        // onMemoryVersion transition hook. undefined until the first read — a
        // first read is a fact, not an event.
        let lastMemoryVersion: number | undefined;
        // M3: the dream-news latch — last-seen dream id per project slug, an
        // IN-MEMORY Map held by this loop (the loop is the terminal session:
        // started at session_start, stopped at session_shutdown). Deliberately
        // NOT a persisted file: the 1h freshness window already bounds how long
        // one dream can be news, so the worst case an in-memory latch permits —
        // a second session re-announcing the same still-fresh learning ONCE,
        // as its own welcome-back line — is the per-session semantics we want,
        // while a state file would add home-dir bookkeeping (writes, pruning,
        // versioning) to a cosmetic toast for zero user-visible benefit.
        const dreamSeen = new Map<string, string>();
        const projectSlug = hooks.projectDir ? slugifyPath(hooks.projectDir) : undefined;
        let timer: ReturnType<typeof setInterval> | null = null;
        // Fast re-probes after a spawn kick: 2s, 5s, 9s, 16s (bounded 4 tries).
        let fastProbeTimers: Array<ReturnType<typeof setTimeout>> = [];
        const probe =
                hooks.probe ??
                (async () => {
                        const p = await probeEngine({
                                endpoint: process.env.UNOWN_ENGINE_URL || ENGINE_URL,
                                timeoutMs: probeTimeoutMs(),
                        });
                        if (p.kind !== "ok") return { up: false, kind: p.kind, probe: p };
                        const body = p.body;
                        return {
                                up: true,
                                pid: body?.pid,
                                busyMs: body?.router?.busyMs,
                                activeJob: body?.router?.activeJob,
                                version: body?.version,
                                dreamNews: parseDreamNews(body?.dreamNews),
                                kind: "ok" as const,
                                probe: p,
                        };
                });
        const kickSpawn = hooks.kickSpawn ?? (() => spawnEngineDetached());

        const publish = (next: EngineState, forceToast = false) => {
                const prev = state;
                if (prev !== next) since = Date.now();
                state = next;
                lastProbeAt = Date.now();
                if (hooks.onFooter) hooks.onFooter(engineFooterText(info(), memoryBar));
                if (prev !== next || forceToast) {
                        const toast = engineToastText(prev, next, outboxStats().queued, detail.probe);
                        if (toast && prev !== "unknown") hooks.onToast?.(toast.message, toast.level);
                        // prev === "unknown" (session start): footer appears silently — the
                        // initial state is a fact, not an event (deliberate engine-off users
                        // must not be greeted by a warning on every boot).
                }
        };

        const info = (): EngineStatusInfo => snapshotOf(state, { since, lastProbeAt, ...detail, ...build });

        /** M3: re-read the memory-bar facts. Runs inside runProbe (the probe
         *  cadence), wrapped so ANY failure simply drops the segment — the
         *  bar is decoration and must never be able to break the loop. */
        const refreshMemoryBar = () => {
                if (!hooks.projectDir) {
                        memoryBar = undefined;
                        return;
                }
                try {
                        const bar = readMemoryBarInfo(hooks.projectDir);
                        memoryBar = bar ? formatMemoryBar(bar) : undefined;
                        if (bar && typeof hooks.onMemoryVersion === "function" && lastMemoryVersion !== undefined && bar.version > lastMemoryVersion) {
                                hooks.onMemoryVersion(lastMemoryVersion, bar.version);
                        }
                        if (bar) lastMemoryVersion = bar.version;
                } catch {
                        memoryBar = undefined;
                }
        };

        /** M3: the dream-news toast decision for an up probe's news block.
         *  The latch is set BEFORE the toast fires, so even a throwing notify
         *  cannot double-fire on the next probe (30s later). */
        const considerDreamNews = (news: DreamNews | undefined) => {
                if (!news || !projectSlug) return;
                if (!shouldToastDreamNews(dreamSeen, news, projectSlug)) return;
                dreamSeen.set(projectSlug, news.id);
                hooks.onToast?.(dreamNewsToastText(news), "info");
                hooks.onDreamNews?.(dreamNewsToastText(news));
        };

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
                refreshMemoryBar(); // M3: bar facts ride the probe cadence (never per keystroke)
                let probeKind: EngineProbeKind | undefined;
                try {
                        const h = await probe();
                        probeKind = h.kind;
                        if (h.up) {
                                detail = { pid: h.pid, busyMs: h.busyMs, activeJob: h.activeJob, probe: h.probe };
                                publishBuild(h.version); // before publish(): the footer render reads it
                                markEngineHealthy(); // observed healthy → reset the crash-loop circuit
                                publish("up");
                                considerDreamNews(h.dreamNews); // after publish: the news toast is a rider on a healthy probe
                                return info();
                        }
                        detail = { probe: h.probe };
                } catch {
                        /* probe errors are simply "down" — the taxonomy probe never throws,
                         * but a custom probe might; never let the loop die. */
                        detail = {};
                }
                build = {};
                // A foreign engine, an occupied port, an incompatible build or a hung
                // port is not a crash: publish "blocked", do not kick, and do not start
                // the fast re-probe ladder (nothing this loop can start would help).
                const kind = probeKind ?? "refused";
                if (kind !== "refused") {
                        publish("blocked");
                        return info();
                }
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
        if (info.state !== "down" && info.state !== "paused" && info.state !== "blocked") return false;
        // Trust the snapshot only while fresh: 2x interval (or 60s floor) since
        // the last probe; after that a delivery should re-probe for itself.
        const maxAge = Math.max(60_000, 2 * probeIntervalMs());
        return Date.now() - info.lastProbeAt < maxAge;
}

/** Human summary of the supervisor's crash-loop circuit, for /engine + CLI. */
export function describeSpawnCircuit(state: SpawnState): string {
        const cause =
                state.lastCause === "unauthorized"
                        ? "the engine rejected this CLI's token"
                        : state.lastCause === "occupied"
                                ? "the port is held by another process"
                                : state.lastCause === "incompatible"
                                        ? "the engine build/API is incompatible"
                                        : state.lastCause === "unreachable"
                                                ? "the engine did not answer"
                                                : undefined;
        if (state.gaveUp)
                return `gave up after ${state.attempts} failed start(s)${cause ? ` — last probe: ${cause}` : ""} — run \`unown engine start\` (resets the circuit), and check .run/engine.log; if the DB is corrupt: \`unown engine repair\``;
        if (cause) return `auto-start blocked — ${cause}; no spawn attempted (run \`unown engine status\` for the owner)`;
        const gate = evaluateSpawnGate(state);
        if (gate.reason === "backoff")
                return `backing off — attempt ${state.attempts}, next auto-start in ${Math.ceil((gate.retryInMs ?? 0) / 1000)}s (auto-start works, just spaced out)`;
        if (state.attempts === 0) return "idle — no failed starts recorded";
        return `${state.attempts} recent attempt(s) recorded, auto-start allowed`;
}
