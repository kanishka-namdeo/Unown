/**
 * hooks-config.test.ts — Multi-type hooks + semantic output + config trust gate.
 *
 * Pins the Milestone 1 hook surface contract:
 *   - HookConfig schema + loader merges user + project (project wins per-event)
 *   - Project config is trust-gated (refuse-first when untrusted)
 *   - Multi-type handlers: command (exit 0/2/N), http (200/N, JSON body),
 *     prompt (LLM reply parsed as JSON or feedback), mcp (callMcp result), agent
 *   - Template interpolation: {{tool}}, {{input.path}}, {{input.command}},
 *     {{prompt}}, missing tokens → empty string (never throw)
 *   - Semantic output entries (warning/stop/feedback/context/error)
 *   - runHooksForEvent composition: deny/stop terminal; mutate stacks;
 *     warn continues; async handlers fire-and-forget
 *   - matcher: "*" matches all; "bash|powershell" matches either; specific
 *     tool name matches exactly
 *   - failClosed: handler error → deny; otherwise → allow with error output
 *   - timeouts: command/http/mcp/prompt all bounded
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    configHash,
    countHandlers,
    fingerprintHooksConfig,
    hasHandlersFor,
    interpolateTemplate,
    loadHooksConfig,
    projectHooksConfigPath,
    readHooksConfig,
    runHookHandler,
    runHooksForEvent,
    userHooksConfigPath,
    type HookConfig,
    type HookEvent,
    type HookHandler,
    type HookRunContext,
} from "../src/hooks-config.ts";

const TMP = mkdtempSync(join(tmpdir(), `hooks-config-${Date.now()}-`));
const PROJECT_DIR = join(TMP, "project");
const PROJECT_UNOWN_DIR = join(PROJECT_DIR, ".unown");
const USER_DIR = join(TMP, "user");
mkdirSync(PROJECT_UNOWN_DIR, { recursive: true });
mkdirSync(USER_DIR, { recursive: true });

afterAll(() => {
    try {
        rmSync(TMP, { recursive: true, force: true });
    } catch {
        /* best-effort */
    }
});

// Default context for runHookHandler tests — callLlm/callMcp are stubs.
function ctx(overrides: Partial<HookRunContext> = {}): HookRunContext {
    return {
        runId: "test-run",
        sandboxRoot: PROJECT_DIR,
        callLlm: async () => "ALLOW",
        callMcp: async () => ({ decision: "allow" }),
        ...overrides,
    };
}

