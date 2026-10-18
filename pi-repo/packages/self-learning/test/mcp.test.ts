// Unit tests for src/mcp.ts — the MCP client (Claude Code / codewhale / zcode port).
//
// Layers:
//   1. pure helpers — config normalization/layering, ${VAR} expansion, tool
//      naming/sanitization, schema normalization, description caps, SSE
//      parsing, spawn-spec (POSIX direct; win32 cmd.exe wrapper via a
//      platform-forced variant)
//   2. JsonMessageAccumulator — NDJSON and pretty-printed multi-line JSON
//   3. live stdio protocol against test/fixtures/mock-mcp-server.mjs —
//      initialize handshake, tools/list (flat + cursor pages), tools/call
//      round-trips, error tool, manager lazy connect + status + dispatch
//      degradation when the server binary does not exist
//   4. live streamable-HTTP against an in-process Bun.serve mock —
//      initialize + session-id capture + tools/list + tools/call (JSON and
//      SSE response modes)
//   5. the extension factory — session_start background-connect registers
//      mcp__server__tool entries through a fake pi; /mcp renders status
//   6. H1 hardening — accumulator garbage/cap recovery, HTTP 404 re-init +
//      replay, 429 backoff, timeout rewriting, bounded notify, cooldown
//      spawn-storm guard, per-session tool registration, guarded registration
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    capDescription,
    createMcpExtension,
    expandEnv,
    isHttpConfig,
    JsonMessageAccumulator,
    loadMcpConfigFile,
    McpManager,
    mcpToolName,
    normalizeInputSchema,
    parseMsEnv,
    parseSseResponse,
    renderMcpStatus,
    resolveMcpConfig,
    retryAfterMs,
    stdioSpawnSpec,
} from "../src/mcp.ts";

