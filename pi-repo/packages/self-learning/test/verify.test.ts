// Unit tests for src/verify.ts — the PostToolUse auto-verify gate (the
// aider-style proactive-quality default from the 2026-10 agent survey) —
// plus the term.ts policy-seed verify-first upgrade path.
//
// Pins:
//   1.  detectProjectChecks reads package.json scripts through the detected
//       package manager, skips the npm placeholder test script, and falls
//       back per-kind to Makefile targets and pyproject.toml tool sections
//   2.  env parsing: verify lane on by default, test lane opt-in, timeouts
//       and cooldowns with garbage-tolerant fallbacks
//   3.  checkCommandArgv is cross-platform (POSIX /bin/sh, Windows ComSpec)
//   4.  gateShouldRun: due / cooldown / session-disable
//   5.  formatCheckFeedback: silent pass, silent timeout, silent
//       spawn-failure; real failures produce error feedback naming the
//       command and (tail-biased, capped) output
//   6.  the runner: failing check → error feedback; pass → silent; cooldown
//       throttles; a 127/9009 infra failure disables the gate for the
//       session; doc paths and bash-policy-blocked commands never spawn;
//       the opt-in test lane composes with the fast lane
//   7.  POLICY_SEED carries the verify-first pair; refreshSeedPolicyAt
//       upgrades a pristine v1 seed exactly once and never touches an
//       edited or missing file
//
// Hermeticity: fs reads/writes happen in throwaway tmp dirs; the runner is
// driven through an injected fake spawn (no real commands run); env parsing
// goes through explicit env objects (never process.env mutation).
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        AUTO_TEST_ENV,
        AUTO_TEST_TIMEOUT_ENV,
        AUTO_VERIFY_COOLDOWN_ENV,
        AUTO_VERIFY_ENV,
        AUTO_VERIFY_TIMEOUT_ENV,
        autoTestEnabled,
        autoVerifyEnabled,
        checkCommandArgv,
        createAutoVerifyRunner,
        createVerifyGateState,
        DEFAULT_TEST_COOLDOWN_MS,
        DEFAULT_TEST_TIMEOUT_MS,
        DEFAULT_VERIFY_COOLDOWN_MS,
        DEFAULT_VERIFY_TIMEOUT_MS,
        detectProjectChecks,
        formatCheckFeedback,
        gateShouldRun,
        isSkippableDocPath,
        testCooldownMs,
        testTimeoutMs,
        verifyCooldownMs,
        verifyTimeoutMs,
        type CheckResult,
        type ProjectChecks,
        type SpawnImpl,
} from "../src/verify.ts";
import { POLICY_SEED, refreshSeedPolicyAt } from "../src/term.ts";

