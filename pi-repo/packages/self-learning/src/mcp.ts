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
 * initialize; `UNOWN_MCP_RECONNECT_COOLDOWN_MS` (30000) blocks reconnect
 * attempts after a failure (spawn-storm guard; /mcp force-throughs);
 * `UNOWN_MCP_KEEPALIVE=0` disables the 60 s ping keepalive
 * (`UNOWN_MCP_PING_INTERVAL_MS`); result text capped at 16 k chars.
 *
 * H2 hardening (research R-a §4 items 1-4/6-7, audit M-01/M-08/M-09/M-10/
 * M-14/M-15/M-17/M-20): project-scoped `.unown/mcp.json` is TRUST-GATED
 * (config-trust.ts — refuse-first; a cloned repo's config used to execute
 * arbitrary commands at session_start). HTTP entries validate their URL
 * (http/https + host, actionable problems), never follow redirects
 * (`redirect: "error"` — a 302 must not bounce our headers to another
 * host), keep protocol headers un-clobberable, and expand `${VAR}` in
 * url/headers/cwd like everywhere else. Windows stdio spawns go through a
 * shared, escaped cmd.exe wrapper (also used by lsp.ts). Config validation
 * surfaces actionable problems instead of silently swallowing them.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { registerChild, unregisterChild } from "./child-reaper.ts";
import { unownVersion } from "./packaging.ts";
import { trustApprovalNeeded, trustBypassed, trustConfig, trustStatePath } from "./config-trust.ts";
import {
    decideElicitation,
    defaultElicitationConfig,
    ELICITATION_DEFAULT_DUMMY,
    resolveElicitationConfig as resolveElicitationConfigFromElicitation,
    type ElicitationConfig as ElicitationConfigFromElicitation,
    type ElicitationDecision,
    type ElicitationRequest,
} from "./elicitation.ts";
import { annotateToolOutput, recordShieldFlag } from "./shield.ts";
import { UNOWN_AGENT_DIR } from "./term.ts";

// ---------------------------------------------------------------------------
// Env parsing (shared with lsp.ts — H1 L-15/M-18)
// ---------------------------------------------------------------------------

/**
 * Parse one ms env knob tolerantly: undefined/empty/NaN/negative/zero/absurd
 * (> `maxMs`) all fall back to `defaultMs`. `maxMs` also lets byte-count
 * knobs reuse this helper with a byte-scaled absurdity bound.
 *
 * No cross-call memoization on purpose: tests mutate process.env between
 * cases, and every consumer reads its env once (at manager construction) —
 * which is the actual "read env once" contract. `Number(env)` without these
 * guards made `UNOWN_*_TIMEOUT_MS=abc` fail every request instantly.
 */
export function parseMsEnv(
    name: string,
    defaultMs: number,
    env: Record<string, string | undefined> = process.env,
    maxMs = 24 * 60 * 60 * 1000,
): number {
    const raw = env[name];
    if (raw === undefined || raw === "") return defaultMs;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maxMs) return defaultMs;
    return parsed;
}

// ---------------------------------------------------------------------------
// Client identity (M-17) + shared config-validation vocabulary (L-06/M-10)
// ---------------------------------------------------------------------------

/** Unown's version — the value the release-artifact build injected, else the
 * ROOT package.json (the source of truth CI asserts against; same contract as
 * cli.ts's VERSION). "unknown" when neither is available. Never hardcoded: the
 * initialize handshake used to claim 0.1.0 while the shipped package was 2.1.x. */
export const UNOWN_VERSION: string = unownVersion(join(import.meta.dir, "..", "..", "..", "..", "package.json"));

/** clientInfo sent in every initialize handshake. */
export const UNOWN_CLIENT_INFO: { name: string; version: string } = { name: "unown", version: UNOWN_VERSION };

/** The protocol revision we speak (MCP streamable-HTTP/stdio, 2025-06-18). */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** One actionable config problem (bad shape, bad URL, untrusted file…). */
export interface ConfigProblem {
    file: string;
    /** JSON key path inside the file, e.g. `mcpServers.example.url`. */
    key: string;
    message: string;
    /** Fix suggestion. */
    hint?: string;
}

/** Render one problem compactly for logs and the /mcp problems block. */
export function formatConfigProblem(p: ConfigProblem): string {
    return `${basename(p.file)}: ${p.key} — ${p.message}${p.hint ? ` (${p.hint})` : ""}`;
}

function describeValue(v: unknown): string {
    if (v === null) return "null";
    if (Array.isArray(v)) return "an array";
    if (typeof v === "string") return `the string ${JSON.stringify(v.slice(0, 60))}`;
    return `a ${typeof v}`;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface StdioServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    /**
     * Per-server elicitation policy (Milestone 2.3). When absent the default
     * is `autoDecline: true` — a headless agent cannot prompt the user
     * mid-turn, so server-initiated `elicitation/create` requests are
     * declined with `defaultReason`. Opt into `autoAccept: true` only when
     * the model is the "user" and the server is trusted.
     */
    elicitation?: ElicitationConfig;
}

export interface HttpServerConfig {
    url: string;
    headers?: Record<string, string>;
    /** Per-server elicitation policy (Milestone 2.3 — see StdioServerConfig). */
    elicitation?: ElicitationConfig;
}

export type AnyServerConfig = StdioServerConfig | HttpServerConfig;

/**
 * Per-server elicitation policy (Milestone 2.3 — reverse-engineered from
 * goose's `elicitation.rs` + the MCP standard's elicitation capability).
 *
 * The pure decision logic lives in `./elicitation.ts` (no pi imports,
 * fully unit-testable). This file re-exports the type for back-compat
 * with the existing imports + wires the resolved policy into the
 * `McpConnection` (per-server, captured at construction) and the
 * `elicitation/create` server→client JSON-RPC request handler.
 *
 * A headless agent cannot surface a JSON-schema prompt to the user
 * mid-turn, so the default behavior is `autoDecline: true` — server
 * `elicitation/create` requests come back with `action: "decline"` and
 * the `defaultReason` in the `content.reason` field. Opt into
 * `autoAccept: true` only when the model is the "user" and the server
 * is trusted; the client then synthesizes dummy data satisfying the
 * schema and returns `action: "accept"`. The elicited data is
 * forwarded to the server and the model never sees the request
 * directly.
 */
export type ElicitationConfig = ElicitationConfigFromElicitation;
export type { ElicitationDecision, ElicitationRequest } from "./elicitation.ts";
export { defaultElicitationConfig, ELICITATION_DEFAULT_DUMMY } from "./elicitation.ts";

/** Resolve a server config's elicitation policy to effective defaults. */
export function resolveElicitationConfig(cfg: AnyServerConfig | undefined): Required<ElicitationConfig> {
    const e = (cfg as { elicitation?: ElicitationConfig } | undefined)?.elicitation;
    return resolveElicitationConfigFromElicitation(e);
}

/**
 * Validate + normalize the `elicitation` block of a server entry. Returns
 * `undefined` when no policy is set (the manager falls back to
 * `autoDecline: true`). Bad shapes surface actionable problems and fall
 * back to "no policy" so the entry still loads.
 */
function normalizeElicitationEntry(
    raw: unknown,
    file: string,
    key: string,
    problems: ConfigProblem[],
): ElicitationConfig | undefined {
    if (raw === undefined) return undefined;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        problems.push({ file, key: `${key}.elicitation`, message: `expected an object, got ${describeValue(raw)} — ignored` });
        return undefined;
    }
    const v = raw as Record<string, unknown>;
    const out: ElicitationConfig = {};
    if (v.autoAccept !== undefined) {
        if (typeof v.autoAccept !== "boolean") {
            problems.push({ file, key: `${key}.elicitation.autoAccept`, message: `expected boolean, got ${describeValue(v.autoAccept)} — ignored` });
        } else {
            out.autoAccept = v.autoAccept;
        }
    }
    if (v.autoDecline !== undefined) {
        if (typeof v.autoDecline !== "boolean") {
            problems.push({ file, key: `${key}.elicitation.autoDecline`, message: `expected boolean, got ${describeValue(v.autoDecline)} — ignored` });
        } else {
            out.autoDecline = v.autoDecline;
        }
    }
    if (v.defaultReason !== undefined) {
        if (typeof v.defaultReason !== "string") {
            problems.push({ file, key: `${key}.elicitation.defaultReason`, message: `expected string, got ${describeValue(v.defaultReason)} — ignored` });
        } else {
            out.defaultReason = v.defaultReason;
        }
    }
    const unknownKeys = Object.keys(v).filter((k) => k !== "autoAccept" && k !== "autoDecline" && k !== "defaultReason");
    if (unknownKeys.length > 0) {
        problems.push({ file, key: `${key}.elicitation`, message: `unknown field(s): ${unknownKeys.map((k) => `'${k}'`).join(", ")} — ignored` });
    }
    return out;
}

export interface McpConfig {
    disabled?: boolean;
    servers: Record<string, AnyServerConfig>;
}

export function isHttpConfig(cfg: AnyServerConfig): cfg is HttpServerConfig {
    return typeof (cfg as HttpServerConfig).url === "string" && (cfg as HttpServerConfig).url.length > 0;
}

/** Validate an HTTP server URL (M-09): http/https with a hostname. Returns
 * the actionable problem message, or null when valid. `file://`, `unix://`,
 * `ftp:` and host-less strings are refused at config load so they can never
 * reach fetch (Bun's fetch would happily GET a `file://` URL). */
