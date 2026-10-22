/**
 * verify.ts — the PostToolUse auto-verify gate (aider-style proactive quality).
 *
 * The evidence-ranked #1 default from the 2026-10 coding-agent survey
 * (aider's auto-lint loop; Claude Code's gather → act → verify agentic
 * phase; Cursor/Kiro PostToolUse lint hooks; Factory's AGENTS.md
 * "Verification" doctrine): after the agent edits a file, run the project's
 * OWN check commands and feed failures back into the tool result — so a
 * broken edit surfaces as a FAILED edit the model immediately fixes, not as
 * a confident wrong answer the user discovers later.
 *
 * Contract (binding):
 *
 *   - FAIL-OPEN: detection misses, missing binaries, blocked commands,
 *     timeouts — every failure path degrades to "no feedback appended",
 *     never to a broken edit path. The gate must never cost more than the
 *     check it runs.
 *   - DEFAULTS: the fast lane (typecheck, else lint) runs after write/edit,
 *     cooldown-throttled, silent on success (aider semantics: a passing
 *     check appends nothing). The TEST lane is OPT-IN
 *     (`UNOWN_AUTO_TEST=1` — test suites can mutate state and hit the
 *     network; aider's `--auto-test` is the opt-in precedent).
 *     `UNOWN_AUTO_VERIFY=0` disables the whole gate.
 *   - SAFETY: every command passes bash-policy `decideBash()` first — the
 *     same PreToolUse denylist the bash tool answers to. The gate never
 *     executes anything the hook layer would refuse.
 *   - CROSS-PLATFORM: POSIX runs `/bin/sh -c`, Windows runs `%ComSpec% /c`.
 *     No shell assumptions, no bash-isms in detected commands.
 *   - One infra failure (command not found) disables the gate for the
 *     session: a missing toolchain is an environment problem, and nagging
 *     the model about it on every edit is worse than silence.
 *
 * Pure decision + formatting logic is exported for tests; `spawnCheck` is
 * the only impure seam and is injectable via `createAutoVerifyRunner`.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decideBash } from "./bash-policy.ts";

// ---------------------------------------------------------------------------
// Env-var names — exported so docs/tests/CLI reference the same identifiers.
// Read lazily (per call) so tests can mutate process.env between calls.
// All optional vars use the repo's `||`-not-`??` convention: `.env.example`
// ships them EMPTY, and an empty string must mean "unset, use the default".
// ---------------------------------------------------------------------------

/** 0/false/no/off disables the whole gate (default: on). */
export const AUTO_VERIFY_ENV = "UNOWN_AUTO_VERIFY";
/** Per-check timeout for the fast lane, ms (default 120000). */
export const AUTO_VERIFY_TIMEOUT_ENV = "UNOWN_AUTO_VERIFY_TIMEOUT_MS";
/** Cooldown between fast-lane runs, ms (default 20000). */
export const AUTO_VERIFY_COOLDOWN_ENV = "UNOWN_AUTO_VERIFY_COOLDOWN_MS";
/** 1/true/yes/on enables the test lane (default: off). */
export const AUTO_TEST_ENV = "UNOWN_AUTO_TEST";
/** Per-check timeout for the test lane, ms (default 300000). */
export const AUTO_TEST_TIMEOUT_ENV = "UNOWN_AUTO_TEST_TIMEOUT_MS";
/** Cooldown between test-lane runs, ms (default 60000). */
export const AUTO_TEST_COOLDOWN_ENV = "UNOWN_AUTO_TEST_COOLDOWN_MS";

export const DEFAULT_VERIFY_TIMEOUT_MS = 120_000;
export const DEFAULT_VERIFY_COOLDOWN_MS = 20_000;
export const DEFAULT_TEST_TIMEOUT_MS = 300_000;
export const DEFAULT_TEST_COOLDOWN_MS = 60_000;

/** Character cap for check output fed back to the model (tail-biased clip). */
export const VERIFY_OUTPUT_CAP = 4_000;
/** Hard collection cap so a chatty check cannot grow memory unbounded. */
const OUTPUT_HARD_CAP = 200_000;

/** Exit codes that mean "the toolchain itself is missing" → disable for session. */
const INFRA_EXIT_CODES = new Set([127, 9009]);

/** Doc-only suffixes never trigger a check run (no typecheck helps a README). */
const SKIP_EXTENSIONS = /\.(md|mdx|txt|rst|adoc|adoc\.txt)$/i;

export function autoVerifyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
        const raw = (env[AUTO_VERIFY_ENV] ?? "").trim();
        return !/^(0|false|no|off)$/i.test(raw);
}

export function autoTestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
        return /^(1|true|yes|on)$/i.test((env[AUTO_TEST_ENV] ?? "").trim());
}

