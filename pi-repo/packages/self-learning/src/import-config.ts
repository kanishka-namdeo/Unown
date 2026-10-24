/**
 * import-config.ts — `unown import` (the 2026-10-24 parity round): one-command
 * config migration from the other agents.
 *
 * Competitive basis: Claude Code ships `/import codex|gemini|cursor` (the
 * switcher-acquisition play — instruction files, MCP servers, commands,
 * subagents, skills all carried over); Codex ships `/import` from Claude
 * Code. Unown's `sessions import --from claude|codex` moved TRANSCRIPTS
 * only — every config artifact was a manual port.
 *
 * Sources and what they contribute:
 *
 *   claude-code  ~/.claude + <project>/.claude + ~/.claude.json + .mcp.json
 *     instructions: CLAUDE.md (project, then user)
 *     commands:     .claude/commands/*.md   (already unown's contract — copies)
 *     skills:       .claude/skills/<name>/SKILL.md  (the SKILL.md standard)
 *     agents:       .claude/agents/*.md     (name/description frontmatter — same)
 *     mcp:          .mcp.json + ~/.claude.json's mcpServers (Claude-compatible
 *                   shape — unown's mcp.json is the same schema)
 *
 *   codex         ~/.codex
 *     instructions: AGENTS.md (already the same convention — copied verbatim)
 *     commands:     prompts/*.md
 *     mcp:          config.toml [mcp_servers.<name>] tables (stdio only —
 *                   that is all Codex configures)
 *
 *   gemini        ~/.gemini + <project>/.gemini
 *     instructions: GEMINI.md (project, then user)
 *     commands:     .gemini/commands/*.toml → converted to markdown commands
 *                   (description + prompt; {{args}} → $ARGUMENTS)
 *     mcp:          settings.json mcpServers (stdio/httpUrl shapes)
 *
 *   cursor        <project>/.cursor
 *     instructions: rules/*.mdc — rule bodies concatenated into the imported
 *                   section of AGENTS.md (rules ARE instructions; path-scoped
 *                   globs are noted in a comment per rule)
 *
 *   opencode      ~/.config/opencode + <project>/.opencode
 *     instructions: AGENTS.md (project, then user — same convention)
 *     commands:     command/*.md  (OpenCode's own contract is markdown+frontmatter)
 *     agents:       agent/*.md
 *
 * Contract:
 *   - NEVER overwrite: a target that already exists is skipped with a reason.
 *     Instructions APPEND under a marked comment section (never clobber the
 *     user's own AGENTS.md); a missing AGENTS.md is created with the section.
 *   - MCP servers merge into .unown/mcp.json: servers already configured in
 *     unown WIN (the import never replaces an explicit unown config); new
 *     ones are added. The file stays refuse-first trust-gated — the report
 *     says to run `/mcp trust` (or set UNOWN_TRUST_PROJECT_CONFIG=1).
 *   - dry-run plans without writing; the plan is the same object either way.
 *   - Everything is best-effort per artifact: one unreadable file never
 *     fails the whole import (it lands in `skipped` with the reason).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { atomicWriteFileSync } from "./atomic.ts";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type ImportSource = "claude-code" | "codex" | "gemini" | "cursor" | "opencode";
export const IMPORT_SOURCES: ImportSource[] = ["claude-code", "codex", "gemini", "cursor", "opencode"];

export type ImportLane = "instructions" | "commands" | "skills" | "agents" | "mcp";
export const IMPORT_LANES: ImportLane[] = ["instructions", "commands", "skills", "agents", "mcp"];

export interface ImportArtifact {
    lane: ImportLane;
    /** Human-readable origin (a real path, or "config.toml [mcp_servers.x]"). */
    origin: string;
    /** The target: an absolute file path (copies) or "AGENTS.md" (the section). */
    target: string;
    /** For copies: the full source content. For mcp: the JSON value. */
    content?: string;
    /** mcp server name (lane === "mcp"). */
    serverName?: string;
    /** mcp server config (lane === "mcp"). */
    serverConfig?: unknown;
}

