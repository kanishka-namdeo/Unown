/**
 * lsp.ts — LSP code intelligence for the unown terminal agent.
 *
 * Reverse-engineered from oh-my-pi's `lsp` tool (can1357/oh-my-pi,
 * docs/tools/lsp.md — 14 actions, ~54 built-in servers, lspmux broker) and
 * reduced to what fits pi's extension seams with zero dependencies:
 *
 *   - a stdio JSON-RPC client (Content-Length framing) speaking real LSP
 *     (initialize / didOpen / didChange / publishDiagnostics / hover /
 *     definition / references / documentSymbol)
 *   - an auto-detected server registry (typescript-language-server, pyright,
 *     pylsp, gopls, rust-analyzer, clangd, bash-language-server) with config
 *     overrides from .unown/lsp.json (project) and ~/.unown/agent/lsp.json
 *     (user; project wins)
 *   - a PostToolUse feedback loop: after every write/edit the fresh
 *     diagnostics for that file are appended to the tool result (mirroring
 *     the Bun syntax gate in hooks.ts), so broken edits get compiler
 *     feedback instead of compounding
 *
 * Design rules (from the oh-my-pi swap assessment — the substrate stays, we
 * wrap): no fork of vendored pi, no native deps, cold start never blocks a
 * tool result, no server means silent degradation, everything is bounded by
 * timeouts, Windows parity by construction (no shell, Buffer-based framing).
 *
 * Env:
 *   UNOWN_LSP=0                    disable the whole surface
 *   UNOWN_LSP_WAIT_MS   (10000)    max wait for fresh diagnostics after an edit
 *   UNOWN_LSP_TIMEOUT_MS (15000)   per-request timeout
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, type Dirent, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { UNOWN_AGENT_DIR } from "./term.ts";

// ---------------------------------------------------------------------------
// Path → language mapping
// ---------------------------------------------------------------------------

const EXTENSION_LANGUAGE: Record<string, string> = {
    ts: "typescript",
    mts: "typescript",
    cts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascriptreact",
    py: "python",
    go: "go",
    rs: "rust",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    hh: "cpp",
    sh: "shellscript",
    bash: "shellscript",
    java: "java",
    rb: "ruby",
    php: "php",
};

/** Language id for a file path (by extension); null when unknown. */
export function languageFromPath(path: string): string | null {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return EXTENSION_LANGUAGE[ext] ?? null;
}

// ---------------------------------------------------------------------------
// Cross-platform command existence probe (no spawn, pure fs)
// ---------------------------------------------------------------------------

/**
 * True when `command` resolves on PATH (checked with fs only — no `which`
 * subprocess). Accepts an env override so tests can point PATH at a fixture
 * directory. Handles Windows PATHEXT resolution and absolute paths.
 */
export function commandExists(command: string, env: Record<string, string | undefined> = process.env): boolean {
    if (!command) return false;
    const name = basename(command);
    const dir = command.length > name.length ? command.slice(0, command.length - name.length - 1) : null;
    if (dir) return existsSync(command) || withExeExtensions(command).some((c) => existsSync(c));
    const pathValue = env.PATH ?? env.Path ?? "";
    const sep = pathValue.includes(";") && !pathValue.includes(":") ? ";" : pathValue.includes(";") ? ";" : ":";
    for (const dirEntry of pathValue.split(sep)) {
        if (!dirEntry) continue;
        for (const candidate of withExeExtensions(join(dirEntry, name))) {
            if (existsSync(candidate)) return true;
        }
    }
    return false;
}

function withExeExtensions(filePath: string): string[] {
    if (process.platform !== "win32") return [filePath];
    const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";");
    return exts.filter(Boolean).map((ext) => filePath + ext.toLowerCase());
}

// ---------------------------------------------------------------------------
// Server registry: defaults + .unown/lsp.json overrides
// ---------------------------------------------------------------------------