function positiveIntEnv(name: string, fallback: number, env: NodeJS.ProcessEnv, floor = 1): number {
        const raw = (env[name] ?? "").trim();
        if (raw === "") return fallback;
        const n = Number(raw);
        return Number.isFinite(n) && n >= floor ? Math.floor(n) : fallback;
}

export function verifyTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
        return positiveIntEnv(AUTO_VERIFY_TIMEOUT_ENV, DEFAULT_VERIFY_TIMEOUT_MS, env, 100);
}

export function verifyCooldownMs(env: NodeJS.ProcessEnv = process.env): number {
        return positiveIntEnv(AUTO_VERIFY_COOLDOWN_ENV, DEFAULT_VERIFY_COOLDOWN_MS, env, 0);
}

export function testTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
        return positiveIntEnv(AUTO_TEST_TIMEOUT_ENV, DEFAULT_TEST_TIMEOUT_MS, env, 100);
}

export function testCooldownMs(env: NodeJS.ProcessEnv = process.env): number {
        return positiveIntEnv(AUTO_TEST_COOLDOWN_ENV, DEFAULT_TEST_COOLDOWN_MS, env, 0);
}

// ---------------------------------------------------------------------------
// Project check detection (pure fs reads; never throws)
// ---------------------------------------------------------------------------

export interface ProjectChecks {
        typecheck: string | null;
        lint: string | null;
        test: string | null;
        /** Manifests that contributed a command, most specific first. */
        sources: string[];
}

const EMPTY_CHECKS: ProjectChecks = { typecheck: null, lint: null, test: null, sources: [] };

/** The `npm create` placeholder test script — not a real check command. */
function isPlaceholderTestScript(value: string): boolean {
        return /^echo\b/i.test(value.trim()) && /no test specified/i.test(value);
}

function detectPackageManagerCommand(cwd: string): string {
        if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))) return "bun run";
        if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm run";
        if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
        return "npm run";
}

function readPackageJsonScripts(cwd: string): Record<string, string> | null {
        try {
                const raw = readFileSync(join(cwd, "package.json"), "utf8");
                const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> };
                if (!pkg.scripts || typeof pkg.scripts !== "object") return null;
                const out: Record<string, string> = {};
                for (const [k, v] of Object.entries(pkg.scripts)) {
                        if (typeof v === "string" && v.trim().length > 0) out[k] = v.trim();
                }
                return out;
        } catch {
                return null;
        }
}

function makefileTargets(cwd: string): Set<string> | null {
        try {
                const raw = readFileSync(join(cwd, "Makefile"), "utf8");
                if (!raw.includes(":")) return null;
                const targets = new Set<string>();
                for (const m of raw.matchAll(/^([a-zA-Z0-9_.-]+)\s*:/gm)) {
                        const name = m[1];
                        if (!name.includes("$") && !name.includes("%")) targets.add(name);
                }
                return targets.size > 0 ? targets : null;
        } catch {
                return null;
        }
}

function readPyprojectText(cwd: string): string | null {
        try {
                return readFileSync(join(cwd, "pyproject.toml"), "utf8");
        } catch {
                return null;
        }
}

/**
 * Detect the project's own check commands. Priority per kind:
 * package.json scripts (run through the detected package manager) over
 * Makefile targets over pyproject.toml tool sections. Never throws; a
 * project with no detectable checks returns all-null (the gate stays
 * silent — fail-open).
 */
export function detectProjectChecks(cwd: string): ProjectChecks {
        const checks: ProjectChecks = { typecheck: null, lint: null, test: null, sources: [] };

        const scripts = readPackageJsonScripts(cwd);
        if (scripts) {
                const pm = detectPackageManagerCommand(cwd);
                if (scripts.typecheck) checks.typecheck = `${pm} typecheck`;
                else if (scripts["type-check"]) checks.typecheck = `${pm} type-check`;
                else if (scripts.tsc) checks.typecheck = `${pm} tsc`;
                if (scripts.lint) checks.lint = `${pm} lint`;
                else if (scripts.eslint) checks.lint = `${pm} eslint`;
                else if (scripts.biome) checks.lint = `${pm} biome`;
                if (scripts.test && !isPlaceholderTestScript(scripts.test)) checks.test = `${pm} test`;
                if (checks.typecheck || checks.lint || checks.test) checks.sources.push("package.json");
        }

        const targets = makefileTargets(cwd);
        if (targets) {
                if (!checks.typecheck) {
                        if (targets.has("typecheck")) checks.typecheck = "make typecheck";
                        else if (targets.has("type-check")) checks.typecheck = "make type-check";
                        else if (targets.has("tsc")) checks.typecheck = "make tsc";
                }
                if (!checks.lint && targets.has("lint")) checks.lint = "make lint";
                if (!checks.test && targets.has("test")) checks.test = "make test";
                if ((checks.typecheck || checks.lint || checks.test) && !checks.sources.includes("Makefile")) {
                        checks.sources.push("Makefile");
                }
        }

        const pyproject = readPyprojectText(cwd);
        if (pyproject) {
                if (!checks.typecheck && /\[tool\.mypy\]/.test(pyproject)) checks.typecheck = "mypy .";
                if (!checks.lint && /\[tool\.ruff\]/.test(pyproject)) checks.lint = "ruff check .";
                if (!checks.test && /\[tool\.pytest(\.ini_options)?\]/.test(pyproject)) checks.test = "python -m pytest";
                if ((checks.typecheck || checks.lint || checks.test) && !checks.sources.includes("pyproject.toml")) {
                        checks.sources.push("pyproject.toml");
                }
        }

        return checks;
}

