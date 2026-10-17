import { wordCount } from "./note.ts";
import type { Note } from "./types.ts";

/** Per-author rollup used by `clippad stats`. */
export interface AuthorStats {
	id: string; // author id, e.g. "u-001"
	name: string; // author display name, e.g. "ada"
	count: number;
	words: number;
}

/** Group notes by author id; sorted by count desc, then author id. */
export function authorStats(notes: Note[]): AuthorStats[] {
	const map = new Map<string, AuthorStats>();
	for (const n of notes) {
		const row = map.get(n.createdBy.id) ?? { id: n.createdBy.id, name: n.createdBy.name, count: 0, words: 0 };
		row.count += 1;
		row.words += wordCount(n);
		map.set(n.createdBy.id, row);
	}
	return [...map.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/** Total word count across all notes. */
export function totalWords(notes: Note[]): number {
	return notes.reduce((sum, n) => sum + wordCount(n), 0);
}
