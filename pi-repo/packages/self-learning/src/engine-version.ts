/**
 * engine-version.ts — the agent↔engine version-skew handshake (M8).
 *
 * THE PROBLEM: the engine is a long-lived detached process (it lives for
 * days; the exit-empty rule means it only leaves when its port dies), while
 * the CLI updates frequently (`unown update` fast-forwards the checkout,
 * rebuilds, and tells the *user* to restart sessions). An updated agent
 * talking to a days-old engine is version skew, and before M8 it was
 * completely invisible: /api/overview reported pid/uptime but no version,
 * and nothing anywhere compared the two builds. The dashboard's agent block
 * even hard-coded `layer: "self-learning v0.1"` — the exact literal-version
 * anti-pattern packaging.ts documents (the MCP handshake once claimed 0.1.0
 * while shipping 2.1.x).
 *
 * THE DESIGN (research precedents: ollama's GET/HEAD /api/version + "client
 * version is X" warning, kubectl's version-skew policy, needrestart's
 * boot-time vs package-mtime rule, LSP/Docker per-request capability
 * negotiation — summarized in docs/detached-engine-architecture.md F15):
 *
 *   engine side   /api/version + overview.version expose {version, gitSha,
 *                 bootedAt, pid, uptimeMs, api} — the sha because semver
 *                 alone cannot see skew inside one dev day (multiple pushes
 *                 at the same version), bootedAt because the needrestart
 *                 rule (engine booted before the current code landed) is
 *                 skew detection that needs NO version string at all;
 *   agent side    compareEngineBuild() is a PURE classifier — fresh /
 *                 old-build (same version, different sha) / stale (older
 *                 semver, or booted-before-this-build) / ancient (major
 *                 behind, or a week behind the build) / ahead (engine newer
 *                 → `unown update`) / unknown (pre-M8 engine: never break,
 *                 just offer the restart that upgrades the reporting too).
 *
 * Warn-and-continue everywhere — a hard refuse would violate the M6
 * "the agent always works engine-down" contract (tmux can refuse on skew
 * because its client is useless without the server; unown's agent has
 * memory-on-disk and the outbox). Every stale surface says the same fix:
 * `unown engine restart`.
 *
 * PURITY: this module is imported by BOTH processes and by the terminal
 * agent's hot paths (engine-status.ts probe loop) — no store import (the
 * detachment contract), no engine imports; update.ts is pulled in only for
 * its pure git/semver helpers (it is side-effect-free at module scope).
 */
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { IS_COMPILED_BINARY, unownVersion } from "./packaging.ts";
import { compareSemver, gitShortSha, parseSemver, realGit, resolveRepoRoot } from "./update.ts";

// ---------------------------------------------------------------------------
// The engine-side version block (/api/version + overview.version)
// ---------------------------------------------------------------------------

/** API surface version of the engine's own reporting (bump when the shape
 *  of EngineVersionInfo changes in a way clients must distinguish). */
export const ENGINE_API_VERSION = 1;

export interface EngineVersionInfo {
	version: string;
	/** Short HEAD sha the engine was booted from; null when not a git
	 *  checkout (compiled binary, plain export). */
	gitSha: string | null;
	/** Epoch ms the engine process booted (first /api hit; see below). */
	bootedAt: number;
	pid: number;
	uptimeMs: number;
	api: number;
}

/** The engine's own version, resolved once and cached (a file read + env
 *  check — cheap, but the overview hot path should not repeat it). */
let cachedVersion: string | undefined;
export function agentVersion(): string {
	cachedVersion ??= unownVersion(join(import.meta.dir, "..", "..", "..", "..", "package.json"));
	return cachedVersion;
}

/** Short HEAD sha of THIS checkout, resolved lazily once per process (a
 *  git spawn is ~tens of ms — fine for one-shot CLI surfaces and the first
 *  probe, never per-request). Null when not a checkout (the compiled shape).
 *  Used by doctor + /engine, which display both sides of the handshake. */
let cachedSha: string | null | undefined;
export function agentGitSha(): string | null {
	if (cachedSha === undefined) {
		const root = resolveRepoRoot(realGit);
		cachedSha = root ? gitShortSha(root, realGit) : null;
	}
	return cachedSha;
}

