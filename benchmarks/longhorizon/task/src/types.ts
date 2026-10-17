/**
 * clippad — core domain types.
 *
 * A note is the single aggregate of the app: everything else (notebook,
 * search, formatters, store, stats, cli) operates on Note objects.
 */

/** The creator of a note. Today a plain author NAME, e.g. "ada". */
export type Author = string;

export interface Note {
	id: string;
	title: string;
	body: string;
	createdAt: number; // epoch milliseconds
	createdBy: Author; // author name, e.g. "ada"
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
