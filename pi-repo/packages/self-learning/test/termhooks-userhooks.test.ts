// termhooks-userhooks.test.ts — the Milestone 1 user-configurable hooks
// wired into TERMINAL sessions (docs/BEHAVIOR.md: handlers in
// `.unown/hooks.json` + `~/.unown/agent/hooks.json` ride on top of the
// built-in policies in every session — engine runs and terminal alike).
//
// Pins the wiring (not the handler runners — hooks-config.test.ts owns
// those): the pi event seams dispatch to loaded handlers, the decision
// mapping matches the engine contract (deny/stop block, mutate rewrites
// input, PostToolUse feedback surfaces to the model), the refuse-first
// trust gate withholds an untrusted project hooks.json, `/hooks trust`
// reloads it, the standalone emitters reach the runtime, and the
// file-gated adversary rides the bridge callLlm lane.
//
// Command-handler payloads spawn real shells: those tests are skipped on
// win32 (same SHELL_EXTERNALS posture as hooks-config.test.ts — bun's
// Windows spawn semantics with detached+shell are tracked there).
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { TEST_TMP } from "./_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTerminalExtension, emitTerminalHookEvent } from "../src/termhooks.ts";

const SHELL_EXTERNALS = process.platform !== "win32";

// Isolated fixture project + user config dir (UNOWN_HOME override gives the
// adversary gate file + trust state a scratch home; UNOWN_HOME is read at
// call time by adversary.ts:resolveConfigDir and term.ts:resolveUnownHome).
const FIX = join(TEST_TMP, "termhooks-userhooks");
const PROJ = join(FIX, "proj");
const HOME = join(FIX, "home");

mkdirSync(PROJ, { recursive: true });
mkdirSync(HOME, { recursive: true });

// Env save/restore: UNOWN_TRUST_PROJECT_CONFIG flips per test; UNOWN_HOME
// and PI_BRIDGE_URL are overridden for the whole file and restored after.
const SAVED: Record<string, string | undefined> = {};
const ENV_KEYS = ["UNOWN_TRUST_PROJECT_CONFIG", "UNOWN_HOME", "PI_BRIDGE_URL", "UNOWN_ADVERSARY"];
for (const k of ENV_KEYS) SAVED[k] = process.env[k];
afterAll(() => {
        for (const k of ENV_KEYS) {
                if (SAVED[k] === undefined) delete process.env[k];
                else process.env[k] = SAVED[k];
        }
        rmSync(FIX, { recursive: true, force: true });
});

/** Marker file the command handlers append to (their observable effect). */
const MARK = join(FIX, "marker.log");
beforeAll(() => {
        rmSync(MARK, { force: true });
});
const readMark = () => (existsSync(MARK) ? readFileSync(MARK, "utf8") : "");

/** A captured handler invoker: fake pi with on() + registerCommand(). */
type Handler = (event?: any, ctx?: any) => any;
function attach(projectDir = PROJ) {
        const handlers: Record<string, Handler> = {};
        const commands: Record<string, Handler> = {};
        const ext = createTerminalExtension({ cwd: projectDir, engineUrl: "http://127.0.0.1:3030" });
        ext.factory({
                on: (name: string, handler: Handler) => {
                        handlers[name] = handler;
                },
                registerCommand: (name: string, def: { handler: Handler }) => {
                        commands[name] = def.handler;
                },
        } as any);
        return { handlers, commands };
}

function writeProjectHooks(cfg: unknown) {
        mkdirSync(join(PROJ, ".unown"), { recursive: true });
        writeFileSync(join(PROJ, ".unown", "hooks.json"), JSON.stringify(cfg));
}

