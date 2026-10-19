/**
 * blame.ts — `/blame` receipts reader (Milestone 3.4).
 *
 * Reverse-engineered from Cursor's blame view (per the 2-b2-report.md
 * proposal #2). The receipts ledger at `.unown/receipts/<session>.jsonl`
 * (written by `checkpoints.ts:ReceiptsLedger`) records every tool call +
 * result with file paths, commands, and timestamps. This module reads those
 * ledgers and surfaces "who touched this file, when, with what tool" — the
 * agent's own audit trail over project files.
 *
 * Purity contract:
 *   - `node:fs` + `node:path` only. No pi imports, no bus, no store, no
 *     spawn. The receipts schema (a JSONL of `ReceiptEntry`-shaped records)
 *     is read as plain JSON — no `checkpoints.ts` import.
 *   - Tolerant: missing receipts dir → empty result; corrupt JSONL lines
 *     are skipped (and counted); a ledger file that disappears mid-scan is
 *     ignored. Never throws.
 *
 * Composition: the `/blame` slash command (registered in `tools.ts`) calls
 * `blameFile` / `blameSummary` against `receiptsDir(cwd)` and renders the
 * result via `formatBlameReport` (or `formatBlameJson` with `--json`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep as pathSep } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One "blame" entry — a single receipt that touched a file. */
export interface BlameEntry {
    /** Receipt timestamp (epoch ms). */
    ts: number;
    /**
     * 1-based turn number within the session — the count of `input` events
     * seen so far when this entry was recorded (0 = before any user input,
     * e.g. session_start). Null when the entry predates the turn counter
     * (legacy ledgers with no `input` records at all).
     */
    turn: number | null;
    /** Session boot id — the ledger filename stem. */
    sessionId: string;
    /** Tool name (`write`, `edit`, `bash`, `powershell`, ...). */
    tool: string;
    /** Short human-readable summary of the action (path / command snippet). */
    summary: string;
}

export interface BlameSummary {
    /** Total entries scanned across all matching ledgers. */
    totalEntries: number;
    /** Count of entries per tool name. */
    byTool: Record<string, number>;
    /** Distinct file paths written/edited (write+edit only — bash paths are
     *  command-shaped, not file-shaped, so they are excluded to keep the
     *  summary meaningful). */
    filesTouched: string[];
}

export interface BlameOptions {
    /** Filter to one session (the ledger filename stem). */
    sessionId?: string;
    /** Filter to entries at or after this epoch-ms timestamp. */
    since?: number;
}

// ---------------------------------------------------------------------------
// Internal: ledger file discovery + line parsing
// ---------------------------------------------------------------------------

/** A raw receipt entry — the subset of fields blame cares about. */
interface RawReceipt {
    seq: number;
    ts: number;
    kind: string;
    tool?: string;
    input?: Record<string, unknown>;
    [key: string]: unknown;
}

/** One ledger file's content parsed into entries + a corrupt-line count. */
interface ParsedLedger {
    sessionId: string;
    entries: RawReceipt[];
    corruptLines: number;
}

/** List the `*.jsonl` ledger files under `dir`, sorted by mtime (oldest first). */
function listLedgerFiles(dir: string, sessionId?: string): string[] {
    if (!existsSync(dir)) return [];
    let names: string[];
    try {
        names = readdirSync(dir);
    } catch {
        return [];
    }
    const files = names
        .filter((n) => n.endsWith(".jsonl"))
        .map((n) => ({ name: n, path: join(dir, n) }))
        .filter((f) => {
            if (!sessionId) return true;
            // ledger filename: `<bootId>.jsonl` or `sub-<bootId>.jsonl`
            // (subagent ledgers, per checkpoints.ts:951). Match either the
            // bare stem or the post-`sub-` stem.
            const stem = f.name.slice(0, -".jsonl".length);
            return stem === sessionId || stem === `sub-${sessionId}`;
        });
    // Sort oldest-first by mtime — stable across runs (the ledger filename
    // itself carries a timestamp prefix, but mtime is more reliable when
    // files were copied in).
    try {
        files.sort((a, b) => {
            const ta = statSync(a.path).mtimeMs;
            const tb = statSync(b.path).mtimeMs;
            return ta - tb;
        });
    } catch {
        /* ignore — fall back to readdir's order */
    }
    return files.map((f) => f.path);
}

