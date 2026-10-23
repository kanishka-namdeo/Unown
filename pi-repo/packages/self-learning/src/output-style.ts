/**
 * output-style.ts — output styles / personas (Claude Code /output-style parity).
 *
 * Problem: Claude Code ships /output-style (Default, Proactive, Concise,
 * Explanatory, Learning) that swaps the agent's tone and verbosity by
 * appending a directive to the system prompt. Unown has nothing — the user
 * cannot ask for terse or teaching-mode answers without rewriting
 * AGENTS.md, and cannot share that preference with a team through the repo.
 *
 * Design: four built-in styles plus custom markdown files discovered from
 * `<project>/.unown/styles/*.md` (source "project") and
 * `${UNOWN_HOME || ~/.unown}/agent/styles/*.md` (source "user") — project
 * wins on name collision, customs shadow built-ins by name, and names are
 * lowercase-kebab so they double as command arguments. Each file is
 * frontmatter (name, description) + body (the directive). The ACTIVE style
 * persists as `{"name": ...}` in the PROJECT `.unown/output-style.json`
 * (travels with the checkout, beats the user file, which beats "default")
 * and can be pinned outright with UNOWN_OUTPUT_STYLE. Selecting "default"
 * means NO appendix — the base system prompt byte-for-byte — so parity
 * with stock pi is one command away.
 *
 * Purity: node:fs + node:os + node:path + ./atomic.ts only, plus the pure
 * parseFrontmatter utility re-exported by @earendil-works/pi-coding-agent
 * (the same import recipes.ts and tools.ts already use — no pi runtime
 * surface is touched here; the lead wires the before_agent_start hook and
 * the /output-style command around this module). Every env-taking
 * function defaults to process.env but accepts an explicit object, so
 * tests redirect UNOWN_HOME into a temp dir instead of touching the
 * developer's real home — the 2026-10-22 writeAgentConfig incident's
 * lesson, applied from birth.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { atomicWriteFileSync } from "./atomic.ts";

// ---------------------------------------------------------------------------
// Types + built-ins
// ---------------------------------------------------------------------------

/** One output style: a named directive appended to the system prompt when active. */
export interface OutputStyle {
    /** Lowercase-kebab identifier ([a-z0-9-], 1-32 chars) — also the command argument. */
    name: string;
    /** One-line listing text for the bare /output-style command. */
    description: string;
    /** The directive appended to the system prompt; empty = base behavior (the default built-in). */
    directive: string;
    /** Where the style comes from: shipped, project checkout, or user home. */
    source: "built-in" | "project" | "user";
}

/**
 * The four built-ins (Claude Code's set minus Learning, which Unown already
 * lives): `default` deliberately carries an EMPTY directive — selecting it
 * appends nothing, so the system prompt is the stock one.
 */
export const BUILTIN_OUTPUT_STYLES: OutputStyle[] = [
    {
        name: "default",
        description: "Base behavior with no output directive",
        directive: "",
        source: "built-in",
    },
    {
        name: "concise",
        description: "Terse answers; code over prose; no preamble",
        directive:
            "Answer tersely. Skip preamble, restatements of the request, and closing summaries. Lead with the change or the answer itself; prefer code and commands over prose. When you modify files, state each file and what changed in one line. Only add explanation when the user asks for it.",
        source: "built-in",
    },
    {
        name: "explanatory",
        description: "Narrated reasoning; teaches while working",
        directive:
            "Narrate your reasoning as you work: before acting, say why this approach over the alternatives. Explain what each change does once applied. Define jargon and unfamiliar APIs the first time you use them. When you choose between options, lay out the trade-offs explicitly. Teach while you build - the reader should understand the code, not just receive it.",
        source: "built-in",
    },
    {
        name: "proactive",
        description: "Surfaces risks, follow-ups, and plan objections unprompted",
        directive:
            "Surface risks, edge cases, and follow-up work without being asked. After completing a task, propose the next steps you would take and flag anything you deliberately left undone. If the plan looks wrong - outdated assumptions, missing tests, a simpler path - say so before executing it. Prefer raising a concern early over discovering it late.",
        source: "built-in",
    },
];

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** The user-level unown home — mirrors term.ts resolveUnownHome, read at CALL time. */
function unownHome(env: NodeJS.ProcessEnv): string {
    return env.UNOWN_HOME || join(homedir(), ".unown"); // `||`: empty .env value means unset
}

