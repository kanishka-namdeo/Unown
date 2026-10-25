/**
 * notes.ts — session note recorder.
 *
 * Every finished run leaves a short structured note (what the task was, what the
 * agent did, what failed). Notes are the raw material AutoDream consolidates
 * into the project memory tier.
 *
 * Two note kinds feed the dream pipeline:
 *   benchmark — produced by engine runs (harness cycles, interactive console)
 *   terminal  — produced by `unown` terminal sessions in real projects; these
 *               carry the project path so AutoDream can consolidate them back
 *               into the project's own .unown/memory/project.md
 */
import { randomUUID } from "node:crypto";
import { emit } from "./bus.ts";
import { projectSlug } from "./project-identity.ts";
import { store } from "./store.ts";
// term.ts is the DB-free lane module (terminal agent + engine share it) — the
// shared truncation helpers live THERE so the terminal side can import them
// without dragging this module's store dependency into its import graph
// (test/detachment.test.ts pins that the terminal agent never opens the DB).
import { capTerminalNoteContent, sliceCodePointSafe } from "./term.ts";

export type NoteKind = "benchmark" | "terminal";

export function createNote(runId: string, content: string, kind: NoteKind = "benchmark", projectPath?: string | null) {
        const id = randomUUID();
        const slug = projectPath ? slugifyProject(projectPath) : null;
        store.run(
                `INSERT INTO notes (id, run_id, content, created_at, kind, project_path, project_slug) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, runId, content, Date.now(), kind, projectPath ?? null, slug],
        );
        emit("note:created", { id, runId, kind, projectPath: projectPath ?? null });
        return id;
}

/** Ingest a note coming from a terminal session in a real project (no run row).
 * Content is truncated at the HTTP-lane cap (server.ts rejects >20k there):
 * legacy outbox files written before the agent-side cap existed must not
 * bypass it at drain time (M6 parity fix). The cap is the SHARED shape
 * (term.ts capTerminalNoteContent — BUG 9): codepoint-safe slice + the same
 * `\n(truncated)` marker the outbox write appends, so the same oversized
 * note stored via either delivery path is byte-identical and the drain's
 * exact-content dedup catches double delivery. Idempotent by construction:
 * an already-capped note re-entering ingest comes through unchanged. */
export function ingestTerminalNote(content: string, projectPath: string) {
        return createNote(null as any, capTerminalNoteContent(content), "terminal", projectPath);
}

export function undreamedNotes(limit = 24, kind?: NoteKind) {
        if (kind) {
                return store.query<any>(
                        `SELECT id, run_id, content, created_at, kind, project_path, project_slug FROM notes WHERE dream_id IS NULL AND kind = ? ORDER BY created_at DESC LIMIT ?`,
                        [kind, limit],
                );
        }
        return store.query<any>(
                `SELECT id, run_id, content, created_at, kind, project_path, project_slug FROM notes WHERE dream_id IS NULL ORDER BY created_at DESC LIMIT ?`,
                [limit],
        );
}

/** Per-project fairness cap for one dream pass (BUG 6): a single project may
 *  contribute at most this many notes, oldest-first. Dreams run every 10
 *  minutes and consume ≤40 notes per pass — without a per-project cap, the
 *  40 NEWEST undreamed terminal notes (the pre-fix global ORDER BY
 *  created_at DESC) all came from whichever project produced notes most
 *  recently, so a busy project starved every quieter project's notes
 *  indefinitely (they aged forever at the tail of the DESC window). 12 keeps
 *  the global 40-cap meaningful across ≥4 active projects per pass. */
const TERMINAL_NOTES_PER_PROJECT_CAP = 12;

/** Pending terminal notes grouped by project PATH (not the stored slug —
 *  identity resolution must happen at dream time, so legacy rows written
 *  under the old basename-only slug heal onto the composite scope when the
 *  project next dreams; grouping by path also keeps two same-named projects'
 *  notes apart from the start).
 *
 *  FAIRNESS (BUG 6): selection is per-project in SQL — up to `perProjectCap`
 *  OLDEST notes per project_path (window function), then the global `limit`
 *  oldest overall — so a high-volume project cannot crowd other projects'
 *  notes out of a pass, and every group's notes arrive oldest-first (the
 *  chronological order the consolidation prompt reads; groups themselves
 *  surface longest-waiting-project-first, mirroring the note ordering).
 *
 *  PATHLESS NOTES (BUG 7): rows with a NULL/empty/whitespace project_path can
 *  never be dreamed honestly — their group would carry projectPath "", and
 *  the dream's initProjectMemory("")/projectMemoryPath("") resolve to a
 *  RELATIVE `.unown/memory/` inside the ENGINE's cwd (plus a bogus
 *  migrateLegacyScope attempt on the empty basename). They are skipped from
 *  the returned groups AND consumed here with an honest dreams row (see
 *  consumePathlessTerminalNotes) — never written to disk, never re-selected
 *  on every later pass. */
export function pendingTerminalNotesByProject(
        limit = 40,
        perProjectCap = TERMINAL_NOTES_PER_PROJECT_CAP,
): Array<{ slug: string; projectPath: string; notes: any[] }> {
        consumePathlessTerminalNotes();
        const rows = store.query<any>(
                `SELECT id, run_id, content, created_at, kind, project_path, project_slug
                 FROM (
                        SELECT *, ROW_NUMBER() OVER (
                                PARTITION BY project_path
                                ORDER BY created_at ASC, id ASC
                        ) AS rn
                        FROM notes
                        WHERE dream_id IS NULL AND kind = 'terminal'
                          AND project_path IS NOT NULL AND TRIM(project_path) <> ''
                 )
                 WHERE rn <= ?
                 ORDER BY created_at ASC, id ASC
                 LIMIT ?`,
                [perProjectCap, limit],
        );
        const groups = new Map<string, { slug: string; projectPath: string; notes: any[] }>();
        for (const n of rows) {
                const projectPath = n.project_path ?? "";
                if (!groups.has(projectPath)) {
                        groups.set(projectPath, { slug: slugifyProject(projectPath), projectPath, notes: [] });
                }
                groups.get(projectPath)!.notes.push(n);
        }
        return [...groups.values()];
}

/** Consume undreamed terminal notes that carry no usable project path (BUG 7)
 *  with an honest dreams row instead of dreaming them. This runs inside the
 *  runProjectDream grouping pass, so such rows are retired exactly when a
 *  dream would otherwise have (mis)handled them — they can never accumulate
 *  as an undreamed backlog, and the dreams row is the visible audit trail for
 *  where the notes went. `status='done'` (not 'error'): skipping is the
 *  CORRECT outcome for an undreamable note, not a failure; `entries_added=0`
 *  keeps it out of the dream-news toast lane. */
function consumePathlessTerminalNotes(): void {
        const rows = store.query<{ id: string }>(
                `SELECT id FROM notes
                 WHERE dream_id IS NULL AND kind = 'terminal'
                   AND (project_path IS NULL OR TRIM(project_path) = '')`,
        );
        if (rows.length === 0) return;
        const dreamId = `skip-${randomUUID()}`;
        const now = Date.now();
        store.run(
                `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, note) VALUES (?, ?, ?, 'done', ?, ?)`,
                [
                        dreamId,
                        now,
                        now,
                        rows.length,
                        `skipped: ${rows.length} terminal note(s) without project path — consumed, never dreamed (no project to consolidate into; a dream would scaffold .unown/ relative to the engine's own cwd)`,
                ],
        );
        markDreamed(
                rows.map((r) => r.id),
                dreamId,
        );
        emit("dream:finished", { id: dreamId, status: "done", notesIn: rows.length, reason: "skipped: note without project path" });
}