// ---------------------------------------------------------------------------
// Trust gate: refuse-first until approved (same UX as mcp.json)
// ---------------------------------------------------------------------------
describe("terminal user hooks — trust gate", () => {
        test("an UNTRUSTED project hooks.json contributes NOTHING (refuse-first)", async () => {
                delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
                writeProjectHooks({
                        version: 1,
                        hooks: {
                                PreToolUse: [{ type: "command", matcher: "bash", command: `echo denied-path >> ${JSON.stringify(MARK)}` }],
                        },
                });
                const { handlers } = attach();
                const decision = await handlers["tool_call"]({ toolName: "bash", input: { command: "ls" } });
                expect(decision).toBeUndefined(); // allowed, hook withheld
                expect(readMark()).not.toContain("denied-path");
        });

        test("UNOWN_TRUST_PROJECT_CONFIG=1 (CI bypass) loads the project config", async () => {
                rmSync(MARK, { force: true });
                process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
                writeProjectHooks({
                        version: 1,
                        hooks: {
                                SessionStart: [{ type: "command", command: `echo session-start >> ${JSON.stringify(MARK)}` }],
                        },
                });
                const { handlers } = attach();
                await handlers["session_start"]({}, { ui: { notify: () => {} } });
                expect(readMark()).toContain("session-start");
                delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        });
});

// ---------------------------------------------------------------------------
// PreToolUse: deny + allow + mutate through the extension seam
// ---------------------------------------------------------------------------
describe("terminal user hooks — PreToolUse", () => {
        test.skipIf(!SHELL_EXTERNALS)("exit-2 command handler blocks the tool call", async () => {
                process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
                writeProjectHooks({
                        version: 1,
                        hooks: {
                                PreToolUse: [
                                        {
                                                type: "command",
                                                matcher: "bash",
                                                command: `echo "hook says no" >&2; exit 2`,
                                        },
                                ],
                        },
                });
                const { handlers } = attach();
                const decision = await handlers["tool_call"]({ toolName: "bash", input: { command: "ls" } });
                expect(decision?.block).toBe(true);
                expect(decision?.reason).toContain("hook says no");
                delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        });

        test.skipIf(!SHELL_EXTERNALS)("mutate rewrites the tool input (engine contract parity)", async () => {
                process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
                writeProjectHooks({
                        version: 1,
                        hooks: {
                                PreToolUse: [
                                        {
                                                type: "command",
                                                matcher: "bash",
                                                command: `echo '{"decision":"mutate","mutatedInput":{"command":"ls -la"}}'`,
                                        },
                                ],
                        },
                });
                const { handlers } = attach();
                const event = { toolName: "bash", input: { command: "ls" } };
                const decision = await handlers["tool_call"](event);
                expect(decision).toBeUndefined(); // allowed
                expect(event.input).toEqual({ command: "ls -la" }); // mutated in place
                delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        });

        test.skipIf(!SHELL_EXTERNALS)("matcher scopes the handler to the named tool", async () => {
                process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
                writeProjectHooks({
                        version: 1,
                        hooks: {
                                PreToolUse: [
                                        {
                                                type: "command",
                                                matcher: "write",
                                                command: `echo "write-hook" >&2; exit 2`,
                                        },
                                ],
                        },
                });
                const { handlers } = attach();
                const bashDecision = await handlers["tool_call"]({ toolName: "bash", input: { command: "ls" } });
                expect(bashDecision).toBeUndefined(); // not the matcher — inert for bash
                delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        });

        test.skipIf(!SHELL_EXTERNALS)("a deny funnels through PermissionRequest (standalone emitter)", async () => {
                rmSync(MARK, { force: true });
                process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
                writeProjectHooks({
                        version: 1,
                        hooks: {
                                PreToolUse: [{ type: "command", matcher: "bash", command: `exit 2` }],
                                PermissionRequest: [{ type: "command", command: `echo "permission:{{tool}}" >> ${JSON.stringify(MARK)}` }],
                        },
                });
                const { handlers } = attach();
                const decision = await handlers["tool_call"]({ toolName: "bash", input: { command: "ls" } });
                expect(decision?.block).toBe(true);
                // emitTerminalHookEvent is fire-and-forget; give the spawned
                // command a beat to land its marker, then assert.
                for (let i = 0; i < 50 && !readMark().includes("permission:"); i++) await Bun.sleep(20);
                expect(readMark()).toContain("permission:bash");
                delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        });
});