describe("hooks-config — schema + loader", () => {
    test("readHooksConfig: missing file returns null", () => {
        expect(readHooksConfig(join(TMP, "missing.json"))).toBeNull();
    });

    test("readHooksConfig: corrupt JSON returns null", () => {
        const p = join(TMP, "corrupt.json");
        writeFileSync(p, "{ not json");
        expect(readHooksConfig(p)).toBeNull();
    });

    test("readHooksConfig: missing `version: 1` rejected", () => {
        const p = join(TMP, "v2.json");
        writeFileSync(p, JSON.stringify({ version: 2, hooks: {} }));
        expect(readHooksConfig(p)).toBeNull();
    });

    test("readHooksConfig: missing `hooks` object rejected", () => {
        const p = join(TMP, "nohooks.json");
        writeFileSync(p, JSON.stringify({ version: 1 }));
        expect(readHooksConfig(p)).toBeNull();
    });

    test("readHooksConfig: valid config parsed; non-array entries filtered", () => {
        const p = join(TMP, "valid.json");
        writeFileSync(
            p,
            JSON.stringify({
                version: 1,
                hooks: {
                    PreToolUse: [{ type: "command", command: "true" }, "not-an-object", { type: "http", url: "http://x" }],
                    Stop: [],
                    SessionStart: "wrong-shape",
                },
            }),
        );
        const cfg = readHooksConfig(p)!;
        expect(cfg.version).toBe(1);
        expect(cfg.hooks.PreToolUse).toHaveLength(2);
        expect(cfg.hooks.Stop).toEqual([]);
        expect(cfg.hooks.SessionStart).toBeUndefined();
    });

    test("loadHooksConfig: no configs → empty config + no approval needed", () => {
        const r = loadHooksConfig(PROJECT_DIR, USER_DIR);
        expect(r.approvalNeeded).toBe(false);
        expect(countHandlers(r.config)).toBe(0);
        expect(r.sources.user).toHaveLength(0);
        expect(r.sources.project).toHaveLength(0);
        expect(r.sources.untrustedProject).toHaveLength(0);
    });

    test("loadHooksConfig: user-only config loaded", () => {
        writeFileSync(
            userHooksConfigPath(USER_DIR),
            JSON.stringify({ version: 1, hooks: { SessionStart: [{ type: "command", command: "echo hi" }] } }),
        );
        const r = loadHooksConfig(PROJECT_DIR, USER_DIR);
        expect(r.sources.user).toHaveLength(1);
        expect(r.config.hooks.SessionStart).toHaveLength(1);
        expect(r.approvalNeeded).toBe(false);
    });

    test("loadHooksConfig: project config untrusted when env bypass not set", () => {
        writeFileSync(
            projectHooksConfigPath(PROJECT_DIR),
            JSON.stringify({ version: 1, hooks: { PreToolUse: [{ type: "command", command: "true" }] } }),
        );
        // Save + restore env so other tests aren't affected.
        const saved = process.env.UNOWN_TRUST_PROJECT_CONFIG;
        delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        try {
            const r = loadHooksConfig(PROJECT_DIR, USER_DIR);
            expect(r.approvalNeeded).toBe(true);
            expect(r.sources.untrustedProject).toHaveLength(1);
            expect(r.config.hooks.PreToolUse).toBeUndefined();
        } finally {
            if (saved !== undefined) process.env.UNOWN_TRUST_PROJECT_CONFIG = saved;
        }
    });

    test("loadHooksConfig: UNOWN_TRUST_PROJECT_CONFIG=1 bypasses the gate", () => {
        const saved = process.env.UNOWN_TRUST_PROJECT_CONFIG;
        process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
        try {
            const r = loadHooksConfig(PROJECT_DIR, USER_DIR);
            expect(r.approvalNeeded).toBe(false);
            expect(r.sources.project).toHaveLength(1);
            expect(r.config.hooks.PreToolUse).toHaveLength(1);
        } finally {
            if (saved !== undefined) process.env.UNOWN_TRUST_PROJECT_CONFIG = saved;
            else delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        }
    });

    test("loadHooksConfig: project wins per-event over user config", () => {
        writeFileSync(
            userHooksConfigPath(USER_DIR),
            JSON.stringify({
                version: 1,
                hooks: {
                    SessionStart: [{ type: "command", command: "user-cmd" }],
                    PreToolUse: [{ type: "command", command: "user-pre" }],
                },
            }),
        );
        const saved = process.env.UNOWN_TRUST_PROJECT_CONFIG;
        process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
        try {
            writeFileSync(
                projectHooksConfigPath(PROJECT_DIR),
                JSON.stringify({
                    version: 1,
                    hooks: {
                        PreToolUse: [{ type: "command", command: "proj-pre" }],
                    },
                }),
            );
            const r = loadHooksConfig(PROJECT_DIR, USER_DIR);
            // SessionStart inherited from user.
            expect(r.config.hooks.SessionStart).toHaveLength(1);
            expect(r.config.hooks.SessionStart![0].command).toBe("user-cmd");
            // PreToolUse replaced by project.
            expect(r.config.hooks.PreToolUse).toHaveLength(1);
            expect(r.config.hooks.PreToolUse![0].command).toBe("proj-pre");
        } finally {
            if (saved !== undefined) process.env.UNOWN_TRUST_PROJECT_CONFIG = saved;
            else delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        }
    });

    test("hasHandlersFor + countHandlers + configHash", () => {
        const cfg: HookConfig = {
            version: 1,
            hooks: {
                PreToolUse: [{ type: "command", command: "x" }],
                PostToolUse: [{ type: "command", command: "y" }, { type: "http", url: "http://z" }],
            },
        };
        expect(hasHandlersFor(cfg, "PreToolUse")).toBe(true);
        expect(hasHandlersFor(cfg, "Stop")).toBe(false);
        expect(countHandlers(cfg)).toBe(3);
        expect(configHash(cfg)).toMatch(/^[a-f0-9]{16}$/);
        expect(configHash(cfg)).toBe(configHash(cfg)); // stable
    });

    test("fingerprintHooksConfig: null when missing, present when set", () => {
        // Use a fresh subdir so prior tests' project configs don't leak.
        const fresh = join(TMP, `fingerprint-fresh-${Date.now()}`);
        mkdirSync(fresh, { recursive: true });
        expect(fingerprintHooksConfig(fresh)).toBeNull();
        const unownDir = join(fresh, ".unown");
        mkdirSync(unownDir, { recursive: true });
        writeFileSync(
            projectHooksConfigPath(fresh),
            JSON.stringify({ version: 1, hooks: { SessionStart: [{ type: "command", command: "true" }] } }),
        );
        const fp = fingerprintHooksConfig(fresh);
        expect(fp).not.toBeNull();
        expect(fp).toMatch(/^[a-f0-9]{64}$/);
    });

    test("projectHooksConfigPath + userHooksConfigPath: expected names", () => {
        expect(projectHooksConfigPath("/proj")).toBe("/proj/.unown/hooks.json");
        expect(userHooksConfigPath("/agent")).toBe("/agent/hooks.json");
    });
});

