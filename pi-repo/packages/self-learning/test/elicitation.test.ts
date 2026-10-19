// Unit tests for src/mcp.ts elicitation capability (Milestone 2.3 —
// reverse-engineered from goose's elicitation.rs + the MCP standard).
//
// Layers:
//   1. Capability advertisement — the initialize handshake carries
//      `capabilities: { elicitation: {} }` (a Bun.serve HTTP mock captures
//      the initialize params and asserts the elicitation block is present).
//   2. elicitation/create handling — a stdio mock server (mock-mcp-elicitation.mjs)
//      sends an elicitation/create request after initialize and stashes the
//      client's JSON-RPC reply on disk so the test can assert on the
//      action/content shape.
//   3. Per-server config — autoAccept/autoDecline/defaultReason are honored;
//      absent config defaults to autoDecline with the headless-no-UI reason.
//   4. Schema validation — malformed requests are cancelled; non-object
//      schemas are declined; missing required fields are declined.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    createMcpExtension,
    McpConnection,
    McpManager,
    resolveElicitationConfig,
    type AnyServerConfig,
    type ElicitationConfig,
} from "../src/mcp.ts";
import {
    decideElicitation,
    defaultElicitationConfig,
    ELICITATION_DEFAULT_DUMMY,
    resolveElicitationConfig as resolveElicitationConfigPure,
    validateAgainstSchema,
    type ElicitationRequest,
} from "../src/elicitation.ts";
import { runMcpCommand } from "../src/mcp-cli.ts";

const MOCK_SERVER = join(import.meta.dir, "fixtures", "mock-mcp-elicitation.mjs");
const NODE = "node";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-elicitation-test-"));
afterAll(() => {
    try {
        rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

/**
 * Spawn a stdio McpManager against the mock-elicitation server, wait for the
 * elicitation/create round trip, and return the stashed client reply.
 *
 * The `env` is merged into the spawned server's env; `MOCK_ELICITATION_RESULT`
 * is set automatically (per-call temp file) so the test can read it back.
 */
async function runElicitationExchange(
    cfg: AnyServerConfig,
    env: Record<string, string> = {},
): Promise<{ action: string; content?: Record<string, unknown> } | null> {
    const dir = mkdtempSync(join(tmpRoot, "ex-"));
    const resultPath = join(dir, "reply.json");
    // Merge any user env into the stdio server's env, then override the
    // result-file path with a per-call temp path the function controls.
    const baseEnv = (cfg as { env?: Record<string, string> }).env ?? {};
    const mergedEnv: Record<string, string> = { ...baseEnv, ...env, MOCK_ELICITATION_RESULT: resultPath };
    const mergedCfg: AnyServerConfig = { ...cfg, env: mergedEnv };
    const m = new McpManager({
        cwd: dir,
        config: { servers: { mock: mergedCfg } },
        requestTimeoutMs: 10_000,
        connectTimeoutMs: 10_000,
    });
    try {
        const conn = await m.connect("mock");
        if (!conn) return null;
        // Wait for the mock to receive the client's elicitation reply.
        const deadline = Date.now() + 5_000;
        while (!existsSync(resultPath) && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 50));
        }
        if (!existsSync(resultPath)) return null;
        const parsed = JSON.parse(readFileSync(resultPath, "utf8")) as { result?: { action: string; content?: Record<string, unknown> } };
        return parsed.result ?? null;
    } finally {
        m.disposeAll();
    }
}

/**
 * Capture the initialize params the client sends to a stdio server. The
 * mock-mcp-elicitation.mjs fixture writes the params to MOCK_INIT_PARAMS_PATH
 * so we can assert on the advertised capabilities without Bun.serve (the
 * HTTP test fixture races with bun:test's fetch through Node's HTTP client —
 * see the note on `HPE_UNEXPECTED_CONTENT_LENGTH` in mcp.test.ts).
 */
async function captureInitializeParams(cfg: AnyServerConfig): Promise<any | null> {
    const dir = mkdtempSync(join(tmpRoot, "init-"));
    const initParamsPath = join(dir, "init-params.json");
    const baseEnv = (cfg as { env?: Record<string, string> }).env ?? {};
    const mergedEnv: Record<string, string> = { ...baseEnv, MOCK_INIT_PARAMS_PATH: initParamsPath };
    const mergedCfg: AnyServerConfig = { ...cfg, env: mergedEnv };
    const m = new McpManager({
        cwd: dir,
        config: { servers: { mock: mergedCfg } },
        requestTimeoutMs: 10_000,
        connectTimeoutMs: 10_000,
    });
    try {
        const conn = await m.connect("mock");
        if (!conn) return null;
        const deadline = Date.now() + 5_000;
        while (!existsSync(initParamsPath) && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 50));
        }
        if (!existsSync(initParamsPath)) return null;
        return JSON.parse(readFileSync(initParamsPath, "utf8"));
    } finally {
        m.disposeAll();
    }
}

