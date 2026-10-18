/**
 * mcp.ts — Model Context Protocol client for the unown terminal agent.
 *
 * Reverse-engineered from the MCP surfaces of Claude Code (`.mcp.json`,
 * `mcp__server__tool` naming, stdio + streamable HTTP), codewhale
 * (docs/MCP.md: stdio + Streamable HTTP/SSE, `/mcp` inventory) and zcode
 * (docs/mcp-services: project/user config, failed server never blocks the
 * session), reduced to a zero-dependency pure-TS client on pi's seams:
 *
 *   - config discovery: `~/.unown/agent/mcp.json` (user) ← `.unown/mcp.json`
 *     (project wins per server name), Claude-compatible `mcpServers` shape:
 *     `{ "name": { "command": "...", "args": [...], "env": {...} } }` for
 *     stdio and `{ "name": { "url": "https://...", "headers": {...} } }` for
 *     streamable HTTP. `${VAR}` expands from the environment.
 *   - transports: stdio (newline-delimited JSON-RPC; a depth-aware
 *     accumulator tolerates servers that pretty-print) and streamable HTTP
 *     (POST JSON-RPC, `Mcp-Session-Id` header capture/replay, application/json
 *     and text/event-stream responses both parsed).
 *   - lazy connect: servers never block session start — the extension kicks
 *     off background connects at session_start and registers each tool the
 *     moment its server answers (dynamic `pi.registerTool`, the documented
 *     pi extension capability). A failed server marks itself `error` and
 *     stays out of the way (zcode's rule).
 *   - tool naming: `mcp__<server>__<tool>` (sanitized to ^[a-z0-9_]+$);
 *     descriptions capped at 500 chars; per-server tool cap 100.
 *
 * Env: `UNOWN_MCP=0` disables the surface; `UNOWN_MCP_TIMEOUT_MS` (120000)
 * per JSON-RPC request; `UNOWN_MCP_CONNECT_TIMEOUT_MS` (20000) for
 * initialize; result text capped at 16 k chars.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { UNOWN_AGENT_DIR } from "./term.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface StdioServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}

export interface HttpServerConfig {
    url: string;
    headers?: Record<string, string>;
}

export type AnyServerConfig = StdioServerConfig | HttpServerConfig;

export interface McpConfig {
    disabled?: boolean;
    servers: Record<string, AnyServerConfig>;
}

export function isHttpConfig(cfg: AnyServerConfig): cfg is HttpServerConfig {
    return typeof (cfg as HttpServerConfig).url === "string" && (cfg as HttpServerConfig).url.length > 0;
}

function normalizeServerEntry(value: unknown): AnyServerConfig | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    if (typeof v.url === "string" && v.url) {
        const headers =
            typeof v.headers === "object" && v.headers !== null
                ? Object.fromEntries(
                      Object.entries(v.headers as Record<string, unknown>)
                          .filter(([, h]) => typeof h === "string")
                          .map(([k, h]) => [k, h as string]),
                  )
                : undefined;
        return { url: v.url, headers };
    }
    if (typeof v.command === "string" && v.command) {
        const args = Array.isArray(v.args)
            ? v.args.filter((a): a is string => typeof a === "string")
            : undefined;
        const env =
            typeof v.env === "object" && v.env !== null
                ? Object.fromEntries(
                      Object.entries(v.env as Record<string, unknown>)
                          .filter(([, e]) => typeof e === "string")
                          .map(([k, e]) => [k, e as string]),
                  )
                : undefined;
        const cwd = typeof v.cwd === "string" && v.cwd ? v.cwd : undefined;
        return { command: v.command, args, env, cwd };
    }
    return null;
}

/** Parse one mcp.json (tolerantly). Null when absent/broken. */
export function loadMcpConfigFile(filePath: string): McpConfig | null {
    if (!existsSync(filePath)) return null;
    try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8"));
        const raw = (parsed as { mcpServers?: unknown })?.mcpServers;
        if (typeof raw !== "object" || raw === null) return { servers: {} };
        const servers: Record<string, AnyServerConfig> = {};
        for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
            const cfg = normalizeServerEntry(value);
            if (cfg) servers[name] = cfg;
        }
        const disabled = (parsed as { disabled?: unknown })?.disabled === true;
        return { disabled, servers };
    } catch {
        return null;
    }
}