export interface ImportPlan {
    source: ImportSource;
    artifacts: ImportArtifact[];
    /** Skipped artifacts with reasons (already exists, unreadable, …). */
    skipped: Array<ImportArtifact & { reason: string }>;
    /** Human notes that ride the report (trust gate reminders, conversions). */
    notes: string[];
}

export interface ImportOptions {
    projectDir: string;
    /** The home dir to scan for user-scoped sources (default: os homedir()). */
    homeDir?: string;
    dryRun?: boolean;
    /** Restrict to specific lanes (default: all). */
    lanes?: ImportLane[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function readIfExists(path: string): string | null {
    try {
        return existsSync(path) ? readFileSync(path, "utf8") : null;
    } catch {
        return null;
    }
}

function listMdFiles(dir: string): string[] {
    try {
        if (!existsSync(dir)) return [];
        return readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.endsWith(".md"))
            .map((e) => join(dir, e.name))
            .sort();
    } catch {
        return [];
    }
}

/** Strip a UTF-8 BOM if present (some editors write one; it breaks the
 *  frontmatter parser downstream). */
function stripBom(s: string): string {
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// ---------------------------------------------------------------------------
// Per-source discovery
// ---------------------------------------------------------------------------

interface DiscoverCtx {
    projectDir: string;
    home: string;
}

function discoverClaudeCode(ctx: DiscoverCtx, out: ImportPlan): void {
    const p = ctx.projectDir;
    const claudeHome = join(ctx.home, ".claude");

    // Instructions: project CLAUDE.md first (more specific), then user.
    for (const [label, path] of [
        ["CLAUDE.md (project)", join(p, "CLAUDE.md")],
        ["CLAUDE.md (user)", join(claudeHome, "CLAUDE.md")],
    ] as const) {
        const content = readIfExists(path);
        if (content !== null) out.artifacts.push({ lane: "instructions", origin: label, target: "AGENTS.md", content: stripBom(content) });
    }

    // Commands (project + user) — already unown's contract.
    for (const dir of [join(p, ".claude", "commands"), join(claudeHome, "commands")]) {
        for (const file of listMdFiles(dir)) {
            const content = readIfExists(file);
            if (content !== null) {
                out.artifacts.push({
                    lane: "commands",
                    origin: file,
                    target: join(p, ".unown", "commands", basename(file)),
                    content: stripBom(content),
                });
            }
        }
    }

    // Skills: <dir>/<name>/SKILL.md → .unown/skills/<name>/SKILL.md
    for (const base of [join(p, ".claude", "skills"), join(claudeHome, "skills")]) {
        try {
            if (!existsSync(base)) continue;
            for (const entry of readdirSync(base, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const skillFile = join(base, entry.name, "SKILL.md");
                const content = readIfExists(skillFile);
                if (content !== null) {
                    out.artifacts.push({
                        lane: "skills",
                        origin: skillFile,
                        target: join(p, ".unown", "skills", entry.name, "SKILL.md"),
                        content: stripBom(content),
                    });
                }
            }
        } catch {
            /* unreadable skills dir — skip */
        }
    }

    // Agents (project + user).
    for (const dir of [join(p, ".claude", "agents"), join(claudeHome, "agents")]) {
        for (const file of listMdFiles(dir)) {
            const content = readIfExists(file);
            if (content !== null) {
                out.artifacts.push({
                    lane: "agents",
                    origin: file,
                    target: join(p, ".unown", "agents", basename(file)),
                    content: stripBom(content),
                });
            }
        }
    }

    // MCP: project .mcp.json first, then ~/.claude.json's mcpServers.
    collectMcpJson(out, join(p, ".mcp.json"), p);
    const claudeJson = readIfExists(join(ctx.home, ".claude.json"));
    if (claudeJson !== null) {
        try {
            const parsed = JSON.parse(claudeJson);
            pushMcpServers(out, parsed?.mcpServers, `${join(ctx.home, ".claude.json")} → mcpServers`);
        } catch {
            out.skipped.push({ lane: "mcp", origin: join(ctx.home, ".claude.json"), target: ".unown/mcp.json", reason: "malformed JSON" });
        }
    }
}

function discoverCodex(ctx: DiscoverCtx, out: ImportPlan): void {
    const codexHome = join(ctx.home, ".codex");
    const agents = readIfExists(join(codexHome, "AGENTS.md"));
    if (agents !== null) {
        out.artifacts.push({ lane: "instructions", origin: join(codexHome, "AGENTS.md"), target: "AGENTS.md", content: stripBom(agents) });
    }
    for (const file of listMdFiles(join(codexHome, "prompts"))) {
        const content = readIfExists(file);
        if (content !== null) {
            out.artifacts.push({
                lane: "commands",
                origin: file,
                target: join(ctx.projectDir, ".unown", "commands", basename(file)),
                content: stripBom(content),
            });
        }
    }
    const toml = readIfExists(join(codexHome, "config.toml"));
    if (toml !== null) {
        const servers = parseCodexMcpServers(toml);
        for (const [name, cfg] of Object.entries(servers)) {
            out.artifacts.push({
                lane: "mcp",
                origin: `${join(codexHome, "config.toml")} → [mcp_servers.${name}]`,
                target: join(ctx.projectDir, ".unown", "mcp.json"),
                serverName: name,
                serverConfig: cfg,
            });
        }
    }
}

function discoverGemini(ctx: DiscoverCtx, out: ImportPlan): void {
    const p = ctx.projectDir;
    const geminiHome = join(ctx.home, ".gemini");
    for (const [label, path] of [
        ["GEMINI.md (project)", join(p, "GEMINI.md")],
        ["GEMINI.md (user)", join(geminiHome, "GEMINI.md")],
    ] as const) {
        const content = readIfExists(path);
        if (content !== null) out.artifacts.push({ lane: "instructions", origin: label, target: "AGENTS.md", content: stripBom(content) });
    }
    // Commands: TOML → markdown conversion.
    for (const dir of [join(p, ".gemini", "commands"), join(geminiHome, "commands")]) {
        try {
            if (!existsSync(dir)) continue;
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (!entry.isFile() || !entry.name.endsWith(".toml")) continue;
                const raw = readIfExists(join(dir, entry.name));
                if (raw === null) continue;
                const converted = convertGeminiCommandToml(raw);
                if (converted === null) {
                    out.skipped.push({
                        lane: "commands",
                        origin: join(dir, entry.name),
                        target: join(p, ".unown", "commands", entry.name.replace(/\.toml$/, ".md")),
                        reason: "unparseable command TOML",
                    });
                    continue;
                }
                out.artifacts.push({
                    lane: "commands",
                    origin: join(dir, entry.name),
                    target: join(p, ".unown", "commands", entry.name.replace(/\.toml$/, ".md")),
                    content: converted,
                });
                out.notes.push(`converted Gemini TOML command ${entry.name} → markdown ({{args}} → $ARGUMENTS)`);
            }
        } catch {
            /* unreadable commands dir — skip */
        }
    }
    // MCP: settings.json mcpServers (both scopes).
    for (const settingsPath of [join(p, ".gemini", "settings.json"), join(geminiHome, "settings.json")]) {
        const raw = readIfExists(settingsPath);
        if (raw === null) continue;
        try {
            const parsed = JSON.parse(raw);
            pushMcpServers(out, parsed?.mcpServers, `${settingsPath} → mcpServers`);
        } catch {
            out.skipped.push({ lane: "mcp", origin: settingsPath, target: ".unown/mcp.json", reason: "malformed JSON" });
        }
    }
}

function discoverCursor(ctx: DiscoverCtx, out: ImportPlan): void {
    const rulesDir = join(ctx.projectDir, ".cursor", "rules");
    try {
        if (!existsSync(rulesDir)) return;
        for (const entry of readdirSync(rulesDir, { withFileTypes: true })) {
            if (!entry.isFile()) continue;
            if (!entry.name.endsWith(".mdc") && !entry.name.endsWith(".md")) continue;
            const raw = readIfExists(join(rulesDir, entry.name));
            if (raw === null) continue;
            // .mdc rules carry frontmatter (description/globs/alwaysApply); the
            // BODY is the instruction. Rules are instructions, not commands —
            // they concatenate into the AGENTS.md section, one heading each.
            const { body, frontmatter } = splitMdc(raw);
            const globs = typeof frontmatter.globs === "string" && frontmatter.globs ? ` (applies to: ${frontmatter.globs})` : "";
            const section = `### Rule: ${entry.name.replace(/\.(mdc|md)$/, "")}${globs}\n\n${body.trim()}\n`;
            out.artifacts.push({
                lane: "instructions",
                origin: join(rulesDir, entry.name),
                target: "AGENTS.md",
                content: section,
            });
        }
    } catch {
        /* unreadable rules dir — skip */
    }
}

function discoverOpencode(ctx: DiscoverCtx, out: ImportPlan): void {
    const p = ctx.projectDir;
    const ocHome = join(ctx.home, ".config", "opencode");
    for (const [label, path] of [
        ["AGENTS.md (project)", join(p, "AGENTS.md")],
        ["AGENTS.md (user)", join(ocHome, "AGENTS.md")],
    ] as const) {
        // A project AGENTS.md that IS unown's own file is not an import — skip.
        if (path === join(p, "AGENTS.md")) {
            out.notes.push("project AGENTS.md detected — it is already unown's instruction file; nothing to import");
            continue;
        }
        const content = readIfExists(path);
        if (content !== null) out.artifacts.push({ lane: "instructions", origin: label, target: "AGENTS.md", content: stripBom(content) });
    }
    for (const dir of [join(p, ".opencode", "command"), join(ocHome, "command")]) {
        for (const file of listMdFiles(dir)) {
            const content = readIfExists(file);
            if (content !== null) {
                out.artifacts.push({
                    lane: "commands",
                    origin: file,
                    target: join(p, ".unown", "commands", basename(file)),
                    content: stripBom(content),
                });
            }
        }
    }
    for (const dir of [join(p, ".opencode", "agent"), join(ocHome, "agent")]) {
        for (const file of listMdFiles(dir)) {
            const content = readIfExists(file);
            if (content !== null) {
                out.artifacts.push({
                    lane: "agents",
                    origin: file,
                    target: join(p, ".unown", "agents", basename(file)),
                    content: stripBom(content),
                });
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Parsers: mcp shapes + codex TOML + gemini command TOML + mdc frontmatter
// ---------------------------------------------------------------------------

function collectMcpJson(out: ImportPlan, path: string, projectDir: string): void {
    const raw = readIfExists(path);
    if (raw === null) return;
    try {
        const parsed = JSON.parse(raw);
        pushMcpServers(out, parsed?.mcpServers, `${path} → mcpServers`);
    } catch {
        out.skipped.push({ lane: "mcp", origin: path, target: join(projectDir, ".unown", "mcp.json"), reason: "malformed JSON" });
    }
}

/** Push a Claude-shaped mcpServers object onto the plan (tolerant). */
function pushMcpServers(out: ImportPlan, servers: unknown, origin: string): void {
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) return;
    for (const [name, cfg] of Object.entries(servers as Record<string, unknown>)) {
        if (!cfg || typeof cfg !== "object") continue;
        out.artifacts.push({ lane: "mcp", origin, target: ".unown/mcp.json", serverName: name, serverConfig: cfg });
    }
}

/**
 * Minimal TOML reader for Codex's `[mcp_servers.<name>]` tables — the subset
 * Codex documents for stdio servers: command (string), args (array of
 * strings), env (table of strings). Line-based, quote-tolerant, everything
 * unknown inside a table is ignored; tables outside mcp_servers are skipped.
 */
export function parseCodexMcpServers(toml: string): Record<string, { command: string; args?: string[]; env?: Record<string, string> }> {
    const result: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
    let current: string | null = null;
    for (const rawLine of toml.split("\n")) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith("#")) continue;
        const table = line.match(/^\[mcp_servers\.([A-Za-z0-9_.-]+)\]$/);
        if (table) {
            current = table[1];
            result[current] ??= { command: "" };
            continue;
        }
        if (line.startsWith("[")) {
            current = null; // some other table
            continue;
        }
        if (current === null) continue;
        const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
        if (!kv) continue;
        const [, key, rawValue] = kv;
        const value = parseTomlValue(rawValue);
        if (key === "command" && typeof value === "string") result[current].command = value;
        else if (key === "args" && Array.isArray(value)) result[current].args = value.filter((v) => typeof v === "string") as string[];
        else if (key === "env" && value && typeof value === "object") {
            const env: Record<string, string> = {};
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                if (typeof v === "string") env[k] = v;
            }
            result[current].env = env;
        }
    }
    // Servers without a command are unusable — drop them.
    for (const [name, cfg] of Object.entries(result)) {
        if (!cfg.command) delete result[name];
    }
    return result;
}

/** One TOML value: string (single/double-quoted), array, or inline table. */
function parseTomlValue(raw: string): unknown {
    const s = raw.trim().replace(/,$/, "");
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
        try {
            return JSON.parse(s);
        } catch {
            return s.slice(1, -1);
        }
    }
    if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1);
    if (s.startsWith("[")) {
        try {
            const arr = JSON.parse(s.replace(/'/g, '"'));
            if (Array.isArray(arr)) return arr;
        } catch {
            /* fall through */
        }
        // Bare-word arrays: [a, b]
        return s
            .slice(1, -1)
            .split(",")
            .map((x) => x.trim().replace(/^["']|["']$/g, ""))
            .filter((x) => x.length > 0);
    }
    if (s.startsWith("{")) {
        // Inline table (TOML syntax, `=`-separated — NOT JSON): parse the
        // key/value pairs. Values are scalars; nested tables are not needed
        // for the mcp_servers env subset.
        const out: Record<string, unknown> = {};
        const inner = s.slice(1, -1).trim();
        if (inner.length > 0) {
            for (const pair of splitTomlPairs(inner)) {
                const eq = pair.indexOf("=");
                if (eq < 0) continue;
                const k = pair.slice(0, eq).trim();
                const v = parseTomlValue(pair.slice(eq + 1).trim());
                if (k.length > 0) out[k] = v;
            }
        }
        return out;
    }
    return s;
}

/** Split a comma-separated TOML list, respecting quotes (no nested commas
 *  inside strings reach the splitter). */
function splitTomlPairs(s: string): string[] {
    const parts: string[] = [];
    let cur = "";
    let quote: string | null = null;
    for (const ch of s) {
        if (quote) {
            cur += ch;
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            cur += ch;
        } else if (ch === ",") {
            parts.push(cur);
            cur = "";
        } else {
            cur += ch;
        }
    }
    if (cur.trim().length > 0) parts.push(cur);
    return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Convert a Gemini custom-command TOML to unown's markdown command. Gemini's
 * format: `description = "..."` + `prompt = "..."` (or triple-quoted). The
 * {{args}} placeholder maps to $ARGUMENTS.
 */
export function convertGeminiCommandToml(toml: string): string | null {
    let description = "";
    let prompt = "";
    for (const rawLine of toml.split("\n")) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith("#")) continue;
        const m = line.match(/^(description|prompt)\s*=\s*(.+)$/);
        if (!m) continue;
        const [, key, rawValue] = m;
        let value: string;
        const v = rawValue.trim();
        if (v.startsWith('"""')) {
            // Multiline prompt: consume until the closing triple quote.
            // (Handled below by the continuation pass — a single-line
            // triple-quoted value is unusual; treat as empty-start.)
            value = "";
        } else {
            const parsed = parseTomlValue(v) as unknown;
            value = typeof parsed === "string" ? parsed : "";
        }
        if (key === "description") description = value;
        else prompt = value;
    }
    // Multiline prompts: """ ... """ blocks — a small dedicated scan.
    const ml = toml.match(/prompt\s*=\s*"""([\s\S]*?)"""/);
    if (ml) prompt = ml[1].trim();
    if (!prompt) return null;
    const body = prompt.replaceAll("{{args}}", "$ARGUMENTS").replaceAll("$1", "$1");
    const fm = description ? `---\ndescription: ${description.replace(/\n/g, " ").replace(/"/g, "")}\n---\n\n` : "";
    return `${fm}${body}\n`;
}

/** Split an .mdc rule into frontmatter fields + body. */
function splitMdc(raw: string): { frontmatter: Record<string, string>; body: string } {
    const fm: Record<string, string> = {};
    let body = raw;
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    if (m) {
        body = raw.slice(m[0].length);
        for (const line of m[1].split("\n")) {
            const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
            if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
        }
    }
    return { frontmatter: fm, body };
}

// ---------------------------------------------------------------------------
// Plan + execute
// ---------------------------------------------------------------------------

const DISCOVERERS: Record<ImportSource, (ctx: DiscoverCtx, out: ImportPlan) => void> = {
    "claude-code": discoverClaudeCode,
    codex: discoverCodex,
    gemini: discoverGemini,
    cursor: discoverCursor,
    opencode: discoverOpencode,
};

/** Discover everything one source can contribute. Pure (no writes). */
export function planImport(source: ImportSource, opts: ImportOptions): ImportPlan {
    const plan: ImportPlan = {
        source,
        artifacts: [],
        skipped: [],
        notes: [],
    };
    const lanes = new Set(opts.lanes ?? IMPORT_LANES);
    const full: ImportPlan = {
        source,
        artifacts: [],
        skipped: [],
        notes: [],
    };
    DISCOVERERS[source]({ projectDir: opts.projectDir, home: opts.homeDir ?? homedir() }, full);
    for (const a of full.artifacts) {
        if (lanes.has(a.lane)) plan.artifacts.push(a);
        else full.skipped.push({ ...a, reason: "lane not selected" });
    }
    plan.skipped = full.skipped;
    plan.notes = full.notes;
    return plan;
}

/** Which sources have anything to offer (the `--from auto` report). */
export function detectAvailableSources(opts: ImportOptions): Array<{ source: ImportSource; count: number }> {
    const out: Array<{ source: ImportSource; count: number }> = [];
    for (const source of IMPORT_SOURCES) {
        const plan = planImport(source, { ...opts, lanes: ["instructions", "commands", "skills", "agents", "mcp"] });
        out.push({ source, count: plan.artifacts.length });
    }
    return out;
}

export interface ImportResult {
    planned: number;
    done: Array<ImportArtifact>;
    skipped: Array<ImportArtifact & { reason: string }>;
    /** The paths that were written/created (for the report). */
    written: string[];
    instructionsAppended: boolean;
    /** Human notes that ride the report (trust gate reminders, conversions). */
    notes: string[];
}

/**
 * Execute a plan. Idempotence: an existing target file SKIPS (never
 * overwrites); instructions append under a marked section; MCP servers merge
 * with existing unown config winning. With `dryRun` nothing is written and
 * the result describes what WOULD happen (done = the artifacts that would
 * land, skipped gains the would-skip reasons).
 */
export function executeImport(plan: ImportPlan, opts: ImportOptions): ImportResult {
    const result: ImportResult = {
        planned: plan.artifacts.length,
        done: [],
        skipped: [...plan.skipped],
        written: [],
        instructionsAppended: false,
        notes: [...plan.notes],
    };
    const dry = opts.dryRun === true;
    const p = opts.projectDir;

    // Pass 1: file-copy lanes (commands / skills / agents).
    for (const a of plan.artifacts) {
        if (a.lane !== "commands" && a.lane !== "skills" && a.lane !== "agents") continue;
        if (!a.content || !a.target) continue;
        if (existsSync(a.target)) {
            result.skipped.push({ ...a, reason: "target already exists (never overwritten — delete it and re-run to re-import)" });
            continue;
        }
        if (!dry) {
            mkdirSync(dirname(a.target), { recursive: true });
            atomicWriteFileSync(a.target, a.content);
        }
        result.done.push(a);
        result.written.push(a.target);
    }

    // Pass 2: instructions — append (or create) AGENTS.md's marked section.
    const instructionArts = plan.artifacts.filter((a) => a.lane === "instructions" && a.content);
    if (instructionArts.length > 0) {
        const agentsPath = join(p, "AGENTS.md");
        const existing = readIfExists(agentsPath) ?? "";
        const header = `<!-- imported from ${plan.source} on ${new Date().toISOString().slice(0, 10)} — unown import -->`;
        // Idempotence: a re-run whose marker (source) already exists appends
        // nothing (the section is there).
        if (existing.includes(`imported from ${plan.source}`)) {
            for (const a of instructionArts) {
                result.skipped.push({ ...a, reason: `AGENTS.md already carries an imported ${plan.source} section` });
            }
        } else {
            const section =
                (existing.length > 0 ? "\n\n" : "") +
                `${header}\n` +
                instructionArts.map((a) => `## From ${a.origin}\n\n${a.content!.trim()}\n`).join("\n");
            if (!dry) atomicWriteFileSync(agentsPath, existing + section + "\n");
            result.done.push(...instructionArts);
            result.written.push(agentsPath);
            result.instructionsAppended = true;
        }
    }

    // Pass 3: MCP — merge into .unown/mcp.json (existing servers win).
    const mcpArts = plan.artifacts.filter((a) => a.lane === "mcp" && a.serverName);
    if (mcpArts.length > 0) {
        const mcpPath = join(p, ".unown", "mcp.json");
        let cfg: any = { mcpServers: {} };
        const raw = readIfExists(mcpPath);
        if (raw !== null) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") cfg = parsed;
                if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") cfg.mcpServers = {};
            } catch {
                result.notes.push("existing .unown/mcp.json is malformed — the import refused to touch it");
                for (const a of mcpArts) result.skipped.push({ ...a, reason: "existing mcp.json malformed" });
                mcpArts.length = 0;
            }
        }
        for (const a of mcpArts) {
            if (cfg.mcpServers[a.serverName!]) {
                result.skipped.push({ ...a, reason: `server "${a.serverName}" already configured in unown (unown wins)` });
                continue;
            }
            if (!dry) cfg.mcpServers[a.serverName!] = normalizeMcpServer(a.serverConfig);
            result.done.push(a);
        }
        if (!dry && mcpArts.some((a) => result.done.includes(a))) {
            mkdirSync(dirname(mcpPath), { recursive: true });
            atomicWriteFileSync(mcpPath, JSON.stringify(cfg, null, 2) + "\n");
            result.written.push(mcpPath);
            result.notes.push("imported MCP servers landed in .unown/mcp.json — refuse-first trust applies: run /mcp trust (or UNOWN_TRUST_PROJECT_CONFIG=1) to activate");
        }
    }

    return result;
}

/** Normalize a foreign server config into unown's Claude-compatible shape
 *  (stdio: command/args/env; http: url/headers). Gemini's `httpUrl` → url. */
export function normalizeMcpServer(cfg: unknown): unknown {
    if (!cfg || typeof cfg !== "object") return cfg;
    const c = { ...(cfg as Record<string, unknown>) };
    const out: Record<string, unknown> = {};
    if (typeof c.url === "string") {
        out.url = c.url;
        if (c.headers && typeof c.headers === "object") out.headers = c.headers;
    } else if (typeof c.httpUrl === "string") {
        out.url = c.httpUrl;
        if (c.headers && typeof c.headers === "object") out.headers = c.headers;
    } else if (typeof c.command === "string") {
        out.command = c.command;
        if (Array.isArray(c.args)) out.args = c.args.filter((x) => typeof x === "string");
        if (c.env && typeof c.env === "object") out.env = c.env;
        if (typeof c.cwd === "string") out.cwd = c.cwd;
    } else {
        // Unknown shape — carry it verbatim (the mcp.json validator will
        // report it; better visible than silently dropped).
        return cfg;
    }
    return out;
}
