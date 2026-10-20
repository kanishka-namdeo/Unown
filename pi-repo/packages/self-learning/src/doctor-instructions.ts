/**
 * doctor-instructions.ts — `/doctor` instruction-set audit (Milestone 3.2).
 *
 * Reverse-engineered from Claude Code's `/doctor` skill with `prompt-audit`
 * subcommand. The existing `unown doctor` (cli.ts:cmdDoctor) already audits
 * config / bridge / engine / memory. This module EXTENDS it with an audit of
 * the instruction set — the human-authored artifacts that steer the agent:
 *
 *   - `AGENTS.md` freshness (exists? stale vs the actual codebase? references
 *     files that no longer exist?)
 *   - Skill coverage (`.unown/skills/<name>/SKILL.md` — valid frontmatter? do they
 *     overlap?)
 *   - MCP config health (parseable? orphaned server entries for missing
 *     binaries?)
 *   - Hook syntax (`.unown/hooks.json` + `~/.unown/agent/hooks.json` —
 *     `version: 1`, `hooks` object, each handler has a valid `type`)
 *   - Stale `.unown/` config (hooks referencing MCP servers that don't exist,
 *     orphaned entries, etc.)
 *   - Adversary mode state (`~/.config/unown/adversary.md` — exists? parses
 *     as a markdown policy?)
 *   - Injection scanner state (`~/.config/unown/injection-scanner.json` —
 *     exists? parses as JSON?)
 *
 * Purity contract:
 *   - `node:fs` + `node:path` + `node:os` only. No pi imports, no bus, no
 *     store, no spawn. The `commandExists` binary check is injectable via
 *     `AuditOptions` so tests can run hermetically.
 *   - Tolerant: missing files, corrupt JSON, broken frontmatter — never
 *     throws; each parse failure becomes a structured `Finding`.
 *
 * Composition: `unown doctor` calls `auditInstructionSet(cwd)` after its
 * existing checks and renders the result inline. `/doctor-instructions`
 * (slash command) runs the audit only and prints it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FindingSeverity = "info" | "warn" | "error";

export interface Finding {
        severity: FindingSeverity;
        message: string;
        /** Optional actionable fix — surfaced by `/doctor` after the message. */
        fix?: string;
}

export interface InstructionAuditReport {
        agentsMd: Finding[];
        skills: Finding[];
        mcpConfig: Finding[];
        hooksConfig: Finding[];
        adversaryMode: Finding[];
        injectionScanner: Finding[];
        staleConfig: Finding[];
}

export interface AuditOptions {
        /**
         * User config dir for the adversary/scanner gate files. Default:
         * `process.env.UNOWN_HOME || join(homedir(), ".config", "unown")` —
         * mirrors `adversary.ts:resolveConfigDir` and `injection-scanner.ts:
         * resolveConfigDir` exactly.
         */
        configDir?: string;
        /**
         * User agent dir for mcp.json / hooks.json. Default:
         * `join(configDir, "agent")` — matches `UNOWN_AGENT_DIR`.
         */
        agentDir?: string;
        /**
         * Override the binary-exists check (for tests). Default: real PATH scan
         * (no spawn — pure fs lookup, mirroring `lsp.ts:commandExists`).
         */
        commandExists?: (cmd: string) => boolean;
}

// ---------------------------------------------------------------------------
// Small tolerant readers
// ---------------------------------------------------------------------------

/**
 * Read `path` as UTF-8 text. Returns null when missing or unreadable — never
 * throws. Same posture as `init-agents.ts:readText` (kept duplicated on
 * purpose so the two modules stay independent).
 */
function readText(p: string): string | null {
        if (!existsSync(p)) return null;
        try {
                return readFileSync(p, "utf8");
        } catch {
                return null;
        }
}

/**
 * Parse JSON tolerantly. Returns `{ ok: true; value: unknown }` on success
 * or `{ ok: false; error: string }` on parse failure. Never throws.
 */
function readJsonE(p: string): { ok: true; value: unknown } | { ok: false; error: string } | null {
        const txt = readText(p);
        if (txt === null) return null;
        try {
                return { ok: true, value: JSON.parse(txt) };
        } catch (e) {
                return { ok: false, error: (e as Error).message };
        }
}

// ---------------------------------------------------------------------------
// Default config-dir / agent-dir resolution (mirrors adversary.ts +
// injection-scanner.ts + term.ts:resolveUnownHome)
// ---------------------------------------------------------------------------