// ---------------------------------------------------------------------------
// PostToolUse: feedback/warning/error outputs surface to the model
// ---------------------------------------------------------------------------
describe("terminal user hooks — PostToolUse", () => {
        test.skipIf(!SHELL_EXTERNALS)("feedback output is appended to the tool result", async () => {
                process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
                writeProjectHooks({
                        version: 1,
                        hooks: {
                                PostToolUse: [
                                        {
                                                type: "command",
                                                command: `echo '{"decision":"allow","outputs":[{"kind":"feedback","message":"post-hook says hi"}]}'`,
                                        },
                                ],
                        },
                });
                const { handlers } = attach();
                const result = await handlers["tool_result"]({
                        toolName: "bash",
                        input: { command: "ls" },
                        content: [{ type: "text", text: "file-a\nfile-b" }],
                });
                expect(result?.content?.some?.((b: any) => b.text === "[PostToolUse:hook:feedback] post-hook says hi")).toBe(true);
                delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        });

        test.skipIf(!SHELL_EXTERNALS)("an error output flags the result isError", async () => {
                process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
                writeProjectHooks({
                        version: 1,
                        hooks: {
                                PostToolUse: [
                                        {
                                                type: "command",
                                                command: `echo '{"decision":"allow","outputs":[{"kind":"error","message":"post-hook exploded"}]}'`,
                                        },
                                ],
                        },
                });
                const { handlers } = attach();
                const result = await handlers["tool_result"]({
                        toolName: "bash",
                        input: { command: "ls" },
                        content: [{ type: "text", text: "ok" }],
                });
                expect(result?.isError).toBe(true);
                expect(result?.content?.some?.((b: any) => b.text.includes("post-hook exploded"))).toBe(true);
                delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        });

        test("with no handlers the tool result passes through untouched (baseline)", async () => {
                delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
                rmSync(join(PROJ, ".unown"), { recursive: true, force: true });
                const { handlers } = attach();
                const result = await handlers["tool_result"]({
                        toolName: "bash",
                        input: { command: "ls" },
                        content: [{ type: "text", text: "plain" }],
                });
                expect(result).toBeUndefined();
        });
});

// ---------------------------------------------------------------------------
// Standalone emitters + remaining pi seams
// ---------------------------------------------------------------------------
describe("terminal user hooks — standalone emitters + event seams", () => {
        test.skipIf(!SHELL_EXTERNALS)("emitTerminalHookEvent dispatches SubagentStart to loaded handlers", async () => {
                rmSync(MARK, { force: true });
                process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
                writeProjectHooks({
                        version: 1,
                        hooks: {
                                SubagentStart: [
                                        { type: "command", command: `echo "subagent:{{context.agent}}" >> ${JSON.stringify(MARK)}` },
                                ],
                                TaskCompleted: [{ type: "command", command: `echo "task:{{context.status}}" >> ${JSON.stringify(MARK)}` }],
                        },
                });
                attach(); // publishes the runtime module-level
                await emitTerminalHookEvent("SubagentStart", {
                        name: "SubagentStart",
                        tool: "task",
                        context: { agent: "general", description: "explore the tree" },
                });
                for (let i = 0; i < 50 && !readMark().includes("subagent:general"); i++) await Bun.sleep(20);
                expect(readMark()).toContain("subagent:general");
                // TaskCompleted has no handler-shape guarantee about ordering;
                // the terminal emitter contract is fire-and-forget like the
                // engine's receipts path.
                delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        });

        test("emitTerminalHookEvent is a no-op with no runtime published", async () => {
                rmSync(join(PROJ, ".unown"), { recursive: true, force: true });
                attach(); // no hooks anywhere → no runtime
                await emitTerminalHookEvent("SubagentStart", { name: "SubagentStart" });
                // reached without throwing — that IS the contract
        });

        test.skipIf(!SHELL_EXTERNALS)("UserPromptSubmit receives the prompt text", async () => {
                rmSync(MARK, { force: true });
                process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
                writeProjectHooks({
                        version: 1,
                        hooks: {
                                UserPromptSubmit: [{ type: "command", command: `echo "prompt:{{prompt}}" >> ${JSON.stringify(MARK)}` }],
                        },
                });
                const { handlers } = attach();
                await handlers["input"]({ text: "fix the flaky auth test" });
                for (let i = 0; i < 50 && !readMark().includes("prompt:"); i++) await Bun.sleep(20);
                expect(readMark()).toContain("prompt:fix the flaky auth test");
                delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        });

        test.skipIf(!SHELL_EXTERNALS)("Stop fires on agent_end", async () => {
                rmSync(MARK, { force: true });
                process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
                writeProjectHooks({
                        version: 1,
                        hooks: {
                                Stop: [{ type: "command", command: `echo "stopped" >> ${JSON.stringify(MARK)}` }],
                        },
                });
                const { handlers } = attach();
                await handlers["agent_end"]({ messages: [] });
                for (let i = 0; i < 50 && !readMark().includes("stopped"); i++) await Bun.sleep(20);
                expect(readMark()).toContain("stopped");
                delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        });

        test.skipIf(!SHELL_EXTERNALS)("session_start surfaces the untrusted-hooks notice (refuse-first UX)", async () => {
                delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
                writeProjectHooks({
                        version: 1,
                        hooks: { SessionStart: [{ type: "command", command: `echo "must-not-run" >> ${JSON.stringify(MARK)}` }] },
                });
                const notices: Array<{ text: string; level: string }> = [];
                const { handlers } = attach();
                await handlers["session_start"]({}, { ui: { notify: (text: string, level: string) => notices.push({ text, level }) } });
                expect(notices.some((n) => n.text.includes(".unown/hooks.json") && n.text.includes("UNTRUSTED"))).toBe(true);
                expect(notices.some((n) => n.text.includes("/hooks trust"))).toBe(true);
                expect(readMark()).not.toContain("must-not-run");
        });
});