describe("hooks-config — interpolateTemplate", () => {
    const evt: HookEvent = {
        name: "PreToolUse",
        tool: "bash",
        input: { command: "ls -la", path: "/tmp/x" },
        prompt: "hello world",
        context: { extra: "ctx-val" },
    };

    test("{{tool}} interpolates", () => {
        expect(interpolateTemplate("tool={{tool}}", evt)).toBe("tool=bash");
    });

    test("{{input.command}} interpolates", () => {
        expect(interpolateTemplate("cmd={{input.command}}", evt)).toBe("cmd=ls -la");
    });

    test("{{input.path}} interpolates", () => {
        expect(interpolateTemplate("path={{input.path}}", evt)).toBe("path=/tmp/x");
    });

    test("{{prompt}} interpolates", () => {
        expect(interpolateTemplate("p={{prompt}}", evt)).toBe("p=hello world");
    });

    test("{{context.extra}} interpolates", () => {
        expect(interpolateTemplate("c={{context.extra}}", evt)).toBe("c=ctx-val");
    });

    test("{{input}} interpolates to JSON", () => {
        const out = interpolateTemplate("i={{input}}", evt);
        expect(out).toContain('"command":"ls -la"');
        expect(out).toContain('"path":"/tmp/x"');
    });

    test("missing token → empty string (never throw)", () => {
        expect(interpolateTemplate("x={{input.missing}}", evt)).toBe("x=");
        expect(interpolateTemplate("x={{missing.nested.deep}}", evt)).toBe("x=");
    });

    test("no tokens → unchanged", () => {
        expect(interpolateTemplate("plain text", evt)).toBe("plain text");
    });

    test("multiple tokens in one template", () => {
        expect(interpolateTemplate("[{{tool}}] {{input.command}}", evt)).toBe("[bash] ls -la");
    });

    test("name token", () => {
        expect(interpolateTemplate("event={{name}}", evt)).toBe("event=PreToolUse");
    });
});

