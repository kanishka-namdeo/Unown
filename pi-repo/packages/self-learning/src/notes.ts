/**
 * notes.ts — session note recorder.
 *
 * Every finished run leaves a short structured note (what the task was, what
 * the agent did, what failed). Notes are the raw material AutoDream
 * consolidates into the project memory tier.
 */
import { randomUUID } from "node:crypto";
import { store } from "./store.ts";
import { emit } from "./bus.ts";

export function createNote(runId: string, content: string) {
	const id = randomUUID();
	store.run(`INSERT INTO notes (id, run_id, content, created_at) VALUES (?, ?, ?, ?)`, [id, runId, content, Date.now()]);
	emit("note:created", { id, runId });
	return id;
}

export function undreamedNotes(limit = 24) {
	return store.query<any>(`SELECT id, run_id, content, created_at FROM notes WHERE dream_id IS NULL ORDER BY created_at DESC LIMIT ?`, [limit]);
}

export function markDreamed(noteIds: string[], dreamId: string) {
	for (const id of noteIds) {
		store.run(`UPDATE notes SET dream_id = ? WHERE id = ?`, [dreamId, id]);
	}
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