/** Project styles dir: `<cwd>/.unown/styles/`. */
export function projectStylesDir(cwd: string): string {
    return join(cwd, ".unown", "styles");
}

/** User styles dir: `${UNOWN_HOME || ~/.unown}/agent/styles/`. */
export function userStylesDir(env: NodeJS.ProcessEnv = process.env): string {
    return join(unownHome(env), "agent", "styles");
}

/** The PROJECT-level persistence file for the active style (beats the user file). */
export function outputStyleFile(cwd: string): string {
    return join(cwd, ".unown", "output-style.json");
}

// ---------------------------------------------------------------------------
// Style-file parsing
// ---------------------------------------------------------------------------

/**
 * Sanitize a style name to the display/argument contract: lowercase kebab,
 * [a-z0-9-] only, leading/trailing dashes stripped, capped at 32 chars.
 * Returns "" when nothing survives (e.g. the raw name was all punctuation).
 * Pure.
 */
export function sanitizeStyleName(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32)
        .replace(/-+$/g, "");
}

/**
 * Parse one style markdown file: frontmatter `name`/`description` + body
 * (the directive). `fallbackName` (usually the file name sans .md) is used
 * when the frontmatter carries no usable name. Returns undefined when the
 * body is empty/whitespace (a style with no directive is not a style), the
 * sanitized name is empty (all-punctuation name), or the frontmatter block
 * exists but does not parse as YAML (a broken file is skipped, not
 * half-loaded). The returned source is "project"; the discovery pass
 * rewrites it to "user" for user-home files. Pure.
 */
export function parseStyleFile(text: string, fallbackName: string): OutputStyle | undefined {
    let frontmatter: Record<string, unknown> = {};
    let body = text;
    try {
        const parsed = parseFrontmatter<Record<string, unknown>>(text);
        frontmatter = parsed.frontmatter ?? {};
        body = parsed.body;
    } catch {
        return undefined; // frontmatter present but unparseable — skip the whole file
    }
    const directive = body.trim();
    if (!directive) return undefined;
    const rawName =
        typeof frontmatter.name === "string" && frontmatter.name.trim().length > 0 ? frontmatter.name : fallbackName;
    const name = sanitizeStyleName(rawName);
    if (!name) return undefined;
    const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
    return { name, description, directive, source: "project" };
}

// ---------------------------------------------------------------------------
// Discovery + listing
// ---------------------------------------------------------------------------

/** Load one styles dir; missing dir, unreadable dir, unreadable files and unparsable files all vanish silently. */
function loadStylesDir(dir: string, source: "project" | "user"): OutputStyle[] {
    if (!existsSync(dir)) return [];
    let files: string[];
    try {
        files = readdirSync(dir);
    } catch {
        return [];
    }
    const out: OutputStyle[] = [];
    for (const file of files) {
        if (!file.endsWith(".md")) continue;
        let text: string;
        try {
            text = readFileSync(join(dir, file), "utf8");
        } catch {
            continue; // unreadable (permissions, or a directory named *.md) — skipped silently
        }
        const style = parseStyleFile(text, file.slice(0, -3)); // file name minus ".md" as the fallback
        if (!style) continue;
        out.push(source === "user" ? { ...style, source: "user" } : style);
    }
    return out;
}

/**
 * Discover custom styles: project dir first, then user dir, project wins on
 * name collision (user entries whose name a project entry already claimed
 * are filtered out; within one dir the first file in readdir order wins a
 * sanitized-name tie). Result sorted by name. Missing dirs → []. Pure
 * except the directory reads it performs.
 */