/** The boot timestamp the engine reports. Same lazy-init seam /api/overview
 *  has always used (globalThis.__unown_engine_booted_at): the first caller
 *  stamps it, every later read agrees — /api/version and /api/overview can
 *  never disagree about when the engine booted. */
function engineBootedAt(): number {
	const g = globalThis as any;
	const existing = g.__unown_engine_booted_at;
	if (typeof existing === "number" && existing > 0) return existing;
	g.__unown_engine_booted_at = Date.now();
	return g.__unown_engine_booted_at;
}

/** The version block the engine exposes (/api/version, overview.version).
 *  The gitSha is captured AT BOOT (lazily, once): the sha the engine RUNS is
 *  the checkout it was spawned from, not whatever HEAD is now — capturing it
 *  per-request would make a stale engine look fresh after a mere `git pull`. */
let cachedEngineSha: string | null | undefined;
export function engineVersionInfo(): EngineVersionInfo {
	if (cachedEngineSha === undefined) {
		const root = resolveRepoRoot(realGit);
		cachedEngineSha = root ? gitShortSha(root, realGit) : null;
	}
	const bootedAt = engineBootedAt();
	return {
		version: agentVersion(),
		gitSha: cachedEngineSha,
		bootedAt,
		pid: process.pid,
		uptimeMs: Date.now() - bootedAt,
		api: ENGINE_API_VERSION,
	};
}

// ---------------------------------------------------------------------------
// compareEngineBuild — the pure skew classifier (agent side)
// ---------------------------------------------------------------------------

export type EngineBuildVerdict = "fresh" | "old-build" | "stale" | "ancient" | "ahead" | "unknown";

/** What the agent knows about itself. gitSha may be null on hot paths that
 *  skip the git spawn (the CLI status surface) — rule 3 simply doesn't fire
 *  there, and the bootedAt rule still catches same-version skew. */
export interface EngineBuildAgent {
	version: string;
	gitSha: string | null;
	codeMtimeMs: number;
}

/** The engine's reported build (the /api/version block, additive fields
 *  ignored). `undefined` = engine predates version reporting (pre-M8). */
export interface EngineBuildRef {
	version?: string;
	gitSha?: string | null;
	bootedAt?: number;
}

export interface EngineBuildComparison {
	verdict: EngineBuildVerdict;
	detail: string;
}

/** A stale verdict is promoted to "ancient" when the engine is a whole major
 *  version behind, or its boot predates the current build by more than this
 *  window (the "days-old engine" case — the one `unown update` users hit). */
export const ANCIENT_BUILD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Classify the engine's build against the agent's own. PURE (clock injected)
 * so every surface — footer, /engine, doctor, engine status — shares one
 * verdict, and the table is unit-testable without a live engine.
 *
 * Priority order:
 *   1. engine missing / no version block → unknown (pre-M8 engine — never
 *      break, offer the restart that brings version reporting along)
 *   2. versions differ (semver)          → ahead (engine newer) / stale
 *      (engine older); non-semver strings: any difference is stale
 *   3. same version, both shas known and different → old-build (the
 *      multiple-pushes-per-day dev case semver cannot see)
 *   4. engine booted BEFORE the current code landed (needrestart's
 *      package-mtime rule) → stale regardless of strings
 *   5. stale + (major behind OR booted > 7d before the build) → ancient
 *   6. else fresh
 */
