/**
 * mcp-cli.ts — `unown mcp` subcommands: Claude Code-style MCP config
 * management (P1 productization, research R-c §2/§4) so users never
 * hand-edit JSON.
 *
 * Two config files, the same ones mcp.ts loads at session boot:
 *   user:     <userDir>/mcp.json            (~/.unown/agent/mcp.json — always trusted)
 *   project:  <cwd>/.unown/mcp.json         (trust-gated per config-trust.ts)
 *
 * Grammar (Claude Code-inspired):
 *   unown mcp add <name> <command> [args...] [--scope user|project]
 *                 [--env KEY=VAL]... [--cwd <dir>]
 *                 stdio server; server args that look like unown flags go
 *                 after a `--` separator (passthrough)
 *   unown mcp add-http <name> <url> [--header 'Name: Value']... [--scope user|project]
 *   unown mcp add-json <name> '<json>' [--scope user|project]
 *   unown mcp list
 *   unown mcp get <name>
 *   unown mcp remove <name> [--scope user|project]
 *   unown mcp test <name>
 *
 * Safety properties:
 *   - every written entry is validated through mcp.ts's OWN config
 *     normalizer (loadMcpConfigFile on a temp file), so `add-json` rejects
 *     invalid shapes with the exact messages sessions report;
 *   - writes are read-modify-write via atomicWriteFileSync (tmp + fsync +
 *     rename) and NEVER clobber: a file that fails to parse is refused, other
 *     servers and unknown top-level keys are preserved, an existing
 *     same-scope name is refused;
 *   - `${VAR}` values are stored literally (expansion happens at session
 *     load, expandEnv in mcp.ts) — a key written as --env T=${SECRET} keeps
 *     the placeholder;
 *   - AUTO-TRUST after a project-scope write: the user typed the command
 *     interactively, which is explicit intent of the same strength as the
 *     in-session `/mcp trust` approval — so `add --scope project` calls
 *     trustConfig right after the write and says so. The fingerprint pins
 *     THIS write's bytes: a later hand-edit re-arms the gate (by design —
 *     that is the cloned-repo RCE protection). `remove` from an
 *     already-trusted project file re-trusts the new content (same
 *     reasoning); removing from an UNTRUSTED file leaves it untrusted.
 *
 * Purity: fs + the existing mcp.ts/config-trust.ts exports only — no pi
 * imports, fully unit-testable. runMcpCommand takes explicit paths
 * ({cwd, userDir}) like the rest of the codebase, so tests (and any
 * redirected UNOWN_HOME) get isolated state.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomic.ts";
import { trustApprovalNeeded, trustConfig, trustStatePath, type TrustOptions } from "./config-trust.ts";
import {
    formatConfigProblem,
    isHttpConfig,
    loadMcpConfigFile,
    McpManager,
    resolveMcpConfig,
    type AnyServerConfig,
    type ConfigProblem,
} from "./mcp.ts";

/** Server names: lowercase letters, digits, `_`, `-` (tool names derive as
 * `mcp__<name>__<tool>` via mcpToolName — kept 1–64 chars, no spaces). */
const NAME_RE = /^[a-z0-9_-]{1,64}$/;

