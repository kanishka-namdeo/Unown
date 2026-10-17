// CLI golden tests — Phase 3, docs/testing-strategy.md §4.3 "Non-interactive
// golden tests" (first wave).
//
// Every test spawns the REAL bin/unown (bun shebang) with /dev/null stdin, a
// private UNOWN_HOME per run, a private project cwd and a private SQLite
// path, against the local mock bridge from ./helpers.ts. No live service
// (engine :3030, bridge :3031) is ever contacted: the engine URL defaults to
// a dead loopback port so session notes queue in the run's own outbox.
//
// What is pinned here (and where drift would show):
//   1. first-run seeding + never-clobber (doctor / print boot)
//   2. `unown setup --force` rewrite vs. no-force refusal (byte-identical)
//   3. `unown memory` 4-tier stack incl. tier source paths
//   4. `unown doctor` classification: chat path dead = hard fail (exit 1);
//      engine/bwrap problems = warnings, exit 0 (documented contract,
//      docs/usage.md "It exits 1 when chat is broken; warnings only affect
//      learning features")
//   5. `unown -p "…" --mode json`: exit 0, parseable JSONL, message_end with
//      token counts, stderr carries diagnostics only (no JSON, no stream)
//   6. `unown --plan -p …`: edit/write/task removed from the request toolset;
//      bash restricted to the read-only allowlist end-to-end
//   7. UNOWN_NO_PREFLIGHT=1 skips the probe; UNOWN_SUBAGENT=1 drops the task
//      tool (both asserted via observable behavior: chat requests + events)
//   8. two concurrent sessions with separate UNOWN_HOME produce independent
//      outbox notes
//
// Spawned CLI runs take seconds each — every test carries an explicit bun
// timeout well above the default 5s.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
        agentFile,
        type MockBridge,
        parseJsonl,
        startMockBridge,
        unown,
        sweepTestRoots,
        type UnownRunResult,
        type UnownRunOptions,
        runUnown,
        outboxNotes,
} from "./helpers.ts";

const STARTER_SKILLS = ["unown-self-learning", "verification-first", "methodical-debugging", "repo-exploration"];
const LONG = { timeout: 150_000 } as const; // spawned CLI runs take seconds

let bridge: MockBridge;
let authBridge: MockBridge; // /v1/models → 401 (credentials rejected)

beforeAll(() => {
        bridge = startMockBridge();
        authBridge = startMockBridge({ modelsStatus: 401 });
});

afterAll(() => {
        bridge?.close();
        authBridge?.close();
        sweepTestRoots(); // golden tests keep their roots until assertions are done
});

const base = (extra: Partial<UnownRunOptions> = {}): UnownRunOptions => ({ bridge, ...extra });