// ---------------------------------------------------------------------------
// Check execution (the only impure seam; injectable for tests)
// ---------------------------------------------------------------------------

export interface CheckResult {
        command: string;
        /** Process exit code; null when the process could not spawn at all. */
        exitCode: number | null;
        output: string;
        timedOut: boolean;
}

/** Shell argv for a check command, cross-platform (pure — exported for tests). */
export function checkCommandArgv(command: string, platform: string = process.platform, comspec = process.env.ComSpec): { file: string; args: string[] } {
        if (platform === "win32") {
                return { file: comspec || "cmd.exe", args: ["/d", "/s", "/c", command] };
        }
        return { file: "/bin/sh", args: ["-c", command] };
}

export function spawnCheck(command: string, cwd: string, timeoutMs: number): Promise<CheckResult> {
        return new Promise<CheckResult>((resolve) => {
                const { file, args } = checkCommandArgv(command);
                let child: ReturnType<typeof spawn>;
                try {
                        child = spawn(file, args, { cwd, env: process.env });
                } catch (err: unknown) {
                        resolve({ command, exitCode: null, output: `spawn failed: ${err instanceof Error ? err.message : String(err)}`, timedOut: false });
                        return;
                }
                let output = "";
                let timedOut = false;
                const append = (chunk: Buffer | string): void => {
                        if (output.length >= OUTPUT_HARD_CAP) return;
                        output += chunk.toString();
                };
                child.stdout?.on("data", append);
                child.stderr?.on("data", append);
                const timer = setTimeout(() => {
                        timedOut = true;
                        try {
                                child.kill("SIGKILL");
                        } catch {
                                /* already gone */
                        }
                }, timeoutMs);
                if (typeof timer.unref === "function") timer.unref();
                child.on("error", (err: Error) => {
                        clearTimeout(timer);
                        resolve({ command, exitCode: null, output: `spawn failed: ${err.message}`, timedOut: false });
                });
                child.on("close", (code: number | null) => {
                        clearTimeout(timer);
                        resolve({ command, exitCode: code, output, timedOut });
                });
        });
}

// ---------------------------------------------------------------------------
// Gate state machine (pure)
// ---------------------------------------------------------------------------

export interface VerifyGateState {
        lastVerifyMs: number | null;
        lastTestMs: number | null;
        disabledReason: string | null;
}

export function createVerifyGateState(): VerifyGateState {
        return { lastVerifyMs: null, lastTestMs: null, disabledReason: null };
}

export function gateShouldRun(
        state: VerifyGateState,
        kind: "verify" | "test",
        cooldownMs: number,
        nowMs: number,
): { run: boolean; reason: string } {
        if (state.disabledReason) return { run: false, reason: `disabled: ${state.disabledReason}` };
        const last = kind === "verify" ? state.lastVerifyMs : state.lastTestMs;
        if (last !== null && nowMs - last < cooldownMs) return { run: false, reason: "cooldown" };
        return { run: true, reason: "due" };
}

/** True when a file extension can never benefit from a project check run. */
export function isSkippableDocPath(path: string): boolean {
        return SKIP_EXTENSIONS.test(path);
}

// ---------------------------------------------------------------------------
// Feedback formatting (pure)
// ---------------------------------------------------------------------------

export interface AutoVerifyFeedback {
        text: string;
        isError: boolean;
}

/** Tail-biased clip: compiler/linter verdicts live at the end of the output. */
function clipOutput(out: string): string {
        const trimmed = out.trim();
        if (trimmed.length <= VERIFY_OUTPUT_CAP) return trimmed;
        const head = trimmed.slice(0, 800);
        const tail = trimmed.slice(-(VERIFY_OUTPUT_CAP - 800));
        const clipped = trimmed.length - VERIFY_OUTPUT_CAP;
        return `${head}\n[… ${clipped} chars clipped …]\n${tail}`;
}