const MOCK_SERVER = join(import.meta.dir, "fixtures", "mock-mcp-server.mjs");
const NODE = "node";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-mcp-test-"));
afterAll(() => {
    try {
        rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

// ---------------------------------------------------------------------------
// 1. Pure helpers
// ---------------------------------------------------------------------------

describe("config helpers", () => {
    test("loadMcpConfigFile parses stdio + http entries, tolerates junk", () => {
        const dir = join(tmpRoot, "cfg");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "mcp.json");
        writeFileSync(
            file,
            JSON.stringify({
                mcpServers: {
                    std: { command: "npx", args: ["-y", "pkg"], env: { A: "1" } },
                    http: { url: "https://x.example/mcp", headers: { Authorization: "Bearer t" } },
                    broken: { nope: true },
                },
            }),
        );
        const { config: cfg, problems } = loadMcpConfigFile(file)!;
        expect(Object.keys(cfg!.servers).sort()).toEqual(["http", "std"]);
        expect(isHttpConfig(cfg!.servers.http!)).toBe(true);
        expect(isHttpConfig(cfg!.servers.std!)).toBe(false);
        // The junk entry surfaces as an actionable problem, not a crash.
        expect(problems.some((p) => p.key.startsWith("mcpServers.broken"))).toBe(true);
        expect(loadMcpConfigFile(join(dir, "missing.json")).config).toBe(null);
        const broken = join(dir, "broken.json");
        writeFileSync(broken, "{");
        const brokenResult = loadMcpConfigFile(broken);
        expect(brokenResult.config).toBe(null);
        expect(brokenResult.problems[0]!.message).toContain("invalid JSON");
    });
    test("resolveMcpConfig: project wins per server name; disabled flags merge", () => {
        const userDir = join(tmpRoot, "user");
        const project = join(tmpRoot, "proj");
        mkdirSync(userDir, { recursive: true });
        mkdirSync(join(project, ".unown"), { recursive: true });
        writeFileSync(join(userDir, "mcp.json"), JSON.stringify({ mcpServers: { a: { command: "user-a" }, b: { command: "user-b" } } }));
        writeFileSync(join(project, ".unown", "mcp.json"), JSON.stringify({ mcpServers: { b: { command: "proj-b" } } }));
        // Project file is untrusted by default → its entries are WITHHELD
        // (gatedServers), and the user entries still load. Bypass the gate
        // to exercise the merge semantics (project wins per name).
        const gated = resolveMcpConfig(project, userDir, { UNOWN_TRUST_PROJECT_CONFIG: "1" });
        expect((gated.config.servers.a as { command: string }).command).toBe("user-a");
        expect((gated.config.servers.b as { command: string }).command).toBe("proj-b");
        // Un-bypassed: the project override is withheld with needsTrust —
        // the user's own "b" stays as the effective config.
        const refused = resolveMcpConfig(project, userDir, {});
        expect(refused.needsTrust).toBe(true);
        expect(Object.keys(refused.gatedServers)).toEqual(["b"]);
        expect((refused.gatedServers.b as { command: string }).command).toBe("proj-b");
        expect((refused.config.servers.a as { command: string }).command).toBe("user-a");
        expect((refused.config.servers.b as { command: string }).command).toBe("user-b");
        writeFileSync(join(project, ".unown", "mcp.json"), JSON.stringify({ mcpServers: {}, disabled: true }));
        expect(resolveMcpConfig(project, userDir, { UNOWN_TRUST_PROJECT_CONFIG: "1" }).config.disabled).toBe(true);
    });
    test("expandEnv expands known vars, leaves unknown literal", () => {
        expect(expandEnv("key-${HOME}-tail", { HOME: "/home/u" })).toBe("key-/home/u-tail");
        expect(expandEnv("${MISSING_VAR_XYZ}", {})).toBe("${MISSING_VAR_XYZ}");
    });
});

describe("naming + schema + descriptions", () => {
    test("mcpToolName sanitizes to ^[a-z0-9_]+$ with caps", () => {
        expect(mcpToolName("My Server", "Search.Files!")).toBe("mcp__my_server__search_files");
        expect(mcpToolName("a".repeat(40), "t".repeat(40)).length).toBeLessThanOrEqual(64);
        expect(/^[a-z0-9_]+$/.test(mcpToolName("X Y", "Z!"))).toBe(true);
    });
    test("normalizeInputSchema passes object schemas, wraps the rest", () => {
        const good = { type: "object", properties: { a: { type: "string" } } };
        expect(normalizeInputSchema(good)).toBe(good);
        const wrapped = normalizeInputSchema({ type: "string" }) as { type: string; additionalProperties: boolean };
        expect(wrapped.type).toBe("object");
        expect(wrapped.additionalProperties).toBe(true);
        const nothing = normalizeInputSchema(undefined) as { type: string };
        expect(nothing.type).toBe("object");
    });
    test("capDescription trims and caps", () => {
        expect(capDescription(undefined)).toContain("no description");
        expect(capDescription("x".repeat(600))).toHaveLength(500);
        expect(capDescription("  a   b  ")).toBe("a b");
    });
});

describe("parseSseResponse", () => {
    test("finds the message with the id across events", () => {
        const body =
            'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"a":1}}\n\n' +
            'data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n' +
            'data: [DONE]\n\n';
        const parsed = parseSseResponse(body, 1) as { result?: { a?: number } };
        expect(parsed?.result?.a).toBe(1);
        expect(parseSseResponse(body, 99)).toBe(null);
    });
});

describe("stdioSpawnSpec", () => {
    test("posix: direct spawn with env expansion", () => {
        if (process.platform === "win32") return; // behavior forced below instead
        const spec = stdioSpawnSpec("npx", ["-y", "${PKG}"], { TOKEN: "${TOKEN}" }, "/w");
        expect(spec.command).toBe("npx");
        expect(spec.args).toEqual(["-y", "${PKG}"]); // unknown vars stay literal
        expect(spec.cwd).toBe("/w");
        const expanded = stdioSpawnSpec("npx", ["-y", "${PKG}"], { TOKEN: "${TOKEN}" }, "/w");
        expect(expanded.env).toEqual({ TOKEN: "${TOKEN}" });
    });
    test("expands env values from the environment", () => {
        process.env.MY_TEST_KEY = "key-value";
        process.env.MY_TEST_SECRET = "secret-value";
        try {
            const spec = stdioSpawnSpec("srv", ["--key", "${MY_TEST_KEY}"], { SECRET: "${MY_TEST_SECRET}" }, "/w");
            if (process.platform === "win32") {
                // non-.exe commands wrap in cmd.exe: ["/d","/s","/c", <pre-quoted line>]
                // — the line is ONE arg (args[3]), command + args are not flattened.
                expect(spec.command).toBe("cmd.exe");
                expect(spec.verbatim).toBe(true);
                expect(spec.args[3]).toContain("key-value"); // expanded inside the /c line
            } else {
                expect(spec.args[1]).toBe("key-value");
            }
            expect(spec.env.SECRET).toBe("secret-value");
        } finally {
            delete process.env.MY_TEST_KEY;
            delete process.env.MY_TEST_SECRET;
        }
    });
});

// ---------------------------------------------------------------------------
// 2. JsonMessageAccumulator
// ---------------------------------------------------------------------------

describe("JsonMessageAccumulator", () => {
    test("NDJSON: multiple messages across chunk splits", () => {
        const acc = new JsonMessageAccumulator();
        const a = acc.feed('{"id":1,"resul');
        const b = acc.feed('t":null}\n{"id":2,"result":{"x":1}}\n');
        expect(a).toHaveLength(0);
        expect(b).toHaveLength(2);
    });
    test("pretty-printed multi-line JSON is reassembled", () => {
        const acc = new JsonMessageAccumulator();
        const pretty = JSON.stringify({ jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "hi" }] } }, null, 2);
        const out = acc.feed(pretty + "\n");
        expect(out).toHaveLength(1);
        expect((out[0] as { id?: number }).id).toBe(7);
    });
    test("strings containing braces do not confuse depth tracking", () => {
        const acc = new JsonMessageAccumulator();
        const out = acc.feed(JSON.stringify({ id: 3, result: { text: "}{ not a brace \"}\" " } }) + "\n");
        expect(out).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// 3. Live stdio protocol (mock server)
// ---------------------------------------------------------------------------

describe("McpManager stdio (mock server)", () => {
    test("connect → listTools → callTool round-trips", async () => {
        const dir = join(tmpRoot, "stdio1");
        mkdirSync(dir, { recursive: true });
        const m = new McpManager({
            cwd: dir,
            config: { servers: { mock: { command: NODE, args: [MOCK_SERVER] } } },
            requestTimeoutMs: 10_000,
            connectTimeoutMs: 10_000,
        });
        expect(m.disabled).toBe(false);
        const conn = await m.connect("mock");
        expect(conn).not.toBeNull();
        expect(m.toolsFor("mock").map((t) => t.name)).toEqual(["echo", "add", "schemaless"]);
        const echo = await m.callTool("mock", "echo", { message: "hello world" });
        expect(echo.isError).toBe(false);
        expect(echo.text).toBe("echo: hello world");
        const add = await m.callTool("mock", "add", { a: 2, b: 40 });
        expect(add.text).toBe("42");
        const bad = await m.callTool("mock", "nope", {});
        expect(bad.isError).toBe(true);
        expect(bad.text).toContain("unknown tool");
        const status = m.status();
        expect(status[0].state).toBe("connected");
        expect(status[0].tools).toBe(3);
        m.disposeAll();
    });

    test("pretty-printed server output parses (MOCK_MCP_PRETTY=1)", async () => {
        const dir = join(tmpRoot, "stdio2");
        mkdirSync(dir, { recursive: true });
        const m = new McpManager({
            cwd: dir,
            config: {
                servers: {
                    pretty: { command: NODE, args: [MOCK_SERVER], env: { MOCK_MCP_PRETTY: "1" } },
                },
            },
            requestTimeoutMs: 10_000,
            connectTimeoutMs: 10_000,
        });
        const echo = await m.callTool("pretty", "echo", { message: "multi-line" });
        expect(echo.text).toBe("echo: multi-line");
        m.disposeAll();
    });

    test("missing binary degrades to an error result, never throws", async () => {
        const dir = join(tmpRoot, "stdio3");
        mkdirSync(dir, { recursive: true });
        const m = new McpManager({
            cwd: dir,
            config: { servers: { gone: { command: "definitely-not-a-real-mcp-binary" } } },
            requestTimeoutMs: 2_000,
            connectTimeoutMs: 2_000,
        });
        const result = await m.callTool("gone", "anything", {});
        expect(result.isError).toBe(true);
        expect(result.text).toContain("not connected");
        const status = m.status();
        expect(status[0].state).toBe("error");
    });

    test("disabled config reports disabled", () => {
        const m = new McpManager({ cwd: tmpRoot, config: { disabled: true, servers: {} } });
        expect(m.disabled).toBe(true);
        const envDisabled = new McpManager({ cwd: tmpRoot, config: { servers: {} }, env: { UNOWN_MCP: "0" } });
        expect(envDisabled.disabled).toBe(true);
    });

    test("cursor-paginated tools/list collects every page", async () => {
        const dir = join(tmpRoot, "stdio4");
        mkdirSync(dir, { recursive: true });
        const m = new McpManager({
            cwd: dir,
            config: { servers: { mock: { command: NODE, args: [MOCK_SERVER] } } },
            requestTimeoutMs: 10_000,
            connectTimeoutMs: 10_000,
        });
        const conn = await m.connect("mock");
        // Drive pagination directly: first page with cursor "0"
        const page = (await conn!.request("tools/list", { cursor: "0" }, 5000)) as {
            tools: Array<{ name: string }>;
            nextCursor?: string;
        };
        expect(page.tools).toHaveLength(1);
        expect(page.nextCursor).toBe("1");
        m.disposeAll();
    });
});

// ---------------------------------------------------------------------------
// 4. Live streamable-HTTP (in-process Bun.serve mock)
// ---------------------------------------------------------------------------

describe("McpManager streamable HTTP (Bun.serve mock)", () => {
    test("initialize + session-id + tools/list + tools/call (JSON mode)", async () => {
        let sawSessionHeader = false;
        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                const message = (await req.json()) as { id?: number; method?: string; params?: any };
                if (req.headers.get("mcp-session-id") === "sess-42") sawSessionHeader = true;
                const id = message.id;
                if (message.method === "initialize") {
                    return Response.json(
                        { jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock-http" } } },
                        { headers: { "mcp-session-id": "sess-42" } },
                    );
                }
                if (message.method === "tools/list") {
                    return Response.json({
                        jsonrpc: "2.0",
                        id,
                        result: { tools: [{ name: "time", description: "current time", inputSchema: { type: "object", properties: {} } }] },
                    });
                }
                if (message.method === "tools/call") {
                    return Response.json({
                        jsonrpc: "2.0",
                        id,
                        result: { content: [{ type: "text", text: "the-time" }] },
                    });
                }
                return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });
            },
        });
        try {
            const m = new McpManager({
                cwd: tmpRoot,
                config: { servers: { remote: { url: `http://127.0.0.1:${server.port}/mcp` } } },
                requestTimeoutMs: 5_000,
                connectTimeoutMs: 5_000,
            });
            const tools = await m.callTool("remote", "time", {});
            expect(tools.text).toBe("the-time");
            expect(tools.isError).toBe(false);
            expect(m.toolsFor("remote").map((t) => t.name)).toEqual(["time"]);
            expect(sawSessionHeader).toBe(true); // session id replayed after initialize
            expect(m.status()[0].transport).toBe("http");
            m.disposeAll();
        } finally {
            server.stop(true);
        }
    });

    test("SSE response mode parses", async () => {
        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                const message = (await req.json()) as { id?: number; method?: string; params?: any };
                const id = message.id;
                if (message.method === "initialize") {
                    return new Response(
                        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "sse" } } })}\n\n`,
                        { headers: { "content-type": "text/event-stream" } },
                    );
                }
                if (message.method === "tools/list") {
                    const body =
                        `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })}\n\n` +
                        `data: ${JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [{ name: "sse-tool" }] } })}\n\n`;
                    return new Response(body, { headers: { "content-type": "text/event-stream" } });
                }
                if (message.method === "tools/call") {
                    return new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "sse-ok" }] } })}\n\n`, {
                        headers: { "content-type": "text/event-stream" },
                    });
                }
                return new Response("bad", { status: 500 });
            },
        });
        try {
            const m = new McpManager({
                cwd: tmpRoot,
                config: { servers: { sse: { url: `http://127.0.0.1:${server.port}/mcp` } } },
                requestTimeoutMs: 5_000,
                connectTimeoutMs: 5_000,
            });
            const result = await m.callTool("sse", "sse-tool", {});
            expect(result.text).toBe("sse-ok");
            m.disposeAll();
        } finally {
            server.stop(true);
        }
    });
});