export function markDreamed(noteIds: string[], dreamId: string) {
        for (const id of noteIds) {
                store.run(`UPDATE notes SET dream_id = ? WHERE id = ?`, [dreamId, id]);
        }
}

/** Stable short identifier for a project path (used as the memory-version tier key).
 *
 *  Composite form `<basename>-<identity6>` (project-identity.ts): the git
 *  remote (or resolved path) hashed to 6 hex — two same-named directories in
 *  different locations NO LONGER share one memory scope (the cross-project
 *  memory leak), while clones/worktrees/renames of one repository DO. */
export function slugifyProject(projectPath: string): string {
        return projectSlug(projectPath);
}

/** Build the note text for a completed run (called by the runner). */
export function noteFromRun(run: {
        id: string;
        taskId?: string | null;
        kind: string;
        status: string;
        prompt?: string | null;
        toolCalls?: number;
        turns?: number;
        tokensIn?: number;
        tokensOut?: number;
        verifySummary?: string | null;
        verifyLog?: string;
        lastAssistantText?: string;
        toolsUsed?: string[];
}): string {
        const lines: string[] = [];
        lines.push(
                `Run ${run.id.slice(0, 8)} (${run.kind}) on task ${run.taskId ?? "interactive"}: ${run.status.toUpperCase()}`,
        );
        if (run.verifySummary) lines.push(`Verification: ${run.verifySummary}`);
        lines.push(
                `Tools used: ${run.toolsUsed?.length ? `${run.toolCalls ?? 0} calls (${[...new Set(run.toolsUsed)].join(", ")})` : "none"}`,
        );
        if (run.status !== "passed" && run.verifyLog) {
                const failures = run.verifyLog
                        .split("\n")
                        .filter((l) => /AssertionError|assert|error:|✗|FAIL|not implemented|tamper/i.test(l))
                        .slice(0, 6)
                        // BUG 13: codepoint-safe — a plain slice can orphan a surrogate
                        // pair at the 200-unit boundary (same class as the note-lane caps).
                        .map((l) => sliceCodePointSafe(l.trim(), 200));
                if (failures.length) lines.push(`Failure evidence:\n  - ${failures.join("\n  - ")}`);
        }
        // BUG 13: same codepoint-safe backoff at the 300-unit boundary.
        if (run.lastAssistantText) lines.push(`Agent's final words: ${sliceCodePointSafe(run.lastAssistantText, 300)}`);
        return lines.join("\n");
}