export function validateHttpUrl(url: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return `url is not a valid absolute URL: ${JSON.stringify(url.slice(0, 80))}`;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return `url scheme must be http or https, got ${parsed.protocol} (in ${JSON.stringify(url.slice(0, 80))})`;
    }
    if (!parsed.hostname) return `url is missing a host: ${JSON.stringify(url.slice(0, 80))}`;
    return null;
}

export interface HttpHeaderProblem {
    name: string;
    message: string;
}

/**
 * Expand `${VAR}` in header values and validate names/values (M-09/M-10): a
 * CR/LF/NUL in a header is a request-splitting vector, so offending headers
 * are DROPPED with a reported problem instead of being sent (fetch would
 * otherwise fail with a bare TypeError at connect time).
 */
export function normalizeHttpHeaders(
    raw: Record<string, unknown>,
    env: Record<string, string | undefined> = process.env,
): { headers: Record<string, string>; problems: HttpHeaderProblem[] } {
    const headers: Record<string, string> = {};
    const problems: HttpHeaderProblem[] = [];
    for (const [name, value] of Object.entries(raw)) {
        if (typeof value !== "string") {
            problems.push({ name, message: `header value must be a string, got ${typeof value} — header ignored` });
            continue;
        }
        if (!name || /[\r\n\0]/.test(name)) {
            problems.push({ name: name || "(empty)", message: "header name is empty or contains a line break — header ignored" });
            continue;
        }
        const expanded = expandEnv(value, env);
        if (/[\r\n\0]/.test(expanded)) {
            problems.push({ name, message: `header value contains a line break (request splitting) — header ignored` });
            continue;
        }
        headers[name] = expanded;
    }
    return { headers, problems };
}

function normalizeServerEntry(
    name: string,
    value: unknown,
    file: string,
    env: Record<string, string | undefined>,
    problems: ConfigProblem[],
): AnyServerConfig | null {
    const key = `mcpServers.${name}`;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        problems.push({ file, key, message: `server entry must be an object, got ${describeValue(value)}` });
        return null;
    }
    const v = value as Record<string, unknown>;
    if (v.url !== undefined) {
        if (typeof v.url !== "string" || !v.url) {
            problems.push({ file, key: `${key}.url`, message: `'url' must be a non-empty string, got ${describeValue(v.url)}` });
            return null;
        }
        const url = expandEnv(v.url, env);
        const urlProblem = validateHttpUrl(url);
        if (urlProblem) {
            problems.push({ file, key: `${key}.url`, message: urlProblem, hint: "only http:// and https:// URLs with a hostname are supported" });
            return null;
        }
        let headersIn: Record<string, unknown> = {};
        if (v.headers !== undefined) {
            if (typeof v.headers !== "object" || v.headers === null || Array.isArray(v.headers)) {
                problems.push({ file, key: `${key}.headers`, message: `expected an object of name → value, got ${describeValue(v.headers)}` });
            } else {
                headersIn = v.headers as Record<string, unknown>;
            }
        }
        const { headers, problems: headerProblems } = normalizeHttpHeaders(headersIn, env);
        for (const hp of headerProblems) problems.push({ file, key: `${key}.headers.${hp.name}`, message: hp.message });
        const elicitation = normalizeElicitationEntry(v.elicitation, file, key, problems);
        const out: HttpServerConfig = { url, headers: Object.keys(headers).length > 0 ? headers : undefined };
        if (elicitation) out.elicitation = elicitation;
        return out;
    }
    if (typeof v.command === "string" && v.command) {
        let args: string[] | undefined;
        if (v.args !== undefined) {
            if (!Array.isArray(v.args)) {
                problems.push({ file, key: `${key}.args`, message: `'args' must be an array of strings, got ${describeValue(v.args)}` });
            } else {
                const strings = v.args.filter((a): a is string => typeof a === "string");
                if (strings.length !== v.args.length) {
                    problems.push({ file, key: `${key}.args`, message: `'args' contains ${v.args.length - strings.length} non-string element(s) — those are dropped` });
                }
                args = strings.length > 0 ? strings : undefined;
            }
        }
        let envOut: Record<string, string> | undefined;
        if (v.env !== undefined) {
            if (typeof v.env !== "object" || v.env === null || Array.isArray(v.env)) {
                problems.push({ file, key: `${key}.env`, message: `expected an object of name → value, got ${describeValue(v.env)}` });
            } else {
                const entries = Object.entries(v.env as Record<string, unknown>).filter(([, e]) => typeof e === "string") as Array<[string, string]>;
                const dropped = Object.keys(v.env as Record<string, unknown>).length - entries.length;
                if (dropped > 0) {
                    problems.push({ file, key: `${key}.env`, message: `'env' contains ${dropped} non-string value(s) — those are dropped` });
                }
                envOut = entries.length > 0 ? Object.fromEntries(entries) : undefined;
            }
        }
        const cwd = typeof v.cwd === "string" && v.cwd ? expandEnv(v.cwd, env) : undefined;
        const elicitation = normalizeElicitationEntry(v.elicitation, file, key, problems);
        const out: StdioServerConfig = { command: v.command, args, env: envOut, cwd };
        if (elicitation) out.elicitation = elicitation;
        return out;
    }
    problems.push({
        file,
        key,
        message: `server entry needs either 'command' (stdio) or 'url' (http) — found ${Object.keys(v).length > 0 ? `only ${Object.keys(v).map((k) => `'${k}'`).join(", ")}` : "no keys"}`,
    });
    return null;
}

export interface McpConfigFileResult {
    config: McpConfig | null;
    problems: ConfigProblem[];
}

/**
 * Parse + validate one mcp.json. NEVER crashes on a bad config (L-06/M-10):
 * parse failures and invalid shapes come back as actionable `problems`, and
 * unusable entries are dropped instead of silently swallowed. `${VAR}` is
 * expanded in url/headers/cwd values with `env` (unknown vars stay literal).
 */
export function loadMcpConfigFile(
    filePath: string,
    env: Record<string, string | undefined> = process.env,
): McpConfigFileResult {
    if (!existsSync(filePath)) return { config: null, problems: [] };
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (err) {
        return {
            config: null,
            problems: [
                {
                    file: filePath,
                    key: "(root)",
                    message: `invalid JSON — ${(err as Error).message}`,
                    hint: "fix the syntax; the file is ignored until then",
                },
            ],
        };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { config: null, problems: [{ file: filePath, key: "(root)", message: `expected a JSON object, got ${describeValue(parsed)}` }] };
    }
    const root = parsed as { mcpServers?: unknown; disabled?: unknown };
    const problems: ConfigProblem[] = [];
    if (root.mcpServers !== undefined && (typeof root.mcpServers !== "object" || root.mcpServers === null || Array.isArray(root.mcpServers))) {
        problems.push({ file: filePath, key: "mcpServers", message: `expected an object of server entries, got ${describeValue(root.mcpServers)}` });
        return { config: { disabled: root.disabled === true, servers: {} }, problems };
    }
    if (root.disabled !== undefined && typeof root.disabled !== "boolean") {
        problems.push({ file: filePath, key: "disabled", message: `expected true or false, got ${describeValue(root.disabled)} — ignored` });
    }
    const raw = (root.mcpServers ?? {}) as Record<string, unknown>;
    const servers: Record<string, AnyServerConfig> = {};
    for (const [name, value] of Object.entries(raw)) {
        const cfg = normalizeServerEntry(name, value, filePath, env, problems);
        if (cfg) servers[name] = cfg;
    }
    return { config: { disabled: root.disabled === true, servers }, problems };
}

/** `${VAR}` expansion from the environment (unknown vars left literal). */
export function expandEnv(value: string, env: Record<string, string | undefined> = process.env): string {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) => {
        const v = env[name];
        return v === undefined ? whole : v;
    });
}

/** Merged config: user file ← project file (project wins per server name).
 *
 * TRUST GATE (H2, M-01 — the audit's top security gap): the project file is
 * attacker-controlled in a cloned repo, so an untrusted project file's
 * servers are WITHHELD into `gatedServers` (never spawned) and `needsTrust`
 * flips true; the status surface renders the approval action (`/mcp trust`).
 * Files under `userDir` are user-owned and always trusted.
 * `UNOWN_TRUST_PROJECT_CONFIG=1|true` bypasses the gate (CI/headless). */
export interface ResolvedMcpConfig {
    config: McpConfig;
    problems: ConfigProblem[];
    /** Project config path when one exists. */
    projectFile: string | null;
    /** Project config present but untrusted (entries withheld). */
    needsTrust: boolean;
    /** Servers withheld by the trust gate (shown as not-configured). */
    gatedServers: Record<string, AnyServerConfig>;
}

export function resolveMcpConfig(
    cwd: string,
    userDir: string = UNOWN_AGENT_DIR,
    env: Record<string, string | undefined> = process.env,
): ResolvedMcpConfig {
    const merged: McpConfig = { servers: {} };
    const problems: ConfigProblem[] = [];
    const gatedServers: Record<string, AnyServerConfig> = {};
    const projectFile = join(cwd, ".unown", "mcp.json");
    const trustOpts = { statePath: trustStatePath(userDir), userDir, env };
    let needsTrust = false;
    for (const file of [join(userDir, "mcp.json"), projectFile]) {
        const isProject = file === projectFile;
        const { config: cfg, problems: fileProblems } = loadMcpConfigFile(file, env);
        problems.push(...fileProblems);
        if (!cfg) continue;
        if (isProject && trustApprovalNeeded(file, trustOpts)) {
            needsTrust = true;
            Object.assign(gatedServers, cfg.servers);
            problems.push({
                file,
                key: "mcpServers",
                message: `project mcp.json is untrusted — ${Object.keys(cfg.servers).length} server(s) withheld`,
                hint: "run /mcp trust (or set UNOWN_TRUST_PROJECT_CONFIG=1)",
            });
            continue;
        }
        if (cfg.disabled === true) merged.disabled = true;
        if (cfg.disabled === false) merged.disabled = false;
        Object.assign(merged.servers, cfg.servers);
    }
    return { config: merged, problems, projectFile: existsSync(projectFile) ? projectFile : null, needsTrust, gatedServers };
}

