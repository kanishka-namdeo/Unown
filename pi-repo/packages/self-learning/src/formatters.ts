/**
 * formatters.ts — post-edit auto-formatters (the 2026-10-24 parity round;
 * OpenCode Formatters / aider auto-lint parity).
 *
 * The workflow every code-focused agent grew: after a successful write/edit,
 * run the project's formatter on the file (prettier, gofmt, ruff, biome…)
 * and let the agent SEE the final form. OpenCode ships this as a first-class
 * config lane; aider runs linters after every edit; Claude Code's workflow
 * docs teach "ask the model to run the formatter" as a manual step. Unown's
 * PostToolUse syntax gate already feeds errors back — this adds the sibling
 * lane: style changes applied + reported, not just errors.
 *
 * Config (both files, the hooks.json two-scope precedent):
 *   ~/.unown/agent/formatters.json   user scope — always trusted
 *   .unown/formatters.json           project scope — config-trust gated
 * Schema (array form keeps order; the map form is accepted for brevity):
 *   { "version": 1, "formatters": [
 *       { "pattern": "<glob>",  "command": "prettier --write" },
 *       ...
 *   ]}
 * (globs use the permissions layer's semantics — a double-star crosses
 *  directory separators; see `patternToRegex`. NB: literal glob examples
 *  cannot appear in this block comment — the star-slash sequence would
 *  terminate it.)
 * The file path is APPENDED to the command unless the command contains the
 *   $FILE placeholder (full control over argument order).
 *
 * Contract:
 *   - First matching rule wins (top to bottom; project rules replace user
 *     rules with the same pattern — the per-pattern merge hooks.json uses).
 *   - Patterns are the permissions layer's globs (`*` segment-local, `**`
 *     crossing, a double-star before a separator may match zero segments)
 *     matched against the
 *     project-relative path, the basename and the absolute path.
 *   - Fail-open, everywhere: a missing formatter, a timeout, a non-zero
 *     exit — none of these ever break the edit. A "formatter unavailable"
 *     notice latches per command per session (reported once, then silent).
 *   - 10s timeout per run (a wedged formatter must not wedge the session).
 *   - The feedback block rides the existing PostToolUse augment lane:
 *     `[PostToolUse:formatter] prettier reformatted src/a.ts (1,234 → 1,240 bytes)`
 *     — appended to the tool result as a NON-error block, so the model sees
 *     the final form and can re-read if the reformat moved its anchors.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { isConfigTrusted, trustBypassed, trustStatePath } from "./config-trust.ts";
import { globMatch } from "./permissions.ts";
import { UNOWN_AGENT_DIR } from "./term.ts";

// ---------------------------------------------------------------------------
// Shapes + paths
// ---------------------------------------------------------------------------

export interface FormatterRule {
    /** Glob pattern (a double-star crosses separators — the permissions
     *  engine's semantics; written out here because the literal glob would
     *  terminate a block comment). */
    pattern: string;
    /** The formatter command; the file path is appended (or replaces $FILE). */
    command: string;
}

export interface FormattersConfig {
    version: 1;
    formatters: FormatterRule[];
}

export interface ResolvedFormattersConfig {
    config: FormattersConfig;
    approvalNeeded: boolean;
    sources: { user: string[]; project: string[]; untrustedProject: string[] };
}

export function projectFormattersConfigPath(projectDir: string): string {
    return join(projectDir, ".unown", "formatters.json");
}

export function userFormattersConfigPath(agentDir: string = UNOWN_AGENT_DIR): string {
    return join(agentDir, "formatters.json");
}

// ---------------------------------------------------------------------------
// Reading + validation
// ---------------------------------------------------------------------------

export interface ReadFormattersResult {
    config: FormattersConfig | null;
    /** Human-readable problems for invalid entries (skipped, not fatal). */
    problems: string[];
}

/** Parse + validate one formatters.json. Tolerant: invalid entries are
 *  skipped with a problem line, a fully-invalid file reads as null. */