const SUBCOMMANDS = ["add", "add-http", "add-json", "list", "get", "remove", "test"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const USAGE_LINE = "usage: unown mcp <add|add-http|add-json|list|get|remove|test> — full grammar: unown help mcp";

export const MCP_HELP = `unown mcp — manage MCP server configs (Claude Code-style)

Manages the two files unown loads MCP servers from:
  user:     <agent dir>/mcp.json        (~/.unown/agent/mcp.json — always trusted)
  project:  .unown/mcp.json in the cwd  (trust-gated; a project-scope add
            approves the exact content it just wrote — a later hand-edit
            re-arms the gate)

usage:
  unown mcp add <name> <command> [args...] [--scope user|project]
                 [--env KEY=VAL]... [--cwd <dir>]
                 stdio server; put server args that look like unown flags
                 after a \`--\` separator (they pass through literally)
  unown mcp add-http <name> <url> [--header 'Name: Value']... [--scope user|project]
                 streamable-HTTP server (http/https URLs only)
  unown mcp add-json <name> '<json>' [--scope user|project]
                 paste a full server object ({command,args,env,cwd} or
                 {url,headers}); validated with the same rules sessions use
  unown mcp list   configured servers, both scopes (offline — no connecting)
  unown mcp get <name>   the stored entry JSON + which file it comes from
  unown mcp remove <name> [--scope user|project]
  unown mcp test <name>  live connect probe (initialize + tools/list)

server names match ^[a-z0-9_-]{1,64}$ (session tools appear as mcp__<name>__<tool>)
\${VAR} placeholders in env values / urls stay literal in the file and expand
at session load (unknown vars stay literal — see docs/usage.md)
`;

/** Explicit paths for testability — mirrors the rest of the codebase. */
export interface McpCliContext {
    /** Project directory (the project scope is <cwd>/.unown/mcp.json). */
    cwd: string;
    /** User agent dir (the user scope is <userDir>/mcp.json; trust state lives next to it). */
    userDir: string;
    /** Env override (default process.env) — ${VAR} expansion + the trust bypass read from it. */
    env?: Record<string, string | undefined>;
}

export interface McpCliResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

// ---------------------------------------------------------------------------
// Config-file helpers (pure fs, shared by add/remove/get)
// ---------------------------------------------------------------------------

/** Parse a config file into a mutable root object; missing file → `{}`.
 * NEVER crashes on a bad file: unparseable/wrong-shaped content is an error
 * the callers surface (writes are refused, not clobbered). */
function readConfigRoot(file: string): { root: Record<string, unknown> } | { error: string } {
    if (!existsSync(file)) return { root: {} };
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
        return {
            error: `${file} is not valid JSON — refusing to rewrite it (fix or remove the file, then re-run): ${(err as Error).message}`,
        };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { error: `${file} is not a JSON object — refusing to rewrite it` };
    }
    return { root: parsed as Record<string, unknown> };
}

/** The `mcpServers` map of a root, creating it when absent. */
function serversMap(root: Record<string, unknown>, file: string): { servers: Record<string, unknown> } | { error: string } {
    if (root.mcpServers === undefined) {
        const servers: Record<string, unknown> = {};
        root.mcpServers = servers;
        return { servers };
    }
    if (typeof root.mcpServers === "object" && root.mcpServers !== null && !Array.isArray(root.mcpServers)) {
        return { servers: root.mcpServers as Record<string, unknown> };
    }
    return { error: `${file}: "mcpServers" must be an object of server entries — refusing to rewrite it` };
}

/** Does `name` exist in `file`? False on missing/unreadable files. */
function hasServer(file: string, name: string): boolean {
    const read = readConfigRoot(file);
    if ("error" in read) return false;
    const sm = serversMap(read.root, file);
    if ("error" in sm) return false;
    return Object.prototype.hasOwnProperty.call(sm.servers, name);
}

/** Insert `name` → `entry` (refusing duplicates and unreadable roots) and
 * atomically rewrite the file, preserving every other key. */
function upsertServer(file: string, name: string, entry: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
    const read = readConfigRoot(file);
    if ("error" in read) return { ok: false, error: read.error };
    const sm = serversMap(read.root, file);
    if ("error" in sm) return { ok: false, error: sm.error };
    if (Object.prototype.hasOwnProperty.call(sm.servers, name)) {
        return {
            ok: false,
            error: `"${name}" already exists in ${file} — remove it first (unown mcp remove ${name}) or pick another name`,
        };
    }
    sm.servers[name] = entry;
    atomicWriteFileSync(file, `${JSON.stringify(read.root, null, 2)}\n`);
    return { ok: true };
}

/** Delete `name` (keeping the file and every other key). */
function removeServer(file: string, name: string): { ok: true } | { ok: false; error: string } {
    const read = readConfigRoot(file);
    if ("error" in read) return { ok: false, error: read.error };
    const sm = serversMap(read.root, file);
    if ("error" in sm) return { ok: false, error: sm.error };
    if (!Object.prototype.hasOwnProperty.call(sm.servers, name)) {
        return { ok: false, error: `no server "${name}" in ${file}` };
    }
    delete sm.servers[name];
    atomicWriteFileSync(file, `${JSON.stringify(read.root, null, 2)}\n`);
    return { ok: true };
}