// ---------------------------------------------------------------------------
// JSON parsing that tolerates pretty-printed NDJSON
// ---------------------------------------------------------------------------

/**
 * Depth-aware line accumulator: feeds chunks, yields complete JSON-RPC
 * messages. Handles newline-delimited JSON AND servers that pretty-print
 * (multi-line objects) by tracking brace depth outside strings.
 *
 * H1 hardening (M-02): servers log banners and occasionally emit binary
 * junk on stdout, and one stray byte used to kill the whole transport:
 *
 *   - a stray `}`/`]` while depth is 0 is GARBAGE, not structure: the bytes
 *     up to and including it are dropped and scanning continues (the old
 *     code let depth go negative, so every later well-formed message was
 *     silently swallowed → all requests hit the 120 s timeout);
 *   - a candidate that fails JSON.parse no longer poisons the stream: the
 *     garbage prefix before the first `{`/`[` is isolated and dropped, and
 *     the embedded message is re-scanned; a genuinely corrupt message is
 *     skipped past its opening brace (always ≥1 byte of progress, so
 *     recovery terminates);
 *   - NUL and other control bytes outside strings are dropped as garbage
 *     instead of accumulating forever;
 *   - hard caps: 1 MiB per message and 4 MiB total buffered — on breach the
 *     buffer is flushed and `onError` fires so the manager can mark the
 *     server errored instead of silently wedging.
 */
export class JsonMessageAccumulator {
    private buffer = "";
    private depth = 0;
    private inString = false;
    private escaped = false;
    /** Chars before this index were already counted (state persists across feeds). */
    private scanIndex = 0;
    private messageStart = 0;
    /** Cap breaches surface here; wired by McpConnection to kill the connection. */
    onError: ((message: string) => void) | null = null;
    private readonly maxMessageChars: number;
    private readonly maxBufferChars: number;

    constructor(maxMessageChars = 1024 * 1024, maxBufferChars = 4 * 1024 * 1024) {
        this.maxMessageChars = maxMessageChars;
        this.maxBufferChars = maxBufferChars;
    }

