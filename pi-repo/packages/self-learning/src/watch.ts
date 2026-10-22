/**
 * watch.ts — the AI-comment watch (M3): aider's `--watch-files` semantics on
 * the always-on engine.
 *
 * The loop (aider's, kept intact): you drop instructions in code comments —
 * `# AI: do this` / `# AI! do it NOW` / `# AI? answer this` — the engine
 * collects them with file:line context, dispatches ONE batched headless agent
 * run per watch root, and the run resolves the work and REMOVES the comment
 * lines it handled. Unown runs the loop as a router interval job
 * (`watch-scan`, 120 s) on the detached engine, so it works with no agent
 * session in use — aider's watcher only lives inside an interactive session.
 *
 * Layering:
 *   - PURE: the marker table, scanFilesForAiComments, commentHash,
 *     buildWatchPrompt, matchIncludePattern — no I/O, total over their input.
 *   - SEMI-PURE: collectWatchableFiles walks a tree through an injectable
 *     fs adapter (tests pass a fake walker; production uses nodeWatchFs).
 *   - ENGINE: ensureWatchSchema, discoverWatchRoots, runWatchScan — the
 *     router job body. Agent runs go through the automations spawn seam
 *     (spawnAutomationRun — the SAME headless `unown --mode json -p
 *     --no-session` CLI, the SAME mode-restricted toolsets, the SAME 30-min
 *     timeout routine runs use), never a bespoke spawner.
 *
 * Dedup model (hash-stable): a comment's identity is
 * sha1(`file:line-kind-text`) — NORMALIZED (posix separators, trimmed text,
 * truncated at 500 chars). A comment whose hash is in watch_seen has already
 * triggered its run and will NOT re-trigger until its text (or line) changes.
 * After a run, the root is re-scanned: comments still present get their
 * last_seen refreshed; comments GONE (the run removed them, or the user did)
 * have their hash rows DELETED — resolved = forgotten, so the same comment
 * re-added later triggers again. A scan with no new comments costs zero LLM.
 *
 * Concurrency note (CLI `unown watch run`): the forced pass runs IN-PROCESS
 * against the same SQLite store the engine uses. WAL allows a second
 * short-lived writer; the engine's busy-mutex covers its own jobs only, so a
 * forced CLI scan racing the engine's own 2-minute tick can, in the worst
 * case, dispatch the same batch twice (both computed "new" before either
 * committed). The hash dedup converges after the first writer commits — the
 * same acceptable, bounded pattern as `unown note` writing the outbox while
 * the engine is mid-sync.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnAutomationRun, type AutomationRow, type AutomationRunRow } from "./automations.ts";
import { emit } from "./bus.ts";
import { store, type Store } from "./store.ts";

// ---------------------------------------------------------------------------
// Constants + the marker table
// ---------------------------------------------------------------------------

/** Aider's marker semantics, one row per line-comment family. `<!-- AI: -->`
 *  (HTML/XML/markdown block comments) is OUT OF SCOPE for v1: only line
 *  comments are scanned — block comments need a stateful parser to avoid
 *  matching inside strings/docs, and that is not worth the surface area
 *  before anyone asks for it. */
export const AI_COMMENT_MARKERS: ReadonlyArray<{ prefix: string; languages: string }> = [
        { prefix: "#", languages: "python, shell, yaml, ruby, toml, r, perl" },
        { prefix: "//", languages: "typescript, javascript, go, rust, java, c, c++, c#, swift, kotlin, php, dart, zig, scala, objective-c" },
        { prefix: "--", languages: "sql, lua, haskell" },
        { prefix: ";", languages: "ini, cfg, conf" },
];

/** Marker semantics (aider's, transliterated):
 *   AI:  task    — do the work, then remove the comment line
 *   AI!  urgent  — same, but the batch prompt says handle it FIRST
 *   AI?  question — answer in the report; no code change expected */
export type AiCommentKind = "task" | "urgent" | "question";

export interface AiComment {
        /** Root-relative, posix-separated path — the same string the prompt shows and the hash uses. */
        file: string;
        /** 1-based line number. */
        line: number;
        kind: AiCommentKind;
        /** Instruction text, trimmed, capped at maxTextChars. */
        text: string;
        /** sha1(`${file}:${line}-${kind}-${text}`) — the dedup identity. */
        hash: string;
        /** True when `text` was clipped at the 500-char cap. */
        truncated?: boolean;
}