/** Helper: build a stdio config (command + args + env + elicitation). */
function stdioConfig(env: Record<string, string> = {}, elicitation?: ElicitationConfig): AnyServerConfig {
    const cfg: AnyServerConfig = { command: NODE, args: [MOCK_SERVER], env };
    if (elicitation) (cfg as { elicitation?: ElicitationConfig }).elicitation = elicitation;
    return cfg;
}

// ---------------------------------------------------------------------------
// 1. Capability advertisement
// ---------------------------------------------------------------------------

describe("elicitation capability advertisement", () => {
    test("initialize carries capabilities: { elicitation: {} } (stdio capture)", async () => {
        // The mock-mcp-elicitation.mjs fixture writes the initialize params
        // it receives to MOCK_INIT_PARAMS_PATH — lets us assert the client's
        // advertised capabilities on the stdio transport (the HTTP fixture
        // races with bun:test's fetch through Node's HTTP client under the
        // `HPE_UNEXPECTED_CONTENT_LENGTH` issue documented in mcp.test.ts).
        const params = await captureInitializeParams(stdioConfig());
        expect(params).not.toBeNull();
        expect(params!.clientInfo?.name).toBe("unown");
        expect(typeof params!.clientInfo?.version).toBe("string");
        expect(params!.protocolVersion).toBe("2025-06-18");
        // The elicitation capability MUST be advertised — the prior
        // `capabilities: {}` made servers assume we can't elicit.
        expect(params!.capabilities).toBeDefined();
        expect(params!.capabilities.elicitation).toEqual({});
    });

    test("McpConnection.elicitationPolicy reflects the resolved per-server config", () => {
        const dir = mkdtempSync(join(tmpRoot, "pol-"));
        const m = new McpManager({
            cwd: dir,
            config: {
                servers: {
                    optIn: { command: NODE, args: [MOCK_SERVER], elicitation: { autoAccept: true, defaultReason: "r" } },
                    optOut: { command: NODE, args: [MOCK_SERVER], elicitation: { autoDecline: false } },
                    none: { command: NODE, args: [MOCK_SERVER] },
                },
            },
        });
        const optIn = m.serverConfig("optIn")!;
        const optOut = m.serverConfig("optOut")!;
        const none = m.serverConfig("none")!;
        expect(resolveElicitationConfig(optIn).autoAccept).toBe(true);
        expect(resolveElicitationConfig(optIn).autoDecline).toBe(true); // default true
        expect(resolveElicitationConfig(optOut).autoAccept).toBe(false);
        expect(resolveElicitationConfig(optOut).autoDecline).toBe(false); // explicit opt-out
        // Default policy: autoDecline true, headless-no-UI reason.
        const def = resolveElicitationConfig(none);
        expect(def.autoAccept).toBe(false);
        expect(def.autoDecline).toBe(true);
        expect(def.defaultReason).toBe("auto-declined by unown (no UI)");
        // Direct McpConnection wiring — the connection stores the resolved
        // policy at construction time (so the elicitation handler sees it).
        const conn = new McpConnection("optIn", optIn, dir, 5_000, 5_000);
        expect(conn.elicitationPolicy.autoAccept).toBe(true);
        expect(conn.elicitationPolicy.defaultReason).toBe("r");
    });
});

