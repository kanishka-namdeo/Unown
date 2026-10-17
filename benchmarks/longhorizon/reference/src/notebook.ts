import { createNote } from "./note.ts";
import type { Note, NoteInput } from "./types.ts";

/** In-memory container of notes. */
export class Notebook {
	private readonly notes: Note[] = [];

	add(input: NoteInput): Note {
		const note = createNote(input);
		this.notes.push(note);
		return note;
	}

	remove(id: string): boolean {
		const i = this.notes.findIndex((n) => n.id === id);
		if (i < 0) return false;
		this.notes.splice(i, 1);
		return true;
	}

	get(id: string): Note | undefined {
		return this.notes.find((n) => n.id === id);
	}

	all(): Note[] {
		return [...this.notes];
	}

	size(): number {
		return this.notes.length;
	}

	/** Notes created by the given author ID (matches note.createdBy.id). */
	byAuthor(id: string): Note[] {
		return this.notes.filter((n) => n.createdBy.id === id);
	}

	byTag(tag: string): Note[] {
		return this.notes.filter((n) => n.tags.includes(tag));
	}

	sortedByTitle(): Note[] {
		return [...this.notes].sort((a, b) => a.title.localeCompare(b.title));
	}
}
