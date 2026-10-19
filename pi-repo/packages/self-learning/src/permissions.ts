/**
 * permissions.ts — granular user-configurable permissions (Claude Code / Cline port).
 *
 * A declarative allow/deny/ask layer ON TOP of the hard-coded guardrails in
 * termhooks.ts (catastrophic-command deny-list + write-path jail). The layer
 * can only ever ADD restrictions: the hard-coded checks run first and their
 * verdicts are final, so no rule — not even `bash allow *` — can unlock
 * `rm -rf /` or an out-of-jail write. When no rule matches, behavior is
 * byte-for-byte the pre-existing policy (zero-surprise rollout).
 *
 * Config files (both optional, JSON, same schema):
 *   <project>/.unown/permissions.json   project scope — TRUST-GATED exactly
 *                                       like .unown/mcp.json / .unown/lsp.json
 *                                       (config-trust.ts fingerprint pinning;
 *                                       a cloned repo is attacker-controlled)
 *   ~/.unown/agent/permissions.json     user scope — user-owned, always trusted
 *
 * Merge: user rules win over project rules for the same tool+pattern; project
 * rules fill the gaps. Evaluation: the MOST SPECIFIC matching rule wins
 * (specificity = literal, non-wildcard characters in the pattern; a rule with
 * no pattern is the least specific); at equal specificity deny beats
 * everything, and a session-learned allow beats a config ask (the user just
 * confirmed it) — see tieBreakWins for the full order.
 *
 * Pattern semantics (tiny built-in matcher — no new dependency):
 *   `*`   matches within one path segment (never crosses `/`)
 *   `**`  matches across segments (`src/**`, a `**` then a slash then
 *         `*.env*`); `**` before a slash may also match zero segments
 *   bash/powershell patterns match the whole command string with `*` matching
 *         any characters, so `bun test*` matches `bun test src/foo.ts` but
 *         not `bunx test` (first-token aware)
 *   edit/write/read patterns match project-relative paths (absolute paths
 *         inside the project are relativized)
 *   webfetch/fetch_url patterns match URLs (scheme+host case-insensitive)
 *   mcp patterns match `server/tool` against `mcp__server__tool` calls
 *
 * Modes:
 *   default           ask rules trigger a confirmation; everything else as above
 *   acceptEdits       ask rules on edit/write with IN-PROJECT paths are
 *                     auto-approved (the path jail still confines writes)
 *   bypassPermissions ask prompts are skipped (treated as allow) — deny rules
 *                     and the hard-coded guardrails STILL apply, and the mode
 *                     refuses to load under UNOWN_STRICT_HOOKS=1 (falls back
 *                     to default with a loud warning)
 *
 * The `ask` effect and the tool_call seam: pi's ToolCallEventResult is
 * {block, reason, terminate} and the runner AWAITS tool_call handlers, so an
 * interactive confirmation is possible via ctx.ui.select when ctx.hasUI is
 * true (TUI/RPC). Where no UI exists (print/json mode, missing ctx, a UI that
 * throws) the gate DEGRADES FAIL-CLOSED: the call is blocked with guidance to
 * add an allow rule. That degrade path is a documented product decision, not
 * a stub — see docs/permissions.md §ask.
 *
 * Learning (opt-in, no UI needed): UNOWN_PERMISSIONS_LEARN=1 — when a bash
 * command passes in default mode with NO matching rule, an allow rule for its
 * leading command (`bun test*` for `bun test src/foo.ts`) is appended to the
 * USER config (idempotent, atomic, never touches a malformed file). The ask
 * dialog's "Always allow (this session)" keeps the same rule in memory only;
 * with the learn knob on it is also persisted.
 *
 * Purity: node:fs/crypto/path + ./atomic.ts + ./config-trust.ts + ./term.ts
 * (agent-dir default) — no pi imports in the logic; only the tiny extension
 * factory touches the pi extension API (loosely typed, like termhooks.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { atomicWriteFileSync } from "./atomic.ts";
import { configFingerprint, trustApprovalNeeded, trustBypassed, trustConfig, trustStatePath } from "./config-trust.ts";
import { UNOWN_AGENT_DIR } from "./term.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type PermissionEffect = "allow" | "deny" | "ask";
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

/** One rule as it appears in a config file. */
export interface PermissionRule {
        tool: string;
        effect: PermissionEffect;
        /** Glob pattern; absent = the rule matches every call of the tool. */
        pattern?: string;
}

/** A rule with its provenance (merge precedence + the /permissions table). */
export interface SourcedRule extends PermissionRule {
        source: "project" | "user" | "session";
}

/** The config-file document. */
export interface PermissionsFile {
        version: 1;
        mode: PermissionMode;
        rules: PermissionRule[];
}

export interface PermissionScopeStatus {
        path: string;
        found: boolean;
        valid: boolean;
        /** project only: file is trusted (or the env bypass is on) */
        trusted: boolean;
        /** project only: found but NOT loaded (untrusted) */
        ignored: boolean;
        ruleCount: number;
}

export interface LoadedPermissions {
        /** UNOWN_PERMISSIONS=0 — the whole layer is inert (hard guardrails only). */
        disabled: boolean;
        /** Effective mode (after the strict-hook refusal of bypassPermissions). */
        mode: PermissionMode;
        /** Mode as written in the winning config file (diagnostics). */
        requestedMode: PermissionMode;
        rules: SourcedRule[];
        learn: boolean;
        project: PermissionScopeStatus;
        user: PermissionScopeStatus;
        warnings: string[];
}

