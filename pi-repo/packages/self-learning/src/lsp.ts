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
 *   UNOWN_LSP_MAX_MSG_BYTES (32 MiB)  max accepted Content-Length per message
 *   UNOWN_LSP_CRASH_COOLDOWN_MS (30000)  restart cooldown after a server crash
 *   UNOWN_LSP_MAX_RESTARTS (3)     auto-restart budget per server per session
 *
 * H1 hardening (research R-a §4 item 1/2/5/6/7): Content-Length is capped
 * (violations recycle the connection instead of buffering to OOM), header
 * parsing tolerates LF-only framing and resyncs past garbage blocks, server
 * exits evict the connection + clear that server's open documents (so the
 * diagnostics loop re-didOpens on a fresh process — the M1 loop used to die
 * permanently after one crash), and every env knob parses tolerantly via
 * the shared parseMsEnv.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, type Dirent, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter as pathDelimiter, join } from "node:path";
import { registerChild, unregisterChild } from "./child-reaper.ts";
import { parseMsEnv } from "./mcp.ts";
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
    // Platform delimiter, not a content heuristic: a SINGLE Windows PATH
    // entry ("C:\\tools\\bin") contains ":" (the drive) and no ";" — the
    // old heuristic picked ":" there and split the drive off the path,
    // which failed the injected-PATH tests on the windows CI leg
    // (commandExists/resolveServerCommand both route through here).
    const sep = process.platform === "win32" ? ";" : pathDelimiter;
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
    private readonly maxMessageBytes: number;
    /** Called for every server → client notification. */
    onNotification: ((method: string, params: unknown) => void) | null = null;
    /** Called on unplanned child exit (crash bookkeeping lives in the manager). */
    onExit: ((code: number | null) => void) | null = null;
    /** Called once on a framing violation before the connection recycles itself. */
    onError: ((reason: string) => void) | null = null;

    constructor(command: string[], cwd: string, maxMessageBytes = 32 * 1024 * 1024) {
        this.command = command;
        this.cwd = cwd;
        this.maxMessageBytes = maxMessageBytes;
    }

    get running(): boolean {
        return !this.disposed && this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
    }

    /** True after an intentional dispose() (vs an unplanned crash). */
    get intentionallyDisposed(): boolean {
        return this.disposed;
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
        registerChild(proc); // last-resort reaper (child-reaper.ts)
        proc.on("error", (err) => this.failAllPending(new Error(`server error: ${err.message}`)));
        proc.once("exit", (code) => {
            unregisterChild(proc);
            // In-flight requests must REJECT with the exit reason, never hang.
            this.failAllPending(new Error(`server exited (code ${code ?? "unknown"})`));
            this.onExit?.(code);
        });
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

    /**
     * Ask the server to exit politely, then stop reading. Spec-compliant
     * servers flush/checkpoint on `shutdown` + `exit` (L-16): both frames
     * are written fire-and-forget (dispose must stay synchronous), the kill
     * lands after a short grace, and the child-reaper covers the residue.
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.failAllPending(new Error("connection disposed"));
        const proc = this.proc;
        this.proc = null;
        if (!proc) return;
        try {
            if (proc.stdin && proc.exitCode === null) {
                const shutdown = JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method: "shutdown", params: null }) + "\r\n";
                const exitNote = JSON.stringify({ jsonrpc: "2.0", method: "exit" }) + "\r\n";
                proc.stdin.write(frame(shutdown));
                proc.stdin.write(frame(exitNote));
            }
        } catch {
            /* already gone */
        }
        const kill = setTimeout(() => {
            try {
                proc.kill();
            } catch {
                /* already gone */
            }
            unregisterChild(proc);
        }, 250);
        kill.unref?.();
    }

    private failAllPending(err: Error): void {
        for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(err);
        }
        this.pending.clear();
    }

    /**
     * Framing violation (oversized Content-Length, unbounded garbage):
     * surface one line on the error hook, fail pending requests with the
     * reason, and recycle the connection — lazy restart takes it from there.
     */
    private violate(reason: string): void {
        if (this.disposed) return;
        this.onError?.(reason);
        this.failAllPending(new Error(reason));
        this.dispose();
    }

    /**
     * Parse complete JSON-RPC messages out of the stdout stream.
     *
     * H1: header termination accepts CRLF and LF-only framing (L-18); a
     * garbage block without a usable Content-Length no longer drops the
     * whole buffer — scanning resumes at the next `Content-Length:`
     * occurrence (L-03), keeping any co-buffered valid frame; and the
     * accepted Content-Length itself is capped (L-02) so `Content-Length:
     * 4294967296` cannot buffer unbounded memory.
     */
    private feed(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (;;) {
            // CRLF first; LF-only fallback for servers that frame with `\n\n`.
            // A CRLF-framed stream never contains a bare `\n\n`, so taking
            // the earlier terminator is always the right split.
            let headerEnd = this.buffer.indexOf("\r\n\r\n");
            let sepLen = 4;
            const lfEnd = this.buffer.indexOf("\n\n");
            if (headerEnd < 0 || (lfEnd >= 0 && lfEnd < headerEnd)) {
                headerEnd = lfEnd;
                sepLen = 2;
            }
            if (headerEnd < 0) {
                // No header terminator yet — bound the wait so garbage without
                // any framing cannot grow the buffer forever.
                if (this.buffer.length > this.maxMessageBytes) {
                    this.violate(`LSP stream exceeded ${this.maxMessageBytes} buffered bytes without a complete header`);
                }
                return;
            }
            const header = this.buffer.subarray(0, headerEnd).toString("ascii");
            const match = /Content-Length:\s*(\d+)/i.exec(header);
            if (!match) {
                // Garbage block (startup banner etc.) — resync instead of
                // dropping everything behind it.
                this.resyncPastGarbage(headerEnd + sepLen);
                continue;
            }
            const length = Number(match[1]);
            if (!Number.isFinite(length) || length > this.maxMessageBytes) {
                this.violate(`LSP Content-Length ${match[1]} exceeds cap ${this.maxMessageBytes} (UNOWN_LSP_MAX_MSG_BYTES)`);
                return;
            }
            const bodyStart = headerEnd + sepLen;
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

    /**
     * Skip a garbage block: everything before the next `Content-Length:`
     * occurrence is dropped. When none exists yet, keep only a plausible
     * partial-header tail (the last line fragment) so a header split across
     * chunk boundaries still completes; otherwise drop to the last newline.
     */
    private resyncPastGarbage(after: number): void {
        const next = this.buffer.indexOf("Content-Length:", after);
        if (next >= 0) {
            this.buffer = this.buffer.subarray(next);
            return;
        }
        const lastNl = this.buffer.lastIndexOf("\n");
        const tail = lastNl >= 0 ? this.buffer.subarray(lastNl + 1) : Buffer.alloc(0);
        // A tail without whitespace/colons could still be a growing header
        // line ("Content-Len…") — keep it; anything else is garbage.
        this.buffer = /^[A-Za-z-]*$/.test(tail.toString("ascii")) ? tail : Buffer.alloc(0);
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
    /** Max accepted Content-Length per message (default 32 MiB; L-02). */
    maxMessageBytes?: number;
    /** Restart cooldown after a crash (default 30 s; L-14). */
    crashCooldownMs?: number;
    /** Auto-restart budget per server per session (default 3; L-14). */
    maxRestarts?: number;
}

export interface ServerStatusEntry {
    language: string;
    command: string;
    state: "running" | "available" | "missing" | "crashed";
    /** Crashes recorded for this server in this session (unplanned exits + framing violations + failed starts). */
    crashCount?: number;
    /** ms-epoch of the last crash, when one was recorded. */
    lastCrashAt?: number;
    /** Why the server is not running: crash reason, "restarts exhausted", or cooldown. */
    detail?: string;
}

interface CrashRecord {
    count: number;
    lastAt: number;
    restarts: number;
    reason: string;
}

/**
 * Per-session LSP manager. One connection per resolved server command
 * (languages sharing a spec share the process — e.g. all four TS/JS ids ride
 * one typescript-language-server). Tracks open documents, mirrors edits via
 * didChange, and caches the latest publishDiagnostics per file with the
 * timestamp needed to wait for FRESH results after a write.
 *
 * H1 restart semantics (L-01/L-14): an unplanned server exit evicts the
 * connection, clears that server's openDocs (so the next syncDocument
 * re-didOpens on a fresh process — a didChange for a never-opened doc is a
 * protocol violation real servers ignore, which silently killed the M1
 * diagnostics loop), records crashCount/lastCrashAt, and gates lazy restarts
 * behind a cooldown + a 3-restart budget so a crash-looping server can never
 * become a spawn storm.
 */
export class LspManager {
    readonly cwd: string;
    private readonly config: LspConfig;
    private readonly env: Record<string, string | undefined>;
    readonly requestTimeoutMs: number;
    readonly diagnosticsWaitMs: number;
    readonly maxMessageBytes: number;
    readonly crashCooldownMs: number;
    readonly maxRestarts: number;
    private connections = new Map<string, LspConnection>(); // key: command.join(" ")
    private commandByLanguage = new Map<string, string[] | null>();
    private openDocs = new Map<string, OpenDoc>(); // key: file path
    private diagnostics = new Map<string, { items: LspDiagnostic[]; ts: number }>(); // key: file path
    private starting = new Map<string, Promise<void>>();
    private crashes = new Map<string, CrashRecord>(); // key: command.join(" ")
    /** Per server: has it EVER published diagnostics (wait-skip heuristic). */
    private publishedEver = new Map<string, boolean>();
    /** Per server: have we already burned one wait on it (wait-skip heuristic). */
    private waitedEver = new Map<string, boolean>();

    constructor(opts: LspManagerOptions) {
        this.cwd = opts.cwd;
        this.config = opts.config ?? {};
        this.env = opts.env ?? process.env;
        this.requestTimeoutMs = opts.requestTimeoutMs ?? parseMsEnv("UNOWN_LSP_TIMEOUT_MS", 15_000, this.env);
        this.diagnosticsWaitMs = opts.diagnosticsWaitMs ?? parseMsEnv("UNOWN_LSP_WAIT_MS", 10_000, this.env);
        this.maxMessageBytes =
            opts.maxMessageBytes ?? parseMsEnv("UNOWN_LSP_MAX_MSG_BYTES", 32 * 1024 * 1024, this.env, 1024 * 1024 * 1024);
        this.crashCooldownMs = opts.crashCooldownMs ?? parseMsEnv("UNOWN_LSP_CRASH_COOLDOWN_MS", 30_000, this.env);
        this.maxRestarts = opts.maxRestarts ?? parseRestartCapEnv(this.env);
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
     *
     * Restart policy: while a crash record exists, restarts are gated by the
     * cooldown (30 s default) and the per-session restart budget — after the
     * cap, syncs skip cheaply (null, no spawn) and status reports
     * "crashed (restarts exhausted)".
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
        const crash = this.crashes.get(key);
        if (crash) {
            if (crash.restarts >= this.maxRestarts) return null; // exhausted — cheap skip
            if (Date.now() - crash.lastAt < this.crashCooldownMs) return null; // cooldown
            crash.restarts++;
        }
        const conn = new LspConnection(command, this.cwd, this.maxMessageBytes);
        conn.onNotification = (method, params) => this.handleNotification(method, params);
        conn.onExit = (code) => {
            if (conn.intentionallyDisposed) return; // disposeAll/violation already recorded
            this.evictConnection(key, conn, `server exited (code ${code ?? "unknown"})`);
        };
        conn.onError = (reason) => this.evictConnection(key, conn, reason);
        this.connections.set(key, conn);
        const startPromise = conn.start(this.requestTimeoutMs).then(
            () => undefined,
            (err: Error) => {
                if (this.connections.get(key) === conn) {
                    this.connections.delete(key);
                    // A failed start (spawn failure, initialize timeout) counts
                    // as a crash: without this, a dead binary would be
                    // re-spawned on every sync. Violations/crashes that already
                    // evicted the connection recorded themselves with a better
                    // reason — don't double-count.
                    this.recordCrash(key, `start failed: ${err.message}`);
                }
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

    /** Evict a dead connection: drop it, reset its openDocs, record the crash. */
    private evictConnection(key: string, conn: LspConnection, reason: string): void {
        if (this.connections.get(key) === conn) this.connections.delete(key);
        this.clearOpenDocsFor(key);
        this.recordCrash(key, reason);
    }

    /** Remove openDocs served by the server identified by `key`. */
    private clearOpenDocsFor(key: string): void {
        for (const [path, doc] of [...this.openDocs]) {
            const command = this.serverCommandFor(doc.languageId);
            if (command && command.join(" ") === key) this.openDocs.delete(path);
        }
    }

    private recordCrash(key: string, reason: string): void {
        const record = this.crashes.get(key) ?? { count: 0, lastAt: 0, restarts: 0, reason: "" };
        record.count++;
        record.lastAt = Date.now();
        record.reason = reason;
        this.crashes.set(key, record);
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
     *
     * H1 HANG-killers (L-08): the PostToolUse loop used to burn the full
     * 10 s window on every edit for a silent or dead server. Now it also
     * (a) bails as soon as the connection dies mid-wait, and (b) skips the
     * wait entirely once a server has demonstrably never published anything
     * (first wait still runs — that is the learning period; a server that
     * has never published anything and already made us wait once never
     * will).
     */
    async waitForFreshDiagnostics(path: string, afterTs: number): Promise<LspDiagnostic[]> {
        const current = this.diagnostics.get(path);
        if (current && current.ts >= afterTs) return current.items;
        const key = this.serverKeyForPath(path);
        if (key) {
            if (this.waitedEver.get(key) && this.publishedEver.get(key) !== true) {
                return current?.items ?? [];
            }
            this.waitedEver.set(key, true);
        }
        const deadline = Date.now() + this.diagnosticsWaitMs;
        for (;;) {
            const now = this.diagnostics.get(path);
            if (now && now.ts >= afterTs) return now.items;
            if (key && !(this.connections.get(key)?.running)) return now?.items ?? []; // server died mid-wait
            if (Date.now() >= deadline) return now?.items ?? [];
            await sleep(150);
        }
    }

    /** Server key (command line) for a file path's language, when resolved. */
    private serverKeyForPath(path: string): string | null {
        const language = languageFromPath(path);
        if (!language) return null;
        return this.serverCommandFor(language)?.join(" ") ?? null;
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

    /**
     * Status snapshot for the /lsp command and the status action. Servers
     * with a crash record and no live connection report `crashed` with the
     * crash count, last-crash timestamp, and why restarts are gated
     * ("restarts exhausted" or the remaining cooldown).
     */
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
                const crash = this.crashes.get(key);
                if (conn?.running) {
                    servers.push({
                        language,
                        command: command.join(" "),
                        state: "running",
                        crashCount: crash?.count,
                        lastCrashAt: crash?.lastAt,
                    });
                    continue;
                }
                if (crash) {
                    const exhausted = crash.restarts >= this.maxRestarts;
                    const cooldownLeft = Math.max(0, this.crashCooldownMs - (Date.now() - crash.lastAt));
                    servers.push({
                        language,
                        command: command.join(" "),
                        state: "crashed",
                        crashCount: crash.count,
                        lastCrashAt: crash.lastAt,
                        detail: exhausted
                            ? "restarts exhausted"
                            : `${cooldownLeft}ms crash cooldown — ${crash.reason}`,
                    });
                    continue;
                }
                servers.push({
                    language,
                    command: command.join(" "),
                    state: "available",
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
        this.crashes.clear();
    }

    private handleNotification(method: string, params: unknown): void {
        if (method !== "textDocument/publishDiagnostics") return;
        const p = params as { uri?: string; diagnostics?: LspDiagnostic[] } | null;
        if (!p?.uri) return;
        const path = uriToPath(p.uri);
        this.diagnostics.set(path, { items: Array.isArray(p.diagnostics) ? p.diagnostics : [], ts: Date.now() });
        const key = this.serverKeyForPath(path);
        if (key) this.publishedEver.set(key, true);
    }
}

/** UNOWN_LSP_MAX_RESTARTS: integer 0..100, junk → default 3. */
function parseRestartCapEnv(env: Record<string, string | undefined>): number {
    const raw = env.UNOWN_LSP_MAX_RESTARTS;
    if (raw === undefined || raw === "") return 3;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) return 3;
    return parsed;
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