// ---------------------------------------------------------------------------
// 5. The extension factory (fake pi)
// ---------------------------------------------------------------------------

type Handler = (event: any, ctx?: any) => any;

function makeFakePi() {
    const handlers = new Map<string, Handler[]>();
    const commands = new Map<string, { description: string; handler: Handler }>();
    const tools = new Map<string, any>();
    const pi: any = {
        on: (event: string, handler: Handler) => {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event)!.push(handler);
        },
        registerCommand: (name: string, def: { description: string; handler: Handler }) => commands.set(name, def),
        registerTool: (tool: any) => tools.set(tool.name, tool),
    };
    const emit = async (event: string, payload: any, ctx?: any) => {
        for (const h of handlers.get(event) ?? []) await h(payload, ctx);
    };
    const runCommand = async (name: string, args: string, ctx: any) => {
        await commands.get(name)!.handler(args, ctx);
    };
    return { pi, emit, runCommand, tools, commands };
}

function makeNotify() {
    const messages: Array<{ text: string; level: string }> = [];
    // Footer seam recorder (P1-b): ctx.ui.setStatus writes land here so the
    // extension's status-bar wiring is assertable through the same harness.
    const statuses: Array<[string, string | undefined]> = [];
    return {
        messages,
        statuses,
        ctx: {
            hasUI: true,
            ui: {
                notify: (text: string, level: string = "info") => messages.push({ text, level }),
                setStatus: (key: string, text: string | undefined) => statuses.push([key, text]),
            },
        },
    };
}