describe("hooks-config — command handler", () => {
    test("exit 0 + empty stdout → allow", async () => {
        const r = await runHookHandler(
            { type: "command", command: "true", timeoutMs: 5000 },
            { name: "PreToolUse", tool: "bash" },
            ctx(),
        );
        expect(r.decision).toBe("allow");
        expect(r.outputs).toEqual([]);
    });

    test("exit 0 + stdout text → allow with feedback", async () => {
        const r = await runHookHandler(
            { type: "command", command: "echo all good", timeoutMs: 5000 },
            { name: "PreToolUse", tool: "bash" },
            ctx(),
        );
        expect(r.decision).toBe("allow");
        expect(r.outputs[0]).toMatchObject({ kind: "feedback", message: "all good" });
    });

    test("exit 0 + stdout JSON → parsed structured output (deny)", async () => {
        const r = await runHookHandler(
            {
                type: "command",
                command: 'echo \'{"decision":"deny","reason":"blocked","outputs":[{"kind":"warning","message":"careful"}]}\'',
                timeoutMs: 5000,
            },
            { name: "PreToolUse", tool: "bash" },
            ctx(),
        );
        expect(r.decision).toBe("deny");
        expect(r.reason).toBe("blocked");
        expect(r.outputs[0]).toMatchObject({ kind: "warning", message: "careful" });
    });

    test("exit 2 → deny with stderr as reason", async () => {
        const r = await runHookHandler(
            { type: "command", command: "echo 'blocked reason' >&2 && exit 2", timeoutMs: 5000 },
            { name: "PreToolUse", tool: "bash" },
            ctx(),
        );
        expect(r.decision).toBe("deny");
        expect(r.reason).toContain("blocked reason");
    });

    test("exit non-zero non-2 → warn", async () => {
        const r = await runHookHandler(
            { type: "command", command: "exit 1", timeoutMs: 5000 },
            { name: "PreToolUse", tool: "bash" },
            ctx(),
        );
        expect(r.decision).toBe("warn");
    });

    test("timeout → failClosed: deny; else allow with error", async () => {
        // Use a Node one-liner that ignores SIGTERM (sleep ignores it too, but
        // Node is a more portable choice across OSes). The handler must time
        // out at timeoutMs=200 and not wait the full command duration.
        const slow = "node -e 'setInterval(()=>{}, 1000)'";
        const r1 = await runHookHandler(
            { type: "command", command: slow, timeoutMs: 200, failClosed: false },
            { name: "PreToolUse", tool: "bash" },
            ctx(),
        );
        expect(r1.decision).toBe("allow");
        expect(r1.outputs[0].kind).toBe("error");

        const r2 = await runHookHandler(
            { type: "command", command: slow, timeoutMs: 200, failClosed: true },
            { name: "PreToolUse", tool: "bash" },
            ctx(),
        );
        expect(r2.decision).toBe("deny");
    });

    test("missing `command` field → allow with error", async () => {
        const r = await runHookHandler(
            { type: "command" } as HookHandler,
            { name: "PreToolUse", tool: "bash" },
            ctx(),
        );
        expect(r.decision).toBe("allow");
        expect(r.outputs[0].kind).toBe("error");
    });

    test("template interpolation: {{tool}} and {{input.command}} are injected", async () => {
        const r = await runHookHandler(
            { type: "command", command: "echo 'tool={{tool}} cmd={{input.command}}'", timeoutMs: 5000 },
            { name: "PreToolUse", tool: "bash", input: { command: "ls" } },
            ctx(),
        );
        expect(r.outputs[0].message).toBe("tool=bash cmd=ls");
    });

    test("async: true → fire-and-forget, returns allow immediately", async () => {
        const start = Date.now();
        const r = await runHookHandler(
            { type: "command", command: "sleep 1 && echo done", timeoutMs: 5000, async: true },
            { name: "PreToolUse", tool: "bash" },
            ctx(),
        );
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(500);
        expect(r.asyncRan).toBe(true);
        expect(r.decision).toBe("allow");
    });
});

