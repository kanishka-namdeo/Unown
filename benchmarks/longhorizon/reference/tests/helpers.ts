import { resetIds } from "../src/ids.ts";
import { createNote } from "../src/note.ts";
import type { Author, Note, NoteInput } from "../src/types.ts";

/** Default note author used across the suite. */
export const DEFAULT_AUTHOR: Author = { id: "u-001", name: "ada" };

export const OTHER_AUTHOR: Author = { id: "u-002", name: "grace" };

/** Build a note with sensible defaults; override any field via `over`. */
export function mkNote(over: Partial<NoteInput> = {}): Note {
	return createNote({
		title: "note title",
		body: "some body text",
		createdBy: DEFAULT_AUTHOR,
		...over,
	});
}

/** Reset id counters for deterministic ids (call from beforeEach). */
export { resetIds };