    /** Feed a text chunk; returns every complete JSON message parsed. */
    feed(chunk: string): unknown[] {
        this.buffer += chunk;
        if (this.buffer.length > this.maxBufferChars) {
            this.reportCapBreach("total buffered output", this.maxBufferChars);
            return [];
        }
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
                if (i - this.messageStart >= this.maxMessageChars) {
                    this.reportCapBreach("message", this.maxMessageChars);
                    continue;
                }
            } else if (ch === "}" || ch === "]") {
                if (this.depth <= 0) {
                    // Stray closer in garbage — drop through it, keep scanning.
                    this.trimBuffer(i + 1);
                    continue;
                }
                this.depth--;
                if (this.depth === 0) {
                    if (i - this.messageStart >= this.maxMessageChars) {
                        this.reportCapBreach("message", this.maxMessageChars);
                        continue;
                    }
                    const candidate = this.buffer.slice(this.messageStart, i + 1);
                    let parsed: unknown;
                    let ok = true;
                    try {
                        parsed = JSON.parse(candidate.trim());
                    } catch {
                        ok = false;
                    }
                    if (ok) {
                        out.push(parsed);
                        // The next message starts after this one (skip whitespace).
                        let next = i + 1;
                        while (next < this.buffer.length && /\s/.test(this.buffer[next])) next++;
                        // Drop the consumed prefix so the buffer stays bounded.
                        this.trimBuffer(next);
                    } else {
                        this.recoverGarbage(candidate);
                    }
                    continue;
                }
            } else if (ch.charCodeAt(0) < 0x20 && ch !== "\t" && ch !== "\n" && ch !== "\r") {
                // Control junk (NULs, binary noise) outside strings: garbage.
                this.trimBuffer(i + 1);
                continue;
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

    /** Drop `chars` from the front of the buffer and reset scan state. */
    private trimBuffer(chars: number): void {
        this.buffer = this.buffer.slice(chars);
        this.scanIndex = 0;
        this.messageStart = 0;
        this.inString = false;
        this.escaped = false;
    }

    /**
     * A depth-0 candidate failed JSON.parse: isolate the garbage instead of
     * poisoning the next message. Either drop a garbage prefix before the
     * first opener (and re-scan the embedded message), or — when the opener
     * itself is the corrupt part — advance past it. Both paths drop ≥1 byte,
     * so recovery always makes progress.
     */
    private recoverGarbage(candidate: string): void {
        const rel = candidate.search(/[{[]/);
        if (rel < 0) {
            this.trimBuffer(this.buffer.length);
        } else if (rel > 0) {
            this.trimBuffer(this.messageStart + rel);
        } else {
            this.trimBuffer(this.messageStart + 1);
        }
    }

    /** Flush everything and surface the cap breach (hostile/broken stream). */
    private reportCapBreach(what: string, cap: number): void {
        this.onError?.(`MCP stream cap exceeded: ${what} over ${cap} chars; buffer flushed`);
        this.trimBuffer(this.buffer.length);
        this.depth = 0;
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

/** Surface a JSON-RPC error with its code (M-20/L-12): -32601 vs -32800
 * (server-cancelled) used to be indistinguishable behind a bare message. */
export function mcpErrorMessage(error: { code?: number; message?: string } | undefined | null): string {
    const code = error?.code;
    const message = error?.message ?? "MCP error";
    return code !== undefined ? `MCP error ${code}: ${message}` : `MCP ${message}`;
}

/** JSON-RPC ids echoed as numeric strings ("7") must still match numeric
 * pending keys (M-15/M-20); non-numeric ids pass through unchanged. */
export function normalizeRpcId(id: unknown): number | string | null {
    if (typeof id === "number") return id;
    if (typeof id === "string") return /^-?\d+$/.test(id) ? Number(id) : id;
    return null;
}

/** Loose id equality for SSE stream matching (numeric-string tolerant). */
export function sameJsonRpcId(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a === "string" && typeof b === "number") return Number(a) === b;
    if (typeof a === "number" && typeof b === "string") return a === Number(b);
    return false;
}

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
    /** Header problems found at construction (surfaced once, at connect). */
    private headerProblems: string[] = [];
    /** Bound for fire-and-forget HTTP notifications (M-06: was unbounded). */
    notifyTimeoutMs = 10_000;
    state: ConnectionState = "idle";
    lastError: string | null = null;
    /** Called for server → client notifications (logged, not acted on). */
    onNotification: ((method: string, params: unknown) => void) | null = null;
    /** Called when the stdio child exits (crash bookkeeping lives in the manager). */
    onExit: ((code: number | null) => void) | null = null;
    /** Verbose log sink (caps, header problems, pagination stops). */
    onLog: ((message: string) => void) | null = null;

    private readonly requestTimeoutMs: number;
    private readonly connectTimeoutMs: number;
    /**
     * Per-server elicitation policy (Milestone 2.3). Defaults to
     * `autoDecline: true` — see resolveElicitationConfig. Drives the
     * `elicitation/create` server→client request handler.
     */
    private readonly elicitation: Required<ElicitationConfig>;

    constructor(
        serverName: string,
        cfg: AnyServerConfig,
        cwd: string,
        requestTimeoutMs: number,
        connectTimeoutMs?: number,
        env: Record<string, string | undefined> = process.env,
    ) {
        this.serverName = serverName;
        this.cwd = cwd;
        this.requestTimeoutMs = requestTimeoutMs;
        this.connectTimeoutMs = connectTimeoutMs ?? requestTimeoutMs;
        this.transport = isHttpConfig(cfg) ? "http" : "stdio";
        this.elicitation = resolveElicitationConfig(cfg);
        if (isHttpConfig(cfg)) {
            // ${VAR} expansion + header validation for directly-passed configs
            // (M-10/M-09); loadMcpConfigFile already did both for disk loads.
            this.baseUrl = expandEnv(cfg.url, env);
            const { headers, problems } = normalizeHttpHeaders({ ...(cfg.headers ?? {}) } as Record<string, unknown>, env);
            for (const hp of problems) this.headerProblems.push(hp.message);
            this.headers = headers;
        } else {
            try {
                this.spawnSpec = stdioSpawnSpec(cfg.command, cfg.args ?? [], cfg.env ?? {}, expandEnv(cfg.cwd ?? cwd, env), { expandWith: env });
                this.spawnError = null;
            } catch (err) {
                // Refuse-first for unsafe command lines (M-08): never spawn them.
                this.spawnSpec = null;
                this.spawnError = `MCP server "${serverName}": ${(err as Error).message}`;
            }
        }
    }

    private spawnSpec: { command: string; args: string[]; env: Record<string, string>; cwd: string; verbatim: boolean } | null = null;
    /** Unsafe command line (CRLF / unescapable % through cmd.exe) — start() fails with this. */
    private spawnError: string | null = null;

    get running(): boolean {
        if (this.disposed) return false;
        if (this.transport === "http") return this.state === "connected";
        return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
    }

    /** Requests awaiting a reply (keepalive skips busy connections). */
    get pendingCount(): number {
        return this.pending.size;
    }

    /** initialize handshake; rejects on timeout/spawn failure. */
    async start(connectTimeoutMs: number): Promise<void> {
        this.state = "connecting";
        try {
            if (this.spawnError) throw new Error(this.spawnError);
            if (this.transport === "stdio") {
                await this.startStdio();
            } else {
                await this.startHttp();
            }
            const result = (await this.request(
                "initialize",
                {
                    protocolVersion: MCP_PROTOCOL_VERSION,
                    // Milestone 2.3 — advertise the elicitation capability so
                    // servers know they can request structured mid-turn input.
                    // The client (us) decides per-request what to do; the
                    // default policy is autoDecline (see handleElicitation).
                    capabilities: { elicitation: {} },
                    clientInfo: { ...UNOWN_CLIENT_INFO },
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

    /** The effective elicitation policy (Milestone 2.3). */
    get elicitationPolicy(): Required<ElicitationConfig> {
        return this.elicitation;
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
                // cmd.exe wrapper lines are pre-quoted — without verbatim the
                // runtime re-escapes the embedded quotes and cmd fails instantly
                windowsVerbatimArguments: spec.verbatim === true,
            });
        } catch (err) {
            throw new Error(`failed to spawn ${spec.command}: ${(err as Error).message}`);
        }
        this.proc = proc;
        registerChild(proc); // last-resort reaper (child-reaper.ts)
        // Cap breaches in the stdout parser kill this connection loudly
        // instead of wedging every request into its 120 s timeout.
        this.acc.onError = (reason) => this.transportError(reason);
        proc.on("error", (err) => this.failPending(new Error(`server error: ${err.message}`)));
        proc.once("exit", (code) => {
            unregisterChild(proc);
            if (!this.disposed && this.state !== "error") {
                this.state = "error";
                this.lastError = `server exited (code ${code})`;
            }
            this.failPending(new Error(`server exited (code ${code})`));
            this.onExit?.(code);
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
        // M-09: validate before the first fetch — an invalid URL would
        // otherwise surface as a bare fetch TypeError at connect time.
        const urlProblem = validateHttpUrl(this.baseUrl);
        if (urlProblem) throw new Error(`MCP server "${this.serverName}": ${urlProblem}`);
        for (const hp of this.headerProblems) this.onLog?.(`MCP server "${this.serverName}": ${hp}`);
        this.headerProblems.length = 0;
    }

    /** Send a JSON-RPC request and await its result. */
    request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
        const timeout = timeoutMs ?? this.requestTimeoutMs;
        const id = this.nextId++;
        const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });
        if (this.transport === "http") {
            return this.httpRoundTrip(id, message, timeout, method);
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

    /**
     * HTTP round trip with session-loss recovery (M-04): a 404 means the
     * server restarted and our `Mcp-Session-Id` expired — re-initialize ONCE
     * (adopting the new session id) and replay the original request; if the
     * replay 404s too, the error surfaces.
     */
    private async httpRoundTrip(id: number, message: string, timeoutMs: number, method: string): Promise<unknown> {
        try {
            return await this.httpAttempt(id, message, timeoutMs, method);
        } catch (err) {
            if (err instanceof McpHttpError && err.status === 404 && this.sessionId) {
                this.sessionId = null;
                await this.reinitialize();
                return await this.httpAttempt(id, message, timeoutMs, method);
            }
            throw err;
        }
    }

    /** Re-run the initialize handshake mid-session (404 recovery path). */
    private async reinitialize(): Promise<void> {
        const id = this.nextId++;
        const message = JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "initialize",
            params: {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: { elicitation: {} },
                clientInfo: { ...UNOWN_CLIENT_INFO },
            },
        });
        await this.httpAttempt(id, message, this.connectTimeoutMs, "initialize");
        this.notify("notifications/initialized", {});
    }

    /**
     * One HTTP exchange with 429/503 backoff. Every fetch is bounded by an
     * AbortController (headers AND body); aborts are rewritten into a clear
     * timeout error. `RETRYABLE_HTTP_STATUS` responses are retried at most
     * `HTTP_MAX_RETRIES` times, honoring `Retry-After` (capped).
     */
    private async httpAttempt(id: number, message: string, timeoutMs: number, method: string): Promise<unknown> {
        for (let attempt = 0; ; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                // Protocol headers LAST (M-09): a user header could otherwise
                // clobber content-type/accept and silently break the transport.
                const headers: Record<string, string> = {
                    ...this.headers,
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                };
                if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
                const res = await fetch(this.baseUrl, {
                    method: "POST",
                    headers,
                    body: message,
                    // M-09: never follow redirects — a 302 must not bounce our
                    // custom headers (api keys, session id) to another host.
                    redirect: "error",
                    signal: controller.signal,
                });
                const sessionHeader = res.headers.get("mcp-session-id");
                if (sessionHeader) this.sessionId = sessionHeader;
                if (RETRYABLE_HTTP_STATUS.has(res.status)) {
                    try {
                        const body = res.body;
                        if (body) body.cancel().catch(() => {});
                    } catch {
                        /* body not readable — dropping the response anyway */
                    }
                    if (attempt >= HTTP_MAX_RETRIES) {
                        throw new Error(`HTTP ${res.status} from ${this.baseUrl} — retries exhausted`);
                    }
                    await sleep(retryAfterMs(res.headers.get("retry-after"), attempt));
                    continue;
                }
                if (!res.ok) throw new McpHttpError(res.status, this.baseUrl);
                const contentType = res.headers.get("content-type") ?? "";
                let payload: unknown = null;
                if (contentType.includes("text/event-stream")) {
                    payload = await parseSseResponse(await res.text(), id);
                } else {
                    payload = await res.json();
                }
                const msg = payload as { id?: number; result?: unknown; error?: { message?: string; code?: number } } | null;
                if (msg && msg.error) throw new Error(mcpErrorMessage(msg.error));
                return msg?.result ?? null;
            } catch (err) {
                if (err instanceof McpHttpError) throw err;
                const message = String((err as Error)?.message ?? "");
                if (/redirect/i.test(message)) {
                    throw new Error(
                        `MCP ${method}: ${this.baseUrl} answered with a redirect — refused (redirects are disabled so our headers cannot bounce to another host)`,
                    );
                }
                throw rewriteAbortError(err, method, timeoutMs);
            } finally {
                clearTimeout(timer);
            }
        }
    }

    /** Fire-and-forget notification. */
    notify(method: string, params: unknown): void {
        const message = JSON.stringify({ jsonrpc: "2.0", method, params });
        if (this.transport === "http") {
            // M-06: this fetch used to have no bound at all — a hung remote
            // pinned sockets forever. 10 s cap, best-effort swallow.
            const headers: Record<string, string> = {
                ...this.headers,
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
            };
            if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.notifyTimeoutMs);
            void fetch(this.baseUrl, { method: "POST", headers, body: message, redirect: "error", signal: controller.signal })
                .then((res) => {
                    const body = res.body;
                    if (body) body.cancel().catch(() => {});
                })
                .catch(() => {
                    /* notification — best effort, bounded */
                })
                .finally(() => clearTimeout(timer));
            return;
        }
        try {
            this.proc?.stdin?.write(message + "\n");
        } catch {
            /* server gone */
        }
    }

    /**
     * Keepalive probe (M-11): true when the server is demonstrably alive — a
     * `ping` result OR a JSON-RPC error reply (answering at all proves the
     * transport works). False only for timeouts/write/HTTP failures.
     */
    async ping(timeoutMs = 10_000): Promise<boolean> {
        try {
            await this.request("ping", {}, timeoutMs);
            return true;
        } catch (err) {
            const msg = String((err as Error)?.message ?? "");
            if (
                msg.includes("timed out") ||
                msg.includes("failed to write") ||
                msg.includes("failed to send") ||
                msg.startsWith("HTTP ") ||
                msg.startsWith("MCP stream cap")
            ) {
                return false;
            }
            return true; // JSON-RPC error reply — the server answered
        }
    }

    /** Mark the connection dead from the outside (keepalive failure). */
    markLost(reason: string): void {
        this.transportError(reason);
    }

    /** tools/list with cursor pagination. */
    async listTools(): Promise<McpToolInfo[]> {
        const tools: McpToolInfo[] = [];
        let cursor: string | undefined = undefined;
        for (let page = 0; page < TOOLS_LIST_MAX_PAGES; page++) {
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
        if (cursor) {
            // M-14: silent truncation is the worst kind — say it happened.
            this.onLog?.(`tools/list for "${this.serverName}" still paginates after ${TOOLS_LIST_MAX_PAGES} pages — stopping with a partial list`);
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
        if (text.length > maxResultChars) {
            // M-14: truncation must be VISIBLE to the model, never silent.
            text = text.slice(0, maxResultChars) + `\n(truncated at ${maxResultChars} chars)`;
        }
        return { text, isError: Boolean(result?.isError) };
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.failPending(new Error("connection disposed"));
        const proc = this.proc;
        try {
            proc?.kill();
        } catch {
            /* already gone */
        }
        if (proc) unregisterChild(proc);
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

    /**
     * Fatal transport defect (stdout stream cap breach, keepalive loss):
     * surface the reason on every pending request, mark errored, dispose.
     */
    private transportError(reason: string): void {
        if (this.disposed) return;
        this.state = "error";
        this.lastError = reason;
        this.failPending(new Error(reason));
        this.dispose();
    }

    private handleMessage(message: unknown): void {
        const msg = message as
            | { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string } }
            | null;
        if (!msg || typeof msg !== "object") return;
        if (msg.method && msg.id === undefined) {
            this.onNotification?.(msg.method, msg.params);
            return;
        }
        if (msg.method && msg.id !== undefined) {
            this.replyToServerRequest(msg.id, msg.method, msg.params);
            return;
        }
        // M-15/M-20: servers echoing ids as strings ("7") are valid JSON-RPC;
        // without normalization the response was dropped and the request
        // burned its full 120 s timeout.
        const id = normalizeRpcId(msg.id);
        const pending = typeof id === "number" ? this.pending.get(id) : undefined;
        if (pending) {
            this.pending.delete(id as number);
            clearTimeout(pending.timer);
            if (msg.error) pending.reject(new Error(mcpErrorMessage(msg.error)));
            else pending.resolve(msg.result);
        }
    }

    /**
     * Dispatch a server → client request (M-20): we implement no server-side
     * capabilities, so `roots/list` answers `{roots: []}`, `elicitation/create`
     * is routed through handleElicitation (Milestone 2.3), and everything
     * else gets -32601 MethodNotFound — a fake `result: null` made
     * well-behaved servers wait on (or crash on) a shape we never sent.
     * Stdio transport only; HTTP servers deliver these via the response
     * stream.
     */
    private replyToServerRequest(id: unknown, method: string, params?: unknown): void {
        let reply: unknown;
        if (method === "roots/list") {
            reply = { jsonrpc: "2.0" as const, id, result: { roots: [] } };
        } else if (method === "elicitation/create") {
            reply = this.handleElicitation(id, params);
        } else {
            reply = { jsonrpc: "2.0" as const, id, error: { code: -32601, message: `method not found: ${method}` } };
        }
        try {
            this.proc?.stdin?.write(JSON.stringify(reply) + "\n");
        } catch {
            /* server gone */
        }
    }

    /**
     * Build the JSON-RPC reply for an `elicitation/create` server→client
     * request (Milestone 2.3 — reverse-engineered from goose's `elicitation.rs`
     * + the MCP standard). The pure decision logic lives in
     * `./elicitation.ts:decideElicitation`; this method wraps its result in
     * the JSON-RPC envelope and attaches Unown's debugging `reason` field
     * to `decline` responses (the MCP standard's decline carries no content,
     * but surfacing the per-server `defaultReason` here makes headless
     * refusals visible in server logs).
     *
     * Response shape:
     *   accept  → { action: "accept",  content: ELICITATION_DEFAULT_DUMMY }
     *   decline → { action: "decline", content: { reason: <defaultReason> } }
     *   cancel  → { action: "cancel" }    // malformed request, no content
     */
    private handleElicitation(id: unknown, params: unknown): { jsonrpc: "2.0"; id: unknown; result: { action: string; content?: Record<string, unknown> } } {
        const request = (params ?? null) as ElicitationRequest;
        const decision = decideElicitation(request, this.elicitation);
        if (decision.action === "accept") {
            return { jsonrpc: "2.0", id, result: { action: "accept", content: decision.content } };
        }
        if (decision.action === "decline") {
            // Unown extension: attach the per-server defaultReason to the
            // decline envelope so a headless refusal is visible in the
            // server's logs. The pure decision returns no content for
            // decline (the MCP standard's shape); the transport layer
            // adds the debugging reason here.
            return { jsonrpc: "2.0", id, result: { action: "decline", content: { reason: this.elicitation.defaultReason } } };
        }
        return { jsonrpc: "2.0", id, result: { action: "cancel" } };
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
                const parsed = JSON.parse(data) as { id?: number | string };
                if (sameJsonRpcId(parsed.id, id)) return parsed;
            } catch {
                continue;
            }
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// HTTP retry/recovery helpers (M-04/M-06)
// ---------------------------------------------------------------------------

/** Statuses we retry with backoff: rate limit + overload family (audit M-04). */
const RETRYABLE_HTTP_STATUS = new Set([429, 502, 503]);
const HTTP_MAX_RETRIES = 2;
const RETRY_AFTER_MAX_MS = 30_000;

/** Internal marker so `httpRoundTrip` can detect 404 session loss. */
class McpHttpError extends Error {
    readonly status: number;
    readonly url: string;
    constructor(status: number, url: string) {
        super(`HTTP ${status} from ${url}`);
        this.status = status;
        this.url = url;
    }
}

/**
 * `Retry-After` as a wait in ms (seconds or HTTP-date form), capped at 30 s.
 * Without a usable header, fall back to short exponential backoff.
 */
export function retryAfterMs(header: string | null, attempt: number): number {
    if (header) {
        const seconds = Number(header);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.min(seconds * 1000, RETRY_AFTER_MAX_MS);
        }
        const date = Date.parse(header);
        if (!Number.isNaN(date)) {
            return Math.max(0, Math.min(date - Date.now(), RETRY_AFTER_MAX_MS));
        }
    }
    return Math.min(250 * 2 ** attempt, RETRY_AFTER_MAX_MS);
}

/** Rewrite fetch aborts into a timeout error that names the call and bound. */
export function rewriteAbortError(err: unknown, method: string, timeoutMs: number): Error {
    const name = (err as Error)?.name ?? "";
    const message = String((err as Error)?.message ?? "");
    if (name === "AbortError" || /abort/i.test(name) || /abort/i.test(message)) {
        return new Error(`MCP ${method} timed out after ${timeoutMs}ms`);
    }
    return err instanceof Error ? err : new Error(message);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** tools/list pagination stop (M-14: logging, not silent truncation). */
const TOOLS_LIST_MAX_PAGES = 20;

/**
 * Windows: spawn through cmd.exe so `npx`/`.cmd`/`.bat` shims resolve
 * without a shell. POSIX: direct spawn. Pure — exported for tests (and used
 * by lsp.ts so BOTH modules share one Windows-correct spec builder).
 *
 * H2 (M-08/L-05) — the old wrapper had three defects, all fixed here:
 *
 *   1. `.bat` was EXCLUDED from wrapping (exactly backwards — direct `.bat`
 *      spawn throws EINVAL on CVE-2024-27980-patched runtimes). Now only
 *      `.exe`/`.com` spawn directly; `.cmd`, `.bat` and extensionless
 *      commands (npm shims) go through `cmd.exe /d /s /c`.
 *   2. args were re-joined onto the cmd.exe line unescaped, so `& | ^ < > "`
 *      inside an arg (e.g. via a `${VAR}`-expanded value) became command
 *      separators — injection. Every arg is now cross-spawn-style escaped
 *      and quoted.
 *   3. `%` cannot be escaped AT ALL in cmd.exe context (variable expansion
 *      happens even inside double quotes) — args or a command containing
 *      `%` on the Windows path are REJECTED with an actionable error
 *      instead of executed. CR/LF/NUL anywhere is likewise rejected (line
 *      splitting = command splitting).
 */
export function stdioSpawnSpec(
    command: string,
    args: string[],
    env: Record<string, string>,
    cwd: string,
    opts: { platform?: string; expandWith?: Record<string, string | undefined> } = {},
): { command: string; args: string[]; env: Record<string, string>; cwd: string; verbatim: boolean } {
    const platform = opts.platform ?? process.platform;
    const expandSource = opts.expandWith ?? process.env;
    const expandedEnv = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, expandEnv(v, expandSource)]));
    const expandedCommand = expandEnv(command, expandSource);
    const expandedArgs = args.map((a) => expandEnv(a, expandSource));
    const parts: Array<[string, string]> = [["command", expandedCommand], ...expandedArgs.map((a, i) => [`args[${i}]`, a] as [string, string])];
    for (const [kind, value] of parts) {
        if (/[\r\n\0]/.test(value)) {
            throw new Error(`stdio ${kind} contains a line break — refused (command injection vector): ${JSON.stringify(value.slice(0, 80))}`);
        }
    }
    if (platform === "win32" && !/\.(exe|com)$/i.test(expandedCommand)) {
        // The COMMAND token must be a plain Windows path. `" & | < > ^` are
        // reserved/illegal in Windows filenames, so a command containing one
        // is broken or hostile config — refuse it outright instead of relying
        // on the quoting below (js/shell-command-injection-from-environment:
        // the command never legitimately carries a cmd.exe metacharacter).
        if (/["&|<>^]/.test(expandedCommand)) {
            throw new Error(
                `stdio command contains cmd.exe metacharacters — refused (command injection vector): ${JSON.stringify(expandedCommand.slice(0, 80))}`,
            );
        }
        for (const [kind, value] of parts) {
            if (value.includes("%")) {
                throw new Error(
                    `stdio ${kind} contains '%' — cmd.exe variable expansion cannot be escaped, refusing to spawn: ${JSON.stringify(value.slice(0, 80))}`,
                );
            }
        }
        const line = [escapeCmdArg(expandedCommand), ...expandedArgs.map(escapeCmdArg)].join(" ");
        // verbatim: the spawn MUST pass this /c line through untouched — the
        // default arg quoting re-escapes the embedded quotes (\"node\" …) and
        // cmd.exe then fails instantly (every live stdio test died in ~13ms
        // on the windows CI leg until windowsVerbatimArguments landed).
        // The /c payload is built as an explicit quote-wrapped concatenation
        // (the CodeQL-recognized shape for "the value cannot break out of
        // the quoting") — every token inside is itself escapeCmdArg-quoted.
        const cmdLine = '"' + line + '"';
        return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdLine], env: expandedEnv, cwd, verbatim: true };
    }
    return { command: expandedCommand, args: expandedArgs, env: expandedEnv, cwd, verbatim: false };
}

/**
 * One cmd.exe-safe token (cross-spawn's escape): double the backslashes
 * before a quote, escape the quote, and always wrap in double quotes so
 * cmd treats `& | ^ < >` inside the token as literals. (`%` is unescapable —
 * rejected upstream in stdioSpawnSpec instead.)
 */
function escapeCmdArg(arg: string): string {
    const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
    return `"${escaped}"`;
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
    /** Reconnect cooldown after a failed connect (default 30 s; M-11). */
    reconnectCooldownMs?: number;
    /** Ping keepalive (default on, 60 s interval; M-11). */
    keepalive?: boolean;
    pingIntervalMs?: number;
    /** Config-validation problems from resolution (H2 L-06/M-10 — surfaced in /mcp). */
    problems?: ConfigProblem[];
    /** Project servers withheld by the trust gate (H2 M-01 — status shows them as not-configured). */
    gatedServers?: Record<string, AnyServerConfig>;
    /** True when a project config exists but is untrusted (H2 M-01). */
    needsTrust?: boolean;
    /** The project config path (guidance + /mcp trust). */
    projectFile?: string | null;
    /** Verbose log sink for cap notices (extension wires its stderr log). */
    onLog?: (message: string) => void;
}

export interface McpServerStatus {
    name: string;
    transport: "stdio" | "http";
    state: ConnectionState | "not-configured";
    detail: string;
    tools: number;
    /** Last connect/spawn failure timestamp (ms epoch), when known. */
    lastFailedAt?: number;
}

/** Per-session MCP manager: lazy connects, tool cache, dispatch. */
export class McpManager {
    readonly cwd: string;
    private config: McpConfig;
    private readonly env: Record<string, string | undefined>;
    readonly requestTimeoutMs: number;
    readonly connectTimeoutMs: number;
    readonly reconnectCooldownMs: number;
    readonly keepaliveEnabled: boolean;
    readonly pingIntervalMs: number;
    /** Config-validation problems (actionable, from resolveMcpConfig). */
    readonly problems: ConfigProblem[];
    /** Project servers withheld by the trust gate. */
    private gatedServers: Record<string, AnyServerConfig>;
    /** Project config present but untrusted. */
    private needsTrust: boolean;
    /** The project config path (null when none exists). */
    private projectFile: string | null;
    /** Verbose log sink (cap notices, pagination stops). */
    private readonly onLog: ((message: string) => void) | null;
    private connections = new Map<string, McpConnection>();
    private toolsByServer = new Map<string, McpToolInfo[]>();
    private connecting = new Map<string, Promise<McpConnection | null>>();
    /** Per-server last failure (connect failure or mid-session exit). */
    private lastFailedAt = new Map<string, number>();
    private keepalives = new Map<string, ReturnType<typeof setInterval>>();