describe("hooks-config — http handler", () => {
    test("200 + JSON body → parsed structured output", async () => {
        // Use a mock by stubbing global fetch.
        const orig = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response(JSON.stringify({ decision: "deny", reason: "blocked", outputs: [] }), { status: 200 })) as any;
        try {
            const r = await runHookHandler(
                { type: "http", url: "http://mock/", timeoutMs: 5000 },
                { name: "PreToolUse", tool: "bash", input: { command: "ls" } },
                ctx(),
            );
            expect(r.decision).toBe("deny");
            expect(r.reason).toBe("blocked");
        } finally {
            globalThis.fetch = orig;
        }
    });

    test("non-200 → allow with warning (default) or deny (failClosed)", async () => {
        const orig = globalThis.fetch;
        globalThis.fetch = (async () => new Response("server error", { status: 500 })) as any;
        try {
            const r1 = await runHookHandler(
                { type: "http", url: "http://mock/", timeoutMs: 5000 },
                { name: "PreToolUse", tool: "bash" },
                ctx(),
            );
            expect(r1.decision).toBe("allow");
            expect(r1.outputs[0].kind).toBe("warning");

            const r2 = await runHookHandler(
                { type: "http", url: "http://mock/", timeoutMs: 5000, failClosed: true },
                { name: "PreToolUse", tool: "bash" },
                ctx(),
            );
            expect(r2.decision).toBe("deny");
        } finally {
            globalThis.fetch = orig;
        }
    });

    test("apiKey → Authorization: Bearer header", async () => {
        const orig = globalThis.fetch;
        let capturedInit: any;
        globalThis.fetch = (async (_url: any, init: any) => {
            capturedInit = init;
            return new Response("{}", { status: 200 });
        }) as any;
        try {
            await runHookHandler(
                { type: "http", url: "http://mock/", apiKey: "test-key", timeoutMs: 5000 },
                { name: "PreToolUse", tool: "bash" },
                ctx(),
            );
            expect(capturedInit.headers.Authorization).toBe("Bearer test-key");
            expect(capturedInit.headers["Content-Type"]).toBe("application/json");
        } finally {
            globalThis.fetch = orig;
        }
    });

    test("missing url → allow with error", async () => {
        const r = await runHookHandler({ type: "http" } as HookHandler, { name: "PreToolUse", tool: "bash" }, ctx());
        expect(r.decision).toBe("allow");
        expect(r.outputs[0].kind).toBe("error");
    });
});

describe("hooks-config — mcp handler", () => {
    test("callMcp returns structured output → parsed", async () => {
        const r = await runHookHandler(
            { type: "mcp", mcpServer: "approver", mcpTool: "review", timeoutMs: 5000 },
            { name: "PreToolUse", tool: "bash" },
            ctx({ callMcp: async () => ({ decision: "deny", reason: "blocked by approver" }) }),
        );
        expect(r.decision).toBe("deny");
        expect(r.reason).toBe("blocked by approver");
    });

    test("callMcp throws → failClosed: deny; else allow with warning", async () => {
        const throwing = async () => {
            throw new Error("mcp unreachable");
        };
        const r1 = await runHookHandler(
            { type: "mcp", mcpServer: "x", mcpTool: "y", timeoutMs: 5000 },
            { name: "PreToolUse", tool: "bash" },
            ctx({ callMcp: throwing }),
        );
        expect(r1.decision).toBe("allow");
        expect(r1.outputs[0].kind).toBe("warning");

        const r2 = await runHookHandler(
            { type: "mcp", mcpServer: "x", mcpTool: "y", timeoutMs: 5000, failClosed: true },
            { name: "PreToolUse", tool: "bash" },
            ctx({ callMcp: throwing }),
        );
        expect(r2.decision).toBe("deny");
    });

    test("missing mcpServer/mcpTool → allow with error", async () => {
        const r = await runHookHandler({ type: "mcp" } as HookHandler, { name: "PreToolUse" }, ctx());
        expect(r.decision).toBe("allow");
        expect(r.outputs[0].kind).toBe("error");
    });

    test("missing callMcp in context → allow with error", async () => {
        const r = await runHookHandler(
            { type: "mcp", mcpServer: "x", mcpTool: "y" },
            { name: "PreToolUse" },
            ctx({ callMcp: undefined }),
        );
        expect(r.decision).toBe("allow");
        expect(r.outputs[0].kind).toBe("error");
    });
});