export interface PermissionEvaluation {
        action: "allow" | "deny" | "ask" | "none";
        /** deny: "[unown-permissions] denied by rule …" — the block reason. */
        reason?: string;
        rule?: SourcedRule;
        subject: string;
}

/** Sync decision consumed by the termhooks tool_call seam. */
export interface PermissionSyncDecision {
        blocked: boolean;
        reason?: string;
        needsAsk?: boolean;
        evaluation?: PermissionEvaluation;
}

// ---------------------------------------------------------------------------
// Env knobs
// ---------------------------------------------------------------------------
export const PERMISSIONS_DISABLE_ENV = "UNOWN_PERMISSIONS";
export const PERMISSIONS_LEARN_ENV = "UNOWN_PERMISSIONS_LEARN";
export const STRICT_HOOKS_ENV = "UNOWN_STRICT_HOOKS";

/** How long the ask dialog waits before auto-dismissing (fail-closed). */
export const ASK_TIMEOUT_MS = 120_000;

/** `||`-style parsing like term.ts: an EMPTY string means unset (bun's .env). */
function flagOn(env: Record<string, string | undefined>, key: string): boolean {
        const raw = env[key] || "";
        return /^(1|true|yes)$/i.test(raw);
}
function flagOff(env: Record<string, string | undefined>, key: string): boolean {
        const raw = env[key] || "";
        return /^(0|false|no)$/i.test(raw);
}

// ---------------------------------------------------------------------------
// Known tool names (validation warnings only — unknown names are kept so
// custom/future tools can be governed; they just never match today)
// ---------------------------------------------------------------------------
const KNOWN_TOOL_NAMES = new Set([
        "bash",
        "powershell",
        "edit",
        "write",
        "read",
        "webfetch",
        "web_search",
        "mcp",
        "task",
        "note",
        "todo",
        "lsp",
        "fetch_url",
]);

export function isKnownToolName(tool: string): boolean {
        if (KNOWN_TOOL_NAMES.has(tool)) return true;
        // the automation_* family (automation_list/create/update/delete)
        return /^automation_[a-z0-9_]+$/.test(tool);
}

// ---------------------------------------------------------------------------
// Pattern matching — a tiny glob matcher (no dependency)
// ---------------------------------------------------------------------------

/**
 * Compile a permission pattern to an anchored RegExp.
 *
 * pathAware (paths, URLs, mcp names): `*` never crosses `/`; `**` does;
 * `**` followed by a slash may match zero segments. Bash mode (pathAware=false): `*` and `**`
 * both match any characters, so patterns are command-prefix globs.
 */
export function patternToRegex(pattern: string, pathAware: boolean): RegExp {
        const key = `${pathAware ? "p" : "b"}\u0000${pattern}`;
        const cached = REGEX_CACHE.get(key);
        if (cached) return cached;
        let re = "";
        for (let i = 0; i < pattern.length; i++) {
                const c = pattern[i];
                if (c === "*") {
                        let stars = 1;
                        while (pattern[i + 1] === "*") {
                                stars++;
                                i++;
                        }
                        if (stars >= 2) {
                                if (pattern[i + 1] === "/") {
                                        re += "(?:[^/]+/)*"; // `**/` — zero or more full segments
                                        i++; // consume the `/` (it is part of the construct)
                                } else {
                                        re += "[\\s\\S]*";
                                }
                        } else {
                                re += pathAware ? "[^/]*" : "[\\s\\S]*";
                        }
                } else if (/[.*+?^${}()|[\]\\]/.test(c)) {
                        re += `\\${c}`;
                } else {
                        re += c;
                }
        }
        const regex = new RegExp(`^${re}$`);
        if (REGEX_CACHE.size < 1000) REGEX_CACHE.set(key, regex); // bounded cache
        return regex;
}
const REGEX_CACHE = new Map<string, RegExp>();

/** Glob-match `value` against `pattern` (`*` segment-local, `**` crossing). */
export function globMatch(pattern: string, value: string, opts: { pathAware?: boolean } = {}): boolean {
        return patternToRegex(pattern, opts.pathAware !== false).test(value);
}

/** Path-aware matching per tool family: commands are free-form, the rest are slash-delimited. */
function pathAwareForTool(tool: string): boolean {
        return tool !== "bash" && tool !== "powershell";
}

// ---------------------------------------------------------------------------
// Subjects — what a rule's pattern is matched against for a given tool call
// ---------------------------------------------------------------------------

/** `mcp__server__tool` → `server/tool` (null when the name is not an mcp tool). */
export function mcpSubject(toolName: string): string | null {
        if (!toolName.startsWith("mcp__")) return null;
        const rest = toolName.slice("mcp__".length);
        const sep = rest.indexOf("__");
        if (sep <= 0) return rest; // malformed — match against the raw remainder
        return `${rest.slice(0, sep)}/${rest.slice(sep + 2)}`;
}

/** Normalize a path subject: forward slashes, no leading `./`, in-project absolutes relativized. */
export function normalizePathSubject(cwd: string, p: string): string {
        if (!p) return "";
        let norm = p.replace(/\\/g, "/");
        while (norm.startsWith("./")) norm = norm.slice(2);
        if (isAbsolute(p)) {
                const rel = relative(cwd, resolve(p)).replace(/\\/g, "/");
                if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
        }
        return norm;
}

