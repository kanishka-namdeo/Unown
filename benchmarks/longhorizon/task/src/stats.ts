import { wordCount } from "./note.ts";
import type { Note } from "./types.ts";

/** Per-author rollup used by `clippad stats`. */
export interface AuthorStats {
	author: string; // author NAME
	count: number;
	words: number;
}

/** Group notes by author name; sorted by count desc, then author name. */
export function authorStats(notes: Note[]): AuthorStats[] {
	const map = new Map<string, AuthorStats>();
	for (const n of notes) {
		const row = map.get(n.createdBy) ?? { author: n.createdBy, count: 0, words: 0 };
		row.count += 1;
		row.words += wordCount(n);
		map.set(n.createdBy, row);
	}
	return [...map.values()].sort((a, b) => b.count - a.count || a.author.localeCompare(b.author));
}

/** Total word count across all notes. */
export function totalWords(notes: Note[]): number {
	return notes.reduce((sum, n) => sum + wordCount(n), 0);
}