/** The marker line grammar. One leading-whitespace-tolerant alternation over
 *  the four families; repeated comment chars (##, ///, ---, ;;) match too.
 *  The `ai` letters are case-insensitive (`# ai:` works — aider matches the
 *  same way); the kind char (:!?) is exact. A marker whose rest trims to
 *  empty (bare `# AI:` / trailing spaces) is NOT a comment — there is no
 *  instruction to act on. Trailing comment markers after the text (python
 *  `# AI: fix this  # TODO`) stay part of the text; only the line itself is
 *  matched, never a mid-line/trailing comment (start-of-line only keeps
 *  strings and URLs safe). */
const MARKER_RE = /^[ \t]*(?:#+|\/\/+|-{2,}|;+)[ \t]*ai([:!?])(.*)$/i;

/** Max instruction text kept per comment (longer clips + sets `truncated`).
 *  500 chars is ~2-3 lines of instruction — anything longer is a design doc,
 *  and the hash must stay stable for what the prompt actually carries. */
export const MAX_COMMENT_TEXT_CHARS = 500;

/** Files above this size are skipped as oversized (512 KB). */
export const MAX_FILE_BYTES = 512 * 1024;

/** Walk guard: at most this many files collected per root (5000). Pathological
 *  monorepos must not turn a 2-minute tick into a full-tree slurp. */
export const MAX_FILES_PER_ROOT = 5000;

/** The default source-extension allowlist — exactly the extensions whose
 *  line-comment families appear in AI_COMMENT_MARKERS. A root's watch.json
 *  `include` patterns REPLACE this list (gitignore-ish globs). */
export const WATCH_SOURCE_EXTENSIONS: readonly string[] = [
        // '#' family
        "py", "pyi", "sh", "bash", "zsh", "yml", "yaml", "rb", "toml", "r", "pl", "plw",
        // '//' family
        "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "go", "rs", "java",
        "c", "h", "cpp", "cc", "hpp", "hh", "cs", "swift", "kt", "kts", "php", "dart", "zig", "scala", "m", "mm",
        // '--' family
        "sql", "lua", "hs",
        // ';' family
        "ini", "cfg", "conf", "inf",
];

// ---------------------------------------------------------------------------
// Pure scanning
// ---------------------------------------------------------------------------

/** sha1(`${file}:${line}-${kind}-${text}`) with posix-normalized `file` —
 *  the stable identity a comment keeps across scans (same comment → same
 *  hash; edited text or a moved line → new hash → re-triggers). */
export function commentHash(file: string, line: number, kind: AiCommentKind, text: string): string {
        const normalized = `${file.replace(/\\/g, "/")}:${line}-${kind}-${text}`;
        return createHash("sha1").update(normalized, "utf8").digest("hex");
}

function kindFromMarker(marker: string): AiCommentKind {
        if (marker === "!") return "urgent";
        if (marker === "?") return "question";
        return "task";
}

/** Scan already-read files for AI comments. Pure: no I/O, deterministic
 *  order (input order, then line order), total over malformed input (a
 *  non-UTF-8 read result just matches nothing). */
export function scanFilesForAiComments(
        files: Array<{ path: string; content: string }>,
        opts: { maxTextChars?: number } = {},
): AiComment[] {
        const cap = opts.maxTextChars ?? MAX_COMMENT_TEXT_CHARS;
        const out: AiComment[] = [];
        for (const file of files) {
                const rel = file.path.replace(/\\/g, "/");
                const lines = file.content.split("\n");
                for (let i = 0; i < lines.length; i++) {
                        const line = lines[i].replace(/\r$/, "");
                        const m = MARKER_RE.exec(line);
                        if (!m) continue;
                        const text = m[2].trim();
                        if (text === "") continue; // bare marker: no instruction
                        const kind = kindFromMarker(m[1]);
                        const clipped = text.length > cap;
                        const finalText = clipped ? text.slice(0, cap) : text;
                        out.push({
                                file: rel,
                                line: i + 1,
                                kind,
                                text: finalText,
                                hash: commentHash(rel, i + 1, kind, finalText),
                                ...(clipped ? { truncated: true } : {}),
                        });
                }
        }
        return out;
}

// ---------------------------------------------------------------------------
// The prompt (pure)
// ---------------------------------------------------------------------------

/** Build the headless-run prompt for one root's NEW comments. Only the new
 *  batch is included: seen comments already had their run (their report is in
 *  watch_runs); re-including them would re-burn tokens re-answering. */
export function buildWatchPrompt(comments: AiComment[], opts: { root: string; mode: "report" | "standard" }): string {
        const badge = (k: AiCommentKind) => (k === "urgent" ? "[AI!]" : k === "question" ? "[AI?]" : "[AI:]");
        const listed = comments.map((c) => `- ${c.file}:${c.line} ${badge(c.kind)} ${c.text}${c.truncated ? " (text truncated at 500 chars)" : ""}`);
        const modeBlock =
                opts.mode === "standard"
                        ? "Mode: STANDARD. You may edit files in this workspace. Apply each [AI:] task, then remove its comment line."
                        : "Mode: REPORT (read-only). You have NO write access: DO NOT edit any file. For each [AI:] task, report what you would do and why; answer every [AI?] question in the report.";
        return [
                `AI-comment watch pass for the repository at ${opts.root}.`,
                "",
                `The user left ${comments.length} new AI instruction comment(s) in the code while you were away (lines that start with an AI marker: "# AI:", "// AI:", "-- AI:", "; AI:"). They are listed below as file:line [marker] text.`,
                "",
                "New comments:",
                ...listed,
                "",
                "Contract (aider's --watch-files semantics; this run is UNATTENDED — nobody can answer questions):",
                "1. [AI:] task — do the work described.",
                "2. [AI!] urgent task — same as [AI:], but handle these FIRST; the user marked them do-it-now.",
                "3. [AI?] question — answer it in your final report. No code change is expected.",
                "4. When you complete a task, REMOVE its comment line from the file. Delete ONLY that comment line — never adjacent code, and never a comment you did not resolve.",
                "5. Finish with a clear report: for every comment, what you did (or, in report mode, what you would do) plus the answers to the [AI?] questions.",
                "",
                modeBlock,
        ].join("\n");
}

// ---------------------------------------------------------------------------
// File walking (semi-pure: fs behind an injectable adapter)
// ---------------------------------------------------------------------------

export interface WatchDirEntry {
        name: string;
        isDirectory: boolean;
        isSymlink: boolean;
}

/** The fs surface collectWatchableFiles needs — small so tests can fake the
 *  whole walker (symlinks, size caps, dir skips) without touching a disk. */
export interface WatchFs {
        readDir(dir: string): WatchDirEntry[];
        /** File size in bytes, or null when the file cannot be statted (skip). */
        statSize(file: string): number | null;
        /** UTF-8 content, or null when unreadable/binary (skip). */
        readFile(file: string): string | null;
}

/** Production adapter (node:fs). Symlinked dirs AND files are skipped — the
 *  walk never follows symlinks (a repo symlink can point anywhere, including
 *  outside the trust boundary the marker file established). */
export const nodeWatchFs: WatchFs = {
        readDir(dir) {
                return readdirSync(dir, { withFileTypes: true }).map((e) => ({
                        name: e.name,
                        isDirectory: e.isDirectory(),
                        isSymlink: e.isSymbolicLink(),
                }));
        },
        statSize(file) {
                try {
                        return statSync(file).size;
                } catch {
                        return null;
                }
        },
        readFile(file) {
                try {
                        const content = readFileSync(file, "utf8");
                        // Cheap binary sniff: a NUL byte in the first 8 KB is the
                        // classic magic-number tell; UTF-8 text never contains one.
                        return content.includes("\u0000") ? null : content;
                } catch {
                        return null;
                }
        },
};

/** Directory names skipped at ANY depth: version control internals, dependency
 *  trees (huge + third-party), and unown's own state (the marker file lives
 *  there — the watch must not scan its own config). */
const SKIPPED_DIR_NAMES = new Set([".git", "node_modules", ".unown"]);

/** gitignore-ish glob match for the `include` patterns: a pattern with no `/`
 *  matches the basename at any depth (`*.py`); a pattern with `/` matches the
 *  root-relative path, with `**` crossing directory boundaries and `*`
 *  matching within one segment. No `!` negation in v1. */
export function matchIncludePattern(pattern: string, relPath: string): boolean {
        const segmentRe = (seg: string) => new RegExp(`^${seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
        if (!pattern.includes("/")) return segmentRe(pattern).test(relPath.split("/").pop() ?? "");
        const patParts = pattern.split("/");
        const pathParts = relPath.split("/");
        const matchFrom = (pi: number, gi: number): boolean => {
                for (;;) {
                        if (gi === patParts.length) return pi === pathParts.length;
                        const g = patParts[gi];
                        if (g === "**") {
                                if (matchFrom(pi, gi + 1)) return true;
                                if (pi === pathParts.length) return false;
                                pi++;
                                continue;
                        }
                        if (pi === pathParts.length) return false;
                        if (!segmentRe(g).test(pathParts[pi])) return false;
                        pi++;
                        gi++;
                }
        };
        return matchFrom(0, 0);
}

export interface CollectOptions {
        fs?: WatchFs;
        /** Override the extension allowlist. */
        extensions?: readonly string[];
        /** Include globs (watch.json `include`) — when present they REPLACE the extension allowlist. */
        include?: string[];
        maxFiles?: number;
        maxFileBytes?: number;
}

/** Walk one root and return its watchable files (root-relative posix paths +
 *  content). Sorted for deterministic hashes-in-order; stops at maxFiles. */
export function collectWatchableFiles(root: string, opts: CollectOptions = {}): Array<{ path: string; content: string }> {
        const fs = opts.fs ?? nodeWatchFs;
        const maxFiles = opts.maxFiles ?? MAX_FILES_PER_ROOT;
        const maxBytes = opts.maxFileBytes ?? MAX_FILE_BYTES;
        const extensions = new Set(opts.extensions ?? WATCH_SOURCE_EXTENSIONS);
        const include = opts.include ?? null;
        const out: Array<{ path: string; content: string }> = [];
        const walk = (absDir: string, relDir: string): void => {
                if (out.length >= maxFiles) return;
                let entries: WatchDirEntry[];
                try {
                        entries = fs.readDir(absDir);
                } catch {
                        return; // unreadable dir (permissions, vanished mid-walk) — skip
                }
                entries.sort((a, b) => a.name.localeCompare(b.name));
                for (const entry of entries) {
                        if (out.length >= maxFiles) return;
                        if (entry.isSymlink) continue; // never follow (or read through) symlinks; other hidden names flow through the allowlist like any file
                        const abs = join(absDir, entry.name);
                        const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
                        if (entry.isDirectory) {
                                if (SKIPPED_DIR_NAMES.has(entry.name)) continue;
                                walk(abs, rel);
                                continue;
                        }
                        // Files: extension allowlist (or include globs), then size, then read.
                        if (include) {
                                if (!include.some((p) => matchIncludePattern(p, rel))) continue;
                        } else {
                                const dot = entry.name.lastIndexOf(".");
                                const ext = dot >= 0 ? entry.name.slice(dot + 1).toLowerCase() : "";
                                if (!extensions.has(ext)) continue;
                        }
                        const size = fs.statSize(abs);
                        if (size === null || size > maxBytes) continue; // unstatatable or oversized
                        const content = fs.readFile(abs);
                        if (content === null) continue; // binary/unreadable
                        out.push({ path: rel, content });
                }
        };
        walk(resolve(root), "");
        return out;
}

// ---------------------------------------------------------------------------
// Engine side: schema
// ---------------------------------------------------------------------------

export const WATCH_SCHEMA = `
CREATE TABLE IF NOT EXISTS watch_seen (
  hash TEXT PRIMARY KEY,               -- sha1(file:line-kind-text) — the dedup identity
  file TEXT,                           -- root-relative path at first sight
  kind TEXT,                           -- task | urgent | question
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS watch_runs (
  id INTEGER PRIMARY KEY,
  root TEXT NOT NULL,
  comments INTEGER NOT NULL,           -- comments dispatched in the batch
  mode TEXT NOT NULL,                  -- report | standard
  status TEXT NOT NULL,                -- running | succeeded | failed
  output TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_watch_runs_started ON watch_runs (started_at);
`;

/** Install the watch tables (idempotent, split per-statement — Store.run
 *  prepares exactly one statement, the ensureAutomationsSchema convention).
 *  Called by runWatchScan and the CLI (list needs watch_seen to exist). */
export function ensureWatchSchema(s: Store = store): void {
        for (const stmt of WATCH_SCHEMA.split(";")) {
                const trimmed = stmt.trim();
                if (trimmed.length > 0) s.run(trimmed, []);
        }
}

// ---------------------------------------------------------------------------
// Engine side: watch-root discovery (the .unown/watch.json opt-in)
// ---------------------------------------------------------------------------

export interface WatchRoot {
        /** Absolute path. */
        root: string;
        markerPath: string;
        mode: "report" | "standard";
        /** Include globs from the marker file; null = default extension allowlist. */
        include: string[] | null;
}

export interface WatchDiscovery {
        roots: WatchRoot[];
        /** Human-readable problems (malformed marker JSON, unknown mode) — surfaced in scan output and `unown watch roots`. */
        warnings: string[];
        /** Roots carrying a marker that opted out (enabled:false) — informational, shown by `unown watch roots`. */
        disabled: Array<{ root: string; markerPath: string }>;
}

/** Kill switch: PI_WATCH_DISABLE=1. Checked at seed time (the router seeds the
 *  job row disabled) AND inside the job body (an env set after boot must stop
 *  the scans too). */
export function watchDisabled(): boolean {
        return (process.env.PI_WATCH_DISABLE || "") === "1";
}

/** PI_WATCH_ROOTS: colon-separated extra roots (POSIX). On Windows the
 *  separator is `;` (path.delimiter) — a bare `:` would shred `C:\...` paths
 *  into garbage candidates; cross-platform correctness beats a literal
 *  reading of "colon-separated" (the deviation is documented in
 *  docs/watch.md). */
export function envWatchRoots(): string[] {
        const raw = process.env.PI_WATCH_ROOTS || "";
        if (raw.trim() === "") return [];
        const sep = process.platform === "win32" ? ";" : ":";
        return raw
                .split(sep)
                .map((p) => p.trim())
                .filter((p) => p.length > 0);
}

/** Parse one candidate root's marker file. Missing marker → not a watch root
 *  (silent — the common case for every non-opted-in directory on the box). */
function parseWatchMarker(root: string): { root?: WatchRoot; warning?: string; disabled?: boolean } {
        const markerPath = join(root, ".unown", "watch.json");
        if (!existsSync(markerPath)) return {};
        let parsed: any;
        try {
                parsed = JSON.parse(readFileSync(markerPath, "utf8"));
        } catch (err: any) {
                return { warning: `watch: ${markerPath} is not valid JSON (${err?.message ?? err}) — watching disabled for ${root}` };
        }
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
                return { warning: `watch: ${markerPath} is not a JSON object — watching disabled for ${root}` };
        }
        // enabled !== false → a root (the spec's opt-in: the file's presence with
        // no enabled field means enabled; only an explicit false opts out).
        if (parsed.enabled === false) return { disabled: true };
        const warnings: string[] = [];
        let mode: "report" | "standard" = "report";
        if (parsed.mode !== undefined) {
                if (parsed.mode === "standard") mode = "standard";
                else if (parsed.mode !== "report") warnings.push(`watch: ${markerPath} has unknown mode "${parsed.mode}" — defaulting to "report" (read-only) for ${root}`);
        }
        let include: string[] | null = null;
        if (parsed.include !== undefined) {
                if (Array.isArray(parsed.include) && parsed.include.every((p: unknown) => typeof p === "string" && p.length > 0)) {
                        include = parsed.include as string[];
                } else {
                        warnings.push(`watch: ${markerPath} has an invalid "include" (expected an array of glob strings) — using the default allowlist for ${root}`);
                }
        }
        return { root: { root, markerPath, mode, include }, warning: warnings.length > 0 ? warnings.join("; ") : undefined };
}

/** Candidate roots the engine probes, in order: the engine's own repo root
 *  (the checkout it runs from — the store.ts REPO_ROOT recipe; a standalone
 *  binary's virtual path simply has no marker), the engine process cwd, every
 *  DISTINCT workspace of existing routines (read-only SELECT over the
 *  automations table — the table may not exist yet on a fresh install), the
 *  PI_WATCH_ROOTS env entries, then any explicit extras (tests). */
export function watchRootCandidates(extraRoots: string[] = []): string[] {
        const candidates: string[] = [];
        try {
                candidates.push(resolve(import.meta.dir, "../../../.."));
        } catch {
                /* exotic module layouts — the other candidates still apply */
        }
        candidates.push(process.cwd());
        try {
                const rows = store.query<{ workspace: string }>(`SELECT DISTINCT workspace FROM automations`);
                for (const row of rows) if (typeof row.workspace === "string" && row.workspace.trim() !== "") candidates.push(row.workspace);
        } catch {
                /* automations table not installed yet — no routine workspaces */
        }
        candidates.push(...envWatchRoots(), ...extraRoots);
        const seen = new Set<string>();
        const out: string[] = [];
        for (const c of candidates) {
                const abs = resolve(c);
                if (!seen.has(abs)) {
                        seen.add(abs);
                        out.push(abs);
                }
        }
        return out;
}

/** Discover the active watch roots among the candidates. */
export function discoverWatchRoots(opts: { extraRoots?: string[] } = {}): WatchDiscovery {
        const discovery: WatchDiscovery = { roots: [], warnings: [], disabled: [] };
        for (const candidate of watchRootCandidates(opts.extraRoots ?? [])) {
                const parsed = parseWatchMarker(candidate);
                if (parsed.warning) discovery.warnings.push(parsed.warning);
                if (parsed.disabled) {
                        discovery.disabled.push({ root: candidate, markerPath: join(candidate, ".unown", "watch.json") });
                        continue;
                }
                if (parsed.root) discovery.roots.push(parsed.root);
        }
        return discovery;
}

// ---------------------------------------------------------------------------
// Engine side: the scan + resolve pass (the router job body)
// ---------------------------------------------------------------------------

/** What one dispatched headless run returned (the spawnAutomationRun result
 *  shape, re-used verbatim so the automations seam stays the only spawner). */
export interface WatchSpawnOutcome {
        exitCode: number;
        output: string;
        turns: number;
        tokensIn: number;
        tokensOut: number;
}

/** The injectable spawn seam. Production = spawnWatchRunViaAutomations (the
 *  automations.ts headless-CLI seam); tests inject a fake and never spawn. */
export type WatchSpawnFn = (args: { root: string; prompt: string; mode: "report" | "standard" }) => Promise<WatchSpawnOutcome>;

/** Production spawner: re-uses the routines seam VERBATIM — the same
 *  `unown --mode json -p --no-session` CLI, the same read-only/standard
 *  toolsets (report → the routines' read-only set), the same 30-minute
 *  timeout, the same UNOWN_AUTOMATION=1 no-recursion env. Watch runs are
 *  synthetic one-shot rows: never inserted into the automations tables, so
 *  routine history/scheduling stays untouched. Model: not pinned per root in
 *  v1 — the engine process's PI_MODEL_ID flows through, exactly like a
 *  routine that has no --model. */
export function spawnWatchRunViaAutomations(args: { root: string; prompt: string; mode: "report" | "standard" }): Promise<WatchSpawnOutcome> {
        const now = Date.now();
        const automation: AutomationRow = {
                id: `watch:${createHash("sha1").update(args.root).digest("hex").slice(0, 10)}`,
                title: "AI comment watch",
                prompt: args.prompt,
                cron_expr: null,
                delay_ms: null,
                schedule_kind: null,
                interval_n: null,
                interval_unit: null,
                interval_at: null,
                timezone: null,
                until_ms: null,
                misfire: null,
                event_kind: null, // a watch run is scan-triggered, never an event listener
                event_filter: null,
                workspace: args.root,
                mode: args.mode === "standard" ? "standard" : "read-only",
                model: null,
                max_runs: null,
                run_count: 0,
                scheduled_run_count: 0,
                lifecycle: "active",
                next_run_at: null,
                last_run_at: null,
                running: 0,
                claimed_at: null,
                dispatch_status: "idle",
                dispatch_attempts: 0,
                retry_at: null,
                last_error: null,
                created_at: now,
                updated_at: now,
        };
        const run: AutomationRunRow = {
                id: `watch:${now}`,
                automation_id: automation.id,
                trigger_kind: "schedule",
                scheduled_at: null,
                status: "running",
                started_at: now,
                ended_at: null,
                exit_code: null,
                output: null,
                error: null,
                turns: 0,
                tokens_in: 0,
                tokens_out: 0,
        };
        return spawnAutomationRun(automation, run);
}

export interface WatchRunRecord {
        runId: number;
        status: "succeeded" | "failed";
        exitCode: number;
        comments: number;
        /** Pre-scan comments the post-run rescan no longer found (resolved). */
        resolved: number;
        /** Pre-scan comments still present after the run (hash-stable: they will not re-trigger until changed). */
        stillPresent: number;
        turns: number;
        tokensIn: number;
        tokensOut: number;
}

export interface WatchScanRootResult {
        root: string;
        mode: "report" | "standard";
        markerPath: string;
        files: number;
        /** Comments found this scan (all, seen + new). */
        comments: number;
        /** Comments whose hash is not in watch_seen — the dispatched batch. */
        newComments: number;
        run: WatchRunRecord | null;
}

export interface WatchScanResult {
        roots: WatchScanRootResult[];
        warnings: string[];
        /** Set when the kill switch stopped the whole pass. */
        skipped?: string;
}

function scanRoot(root: WatchRoot): { files: Array<{ path: string; content: string }>; comments: AiComment[] } {
        const files = collectWatchableFiles(root.root, root.include ? { include: root.include } : {});
        return { files, comments: scanFilesForAiComments(files) };
}

function seenHashes(): Set<string> {
        try {
                return new Set(store.query<{ hash: string }>(`SELECT hash FROM watch_seen`).map((r) => r.hash));
        } catch {
                return new Set(); // schema not installed yet — treat everything as unseen
        }
}

/** Upsert a comment as seen (INSERT keeps first_seen; conflict refreshes
 *  last_seen only — the identity's age is part of the audit story). */
function markSeen(comments: AiComment[], now: number): void {
        for (const c of comments) {
                store.run(
                        `INSERT INTO watch_seen (hash, file, kind, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
                         ON CONFLICT(hash) DO UPDATE SET last_seen = excluded.last_seen`,
                        [c.hash, c.file, c.kind, now, now],
                );
        }
}

/**
 * One watch pass over every discovered root (the `watch-scan` router job
 * body, and `unown watch run`'s in-process forced pass — the same seam).
 *
 * Per root: collect + scan → diff against watch_seen → no new comments means
 * a pure bookkeeping update (zero LLM); new comments dispatch ONE batched
 * headless run (prompt = buildWatchPrompt over the new batch only), then the
 * root is re-scanned: still-present comments get last_seen refreshed, gone
 * comments' hash rows are DELETED (resolved = forgotten). Every run is
 * recorded in watch_runs; `watch:scan` and `watch:run-finished` bus events
 * feed SSE.
 *
 * The pass runs under the router's busy-mutex and (as a learning job) behind
 * the governor: when the budget is exhausted or the breaker is open, watch
 * runs are throttled like every other LLM-spending job — that is correct
 * behavior, not a bug; the cheap dedup bookkeeping still happens on the next
 * unthrottled pass.
 */
export async function runWatchScan(
        opts: { spawn?: WatchSpawnFn; roots?: string[]; now?: number } = {},
): Promise<WatchScanResult> {
        if (watchDisabled()) {
                return { roots: [], warnings: [], skipped: "disabled (PI_WATCH_DISABLE=1)" };
        }
        ensureWatchSchema();
        const spawn = opts.spawn ?? spawnWatchRunViaAutomations;
        const now = () => opts.now ?? Date.now();
        const discovery =
                opts.roots !== undefined
                        ? (() => {
                                  // Explicit root list (tests / forced passes): same marker
                                  // parsing, warnings included.
                                  const d: WatchDiscovery = { roots: [], warnings: [], disabled: [] };
                                  for (const r of opts.roots!) {
                                          const parsed = parseWatchMarker(r);
                                          if (parsed.warning) d.warnings.push(parsed.warning);
                                          if (parsed.disabled) d.disabled.push({ root: r, markerPath: join(r, ".unown", "watch.json") });
                                          if (parsed.root) d.roots.push(parsed.root);
                                  }
                                  return d;
                          })()
                        : discoverWatchRoots();
        const seen = seenHashes();
        const results: WatchScanRootResult[] = [];

        for (const root of discovery.roots) {
                const { files, comments } = scanRoot(root);
                const fresh = comments.filter((c) => !seen.has(c.hash));
                emit("watch:scan", { root: root.root, comments: comments.length, new: fresh.length });
                const base: WatchScanRootResult = {
                        root: root.root,
                        mode: root.mode,
                        markerPath: root.markerPath,
                        files: files.length,
                        comments: comments.length,
                        newComments: fresh.length,
                        run: null,
                };

                if (fresh.length === 0) {
                        // The cheap path: refresh last_seen for what is still there. No
                        // LLM cost, no run row — a quiet tick stays quiet.
                        markSeen(comments, now());
                        results.push(base);
                        continue;
                }

                // ONE batched run per root per scan (the budget rule — aider batches
                // its watch prompts the same way).
                const startedAt = now();
                const info = store.run(
                        `INSERT INTO watch_runs (root, comments, mode, status, output, started_at, finished_at)
                         VALUES (?, ?, ?, 'running', NULL, ?, NULL)`,
                        [root.root, fresh.length, root.mode, startedAt],
                );
                const runId = Number(info.lastInsertRowid);
                let outcome: WatchSpawnOutcome;
                try {
                        outcome = await spawn({ root: root.root, prompt: buildWatchPrompt(fresh, { root: root.root, mode: root.mode }), mode: root.mode });
                } catch (err: any) {
                        outcome = { exitCode: 1, output: `spawn failed: ${err?.message ?? err}`, turns: 0, tokensIn: 0, tokensOut: 0 };
                }

                // Post-run reconcile, scoped to the PRE-scan comments: a comment
                // that APPEARED mid-run is in neither set below — it stays unseen
                // and the next scan dispatches it (marking it now would swallow it
                // forever).
                const after = scanRoot(root);
                const afterByHash = new Set(after.comments.map((c) => c.hash));
                const stillPresent = comments.filter((c) => afterByHash.has(c.hash));
                const gone = comments.filter((c) => !afterByHash.has(c.hash));
                markSeen(stillPresent, now());
                for (const c of gone) store.run(`DELETE FROM watch_seen WHERE hash = ?`, [c.hash]);

                const status: "succeeded" | "failed" = outcome.exitCode === 0 ? "succeeded" : "failed";
                store.run(
                        `UPDATE watch_runs SET status = ?, output = ?, finished_at = ? WHERE id = ?`,
                        [status, outcome.output.slice(0, 20_000), now(), runId],
                );
                const record: WatchRunRecord = {
                        runId,
                        status,
                        exitCode: outcome.exitCode,
                        comments: fresh.length,
                        resolved: gone.length,
                        stillPresent: stillPresent.length,
                        turns: outcome.turns,
                        tokensIn: outcome.tokensIn,
                        tokensOut: outcome.tokensOut,
                };
                emit("watch:run-finished", { root: root.root, runId, status, comments: fresh.length, resolved: gone.length });
                results.push({ ...base, run: record });
        }

        return { roots: results, warnings: discovery.warnings };
}

/** The last recorded runs (newest first) — `unown watch` surfaces them, the
 *  dashboard/SSE story reads them off watch_runs. */
export function recentWatchRuns(limit = 10): Array<{
        id: number;
        root: string;
        comments: number;
        mode: string;
        status: string;
        started_at: number;
        finished_at: number | null;
}> {
        ensureWatchSchema();
        return store.query(
                `SELECT id, root, comments, mode, status, started_at, finished_at FROM watch_runs ORDER BY id DESC LIMIT ?`,
                [limit],
        );
}