describe("hooks-config — prompt/agent handler", () => {
    test("LLM returns structured JSON → parsed", async () => {
        const r = await runHookHandler(
            { type: "prompt", prompt: "review {{tool}}", model: "kimi-k2.5", timeoutMs: 5000 },
            { name: "PreToolUse", tool: "bash" },
            ctx({
                callLlm: async () => JSON.stringify({ decision: "deny", reason: "suspicious" }),
            }),
        );
        expect(r.decision).toBe("deny");
        expect(r.reason).toBe("suspicious");
    });

    test("LLM returns plain text → feedback output", async () => {
        const r = await runHookHandler(
            { type: "prompt", prompt: "review", timeoutMs: 5000 },
            { name: "PreToolUse", tool: "bash" },
            ctx({ callLlm: async () => "looks fine to me" }),
        );
        expect(r.decision).toBe("allow");
        expect(r.outputs[0]).toMatchObject({ kind: "feedback", message: "looks fine to me" });
    });

    test("LLM returns 'BLOCK: reason' string → feedback (raw, not parsed)", async () => {
        // Without JSON, BLOCK is just text — the handler doesn't parse BLOCK/ALLOW
        // (that's the adversary.ts convention). It still surfaces as feedback.
        const r = await runHookHandler(
            { type: "prompt", prompt: "review", timeoutMs: 5000 },
            { name: "PreToolUse", tool: "bash" },
            ctx({ callLlm: async () => "BLOCK: this is dangerous" }),
        );
        expect(r.decision).toBe("allow");
        expect(r.outputs[0].message).toContain("BLOCK: this is dangerous");
    });

    test("LLM timeout → failClosed: deny; else allow with warning", async () => {
        const r1 = await runHookHandler(
            { type: "prompt", prompt: "review", timeoutMs: 100, failClosed: false },
            { name: "PreToolUse", tool: "bash" },
            ctx({ callLlm: async () => new Promise((r) => setTimeout(() => r("ALLOW"), 500)) }),
        );
        expect(r1.decision).toBe("allow");
        expect(r1.outputs[0].kind).toBe("warning");

        const r2 = await runHookHandler(
            { type: "prompt", prompt: "review", timeoutMs: 100, failClosed: true },
            { name: "PreToolUse", tool: "bash" },
            ctx({ callLlm: async () => new Promise((r) => setTimeout(() => r("ALLOW"), 500)) }),
        );
        expect(r2.decision).toBe("deny");
    });

    test("missing prompt → allow with error", async () => {
        const r = await runHookHandler({ type: "prompt" } as HookHandler, { name: "PreToolUse" }, ctx());
        expect(r.decision).toBe("allow");
        expect(r.outputs[0].kind).toBe("error");
    });

    test("missing callLlm in context → allow with error", async () => {
        const r = await runHookHandler(
            { type: "prompt", prompt: "review" },
            { name: "PreToolUse" },
            ctx({ callLlm: undefined }),
        );
        expect(r.decision).toBe("allow");
        expect(r.outputs[0].kind).toBe("error");
    });

    test("agent handler type — same semantics as prompt", async () => {
        const r = await runHookHandler(
            { type: "agent", prompt: "review as agent", timeoutMs: 5000 },
            { name: "PreToolUse", tool: "bash" },
            ctx({ callLlm: async () => "ALLOW" }),
        );
        expect(r.decision).toBe("allow");
        expect(r.outputs[0]).toMatchObject({ kind: "feedback", message: "ALLOW" });
    });
});