    constructor(opts: McpManagerOptions) {
        this.cwd = opts.cwd;
        this.config = opts.config ?? { servers: {} };
        this.env = opts.env ?? process.env;
        this.requestTimeoutMs = opts.requestTimeoutMs ?? parseMsEnv("UNOWN_MCP_TIMEOUT_MS", 120_000, this.env);
        this.connectTimeoutMs = opts.connectTimeoutMs ?? parseMsEnv("UNOWN_MCP_CONNECT_TIMEOUT_MS", 20_000, this.env);
        this.reconnectCooldownMs = opts.reconnectCooldownMs ?? parseMsEnv("UNOWN_MCP_RECONNECT_COOLDOWN_MS", 30_000, this.env);
        this.pingIntervalMs = opts.pingIntervalMs ?? parseMsEnv("UNOWN_MCP_PING_INTERVAL_MS", 60_000, this.env);
        this.keepaliveEnabled = opts.keepalive ?? this.env.UNOWN_MCP_KEEPALIVE !== "0";
        this.problems = opts.problems ?? [];
        this.gatedServers = opts.gatedServers ?? {};
        this.needsTrust = opts.needsTrust ?? false;
        this.projectFile = opts.projectFile ?? null;
        this.onLog = opts.onLog ?? null;
    }

    /** True when the project config is gated by the trust gate (refuse-first). */
    get projectNeedsTrust(): boolean {
        return this.needsTrust;
    }

