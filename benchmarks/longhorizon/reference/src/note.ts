import { nextId } from "./ids.ts";
import type { Author, Note, NoteInput } from "./types.ts";

/** Build a Note from a NoteInput, filling in id and createdAt defaults. */
export function createNote(input: NoteInput): Note {
	return {
		id: input.id ?? nextId("n"),
		title: input.title,
		body: input.body,
		createdAt: input.createdAt ?? 0,
		createdBy: input.createdBy,
		tags: [...(input.tags ?? [])],
	};
}

/** Number of non-empty words in the note body. */
export function wordCount(note: Note): number {
	return note.body.split(/\s+/).filter(Boolean).length;
}

/** One-line summary used by list output headers. */
export function summaryLine(note: Note): string {
	return `[${note.id}] ${note.title} — ${wordCount(note)} words`;
}
