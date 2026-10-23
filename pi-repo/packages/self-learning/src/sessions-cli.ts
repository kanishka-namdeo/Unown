/**
 * sessions-cli.ts — `unown sessions <sub>` (Milestone 3.5).
 *
 * Three subcommands:
 *   unown sessions list                          list persisted sessions in cwd
 *   unown sessions export <session-id> [--out F] write the export JSON
 *   unown sessions import <file> [--from F]      rehydrate an export JSON — or
 *                                                 convert a Claude Code / Codex
 *                                                 session .jsonl (import-convert.ts)
 *
 * Pattern matches `automations-cli.ts` / `mcp-cli.ts`: returns an exit code,
 * writes to stdout/stderr directly. The actual export/import logic lives in
 * `sessions.ts` (pure); this module owns argv parsing + constructing a
 * minimal `SessionLike` from the JSONL file on disk.
 *
 * NO pi imports — `runSessionsCommand` reads the session .jsonl directly
 * (a header line + N entry lines, each a JSON object) and constructs a
 * `SessionLike` from the parsed entries. This is enough for `exportSession`,
 * which only needs `getSessionId` / `getCwd` / `getEntries` / `getHeader`.
 * The full SessionManager (with branch / append / tree traversal) is only
 * needed for live in-session operations — the CLI is offline (no live session
 * to mutate).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { exportSession, importSession, listSessions, type SessionEntryLike, type SessionLike } from "./sessions.ts";
import { convertAndWriteSession, detectSessionFormat, type SessionFormat } from "./import-convert.ts";

export const SESSIONS_USAGE = `unown sessions — session export / import / list (Milestone 3.5)

Usage:
  unown sessions list
  unown sessions export <session-id> [--out <file>] [--raw]
  unown sessions import <file> [--from <auto|claude|codex|unown>]

The exported JSON contains { version, manifest, messages, todos, notes, skills,
files } — a single self-describing file you can rehydrate on another machine
with \`unown sessions import\`. The imported session appears in \`unown sessions
list\` with a fresh id (the original id is preserved in the manifest for
traceability).

\`sessions import\` also converts FOREIGN agent transcripts (the migration
path away from Claude Code / Codex CLI, which both ship /import themselves):
a Claude Code session (~/.claude/projects/<slug>/*.jsonl) or a Codex rollout
(~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) is rewritten into a native
unown session .jsonl with fresh ids and a linear parent chain, landing in the
same .unown/sessions directory — \`--from\` names the source explicitly
(claude | codex | unown), the default \`auto\` sniffs the line shapes, and a
plain unown export JSON keeps flowing through the rehydrate path above.

Exports are REDACTED by default: known secret shapes (API keys, PATs, PEM
blocks, bearer tokens) become [REDACTED:<type>] markers, because a transfer
artifact routinely changes hands. --raw opts out for a lossless self-transfer
between machines you own.

Docs: docs/usage.md (sessions).`;

function flagValue(argv: string[], name: string): string | undefined {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
    return argv.includes(name);
}

/** First positional (non-flag) argument in `argv`, skipping flags and the
 *  values of value-taking flags — so `import <file> --from <fmt>` and
 *  `import --from <fmt> <file>` both find <file>. */
function positionalArg(argv: string[], valueFlags: string[]): string | undefined {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith("-")) {
            if (valueFlags.includes(arg) && i + 1 < argv.length) i++; // skip the flag's value
            continue;
        }
        return arg;
    }
    return undefined;
}

/** Find the .jsonl session file under <cwd>/.unown/sessions/ that matches
 *  `sessionId` (substring on filename). */
function findSessionFile(sessionDir: string, sessionId: string): string | null {
    if (!existsSync(sessionDir)) return null;
    let files: string[];
    try {
        files = readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
    } catch {
        return null;
    }
    // Prefer a filename match (filenames are <timestamp>_<id>.jsonl).
    const byName = files.find((f) => f.includes(sessionId));
    if (byName) return join(sessionDir, byName);
    return null;
}