/**
 * Render a check result as tool-result feedback. Silent pass (aider
 * semantics: a green check appends nothing), silent timeout and silent
 * spawn-failure — only a REAL non-zero exit from a REAL command produces
 * feedback, and that feedback is an error.
 */
export function formatCheckFeedback(res: CheckResult, kind: "verify" | "test"): AutoVerifyFeedback | null {
        if (res.timedOut) return null;
        if (res.exitCode === null) return null;
        if (res.exitCode === 0) return null;
        const label = kind === "test" ? "auto-test" : "auto-verify";
        const action =
                kind === "test"
                        ? "fix the failing tests at the root cause (never weaken or skip a test) and re-run"
                        : "fix the root cause and re-run until it passes";
        const output = clipOutput(res.output);
        const text =
                `\n\n[${label}] \`${res.command}\` failed (exit ${res.exitCode}) — ${action} before declaring this change done:\n` +
                (output.length > 0 ? output : "(no output)");
        return { text, isError: true };
}

// ---------------------------------------------------------------------------
// The runner — one per session (wired in tools.ts's tool_result seam)
// ---------------------------------------------------------------------------

export type SpawnImpl = (command: string, cwd: string, timeoutMs: number) => Promise<CheckResult>;

export interface AutoVerifyRunnerOptions {
        env?: NodeJS.ProcessEnv;
        now?: () => number;
        spawnImpl?: SpawnImpl;
        checks?: ProjectChecks;
        log?: (msg: string) => void;
}

export interface AutoVerifyRunner {
        /** Feedback to append to a write/edit tool result; null = none. */
        feedbackFor(path: string): Promise<AutoVerifyFeedback | null>;
        state: VerifyGateState;
        checks: ProjectChecks;
}

export function createAutoVerifyRunner(cwd: string, options: AutoVerifyRunnerOptions = {}): AutoVerifyRunner {
        const env = options.env ?? process.env;
        const now = options.now ?? Date.now;
        const runCheck = options.spawnImpl ?? spawnCheck;
        const log = options.log ?? ((): void => {});
        const state = createVerifyGateState();
        const checks = options.checks ?? detectProjectChecks(cwd);
        let inFlight: Promise<unknown> | null = null;

        async function runLane(kind: "verify" | "test", command: string, timeoutMs: number, cooldownMs: number, path: string): Promise<AutoVerifyFeedback | null> {
                const gate = gateShouldRun(state, kind, cooldownMs, now());
                if (!gate.run) return null;
                if (kind === "verify") state.lastVerifyMs = now();
                else state.lastTestMs = now();
                const decision = decideBash(command);
                if (decision.block) {
                        log(`auto-verify skipped (bash policy: ${decision.reason})`);
                        return null;
                }
                const res = await runCheck(command, cwd, timeoutMs);
                if (res.exitCode !== null && INFRA_EXIT_CODES.has(res.exitCode)) {
                        state.disabledReason = `check command not found (exit ${res.exitCode}): ${command}`;
                        log(`auto-verify disabled for this session: ${state.disabledReason}`);
                        return null;
                }
                const feedback = formatCheckFeedback(res, kind);
                if (feedback?.isError) {
                        log(`PostToolUse auto-verify gate flagged ${path} (${command}, exit ${res.exitCode})`);
                }
                return feedback;
        }

        async function feedbackFor(path: string): Promise<AutoVerifyFeedback | null> {
                if (isSkippableDocPath(path)) return null;
                const verifyOn = autoVerifyEnabled(env);
                const testOn = autoTestEnabled(env);
                if ((!verifyOn && !testOn) || state.disabledReason) return null;
                if (inFlight) return null; // one check at a time — an edit burst never queues behind a slow run
                const attempt = (async () => {
                        const parts: AutoVerifyFeedback[] = [];
                        if (verifyOn) {
                                const command = checks.typecheck ?? checks.lint;
                                if (command) {
                                        const fb = await runLane("verify", command, verifyTimeoutMs(env), verifyCooldownMs(env), path);
                                        if (fb) parts.push(fb);
                                }
                        }
                        if (testOn && checks.test) {
                                const fb = await runLane("test", checks.test, testTimeoutMs(env), testCooldownMs(env), path);
                                if (fb) parts.push(fb);
                        }
                        if (parts.length === 0) return null;
                        return { text: parts.map((p) => p.text).join(""), isError: parts.some((p) => p.isError) };
                })();
                inFlight = attempt;
                try {
                        return await attempt;
                } catch {
                        return null; // the gate must never break the edit path
                } finally {
                        inFlight = null;
                }
        }

        return { feedbackFor, state, checks };
}