/** `${VAR}` expansion from the environment (unknown vars left literal). */
export function expandEnv(value: string, env: Record<string, string | undefined> = process.env): string {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) => {
        const v = env[name];
        return v === undefined ? whole : v;
    });
}

/** Merged config: user file ← project file (project wins per server name). */
export function resolveMcpConfig(cwd: string, userDir: string = UNOWN_AGENT_DIR): McpConfig {
    const merged: McpConfig = { servers: {} };
    for (const file of [join(userDir, "mcp.json"), join(cwd, ".unown", "mcp.json")]) {
        const cfg = loadMcpConfigFile(file);
        if (!cfg) continue;
        if (cfg.disabled === true) merged.disabled = true;
        if (cfg.disabled === false) merged.disabled = false;
        Object.assign(merged.servers, cfg.servers);
    }
    return merged;
}

// ---------------------------------------------------------------------------
// JSON parsing that tolerates pretty-printed NDJSON
// ---------------------------------------------------------------------------

/**
 * Depth-aware line accumulator: feeds chunks, yields complete JSON-RPC
 * messages. Handles newline-delimited JSON AND servers that pretty-print
 * (multi-line objects) by tracking brace depth outside strings.
 */
export class JsonMessageAccumulator {
    private buffer = "";
    private depth = 0;
    private inString = false;
    private escaped = false;
    /** Chars before this index were already counted (state persists across feeds). */
    private scanIndex = 0;
    private messageStart = 0;

    /** Feed a text chunk; returns every complete JSON message parsed. */
    feed(chunk: string): unknown[] {
        this.buffer += chunk;
        const out: unknown[] = [];
        while (this.scanIndex < this.buffer.length) {
            const i = this.scanIndex;
            const ch = this.buffer[i];
            if (this.inString) {
                if (this.escaped) this.escaped = false;
                else if (ch === "\\") this.escaped = true;
                else if (ch === '"') this.inString = false;
                this.scanIndex++;
                continue;
            }
            if (ch === '"') {
                this.inString = true;
            } else if (ch === "{" || ch === "[") {
                this.depth++;
            } else if (ch === "}" || ch === "]") {
                this.depth--;
                if (this.depth === 0) {
                    const candidate = this.buffer.slice(this.messageStart, i + 1).trim();
                    if (candidate) out.push(this.parse(candidate));
                    // The next message starts after this one (skip whitespace).
                    let next = i + 1;
                    while (next < this.buffer.length && /\s/.test(this.buffer[next])) next++;
                    // Drop the consumed prefix so the buffer stays bounded.
                    this.buffer = this.buffer.slice(next);
                    this.messageStart = 0;
                    this.scanIndex = 0;
                    continue;
                }
            }
            this.scanIndex++;
        }
        // Drop pure-whitespace residue so the buffer cannot grow unbounded.
        if (this.depth === 0 && this.buffer.trim() === "") {
            this.buffer = "";
            this.messageStart = 0;
            this.scanIndex = 0;
        }
        return out;
    }