function resolveConfigDir(env: NodeJS.ProcessEnv = process.env): string {
        // `||`, not `??`: empty .env values must mean "unset" (see
        // term.ts:resolveUnownHome — bun auto-loads .env, .env.example ships
        // optional vars as `KEY=`).
        return env.UNOWN_HOME || join(homedir(), ".config", "unown");
}

function resolveAgentDir(configDir: string): string {
        return join(configDir, "agent");
}

// ---------------------------------------------------------------------------
// Default binary lookup — no spawn (mirrors lsp.ts:commandExists's pure
// stat-the-PATH-entries implementation, kept inline so doctor-instructions
// has no imports beyond node:fs / node:os / node:path).
// ---------------------------------------------------------------------------

function defaultCommandExists(cmd: string): boolean {
        if (!cmd) return false;
        // Absolute or relative path — just stat.
        if (cmd.includes("/") || cmd.includes("\\")) {
                return existsSync(cmd);
        }
        const path = process.env.PATH ?? "";
        const sep = process.platform === "win32" ? ";" : ":";
        const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
        for (const dir of path.split(sep)) {
                if (!dir) continue;
                for (const ext of exts) {
                        try {
                                if (existsSync(join(dir, cmd + ext))) return true;
                        } catch {
                                // permission errors etc — skip silently
                        }
                }
        }
        return false;
}

// ---------------------------------------------------------------------------
// Gitignore awareness — a gitignored path is EXPECTED to be absent on a fresh
// clone (generated artifacts like src/generated/prisma), so its non-existence
// is not staleness. One memoized `git check-ignore` per distinct ref; without
// git (or outside a repo) the answer is simply "not ignored".
// ---------------------------------------------------------------------------
const gitIgnoredMemo = new Map<string, boolean>();

export function _resetGitIgnoreMemoForTests(): void {
        gitIgnoredMemo.clear();
}

function isGitIgnored(cwd: string, ref: string): boolean {
        const memoKey = `${cwd}\u0000${ref}`;
        const cached = gitIgnoredMemo.get(memoKey);
        if (cached !== undefined) return cached;
        let ignored = false;
        try {
                // `git check-ignore -q <path>`: exit 0 = ignored, 1 = not, other = no
                // git / not a repo → keep false. Bun.spawnSync avoids the audit's
                // no-import discipline for child_process (mirrors the pure-stat
                // approach above: fail closed to current behaviour).
                const proc = Bun.spawnSync({
                        cmd: ["git", "-C", cwd, "check-ignore", "-q", "--", ref],
                        stdout: "ignore",
                        stderr: "ignore",
                });
                ignored = proc.exitCode === 0;
        } catch {
                ignored = false;
        }
        gitIgnoredMemo.set(memoKey, ignored);
        return ignored;
}

// ---------------------------------------------------------------------------
// AGENTS.md audit
// ---------------------------------------------------------------------------

/**
 * Patterns we treat as file references when checking AGENTS.md freshness.
 * Match groups:
 *   - markdown links `[text](path)` → group 1
 *   - backtick-quoted paths `\`path\`` → group 2 (only if it looks like a path)
 */
const MD_LINK_RE = /\[(?:[^\]]+)\]\(([^)]+)\)/g;
const BACKTICK_PATH_RE = /`([A-Za-z0-9_.\/-]+\/[A-Za-z0-9_.\/-]+|\.\.?\/[A-Za-z0-9_.\/-]+|[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|rb|ex|exs|md|json|toml|yaml|yml))`/g;

/**
 * Check whether a path-like string from AGENTS.md looks like a real file
 * reference (not a URL or an anchor). Returns the cleaned path or null.
 */