export function compareEngineBuild(
	agent: EngineBuildAgent,
	engine: EngineBuildRef | undefined,
	now: number = Date.now(),
): EngineBuildComparison {
	// 1. pre-version engine: the handshake itself is missing.
	if (!engine || typeof engine.version !== "string" || engine.version === "") {
		return { verdict: "unknown", detail: "engine predates version reporting — restart to update: unown engine restart" };
	}
	const e = engine.version;
	const a = agent.version;

	// 2. different version strings.
	if (e !== a) {
		const cmp = compareSemver(e, a);
		if (cmp > 0) {
			return { verdict: "ahead", detail: `engine v${e} is newer than agent v${a} — update the agent: unown update` };
		}
		if (cmp < 0) {
			return staleVerdict(agent, engine, now, `engine v${e} is older than agent v${a} — restart the engine: unown engine restart`);
		}
		// cmp === 0 with different strings (a `v` prefix, say): semver-equal —
		// fall through to the sha / boot rules rather than calling it skew.
	}

	// 3. same version, different build (the dev-day case).
	if (agent.gitSha !== null && engine.gitSha != null && engine.gitSha !== agent.gitSha) {
		return {
			verdict: "old-build",
			detail: `same version (v${e}) but engine runs ${engine.gitSha} while the agent runs ${agent.gitSha} — restart the engine: unown engine restart`,
		};
	}

	// 4. needrestart rule: the engine booted before the current code landed.
	if (typeof engine.bootedAt === "number" && agent.codeMtimeMs > 0 && engine.bootedAt < agent.codeMtimeMs) {
		return staleVerdict(agent, engine, now, `engine booted before the current build landed (${formatDuration(Math.max(0, now - engine.bootedAt))} ago) — restart the engine: unown engine restart`);
	}

	// 5./6. fresh.
	return { verdict: "fresh", detail: `engine v${e} matches agent v${a}` };
}

/** The stale verdict + the ancient promotion (rule 5), shared by both stale
 *  branches so the "how stale is too stale" policy has one definition. */
function staleVerdict(
	agent: EngineBuildAgent,
	engine: EngineBuildRef,
	now: number,
	detail: string,
): EngineBuildComparison {
	const pe = parseSemver(engine.version ?? "");
	const pa = parseSemver(agent.version);
	const majorBehind = pe && pa && pa.major - pe.major >= 1;
	const bootedLongBeforeBuild =
		typeof engine.bootedAt === "number" &&
		agent.codeMtimeMs > 0 &&
		engine.bootedAt < agent.codeMtimeMs - ANCIENT_BUILD_MS;
	if (majorBehind || bootedLongBeforeBuild) {
		return { verdict: "ancient", detail: `${detail.replace(" — restart", " (far behind) — restart")}` };
	}
	return { verdict: "stale", detail };
}

// ---------------------------------------------------------------------------
// codeMtimeMs — when did the code the AGENT runs first land on disk?
// ---------------------------------------------------------------------------

/** The repo root this module tree lives in (the store.ts / supervisor
 *  shape: four levels up from src/; nonsense inside a compiled binary,
 *  which is why IS_COMPILED_BINARY routes around it first). */
const REPO_ROOT = resolve(import.meta.dir, "../../../..");

/** statSync seam so tests can pin the fallbacks (missing file → 0, stat
 *  error → 0) without touching the real checkout. */
export interface CodeMtimeOpts {
	compiled?: boolean;
	execPath?: string;
	packageJson?: string;
	stat?: (p: string) => { mtimeMs: number };
}

/**
 * mtime of the code the agent runs — the needrestart anchor.
 *
 *   checkout shape  → mtime of the ROOT package.json (rewritten by every
 *                     `unown update` — releases bump it — and by any dev
 *                     push that touches it)
 *   compiled shape  → mtime of process.execPath (the standalone binary IS
 *                     the code; a replaced binary has a fresh mtime)
 *   missing/stat error → 0 ("no anchor known" — rule 4 never fires)
 */
export function codeMtimeMs(opts: CodeMtimeOpts = {}): number {
	const stat = opts.stat ?? ((p: string) => statSync(p));
	const target =
		(opts.compiled ?? IS_COMPILED_BINARY) ? (opts.execPath ?? process.execPath) : (opts.packageJson ?? join(REPO_ROOT, "package.json"));
	try {
		return stat(target).mtimeMs;
	} catch {
		return 0;
	}
}

// ---------------------------------------------------------------------------
// Duration formatting — one humanizer for uptime AND "booted X ago" ages
// ---------------------------------------------------------------------------

/**
 * Humanize a duration: `45s` / `6m30s` / `3h 12m` / `6d 4h 20m`.
 *
 * WHY this exists: `unown engine status` rendered uptime as raw minutes —
 * the live engine here showed `up 8640m0s` for six days. Durations past an
 * hour switch to `Xh Ym`; past a day to `Xd Yh Zm` (the tmux/docker-uptime
 * vocabulary). Under an hour the historical `Xm Ys` single-line style is
 * kept so existing output stays recognizable.
 */
export function formatDuration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (d > 0) return `${d}d ${h}h ${m}m`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m${sec}s`;
}