describe("createMcpExtension", () => {
    test("session_start background-connects and registers mcp__server__tool entries", async () => {
        const dir = join(tmpRoot, "ext1");
        mkdirSync(dir, { recursive: true });
        const ext = createMcpExtension({
            cwd: dir,
            config: { servers: { mock: { command: NODE, args: [MOCK_SERVER] } } },
        });
        const { pi, emit, tools } = makeFakePi();
        ext.factory(pi);

        const { ctx, statuses } = makeNotify();
        await emit("session_start", {}, ctx);
        // background connect — poll briefly for registration
        const deadline = Date.now() + 8000;
        while (tools.size < 3 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
        }
        expect(tools.has("mcp__mock__echo")).toBe(true);
        expect(tools.has("mcp__mock__add")).toBe(true);
        expect(tools.has("mcp__mock__schemaless")).toBe(true);
        const echoTool = tools.get("mcp__mock__echo")!;
        expect(echoTool.description).toContain("Echo a message back");
        expect(echoTool.description).toContain("MCP server: mock");
        const result = await echoTool.execute("t1", { message: "via extension" });
        expect(result.content[0].text).toBe("echo: via extension");
        expect(result.isError).toBeUndefined();
        // P1-b footer line: once the background connect finishes, the footer
        // carries the one-line integration health summary.
        expect(statuses.some(([k, t]) => k === "mcp" && t === "mcp: 1/1 · 3 tools")).toBe(true);
    });

    test("/mcp renders status and empty-config guidance", async () => {
        const dir = join(tmpRoot, "ext2");
        mkdirSync(dir, { recursive: true });
        const ext = createMcpExtension({ cwd: dir, config: { servers: {} } });
        const { pi, runCommand } = makeFakePi();
        ext.factory(pi);
        const { ctx, messages } = makeNotify();
        await runCommand("mcp", "", ctx);
        expect(messages[0].text).toContain("No MCP servers configured");
        expect(renderMcpStatus([])).toContain("mcpServers");
    });

    test("failed server never blocks the session; /mcp shows the error", async () => {
        const dir = join(tmpRoot, "ext3");
        mkdirSync(dir, { recursive: true });
        const ext = createMcpExtension({
            cwd: dir,
            config: { servers: { gone: { command: "not-a-real-mcp-binary-xyz" } } },
        });
        const { pi, emit, runCommand } = makeFakePi();
        ext.factory(pi);
        const { ctx, messages } = makeNotify();
        await emit("session_start", {}); // must not throw
        await runCommand("mcp", "", ctx);
        const statusMessage = messages.find((m) => m.text.includes("gone"));
        expect(statusMessage).toBeDefined();
        expect(statusMessage!.text).toContain("error");
    });

    test("disabled via UNOWN_MCP=0: no connect, message on /mcp", async () => {
        const dir = join(tmpRoot, "ext4");
        mkdirSync(dir, { recursive: true });
        const prev = process.env.UNOWN_MCP;
        process.env.UNOWN_MCP = "0";
        try {
            const ext = createMcpExtension({
                cwd: dir,
                config: { servers: { mock: { command: NODE, args: [MOCK_SERVER] } } },
            });
            const { pi, emit, runCommand, tools } = makeFakePi();
            ext.factory(pi);
            const { ctx, messages } = makeNotify();
            await emit("session_start", {});
            await new Promise((r) => setTimeout(r, 300));
            expect(tools.size).toBe(0);
            await runCommand("mcp", "", ctx);
            expect(messages[0].text).toContain("disabled");
        } finally {
            if (prev === undefined) delete process.env.UNOWN_MCP;
            else process.env.UNOWN_MCP = prev;
        }
    });
});

// ---------------------------------------------------------------------------
// 6. H1 hardening — accumulator, HTTP recovery, cooldown, per-session state
// ---------------------------------------------------------------------------

describe("JsonMessageAccumulator garbage recovery (H1)", () => {
    test("stray closers (depth-negative poison) do not kill the transport", () => {
        const acc = new JsonMessageAccumulator();
        const out = acc.feed("}]\n" + JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }) + "\n");
        expect(out).toHaveLength(1);
        expect((out[0] as { id?: number }).id).toBe(1);
    });

    test("garbage banner before a message is isolated; message still delivered", () => {
        const acc = new JsonMessageAccumulator();
        const out = acc.feed("listening on port 3000\n" + JSON.stringify({ jsonrpc: "2.0", id: 7, result: { ok: true } }) + "\n");
        expect(out).toHaveLength(1);
        expect((out[0] as { id?: number }).id).toBe(7);
    });

    test("NUL and binary junk outside strings are dropped; next message survives", () => {
        const acc = new JsonMessageAccumulator();
        const out = acc.feed("\x00\x01\x02junk\x00" + JSON.stringify({ id: 2, result: null }) + "\n");
        expect(out).toHaveLength(1);
        expect((out[0] as { id?: number }).id).toBe(2);
    });

    test("a corrupt JSON message is skipped without poisoning the next", () => {
        const acc = new JsonMessageAccumulator();
        const out = acc.feed('{"id":1,"result":}\n' + JSON.stringify({ id: 2, result: "ok" }) + "\n");
        expect(out).toHaveLength(1);
        expect((out[0] as { id?: number }).id).toBe(2);
    });

    test("cap breaches surface an error and flush; the stream recovers", () => {
        const acc = new JsonMessageAccumulator(64, 256);
        const errors: string[] = [];
        acc.onError = (msg) => errors.push(msg);
        const out = acc.feed('{"id":1,"result":"' + "x".repeat(100) + '"}\n');
        expect(out).toHaveLength(0); // oversized message dropped
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("cap exceeded");
        expect(errors[0]).toContain("message");
        // total-buffer cap: unstructured junk beyond the cap also surfaces
        errors.length = 0;
        acc.feed("y".repeat(300));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("total buffered output");
        // and a valid message after the flush still parses
        const next = acc.feed(JSON.stringify({ id: 3, result: null }) + "\n");
        expect(next).toHaveLength(1);
    });
});