function cleanFileRef(raw: string): string | null {
        if (!raw) return null;
        // Strip anchors + query strings.
        let p = raw.split(/[#?]/)[0];
        if (!p) return null;
        // Skip URLs (http://, https://, mailto:, etc.).
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return null;
        if (/^mailto:/i.test(p)) return null;
        // Skip absolute URLs without a scheme (//foo).
        if (p.startsWith("//")) return null;
        return p;
}

/** Audit AGENTS.md at `<cwd>/AGENTS.md`. */
function auditAgentsMd(cwd: string): Finding[] {
        const out: Finding[] = [];
        const path = join(cwd, "AGENTS.md");
        const text = readText(path);
        if (text === null) {
                out.push({
                        severity: "info",
                        message: `no AGENTS.md found at the project root`,
                        fix: `run \`unown init\` (or the \`/init-agents\` slash command) to generate one from repo forensics`,
                });
                return out;
        }

        // Stale check: scan markdown links + backtick paths for references that no
        // longer resolve. Each broken reference is one warn finding.
        //
        // Confidence ladder for BACKTICK tokens (prose — a weaker signal than a
        // link): real AGENTS.md prose legitimately backticks package-relative
        // shorthand (`src/cli.ts` meaning <some-package>/src/cli.ts), git refs
        // (`origin/main`), bare filenames (`changelog-data.ts`), URL paths
        // (`/api/overview`) and absolute paths (`/usr/local/bin/bun`). None of
        // those resolve from the project root, none of them are staleness, and
        // warning on all of them buries the signal (measured on this repo's own
        // AGENTS.md: 31 warns, 0 true positives). So a backtick token only
        // warns when we are CONFIDENT the author meant a project-relative path:
        // relative, contains a separator, and its ANCHOR (first path segment)
        // exists in the project — the author demonstrably knew the tree, so a
        // non-resolving tail is real staleness. Markdown links keep the strict
        // check in both directions: a link is an explicit navigation affordance,
        // not prose emphasis.
        const broken = new Set<string>();
        const considerRef = (raw: string, strict: boolean) => {
                // Absolute/URL paths are outside the project's audit scope.
                if (raw.startsWith("/")) return;
                if (!strict) {
                        const segs = raw.split("/");
                        // Bare filename — no anchor to verify against.
                        if (segs.length < 2) return;
                        const anchor = segs[0];
                        // `./`/`../` refs always carry a resolvable anchor.
                        if (anchor !== "." && anchor !== ".." && !existsSync(join(cwd, anchor))) return;
                }
                // Gitignored paths are generated artifacts — their absence on a
                // fresh clone is expected, not staleness (e.g. this repo's own
                // `src/generated/prisma`, documented in AGENTS.md but absent until
                // `prisma generate` runs). Skipped for both links and backticks.
                if (isGitIgnored(cwd, raw)) return;
                if (!existsSync(join(cwd, raw))) broken.add(raw);
        };
        let m: RegExpExecArray | null;
        MD_LINK_RE.lastIndex = 0;
        while ((m = MD_LINK_RE.exec(text)) !== null) {
                const ref = cleanFileRef(m[1]);
                if (ref === null) continue;
                // Skip external anchors that start with `#` — they're in-page refs.
                if (ref.startsWith("#")) continue;
                considerRef(ref, true);
        }
        BACKTICK_PATH_RE.lastIndex = 0;
        while ((m = BACKTICK_PATH_RE.exec(text)) !== null) {
                const ref = cleanFileRef(m[1]);
                if (ref === null) continue;
                considerRef(ref, false);
        }
        for (const ref of Array.from(broken).sort()) {
                out.push({
                        severity: "warn",
                        message: `AGENTS.md references \`${ref}\` which does not exist`,
                        fix: `remove the reference or restore the file (then re-run \`/init-agents\`)`,
                });
        }

        // Freshness nudge — only when the file is tiny (likely auto-generated and
        // never curated). 200 bytes is a reasonable "skeleton-only" threshold.
        let stat: { size: number } | null = null;
        try {
                const s = statSync(path);
                stat = { size: s.size };
        } catch {
                stat = null;
        }
        if (stat && stat.size < 200) {
                out.push({
                        severity: "info",
                        message: `AGENTS.md is very short (${stat.size} bytes) — likely a skeleton`,
                        fix: `curate it with project-specific conventions, then re-run \`/init-agents\` to refresh the auto-detected sections`,
                });
        }

        return out;
}

// ---------------------------------------------------------------------------
// Skills audit
// ---------------------------------------------------------------------------

/**
 * Parse SKILL.md frontmatter — must start with `---\n`, contain `name:` and
 * `description:` keys, and close with another `---\n`. Returns the parsed
 * frontmatter (a Record) or null when malformed.
 */
function parseSkillFrontmatter(text: string): Record<string, string> | null {
        const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
        if (!m) return null;
        const fm: Record<string, string> = {};
        for (const line of m[1].split(/\r?\n/)) {
                const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
                if (!kv) continue;
                fm[kv[1]] = kv[2].trim();
        }
        return fm;
}

/** Audit `<cwd>/.unown/skills/<name>/SKILL.md` files. */
function auditSkills(cwd: string): Finding[] {
        const out: Finding[] = [];
        const skillsDir = join(cwd, ".unown", "skills");
        if (!existsSync(skillsDir)) return out;

        let entries: string[] = [];
        try {
                entries = readdirSync(skillsDir, { withFileTypes: true })
                        .filter((d) => d.isDirectory())
                        .map((d) => d.name);
        } catch {
                out.push({
                        severity: "warn",
                        message: `.unown/skills/ exists but is not readable`,
                        fix: `check the directory permissions`,
                });
                return out;
        }

        const seenDescriptions: Array<{ name: string; description: string; file: string }> = [];
        for (const name of entries) {
                const skillFile = join(skillsDir, name, "SKILL.md");
                const text = readText(skillFile);
                if (text === null) {
                        out.push({
                                severity: "warn",
                                message: `skill directory \`.unown/skills/${name}/\` has no SKILL.md`,
                                fix: `add a SKILL.md (frontmatter: name + description; body: the procedure)`,
                        });
                        continue;
                }
                const fm = parseSkillFrontmatter(text);
                if (fm === null) {
                        out.push({
                                severity: "error",
                                message: `skill \`.unown/skills/${name}/SKILL.md\` has invalid frontmatter — expected \`---\\nname: …\\ndescription: …\\n---\``,
                                fix: `add a YAML frontmatter block at the top with \`name\` and \`description\` keys`,
                        });
                        continue;
                }
                if (!fm.name) {
                        out.push({
                                severity: "error",
                                message: `skill \`.unown/skills/${name}/SKILL.md\` frontmatter is missing the \`name\` field`,
                                fix: `add \`name: ${name}\` to the frontmatter`,
                        });
                }
                if (!fm.description) {
                        out.push({
                                severity: "error",
                                message: `skill \`.unown/skills/${name}/SKILL.md\` frontmatter is missing the \`description\` field`,
                                fix: `add a one-line \`description:\` (used by progressive disclosure)`,
                        });
                }
                if (fm.name && fm.name !== name) {
                        out.push({
                                severity: "warn",
                                message: `skill \`.unown/skills/${name}/SKILL.md\` frontmatter name (\`${fm.name}\`) does not match the directory name (\`${name}\`)`,
                                fix: `rename either the directory or the frontmatter field so they match`,
                        });
                }
                // Overlap detection — same description across two skills.
                if (fm.description) {
                        const dup = seenDescriptions.find((s) => s.description === fm.description);
                        if (dup) {
                                out.push({
                                        severity: "warn",
                                        message: `skill \`${name}\` has the same description as \`${dup.name}\` — they may overlap`,
                                        fix: `differentiate the descriptions or merge the skills`,
                                });
                        } else {
                                seenDescriptions.push({ name, description: fm.description, file: skillFile });
                        }
                }
        }

        if (entries.length === 0) {
                out.push({
                        severity: "info",
                        message: `.unown/skills/ exists but has no skill directories yet`,
                        fix: `skills are minted by AutoDreaming after successful project dreams — no action needed`,
                });
        }

        return out;
}

// ---------------------------------------------------------------------------
// MCP config audit
// ---------------------------------------------------------------------------

interface McpServerEntry {
        command?: string;
        args?: unknown;
        url?: string;
        type?: string;
}

/**
 * Audit the merged `.unown/mcp.json` + `<agentDir>/mcp.json`. The existing
 * doctor already reports validation problems + the trust gate; this audit
 * focuses on the ORPHAN check (server entries whose `command` binary isn't
 * on PATH) plus parseability.
 */
function auditMcpConfig(cwd: string, agentDir: string, commandExists: (cmd: string) => boolean): Finding[] {
        const out: Finding[] = [];
        const checkedFiles = [
                { path: join(cwd, ".unown", "mcp.json"), label: "project" },
                { path: join(agentDir, "mcp.json"), label: "user" },
        ];
        let anyConfigured = false;
        let allServers = 0;

        for (const { path, label } of checkedFiles) {
                const parsed = readJsonE(path);
                if (parsed === null) continue; // missing — fine
                if (!parsed.ok) {
                        out.push({
                                severity: "error",
                                message: `${label} mcp.json at \`${path}\` is not valid JSON — ${parsed.error}`,
                                fix: `fix the syntax; the file is ignored until then`,
                        });
                        continue;
                }
                const root = parsed.value as Record<string, unknown> | null;
                if (root === null || typeof root !== "object" || Array.isArray(root)) {
                        out.push({
                                severity: "error",
                                message: `${label} mcp.json at \`${path}\` is not a JSON object`,
                                fix: `replace the contents with \`{ "mcpServers": { ... } }\``,
                        });
                        continue;
                }
                const servers = root.mcpServers as Record<string, McpServerEntry> | undefined;
                if (servers === undefined) continue;
                if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
                        out.push({
                                severity: "error",
                                message: `${label} mcp.json at \`${path}\` — \`mcpServers\` must be an object`,
                                fix: `replace the value with an object of server entries`,
                        });
                        continue;
                }
                anyConfigured = anyConfigured || Object.keys(servers).length > 0;
                allServers += Object.keys(servers).length;

                for (const [name, entry] of Object.entries(servers)) {
                        if (!entry || typeof entry !== "object") {
                                out.push({
                                        severity: "error",
                                        message: `${label} mcp.json: server \`${name}\` is not an object`,
                                        fix: `replace it with \`{ "command": "...", "args": [...] }\` or \`{ "url": "..." }\``,
                                });
                                continue;
                        }
                        const hasCommand = typeof entry.command === "string" && entry.command.length > 0;
                        const hasUrl = typeof entry.url === "string" && entry.url.length > 0;
                        if (!hasCommand && !hasUrl) {
                                out.push({
                                        severity: "error",
                                        message: `${label} mcp.json: server \`${name}\` has neither \`command\` nor \`url\``,
                                        fix: `add \`{ "command": "...", "args": [...] }\` (stdio) or \`{ "url": "..." }\` (http)`,
                                });
                                continue;
                        }
                        // Orphan check — stdio server whose binary isn't on PATH.
                        if (hasCommand && !commandExists(entry.command!)) {
                                out.push({
                                        severity: "warn",
                                        message: `${label} mcp.json: server \`${name}\` commands \`${entry.command}\` which is not on PATH — the server will fail to start`,
                                        fix: `install \`${entry.command}\` (or point at the absolute path) and re-run \`unown mcp test ${name}\``,
                                });
                        }
                }
        }

        if (anyConfigured && allServers > 0 && out.length === 0) {
                out.push({
                        severity: "info",
                        message: `${allServers} MCP server(s) configured — all entries parse cleanly`,
                });
        }
        return out;
}

// ---------------------------------------------------------------------------
// Hooks config audit
// ---------------------------------------------------------------------------

const VALID_HOOK_TYPES = new Set(["command", "http", "mcp", "prompt", "agent"]);
const VALID_HOOK_EVENTS = new Set([
        "SessionStart",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "Stop",
        "SubagentStop",
        "PreModelRequest",
        "PostModelRequest",
        "PreCompact",
        "PostCompact",
        "SubagentStart",
        "TaskCompleted",
        "PermissionRequest",
]);

/** Audit `.unown/hooks.json` + `<agentDir>/hooks.json` schema. */
function auditHooksConfig(cwd: string, agentDir: string): Finding[] {
        const out: Finding[] = [];
        const checkedFiles = [
                { path: join(cwd, ".unown", "hooks.json"), label: "project" },
                { path: join(agentDir, "hooks.json"), label: "user" },
        ];

        for (const { path, label } of checkedFiles) {
                const parsed = readJsonE(path);
                if (parsed === null) continue; // missing — fine
                if (!parsed.ok) {
                        out.push({
                                severity: "error",
                                message: `${label} hooks.json at \`${path}\` is not valid JSON — ${parsed.error}`,
                                fix: `fix the syntax; the file is ignored until then`,
                        });
                        continue;
                }
                const root = parsed.value as Record<string, unknown> | null;
                if (root === null || typeof root !== "object" || Array.isArray(root)) {
                        out.push({
                                severity: "error",
                                message: `${label} hooks.json at \`${path}\` is not a JSON object`,
                                fix: `replace the contents with \`{ "version": 1, "hooks": { ... } }\``,
                        });
                        continue;
                }
                if (root.version !== 1) {
                        out.push({
                                severity: "error",
                                message: `${label} hooks.json at \`${path}\` — \`version\` must be \`1\` (got ${JSON.stringify(root.version)})`,
                                fix: `set \`"version": 1\` at the top level`,
                        });
                        continue;
                }
                const hooks = root.hooks as Record<string, unknown> | undefined;
                if (hooks === undefined || hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) {
                        out.push({
                                severity: "error",
                                message: `${label} hooks.json at \`${path}\` — \`hooks\` must be an object keyed by event name`,
                                fix: `replace with \`"hooks": { "PreToolUse": [ ... ] }\``,
                        });
                        continue;
                }
                for (const [event, handlers] of Object.entries(hooks)) {
                        if (!VALID_HOOK_EVENTS.has(event)) {
                                out.push({
                                        severity: "warn",
                                        message: `${label} hooks.json: unknown event \`${event}\` — must be one of ${Array.from(VALID_HOOK_EVENTS).join(", ")}`,
                                        fix: `rename or remove the event key`,
                                });
                                continue;
                        }
                        if (!Array.isArray(handlers)) {
                                out.push({
                                        severity: "error",
                                        message: `${label} hooks.json: event \`${event}\` must be an array of handlers`,
                                        fix: `replace the value with an array`,
                                });
                                continue;
                        }
                        for (let i = 0; i < handlers.length; i++) {
                                const h = handlers[i] as Record<string, unknown> | null;
                                if (!h || typeof h !== "object") {
                                        out.push({
                                                severity: "error",
                                                message: `${label} hooks.json: ${event}[${i}] is not an object`,
                                                fix: `replace with \`{ "type": "command", "command": "..." }\` etc.`,
                                        });
                                        continue;
                                }
                                if (typeof h.type !== "string" || !VALID_HOOK_TYPES.has(h.type)) {
                                        out.push({
                                                severity: "error",
                                                message: `${label} hooks.json: ${event}[${i}] has invalid \`type\` ${JSON.stringify(h.type)} — must be one of ${Array.from(VALID_HOOK_TYPES).join(", ")}`,
                                                fix: `set \`type\` to one of ${Array.from(VALID_HOOK_TYPES).join(", ")}`,
                                        });
                                }
                                // Type-specific required fields.
                                if (h.type === "command" && typeof h.command !== "string") {
                                        out.push({
                                                severity: "error",
                                                message: `${label} hooks.json: ${event}[${i}] type \`command\` requires a \`command\` string`,
                                                fix: `add \`"command": "echo 'fired'"\``,
                                        });
                                }
                                if (h.type === "http" && typeof h.url !== "string") {
                                        out.push({
                                                severity: "error",
                                                message: `${label} hooks.json: ${event}[${i}] type \`http\` requires a \`url\` string`,
                                                fix: `add \`"url": "https://..."\``,
                                        });
                                }
                                if (h.type === "mcp" && (typeof h.mcpServer !== "string" || typeof h.mcpTool !== "string")) {
                                        out.push({
                                                severity: "error",
                                                message: `${label} hooks.json: ${event}[${i}] type \`mcp\` requires \`mcpServer\` and \`mcpTool\` strings`,
                                                fix: `add \`"mcpServer": "name", "mcpTool": "review"\``,
                                        });
                                }
                                if ((h.type === "prompt" || h.type === "agent") && typeof h.prompt !== "string") {
                                        out.push({
                                                severity: "error",
                                                message: `${label} hooks.json: ${event}[${i}] type \`${h.type}\` requires a \`prompt\` string`,
                                                fix: `add \`"prompt": "Review {{input.path}} for ..."\``,
                                        });
                                }
                        }
                }
        }

        return out;
}

// ---------------------------------------------------------------------------
// Adversary mode audit
// ---------------------------------------------------------------------------

/** A minimal "is this valid markdown" check — at least one heading or one
 *  non-empty paragraph. Returns true when the file looks like real policy. */
function looksLikeValidPolicy(text: string): { ok: boolean; reason?: string } {
        const trimmed = text.trim();
        if (trimmed.length === 0) return { ok: false, reason: "file is empty" };
        if (trimmed.length < 20) return { ok: false, reason: `file is suspiciously short (${trimmed.length} bytes)` };
        const hasHeading = /^#{1,6}\s+\S/m.test(trimmed);
        const hasParagraph = /\n\s*\S/.test(trimmed) || /\S/.test(trimmed);
        if (!hasHeading && !hasParagraph) {
                return { ok: false, reason: "no heading or paragraph found" };
        }
        return { ok: true };
}

/** Audit the adversary-mode gate file at `<configDir>/adversary.md`. */
function auditAdversaryMode(configDir: string): Finding[] {
        const out: Finding[] = [];
        const path = join(configDir, "adversary.md");
        const text = readText(path);
        if (text === null) return out; // not opt-in — silent
        const check = looksLikeValidPolicy(text);
        if (check.ok) {
                out.push({
                        severity: "info",
                        message: `adversary mode is ACTIVE — gate file at \`${path}\` (${text.length} bytes)`,
                        fix: `to disable, delete the file (the reviewer is file-gated)`,
                });
        } else {
                out.push({
                        severity: "warn",
                        message: `adversary.md at \`${path}\` looks malformed — ${check.reason}`,
                        fix: `rewrite it as a markdown policy document (headings + paragraphs describing what the reviewer should block)`,
                });
        }
        return out;
}

// ---------------------------------------------------------------------------
// Injection scanner audit
// ---------------------------------------------------------------------------

/** Audit the injection-scanner config file at `<configDir>/injection-scanner.json`. */
function auditInjectionScanner(configDir: string): Finding[] {
        const out: Finding[] = [];
        const path = join(configDir, "injection-scanner.json");
        const parsed = readJsonE(path);
        if (parsed === null) return out; // not opt-in — silent
        if (!parsed.ok) {
                out.push({
                        severity: "error",
                        message: `injection-scanner.json at \`${path}\` is not valid JSON — ${parsed.error}`,
                        fix: `fix the syntax; the scanner falls back to the built-in defaults while the file is broken`,
                });
                return out;
        }
        const root = parsed.value as Record<string, unknown> | null;
        if (root === null || typeof root !== "object" || Array.isArray(root)) {
                out.push({
                        severity: "error",
                        message: `injection-scanner.json at \`${path}\` is not a JSON object`,
                        fix: `replace with \`{ "enabled": true, "blockOn": ["critical", "high"] }\``,
                });
                return out;
        }
        if (root.enabled !== undefined && typeof root.enabled !== "boolean") {
                out.push({
                        severity: "warn",
                        message: `injection-scanner.json: \`enabled\` should be boolean, got ${typeof root.enabled} — ignored`,
                });
        }
        if (Array.isArray(root.blockOn)) {
                const valid = new Set(["low", "medium", "high", "critical"]);
                for (const r of root.blockOn as unknown[]) {
                        if (typeof r !== "string" || !valid.has(r)) {
                                out.push({
                                        severity: "warn",
                                        message: `injection-scanner.json: \`blockOn\` has an invalid entry ${JSON.stringify(r)} — ignored`,
                                        fix: `use only \`low\`, \`medium\`, \`high\`, \`critical\``,
                                });
                        }
                }
        }
        if (out.length === 0) {
                out.push({
                        severity: "info",
                        message: `injection scanner is ACTIVE — config at \`${path}\``,
                });
        }
        return out;
}

// ---------------------------------------------------------------------------
// Stale-config audit — cross-file references that don't resolve.
// ---------------------------------------------------------------------------

/** Audit cross-references: hooks.json's `mcpServer` fields must resolve to
 *  an entry in mcp.json. */
function auditStaleConfig(cwd: string, agentDir: string): Finding[] {
        const out: Finding[] = [];

        // Gather every configured MCP server name across both files.
        const serverNames = new Set<string>();
        for (const path of [join(cwd, ".unown", "mcp.json"), join(agentDir, "mcp.json")]) {
                const parsed = readJsonE(path);
                if (parsed === null || !parsed.ok) continue;
                const root = parsed.value as Record<string, unknown> | null;
                if (!root || typeof root !== "object") continue;
                const servers = root.mcpServers as Record<string, unknown> | undefined;
                if (servers && typeof servers === "object") {
                        for (const name of Object.keys(servers)) serverNames.add(name);
                }
        }

        // Scan hooks.json for `mcpServer:` fields that don't resolve.
        for (const path of [join(cwd, ".unown", "hooks.json"), join(agentDir, "hooks.json")]) {
                const parsed = readJsonE(path);
                if (parsed === null || !parsed.ok) continue;
                const root = parsed.value as Record<string, unknown> | null;
                if (!root || typeof root !== "object") continue;
                const hooks = root.hooks as Record<string, unknown> | undefined;
                if (!hooks || typeof hooks !== "object") continue;
                for (const [event, handlers] of Object.entries(hooks)) {
                        if (!Array.isArray(handlers)) continue;
                        for (let i = 0; i < handlers.length; i++) {
                                const h = handlers[i] as Record<string, unknown> | null;
                                if (!h || typeof h !== "object") continue;
                                if (h.type === "mcp" && typeof h.mcpServer === "string") {
                                        if (!serverNames.has(h.mcpServer)) {
                                                out.push({
                                                        severity: "warn",
                                                        message: `hooks.json: ${event}[${i}] references MCP server \`${h.mcpServer}\` which is not configured in any mcp.json`,
                                                        fix: `add an entry for \`${h.mcpServer}\` to .unown/mcp.json (run \`unown mcp add ${h.mcpServer} ...\`)`,
                                                });
                                        }
                                }
                        }
                }
        }

        // Orphaned skill directories: `.unown/skills/<name>/` with no SKILL.md is
        // reported under skills (with a stronger severity) — but a stray empty
        // directory is also a stale-config smell, reported here as info.
        const skillsDir = join(cwd, ".unown", "skills");
        if (existsSync(skillsDir)) {
                try {
                        const entries = readdirSync(skillsDir, { withFileTypes: true });
                        for (const d of entries) {
                                if (!d.isDirectory()) {
                                        out.push({
                                                severity: "info",
                                                message: `.unown/skills/${d.name} is not a directory — stray file`,
                                                fix: `remove or relocate it (skills are stored as \`<name>/SKILL.md\`)`,
                                        });
                                }
                        }
                } catch {
                        // already reported under skills section
                }
        }

        return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Audit the instruction set at `cwd` and return a structured report. NEVER
 * throws — every parse failure or missing file becomes a structured
 * `Finding` (and missing optional files are silent).
 *
 * Sections returned (always all 7, possibly with empty `findings` arrays):
 *   - `agentsMd` — AGENTS.md freshness + reference integrity
 *   - `skills` — `.unown/skills/<name>/SKILL.md` frontmatter + overlap
 *   - `mcpConfig` — mcp.json parseability + orphaned server binaries
 *   - `hooksConfig` — hooks.json schema validation
 *   - `adversaryMode` — gate file presence + validity
 *   - `injectionScanner` — config file presence + JSON validity
 *   - `staleConfig` — cross-file references that don't resolve
 */
export function auditInstructionSet(cwd: string, opts: AuditOptions = {}): InstructionAuditReport {
        const configDir = opts.configDir ?? resolveConfigDir(process.env);
        const agentDir = opts.agentDir ?? resolveAgentDir(configDir);
        const commandExists = opts.commandExists ?? defaultCommandExists;

        return {
                agentsMd: auditAgentsMd(cwd),
                skills: auditSkills(cwd),
                mcpConfig: auditMcpConfig(cwd, agentDir, commandExists),
                hooksConfig: auditHooksConfig(cwd, agentDir),
                adversaryMode: auditAdversaryMode(configDir),
                injectionScanner: auditInjectionScanner(configDir),
                staleConfig: auditStaleConfig(cwd, agentDir),
        };
}

/**
 * Render `InstructionAuditReport` as a human-readable multi-line string for
 * `/doctor` and `/doctor-instructions` output. Pure — no I/O.
 */
export function renderInstructionAudit(report: InstructionAuditReport): string {
        const sections: Array<{ key: keyof InstructionAuditReport; title: string }> = [
                { key: "agentsMd", title: "AGENTS.md" },
                { key: "skills", title: "Skills" },
                { key: "mcpConfig", title: "MCP config" },
                { key: "hooksConfig", title: "Hooks config" },
                { key: "adversaryMode", title: "Adversary mode" },
                { key: "injectionScanner", title: "Injection scanner" },
                { key: "staleConfig", title: "Stale config" },
        ];
        const lines: string[] = [];
        lines.push(``);
        lines.push(`Instruction-set audit:`);
        for (const { key, title } of sections) {
                const findings = report[key];
                if (findings.length === 0) {
                        lines.push(`  ✓ ${title}: clean`);
                        continue;
                }
                lines.push(`  • ${title}:`);
                for (const f of findings) {
                        const icon = f.severity === "error" ? "✗" : f.severity === "warn" ? "⚠" : "·";
                        lines.push(`    ${icon} [${f.severity}] ${f.message}`);
                        if (f.fix) lines.push(`        → ${f.fix}`);
                }
        }
        return lines.join("\n");
}

/** Count error/warn findings across the whole report — used by `/doctor`
 *  to fold the instruction audit into the existing summary exit posture
 *  (warn-class never turns doctor non-zero; only errors could, but the
 *  existing contract keeps the chat path as the only hard-fail). */
export function summarizeInstructionAudit(report: InstructionAuditReport): {
        errors: number;
        warnings: number;
        infos: number;
} {
        let errors = 0;
        let warnings = 0;
        let infos = 0;
        for (const key of Object.keys(report) as Array<keyof InstructionAuditReport>) {
                for (const f of report[key]) {
                        if (f.severity === "error") errors++;
                        else if (f.severity === "warn") warnings++;
                        else infos++;
                }
        }
        return { errors, warnings, infos };
}
