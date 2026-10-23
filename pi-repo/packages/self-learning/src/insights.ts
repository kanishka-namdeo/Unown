/**
 * insights.ts — `/insights` cross-session analytics engine (v0.0.7 parity round).
 *
 * Claude Code's /insights parity: analyze the user's OWN history and surface
 * what they worked on, where the friction was, and what it cost. Three data
 * sources, all local, all read tolerantly:
 *
 *   1. Live pi session transcripts — `~/.unown/agent/sessions/<ts>_<id>.jsonl`
 *      (first line = session header {type:"session", id, timestamp, cwd}; then
 *      message entries carrying role/model/usage — the same runtime shape
 *      sessions-cli.ts's FileSessionLike parses). Walked for message counts,
 *      a per-model session census, token sums, per-cwd project frequency, and
 *      failed toolResults (the friction signal).
 *   2. Project receipts ledger — `<cwd>/.unown/receipts/*.jsonl` (the
 *      checkpoints.ts ReceiptsLedger runtime shape, read as plain JSON like
 *      blame.ts does — no checkpoints import). Walked for tool-call counts,
 *      most-touched files (write/edit `input.path`, relativized against the
 *      cwd when prefixable), and learning notes (count + latest).
 *   3. Bridge usage — GET /v1/usage?days=N, the same aggregate `unown usage`
 *      reads. INJECTED as `fetchUsage` so tests (and any offline caller) stay
 *      pure; the default wraps usage-cli.ts's `fetchBridgeUsage` with the
 *      identical env resolution (PI_BRIDGE_URL / BRIDGE_API_KEY).
 *
 * Purity contract (blame.ts's): `node:fs`/`node:os`/`node:path` plus the
 * side-effect-free helpers re-exported by usage-cli.ts. No pi imports, no
 * store, no bus, no spawn. The only I/O is the two scan functions over
 * explicit dirs plus the injected bridge fetch. Tolerant by construction:
 * missing dirs → zeroed fields; unreadable/malformed files are skipped
 * file-wise, malformed lines line-wise; a throwing `fetchUsage` degrades to
 * `bridge: null`. `buildInsightsReport` never throws on bad data.
 *
 * Window semantics (deliberate, Claude-Code-like): the session/receipts scans
 * are NOT time-filtered — "what have I been doing" wants the cumulative local
 * record, bounded only by `maxSessions` (the N most-recent transcript files
 * by mtime, so a years-old archive can't stall the report). The `days` window
 * applies ONLY to the bridge usage call, whose aggregate is time-bounded
 * server-side; the renderer restates it in the closing line.
 *
 * Composition: the `/insights` slash command (registered in tools.ts) calls
 * `buildInsightsReport({ cwd })`, renders via `renderInsightsReport` (plain
 * text, ANSI-free — the caller colorizes), and appends `insightsHintLine` as
 * the footer hint.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep as pathSep } from "node:path";

import { fetchBridgeUsage, formatCostUsd, formatInt, resolveBridgeUrl, type UsageSummary } from "./usage-cli.ts";

// ---------------------------------------------------------------------------
// Defaults + public types
// ---------------------------------------------------------------------------

/** Default analytics window (days) — bounds the BRIDGE usage call only. */
const DEFAULT_WINDOW_DAYS = 7;
/** Default transcript cap: the N most-recent session files by mtime. */
const DEFAULT_MAX_SESSIONS = 200;
/** Renderer row cap for every ranked list (`… +N more` beyond it). */
const RENDER_ROW_CAP = 8;
/** Report-level cap for activeProjects (the spec'd "top 5 projects"). */
const ACTIVE_PROJECTS_CAP = 5;
/** Latest-note text cap (chars) — a footer hint, not a transcript. */
const NOTE_TEXT_CAP = 120;
/**
 * Friction heuristic: a toolResult (or a learning note) whose text matches
 * reads as a failure. Deliberately textual — Claude Code's /insights reads
 * error-ish output the same way; `exit code [1-9]` catches the bash convention
 * while `exit code 0` stays a success.
 */
const FRICTION_TEXT_RE = /error|failed|exit code [1-9]/i;