/**
 * Validate a candidate entry with mcp.ts's OWN normalizer (same messages the
 * session reports): round-trip `{mcpServers: {name: entry}}` through
 * loadMcpConfigFile on a throwaway file. The RAW entry is what gets written
 * (never the normalized form — normalization expands `${VAR}`, and the file
 * must keep placeholders literal).
 */
function validateEntry(
    name: string,
    entry: Record<string, unknown>,
    env: Record<string, string | undefined>,
): { ok: true } | { ok: false; problem: string } {
    const dir = mkdtempSync(join(tmpdir(), "unown-mcp-validate-"));
    try {
        const file = join(dir, "mcp.json");
        writeFileSync(file, JSON.stringify({ mcpServers: { [name]: entry } }));
        const { config, problems } = loadMcpConfigFile(file, env);
        if (problems.length > 0) {
            return {
                ok: false,
                problem: `${formatConfigProblem(problems[0])}${problems.length > 1 ? ` (+${problems.length - 1} more problem(s))` : ""}`,
            };
        }
        if (!config || !config.servers[name]) return { ok: false, problem: "entry rejected by the config validator" };
        return { ok: true };
    } finally {
        try {
            rmSync(dir, { recursive: true, force: true });
        } catch {
            /* best effort — /tmp is janitor-swept */
        }
    }
}

// ---------------------------------------------------------------------------
// Small render helpers
// ---------------------------------------------------------------------------

function describeEntry(entry: Record<string, unknown>): "stdio" | "http" {
    return isHttpConfig(entry as AnyServerConfig) ? "http" : "stdio";
}

function serverTarget(cfg: AnyServerConfig): string {
    if (isHttpConfig(cfg)) return cfg.url;
    return [cfg.command, ...(cfg.args ?? [])].join(" ");
}

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

/** `--scope user|project` value guard. */
function parseScope(value: string | undefined): { scope: "user" | "project" } | { error: string } {
    if (value === "user" || value === "project") return { scope: value };
    return { error: `--scope expects user or project (got ${JSON.stringify(value ?? "")})` };
}

/** `--env KEY=VAL` — the value keeps `=` signs and `${VAR}` placeholders. */
function parseEnvPair(raw: string): { key: string; value: string } | { error: string } {
    const eq = raw.indexOf("=");
    if (eq < 1) return { error: `--env expects KEY=VAL (got ${JSON.stringify(raw)})` };
    const key = raw.slice(0, eq);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        return { error: `--env key must be an environment variable name (got ${JSON.stringify(key)})` };
    }
    return { key, value: raw.slice(eq + 1) };
}

/** `--header 'Name: Value'` — split on the first colon. */
function parseHeader(raw: string): { name: string; value: string } | { error: string } {
    const colon = raw.indexOf(":");
    if (colon < 1) return { error: `--header expects 'Name: Value' (got ${JSON.stringify(raw)})` };
    const name = raw.slice(0, colon).trim();
    if (!name) return { error: `--header name is empty (got ${JSON.stringify(raw)})` };
    return { name, value: raw.slice(colon + 1).trim() };
}

interface CommonFlags {
    positionals: string[];
    scope?: "user" | "project";
}

/** Shared flag walker. Known flags are extracted anywhere BEFORE `--`;
 * everything after a `--` separator is literal (Claude Code passthrough);
 * unknown `--flags` are only accepted as positional server args once the
 * command positional has been seen (so `add srv node serve.js --port 3000`
 * works without quoting games), otherwise they are usage errors. */