describe("McpManager H1 stdio hardening", () => {
    test("garbage on a real stdio transport still connects (MOCK_MCP_GARBAGE=1)", async () => {
        const dir = join(tmpRoot, "h1garbage");
        mkdirSync(dir, { recursive: true });
        const m = new McpManager({
            cwd: dir,
            config: { servers: { noisy: { command: NODE, args: [MOCK_SERVER], env: { MOCK_MCP_GARBAGE: "1" } } } },
            requestTimeoutMs: 10_000,
            connectTimeoutMs: 10_000,
        });
        const echo = await m.callTool("noisy", "echo", { message: "still alive" });
        expect(echo.isError).toBe(false);
        expect(echo.text).toBe("echo: still alive");
        m.disposeAll();
    });

    test("oversized (>1 MiB) message surfaces a cap error, not a wedge", async () => {
        const dir = join(tmpRoot, "h1bigmsg");
        mkdirSync(dir, { recursive: true });
        const m = new McpManager({
            cwd: dir,
            config: { servers: { mock: { command: NODE, args: [MOCK_SERVER] } } },
            requestTimeoutMs: 30_000,
            connectTimeoutMs: 10_000,
        });
        const started = Date.now();
        const result = await m.callTool("mock", "echo", { message: "x".repeat(1_500_000) });
        expect(result.isError).toBe(true);
        expect(result.text).toContain("cap exceeded");
        expect(Date.now() - started).toBeLessThan(10_000); // bounded failure, not a 120 s timeout wedge
        m.disposeAll();
    });

    test("mid-session stdio crash rejects pending requests and cools down reconnects", async () => {
        const dir = join(tmpRoot, "h1crash");
        mkdirSync(dir, { recursive: true });
        const m = new McpManager({
            cwd: dir,
            config: { servers: { mock: { command: NODE, args: [MOCK_SERVER] } } },
            requestTimeoutMs: 5_000,
            connectTimeoutMs: 5_000,
        });
        const conn = await m.connect("mock");
        expect(conn).not.toBeNull();
        await expect(conn!.request("$/mockCrash", {}, 5_000)).rejects.toThrow("server exited (code 1)");
        // within the (default 30 s) cooldown: no respawn, clean degradation
        const result = await m.callTool("mock", "echo", { message: "hi" });
        expect(result.isError).toBe(true);
        expect(result.text).toContain("not connected");
        m.disposeAll();
    });

    test("failed server cooldown: exactly one spawn until /mcp force-throughs", async () => {
        const dir = join(tmpRoot, "h1cooldown");
        mkdirSync(dir, { recursive: true });
        const counter = join(dir, "spawns.txt");
        const script = `require("fs").appendFileSync(${JSON.stringify(counter)}, "x"); process.exit(3);`;
        const m = new McpManager({
            cwd: dir,
            config: { servers: { gone: { command: NODE, args: ["-e", script] } } },
            requestTimeoutMs: 2_000,
            connectTimeoutMs: 2_000,
            reconnectCooldownMs: 60_000,
        });
        const r1 = await m.callTool("gone", "t", {});
        expect(r1.isError).toBe(true);
        const r2 = await m.callTool("gone", "t", {}); // within cooldown → skipped, no spawn
        expect(r2.isError).toBe(true);
        expect(readFileSync(counter, "utf8")).toBe("x"); // exactly ONE spawn so far
        const ok = await m.connectAll(true); // /mcp reconnect forces through
        expect(ok).toEqual([]);
        expect(readFileSync(counter, "utf8")).toBe("xx"); // forced second spawn
        m.disposeAll();
    });
});

