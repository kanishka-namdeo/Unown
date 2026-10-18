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
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    parseSseResponse,
    renderMcpStatus,
    resolveMcpConfig,
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
        const cfg = loadMcpConfigFile(file)!;
        expect(Object.keys(cfg.servers).sort()).toEqual(["http", "std"]);
        expect(isHttpConfig(cfg.servers.http!)).toBe(true);
        expect(isHttpConfig(cfg.servers.std!)).toBe(false);
        expect(loadMcpConfigFile(join(dir, "missing.json"))).toBe(null);
        const broken = join(dir, "broken.json");
        writeFileSync(broken, "{");
        expect(loadMcpConfigFile(broken)).toBe(null);
    });
    test("resolveMcpConfig: project wins per server name; disabled flags merge", () => {
        const userDir = join(tmpRoot, "user");
        const project = join(tmpRoot, "proj");
        mkdirSync(userDir, { recursive: true });
        mkdirSync(join(project, ".unown"), { recursive: true });
        writeFileSync(join(userDir, "mcp.json"), JSON.stringify({ mcpServers: { a: { command: "user-a" }, b: { command: "user-b" } } }));
        writeFileSync(join(project, ".unown", "mcp.json"), JSON.stringify({ mcpServers: { b: { command: "proj-b" } } }));
        const cfg = resolveMcpConfig(project, userDir);
        expect((cfg.servers.a as { command: string }).command).toBe("user-a");
        expect((cfg.servers.b as { command: string }).command).toBe("proj-b");
        writeFileSync(join(project, ".unown", "mcp.json"), JSON.stringify({ mcpServers: {}, disabled: true }));
        expect(resolveMcpConfig(project, userDir).disabled).toBe(true);
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
                // non-.exe commands wrap in cmd.exe: ["/d","/s","/c", <cmd>, ...args]
                expect(spec.command).toBe("cmd.exe");
                expect(spec.args[5]).toBe("key-value");
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
    return {
        messages,
        ctx: { ui: { notify: (text: string, level: string = "info") => messages.push({ text, level }) } },
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

        await emit("session_start", {});
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