export function readFormattersConfig(path: string): ReadFormattersResult {
    const problems: string[] = [];
    if (!existsSync(path)) return { config: null, problems };
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch {
        return { config: null, problems: [`${path}: unreadable`] };
    }
    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch (err: any) {
        return { config: null, problems: [`${path}: malformed JSON (${err instanceof Error ? err.message : String(err)})`] };
    }
    const src = parsed?.formatters;
    if (!Array.isArray(src) && typeof src !== "object") {
        return { config: null, problems: [`${path}: no "formatters" array/object`] };
    }
    const rules: FormatterRule[] = [];
    if (Array.isArray(src)) {
        for (const entry of src) {
            if (!entry || typeof entry !== "object") {
                problems.push(`${path}: non-object formatter entry skipped`);
                continue;
            }
            const pattern = typeof entry.pattern === "string" ? entry.pattern.trim() : "";
            const command = typeof entry.command === "string" ? entry.command.trim() : "";
            if (!pattern || !command) {
                problems.push(`${path}: formatter entry needs non-empty pattern + command (skipped)`);
                continue;
            }
            rules.push({ pattern, command });
        }
    } else {
        // Map form: { "pattern": "command", ... } — insertion order kept.
        for (const [pattern, command] of Object.entries(src as Record<string, unknown>)) {
            if (typeof command !== "string" || command.trim().length === 0) {
                problems.push(`${path}: formatter "${pattern}" needs a non-empty command (skipped)`);
                continue;
            }
            rules.push({ pattern: pattern.trim(), command: command.trim() });
        }
    }
    if (rules.length === 0) return { config: null, problems };
    return { config: { version: 1, formatters: rules }, problems };
}

/**
 * Load both scopes (user always trusted; project config-trust gated — the
 * same refuse-first posture as hooks.json / mcp.json / lsp.json) and merge:
 * project rules REPLACE user rules with the same pattern, others append.
 */
export function loadFormattersConfig(projectDir: string, agentDir: string = UNOWN_AGENT_DIR): ResolvedFormattersConfig {
    const sources: ResolvedFormattersConfig["sources"] = { user: [], project: [], untrustedProject: [] };
    const userRead = readFormattersConfig(userFormattersConfigPath(agentDir));
    if (userRead.config) sources.user.push(userFormattersConfigPath(agentDir));

    const projPath = projectFormattersConfigPath(projectDir);
    let projCfg: FormattersConfig | null = null;
    let approvalNeeded = false;
    if (existsSync(projPath)) {
        if (trustBypassed()) {
            projCfg = readFormattersConfig(projPath).config;
            if (projCfg) sources.project.push(projPath);
        } else if (isConfigTrusted(projPath, { statePath: trustStatePath(agentDir) })) {
            projCfg = readFormattersConfig(projPath).config;
            if (projCfg) sources.project.push(projPath);
        } else {
            approvalNeeded = true;
            sources.untrustedProject.push(projPath);
        }
    }

    const byPattern = new Map<string, FormatterRule>();
    if (userRead.config) for (const r of userRead.config.formatters) byPattern.set(r.pattern, r);
    if (projCfg) for (const r of projCfg.formatters) byPattern.set(r.pattern, r); // project wins per-pattern

    return {
        config: { version: 1, formatters: [...byPattern.values()] },
        approvalNeeded,
        sources,
    };
}

// ---------------------------------------------------------------------------
// Matching + execution
// ---------------------------------------------------------------------------

/** First rule whose pattern matches the file (relative path, basename and
 *  absolute path all tried — a top-level glob should not need a
 *  double-star prefix to match nested files). */
export function matchFormatter(rules: FormatterRule[], filePath: string, cwd: string): FormatterRule | null {
    const abs = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
    const rel = relative(cwd, abs);
    const name = basename(abs);
    for (const rule of rules) {
        if (globMatch(rule.pattern, rel) || globMatch(rule.pattern, name) || globMatch(rule.pattern, abs)) {
            return rule;
        }
    }
    return null;
}

/** Quote a path for the shell (double quotes; escape embedded quotes). */
function shellQuote(p: string): string {
    return `"${p.replace(/(["\\$`])/g, "\\$1")}"`;
}

/** Build the shell command line for a rule + file ($FILE placeholder or append). */
export function buildFormatterCommand(rule: FormatterRule, absPath: string): string {
    if (rule.command.includes("$FILE")) {
        return rule.command.replaceAll("$FILE", shellQuote(absPath));
    }
    return `${rule.command} ${shellQuote(absPath)}`;
}

export interface FormatterRunResult {
    /** true when the formatter ran successfully AND changed the file. */
    changed: boolean;
    /** true when the formatter ran successfully and changed nothing. */
    clean: boolean;
    error?: string;
}

