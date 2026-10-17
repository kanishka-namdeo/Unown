import { wordCount } from "./note.ts";
import type { Note } from "./types.ts";

/**
 * Fixed-width table rendering, used by `clippad table`.
 * Columns: ID, TITLE, CREATED-BY, WORDS. The CREATED-BY column renders the
 * author as "<name> (<id>)".
 */
export function formatNoteTable(notes: Note[]): string {
	const rows = notes.map((n) => ({
		id: n.id,
		title: n.title,
		createdBy: `${n.createdBy.name} (${n.createdBy.id})`,
		words: String(wordCount(n)),
	}));
	const widths = {
		id: Math.max("ID".length, ...rows.map((r) => r.id.length)),
		title: Math.max("TITLE".length, ...rows.map((r) => r.title.length)),
		createdBy: Math.max("CREATED-BY".length, ...rows.map((r) => r.createdBy.length)),
		words: Math.max("WORDS".length, ...rows.map((r) => r.words.length)),
	};
	const header = [
		"ID".padEnd(widths.id),
		"TITLE".padEnd(widths.title),
		"CREATED-BY".padEnd(widths.createdBy),
		"WORDS".padEnd(widths.words),
	].join("  ");
	const line = "-".repeat(header.length);
	const body = rows.map((r) =>
		[
			r.id.padEnd(widths.id),
			r.title.padEnd(widths.title),
			r.createdBy.padEnd(widths.createdBy),
			r.words.padEnd(widths.words),
		].join("  "),
	);
	return [header, line, ...body].join("\n");
}