// ---------------------------------------------------------------------------
// 1. First-run seeding + never-clobber
// ---------------------------------------------------------------------------
describe("CLI golden — first-run seeding", () => {
        test(
                "unown doctor on an empty UNOWN_HOME seeds models.json/settings/skills and exits 0",
                async () => {
                        const run = await unown(["doctor"], base());
                        expect(run.exitCode).toBe(0);

                        // models.json: bundled bridge defaults (docs/usage.md §first run)
                        const models = JSON.parse(agentFile(run, "models.json") ?? "{}");
                        expect(models.providers["zai-bridge"]).toBeDefined();
                        expect(models.providers["zai-bridge"].baseUrl).toBe(`${bridge.url}/v1`);
                        expect(models.providers["zai-bridge"].api).toBe("openai-completions");
                        expect(models.providers["zai-bridge"].apiKey).toBe("bridge-local");
                        expect(models.providers["zai-bridge"].models[0]).toMatchObject({ id: "kimi-k2.5", input: ["text", "image"] });

                        // settings.json: pinned defaults (no first-run picker)
                        const settings = JSON.parse(agentFile(run, "settings.json") ?? "{}");
                        expect(settings).toMatchObject({ defaultProvider: "zai-bridge", defaultModel: "kimi-k2.5", theme: "unown" });

                        // auth.json placeholder + sessions dir + starter skills + theme
                        expect(agentFile(run, "auth.json")).toBe("{}");
                        expect(existsSync(join(run.unownHome, "agent", "sessions"))).toBe(true);
                        for (const skill of STARTER_SKILLS) {
                                expect(existsSync(join(run.unownHome, "agent", "skills", skill, "SKILL.md"))).toBe(true);
                        }
                        expect(existsSync(join(run.unownHome, "agent", "themes", "unown.json"))).toBe(true);

                        // doctor output: chat path green, engine down = warning (dead engine URL)
                        expect(run.stdout).toContain("✓ agent dir");
                        expect(run.stdout).toContain("✓ model provider configured");
                        expect(run.stdout).toContain("✓ model endpoint reachable");
                        expect(run.stdout).toContain("⚠ self-learning engine");
                        expect(run.stdout).toContain("✓ unown is ready to chat");
                },
                LONG,
        );

        test(
                "second invocation never clobbers user-modified models.json/settings.json",
                async () => {
                        const root = join(await import("node:os").then((os) => os.tmpdir()), `unown-cli-noclobber-${Date.now()}`);
                        try {
                                const opts = base({ root });
                                const first = await runUnown(["doctor"], opts);
                                expect(first.exitCode).toBe(0);

                                // User edits after the first run (docs/configuration.md: "the
                                // first-run bootstrap never clobbers an existing file").
                                const modelsPath = join(first.unownHome, "agent", "models.json");
                                const settingsPath = join(first.unownHome, "agent", "settings.json");
                                const models = JSON.parse(readFileSync(modelsPath, "utf8"));
                                models.providers["zai-bridge"].models[0].id = "user-model";
                                writeFileSync(modelsPath, `${JSON.stringify(models, null, 2)}\n`, "utf8");
                                const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
                                settings.defaultModel = "user-model";
                                settings.userKey = "keep-me";
                                writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
                                const userModels = readFileSync(modelsPath, "utf8");
                                const userSettings = readFileSync(settingsPath, "utf8");

                                const second = await runUnown(["doctor"], opts);
                                expect(second.exitCode).toBe(0);
                                expect(readFileSync(modelsPath, "utf8")).toBe(userModels);
                                expect(readFileSync(settingsPath, "utf8")).toBe(userSettings);
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );

        test(
                "PINNED BEHAVIOR: unown memory scaffolds project+user memory but does NOT seed the agent dir",
                async () => {
                        const run = await unown(["memory"], base());
                        expect(run.exitCode).toBe(0);
                        expect(existsSync(join(run.unownHome, "agent", "models.json"))).toBe(false);
                        expect(existsSync(join(run.projDir, ".unown", "memory", "project.md"))).toBe(true);
                        expect(existsSync(join(run.projDir, ".unown", "memory", "local.md"))).toBe(true);
                        expect(existsSync(join(run.unownHome, "memory", "user.md"))).toBe(true);
                },
                LONG,
        );
});

// ---------------------------------------------------------------------------
// 2. unown setup
// ---------------------------------------------------------------------------
describe("CLI golden — unown setup", () => {
        test(
                "setup --force rewrites models.json, stores the key in auth.json (0600), merges settings",
                async () => {
                        const run = await unown(
                                [
                                        "setup",
                                        "--provider",
                                        "openai",
                                        "--base-url",
                                        `${bridge.url}/v1`,
                                        "--api-key",
                                        "sk-golden-test",
                                        "--model",
                                        "golden-model",
                                        "--force",
                                ],
                                base(),
                        );
                        expect(run.exitCode).toBe(0);
                        expect(run.stdout).toContain("✓ configured openai");

                        const models = JSON.parse(agentFile(run, "models.json") ?? "{}");
                        expect(Object.keys(models.providers)).toEqual(["openai"]);
                        expect(models.providers.openai.baseUrl).toBe(`${bridge.url}/v1`);
                        expect(models.providers.openai.models[0].id).toBe("golden-model");
                        // keys for direct providers live in auth.json, NOT models.json
                        expect(models.providers.openai.apiKey).toBeUndefined();

                        const auth = JSON.parse(agentFile(run, "auth.json") ?? "{}");
                        expect(auth.openai).toEqual({ type: "api_key", key: "sk-golden-test" });
                        // chmod is a no-op on win32 (documented in src/setup.ts — NTFS
                        // relies on ACLs); the 0600 golden is POSIX-only.
                        if (process.platform !== "win32") {
                                expect(statSync(join(run.unownHome, "agent", "auth.json")).mode & 0o777).toBe(0o600);
                        }

                        const settings = JSON.parse(agentFile(run, "settings.json") ?? "{}");
                        expect(settings).toMatchObject({ defaultProvider: "openai", defaultModel: "golden-model" });
                },
                LONG,
        );

        test(
                "setup WITHOUT --force exits non-zero and leaves all agent files byte-identical",
                async () => {
                        const root = join(await import("node:os").then((os) => os.tmpdir()), `unown-cli-noforce-${Date.now()}`);
                        try {
                                const opts = base({ root });
                                const seed = await runUnown(["doctor"], opts); // seeds models.json + settings.json
                                expect(seed.exitCode).toBe(0);

                                const files = ["models.json", "settings.json", "auth.json"] as const;
                                const before = new Map(files.map((f) => [f, agentFile(seed, f)]));

                                const attempt = await runUnown(
                                        ["setup", "--provider", "openai", "--base-url", `${bridge.url}/v1`, "--api-key", "k", "--model", "m"],
                                        opts,
                                );
                                expect(attempt.exitCode).not.toBe(0);
                                expect(attempt.stderr).toContain("already exists");
                                expect(attempt.stderr).toContain("--force");

                                for (const f of files) {
                                        expect(agentFile(attempt, f)).toBe(before.get(f));
                                }
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );
});

// ---------------------------------------------------------------------------
// 3. unown memory — the 4-tier stack with per-tier source labels
// ---------------------------------------------------------------------------
describe("CLI golden — unown memory", () => {
        test("prints all four tiers with their source paths and exits 0", async () => {
                const run = await unown(["memory"], base());
                expect(run.exitCode).toBe(0);
                const out = run.stdout;
                expect(out).toContain("【POLICY】");
                expect(out).toContain("memory/tier0-policy.md (enterprise policy — highest authority)");
                expect(out).toContain("【PROJECT】");
                expect(out).toContain(".unown/memory/project.md (project memory — maintained by AutoDream & you)");
                expect(out).toContain("【USER】");
                expect(out).toContain("memory/tier2-user.md (user memory — global preferences)");
                expect(out).toContain("【LOCAL】");
                expect(out).toContain(".unown/memory/local.md (local overrides — highest precedence)");
        }, LONG);
});

// ---------------------------------------------------------------------------
// 4. unown doctor classification
// ---------------------------------------------------------------------------
describe("CLI golden — unown doctor classification", () => {
        test("chat path unreachable (dead port) is a HARD failure: exit 1", async () => {
                const run = await unown(["doctor"], base({ bridgeUrl: "http://127.0.0.1:9" }));
                expect(run.exitCode).toBe(1);
                expect(run.stdout).toContain("✗ model endpoint reachable");
                expect(run.stdout).toContain("unown cannot chat yet");
        }, LONG);

        test("engine unreachable is a WARNING only: exit 0, chat still ready", async () => {
                // bridge (chat path) healthy; engine URL defaults to the dead port.
                const run = await unown(["doctor"], base());
                expect(run.exitCode).toBe(0);
                expect(run.stdout).toContain("⚠ self-learning engine");
                expect(run.stdout).toContain("notes queue");
                expect(run.stdout).toContain("✓ unown is ready to chat");
        }, LONG);
});

// ---------------------------------------------------------------------------
// 5. Headless print mode (--mode json)
// ---------------------------------------------------------------------------
describe("CLI golden — headless print mode", () => {
        test(
                "-p … --mode json: exit 0, parseable JSONL, message_end with token counts, clean stdout",
                async () => {
                        const run = await unown(["-p", "say hi", "--mode", "json"], base());
                        expect(run.exitCode).toBe(0);

                        const events = parseJsonl(run.stdout); // throws if any line is not JSON
                        const types = events.map((e) => e.type);
                        expect(types).toContain("session"); // session header first line
                        expect(types).toContain("agent_start");
                        expect(types).toContain("message_start");
                        expect(types).toContain("message_update");
                        expect(types).toContain("message_end");
                        expect(types).toContain("agent_end");
                        expect(types).toContain("agent_settled");

                        // token counts present on the final assistant message
                        const assistantEnd = events.find((e) => e.type === "message_end" && e.message?.role === "assistant");
                        expect(assistantEnd).toBeDefined();
                        expect(assistantEnd!.message.usage.input).toBeGreaterThan(0);
                        expect(assistantEnd!.message.usage.output).toBeGreaterThan(0);
                        expect(assistantEnd!.message.stopReason).toBe("stop");

                        // stderr carries diagnostics only: no JSON events, no unreachable error
                        expect(run.stderr).not.toContain("unown: cannot reach the model endpoint");
                        expect(run.stderr).not.toContain("rejected the credentials");
                        for (const line of run.stderr.split("\n")) {
                                if (line.trim()) expect(line.trim().startsWith("{")).toBe(false);
                        }
                },
                LONG,
        );

        test("first-run banner appears once on stderr, not on the second run in the same home", async () => {
                const { tmpdir } = await import("node:os");
                const root = join(tmpdir(), `unown-cli-banner-${Date.now()}`);
                try {
                        const opts = base({ root });
                        const first = await runUnown(["-p", "one", "--mode", "json"], opts);
                        expect(first.exitCode).toBe(0);
                        expect(first.stderr).toContain("first run");
                        expect(first.stderr).toContain("unown setup");

                        const second = await runUnown(["-p", "two", "--mode", "json"], opts);
                        expect(second.exitCode).toBe(0);
                        expect(second.stderr).not.toContain("first run");
                } finally {
                        rmSync(root, { recursive: true, force: true });
                }
        }, LONG);
});

// ---------------------------------------------------------------------------
// 6. Plan mode
// ---------------------------------------------------------------------------
describe("CLI golden — plan mode", () => {
        test(
                "--plan removes edit/write/task from the request toolset (read-only exploration)",
                async () => {
                        const run = await unown(["--plan", "-p", "look around and plan", "--mode", "json"], base());
                        expect(run.exitCode).toBe(0);
                        const req = bridge.requests[bridge.requests.length - 1];
                        expect(req).toBeDefined();
                        expect(req.tools).not.toContain("edit");
                        expect(req.tools).not.toContain("write");
                        expect(req.tools).not.toContain("task");
                        for (const t of ["read", "bash", "grep", "find", "ls", "todo", "note", "fetch_url"]) {
                                expect(req.tools).toContain(t);
                        }
                },
                LONG,
        );

        // POSIX-bash e2e: the fixtures/commands below are POSIX bash semantics
        // (Windows e2e golden coverage lands with PowerShell-native fixtures —
        // follow-up).
        test.skipIf(
                process.platform === "win32",
        )(
                "--plan: safe bash command executes; a write-shaped command is refused by the plan allowlist",
                async () => {
                        // safe (read-only) command runs fine in plan mode
                        const safe = await unown(["--plan", "-p", 'TOOLCALL bash {"command":"ls -la"}', "--mode", "json"], base());
                        expect(safe.exitCode).toBe(0);
                        const safeEvents = parseJsonl(safe.stdout);
                        const safeEnd = safeEvents.find((e) => e.type === "tool_execution_end" && e.toolName === "bash");
                        expect(safeEnd).toBeDefined();
                        expect(safeEnd.isError).toBe(false);

                        // rm is not on the read-only allowlist → blocked with the plan reason
                        const risky = await unown(["--plan", "-p", 'TOOLCALL bash {"command":"rm -rf ./build"}', "--mode", "json"], base());
                        expect(risky.exitCode).toBe(0);
                        const riskyEvents = parseJsonl(risky.stdout);
                        const riskyEnd = riskyEvents.find((e) => e.type === "tool_execution_end" && e.toolName === "bash");
                        expect(riskyEnd).toBeDefined();
                        expect(riskyEnd.isError).toBe(true);
                        expect(JSON.stringify(riskyEnd.result?.content ?? "")).toContain("Plan mode");
                },
                LONG,
        );
});

// ---------------------------------------------------------------------------
// 7. Env knobs
// ---------------------------------------------------------------------------
describe("CLI golden — env knobs", () => {
        // POSIX-bash e2e: the bash tool spawn + deny-reason fixture below are
        // POSIX bash semantics (Windows e2e golden coverage lands with
        // PowerShell-native fixtures — follow-up).
        test.skipIf(
                process.platform === "win32",
        )(
                "terminal hooks deny a catastrophic bash tool call end-to-end (real CLI)",
                async () => {
                        const run = await unown(["-p", 'TOOLCALL bash {"command":"rm -rf /"}', "--mode", "json"], base());
                        expect(run.exitCode).toBe(0); // the session itself completes; the tool call is denied
                        const events = parseJsonl(run.stdout);
                        const end = events.find((e) => e.type === "tool_execution_end" && e.toolName === "bash");
                        expect(end).toBeDefined();
                        expect(end.isError).toBe(true);
                        expect(JSON.stringify(end.result?.content ?? "")).toContain("refusing rm on filesystem root");
                        // follow-up turn: the mock answers plain text after the tool result
                        const roles = bridge.requests[bridge.requests.length - 1].roles;
                        expect(roles).toContain("tool");
                },
                LONG,
        );

        test(
                "UNOWN_NO_PREFLIGHT=1 skips the probe (auth-rejecting endpoint)",
                async () => {
                        // Without the flag: pre-flight aborts with actionable guidance, no chat request.
                        const before = authBridge.requests.length;
                        const blocked = await unown(["-p", "hello", "--mode", "json"], base({ bridge: authBridge }));
                        expect(blocked.exitCode).toBe(1);
                        expect(blocked.stderr).toContain("rejected the credentials");
                        expect(blocked.stderr).toContain("unown setup");
                        // stdout stays clean for the JSON stream. (Pin: the blocked path
                        // emits exactly one trailing newline — no JSON events, no banner.
                        // parseJsonl-style consumers skip blank lines, so this is benign.)
                        expect(blocked.stdout.trim()).toBe("");
                        expect(authBridge.requests.length).toBe(before);

                        // With the flag: the probe is skipped and the chat round-trip happens.
                        // (A one-shot session issues TWO upstream chat calls — the main reply
                        // plus the session-summary generation — so assert "more", not an exact count.)
                        const passed = await unown(["-p", "hello", "--mode", "json"], base({ bridge: authBridge, env: { UNOWN_NO_PREFLIGHT: "1" } }));
                        expect(passed.exitCode).toBe(0);
                        expect(authBridge.requests.length).toBeGreaterThan(before);
                        expect(authBridge.requests.length).toBeGreaterThanOrEqual(before + 1);
                        const events = parseJsonl(passed.stdout);
                        expect(events.some((e) => e.type === "message_end" && e.message?.role === "assistant")).toBe(true);
                },
                LONG,
        );

        test(
                "UNOWN_SUBAGENT=1 suppresses the task tool (no subagent nesting)",
                async () => {
                        const plain = await unown(["-p", "tools please", "--mode", "json"], base());
                        expect(plain.exitCode).toBe(0);
                        const plainTools = bridge.requests[bridge.requests.length - 1].tools;
                        expect(plainTools).toContain("task");

                        const sub = await unown(["-p", "tools please", "--mode", "json"], base({ env: { UNOWN_SUBAGENT: "1" } }));
                        expect(sub.exitCode).toBe(0);
                        const subTools = bridge.requests[bridge.requests.length - 1].tools;
                        expect(subTools).not.toContain("task");
                        for (const t of ["read", "bash", "edit", "write", "todo", "note", "fetch_url"]) {
                                expect(subTools).toContain(t);
                        }
                },
                LONG,
        );
});

// ---------------------------------------------------------------------------
// 8. Parallel sessions
// ---------------------------------------------------------------------------
describe("CLI golden — parallel sessions", () => {
        test(
                "two concurrent sessions with separate UNOWN_HOME produce independent outbox notes",
                async () => {
                        const runs = await Promise.all([
                                runUnown(["-p", "session alpha reports its own project"], base()),
                                runUnown(["-p", "session beta reports its own project"], base()),
                        ]);
                        try {
                                for (const run of runs) {
                                        expect(run.exitCode).toBe(0);
                                        const notes = outboxNotes(run);
                                        expect(notes.length).toBeGreaterThanOrEqual(1);
                                        const content = notes.map((n) => readFileSync(join(run.unownHome, "notes", "outbox", n), "utf8")).join("\n");
                                        // The CLI realpaths its cwd (macOS: /var/folders ->
                                        // /private/var/folders) — compare against the physical path.
                                        expect(content).toContain(`Terminal session in ${realpathSync(run.projDir)}`);
                                }
                                // no stomping: alpha's home never saw beta's project path and
                                // vice versa — in either the literal or the realpath'd spelling
                                const alphaNote = readFileSync(join(runs[0].unownHome, "notes", "outbox", outboxNotes(runs[0])[0]), "utf8");
                                const betaNote = readFileSync(join(runs[1].unownHome, "notes", "outbox", outboxNotes(runs[1])[0]), "utf8");
                                expect(alphaNote).not.toContain(runs[1].projDir);
                                expect(alphaNote).not.toContain(realpathSync(runs[1].projDir));
                                expect(betaNote).not.toContain(runs[0].projDir);
                                expect(betaNote).not.toContain(realpathSync(runs[0].projDir));
                                expect(runs[0].unownHome).not.toBe(runs[1].unownHome);
                        } finally {
                                for (const run of runs) run.release();
                        }
                },
                LONG,
        );
});
