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
import { basename } from "node:path";
import { store } from "./store.ts";
import { emit } from "./bus.ts";

export type NoteKind = "benchmark" | "terminal";

export function createNote(runId: string, content: string, kind: NoteKind = "benchmark", projectPath?: string | null) {
	const id = randomUUID();
	const slug = projectPath ? slugifyProject(projectPath) : null;
	store.run(`INSERT INTO notes (id, run_id, content, created_at, kind, project_path, project_slug) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
		id,
		runId,
		content,
		Date.now(),
		kind,
		projectPath ?? null,
		slug,
	]);
	emit("note:created", { id, runId, kind, projectPath: projectPath ?? null });
	return id;
}

/** Ingest a note coming from a terminal session in a real project (no run row). */
export function ingestTerminalNote(content: string, projectPath: string) {
	return createNote(null as any, content, "terminal", projectPath);
}

export function undreamedNotes(limit = 24, kind?: NoteKind) {
	if (kind) {
		return store.query<any>(`SELECT id, run_id, content, created_at, kind, project_path, project_slug FROM notes WHERE dream_id IS NULL AND kind = ? ORDER BY created_at DESC LIMIT ?`, [kind, limit]);
	}
	return store.query<any>(`SELECT id, run_id, content, created_at, kind, project_path, project_slug FROM notes WHERE dream_id IS NULL ORDER BY created_at DESC LIMIT ?`, [limit]);
}

/** Pending terminal notes grouped by project slug. */
export function pendingTerminalNotesByProject(limit = 40): Array<{ slug: string; projectPath: string; notes: any[] }> {
	const rows = undreamedNotes(limit, "terminal");
	const groups = new Map<string, { slug: string; projectPath: string; notes: any[] }>();
	for (const n of rows) {
		const slug = n.project_slug ?? "unknown";
		if (!groups.has(slug)) groups.set(slug, { slug, projectPath: n.project_path ?? "", notes: [] });
		groups.get(slug)!.notes.push(n);
	}
	return [...groups.values()];
}

export function markDreamed(noteIds: string[], dreamId: string) {
	for (const id of noteIds) {
		store.run(`UPDATE notes SET dream_id = ? WHERE id = ?`, [dreamId, id]);
	}
}

/** Stable short identifier for a project path (used as the memory-version tier key). */
export function slugifyProject(projectPath: string): string {
	const base = basename(projectPath) || "project";
	const cleaned = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "project";
	return cleaned;
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
	lines.push(`Run ${run.id.slice(0, 8)} (${run.kind}) on task ${run.taskId ?? "interactive"}: ${run.status.toUpperCase()}`);
	if (run.verifySummary) lines.push(`Verification: ${run.verifySummary}`);
	lines.push(`Tools used: ${run.toolsUsed?.length ? `${run.toolCalls ?? 0} calls (${[...new Set(run.toolsUsed)].join(", ")})` : "none"}`);
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