    private parse(text: string): unknown {
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

export interface McpToolInfo {
    name: string;
    description?: string;
    inputSchema?: unknown;
}

export type ConnectionState = "idle" | "connecting" | "connected" | "error";

/**
 * One live MCP server connection. `transport` picks the wire; both speak
 * JSON-RPC 2.0 with request ids and bounded timeouts.
 */
export class McpConnection {
    readonly serverName: string;
    readonly transport: "stdio" | "http";
    readonly cwd: string;
    private proc: ChildProcess | null = null;
    private acc = new JsonMessageAccumulator();
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();
    private disposed = false;
    private sessionId: string | null = null;
    private baseUrl = "";
    private headers: Record<string, string> = {};
    state: ConnectionState = "idle";
    lastError: string | null = null;
    /** Called for server → client notifications (logged, not acted on). */
    onNotification: ((method: string, params: unknown) => void) | null = null;

    constructor(serverName: string, cfg: AnyServerConfig, cwd: string, private requestTimeoutMs: number) {
        this.serverName = serverName;
        this.cwd = cwd;
        this.transport = isHttpConfig(cfg) ? "http" : "stdio";
        if (isHttpConfig(cfg)) {
            this.baseUrl = cfg.url;
            this.headers = { ...(cfg.headers ?? {}) };
        } else {
            this.spawnSpec = stdioSpawnSpec(cfg.command, cfg.args ?? [], cfg.env ?? {}, cfg.cwd ?? cwd);
        }
    }

    private spawnSpec: { command: string; args: string[]; env: Record<string, string>; cwd: string } | null = null;

    get running(): boolean {
        if (this.disposed) return false;
        if (this.transport === "http") return this.state === "connected";
        return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
    }

    /** initialize handshake; rejects on timeout/spawn failure. */
    async start(connectTimeoutMs: number): Promise<void> {
        this.state = "connecting";
        try {
            if (this.transport === "stdio") {
                await this.startStdio();
            } else {
                await this.startHttp();
            }
            const result = (await this.request(
                "initialize",
                {
                    protocolVersion: "2025-06-18",
                    capabilities: {},
                    clientInfo: { name: "unown", version: "0.1.0" },
                },
                connectTimeoutMs,
            )) as { protocolVersion?: string; serverInfo?: { name?: string; version?: string } } | null;
            if (!result) throw new Error("server returned no initialize result");
            this.notify("notifications/initialized", {});
            this.state = "connected";
            this.lastError = null;
        } catch (err) {
            this.state = "error";
            this.lastError = (err as Error).message;
            this.dispose();
            throw err;
        }
    }

    private async startStdio(): Promise<void> {
        const spec = this.spawnSpec!;
        let proc: ChildProcess;
        try {
            proc = spawn(spec.command, spec.args, {
                cwd: spec.cwd,
                env: { ...process.env, ...spec.env },
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
            });
        } catch (err) {
            throw new Error(`failed to spawn ${spec.command}: ${(err as Error).message}`);
        }
        this.proc = proc;
        proc.on("error", (err) => this.failPending(new Error(`server error: ${err.message}`)));
        proc.once("exit", (code) => {
            if (!this.disposed && this.state !== "error") {
                this.state = "error";
                this.lastError = `server exited (code ${code})`;
            }
            this.failPending(new Error(`server exited (code ${code})`));
        });
        if (!proc.stdout || !proc.stdin) throw new Error("server did not expose stdio pipes");
        proc.stdout.setEncoding("utf8");
        proc.stdout.on("data", (chunk: string) => {
            for (const message of this.acc.feed(chunk)) this.handleMessage(message);
        });
        const stderrTail: string[] = [];
        proc.stderr?.setEncoding("utf8");
        proc.stderr?.on("data", (c: string) => {
            stderrTail.push(c);
            if (stderrTail.join("").length > 4000) stderrTail.shift();
            this.lastStderr = stderrTail.join("").slice(-2000);
        });
    }

    private lastStderr = "";

    private async startHttp(): Promise<void> {
        // Nothing to do ahead of initialize — HTTP connects per request.
    }

    /** Send a JSON-RPC request and await its result. */
    request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
        const timeout = timeoutMs ?? this.requestTimeoutMs;
        const id = this.nextId++;
        const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });
        if (this.transport === "http") {
            return this.httpRoundTrip(id, message, timeout);
        }
        if (!this.proc?.stdin) return Promise.reject(new Error("connection not started"));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`MCP ${method} timed out after ${timeout}ms`));
            }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            try {
                this.proc!.stdin!.write(message + "\n", (err) => {
                    if (err) {
                        const p = this.pending.get(id);
                        if (p) {
                            clearTimeout(p.timer);
                            this.pending.delete(id);
                            p.reject(new Error(`failed to write ${method}: ${err.message}`));
                        }
                    }
                });
            } catch (err) {
                const p = this.pending.get(id);
                if (p) {
                    clearTimeout(p.timer);
                    this.pending.delete(id);
                }
                reject(new Error(`failed to send ${method}: ${(err as Error).message}`));
            }
        });
    }

    private async httpRoundTrip(id: number, message: string, timeoutMs: number): Promise<unknown> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const headers: Record<string, string> = {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                ...this.headers,
            };
            if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
            const res = await fetch(this.baseUrl, {
                method: "POST",
                headers,
                body: message,
                signal: controller.signal,
            });
            const sessionHeader = res.headers.get("mcp-session-id");
            if (sessionHeader) this.sessionId = sessionHeader;
            if (!res.ok) throw new Error(`HTTP ${res.status} from ${this.baseUrl}`);
            const contentType = res.headers.get("content-type") ?? "";
            let payload: unknown = null;
            if (contentType.includes("text/event-stream")) {
                payload = await parseSseResponse(await res.text(), id);
            } else {
                payload = await res.json();
            }
            const msg = payload as { id?: number; result?: unknown; error?: { message?: string } } | null;
            if (msg && msg.error) throw new Error(`MCP ${msg.error.message ?? "error"}`);
            return msg?.result ?? null;
        } finally {
            clearTimeout(timer);
        }
    }

    /** Fire-and-forget notification. */
    notify(method: string, params: unknown): void {
        const message = JSON.stringify({ jsonrpc: "2.0", method, params });
        if (this.transport === "http") {
            const headers: Record<string, string> = {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                ...this.headers,
            };
            if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
            void fetch(this.baseUrl, { method: "POST", headers, body: message }).catch(() => {});
            return;
        }
        try {
            this.proc?.stdin?.write(message + "\n");
        } catch {
            /* server gone */
        }
    }

    /** tools/list with cursor pagination. */
    async listTools(): Promise<McpToolInfo[]> {
        const tools: McpToolInfo[] = [];
        let cursor: string | undefined = undefined;
        for (let page = 0; page < 20; page++) {
            const result = (await this.request("tools/list", cursor ? { cursor } : {}, undefined)) as
                | { tools?: McpToolInfo[]; nextCursor?: string }
                | null;
            if (result?.tools) {
                for (const t of result.tools) {
                    if (typeof t?.name === "string") tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
                }
            }
            cursor = result?.nextCursor;
            if (!cursor) break;
        }
        return tools;
    }

    /** tools/call with content normalization + caps. */
    async callTool(name: string, args: Record<string, unknown>, maxResultChars = 16_000): Promise<{ text: string; isError: boolean }> {
        const result = (await this.request("tools/call", { name, arguments: args }, undefined)) as
            | { content?: Array<{ type?: string; text?: string; [k: string]: unknown }>; isError?: boolean }
            | null;
        const parts: string[] = [];
        for (const item of result?.content ?? []) {
            if (item?.type === "text" && typeof item.text === "string") {
                parts.push(item.text);
            } else if (item?.type === "image") {
                parts.push("[image omitted]");
            } else if (item?.type === "resource" || item?.type === "embedded" || item?.type === "audio") {
                parts.push(`[${item.type} content omitted]`);
            } else if (typeof item?.text === "string") {
                parts.push(item.text);
            }
        }
        let text = parts.join("\n") || "(empty result)";
        if (text.length > maxResultChars) text = text.slice(0, maxResultChars) + `\n… (truncated at ${maxResultChars} chars)`;
        return { text, isError: Boolean(result?.isError) };
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.failPending(new Error("connection disposed"));
        try {
            this.proc?.kill();
        } catch {
            /* already gone */
        }
        this.proc = null;
    }

    /** Human hint when a stdio server died (last stderr tail). */
    stderrHint(): string | null {
        return this.transport === "stdio" && this.lastStderr ? this.lastStderr.slice(-400) : null;
    }

    private failPending(err: Error): void {
        for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(err);
        }
        this.pending.clear();
    }

    private handleMessage(message: unknown): void {
        const msg = message as { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown } | null;
        if (!msg || typeof msg !== "object") return;
        if (msg.method && msg.id === undefined) {
            this.onNotification?.(msg.method, msg.params);
            return;
        }
        if (msg.method && msg.id !== undefined) {
            // server → client request: reply null (we implement no server-side capabilities)
            this.replyNull(msg.id);
            return;
        }
        const pending = this.pending.get(msg.id as number);
        if (pending) {
            this.pending.delete(msg.id as number);
            clearTimeout(pending.timer);
            if (msg.error) pending.reject(new Error(String((msg.error as { message?: string }).message ?? "MCP error")));
            else pending.resolve(msg.result);
        }
    }

    private replyNull(id: unknown): void {
        try {
            this.proc?.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, result: null }) + "\n");
        } catch {
            /* ignore */
        }
    }
}

