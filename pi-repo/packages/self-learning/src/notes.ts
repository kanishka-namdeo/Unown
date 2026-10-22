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
 * bypass it at drain time (M6 parity fix). */
export function ingestTerminalNote(content: string, projectPath: string) {
        return createNote(null as any, content.slice(0, 20000), "terminal", projectPath);
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

/** Pending terminal notes grouped by project PATH (not the stored slug —
 *  identity resolution must happen at dream time, so legacy rows written
 *  under the old basename-only slug heal onto the composite scope when the
 *  project next dreams; grouping by path also keeps two same-named projects'
 *  notes apart from the start). */
export function pendingTerminalNotesByProject(limit = 40): Array<{ slug: string; projectPath: string; notes: any[] }> {
        const rows = undreamedNotes(limit, "terminal");
        const groups = new Map<string, { slug: string; projectPath: string; notes: any[] }>();
        for (const n of rows) {
                const projectPath = n.project_path ?? "";
                const key = projectPath || n.project_slug || "unknown";
                if (!groups.has(key)) {
                        groups.set(key, {
                                slug: projectPath ? slugifyProject(projectPath) : (n.project_slug ?? "unknown"),
                                projectPath,
                                notes: [],
                        });
                }
                groups.get(key)!.notes.push(n);
        }
        return [...groups.values()];
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
                        .map((l) => l.trim().slice(0, 200));
                if (failures.length) lines.push(`Failure evidence:\n  - ${failures.join("\n  - ")}`);
        }
        if (run.lastAssistantText) lines.push(`Agent's final words: ${run.lastAssistantText.slice(0, 300)}`);
        return lines.join("\n");
}