// ---------------------------------------------------------------------------
// Adversary mode (M1.4) — file-gated, rides the bridge callLlm lane
// ---------------------------------------------------------------------------
describe("terminal user hooks — adversary mode over the bridge", () => {
        let server: any;
        let port = 0;
        beforeAll(async () => {
                server = Bun.serve({
                        port: 0,
                        fetch: async () =>
                                new Response(
                                        JSON.stringify({
                                                choices: [{ message: { role: "assistant", content: "BLOCK: the policy forbids this" } }],
                                        }),
                                        { headers: { "Content-Type": "application/json" } },
                                ),
                });
                port = server.port;
        });
        afterAll(() => {
                server?.stop?.(true);
        });

        test("gate file absent → the adversary is inert (no-regression pin)", async () => {
                process.env.UNOWN_HOME = HOME;
                process.env.PI_BRIDGE_URL = `http://127.0.0.1:${port}`;
                // adversary.ts:resolveConfigDir treats UNOWN_HOME as the config
                // dir itself: with it set the gate file is ${UNOWN_HOME}/adversary.md
                rmSync(join(HOME, "adversary.md"), { force: true });
                rmSync(join(HOME, ".config", "unown", "adversary.md"), { force: true });
                const { handlers } = attach();
                const decision = await handlers["tool_call"]({ toolName: "bash", input: { command: "ls" } });
                expect(decision).toBeUndefined(); // gate closed — straight through
        });

        test("gate file present → the reviewer's BLOCK denies the call via the bridge", async () => {
                writeFileSync(
                        join(HOME, "adversary.md"),
                        "# Adversary policy\n\nBlock anything touching the forbidden zone.\n",
                );
                const { handlers } = attach();
                const decision = await handlers["tool_call"]({ toolName: "bash", input: { command: "ls" } });
                expect(decision?.block).toBe(true);
                expect(decision?.reason).toContain("policy forbids this");
                rmSync(join(HOME, "adversary.md"), { force: true });
        });

        test("bridge down → the adversary fails OPEN (built-in policies already passed)", async () => {
                writeFileSync(join(HOME, "adversary.md"), "# Adversary policy\n\nBlock nothing real.\n");
                process.env.PI_BRIDGE_URL = "http://127.0.0.1:1"; // nothing listens here
                const { handlers } = attach();
                const decision = await handlers["tool_call"]({ toolName: "bash", input: { command: "ls" } });
                expect(decision).toBeUndefined(); // fail-open
                rmSync(join(HOME, "adversary.md"), { force: true });
        });
});