export function discoverCustomStyles(cwd: string, env: NodeJS.ProcessEnv = process.env): OutputStyle[] {
    const collected: OutputStyle[] = [
        ...loadStylesDir(projectStylesDir(cwd), "project"),
        ...loadStylesDir(userStylesDir(env), "user"),
    ];
    const claimed = new Set<string>();
    const out: OutputStyle[] = [];
    for (const style of collected) {
        if (style.source === "user" && claimed.has(style.name)) continue; // project already owns this name
        claimed.add(style.name);
        out.push(style);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The full listing: built-ins first (in shipped order), a custom REPLACING
 * the built-in of the same name in place, then the remaining customs
 * (name-sorted). This is what /output-style shows and what resolveStyle
 * consults — customs shadow built-ins by name.
 */
export function listStyles(cwd: string, env: NodeJS.ProcessEnv = process.env): OutputStyle[] {
    const customs = discoverCustomStyles(cwd, env);
    const byName = new Map(customs.map((s) => [s.name, s]));
    const out: OutputStyle[] = BUILTIN_OUTPUT_STYLES.map((b) => byName.get(b.name) ?? b);
    const builtinNames = new Set(BUILTIN_OUTPUT_STYLES.map((b) => b.name));
    for (const style of customs) {
        if (!builtinNames.has(style.name)) out.push(style);
    }
    return out;
}

/**
 * Resolve one style by name: "default" or "" → the default built-in;
 * otherwise case-insensitive lookup, customs shadowing built-ins.
 * undefined when nothing matches (the caller surfaces "unknown style").
 * Pure except the discovery reads.
 */
export function resolveStyle(name: string, cwd: string, env: NodeJS.ProcessEnv = process.env): OutputStyle | undefined {
    const wanted = name.trim().toLowerCase();
    if (wanted === "" || wanted === "default") {
        return BUILTIN_OUTPUT_STYLES.find((s) => s.name === "default");
    }
    for (const style of discoverCustomStyles(cwd, env)) {
        if (style.name === wanted) return style;
    }
    return BUILTIN_OUTPUT_STYLES.find((s) => s.name === wanted);
}

// ---------------------------------------------------------------------------
// System-prompt appendix
// ---------------------------------------------------------------------------

/**
 * The system-prompt appendix for a style: "" when there is no directive
 * (the default built-in — selecting it means "no appendix", byte-for-byte
 * stock behavior), else the pinned fenced wrapper. The exact shape is
 * load-bearing: the before_agent_start hook appends this verbatim.
 */
export function styleSystemPromptAppendix(style: OutputStyle): string {
    const directive = style.directive.trim();
    if (!directive) return "";
    return `\n\n## Output style: ${style.name}\n\n${directive}\n`;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Read one active-style JSON file; malformed JSON, non-object or empty name → undefined. */
function readActiveStyleFile(path: string): string | undefined {
    if (!existsSync(path)) return undefined;
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        if (typeof parsed !== "object" || parsed === null) return undefined;
        const name = (parsed as { name?: unknown }).name;
        return typeof name === "string" && name.trim().length > 0 ? name.trim() : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The active style name, in precedence order: UNOWN_OUTPUT_STYLE env (empty
 * counts as unset — the repo `KEY=` .env convention), then the PROJECT
 * `.unown/output-style.json` (travels with the checkout, beats the user
 * file), then `${UNOWN_HOME || ~/.unown}/agent/output-style.json`, else
 * "default". The name is returned verbatim (case preserved); resolution
 * happens in resolveStyle, which is case-insensitive.
 */
export function activeStyleName(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
    const fromEnv = env.UNOWN_OUTPUT_STYLE?.trim();
    if (fromEnv) return fromEnv;
    const project = readActiveStyleFile(outputStyleFile(cwd));
    if (project) return project;
    const user = readActiveStyleFile(join(unownHome(env), "agent", "output-style.json"));
    if (user) return user;
    return "default";
}

/**
 * Persist the active style to the PROJECT file (atomic via
 * atomicWriteFileSync — a crash mid-write must never leave a truncated
 * JSON the next session cannot parse), canonicalizing the name to what
 * resolveStyle found. Throws Error("unknown output style") when the name
 * resolves to nothing — the command layer catches and surfaces it.
 */
export function saveActiveStyle(cwd: string, name: string, env: NodeJS.ProcessEnv = process.env): void {
    const style = resolveStyle(name, cwd, env);
    if (!style) throw new Error("unknown output style");
    atomicWriteFileSync(outputStyleFile(cwd), `${JSON.stringify({ name: style.name })}\n`);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * The rendered listing for the bare /output-style command: one line per
 * style, `name (source) — description`, built-ins first then customs.
 * Pure (delegates to listStyles).
 */
export function describeStyles(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
    return listStyles(cwd, env)
        .map((s) => `${s.name} (${s.source}) — ${s.description}`)
        .join("\n");
}
