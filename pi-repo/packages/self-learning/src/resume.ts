/**
 * resume.ts — launch-time session resume: `--continue` / `-c` and
 * `--resume <id|name>` (the 2026-10-24 flow round; Claude Code `claude -c` /
 * `claude -r`, Codex `codex resume`, Crush `--continue`, OpenCode `-c`
 * parity — the muscle-memory "pick up where I left off" launch that Unown
 * lacked: only an exact `--session <path>` existed, requiring the user to
 * know the full JSONL filename).
 *
 * Resolution semantics (newest-first everywhere):
 *   `--continue`      → the newest persisted session whose header cwd
 *                       (realpath-compared) is the current directory, across
 *                       BOTH stores: ~/.unown/agent/sessions (pi terminal
 *                       sessions) and <cwd>/.unown/sessions (imports — the
 *                       cross-agent migration lane).
 *   `--resume <query>`→ 1. an existing session FILE path (the --session
 *                          spelling, kept working),
 *                       2. a full or prefix session-id match (the uuid in the
 *                          filename — no file reads needed),
 *                       3. a session NAME match (case-insensitive substring
 *                          on the latest session_info entry — auto-titles and
 *                          /name both land there), newest file wins.
 *                       Ambiguous name matches return the candidates instead
 *                       of guessing (the error lists the five newest).
 *
 * Name scan bounds: each file's header is read from the first 4 KiB; names
 * from the last 512 KiB of files up to 8 MiB (the newest session_info wins —
 * auto-titles land after turn one, /name can land anywhere; a name set early
 * in a >8 MiB session may be missed, in which case --resume <id> or the
 * in-session /resume picker still finds it — documented, not silent).
 */

import { existsSync, openSync, readSync, readFileSync, readdirSync, statSync, closeSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

/** One discovered session file. */
export interface SessionCandidate {
    /** Absolute path to the .jsonl file. */
    file: string;
    /** Session id from the header (uuid or imp-* import id). */
    id: string;
    /** Header cwd (raw, as recorded — may differ from the current spelling). */
    cwd?: string;
    /** Latest session_info name (auto-title or /name), when discoverable. */
    name?: string;
    /** File mtime (ms) — the newest-first ordering key. */
    mtime: number;
}

export type ResumeResolution =
    | { ok: true; file: string; id: string; name?: string; via: "path" | "id" | "name" | "latest" }
    | { ok: false; error: string; candidates?: Array<{ id: string; name?: string; file: string; mtime: number }> };

/** Header bytes read per file (the session line is the FIRST line). */
const HEADER_BYTES = 4096;
/** Tail bytes scanned for the latest session_info name. */
const NAME_TAIL_BYTES = 512 * 1024;
/** Files larger than this skip the name scan (id/path matching still work). */
const NAME_SCAN_MAX_BYTES = 8 * 1024 * 1024;

/** Read up to `bytes` from the START of a file (best-effort, utf8). */
function readHead(file: string, bytes: number): string {
    let fd: number | undefined;
    try {
        fd = openSync(file, "r");
        const buf = Buffer.alloc(bytes);
        const bytesRead = readAt(fd, buf, 0, bytes, 0);
        return buf.subarray(0, bytesRead).toString("utf8");
    } catch {
        return "";
    } finally {
        if (fd !== undefined) {
            try {
                closeSync(fd);
            } catch {
                /* closed elsewhere or already closed */
            }
        }
    }
}

/** readSync for clarity (positional form; never the callback form — that one
 *  is async and returns 0 bytes synchronously, silently breaking every scan). */
function readAt(fd: number, buf: Buffer, offset: number, length: number, position: number): number {
    return readSync(fd, buf, offset, length, position);
}

/** Read the LAST `bytes` of a file (best-effort). */
function readTail(file: string, bytes: number): string {
    let fd: number | undefined;
    try {
        const size = statSync(file).size;
        const start = Math.max(0, size - bytes);
        fd = openSync(file, "r");
        const len = Math.min(bytes, size);
        const buf = Buffer.alloc(len);
        const bytesRead = readAt(fd, buf, 0, len, start);
        return buf.subarray(0, bytesRead).toString("utf8");
    } catch {
        return "";
    } finally {
        if (fd !== undefined) {
            try {
                closeSync(fd);
            } catch {
                /* ignore */
            }
        }
    }
}

/** Parse the session header from the first line of a JSONL file. */
function parseHeader(head: string): { id: string; cwd?: string } | null {
    const firstLine = head.split("\n", 1)[0] ?? "";
    const trimmed = firstLine.trim();
    if (!trimmed) return null;
    try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        if (obj.type !== "session" || typeof obj.id !== "string" || !obj.id) return null;
        const cwd = typeof obj.cwd === "string" ? obj.cwd : undefined;
        return { id: obj.id, cwd };
    } catch {
        return null;
    }
}