/** Default per-run timeout: a wedged formatter must not wedge the session. */
export const FORMATTER_TIMEOUT_MS = 10_000;

/**
 * Run one formatter on one file, synchronously (the PostToolUse augment lane
 * must complete before the tool result returns to the model). Change
 * detection is a before/after byte compare of the file itself — the
 * formatter's exit code says nothing about whether it rewrote anything.
 * Fail-open: every failure is a returned `error`, never a throw.
 */
export function runFormatter(
    rule: FormatterRule,
    absPath: string,
    timeoutMs: number = FORMATTER_TIMEOUT_MS,
): FormatterRunResult {
    let before: Buffer;
    try {
        before = readFileSync(absPath);
    } catch {
        return { changed: false, clean: false, error: "file unreadable after edit" };
    }
    let proc: ReturnType<typeof spawnSync>;
    try {
        proc = spawnSync(buildFormatterCommand(rule, absPath), {
            shell: true,
            windowsHide: true,
            timeout: timeoutMs,
            encoding: "utf8",
            maxBuffer: 4 * 1024 * 1024,
        });
    } catch (err: any) {
        return { changed: false, clean: false, error: `spawn failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (proc.error) {
        const msg = proc.error.message ?? String(proc.error);
        // ENOENT on the shell level (command not found) — the latch case.
        return { changed: false, clean: false, error: msg };
    }
    if (proc.status !== 0) {
        const tail = (proc.stderr ?? "").toString().trim().split("\n").slice(-1)[0] ?? "";
        return { changed: false, clean: false, error: `exit ${proc.status}${tail ? `: ${tail.slice(0, 200)}` : ""}` };
    }
    let after: Buffer;
    try {
        after = readFileSync(absPath);
    } catch {
        return { changed: false, clean: false, error: "file unreadable after format" };
    }
    return { changed: !before.equals(after), clean: before.equals(after) };
}

// ---------------------------------------------------------------------------
// The PostToolUse entry (termhooks wiring)
// ---------------------------------------------------------------------------

/** Per-session latch: a command that failed once stops being reported (the
 *  "formatter unavailable" notice prints once, not on every edit). */
export interface FormatterSessionState {
    latched: Set<string>;
}

export function createFormatterSessionState(): FormatterSessionState {
    return { latched: new Set() };
}

export interface MaybeFormatOutcome {
    /** The feedback block for the tool result (absent when nothing to say). */
    feedback?: string;
}

/**
 * The PostToolUse entry point: write/edit only, first matching rule, run it,
 * return the feedback line. Never throws; a missing config is a no-op.
 * `opts.projectDir` drives the project-scope lookup; the user scope needs
 * no project.
 */
export async function maybeFormatOnEdit(opts: {
    tool: string;
    path: string;
    projectDir: string;
    agentDir?: string;
    state: FormatterSessionState;
    cwd: string;
    run?: typeof runFormatter;
}): Promise<MaybeFormatOutcome> {
    if (opts.tool !== "write" && opts.tool !== "edit") return {};
    if (!opts.path) return {};
    let resolved: ResolvedFormattersConfig;
    try {
        resolved = loadFormattersConfig(opts.projectDir, opts.agentDir);
    } catch {
        return {}; // fail-open
    }
    if (resolved.config.formatters.length === 0) return {};
    const rule = matchFormatter(resolved.config.formatters, opts.path, opts.cwd);
    if (!rule) return {};
    const abs = isAbsolute(opts.path) ? opts.path : resolve(opts.cwd, opts.path);
    const run = opts.run ?? runFormatter;
    let result: FormatterRunResult;
    try {
        result = run(rule, abs);
    } catch (err: any) {
        return {}; // fail-open — a formatter must never break an edit
    }
    const name = basename(abs);
    const commandHead = rule.command.split(/\s+/)[0];
    if (result.error) {
        if (opts.state.latched.has(rule.command)) return {};
        opts.state.latched.add(rule.command);
        return {
            feedback: `[PostToolUse:formatter] ${commandHead} failed on ${name} (${result.error}) — formatters for this pattern are now silent for the session; the edit stands unformatted`,
        };
    }
    if (result.changed) {
        return {
            feedback: `[PostToolUse:formatter] ${commandHead} reformatted ${name} — the file on disk is now the formatted form; re-read it if you need byte-exact anchors`,
        };
    }
    return {}; // clean — no noise
}
