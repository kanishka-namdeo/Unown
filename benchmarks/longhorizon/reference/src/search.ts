import type { Note } from "./types.ts";

/**
 * Case-insensitive substring search across title, body, tags and both author
 * fields (createdBy.name and createdBy.id).
 */
export function findMatches(notes: Note[], query: string): Note[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	return notes.filter(
		(n) =>
			n.title.toLowerCase().includes(q) ||
			n.body.toLowerCase().includes(q) ||
			n.tags.some((t) => t.toLowerCase().includes(q)) ||
			n.createdBy.name.toLowerCase().includes(q) ||
			n.createdBy.id.toLowerCase().includes(q),
	);
}

/** Exact (case-insensitive) title match. */
export function findByTitle(notes: Note[], title: string): Note[] {
	const t = title.trim().toLowerCase();
	return notes.filter((n) => n.title.toLowerCase() === t);
}