describe("McpManager H1 HTTP robustness (Bun.serve mocks)", () => {
    test("404 → re-initialize with a new session id and replay the request", async () => {
        let initCount = 0;
        let currentSession = "sess-1";
        let expiredOnce = false;
        const sessionIdsOnCalls: string[] = [];
        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                const message = (await req.json()) as { id?: number; method?: string; params?: any };
                if (message.method === "initialize") {
                    initCount++;
                    currentSession = `sess-${initCount}`; // server restart rotates ids
                    return Response.json(
                        { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock" } } },
                        { headers: { "mcp-session-id": currentSession } },
                    );
                }
                const sid = req.headers.get("mcp-session-id");
                if (sid && message.method === "tools/call") sessionIdsOnCalls.push(sid);
                if (sid && message.method === "tools/call" && !expiredOnce) {
                    expiredOnce = true;
                    return new Response("session expired", { status: 404 });
                }
                if (message.method === "tools/list") {
                    return Response.json({
                        jsonrpc: "2.0",
                        id: message.id,
                        result: { tools: [{ name: "time", inputSchema: { type: "object", properties: {} } }] },
                    });
                }
                if (message.method === "tools/call") {
                    return Response.json({
                        jsonrpc: "2.0",
                        id: message.id,
                        result: { content: [{ type: "text", text: "after-404-recovery" }] },
                    });
                }
                return Response.json({ jsonrpc: "2.0", id: message.id, result: {} });
            },
        });
        try {
            const m = new McpManager({
                cwd: tmpRoot,
                config: { servers: { remote: { url: `http://127.0.0.1:${server.port}/mcp` } } },
                requestTimeoutMs: 5_000,
                connectTimeoutMs: 5_000,
            });
            const result = await m.callTool("remote", "time", {});
            expect(result.isError).toBe(false);
            expect(result.text).toBe("after-404-recovery");
            expect(initCount).toBe(2); // original + one re-initialize
            expect(sessionIdsOnCalls).toEqual(["sess-1", "sess-2"]); // replay adopted the new session id
            m.disposeAll();
        } finally {
            server.stop(true);
        }
    });

    test("429 with Retry-After: 0 is retried and succeeds", async () => {
        let hits = 0;
        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                const message = (await req.json()) as { id?: number; method?: string };
                if (message.method === "tools/call") {
                    hits++;
                    if (hits === 1) return new Response("busy", { status: 429, headers: { "retry-after": "0" } });
                    return Response.json({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "ok-after-429" }] } });
                }
                return Response.json({ jsonrpc: "2.0", id: message.id, result: { tools: [] } });
            },
        });
        try {
            const m = new McpManager({
                cwd: tmpRoot,
                config: { servers: { busy: { url: `http://127.0.0.1:${server.port}/mcp` } } },
                requestTimeoutMs: 5_000,
                connectTimeoutMs: 5_000,
            });
            const result = await m.callTool("busy", "time", {});
            expect(result.isError).toBe(false);
            expect(result.text).toBe("ok-after-429");
            expect(hits).toBe(2);
            m.disposeAll();
        } finally {
            server.stop(true);
        }
    });

    test("429 exhaustion surfaces a clear error after the retry cap", async () => {
        let hits = 0;
        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                const message = (await req.json()) as { id?: number; method?: string };
                if (message.method === "tools/call") {
                    hits++;
                    return new Response("busy", { status: 429, headers: { "retry-after": "0" } });
                }
                return Response.json({ jsonrpc: "2.0", id: message.id, result: { tools: [] } });
            },
        });
        try {
            const m = new McpManager({
                cwd: tmpRoot,
                config: { servers: { alwaysbusy: { url: `http://127.0.0.1:${server.port}/mcp` } } },
                requestTimeoutMs: 5_000,
                connectTimeoutMs: 5_000,
            });
            const result = await m.callTool("alwaysbusy", "time", {});
            expect(result.isError).toBe(true);
            expect(result.text).toContain("429");
            expect(result.text).toContain("retries exhausted");
            expect(hits).toBe(3); // 1 attempt + 2 retries
            m.disposeAll();
        } finally {
            server.stop(true);
        }
    });

    test("aborted HTTP request is rewritten into a clear timeout error", async () => {
        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                const message = (await req.json()) as { id?: number; method?: string };
                if (message.method === "tools/call") {
                    await new Promise(() => {}); // never responds
                }
                return Response.json({ jsonrpc: "2.0", id: message.id, result: { tools: [] } });
            },
        });
        try {
            const m = new McpManager({
                cwd: tmpRoot,
                config: { servers: { slow: { url: `http://127.0.0.1:${server.port}/mcp` } } },
                requestTimeoutMs: 400,
                connectTimeoutMs: 5_000,
            });
            const started = Date.now();
            const result = await m.callTool("slow", "time", {});
            expect(result.isError).toBe(true);
            expect(result.text).toContain("timed out after 400ms");
            expect(Date.now() - started).toBeLessThan(3_000);
            m.disposeAll();
        } finally {
            server.stop(true);
        }
    });

    test("HTTP notify() is bounded by an AbortController", async () => {
        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                const message = (await req.json()) as { id?: number; method?: string };
                return Response.json({ jsonrpc: "2.0", id: message.id, result: { tools: [] } });
            },
        });
        const m = new McpManager({
            cwd: tmpRoot,
            config: { servers: { remote: { url: `http://127.0.0.1:${server.port}/mcp` } } },
            requestTimeoutMs: 5_000,
            connectTimeoutMs: 5_000,
            keepalive: false,
        });
        try {
            const conn = await m.connect("remote");
            expect(conn).not.toBeNull();
            // Swap in a fetch that never resolves and reports aborts — the
            // notify() bound must fire its AbortController.
            const originalFetch = globalThis.fetch;
            let sawAbort = false;
            globalThis.fetch = ((input: any, init: any) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => {
                        sawAbort = true;
                        reject(new Error("aborted"));
                    });
                })) as typeof fetch;
            try {
                conn!.notifyTimeoutMs = 120;
                conn!.notify("notifications/test", {});
                await new Promise((r) => setTimeout(r, 400));
                expect(sawAbort).toBe(true);
            } finally {
                globalThis.fetch = originalFetch;
            }
        } finally {
            m.disposeAll();
            server.stop(true);
        }
    });
});

describe("createMcpExtension H1 lifecycle", () => {
    test("second factory() invocation (new session runtime) registers tools again", async () => {
        const dir = join(tmpRoot, "h1ext2");
        mkdirSync(dir, { recursive: true });
        const ext = createMcpExtension({
            cwd: dir,
            config: { servers: { mock: { command: NODE, args: [MOCK_SERVER] } } },
        });
        const first = makeFakePi();
        const second = makeFakePi();
        ext.factory(first.pi);
        ext.factory(second.pi);
        await first.emit("session_start", {});
        await second.emit("session_start", {});
        const deadline = Date.now() + 8_000;
        while ((first.tools.size < 3 || second.tools.size < 3) && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
        }
        expect(first.tools.has("mcp__mock__echo")).toBe(true);
        expect(second.tools.has("mcp__mock__echo")).toBe(true);
        expect(second.tools.has("mcp__mock__add")).toBe(true);
        expect(second.tools.has("mcp__mock__schemaless")).toBe(true);
        // the second session's tool actually works end-to-end
        const echoTool = second.tools.get("mcp__mock__echo")!;
        const result = await echoTool.execute("t2", { message: "from session two" });
        expect(result.content[0].text).toBe("echo: from session two");
        await second.emit("session_shutdown", {});
    });

    test("registerTool throwing never produces an unhandled rejection; /mcp still works", async () => {
        const dir = join(tmpRoot, "h1ext3");
        mkdirSync(dir, { recursive: true });
        const ext = createMcpExtension({
            cwd: dir,
            config: { servers: { mock: { command: NODE, args: [MOCK_SERVER] } } },
        });
        const { pi, emit, runCommand } = makeFakePi();
        ext.factory(pi);
        const originalRegister = pi.registerTool;
        pi.registerTool = () => {
            throw new Error("boom");
        };
        await emit("session_start", {}); // must not reject (the crash used to kill the process)
        await new Promise((r) => setTimeout(r, 1_500)); // background connect + throwing registrations
        pi.registerTool = originalRegister;
        // the session is still usable: /mcp renders status and registers now
        const { ctx, messages } = makeNotify();
        await runCommand("mcp", "", ctx); // must not reject
        expect(messages.some((m) => m.text.includes("mock"))).toBe(true);
        await emit("session_shutdown", {});
    });
});