function parseFlags(
    rest: string[],
    opts: {
        known: Array<"--scope" | "--env" | "--cwd" | "--header">;
        onFlag: (flag: string, value: string | undefined) => string | undefined;
        maxPositionals: number;
    },
): { flags: CommonFlags } | { error: string } {
    const positionals: string[] = [];
    let scope: "user" | "project" | undefined;
    let literal = false;
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === undefined) continue;
        if (literal) {
            positionals.push(a);
            continue;
        }
        if (a === "--") {
            literal = true;
            continue;
        }
        if (opts.known.includes(a as "--scope")) {
            const value = rest[++i];
            const err = opts.onFlag(a, value);
            if (err) return { error: err };
            if (a === "--scope") {
                const parsed = parseScope(value);
                if ("error" in parsed) return { error: parsed.error };
                scope = parsed.scope;
            }
            continue;
        }
        if (a.startsWith("--") && positionals.length < 2) {
            return { error: `unknown flag ${a} — server args that look like flags go after a \`--\` separator` };
        }
        positionals.push(a);
    }
    if (positionals.length > opts.maxPositionals) {
        return { error: `too many arguments: ${positionals.slice(opts.maxPositionals).join(" ")}` };
    }
    return { flags: { positionals, scope } };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runMcpCommand(argv: string[], ctx: McpCliContext): Promise<McpCliResult> {
    const out: string[] = [];
    const err: string[] = [];
    const log = (line?: string) => out.push(line ?? "");
    const fail = (line?: string) => err.push(line ?? "");
    const env = ctx.env ?? process.env;
    const userFile = join(ctx.userDir, "mcp.json");
    const projectFile = join(ctx.cwd, ".unown", "mcp.json");
    const trustOpts: TrustOptions = { statePath: trustStatePath(ctx.userDir), userDir: ctx.userDir, env };
    const finish = (exitCode: number): McpCliResult => ({
        exitCode,
        stdout: out.length > 0 ? `${out.join("\n")}\n` : "",
        stderr: err.length > 0 ? `${err.join("\n")}\n` : "",
    });
    const usageFail = (line: string): McpCliResult => {
        fail(`unown mcp: ${line}`);
        fail(USAGE_LINE);
        return finish(1);
    };

    const sub = argv[0] as Subcommand | undefined;
    if (sub === undefined) return usageFail("missing subcommand");
    if (sub === "-h" || sub === "--help" || sub === "help") {
        log(MCP_HELP);
        return finish(0);
    }
    if (!SUBCOMMANDS.includes(sub)) return usageFail(`unknown subcommand "${sub}"`);
    const rest = argv.slice(1);
    if (rest[0] === "-h" || rest[0] === "--help") {
        log(MCP_HELP);
        return finish(0);
    }

    // Shared write path for add/add-http/add-json.
    const writeAddedEntry = (scope: "user" | "project", name: string, entry: Record<string, unknown>): McpCliResult => {
        const file = scope === "user" ? userFile : projectFile;
        const nameProblem = NAME_RE.test(name)
            ? null
            : `server name must match ^[a-z0-9_-]{1,64}$ (got ${JSON.stringify(name)}) — session tools appear as mcp__<name>__<tool>`;
        if (nameProblem) {
            fail(`✗ ${nameProblem}`);
            return finish(1);
        }
        const validation = validateEntry(name, entry, env);
        if (!validation.ok) {
            fail(`✗ ${name}: ${validation.problem}`);
            return finish(1);
        }
        const up = upsertServer(file, name, entry);
        if (!up.ok) {
            fail(`✗ ${up.error}`);
            return finish(1);
        }
        log(`✓ added ${name} (${describeEntry(entry)}) → ${file}`);
        if (scope === "project") {
            // AUTO-TRUST (see file header): an interactive `add --scope project`
            // is explicit intent, same strength as the in-session /mcp trust
            // approval. The fingerprint pins exactly these bytes — any later
            // hand-edit re-arms the gate.
            const trusted = trustConfig(projectFile, trustOpts);
            if (trusted) log("  trusted — the project config is approved for this content (a later hand-edit re-arms the gate)");
            else fail("  ⚠ written but NOT trusted — run /mcp trust in a session or set UNOWN_TRUST_PROJECT_CONFIG=1");
        }
        return finish(0);
    };

    switch (sub) {
        case "add": {
            const envPairs: Array<{ key: string; value: string }> = [];
            let serverCwd: string | undefined;
            const parsed = parseFlags(rest, {
                known: ["--scope", "--env", "--cwd"],
                maxPositionals: Number.MAX_SAFE_INTEGER,
                onFlag: (flag, value) => {
                    if (flag === "--env") {
                        const pair = parseEnvPair(value ?? "");
                        if ("error" in pair) return pair.error;
                        envPairs.push(pair);
                        return undefined;
                    }
                    if (flag === "--cwd") {
                        if (!value) return "--cwd expects a directory";
                        serverCwd = value;
                    }
                    return undefined;
                },
            });
            if ("error" in parsed) return usageFail(parsed.error);
            const [name, command, ...args] = parsed.flags.positionals;
            if (!name || !command) return usageFail("add needs <name> <command> [args...]");
            const entry: Record<string, unknown> = { command };
            if (args.length > 0) entry.args = args;
            if (envPairs.length > 0) entry.env = Object.fromEntries(envPairs.map((p) => [p.key, p.value]));
            if (serverCwd !== undefined) entry.cwd = serverCwd;
            return writeAddedEntry(parsed.flags.scope ?? "user", name, entry);
        }

        case "add-http": {
            const headers: Record<string, string> = {};
            const parsed = parseFlags(rest, {
                known: ["--scope", "--header"],
                maxPositionals: 2,
                onFlag: (flag, value) => {
                    if (flag === "--header") {
                        const header = parseHeader(value ?? "");
                        if ("error" in header) return header.error;
                        headers[header.name] = header.value;
                    }
                    return undefined;
                },
            });
            if ("error" in parsed) return usageFail(parsed.error);
            const [name, url] = parsed.flags.positionals;
            if (!name || !url) return usageFail("add-http needs <name> <url>");
            const entry: Record<string, unknown> = { url };
            if (Object.keys(headers).length > 0) entry.headers = headers;
            return writeAddedEntry(parsed.flags.scope ?? "user", name, entry);
        }

        case "add-json": {
            const parsed = parseFlags(rest, { known: ["--scope"], maxPositionals: 2, onFlag: () => undefined });
            if ("error" in parsed) return usageFail(parsed.error);
            const [name, rawJson] = parsed.flags.positionals;
            if (!name || !rawJson) return usageFail(`add-json needs <name> '<json>'`);
            let entry: unknown;
            try {
                entry = JSON.parse(rawJson);
            } catch (err) {
                return usageFail(`the JSON did not parse: ${(err as Error).message}`);
            }
            if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
                return usageFail("the JSON must be one server object ({command,args,env,cwd} or {url,headers})");
            }
            return writeAddedEntry(parsed.flags.scope ?? "user", name, entry as Record<string, unknown>);
        }

        case "list": {
            if (rest.length > 0) return usageFail(`list takes no arguments (got ${rest.join(" ")})`);
            const problems: ConfigProblem[] = [];
            const projectUntrusted = trustApprovalNeeded(projectFile, trustOpts);
            const rows: Array<{ name: string; scope: string; type: string; target: string; notes: string }> = [];
            for (const [scope, file] of [
                ["user", userFile],
                ["project", projectFile],
            ] as const) {
                const { config, problems: fileProblems } = loadMcpConfigFile(file, env);
                problems.push(...fileProblems);
                if (!config) continue;
                for (const [name, cfg] of Object.entries(config.servers)) {
                    const notes: string[] = [];
                    if (config.disabled === true) notes.push("disabled");
                    if (scope === "project" && projectUntrusted) notes.push("untrusted — /mcp trust");
                    rows.push({ name, scope, type: isHttpConfig(cfg) ? "http" : "stdio", target: serverTarget(cfg), notes: notes.join(" · ") });
                }
            }
            if (rows.length === 0) {
                log("no MCP servers configured — add one: unown mcp add <name> <command> [args...]");
            } else {
                rows.sort((a, b) => (a.name === b.name ? a.scope.localeCompare(b.scope) : a.name.localeCompare(b.name)));
                const nameW = Math.max(...rows.map((r) => r.name.length), 4);
                const scopeW = 7;
                const typeW = 5;
                log(`MCP servers (${rows.length}):`);
                for (const r of rows) {
                    const notes = r.notes ? `  (${r.notes})` : "";
                    log(`  ${r.name.padEnd(nameW)}  ${r.scope.padEnd(scopeW)}  ${r.type.padEnd(typeW)}  ${r.target}${notes}`);
                }
            }
            for (const p of problems) fail(`⚠ ${formatConfigProblem(p)}`);
            return finish(0);
        }

        case "get": {
            const name = rest[0];
            if (!name) return usageFail("get needs <name>");
            if (rest.length > 1) return usageFail(`get takes one server name (got ${rest.join(" ")})`);
            // Effective-entry order: project wins per server name at load time.
            for (const file of [projectFile, userFile]) {
                const read = readConfigRoot(file);
                if ("error" in read) {
                    fail(`✗ ${read.error}`);
                    return finish(1);
                }
                const sm = serversMap(read.root, file);
                if ("error" in sm) {
                    fail(`✗ ${sm.error}`);
                    return finish(1);
                }
                const raw = sm.servers[name];
                if (raw !== undefined) {
                    log(`${name} — ${file}`);
                    log(JSON.stringify(raw, null, 2));
                    return finish(0);
                }
            }
            const names = [...hasAnyNames(userFile), ...hasAnyNames(projectFile)];
            fail(`✗ no server named "${name}"${names.length > 0 ? ` — configured: ${names.join(", ")}` : ""}`);
            return finish(1);
        }

        case "remove": {
            const parsed = parseFlags(rest, { known: ["--scope"], maxPositionals: 1, onFlag: () => undefined });
            if ("error" in parsed) return usageFail(parsed.error);
            const name = parsed.flags.positionals[0];
            if (!name) return usageFail("remove needs <name> [--scope user|project]");
            const scopeArg = parsed.flags.scope;
            const userHas = hasServer(userFile, name);
            const projHas = hasServer(projectFile, name);
            let file: string;
            if (scopeArg) {
                file = scopeArg === "user" ? userFile : projectFile;
                if (!hasServer(file, name)) {
                    fail(`✗ no server "${name}" in the ${scopeArg} scope (${file})`);
                    return finish(1);
                }
            } else if (userHas && projHas) {
                fail(`✗ "${name}" exists in BOTH scopes — pass --scope user or --scope project:`);
                fail(`  user:     ${userFile}`);
                fail(`  project:  ${projectFile}`);
                return finish(1);
            } else if (userHas) {
                file = userFile;
            } else if (projHas) {
                file = projectFile;
            } else {
                fail(`✗ no server named "${name}" is configured — run \`unown mcp list\``);
                return finish(1);
            }
            const isProject = file === projectFile;
            const wasTrusted = isProject && !trustApprovalNeeded(projectFile, trustOpts);
            const rm = removeServer(file, name);
            if (!rm.ok) {
                fail(`✗ ${rm.error}`);
                return finish(1);
            }
            if (isProject && wasTrusted) {
                // The user already approved this file's content; their CLI edit
                // keeps the (new) content approved. An UNTRUSTED file stays
                // untrusted — removing one entry must not bless the rest.
                trustConfig(projectFile, trustOpts);
            }
            log(`✓ removed ${name} from ${file}`);
            return finish(0);
        }

        case "test": {
            const name = rest[0];
            if (!name) return usageFail("test needs <name>");
            if (rest.length > 1) return usageFail(`test takes one server name (got ${rest.join(" ")})`);
            const resolved = resolveMcpConfig(ctx.cwd, ctx.userDir, env);
            const cfg = resolved.config.servers[name];
            if (!cfg && resolved.gatedServers[name] !== undefined) {
                fail(`✗ ${name}: the project config defining it is untrusted — run /mcp trust in a session or set UNOWN_TRUST_PROJECT_CONFIG=1`);
                return finish(1);
            }
            if (!cfg) {
                fail(`✗ no server named "${name}" is configured — run \`unown mcp list\``);
                return finish(1);
            }
            // Live probe: one manager, one server, short timeouts (connect +
            // tools/list ≈ 20 s worst case), no keepalive timers, clean disposal.
            const manager = new McpManager({
                cwd: ctx.cwd,
                config: { servers: { [name]: cfg } },
                env,
                requestTimeoutMs: 10_000,
                connectTimeoutMs: 10_000,
                reconnectCooldownMs: 0,
                keepalive: false,
            });
            try {
                await manager.connectAll(true);
                const st = manager.status()[0];
                if (st && st.state === "connected") {
                    log(`✓ ${name}: connected — ${st.tools} tool(s) (${st.transport}, ${st.detail})`);
                    return finish(0);
                }
                fail(`✗ ${name}: ${st?.state ?? "error"} — ${st?.detail ?? "no status"} (${st?.transport ?? "stdio"})`);
                return finish(1);
            } finally {
                manager.disposeAll();
            }
        }
    }
}

/** Server names in `file` (raw parse; empty when unreadable) — for get's hint. */
function hasAnyNames(file: string): string[] {
    const read = readConfigRoot(file);
    if ("error" in read) return [];
    const sm = serversMap(read.root, file);
    if ("error" in sm) return [];
    return Object.keys(sm.servers);
}