/**
 * Read + parse one ledger file. Tolerant: empty lines and corrupt JSON are
 * skipped (counted), never thrown. A truncated tail line (the writer was
 * interrupted mid-append) rides the corrupt-line count.
 */
function parseLedger(file: string): ParsedLedger {
    const name = file.split(pathSep).pop() ?? file;
    const sessionId = name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : name;
    const entries: RawReceipt[] = [];
    let corruptLines = 0;
    let text: string;
    try {
        text = readFileSync(file, "utf8");
    } catch {
        return { sessionId, entries, corruptLines: 0 };
    }
    for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
            const parsed = JSON.parse(line);
            if (parsed && typeof parsed === "object" && typeof (parsed as any).kind === "string") {
                entries.push(parsed as RawReceipt);
            } else {
                corruptLines++;
            }
        } catch {
            corruptLines++;
        }
    }
    return { sessionId, entries, corruptLines };
}

// ---------------------------------------------------------------------------
// Internal: file-path matching (write/edit path + bash command substring)
// ---------------------------------------------------------------------------

/**
 * True when `candidatePath` (the `input.path` of a write/edit receipt)
 * refers to the same file as `targetPath`. Tolerant of:
 *   - absolute vs relative (resolved against an optional `cwd`)
 *   - leading `./`
 *   - case differences on case-insensitive filesystems (win32/darwin)
 *   - shared basenames when the full path is otherwise ambiguous (a
 *     pragmatic last-resort match so `/blame package.json` finds writes
 *     to `./package.json` without forcing the user to type the full path)
 */
function pathsMatch(candidatePath: string, targetPath: string, cwd?: string): boolean {
    if (!candidatePath || !targetPath) return false;
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    const a = norm(candidatePath);
    const b = norm(targetPath);
    if (!a || !b) return false;
    if (a === b) return true;
    // Resolve against cwd and compare absolutes (handles `src/x.ts` vs
    // `/abs/cwd/src/x.ts`). When no cwd is supplied, fall back to a
    // suffix-aware compare.
    if (cwd) {
        try {
            const ra = resolve(cwd, a);
            const rb = resolve(cwd, b);
            if (ra === rb) return true;
            // Compare case-insensitively on Windows + macOS (default FS).
            if (process.platform === "win32" || process.platform === "darwin") {
                if (ra.toLowerCase() === rb.toLowerCase()) return true;
            }
        } catch {
            /* ignore */
        }
    }
    // Suffix match: `/abs/cwd/src/x.ts` ends with `src/x.ts` (or vice-versa).
    const lower = (s: string) => (process.platform === "win32" || process.platform === "darwin" ? s.toLowerCase() : s);
    if (lower(a).endsWith(lower(b)) || lower(b).endsWith(lower(a))) {
        // Require a path-separator boundary so `foo.ts` doesn't match `barfoo.ts`.
        const longer = a.length >= b.length ? a : b;
        const shorter = a.length >= b.length ? b : a;
        const idx = longer.toLowerCase().indexOf(shorter.toLowerCase());
        if (idx === 0 || longer[idx - 1] === "/" || longer[idx - 1] === "\\") return true;
    }
    // Last resort: basename match (only when one side is a bare filename).
    const baseA = a.split("/").pop() ?? a;
    const baseB = b.split("/").pop() ?? b;
    if (baseA === baseB && baseA.length > 0) {
        // Only count basename matches when the target has no path separator
        // (i.e., the user really did ask for the bare filename) — this keeps
        // `src/util.ts` from matching an unrelated `tests/util.ts`.
        if (!b.includes("/")) return true;
    }
    return false;
}