    /** Number of servers withheld by the trust gate. */
    get gatedServerCount(): number {
        return Object.keys(this.gatedServers).length;
    }

    /** The gated project config path, when any (for /mcp trust + guidance). */
    get projectConfigFile(): string | null {
        return this.projectFile;
    }

    /**
     * Swap the config after `/mcp trust` re-resolves with the project file
     * included. Existing connections stay live (their closures read
     * `this.config` at call time); the newly-admitted servers connect lazily.
     */
    reload(config: McpConfig, extra?: { problems?: ConfigProblem[]; gatedServers?: Record<string, AnyServerConfig>; needsTrust?: boolean; projectFile?: string | null }): void {
        this.config = config;
        if (extra?.problems) {
            this.problems.length = 0;
            this.problems.push(...extra.problems);
        }
        if (extra?.gatedServers) this.gatedServers = extra.gatedServers;
        if (extra?.needsTrust !== undefined) this.needsTrust = extra.needsTrust;
        if (extra?.projectFile !== undefined) this.projectFile = extra.projectFile;
    }

    get disabled(): boolean {
        return this.config.disabled === true || this.env.UNOWN_MCP === "0";
    }

    serverNames(): string[] {
        return Object.keys(this.config.servers);
    }

    /**
     * The raw config for a server (or undefined when not configured).
     * Milestone 2.3: exposes the per-server `elicitation` policy block to
     * the `/mcp elicitation <server>` subcommand.
     */
    serverConfig(name: string): AnyServerConfig | undefined {
        return this.config.servers[name];
    }

    /**
     * Connect (or return the live connection). Single-flight per server.
     *
     * Failure cooldown (M-11): a server that failed within
     * `reconnectCooldownMs` is skipped — every `mcp__gone__*` call used to
     * re-pay a cold spawn (npx ≈ 20 s connect budget each time). `force`
     * (/mcp reconnect) pushes through the cooldown deliberately. When a
     * connection is replaced, the old one is disposed first (M-21: kill the
     * child, drop its listeners) instead of being overwritten alive.
     */
    async connect(server: string, opts?: { force?: boolean }): Promise<McpConnection | null> {
        const cfg = this.config.servers[server];
        if (!cfg) return null;
        const existing = this.connections.get(server);
        if (existing?.running && existing.state === "connected") return existing;
        const inFlight = this.connecting.get(server);
        if (inFlight) return inFlight;
        if (!opts?.force) {
            const failedAt = this.lastFailedAt.get(server);
            if (failedAt !== undefined && Date.now() - failedAt < this.reconnectCooldownMs) return null;
        }
        const conn = new McpConnection(server, cfg, this.cwd, this.requestTimeoutMs, this.connectTimeoutMs, this.env);
        conn.onLog = (message) => this.onLog?.(message);
        conn.onNotification = (method) => {
            if (method === "notifications/tools/list_changed") {
                // refresh lazily on next list
                this.toolsByServer.delete(server);
            }
        };
        conn.onExit = () => {
            // Mid-session death: remember it so reconnects obey the cooldown
            // (no respawn storm) and stop this server's keepalive.
            this.lastFailedAt.set(server, Date.now());
            this.stopKeepalive(server);
        };
        if (existing) existing.dispose(); // replaced, not orphaned
        this.connections.set(server, conn);
        const promise = (async () => {
            try {
                await conn.start(this.connectTimeoutMs);
                this.toolsByServer.set(server, await conn.listTools());
                this.startKeepalive(server);
                return conn;
            } catch {
                this.lastFailedAt.set(server, Date.now());
                return null;
            } finally {
                this.connecting.delete(server);
            }
        })();
        this.connecting.set(server, promise);
        return promise;
    }

    /** Connect every configured server; returns the ones that came up. */
    async connectAll(force = false): Promise<string[]> {
        const ok: string[] = [];
        await Promise.all(
            this.serverNames().map(async (name) => {
                const conn = await this.connect(name, { force });
                if (conn) ok.push(name);
            }),
        );
        return ok;
    }

    /**
     * Ping keepalive (M-11): ON by default — a 60 s `ping` request is one
     * tiny JSON line (stdio) or one POST (HTTP) and catches zombie stdio
     * processes and silently-expired HTTP sessions long before the user's
     * next tool call would hang. Skips busy connections (a server deep in a
     * long tool call may legitimately miss a ping — that is not a death).
     * Disable with UNOWN_MCP_KEEPALIVE=0. Timers are unref'd so they never
     * hold the process open.
     */
    private startKeepalive(server: string): void {
        if (!this.keepaliveEnabled) return;
        this.stopKeepalive(server);
        const timer = setInterval(() => {
            void this.pingServer(server);
        }, this.pingIntervalMs);
        timer.unref?.();
        this.keepalives.set(server, timer);
    }

    private stopKeepalive(server: string): void {
        const timer = this.keepalives.get(server);
        if (timer) {
            clearInterval(timer);
            this.keepalives.delete(server);
        }
    }

