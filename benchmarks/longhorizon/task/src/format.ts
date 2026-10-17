import { wordCount } from "./note.ts";
import type { Note } from "./types.ts";

/**
 * Plain single-line rendering, used by `clippad list` and `clippad find`.
 * Shape: "• [n-001] Ship it (by ada) — 4 words"
 */
export function formatNote(note: Note): string {
	return `• [${note.id}] ${note.title} (by ${note.createdBy}) — ${wordCount(note)} words`;
}

/** Section header, e.g. "== All notes (3) ==". */
export function formatHeader(label: string, count: number): string {
	return `== ${label} (${count}) ==`;
}