/** Normalize a URL subject: scheme + host lowercased (the path stays case-sensitive). */
export function normalizeUrlSubject(url: string): string {
        if (!url) return "";
        const m = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/?#]*)([\s\S]*)$/);
        if (!m) return url;
        return `${m[1].toLowerCase()}${m[2].toLowerCase()}${m[3]}`;
}

/**
 * The string a rule's pattern matches for a tool call: bash/powershell → the
 * command; edit/write/read → the project-relative path; webfetch/fetch_url →
 * the URL; mcp tools → `server/tool`; then a generic chain (query/task/text/
 * op/…) so note/todo/lsp/task rules have something to match. Tools whose
 * input carries none of these get "" (pattern rules cannot match them;
 * pattern-less rules still do).
 */
export function extractSubject(tool: string, input: Record<string, unknown>, cwd: string): string {
        if (tool === "bash" || tool === "powershell") return String(input.command ?? "");
        if (tool.startsWith("mcp__")) {
                const s = mcpSubject(tool);
                if (s !== null) return s;
        }
        const path = input.path ?? input.file_path;
        if (typeof path === "string" && path) return normalizePathSubject(cwd, path);
        const url = input.url;
        if (typeof url === "string" && url) return normalizeUrlSubject(url);
        for (const key of ["command", "query", "task", "prompt", "description", "text", "op", "name"]) {
                const v = input[key];
                if (typeof v === "string" && v) return v;
        }
        return "";
}

/**
 * The pattern learned for a bash command: the leading command — first token,
 * plus the subcommand token when it is not a flag — with a trailing `*`.
 * `bun test src/foo.ts` → `bun test*`; `ls -la` → `ls*`.
 */
export function bashLearnPattern(command: string): string {
        const tokens = command.trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return "";
        let head = tokens[0];
        const second = tokens[1];
        if (second && !second.startsWith("-")) head = `${head} ${second}`;
        return `${head}*`;
}

// ---------------------------------------------------------------------------
// Config loading, validation, merge
// ---------------------------------------------------------------------------

export interface LoadPermissionsOptions {
        /** Strict-hook mode (bypassPermissions refuses to load). Default: env. */
        strict?: boolean;
        /** Trust-state file override (tests). Default: `<agentDir>/trusted-configs.json`. */
        statePath?: string;
}

interface ParsedScope {
        rules: SourcedRule[];
        valid: boolean;
        /** The file's declared mode (already normalized to a valid value). */
        mode: PermissionMode | undefined;
        warnings: string[];
}

function ruleKey(rule: PermissionRule): string {
        return `${rule.tool}\u0000${rule.pattern ?? ""}`;
}

function parseScope(file: string, source: "project" | "user"): ParsedScope {
        const empty: ParsedScope = { rules: [], valid: true, mode: undefined, warnings: [] };
        if (!existsSync(file)) return empty;
        let raw: string;
        try {
                raw = readFileSync(file, "utf8");
        } catch (err: any) {
                return { rules: [], valid: false, mode: undefined, warnings: [`unreadable ${source} permissions file ${file}: ${err?.message ?? err}`] };
        }
        let doc: any;
        try {
                doc = JSON.parse(raw);
        } catch (err: any) {
                return {
                        rules: [],
                        valid: false,
                        mode: undefined,
                        warnings: [`invalid JSON in ${source} permissions file ${file} — ignored, safe defaults active (${err?.message ?? err})`],
                };
        }
        if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
                return { rules: [], valid: false, mode: undefined, warnings: [`${source} permissions file ${file} is not a JSON object — ignored, safe defaults active`] };
        }
        if (doc.version !== undefined && doc.version !== 1) {
                return {
                        rules: [],
                        valid: false,
                        mode: undefined,
                        warnings: [`${source} permissions file ${file} has unsupported version ${JSON.stringify(doc.version)} (expected 1) — ignored, safe defaults active`],
                };
        }
        const warnings: string[] = [];
        let mode: PermissionMode | undefined = doc.mode;
        if (mode !== undefined && mode !== "default" && mode !== "acceptEdits" && mode !== "bypassPermissions") {
                warnings.push(`${source} permissions file ${file}: unknown mode ${JSON.stringify(doc.mode)} — using "default"`);
                mode = "default";
        }
        const rules: SourcedRule[] = [];
        if (doc.rules !== undefined && !Array.isArray(doc.rules)) {
                warnings.push(`${source} permissions file ${file}: "rules" is not an array — no rules loaded`);
        } else if (Array.isArray(doc.rules)) {
                doc.rules.forEach((entry: any, i: number) => {
                        const where = `${file} rules[${i}]`;
                        if (typeof entry !== "object" || entry === null) {
                                warnings.push(`${where}: not an object — skipped`);
                                return;
                        }
                        if (typeof entry.tool !== "string" || !entry.tool.trim()) {
                                warnings.push(`${where}: missing/empty "tool" — skipped`);
                                return;
                        }
                        const effect = entry.effect;
                        if (effect !== "allow" && effect !== "deny" && effect !== "ask") {
                                warnings.push(`${where}: effect must be allow|deny|ask (got ${JSON.stringify(entry.effect)}) — skipped`);
                                return;
                        }
                        let pattern = entry.pattern;
                        if (pattern !== undefined && typeof pattern !== "string") {
                                warnings.push(`${where}: pattern must be a string — skipped`);
                                return;
                        }
                        if (pattern === "") {
                                pattern = undefined; // "" behaves like no pattern (matches every call)
                        }
                        const tool = entry.tool.trim();
                        if (!isKnownToolName(tool)) {
                                warnings.push(`${where}: unknown tool name "${tool}" — rule kept (matches only if such a tool ever registers)`);
                        }
                        const rule: SourcedRule = { tool, effect, source };
                        if (pattern !== undefined) rule.pattern = pattern;
                        rules.push(rule);
                });
        }
        return { rules, valid: true, mode, warnings };
}