/**
 * True when `command` (the `input.command` of a bash receipt) references
 * `targetPath` — either as a full-path substring, a relative-path substring,
 * or a basename token. Matches `cat src/foo.ts`, `vim src/foo.ts`,
 * `echo x > src/foo.ts`, `rm src/foo.ts`, etc.
 */
function commandReferencesPath(command: string, targetPath: string): boolean {
    if (!command || !targetPath) return false;
    if (command.includes(targetPath)) return true;
    // Normalize the path's separators for the substring check (bash uses `/`
    // even on Windows in most cases; allow `\` too).
    const norm = targetPath.replace(/\\/g, "/");
    if (norm !== targetPath && command.includes(norm)) return true;
    // Basename token match: the path's last segment appears as a token-like
    // substring of the command. Require at least 3 chars so short names
    // like `a.ts` don't false-positive inside other words.
    const base = norm.split("/").pop() ?? norm;
    if (base.length >= 3) {
        // Word-ish boundary: preceded by start/space/quote/= or followed by
        // end/space/quote. Keeps `cat src/foo.ts` matching but not `cat
        // src/foo.ts.bak` (the `.bak` suffix breaks the trailing boundary).
        const re = new RegExp(`(^|[\\s"'\`=])${escapeRegex(base)}($|[\\s"'\`])`);
        if (re.test(command)) return true;
    }
    return false;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Internal: build a BlameEntry from a tool_call receipt
// ---------------------------------------------------------------------------

/**
 * Build a BlameEntry from a `tool_call` receipt + the running turn count.
 * Returns null when the entry has no `tool`/`ts` (malformed) — those are
 * skipped silently by the caller.
 */
function buildEntry(rec: RawReceipt, sessionId: string, turn: number | null): BlameEntry | null {
    const tool = typeof rec.tool === "string" ? rec.tool : "";
    if (typeof rec.ts !== "number" || !tool) return null;
    const summary = describeAction(tool, rec.input ?? {});
    return { ts: rec.ts, turn, sessionId, tool, summary };
}

/** Render a one-line summary of the tool_call's input (path or command). */
function describeAction(tool: string, input: Record<string, unknown> | undefined): string {
    if (!input) return "";
    if (tool === "bash" || tool === "powershell") {
        const cmd = typeof input.command === "string" ? input.command : "";
        return cmd.replace(/\s+/g, " ").trim().slice(0, 120);
    }
    const p = typeof input.path === "string" ? input.path : "";
    if (p) return p.length > 100 ? `…${p.slice(-99)}` : p;
    if (typeof input.url === "string") return input.url.slice(0, 100);
    if (typeof input.task === "string") return input.task.slice(0, 80);
    return "";
}

// ---------------------------------------------------------------------------
// Public API: blameFile / blameSummary
// ---------------------------------------------------------------------------

/**
 * Find every receipt entry that touched `filePath` — write/edit calls whose
 * `input.path` matches, and bash/powershell calls whose `input.command`
 * references the path. Returns entries oldest-first, with the session id
 * and turn number attached for attribution.
 *
 * Options:
 *   - `sessionId` — restrict to one session's ledger.
 *   - `since`     — epoch-ms; only entries at or after this time.
 *
 * Tolerant: a missing `receiptsDir` returns `[]`. Corrupt JSONL lines are
 * skipped silently (their count surfaces only in `blameSummary`).
 */
export function blameFile(
    receiptsDir: string,
    filePath: string,
    opts: BlameOptions = {},
    cwd?: string,
): BlameEntry[] {
    const out: BlameEntry[] = [];
    const files = listLedgerFiles(receiptsDir, opts.sessionId);
    for (const file of files) {
        const { sessionId, entries } = parseLedger(file);
        let turn: number | null = null;
        for (const rec of entries) {
            if (rec.kind === "input") {
                turn = (turn ?? 0) + 1;
                continue;
            }
            if (rec.kind !== "tool_call") continue;
            if (typeof opts.since === "number" && typeof rec.ts === "number" && rec.ts < opts.since) {
                continue;
            }
            const tool = typeof rec.tool === "string" ? rec.tool : "";
            const input = (rec.input ?? {}) as Record<string, unknown>;
            const touched =
                (tool === "write" || tool === "edit") && typeof input.path === "string"
                    ? pathsMatch(input.path, filePath, cwd)
                    : (tool === "bash" || tool === "powershell") && typeof input.command === "string"
                      ? commandReferencesPath(input.command, filePath)
                      : false;
            if (!touched) continue;
            const entry = buildEntry(rec, sessionId, turn);
            if (entry) out.push(entry);
        }
    }
    return out;
}

/**
 * Summarize every receipt entry across the matching ledgers: total count,
 * per-tool counts, and the distinct files written/edited. `sessionId`
 * restricts the scan to one session (no `since` filter here — summaries are
 * session-shaped, not time-shaped; callers that need time-bounded summaries
 * can call `blameFile` per file).
 */
export function blameSummary(receiptsDir: string, opts: BlameOptions = {}): BlameSummary {
    let totalEntries = 0;
    const byTool: Record<string, number> = {};
    const filesTouched = new Set<string>();
    const files = listLedgerFiles(receiptsDir, opts.sessionId);
    for (const file of files) {
        const { entries } = parseLedger(file);
        for (const rec of entries) {
            if (rec.kind !== "tool_call") continue;
            if (typeof opts.since === "number" && typeof rec.ts === "number" && rec.ts < opts.since) {
                continue;
            }
            totalEntries++;
            const tool = typeof rec.tool === "string" ? rec.tool : "(unknown)";
            byTool[tool] = (byTool[tool] ?? 0) + 1;
            // Distinct files: write/edit only (bash commands aren't file-shaped).
            if (tool === "write" || tool === "edit") {
                const p = typeof rec.input?.path === "string" ? (rec.input.path as string) : "";
                if (p) filesTouched.add(p);
            }
        }
    }
    return { totalEntries, byTool, filesTouched: [...filesTouched].sort() };
}

// ---------------------------------------------------------------------------
// Public API: formatters
// ---------------------------------------------------------------------------

/**
 * Render blame entries as markdown, grouped by session. Each session block
 * shows the count + a bulleted timeline (ISO timestamp, turn, tool, summary).
 * Designed to be readable in a terminal `/blame` notification.
 */
export function formatBlameReport(entries: BlameEntry[], filePath?: string): string {
    const title = filePath ? `# Blame — \`${filePath}\`` : "# Blame — receipts";
    if (entries.length === 0) {
        return `${title}\n\n_No matching receipts found._`;
    }
    // Group by sessionId, preserving the order they were seen in (oldest-first
    // per the blameFile contract — entries from one session arrive together).
    const bySession = new Map<string, BlameEntry[]>();
    for (const e of entries) {
        const arr = bySession.get(e.sessionId) ?? [];
        arr.push(e);
        bySession.set(e.sessionId, arr);
    }
    const lines: string[] = [title, ""];
    let totalShown = 0;
    for (const [sessionId, arr] of bySession) {
        lines.push(`## Session \`${sessionId}\` (${arr.length} touch${arr.length === 1 ? "" : "es"})`);
        lines.push("");
        for (const e of arr) {
            const iso = new Date(e.ts).toISOString();
            const turnLabel = e.turn === null ? "—" : `turn ${e.turn}`;
            lines.push(`- \`${iso}\` ${turnLabel} — ${e.tool}: ${e.summary}`);
        }
        lines.push("");
        totalShown += arr.length;
    }
    lines.push(`_Showing ${totalShown} receipt${totalShown === 1 ? "" : "s"} across ${bySession.size} session${bySession.size === 1 ? "" : "s"}._`);
    return lines.join("\n");
}

/** Render blame entries as a JSON string (machine-readable, `--json` flag). */
export function formatBlameJson(entries: BlameEntry[]): string {
    return JSON.stringify(entries, null, 2);
}