/** Parse an SSE response body; return the JSON-RPC message with `id`. */
export function parseSseResponse(body: string, id: number): unknown {
    for (const block of body.split(/\n\s*\n/)) {
        for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
                const parsed = JSON.parse(data) as { id?: number };
                if (parsed.id === id) return parsed;
            } catch {
                continue;
            }
        }
    }
    return null;
}

/**
 * Windows: spawn through cmd.exe so `npx`/`.cmd` shims resolve without a
 * shell. POSIX: direct spawn. Pure — exported for tests.
 */
export function stdioSpawnSpec(
    command: string,
    args: string[],
    env: Record<string, string>,
    cwd: string,
): { command: string; args: string[]; env: Record<string, string>; cwd: string } {
    const expandedEnv = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, expandEnv(v)]));
    if (process.platform === "win32" && !/\.(exe|com|bat)$/i.test(command)) {
        return {
            command: "cmd.exe",
            args: ["/d", "/s", "/c", expandEnv(command), ...args.map((a) => expandEnv(a))],
            env: expandedEnv,
            cwd,
        };
    }
    return { command: expandEnv(command), args: args.map((a) => expandEnv(a)), env: expandedEnv, cwd };
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export interface McpManagerOptions {
    cwd: string;
    config?: McpConfig;
    env?: Record<string, string | undefined>;
    requestTimeoutMs?: number;
    connectTimeoutMs?: number;
}