// ---------------------------------------------------------------------------
// 2. elicitation/create handling
// ---------------------------------------------------------------------------

describe("elicitation/create handler", () => {
    test("default policy (no elicitation block) → decline with the default reason", async () => {
        const reply = await runElicitationExchange(stdioConfig());
        expect(reply).not.toBeNull();
        expect(reply!.action).toBe("decline");
        expect(reply!.content?.reason).toBe("auto-declined by unown (no UI)");
    });

    test("autoAccept: true → accept with synthesized dummy data matching the schema", async () => {
        const reply = await runElicitationExchange(
            stdioConfig({}, { autoAccept: true }),
        );
        expect(reply).not.toBeNull();
        expect(reply!.action).toBe("accept");
        // The mock's default schema asks for `confirmed: boolean` (required)
        // and `reason: string` (optional). The synthesized data must carry
        // both, plus a `reason` field with the auto-accepted marker.
        expect(reply!.content).toBeDefined();
        expect(reply!.content!.confirmed).toBe(true);
        expect(typeof reply!.content!.reason).toBe("string");
        expect(reply!.content!.reason).toContain("auto-accepted by unown");
    });

    test("autoDecline: true (default) + custom defaultReason → decline with the custom reason", async () => {
        const reply = await runElicitationExchange(
            stdioConfig({}, { autoDecline: true, defaultReason: "no UI in CI" }),
        );
        expect(reply).not.toBeNull();
        expect(reply!.action).toBe("decline");
        expect(reply!.content?.reason).toBe("no UI in CI");
    });

    test("malformed request (no message + no requestedSchema) → cancel", async () => {
        const reply = await runElicitationExchange(
            stdioConfig({ MOCK_ELICITATION_MALFORMED: "1" }),
        );
        expect(reply).not.toBeNull();
        expect(reply!.action).toBe("cancel");
        expect(reply!.content).toBeUndefined();
    });

    test("schema validation: autoAccept + bad schema (non-object) → decline (not accept, not cancel)", async () => {
        const reply = await runElicitationExchange(
            stdioConfig(
                { MOCK_ELICITATION_BADSCHEMA: "1" },
                { autoAccept: true, defaultReason: "headless-no-UI" },
            ),
        );
        expect(reply).not.toBeNull();
        // The schema is `{ type: "string" }` — not an object schema. Even with
        // autoAccept on, we cannot synthesize data → decline.
        expect(reply!.action).toBe("decline");
        expect(reply!.content?.reason).toContain("headless-no-UI");
    });

    test("server config without elicitation section → defaults to autoDecline: true", async () => {
        // Resolve a config with no `elicitation` field and assert the default
        // policy is autoDecline: true with the headless-no-UI reason.
        const cfg = stdioConfig();
        const policy = resolveElicitationConfig(cfg);
        expect(policy.autoAccept).toBe(false);
        expect(policy.autoDecline).toBe(true);
        expect(policy.defaultReason).toBe("auto-declined by unown (no UI)");
        // End-to-end: a server with no elicitation block declines.
        const reply = await runElicitationExchange(stdioConfig());
        expect(reply).not.toBeNull();
        expect(reply!.action).toBe("decline");
        expect(reply!.content?.reason).toBe("auto-declined by unown (no UI)");
    });
});

// ---------------------------------------------------------------------------
// 3. /mcp elicitation subcommand
// ---------------------------------------------------------------------------

