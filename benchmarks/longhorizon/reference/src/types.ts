/**
 * clippad — core domain types.
 *
 * A note is the single aggregate of the app: everything else (notebook,
 * search, formatters, store, stats, cli) operates on Note objects.
 */

/** The creator of a note: a structured author record. */
export interface Author {
	id: string; // stable user id, e.g. "u-001"
	name: string; // display name, e.g. "ada"
}

export interface Note {
	id: string;
	title: string;
	body: string;
	createdAt: number; // epoch milliseconds
	createdBy: Author; // structured author record
	tags: string[];
}

/** Input accepted by createNote; id/createdAt are filled in when omitted. */
export interface NoteInput {
	title: string;
	body: string;
	createdBy: Author;
	tags?: string[];
	createdAt?: number;
	id?: string;
}