export interface McpServerStatus {
    name: string;
    transport: "stdio" | "http";
    state: ConnectionState | "not-configured";
    detail: string;
    tools: number;
}

/** Per-session MCP manager: lazy connects, tool cache, dispatch. */
export class McpManager {
    readonly cwd: string;
    private readonly config: McpConfig;
    private readonly env: Record<string, string | undefined>;
    readonly requestTimeoutMs: number;
    readonly connectTimeoutMs: number;
    private connections = new Map<string, McpConnection>();
    private toolsByServer = new Map<string, McpToolInfo[]>();
    private connecting = new Map<string, Promise<McpConnection | null>>();

    constructor(opts: McpManagerOptions) {
        this.cwd = opts.cwd;
        this.config = opts.config ?? { servers: {} };
        this.env = opts.env ?? process.env;
        this.requestTimeoutMs = opts.requestTimeoutMs ?? Number(this.env.UNOWN_MCP_TIMEOUT_MS ?? 120_000);
        this.connectTimeoutMs = opts.connectTimeoutMs ?? Number(this.env.UNOWN_MCP_CONNECT_TIMEOUT_MS ?? 20_000);
    }

    get disabled(): boolean {
        return this.config.disabled === true || this.env.UNOWN_MCP === "0";
    }

    serverNames(): string[] {
        return Object.keys(this.config.servers);
    }

    /** Connect (or return the live connection). Single-flight per server. */
    async connect(server: string): Promise<McpConnection | null> {
        const cfg = this.config.servers[server];
        if (!cfg) return null;
        const existing = this.connections.get(server);
        if (existing?.running && existing.state === "connected") return existing;
        const inFlight = this.connecting.get(server);
        if (inFlight) return inFlight;
        const conn = new McpConnection(server, cfg, this.cwd, this.requestTimeoutMs);
        conn.onNotification = (method) => {
            if (method === "notifications/tools/list_changed") {
                // refresh lazily on next list
                this.toolsByServer.delete(server);
            }
        };
        this.connections.set(server, conn);
        const promise = (async () => {
            try {
                await conn.start(this.connectTimeoutMs);
                this.toolsByServer.set(server, await conn.listTools());
                return conn;
            } catch {
                return null;
            } finally {
                this.connecting.delete(server);
            }
        })();
        this.connecting.set(server, promise);
        return promise;
    }

    /** Connect every configured server; returns the ones that came up. */
    async connectAll(): Promise<string[]> {
        const ok: string[] = [];
        await Promise.all(
            this.serverNames().map(async (name) => {
                const conn = await this.connect(name);
                if (conn) ok.push(name);
            }),
        );
        return ok;
    }

    toolsFor(server: string): McpToolInfo[] {
        return this.toolsByServer.get(server) ?? [];
    }

