/**
 * dream.ts — Auto Dreaming (pattern 4/5).
 *
 * An AutoDream sub-agent that periodically consumes accumulated session notes
 * from multiple runs, merges duplicates, resolves contradictions, prunes stale
 * entries, reorganizes by topic, and writes a consolidated project-memory
 * file — so the next session starts where the last one left off.
 */
import { randomUUID } from "node:crypto";
import { store } from "./store.ts";
import { chatJson } from "./llm.ts";
import { undreamedNotes, markDreamed } from "./notes.ts";
import { readTier, writeTier, currentVersion } from "./memory.ts";
import { emit } from "./bus.ts";

export interface DreamResult {
	id: string;
	status: "done" | "no-notes" | "error";
	notesIn: number;
	merged: number;
	pruned: number;
	added: number;
	output: string;
	note?: string;
	error?: string;
}

const SYSTEM = `You are AutoDream, the memory-consolidation sub-agent of a self-learning coding agent.
You receive the CURRENT project memory file and a set of SESSION NOTES from recent runs.
Your job: write the NEXT version of the project memory file.

Rules:
1. Merge duplicate notes into single, precise rules.
2. Resolve contradictions: prefer the rule backed by the most recent evidence; drop the loser.
3. Prune stale or one-off observations that will not help future runs.
4. Reorganize into clear topic sections (## Workflow, ## Known pitfalls, ## Task playbooks, ...).
5. PRESERVE rules that were hard-won (they reference fixed failures / harness improvements) — never delete them, only tighten wording.
6. New durable lessons become short imperative bullets under the fitting topic.
7. Keep the whole file under 120 lines. Markdown only. No prose paragraphs — bullets.
Return STRICT JSON: {"projectMd": "<full new file content>", "stats": {"merged": <int>, "pruned": <int>, "added": <int>, "topics": ["..."]}}`;

export async function runDream(): Promise<DreamResult> {
	const id = randomUUID();
	const notes = undreamedNotes(24);

	if (notes.length === 0) {
		store.run(`INSERT INTO dreams (id, started_at, ended_at, status, notes_in) VALUES (?, ?, ?, 'no-notes', 0)`, [id, Date.now(), Date.now()]);
		emit("dream:finished", { id, status: "no-notes" });
		return { id, status: "no-notes", notesIn: 0, merged: 0, pruned: 0, added: 0, output: "" };
	}

	store.run(`INSERT INTO dreams (id, started_at, status, notes_in) VALUES (?, ?, 'running', ?)`, [id, Date.now(), notes.length]);
	emit("dream:started", { id, notesIn: notes.length });

	try {
		const currentMemory = readTier("project");
		const notesText = notes
			.map((n: any) => `--- note (${new Date(n.created_at).toISOString()}) run=${String(n.run_id ?? "").slice(0, 8)} ---\n${n.content}`)
			.join("\n\n");

		const result = await chatJson<{ projectMd: string; stats: { merged: number; pruned: number; added: number; topics?: string[] } }>(
			[
				{ role: "system", content: SYSTEM },
				{
					role: "user",
					content: `CURRENT PROJECT MEMORY (version ${currentVersion("project")}):\n\n${currentMemory}\n\nSESSION NOTES SINCE LAST DREAM (${notes.length}):\n\n${notesText}`,
				},
			],
			{ maxTokens: 3000 },
		);

		const next = String(result.projectMd ?? "").trim();
		if (!next || next.length < 60) throw new Error("dream produced empty memory");
		const stats = result.stats ?? { merged: 0, pruned: 0, added: 0 };

		const version = writeTier("project", next + "\n", "autodream", `consolidated ${notes.length} notes (merged ${stats.merged}, pruned ${stats.pruned}, added ${stats.added})`);
		markDreamed(
			notes.map((n: any) => n.id),
			id,
		);

		store.run(
			`UPDATE dreams SET ended_at = ?, status = 'done', entries_merged = ?, entries_pruned = ?, entries_added = ?, output = ?, note = ? WHERE id = ?`,
			[Date.now(), stats.merged ?? 0, stats.pruned ?? 0, stats.added ?? 0, next, `project memory -> v${version}`, id],
		);
		emit("dream:finished", { id, status: "done", notesIn: notes.length, stats, version });
		return {
			id,
			status: "done",
			notesIn: notes.length,
			merged: stats.merged ?? 0,
			pruned: stats.pruned ?? 0,
			added: stats.added ?? 0,
			output: next,
		};
	} catch (err: any) {
		const msg = err?.message ?? String(err);
		store.run(`UPDATE dreams SET ended_at = ?, status = 'error', note = ? WHERE id = ?`, [Date.now(), msg, id]);
		emit("dream:finished", { id, status: "error", error: msg });
		return { id, status: "error", notesIn: notes.length, merged: 0, pruned: 0, added: 0, output: "", error: msg };
	}
}

export function listDreams(limit = 30) {
	return store.query<any>(`SELECT * FROM dreams ORDER BY started_at DESC LIMIT ?`, [limit]);
}

export function dreamNotes(dreamId: string) {
	return store.query<any>(`SELECT * FROM notes WHERE dream_id = ? ORDER BY created_at`, [dreamId]);
}