/**
 * Load + merge the permission configs. Pure (fs reads only), never throws —
 * every failure degrades to "no rules, default mode, a warning".
 */
export function loadPermissions(
        cwd: string,
        agentDir: string = UNOWN_AGENT_DIR,
        env: Record<string, string | undefined> = process.env,
        opts: LoadPermissionsOptions = {},
): LoadedPermissions {
        const projectFile = join(cwd, ".unown", "permissions.json");
        const userFile = join(agentDir, "permissions.json");
        const statePath = opts.statePath ?? trustStatePath(agentDir);
        const strict = opts.strict ?? flagOn(env, STRICT_HOOKS_ENV);
        const disabled = flagOff(env, PERMISSIONS_DISABLE_ENV);
        const learn = flagOn(env, PERMISSIONS_LEARN_ENV);
        const bypassed = trustBypassed(env);

        // User scope: user-owned dir — always loaded when present and valid.
        const userScope = parseScope(userFile, "user");

        // Project scope: trust-gated exactly like .unown/mcp.json / .unown/lsp.json
        // (an untrusted file is NEVER read for rules — only stat'd/fingerprinted).
        const projectFound = existsSync(projectFile);
        const projectTrusted =
                !projectFound ||
                bypassed ||
                !trustApprovalNeeded(projectFile, { statePath, userDir: agentDir, env });
        const projectIgnored = projectFound && !projectTrusted;
        const projectScope: ParsedScope = projectIgnored
                ? { rules: [], valid: true, mode: undefined, warnings: [] }
                : parseScope(projectFile, "project");

        const warnings: string[] = [];
        if (projectIgnored) {
                warnings.push(
                        `project .unown/permissions.json is untrusted — ignored (approve it with /permissions trust in a session, or set UNOWN_TRUST_PROJECT_CONFIG=1 for CI/headless)`,
                );
        }
        warnings.push(...projectScope.warnings, ...userScope.warnings);

        // Merge: user wins for the same tool+pattern; project fills the gaps.
        // Source order matters only for dedup — evaluation re-ranks by specificity.
        const merged = new Map<string, SourcedRule>();
        for (const rule of projectScope.rules) merged.set(ruleKey(rule), rule);
        for (const rule of userScope.rules) merged.set(ruleKey(rule), rule);
        const rules = [...merged.values()];

        // Mode: the user file's declaration wins; an ABSENT declaration lets
        // the project's apply (absence is not an override). A file that was
        // ignored (untrusted) or invalid contributes no mode.
        const requestedMode: PermissionMode = userScope.mode ?? projectScope.mode ?? "default";
        let mode = requestedMode;
        if (mode === "bypassPermissions" && strict) {
                mode = "default";
                warnings.push(
                        `permissions mode "bypassPermissions" refused under UNOWN_STRICT_HOOKS=1 — falling back to "default" (strict sessions never skip confirmations)`,
                );
        }

        return {
                disabled,
                mode,
                requestedMode,
                rules: disabled ? [] : rules,
                learn,
                project: {
                        path: projectFile,
                        found: projectFound,
                        valid: projectScope.valid,
                        trusted: projectTrusted,
                        ignored: projectIgnored,
                        ruleCount: projectScope.rules.length,
                },
                user: {
                        path: userFile,
                        found: existsSync(userFile),
                        valid: userScope.valid,
                        trusted: true,
                        ignored: false,
                        ruleCount: userScope.rules.length,
                },
                warnings,
        };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function specificity(rule: SourcedRule): number {
        if (!rule.pattern) return -1; // pattern-less = least specific
        return rule.pattern.replace(/\*/g, "").length;
}

const EFFECT_RANK: Record<PermissionEffect, number> = { deny: 3, ask: 2, allow: 1 };
const SOURCE_RANK: Record<SourcedRule["source"], number> = { session: 3, user: 2, project: 1 };

/**
 * Equal-specificity tie-break. Invariants, in order:
 *  1. deny ALWAYS wins over non-deny — nothing overrides a deny of the same
 *     specificity, not even a session confirmation (safety first).
 *  2. equal effects → session > user > project.
 *  3. allow vs ask (both non-deny): a SESSION allow beats a config ask (the
 *     user just confirmed "Always allow" for exactly this); otherwise ask
 *     beats allow (the stricter reading wins an ambiguous tie).
 */
function tieBreakWins(candidate: SourcedRule, best: SourcedRule): boolean {
        if (candidate.effect === "deny" && best.effect !== "deny") return true;
        if (candidate.effect !== "deny" && best.effect === "deny") return false;
        if (candidate.effect === best.effect) return SOURCE_RANK[candidate.source] > SOURCE_RANK[best.source];
        if (candidate.source === "session" && best.source !== "session") return true;
        if (candidate.source !== "session" && best.source === "session") return false;
        return EFFECT_RANK[candidate.effect] > EFFECT_RANK[best.effect];
}

function ruleMatchesTool(ruleTool: string, toolName: string): boolean {
        if (ruleTool === toolName) return true;
        // bash/powershell are the one command-execution tool under two platform
        // spellings — a rule for either governs both (deny symmetry is the safe side).
        if ((ruleTool === "bash" && toolName === "powershell") || (ruleTool === "powershell" && toolName === "bash")) return true;
        // the "mcp" tool name governs every concrete mcp__server__tool call
        if (ruleTool === "mcp" && toolName.startsWith("mcp__")) return true;
        return false;
}

function ruleMatches(rule: SourcedRule, toolName: string, subject: string): boolean {
        if (!ruleMatchesTool(rule.tool, toolName)) return false;
        if (rule.pattern === undefined) return true; // matches every call of the tool
        if (!subject) return false; // nothing to match a pattern against
        return globMatch(rule.pattern, subject, { pathAware: pathAwareForTool(rule.tool) });
}

/** After normalization: a bare relative path is in-project; `../…`, absolute and drive paths are not. */
function subjectInProject(subject: string): boolean {
        if (!subject) return false;
        if (subject === ".." || subject.startsWith("../")) return false;
        if (subject.startsWith("/")) return false;
        if (/^[a-zA-Z]:/.test(subject)) return false;
        return true;
}

/**
 * Evaluate the merged rules against one tool call.
 *
 * Most specific match wins; ties: deny > ask > allow, then session > user >
 * project. Mode adjustments: bypassPermissions treats ask as allow;
 * acceptEdits auto-approves ask on edit/write with in-project paths.
 */
export function evaluatePermissions(
        loaded: LoadedPermissions,
        tool: string,
        subject: string,
        sessionRules: SourcedRule[] = [],
): PermissionEvaluation {
        if (loaded.disabled) return { action: "none", subject };
        const candidates = [...loaded.rules, ...sessionRules].filter((r) => ruleMatches(r, tool, subject));
        if (candidates.length === 0) return { action: "none", subject };

        let best = candidates[0];
        for (const rule of candidates.slice(1)) {
                if (specificity(rule) > specificity(best)) {
                        best = rule;
                        continue;
                }
                if (specificity(rule) === specificity(best) && tieBreakWins(rule, best)) {
                        best = rule;
                }
        }

        if (best.effect === "deny") {
                return {
                        action: "deny",
                        reason: `[unown-permissions] denied by rule ${best.pattern ? `"${best.pattern}" ` : ""}(${best.tool}, ${best.source}) — edit .unown/permissions.json / ~/.unown/agent/permissions.json or see docs/permissions.md`,
                        rule: best,
                        subject,
                };
        }
        if (best.effect === "ask") {
                if (loaded.mode === "bypassPermissions") return { action: "allow", rule: best, subject };
                if (
                        loaded.mode === "acceptEdits" &&
                        (tool === "edit" || tool === "write") &&
                        subjectInProject(subject)
                ) {
                        return { action: "allow", rule: best, subject };
                }
                return { action: "ask", rule: best, subject };
        }
        return { action: "allow", rule: best, subject };
}

// ---------------------------------------------------------------------------
// Learning — append an allow rule to the USER config (atomic, non-destructive)
// ---------------------------------------------------------------------------

/** Upper bound on learned rules in one file — unbounded growth is a footgun. */
export const LEARNED_RULES_CAP = 1000;

/** Read a permissions file's rules array (empty on any error) — diagnostics/tests. */
export function parsePersistedRules(file: string): PermissionRule[] {
        try {
                const doc = JSON.parse(readFileSync(file, "utf8"));
                if (typeof doc !== "object" || doc === null || !Array.isArray(doc.rules)) return [];
                return doc.rules.filter(
                        (r: any): r is PermissionRule =>
                                typeof r === "object" && r !== null && typeof r.tool === "string" && (r.effect === "allow" || r.effect === "deny" || r.effect === "ask"),
                );
        } catch {
                return [];
        }
}

export interface PersistResult {
        ok: boolean;
        note?: string;
}

/**
 * Add (or flip) `{tool, allow, pattern}` in the user permissions file.
 * - existing identical allow → no-op
 * - existing ask with the same tool+pattern → flipped to allow (explicit user intent)
 * - existing deny with the same tool+pattern → NOT overridden (deny wins; noted)
 * - malformed file → left untouched (learning skipped, non-destructive)
 * Unknown top-level keys are preserved.
 */
export function persistLearnedAllow(userFile: string, tool: string, pattern: string): PersistResult {
        let doc: any;
        try {
                if (existsSync(userFile)) {
                        doc = JSON.parse(readFileSync(userFile, "utf8"));
                        if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
                                return { ok: false, note: "user permissions file is not a JSON object — learning skipped" };
                        }
                }
        } catch {
                return { ok: false, note: "user permissions file is not valid JSON — learning skipped (fix it by hand)" };
        }
        if (doc === undefined) doc = {};
        if (!Array.isArray(doc.rules)) doc.rules = [];
        if (doc.version === undefined) doc.version = 1;
        if (doc.mode === undefined) doc.mode = "default";
        if (doc.rules.length >= LEARNED_RULES_CAP) {
                return { ok: false, note: `user permissions file already has ${doc.rules.length} rules (cap ${LEARNED_RULES_CAP}) — learning skipped` };
        }
        const existing = doc.rules.find(
                (r: any) => typeof r === "object" && r !== null && r.tool === tool && (r.pattern ?? "") === pattern,
        );
        if (existing) {
                if (existing.effect === "allow") return { ok: true, note: "already present" };
                if (existing.effect === "ask") {
                        existing.effect = "allow"; // the user confirmed — flip the ask rule
                } else {
                        return { ok: false, note: "a deny rule for the same tool+pattern exists — not overridden" };
                }
        } else {
                doc.rules.push({ tool, effect: "allow", pattern });
        }
        try {
                atomicWriteFileSync(userFile, `${JSON.stringify(doc, null, 2)}\n`);
                return { ok: true };
        } catch (err: any) {
                return { ok: false, note: `write failed: ${err?.message ?? err}` };
        }
}