    async callTool(server: string, tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
        const conn = await this.connect(server);
        if (!conn) {
            const failed = this.connections.get(server);
            const hint = failed?.stderrHint();
            return {
                text: `MCP server "${server}" is not connected${failed?.lastError ? ` (${failed.lastError})` : ""}${hint ? `\nserver stderr: ${hint}` : ""}`,
                isError: true,
            };
        }
        try {
            return await conn.callTool(tool, args);
        } catch (err) {
            return { text: `MCP tools/call ${server}/${tool} failed: ${(err as Error).message}`, isError: true };
        }
    }

    status(): McpServerStatus[] {
        const out: McpServerStatus[] = [];
        for (const name of this.serverNames()) {
            const cfg = this.config.servers[name];
            const conn = this.connections.get(name);
            const transport = isHttpConfig(cfg) ? "http" : "stdio";
            if (!conn) {
                out.push({ name, transport, state: "idle", detail: isHttpConfig(cfg) ? cfg.url : cfg.command, tools: 0 });
            } else if (conn.state === "connected") {
                out.push({
                    name,
                    transport,
                    state: "connected",
                    detail: isHttpConfig(cfg) ? cfg.url : (cfg as StdioServerConfig).command,
                    tools: this.toolsFor(name).length,
                });
            } else {
                out.push({
                    name,
                    transport,
                    state: conn.state,
                    detail: conn.lastError ?? (isHttpConfig(cfg) ? cfg.url : (cfg as StdioServerConfig).command),
                    tools: 0,
                });
            }
        }
        return out;
    }

    disposeAll(): void {
        for (const conn of this.connections.values()) conn.dispose();
        this.connections.clear();
        this.toolsByServer.clear();
    }
}

// ---------------------------------------------------------------------------
// Tool naming / schema helpers (pure)
// ---------------------------------------------------------------------------

/** `mcp__<server>__<tool>` sanitized to ^[a-z0-9_]+$ (≤64 chars). */
export function mcpToolName(server: string, tool: string): string {
    const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
    const raw = `mcp__${sanitize(server)}__${sanitize(tool)}`;
    return raw.slice(0, 64).replace(/_+$/, "");
}

/** Only object-shaped JSON Schemas pass through; everything else becomes a permissive object. */
export function normalizeInputSchema(schema: unknown): unknown {
    if (
        typeof schema === "object" &&
        schema !== null &&
        (schema as { type?: unknown }).type === "object" &&
        typeof (schema as { properties?: unknown }).properties === "object"
    ) {
        return schema;
    }
    return Type.Object({}, { additionalProperties: true });
}