describe("parseMsEnv + retryAfterMs (H1)", () => {
    test("junk/empty/negative/zero/absurd values fall back to the default", () => {
        expect(parseMsEnv("X", 1_000, {})).toBe(1_000);
        expect(parseMsEnv("X", 1_000, { X: "abc" })).toBe(1_000);
        expect(parseMsEnv("X", 1_000, { X: "" })).toBe(1_000);
        expect(parseMsEnv("X", 1_000, { X: "-5" })).toBe(1_000);
        expect(parseMsEnv("X", 1_000, { X: "0" })).toBe(1_000);
        expect(parseMsEnv("X", 1_000, { X: "999999999999999" })).toBe(1_000); // > 24 h is absurd
    });
    test("valid values parse; a custom absurdity bound applies", () => {
        expect(parseMsEnv("X", 1_000, { X: "2500" })).toBe(2_500);
        expect(parseMsEnv("X", 500, { X: "2000" }, 1_000)).toBe(500); // over the custom bound
    });
    test("manager env fallbacks parse tolerantly", () => {
        const m = new McpManager({ cwd: tmpRoot, env: { UNOWN_MCP_TIMEOUT_MS: "abc", UNOWN_MCP_CONNECT_TIMEOUT_MS: "" } });
        expect(m.requestTimeoutMs).toBe(120_000);
        expect(m.connectTimeoutMs).toBe(20_000);
    });
    test("retryAfterMs honors seconds, caps at 30 s, defaults to backoff", () => {
        expect(retryAfterMs("0", 0)).toBe(0);
        expect(retryAfterMs("2", 0)).toBe(2_000);
        expect(retryAfterMs("999999", 0)).toBe(30_000); // capped
        expect(retryAfterMs(null, 0)).toBe(250); // exponential fallback
        expect(retryAfterMs(null, 2)).toBe(1_000);
    });
});

// ---------------------------------------------------------------------------
// H2: trust gate, URL validation, spawn spec, clientInfo, truncation
// ---------------------------------------------------------------------------