/** The latest session_info name in a JSONL body (newest wins — scan backwards). */
function latestSessionName(body: string): string | undefined {
    const lines = body.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line.startsWith("{")) continue;
        try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            if (obj.type === "session_info") {
                const name = typeof obj.name === "string" ? obj.name.trim() : "";
                return name || undefined;
            }
        } catch {
            /* partial line at the tail boundary — keep scanning */
        }
    }
    return undefined;
}

/** List session files (mtime-desc) from every store: the pi terminal store
 *  under agentDir/sessions and the project's import store <cwd>/.unown/sessions. */
export function scanSessionFiles(cwd: string, agentDir: string): string[] {
    const dirs = [join(agentDir, "sessions"), join(cwd, ".unown", "sessions")];
    const files: string[] = [];
    for (const dir of dirs) {
        let names: string[];
        try {
            names = readdirSync(dir);
        } catch {
            continue; // missing dir — normal on a fresh install
        }
        for (const n of names) {
            if (!n.endsWith(".jsonl")) continue;
            const f = join(dir, n);
            try {
                statSync(f); // exists + readable metadata
                files.push(f);
            } catch {
                /* broken entry — skip */
            }
        }
    }
    files.sort((a, b) => {
        try {
            return statSync(b).mtimeMs - statSync(a).mtimeMs;
        } catch {
            return 0;
        }
    });
    return files;
}

/** Full candidates (header + name) for the newest `limit` files. */
export function scanSessions(cwd: string, agentDir: string, limit = Number.POSITIVE_INFINITY): SessionCandidate[] {
    const out: SessionCandidate[] = [];
    for (const file of scanSessionFiles(cwd, agentDir)) {
        if (out.length >= limit) break;
        const head = readHead(file, HEADER_BYTES);
        const parsed = parseHeader(head);
        if (!parsed) continue; // not a session file (or corrupt head) — skip
        let name: string | undefined;
        try {
            const size = statSync(file).size;
            if (size <= NAME_SCAN_MAX_BYTES) {
                const body = size <= NAME_TAIL_BYTES ? readFileSync(file, "utf8") : readTail(file, NAME_TAIL_BYTES);
                name = latestSessionName(body);
            }
        } catch {
            /* name is best-effort */
        }
        let mtime = 0;
        try {
            mtime = statSync(file).mtimeMs;
        } catch {
            /* 0 sorts last */
        }
        out.push({ file, id: parsed.id, cwd: parsed.cwd, name, mtime });
    }
    return out;
}

/** Realpath both sides (missing paths fall back to the literal spelling). */
function sameDir(a: string, b: string): boolean {
    const r = (p: string): string => {
        try {
            return realpathSync(p);
        } catch {
            return resolve(p);
        }
    };
    const ra = r(a);
    const rb = r(b);
    if (ra === rb) return true;
    // Case-insensitive filesystems can still disagree on spelling (drive
    // letters on Windows); compare case-insensitively as the fallback.
    return ra.toLowerCase() === rb.toLowerCase();
}