/**
 * Try the foreign-format conversion path for `unown sessions import` (the
 * `--from` flag / .jsonl transcripts from Claude Code or Codex). Returns the
 * exit code when the file was handled — converted successfully, or skipped
 * with a reason — and null when the caller should fall through to the
 * portable-JSON `importSession` path (missing file, or an unknown shape
 * under `auto` that may still be an export JSON).
 *
 * Writes into the SAME directory `importSession` uses
 * (`<cwd>/.unown/sessions`) so the converted session shows up in `unown
 * sessions list` and /resume immediately.
 */
function importForeignSession(file: string, from: string, cwd: string): number | null {
    let raw: string;
    try {
        raw = readFileSync(file, "utf8");
    } catch {
        return null; // missing/unreadable — importSession reports the error
    }
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;
    const format: SessionFormat = from === "auto" ? detectSessionFormat(lines) : (from as SessionFormat);
    if (format === "unknown") return null;
    const result = convertAndWriteSession(lines, {
        format,
        targetDir: join(cwd, ".unown", "sessions"),
        fallbackCwd: cwd,
    });
    const { path: convertedPath, bytes } = result;
    if (result.skipped || convertedPath === undefined || bytes === undefined) {
        process.stderr.write(`unown sessions import: ${result.reason ?? "conversion produced no session"}\n`);
        return 1;
    }
    // Re-read the written file for the summary line (fresh id + message
    // count) — convertAndWriteSession's return stays deliberately minimal.
    const written = readFileSync(convertedPath, "utf8").split("\n").filter((l) => l.trim().length > 0);
    let newId = "";
    let messages = 0;
    try {
        const header = JSON.parse(written[0]) as Record<string, unknown>;
        if (typeof header.id === "string") newId = header.id;
    } catch {
        // unreachable — writeConvertedSession just serialized this file
    }
    for (const line of written.slice(1)) {
        try {
            if ((JSON.parse(line) as Record<string, unknown>).type === "message") messages++;
        } catch {
            continue; // tolerate malformed lines
        }
    }
    process.stdout.write(
        `✓ Imported ${format} session → new id ${newId} (${messages} messages, ${bytes} bytes) — /resume or unown sessions list will show it\n`,
    );
    return 0;
}

/**
 * Read a session .jsonl file and construct a minimal `SessionLike` for
 * `exportSession`. The first line is the session header; subsequent lines
 * are entries (messages, model_changes, etc.). Malformed lines are skipped
 * (mirrors `loadEntriesFromFile`'s tolerant parsing in pi-coding-agent).
 *
 * Used by the CLI to avoid a hard dependency on the pi `SessionManager`
 * (which would require spawning pi / opening the agent dir). The CLI is
 * offline — no live session to mutate, so we don't need branch/append.
 */
class FileSessionLike implements SessionLike {
    private readonly sessionId: string;
    private readonly cwd: string;
    private readonly entries: SessionEntryLike[];
    private readonly headerTimestamp: string;
    constructor(file: string) {
        const content = readFileSync(file, "utf8");
        const lines = content.split("\n").filter((l) => l.trim().length > 0);
        if (lines.length === 0) throw new Error(`empty session file: ${file}`);
        const header = JSON.parse(lines[0]);
        if (header.type !== "session" || typeof header.id !== "string") {
            throw new Error(`not a session file (first line is not a session header): ${file}`);
        }
        this.sessionId = header.id;
        this.cwd = typeof header.cwd === "string" ? header.cwd : process.cwd();
        this.headerTimestamp = typeof header.timestamp === "string" ? header.timestamp : new Date().toISOString();
        const entries: SessionEntryLike[] = [];
        for (let i = 1; i < lines.length; i++) {
            try {
                const entry = JSON.parse(lines[i]);
                if (entry && typeof entry.type === "string" && typeof entry.id === "string") {
                    entries.push(entry as SessionEntryLike);
                }
            } catch {
                continue; // tolerate malformed lines (mirrors pi's loadEntriesFromFile)
            }
        }
        this.entries = entries;
    }
    getSessionId(): string {
        return this.sessionId;
    }
    getCwd(): string {
        return this.cwd;
    }
    getEntries(): SessionEntryLike[] {
        return this.entries;
    }
    getHeader() {
        return { id: this.sessionId, timestamp: this.headerTimestamp, cwd: this.cwd };
    }
}