describe("/mcp elicitation subcommand", () => {
    test("/mcp elicitation <server> shows the per-server policy", async () => {
        const dir = mkdtempSync(join(tmpRoot, "cmd-"));
        const ext = createMcpExtension({
            cwd: dir,
            config: {
                servers: {
                    "trusted-server": {
                        command: NODE,
                        args: [MOCK_SERVER],
                        elicitation: { autoAccept: true, defaultReason: "model is user" },
                    },
                },
            },
        });
        const handlers = new Map<string, Array<(event: any, ctx?: any) => any>>();
        const commands = new Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void> }>();
        const pi: any = {
            on: (event: string, handler: (event: any, ctx?: any) => any) => {
                if (!handlers.has(event)) handlers.set(event, []);
                handlers.get(event)!.push(handler);
            },
            registerCommand: (name: string, def: any) => commands.set(name, def),
            registerTool: () => {},
        };
        ext.factory(pi);
        const messages: Array<{ text: string; level: string }> = [];
        const ctx = { hasUI: true, ui: { notify: (text: string, level: string = "info") => messages.push({ text, level }) } };
        await commands.get("mcp")!.handler("elicitation trusted-server", ctx);
        expect(messages).toHaveLength(1);
        expect(messages[0].text).toContain("trusted-server");
        expect(messages[0].text).toContain("autoAccept: true");
        expect(messages[0].text).toContain("model is user");
    });

    test("/mcp elicitation <unknown> → actionable 'not configured' message", async () => {
        const dir = mkdtempSync(join(tmpRoot, "cmd2-"));
        const ext = createMcpExtension({ cwd: dir, config: { servers: {} } });
        const commands = new Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void> }>();
        const pi: any = {
            on: () => {},
            registerCommand: (name: string, def: any) => commands.set(name, def),
            registerTool: () => {},
        };
        ext.factory(pi);
        const messages: Array<{ text: string; level: string }> = [];
        const ctx = { hasUI: true, ui: { notify: (text: string, level: string = "info") => messages.push({ text, level }) } };
        await commands.get("mcp")!.handler("elicitation no-such-server", ctx);
        expect(messages[0].text).toContain("no-such-server");
        // The phrase "is configured" (with the negation) makes the message
        // actionable: the user knows the server name is missing.
        expect(messages[0].text.toLowerCase()).toContain("not configured");
    });
});

// ---------------------------------------------------------------------------
// 4. Config normalization — bad elicitation shapes surface problems
// ---------------------------------------------------------------------------