/** `--continue`: the newest session whose recorded cwd is this directory. */
export function latestSessionForCwd(cwd: string, agentDir: string): ResumeResolution {
    const files = scanSessionFiles(cwd, agentDir);
    for (const file of files) {
        const head = readHead(file, HEADER_BYTES);
        const parsed = parseHeader(head);
        if (!parsed) continue;
        if (parsed.cwd && sameDir(parsed.cwd, cwd)) {
            return { ok: true, file, id: parsed.id, via: "latest" };
        }
    }
    return {
        ok: false,
        error: `no previous session found in this directory (${cwd}) — start one with \`unown\`, or list them with \`unown sessions list\` (imports) / \`/resume\` inside a session`,
    };
}

/** `--resume <query>`: path → id (full or prefix) → name (newest, ambiguous listed). */
export function resolveResumeQuery(cwd: string, agentDir: string, query: string): ResumeResolution {
    const q = query.trim();
    if (!q) {
        return { ok: false, error: "--resume expects a session id, name or file path (bare picker: run `unown` and use /resume)" };
    }
    // 1. An existing file path (absolute or cwd-relative) — the --session spelling.
    const asPath = isAbsolute(q) ? q : resolve(cwd, q);
    if (existsSync(asPath) && asPath.endsWith(".jsonl")) {
        const head = readHead(asPath, HEADER_BYTES);
        const parsed = parseHeader(head);
        return { ok: true, file: asPath, id: parsed?.id ?? basename(asPath), via: "path" };
    }
    // 2. Id match (full or prefix) — the uuid lives in the filename; cheap.
    const qLower = q.toLowerCase();
    const files = scanSessionFiles(cwd, agentDir);
    const idHits: string[] = [];
    for (const f of files) {
        const stem = basename(f, ".jsonl").toLowerCase();
        if (stem === qLower || stem.endsWith(`_${qLower}`) || stem.includes(qLower)) idHits.push(f);
        if (idHits.length > 1) break;
    }
    if (idHits.length === 1) {
        const file = idHits[0];
        const head = readHead(file, HEADER_BYTES);
        const parsed = parseHeader(head);
        return { ok: true, file, id: parsed?.id ?? basename(file, ".jsonl"), via: "id" };
    }
    if (idHits.length > 1) {
        return { ok: false, error: `session id "${q}" is ambiguous (${idHits.length} matches) — use more of the id`, candidates: idHits.map((f) => ({ id: basename(f, ".jsonl"), file: f, mtime: 0 })) };
    }
    // 3. Name match (newest first, case-insensitive substring).
    const candidates = scanSessions(cwd, agentDir);
    const nameHits = candidates.filter((c) => c.name && c.name.toLowerCase().includes(qLower));
    if (nameHits.length === 0) {
        return {
            ok: false,
            error: `no session matches "${q}" (checked ${candidates.length} session file(s): ids and names) — \`unown -c\` continues this directory's latest, \`/resume\` inside a session opens the picker`,
        };
    }
    if (nameHits.length > 1 && nameHits[0].name?.toLowerCase() !== nameHits[1].name?.toLowerCase()) {
        return {
            ok: false,
            error: `"${q}" matches ${nameHits.length} sessions — the newest five are listed; use the id for an exact pick`,
            candidates: nameHits.slice(0, 5).map((c) => ({ id: c.id, name: c.name, file: c.file, mtime: c.mtime })),
        };
    }
    // Exact-same-name duplicates (forks/clones): newest wins, like Claude Code.
    const hit = nameHits[0];
    return { ok: true, file: hit.file, id: hit.id, name: hit.name, via: "name" };
}

/** Human-readable one-liner for the boot notice (where a resume landed). */
export function describeResume(res: Extract<ResumeResolution, { ok: true }>): string {
    const viaNote =
        res.via === "latest"
            ? "continuing this directory's latest session"
            : res.via === "name"
              ? `resumed by name "${res.name}"`
              : res.via === "id"
                ? "resumed by session id"
                : "resumed from file";
    return `${viaNote} — ${basename(res.file)} (${res.id})`;
}