export interface ServerSpec {
    /** Language ids this server serves. */
    languages: string[];
    /** Candidate command lines, first resolvable wins. */
    candidates: string[][];
    label: string;
}

/** Candidate server command lines per language group. Order = preference. */
export const DEFAULT_SERVERS: ServerSpec[] = [
    {
        label: "typescript-language-server",
        languages: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
        candidates: [["typescript-language-server", "--stdio"]],
    },
    {
        label: "pyright",
        languages: ["python"],
        candidates: [
            ["pyright-langserver", "--stdio"],
            ["basedpyright-langserver", "--stdio"],
            ["pylsp"],
        ],
    },
    { label: "gopls", languages: ["go"], candidates: [["gopls"]] },
    { label: "rust-analyzer", languages: ["rust"], candidates: [["rust-analyzer"]] },
    { label: "clangd", languages: ["c", "cpp"], candidates: [["clangd"]] },
    {
        label: "bash-language-server",
        languages: ["shellscript"],
        candidates: [["bash-language-server", "start", "--stdio"]],
    },
    { label: "ruby-lsp", languages: ["ruby"], candidates: [["ruby-lsp"]] },
    { label: "intelephense", languages: ["php"], candidates: [["intelephense", "--stdio"]] },
];

export interface LspConfig {
    disabled?: boolean;
    /** language id → explicit command line (overrides defaults entirely). */
    servers?: Record<string, { command: string[] }>;
}

/** Parse (tolerantly) one lsp.json; null when absent/broken. */
export function loadLspConfigFile(filePath: string): LspConfig | null {
    if (!existsSync(filePath)) return null;
    try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8"));
        if (typeof parsed !== "object" || parsed === null) return null;
        return parsed as LspConfig;
    } catch {
        return null;
    }
}

/** Merged config: defaults ← user file ← project file (later wins). */
export function resolveLspConfig(cwd: string, userDir: string = UNOWN_AGENT_DIR): LspConfig {
    const merged: LspConfig = {};
    for (const file of [join(userDir, "lsp.json"), join(cwd, ".unown", "lsp.json")]) {
        const cfg = loadLspConfigFile(file);
        if (!cfg) continue;
        if (cfg.disabled === true) merged.disabled = true;
        if (cfg.disabled === false) merged.disabled = false;
        if (cfg.servers && typeof cfg.servers === "object") {
            merged.servers = { ...(merged.servers ?? {}), ...cfg.servers };
        }
    }
    return merged;
}

/**
 * Resolve the command line to launch for a language id, or null.
 * Config `servers` entries override defaults; otherwise the first default
 * candidate whose command resolves on PATH wins (memoized per language).
 */
export function resolveServerCommand(
    language: string,
    config: LspConfig,
    env: Record<string, string | undefined> = process.env,
): string[] | null {
    const override = config.servers?.[language]?.command;
    if (override && override.length > 0) return override;
    const spec = DEFAULT_SERVERS.find((s) => s.languages.includes(language));
    if (!spec) return null;
    for (const candidate of spec.candidates) {
        if (commandExists(candidate[0], env)) return candidate;
    }
    return null;
}

// ---------------------------------------------------------------------------
// URI conversion
// ---------------------------------------------------------------------------

/** File path → file URI (Windows drive letters get the three-slash form). */
export function pathToUri(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    if (/^[a-zA-Z]:/.test(normalized)) return `file:///${encodeURI(normalized)}`;
    return `file://${encodeURI(normalized)}`;
}