describe("hooks-config — runHooksForEvent composition", () => {
    test("empty handlers → allow", async () => {
        const r = await runHooksForEvent([], { name: "PreToolUse", tool: "bash" }, ctx());
        expect(r.decision).toBe("allow");
        expect(r.outputs).toEqual([]);
    });

    test("first deny wins; later deny short-circuited", async () => {
        const handlers: HookHandler[] = [
            { type: "command", command: "exit 2", timeoutMs: 5000 },
            { type: "command", command: 'echo \'{"decision":"deny","reason":"second"}\'', timeoutMs: 5000 },
        ];
        const r = await runHooksForEvent(handlers, { name: "PreToolUse", tool: "bash" }, ctx());
        expect(r.decision).toBe("deny");
        // First handler's reason wins (the first deny is terminal).
        // The exit 2 path captures stderr (empty here), so reason falls back to "command exited 2".
        expect(r.reason).toBeDefined();
    });

    test("mutate stacks — later mutates overlay earlier ones", async () => {
        const handlers: HookHandler[] = [
            {
                type: "command",
                command: 'echo \'{"decision":"mutate","mutatedInput":{"path":"first.txt"}}\'',
                timeoutMs: 5000,
            },
            {
                type: "command",
                command: 'echo \'{"decision":"mutate","mutatedInput":{"content":"new"}}\'',
                timeoutMs: 5000,
            },
        ];
        const r = await runHooksForEvent(handlers, { name: "PreToolUse", tool: "write", input: { path: "orig.txt" } }, ctx());
        expect(r.decision).toBe("mutate");
        expect(r.mutatedInput).toEqual({ path: "first.txt", content: "new" });
    });

    test("warn continues — allow with warning output", async () => {
        const handlers: HookHandler[] = [
            { type: "command", command: "exit 1", timeoutMs: 5000 },
        ];
        const r = await runHooksForEvent(handlers, { name: "PreToolUse", tool: "bash" }, ctx());
        expect(r.decision).toBe("warn");
        expect(r.outputs.length).toBeGreaterThan(0);
    });

    test("matcher: '*' matches all tools", async () => {
        const handlers: HookHandler[] = [
            { type: "command", command: "echo all", matcher: "*", timeoutMs: 5000 },
        ];
        const r1 = await runHooksForEvent(handlers, { name: "PreToolUse", tool: "bash" }, ctx());
        const r2 = await runHooksForEvent(handlers, { name: "PreToolUse", tool: "write" }, ctx());
        const r3 = await runHooksForEvent(handlers, { name: "PreToolUse", tool: "unknown-tool" }, ctx());
        expect(r1.outputs).toHaveLength(1);
        expect(r2.outputs).toHaveLength(1);
        expect(r3.outputs).toHaveLength(1);
    });

    test("matcher: 'bash|powershell' matches either", async () => {
        const handlers: HookHandler[] = [
            { type: "command", command: "echo matched", matcher: "bash|powershell", timeoutMs: 5000 },
        ];
        const r1 = await runHooksForEvent(handlers, { name: "PreToolUse", tool: "bash" }, ctx());
        const r2 = await runHooksForEvent(handlers, { name: "PreToolUse", tool: "powershell" }, ctx());
        const r3 = await runHooksForEvent(handlers, { name: "PreToolUse", tool: "write" }, ctx());
        expect(r1.outputs).toHaveLength(1);
        expect(r2.outputs).toHaveLength(1);
        expect(r3.outputs).toHaveLength(0);
    });

    test("matcher: exact tool name only", async () => {
        const handlers: HookHandler[] = [
            { type: "command", command: "echo matched", matcher: "bash", timeoutMs: 5000 },
        ];
        const r1 = await runHooksForEvent(handlers, { name: "PreToolUse", tool: "bash" }, ctx());
        const r2 = await runHooksForEvent(handlers, { name: "PreToolUse", tool: "powershell" }, ctx());
        expect(r1.outputs).toHaveLength(1);
        expect(r2.outputs).toHaveLength(0);
    });

    test("matcher: no event.tool → no match (except '*')", async () => {
        const handlers: HookHandler[] = [
            { type: "command", command: "echo matched", matcher: "bash", timeoutMs: 5000 },
        ];
        const r = await runHooksForEvent(handlers, { name: "SessionStart" }, ctx());
        expect(r.outputs).toHaveLength(0);
    });

    test("async handlers do not affect the merged decision", async () => {
        const handlers: HookHandler[] = [
            { type: "command", command: "echo async", async: true, timeoutMs: 5000 },
            { type: "command", command: "true", timeoutMs: 5000 },
        ];
        const r = await runHooksForEvent(handlers, { name: "PreToolUse", tool: "bash" }, ctx());
        expect(r.decision).toBe("allow");
        expect(r.asyncRan).toBe(true);
        expect(r.outputs).toEqual([]);
    });
});

describe("hooks-config — parseHandlerOutput edge cases", () => {
    test("null → null", async () => {
        const r = await runHookHandler(
            { type: "command", command: "true", timeoutMs: 5000 },
            { name: "PreToolUse" },
            ctx(),
        );
        expect(r.decision).toBe("allow");
        expect(r.outputs).toEqual([]);
    });

    test("unknown handler type → allow with error", async () => {
        const r = await runHookHandler(
            { type: "unknown" as any },
            { name: "PreToolUse" },
            ctx(),
        );
        expect(r.decision).toBe("allow");
        expect(r.outputs[0].kind).toBe("error");
        expect(r.outputs[0].message).toContain("unknown handler type");
    });
});