// ---------------------------------------------------------------------------
// The gate — per-session state shared by the termhooks seam and /permissions
// ---------------------------------------------------------------------------

export interface PermissionGateOptions {
        cwd: string;
        /** Default: UNOWN_AGENT_DIR (~/.unown/agent). */
        agentDir?: string;
        /** Default: process.env (tests inject). */
        env?: Record<string, string | undefined>;
        /** Default: parsed from env.UNOWN_STRICT_HOOKS. */
        strict?: boolean;
        verbose?: boolean;
        /** Trust-state file override (tests). */
        statePath?: string;
}

export interface PermissionsStatus {
        disabled: boolean;
        mode: PermissionMode;
        requestedMode: PermissionMode;
        learn: boolean;
        trustBypassed: boolean;
        project: PermissionScopeStatus;
        user: PermissionScopeStatus;
        rules: SourcedRule[];
        sessionRuleCount: number;
        warnings: string[];
}

/** The decision shape termhooks returns from the tool_call seam. */
export interface ToolCallDecision {
        block: boolean;
        reason?: string;
        terminate?: boolean;
}

const PROCEED: PermissionSyncDecision = { blocked: false };

export interface PermissionGate {
        /** Sync check (hard-coded guardrails have ALREADY passed when this runs). */
        check(tool: string, input: Record<string, unknown>): PermissionSyncDecision;
        /**
         * The ask flow. Returns a thenable resolving to {block, reason} | undefined
         * (undefined = proceed). Degrades fail-closed when no UI is available.
         */
        handleAsk(tool: string, input: Record<string, unknown>, evaluation: PermissionEvaluation, ctx: unknown): Promise<ToolCallDecision | undefined>;
        /** Remember an allow rule for this session only ("Always allow (this session)"). */
        rememberSessionAllow(tool: string, subject: string): string | null;
        /** Re-read the config files (used by /permissions after trust/reload). */
        reload(): void;
        status(): PermissionsStatus;
        /** One-shot notice when the project config is untrusted (null after first read). */
        consumeUntrustedNotice(): string | null;
}

