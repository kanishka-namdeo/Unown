/**
 * sessions-cli.ts — `unown sessions <sub>` (Milestone 3.5).
 *
 * Three subcommands:
 *   unown sessions list                          list persisted sessions in cwd
 *   unown sessions export <session-id> [--out F] write the export JSON
 *   unown sessions import <file>                 rehydrate into a new session id
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

export const SESSIONS_USAGE = `unown sessions — session export / import / list (Milestone 3.5)

Usage:
  unown sessions list
  unown sessions export <session-id> [--out <file>]
  unown sessions import <file>

The exported JSON contains { version, manifest, messages, todos, notes, skills,
files } — a single self-describing file you can rehydrate on another machine
with \`unown sessions import\`. The imported session appears in \`unown sessions
list\` with a fresh id (the original id is preserved in the manifest for
traceability).

Docs: docs/usage.md (sessions).`;

function flagValue(argv: string[], name: string): string | undefined {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
    return argv.includes(name);
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
            process.stderr.write("usage: unown sessions export <session-id> [--out <file>]\n");
            return 1;
        }
        const out = flagValue(argv, "--out");
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
            process.stderr.write(`unown sessions export: cannot open session: ${err?.message ?? err}\n`);
            return 1;
        }
        try {
            const result = await exportSession(sm.getSessionId(), {
                sessionManager: sm,
                outPath: out,
            });
            process.stdout.write(
                `✓ Exported session ${sm.getSessionId()} → ${result.path} (${result.bytes} bytes)\n`,
            );
            return 0;
        } catch (err: any) {
            process.stderr.write(`unown sessions export: ${err?.message ?? err}\n`);
            return 1;
        }
    }

    if (sub === "import") {
        const file = argv[1];
        if (!file || file.startsWith("--")) {
            process.stderr.write("usage: unown sessions import <file>\n");
            return 1;
        }
        try {
            const result = await importSession(file);
            process.stdout.write(
                `✓ Imported session → new id ${result.sessionId} (${result.bytes} bytes written)\n`,
            );
            return 0;
        } catch (err: any) {
            process.stderr.write(`unown sessions import: ${err?.message ?? err}\n`);
            return 1;
        }
    }

    process.stderr.write(`unown sessions: unknown subcommand "${sub}"\n\n${SESSIONS_USAGE}\n`);
    return 1;
}