export function capDescription(description: string | undefined, max = 500): string {
    const text = (description ?? "").replace(/\s+/g, " ").trim();
    if (!text) return "MCP tool (no description provided by the server).";
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** Render the /mcp status listing. */
export function renderMcpStatus(statuses: McpServerStatus[]): string {
    if (statuses.length === 0) {
        return "No MCP servers configured. Add them to .unown/mcp.json (project) or ~/.unown/agent/mcp.json (user):\n" +
            '{ "mcpServers": { "example": { "command": "npx", "args": ["-y", "@example/mcp-server"] } } }\n' +
            'HTTP servers: { "mcpServers": { "remote": { "url": "https://example.com/mcp" } } }\n' +
            "Tools appear as mcp__<server>__<tool> once the server connects.";
    }
    const lines = statuses.map((s) => {
        const mark = s.state === "connected" ? "●" : s.state === "error" ? "✗" : "○";
        const detail = s.state === "error" ? ` — ${s.detail}` : ` — ${s.detail}`;
        return `${mark} ${s.name} [${s.transport}] ${s.state}${s.tools ? `, ${s.tools} tool(s)` : ""}${detail}`;
    });
    return `MCP servers:\n${lines.join("\n")}\nTools are named mcp__<server>__<tool>; /mcp reconnects failed servers.`;
}

// ---------------------------------------------------------------------------
// The extension
// ---------------------------------------------------------------------------

export interface McpOptions {
    cwd: string;
    verbose?: boolean;
    /** Override config (tests). */
    config?: McpConfig;
}

const TOOLS_PER_SERVER_CAP = 100;

/**
 * The `unown-mcp` inline extension: background-connects every configured
 * server at session_start (never blocking the session — zcode's rule that a
 * failed server must not block), registers each server's tools dynamically
 * (`pi.registerTool` after initialization is pi's documented capability),
 * and exposes `/mcp` (status + reconnect attempt).
 */
export function createMcpExtension(opts: McpOptions) {
    const verbose = opts.verbose ?? false;
    const log = (msg: string) => {
        if (verbose) console.error(`[unown-mcp] ${msg}`);
    };

    let manager: McpManager | null = null;
    const registered = new Set<string>();

    const getManager = (): McpManager => {
        if (!manager) manager = new McpManager({ cwd: opts.cwd, config: opts.config ?? resolveMcpConfig(opts.cwd) });
        return manager;
    };

    const registerServerTools = (pi: any, server: string): number => {
        const m = getManager();
        const tools = m.toolsFor(server).slice(0, TOOLS_PER_SERVER_CAP);
        let count = 0;
        for (const tool of tools) {
            const name = mcpToolName(server, tool.name);
            if (registered.has(name)) continue;
            registered.add(name);
            count++;
            const label = `${server}/${tool.name}`;
            const description = capDescription(tool.description) + ` (MCP server: ${server})`;
            pi.registerTool({
                name,
                label,
                description,
                parameters: normalizeInputSchema(tool.inputSchema) as any,
                async execute(_toolCallId: string, params: Record<string, unknown>) {
                    const result = await m.callTool(server, tool.name, params ?? {});
                    return {
                        content: [{ type: "text", text: result.text }],
                        ...(result.isError ? { isError: true } : {}),
                    };
                },
                renderCall(_args: any, theme: any) {
                    const head = theme?.fg ? theme.fg("toolTitle", theme.bold(label)) : label;
                    return new Text(String(head), 0, 0);
                },
                renderResult(result: any, _o: any, theme: any) {
                    const block = result?.content?.[0];
                    const text = block?.type === "text" ? block.text : "";
                    const first = text.split("\n")[0] ?? "";
                    return new Text(String(theme?.fg ? theme.fg("muted", first.slice(0, 100)) : first.slice(0, 100)), 0, 0);
                },
            });
        }
        if (count > 0) log(`registered ${count} tool(s) from ${server}`);
        return count;
    };

    const factory = (pi: any) => {
        pi.on("session_start", () => {
            try {
                const m = getManager();
                if (m.disabled || m.serverNames().length === 0) return;
                log(`connecting ${m.serverNames().length} MCP server(s) in the background`);
                void (async () => {
                    const okServers = await m.connectAll();
                    for (const server of okServers) registerServerTools(pi, server);
                })();
            } catch (err: any) {
                log(`session_start connect failed: ${err?.message ?? err}`);
            }
        });

        pi.registerCommand("mcp", {
            description: "Show MCP server status (and attempt to connect/reconnect): /mcp",
            handler: async (_args: string, ctx: any) => {
                const m = getManager();
                if (m.disabled) {
                    ctx.ui.notify("MCP support is disabled (UNOWN_MCP=0 or disabled in mcp.json).", "info");
                    return;
                }
                if (m.serverNames().length === 0) {
                    ctx.ui.notify(renderMcpStatus([]), "info");
                    return;
                }
                // /mcp doubles as a manual reconnect: retry every server.
                const before = m.status().filter((s) => s.state === "connected").map((s) => s.name);
                ctx.ui.notify("Connecting MCP servers…", "info");
                const okServers = await m.connectAll();
                for (const server of okServers) registerServerTools(pi, server);
                const statuses = m.status();
                ctx.ui.notify(renderMcpStatus(statuses), "info");
                const newly = okServers.filter((s) => !before.includes(s));
                if (newly.length > 0) {
                    const toolCount = newly.reduce((n, s) => n + m.toolsFor(s).length, 0);
                    ctx.ui.notify(`Connected ${newly.join(", ")} — ${toolCount} tool(s) registered as mcp__<server>__<tool>.`, "info");
                }
            },
        });

        pi.on("session_shutdown", () => {
            try {
                manager?.disposeAll();
            } catch {
                /* best effort */
            }
        });
    };

    return { name: "unown-mcp", factory, hidden: true } as const;
}