export function createPermissionGate(opts: PermissionGateOptions): PermissionGate {
        const cwd = opts.cwd;
        const agentDir = opts.agentDir ?? UNOWN_AGENT_DIR;
        const env = opts.env ?? process.env;
        const statePath = opts.statePath ?? trustStatePath(agentDir);
        const log = (msg: string) => {
                if (opts.verbose) console.error(`[unown] permissions: ${msg}`);
        };

        let loaded = loadPermissions(cwd, agentDir, env, { strict: opts.strict, statePath });
        const sessionRules: SourcedRule[] = [];
        const learnedMemo = new Set<string>();
        let untrustedNoticePending =
                loaded.project.ignored ? "unown: project .unown/permissions.json is untrusted — its rules are ignored. Approve it with /permissions trust." : null;

        /** The pattern remembered for a session always-allow on a concrete call. */
        const sessionPatternFor = (tool: string, subject: string): string | null => {
                if (!subject) return null;
                if (tool === "bash" || tool === "powershell") return bashLearnPattern(subject);
                return subject; // exact path/URL/server-tool — minimal authority
        };

        const gate: PermissionGate = {
                check(tool, input) {
                        try {
                                if (loaded.disabled) return PROCEED;
                                const subject = extractSubject(tool, input, cwd);
                                const evaluation = evaluatePermissions(loaded, tool, subject, sessionRules);
                                if (evaluation.action === "deny") {
                                        log(`DENY ${tool}: rule ${evaluation.rule?.pattern ?? "(any)"} (${evaluation.rule?.source})`);
                                        return { blocked: true, reason: evaluation.reason, evaluation };
                                }
                                if (evaluation.action === "ask") return { blocked: false, needsAsk: true, evaluation };
                                if (evaluation.action === "none" && loaded.learn && loaded.mode === "default") {
                                        maybeLearn(tool, subject);
                                }
                                return PROCEED;
                        } catch (err: any) {
                                // The layer augments; a bug in it must never break the session —
                                // fail open to the (already-passed) hard-coded guardrails.
                                log(`check failed (fail-open): ${err?.message ?? err}`);
                                return PROCEED;
                        }
                },

                async handleAsk(tool, _input, evaluation, ctx) {
                        try {
                                const rule = evaluation.rule;
                                const pattern = rule?.pattern ?? "(any)";
                                const subject = evaluation.subject;
                                const preview = subject ? ` ${subject.slice(0, 120)}${subject.length > 120 ? "…" : ""}` : "";
                                const c = ctx as
                                        | { hasUI?: boolean; ui?: { select?: (t: string, o: string[], opts?: any) => Promise<string | undefined> } }
                                        | null
                                        | undefined;
                                if (!c || c.hasUI !== true || typeof c.ui?.select !== "function") {
                                        return degradeAsk(tool, pattern);
                                }
                                const picked = await c.ui.select(
                                        `unown permissions: ${tool}${preview} matched ask rule "${pattern}" (${rule?.source}). Proceed?`,
                                        ["Allow once", "Always allow (this session)", "Deny"],
                                        { timeout: ASK_TIMEOUT_MS },
                                );
                                if (picked === "Always allow (this session)") {
                                        const pattern2 = gate.rememberSessionAllow(tool, subject);
                                        if (loaded.learn && pattern2) {
                                                const res = persistLearnedAllow(join(agentDir, "permissions.json"), tool, pattern2);
                                                log(`learned allow rule ${tool} ${pattern2}: ${res.ok ? "persisted" : res.note ?? "not persisted"}`);
                                        }
                                        return undefined;
                                }
                                if (picked === "Allow once") return undefined;
                                // "Deny", dialog dismissed, or timeout — fail closed.
                                return {
                                        block: true,
                                        reason: `[unown-permissions] ${tool} call denied at the confirmation prompt (ask rule "${pattern}")`,
                                        terminate: false,
                                };
                        } catch (err: any) {
                                log(`ask failed (fail-closed): ${err?.message ?? err}`);
                                return degradeAsk(tool, evaluation.rule?.pattern ?? "(any)");
                        }
                },

                rememberSessionAllow(tool, subject) {
                        const pattern = sessionPatternFor(tool, subject);
                        if (!pattern) return null;
                        const existing = sessionRules.find((r) => r.tool === tool && r.pattern === pattern);
                        if (existing) return pattern;
                        sessionRules.push({ tool, effect: "allow", pattern, source: "session" });
                        log(`session allow: ${tool} ${pattern}`);
                        return pattern;
                },

                reload() {
                        loaded = loadPermissions(cwd, agentDir, env, { strict: opts.strict, statePath });
                        if (loaded.project.ignored && !untrustedNoticePending) {
                                untrustedNoticePending = "unown: project .unown/permissions.json is untrusted — its rules are ignored. Approve it with /permissions trust.";
                        }
                },

                status() {
                        return {
                                disabled: loaded.disabled,
                                mode: loaded.mode,
                                requestedMode: loaded.requestedMode,
                                learn: loaded.learn,
                                trustBypassed: trustBypassed(env),
                                project: loaded.project,
                                user: loaded.user,
                                rules: loaded.rules,
                                sessionRuleCount: sessionRules.length,
                                warnings: loaded.warnings,
                        };
                },

                consumeUntrustedNotice() {
                        const notice = untrustedNoticePending;
                        untrustedNoticePending = null;
                        return notice;
                },
        };

        function maybeLearn(tool: string, subject: string): void {
                if (tool !== "bash" && tool !== "powershell") return; // spec: bash commands
                if (!subject.trim()) return;
                const pattern = bashLearnPattern(subject);
                if (!pattern || learnedMemo.has(pattern)) return;
                learnedMemo.add(pattern);
                const res = persistLearnedAllow(join(agentDir, "permissions.json"), tool, pattern);
                log(`learned allow rule ${tool} ${pattern}: ${res.ok ? "persisted to user config" : res.note ?? "not persisted"}`);
        }

        function degradeAsk(tool: string, pattern: string): ToolCallDecision {
                return {
                        block: true,
                        reason:
                                `[unown-permissions] ${tool} matched ask rule "${pattern}" — interactive confirmation is unavailable in this mode, ` +
                                "so the call is blocked (fail-closed). Add an allow rule to .unown/permissions.json or ~/.unown/agent/permissions.json " +
                                "(see docs/permissions.md), or re-run in an interactive session.",
                        terminate: false,
                };
        }

        return gate;
}