describe("H2 trust gate + validation", () => {
    test("untrusted project mcp.json never spawns: session_start registers nothing; /mcp shows the approval action; /mcp trust admits it", async () => {
        const dir = join(tmpRoot, "h2-trust");
        mkdirSync(join(dir, ".unown"), { recursive: true });
        writeFileSync(
            join(dir, ".unown", "mcp.json"),
            JSON.stringify({ mcpServers: { gated: { command: NODE, args: [MOCK_SERVER] } } }),
        );
        // No opts.config → the real resolveMcpConfig path runs; the suite's
        // _env.ts preload redirects UNOWN_HOME so trust state is isolated.
        const ext = createMcpExtension({ cwd: dir });
        const { pi, emit, tools, runCommand } = makeFakePi();
        ext.factory(pi);
        await emit("session_start", {});
        await new Promise((r) => setTimeout(r, 600));
        expect(tools.size).toBe(0); // REFUSE FIRST: nothing spawned, nothing registered

        const status = makeNotify();
        await runCommand("mcp", "", status.ctx);
        expect(status.messages.some((m) => m.text.includes("UNTRUSTED"))).toBe(true);

        const trust = makeNotify();
        await runCommand("mcp", "trust", trust.ctx);
        expect(trust.messages.some((m) => m.text.includes("Trusted"))).toBe(true);
        // Poll for the post-trust background registration.
        const deadline = Date.now() + 8000;
        while (tools.size < 1 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
        }
        expect(tools.has("mcp__gated__echo")).toBe(true);
    });

    test("footer line (P1-b): withheld → 'mcp: N withheld (untrusted)' at session_start, live count after /mcp trust", async () => {
        const dir = join(tmpRoot, "p1b-footer");
        mkdirSync(join(dir, ".unown"), { recursive: true });
        writeFileSync(
            join(dir, ".unown", "mcp.json"),
            JSON.stringify({ mcpServers: { gated: { command: NODE, args: [MOCK_SERVER] } } }),
        );
        // Real config resolution (isolated UNOWN_HOME via _env.ts) — the
        // project server is withheld by the trust gate at session_start.
        const ext = createMcpExtension({ cwd: dir });
        const { pi, emit, tools, runCommand } = makeFakePi();
        ext.factory(pi);
        const { ctx, messages, statuses } = makeNotify();
        await emit("session_start", {}, ctx);
        await new Promise((r) => setTimeout(r, 400));
        expect(tools.size).toBe(0); // refused, never spawned
        expect(statuses.some(([k, t]) => k === "mcp" && t === "mcp: 1 withheld (untrusted)")).toBe(true);
        // /mcp trust admits it: connect + registration + a live footer line.
        await runCommand("mcp", "trust", ctx);
        expect(messages.some((m) => m.text.includes("Trusted"))).toBe(true);
        const deadline = Date.now() + 8000;
        while (!tools.has("mcp__gated__echo") && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
        }
        expect(tools.has("mcp__gated__echo")).toBe(true);
        expect(statuses.some(([k, t]) => k === "mcp" && t === "mcp: 1/1 · 3 tools")).toBe(true);
    });

    test("URL validation: non-http schemes and unparseable URLs surface actionable problems at config load", () => {
        const dir = join(tmpRoot, "h2-url");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "mcp.json");
        writeFileSync(
            file,
            JSON.stringify({
                mcpServers: {
                    badScheme: { url: "file:///etc/passwd" },
                    unparseable: { url: "http://" },
                    good: { url: "https://example.com/mcp" },
                },
            }),
        );
        const { config, problems } = loadMcpConfigFile(file)!;
        expect(config!.servers.good).toBeDefined();
        expect(config!.servers.badScheme).toBeUndefined(); // rejected, not spawned
        expect(config!.servers.unparseable).toBeUndefined();
        const keys = problems.map((p) => p.key);
        expect(keys.some((k) => k.includes("badScheme"))).toBe(true);
        expect(keys.some((k) => k.includes("unparseable"))).toBe(true);
        expect(problems.some((p) => p.hint?.includes("http"))).toBe(true);
    });

    test("header values with line breaks are dropped with an actionable problem (request splitting)", () => {
        const dir = join(tmpRoot, "h2-headers");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "mcp.json");
        writeFileSync(
            file,
            JSON.stringify({
                mcpServers: {
                    evil: { url: "https://x.example/mcp", headers: { Authorization: "Bearer t\r\nX-Injected: 1", "X-Ok": "fine" } },
                },
            }),
        );
        const { config, problems } = loadMcpConfigFile(file)!;
        // The dangerous header is dropped (never sent); the sane one survives.
        const entry = config!.servers.evil as { url: string; headers?: Record<string, string> };
        expect(entry.url).toBe("https://x.example/mcp");
        expect(entry.headers?.Authorization).toBeUndefined();
        expect(entry.headers?.["X-Ok"]).toBe("fine");
        expect(problems.some((p) => p.key.includes("Authorization") && p.message.includes("line break"))).toBe(true);
    });

    test("${VAR} expands in url and cwd (H2 M-10)", () => {
        const dir = join(tmpRoot, "h2-var");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "mcp.json");
        writeFileSync(
            file,
            JSON.stringify({ mcpServers: { h: { url: "https://${H2_HOST}/mcp", command: undefined } } }),
        );
        const { config } = loadMcpConfigFile(file, { H2_HOST: "expanded.example" })!;
        expect((config!.servers.h as { url: string }).url).toBe("https://expanded.example/mcp");
        // Unknown vars stay literal (existing contract).
        const { config: lit } = loadMcpConfigFile(file, {})!;
        expect((lit!.servers.h as { url: string }).url).toBe("https://${H2_HOST}/mcp");
    });

    test("stdioSpawnSpec: CRLF refused, % refused on win32 cmd path, metachars escaped, non-win32 passthrough", () => {
        // Line-break injection refused on every platform.
        expect(() => stdioSpawnSpec("echo", ["a\r\nb"], {}, "/tmp")).toThrow("line break");
        expect(() => stdioSpawnSpec("ec\nho", [], {}, "/tmp")).toThrow("line break");
        // win32: non-exe commands wrap through cmd.exe with escaped args.
        const win = stdioSpawnSpec("npx.cmd", ["-y", "pkg&evil"], {}, "C:\\proj", { platform: "win32" });
        expect(win.command).toBe("cmd.exe");
        expect(win.args[0]).toBe("/d");
        expect(win.args[3]).toContain("pkg&evil"); // wrapped in quotes → literal
        expect(win.verbatim).toBe(true); // wrapper lines are pre-quoted — spawn must not re-escape
        // win32: % is unescapable through cmd.exe — refused.
        expect(() => stdioSpawnSpec("npx.cmd", ["%VAR%"], {}, "C:\\proj", { platform: "win32" })).toThrow("'%'");
        // win32: .exe binaries spawn directly (no cmd wrapper).
        const exe = stdioSpawnSpec("C:\\tool\\srv.exe", ["-v"], {}, "C:\\proj", { platform: "win32" });
        expect(exe.command).toBe("C:\\tool\\srv.exe");
        expect(exe.verbatim).toBe(false);
        // posix: passthrough untouched.
        const nix = stdioSpawnSpec("npx", ["-y", "pkg"], {}, "/tmp", { platform: "linux" });
        expect(nix.command).toBe("npx");
        expect(nix.args).toEqual(["-y", "pkg"]);
        expect(nix.verbatim).toBe(false);
        // ${VAR} expansion through expandWith applies to command and args.
        // (platform forced: this asserts EXPANSION, not platform routing —
        // without the force, win32 wraps "node" in the cmd.exe wrapper.)
        const expanded = stdioSpawnSpec("${BIN}", ["-${MODE}-"], {}, "/tmp", { platform: "linux", expandWith: { BIN: "node", MODE: "fast" } });
        expect(expanded.command).toBe("node");
        expect(expanded.args).toEqual(["-fast-"]);
    });

    test("initialize carries clientInfo {name:'unown'} and protocolVersion (HTTP capture)", async () => {
        const seen: any[] = [];
        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                const message = (await req.json()) as { id?: number; method?: string; params?: any };
                if (message.method === "initialize") seen.push(message.params);
                if (message.method === "initialize") {
                    return Response.json(
                        { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock" } } },
                        { headers: { "mcp-session-id": "s1" } },
                    );
                }
                if (message.method === "tools/list") {
                    return Response.json({ jsonrpc: "2.0", id: message.id, result: { tools: [] } });
                }
                return Response.json({ jsonrpc: "2.0", id: message.id, result: {} });
            },
        });
        try {
            const m = new McpManager({
                cwd: tmpRoot,
                config: { servers: { probe: { url: `http://127.0.0.1:${server.port}/mcp` } } },
                requestTimeoutMs: 5_000,
                connectTimeoutMs: 5_000,
            });
            await m.connectAll();
            expect(seen).toHaveLength(1);
            expect(seen[0]!.clientInfo?.name).toBe("unown");
            expect(typeof seen[0]!.clientInfo?.version).toBe("string");
            expect(seen[0]!.protocolVersion).toBe("2025-06-18");
            m.disposeAll();
        } finally {
            server.stop(true);
        }
    });

    test("oversized tool results are visibly truncated (M-14)", async () => {
        const m = new McpManager({
            cwd: tmpRoot,
            config: { servers: { mock: { command: NODE, args: [MOCK_SERVER] } } },
            requestTimeoutMs: 10_000,
            connectTimeoutMs: 10_000,
        });
        try {
            const big = "x".repeat(20_000);
            const result = await m.callTool("mock", "echo", { message: big });
            expect(result.text!.length).toBeLessThan(17_000);
            expect(result.text!.endsWith("(truncated at 16000 chars)")).toBe(true);
        } finally {
            m.disposeAll();
        }
    });
});