describe("elicitation config normalization", () => {
    test("bad shapes surface actionable problems and fall back to no-policy", async () => {
        const dir = mkdtempSync(join(tmpRoot, "norm-"));
        const file = join(dir, "mcp.json");
        writeFileSync(
            file,
            JSON.stringify({
                mcpServers: {
                    bad: { command: NODE, args: [MOCK_SERVER], elicitation: "not-an-object" },
                    unknown: {
                        command: NODE,
                        args: [MOCK_SERVER],
                        elicitation: { autoAccept: "yes-please", madeUp: 1 },
                    },
                },
            }),
        );
        // Inline-load: import the parser lazily to keep this test self-contained.
        const { loadMcpConfigFile } = await import("../src/mcp.ts");
        const { config, problems } = loadMcpConfigFile(file)!;
        expect(config!.servers.bad).toBeDefined();
        expect(config!.servers.unknown).toBeDefined();
        expect(resolveElicitationConfig(config!.servers.bad!).autoDecline).toBe(true); // falls back
        const problemKeys = problems.map((p) => p.key);
        expect(problemKeys.some((k) => k.includes("bad.elicitation"))).toBe(true);
        expect(problemKeys.some((k) => k.includes("unknown.elicitation"))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 5. Pure module (src/elicitation.ts) — the testable core
// ---------------------------------------------------------------------------
//
// The decision function and its dependencies (default config, schema
// validator, default dummy) are pure and have no MCP transport — these
// tests exercise the decision tree directly without spawning any server.
// Pinned by the Milestone 2.3 spec test list (15 cases).
describe("elicitation pure module", () => {
    // Test 1 — defaultElicitationConfig() returns the documented defaults.
    test("defaultElicitationConfig returns autoDecline=true with the headless-no-UI reason", () => {
        const d = defaultElicitationConfig();
        expect(d.autoAccept).toBe(false);
        expect(d.autoDecline).toBe(true);
        expect(d.defaultReason).toBe("auto-declined by unown (no UI)");
    });

    // Test 2 — default config (autoDecline: true) → decline, no content.
    test("decideElicitation with default config → { action: 'decline', content: undefined }", () => {
        const req: ElicitationRequest = {
            message: "Please confirm",
            requestedSchema: { type: "object", properties: { confirmed: { type: "boolean" } }, required: ["confirmed"] },
        };
        const decision = decideElicitation(req, defaultElicitationConfig());
        expect(decision.action).toBe("decline");
        expect(decision.content).toBeUndefined();
    });

    // Test 3 — autoAccept: true → accept with the dummy.
    test("decideElicitation with autoAccept: true → { action: 'accept', content: ELICITATION_DEFAULT_DUMMY }", () => {
        const req: ElicitationRequest = {
            message: "Confirm deletion",
            requestedSchema: {
                type: "object",
                properties: { confirmed: { type: "boolean" }, reason: { type: "string" } },
                required: ["confirmed"],
            },
        };
        const decision = decideElicitation(req, { autoAccept: true, autoDecline: true });
        expect(decision.action).toBe("accept");
        expect(decision.content).toEqual(ELICITATION_DEFAULT_DUMMY);
    });

    // Test 4 — autoAccept: true but schema requires an extra field → decline.
    test("decideElicitation autoAccept + schema requires extra field → decline (dummy doesn't satisfy)", () => {
        const req: ElicitationRequest = {
            message: "Enter your name + confirm",
            requestedSchema: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    confirmed: { type: "boolean" },
                },
                required: ["name", "confirmed"],
            },
        };
        // The dummy only has `confirmed` + `reason`; `name` is required and
        // absent → validateAgainstSchema returns false → decline.
        const decision = decideElicitation(req, { autoAccept: true });
        expect(decision.action).toBe("decline");
        expect(decision.content).toBeUndefined();
    });

    // Test 5 — autoAccept: true and schema requires only `confirmed` → accept with dummy.
    test("decideElicitation autoAccept + schema requires only `confirmed` → accept with dummy", () => {
        const req: ElicitationRequest = {
            message: "Confirm",
            requestedSchema: {
                type: "object",
                properties: { confirmed: { type: "boolean" }, reason: { type: "string" } },
                required: ["confirmed"],
            },
        };
        const decision = decideElicitation(req, { autoAccept: true, autoDecline: false });
        expect(decision.action).toBe("accept");
        expect(decision.content).toEqual(ELICITATION_DEFAULT_DUMMY);
    });

    // Test 6 — autoAccept + autoDecline both true → autoAccept wins.
    test("decideElicitation autoAccept + autoDecline both true → autoAccept wins (accept)", () => {
        const req: ElicitationRequest = {
            message: "Confirm",
            requestedSchema: {
                type: "object",
                properties: { confirmed: { type: "boolean" } },
                required: ["confirmed"],
            },
        };
        const decision = decideElicitation(req, { autoAccept: true, autoDecline: true });
        expect(decision.action).toBe("accept");
        expect(decision.content).toEqual(ELICITATION_DEFAULT_DUMMY);
    });

    // Test 7 — both autoAccept + autoDecline false → cancel (neither opinion).
    test("decideElicitation both false → { action: 'cancel' } (neither accepted nor declined)", () => {
        const req: ElicitationRequest = {
            message: "Confirm",
            requestedSchema: {
                type: "object",
                properties: { confirmed: { type: "boolean" } },
                required: ["confirmed"],
            },
        };
        const decision = decideElicitation(req, { autoAccept: false, autoDecline: false });
        expect(decision.action).toBe("cancel");
        expect(decision.content).toBeUndefined();
    });

    // Test 8 — malformed request (no requestedSchema) → cancel.
    test("decideElicitation malformed request (no requestedSchema) → cancel", () => {
        const decision = decideElicitation({ message: "hi" }, defaultElicitationConfig());
        expect(decision.action).toBe("cancel");
        expect(decision.content).toBeUndefined();
    });

    // Test 9 — empty message → still works (message is informational).
    test("decideElicitation with empty message → still works (string is sufficient)", () => {
        const req: ElicitationRequest = {
            message: "",
            requestedSchema: { type: "object", properties: { confirmed: { type: "boolean" } }, required: ["confirmed"] },
        };
        const decision = decideElicitation(req, { autoAccept: true });
        expect(decision.action).toBe("accept");
        expect(decision.content).toEqual(ELICITATION_DEFAULT_DUMMY);
    });

    // Test 10 — validateAgainstSchema validates types (string, boolean, number).
    test("validateAgainstSchema validates string / boolean / number types", () => {
        const s = { type: "object", properties: { s: { type: "string" }, b: { type: "boolean" }, n: { type: "number" } } };
        expect(validateAgainstSchema({ s: "x", b: true, n: 1 }, s)).toBe(true);
        expect(validateAgainstSchema({ s: 1, b: true, n: 1 }, s)).toBe(false); // s not string
        expect(validateAgainstSchema({ s: "x", b: "yes", n: 1 }, s)).toBe(false); // b not boolean
        expect(validateAgainstSchema({ s: "x", b: true, n: "1" }, s)).toBe(false); // n not number
    });

    // Test 11 — validateAgainstSchema checks required fields.
    test("validateAgainstSchema flags missing required fields", () => {
        const s = { type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a", "b"] };
        expect(validateAgainstSchema({ a: "x", b: "y" }, s)).toBe(true);
        expect(validateAgainstSchema({ a: "x" }, s)).toBe(false); // missing required b
        expect(validateAgainstSchema({}, s)).toBe(false); // missing both
    });

    // Test 12 — validateAgainstSchema ignores unknown properties by default.
    test("validateAgainstSchema ignores unknown properties (additionalProperties default true)", () => {
        const s = { type: "object", properties: { a: { type: "string" } } };
        // No additionalProperties set → unknown fields are allowed by default.
        expect(validateAgainstSchema({ a: "x", unknown: "anything" }, s)).toBe(true);
        expect(validateAgainstSchema({ a: "x", extra: 123, more: null }, s)).toBe(true);
        // Explicit additionalProperties: false would reject unknowns — not the default.
        const strict = { type: "object", properties: { a: { type: "string" } }, additionalProperties: false };
        expect(validateAgainstSchema({ a: "x", unknown: "anything" }, strict)).toBe(false);
    });

    // Test 13 — server config with elicitation field parses correctly.
    test("server config with elicitation field parses correctly (autoAccept + custom reason preserved)", () => {
        const dir = mkdtempSync(join(tmpRoot, "cfg-with-"));
        const file = join(dir, "mcp.json");
        writeFileSync(
            file,
            JSON.stringify({
                mcpServers: {
                    trusted: {
                        command: NODE,
                        args: [MOCK_SERVER],
                        elicitation: { autoAccept: true, autoDecline: false, defaultReason: "model is user" },
                    },
                },
            }),
        );
        const { loadMcpConfigFile } = require("../src/mcp.ts") as typeof import("../src/mcp.ts");
        const { config, problems } = loadMcpConfigFile(file)!;
        expect(problems).toHaveLength(0);
        expect(config!.servers.trusted).toBeDefined();
        const resolved = resolveElicitationConfigPure(config!.servers.trusted!.elicitation);
        expect(resolved.autoAccept).toBe(true);
        expect(resolved.autoDecline).toBe(false);
        expect(resolved.defaultReason).toBe("model is user");
    });

    // Test 14 — server config without elicitation field gets defaults applied.
    test("server config without elicitation field → defaults applied (autoDecline=true, headless-no-UI reason)", () => {
        const dir = mkdtempSync(join(tmpRoot, "cfg-without-"));
        const file = join(dir, "mcp.json");
        writeFileSync(
            file,
            JSON.stringify({
                mcpServers: { plain: { command: NODE, args: [MOCK_SERVER] } },
            }),
        );
        const { loadMcpConfigFile } = require("../src/mcp.ts") as typeof import("../src/mcp.ts");
        const { config, problems } = loadMcpConfigFile(file)!;
        expect(problems).toHaveLength(0);
        expect(config!.servers.plain).toBeDefined();
        // No elicitation block on the parsed entry — resolveElicitationConfig
        // applies defaults.
        const resolved = resolveElicitationConfig(config!.servers.plain!);
        expect(resolved.autoAccept).toBe(false);
        expect(resolved.autoDecline).toBe(true);
        expect(resolved.defaultReason).toBe("auto-declined by unown (no UI)");
    });
});

// ---------------------------------------------------------------------------
// 6. `unown mcp elicitation <server>` CLI subcommand (Milestone 2.3)
// ---------------------------------------------------------------------------
//
// The session-side `/mcp elicitation <server>` slash command is covered in
// section 3 above. This is the offline CLI mirror (`unown mcp elicitation`)
// — same data, no session required, prints to stdout for shell pipelines.
describe("unown mcp elicitation (CLI subcommand)", () => {
    function cleanEnv(): Record<string, string | undefined> {
        const env = { ...process.env };
        delete env.UNOWN_TRUST_PROJECT_CONFIG;
        return env;
    }

    test("elicitation <server> prints the per-server policy block", async () => {
        const cwd = mkdtempSync(join(tmpRoot, "cli-cwd-"));
        const userDir = mkdtempSync(join(tmpRoot, "cli-user-"));
        writeFileSync(
            join(userDir, "mcp.json"),
            JSON.stringify({
                mcpServers: {
                    "trusted-server": {
                        command: NODE,
                        args: [MOCK_SERVER],
                        elicitation: { autoAccept: true, defaultReason: "model is user" },
                    },
                },
            }),
        );
        const r = await runMcpCommand(["elicitation", "trusted-server"], { cwd, userDir, env: cleanEnv() });
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("trusted-server");
        expect(r.stdout).toContain("autoAccept:    true");
        // autoDecline defaults to true (the field was omitted in the config —
        // the resolver treats `autoDecline !== false` as true).
        expect(r.stdout).toContain("autoDecline:   true");
        expect(r.stdout).toContain("model is user");
    });

    test("elicitation <unknown> → actionable 'not configured' message", async () => {
        const cwd = mkdtempSync(join(tmpRoot, "cli-cwd2-"));
        const userDir = mkdtempSync(join(tmpRoot, "cli-user2-"));
        writeFileSync(
            join(userDir, "mcp.json"),
            JSON.stringify({ mcpServers: { real: { command: NODE, args: [MOCK_SERVER] } } }),
        );
        const r = await runMcpCommand(["elicitation", "no-such"], { cwd, userDir, env: cleanEnv() });
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain("no-such");
        // The message names the missing server AND lists the configured ones
        // so the typo is obvious — "no server named "no-such" is configured
        // — configured: real".
        expect(r.stderr.toLowerCase()).toContain("no server named");
        expect(r.stderr).toContain("real");
    });

    test("elicitation (no name) lists every server's policy", async () => {
        const cwd = mkdtempSync(join(tmpRoot, "cli-cwd3-"));
        const userDir = mkdtempSync(join(tmpRoot, "cli-user3-"));
        writeFileSync(
            join(userDir, "mcp.json"),
            JSON.stringify({
                mcpServers: {
                    "decliner": { command: NODE, args: [MOCK_SERVER] }, // default policy
                    "accepter": {
                        command: NODE,
                        args: [MOCK_SERVER],
                        elicitation: { autoAccept: true, autoDecline: false, defaultReason: "auto" },
                    },
                },
            }),
        );
        const r = await runMcpCommand(["elicitation"], { cwd, userDir, env: cleanEnv() });
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("decliner");
        expect(r.stdout).toContain("accepter");
        // Both autoAccept values visible — one true, one false.
        expect(r.stdout).toContain("autoAccept=true");
        expect(r.stdout).toContain("autoAccept=false");
    });

    test("elicitation with no configured servers → hint + the default policy", async () => {
        const cwd = mkdtempSync(join(tmpRoot, "cli-empty-"));
        const userDir = mkdtempSync(join(tmpRoot, "cli-empty-user-"));
        const r = await runMcpCommand(["elicitation"], { cwd, userDir, env: cleanEnv() });
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("no MCP servers configured");
        expect(r.stdout).toContain("autoDecline=true");
    });
});