    private async pingServer(server: string): Promise<void> {
        const conn = this.connections.get(server);
        if (!conn || !conn.running || conn.state !== "connected") {
            this.stopKeepalive(server);
            return;
        }
        if (conn.pendingCount > 0) return; // busy ≠ dead
        const alive = await conn.ping(10_000);
        if (alive) return;
        conn.markLost("keepalive ping timed out");
        this.lastFailedAt.set(server, Date.now());
        this.stopKeepalive(server);
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
            const lastFailedAt = this.lastFailedAt.get(name);
            if (!conn) {
                out.push({
                    name,
                    transport,
                    state: "idle",
                    detail: isHttpConfig(cfg) ? cfg.url : cfg.command,
                    tools: 0,
                    lastFailedAt,
                });
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
                    lastFailedAt,
                });
            }
        }
        // Gated project servers (H2 M-01): visible but never spawned until
        // approved — "needs approval" instead of silence.
        for (const [name, cfg] of Object.entries(this.gatedServers)) {
            out.push({
                name,
                transport: isHttpConfig(cfg) ? "http" : "stdio",
                state: "not-configured",
                detail: isHttpConfig(cfg) ? cfg.url : cfg.command,
                tools: 0,
            });
        }
        return out;
    }

    disposeAll(): void {
        for (const conn of this.connections.values()) conn.dispose();
        this.connections.clear();
        this.toolsByServer.clear();
        for (const server of [...this.keepalives.keys()]) this.stopKeepalive(server);
        this.lastFailedAt.clear();
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

/** Only object-shaped JSON Schemas pass through; everything else becomes a
 * permissive object. Serialized schemas over 32 KB (M-16 — hostile prompt
 * bloat) also fall back to the permissive wrap. */
export function normalizeInputSchema(schema: unknown): unknown {
    if (
        typeof schema === "object" &&
        schema !== null &&
        (schema as { type?: unknown }).type === "object" &&
        typeof (schema as { properties?: unknown }).properties === "object"
    ) {
        try {
            if (JSON.stringify(schema).length <= MAX_SERIALIZED_SCHEMA_CHARS) return schema;
        } catch {
            /* circular/unserializable — use the permissive wrap */
        }
    }
    return Type.Object({}, { additionalProperties: true });
}

/** Cap for a tool's serialized inputSchema (M-16). */
const MAX_SERIALIZED_SCHEMA_CHARS = 32 * 1024;

export function capDescription(description: string | undefined, max = 500): string {
    const text = (description ?? "").replace(/\s+/g, " ").trim();
    if (!text) return "MCP tool (no description provided by the server).";
    // M-14: truncation is visible, never silent.
    return text.length > max ? text.slice(0, max - 13) + "… (truncated)" : text;
}

/** Render the /mcp status listing (config problems + trust guidance when
 * present — H2 L-06/M-01). */
export function renderMcpStatus(statuses: McpServerStatus[], problems: ConfigProblem[] = [], needsTrust = false): string {
    if (statuses.length === 0 && problems.length === 0 && !needsTrust) {
        return "No MCP servers configured. Add them to .unown/mcp.json (project) or ~/.unown/agent/mcp.json (user):\n" +
            '{ "mcpServers": { "example": { "command": "npx", "args": ["-y", "@example/mcp-server"] } } }\n' +
            'HTTP servers: { "mcpServers": { "remote": { "url": "https://example.com/mcp" } } }\n' +
            "Tools appear as mcp__<server>__<tool> once the server connects.";
    }
    const lines = statuses.map((s) => {
        const mark = s.state === "connected" ? "●" : s.state === "error" ? "✗" : "○";
        const suffix =
            s.state === "not-configured"
                ? " — untrusted project mcp.json: run /mcp trust (or set UNOWN_TRUST_PROJECT_CONFIG=1)"
                : ` — ${s.detail}`;
        return `${mark} ${s.name} [${s.transport}] ${s.state}${s.tools ? `, ${s.tools} tool(s)` : ""}${suffix}`;
    });
    const parts = [`MCP servers:\n${lines.join("\n")}`];
    if (needsTrust) {
        parts.push("⚠ a project .unown/mcp.json is UNTRUSTED — its servers are withheld until approved. Run /mcp trust, or set UNOWN_TRUST_PROJECT_CONFIG=1 (CI/headless bypass).");
    }
    if (problems.length > 0) {
        parts.push(`Config problems:\n${problems.map((p) => `  ${formatConfigProblem(p)}`).join("\n")}`);
    }
    parts.push("Tools are named mcp__<server>__<tool>; /mcp reconnects failed servers; /mcp trust approves a project mcp.json.");
    return parts.join("\n");
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
 * and exposes `/mcp` (status + reconnect) and `/mcp trust` (approves the
 * project-scoped .unown/mcp.json the trust gate is withholding).
 *
 * H1 lifecycle hardening: the `registered` guard Set is SESSION-scoped (it
 * lives inside factory(), keyed to one pi instance). At extension scope it
 * survived across factory() invocations — cli.ts registers the same
 * extension object into every session runtime, so the second session in
 * one process got zero mcp__* tools (M-12). Every async seam is guarded:
 * an unhandled rejection from `pi.registerTool` used to kill the whole Bun
 * process (M-03).
 *
 * H2 trust gate (M-01): resolveMcpConfig withholds an untrusted project
 * config's servers entirely (REFUSE-FIRST — they are never spawned), and
 * `/mcp trust` records the file's fingerprint (config-trust.ts), reloads
 * the config, and connects the newly-admitted servers.
 */
/** Module-level reference to the most recently created LIVE manager —
 *  lets sibling extensions (termhooks' user-hook `mcp` handlers) reach the
 *  session's connected servers instead of spawning a second MCP client.
 *  One manager per unown process; subagent children are separate processes
 *  with their own. Cleared nowhere: a dead manager's callTool already
 *  errors into the handler's fail-open path. */
let activeManagerRef: McpManager | null = null;

/** The live interactive MCP manager for this process, when one exists. */
export function getActiveMcpManager(): McpManager | null {
        return activeManagerRef;
}

export function createMcpExtension(opts: McpOptions) {
    const verbose = opts.verbose ?? false;
    const log = (msg: string) => {
        if (verbose) console.error(`[unown-mcp] ${msg}`);
    };

    let manager: McpManager | null = null;

    /**
     * Footer status line (P1-b): pi's `ctx.ui.setStatus(key, text)` seam —
     * the interactive footer renders one joined, width-truncated row from
     * all extension statuses (pass undefined to clear the key). Guarded on
     * every call: the UI shape varies across pi modes/builds, so a missing
     * or throwing setStatus degrades to no status line — never a crash.
     */
    const setStatusLine = (ctx: any, key: string, text: string | undefined): void => {
        try {
            if (!ctx?.hasUI || typeof ctx.ui?.setStatus !== "function") return;
            ctx.ui.setStatus(key, text);
        } catch {
            /* the footer is cosmetic — degrade silently */
        }
    };

    /**
     * The one-line integration health summary: "mcp: 3/3 · 14 tools", with
     * failure/withheld counts appended when not everything is up, and
     * "mcp: N withheld (untrusted)" when the trust gate is withholding every
     * configured server. Undefined = nothing worth a footer line (R-c §3
     * budget discipline: ~40 chars, one key, no animation).
     */
    const mcpFooterText = (m: McpManager): string | undefined => {
        const statuses = m.status();
        const live = statuses.filter((s) => s.state !== "not-configured");
        const gated = statuses.length - live.length;
        if (live.length === 0) return gated > 0 ? `mcp: ${gated} withheld (untrusted)` : undefined;
        const connected = live.filter((s) => s.state === "connected");
        const tools = connected.reduce((n, s) => n + s.tools, 0);
        const failed = live.length - connected.length;
        let text = `mcp: ${connected.length}/${live.length}`;
        if (tools > 0) text += ` · ${tools} tool${tools === 1 ? "" : "s"}`;
        if (failed > 0) text += ` · ${failed} ✗`;
        if (gated > 0) text += ` · ${gated} withheld`;
        return text;
    };

    const getManager = (): McpManager => {
        if (!manager) {
            // No TUI prompt exists at module level, so an untrusted project
            // config is never loaded or executed — the status surfaces the
            // approval action instead (refuse-first).
            const resolved = opts.config
                ? { config: opts.config, problems: [] as ConfigProblem[], projectFile: null, needsTrust: false, gatedServers: {} }
                : resolveMcpConfig(opts.cwd);
            // Milestone 2.2 — per-subagent MCP server whitelist. When
            // UNOWN_MCP_SERVERS is set (cli.ts:applySubagentEnvOverrides sets
            // it from the parsed --mcp-servers flag), filter the merged
            // config to only the listed server names. Empty string means
            // "load none" (the background-explore subagent sets []). Unset
            // means "load all" (the legacy behavior). The whitelist is
            // applied to the merged config AFTER the trust gate so untrusted
            // project servers are still withheld.
            const whitelistRaw = process.env.UNOWN_MCP_SERVERS;
            let config = resolved.config;
            if (whitelistRaw !== undefined) {
                const allowed = new Set(
                    whitelistRaw
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                );
                const filtered: Record<string, AnyServerConfig> = {};
                for (const [name, cfg] of Object.entries(resolved.config.servers)) {
                    if (allowed.has(name)) filtered[name] = cfg;
                }
                config = { ...resolved.config, servers: filtered };
                if (verbose) {
                    const total = Object.keys(resolved.config.servers).length;
                    const kept = Object.keys(filtered).length;
                    log(`mcp whitelist UNOWN_MCP_SERVERS=${JSON.stringify(whitelistRaw)} → ${kept}/${total} server(s) loaded`);
                }
            }
            manager = new McpManager({
                cwd: opts.cwd,
                config,
                problems: resolved.problems,
                gatedServers: resolved.gatedServers,
                needsTrust: resolved.needsTrust,
                projectFile: resolved.projectFile,
                onLog: (message) => log(message),
            });
            activeManagerRef = manager;
            if (resolved.needsTrust) {
                log(`project mcp.json is untrusted — ${Object.keys(resolved.gatedServers).length} server(s) withheld; run /mcp trust`);
            }
            for (const p of resolved.problems) log(formatConfigProblem(p));
        }
        return manager;
    };

    const registerServerTools = (pi: any, server: string, registered: Set<string>): number => {
        const m = getManager();
        const all = m.toolsFor(server);
        if (all.length > TOOLS_PER_SERVER_CAP) {
            // M-14: the per-server tool cap used to slice silently.
            log(`server "${server}" exposes ${all.length} tools — registering the first ${TOOLS_PER_SERVER_CAP}`);
        }
        const tools = all.slice(0, TOOLS_PER_SERVER_CAP);
        let count = 0;
        for (const tool of tools) {
            let name = mcpToolName(server, tool.name);
            if (registered.has(name)) {
                // M-14: two server tools can sanitize to the same name — the
                // second used to be silently skipped. Disambiguate instead.
                let n = 2;
                let candidate: string;
                do {
                    const suffix = `_${n}`;
                    candidate = `${name.slice(0, 64 - suffix.length)}${suffix}`;
                    n++;
                } while (registered.has(candidate));
                name = candidate;
                log(`tool name collision: "${server}/${tool.name}" registered as ${name}`);
            }
            registered.add(name);
            count++;
            const label = `${server}/${tool.name}`;
            const description = capDescription(tool.description) + ` (MCP server: ${server})`;
            try {
                pi.registerTool({
                    name,
                    label,
                    description,
                    parameters: normalizeInputSchema(tool.inputSchema) as any,
                    async execute(_toolCallId: string, params: Record<string, unknown>) {
                        const result = await m.callTool(server, tool.name, params ?? {});
                        return {
                            // Injection shield: MCP tool output is live hostile-content
                            // surface (a poisoned or hijacked server addressing the
                            // reading agent). This execute() wrapper is the ONE choke
                            // point every mcp__ tool result flows through — annotate
                            // here and every server is covered. Fail-open by contract.
                            content: [
                                {
                                    type: "text",
                                    text: annotateToolOutput(result.text, `mcp:${server}/${tool.name}`, {
                                        onFlag: (info) => {
                                            log(`injection shield flagged ${info.source}: ${info.flags.join(", ")}`);
                                            recordShieldFlag(pi, info);
                                        },
                                    }),
                                },
                            ],
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
            } catch (err: any) {
                // One hostile/duplicate tool must not block the rest (M-03).
                registered.delete(name);
                count--;
                log(`tool ${name} registration failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        if (count > 0) log(`registered ${count} tool(s) from ${server}`);
        return count;
    };

    const factory = (pi: any) => {
        // Per-session registration state — see the extension doc comment.
        const registered = new Set<string>();

        pi.on("session_start", (_event: any, ctx: any) => {
            try {
                const m = getManager();
                if (m.serverNames().length === 0) {
                    // Refuse-first visibility: nothing connectable, but an
                    // untrusted project config's withheld servers deserve one
                    // footer line instead of silence.
                    if (!m.disabled && m.gatedServerCount > 0) {
                        setStatusLine(ctx, "mcp", mcpFooterText(m));
                    }
                    return;
                }
                if (m.disabled) return;
                log(`connecting ${m.serverNames().length} MCP server(s) in the background`);
                void (async () => {
                    try {
                        const okServers = await m.connectAll();
                        for (const server of okServers) registerServerTools(pi, server, registered);
                        setStatusLine(ctx, "mcp", mcpFooterText(m));
                    } catch (err: any) {
                        log(`background connect failed: ${err instanceof Error ? err.message : String(err)}`);
                    }
                })();
            } catch (err: any) {
                log(`session_start connect failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        });

        pi.registerCommand("mcp", {
            description: "MCP server status + reconnect: /mcp — /mcp trust approves a project .unown/mcp.json — /mcp elicitation <server> shows the elicitation policy",
            handler: async (args: string, ctx: any) => {
                try {
                    const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
                    const sub = (parts[0] ?? "").toLowerCase();
                    const m = getManager();
                    if (m.disabled) {
                        ctx.ui.notify("MCP support is disabled (UNOWN_MCP=0 or disabled in mcp.json).", "info");
                        return;
                    }
                    if (sub === "trust") {
                        // /mcp trust: approve the project mcp.json the gate is
                        // withholding, reload, and connect its servers.
                        if (opts.config) {
                            ctx.ui.notify("Config was injected programmatically — there is no project file to trust.", "info");
                            return;
                        }
                        const projectFile = join(opts.cwd, ".unown", "mcp.json");
                        if (!existsSync(projectFile)) {
                            ctx.ui.notify("No project .unown/mcp.json found — nothing to trust.", "info");
                            return;
                        }
                        if (trustBypassed()) {
                            ctx.ui.notify("UNOWN_TRUST_PROJECT_CONFIG is set — the trust gate is already bypassed.", "info");
                            return;
                        }
                        const ok = trustConfig(projectFile, { statePath: trustStatePath() });
                        if (!ok) {
                            ctx.ui.notify(`Trusting ${projectFile} failed (unreadable file or unwritable trust state).`, "error");
                            return;
                        }
                        log(`trusted ${projectFile}`);
                        const resolved = resolveMcpConfig(opts.cwd);
                        m.reload(resolved.config, {
                            problems: resolved.problems,
                            gatedServers: resolved.gatedServers,
                            needsTrust: resolved.needsTrust,
                            projectFile: resolved.projectFile,
                        });
                        ctx.ui.notify(`Trusted ${projectFile} — connecting its servers…`, "info");
                        const before = m.status().filter((s) => s.state === "connected").map((s) => s.name);
                        const okServers = await m.connectAll(true);
                        for (const server of okServers) registerServerTools(pi, server, registered);
                        setStatusLine(ctx, "mcp", mcpFooterText(m));
                        ctx.ui.notify(renderMcpStatus(m.status(), m.problems, m.projectNeedsTrust), "info");
                        const newly = okServers.filter((s) => !before.includes(s));
                        if (newly.length > 0) {
                            const toolCount = newly.reduce((n, s) => n + m.toolsFor(s).length, 0);
                            ctx.ui.notify(`Connected ${newly.join(", ")} — ${toolCount} tool(s) registered as mcp__<server>__<tool>.`, "info");
                        }
                        return;
                    }
                    if (sub === "elicitation") {
                        // /mcp elicitation <server>: show the per-server
                        // elicitation policy (Milestone 2.3). Headless agents
                        // default to autoDecline; autoAccept must be opt-in
                        // per server in .unown/mcp.json.
                        const name = parts[1] ?? "";
                        if (!name) {
                            const lines = m.serverNames().map((n) => {
                                const cfg = m.serverConfig(n);
                                const e = resolveElicitationConfig(cfg);
                                return `  ${n}: autoAccept=${e.autoAccept} autoDecline=${e.autoDecline} reason=${JSON.stringify(e.defaultReason)}`;
                            });
                            ctx.ui.notify(
                                lines.length > 0
                                    ? `Elicitation policies:\n${lines.join("\n")}`
                                    : "No MCP servers configured. Set `elicitation` per server in .unown/mcp.json.",
                                "info",
                            );
                            return;
                        }
                        const cfg = m.serverConfig(name);
                        if (!cfg) {
                            ctx.ui.notify(`MCP server "${name}" is not configured. Add it to .unown/mcp.json under mcpServers, or check the spelling.`, "info");
                            return;
                        }
                        const e = resolveElicitationConfig(cfg);
                        ctx.ui.notify(
                            `Elicitation policy for "${name}":\n  autoAccept: ${e.autoAccept}\n  autoDecline: ${e.autoDecline}\n  defaultReason: ${JSON.stringify(e.defaultReason)}\n\n` +
                                `Set under .unown/mcp.json → mcpServers.${name}.elicitation = { autoAccept, autoDecline, defaultReason }.`,
                            "info",
                        );
                        return;
                    }
                    if (sub !== "") {
                        ctx.ui.notify(`Unknown /mcp argument "${sub}". Usage: /mcp [trust | elicitation [server]]`, "info");
                        return;
                    }
                    if (m.serverNames().length === 0 && m.gatedServerCount === 0 && m.problems.length === 0) {
                        ctx.ui.notify(renderMcpStatus([]), "info");
                        return;
                    }
                    // /mcp doubles as a manual reconnect: retry every server,
                    // forcing through the failure cooldown.
                    const before = m.status().filter((s) => s.state === "connected").map((s) => s.name);
                    ctx.ui.notify("Connecting MCP servers…", "info");
                    const okServers = await m.connectAll(true);
                    for (const server of okServers) registerServerTools(pi, server, registered);
                    setStatusLine(ctx, "mcp", mcpFooterText(m));
                    const statuses = m.status();
                    ctx.ui.notify(renderMcpStatus(statuses, m.problems, m.projectNeedsTrust), "info");
                    const newly = okServers.filter((s) => !before.includes(s));
                    if (newly.length > 0) {
                        const toolCount = newly.reduce((n, s) => n + m.toolsFor(s).length, 0);
                        ctx.ui.notify(`Connected ${newly.join(", ")} — ${toolCount} tool(s) registered as mcp__<server>__<tool>.`, "info");
                    }
                } catch (err: any) {
                    ctx.ui.notify(`MCP command failed: ${err instanceof Error ? err.message : String(err)}`, "error");
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