/** Exit-code-returning entry point. `argv` is everything AFTER `unown sessions`
 *  (e.g. `["export", "<id>", "--out", "<path>"]`). */
export async function runSessionsCommand(argv: string[]): Promise<number> {
    const sub = argv[0] ?? "list";

    if (hasFlag(argv, "-h") || hasFlag(argv, "--help") || sub === "help") {
        process.stdout.write(SESSIONS_USAGE + "\n");
        return 0;
    }

    const cwd = process.cwd();

    if (sub === "list") {
        const sessions = listSessions({ cwd });
        if (sessions.length === 0) {
            process.stdout.write("No sessions found in this project. Run `unown` to start one.\n");
            return 0;
        }
        const lines = sessions.map((s) => {
            const date = new Date(s.createdAt).toISOString().replace("T", " ").slice(0, 19);
            const fileCount = s.touchedFiles.length;
            const filesSuffix = fileCount > 0 ? ` · ${fileCount} file(s)` : "";
            return `${s.id}  ${date}  · ${s.messageCount} msg(s)${filesSuffix}`;
        });
        process.stdout.write(lines.join("\n") + "\n");
        return 0;
    }

    if (sub === "export") {
        const sessionId = argv[1];
        if (!sessionId || sessionId.startsWith("--")) {
            process.stderr.write("usage: unown sessions export <session-id> [--out <file>] [--raw]\n");
            return 1;
        }
        const out = flagValue(argv, "--out");
        const raw = hasFlag(argv, "--raw");
        const sessionDir = join(cwd, ".unown", "sessions");
        const sessionFile = findSessionFile(sessionDir, sessionId);
        if (!sessionFile) {
            process.stderr.write(
                `unown sessions export: no session file matching id "${sessionId}" under ${sessionDir}\n`,
            );
            return 1;
        }
        let sm: SessionLike;
        try {
            sm = new FileSessionLike(sessionFile);
        } catch (err: any) {
            process.stderr.write(`unown sessions export: cannot open session: ${err instanceof Error ? err.message : String(err)}\n`);
            return 1;
        }
        try {
            const result = await exportSession(sm.getSessionId(), {
                sessionManager: sm,
                outPath: out,
                redact: !raw,
            });
            const redactionNote =
                result.redacted > 0
                    ? ` — ${result.redacted} secret${result.redacted === 1 ? "" : "s"} redacted ([REDACTED:*] markers; --raw keeps them verbatim)`
                    : "";
            process.stdout.write(
                `✓ Exported session ${sm.getSessionId()} → ${result.path} (${result.bytes} bytes)${redactionNote}\n`,
            );
            return 0;
        } catch (err: any) {
            process.stderr.write(`unown sessions export: ${err instanceof Error ? err.message : String(err)}\n`);
            return 1;
        }
    }

    if (sub === "import") {
        const file = positionalArg(argv.slice(1), ["--from"]);
        if (!file) {
            process.stderr.write("usage: unown sessions import <file> [--from <auto|claude|codex|unown>]\n");
            return 1;
        }
        const from = flagValue(argv, "--from") ?? "auto";
        if (from !== "auto" && from !== "claude" && from !== "codex" && from !== "unown") {
            process.stderr.write(
                `unown sessions import: invalid --from value "${from}" (expected auto, claude, codex or unown)\n`,
            );
            return 1;
        }
        // Foreign transcripts (Claude Code / Codex .jsonl) are CONVERTED into
        // a native unown session instead of rehydrating a portable export.
        if (file.endsWith(".jsonl") || from !== "auto") {
            const code = importForeignSession(file, from, cwd);
            if (code !== null) return code;
            // null: not a convertible foreign session — fall through to the
            // portable-JSON path below, which reports its own clear errors.
        }
        try {
            const result = await importSession(file);
            process.stdout.write(
                `✓ Imported session → new id ${result.sessionId} (${result.bytes} bytes written)\n`,
            );
            return 0;
        } catch (err: any) {
            process.stderr.write(`unown sessions import: ${err instanceof Error ? err.message : String(err)}\n`);
            return 1;
        }
    }

    process.stderr.write(`unown sessions: unknown subcommand "${sub}"\n\n${SESSIONS_USAGE}\n`);
    return 1;
}