// ---------------------------------------------------------------------------
// Rendering (/permissions) + doctor summary
// ---------------------------------------------------------------------------

export function renderPermissionsStatus(status: PermissionsStatus): string {
        const lines: string[] = [];
        if (status.disabled) {
                lines.push("unown permissions — DISABLED (UNOWN_PERMISSIONS=0; hard-coded guardrails still active)");
                lines.push("  re-enable by unsetting the variable — see docs/permissions.md");
                return lines.join("\n");
        }
        const modeNote =
                status.requestedMode !== status.mode ? ` (requested "${status.requestedMode}" — refused under UNOWN_STRICT_HOOKS=1)` : "";
        lines.push(`unown permissions — mode: ${status.mode}${modeNote}`);
        const describeScope = (s: PermissionScopeStatus, label: string): string => {
                if (!s.found) return `  ${label}: ${s.path} (not found — defaults active)`;
                if (label === "project" && s.ignored) {
                        return `  ${label}: ${s.path} — UNTRUSTED (ignored; run /permissions trust in this session${
                                status.trustBypassed ? "" : " or set UNOWN_TRUST_PROJECT_CONFIG=1 for CI"
                        })`;
                }
                if (!s.valid) return `  ${label}: ${s.path} — INVALID (ignored; safe defaults active)`;
                return `  ${label}: ${s.path} — ${s.ruleCount} rule(s)`;
        };
        lines.push(describeScope(status.project, "project"));
        lines.push(describeScope(status.user, "user   "));
        lines.push(`  learn: ${status.learn ? "ON (UNOWN_PERMISSIONS_LEARN=1 — passed bash commands append allow rules to the user config)" : "off (set UNOWN_PERMISSIONS_LEARN=1 to enable)"}`);
        if (status.sessionRuleCount > 0) lines.push(`  session: ${status.sessionRuleCount} always-allow rule(s) confirmed this session`);
        if (status.rules.length === 0) {
                lines.push("  rules: (none — the hard-coded guardrails alone are active)");
        } else {
                lines.push("  rules:");
                const pad = (s: string, n: number) => (s.length >= n ? s : `${s}${" ".repeat(n - s.length)}`);
                lines.push(`    ${pad("tool", 14)}${pad("effect", 7)}${pad("pattern", 28)}source`);
                for (const r of status.rules) {
                        lines.push(`    ${pad(r.tool, 14)}${pad(r.effect, 7)}${pad(r.pattern ?? "(any)", 28)}${r.source}`);
                }
        }
        for (const w of status.warnings) lines.push(`  ⚠ ${w}`);
        lines.push("  reference: docs/permissions.md");
        return lines.join("\n");
}