// ---------------------------------------------------------------------------
// Scratch dirs (registered + removed once at the end)
// ---------------------------------------------------------------------------
const cleanups: string[] = [];
function scratchDir(setup: (dir: string) => void): string {
        const dir = mkdtempSync(join(tmpdir(), "unown-verify-"));
        cleanups.push(dir);
        setup(dir);
        return dir;
}
afterAll(() => {
        for (const d of cleanups) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fake spawn — records calls, returns canned results
// ---------------------------------------------------------------------------
interface RecordingSpawn extends SpawnImpl {
        calls: Array<{ command: string; cwd: string; timeoutMs: number }>;
}
function fakeSpawn(results: Record<string, CheckResult>): RecordingSpawn {
        const calls: Array<{ command: string; cwd: string; timeoutMs: number }> = [];
        const impl = async (command: string, cwd: string, timeoutMs: number): Promise<CheckResult> => {
                calls.push({ command, cwd, timeoutMs });
                return results[command] ?? { command, exitCode: 0, output: "", timedOut: false };
        };
        return Object.assign(impl, { calls });
}

const CHECKS: ProjectChecks = { typecheck: "npm run typecheck", lint: null, test: "npm test", sources: ["package.json"] };

// ---------------------------------------------------------------------------
// detectProjectChecks
// ---------------------------------------------------------------------------
describe("detectProjectChecks", () => {
        test("package.json scripts run through the detected package manager", () => {
                const dir = scratchDir((d) => {
                        writeFileSync(
                                join(d, "package.json"),
                                JSON.stringify({ scripts: { typecheck: "tsc --noEmit", lint: "eslint .", test: "bun test" } }),
                        );
                        writeFileSync(join(d, "bun.lock"), "");
                });
                const checks = detectProjectChecks(dir);
                expect(checks.typecheck).toBe("bun run typecheck");
                expect(checks.lint).toBe("bun run lint");
                expect(checks.test).toBe("bun run test");
                expect(checks.sources).toContain("package.json");
        });

        test("no lockfile defaults to npm; the npm placeholder test script is not a check", () => {
                const dir = scratchDir((d) => {
                        writeFileSync(
                                join(d, "package.json"),
                                JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
                        );
                });
                const checks = detectProjectChecks(dir);
                expect(checks.test).toBeNull();
                expect(checks.typecheck).toBeNull();
                expect(checks.lint).toBeNull();
        });

        test("type-check and tsc script spellings and the eslint fallback resolve", () => {
                const dir = scratchDir((d) => {
                        writeFileSync(join(d, "package.json"), JSON.stringify({ scripts: { "type-check": "tsc", eslint: "eslint ." } }));
                });
                const checks = detectProjectChecks(dir);
                expect(checks.typecheck).toBe("npm run type-check");
                expect(checks.lint).toBe("npm run eslint");
        });

        test("Makefile targets become make commands", () => {
                const dir = scratchDir((d) => {
                        writeFileSync(
                                join(d, "Makefile"),
                                ["lint:", "\t@true", "typecheck:", "\t@true", ".PHONY: lint typecheck", ""].join("\n"),
                        );
                });
                const checks = detectProjectChecks(dir);
                expect(checks.typecheck).toBe("make typecheck");
                expect(checks.lint).toBe("make lint");
                expect(checks.test).toBeNull();
                expect(checks.sources).toContain("Makefile");
        });

        test("pyproject.toml tool sections map to module invocations", () => {
                const dir = scratchDir((d) => {
                        writeFileSync(join(d, "pyproject.toml"), "[tool.ruff]\nline-length = 100\n\n[tool.pytest.ini_options]\nminversion = \"7\"\n");
                });
                const checks = detectProjectChecks(dir);
                expect(checks.lint).toBe("ruff check .");
                expect(checks.test).toBe("python -m pytest");
                expect(checks.typecheck).toBeNull();
                expect(checks.sources).toContain("pyproject.toml");
        });

        test("package.json wins per-kind over Makefile; Makefile fills the gaps", () => {
                const dir = scratchDir((d) => {
                        writeFileSync(join(d, "package.json"), JSON.stringify({ scripts: { lint: "eslint ." } }));
                        writeFileSync(join(d, "Makefile"), "lint:\ntypecheck:\ntest:\n");
                });
                const checks = detectProjectChecks(dir);
                expect(checks.lint).toBe("npm run lint");
                expect(checks.typecheck).toBe("make typecheck");
                expect(checks.test).toBe("make test");
                expect(checks.sources).toEqual(["package.json", "Makefile"]);
        });

        test("an empty or corrupt project detects nothing and never throws", () => {
                const empty = scratchDir(() => {});
                expect(detectProjectChecks(empty).typecheck).toBeNull();
                const corrupt = scratchDir((d) => {
                        writeFileSync(join(d, "package.json"), "{ not json");
                });
                expect(() => detectProjectChecks(corrupt)).not.toThrow();
                expect(detectProjectChecks(corrupt).lint).toBeNull();
        });
});

// ---------------------------------------------------------------------------
// Env parsing
// ---------------------------------------------------------------------------
describe("env parsing", () => {
        test("verify lane is on by default; explicit negatives disable", () => {
                expect(autoVerifyEnabled({})).toBe(true);
                expect(autoVerifyEnabled({ [AUTO_VERIFY_ENV]: "" })).toBe(true);
                for (const v of ["0", "false", "no", "off", "FALSE", "Off"]) {
                        expect(autoVerifyEnabled({ [AUTO_VERIFY_ENV]: v })).toBe(false);
                }
                expect(autoVerifyEnabled({ [AUTO_VERIFY_ENV]: "1" })).toBe(true);
        });

        test("test lane is off by default; explicit positives enable", () => {
                expect(autoTestEnabled({})).toBe(false);
                expect(autoTestEnabled({ [AUTO_TEST_ENV]: "" })).toBe(false);
                for (const v of ["1", "true", "yes", "on", "TRUE"]) {
                        expect(autoTestEnabled({ [AUTO_TEST_ENV]: v })).toBe(true);
                }
                expect(autoTestEnabled({ [AUTO_TEST_ENV]: "0" })).toBe(false);
        });

        test("timeouts and cooldowns: defaults, overrides, garbage fallbacks", () => {
                expect(verifyTimeoutMs({})).toBe(DEFAULT_VERIFY_TIMEOUT_MS);
                expect(verifyTimeoutMs({ [AUTO_VERIFY_TIMEOUT_ENV]: "5000" })).toBe(5000);
                expect(verifyTimeoutMs({ [AUTO_VERIFY_TIMEOUT_ENV]: "garbage" })).toBe(DEFAULT_VERIFY_TIMEOUT_MS);
                expect(verifyTimeoutMs({ [AUTO_VERIFY_TIMEOUT_ENV]: "-5" })).toBe(DEFAULT_VERIFY_TIMEOUT_MS);
                expect(verifyCooldownMs({})).toBe(DEFAULT_VERIFY_COOLDOWN_MS);
                expect(verifyCooldownMs({ [AUTO_VERIFY_COOLDOWN_ENV]: "0" })).toBe(0);
                expect(verifyCooldownMs({ [AUTO_VERIFY_COOLDOWN_ENV]: "7000" })).toBe(7000);
                expect(testTimeoutMs({})).toBe(DEFAULT_TEST_TIMEOUT_MS);
                expect(testTimeoutMs({ [AUTO_TEST_TIMEOUT_ENV]: "1234" })).toBe(1234);
                expect(testCooldownMs({})).toBe(DEFAULT_TEST_COOLDOWN_MS);
        });
});

// ---------------------------------------------------------------------------
// Cross-platform command assembly
// ---------------------------------------------------------------------------
describe("checkCommandArgv", () => {
        test("POSIX runs /bin/sh -c <command>", () => {
                const argv = checkCommandArgv("npm run lint", "linux");
                expect(argv.file).toBe("/bin/sh");
                expect(argv.args).toEqual(["-c", "npm run lint"]);
        });
        test("Windows runs %ComSpec% /d /s /c <command> and falls back to cmd.exe", () => {
                const argv = checkCommandArgv("npm run lint", "win32", "C:\\Windows\\system32\\cmd.exe");
                expect(argv.file).toBe("C:\\Windows\\system32\\cmd.exe");
                expect(argv.args).toEqual(["/d", "/s", "/c", "npm run lint"]);
                // The FALLBACK is probed with "" (falsy): passing undefined would
                // trigger the parameter DEFAULT (process.env.ComSpec — set on every
                // real windows host, so the old `undefined` probe only ever tested
                // the fallback on linux and went red the first time the windows leg
                // actually ran, 2026-10-22).
                expect(checkCommandArgv("x", "win32", "").file).toBe("cmd.exe");
                // The env default itself: resolves ComSpec on windows, the fallback
                // elsewhere — both spell cmd.
                expect(checkCommandArgv("x", "win32").file?.toLowerCase()).toContain("cmd.exe");
        });
});

// ---------------------------------------------------------------------------
// Gate state machine
// ---------------------------------------------------------------------------
describe("gateShouldRun", () => {
        test("due → run; inside cooldown → skip; past cooldown → run again", () => {
                const state = createVerifyGateState();
                expect(gateShouldRun(state, "verify", 20_000, 1_000).run).toBe(true);
                state.lastVerifyMs = 500;
                expect(gateShouldRun(state, "verify", 20_000, 10_000).run).toBe(false);
                expect(gateShouldRun(state, "verify", 20_000, 20_501).run).toBe(true);
        });
        test("a session-disable beats every cooldown", () => {
                const state = createVerifyGateState();
                state.disabledReason = "check command not found";
                expect(gateShouldRun(state, "verify", 0, 999_999).run).toBe(false);
                expect(gateShouldRun(state, "test", 0, 999_999).run).toBe(false);
        });
        test("the test lane keeps its own clock", () => {
                const state = createVerifyGateState();
                state.lastTestMs = 1_000;
                expect(gateShouldRun(state, "test", 60_000, 10_000).run).toBe(false);
                expect(gateShouldRun(state, "verify", 60_000, 10_000).run).toBe(true);
        });
});

// ---------------------------------------------------------------------------
// Feedback formatting
// ---------------------------------------------------------------------------
describe("formatCheckFeedback", () => {
        test("silent on pass, timeout, and spawn-level failure", () => {
                expect(formatCheckFeedback({ command: "x", exitCode: 0, output: "", timedOut: false }, "verify")).toBeNull();
                expect(formatCheckFeedback({ command: "x", exitCode: 1, output: "", timedOut: true }, "verify")).toBeNull();
                expect(formatCheckFeedback({ command: "x", exitCode: null, output: "boom", timedOut: false }, "verify")).toBeNull();
        });
        test("a real failure produces error feedback naming command and output", () => {
                const fb = formatCheckFeedback(
                        { command: "npm run typecheck", exitCode: 2, output: "src/a.ts:3:7 - error TS2345", timedOut: false },
                        "verify",
                );
                expect(fb?.isError).toBe(true);
                expect(fb?.text).toContain("[auto-verify]");
                expect(fb?.text).toContain("npm run typecheck");
                expect(fb?.text).toContain("error TS2345");
                expect(fb?.text).toContain("exit 2");
        });
        test("the test lane uses the auto-test label and the never-weaken wording", () => {
                const fb = formatCheckFeedback({ command: "npm test", exitCode: 1, output: "1 failing", timedOut: false }, "test");
                expect(fb?.text).toContain("[auto-test]");
                expect(fb?.text).toContain("never weaken");
        });
        test("long output is clipped with a marker and keeps head and tail", () => {
                const output = `${"a".repeat(500)}\nTHE-VERDICT-NEAR-HEAD${"b".repeat(10_000)}THE-TAIL`;
                const fb = formatCheckFeedback({ command: "x", exitCode: 1, output, timedOut: false }, "verify");
                expect(fb?.text).toContain("chars clipped");
                expect(fb?.text).toContain("THE-VERDICT-NEAR-HEAD");
                expect(fb?.text).toContain("THE-TAIL");
                expect((fb?.text ?? "").length).toBeLessThan(6_000);
        });
});

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------
describe("createAutoVerifyRunner", () => {
        test("a failing check produces error feedback; a pass is silent; cooldown throttles", async () => {
                const spawn = fakeSpawn({
                        "npm run typecheck": { command: "npm run typecheck", exitCode: 2, output: "error TS2345", timedOut: false },
                });
                let now = 1_000;
                const runner = createAutoVerifyRunner("/proj", { spawnImpl: spawn, checks: CHECKS, env: {}, now: () => now });
                const fb = await runner.feedbackFor("/proj/src/a.ts");
                expect(fb?.isError).toBe(true);
                expect(fb?.text).toContain("npm run typecheck");
                expect(spawn.calls).toHaveLength(1);
                // immediate second edit → cooldown → no second run, no feedback
                expect(await runner.feedbackFor("/proj/src/b.ts")).toBeNull();
                expect(spawn.calls).toHaveLength(1);
                // past the default cooldown → the check runs again (the fake still
                // fails it, so the feedback comes back)
                now += DEFAULT_VERIFY_COOLDOWN_MS + 1;
                const fb2 = await runner.feedbackFor("/proj/src/b.ts");
                expect(fb2?.isError).toBe(true);
                expect(spawn.calls).toHaveLength(2);
        });

        test("a passing check never appends feedback", async () => {
                const spawn = fakeSpawn({
                        "npm run typecheck": { command: "npm run typecheck", exitCode: 0, output: "clean", timedOut: false },
                });
                const runner = createAutoVerifyRunner("/proj", { spawnImpl: spawn, checks: CHECKS, env: {} });
                expect(await runner.feedbackFor("/proj/src/a.ts")).toBeNull();
        });

        test("doc-only paths never spawn", async () => {
                const spawn = fakeSpawn({});
                const runner = createAutoVerifyRunner("/proj", { spawnImpl: spawn, checks: CHECKS, env: {} });
                expect(await runner.feedbackFor("/proj/README.md")).toBeNull();
                expect(await runner.feedbackFor("/proj/docs/notes.txt")).toBeNull();
                expect(spawn.calls).toHaveLength(0);
                expect(isSkippableDocPath("/proj/src/a.ts")).toBe(false);
        });

        test("UNOWN_AUTO_VERIFY=0 silences the fast lane; UNOWN_AUTO_TEST=1 runs the test lane", async () => {
                const spawn = fakeSpawn({
                        "npm test": { command: "npm test", exitCode: 1, output: "1 failing", timedOut: false },
                });
                const runner = createAutoVerifyRunner("/proj", {
                        spawnImpl: spawn,
                        checks: CHECKS,
                        env: { [AUTO_VERIFY_ENV]: "0", [AUTO_TEST_ENV]: "1" },
                });
                const fb = await runner.feedbackFor("/proj/src/a.ts");
                expect(fb?.isError).toBe(true);
                expect(fb?.text).toContain("[auto-test]");
                expect(spawn.calls.map((c) => c.command)).toEqual(["npm test"]);
        });

        test("both lanes failing produce one concatenated feedback", async () => {
                const spawn = fakeSpawn({
                        "npm run typecheck": { command: "npm run typecheck", exitCode: 2, output: "TS error", timedOut: false },
                        "npm test": { command: "npm test", exitCode: 1, output: "test failed", timedOut: false },
                });
                const runner = createAutoVerifyRunner("/proj", {
                        spawnImpl: spawn,
                        checks: CHECKS,
                        env: { [AUTO_TEST_ENV]: "1" },
                });
                const fb = await runner.feedbackFor("/proj/src/a.ts");
                expect(fb?.isError).toBe(true);
                expect(fb?.text).toContain("[auto-verify]");
                expect(fb?.text).toContain("[auto-test]");
        });

        test("an infra failure (127) disables the gate for the rest of the session", async () => {
                const spawn = fakeSpawn({
                        "npm run typecheck": { command: "npm run typecheck", exitCode: 127, output: "not found", timedOut: false },
                });
                let now = 0;
                const runner = createAutoVerifyRunner("/proj", { spawnImpl: spawn, checks: CHECKS, env: {}, now: () => now });
                expect(await runner.feedbackFor("/proj/a.ts")).toBeNull(); // infra → silent + disable
                expect(runner.state.disabledReason).toContain("not found");
                now = 9_999_999; // far past every cooldown
                expect(await runner.feedbackFor("/proj/a.ts")).toBeNull();
                expect(spawn.calls).toHaveLength(1);
        });

        test("bash-policy-blocked check commands are never spawned", async () => {
                const spawn = fakeSpawn({});
                const evil: ProjectChecks = { typecheck: "git push origin main", lint: null, test: null, sources: ["package.json"] };
                const runner = createAutoVerifyRunner("/proj", { spawnImpl: spawn, checks: evil, env: {} });
                expect(await runner.feedbackFor("/proj/a.ts")).toBeNull();
                expect(spawn.calls).toHaveLength(0);
        });

        test("a timeout is silent but still records the run (no hammering)", async () => {
                const spawn = fakeSpawn({
                        "npm run typecheck": { command: "npm run typecheck", exitCode: 143, output: "", timedOut: true },
                });
                const runner = createAutoVerifyRunner("/proj", { spawnImpl: spawn, checks: CHECKS, env: {} });
                expect(await runner.feedbackFor("/proj/a.ts")).toBeNull();
                expect(runner.state.lastVerifyMs).not.toBeNull();
        });

        test("no detectable checks → the runner never spawns", async () => {
                const spawn = fakeSpawn({});
                const none: ProjectChecks = { typecheck: null, lint: null, test: null, sources: [] };
                const runner = createAutoVerifyRunner("/proj", { spawnImpl: spawn, checks: none, env: { [AUTO_TEST_ENV]: "1" } });
                expect(await runner.feedbackFor("/proj/a.ts")).toBeNull();
                expect(spawn.calls).toHaveLength(0);
        });

        test("the fast lane prefers typecheck over lint", async () => {
                const spawn = fakeSpawn({});
                const lintOnly: ProjectChecks = { typecheck: null, lint: "npm run lint", test: null, sources: ["package.json"] };
                const withBoth: ProjectChecks = { typecheck: "npm run typecheck", lint: "npm run lint", test: null, sources: ["package.json"] };
                const r1 = createAutoVerifyRunner("/proj", { spawnImpl: spawn, checks: lintOnly, env: {} });
                await r1.feedbackFor("/proj/a.ts");
                expect(spawn.calls.map((c) => c.command)).toEqual(["npm run lint"]);
                const r2 = createAutoVerifyRunner("/proj", { spawnImpl: spawn, checks: withBoth, env: {} });
                await r2.feedbackFor("/proj/a.ts");
                expect(spawn.calls.map((c) => c.command)).toEqual(["npm run lint", "npm run typecheck"]);
        });
});

// ---------------------------------------------------------------------------
// Policy seed (verify-first defaults)
// ---------------------------------------------------------------------------
const POLICY_SEED_V1_TEXT = `# Tier 0 — Policy (non-negotiable guardrails)

- Never delete or overwrite files outside the current working directory.
- Always verify your work by running the available tests / build before declaring success.
- Keep changes minimal: do exactly what the task asks for.
- Never edit tests to make them pass; fix the root cause instead.
`;

describe("policy seed (verify-first defaults)", () => {
        test("the shipped seed carries the verify-first pair", () => {
                expect(POLICY_SEED).toContain("Read a file before editing it");
                expect(POLICY_SEED).toContain("never report success with a failing check");
        });

        test("refreshSeedPolicyAt upgrades a pristine v1 seed exactly once", () => {
                const dir = mkdtempSync(join(tmpdir(), "unown-policy-"));
                cleanups.push(dir);
                const p = join(dir, "policy.md");
                writeFileSync(p, POLICY_SEED_V1_TEXT, "utf8");
                expect(refreshSeedPolicyAt(p)).toBe(true);
                expect(readFileSync(p, "utf8")).toBe(POLICY_SEED);
                expect(refreshSeedPolicyAt(p)).toBe(false); // idempotent — already current
        });

        test("refreshSeedPolicyAt never touches a user-edited policy", () => {
                const dir = mkdtempSync(join(tmpdir(), "unown-policy-"));
                cleanups.push(dir);
                const p = join(dir, "policy.md");
                const edited = `${POLICY_SEED_V1_TEXT}- MY OWN ENTERPRISE RULE\n`;
                writeFileSync(p, edited, "utf8");
                expect(refreshSeedPolicyAt(p)).toBe(false);
                expect(readFileSync(p, "utf8")).toBe(edited);
        });

        test("refreshSeedPolicyAt: missing file → false, no side effects", () => {
                const dir = mkdtempSync(join(tmpdir(), "unown-policy-"));
                cleanups.push(dir);
                expect(refreshSeedPolicyAt(join(dir, "policy.md"))).toBe(false);
        });
});