/** Options for `buildInsightsReport` — all paths explicit, all I/O injectable. */
export interface InsightsOptions {
    /** Project root: anchors receipt discovery + file-path relativization. */
    cwd: string;
    /** Live pi transcripts dir. Default: `${UNOWN_HOME || ~/.unown}/agent/
     *  sessions` (term.ts's resolveUnownHome convention — `||` so an empty
     *  env value means unset, the house rule). */
    sessionsDir?: string;
    /** Receipts ledger dir. Default: `<cwd>/.unown/receipts`. */
    receiptsDir?: string;
    /** Window in days — the ONLY thing `days` bounds (the local scans are
     *  cumulative by design). Default 7. */
    days?: number;
    /** Session-file cap: the N most recent by mtime. Default 200. */
    maxSessions?: number;
    /** Injected GET /v1/usage fetcher — tests mock it; the default wraps
     *  usage-cli.ts's `fetchBridgeUsage` with the `unown usage` env rules.
     *  Returning null (or throwing) → `report.bridge === null`. */
    fetchUsage?: (days: number) => Promise<UsageSummary | null>;
}

/** The /insights report — a pure snapshot, fully renderable offline. */
export interface InsightsReport {
    /** ISO timestamp of the scan (renderer closing line). */
    generatedAt: string;
    /** Bridge window (days) — see InsightsOptions.days. */
    windowDays: number;
    /** Session census over the (mtime-capped) transcript scan. */
    sessions: {
        /** Parsed session files — unreadable/malformed files are skipped,
         *  not counted. */
        count: number;
        /** Oldest session-header timestamp (ISO); undefined when no session
         *  carried a parseable timestamp. */
        oldest?: string;
        /** Newest session-header timestamp (ISO). */
        newest?: string;
    };
    /** Message counts by role (toolResult messages are neither). */
    messages: { user: number; assistant: number };
    /** Model census: each model counts ONCE per session that used it (the
     *  `name · N sessions` render), from assistant `message.model` with
     *  `responseModel` as fallback. Sorted count desc, model asc. */
    topModels: Array<{ model: string; count: number }>;
    /** Most-touched files: write/edit receipts by `input.path`, RELATIVE to
     *  the cwd when prefixable (absolute paths outside it stay absolute).
     *  Sorted count desc, path asc. */
    topFiles: Array<{ path: string; count: number }>;
    /** Tool-call counts from the receipts ledgers (all tools). Sorted count
     *  desc, tool asc. */
    topTools: Array<{ tool: string; count: number }>;
    /** Learning-note census from the receipts ledgers. */
    notes: {
        count: number;
        /** Highest-ts note; text whitespace-flattened and capped at 120
         *  chars. `ts` is the receipt's epoch-ms as ISO. */
        latest?: { text: string; ts?: string };
    };
    /** Token sums from session `message.usage` (assistant + toolResult —
     *  the /session attribution semantics, `entry.usage` as the compaction
     *  fallback). */
    tokens: {
        prompt: number;
        completion: number;
        /** Prompt-cache traffic: cacheRead + cacheWrite. */
        cached: number;
    };
    /** Bridge usage over the window, or null when unreachable. */
    bridge: UsageSummary | null;
    /** Friction signals. */
    friction: {
        /** toolResult messages whose text matches FRICTION_TEXT_RE. */
        failedToolResults: number;
        /** Learning notes matching the same heuristic. */
        errorNotes?: number;
        /** Distinct sessions with ≥1 failed tool result. */
        sessionsWithErrors: number;
    };
    /** Session-header cwd frequency — top 5, sorted count desc, cwd asc. */
    activeProjects: Array<{ cwd: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Internal: tolerant JSON guards + small parse helpers
// ---------------------------------------------------------------------------

/** Narrow `unknown` to a plain record (post-JSON.parse guard; arrays rejected). */
function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Finite number or 0 — usage fields drift in shape across pi versions. */
function finiteNumber(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Header timestamp (ISO string) → epoch ms, or undefined when unparseable. */
function parseTimestampMs(v: unknown): number | undefined {
    if (typeof v !== "string" || v.length === 0) return undefined;
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : undefined;
}

/** Assistant model id: `message.model` first (the /insights spec), the
 *  runtime `responseModel` as fallback (mirrors /session's rollup). */
function pickModelId(message: Record<string, unknown>): string | null {
    if (typeof message.model === "string" && message.model.length > 0) return message.model;
    if (typeof message.responseModel === "string" && message.responseModel.length > 0) return message.responseModel;
    return null;
}

/**
 * toolResult failure heuristic: any text block (or a plain-string content —
 * the two shapes pi writes) matching FRICTION_TEXT_RE. One match = one failed
 * result, regardless of how many blocks matched.
 */
function toolResultLooksFailed(message: Record<string, unknown>): boolean {
    const content = message.content;
    if (typeof content === "string") return FRICTION_TEXT_RE.test(content);
    if (!Array.isArray(content)) return false;
    for (const block of content) {
        if (isRecord(block) && block.type === "text" && typeof block.text === "string" && FRICTION_TEXT_RE.test(block.text)) {
            return true;
        }
    }
    return false;
}

/** Absolute paths inside `cwd` become cwd-relative (posix separators);
 *  everything else — already-relative, outside the cwd, or unresolvable —
 *  is returned as-is. `..`-escapes and `rel === ".."` keep the absolute form. */
function relativizePath(p: string, cwd: string): string {
    if (p.length === 0) return p;
    try {
        if (isAbsolute(p)) {
            const rel = relative(cwd, p);
            const goesUp = rel === ".." || rel.startsWith(`..${pathSep}`);
            if (rel.length > 0 && !goesUp && !isAbsolute(rel)) return rel.split(pathSep).join("/");
            return p;
        }
        return p.replace(/^\.\//, "");
    } catch {
        return p;
    }
}

/** Map<string, number> → [key, count] pairs sorted count desc, then key asc
 *  (the tiebreak makes every ranking deterministic regardless of scan order). */
function sortedCounts(map: Map<string, number>): Array<[string, number]> {
    return [...map.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Internal: session transcript scan
// ---------------------------------------------------------------------------

/** Default transcripts dir: `${UNOWN_HOME || ~/.unown}/agent/sessions` — the
 *  live pi session store (term.ts's resolveUnownHome convention, re-resolved
 *  here because term.ts drags in the whole engine import graph). */
function defaultSessionsDir(): string {
    return join(process.env.UNOWN_HOME || join(homedir(), ".unown"), "agent", "sessions");
}

/** One parsed session file: header + a tolerant entry list. */
interface ParsedSession {
    header: { id: string; timestamp?: string; cwd?: string };
    entries: Array<Record<string, unknown>>;
}

/**
 * Read + parse one session .jsonl (the FileSessionLike contract from
 * sessions-cli.ts): the first non-empty line must be a `type:"session"`
 * header with a string id, or the WHOLE file is rejected (malformed → null;
 * the caller skips it without counting). Subsequent lines are entries;
 * malformed ones are skipped line-by-line so a truncated tail never loses
 * the session — mirroring pi's own loadEntriesFromFile tolerance.
 */
function parseSessionFile(file: string): ParsedSession | null {
    let text: string;
    try {
        text = readFileSync(file, "utf8");
    } catch {
        return null;
    }
    const lines = text.split("\n");
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().length > 0) {
            headerIdx = i;
            break;
        }
    }
    if (headerIdx < 0) return null;
    let header: unknown;
    try {
        header = JSON.parse(lines[headerIdx]);
    } catch {
        return null;
    }
    if (!isRecord(header) || header.type !== "session" || typeof header.id !== "string") return null;
    const entries: Array<Record<string, unknown>> = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().length === 0) continue;
        try {
            const entry: unknown = JSON.parse(line);
            if (isRecord(entry) && typeof entry.type === "string") entries.push(entry);
        } catch {
            /* malformed entry line — skipped, the session is retained */
        }
    }
    return {
        header: {
            id: header.id,
            timestamp: typeof header.timestamp === "string" ? header.timestamp : undefined,
            cwd: typeof header.cwd === "string" ? header.cwd : undefined,
        },
        entries,
    };
}

/**
 * List the `*.jsonl` files under `dir`, NEWEST-mtime first (filename
 * tiebreak). Tolerant: a missing/unreadable dir yields []; files that vanish
 * or fail to stat mid-scan are skipped. The caller slices to `maxSessions`.
 */
function listJsonlFiles(dir: string): Array<{ path: string; mtimeMs: number }> {
    if (!existsSync(dir)) return [];
    let names: string[];
    try {
        names = readdirSync(dir);
    } catch {
        return [];
    }
    const out: Array<{ path: string; mtimeMs: number }> = [];
    for (const name of names) {
        if (!name.endsWith(".jsonl")) continue;
        const path = join(dir, name);
        try {
            out.push({ path, mtimeMs: statSync(path).mtimeMs });
        } catch {
            /* unstattable (race, permission) — skip */
        }
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return out;
}

// ---------------------------------------------------------------------------
// Internal: receipts ledger scan
// ---------------------------------------------------------------------------

/** Receipts-side stats: tool/file rankings + the learning-note census. */
interface ReceiptsStats {
    topTools: Array<{ tool: string; count: number }>;
    topFiles: Array<{ path: string; count: number }>;
    noteCount: number;
    errorNotes: number;
    latestNote: { text: string; ts?: string } | undefined;
}

/**
 * Scan every `*.jsonl` ledger under `receiptsDir` (oldest-first — blame.ts's
 * listing convention, filename tiebreak). Only `tool_call` and `note` entries
 * matter: tool calls feed the tool ranking, and write/edit `input.path` the
 * file ranking (relativized against `cwd`); notes feed the learning census.
 * Tolerant of missing dirs, corrupt lines, and shape drift — the runtime
 * ledger (checkpoints.ts) writes `preview`, some writers `content`; both are
 * read, `content` preferred.
 */
function scanReceipts(receiptsDir: string, cwd: string): ReceiptsStats {
    const toolCounts = new Map<string, number>();
    const fileCounts = new Map<string, number>();
    let noteCount = 0;
    let errorNotes = 0;
    let latestNote: { text: string; ts?: string } | undefined;
    let latestTs: number | undefined;

    const files = listJsonlFiles(receiptsDir);
    files.sort((a, b) => a.mtimeMs - b.mtimeMs || (a.path < b.path ? -1 : 1));
    for (const { path } of files) {
        let text: string;
        try {
            text = readFileSync(path, "utf8");
        } catch {
            continue;
        }
        for (const line of text.split("\n")) {
            if (line.trim().length === 0) continue;
            let rec: unknown;
            try {
                rec = JSON.parse(line);
            } catch {
                continue;
            }
            if (!isRecord(rec)) continue;
            if (rec.kind === "tool_call" && typeof rec.tool === "string" && rec.tool.length > 0) {
                toolCounts.set(rec.tool, (toolCounts.get(rec.tool) ?? 0) + 1);
                if (rec.tool === "write" || rec.tool === "edit") {
                    const input = rec.input;
                    const p = isRecord(input) && typeof input.path === "string" ? input.path : "";
                    if (p.length > 0) {
                        const key = relativizePath(p, cwd);
                        fileCounts.set(key, (fileCounts.get(key) ?? 0) + 1);
                    }
                }
            } else if (rec.kind === "note") {
                noteCount++;
                // `content` per the spec'd shape, `preview` per the runtime
                // ledger — flattened so a multi-line note renders one row.
                const raw = typeof rec.content === "string" ? rec.content : typeof rec.preview === "string" ? rec.preview : "";
                const flat = raw.replace(/\s+/g, " ").trim();
                const capped = flat.length > NOTE_TEXT_CAP ? flat.slice(0, NOTE_TEXT_CAP - 1) + "…" : flat;
                if (flat.length > 0 && FRICTION_TEXT_RE.test(flat)) errorNotes++;
                if (typeof rec.ts === "number" && Number.isFinite(rec.ts)) {
                    // Highest ts wins; a same-ts tie takes the later-seen entry
                    // (append order is chronological within a ledger).
                    if (latestTs === undefined || rec.ts >= latestTs) {
                        latestTs = rec.ts;
                        latestNote = { text: capped, ts: new Date(rec.ts).toISOString() };
                    }
                } else if (latestNote === undefined) {
                    // A ts-less note only leads when nothing better exists.
                    latestNote = { text: capped };
                }
            }
        }
    }
    return {
        topTools: sortedCounts(toolCounts).map(([tool, count]) => ({ tool, count })),
        topFiles: sortedCounts(fileCounts).map(([path, count]) => ({ path, count })),
        noteCount,
        errorNotes,
        latestNote,
    };
}

// ---------------------------------------------------------------------------
// Public API: buildInsightsReport
// ---------------------------------------------------------------------------

/** Default bridge fetch: the exact `unown usage` transport (PI_BRIDGE_URL /
 *  BRIDGE_API_KEY env, 4s abort) — null when the bridge is unreachable. */
function defaultFetchUsage(days: number): Promise<UsageSummary | null> {
    return fetchBridgeUsage(resolveBridgeUrl(process.env), days, undefined, process.env.BRIDGE_API_KEY || undefined);
}

/**
 * Build the /insights report: scan the sessions dir (capped at
 * `maxSessions` most-recent .jsonl files by mtime — the window does NOT
 * filter local history), walk entries for message counts, the per-model
 * session census, token sums, project frequency and failed toolResults;
 * scan the receipts dir for tool/file rankings and the note census; fetch
 * bridge usage through the injected (or default) fetcher.
 *
 * NEVER throws on individual bad data: missing dirs → zeroed fields,
 * unreadable/malformed files and lines are skipped, a null-or-throwing
 * fetchUsage → `bridge: null`. See the module header for the full purity
 * contract.
 */
export async function buildInsightsReport(opts: InsightsOptions): Promise<InsightsReport> {
    const cwd = opts.cwd;
    const days = opts.days ?? DEFAULT_WINDOW_DAYS;
    const maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
    const sessionsDir = opts.sessionsDir ?? defaultSessionsDir();
    const receiptsDir = opts.receiptsDir ?? join(cwd, ".unown", "receipts");

    // -- 1. session transcripts -------------------------------------------
    let sessionCount = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;
    let failedToolResults = 0;
    let sessionsWithErrors = 0;
    let oldestMs: number | undefined;
    let newestMs: number | undefined;
    const modelCounts = new Map<string, number>();
    const projectCounts = new Map<string, number>();

    for (const { path } of listJsonlFiles(sessionsDir).slice(0, maxSessions)) {
        const parsed = parseSessionFile(path);
        if (parsed === null) continue; // unreadable/malformed — skipped, not counted
        sessionCount++;
        if (parsed.header.cwd !== undefined && parsed.header.cwd.length > 0) {
            projectCounts.set(parsed.header.cwd, (projectCounts.get(parsed.header.cwd) ?? 0) + 1);
        }
        const tsMs = parseTimestampMs(parsed.header.timestamp);
        if (tsMs !== undefined) {
            if (oldestMs === undefined || tsMs < oldestMs) oldestMs = tsMs;
            if (newestMs === undefined || tsMs > newestMs) newestMs = tsMs;
        }
        // Per-session model census: a model counts once per session that used
        // it (the `name · N sessions` render), not per assistant message.
        const sessionModels = new Set<string>();
        let sessionFailed = false;
        for (const entry of parsed.entries) {
            if (entry.type !== "message") continue;
            const message = entry.message;
            if (!isRecord(message)) continue;
            const role = message.role;
            if (role === "user") {
                userMessages++;
            } else if (role === "assistant") {
                assistantMessages++;
                const model = pickModelId(message);
                if (model !== null) sessionModels.add(model);
            }
            // Usage rides assistant AND toolResult messages (the /session
            // attribution semantics); entry.usage is the compaction fallback.
            const usage = isRecord(message.usage) ? message.usage : isRecord(entry.usage) ? entry.usage : null;
            if (usage !== null) {
                promptTokens += finiteNumber(usage.input);
                completionTokens += finiteNumber(usage.output);
                cachedTokens += finiteNumber(usage.cacheRead) + finiteNumber(usage.cacheWrite);
            }
            if (role === "toolResult" && toolResultLooksFailed(message)) {
                failedToolResults++;
                sessionFailed = true;
            }
        }
        if (sessionFailed) sessionsWithErrors++;
        for (const model of sessionModels) {
            modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
        }
    }

    // -- 2. receipts ledgers ------------------------------------------------
    const receipts = scanReceipts(receiptsDir, cwd);

    // -- 3. bridge usage (injected) -----------------------------------------
    const fetchUsage = opts.fetchUsage ?? defaultFetchUsage;
    let bridge: UsageSummary | null = null;
    try {
        bridge = (await fetchUsage(days)) ?? null;
    } catch {
        bridge = null; // an unreachable bridge must never sink the report
    }

    return {
        generatedAt: new Date().toISOString(),
        windowDays: days,
        sessions: {
            count: sessionCount,
            oldest: oldestMs !== undefined ? new Date(oldestMs).toISOString() : undefined,
            newest: newestMs !== undefined ? new Date(newestMs).toISOString() : undefined,
        },
        messages: { user: userMessages, assistant: assistantMessages },
        topModels: sortedCounts(modelCounts).map(([model, count]) => ({ model, count })),
        topFiles: receipts.topFiles,
        topTools: receipts.topTools,
        notes: { count: receipts.noteCount, latest: receipts.latestNote },
        tokens: { prompt: promptTokens, completion: completionTokens, cached: cachedTokens },
        bridge,
        friction: {
            failedToolResults,
            errorNotes: receipts.errorNotes,
            sessionsWithErrors,
        },
        activeProjects: sortedCounts(projectCounts)
            .slice(0, ACTIVE_PROJECTS_CAP)
            .map(([projectCwd, count]) => ({ cwd: projectCwd, count })),
    };
}

// ---------------------------------------------------------------------------
// Public API: renderInsightsReport + insightsHintLine
// ---------------------------------------------------------------------------

/** Compact date for ranges: "2026-10-19 10:00" — renderUsageTable's
 *  since-format convention (`toISOString().replace("T", " ").slice(0, 16)`). */
function fmtDate(iso: string): string {
    return iso.replace("T", " ").slice(0, 16);
}

/** Word-level pluralization: `pl(2, "touch", "touches")` — a bare `+"s"
 *  suffix helper would render "touchs" (the reason this exists). */
function pl(n: number, one: string, many: string): string {
    return n === 1 ? one : many;
}

/** Cap a rendered list at RENDER_ROW_CAP rows + a `… +N more` overflow line. */
function capRows(rows: string[]): string[] {
    if (rows.length <= RENDER_ROW_CAP) return rows;
    return [...rows.slice(0, RENDER_ROW_CAP), `… +${formatInt(rows.length - RENDER_ROW_CAP)} more`];
}

/**
 * The Tokens section's bridge line: the windowed aggregate + cost. Honest by
 * construction — `cost —` when costUsd is null (prices unpinned), an
 * "unreachable" line when the bridge is down. Reuses usage-cli's
 * formatCostUsd so /insights and /usage can never disagree on money.
 */
function renderBridgeLine(report: InsightsReport): string {
    const b = report.bridge ?? null;
    if (b === null) return "  bridge: unreachable — `unown usage` reads the log directly";
    const totals: Record<string, unknown> = isRecord(b.totals) ? b.totals : {};
    const pricing: Record<string, unknown> = isRecord(b.pricing) ? b.pricing : {};
    const costUsd = typeof totals.costUsd === "number" ? totals.costUsd : null;
    const estimate = pricing.estimate === true;
    const cost = costUsd !== null ? formatCostUsd(costUsd, estimate) : "cost —";
    const windowDays = typeof b.days === "number" ? b.days : report.windowDays;
    const requests = typeof totals.requests === "number" ? totals.requests : 0;
    const errors = typeof totals.errors === "number" ? totals.errors : 0;
    return `  bridge ${formatInt(windowDays)}d · ${formatInt(requests)} requests · ${formatInt(errors)} errors · ${cost}`;
}

/**
 * Render the report as plain TUI text (ANSI-free — the caller colorizes).
 * Sections use the /learning separator style (`── NAME · detail ──`):
 * Sessions (count + date range), Activity (messages + top projects),
 * Models (`name · N sessions`), most-touched Files, Tool usage, Learning
 * (notes + latest), Tokens (prompt/completion/cached + the bridge line),
 * Friction (failed tool results + affected sessions), closed by
 * `window: N days · generated <iso>`. Every ranked list is capped at 8 rows
 * with `… +N more`; numbers are locale-formatted (en-US grouping — pinned
 * locale, so output is byte-identical across hosts). Pure: two calls on the
 * same report produce identical strings.
 */
export function renderInsightsReport(report: InsightsReport): string {
    const sections: string[] = [];

    // ── SESSIONS ──
    {
        const lines = [`── SESSIONS · ${formatInt(report.sessions.count)} ──`];
        if (report.sessions.count === 0) {
            lines.push("no sessions found");
        } else {
            const oldest = report.sessions.oldest !== undefined ? fmtDate(report.sessions.oldest) : "—";
            const newest = report.sessions.newest !== undefined ? fmtDate(report.sessions.newest) : "—";
            lines.push(`${formatInt(report.sessions.count)} ${pl(report.sessions.count, "session", "sessions")} · ${oldest} → ${newest}`);
        }
        sections.push(lines.join("\n"));
    }

    // ── ACTIVITY ──
    {
        const totalMessages = report.messages.user + report.messages.assistant;
        const lines = [`── ACTIVITY · ${formatInt(totalMessages)} ${pl(totalMessages, "message", "messages")} ──`];
        lines.push(`user ${formatInt(report.messages.user)} · assistant ${formatInt(report.messages.assistant)}`);
        if (report.activeProjects.length > 0) {
            lines.push("projects:");
            lines.push(
                ...capRows(
                    report.activeProjects.map((p) => `  ${p.cwd} · ${formatInt(p.count)} ${pl(p.count, "session", "sessions")}`),
                ),
            );
        } else {
            lines.push("projects: —");
        }
        sections.push(lines.join("\n"));
    }

    // ── MODELS ──
    {
        const lines = [`── MODELS · ${formatInt(report.topModels.length)} ──`];
        if (report.topModels.length === 0) {
            lines.push("  none recorded");
        } else {
            lines.push(
                ...capRows(report.topModels.map((m) => `  ${m.model} · ${formatInt(m.count)} ${pl(m.count, "session", "sessions")}`)),
            );
        }
        sections.push(lines.join("\n"));
    }

    // ── FILES ──
    {
        const lines = ["── FILES · most-touched ──"];
        if (report.topFiles.length === 0) {
            lines.push("  none touched");
        } else {
            lines.push(
                ...capRows(report.topFiles.map((f) => `  ${f.path} · ${formatInt(f.count)} ${pl(f.count, "touch", "touches")}`)),
            );
        }
        sections.push(lines.join("\n"));
    }

    // ── TOOLS ──
    {
        const totalCalls = report.topTools.reduce((acc, t) => acc + t.count, 0);
        const lines = [`── TOOLS · ${formatInt(totalCalls)} ${pl(totalCalls, "call", "calls")} ──`];
        if (report.topTools.length === 0) {
            lines.push("  none recorded");
        } else {
            lines.push(...capRows(report.topTools.map((t) => `  ${t.tool} · ${formatInt(t.count)}`)));
        }
        sections.push(lines.join("\n"));
    }

    // ── LEARNING ──
    {
        const lines = [`── LEARNING · ${formatInt(report.notes.count)} ${pl(report.notes.count, "note", "notes")} ──`];
        if (report.notes.latest !== undefined) {
            const ts = report.notes.latest.ts !== undefined ? ` · ${fmtDate(report.notes.latest.ts)}` : "";
            lines.push(`  latest: ${report.notes.latest.text}${ts}`);
        } else {
            lines.push("  no notes yet — /note <text> records one mid-session");
        }
        sections.push(lines.join("\n"));
    }

    // ── TOKENS ──
    {
        const t = report.tokens;
        const totalTokens = t.prompt + t.completion + t.cached;
        const lines = [`── TOKENS · ${formatInt(totalTokens)} total ──`];
        lines.push(`  prompt ${formatInt(t.prompt)} · completion ${formatInt(t.completion)} · cached ${formatInt(t.cached)}`);
        lines.push(renderBridgeLine(report));
        sections.push(lines.join("\n"));
    }

    // ── FRICTION ──
    {
        const f = report.friction;
        const lines = [`── FRICTION · ${formatInt(f.failedToolResults)} ${pl(f.failedToolResults, "failed tool result", "failed tool results")} ──`];
        if (f.failedToolResults === 0) {
            lines.push("  none — a clean window");
        } else {
            lines.push(
                `  ${formatInt(f.failedToolResults)} ${pl(f.failedToolResults, "failed tool result", "failed tool results")} · ${formatInt(f.sessionsWithErrors)} of ${formatInt(report.sessions.count)} sessions affected`,
            );
        }
        if (f.errorNotes !== undefined && f.errorNotes > 0) {
            lines.push(`  error notes: ${formatInt(f.errorNotes)}`);
        }
        sections.push(lines.join("\n"));
    }

    return `${sections.join("\n\n")}\n\nwindow: ${report.windowDays} ${pl(report.windowDays, "day", "days")} · generated ${report.generatedAt}`;
}

/**
 * One-line footer hint for the /insights command surface — says WHAT was
 * scanned (so "where did these numbers come from" is answered inline), that
 * everything stays local, and that the days window bounds bridge costs only.
 * Pure: describes the scan itself, not a specific run, so it takes no report.
 */
export function insightsHintLine(): string {
    return "/insights — cross-session analytics over your own history: session transcripts, project receipts, bridge usage — everything local; the days window bounds bridge costs only";
}