/** `unown doctor`'s permissions check — warn-level by doctor's contract. */
export function permissionsDoctorSummary(
        cwd: string,
        agentDir: string = UNOWN_AGENT_DIR,
        env: Record<string, string | undefined> = process.env,
        opts: LoadPermissionsOptions = {},
): { ok: boolean; detail: string } {
        try {
                const loaded = loadPermissions(cwd, agentDir, env, opts);
                if (loaded.disabled) return { ok: true, detail: "disabled (UNOWN_PERMISSIONS=0) — hard-coded guardrails only" };
                if (loaded.project.ignored) {
                        return {
                                ok: false,
                                detail: `project .unown/permissions.json untrusted — ignored (run /permissions trust in a session, or set UNOWN_TRUST_PROJECT_CONFIG=1)`,
                        };
                }
                const problems = loaded.warnings;
                if (problems.length > 0) {
                        return { ok: false, detail: `${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}` };
                }
                if (!loaded.project.found && !loaded.user.found) {
                        return { ok: true, detail: "no permissions config — defaults active (docs/permissions.md)" };
                }
                const parts = [
                        `mode ${loaded.mode}`,
                        `${loaded.rules.length} rule(s) (project ${loaded.project.ruleCount}, user ${loaded.user.ruleCount})`,
                        `learn ${loaded.learn ? "on" : "off"}`,
                ];
                if (loaded.requestedMode !== loaded.mode) parts.push(`requested "${loaded.requestedMode}" refused (strict hooks)`);
                return { ok: true, detail: parts.join(" · ") };
        } catch (err: any) {
                return { ok: true, detail: `check failed (fail-open): ${err?.message ?? err}` };
        }
}

// ---------------------------------------------------------------------------
// The /permissions session command (inline extension, wired alongside the
// terminal extension in cli.ts — same shape as termhooks' factory)
// ---------------------------------------------------------------------------

export interface PermissionsExtensionOptions {
        cwd: string;
        agentDir?: string;
        env?: Record<string, string | undefined>;
        verbose?: boolean;
        /** Shared gate (cli.ts injects the termhooks gate so state is session-wide). */
        gate?: PermissionGate;
        statePath?: string;
}

export function createPermissionsExtension(opts: PermissionsExtensionOptions) {
        const cwd = opts.cwd;
        const agentDir = opts.agentDir ?? UNOWN_AGENT_DIR;
        const env = opts.env ?? process.env;
        const statePath = opts.statePath ?? trustStatePath(agentDir);
        const log = (msg: string) => {
                if (opts.verbose) console.error(`[unown] permissions: ${msg}`);
        };
        const getGate = (): PermissionGate =>
                opts.gate ??
                createPermissionGate({ cwd, agentDir, env, verbose: opts.verbose, statePath });

        const factory = (pi: any) => {
                pi.registerCommand("permissions", {
                        description: "Granular permissions status: /permissions — /permissions trust approves a project .unown/permissions.json",
                        handler: async (args: string, ctx: any) => {
                                try {
                                        const sub = ((args ?? "").trim().split(/\s+/)[0] ?? "").toLowerCase();
                                        const gate = getGate();
                                        if (sub === "trust") {
                                                const projectFile = join(cwd, ".unown", "permissions.json");
                                                if (!existsSync(projectFile)) {
                                                        ctx?.ui?.notify?.("No project .unown/permissions.json found — nothing to trust.", "info");
                                                        return;
                                                }
                                                if (trustBypassed(env)) {
                                                        ctx?.ui?.notify?.("UNOWN_TRUST_PROJECT_CONFIG is set — the trust gate is already bypassed.", "info");
                                                        return;
                                                }
                                                const fingerprint = configFingerprint(projectFile);
                                                if (!fingerprint) {
                                                        ctx?.ui?.notify?.(`Trusting ${projectFile} failed (unreadable file).`, "error");
                                                        return;
                                                }
                                                const ok = trustConfig(projectFile, { statePath, userDir: agentDir, env });
                                                if (!ok) {
                                                        ctx?.ui?.notify?.(`Trusting ${projectFile} failed (unwritable trust state).`, "error");
                                                        return;
                                                }
                                                log(`trusted ${projectFile}`);
                                                gate.reload();
                                                const status = gate.status();
                                                ctx?.ui?.notify?.(
                                                        `Trusted ${projectFile} — ${status.project.ruleCount} project rule(s) now active.`,
                                                        "info",
                                                );
                                                ctx?.ui?.notify?.(renderPermissionsStatus(status), "info");
                                                return;
                                        }
                                        if (sub !== "") {
                                                ctx?.ui?.notify?.(`Unknown /permissions argument "${sub}". Usage: /permissions [trust]`, "info");
                                                return;
                                        }
                                        gate.reload(); // show the files as they are NOW, not as the session booted
                                        ctx?.ui?.notify?.(renderPermissionsStatus(gate.status()), "info");
                                } catch (err: any) {
                                        ctx?.ui?.notify?.(`Permissions command failed: ${err?.message ?? err}`, "error");
                                }
                        },
                });
        };

        return { name: "unown-permissions", factory, hidden: true } as const;
}