/** file URI → file path (decode + platform separators). */
export function uriToPath(uri: string): string {
    const raw = uri.startsWith("file://") ? uri.slice("file://".length) : uri;
    let decoded: string;
    try {
        decoded = decodeURI(raw);
    } catch {
        decoded = raw;
    }
    const withoutHost = decoded.replace(/^\/(?=[a-zA-Z]:\/)/, "");
    return process.platform === "win32" ? withoutHost.replace(/\//g, "\\") : withoutHost;
}

// ---------------------------------------------------------------------------
// LSP wire types (the subset we consume)
// ---------------------------------------------------------------------------

export interface LspDiagnostic {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    severity?: number; // 1 error, 2 warning, 3 info, 4 hint
    message: string;
    source?: string;
    code?: string | number;
}

export interface LspLocation {
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

// ---------------------------------------------------------------------------
// JSON-RPC / LSP connection over stdio
// ---------------------------------------------------------------------------

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * One live language-server process. Speaks LSP over stdio with
 * Content-Length framing. Buffer-based parsing keeps multi-byte UTF-8
 * characters intact across stdout chunk boundaries.
 */
export class LspConnection {
    readonly command: string[];
    readonly cwd: string;
    private proc: ChildProcess | null = null;
    private buffer: Buffer = Buffer.alloc(0);
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();
    private disposed = false;
    /** Called for every server → client notification. */
    onNotification: ((method: string, params: unknown) => void) | null = null;

    constructor(command: string[], cwd: string) {
        this.command = command;
        this.cwd = cwd;
    }

    get running(): boolean {
        return !this.disposed && this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
    }

    /** Spawn + initialize. Rejects on spawn failure or timeout. */
    async start(timeoutMs: number): Promise<void> {
        if (this.running) return;
        this.disposed = false;
        let proc: ChildProcess;
        try {
            proc = spawn(this.command[0], this.command.slice(1), {
                cwd: this.cwd,
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
            });
        } catch (err) {
            throw new Error(`failed to spawn ${this.command.join(" ")}: ${(err as Error).message}`);
        }
        this.proc = proc;
        proc.on("error", (err) => this.failAllPending(new Error(`server error: ${err.message}`)));
        proc.once("exit", () => this.failAllPending(new Error("server exited")));
        if (!proc.stdout || !proc.stdin) throw new Error("server did not expose stdio pipes");
        proc.stdout.on("data", (chunk: Buffer) => this.feed(chunk));
        const stderrChunks: Buffer[] = [];
        proc.stderr?.on("data", (c: Buffer) => {
            stderrChunks.push(c);
            if (stderrChunks.reduce((n, b) => n + b.length, 0) > 20_000) stderrChunks.shift();
        });
        await this.request(
            "initialize",
            {
                processId: process.pid,
                rootUri: pathToUri(this.cwd),
                capabilities: {
                    textDocument: { synchronization: { dynamicRegistration: false, didSave: false } },
                    workspace: { workspaceFolders: false },
                },
                workspaceFolders: null,
            },
            timeoutMs,
        );
        this.notify("initialized", {});
    }

    /** Send a request and await its result (bounded by timeoutMs). */
    request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
        if (!this.proc || !this.proc.stdin) return Promise.reject(new Error("connection not started"));
        const id = this.nextId++;
        const message = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\r\n";
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`LSP request ${method} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try {
                this.proc!.stdin!.write(frame(message), (err) => {
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

    /** Fire-and-forget notification. */
    notify(method: string, params: unknown): void {
        if (!this.proc?.stdin) return;
        try {
            this.proc.stdin.write(frame(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\r\n"));
        } catch {
            /* server gone — the exit handler cleans up */
        }
    }

    /** Ask the server to exit politely, then stop reading. */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.failAllPending(new Error("connection disposed"));
        try {
            this.proc?.kill();
        } catch {
            /* already gone */
        }
        this.proc = null;
    }

    private failAllPending(err: Error): void {
        for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(err);
        }
        this.pending.clear();
    }

    /** Parse complete JSON-RPC messages out of the stdout stream. */
    private feed(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (;;) {
            const headerEnd = this.buffer.indexOf("\r\n\r\n");
            if (headerEnd < 0) return;
            const header = this.buffer.subarray(0, headerEnd).toString("ascii");
            const match = /Content-Length:\s*(\d+)/i.exec(header);
            if (!match) {
                // Unframed garbage — drop the buffer rather than hang forever.
                this.buffer = Buffer.alloc(0);
                return;
            }
            const length = Number(match[1]);
            const bodyStart = headerEnd + 4;
            if (this.buffer.length < bodyStart + length) return;
            const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
            this.buffer = this.buffer.subarray(bodyStart + length);
            let message: any;
            try {
                message = JSON.parse(body);
            } catch {
                continue;
            }
            if (message?.method && message.id !== undefined && message.result === undefined && message.error === undefined) {
                // server → client request (window/workDoneRow/create etc.) — reply null
                this.replyNull(message.id);
                continue;
            }
            if (message?.method && message.id === undefined) {
                this.onNotification?.(message.method, message.params);
                continue;
            }
            const pending = this.pending.get(message.id);
            if (pending) {
                this.pending.delete(message.id);
                clearTimeout(pending.timer);
                if (message.error) pending.reject(new Error(`LSP ${message.error.message ?? "error"}`));
                else pending.resolve(message.result);
            }
        }
    }

    private replyNull(id: unknown): void {
        if (!this.proc?.stdin) return;
        try {
            this.proc.stdin.write(frame(JSON.stringify({ jsonrpc: "2.0", id, result: null }) + "\r\n"));
        } catch {
            /* ignore */
        }
    }
}

function frame(message: string): Buffer {
    const body = Buffer.from(message, "utf8");
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

// ---------------------------------------------------------------------------
// The manager: server lifecycle + document sync + diagnostics cache
// ---------------------------------------------------------------------------

interface OpenDoc {
    uri: string;
    languageId: string;
    version: number;
}

export interface LspManagerOptions {
    cwd: string;
    config?: LspConfig;
    env?: Record<string, string | undefined>;
    requestTimeoutMs?: number;
    diagnosticsWaitMs?: number;
}

export interface ServerStatusEntry {
    language: string;
    command: string;
    state: "running" | "available" | "missing";
}

/**
 * Per-session LSP manager. One connection per resolved server command
 * (languages sharing a spec share the process — e.g. all four TS/JS ids ride
 * one typescript-language-server). Tracks open documents, mirrors edits via
 * didChange, and caches the latest publishDiagnostics per file with the
 * timestamp needed to wait for FRESH results after a write.
 */
export class LspManager {
    readonly cwd: string;
    private readonly config: LspConfig;
    private readonly env: Record<string, string | undefined>;
    private readonly requestTimeoutMs: number;
    readonly diagnosticsWaitMs: number;
    private connections = new Map<string, LspConnection>(); // key: command.join(" ")
    private commandByLanguage = new Map<string, string[] | null>();
    private openDocs = new Map<string, OpenDoc>(); // key: file path
    private diagnostics = new Map<string, { items: LspDiagnostic[]; ts: number }>(); // key: file path
    private starting = new Map<string, Promise<void>>();

    constructor(opts: LspManagerOptions) {
        this.cwd = opts.cwd;
        this.config = opts.config ?? {};
        this.env = opts.env ?? process.env;
        this.requestTimeoutMs = opts.requestTimeoutMs ?? Number(this.env.UNOWN_LSP_TIMEOUT_MS ?? 15_000);
        this.diagnosticsWaitMs = opts.diagnosticsWaitMs ?? Number(this.env.UNOWN_LSP_WAIT_MS ?? 10_000);
    }

    get disabled(): boolean {
        return this.config.disabled === true || this.env.UNOWN_LSP === "0";
    }

    /** Command line for a language (memoized; null = no server). */
    serverCommandFor(language: string): string[] | null {
        if (!this.commandByLanguage.has(language)) {
            this.commandByLanguage.set(language, resolveServerCommand(language, this.config, this.env));
        }
        return this.commandByLanguage.get(language) ?? null;
    }

    /**
     * The live (or lazily started) connection for a language.
     * `waitReady: false` returns null while a cold start is in flight —
     * used by the PostToolUse augment so the FIRST edit after boot never
     * blocks on server startup.
     */
    async connectionFor(language: string, waitReady = true): Promise<LspConnection | null> {
        const command = this.serverCommandFor(language);
        if (!command) return null;
        const key = command.join(" ");
        const existing = this.connections.get(key);
        if (existing?.running) return existing;
        const inFlight = this.starting.get(key);
        if (inFlight) {
            if (!waitReady) return null;
            await inFlight.catch(() => {});
            const again = this.connections.get(key);
            return again?.running ? again : null;
        }
        const conn = new LspConnection(command, this.cwd);
        conn.onNotification = (method, params) => this.handleNotification(method, params);
        this.connections.set(key, conn);
        const startPromise = conn.start(this.requestTimeoutMs).then(
            () => undefined,
            (err: Error) => {
                if (this.connections.get(key) === conn) this.connections.delete(key);
                conn.dispose();
                throw err;
            },
        );
        this.starting.set(key, startPromise);
        // Untrack on settle; the .then handler also marks cold-start failures
        // as handled so a fire-and-forget warm can never crash the process.
        const untrack = () => this.starting.delete(key);
        startPromise.then(untrack, untrack);
        if (waitReady) {
            try {
                await startPromise;
            } catch {
                return null;
            }
        }
        return conn.running ? conn : null;
    }

    /** True when a live connection exists for the language's server. */
    isLiveFor(language: string): boolean {
        const command = this.serverCommandFor(language);
        if (!command) return false;
        return this.connections.get(command.join(" "))?.running ?? false;
    }

    /** Warm the server for a language without blocking (fire-and-forget). */
    async warmFor(language: string): Promise<void> {
        try {
            await this.connectionFor(language, false);
        } catch {
            /* best effort */
        }
    }

    /** Latest cached diagnostics for a file path. */
    diagnosticsFor(path: string): { items: LspDiagnostic[]; ts: number } | undefined {
        return this.diagnostics.get(path);
    }

    /** Every file with cached diagnostics (the `all: true` action). */
    allDiagnostics(): Array<{ path: string; items: LspDiagnostic[] }> {
        return [...this.diagnostics.entries()].map(([path, d]) => ({ path, items: d.items }));
    }

    /** Ensure a file is open on its server; send the current disk content. */
    async syncDocument(path: string): Promise<LspConnection | null> {
        const language = languageFromPath(path);
        if (!language) return null;
        const conn = await this.connectionFor(language, true);
        if (!conn) return null;
        const uri = pathToUri(path);
        let content: string;
        try {
            content = readFileSync(path, "utf8");
        } catch {
            return conn; // deleted/unreadable — nothing to sync
        }
        const existing = this.openDocs.get(path);
        if (!existing || existing.uri !== uri) {
            this.openDocs.set(path, { uri, languageId: language, version: 1 });
            conn.notify("textDocument/didOpen", {
                textDocument: { uri, languageId: language, version: 1, text: content },
            });
        } else {
            existing.version += 1;
            conn.notify("textDocument/didChange", {
                textDocument: { uri, version: existing.version },
                contentChanges: [{ text: content }],
            });
        }
        return conn;
    }

    /**
     * Wait until diagnostics for `path` were published after `afterTs`
     * (bounded by diagnosticsWaitMs). Cold-start aware: returns immediately
     * with whatever is cached when no publish ever arrives.
     */
    async waitForFreshDiagnostics(path: string, afterTs: number): Promise<LspDiagnostic[]> {
        const deadline = Date.now() + this.diagnosticsWaitMs;
        for (;;) {
            const current = this.diagnostics.get(path);
            if (current && current.ts >= afterTs) return current.items;
            if (Date.now() >= deadline) return current?.items ?? [];
            await sleep(150);
        }
    }

    /** LSP hover at a 0-based line/character. */
    async hover(path: string, line: number, character: number): Promise<string | null> {
        const conn = await this.syncDocument(path);
        if (!conn) return null;
        const result = (await conn.request(
            "textDocument/hover",
            { textDocument: { uri: pathToUri(path) }, position: { line, character } },
            this.requestTimeoutMs,
        )) as { contents?: unknown } | null;
        if (!result) return null;
        return renderHoverContents(result.contents);
    }

    /** textDocument/definition → locations (file:line:col + source line). */
    async definition(path: string, line: number, character: number): Promise<LspLocation[]> {
        return this.locationRequest(path, line, character, "textDocument/definition");
    }

    /** textDocument/references → locations. */
    async references(path: string, line: number, character: number): Promise<LspLocation[]> {
        return this.locationRequest(path, line, character, "textDocument/references", {
            context: { includeDeclaration: false },
        });
    }

    private async locationRequest(
        path: string,
        line: number,
        character: number,
        method: string,
        extra: Record<string, unknown> = {},
    ): Promise<LspLocation[]> {
        const conn = await this.syncDocument(path);
        if (!conn) return [];
        try {
            const result = await conn.request(
                method,
                { textDocument: { uri: pathToUri(path) }, position: { line, character }, ...extra },
                this.requestTimeoutMs,
            );
            return normalizeLocations(result);
        } catch {
            return [];
        }
    }

    /** textDocument/documentSymbol → flat symbol list. */
    async symbols(path: string): Promise<Array<{ name: string; kind: number; line: number; container?: string }>> {
        const conn = await this.syncDocument(path);
        if (!conn) return [];
        try {
            const result = await conn.request(
                "textDocument/documentSymbol",
                { textDocument: { uri: pathToUri(path) } },
                this.requestTimeoutMs,
            );
            return flattenSymbols(result, undefined);
        } catch {
            return [];
        }
    }

    /** Status snapshot for the /lsp command and the status action. */
    status(): { servers: ServerStatusEntry[]; openDocs: number; diagnostics: number } {
        const servers: ServerStatusEntry[] = [];
        const seen = new Set<string>();
        for (const spec of DEFAULT_SERVERS) {
            for (const language of spec.languages) {
                const command = this.serverCommandFor(language);
                if (!command) continue;
                const key = command.join(" ");
                if (seen.has(key)) continue;
                seen.add(key);
                const conn = this.connections.get(key);
                servers.push({
                    language,
                    command: command.join(" "),
                    state: conn?.running ? "running" : "available",
                });
            }
        }
        let diagnostics = 0;
        for (const d of this.diagnostics.values()) diagnostics += d.items.length;
        return { servers, openDocs: this.openDocs.size, diagnostics };
    }

    /** Kill every connection (session shutdown). */
    disposeAll(): void {
        for (const conn of this.connections.values()) conn.dispose();
        this.connections.clear();
        this.openDocs.clear();
        this.diagnostics.clear();
    }

    private handleNotification(method: string, params: unknown): void {
        if (method !== "textDocument/publishDiagnostics") return;
        const p = params as { uri?: string; diagnostics?: LspDiagnostic[] } | null;
        if (!p?.uri) return;
        const path = uriToPath(p.uri);
        this.diagnostics.set(path, { items: Array.isArray(p.diagnostics) ? p.diagnostics : [], ts: Date.now() });
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Rendering helpers (pure, exported for tests)
// ---------------------------------------------------------------------------

export function severityLabel(severity: number | undefined): string {
    switch (severity) {
        case 1:
            return "error";
        case 2:
            return "warning";
        case 3:
            return "info";
        case 4:
            return "hint";
        default:
            return "note";
    }
}

export function renderDiagnostics(path: string, items: LspDiagnostic[], maxItems = 50): string {
    if (items.length === 0) return `No diagnostics for ${path}.`;
    const sorted = [...items].sort((a, b) => {
        const sa = a.severity ?? 5;
        const sb = b.severity ?? 5;
        if (sa !== sb) return sa - sb;
        const la = a.range.start.line;
        const lb = b.range.start.line;
        if (la !== lb) return la - lb;
        return a.range.start.character - b.range.start.character;
    });
    const shown = sorted.slice(0, maxItems);
    const lines = shown.map((d) => {
        const src = d.source ? ` (${d.source}${d.code !== undefined ? ` ${d.code}` : ""})` : "";
        return `${path}:${d.range.start.line + 1}:${d.range.start.character + 1} [${severityLabel(d.severity)}] ${d.message}${src}`;
    });
    if (sorted.length > shown.length) lines.push(`… ${sorted.length - shown.length} more`);
    return lines.join("\n");
}

export function countErrors(items: LspDiagnostic[]): number {
    return items.filter((d) => d.severity === undefined || d.severity === 1).length;
}

export function renderHoverContents(contents: unknown): string | null {
    if (contents === null || contents === undefined) return null;
    if (typeof contents === "string") return contents.trim() || null;
    if (Array.isArray(contents)) {
        const parts = contents.map((c) => renderHoverContents(c)).filter((s): s is string => s !== null);
        return parts.length ? parts.join("\n") : null;
    }
    const obj = contents as { value?: string; language?: string };
    if (typeof obj?.value === "string") return obj.value.trim() || null;
    return null;
}

export function normalizeLocations(result: unknown): LspLocation[] {
    if (!result) return [];
    const list = Array.isArray(result) ? result : [result];
    const out: LspLocation[] = [];
    for (const item of list) {
        const loc = item as LspLocation & { targetUri?: string; targetRange?: LspLocation["range"] };
        if (loc.uri && loc.range) out.push({ uri: loc.uri, range: loc.range });
        else if (loc.targetUri && loc.targetRange) out.push({ uri: loc.targetUri, range: loc.targetRange });
    }
    return out;
}

export function flattenSymbols(
    result: unknown,
    container: string | undefined,
): Array<{ name: string; kind: number; line: number; container?: string }> {
    if (!Array.isArray(result)) return [];
    const out: Array<{ name: string; kind: number; line: number; container?: string }> = [];
    for (const s of result as Array<{
        name?: string;
        kind?: number;
        range?: { start?: { line?: number } };
        children?: unknown;
    }>) {
        if (typeof s?.name !== "string") continue;
        const line = typeof s.range?.start?.line === "number" ? s.range.start.line : 0;
        out.push({ name: s.name, kind: s.kind ?? 0, line, container });
        if (Array.isArray(s.children)) out.push(...flattenSymbols(s.children, s.name));
    }
    return out;
}

/**
 * Resolve the 0-based character offset for a lookup: the first occurrence of
 * `symbol` on the line when given, else the first word character, else 0.
 */
export function characterForLine(lineText: string, symbol?: string): number {
    if (symbol) {
        const idx = lineText.indexOf(symbol);
        if (idx >= 0) return idx;
    }
    const word = /\w/.exec(lineText);
    return word ? word.index : 0;
}

/** Read one line (1-based) from a file for rendering locations. */
export function readLineText(path: string, lineOneBased: number): string {
    try {
        const lines = readFileSync(path, "utf8").split("\n");
        return (lines[lineOneBased - 1] ?? "").trim().slice(0, 120);
    } catch {
        return "";
    }
}

export function renderLocations(locations: LspLocation[], maxItems = 20): string {
    if (locations.length === 0) return "No results.";
    const shown = locations.slice(0, maxItems);
    const lines = shown.map((loc) => {
        const path = uriToPath(loc.uri);
        const line = loc.range.start.line + 1;
        const text = readLineText(path, line);
        return text ? `${path}:${line}  ${text}` : `${path}:${line}`;
    });
    if (locations.length > shown.length) lines.push(`… ${locations.length - shown.length} more`);
    return lines.join("\n");
}

// Re-exported for the extension's convenience.
export { readdirSync as _readdirSync };
export type { Dirent as _Dirent };
export { homedir as _homedir };
